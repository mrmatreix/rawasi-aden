#!/usr/bin/env node
'use strict';
// Read-only structural audit of the chart of accounts. Exit code 1 when any error is found.
//   node scripts/audit_chart_of_accounts.js --db <path>
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { auditChart } = require('../server/services/chartOfAccountsRules');
const { loadAccounts } = require('../server/database/chartOfAccountsRepair');

const i = process.argv.indexOf('--db');
const dbPath = i > 0 ? process.argv[i + 1] : process.env.RAWASI_DB_PATH;
if (!dbPath) { console.error('Usage: audit_chart_of_accounts.js --db <path>'); process.exit(2); }
const db = new DatabaseSync(path.resolve(dbPath), { readOnly: true });
try {
  const { errors, warnings } = auditChart(loadAccounts(db));
  for (const e of errors) console.log(`ERROR ${e.rule.padEnd(28)} ${e.code.padEnd(10)} ${e.name} ${e.detail ?? ''}`);
  for (const w of warnings) console.log(`warn  ${w.rule.padEnd(28)} ${w.code.padEnd(10)} ${w.name}`);
  console.log(`${errors.length} errors, ${warnings.length} warnings`);
  process.exit(errors.length ? 1 : 0);
} finally { db.close(); }
