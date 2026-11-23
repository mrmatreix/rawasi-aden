const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { openPeriodCondition } = require('../server/services/operationVisibility');
// The pending-cash projection service this file also tested was never wired to the app: the cash screen reads
// posted ledger lines only (cashAccountActivity, covered by reporting_pending_ledger.test.js). It was removed.

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
