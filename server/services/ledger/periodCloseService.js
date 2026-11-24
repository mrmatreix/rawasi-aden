'use strict';
// Period and year closing (stage 6, H11).
// - Periods may not overlap.
// - A period closes only when nothing in its date range is left unposted (journals, vouchers, bills, payroll, wizard).
// - Closing needs the dedicated permission (admin or an explicit accounting:close_period grant; the accountant
//   role's blanket accounting:* shortcut does not count) and the CURRENT user's own password, with an attempt limit.
//   The old route accepted the password of ANY admin account, checked with blocking bcrypt, with no limit.
// - Year end: one closing entry dated the last day of the year moves every revenue and expense balance to retained
//   earnings. Income statements exclude it (CLOSING_REFERENCE_TYPE); the balance sheet and the ledger include it.
const bcrypt = require('bcryptjs');
const db = require('../../database/db');
const PostingService = require('./postingService');
const SystemAccounts = require('../systemAccountService');
const { normalizeAccountType } = require('../chartOfAccountsRules');
const Money = require('./money');

const CLOSING_REFERENCE_TYPE = 'قيد إقفال سنوي';
const periodError = (message, statusCode = 400, extra = {}) => Object.assign(new Error(message), { statusCode, ...extra });
const validDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;

// ---- permission and re-authentication --------------------------------------------------------------------
function canClosePeriods(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const perms = Array.isArray(user.permissions) ? user.permissions : String(user.permissions || '').split(',').map(s => s.trim());
  return perms.includes('*') || perms.includes('all') || perms.includes('accounting:close_period');
}

const attempts = new Map(); // userId -> { failures, lockedUntil }
const MAX_FAILURES = 5; const LOCK_MS = 15 * 60 * 1000;
async function reauthenticate(user, password) {
  if (!user || !user.id) throw periodError('يجب تسجيل الدخول لإقفال الفترات', 401);
  const state = attempts.get(user.id) || { failures: 0, lockedUntil: 0 };
  if (state.lockedUntil > Date.now()) throw periodError('تم إيقاف محاولات الإقفال مؤقتاً بسبب تكرار كلمة مرور خاطئة؛ حاول بعد 15 دقيقة', 429);
  if (!password || !String(password).trim()) throw periodError('إقفال الفترة يتطلب إدخال كلمة مرور حسابك لتأكيد هويتك', 400);
  const row = await db.get('SELECT password_hash FROM users WHERE id = ?', [Number(user.id)]);
  const ok = !!(row && row.password_hash && await bcrypt.compare(String(password), row.password_hash));
  if (!ok) {
    state.failures += 1;
    if (state.failures >= MAX_FAILURES) { state.lockedUntil = Date.now() + LOCK_MS; state.failures = 0; }
    attempts.set(user.id, state);
    throw periodError('كلمة المرور غير صحيحة؛ أدخل كلمة مرور حسابك أنت', 401);
  }
  attempts.delete(user.id);
}

// ---- periods ----------------------------------------------------------------------------------------------
async function overlapping(start, end, { excludeId = null, h = db } = {}) {
  return h.query(`SELECT id, period_name, start_date, end_date, status FROM accounting_periods
    WHERE start_date <= ? AND end_date >= ? ${excludeId ? 'AND id <> ?' : ''} ORDER BY start_date`, excludeId ? [end, start, excludeId] : [end, start]);
}

async function createPeriod({ period_name, fiscal_year, start_date, end_date, notes }) {
  if (!period_name || !String(period_name).trim() || !validDate(start_date) || !validDate(end_date) || start_date > end_date) {
    throw periodError('أدخل اسم الفترة وتاريخي بداية ونهاية صالحين ومرتّبين');
  }
  return db.transaction(async tx => {
    const clash = await overlapping(start_date, end_date, { h: tx });
    if (clash.length) {
      throw periodError(`الفترة تتداخل مع فترات قائمة: ${clash.map(p => `${p.period_name} (${p.start_date} → ${p.end_date})`).join('، ')}`, 409, { code: 'PERIOD_OVERLAP', overlaps: clash });
    }
    const fy = Number(fiscal_year) || Number(start_date.slice(0, 4));
    const r = await tx.run("INSERT INTO accounting_periods (period_name, fiscal_year, start_date, end_date, status, notes) VALUES (?, ?, ?, ?, 'open', ?)",
      [String(period_name).trim(), fy, start_date, end_date, notes || '']);
    return { id: Number(r.lastInsertRowid || r.insertId), fiscal_year: fy };
  });
}

