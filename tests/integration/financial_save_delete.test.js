const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('financial saves resist concurrent/retried requests; only drafts can be deleted', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rawasi-save-delete-'));
  Object.assign(process.env, { NODE_ENV: 'development', DB_ENGINE: 'sqlite', RAWASI_DB_PATH: path.join(temp, 'test.db'),
    RAWASI_UPLOAD_DIR: path.join(temp, 'uploads'), RAWASI_PROJECTS_DIR: path.join(temp, 'projects'),
    RAWASI_BACKUP_DIR: path.join(temp, 'backups'), RAWASI_SCRATCH_DIR: path.join(temp, 'scratch'), ENABLE_SCHEDULERS: 'false' });
  const fixture = spawnSync(process.execPath, ['tests/create_fixture.js'], { env: process.env, encoding: 'utf8', windowsHide: true });
  assert.equal(fixture.status, 0, fixture.stderr);
  const db = require('../../server/database/db');
  let server;
  try {
    await db.ready;
    const app = require('../../server/server');
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const user = await db.get("SELECT id FROM users WHERE username = 'admin'");
    const token = require('jsonwebtoken').sign({ id: user.id, username: 'admin', role: 'admin' }, require('../../server/middleware/security').JWT_SECRET, { expiresIn: '5m' });
    const request = async (route, body, method = 'POST', key) => {
      const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
      if (key) headers['Idempotency-Key'] = key;
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/${route}`, { method, headers, body: JSON.stringify(body) });
      return { status: res.status, replayed: res.headers.get('Idempotency-Replayed'), body: await res.json() };
    };
    const account = async code => (await db.get('SELECT id FROM accounts WHERE code = ?', [code])).id;
    const cash = await account('11101001');
    const expense = await account('31101001');
    const revenue = await account('41101001');
    const client = await db.get('SELECT id FROM clients LIMIT 1');
    const center = await db.get('SELECT id FROM cost_centers LIMIT 1');
    const supporting_documents = [{ name: 'test.pdf', content_base64: Buffer.from('%PDF-1.7\nfixture\n%%EOF').toString('base64') }];
    const common = { date: '2099-01-15', amount: 100, currency: 'ر.ي', payment_method: 'نقدي', settlement_account_id: cash, cost_center_id: center.id, status: 'draft', supporting_documents };
    const cases = [
      { route: 'expenses', table: 'expenses', kind: 'expense', payload: { ...common, expense_type: 'مصروف عام', account_id: expense } },
      { route: 'payments', table: 'payments', kind: 'payment', payload: { ...common, type: 'قبض', client_id: client.id, account_id: revenue } },
      { route: 'accounting/journal-entries', table: 'journal_entries', kind: 'journal', payload: { date: common.date, description: 'اختبار منع التكرار', status: 'draft', supporting_documents, lines: [{ account_id: cash, debit: 100, credit: 0 }, { account_id: expense, debit: 0, credit: 100, cost_center_id: center.id }] } }
    ];
    for (const item of cases) {
      const key = 'test-' + item.table;
      const before = (await db.get(`SELECT COUNT(*) AS n FROM ${item.table}`)).n;
      const started = performance.now();
      const responses = await Promise.all(Array.from({ length: 6 }, () => request(item.route, item.payload, 'POST', key)));
      const success = responses.find(response => response.body.success);
      assert.ok(success, JSON.stringify(responses));
      assert(responses.every(response => response.body.success || (response.status === 409 && response.body.pending)), JSON.stringify(responses));
      const replay = await request(item.route, item.payload, 'POST', key);
      assert.equal(replay.body.id, success.body.id);
      assert.equal(replay.replayed, 'true');
      assert.equal((await db.get(`SELECT COUNT(*) AS n FROM ${item.table}`)).n, before + 1);
      assert.equal((await db.get('SELECT COUNT(*) AS n FROM supporting_documents WHERE entity_type = ? AND entity_id = ?', [item.kind, success.body.id])).n, 1);
      const conflict = await request(item.route, { ...item.payload, notes: 'changed' }, 'POST', key);
      assert.equal(conflict.status, 409);
      // Persisted replay also survives a newly constructed middleware instance.
      delete require.cache[require.resolve('../../server/middleware/financialSave')];
      const { financialSave } = require('../../server/middleware/financialSave');
      let replayed;
      await financialSave({ get: name => name === 'Idempotency-Key' ? key : null, body: item.payload, user, method: 'POST', baseUrl: '/api/' + item.route.split('/')[0], path: item.route.includes('/') ? '/journal-entries' : '/' },
        { set() {}, status(code) { this.code = code; return this; }, json(body) { replayed = body; } }, () => assert.fail('must replay persisted result'));
      assert.equal(replayed.id, success.body.id);
      console.log(`${item.table}: 6 concurrent requests produced 1 record; round trip ${Math.round(performance.now()-started)}ms`);
      const deleted = await request(item.route + '/' + success.body.id, {}, 'DELETE');
      assert.equal(deleted.status, 200, JSON.stringify(deleted));
      assert.equal(await db.get(`SELECT id FROM ${item.table} WHERE id = ?`, [success.body.id]), null);
      assert.equal((await db.get('SELECT COUNT(*) AS n FROM supporting_documents WHERE entity_type = ? AND entity_id = ?', [item.kind, success.body.id])).n, 0);
      if (item.kind === 'journal') assert.equal((await db.get('SELECT COUNT(*) AS n FROM journal_entry_lines WHERE entry_id = ?', [success.body.id])).n, 0);
      const posted = await request(item.route, item.payload, 'POST', key + '-posted');
      assert.equal(posted.status, 200, JSON.stringify(posted));
      const post = await request(item.route + '/' + posted.body.id + '/post', {});
      assert.equal(post.status, 200, JSON.stringify(post));
      const denied = await request(item.route + '/' + posted.body.id, {}, 'DELETE');
      assert.equal(denied.status, 400, JSON.stringify(denied));
      assert.equal((await db.get(`SELECT status FROM ${item.table} WHERE id = ?`, [posted.body.id])).status, 'posted');
    }
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await db.closeDatabase();
    assert.equal(path.dirname(temp), os.tmpdir());
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
