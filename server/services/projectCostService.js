/**
 * خدمة توحيد التكلفة الفعلية للمشاريع (Unified Project Cost Service)
 * ============================================================================
 * مصدر الحقيقة الوحيد (Single Source of Truth) للتكلفة الفعلية actual_cost.
 *
 * المعادلة الموحدة (تُحتسب من السجلات دائماً — لا تراكم يدوي):
 *
 *   التكلفة الفعلية = مصروفات مرحلة/معتمدة (مباشرة فقط، بلا مرايا)
 *                   + صافي الصرف المخزني (صرف − مرتجع موقع)
 *                   + أجور العمالة الميدانية
 *                   + مشتريات المشروع الفرعية
 *
 * ملاحظات تصميمية:
 * 1. المصروفات «المرآة» (التي تُنشأ آلياً من شاشتي الأجور والمشتريات الفرعية)
 *    تُستبعد من بند المصروفات لأن الحدث الاقتصادي نفسه يُحتسب مرة واحدة
 *    عبر جدول الأجور/المشتريات الفرعي — وذلك عبر عمودي source_table/source_id.
 * 2. تُستدعى recalculateProjectCost بعد كل عملية تغيّر التكلفة (بدل التحديث
 *    التراكمي actual_cost ± X الذي كان سبب الانحراف)، وهي idempotent وآمنة
 *    للتكرار — أي انحراف قديم يُصحح تلقائياً عند أول حركة جديدة.
 * 3. تعمل داخل المعاملات الذرية (tx) أو خارجها.
 */

const db = require('../database/db');

const { query, get, run, transaction, getActiveEngine } = db;

// الحالات التي تُحتسب ضمن التكلفة (المرحلة + المعتمدة الملتزم بها)
const COUNTED_EXPENSE_STATUSES = ['posted', 'approved'];

// حماية من تكرار فحص المخطط (تُضبط فقط عند النجاح ليُعاد الفحص عند الفشل)
let schemaEnsured = false;

/**
 * التأكد من وجود عمودي الربط بالمصدر على جدول المصروفات (idempotent).
 * يُستدعى خارج المعاملات (قبل بدء tx) لتجنب مشاكل DDL داخل المعاملة.
 */
async function ensureSchema() {
  if (schemaEnsured) return true;
  const engine = typeof getActiveEngine === 'function' ? getActiveEngine() : 'sqlite';

  try {
    if (engine === 'mysql') {
      const cols = await query('SHOW COLUMNS FROM expenses');
      const names = (cols || []).map(c => c.Field || c.field || c.COLUMN_NAME);
      if (!names.includes('source_table')) {
        await run("ALTER TABLE expenses ADD COLUMN source_table VARCHAR(60) NULL COMMENT 'جدول المصدر للمصروفات المرآة'");
      }
      if (!names.includes('source_id')) {
        await run('ALTER TABLE expenses ADD COLUMN source_id INT NULL');
      }
    } else {
      const cols = await query('PRAGMA table_info(expenses)');
      const names = (cols || []).map(c => c.name);
      if (!names.includes('source_table')) {
        await run('ALTER TABLE expenses ADD COLUMN source_table TEXT');
      }
      if (!names.includes('source_id')) {
        await run('ALTER TABLE expenses ADD COLUMN source_id INTEGER');
      }
    }
    schemaEnsured = true;
    return true;
  } catch (err) {
    // لا نخفي الخطأ — لكن نسمح بإعادة المحاولة لاحقاً
    console.warn('⚠️ [ProjectCost] تعذر التأكد من مخطط الربط:', err.message);
    throw err;
  }
}

/** تنفيذ قراءة عبر tx أو الاتصال العام */
function pickReader(tx) {
  return tx || { query, get };
}

/**
 * تفصيل التكلفة الفعلية لمشروع من مصادرها الأربعة.
 * @returns { expenses, inventory_out, inventory_returns, inventory_net, labor, purchases, total }
 */
async function getCostBreakdown(projectId, tx = null) {
  const pId = Number(projectId);
  if (!pId) throw new Error('معرف المشروع مطلوب لاحتساب التكلفة');
  if (!tx) await ensureSchema();
  const reader = pickReader(tx);

  const statusPlaceholders = COUNTED_EXPENSE_STATUSES.map(() => '?').join(',');

  const expRow = await reader.get(
    `SELECT COALESCE(SUM(amount), 0) as total FROM expenses
     WHERE project_id = ? AND status IN (${statusPlaceholders}) AND source_table IS NULL`,
    [pId, ...COUNTED_EXPENSE_STATUSES]
  );

  const outRow = await reader.get(
    `SELECT COALESCE(SUM(total_amount), 0) as total FROM inventory_transactions
     WHERE project_id = ? AND type = 'out'`,
    [pId]
  );

  const retRow = await reader.get(
    `SELECT COALESCE(SUM(total_amount), 0) as total FROM inventory_returns
     WHERE project_id = ? AND return_type = 'project_return'
       AND (status IS NULL OR status NOT IN ('reversed', 'cancelled'))`,
    [pId]
  );

  const laborRow = await reader.get(
    'SELECT COALESCE(SUM(total_amount), 0) as total FROM project_labor_expenses WHERE project_id = ?',
    [pId]
  );

  const purchRow = await reader.get(
    'SELECT COALESCE(SUM(total_amount), 0) as total FROM project_purchases WHERE project_id = ?',
    [pId]
  );

  const expenses = Number(expRow?.total) || 0;
  const inventoryOut = Number(outRow?.total) || 0;
  const inventoryReturns = Number(retRow?.total) || 0;
  const inventoryNet = inventoryOut - inventoryReturns;
  const labor = Number(laborRow?.total) || 0;
  const purchases = Number(purchRow?.total) || 0;

  const total = Math.max(0, expenses + inventoryNet + labor + purchases);

  return {
    project_id: pId,
    expenses: Math.round(expenses * 100) / 100,
    inventory_out: Math.round(inventoryOut * 100) / 100,
    inventory_returns: Math.round(inventoryReturns * 100) / 100,
    inventory_net: Math.round(inventoryNet * 100) / 100,
    labor: Math.round(labor * 100) / 100,
    purchases: Math.round(purchases * 100) / 100,
    total: Math.round(total * 100) / 100,
    formula: 'مصروفات مباشرة (مرحلة/معتمدة) + صافي الصرف المخزني + أجور ميدانية + مشتريات فرعية'
  };
}

