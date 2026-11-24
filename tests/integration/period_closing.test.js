// Stage 6: period and year closing (H11).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('periods: no overlaps, dedicated permission + own password, nothing pending, year-end closing to retained earnings', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rawasi-closing-'));
  Object.assign(process.env, { NODE_ENV: 'development', DB_ENGINE: 'sqlite', RAWASI_DB_PATH: path.join(temp, 'fixture.db'), RAWASI_UPLOAD_DIR: path.join(temp, 'uploads'), RAWASI_PROJECTS_DIR: path.join(temp, 'projects'), RAWASI_BACKUP_DIR: path.join(temp, 'backups'), RAWASI_SCRATCH_DIR: path.join(temp, 'scratch'), ENABLE_SCHEDULERS: 'false' });
  const fixture = spawnSync(process.execPath, ['tests/create_fixture.js'], { env: process.env, encoding: 'utf8', windowsHide: true });
  assert.equal(fixture.status, 0, fixture.stderr);
  const db = require('../../server/database/db');
  let server;
  try {
    await db.ready;
    const bcrypt = require('bcryptjs');
    const SystemAccounts = require('../../server/services/systemAccountService');
    const Accounting = require('../../server/services/accountingService');
    const Reporting = require('../../server/services/reportingService');
    const id = async code => (await db.get('SELECT id FROM accounts WHERE code = ?', [code]))?.id;
    await db.run("INSERT INTO accounts (code, name, type, parent_id, level, is_posting, status) VALUES ('22104', 'الأرباح المحتجزة', 'equity', ?, 4, 0, 'active')", [await id('221')]);
    await db.run("INSERT INTO accounts (code, name, type, parent_id, level, is_posting, status) VALUES ('22104001', 'الأرباح المحتجزة', 'equity', ?, 5, 1, 'active')", [await id('22104')]);
    await SystemAccounts.setMapping('RETAINED_EARNINGS', await id('22104001'));
    const cash = await id('11101001'); const revenue = await id('41101001'); const expense = await id('32102001'); const re = await id('22104001');
    const center = (await db.get("SELECT id FROM cost_centers WHERE code = 'CC-TEST'")).id;

    // Test users with test passwords (fixture-only values)
    const hash = bcrypt.hashSync('closing-test-pass', 4);
    const closer = (await db.run("INSERT INTO users (username, password_hash, full_name, role, status, two_factor_enabled) VALUES ('closer', ?, 'Closer', 'admin', 'active', 0)", [hash])).lastInsertRowid;
    const accountant = (await db.run("INSERT INTO users (username, password_hash, full_name, role, status, two_factor_enabled) VALUES ('acc1', ?, 'Accountant', 'accountant', 'active', 0)", [hash])).lastInsertRowid;

    server = require('../../server/server').listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const { JWT_SECRET } = require('../../server/middleware/security');
    const tokenOf = (uid, username, role) => require('jsonwebtoken').sign({ id: uid, username, role }, JWT_SECRET, { expiresIn: '5m' });
    const tokens = { closer: tokenOf(closer, 'closer', 'admin'), acc: tokenOf(accountant, 'acc1', 'accountant') };
    const api = (who, method, route, body) => fetch(`http://127.0.0.1:${server.address().port}/api/accounting${route}`, { method, headers: { Authorization: 'Bearer ' + tokens[who], 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, body: await r.json() }));

    // 1. Periods cannot overlap
    const p = await api('closer', 'POST', '/periods', { period_name: 'الربع الرابع 2090', start_date: '2090-10-01', end_date: '2090-12-31' });
    assert.equal(p.status, 200, JSON.stringify(p.body));
    const clash = await api('closer', 'POST', '/periods', { period_name: 'ديسمبر 2090', start_date: '2090-12-01', end_date: '2090-12-31' });
    assert.equal(clash.status, 409); assert.equal(clash.body.code, 'PERIOD_OVERLAP');
    const periodId = p.body.id;

    // Activity in 2090: revenue 1000, expense 400 -> profit 600; plus a draft entry left pending
    await Accounting.createJournalEntry({ date: '2090-11-10', description: 'إيراد' }, [{ account_id: cash, debit: 1000 }, { account_id: revenue, credit: 1000, cost_center_id: center }]);
    await Accounting.createJournalEntry({ date: '2090-11-11', description: 'مصروف' }, [{ account_id: expense, debit: 400, cost_center_id: center }, { account_id: cash, credit: 400 }]);
    const draft = await Accounting.createJournalEntry({ date: '2090-11-12', description: 'مسودة', status: 'draft' }, [{ account_id: expense, debit: 5, cost_center_id: center }, { account_id: cash, credit: 5 }]);

    // 2. Closing needs the dedicated permission (the accountant role's blanket accounting:* does not count)
    assert.equal((await api('acc', 'PUT', `/periods/${periodId}/close`, { password: 'closing-test-pass' })).status, 403);
    // 3. ... and the current user's own password (no other admin's password)
    assert.equal((await api('closer', 'PUT', `/periods/${periodId}/close`, { password: 'wrong' })).status, 401);
    // 4. Nothing may be left unposted in the period
    const pending = await api('closer', 'PUT', `/periods/${periodId}/close`, { password: 'closing-test-pass' });
    assert.equal(pending.status, 409); assert.equal(pending.body.code, 'PERIOD_HAS_PENDING'); assert.equal(pending.body.pending.journal_entries, 1);
    await db.run("UPDATE journal_entries SET status = 'cancelled' WHERE id = ? AND status = 'draft'", [draft.id]).catch(async () => {
      await db.run('INSERT INTO ledger_maintenance_unlock (reason) VALUES (?)', ['test: drop draft']);
      await db.run('DELETE FROM journal_entry_lines WHERE entry_id = ?', [draft.id]); await db.run('DELETE FROM journal_entries WHERE id = ?', [draft.id]);
      await db.run('DELETE FROM ledger_maintenance_unlock');
    });

    // 5. The period containing the year end needs the closing entry first
    const needYear = await api('closer', 'PUT', `/periods/${periodId}/close`, { password: 'closing-test-pass' });
    assert.equal(needYear.status, 409, JSON.stringify(needYear.body)); assert.equal(needYear.body.code, 'YEAR_CLOSING_REQUIRED'); assert.equal(needYear.body.fiscal_year, 2090);
    const status = await api('closer', 'GET', '/fiscal-years/2090/closing');
    assert.equal(status.body.data.net_result, 600);

    // 6. Year closing: revenue and expense to zero, profit to retained earnings, dated 31/12
    const yc = await api('closer', 'POST', '/fiscal-years/2090/closing', { password: 'closing-test-pass' });
    assert.equal(yc.status, 200, JSON.stringify(yc.body)); assert.equal(yc.body.net_result, 600);
    const closing = await db.get('SELECT * FROM journal_entries WHERE id = ?', [yc.body.journal_entry_id]);
    assert.equal(closing.date, '2090-12-31');
    const bal = async acc => Number((await db.get("SELECT COALESCE(SUM(l.debit - l.credit), 0) AS b FROM journal_entry_lines l JOIN journal_entries je ON je.id = l.entry_id WHERE je.status = 'posted' AND l.account_id = ? AND je.date <= '2090-12-31'", [acc])).b);
    assert.equal(await bal(revenue), 0); assert.equal(await bal(expense), 0); assert.equal(await bal(re), -600, 'retained earnings credited with the profit');
    assert.equal((await api('closer', 'POST', '/fiscal-years/2090/closing', { password: 'closing-test-pass' })).status, 409, 'only once');
    // the income statement of the year still shows the profit (the closing entry is excluded from it)
    const is = await Reporting.getIncomeStatement({ from_date: '2090-01-01', to_date: '2090-12-31' });
    const isData = is.data || is;
    assert.equal(Math.round(Number(isData.summary?.net_profit ?? isData.net_profit ?? isData.totals?.net_profit)), 600);

    // 7. Now the period closes, and the database refuses postings dated inside it
    const closed = await api('closer', 'PUT', `/periods/${periodId}/close`, { password: 'closing-test-pass' });
    assert.equal(closed.status, 200, JSON.stringify(closed.body));
    await assert.rejects(Accounting.createJournalEntry({ date: '2090-11-20', description: 'بعد الإقفال' }, [{ account_id: cash, debit: 1 }, { account_id: revenue, credit: 1, cost_center_id: center }]), /مغلقة/);

    // 8. Reopening: dedicated permission + documented reason
    assert.equal((await api('acc', 'PUT', `/periods/${periodId}/reopen`, { reason: 'تصحيح' })).status, 403);
    assert.equal((await api('closer', 'PUT', `/periods/${periodId}/reopen`, { reason: '' })).status, 400);
    assert.equal((await api('closer', 'PUT', `/periods/${periodId}/reopen`, { reason: 'تصحيح قيد بعد المراجعة' })).status, 200);

    // 9. Repeated wrong passwords lock closing for this user
    const p2 = await api('closer', 'POST', '/periods', { period_name: 'يناير 2091', start_date: '2091-01-01', end_date: '2091-01-31' });
    for (let i = 0; i < 5; i++) await api('closer', 'PUT', `/periods/${p2.body.id}/close`, { password: 'nope' + i });
    assert.equal((await api('closer', 'PUT', `/periods/${p2.body.id}/close`, { password: 'closing-test-pass' })).status, 429);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
  }
});
