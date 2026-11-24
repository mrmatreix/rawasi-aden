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
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/${route}`, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body) });
      return { status: res.status, replayed: res.headers.get('Idempotency-Replayed'), body: await res.json() };
    };
    const account = async code => (await db.get('SELECT id FROM accounts WHERE code = ?', [code])).id;
    const cash = await account('11101001');
    const expense = await account('31101001');
    const revenue = await account('41101001');
    const client = await db.get('SELECT id FROM clients LIMIT 1');
    const center = await db.get('SELECT id FROM cost_centers LIMIT 1');
    const otherCenter = await db.run("INSERT INTO cost_centers(code, name, type, status) VALUES ('CC-OVERRIDE', 'مركز بديل', 'مركز ربح', 'active')");
    const otherCenterId = Number(otherCenter.lastInsertRowid || otherCenter.insertId);
    const supporting_documents = [{ name: 'test.pdf', content_base64: Buffer.from('%PDF-1.7\nfixture\n%%EOF').toString('base64') }];
    const common = { date: '2099-01-15', amount: 100, currency: 'ر.ي', payment_method: 'نقدي', settlement_account_id: cash, cost_center_id: center.id, status: 'draft', supporting_documents };
    // Account setup accepts a usage policy rather than a chosen default center,
    // and infers the hidden parent from the sequential account code.
    assert.equal((await request('accounting/accounts', { code: '31101002', name: 'إعداد إلزامي', type: 'asset', cost_center_required: 1 })).status, 400);
    const setup = await request('accounting/accounts', { code: '31101002', name: 'إعداد إلزامي', type: 'asset', cost_center_required: 1, default_cost_center_id: center.id });
    assert.equal(setup.status, 200, JSON.stringify(setup));
    const configured = await db.get('SELECT * FROM accounts WHERE id = ?', [setup.body.id]);
    assert.equal(configured.cost_center_required, 1);
    assert.equal(configured.default_cost_center_id, center.id);
    assert.equal(configured.parent_id, (await db.get("SELECT id FROM accounts WHERE code = '31101'")).id);
    const editedSetup = await request('accounting/accounts/' + configured.id, { code: configured.code, name: configured.name, type: configured.type, cost_center_required: 0 }, 'PUT');
    assert.equal(editedSetup.status, 200, JSON.stringify(editedSetup));
    assert.equal((await db.get('SELECT cost_center_required FROM accounts WHERE id = ?', [configured.id])).cost_center_required, 0);
    const cases = [
      { route: 'expenses', table: 'expenses', kind: 'expense', payload: { ...common, expense_type: 'مصروف عام', account_id: expense } },
      { route: 'payments', table: 'payments', kind: 'payment', payload: { ...common, type: 'قبض', client_id: client.id, account_id: revenue } },
      { route: 'accounting/journal-entries', table: 'journal_entries', kind: 'journal', payload: { date: common.date, description: 'اختبار منع التكرار', status: 'draft', supporting_documents, lines: [{ account_id: cash, debit: 100, credit: 0 }, { account_id: expense, debit: 0, credit: 100, cost_center_id: center.id }] } }
    ];
    for (const item of cases) {
      const policyAccount = item.kind === 'payment' ? revenue : expense;
      await db.run('UPDATE accounts SET cost_center_required = 1 WHERE id = ?', [policyAccount]);
      const noCenter = structuredClone(item.payload);
      delete noCenter.cost_center_id;
      if (noCenter.lines) for (const line of noCenter.lines) delete line.cost_center_id;
      const required = await request(item.route, noCenter);
      assert.equal(required.status, 400, JSON.stringify(required));
      assert.match(required.body.message, /مركز التكلفة إلزامي/);
      await db.run('UPDATE accounts SET default_cost_center_id = ? WHERE id = ?', [center.id, policyAccount]);
      const fallback = await request(item.route, noCenter);
      assert.equal(fallback.status, 200, JSON.stringify(fallback));
      const fallbackCenter = item.kind === 'journal'
        ? await db.get('SELECT cost_center_id FROM journal_entry_lines WHERE entry_id = ? AND account_id = ?', [fallback.body.id, policyAccount])
        : await db.get(`SELECT cost_center_id FROM ${item.table} WHERE id = ?`, [fallback.body.id]);
      assert.equal(fallbackCenter.cost_center_id, center.id);
      assert.equal((await request(item.route + '/' + fallback.body.id, {}, 'DELETE')).status, 200);
      const overridePayload = structuredClone(noCenter);
      if (overridePayload.lines) for (const line of overridePayload.lines) { if (line.account_id === policyAccount) line.cost_center_id = otherCenterId; }
      else overridePayload.cost_center_id = otherCenterId;
      const overridden = await request(item.route, overridePayload);
      assert.equal(overridden.status, 200, JSON.stringify(overridden));
      const storedOverride = item.kind === 'journal'
        ? await db.get('SELECT cost_center_id FROM journal_entry_lines WHERE entry_id = ? AND account_id = ?', [overridden.body.id, policyAccount])
        : await db.get(`SELECT cost_center_id FROM ${item.table} WHERE id = ?`, [overridden.body.id]);
      assert.equal(storedOverride.cost_center_id, otherCenterId);
      assert.equal((await request(item.route + '/' + overridden.body.id, {}, 'DELETE')).status, 200);
      await db.run('UPDATE accounts SET default_cost_center_id = NULL WHERE id = ?', [policyAccount]);
      await db.run('UPDATE accounts SET cost_center_required = 0 WHERE id = ?', [policyAccount]);
      const optional = await request(item.route, noCenter);
      assert.equal(optional.status, 200, JSON.stringify(optional));
      assert.equal((await request(item.route + '/' + optional.body.id, {}, 'DELETE')).status, 200);
      await db.run('UPDATE accounts SET cost_center_required = 1 WHERE id = ?', [policyAccount]);
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
      const cashBefore = await request('accounting/cash-movements?all=true', null, 'GET');
      assert(cashBefore.body.data.some(row => row.reference_no === (posted.body.receipt_no || posted.body.entry_no)));
      if (item.kind === 'journal') {
        await db.run('UPDATE accounts SET default_cost_center_id = ? WHERE id = ?', [center.id, policyAccount]);
        await db.run('UPDATE journal_entry_lines SET cost_center_id = NULL WHERE entry_id = ? AND account_id = ?', [posted.body.id, policyAccount]);
      }
      const post = await request(item.route + '/' + posted.body.id + '/post', {});
      assert.equal(post.status, 200, JSON.stringify(post));
      if (item.kind === 'journal') assert.equal((await db.get('SELECT cost_center_id FROM journal_entry_lines WHERE entry_id = ? AND account_id = ?', [posted.body.id, policyAccount])).cost_center_id, center.id);
      const cashAfter = await request('accounting/cash-movements?all=true', null, 'GET');
      assert(cashAfter.body.data.every(row => !row.is_posted));
      assert(!cashAfter.body.data.some(row => row.reference_no === (posted.body.receipt_no || posted.body.entry_no)));
      assert.equal(cashAfter.body.summary.current_balance, cashBefore.body.summary.current_balance);
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
