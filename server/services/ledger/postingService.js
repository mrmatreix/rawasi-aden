'use strict';
// PostingService: the single writer of journal entries (stage 3).
//   post(tx, { date, description, source: { type, id, no }, status, series, lines, user, documents, dedupe })
//   reverse(tx, { entry, lines }, { date, description, referenceType, referenceId, user, reason })
// Everything happens inside the caller's transaction: validation, numbering, header, lines, cash sync.
// Amounts are handled as integer fils (1/100) internally; one rounding at the boundary.
const { checkPeriodOpen } = require('../periodService');
const SystemAccounts = require('../systemAccountService');
const Numbering = require('../numberingService');
const Money = require('./money');

const postingError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

async function loadPostingAccount(h, accountId) {
  if (!accountId) throw postingError('يرجى تحديد الحساب المالي');
  const idNum = Number(accountId);
  if (!idNum) throw postingError('معرف الحساب غير صالح');
  const account = await h.get(`SELECT a.*, (SELECT COUNT(*) FROM accounts c WHERE c.parent_id = a.id) AS children_count
    FROM accounts a WHERE a.id = ?`, [idNum]);
  if (!account) throw postingError('الحساب المالي غير موجود في دليل الحسابات');
  if (account.status === 'restricted' || account.status === 'inactive' || Number(account.is_active) === 0) {
    throw postingError(`الحساب [${account.code} - ${account.name}] موقوف ومقيد، ولا يمكن تسجيل قيود يومية عليه`);
  }
  if (!(Number(account.is_posting) === 1 && Number(account.children_count || 0) === 0)) {
    throw postingError('لا يمكن تسجيل العملية على هذا الحساب، يرجى اختيار الحساب الفرعي الأخير.');
  }
  return account;
}

async function resolveCostCenter(h, account, value) {
  const supplied = value !== undefined && value !== null && value !== '';
  const raw = supplied ? value : account.default_cost_center_id;
  let center = null;
  if (raw !== undefined && raw !== null && raw !== '') {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0 || !await h.get('SELECT id FROM cost_centers WHERE id = ?', [id])) throw postingError('مركز التكلفة المحدد غير صالح');
    center = id;
  }
  if (Number(account.cost_center_required) === 1 && !center) throw postingError('مركز التكلفة إلزامي للحساب ' + account.code + ' - ' + account.name);
  return center;
}

async function resolveProject(h, projectId) {
  if (!projectId) return null;
  const row = await h.get('SELECT id FROM projects WHERE id = ?', [Number(projectId)]);
  return row ? row.id : null;
}

// Subledger dimension (stage 4.7): which client / supplier / employee a receivable or payable line belongs to.
const PARTY_TABLES = Object.freeze({ client: 'clients', supplier: 'suppliers', employee: 'employees' });
async function resolveParty(h, type, id) {
  if (!type || id === undefined || id === null || id === '') return { type: null, id: null };
  if (!PARTY_TABLES[type]) throw postingError('نوع الطرف غير صالح (عميل / مورد / موظف)');
  const row = await h.get(`SELECT id FROM ${PARTY_TABLES[type]} WHERE id = ?`, [Number(id)]);
  return row ? { type, id: row.id } : { type: null, id: null };
}

/**
 * Validates lines and returns them in fils. Each line: { accountId | account_id | role, debit, credit,
 * costCenterId | cost_center_id, projectId | project_id, partyType + partyId (client | supplier | employee), notes | description }.
 */
async function prepareLines(h, lines) {
  if (!Array.isArray(lines) || lines.length < 2) throw postingError('يجب أن يحتوي القيد على سطرين على الأقل (طرف مدين وطرف دائن)');
  const out = [];
  let debit = 0; let credit = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const d = Money.toFils(line.debit); const c = Money.toFils(line.credit);
    if (d < 0 || c < 0) throw postingError(`السطر رقم ${i + 1}: لا يمكن إدخال مبالغ سالبة`);
    if (d === 0 && c === 0) continue;
    if (d > 0 && c > 0) throw postingError(`السطر رقم ${i + 1}: لا يمكن تحديد مبلغ مدين ودائن معاً لنفس الحساب في نفس السطر`);
    const accountRef = line.role ? (await SystemAccounts.resolve(line.role, h)).id : (line.accountId ?? line.account_id);
    if (!accountRef && !line.role) throw postingError(`السطر رقم ${i + 1}: يرجى تحديد الحساب المالي`);
    const account = await loadPostingAccount(h, accountRef);
    const costCenterId = await resolveCostCenter(h, account, line.costCenterId ?? line.cost_center_id);
    const party = await resolveParty(h, line.partyType ?? line.party_type, line.partyId ?? line.party_id);
    out.push({ account, account_id: account.id, cost_center_id: costCenterId, project_id: await resolveProject(h, line.projectId ?? line.project_id),
      party_type: party.type, party_id: party.id, debit: d, credit: c, notes: String(line.notes ?? line.description ?? '').trim() });
    debit += d; credit += c;
  }
  if (out.length < 2) throw postingError('يجب إدخال قيمتين ماليتين موجبتين على الأقل لتكوين القيد');
  if (debit <= 0) throw postingError('إجمالي قيمة القيد يجب أن تكون أكبر من الصفر');
  if (debit !== credit) {
    throw postingError(`⛔ القيد غير متزن محاسبياً! إجمالي المدين (${Money.fromFils(debit)}) لا يساوي إجمالي الدائن (${Money.fromFils(credit)})، يوجد فرق قدره (${Money.fromFils(Math.abs(debit - credit))})`);
  }
  return { lines: out, total: debit };
}

