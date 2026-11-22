// Stage 4.3: one ReversalService. Journal-screen reversals reverse the source document; wizard reversals happen once.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('reversal service: document entries, bill tax entries and payment-wizard transactions', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rawasi-reversal-'));
  Object.assign(process.env, { NODE_ENV: 'development', DB_ENGINE: 'sqlite', RAWASI_DB_PATH: path.join(temp, 'fixture.db'), RAWASI_UPLOAD_DIR: path.join(temp, 'uploads'), RAWASI_PROJECTS_DIR: path.join(temp, 'projects'), RAWASI_BACKUP_DIR: path.join(temp, 'backups'), RAWASI_SCRATCH_DIR: path.join(temp, 'scratch'), ENABLE_SCHEDULERS: 'false' });
  const fixture = spawnSync(process.execPath, ['tests/create_fixture.js'], { env: process.env, encoding: 'utf8', windowsHide: true });
  assert.equal(fixture.status, 0, fixture.stderr);
  const db = require('../../server/database/db');
  await db.ready;
  const SystemAccounts = require('../../server/services/systemAccountService');
  const Billing = require('../../server/services/billing/billingService');
  const Tax = require('../../server/services/taxAndGuaranteeService');
  const Accounting = require('../../server/services/accountingService');
  const Control = require('../../server/services/financialControlService');
  const Reversal = require('../../server/services/ledger/reversalService');
  const PaymentService = require('../../server/services/paymentService');
  const id = async code => (await db.get('SELECT id FROM accounts WHERE code = ?', [code]))?.id;
  const addAccount = async (code, name, type, parent) => {
    if (await id(code)) return id(code);
    const level = { 1: 1, 2: 2, 3: 3, 5: 4, 8: 5 }[code.length];
    return (await db.run('INSERT INTO accounts (code, name, type, parent_id, level, is_posting, status) VALUES (?, ?, ?, ?, ?, ?, ?)', [code, name, type, parent ? await id(parent) : null, level, level === 5 ? 1 : 0, 'active'])).lastInsertRowid;
  };
  await addAccount('112', 'الذمم', 'asset', '11'); await addAccount('11201', 'العملاء', 'asset', '112'); await addAccount('11201001', 'ذمم العملاء', 'asset', '11201');
  await addAccount('118', 'الضرائب', 'asset', '11'); await addAccount('11801', 'الضرائب', 'asset', '118'); await addAccount('11801001', 'ضريبة مخصومة', 'asset', '11801');
  await SystemAccounts.setMapping('ACCOUNTS_RECEIVABLE', await id('11201001'));
  await SystemAccounts.setMapping('WHT_RECEIVABLE', await id('11801001'));
  const cash = await id('11101001'); const bank = await id('11102001'); const ar = await id('11201001');
  const admin = { id: (await db.get("SELECT id FROM users WHERE username = 'admin'")).id, username: 'admin' };
  const checker = { id: (await db.run("INSERT INTO users (username, password_hash, full_name, role, status, two_factor_enabled) VALUES ('rev-checker', 'x', 'Checker', 'admin', 'active', 0)")).lastInsertRowid, username: 'rev-checker' };
  const clientId = (await db.run("INSERT INTO clients (name) VALUES ('عميل العكس')")).lastInsertRowid;
  const projectId = (await db.run("INSERT INTO projects (name, code, client_id, status) VALUES ('مشروع العكس', 'PRJ-REV', ?, 'active')", [clientId])).lastInsertRowid;
  const net = async accountId => Number((await db.get("SELECT COALESCE(SUM(l.debit - l.credit), 0) AS n FROM journal_entry_lines l JOIN journal_entries je ON je.id = l.entry_id WHERE je.status = 'posted' AND l.account_id = ?", [accountId])).n);

  // A posted bill and a collection voucher against it
  const bill = await Billing.create({ project_id: projectId, client_id: clientId, amount: 3000, date: '2097-06-01' }, admin);
  await Billing.approve(bill.id, checker); await Billing.post(bill.id, checker);
  const payId = (await db.run(`INSERT INTO payments (payment_no, receipt_no, type, client_id, project_id, bill_id, account_id, settlement_account_id, amount, local_amount, payment_method, date, status, receipt_category)
    VALUES ('RC-T-1', 'RC-T-1', 'قبض', ?, ?, ?, ?, ?, 1200, 1200, 'نقدي', '2097-06-02', 'posted', 'bill_collection')`, [clientId, projectId, bill.id, ar, cash])).lastInsertRowid;
  const je = await Accounting.createVoucherJournalEntry({ sourceTable: 'payments', voucherType: 'سند قبض', voucherId: payId, receiptNo: 'RC-T-1', date: '2097-06-02', amount: 1200, accountId: ar, settlementAccountId: cash, user: admin });
  await db.transaction(tx => require('../../server/services/clientChainService').applyPaymentToBill(bill.id, 1200, tx));
  assert.equal((await db.get('SELECT paid_amount FROM bills WHERE id = ?', [bill.id])).paid_amount, 1200);

  // 1. Reversing the receipt's entry from the journal screen reverses the receipt itself (document and ledger agree)
  const viaJournal = await Control.reverseJournalEntry(je.id, { user: checker, reason: 'خطأ في التحصيل', reversal_date: '2097-06-03' });
  assert.deepEqual(viaJournal.reversed_document, { kind: 'payment', id: Number(payId) });
  assert.equal((await db.get('SELECT status FROM payments WHERE id = ?', [payId])).status, 'reversed');
  const billAfter = await db.get('SELECT paid_amount, remaining_amount FROM bills WHERE id = ?', [bill.id]);
  assert.equal(billAfter.paid_amount, 0); assert.equal(billAfter.remaining_amount, 3000);
  assert.equal(await net(ar), 3000, 'receivable back to the full bill');
  await assert.rejects(Control.reverseJournalEntry(je.id, { user: checker, reason: 'مرة ثانية', reversal_date: '2097-06-03' }), /(عكسه|معكوس) مسبقاً/);

  // 2. A bill's separate WHT entry is reversed only with the bill
  await Tax.processBillTaxDeduction(bill.id, 3, checker);
  const taxEntry = await db.get("SELECT id FROM journal_entries WHERE reference_type = 'ضريبة مستخلص' AND reference_id = ?", [bill.id]);
  await assert.rejects(Control.reverseJournalEntry(taxEntry.id, { user: checker, reason: 'عكس الضريبة', reversal_date: '2097-06-04' }), /مع المستخلص/);
  // ... and reversing the bill's main entry from the journal screen reverses the bill and its tax entry
  const billEntryId = (await db.get('SELECT journal_entry_id FROM bills WHERE id = ?', [bill.id])).journal_entry_id;
  const billRev = await Control.reverseJournalEntry(billEntryId, { user: checker, reason: 'إلغاء المستخلص', reversal_date: '2097-06-04' });
  assert.equal(billRev.reversed_document.kind, 'bill');
  assert.equal((await db.get('SELECT status FROM bills WHERE id = ?', [bill.id])).status, 'reversed');
  assert.equal(await net(ar), 0); assert.equal(await net(await id('11801001')), 0);

  // 3. Payment wizard: a bounce mirrors the entry once; a later reverse is refused; no reason, no reversal
  // The wizard tables exist in production but only come from migration_payment_layers.sql, which boot does not run.
  if (!await db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'payment_transactions'")) {
    const { DatabaseSync } = require('node:sqlite');
    const raw = new DatabaseSync(process.env.RAWASI_DB_PATH);
    raw.exec(fs.readFileSync(path.join(__dirname, '../../server/database/migration_payment_layers.sql'), 'utf8'));
    raw.close();
  }
  const wizardJe = await Accounting.createJournalEntry({ date: '2097-06-05', description: 'wizard', reference_type: 'سند قبض خماسي' }, [{ account_id: bank, debit: 700 }, { account_id: cash, credit: 700 }]);
  // reference data of the wizard (contexts, instruments, channels) is irrelevant to the reversal rules
  const { DatabaseSync: RawDb } = require('node:sqlite');
  const rawConn = new RawDb(process.env.RAWASI_DB_PATH, { enableForeignKeyConstraints: false });
  const txId = Number(rawConn.prepare(`INSERT INTO payment_transactions (transaction_no, transaction_date, direction, context_code, instrument_code, channel_id, debit_account_id, credit_account_id, amount, local_amount, net_amount, status, journal_entry_id)
    VALUES ('TRX-T-1', '2097-06-05', 'IN', 'GENERAL', 'CASH', 1, ?, ?, 700, 700, 700, 'posted', ?)`).run(bank, cash, wizardJe.id).lastInsertRowid);
  rawConn.close();
  await assert.rejects(Reversal.reversePaymentTransaction(txId, { user: checker, reason: '' }), /سبب/);
  const bounced = await PaymentService.bounceTransaction(txId, 'شيك مرتجع من البنك', checker);
  assert.match(bounced.reversing_entry_no, /^REV-\d{4}-\d{4}$/);
  await assert.rejects(PaymentService.reverseTransaction(txId, 'عكس بعد الارتجاع', checker), /معكوسة أو مرتجعة مسبقاً/);
  assert.equal(await net(bank), 0, 'the wizard entry is reversed exactly once');
  const reversalsOfWizard = await db.get("SELECT COUNT(*) AS n FROM journal_entries WHERE reference_no = ? AND entry_no LIKE 'REV-%'", [wizardJe.entry_no]);
  assert.equal(reversalsOfWizard.n, 1);
});
