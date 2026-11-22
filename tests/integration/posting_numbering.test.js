// Stage 3: unified PostingService and document numbering.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Money = require('../../server/services/ledger/money');

test('money is handled in whole fils with one rounding', () => {
  assert.equal(Money.toFils(0.1) + Money.toFils(0.2), Money.toFils(0.3));
  assert.equal(Money.toFils(1.005), 101);
  assert.equal(Money.toFils('2500.10'), 250010);
  assert.equal(Money.toFils(-3.335), -334);
  assert.equal(Money.round2(100.004), 100);
});

test('posting service and numbering: unique per series and year, inside the transaction, no COUNT+1 collisions', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rawasi-posting-'));
  Object.assign(process.env, { NODE_ENV: 'development', DB_ENGINE: 'sqlite', RAWASI_DB_PATH: path.join(temp, 'fixture.db'), RAWASI_UPLOAD_DIR: path.join(temp, 'uploads'), RAWASI_PROJECTS_DIR: path.join(temp, 'projects'), RAWASI_BACKUP_DIR: path.join(temp, 'backups'), RAWASI_SCRATCH_DIR: path.join(temp, 'scratch'), ENABLE_SCHEDULERS: 'false' });
  const fixture = spawnSync(process.execPath, ['tests/create_fixture.js'], { env: process.env, encoding: 'utf8', windowsHide: true });
  assert.equal(fixture.status, 0, fixture.stderr);
  const db = require('../../server/database/db');
  await db.ready;
  const Numbering = require('../../server/services/numberingService');
  const Posting = require('../../server/services/ledger/postingService');
  const Accounting = require('../../server/services/accountingService');
  const id = async code => (await db.get('SELECT id FROM accounts WHERE code = ?', [code])).id;
  const cash = await id('11101001'); const bank = await id('11102001'); const expense = await id('32102001'); const revenue = await id('41101001');
  const center = (await db.get("SELECT id FROM cost_centers WHERE code = 'CC-TEST'")).id;
  const groupAccount = await id('111');
  const draft = (no, date) => db.run("INSERT INTO journal_entries (entry_no, date, description, total_debit, total_credit, status) VALUES (?, ?, 'legacy', 1, 1, 'draft')", [no, date]);

  // 1. A new series/year continues after the highest number already in the table
  await draft('JV-2091-0007', '2091-05-01');
  assert.equal(await db.transaction(tx => Numbering.nextJournalNumber(tx, { date: '2091-06-01' })), 'JV-2091-0008');
  // 2. A number written by a legacy path is skipped, never reused
  await draft('JV-2091-0009', '2091-05-02');
  assert.equal(await db.transaction(tx => Numbering.nextJournalNumber(tx, { date: '2091-06-01' })), 'JV-2091-0010');
  // 3. The year comes from the document date, and each year restarts at 1
  assert.equal(await db.transaction(tx => Numbering.nextJournalNumber(tx, { date: '2090-12-31' })), 'JV-2090-0001');
  // 4. A rolled-back posting gives its number back
  await assert.rejects(db.transaction(async tx => { await Numbering.nextJournalNumber(tx, { date: '2091-06-01' }); throw new Error('rollback'); }), /rollback/);
  assert.equal(await db.transaction(tx => Numbering.nextJournalNumber(tx, { date: '2091-06-01' })), 'JV-2091-0011');
  // 5. Series without a year keep their legacy format
  assert.match(await db.transaction(tx => Numbering.nextJournalNumber(tx, { series: 'JE', date: '2091-01-01' })), /^JE-\d{5}$/);
  await assert.rejects(db.transaction(tx => Numbering.nextJournalNumber(tx, { date: 'not a date' })), /تاريخ المستند غير صالح/);

  // R6: the old COUNT(*)+1 scheme produced a number that already existed; the service never does
  const count = (await db.get('SELECT COUNT(*) AS n FROM journal_entries')).n;
  await draft(`JV-2092-${String(count + 1).padStart(4, '0')}`, '2092-01-01');
  const issued = await db.transaction(tx => Numbering.nextJournalNumber(tx, { date: '2092-02-01' }));
  assert.notEqual(issued, `JV-2092-${String(count + 1).padStart(4, '0')}`);
  assert.equal(await db.get('SELECT id FROM journal_entries WHERE entry_no = ?', [issued]), null);

  // 6. PostingService: role lines, exact fils balance, cost centres, idempotent source
  const posted = await db.transaction(tx => Posting.post(tx, {
    date: '2091-07-01', description: 'posting service test', source: { type: 'اختبار', id: 1, no: 'T-1' }, dedupe: true,
    lines: [{ role: 'CASH_DEFAULT', debit: 0.1 }, { role: 'CASH_DEFAULT', debit: 0.2 }, { accountId: revenue, credit: 0.3, costCenterId: center }]
  }));
  assert.match(posted.entry_no, /^JV-2091-\d{4}$/);
  assert.deepEqual((await db.query('SELECT debit, credit FROM journal_entry_lines WHERE entry_id = ? ORDER BY id', [posted.id])).map(l => [l.debit, l.credit]), [[0.1, 0], [0.2, 0], [0, 0.3]]);
  const again = await db.transaction(tx => Posting.post(tx, {
    date: '2091-07-01', description: 'posting service test', source: { type: 'اختبار', id: 1, no: 'T-1' }, dedupe: true,
    lines: [{ role: 'CASH_DEFAULT', debit: 5 }, { accountId: revenue, credit: 5, costCenterId: center }]
  }));
  assert.equal(again.already_existed, true);
  assert.equal(again.id, posted.id);
  await assert.rejects(db.transaction(tx => Posting.post(tx, { date: '2091-07-01', description: 'x',
    lines: [{ accountId: cash, debit: 100.01 }, { accountId: revenue, credit: 100, costCenterId: center }] })), /غير متزن/);
  await assert.rejects(db.transaction(tx => Posting.post(tx, { date: '2091-07-01', description: 'x',
    lines: [{ accountId: groupAccount, debit: 1 }, { accountId: revenue, credit: 1, costCenterId: center }] })), /الحساب الفرعي الأخير/);
  await assert.rejects(db.transaction(tx => Posting.post(tx, { date: '2091-07-01', description: 'x', lines: [{ accountId: cash, debit: 1 }] })), /سطرين/);
  const movements = await db.get('SELECT COUNT(*) AS n FROM cash_movements WHERE reference_no = ?', [posted.entry_no]);
  assert.equal(movements.n, 1, 'posted cash lines are synced to the cash book');

  // 7. createJournalEntry is a thin wrapper: number from the entry date, voucher series kept
  const manual = await Accounting.createJournalEntry({ date: '2093-03-03', description: 'wrapper' },
    [{ account_id: expense, debit: 40, cost_center_id: center }, { account_id: bank, credit: 40 }]);
  assert.match(manual.entry_no, /^JV-2093-\d{4}$/);
  const receipt = await Accounting.createJournalEntry({ date: '2093-03-04', description: 'receipt', reference_type: 'سند قبض' },
    [{ account_id: cash, debit: 15 }, { account_id: revenue, credit: 15, cost_center_id: center }]);
  assert.match(receipt.entry_no, /^JV-RC-2093-\d{4}$/);

  // 8. Concurrent postings never share a number
  const many = await Promise.all(Array.from({ length: 15 }, (_, i) => Accounting.createJournalEntry({ date: '2094-01-01', description: 'burst ' + i },
    [{ account_id: cash, debit: 1 + i }, { account_id: revenue, credit: 1 + i, cost_center_id: center }])));
  const numbers = many.map(r => r.entry_no);
  assert.equal(new Set(numbers).size, numbers.length);
  assert.deepEqual([...numbers].sort(), Array.from({ length: 15 }, (_, i) => `JV-2094-${String(i + 1).padStart(4, '0')}`));

  // 9. Reversals use the REV series of the reversal date
  const Control = require('../../server/services/financialControlService');
  const user = { id: (await db.get("SELECT id FROM users WHERE username = 'admin'")).id, username: 'admin' };
  const rev = await Control.reverseJournalEntry(manual.id, { user, reason: 'numbering test', reversal_date: '2093-04-01' });
  assert.match(rev.reversing_entry_no || (await db.get('SELECT entry_no FROM journal_entries WHERE id = ?', [rev.reversing_je_id])).entry_no, /^REV-2093-\d{4}$/);
});