async function assertOpenPeriod(date) {
  const period = await checkPeriodOpen(date);
  if (!period.isOpen) throw postingError(period.message);
}

async function findExisting(h, source) {
  if (!source || !source.type || source.id == null) return null;
  const params = [source.type, source.id];
  let sql = 'SELECT id, entry_no, status, total_debit FROM journal_entries WHERE reference_type = ? AND reference_id = ?';
  if (source.no != null) { sql += ' AND reference_no = ?'; params.push(String(source.no)); }
  return h.get(sql + ' ORDER BY id DESC LIMIT 1', params);
}

const actor = user => ({ id: user?.id ? Number(user.id) || null : null, name: user?.username || user?.full_name || user?.name || 'المحاسب المالي' });

async function validUserId(h, id) {
  if (!id) return null;
  const row = await h.get('SELECT id FROM users WHERE id = ?', [id]).catch(() => null);
  return row ? row.id : null;
}

/**
 * Post (or save as draft) one journal entry. Returns { id, entry_no, total_debit, total_credit, status, lines }
 * or, with dedupe and an existing entry for the same source, { id, entry_no, already_existed: true }.
 */
// syncCash=false: the caller writes its own cash-book row (vouchers record it under the voucher number).
async function post(h, { date, description, source = {}, status = 'posted', series = 'JV', lines, user, documents, dedupe = false, checkPeriod = true, syncCash = true }) {
  if (!h || typeof h.run !== 'function') throw new Error('PostingService.post requires a transaction handle');
  if (!date || !description || !String(description).trim()) throw postingError('تاريخ القيد والبيان حقول إلزامية');
  if (!['posted', 'draft'].includes(status)) throw postingError('حالة القيد يجب أن تكون مسودة أو مرحّل');
  if (checkPeriod) await assertOpenPeriod(date);
  if (dedupe) {
    const existing = await findExisting(h, source);
    if (existing) return { id: existing.id, entry_no: existing.entry_no, status: existing.status, already_existed: true };
  }
  const prepared = await prepareLines(h, lines);
  const entryNo = await Numbering.nextJournalNumber(h, { series, date });
  const who = actor(user);
  const userId = await validUserId(h, who.id);
  const total = Money.fromFils(prepared.total);
  const posted = status === 'posted';
  const res = await h.run(`INSERT INTO journal_entries (entry_no, date, description, reference_type, reference_id, reference_no,
      total_debit, total_credit, status, created_by, created_by_name, posted_by, posted_by_name, posted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    entryNo, date, String(description).trim(), source.type || 'قيد يدوي', source.id ?? null, source.no != null ? String(source.no).trim() : null,
    total, total, status, userId, who.name, posted ? userId : null, posted ? who.name : null, posted ? new Date().toISOString() : null]);
  const id = Number(res.lastInsertRowid || res.insertId);
  for (const l of prepared.lines) {
    await h.run('INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, party_type, party_id, debit, credit, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, l.account_id, l.cost_center_id, l.project_id, l.party_type, l.party_id, Money.fromFils(l.debit), Money.fromFils(l.credit), l.notes]);
  }
  if (documents) await require('../supportingDocumentService').saveDocuments(h, 'journal', id, documents);
  if (posted && syncCash) await require('../accountingService').syncJournalCashMovements(h, id);
  return { id, entry_no: entryNo, total_debit: total, total_credit: total, status,
    lines: prepared.lines.map(l => ({ account_id: l.account_id, account: l.account, cost_center_id: l.cost_center_id, project_id: l.project_id, debit: Money.fromFils(l.debit), credit: Money.fromFils(l.credit) })) };
}

/** Storno: posts the exact mirror of the original lines and marks the original with reversal_ref_id. */
async function reverse(h, { entry, lines }, { date, description, referenceType, referenceId, user, reason, syncCash = true, lineNote = null }) {
  const who = actor(user);
  const userId = await validUserId(h, who.id);
  const entryNo = await Numbering.nextJournalNumber(h, { series: 'REV', date });
  const res = await h.run(`INSERT INTO journal_entries (entry_no, date, description, reference_type, reference_id, reference_no,
      total_debit, total_credit, status, created_by, created_by_name, posted_by, posted_by_name, posted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
  [entryNo, date, description, referenceType, referenceId, entry.entry_no, Number(entry.total_credit), Number(entry.total_debit), userId, who.name, userId, who.name]);
  const id = Number(res.lastInsertRowid || res.insertId);
  for (const line of lines) {
    await h.run('INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, party_type, party_id, debit, credit, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, line.account_id, line.cost_center_id ?? null, line.project_id ?? null, line.party_type ?? null, line.party_id ?? null, Number(line.credit) || 0, Number(line.debit) || 0, lineNote ? lineNote(line) : `عكس سطر القيد ${entry.entry_no} - ${reason}`]);
  }
  await h.run(`UPDATE journal_entries SET reversed_by = ?, reversed_by_name = ?, reversed_at = CURRENT_TIMESTAMP, reversal_reason = ?, reversal_ref_id = ?
    WHERE id = ?`, [userId, who.name, reason, id, entry.id]);
  if (syncCash) await require('../accountingService').syncJournalCashMovements(h, id);
  return { id, entry_no: entryNo };
}

module.exports = { post, reverse, prepareLines, loadPostingAccount, resolveCostCenter, PARTY_TABLES };
