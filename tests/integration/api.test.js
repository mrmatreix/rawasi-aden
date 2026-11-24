const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const app = require('../../server/server');

test('API Integration - Health, Version & Docs Endpoints', async (t) => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(() => {
    if (server.closeAllConnections) server.closeAllConnections();
    server.close();
  });

  // 1. فحص /api/health
  const resHealth = await fetch(`${baseUrl}/api/health`);
  assert.strictEqual(resHealth.status, 200, 'Health check should return 200');
  const dataHealth = await resHealth.json();
  assert.strictEqual(dataHealth.status, 'online');
  // the probe is minimal on purpose (no system details for unauthenticated callers)
  assert.strictEqual(dataHealth.ready, true);
  assert.equal(dataHealth.system, undefined);

  // 2. فحص /api/version
  const resVersion = await fetch(`${baseUrl}/api/version`);
  assert.strictEqual(resVersion.status, 200, 'Version endpoint should return 200');
  const dataVersion = await resVersion.json();
  assert.strictEqual(dataVersion.success, true);
  assert.ok(dataVersion.version, 'Version string must be present');

  // 3. مواصفة OpenAPI محمية: لا تُكشف لغير المسجّلين (تفاصيلها تُختبر من الملف نفسه)
  const resDocs = await fetch(`${baseUrl}/api/docs/spec`);
  assert.strictEqual(resDocs.status, 401, 'Docs spec requires authentication');
  const dataDocs = require('../../server/docs/openapi.json');
  assert.strictEqual(dataDocs.openapi, '3.0.3');
  assert.ok(dataDocs.paths['/api/accounting/journal-entries'], 'Journal entries path must be documented');

  // 4. فحص حماية مسار التحقق من الفترات (طلب تسجيل الدخول 401)
  const resPeriod = await fetch(`${baseUrl}/api/accounting/check-period?date=2026-09-22`);
  assert.strictEqual(resPeriod.status, 401, 'Unauthenticated accounting route must return 401');
  const dataPeriod = await resPeriod.json();
  assert.strictEqual(dataPeriod.authenticated, false);
});