/** Overlapping pairs among existing periods (legacy data, e.g. duplicated test periods) for review. */
async function existingOverlaps(h = db) {
  return h.query(`SELECT a.id AS period_id, a.period_name, a.start_date, a.end_date, b.id AS overlaps_id, b.period_name AS overlaps_name
    FROM accounting_periods a JOIN accounting_periods b ON b.id > a.id AND a.start_date <= b.end_date AND a.end_date >= b.start_date
    ORDER BY a.start_date, a.id`);
}

const PENDING = ['draft', 'under_review', 'approved'];
/** Everything in the date range that would still change the ledger if posted. */
async function pendingDocuments(start, end, h = db) {
  const count = async (sql, params) => Number((await h.get(sql, params).catch(() => ({ n: 0 })))?.n || 0);
  const marks = PENDING.map(() => '?').join(',');
  const result = {
    journal_entries: await count(`SELECT COUNT(*) AS n FROM journal_entries WHERE date BETWEEN ? AND ? AND status IN (${marks})`, [start, end, ...PENDING]),
    payments: await count(`SELECT COUNT(*) AS n FROM payments WHERE date BETWEEN ? AND ? AND status IN (${marks})`, [start, end, ...PENDING]),
    expenses: await count(`SELECT COUNT(*) AS n FROM expenses WHERE date BETWEEN ? AND ? AND status IN (${marks})`, [start, end, ...PENDING]),
    bills: await count(`SELECT COUNT(*) AS n FROM bills WHERE date BETWEEN ? AND ? AND status IN (${marks})`, [start, end, ...PENDING]),
    payroll: await count("SELECT COUNT(*) AS n FROM payroll WHERE (payroll_month || '-01') BETWEEN ? AND ? AND journal_entry_id IS NULL", [start.slice(0, 8) + '01', end]),
    payment_transactions: await count("SELECT COUNT(*) AS n FROM payment_transactions WHERE transaction_date BETWEEN ? AND ? AND status IN ('draft','pending')", [start, end])
  };
  result.total = Object.values(result).reduce((s, n) => s + n, 0);
  return result;
}

const PENDING_LABELS = { journal_entries: 'قيود يومية', payments: 'سندات قبض/صرف', expenses: 'سندات مصروفات', bills: 'مستخلصات', payroll: 'مسيرات رواتب غير مستحقة', payment_transactions: 'معاملات دفع' };

async function closePeriod(id, { user, password, notes }) {
  if (!canClosePeriods(user)) throw periodError('إقفال الفترات المحاسبية يحتاج صلاحية الإقفال المخصصة (المدير أو accounting:close_period)', 403);
  await reauthenticate(user, password);
  const period = await db.get('SELECT * FROM accounting_periods WHERE id = ?', [id]);
  if (!period) throw periodError('الفترة المحاسبية غير موجودة', 404);
  if (period.status === 'closed') throw periodError('الفترة المحاسبية مغلقة مسبقاً');
  const pending = await pendingDocuments(period.start_date, period.end_date);
  if (pending.total) {
    const list = Object.entries(pending).filter(([k, n]) => k !== 'total' && n).map(([k, n]) => `${n} ${PENDING_LABELS[k]}`).join('، ');
    throw periodError(`لا يمكن إقفال الفترة وفيها مستندات غير مرحّلة: ${list}. رحّلها أو ألغِها أولاً.`, 409, { code: 'PERIOD_HAS_PENDING', pending });
  }
  // the period that contains a year end needs the year-end closing entry first
  const yearEnd = `${period.end_date.slice(0, 4)}-12-31`;
  if (period.start_date <= yearEnd && period.end_date >= yearEnd) {
    const status = await yearClosingStatus(Number(yearEnd.slice(0, 4)));
    if (!status.closing_entry && status.net_result !== 0) {
      throw periodError(`الفترة تتضمن نهاية السنة ${yearEnd.slice(0, 4)}: رحّل قيد الإقفال السنوي (ترحيل الإيرادات والمصروفات إلى الأرباح المحتجزة) قبل إقفالها.`, 409, { code: 'YEAR_CLOSING_REQUIRED', fiscal_year: Number(yearEnd.slice(0, 4)) });
    }
  }
  const by = user.full_name || user.username || 'المدير';
  await db.run("UPDATE accounting_periods SET status = 'closed', closed_at = CURRENT_TIMESTAMP, closed_by = ?, notes = COALESCE(?, notes) WHERE id = ? AND status <> 'closed'", [by, notes || null, id]);
  return { period, closed_by: by };
}

