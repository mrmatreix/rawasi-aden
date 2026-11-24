const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { reportingSql } = require('../server/services/reportingLedger');
const { getCashAccountActivity } = require('../server/services/cashAccountActivity');

test('financial balances include pending vouchers and journals once and remain stable after posting', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`
      CREATE TABLE accounts (id INTEGER, code TEXT, name TEXT);
      INSERT INTO accounts VALUES (10, '11101001', 'صندوق'), (20, '51001', 'مصروف'), (30, '41001', 'إيراد');
      CREATE TABLE accounting_periods (start_date TEXT, end_date TEXT, status TEXT);
      CREATE TABLE journal_entries (id INTEGER, entry_no TEXT, date TEXT, description TEXT, status TEXT,
        reference_type TEXT, reference_id INTEGER, total_debit REAL, total_credit REAL);
      CREATE TABLE journal_entry_lines (id INTEGER, entry_id INTEGER, account_id INTEGER,
        cost_center_id INTEGER, project_id INTEGER, debit REAL, credit REAL, notes TEXT);
      CREATE TABLE expenses (id INTEGER, receipt_no TEXT, date TEXT, notes TEXT, status TEXT,
        account_id INTEGER, settlement_account_id INTEGER, cost_center_id INTEGER, project_id INTEGER,
        local_amount REAL, amount REAL, exchange_rate REAL);
      CREATE TABLE payments (id INTEGER, receipt_no TEXT, date TEXT, notes TEXT, status TEXT, type TEXT,
        account_id INTEGER, settlement_account_id INTEGER, cost_center_id INTEGER, project_id INTEGER,
        local_amount REAL, amount REAL, exchange_rate REAL);
      INSERT INTO expenses VALUES (1, 'EP-1', '2026-10-19', 'صرف', 'draft', 20, 10, 1, 1, 50, 50, 1);
      INSERT INTO payments VALUES (1, 'RC-1', '2026-10-19', 'قبض', 'approved', 'قبض', 30, 10, 2, 1, 120, 120, 1);
      INSERT INTO journal_entries VALUES (1, 'JV-1', '2026-10-19', 'قيد', 'draft', 'يدوي', NULL, 10, 10);
      INSERT INTO journal_entry_lines VALUES (1, 1, 20, 1, 1, 10, 0, ''), (2, 1, 10, 1, 1, 0, 10, '');
      ALTER TABLE expenses ADD COLUMN payment_method TEXT DEFAULT 'نقدي';
      ALTER TABLE payments ADD COLUMN payment_method TEXT DEFAULT 'نقدي';
    `);
    const sql = reportingSql(`SELECT jel.account_id, SUM(jel.debit) AS debit, SUM(jel.credit) AS credit
      FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.entry_id
      WHERE je.status = 'posted' GROUP BY jel.account_id ORDER BY jel.account_id`);
    const before = db.prepare(sql).all();
    const queryDb = { query: async sql => db.prepare(reportingSql(sql)).all() };
    const cashBefore = await getCashAccountActivity(queryDb, { all: 'true' });
    assert.equal(cashBefore.data.length, 3);
    assert.equal(cashBefore.summary.current_balance, 60);
    assert.equal(cashBefore.summary.pending_count, 3);
    assert.equal((await getCashAccountActivity(queryDb, { type: 'بنك' })).data.length, 0);
    assert.equal(before.find(row => row.account_id === 10).debit - before.find(row => row.account_id === 10).credit, 60);
    assert.equal(before.find(row => row.account_id === 20).debit, 60);
    assert.equal(before.reduce((sum, row) => sum + row.debit - row.credit, 0), 0);
    db.exec(`
      INSERT INTO journal_entries VALUES (2, 'JV-EP-1', '2026-10-19', 'صرف', 'posted', 'سند صرف', 1, 50, 50),
        (3, 'JV-RC-1', '2026-10-19', 'قبض', 'posted', 'سند قبض', 1, 120, 120);
      INSERT INTO journal_entry_lines VALUES (3, 2, 20, 1, 1, 50, 0, ''), (4, 2, 10, 1, 1, 0, 50, ''),
        (5, 3, 10, 2, 1, 120, 0, ''), (6, 3, 30, 2, 1, 0, 120, '');
      UPDATE journal_entries SET status = 'posted' WHERE id = 1;
    `);
    assert.deepEqual(db.prepare(sql).all(), before, 'existing voucher journals suppress synthetic copies even during transition');
    db.exec("UPDATE expenses SET status = 'posted'; UPDATE payments SET status = 'posted'");
    assert.deepEqual(db.prepare(sql).all(), before);
    const cashAfter = await getCashAccountActivity(queryDb, { all: 'true' });
    assert.equal(cashAfter.data.length, 3);
    assert.equal(cashAfter.summary.current_balance, cashBefore.summary.current_balance);
    assert.equal(cashAfter.summary.pending_count, 0);
    assert.ok(cashAfter.data.every(row => row.is_posted));
    db.exec("INSERT INTO accounting_periods VALUES ('2026-10-19', '2026-10-19', 'closed')");
    const closed = await getCashAccountActivity(queryDb, { all: 'true' });
    assert.equal(closed.data.length, 0);
    assert.equal(closed.summary.current_balance, 60);
    db.exec("UPDATE journal_entries SET status = 'cancelled' WHERE id = 1");
    assert.equal(db.prepare(sql).all().find(row => row.account_id === 20).debit, 50);
    db.exec("UPDATE accounting_periods SET status = 'open'; UPDATE accounts SET code = '11102001', name = 'بنك' WHERE id = 20");
    const bankSide = await getCashAccountActivity(queryDb, { type: 'بنك', all: 'true' });
    assert.equal(bankSide.data.length, 1);
    assert.equal(bankSide.data[0].account_role, 'counterpart');
    assert.equal(bankSide.data[0].payment_method, 'نقدي');
    assert.equal(bankSide.data[0].reference_no, 'EP-1');
    const cashSide = await getCashAccountActivity(queryDb, { type: 'نقدي', all: 'true' });
    const settlement = cashSide.data.find(row => row.reference_no === 'EP-1');
    assert.equal(settlement.account_role, 'settlement');
    assert.equal(settlement.cash_out, 50);
  } finally { db.close(); }
});
