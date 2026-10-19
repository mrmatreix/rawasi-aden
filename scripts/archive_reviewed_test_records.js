const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { DatabaseSync, backup } = require('node:sqlite');
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const serialize = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? String(v) : v);
const fingerprint = rows => crypto.createHash('sha256').update(rows.map(serialize).sort().join('\n')).digest('hex');

async function cleanSnapshot(sourcePath, outputDirectory, reviewPath) {
  const source = path.resolve(sourcePath);
  const directory = path.resolve(outputDirectory);
  const root = path.resolve(__dirname, '..');
  assert.ok(directory.startsWith(root + path.sep), 'Archive must remain inside workspace');
  assert.ok(!fs.existsSync(directory), 'Choose a new archive directory');
  fs.mkdirSync(directory, { recursive: true });
  const original = path.join(directory, 'before.db');
  const cleaned = path.join(directory, 'cleaned.db');
  const live = new DatabaseSync(source, { readOnly: true });
  try { await backup(live, original); } finally { live.close(); }
  fs.copyFileSync(original, cleaned, fs.constants.COPYFILE_EXCL);
  const db = new DatabaseSync(cleaned);
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000');
    assert.deepEqual(db.prepare('PRAGMA integrity_check').all().map(r => r.integrity_check), ['ok']);
    const reviewed = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
    const permitted = new Set(reviewed.map(r => r.table + ':' + r.id));
    const issues = db.prepare('PRAGMA foreign_key_check').all();
    assert.equal(issues.length, reviewed.reduce((sum, row) => sum + row.missing.length, 0), 'References changed since the approved review');
    assert.deepEqual(new Set(issues.map(r => r.table + ':' + r.rowid)), permitted);
    const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name);
    const allRows = new Map(tables.map(table => [table, db.prepare('SELECT rowid AS __archive_rowid__,* FROM ' + quote(table)).all()]));
    const relations = tables.flatMap(table => db.prepare('PRAGMA foreign_key_list(' + quote(table) + ')').all().map(fk => ({ ...fk, child: table })));
    assert.ok(relations.every(fk => fk.seq === 0), 'Composite references require explicit review');
    const plan = new Map();
    const reasons = new Map();
    const add = (table, id, reason) => {
      if (!allRows.get(table)?.some(row => row.__archive_rowid__ === id)) return false;
      if (!plan.has(table)) plan.set(table, new Set());
      const ids = plan.get(table);
      if (ids.has(id)) return false;
      ids.add(id); reasons.set(table + ':' + id, reason); return true;
    };
    for (const row of reviewed) add(row.table, row.id, 'علاقة تجريبية غير مكتملة ضمن المراجعة المعتمدة');
    const selected = (table, id) => plan.get(table)?.has(id) || false;
    const journals = allRows.get('journal_entries');
    const journalLines = allRows.get('journal_entry_lines');
    for (const entry of journals) {
      if (!journalLines.some(line => line.entry_id === entry.id)) {
        const missingBill = entry.reference_type === 'مستخلص أعمال معتمد' && !allRows.get('bills').some(bill => bill.id === entry.reference_id);
        if (entry.reference_type === 'TEST' || missingBill) add('journal_entries', entry.__archive_rowid__, 'قيد قديم بلا سطور؛ مصدره اختبار أو مستخلص مفقود');
      }
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const line of journalLines) if (selected('journal_entry_lines', line.__archive_rowid__)) changed = add('journal_entries', line.entry_id, 'أرشفة القيد كاملاً للمحافظة على توازن الطرفين') || changed;
      for (const fk of relations) {
        const parentRows = allRows.get(fk.table) || [];
        const referencedColumn = fk.to || db.prepare('PRAGMA table_info(' + quote(fk.table) + ')').all().find(col => col.pk === 1)?.name;
        const deletedKeys = new Set(parentRows.filter(row => selected(fk.table, row.__archive_rowid__)).map(row => row[referencedColumn]));
        for (const row of allRows.get(fk.child)) if (row[fk.from] != null && deletedKeys.has(row[fk.from])) changed = add(fk.child, row.__archive_rowid__, 'سجل تابع لسجل مؤرشف عبر ' + fk.from) || changed;
      }
      const removedEntries = journals.filter(j => selected('journal_entries', j.id));
      const removedPayments = allRows.get('payments').filter(p => selected('payments', p.id));
      const removedExpenses = allRows.get('expenses').filter(e => selected('expenses', e.id));
      for (const entry of journals) {
        if (entry.reference_type === 'سند قبض' && removedPayments.some(p => p.type === 'قبض' && (p.journal_entry_id === entry.id || p.id === entry.reference_id))) changed = add('journal_entries', entry.id, 'قيد سند قبض تجريبي مؤرشف') || changed;
        if (entry.reference_type === 'سند صرف' && [...removedExpenses, ...removedPayments.filter(p => p.type === 'صرف')].some(v => v.journal_entry_id === entry.id || (v.id === entry.reference_id && v.receipt_no === entry.reference_no))) changed = add('journal_entries', entry.id, 'قيد سند صرف تجريبي مؤرشف') || changed;
      }
      for (const table of tables) {
        for (const row of allRows.get(table)) {
          if (row.journal_entry_id != null && removedEntries.some(j => j.id === row.journal_entry_id)) changed = add(table, row.__archive_rowid__, 'مرتبط بقيد تجريبي مؤرشف') || changed;
        }
      }
      const refs = new Set([...removedEntries.map(j => j.entry_no), ...removedPayments.map(p => p.receipt_no), ...removedExpenses.map(e => e.receipt_no)]);
      for (const row of allRows.get('cash_movements')) if (refs.has(row.reference_no)) changed = add('cash_movements', row.__archive_rowid__, 'حركة نقدية ناتجة عن مستند مؤرشف') || changed;
      for (const doc of allRows.get('supporting_documents')) {
        const table = ({ journal: 'journal_entries', payment: 'payments', expense: 'expenses' })[doc.entity_type];
        if (table && selected(table, doc.entity_id)) changed = add('supporting_documents', doc.__archive_rowid__, 'مؤيد لسجل مؤرشف') || changed;
      }
    }
    const archived = [];
    for (const [table, ids] of plan) for (const row of allRows.get(table).filter(row => ids.has(row.__archive_rowid__))) archived.push({ table, reason: reasons.get(table + ':' + row.__archive_rowid__), row });
    fs.writeFileSync(path.join(directory, 'archived-records.json'), JSON.stringify(archived, null, 2));
    const expected = new Map(tables.map(table => [table, allRows.get(table).filter(row => !selected(table, row.__archive_rowid__))]));
    const sequencesBefore = db.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all();
    db.exec('BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON');
    try {
      for (const [table, ids] of plan) {
        const remove = db.prepare('DELETE FROM ' + quote(table) + ' WHERE rowid=?');
        for (const id of ids) assert.equal(remove.run(id).changes, 1);
      }
      assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0, 'Remaining orphan references');
      const badEntries = db.prepare(`SELECT j.id FROM journal_entries j LEFT JOIN journal_entry_lines l ON l.entry_id=j.id GROUP BY j.id HAVING COUNT(l.id)<2 OR ABS(COALESCE(SUM(l.debit),0)-COALESCE(SUM(l.credit),0))>0.001 OR ABS(COALESCE(SUM(l.debit),0)-j.total_debit)>0.001 OR ABS(COALESCE(SUM(l.credit),0)-j.total_credit)>0.001`).all();
      assert.equal(badEntries.length, 0, 'Remaining journals must be balanced and match header totals');
      for (const table of tables) assert.equal(fingerprint(db.prepare('SELECT rowid AS __archive_rowid__,* FROM ' + quote(table)).all()), fingerprint(expected.get(table)), 'Unrelated data changed: ' + table);
      assert.deepEqual(db.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all(), sequencesBefore, 'Sequence counters must stay unchanged');
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    assert.deepEqual(db.prepare('PRAGMA integrity_check').all().map(r => r.integrity_check), ['ok']);
    const counts = Object.fromEntries([...plan].map(([table, ids]) => [table, ids.size]));
    const summary = { before: original, cleaned, references_before: issues.length, references_after: 0, reviewed_records: reviewed.length, archived_records: archived.length, counts, unrelated_data_unchanged: true, numbering_preserved: true, journal_balance_check: 'ok', integrity_check: 'ok' };
    fs.writeFileSync(path.join(directory, 'verification.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary));
  } finally { db.close(); }
}
if (require.main === module) cleanSnapshot(process.argv[2], process.argv[3], process.argv[4]).catch(error => { console.error(error.stack); process.exitCode=1; });
module.exports = { cleanSnapshot };
