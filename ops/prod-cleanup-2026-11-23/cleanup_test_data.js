'use strict';
/**
 * Reviewed cleanup of test / demo data found in the production database (investigation 2026-11-23).
 *
 *   node cleanup_test_data.js --source <db file> --out <new folder> [--include-orphan-demo] [--rc-2026-0001=keep|unlink|delete]
 *
 * Safety:
 * - the source is opened READ-ONLY and copied with the SQLite backup API; nothing is ever written to it;
 * - all changes happen in <out>/cleaned.db inside ONE transaction; <out>/before.db is the untouched copy;
 * - the output folder must not exist yet;
 * - any row in any table that references a row planned for deletion, and is not itself in the plan, stops the
 *   run with nothing changed (no blind cascade);
 * - default scope = data that is certainly test data. Two groups only run when asked explicitly:
 *     --include-orphan-demo   REC-MNR-001/002 (45,000,000 receipts for a client and project that do not exist)
 *     --include-orphan-entries  JE-00009 and the six 2026-10-17 inventory entries, each removed only when its source
 *                             document is found nowhere at run time (the bill or the inventory document number)
 *     --include-manual-trial  JV-2026-0001, a manual 1,000 entry between two banks (only if it still matches exactly)
 *     --rc-2026-0001=...      the 1,000,000 receipt whose entry is a bank-to-bank transfer (default: keep)
 *         unlink : keep the bank entry and cash row (a real transfer), detach the receipt from the client
 *         delete : remove the receipt, its entry and its cash-book row (it was a trial)
 * Writes <out>/report.md and <out>/report.json.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync, backup } = require('node:sqlite');

const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : true]; }));
// "--source X" / "--out X" forms
process.argv.slice(2).forEach((a, i, all) => { if ((a === '--source' || a === '--out') && all[i + 1]) args[a.slice(2)] = all[i + 1]; });
const rcMode = args['rc-2026-0001'] || 'keep';
if (!args.source || !args.out) throw new Error('usage: --source <db> --out <new folder> [--include-orphan-demo] [--rc-2026-0001=keep|unlink|delete]');
if (!['keep', 'unlink', 'delete'].includes(rcMode)) throw new Error('--rc-2026-0001 must be keep, unlink or delete');
const source = path.resolve(args.source); const out = path.resolve(args.out);
if (fs.existsSync(out)) throw new Error('output folder already exists: ' + out);
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const beforeFile = path.join(out, 'before.db'); const cleanedFile = path.join(out, 'cleaned.db');
  const src = new DatabaseSync(source, { readOnly: true });
  try {
    const ok = src.prepare('PRAGMA integrity_check').all().map(r => r.integrity_check);
    if (ok.length !== 1 || ok[0] !== 'ok') throw new Error('source fails integrity_check: ' + ok.slice(0, 3).join('; '));
    await backup(src, beforeFile);
  } finally { src.close(); }
  fs.copyFileSync(beforeFile, cleanedFile, fs.constants.COPYFILE_EXCL);

  const db = new DatabaseSync(cleanedFile);
  db.exec('PRAGMA foreign_keys = ON');
  const all = (sql, ...p) => db.prepare(sql).all(...p);
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const hasTable = t => !!one("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", t);
  const hasColumn = (t, c) => hasTable(t) && all(`PRAGMA table_info("${t}")`).some(x => x.name === c);
  const ids = (sql, ...p) => all(sql, ...p).map(r => r.id);
  const tables0 = () => all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").map(r => r.name);

  const balances = () => Object.fromEntries(all(`SELECT a.code || ' ' || a.name AS k, ROUND(SUM(l.debit - l.credit), 2) AS b
    FROM journal_entry_lines l JOIN journal_entries je ON je.id = l.entry_id JOIN accounts a ON a.id = l.account_id
    WHERE je.status = 'posted' GROUP BY a.id ORDER BY a.code`).map(r => [r.k, r.b]));
  const clientBalances = () => Object.fromEntries(all('SELECT id, name, current_balance FROM clients ORDER BY id').map(r => [r.id + ' ' + r.name, r.current_balance]));
  const before = { balances: balances(), clients: clientBalances() };

  // ---------------------------------------------------------------- the plan (table -> ids), with the reason
  const plan = new Map(); const reasons = [];
  const add = (table, list, reason) => {
    if (!list.length) return;
    if (!plan.has(table)) plan.set(table, new Set());
    list.forEach(id => plan.get(table).add(id));
    reasons.push({ table, ids: list, reason });
  };
  const testEntries = ids("SELECT id FROM journal_entries WHERE entry_no LIKE 'TEST\\_%' ESCAPE '\\'");
  add('journal_entries', testEntries, 'TEST_ entries dated 2027-2028, posted by the old reporting test suite against this database');
  add('journal_entry_lines', testEntries.length ? ids(`SELECT id FROM journal_entry_lines WHERE entry_id IN (${testEntries.join(',')})`) : [], 'lines of those TEST_ entries');
  add('payments', ids("SELECT id FROM payments WHERE receipt_no LIKE 'RC-CHAIN-%'"), 'RC-CHAIN receipts of the client-chain test (their client and project do not exist)');
  add('accounting_periods', ids("SELECT id FROM accounting_periods WHERE period_name = 'فترة رقابية اختبارية' OR period_name LIKE 'TEST %'"),
    'test periods: five overlap the real Q1 2025 period, two closed test months in 2033 / 2034');
  if (hasTable('suppliers')) add('suppliers', ids("SELECT id FROM suppliers WHERE name = 'مورد اختبار الذمم 2033'"), 'supplier created by the payables test');
  if (hasTable('settings')) {
    const keyCol = hasColumn('settings', 'key') ? 'key' : null;
    if (keyCol) add('settings', all("SELECT rowid AS id FROM settings WHERE \"key\" = 'test_key' AND value = '123'").map(r => r.id), 'test_key = 123 left by a settings test');
  }
  if (hasTable('profitability_audit_log')) add('profitability_audit_log', ids("SELECT id FROM profitability_audit_log WHERE trigger_event LIKE 'TEST%' OR reference_id LIKE 'TEST-%'"), 'audit rows of profitability recalculation tests');
  if (args['include-orphan-demo']) add('payments', ids("SELECT id FROM payments WHERE receipt_no IN ('REC-MNR-001', 'REC-MNR-002') AND (client_id IS NULL OR client_id NOT IN (SELECT id FROM clients))"),
    'REC-MNR demo receipts (45,000,000) for a client and project that do not exist');

  if (args['include-orphan-entries']) {
    // entries whose source document does not exist anywhere: a bill accrual for a missing bill, and inventory
    // entries whose document number appears in no table (the items table itself is empty on this database)
    // logs written by the same operation are not evidence that a document exists; material_domain_events is a
    // hash-chained log and is left untouched (deleting from it would break the chain verification)
    const LOGS = ['journal_entries', 'journal_entry_lines', 'profitability_audit_log', 'material_domain_events', 'audit_logs'];
    const textTables = tables0().filter(t => !LOGS.includes(t));
    const docFound = code => textTables.some(t => {
      const cols = all(`PRAGMA table_info("${t}")`).filter(c => !/INT|REAL|NUM|DEC|DOUBLE|FLOAT|BOOL/i.test(c.type || '')).map(c => c.name);
      return cols.length && one(`SELECT 1 AS x FROM "${t}" WHERE ${cols.map(c => `CAST("${c}" AS TEXT) LIKE ?`).join(' OR ')} LIMIT 1`, ...cols.map(() => `%${code}%`));
    });
    const candidates = all("SELECT id, entry_no, reference_type, reference_id, description FROM journal_entries WHERE entry_no IN ('JE-00009', 'JV-2026-0003', 'JV-2026-0004', 'JV-2026-0005', 'JV-2026-0006', 'JV-2026-0007', 'JV-2026-0008')");
    const orphans = []; const kept = [];
    for (const e of candidates) {
      let orphan;
      if (e.reference_type === 'مستخلص أعمال معتمد') orphan = !one('SELECT 1 AS x FROM bills WHERE id = ?', e.reference_id);
      else { const m = String(e.description).match(/\(([A-Z]{2,4}(?:-[A-Z]{2,4})?-\d{4}-\d{4})\)/); orphan = !!m && !docFound(m[1]); }
      (orphan ? orphans : kept).push(e);
    }
    // the inventory entries move stock against each other: remove them all or none, never a subset
    const isInventory = e => e.reference_type !== 'مستخلص أعمال معتمد';
    if (kept.some(isInventory)) for (let i = orphans.length - 1; i >= 0; i--) if (isInventory(orphans[i])) kept.push(...orphans.splice(i, 1));
    add('journal_entries', orphans.map(e => e.id), 'entries whose source document does not exist (missing bill / inventory documents of the 2026-10-17 test runs): ' + orphans.map(e => e.entry_no).join(', '));
    if (orphans.length) add('journal_entry_lines', ids(`SELECT id FROM journal_entry_lines WHERE entry_id IN (${orphans.map(e => e.id).join(',')})`), 'their lines');
    if (kept.length) reasons.push({ table: 'journal_entries', ids: [], reason: 'KEPT (source document found): ' + kept.map(e => e.entry_no).join(', ') });
  }

  if (args['include-manual-trial']) {
    // JV-2026-0001: a manual 1,000 bank-to-bank trial (owner confirmed 2026-11-23). Removed only if it is still
    // exactly that entry: manual, no reference, two lines of 1,000 on two bank accounts under the bank group
    const e = one("SELECT id, reference_type, reference_id, total_debit, total_credit FROM journal_entries WHERE entry_no = 'JV-2026-0001'");
    if (e) {
      const lines = all('SELECT a.code, l.debit, l.credit FROM journal_entry_lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = ? ORDER BY l.id', e.id);
      const exact = e.reference_type === 'قيد يدوي' && e.reference_id == null && Number(e.total_debit) === 1000 && Number(e.total_credit) === 1000
        && lines.length === 2 && lines.every(l => String(l.code).startsWith('11102')) && lines.reduce((s, l) => s + Number(l.debit), 0) === 1000;
      if (!exact) throw new Error('JV-2026-0001 is no longer the confirmed 1,000 bank-to-bank trial; refusing to delete it. Review it by hand.');
      add('journal_entries', [e.id], 'JV-2026-0001 manual 1,000 bank-to-bank trial (owner confirmed it was a trial)');
      add('journal_entry_lines', ids('SELECT id FROM journal_entry_lines WHERE entry_id = ?', e.id), 'its lines');
    }
  }

  const rc = one("SELECT * FROM payments WHERE receipt_no = 'RC-2026-0001'");
  const cashRows = [];
  if (rc && rcMode === 'delete') {
    add('payments', [rc.id], 'RC-2026-0001 trial receipt (owner confirmed it was a trial)');
    if (rc.journal_entry_id) {
      add('journal_entries', [rc.journal_entry_id], 'bank-to-bank entry of RC-2026-0001');
      add('journal_entry_lines', ids('SELECT id FROM journal_entry_lines WHERE entry_id = ?', rc.journal_entry_id), 'its lines');
    }
    cashRows.push(...ids("SELECT id FROM cash_movements WHERE reference_no = 'RC-2026-0001'"));
  }
  // cash-book rows written under a deleted document number
  const deletedNumbers = [
    ...(plan.get('payments') ? all(`SELECT receipt_no FROM payments WHERE id IN (${[...plan.get('payments')].join(',')})`).map(r => r.receipt_no) : []),
    ...(plan.get('journal_entries') ? all(`SELECT entry_no FROM journal_entries WHERE id IN (${[...plan.get('journal_entries')].join(',')})`).map(r => r.entry_no) : [])
  ];
  if (deletedNumbers.length) cashRows.push(...ids(`SELECT id FROM cash_movements WHERE reference_no IN (${deletedNumbers.map(() => '?').join(',')})`, ...deletedNumbers));
  add('cash_movements', [...new Set(cashRows)], 'cash-book rows of the deleted documents');

  // ---------------------------------------------------------------- dependency check: stop on anything outside the plan
  const blockers = [];
  const tables = all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").map(r => r.name);
  for (const child of tables) {
    for (const fk of all(`PRAGMA foreign_key_list("${child}")`)) {
      const targets = plan.get(fk.table); if (!targets || !targets.size) continue;
      const rows = all(`SELECT rowid AS id FROM "${child}" WHERE "${fk.from}" IN (${[...targets].join(',')})`).map(r => r.id);
      const outside = rows.filter(id => !(plan.get(child) && plan.get(child).has(id)));
      if (outside.length) blockers.push(`${child}.${fk.from} -> ${fk.table}: rows ${outside.join(',')}`);
    }
  }
  // soft links that carry no declared foreign key
  const deletedEntries = plan.get('journal_entries') ? [...plan.get('journal_entries')] : [];
  if (deletedEntries.length) for (const child of tables) {
    if (!hasColumn(child, 'journal_entry_id')) continue;
    const rows = all(`SELECT rowid AS id FROM "${child}" WHERE journal_entry_id IN (${deletedEntries.join(',')})`).map(r => r.id);
    const outside = rows.filter(id => !(plan.get(child) && plan.get(child).has(id)));
    if (outside.length) blockers.push(`${child}.journal_entry_id (no declared FK): rows ${outside.join(',')}`);
  }
  if (blockers.length) { db.close(); throw new Error('STOPPED, nothing changed. Rows outside the plan reference planned deletions:\n  ' + blockers.join('\n  ')); }

  // ---------------------------------------------------------------- apply in one transaction
  const deletedRows = {};
  db.exec('BEGIN IMMEDIATE');
  try {
    const unlock = hasTable('ledger_maintenance_unlock');
    if (unlock) db.prepare("INSERT INTO ledger_maintenance_unlock (reason) VALUES ('reviewed test-data cleanup 2026-11-23')").run();
    // children before parents
    const order = ['journal_entry_lines', 'cash_movements', 'payments', 'journal_entries', 'accounting_periods', 'suppliers', 'settings', 'profitability_audit_log'];
    for (const table of order) {
      const set = plan.get(table); if (!set || !set.size) continue;
      const list = [...set];
      deletedRows[table] = all(`SELECT rowid AS _rowid, * FROM "${table}" WHERE rowid IN (${list.join(',')})`);
      const res = db.prepare(`DELETE FROM "${table}" WHERE rowid IN (${list.join(',')})`).run();
      if (Number(res.changes) !== list.length) throw new Error(`${table}: expected ${list.length} deletions, got ${res.changes}`);
    }
    if (rc && rcMode === 'unlink') {
      // a real bank-to-bank transfer: keep the entry and the cash row, stop counting it as a client collection
      db.prepare("UPDATE payments SET client_id = NULL, project_id = NULL, receipt_category = 'general', notes = TRIM(COALESCE(notes, '') || ' [فُصل عن العميل 2026-11-23: تحويل بين البنوك وليس تحصيلاً]') WHERE id = ?").run(rc.id);
    }
    // Reserve the numbers of the deleted documents: numbering restarts after the highest number left in the table,
    // so an emptied ledger would hand out JV-2026-0001 / RC-2026-0001 again. document_sequences (the table
    // numberingService reads, key "table.column:prefix" per year, 0 for series without a year) keeps them used.
    db.exec(`CREATE TABLE IF NOT EXISTS document_sequences (series TEXT NOT NULL, period_year INTEGER NOT NULL,
      last_no INTEGER NOT NULL DEFAULT 0, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (series, period_year))`);
    const reserved = {};
    const reserve = (table, column, number) => {
      const yearly = String(number).match(/^([A-Z]+(?:-[A-Z]+)*)-(\d{4})-(\d+)$/);
      const plain = !yearly && String(number).match(/^([A-Z]+)-(\d+)$/);
      if (!yearly && !plain) return; // TEST_..., RC-CHAIN-..., REC-MNR-... are not issued by numberingService
      const [prefix, year, n] = yearly ? [yearly[1], Number(yearly[2]), Number(yearly[3])] : [plain[1], 0, Number(plain[2])];
      const key = `${table}.${column}:${prefix}`; const k = key + '@' + year;
      reserved[k] = Math.max(reserved[k] || 0, n);
    };
    (deletedRows.journal_entries || []).forEach(r => reserve('journal_entries', 'entry_no', r.entry_no));
    (deletedRows.payments || []).forEach(r => reserve('payments', 'receipt_no', r.receipt_no));
    for (const [k, n] of Object.entries(reserved)) {
      const [series, year] = k.split('@');
      db.prepare(`INSERT INTO document_sequences (series, period_year, last_no) VALUES (?, ?, ?)
        ON CONFLICT(series, period_year) DO UPDATE SET last_no = MAX(last_no, excluded.last_no), updated_at = CURRENT_TIMESTAMP`).run(series, Number(year), n);
    }
    reasons.push({ table: 'document_sequences', ids: [], reason: 'numbers of deleted documents kept reserved (no reuse): ' + (Object.entries(reserved).map(([k, n]) => `${k.replace('@', ' ')} → ${n}`).join(', ') || 'none') });
    if (unlock) db.exec('DELETE FROM ledger_maintenance_unlock');
    // client balances with the corrected formula (advance receipts are a liability, not a collection)
    const clientIds = all('SELECT id FROM clients').map(r => r.id);
    const billStatuses = "('معتمد', 'posted', 'محصل جزئي', 'محصل كامل')";
    for (const id of clientIds) {
      const prev = Number(one('SELECT previous_balance FROM clients WHERE id = ?', id).previous_balance) || 0;
      const due = Number(one(`SELECT COALESCE(SUM(net_amount), 0) AS t FROM bills WHERE client_id = ? AND status IN ${billStatuses}`, id).t) || 0;
      const paid = Number(one(`SELECT COALESCE(SUM(COALESCE(local_amount, amount)), 0) AS t FROM payments WHERE client_id = ? AND type = 'قبض'
        AND (status IN ('posted', 'cleared', 'approved') OR status IS NULL) AND COALESCE(receipt_category, 'general') <> 'advance_payment'`, id).t) || 0;
      db.prepare('UPDATE clients SET total_due = ?, total_paid = ?, current_balance = ? WHERE id = ?').run(due, paid, Math.round((prev + due - paid) * 100) / 100, id);
    }
    db.exec('COMMIT');
  } catch (err) { try { db.exec('ROLLBACK'); } catch {} db.close(); throw err; }

  const integrity = all('PRAGMA integrity_check').map(r => r.integrity_check);
  const fkIssues = all('PRAGMA foreign_key_check');
  const after = { balances: balances(), clients: clientBalances() };
  db.close();

  // ---------------------------------------------------------------- report
  const keys = [...new Set([...Object.keys(before.balances), ...Object.keys(after.balances)])].sort();
  const balanceRows = keys.map(k => ({ account: k, before: before.balances[k] ?? 0, after: after.balances[k] ?? 0 })).filter(r => r.before !== r.after);
  const report = {
    generated_at: new Date().toISOString(), source, source_sha256: sha(source), before_sha256: sha(beforeFile), cleaned_sha256: sha(cleanedFile),
    options: { include_orphan_demo: !!args['include-orphan-demo'], rc_2026_0001: rcMode },
    deleted_counts: Object.fromEntries(Object.entries(deletedRows).map(([t, r]) => [t, r.length])),
    reasons, changed_account_balances: balanceRows, clients_before: before.clients, clients_after: after.clients,
    integrity_check: integrity, foreign_key_issues: fkIssues.length, deleted_rows: deletedRows
  };
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, (_, v) => typeof v === 'bigint' ? Number(v) : v, 2));
  const md = [
    '# تقرير تنظيف بيانات الاختبار — نسخة الإنتاج', '',
    `- المصدر (لم يُعدَّل): \`${source}\``, `- الخيارات: سندات REC-MNR = ${report.options.include_orphan_demo ? 'تُحذف' : 'تبقى'}، RC-2026-0001 = ${rcMode}`,
    `- فحص السلامة بعد التنظيف: ${integrity.join(', ')} — مراجع مكسورة: ${fkIssues.length}`, '',
    '## ما حُذف', '', '| الجدول | العدد |', '|---|---|', ...Object.entries(report.deleted_counts).map(([t, n]) => `| ${t} | ${n} |`), '',
    '## السبب', '', ...reasons.map(r => `- **${r.table}** (${r.ids.length}): ${r.reason}`), '',
    '## أرصدة الحسابات التي تغيّرت (الأستاذ العام، المرحّل فقط)', '', '| الحساب | قبل | بعد |', '|---|---:|---:|', ...balanceRows.map(r => `| ${r.account} | ${r.before} | ${r.after} |`), '',
    '## أرصدة العملاء', '', '| العميل | قبل | بعد |', '|---|---:|---:|', ...Object.keys(before.clients).map(k => `| ${k} | ${before.clients[k]} | ${after.clients[k]} |`), '',
    `بصمات SHA-256: المصدر ${report.source_sha256.slice(0, 16)}… — قبل ${report.before_sha256.slice(0, 16)}… — بعد ${report.cleaned_sha256.slice(0, 16)}…`
  ].join('\n');
  fs.writeFileSync(path.join(out, 'report.md'), md);
  console.log(md);
})().catch(err => { console.error(err.message); process.exit(1); });
