'use strict';
// Chart-of-accounts data repair (stage 2). Works on a node:sqlite DatabaseSync handle.
// planRepair() is read-only and returns every change; applyRepair() runs the same plan inside
// one IMMEDIATE transaction and rolls back unless the structural audit is clean afterwards.
// Account codes never change and no account or journal line is deleted.
const rules = require('../services/chartOfAccountsRules');

// ---- Accountant-reviewable configuration -------------------------------------------------
const RENAMES = Object.freeze({
  '2': 'الالتزامات وحقوق الملكية',
  '21402': 'الدفعات والإيرادات المقدمة من العملاء',
  '32103': 'مصروفات قانونية وضريبية'
});

// [code, name, type, isContra]; parents come first so they exist when children are inserted.
const NEW_ACCOUNTS = Object.freeze([
  ['118', 'الضرائب المدينة', 'asset'], ['11801', 'الضرائب المدينة', 'asset'],
  ['11801001', 'ضريبة مخصومة من المنبع لدى العملاء', 'asset'], ['11801002', 'ضريبة القيمة المضافة - المدخلات', 'asset'],
  ['12201', 'السيارات', 'asset'], ['12201001', 'السيارات', 'asset'],
  ['124', 'مجمع الإهلاك', 'asset', 1], ['12401', 'مجمع إهلاك الأصول الثابتة', 'asset', 1], ['12401001', 'مجمع إهلاك الأصول الثابتة', 'asset', 1],
  ['21402001', 'الدفعات المقدمة من العملاء', 'liability'],
  ['215', 'الضرائب المستحقة', 'liability'], ['21501', 'الضرائب المستحقة', 'liability'],
  ['21501001', 'ضريبة الخصم من المنبع مستحقة الدفع', 'liability'], ['21501002', 'ضريبة القيمة المضافة - المخرجات', 'liability'],
  ['22104', 'الأرباح المحتجزة', 'equity'], ['22104001', 'الأرباح المحتجزة', 'equity'],
  ['32104', 'الإهلاك', 'expense'], ['32104001', 'مصروف إهلاك الأصول الثابتة', 'expense'],
  ['32105', 'مصروفات أخرى', 'expense'], ['32105001', 'خسائر فروق العملة', 'expense'],
  // المرحلة 4.6: حسابات المخزون والبنوك
  ['31101009', 'تكلفة المواد المصروفة من المخزون للمشاريع', 'expense'],
  ['32105002', 'عجز وتلف المخزون', 'expense'], ['32105003', 'عمولات ومصاريف بنكية', 'expense'],
  ['41203004', 'فائض جرد المخزون', 'revenue'],
  ['119', 'أرصدة نقدية مقيدة', 'asset'], ['11901', 'غطاء خطابات الضمان', 'asset'], ['11901001', 'غطاء خطابات الضمان لدى البنوك', 'asset'],
  ['32105004', 'عمولات خطابات الضمان', 'expense']
].map(([code, name, type, contra = 0]) => Object.freeze({ code, name, type, is_contra: contra })));

// Misplaced accounts are retired (never deleted) and replaced by a correctly placed one.
// Retirement is skipped, and reported, when the account already carries journal lines:
// moving a balance needs an accountant-approved reclassification entry.
const RETIREMENTS = Object.freeze([
  { code: '22103001', replacement: '12401001', reason: 'مجمع الإهلاك حساب مقابل للأصول الثابتة وليس من حقوق الملكية' },
  { code: '22103', replacement: '12401', reason: 'مجموعة مجمع الإهلاك نُقلت إلى الأصول الثابتة' },
  { code: '21101004', replacement: '21402001', reason: 'الدفعات المقدمة من العملاء التزام تعاقدي وليست من الموردين' }
]);
// -------------------------------------------------------------------------------------------

