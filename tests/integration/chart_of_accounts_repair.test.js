// Stage 2: chart-of-accounts repair on the production-shaped chart, system account roles, settlement checks.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { planRepair, applyRepair, loadAccounts } = require('../../server/database/chartOfAccountsRepair');
const { auditChart, normalBalanceFor, normalizeAccountType } = require('../../server/services/chartOfAccountsRules');

const shape = require('../fixtures/production_coa_shape.json').accounts;

function productionShapedDb(file, { lineOn = [] } = {}) {
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL,
      parent_id INTEGER REFERENCES accounts(id), balance REAL DEFAULT 0, level INTEGER, is_posting INTEGER DEFAULT 1, status TEXT DEFAULT 'active',
      parent_code TEXT, is_contra INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1, currencies TEXT, report_type TEXT, inclusion TEXT, created_at DATETIME);
    CREATE TABLE journal_entry_lines (id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id INTEGER, account_id INTEGER REFERENCES accounts(id), debit REAL DEFAULT 0, credit REAL DEFAULT 0);`);
  const ins = db.prepare(`INSERT INTO accounts (id, code, name, type, parent_id, level, is_posting, status, parent_code, is_contra, is_active, currencies, report_type, inclusion)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  db.exec('PRAGMA foreign_keys = OFF');
  for (const a of shape) ins.run(a.id, a.code, a.name, a.type, a.parent_id, a.level, a.is_posting, a.status, a.parent_code, a.is_contra, a.is_active, a.currencies, a.report_type, a.inclusion);
  for (const code of lineOn) db.prepare('INSERT INTO journal_entry_lines (entry_id, account_id, debit) SELECT 1, id, 10 FROM accounts WHERE code = ?').run(code);
  return db;
}

test('the production-shaped chart is repaired to zero structural errors, idempotently, without touching codes or lines', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rawasi-coa-'));
  const db = productionShapedDb(path.join(temp, 'coa.db'), { lineOn: ['12101001', '21101001'] });
  try {
    const before = auditChart(loadAccounts(db));
    assert.ok(before.errors.length > 30, 'the production shape is broken before the repair');
    assert.ok(before.errors.some(e => e.rule === 'wrong_parent' && e.code === '12101001'), 'furniture sits under the cash box');

    const result = applyRepair(db);
    assert.deepEqual(result.after.errors, [], 'no structural errors remain');
    assert.equal(planRepair(db).changes.length, 0, 'a second run changes nothing');

    const acc = code => db.prepare('SELECT a.*, p.code AS parent FROM accounts a LEFT JOIN accounts p ON p.id = a.parent_id WHERE a.code = ?').get(code);
    assert.equal(acc('12101001').parent, '12101');
    assert.equal(acc('121').parent, '12');
    assert.equal(acc('21101001').parent, '21101');
    assert.equal(acc('211').parent, '21');
    assert.equal(acc('221').parent, '2', 'equity sits beside liabilities, not inside long-term liabilities');
    assert.equal(acc('2').name, 'الالتزامات وحقوق الملكية');
    assert.equal(acc('11102003').type, 'asset', 'Arabic type labels are normalised');
    assert.equal(acc('11102003').parent_code, '11102');
    assert.equal(acc('12401001').is_contra, 1);
    assert.equal(acc('12401001').normal_balance, 'credit', 'accumulated depreciation is a credit-natured contra asset');
    assert.equal(acc('12401001').parent, '12401');
    assert.equal(acc('22103001').status, 'inactive', 'the misplaced depreciation account is retired, not deleted');
    assert.equal(acc('22103001').is_posting, 0);
    assert.equal(acc('21101004').status, 'inactive');
    assert.equal(acc('21402001').parent, '21402');
    assert.equal(acc('22104001').type, 'equity');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n, shape.length + require('../../server/database/chartOfAccountsRepair').NEW_ACCOUNTS.length, 'only additions, no deletions');
    for (const a of shape) assert.ok(acc(a.code), `account ${a.code} still exists with the same code`);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM journal_entry_lines').get().n, 2, 'journal lines untouched');

    const map = role => db.prepare('SELECT a.code FROM system_account_mappings m JOIN accounts a ON a.id = m.account_id WHERE m.role = ?').get(role)?.code;
    assert.equal(map('CUSTOMER_ADVANCES'), '21402001');
    assert.equal(map('CASH_GROUP'), '11101');
    assert.equal(map('ACCOUNTS_RECEIVABLE'), '11201001');
    assert.equal(map('ACCUMULATED_DEPRECIATION'), '12401001');
  } finally { db.close(); fs.rmSync(temp, { recursive: true, force: true }); }
});

test('an account that already carries journal lines is not retired; the repair reports it for the accountant', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rawasi-coa-'));
  const db = productionShapedDb(path.join(temp, 'coa.db'), { lineOn: ['21101004'] });
  try {
    const result = applyRepair(db);
    assert.ok(result.skipped.some(s => s.code === '21101004' && /reclassification/.test(s.reason)));
    assert.equal(db.prepare("SELECT status FROM accounts WHERE code = '21101004'").get().status, 'active');
    assert.deepEqual(result.after.errors, []);
  } finally { db.close(); fs.rmSync(temp, { recursive: true, force: true }); }
});

