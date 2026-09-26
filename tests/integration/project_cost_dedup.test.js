/**
 * اختبار منع الازدواج عند الإدخال (Cost Dedup)
 * ============================================================================
 * - ربط بند فرعي بسند رسمي يمتصه (يُحتسب السند فقط عند الترحيل).
 * - الربط الجزئي: السند + متبقي البند.
 * - العكس يعيد البند للاحتساب تلقائياً.
 * - رفض الربط المزدوج، وتحذيرات الاشتباه غير الحاجبة.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../../server/database/db');
const app = require('../../server/server');

test('Project Cost Dedup - Link Absorption & Duplicate Warnings', async (t) => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(() => {
    if (server.closeAllConnections) server.closeAllConnections();
    server.close();
  });

  const JWT_SECRET = process.env.JWT_SECRET || 'rawasi_aden_secret_key_2024';
  const csrfToken = 'cost-dedup-test-csrf-token-1234567890123456789012345678901';
  const testerId = 7202;
  const today = new Date().toISOString().split('T')[0];
  const PROJECT_NAME = 'TEST-DEDUP مشروع اختبار منع الازدواج';

  const adminHeaders = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + jwt.sign(
      { id: testerId, username: 'cost_dedup_tester', role: 'admin', permissions: ['*'] },
      JWT_SECRET,
      { expiresIn: '1h' }
    ),
    'X-CSRF-Token': csrfToken,
    'X-Requested-With': 'XMLHttpRequest',
    'Connection': 'close'
  };

  const api = async (method, path, body = null) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: adminHeaders,
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  };

  const cleanup = async () => {
    try {
      const projs = await db.query('SELECT id FROM projects WHERE name = ?', [PROJECT_NAME]);
      for (const p of projs) {
        const exps = await db.query('SELECT id FROM expenses WHERE project_id = ?', [p.id]);
        const expIds = exps.map(e => e.id);
        if (expIds.length > 0) {
          const ph = expIds.map(() => '?').join(',');
          const jes = await db.query(`SELECT id FROM journal_entries WHERE reference_id IN (${ph})`, expIds);
          const jeIds = jes.map(j => j.id);
          if (jeIds.length > 0) {
            const jph = jeIds.map(() => '?').join(',');
            await db.run(`DELETE FROM journal_entry_lines WHERE entry_id IN (${jph})`, jeIds);
            await db.run(`DELETE FROM journal_entries WHERE id IN (${jph})`, jeIds);
          }
          await db.run(`DELETE FROM expenses WHERE id IN (${ph})`, expIds);
        }
        await db.run('DELETE FROM inventory_transactions WHERE project_id = ?', [p.id]);
        await db.run('DELETE FROM project_labor_expenses WHERE project_id = ?', [p.id]);
        await db.run('DELETE FROM project_purchases WHERE project_id = ?', [p.id]);
        await db.run('DELETE FROM projects WHERE id = ?', [p.id]);
      }
      await db.run('DELETE FROM users WHERE id = ?', [testerId]);
    } catch {}
  };

  await cleanup();
  await db.run(
    `INSERT OR REPLACE INTO users (id, username, password_hash, role, full_name, status, permissions)
     VALUES (?, 'cost_dedup_tester', ?, 'admin', 'مختبر منع الازدواج', 'active', '["*"]')`,
    [testerId, bcrypt.hashSync('Pass@123456', 10)]
  );

  try {
    // 1. مشروع اختبار
    let r = await api('POST', '/api/projects', {
      name: PROJECT_NAME, contract_value: 500000, estimated_cost: 300000
    });
    assert.strictEqual(r.status, 200, 'إنشاء المشروع: ' + JSON.stringify(r.data));
    const projectId = r.data.id;

    // 2. أجور غير مدفوعة 60,000 (بلا مرآة) ← التكلفة = 60,000
    r = await api('POST', `/api/project-hub/${projectId}/labor`, {
      worker_name_or_team: 'طاقم الازدواج', trade: 'نجارة',
      total_amount: 60000, payment_status: 'غير مدفوع', date: today
    });
    assert.strictEqual(r.status, 200, 'تسجيل الأجور: ' + JSON.stringify(r.data));
    const laborId = r.data.data.id;

    let proj = await db.get('SELECT actual_cost FROM projects WHERE id = ?', [projectId]);
    assert.strictEqual(Number(proj.actual_cost), 60000, 'التكلفة بعد الأجور');

    // 3. سند مرحل 60,000 مربوط بالأجور ← التكلفة تبقى 60,000 (لا 120,000)
    r = await api('POST', '/api/expenses', {
      expense_type: 'أجور عمالة', project_id: projectId, amount: 60000,
      payment_method: 'نقدي', date: today, link_labor_id: laborId
    });
    assert.strictEqual(r.status, 200, 'سند مرتبط: ' + JSON.stringify(r.data));
    assert.ok(r.data.link_note, 'يجب إرجاع ملاحظة الربط');
    const linkedExpenseId = r.data.id;

    proj = await db.get('SELECT actual_cost FROM projects WHERE id = ?', [projectId]);
    assert.strictEqual(Number(proj.actual_cost), 60000, 'البند الممتص لا يُحتسب مرتين');

    // 4. التفصيل يكشف الامتصاص
    r = await api('GET', `/api/projects/${projectId}/cost-breakdown`);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.data.data.breakdown.expenses, 60000, 'السند محتسب');
    assert.strictEqual(r.data.data.breakdown.labor, 0, 'الأجور الممتصة صفر');
    assert.strictEqual(r.data.data.breakdown.labor_absorbed, 60000, 'الممتص 60k');
    assert.strictEqual(r.data.data.linked_items.length, 1, 'بند مربوط واحد ظاهر');

    // 5. عكس السند ← الأجور تعود للاحتساب تلقائياً (60,000)
    r = await api('POST', `/api/expenses/${linkedExpenseId}/reverse`, {
      reason: 'اختبار فك الامتصاص بالعكس', reversal_date: today
    });
    assert.strictEqual(r.status, 200, 'العكس: ' + JSON.stringify(r.data));
    proj = await db.get('SELECT actual_cost FROM projects WHERE id = ?', [projectId]);
    assert.strictEqual(Number(proj.actual_cost), 60000, 'بعد العكس تعود الأجور للاحتساب');

    // 6. ربط نفس البند بسند آخر ← مرفوض (مربوط مسبقاً)
    r = await api('POST', '/api/expenses', {
      expense_type: 'أجور عمالة', project_id: projectId, amount: 60000,
      payment_method: 'نقدي', date: today, link_labor_id: laborId
    });
    assert.strictEqual(r.status, 500, 'الربط المزدوج يجب أن يُرفض');
    assert.match(r.data.message, /مربوط مسبقاً/, 'رسالة الربط المسبق');

    // 7. ربط مزدوج (أجور + مشتريات معاً) ← مرفوض
    r = await api('POST', '/api/expenses', {
      expense_type: 'مواد بناء', project_id: projectId, amount: 10000,
      payment_method: 'نقدي', date: today, link_labor_id: laborId, link_purchase_id: 1
    });
    assert.strictEqual(r.status, 400, 'ربط بندين معاً مرفوض');

    // 8. ربط جزئي: فاتورة 80,000 + سند 30,000 ← 30k سند + 50k متبقي
    r = await api('POST', `/api/project-hub/${projectId}/purchases`, {
      item_description: 'حديد للازدواج', total_amount: 80000,
      paid_amount: 0, payment_status: 'غير مدفوع', date: today
    });
    assert.strictEqual(r.status, 200, 'الفاتورة: ' + JSON.stringify(r.data));
    const purchaseId = r.data.data.id;

    r = await api('POST', '/api/expenses', {
      expense_type: 'مواد بناء', project_id: projectId, amount: 30000,
      payment_method: 'نقدي', date: today, link_purchase_id: purchaseId
    });
    assert.strictEqual(r.status, 200, 'سند جزئي: ' + JSON.stringify(r.data));
    assert.match(r.data.link_note || '', /جزئي/, 'ملاحظة الربط الجزئي');

    r = await api('GET', `/api/projects/${projectId}/cost-breakdown`);
    const bd = r.data.data.breakdown;
    assert.strictEqual(bd.purchases, 50000, 'متبقي الفاتورة 50k');
    assert.strictEqual(bd.purchases_absorbed, 30000, 'الممتص 30k');
    // الإجمالي: 60 أجور + 30 سند مواد + 50 متبقي فاتورة = 140
    assert.strictEqual(bd.total, 140000, 'الإجمالي بعد الربط الجزئي');

    // 9. ربط مسودة عبر PUT ثم حذفها ← يُفك الربط تلقائياً
    r = await api('POST', `/api/project-hub/${projectId}/labor`, {
      worker_name_or_team: 'طاقم المسودة', total_amount: 20000,
      payment_status: 'غير مدفوع', date: today
    });
    const labor2Id = r.data.data.id;

    r = await api('POST', '/api/expenses', {
      expense_type: 'أجور عمالة', project_id: projectId, amount: 20000,
      payment_method: 'نقدي', date: today, status: 'draft'
    });
    const draftId = r.data.id;

    r = await api('PUT', `/api/expenses/${draftId}`, { link_labor_id: labor2Id });
    assert.strictEqual(r.status, 200, 'ربط المسودة: ' + JSON.stringify(r.data));
    let link = await db.get('SELECT linked_expense_id FROM project_labor_expenses WHERE id = ?', [labor2Id]);
    assert.strictEqual(Number(link.linked_expense_id), Number(draftId), 'الربط محفوظ');

    r = await api('DELETE', `/api/expenses/${draftId}`);
    assert.strictEqual(r.status, 200, 'حذف المسودة');
    link = await db.get('SELECT linked_expense_id FROM project_labor_expenses WHERE id = ?', [labor2Id]);
    assert.strictEqual(link.linked_expense_id, null, 'حذف المسودة يفك الربط');

    // 10. تحذيرات الاشتباه: مصروف مباشر ثم بند بنفس المبلغ
    r = await api('POST', '/api/expenses', {
      expense_type: 'نقل ومواصلات', project_id: projectId, amount: 25000,
      payment_method: 'نقدي', date: today
    });
    assert.strictEqual(r.status, 200);

    r = await api('POST', `/api/project-hub/${projectId}/labor`, {
      worker_name_or_team: 'طاقم مشتبه', total_amount: 25000,
      payment_status: 'غير مدفوع', date: today
    });
    assert.strictEqual(r.status, 200, 'البند المشتبه يُحفظ (التحذير غير حاجب)');
    assert.ok(Array.isArray(r.data.warnings), 'الاستجابة تتضمن warnings');
    assert.ok(r.data.warnings.length > 0, 'يجب وجود تحذير اشتباه');
    assert.ok(r.data.warnings.some(w => w.kind === 'expense'), 'التحذير يشير للمصروف المشابه');

    console.log('✅ منع الازدواج: جميع الفحوصات (10) ناجحة');
  } finally {
    await cleanup();
  }
});