const OPTIONAL_COLUMNS = Object.freeze({
  parent_code: 'TEXT', is_contra: 'INTEGER DEFAULT 0', is_active: 'INTEGER DEFAULT 1', normal_balance: 'TEXT', updated_at: 'DATETIME'
});
const INHERITED_COLUMNS = ['currencies', 'report_type', 'inclusion', 'analytical_type', 'default_cost_center_id', 'cost_center_required'];

const MAPPINGS_DDL = `CREATE TABLE IF NOT EXISTS system_account_mappings (
  role TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT
)`;

const columnsOf = (db, table) => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
const tableExists = (db, table) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);

// Every table that can point at an account (used to decide whether an account is safe to retire).
function accountReferences(db, accountId) {
  const refs = [];
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()) {
    if (name === 'accounts' || name === 'cash_flow_account_mappings' || name === 'system_account_mappings') continue;
    const fkCols = db.prepare(`PRAGMA foreign_key_list(${name})`).all().filter(fk => fk.table === 'accounts').map(fk => fk.from);
    const namedCols = db.prepare(`PRAGMA table_info(${name})`).all().map(c => c.name).filter(c => /(^|_)account_id$/.test(c));
    for (const col of new Set([...fkCols, ...namedCols])) {
      const n = db.prepare(`SELECT COUNT(*) AS n FROM ${name} WHERE ${col} = ?`).get(accountId).n;
      if (n) refs.push(`${name}.${col}=${n}`);
    }
  }
  return refs;
}

function loadAccounts(db) {
  const cols = columnsOf(db, 'accounts');
  const pick = c => (cols.has(c) ? `a.${c}` : `NULL AS ${c}`);
  return db.prepare(`SELECT a.id, a.code, a.name, a.type, a.parent_id, a.level, a.is_posting, a.status,
    ${pick('parent_code')}, ${pick('is_contra')}, ${pick('is_active')}, ${pick('normal_balance')} FROM accounts a ORDER BY a.code`).all()
    .map(a => ({ ...a, code: String(a.code) }));
}