// Reopening needs the same dedicated permission and a documented reason (audited); no password prompt in the UI.
async function reopenPeriod(id, { user, reason }) {
  if (!canClosePeriods(user)) throw periodError('إعادة فتح الفترات تحتاج صلاحية الإقفال المخصصة', 403);
  if (!reason || String(reason).trim().length < 3) throw periodError('يجب ذكر سبب رسمي لإعادة فتح الفترة المحاسبية المغلقة');
  const period = await db.get('SELECT * FROM accounting_periods WHERE id = ?', [id]);
  if (!period) throw periodError('الفترة المحاسبية غير موجودة', 404);
  if (period.status !== 'closed') throw periodError('الفترة ليست مغلقة');
  const by = user.username || user.full_name || 'المدير';
  await db.run("UPDATE accounting_periods SET status = 'open', reopened_at = CURRENT_TIMESTAMP, reopened_by = ?, reopen_reason = ? WHERE id = ?", [by, String(reason).trim(), id]);
  return { period, reopened_by: by };
}

// ---- year-end closing entry -------------------------------------------------------------------------------
async function profitAndLossBalances(year, h = db) {
  const rows = await h.query(`SELECT a.id, a.code, a.name, a.type, COALESCE(SUM(l.debit), 0) AS debit, COALESCE(SUM(l.credit), 0) AS credit
    FROM journal_entry_lines l JOIN journal_entries je ON je.id = l.entry_id JOIN accounts a ON a.id = l.account_id
    WHERE je.status IN ('posted', 'closed') AND je.date BETWEEN ? AND ? AND COALESCE(je.reference_type, '') <> ?
    GROUP BY a.id, a.code, a.name, a.type`, [`${year}-01-01`, `${year}-12-31`, CLOSING_REFERENCE_TYPE]);
  return rows.map(r => ({ ...r, type: normalizeAccountType(r.type), net: Money.toFils(r.debit) - Money.toFils(r.credit) }))
    .filter(r => (r.type === 'revenue' || r.type === 'expense') && r.net !== 0);
}

async function yearClosingStatus(year, h = db) {
  const entry = await h.get(`SELECT id, entry_no, date FROM journal_entries WHERE reference_type = ? AND reference_no = ? AND reversal_ref_id IS NULL AND status IN ('posted','closed') ORDER BY id DESC LIMIT 1`,
    [CLOSING_REFERENCE_TYPE, String(year)]);
  const balances = entry ? [] : await profitAndLossBalances(year, h);
  const net = balances.reduce((s, r) => s + r.net, 0); // debit-positive: expenses > revenue = loss
  return { fiscal_year: year, closing_entry: entry || null, net_result: Money.fromFils(-net), accounts: balances.length };
}

/** Posts the year-end closing entry: every revenue/expense balance to zero, the result to retained earnings. */
async function postYearClosing(year, { user, password }) {
  if (!canClosePeriods(user)) throw periodError('قيد الإقفال السنوي يحتاج صلاحية الإقفال المخصصة', 403);
  if (!Number.isInteger(Number(year)) || Number(year) < 1900) throw periodError('السنة المالية غير صالحة');
  await reauthenticate(user, password);
  const date = `${year}-12-31`;
  return db.transaction(async tx => {
    const existing = await yearClosingStatus(Number(year), tx);
    if (existing.closing_entry) throw periodError(`قيد الإقفال للسنة ${year} مرحّل مسبقاً (${existing.closing_entry.entry_no})`, 409);
    const balances = await profitAndLossBalances(Number(year), tx);
    if (!balances.length) throw periodError(`لا توجد أرصدة إيرادات أو مصروفات في السنة ${year} لإقفالها`);
    const lines = balances.map(r => r.net > 0
      ? { accountId: r.id, credit: Money.fromFils(r.net), notes: `إقفال ${r.code} ${r.name} لسنة ${year}` }
      : { accountId: r.id, debit: Money.fromFils(-r.net), notes: `إقفال ${r.code} ${r.name} لسنة ${year}` });
    const net = balances.reduce((s, r) => s + r.net, 0); // > 0 loss, < 0 profit
    lines.push(net < 0
      ? { role: 'RETAINED_EARNINGS', credit: Money.fromFils(-net), notes: `صافي ربح سنة ${year}` }
      : { role: 'RETAINED_EARNINGS', debit: Money.fromFils(net), notes: `صافي خسارة سنة ${year}` });
    const entry = await PostingService.post(tx, {
      date, series: 'JV-CLOSE', user, description: `قيد الإقفال السنوي لسنة ${year}: ترحيل الإيرادات والمصروفات إلى الأرباح المحتجزة`,
      source: { type: CLOSING_REFERENCE_TYPE, id: Number(year), no: String(year) }, lines, costCenterRule: false
    });
    return { entry, net_result: Money.fromFils(-net), accounts: balances.length };
  });
}

module.exports = { CLOSING_REFERENCE_TYPE, canClosePeriods, createPeriod, existingOverlaps, pendingDocuments, closePeriod, reopenPeriod, yearClosingStatus, postYearClosing };
