const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { getPendingCashMovements } = require('../server/services/pendingCashMovementService');
const { openPeriodCondition } = require('../server/services/operationVisibility');

test('operational visibility hides closed date boundaries for every status and preserves archive access', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`
      CREATE TABLE accounting_periods (start_date TEXT, end_date TEXT, status TEXT);
      INSERT INTO accounting_periods VALUES ('2026-10-01', '2026-10-19', 'closed');
      CREATE TABLE operations (date TEXT, status TEXT);
      INSERT INTO operations VALUES ('2026-10-01', 'draft'), ('2026-10-19', 'posted'),
        ('2026-10-10', 'approved'), ('2026-09-30', 'posted'), ('2026-10-20', 'draft');
    `);
    for (const alias of ['e', 'p', 'je', 'cm']) {
      const visible = db.prepare(`SELECT * FROM operations ${alias} WHERE ${openPeriodCondition(`${alias}.date`)}`).all();
      assert.equal(visible.length, 2);
      const archived = db.prepare(`SELECT * FROM operations ${alias} WHERE ${openPeriodCondition(`${alias}.date`, 'true')}`).all();
      assert.equal(archived.length, 5);
    }
    assert.equal(db.prepare(`SELECT * FROM operations WHERE ${openPeriodCondition('date')}`).all().length, 2);
    db.exec("UPDATE accounting_periods SET status = 'open'");
    assert.equal(db.prepare(`SELECT * FROM operations WHERE ${openPeriodCondition('date')}`).all().length, 5);
  } finally {
    db.close();
  }
});

test('cash screen projects pending vouchers and journal lines without posting or duplicates', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec(`
      CREATE TABLE accounting_periods (start_date TEXT, end_date TEXT, status TEXT);
      CREATE TABLE accounts (id INTEGER, code TEXT, name TEXT);
      INSERT INTO accounts VALUES (1, '11101001', 'صندوق'), (2, '11102001', 'بنك'), (3, '51001', 'مصروف');
      CREATE TABLE expenses (id INTEGER, receipt_no TEXT, date TEXT, status TEXT, notes TEXT,
        settlement_account_id INTEGER, amount REAL, local_amount REAL, exchange_rate REAL);
      INSERT INTO expenses VALUES (1, 'EP-1', '2026-10-19', 'draft', 'صرف', 1, 10, 0, 2);
      CREATE TABLE payments (id INTEGER, receipt_no TEXT, date TEXT, status TEXT, notes TEXT,
        settlement_account_id INTEGER, amount REAL, local_amount REAL, exchange_rate REAL, type TEXT);
      INSERT INTO payments VALUES (2, 'RC-2', '2026-10-19', 'approved', 'قبض', 2, 30, 30, 1, 'قبض');
      CREATE TABLE journal_entries (id INTEGER, entry_no TEXT, date TEXT, status TEXT,
        description TEXT, reference_type TEXT, reference_id INTEGER);
      INSERT INTO journal_entries VALUES (3, 'JV-3', '2026-10-19', 'under_review', 'تحويل', 'يدوي', NULL),
        (4, 'JV-4', '2026-10-19', 'draft', 'قيد سند', 'سند قبض', 2),
        (5, 'JV-5', '2026-10-19', 'cancelled', 'ملغي', 'يدوي', NULL);
      CREATE TABLE journal_entry_lines (entry_id INTEGER, account_id INTEGER, debit REAL, credit REAL);
      INSERT INTO journal_entry_lines VALUES (3, 1, 40, 0), (3, 2, 0, 40), (3, 3, 8, 0),
        (4, 2, 30, 0), (5, 1, 100, 0);
    `);
    const db = { query: async sql => sqlite.prepare(sql).all() };
    const rows = await getPendingCashMovements(db);
    assert.equal(rows.length, 4);
    assert.equal(rows.find(r => r.source_type === 'expense').cash_out, 20);
    assert.equal(rows.find(r => r.source_type === 'payment').cash_in, 30);
    assert.ok(rows.every(r => r.is_posted === false && r.current_balance === null));
    assert.equal((await getPendingCashMovements(db, { type: 'بنك' })).length, 2);
    assert.equal((await getPendingCashMovements(db, { type: 'نقدي' })).length, 2);
    assert.equal((await getPendingCashMovements(db, { from_date: '2026-10-20' })).length, 0);
    assert.equal((await getPendingCashMovements(db, { to_date: '2026-10-18' })).length, 0);
    sqlite.exec("INSERT INTO accounting_periods VALUES ('2026-10-19', '2026-10-19', 'closed');");
    assert.equal((await getPendingCashMovements(db)).length, 0);
    assert.equal((await getPendingCashMovements(db, { include_closed: 'true' })).length, 4);
    sqlite.exec("UPDATE accounting_periods SET status = 'open';");
    assert.equal((await getPendingCashMovements(db)).length, 4);
    sqlite.exec("UPDATE expenses SET status = 'posted'; UPDATE payments SET status = 'posted'; UPDATE journal_entries SET status = 'posted' WHERE id = 3;");
    assert.equal((await getPendingCashMovements(db)).length, 0);
  } finally {
    sqlite.close();
  }
});