// Simulates the whole repair in memory so the plan, the dry run and the applied result agree.
function planRepair(db) {
  const changes = [];
  const skipped = [];
  const cols = columnsOf(db, 'accounts');
  const missingColumns = Object.keys(OPTIONAL_COLUMNS).filter(c => !cols.has(c));
  const accounts = loadAccounts(db);
  const byCode = new Map(accounts.map(a => [a.code, a]));
  const unknown = accounts.filter(a => !rules.normalizeAccountType(a.type));
  if (unknown.length) throw new Error('Unknown account types: ' + unknown.map(a => `${a.code}=${a.type}`).join(', '));

  // 1. New accounts (in memory with negative ids until inserted)
  let tempId = -1;
  const inserts = [];
  for (const n of NEW_ACCOUNTS) {
    if (byCode.has(n.code)) continue;
    const parentCode = rules.expectedParentCode(n.code);
    if (parentCode && !byCode.has(parentCode)) { skipped.push({ code: n.code, reason: `parent ${parentCode} missing` }); continue; }
    const row = { id: tempId--, code: n.code, name: n.name, type: n.type, parent_id: null, level: rules.levelForCode(n.code),
      is_posting: rules.levelForCode(n.code) === 5 ? 1 : 0, status: 'active', is_active: 1, is_contra: n.is_contra, parent_code: null, normal_balance: null, isNew: true };
    accounts.push(row); byCode.set(n.code, row); inserts.push(row);
    changes.push({ code: n.code, field: 'insert', from: null, to: `${n.name} (${n.type}${n.is_contra ? ', contra' : ''})` });
  }

  const set = (a, field, to) => {
    const from = a[field] ?? null;
    if (from === to || (from != null && to != null && String(from) === String(to))) return;
    if (!a.isNew) changes.push({ code: a.code, field, from, to });
    a[field] = to;
  };

  // 2. Renames
  for (const [code, name] of Object.entries(RENAMES)) if (byCode.has(code)) set(byCode.get(code), 'name', name);

  // 3. Retirements
  for (const r of RETIREMENTS) {
    const a = byCode.get(r.code);
    if (!a || (a.status === 'inactive' && Number(a.is_posting) === 0)) continue;
    if (!byCode.has(r.replacement)) { skipped.push({ code: r.code, reason: `replacement ${r.replacement} missing` }); continue; }
    const lines = a.id > 0 ? db.prepare('SELECT COUNT(*) AS n FROM journal_entry_lines WHERE account_id = ?').get(a.id).n : 0;
    const refs = a.id > 0 ? accountReferences(db, a.id).filter(x => !x.startsWith('journal_entry_lines.')) : [];
    const activeKids = accounts.filter(c => Number(c.parent_id) === Number(a.id) && c.status !== 'inactive' && !RETIREMENTS.some(x => x.code === c.code));
    if (lines || refs.length || activeKids.length) {
      skipped.push({ code: r.code, reason: `in use (lines=${lines}${refs.length ? ', ' + refs.join(', ') : ''}${activeKids.length ? ', active children' : ''}); needs an accountant-approved reclassification entry to ${r.replacement}` });
      continue;
    }
    set(a, 'status', 'inactive'); set(a, 'is_active', 0); set(a, 'is_posting', 0);
    set(a, 'name', `${a.name.replace(/ \(موقوف.*\)$/, '')} (موقوف - استخدم ${r.replacement})`);
    a.retired = true;
  }

  // 4. Types, parents, levels, posting flag, normal balance
  const idOf = code => (byCode.get(code) ? byCode.get(code).id : null);
  for (const a of accounts) set(a, 'type', rules.normalizeAccountType(a.type));
  for (const a of accounts) {
    const parentCode = rules.expectedParentCode(a.code);
    set(a, 'parent_id', parentCode ? idOf(parentCode) : null);
    set(a, 'parent_code', parentCode && idOf(parentCode) != null ? parentCode : null);
    set(a, 'level', rules.levelForCode(a.code));
  }
  const hasKids = a => accounts.some(c => c.parent_id != null && Number(c.parent_id) === Number(a.id));
  for (const a of accounts) {
    if (hasKids(a)) set(a, 'is_posting', 0);
    if (!hasKids(a) && a.level === 5 && !a.retired && a.status !== 'inactive') set(a, 'is_posting', 1);
  }
  // A retired group under another type keeps no stale type conflict: it follows its new parent.
  for (const a of accounts) if (a.retired) { const p = accounts.find(x => Number(x.id) === Number(a.parent_id)); if (p) set(a, 'type', p.type); }
  for (const r of NEW_ACCOUNTS) if (r.is_contra && byCode.get(r.code)) set(byCode.get(r.code), 'is_contra', 1);
  for (const a of accounts) set(a, 'is_contra', Number(a.is_contra || 0));
  for (const a of accounts) set(a, 'normal_balance', rules.normalBalanceFor(a.type, a.is_contra));

  // 5. System account mappings
  const current = tableExists(db, 'system_account_mappings')
    ? new Map(db.prepare('SELECT role, account_id FROM system_account_mappings').all().map(m => [m.role, Number(m.account_id)])) : new Map();
  const usable = (a, def) => a && a.status !== 'inactive' && Number(a.is_active ?? 1) === 1 && rules.normalizeAccountType(a.type) === def.type
    && (def.group ? true : Number(a.is_posting) === 1 && !hasKids(a));
  const mappings = [];
  for (const [role, def] of Object.entries(rules.SYSTEM_ACCOUNT_ROLES)) {
    const mapped = current.has(role) ? accounts.find(a => Number(a.id) === current.get(role)) : null;
    if (usable(mapped, def)) continue;
    const target = def.codes.map(c => byCode.get(c)).find(a => usable(a, def));
    if (!target) { skipped.push({ code: role, reason: 'no usable account for system role' }); continue; }
    mappings.push({ role, code: target.code });
    changes.push({ code: role, field: 'system_account_mapping', from: mapped ? mapped.code : null, to: target.code });
  }

  const audit = rules.auditChart(accounts);
  return { missingColumns, inserts, accounts, mappings, changes, skipped, audit };
}