/**
 * إعادة احتساب التكلفة الفعلية لمشروع وحفظها في حقل projects.actual_cost.
 * تُستدعى بعد كل عملية مؤثرة (داخل tx أو خارجها).
 * @returns تفصيل التكلفة المحتسب
 */
async function recalculateProjectCost(projectId, tx = null) {
  const pId = Number(projectId);
  if (!pId) return null;
  const breakdown = await getCostBreakdown(pId, tx);
  const writer = tx || { run };
  await writer.run('UPDATE projects SET actual_cost = ? WHERE id = ?', [breakdown.total, pId]);
  return breakdown;
}

/**
 * إعادة احتساب التكلفة لكل المشاريع (للترحيل والمعالجة الجماعية).
 * @returns تقرير { projects_count, details[] }
 */
async function recalculateAllProjects() {
  await ensureSchema();
  const projects = await query('SELECT id, code, name, actual_cost FROM projects ORDER BY id ASC');
  const details = [];
  for (const p of projects) {
    const before = Number(p.actual_cost) || 0;
    const breakdown = await recalculateProjectCost(p.id);
    details.push({
      id: p.id,
      code: p.code,
      name: p.name,
      before,
      after: breakdown.total,
      drift: Math.round((breakdown.total - before) * 100) / 100,
      breakdown
    });
  }
  return { projects_count: details.length, details };
}

/**
 * ربط المصروفات المرآة القديمة بمصادرها (لمرة واحدة بعد الترقية).
 * - EXP-LAB-<id> ← project_labor_expenses
 * - EXP-PUR-<id> ← project_purchases
 * - ملاحظة 'فاتورة مشتريات:%' مع إيصال مخصص ← project_purchases (بدون id)
 * @returns عدد الصفوف المربوطة
 */
async function backfillMirrorLinks() {
  await ensureSchema();
  let linked = 0;

  // 1. مرايا الأجور (رقم الإيصال يحمل id السجل دائماً)
  const labMirrors = await query(
    "SELECT id, receipt_no FROM expenses WHERE source_table IS NULL AND receipt_no LIKE 'EXP-LAB-%'"
  );
  for (const m of labMirrors) {
    const srcId = Number(String(m.receipt_no).replace('EXP-LAB-', '')) || null;
    await run('UPDATE expenses SET source_table = ?, source_id = ? WHERE id = ?', [
      'project_labor_expenses', srcId, m.id
    ]);
    linked++;
  }

  // 2. مرايا المشتريات بالنمط القياسي
  const purMirrors = await query(
    "SELECT id, receipt_no FROM expenses WHERE source_table IS NULL AND receipt_no LIKE 'EXP-PUR-%'"
  );
  for (const m of purMirrors) {
    const srcId = Number(String(m.receipt_no).replace('EXP-PUR-', '')) || null;
    await run('UPDATE expenses SET source_table = ?, source_id = ? WHERE id = ?', [
      'project_purchases', srcId, m.id
    ]);
    linked++;
  }

  // 3. مرايا المشتريات ذات الإيصال المخصص (تُعرف من نص الملاحظة الثابت)
  const customPur = await run(
    `UPDATE expenses SET source_table = 'project_purchases'
     WHERE source_table IS NULL AND notes LIKE 'فاتورة مشتريات:%'`
  );
  linked += Number(customPur?.changes ?? customPur?.affectedRows ?? 0);

  return linked;
}

/**
 * حذف المصروفات المرآة المرتبطة بسجل فرعي (عند حذف الأصل).
 * لا يحذف أي مصروف له قيد يومي مرتبط (حماية).
 * @returns عدد المحذوفات
 */
async function deleteLinkedMirrors(sourceTable, sourceId, tx = null) {
  if (!sourceTable || !sourceId) return 0;
  if (!tx) await ensureSchema();
  const conn = tx || { query, get, run };
  const mirrors = await conn.query(
    'SELECT id FROM expenses WHERE source_table = ? AND source_id = ?',
    [sourceTable, Number(sourceId)]
  );
  let deleted = 0;
  for (const m of mirrors) {
    const je = await conn.get(
      'SELECT id FROM journal_entries WHERE reference_id = ? LIMIT 1',
      [m.id]
    );
    if (je) continue; // له قيد — لا نحذفه (يُستبعد من التكلفة فقط)
    await conn.run('DELETE FROM expenses WHERE id = ?', [m.id]);
    deleted++;
  }
  return deleted;
}

module.exports = {
  COUNTED_EXPENSE_STATUSES,
  ensureSchema,
  getCostBreakdown,
  recalculateProjectCost,
  recalculateAllProjects,
  backfillMirrorLinks,
  deleteLinkedMirrors
};
