#!/usr/bin/env node
'use strict';
// Stage 2 chart-of-accounts repair.
//   node scripts/repair_chart_of_accounts.js --db <path>                 dry run: prints the plan, writes nothing
//   node scripts/repair_chart_of_accounts.js --db <path> --apply         backs up the file, then applies
//   --report <file.json>   also writes the full plan/result as JSON (for the accountant's review)
// The plan (renames, new accounts, retirements) lives in server/database/chartOfAccountsRepair.js.
// Run it on a copy first and have the accountant sign the dry-run report before touching production.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { planRepair, applyRepair } = require('../server/database/chartOfAccountsRepair');

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const apply = args.includes('--apply');
const dbArg = opt('--db');
const reportFile = opt('--report');
if (!dbArg) { console.error('Usage: repair_chart_of_accounts.js --db <path> [--apply] [--report <file.json>]'); process.exit(2); }
const dbPath = path.resolve(dbArg);
if (!fs.existsSync(dbPath)) { console.error(`Database not found: ${dbPath}`); process.exit(2); }
if (apply && (process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID) && !args.includes('--allow-railway')) {
  console.error('Refusing to apply on Railway without --allow-railway (run the dry run and get accountant sign-off first).');
  process.exit(2);
}

const db = new DatabaseSync(dbPath, { readOnly: !apply });
try {
  let result;
  if (apply) {
    const backup = `${dbPath}.before-coa-repair-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
    db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
    console.log(`Backup written: ${backup}`);
    result = applyRepair(db);
  } else {
    result = planRepair(db);
  }
  const byField = result.changes.reduce((m, c) => ({ ...m, [c.field]: (m[c.field] || 0) + 1 }), {});
  console.log(`${apply ? 'APPLIED' : 'DRY RUN'}: ${result.changes.length} changes ${JSON.stringify(byField)}`);
  for (const c of result.changes.filter(c => args.includes('--verbose') || c.field !== 'normal_balance')) console.log(`  ${c.code.padEnd(24)} ${c.field.padEnd(22)} ${c.from ?? '∅'} -> ${c.to ?? '∅'}`);
  if (result.missingColumns.length) console.log(`  columns to add: ${result.missingColumns.join(', ')}`);
  for (const s of result.skipped) console.log(`  SKIPPED ${s.code}: ${s.reason}`);
  const audit = result.after || result.audit;
  console.log(`Structural audit ${apply ? 'after repair' : 'of the planned result'}: ${audit.errors.length} errors, ${audit.warnings.length} warnings`);
  for (const e of audit.errors) console.log(`  ERROR ${e.rule} ${e.code} ${e.detail ?? ''}`);
  for (const w of audit.warnings) console.log(`  warn  ${w.rule} ${w.code} ${w.name}`);
  if (reportFile) {
    const { accounts, ...rest } = result;
    fs.writeFileSync(reportFile, JSON.stringify({ db: dbPath, applied: apply, at: new Date().toISOString(), ...rest }, null, 1));
  }
  process.exit(audit.errors.length ? 1 : 0);
} catch (err) {
  console.error(err.message);
  process.exit(1);
} finally {
  try { db.close(); } catch {}
}
