// Stage 4.1: one bill lifecycle (draft -> approved by another user -> posted), revenue once, WHT as its own entry.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('bills: maker-checker, single posting path through PostingService, revenue at billing, tax entry, reversal', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rawasi-billing-'));
  Object.assign(process.env, { NODE_ENV: 'development', DB_ENGINE: 'sqlite', RAWASI_DB_PATH: path.join(temp, 'fixture.db'), RAWASI_UPLOAD_DIR: path.join(temp, 'uploads'), RAWASI_PROJECTS_DIR: path.join(temp, 'projects'), RAWASI_BACKUP_DIR: path.join(temp, 'backups'), RAWASI_SCRATCH_DIR: path.join(temp, 'scratch'), ENABLE_SCHEDULERS: 'false' });
  const fixture = spawnSync(process.execPath, ['tests/create_fixture.js'], { env: process.env, encoding: 'utf8', windowsHide: true });
  assert.equal(fixture.status, 0, fixture.stderr);
  const db = require('../../server/database/db');
  let server;
  try {
    await db.ready;
    const SystemAccounts = require('../../server/services/systemAccountService');
    const Billing = require('../../server/services/billing/billingService');
    const Tax = require('../../server/services/taxAndGuaranteeService');
    const Contracting = require('../../server/services/contractingAccountingService');
    const Control = require('../../server/services/financialControlService');
    const id = async code => (await db.get('SELECT id FROM accounts WHERE code = ?', [code]))?.id;

    // Production-shaped receivable / retention / advance / WHT accounts, mapped to their roles
    const addAccount = async (code, name, type, parent) => {
      if (await id(code)) return id(code);
      const level = { 1: 1, 2: 2, 3: 3, 5: 4, 8: 5 }[code.length];
      const r = await db.run('INSERT INTO accounts (code, name, type, parent_id, level, is_posting, status) VALUES (?, ?, ?, ?, ?, ?, ?)', [code, name, type, parent ? await id(parent) : null, level, level === 5 ? 1 : 0, 'active']);
      return r.lastInsertRowid;
    };
    await addAccount('112', 'الذمم', 'asset', '11'); await addAccount('11201', 'العملاء', 'asset', '112'); await addAccount('11201001', 'ذمم العملاء', 'asset', '11201');
    await addAccount('11202', 'المحتجزات', 'asset', '112'); await addAccount('11202001', 'محتجزات لدى العملاء', 'asset', '11202');
    await addAccount('118', 'الضرائب المدينة', 'asset', '11'); await addAccount('11801', 'الضرائب المدينة', 'asset', '118'); await addAccount('11801001', 'ضريبة مخصومة', 'asset', '11801');
    await addAccount('21', 'قصيرة', 'liability', '2'); await addAccount('214', 'أرصدة دائنة', 'liability', '21'); await addAccount('21402', 'مقدمات', 'liability', '214'); await addAccount('21402001', 'دفعات مقدمة من العملاء', 'liability', '21402');
    await SystemAccounts.setMapping('ACCOUNTS_RECEIVABLE', await id('11201001'));
    await SystemAccounts.setMapping('RETENTION_RECEIVABLE', await id('11202001'));
    await SystemAccounts.setMapping('CUSTOMER_ADVANCES', await id('21402001'));
    await SystemAccounts.setMapping('WHT_RECEIVABLE', await id('11801001'));
    await db.run("UPDATE accounts SET cost_center_required = 1 WHERE code = '41101001'");

    const admin = { id: (await db.get("SELECT id FROM users WHERE username = 'admin'")).id, username: 'admin', role: 'admin' };
    const checkerId = (await db.run("INSERT INTO users (username, password_hash, full_name, role, status, two_factor_enabled) VALUES ('checker', 'x', 'Checker', 'admin', 'active', 0)")).lastInsertRowid;
    const checker = { id: checkerId, username: 'checker', role: 'admin' };
    const clientId = (await db.run("INSERT INTO clients (name) VALUES ('عميل اختبار المستخلص')")).lastInsertRowid;
    const projectId = (await db.run("INSERT INTO projects (name, code, client_id, status) VALUES ('مشروع المستخلص', 'PRJ-BILL', ?, 'active')", [clientId])).lastInsertRowid;
    await db.run("INSERT INTO cost_centers (code, name, type, project_id, status) VALUES ('CC-BILL', 'مركز المشروع', 'project', ?, 'active')", [projectId]);
    const revenueLines = async entryId => (await db.query('SELECT a.code, l.debit, l.credit FROM journal_entry_lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = ? ORDER BY l.id', [entryId])).map(r => ({ ...r }));
    const ledgerRevenue = async () => Number((await db.get("SELECT COALESCE(SUM(l.credit - l.debit), 0) AS r FROM journal_entry_lines l JOIN journal_entries je ON je.id = l.entry_id JOIN accounts a ON a.id = l.account_id WHERE je.status = 'posted' AND a.code = '41101001' AND l.project_id = ?", [projectId])).r);

    // 1. Creation never posts, even when the client asks for 'معتمد'
    const bill = await Billing.create({ project_id: projectId, client_id: clientId, amount: 100000, advance_deduction: 10000, retention_deduction: 5000, deduction: 17000, status: 'معتمد', date: '2095-02-10' }, admin);
    assert.equal(bill.status, 'draft');
    assert.match(bill.bill_no, /^INV-2095-\d{4}$/);
    assert.equal(bill.net_amount, 83000, 'other deductions (2,000) reduce the net amount');
    assert.equal(await db.get("SELECT id FROM journal_entries WHERE reference_type = 'مستخلص أعمال معتمد' AND reference_id = ?", [bill.id]), null);

    // 2. Draft cannot be posted or collected; creator cannot approve
    await assert.rejects(Billing.post(bill.id, checker), /إلا بعد اعتماده/);
    await assert.rejects(db.transaction(tx => require('../../server/services/clientChainService').applyPaymentToBill(bill.id, 100, tx)), /غير مرحّل/);
    await assert.rejects(Billing.approve(bill.id, admin), /انتهاك لمبدأ الرقابة الثنائية/);

    // 3. Edit keeps remaining = net (H12)
    await Billing.update(bill.id, { amount: 90000, deduction: 17000 });
    let row = await db.get('SELECT * FROM bills WHERE id = ?', [bill.id]);
    assert.equal(row.net_amount, 73000);
    assert.equal(row.remaining_amount, 73000);

    // 4. WHT on an unposted bill only changes the bill; the posting carries the WHT line (no invented retention, H10)
    const taxDraft = await Tax.processBillTaxDeduction(bill.id, 3.0, checker);
    assert.equal(taxDraft.tax_wht_amount, 2700);
    assert.equal(taxDraft.net_amount, 70300);
    assert.equal(taxDraft.retention_deduction, 5000);
    assert.equal(taxDraft.journal_entry_no, null);
    await assert.rejects(Tax.processBillTaxDeduction(bill.id, 3.0, checker), /محتسبة مسبقاً/);

    // 5. Approve by another user, then post once
    await Billing.approve(bill.id, checker);
    const posted = await Billing.post(bill.id, checker);
    assert.match(posted.entry.entry_no, /^JE-\d{5}$/);
    const lines = await revenueLines(posted.entry.id);
    assert.deepEqual(lines, [
      { code: '11201001', debit: 70300, credit: 0 },
      { code: '11202001', debit: 5000, credit: 0 },
      { code: '21402001', debit: 10000, credit: 0 },
      { code: '11801001', debit: 2700, credit: 0 },
      { code: '41101001', debit: 0, credit: 88000 }
    ], 'revenue = gross less other deductions; WHT and retention on their own accounts');
    assert.equal(await ledgerRevenue(), 88000);
    await assert.rejects(Billing.post(bill.id, checker), /مرحل مسبقاً/);
    row = await db.get('SELECT * FROM bills WHERE id = ?', [bill.id]);
    assert.equal(row.status, 'posted'); assert.equal(Number(row.journal_entry_id), posted.entry.id); assert.equal(row.remaining_amount, 70300);
    assert.equal((await db.get('SELECT current_balance FROM clients WHERE id = ?', [clientId])).current_balance, 70300);
    assert.equal((await db.get("SELECT journal_entry_id FROM tax_withholdings WHERE source_doc_id = ? AND source_doc_type = 'bill'", [bill.id])).journal_entry_id, posted.entry.id);

    // 6. POC recognition no longer posts a second revenue
    await assert.rejects(Contracting.recognizeProjectRevenue({ projectId, periodDate: '2095-02-28', user: checker }), err => err.statusCode === 409 && /سياسة الإيراد/.test(err.message));
    assert.equal(await ledgerRevenue(), 88000, 'revenue recorded exactly once');

    // 7. WHT on an already posted bill: small entry Dr WHT / Cr AR, revenue untouched, bill entry untouched
    const bill2 = await Billing.create({ project_id: projectId, client_id: clientId, amount: 50000, date: '2095-03-01' }, admin);
    await Billing.approve(bill2.id, checker);
    const posted2 = await Billing.post(bill2.id, checker);
    const tax2 = await Tax.processBillTaxDeduction(bill2.id, 3.0, checker);
    assert.match(tax2.journal_entry_no, /^JV-TAX-2095-\d{4}$/);
    const taxEntry = await db.get('SELECT * FROM journal_entries WHERE entry_no = ?', [tax2.journal_entry_no]);
    assert.equal(taxEntry.total_debit, 1500);
    assert.deepEqual(await revenueLines(taxEntry.id), [{ code: '11801001', debit: 1500, credit: 0 }, { code: '11201001', debit: 0, credit: 1500 }]);
    assert.equal(Number((await db.get('SELECT journal_entry_id FROM bills WHERE id = ?', [bill2.id])).journal_entry_id), posted2.entry.id, 'the bill keeps its own entry');
    assert.equal(await ledgerRevenue(), 138000);
    assert.equal((await db.get('SELECT net_amount, remaining_amount FROM bills WHERE id = ?', [bill2.id])).remaining_amount, 48500);

    // 8. Reversing the bill also reverses its WHT entry; revenue and receivable net to zero for it
    await Control.reverseBill(bill2.id, { user: checker, reason: 'اختبار عكس المستخلص', reversal_date: '2095-03-05' });
    assert.equal(await ledgerRevenue(), 88000);
    const wht = await db.get("SELECT COALESCE(SUM(l.debit - l.credit), 0) AS n FROM journal_entry_lines l JOIN journal_entries je ON je.id = l.entry_id JOIN accounts a ON a.id = l.account_id WHERE je.status = 'posted' AND a.code = '11801001'");
    assert.equal(wht.n, 2700, 'only the first bill keeps its withholding tax');

    // 9. HTTP: creating with status 'معتمد' answers with a draft and requires approval
    server = require('../../server/server').listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const { JWT_SECRET } = require('../../server/middleware/security');
    const token = require('jsonwebtoken').sign({ id: admin.id, username: 'admin', role: 'admin' }, JWT_SECRET, { expiresIn: '3m' });
    const api = (route, body) => fetch(`http://127.0.0.1:${server.address().port}/api/billing${route}`, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then(async r => ({ status: r.status, body: await r.json() }));
    const created = await api('', { project_id: projectId, client_id: clientId, amount: 1000, status: 'معتمد', date: '2095-04-01' });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    assert.equal(created.body.status, 'draft'); assert.equal(created.body.requires_approval, true);
    const selfApprove = await api(`/${created.body.id}/approve`);
    assert.equal(selfApprove.status, 403); assert.equal(selfApprove.body.fourEyesViolation, true);
    const earlyPost = await api(`/${created.body.id}/post`);
    assert.equal(earlyPost.status, 400);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
  }
});