function inheritedValues(db, accounts, row, cols) {
  const parentCode = rules.expectedParentCode(row.code);
  const sibling = db.prepare(`SELECT * FROM accounts WHERE parent_code = ? OR parent_id = (SELECT id FROM accounts WHERE code = ?) ORDER BY code LIMIT 1`).get(parentCode, parentCode);
  const parent = db.prepare('SELECT * FROM accounts WHERE code = ?').get(parentCode);
  const source = (rules.levelForCode(row.code) === 5 ? sibling : null) || parent || {};
  const values = {};
  for (const c of INHERITED_COLUMNS) if (cols.has(c) && source[c] !== undefined && source[c] !== null) values[c] = source[c];
  return values;
}

function applyRepair(db, { updatedBy = 'repair_chart_of_accounts' } = {}) {
  // Columns and the mapping table are added outside the transaction (DDL is idempotent).
  const before = columnsOf(db, 'accounts');
  for (const [c, def] of Object.entries(OPTIONAL_COLUMNS)) if (!before.has(c)) db.exec(`ALTER TABLE accounts ADD COLUMN ${c} ${def}`);
  db.exec(MAPPINGS_DDL);
  const plan = planRepair(db);
  if (plan.audit.errors.length) {
    const sample = plan.audit.errors.slice(0, 10).map(e => `${e.rule}:${e.code}`).join(', ');
    throw new Error(`Repair plan would leave ${plan.audit.errors.length} structural errors (${sample}); nothing written`);
  }
  const cols = columnsOf(db, 'accounts');
  db.exec('BEGIN IMMEDIATE');
  try {
    const idByCode = new Map(db.prepare('SELECT id, code FROM accounts').all().map(a => [String(a.code), a.id]));
    for (const row of plan.inserts) {
      const extra = inheritedValues(db, plan.accounts, row, cols);
      const fields = ['code', 'name', 'type', 'level', 'is_posting', 'status', 'is_active', 'is_contra', 'balance', ...Object.keys(extra)];
      const values = [row.code, row.name, row.type, row.level, row.is_posting, 'active', 1, row.is_contra, 0, ...Object.values(extra)];
      const r = db.prepare(`INSERT INTO accounts (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`).run(...values);
      idByCode.set(row.code, Number(r.lastInsertRowid));
    }
    const update = db.prepare(`UPDATE accounts SET name = ?, type = ?, parent_id = ?, parent_code = ?, level = ?, is_posting = ?,
      status = ?, is_active = ?, is_contra = ?, normal_balance = ?, updated_at = CURRENT_TIMESTAMP WHERE code = ?`);
    for (const a of plan.accounts) {
      const parentCode = rules.expectedParentCode(a.code);
      const parentId = parentCode ? idByCode.get(parentCode) ?? null : null;
      update.run(a.name, a.type, parentId, parentId ? parentCode : null, a.level, Number(a.is_posting), a.status || 'active',
        Number(a.is_active ?? 1), Number(a.is_contra || 0), a.normal_balance, a.code);
    }
    const upsert = db.prepare(`INSERT INTO system_account_mappings (role, account_id, updated_at, updated_by) VALUES (?, ?, CURRENT_TIMESTAMP, ?)
      ON CONFLICT(role) DO UPDATE SET account_id = excluded.account_id, updated_at = CURRENT_TIMESTAMP, updated_by = excluded.updated_by`);
    for (const m of plan.mappings) upsert.run(m.role, idByCode.get(m.code), updatedBy);
    const after = rules.auditChart(loadAccounts(db));
    if (after.errors.length) throw new Error(`Post-repair audit failed: ${after.errors.slice(0, 10).map(e => `${e.rule}:${e.code}`).join(', ')}`);
    db.exec('COMMIT');
    return { ...plan, after };
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch {}
    throw err;
  }
}

module.exports = { planRepair, applyRepair, loadAccounts, RENAMES, NEW_ACCOUNTS, RETIREMENTS, MAPPINGS_DDL };
