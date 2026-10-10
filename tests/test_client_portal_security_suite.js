/**
 * حزمة اختبارات الأمان والتدقيق الشاملة لبوابة وتطبيق العملاء (Security & Integration Test Suite)
 * لمشروع شركة رواسي عدن للهندسة والمقاولات
 */

const assert = require('assert');
const http = require('http');
const jwt = require('jsonwebtoken');
const db = require('../server/database/db');
const { CLIENT_JWT_SECRET } = require('../server/middleware/client_auth');

function apiRequest(options, bodyData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(body); } catch { parsed = body; }
        resolve({ statusCode: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    if (bodyData) {
      req.write(typeof bodyData === 'string' ? bodyData : JSON.stringify(bodyData));
    }
    req.end();
  });
}

async function runSecurityTestSuite() {
  console.log('===========================================================');
  console.log('🧪 بدء تشغيل حزمة اختبارات الأمان والتكامل لبوابة العملاء');
  console.log('===========================================================');

  let passedCount = 0;
  let failedCount = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`✅ [نجاح]: ${name}`);
      passedCount++;
    } catch (err) {
      console.error(`❌ [فشل]: ${name}`);
      console.error('   السبب:', err.message);
      failedCount++;
    }
  }

  // تهيئة مستخدمين وقواعد اختبارية
  const client1Id = 1;
  const client2Id = 2;

  // 1. اختبار: المستخدم غير المسجل لا يستطيع الوصول إلى الصفحات المحمية
  await test('1. إعاقة المستخدم غير المسجل عند الوصول لمسار محمي بدون Authorization header (401)', async () => {
    const res = await apiRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/api/client-portal/dashboard',
      method: 'GET'
    });
    assert.strictEqual(res.statusCode, 401, 'يجب إرجاع كود 401 عند غياب التوكن');
    assert.strictEqual(res.body.success, false, 'يجب أن تكون نتيجة الطلب غير ناجحة');
  });

  // 2. اختبار: العميل الأول لا يستطيع الوصول إلى بيانات مشاريع العميل الثاني
  await test('2. منع العميل الأول من الاطلاع على مشاريع العميل الثاني (Horizontal Access Isolation)', async () => {
    // إنشاء توكن خاص بالعميل 1
    const tokenClient1 = jwt.sign(
      { id: 9991, client_id: client1Id, type: 'client', role: 'viewer', email: 'client1_test@test.com' },
      CLIENT_JWT_SECRET,
      { expiresIn: '1h' }
    );

    // إضافة مستخدم اختبار مؤقت في قاعدة البيانات
    await db.run(`
      INSERT OR REPLACE INTO client_users (id, client_id, email, password_hash, full_name, role, status)
      VALUES (9991, ?, 'client1_test@test.com', 'hash', 'عميل اختبار 1', 'viewer', 'active')
    `, [client1Id]);

    const res = await apiRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/api/client-portal/projects',
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenClient1}` }
    });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    // التأكد من أن جميع المشاريع المرجعة تتبع للعميل 1 فقط
    if (res.body.projects && res.body.projects.length > 0) {
      const otherClientProjs = res.body.projects.filter(p => p.client_id && p.client_id !== client1Id);
      assert.strictEqual(otherClientProjs.length, 0, 'يجب عدم تسريب أي مشروع لعميل آخر');
    }
  });

  // 3. اختبار: تغيير معرف المشروع بالطلب لا يتجاوز الصلاحيات (IDOR Protection)
  await test('3. منع حيلة التلاعب بمعرف المشروع بالطلب (Broken Object Level Authorization / IDOR)', async () => {
    const tokenClient1 = jwt.sign(
      { id: 9991, client_id: client1Id, type: 'client', role: 'viewer', email: 'client1_test@test.com' },
      CLIENT_JWT_SECRET,
      { expiresIn: '1h' }
    );

    // محاولة طلب مشروع يتبع للعميل 2 أو غير مسموح (مثلاً ID 999999)
    const res = await apiRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/api/client-portal/projects/999999',
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenClient1}` }
    });

    assert.ok([403, 404].includes(res.statusCode), 'يجب رفض الطلب إما بـ 403 أو 404 عند طلب مشروع غير مملوك للعميل');
    assert.strictEqual(res.body.success, false);
  });

  // 4. اختبار: مستخدم العرض فقط (Viewer) لا يستطيع اعتماد المستخلصات
  await test('4. حظر مستخدم العرض فقط (Viewer) من القيام بعملية الاعتماد المالي', async () => {
    // إنشاء مستخدم اختبار بدون صلاحية اعتماد
    await db.run(`
      INSERT OR REPLACE INTO client_users (id, client_id, email, password_hash, full_name, role, status)
      VALUES (9992, ?, 'viewer_test@test.com', 'hash', 'مستعرض فقط', 'viewer', 'active')
    `, [client1Id]);

    const tokenViewer = jwt.sign(
      { id: 9992, client_id: client1Id, type: 'client', role: 'viewer', email: 'viewer_test@test.com' },
      CLIENT_JWT_SECRET,
      { expiresIn: '1h' }
    );

    const res = await apiRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/api/client-portal/invoices/1/approve',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenViewer}`
      }
    }, { decision: 'approved', notes: 'محاولة اعتماد غير مصرح بها' });

    assert.ok([403, 404].includes(res.statusCode), 'يجب حظر عملية الاعتماد لعدم وجود صلاحية');
    assert.strictEqual(res.body.success, false);
  });

  // 5. اختبار: الحساب المعطل (Suspended) لا يستطيع تنفيذ أي طلب محمي
  await test('5. رفض الطلبات فوراً إذا كانت حالة الحساب معطلة أو موقوفة (Suspended Account Block)', async () => {
    await db.run(`
      INSERT OR REPLACE INTO client_users (id, client_id, email, password_hash, full_name, role, status)
      VALUES (9993, ?, 'suspended_test@test.com', 'hash', 'حساب موقوف', 'owner', 'suspended')
    `, [client1Id]);

    const tokenSuspended = jwt.sign(
      { id: 9993, client_id: client1Id, type: 'client', role: 'owner', email: 'suspended_test@test.com' },
      CLIENT_JWT_SECRET,
      { expiresIn: '1h' }
    );

    const res = await apiRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/api/client-portal/dashboard',
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenSuspended}` }
    });

    assert.strictEqual(res.statusCode, 403, 'يجب إرجاع 403 للمستخدم الموقوف');
    assert.strictEqual(res.body.suspended, true, 'يجب الإشارة إلى حالة التجميد');
  });

  // 6. اختبار: التوكن التابع للنظام الداخلي لا يعمل على بوابة العملاء (Cross-Context Token Block)
  await test('6. منع استخدام توكنات الموظفين الداخليين للوصول إلى بوابة العملاء (Token Type Isolation)', async () => {
    const internalAdminToken = jwt.sign(
      { id: 1, username: 'admin', role: 'admin' }, // غياب type: 'client'
      'different_internal_secret',
      { expiresIn: '1h' }
    );

    const res = await apiRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/api/client-portal/dashboard',
      method: 'GET',
      headers: { Authorization: `Bearer ${internalAdminToken}` }
    });

    assert.strictEqual(res.statusCode, 401, 'يجب تفتيش وعزل التوكن غير المخصص لبوابة العملاء');
  });

  // 7. اختبار: كشف حساب العميل التحليلي يعمل بدقة ويسجل الفواتير والدفعات
  await test('7. استخراج كشف حساب العميل الربط المحاسبي المباشر (/statement)', async () => {
    const tokenOwner = jwt.sign(
      { id: 9991, client_id: client1Id, type: 'client', role: 'owner', email: 'client1_test@test.com' },
      CLIENT_JWT_SECRET,
      { expiresIn: '1h' }
    );

    const res = await apiRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/api/client-portal/statement',
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenOwner}` }
    });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.summary, 'يجب إرجاع ملخص الكشف المحاسبي');
    assert.ok(Array.isArray(res.body.statement), 'يجب أن يكون كشف الحساب عبارة عن مصفوفة قيود');
  });

  // 8. تنظيف مستخدمي الاختبار من قاعدة البيانات
  await db.run(`DELETE FROM client_users WHERE id IN (9991, 9992, 9993)`);

  console.log('===========================================================');
  console.log(`📊 نتيجة الحزمة: [نجاح: ${passedCount}] | [فشل: ${failedCount}] | [الإجمالي: ${passedCount + failedCount}]`);
  console.log('===========================================================');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runSecurityTestSuite().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
