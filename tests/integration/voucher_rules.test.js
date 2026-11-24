// Stage 4.2: receipt account rules (M9) and one cash-book row per voucher.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('receipts: bill collection closes the receivable, no cash-against-cash, single cash-book row', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rawasi-vouchers-'));
  Object.assign(process.env, { NODE_ENV: 'development', DB_ENGINE: 'sqlite', RAWASI_DB_PATH: path.join(temp, 'fixture.db'), RAWASI_UPLOAD_DIR: path.join(temp, 'uploads'), RAWASI_PROJECTS_DIR: path.join(temp, 'projects'), RAWASI_BACKUP_DIR: path.join(temp, 'backups'), RAWASI_SCRATCH_DIR: path.join(temp, 'scratch'), ENABLE_SCHEDULERS: 'false' });
  const fixture = spawnSync(process.execPath, ['tests/create_fixture.js'], { env: process.env, encoding: 'utf8', windowsHide: true });
  assert.equal(fixture.status, 0, fixture.stderr);
  const db = require('../../server/database/db');
  let server;
  try {
    await db.ready;
    const SystemAccounts = require('../../server/services/systemAccountService');
    const Billing = require('../../server/services/billing/billingService');
    const id = async code => (await db.get('SELECT id FROM accounts WHERE code = ?', [code]))?.id;
    const addAccount = async (code, name, type, parent) => {
      if (await id(code)) return id(code);
      const level = { 1: 1, 2: 2, 3: 3, 5: 4, 8: 5 }[code.length];
      return (await db.run('INSERT INTO accounts (code, name, type, parent_id, level, is_posting, status) VALUES (?, ?, ?, ?, ?, ?, ?)', [code, name, type, parent ? await id(parent) : null, level, level === 5 ? 1 : 0, 'active'])).lastInsertRowid;
    };
    await addAccount('112', 'الذمم', 'asset', '11'); await addAccount('11201', 'العملاء', 'asset', '112'); await addAccount('11201001', 'ذمم العملاء', 'asset', '11201');
    await addAccount('21', 'قصيرة', 'liability', '2'); await addAccount('214', 'أرصدة دائنة', 'liability', '21'); await addAccount('21402', 'مقدمات', 'liability', '214'); await addAccount('21402001', 'دفعات مقدمة من العملاء', 'liability', '21402');
    await SystemAccounts.setMapping('ACCOUNTS_RECEIVABLE', await id('11201001'));
    await SystemAccounts.setMapping('CUSTOMER_ADVANCES', await id('21402001'));
    const cash = await id('11101001'); const bank = await id('11102001'); const revenue = await id('41101001'); const ar = await id('11201001'); const expense = await id('32102001');
    const center = (await db.get("SELECT id FROM cost_centers WHERE code = 'CC-TEST'")).id;

    const admin = { id: (await db.get("SELECT id FROM users WHERE username = 'admin'")).id, username: 'admin' };
    const checker = { id: (await db.run("INSERT INTO users (username, password_hash, full_name, role, status, two_factor_enabled) VALUES ('checker2', 'x', 'Checker', 'admin', 'active', 0)")).lastInsertRowid, username: 'checker2' };
    const clientId = (await db.run("INSERT INTO clients (name) VALUES ('عميل السندات')")).lastInsertRowid;
    const projectId = (await db.run("INSERT INTO projects (name, code, client_id, status) VALUES ('مشروع السندات', 'PRJ-VCH', ?, 'active')", [clientId])).lastInsertRowid;
    const bill = await Billing.create({ project_id: projectId, client_id: clientId, amount: 5000, date: '2096-05-01' }, admin);
    await Billing.approve(bill.id, checker); await Billing.post(bill.id, checker);

    server = require('../../server/server').listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const { JWT_SECRET } = require('../../server/middleware/security');
    const token = require('jsonwebtoken').sign({ id: admin.id, username: 'admin', role: 'admin' }, JWT_SECRET, { expiresIn: '3m' });
    const call = (method, route, body) => fetch(`http://127.0.0.1:${server.address().port}/api/payments${route}`, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, body: await r.json() }));
    const receipt = extra => call('POST', '', { type: 'قبض', client_id: clientId, project_id: projectId, amount: 1000, payment_method: 'نقدي', settlement_account_id: cash, date: '2096-05-02', status: 'posted', cost_center_id: center, ...extra });

    // The UI asks which account a bill collection must use
    const required = await call('GET', `/receipt-account?category=bill_collection&bill_id=${bill.id}&client_id=${clientId}`);
    assert.equal(required.body.data.code, '11201001');
    assert.equal((await call('GET', '/receipt-account?category=general')).body.data, null);

    // M9: a bill collection credited to revenue would record the revenue twice
    const toRevenue = await receipt({ bill_id: bill.id, receipt_category: 'bill_collection', account_id: revenue });
    assert.equal(toRevenue.status, 400, JSON.stringify(toRevenue.body));
    assert.match(toRevenue.body.message, /11201001/);
    // M9: cash against cash is a transfer, not a receipt
    const cashToCash = await receipt({ receipt_category: 'general', account_id: bank });
    assert.equal(cashToCash.status, 400);
    assert.match(cashToCash.body.message, /صندوق أو بنك/);
    // advances go to the liability, never revenue
    const advanceToRevenue = await receipt({ receipt_category: 'advance_payment', account_id: revenue });
    assert.equal(advanceToRevenue.status, 400);

    // Correct collection: Dr cash / Cr receivable, bill updated, one cash-book row
    const ok = await receipt({ bill_id: bill.id, receipt_category: 'bill_collection', account_id: ar });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const lines = (await db.query('SELECT account_id, debit, credit FROM journal_entry_lines WHERE entry_id = ? ORDER BY id', [ok.body.journal_entry_id])).map(r => ({ ...r }));
    assert.deepEqual(lines, [{ account_id: cash, debit: 1000, credit: 0 }, { account_id: ar, debit: 0, credit: 1000 }]);
    const billRow = await db.get('SELECT paid_amount, remaining_amount, status FROM bills WHERE id = ?', [bill.id]);
    assert.equal(billRow.paid_amount, 1000); assert.equal(billRow.remaining_amount, 4000); assert.equal(billRow.status, 'محصل جزئي');
    const cashRows = async (receiptNo, entryNo) => (await db.get('SELECT COUNT(*) AS n FROM cash_movements WHERE reference_no IN (?, ?)', [receiptNo, entryNo])).n;
    assert.equal(await cashRows(ok.body.receipt_no, ok.body.entry_no), 1, 'one cash-book row per receipt (not one per voucher plus one per journal entry)');
    const ar_balance = await db.get('SELECT SUM(l.debit - l.credit) AS n FROM journal_entry_lines l JOIN journal_entries je ON je.id = l.entry_id WHERE je.status = ? AND l.account_id = ?', ['posted', ar]);
    assert.equal(ar_balance.n, 4000, 'receivable = bill net less collection');

    // A general receipt may credit revenue; a payment voucher also gets a single cash-book row
    const general = await receipt({ receipt_category: 'general', account_id: revenue });
    assert.equal(general.status, 200, JSON.stringify(general.body));
    const pay = await call('POST', '', { type: 'صرف', amount: 300, payment_method: 'نقدي', settlement_account_id: cash, account_id: expense, cost_center_id: center, date: '2096-05-03', status: 'posted' });
    assert.equal(pay.status, 200, JSON.stringify(pay.body));
    assert.equal(await cashRows(pay.body.receipt_no, pay.body.entry_no), 1);

    // H5: without the posting permission a voucher is saved as a draft and cannot be posted by its creator
    const pm = (await db.run("INSERT INTO users (username, password_hash, full_name, role, status, two_factor_enabled) VALUES ('pm1', 'x', 'Project manager', 'project_manager', 'active', 0)")).lastInsertRowid;
    const pmToken = require('jsonwebtoken').sign({ id: pm, username: 'pm1', role: 'project_manager' }, JWT_SECRET, { expiresIn: '3m' });
    const asPm = (method, route, body) => fetch(`http://127.0.0.1:${server.address().port}/api${route}`, { method, headers: { Authorization: 'Bearer ' + pmToken, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, body: await r.json() }));
    const pmExpense = await asPm('POST', '/expenses', { amount: 200, expense_type: 'مصروفات إدارية', payment_method: 'نقدي', settlement_account_id: cash, account_id: expense, cost_center_id: center, date: '2096-05-04', status: 'posted', notes: 'pm expense' });
    assert.equal(pmExpense.status, 200, JSON.stringify(pmExpense.body));
    assert.equal(pmExpense.body.status, 'draft');
    assert.equal(pmExpense.body.requires_posting, true);
    assert.equal(pmExpense.body.entry_no, null);
    assert.equal((await asPm('POST', `/expenses/${pmExpense.body.id}/post`)).status, 403);
    const sk = (await db.run("INSERT INTO users (username, password_hash, full_name, role, status, two_factor_enabled) VALUES ('sk1', 'x', 'Storekeeper', 'storekeeper', 'active', 0)")).lastInsertRowid;
    const skToken = require('jsonwebtoken').sign({ id: sk, username: 'sk1', role: 'storekeeper' }, JWT_SECRET, { expiresIn: '3m' });
    const asSk = (method, route, body) => fetch(`http://127.0.0.1:${server.address().port}/api${route}`, { method, headers: { Authorization: 'Bearer ' + skToken, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(r => r.status);
    assert.equal(await asSk('POST', '/payments/transactions', { direction: 'OUT', amount: 10 }), 403, 'payment transactions need a financial permission');
    assert.equal(await asSk('GET', '/payments/transactions'), 403);
    assert.equal((await asPm('POST', '/payments/transactions/1/approve')).status, 403);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
  }
});
