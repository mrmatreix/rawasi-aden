'use strict';
// System account roles (role -> account) so services stop hard-coding account ids and codes.
// Every lookup accepts an optional transaction handle (anything with get/query/run).
const db = require('../database/db');
const { SYSTEM_ACCOUNT_ROLES, normalizeAccountType } = require('./chartOfAccountsRules');

const roleError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode, code: 'SYSTEM_ACCOUNT' });

function definition(role) {
  const def = SYSTEM_ACCOUNT_ROLES[role];
  if (!def) throw roleError(`دور حساب النظام غير معروف: ${role}`);
  return def;
}

const ACCOUNT_SQL = `SELECT a.*, (SELECT COUNT(*) FROM accounts c WHERE c.parent_id = a.id) AS children_count FROM accounts a WHERE a.id = ?`;

function usableProblem(account, def) {
  if (!account) return 'الحساب غير موجود';
  if ((account.status && account.status !== 'active') || Number(account.is_active ?? 1) === 0) return 'الحساب موقوف';
  if (normalizeAccountType(account.type) !== def.type) return `نوع الحساب يجب أن يكون ${def.type}`;
  if (!def.group && (Number(account.is_posting) !== 1 || Number(account.children_count) > 0)) return 'يجب اختيار حساب فرعي نهائي قابل للترحيل';
  if (def.group && Number(account.children_count) === 0) return 'يجب اختيار حساب تجميعي له حسابات فرعية';
  return null;
}

// Returns the mapped account row, or falls back to the role's default codes when no usable mapping exists.
async function resolve(role, h = db) {
  const def = definition(role);
  const mapping = await h.get('SELECT account_id FROM system_account_mappings WHERE role = ?', [role]).catch(() => null);
  if (mapping) {
    const account = await h.get(ACCOUNT_SQL, [mapping.account_id]);
    if (!usableProblem(account, def)) return account;
  }
  for (const code of def.codes) {
    const row = await h.get('SELECT id FROM accounts WHERE code = ?', [code]);
    const account = row ? await h.get(ACCOUNT_SQL, [row.id]) : null;
    if (account && !usableProblem(account, def)) return account;
  }
  throw roleError(`لم يتم ربط حساب النظام "${def.label}" (${role}) بحساب صالح في دليل الحسابات. يرجى ضبطه من إعدادات حسابات النظام.`);
}

async function resolveOptional(role, h = db) {
  try { return await resolve(role, h); } catch (err) { if (err.code === 'SYSTEM_ACCOUNT') return null; throw err; }
}

// True when accountId sits anywhere below the account mapped to a group role (e.g. CASH_GROUP).
async function isUnderGroup(accountId, groupRole, h = db) {
  const group = await resolveOptional(groupRole, h);
  if (!group) return false;
  let current = await h.get('SELECT id, parent_id FROM accounts WHERE id = ?', [accountId]);
  const seen = new Set();
  while (current && !seen.has(Number(current.id))) {
    if (Number(current.id) === Number(group.id)) return true;
    seen.add(Number(current.id));
    current = current.parent_id ? await h.get('SELECT id, parent_id FROM accounts WHERE id = ?', [current.parent_id]) : null;
  }
  return false;
}

async function list(h = db) {
  const rows = await h.query(`SELECT m.role, m.account_id, m.updated_at, m.updated_by, a.code, a.name FROM system_account_mappings m
    LEFT JOIN accounts a ON a.id = m.account_id`);
  const byRole = new Map(rows.map(r => [r.role, r]));
  const out = [];
  for (const [role, def] of Object.entries(SYSTEM_ACCOUNT_ROLES)) {
    const r = byRole.get(role);
    const account = r ? await h.get(ACCOUNT_SQL, [r.account_id]) : null;
    out.push({ role, label: def.label, expected_type: def.type, group: !!def.group, default_codes: def.codes,
      account_id: r ? r.account_id : null, code: r ? r.code : null, name: r ? r.name : null,
      updated_at: r ? r.updated_at : null, updated_by: r ? r.updated_by : null, problem: r ? usableProblem(account, def) : 'غير مربوط' });
  }
  return out;
}

async function setMapping(role, accountId, updatedBy, h = db) {
  const def = definition(role);
  const account = await h.get(ACCOUNT_SQL, [Number(accountId)]);
  const problem = usableProblem(account, def);
  if (problem) throw roleError(`لا يمكن ربط "${def.label}": ${problem}`);
  await h.run(`INSERT INTO system_account_mappings (role, account_id, updated_at, updated_by) VALUES (?, ?, CURRENT_TIMESTAMP, ?)
    ON CONFLICT(role) DO UPDATE SET account_id = excluded.account_id, updated_at = CURRENT_TIMESTAMP, updated_by = excluded.updated_by`,
  [role, account.id, updatedBy || null]);
  return { role, account_id: account.id, code: account.code, name: account.name };
}

module.exports = { resolve, resolveOptional, isUnderGroup, list, setMapping, usableProblem };