test('type vocabulary and normal balance rules', () => {
  assert.equal(normalizeAccountType('أصول'), 'asset');
  assert.equal(normalizeAccountType('حقوق ملكية'), 'equity');
  assert.equal(normalizeAccountType('غير معروف'), null);
  assert.equal(normalBalanceFor('expense'), 'debit');
  assert.equal(normalBalanceFor('revenue'), 'credit');
  assert.equal(normalBalanceFor('asset', 1), 'credit');
});

test('system accounts: seeded at boot, API to review/change them, settlement checks no longer trust broken parent links', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rawasi-system-accounts-'));
  Object.assign(process.env, { NODE_ENV: 'development', DB_ENGINE: 'sqlite', RAWASI_DB_PATH: path.join(temp, 'fixture.db'), RAWASI_UPLOAD_DIR: path.join(temp, 'uploads'), RAWASI_PROJECTS_DIR: path.join(temp, 'projects'), RAWASI_BACKUP_DIR: path.join(temp, 'backups'), RAWASI_SCRATCH_DIR: path.join(temp, 'scratch'), ENABLE_SCHEDULERS: 'false' });
  const fixture = spawnSync(process.execPath, ['tests/create_fixture.js'], { env: process.env, encoding: 'utf8', windowsHide: true });
  assert.equal(fixture.status, 0, fixture.stderr);
  const db = require('../../server/database/db');
  let server;
  try {
    await db.ready;
    const Accounting = require('../../server/services/accountingService');
    const SystemAccounts = require('../../server/services/systemAccountService');
    const id = async code => (await db.get('SELECT id FROM accounts WHERE code = ?', [code])).id;

    // Boot added the columns, the normal-balance trigger and the default mappings that exist in this chart
    assert.equal((await SystemAccounts.resolve('CASH_DEFAULT')).code, '11101001');
    assert.equal((await SystemAccounts.resolve('CASH_GROUP')).code, '11101');
    assert.equal((await db.get("SELECT normal_balance FROM accounts WHERE code = '41101001'")).normal_balance, 'credit');
    const created = await db.run("INSERT INTO accounts (code, name, type, level, is_posting, status) VALUES ('99999998', 'contra test', 'asset', 5, 1, 'active')");
    await db.run('UPDATE accounts SET is_contra = 1 WHERE id = ?', [created.lastInsertRowid]);
    assert.equal((await db.get('SELECT normal_balance FROM accounts WHERE id = ?', [created.lastInsertRowid])).normal_balance, 'credit');
    await assert.rejects(SystemAccounts.resolve('WHT_PAYABLE'), /لم يتم ربط حساب النظام/, 'an unmapped role fails with a clear message');

    // R2: a furniture account wrongly linked under the cash box is still refused as a cash account
    assert.equal((await Accounting.resolveVoucherSettlementAccount('نقدي', await id('11101001'))).code, '11101001');
    await db.run('UPDATE accounts SET parent_id = ? WHERE code = ?', [await id('11101'), '12101002']);
    await assert.rejects(Accounting.resolveVoucherSettlementAccount('نقدي', await id('12101002')), /حساب صندوق/);

    server = require('../../server/server').listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const user = await db.get("SELECT id FROM users WHERE username = 'admin'");
    const { JWT_SECRET } = require('../../server/middleware/security');
    const token = require('jsonwebtoken').sign({ id: user.id, username: 'admin', role: 'admin' }, JWT_SECRET, { expiresIn: '3m' });
    const api = (route, method = 'GET', body) => fetch(`http://127.0.0.1:${server.address().port}/api/accounting${route}`, { method,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      .then(async r => ({ status: r.status, body: await r.json() }));

    const listed = await api('/system-accounts');
    assert.equal(listed.status, 200);
    assert.equal(listed.body.data.find(r => r.role === 'CASH_DEFAULT').code, '11101001');
    assert.equal(listed.body.data.find(r => r.role === 'WHT_PAYABLE').problem, 'غير مربوط');

    const wrongType = await api('/system-accounts/CONTRACT_REVENUE', 'PUT', { account_id: await id('11101001') });
    assert.equal(wrongType.status, 400, 'a cash account cannot be the revenue account');
    const group = await api('/system-accounts/CONTRACT_REVENUE', 'PUT', { account_id: await id('41101') });
    assert.equal(group.status, 400, 'a summary account cannot be a posting role');
    const ok = await api('/system-accounts/BANK_DEFAULT', 'PUT', { account_id: await id('11102002') });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal((await SystemAccounts.resolve('BANK_DEFAULT')).code, '11102002');
    assert.equal((await Accounting.resolveBankAccount()).coaAccount.code, '11102002');
    const unknown = await api('/system-accounts/NOPE', 'PUT', { account_id: await id('11102002') });
    assert.equal(unknown.status, 400);

    // Account types are normalised on creation
    const createdAccount = await api('/accounts', 'POST', { code: '11102003', name: 'بنك اختبار', type: 'أصول', parent_id: await id('11102') });
    assert.equal(createdAccount.status, 200, JSON.stringify(createdAccount.body));
    assert.equal((await db.get("SELECT type FROM accounts WHERE code = '11102003'")).type, 'asset');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await db.close?.();
  }
});
