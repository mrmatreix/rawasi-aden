// Stage 4.7: subledger derived from the ledger (party dimension), supplier prepayments kept, derived cash boxes, site journals on roles.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('subledger: party balances from tagged ledger lines, no prepayment wipe-out, cash boxes by sums, site journals on role accounts', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rawasi-subledger-'));
  Object.assign(process.env, { NODE_ENV: 'development', DB_ENGINE: 'sqlite', RAWASI_DB_PATH: path.join(temp, 'fixture.db'), RAWASI_UPLOAD_DIR: path.join(temp, 'uploads'), RAWASI_PROJECTS_DIR: path.join(temp, 'projects'), RAWASI_BACKUP_DIR: path.join(temp, 'backups'), RAWASI_SCRATCH_DIR: path.join(temp, 'scratch'), ENABLE_SCHEDULERS: 'false' });
  const fixture = spawnSync(process.execPath, ['tests/create_fixture.js'], { env: process.env, encoding: 'utf8', windowsHide: true });
  assert.equal(fixture.status, 0, fixture.stderr);
  const db = require('../../server/database/db');
  let server;
  try {
    await db.ready;
    const SystemAccounts = require('../../server/services/systemAccountService');
    const Billing = require('../../server/services/billing/billingService');
    const Subledger = require('../../server/services/ledger/subledgerService');
    const ProjectCost = require('../../server/services/projectCostService');
    const CashBox = require('../../server/services/cashBoxService');
    const id = async code => (await db.get('SELECT id FROM accounts WHERE code = ?', [code]))?.id;
    const addAccount = async (code, name, type, parent) => {
      if (await id(code)) return id(code);
      const level = { 1: 1, 2: 2, 3: 3, 5: 4, 8: 5 }[code.length];
      return (await db.run('INSERT INTO accounts (code, name, type, parent_id, level, is_posting, status) VALUES (?, ?, ?, ?, ?, ?, ?)', [code, name, type, parent ? await id(parent) : null, level, level === 5 ? 1 : 0, 'active'])).lastInsertRowid;
    };
    await addAccount('112', 'الذمم', 'asset', '11'); await addAccount('11201', 'العملاء', 'asset', '112'); await addAccount('11201001', 'ذمم العملاء', 'asset', '11201');
    await addAccount('21', 'قصيرة', 'liability', '2'); await addAccount('211', 'الموردون', 'liability', '21'); await addAccount('21101', 'موردون محليون', 'liability', '211'); await addAccount('21101001', 'موردون محليون', 'liability', '21101');
    await addAccount('31101009', 'تكلفة مواد المشاريع', 'expense', '31101'); await addAccount('31101005', 'أجور عمالة الموقع', 'expense', '31101');
    await SystemAccounts.setMapping('ACCOUNTS_RECEIVABLE', await id('11201001'));
    await SystemAccounts.setMapping('SUPPLIERS_PAYABLE', await id('21101001'));
    await SystemAccounts.setMapping('PROJECT_MATERIAL_COST', await id('31101009'));
    await SystemAccounts.setMapping('SITE_LABOR_COST', await id('31101005'));
    const cash = await id('11101001'); const ar = await id('11201001'); const ap = await id('21101001'); const expense = await id('32102001');
    const center = (await db.get("SELECT id FROM cost_centers WHERE code = 'CC-TEST'")).id;
    const admin = { id: (await db.get("SELECT id FROM users WHERE username = 'admin'")).id, username: 'admin', role: 'admin' };
    const checker = { id: (await db.run("INSERT INTO users (username, password_hash, full_name, role, status, two_factor_enabled) VALUES ('sl-checker', 'x', 'Checker', 'admin', 'active', 0)")).lastInsertRowid, username: 'sl-checker' };
    const clientA = (await db.run("INSERT INTO clients (name) VALUES ('عميل أ')")).lastInsertRowid;
    const clientB = (await db.run("INSERT INTO clients (name) VALUES ('عميل ب')")).lastInsertRowid;
    const projectA = (await db.run("INSERT INTO projects (name, code, client_id, status) VALUES ('مشروع أ', 'PRJ-SLA', ?, 'active')", [clientA])).lastInsertRowid;
    const projectB = (await db.run("INSERT INTO projects (name, code, client_id, status) VALUES ('مشروع ب', 'PRJ-SLB', ?, 'active')", [clientB])).lastInsertRowid;
    const supplierId = (await db.run("INSERT INTO suppliers (name, company_name, balance) VALUES ('مورد الاختبار', 'مورد الاختبار', 0)")).lastInsertRowid;

    // Two clients share one receivable account; each one's balance comes from its own tagged lines
    for (const [project, client, amount] of [[projectA, clientA, 4000], [projectB, clientB, 9000]]) {
      const bill = await Billing.create({ project_id: project, client_id: client, amount, date: '2099-01-10' }, admin);
      await Billing.approve(bill.id, checker); await Billing.post(bill.id, checker);
    }
    assert.equal((await Subledger.partyBalance('client', clientA)).balance, 4000);
    assert.equal((await Subledger.partyBalance('client', clientB)).balance, 9000);

    server = require('../../server/server').listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const { JWT_SECRET } = require('../../server/middleware/security');
    const token = require('jsonwebtoken').sign({ id: admin.id, username: 'admin', role: 'admin' }, JWT_SECRET, { expiresIn: '3m' });
    const api = (method, route, body) => fetch(`http://127.0.0.1:${server.address().port}/api${route}`, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, body: await r.json() }));

    const billA = await db.get('SELECT id FROM bills WHERE client_id = ?', [clientA]);
    const receipt = await api('POST', '/payments', { type: 'قبض', client_id: clientA, project_id: projectA, bill_id: billA.id, receipt_category: 'bill_collection', account_id: ar, amount: 1500, payment_method: 'نقدي', settlement_account_id: cash, date: '2099-01-12', status: 'posted' });
    assert.equal(receipt.status, 200, JSON.stringify(receipt.body));
    const ledgerA = await api('GET', `/accounting/party-ledger/client/${clientA}`);
    assert.equal(ledgerA.status, 200, JSON.stringify(ledgerA.body));
    assert.equal(ledgerA.body.data.balance, 2500, 'bill 4000 less collection 1500');
    assert.equal(ledgerA.body.data.difference, 0, 'stored client balance agrees with the ledger');
    assert.deepEqual(ledgerA.body.data.statement.lines.map(l => l.balance), [4000, 2500]);
    // the client statement no longer opens with the other client's receivables
    const Reporting = require('../../server/services/reportingService');
    const stA = await Reporting.getClientStatement(clientA, { from_date: '2099-01-11', to_date: '2099-12-31' });
    const opening = stA.data.summary.opening_balance;
    assert.equal(Number(opening), 4000);

    // M1: a payment to a supplier with nothing owed is a prepayment (negative payable), not erased to zero
    const prepay = await api('POST', '/payments', { type: 'صرف', supplier_id: supplierId, account_id: ap, amount: 700, payment_method: 'نقدي', settlement_account_id: cash, date: '2099-01-13', status: 'posted' });
    assert.equal(prepay.status, 200, JSON.stringify(prepay.body));
    assert.equal((await db.get('SELECT balance FROM suppliers WHERE id = ?', [supplierId])).balance, -700);
    assert.equal((await Subledger.partyBalance('supplier', supplierId)).balance, 700, 'debit balance on the supplier = prepayment');
    assert.equal((await Subledger.reconcileParty('supplier', supplierId)).difference, 0);

    // Site purchase payable and settlement: material cost + supplier payable on role accounts, tagged with the supplier
    const ap1 = await db.transaction(tx => ProjectCost.createPayableJournal(tx, { purchaseId: 1, supplierId, projectId: projectA, amount: 300, date: '2099-01-14', invoiceRef: 'INV-S1' }));
    const apLines = (await db.query('SELECT a.code, l.debit, l.credit, l.party_id FROM journal_entry_lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = ? ORDER BY l.id', [ap1.jeId])).map(r => ({ ...r }));
    assert.deepEqual(apLines, [{ code: '31101009', debit: 300, credit: 0, party_id: null }, { code: '21101001', debit: 0, credit: 300, party_id: Number(supplierId) }]);
    const wage = await db.transaction(tx => ProjectCost.createWageAccrualJournal(tx, { laborId: 1, workerLabel: 'عامل', projectId: projectA, amount: 120, date: '2099-01-15' }));
    assert.equal((await db.get('SELECT a.code FROM journal_entry_lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = ? AND l.debit > 0', [wage.jeId])).code, '31101005', 'site wages are site labour cost, not management salaries');

    // Cash boxes: a back-dated movement no longer corrupts the box balance
    await db.transaction(tx => CashBox.appendMovement(tx, { cashIn: 100, date: '2099-02-01', notes: 'later' }));
    await db.transaction(tx => CashBox.appendMovement(tx, { cashOut: 30, date: '2099-01-01', notes: 'back-dated' }));
    const sums = await db.get('SELECT COALESCE(SUM(cash_in - cash_out - COALESCE(withdrawals, 0)), 0) AS n FROM cash_movements WHERE project_id IS NULL');
    const first = await db.get('SELECT previous_balance FROM cash_movements WHERE project_id IS NULL ORDER BY date, id LIMIT 1');
    const main = (await CashBox.getBoxesSummary()).boxes.find(b => b.project_id === null);
    assert.equal(main.current_balance, Math.round((Number(first.previous_balance) + Number(sums.n)) * 100) / 100);

    // Permissions: the cash statement needs a financial permission
    const sk = (await db.run("INSERT INTO users (username, password_hash, full_name, role, status, two_factor_enabled) VALUES ('sl-sk', 'x', 'Storekeeper', 'storekeeper', 'active', 0)")).lastInsertRowid;
    const skToken = require('jsonwebtoken').sign({ id: sk, username: 'sl-sk', role: 'storekeeper' }, JWT_SECRET, { expiresIn: '3m' });
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/accounting/cash-movements`, { headers: { Authorization: 'Bearer ' + skToken } });
    assert.equal(r.status, 403);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
  }
});
