/**
 * =========================================================================
 * tests/unit/date_validation_and_api_errors.test.js
 * اختبارات التحقق من التواريخ وسلامة استجابات أخطاء API (HTTP 400/500)
 * =========================================================================
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const reportsRouter = require('../../server/routes/reports');

// إعداد تطبيق Express تجريبي لاختبار مسارات التقارير
const app = express();
app.use(express.json());
// محاكاة مستخدم لديه كافة الصلاحيات
app.use((req, res, next) => {
  req.user = { id: 1, username: 'admin', role: 'admin' };
  next();
});
app.use('/api/reports', reportsRouter);

// مساعد لإجراء طلب داخلي عبر Express
function makeRequest(path) {
  return new Promise((resolve) => {
    const req = {
      method: 'GET',
      url: path,
      headers: {},
      query: {}
    };

    // تحليل مسار الاستعلام
    const [pathname, queryString] = path.split('?');
    if (queryString) {
      const params = new URLSearchParams(queryString);
      for (const [key, val] of params.entries()) {
        req.query[key] = val;
      }
    }

    const res = {
      statusCode: 200,
      headers: {},
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.body = data;
        resolve({ statusCode: this.statusCode, body: data });
      },
      setHeader(k, v) {
        this.headers[k] = v;
      }
    };

    app.handle(req, res);
  });
}

test('1. تاريخ صحيح YYYY-MM-DD: يعود بحالة نجاح HTTP 200', async () => {
  const res = await makeRequest('/api/reports/trial-balance?from_date=2026-01-01&to_date=2026-01-31');
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.success, true);
});

test('2. تاريخ مستحيل تقويمياً 2026-99-99: يرفض برمز HTTP 400 وكود خطأ واضح', async () => {
  const res = await makeRequest('/api/reports/trial-balance?from_date=2026-99-99&to_date=2026-12-31');
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.success, false);
  assert.strictEqual(res.body.code, 'INVALID_INPUT');
  assert.match(res.body.message, /الشهر/);
});

test('3. يوم غير موجود في الشهر (مثلاً 2026-02-31): يرفض برمز HTTP 400', async () => {
  const res = await makeRequest('/api/reports/income-statement?from_date=2026-02-01&to_date=2026-02-31');
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.success, false);
  assert.strictEqual(res.body.code, 'INVALID_INPUT');
  assert.match(res.body.message, /اليوم/);
});

test('4. نطاق زمني معكوس (تاريخ البداية > تاريخ النهاية): يرفض برمز HTTP 400', async () => {
  const res = await makeRequest('/api/reports/profit-loss?from_date=2026-12-31&to_date=2026-01-01');
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.success, false);
  assert.strictEqual(res.body.code, 'INVALID_INPUT');
  assert.match(res.body.message, /تاريخ البداية يجب ألا يتجاوز تاريخ النهاية/);
});

test('5. تاريخ بداية ونهاية متساويان: يقبل ويعامل كيوم محدد بنجاح HTTP 200', async () => {
  const res = await makeRequest('/api/reports/income-statement?from_date=2026-05-15&to_date=2026-05-15');
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.data.period.from_date, '2026-05-15');
  assert.strictEqual(res.body.data.period.to_date, '2026-05-15');
});

test('6. تقرير حتى تاريخ محدد (Balance Sheet as_of_date): يقبل بنجاح ويرفض التواريخ المستحيلة', async () => {
  const validRes = await makeRequest('/api/reports/balance-sheet?as_of_date=2026-12-31');
  assert.strictEqual(validRes.statusCode, 200);
  assert.strictEqual(validRes.body.success, true);

  const invalidRes = await makeRequest('/api/reports/balance-sheet?as_of_date=2026-13-45');
  assert.strictEqual(invalidRes.statusCode, 400);
  assert.strictEqual(invalidRes.body.success, false);
});

test('7. تقرير خلال شهر أو سنة مالية كاملة: يعمل بدقة', async () => {
  const monthRes = await makeRequest('/api/reports/cash-flow?from_date=2026-03-01&to_date=2026-03-31');
  assert.strictEqual(monthRes.statusCode, 200);
  assert.strictEqual(monthRes.body.success, true);

  const yearRes = await makeRequest('/api/reports/cash-flow?from_date=2026-01-01&to_date=2026-12-31');
  assert.strictEqual(yearRes.statusCode, 200);
  assert.strictEqual(yearRes.body.success, true);
});

test('8. معرف عميل أو مورد غير صالح: يرفض برمز HTTP 400', async () => {
  const clientRes = await makeRequest('/api/reports/client-statement/abc');
  assert.strictEqual(clientRes.statusCode, 400);
  assert.strictEqual(clientRes.body.success, false);

  const supplierRes = await makeRequest('/api/reports/supplier-statement/0');
  assert.strictEqual(supplierRes.statusCode, 400);
  assert.strictEqual(supplierRes.body.success, false);
});
