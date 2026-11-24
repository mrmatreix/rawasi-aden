// Stage 1 ledger safety: database guards, reversal rules, voucher linkage, report default, signed webhooks.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

test('ledger guards, storno reversals, voucher linkage, posted-only reports and signed webhooks', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rawasi-ledger-integrity-'));
  Object.assign(process.env, { NODE_ENV: 'development', DB_ENGINE: 'sqlite', RAWASI_DB_PATH: path.join(temp, 'fixture.db'), RAWASI_UPLOAD_DIR: path.join(temp, 'uploads'), RAWASI_PROJECTS_DIR: path.join(temp, 'projects'), RAWASI_BACKUP_DIR: path.join(temp, 'backups'), RAWASI_SCRATCH_DIR: path.join(temp, 'scratch'), ENABLE_SCHEDULERS: 'false' });
  delete process.env.PAYMENT_WEBHOOK_SECRET; delete process.env.PAYMENT_WEBHOOK_SECRET_TESTPAY;
  const fixture = spawnSync(process.execPath, ['tests/create_fixture.js'], { env: process.env, encoding: 'utf8', windowsHide: true });
  assert.equal(fixture.status, 0, fixture.stderr);
  const db = require('../../server/database/db');
  let server;
  try {
    await db.ready;
    const Accounting = require('../../server/services/accountingService');
    const Control = require('../../server/services/financialControlService');
    const { parseFilters } = require('../../server/services/reportFilterService');
    const id = async code => (await db.get('SELECT id FROM accounts WHERE code = ?', [code])).id;
    const cash = await id('11101001'); const bank = await id('11102001'); const expense = await id('32102001'); const revenue = await id('41101001');
    const center = (await db.get("SELECT id FROM cost_centers WHERE code = 'CC-TEST'")).id;
    const user = { id: (await db.get("SELECT id FROM users WHERE username = 'admin'")).id, username: 'admin' };
    const header = (no, total, status = 'posted', date = '2098-03-01') => db.transaction(async tx => {
      const r = await tx.run('INSERT INTO journal_entries (entry_no, date, description, total_debit, total_credit, status) VALUES (?, ?, ?, ?, ?, ?)', [no, date, 'guard test', total, total, status]);
      return Number(r.lastInsertRowid);
    });

    // 1. A posted entry whose lines do not balance (or has no lines) never commits
    await assert.rejects(db.transaction(async tx => {
      const r = await tx.run("INSERT INTO journal_entries (entry_no, date, description, total_debit, total_credit, status) VALUES ('LG-UNBAL', '2098-03-01', 'x', 100, 100, 'posted')");
      await tx.run('INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit) VALUES (?, ?, 100, 0)', [r.lastInsertRowid, cash]);
      await tx.run('INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit) VALUES (?, ?, 0, 1)', [r.lastInsertRowid, revenue]);
    }), /غير متزن/);
    await assert.rejects(header('LG-EMPTY', 200), /غير متزن/);
    assert.equal(await db.get("SELECT id FROM journal_entries WHERE entry_no IN ('LG-UNBAL', 'LG-EMPTY')"), null, 'rejected entries rolled back');

    // 2. Posting from draft requires balanced lines that match the header
    const draftId = await header('LG-DRAFT', 50, 'draft');
    await db.run('INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit) VALUES (?, ?, 50, 0)', [draftId, cash]);
    await assert.rejects(db.run("UPDATE journal_entries SET status = 'posted' WHERE id = ?", [draftId]), /غير متزنة/);
    await db.run('INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit) VALUES (?, ?, 0, 50)', [draftId, bank]);
    await db.run("UPDATE journal_entries SET status = 'posted' WHERE id = ?", [draftId]);

    // 3. Posted entries are immutable: no line edits, deletes, header edits or return to draft
    await assert.rejects(db.run('UPDATE journal_entry_lines SET debit = 60 WHERE entry_id = ? AND debit > 0', [draftId]), /لا يمكن تعديل سطور/);
    await assert.rejects(db.run('DELETE FROM journal_entry_lines WHERE entry_id = ?', [draftId]), /لا يمكن حذف سطور/);
    await assert.rejects(db.run('DELETE FROM journal_entries WHERE id = ?', [draftId]), /لا يمكن حذف قيد/);
    await assert.rejects(db.run("UPDATE journal_entries SET date = '2098-03-02' WHERE id = ?", [draftId]), /لا يمكن تعديل قيد/);
    await assert.rejects(db.run("UPDATE journal_entries SET status = 'draft' WHERE id = ?", [draftId]), /لا يمكن تعديل قيد/);

    // 4. No postings to non-posting (summary) accounts, even if they have no children
    const summary = await db.run("INSERT INTO accounts (code, name, type, level, is_posting, status) VALUES ('99999999', 'summary leaf', 'asset', 5, 0, 'active')");
    await assert.rejects(db.run('INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit) VALUES (?, ?, 1, 0)', [draftId, summary.lastInsertRowid]), /غير قابل للترحيل/);

    // 5. Closed periods are enforced by the database itself
    await db.run("INSERT INTO accounting_periods (period_name, fiscal_year, start_date, end_date, status) VALUES ('LG closed', 2097, '2097-01-01', '2097-01-31', 'closed')");
    await assert.rejects(header('LG-CLOSED', 10, 'posted', '2097-01-15'), /فترة محاسبية مغلقة/);

    // 6. Reversal: drafts are refused; posted entries are mirrored and net to zero; no double reversal
    const draft = await Accounting.createJournalEntry({ date: '2098-04-01', description: 'draft only', status: 'draft' },
      [{ account_id: expense, debit: 500, cost_center_id: center }, { account_id: cash, credit: 500 }]);
    await assert.rejects(Control.reverseJournalEntry(draft.id, { user, reason: 'test reversal' }), /لم يُرحّل/);
    const posted = await Accounting.createJournalEntry({ date: '2098-04-02', description: 'posted entry' },
      [{ account_id: expense, debit: 700, cost_center_id: center }, { account_id: cash, credit: 700, cost_center_id: center }]);
    const reversal = await Control.reverseJournalEntry(posted.id, { user, reason: 'test reversal', reversal_date: '2098-04-03' });
    const original = await db.get('SELECT status, reversal_ref_id FROM journal_entries WHERE id = ?', [posted.id]);
    assert.equal(original.status, 'posted', 'the original stays in the ledger');
    assert.equal(Number(original.reversal_ref_id), Number(reversal.reversing_je_id));
    const net = await db.get("SELECT SUM(l.debit - l.credit) AS net FROM journal_entry_lines l JOIN journal_entries je ON je.id = l.entry_id WHERE je.status = 'posted' AND je.id IN (?, ?) AND l.account_id = ?", [posted.id, reversal.reversing_je_id, expense]);
    assert.equal(Number(net.net), 0, 'original + reversal net to zero in posted-only reports');
    await assert.rejects(Control.reverseJournalEntry(posted.id, { user, reason: 'again please' }), /معكوس مسبقاً/);

    // 7. A "posted" receipt that never reached the ledger cannot be reversed into a phantom entry
    const orphan = await db.run("INSERT INTO payments (receipt_no, type, amount, local_amount, date, status, account_id) VALUES ('LG-ORPHAN', 'قبض', 1000, 1000, '2098-04-05', 'posted', ?)", [revenue]);
    const before = (await db.get('SELECT COUNT(*) AS n FROM journal_entries')).n;
    await assert.rejects(Control.reversePayment(orphan.lastInsertRowid, { user, reason: 'test reversal' }), /لا يوجد له قيد مرحّل/);
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM journal_entries')).n, before);
    assert.equal((await db.get('SELECT status FROM payments WHERE id = ?', [orphan.lastInsertRowid])).status, 'posted');

    // 8. Payment vouchers and expenses with the same id each get their own journal entry
    await db.run("INSERT INTO expenses (id, receipt_no, expense_type, amount, date, status) VALUES (900, 'LG-EXP-900', 'اختبار', 300, '2098-05-01', 'posted')");
    await db.run("INSERT INTO payments (id, receipt_no, type, amount, local_amount, date, status) VALUES (900, 'LG-PV-900', 'صرف', 400, 400, '2098-05-01', 'posted')");
    const expenseJe = await Accounting.createVoucherJournalEntry({ voucherType: 'سند صرف', voucherId: 900, receiptNo: 'LG-EXP-900', date: '2098-05-01', amount: 300, accountId: expense, costCenterId: center, settlementAccountId: cash, sourceTable: 'expenses' });
    const paymentJe = await Accounting.createVoucherJournalEntry({ voucherType: 'سند صرف', voucherId: 900, receiptNo: 'LG-PV-900', date: '2098-05-01', amount: 400, accountId: expense, costCenterId: center, settlementAccountId: cash, sourceTable: 'payments' });
    assert.notEqual(paymentJe.id, expenseJe.id, 'the payment voucher is not mistaken for the expense');
    assert.equal(paymentJe.already_existed, undefined);
    assert.equal(Number((await db.get('SELECT journal_entry_id FROM expenses WHERE id = 900')).journal_entry_id), Number(expenseJe.id));
    assert.equal(Number((await db.get('SELECT journal_entry_id FROM payments WHERE id = 900')).journal_entry_id), Number(paymentJe.id));
    const again = await Accounting.createVoucherJournalEntry({ voucherType: 'سند صرف', voucherId: 900, receiptNo: 'LG-PV-900', date: '2098-05-01', amount: 400, accountId: expense, costCenterId: center, settlementAccountId: cash, sourceTable: 'payments' });
    assert.equal(again.already_existed, true);
    const reversedPayment = await Control.reversePayment(900, { user, reason: 'test reversal', reversal_date: '2098-05-02' });
    const mirrored = await db.query('SELECT account_id, debit, credit FROM journal_entry_lines WHERE entry_id = ? ORDER BY id', [reversedPayment.reversing_je_id]);
    assert.deepEqual(mirrored.map(l => [Number(l.account_id), Number(l.debit), Number(l.credit)]), [[expense, 0, 400], [cash, 400, 0]]);

    // 9. Financial statements default to posted entries only
    assert.equal(parseFilters({}).posting_status, 'posted');

    // 10. Webhooks: disabled without a secret, rejected when unsigned, and can never fail a posted voucher
    server = require('../../server/server').listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const hook = (body, headers = {}) => fetch(`http://127.0.0.1:${server.address().port}/api/payments/webhook/testpay`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body }).then(async r => ({ status: r.status, body: await r.json() }));
    const failedBody = JSON.stringify({ payment_id: 900, status: 'failed' });
    assert.equal((await hook(failedBody)).status, 503);
    process.env.PAYMENT_WEBHOOK_SECRET_TESTPAY = crypto.randomBytes(32).toString('hex');
    assert.equal((await hook(failedBody)).status, 401);
    assert.equal((await hook(failedBody, { 'X-Webhook-Signature': 'sha256=' + '0'.repeat(64) })).status, 401);
    const sign = body => crypto.createHmac('sha256', process.env.PAYMENT_WEBHOOK_SECRET_TESTPAY).update(body).digest('hex');
    const signed = await hook(failedBody, { 'X-Webhook-Signature': 'sha256=' + sign(failedBody) });
    assert.equal(signed.status, 200, JSON.stringify(signed.body));
    assert.equal(signed.body.action, 'IGNORED');
    assert.equal((await db.get('SELECT status FROM payments WHERE id = 900')).status, 'reversed', 'webhook did not touch a non-pending voucher');
    const t = Math.floor(Date.now() / 1000);
    const stripe = await hook(failedBody, { 'Stripe-Signature': `t=${t},v1=${sign(`${t}.${failedBody}`)}` });
    assert.equal(stripe.status, 200);
    const stale = await hook(failedBody, { 'Stripe-Signature': `t=${t - 3600},v1=${sign(`${t - 3600}.${failedBody}`)}` });
    assert.equal(stale.status, 401, 'old stripe signatures are refused');
  } finally {
    delete process.env.PAYMENT_WEBHOOK_SECRET_TESTPAY;
    if (server) await new Promise(resolve => server.close(resolve));
    await db.closeDatabase();
    assert.equal(path.dirname(temp), os.tmpdir());
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
