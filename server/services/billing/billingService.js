'use strict';
// BillingService (stage 4.1): the only place that creates, approves and posts bills (مستخلصات).
// Company policy (decided 2026-11-22): revenue is recognised when an approved bill is posted.
//   Dr Accounts receivable (net) + Retention receivable + Customer advances (amortised) + WHT receivable
//   Cr Contract revenue (gross less other deductions)
// Workflow: draft -> (under_review) -> approved [by someone other than the creator] -> posted.
const db = require('../../database/db');
const { checkPeriodOpen } = require('../periodService');
const Numbering = require('../numberingService');
const PostingService = require('../ledger/postingService');
const Money = require('../ledger/money');
const clientChainService = require('../clientChainService');

// Statuses that mean "the bill is in the ledger" (legacy 'معتمد' and the collection statuses included).
const POSTED_BILL_STATUSES = ['posted', 'معتمد', 'محصل جزئي', 'محصل كامل', 'closed'];
const APPROVABLE = ['draft', 'under_review'];
const BILL_ENTRY_TYPE = 'مستخلص أعمال معتمد';
const BILL_TAX_ENTRY_TYPE = 'ضريبة مستخلص';

const billError = (message, statusCode = 400, extra = {}) => Object.assign(new Error(message), { statusCode, ...extra });
const actorOf = user => ({ id: user?.id ? Number(user.id) || null : null, name: user?.username || user?.full_name || 'مستخدم النظام' });
const isPosted = bill => POSTED_BILL_STATUSES.includes(String(bill?.status || ''));

async function validUserId(h, id) {
  if (!id) return null;
  const row = await h.get('SELECT id FROM users WHERE id = ?', [id]);
  return row ? row.id : null;
}

async function assertOpen(date) {
  const period = await checkPeriodOpen(date);
  if (!period.isOpen) throw billError(period.message, 403);
}

/**
 * Amounts of a bill in fils. `other` covers deductions that are neither advance, retention nor tax
 * (penalties, discounts): they reduce the revenue recognised, so the entry always balances.
 */
function amounts({ gross, advance = 0, retention = 0, tax = 0, totalDeduction = null }) {
  const g = Money.toFils(gross); const a = Money.toFils(advance); const r = Money.toFils(retention); const t = Money.toFils(tax);
  const declared = totalDeduction == null ? a + r + t : Money.toFils(totalDeduction);
  const other = Math.max(0, declared - a - r - t);
  const net = g - a - r - t - other;
  if (g <= 0) throw billError('يرجى تحديد المبلغ الإجمالي للمستخلص');
  if (a < 0 || r < 0 || t < 0) throw billError('الاستقطاعات لا يمكن أن تكون سالبة');
  if (net < 0) throw billError('مجموع الاستقطاعات أكبر من إجمالي المستخلص');
  return { gross: g, advance: a, retention: r, tax: t, other, net, deduction: a + r + t + other };
}
const billAmounts = bill => amounts({ gross: bill.gross_amount || bill.amount, advance: bill.advance_deduction, retention: bill.retention_deduction,
  tax: bill.tax_wht_amount, totalDeduction: bill.deduction });

async function projectCostCenter(h, projectId) {
  if (!projectId) return null;
  const row = await h.get("SELECT id FROM cost_centers WHERE project_id = ? AND COALESCE(status, 'active') = 'active' ORDER BY id LIMIT 1", [projectId]);
  return row ? row.id : null;
}

async function create(input, user) {
  const { bill_type = 'مستخلص جاري', project_id, client_id, contract_id, amount, gross_amount, deduction, advance_deduction = 0, retention_deduction = 0,
    date = new Date().toISOString().split('T')[0], notes, progress_percentage } = input;
  await assertOpen(date);
  if (!project_id || !(Number(amount || gross_amount) > 0)) throw billError('يرجى تحديد المشروع والمبلغ الإجمالي');
  const resolution = await clientChainService.resolveBillContractAndClient({ project_id, client_id, contract_id, amount: amount || gross_amount, advance_deduction, retention_deduction });
  const m = amounts({ gross: resolution.gross_amount, advance: resolution.advance_deduction, retention: resolution.retention_deduction,
    totalDeduction: deduction != null && deduction !== '' ? Math.max(Number(deduction), resolution.advance_deduction + resolution.retention_deduction) : null });
  const who = actorOf(user);
  return db.transaction(async tx => {
    const bill_no = await Numbering.next(tx, 'INV', { table: 'bills', column: 'bill_no', date });
    const creatorId = await validUserId(tx, who.id);
    const res = await tx.run(`INSERT INTO bills (bill_no, bill_type, project_id, client_id, contract_id, amount, deduction, net_amount, status, date, notes,
        gross_amount, advance_deduction, retention_deduction, paid_amount, remaining_amount, payment_status, created_by, created_by_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, 0, ?, 'unpaid', ?, ?)`, [
      bill_no, bill_type, project_id, resolution.client_id || null, resolution.contract_id || null,
      Money.fromFils(m.gross), Money.fromFils(m.deduction), Money.fromFils(m.net), date, notes || '',
      Money.fromFils(m.gross), Money.fromFils(m.advance), Money.fromFils(m.retention), Money.fromFils(m.net), creatorId, who.name]);
    const id = Number(res.lastInsertRowid || res.insertId);
    if (progress_percentage !== undefined && progress_percentage !== null) {
      const newProg = Math.min(100, Math.max(0, parseFloat(progress_percentage) || 0));
      const old = await tx.get('SELECT progress_percentage FROM projects WHERE id = ?', [project_id]);
      const oldProg = old ? Number(old.progress_percentage) || 0 : 0;
      if (newProg !== oldProg && newProg > 0) {
        await tx.run('UPDATE projects SET progress_percentage = ? WHERE id = ?', [newProg, project_id]);
        await tx.run('INSERT INTO project_progress_history (project_id, previous_percentage, new_percentage, notes, recorded_by, date) VALUES (?, ?, ?, ?, ?, ?)',
          [project_id, oldProg, newProg, `تحديث نسبة الإنجاز تلقائياً مع إصدار ${bill_type} رقم ${bill_no}`, who.name, date]);
      }
    }
    return { id, bill_no, status: 'draft', gross_amount: Money.fromFils(m.gross), net_amount: Money.fromFils(m.net), client_id: resolution.client_id };
  });
}

async function update(id, input) {
  return db.transaction(async tx => {
    const bill = await tx.get('SELECT * FROM bills WHERE id = ?', [id]);
    if (!bill) throw billError('المستخلص غير موجود', 404);
    if (!['draft', 'under_review'].includes(bill.status)) throw billError(`لا يمكن تعديل مستخلص في حالة [${bill.status}]؛ التصحيح يتم بقيد عكسي`, 400, { immutable: true });
    const date = input.date || bill.date;
    await assertOpen(bill.date); await assertOpen(date);
    const m = amounts({ gross: input.amount ?? bill.gross_amount ?? bill.amount,
      advance: input.advance_deduction ?? bill.advance_deduction, retention: input.retention_deduction ?? bill.retention_deduction, tax: bill.tax_wht_amount,
      totalDeduction: input.deduction ?? null });
    const paid = Money.toFils(bill.paid_amount);
    // H12: the remaining amount always follows the net amount
    await tx.run(`UPDATE bills SET amount = ?, gross_amount = ?, advance_deduction = ?, retention_deduction = ?, deduction = ?, net_amount = ?,
        remaining_amount = ?, notes = COALESCE(?, notes), date = ? WHERE id = ?`,
    [Money.fromFils(m.gross), Money.fromFils(m.gross), Money.fromFils(m.advance), Money.fromFils(m.retention), Money.fromFils(m.deduction),
      Money.fromFils(m.net), Money.fromFils(Math.max(0, m.net - paid)), input.notes ?? null, date, id]);
    return { before: { gross_amount: bill.gross_amount, net_amount: bill.net_amount, date: bill.date }, after: { gross_amount: Money.fromFils(m.gross), net_amount: Money.fromFils(m.net), date }, bill };
  });
}

async function approve(id, user, notes) {
  const who = actorOf(user);
  return db.transaction(async tx => {
    const bill = await tx.get('SELECT * FROM bills WHERE id = ?', [id]);
    if (!bill) throw billError('المستخلص غير موجود', 404);
    if (!APPROVABLE.includes(bill.status)) throw billError(`لا يمكن اعتماد المستخلص في حالة [${bill.status}]`);
    require('../financialControlService').assertMakerChecker(bill, user, 'اعتماد');
    await assertOpen(bill.date);
    const approverId = await validUserId(tx, who.id);
    const r = await tx.run(`UPDATE bills SET status = 'approved', approved_by = ?, approved_by_name = ?, approved_at = CURRENT_TIMESTAMP, approval_notes = ?
      WHERE id = ? AND status = ?`, [approverId, who.name, notes || null, id, bill.status]);
    if (!Number(r.changes ?? r.affectedRows ?? 1)) throw billError('تغيرت حالة المستخلص أثناء الاعتماد؛ أعد المحاولة', 409);
    return { bill, approved_by: who.name };
  });
}

/** Build the posting lines of a bill (in currency units; PostingService converts to fils). */
async function billLines(h, bill) {
  const m = billAmounts(bill);
  const center = await projectCostCenter(h, bill.project_id);
  const base = { projectId: bill.project_id, costCenterId: center };
  const client = bill.client_id ? { partyType: 'client', partyId: bill.client_id } : {};
  const lines = [];
  if (m.net > 0) lines.push({ ...base, ...client, role: 'ACCOUNTS_RECEIVABLE', debit: Money.fromFils(m.net), notes: `ذمم عملاء - صافي ${bill.bill_type || 'مستخلص'} رقم ${bill.bill_no}` });
  if (m.retention > 0) lines.push({ ...base, ...client, role: 'RETENTION_RECEIVABLE', debit: Money.fromFils(m.retention), notes: `محتجز ضمان مستقطع - ${bill.bill_no}` });
  if (m.advance > 0) lines.push({ ...base, ...client, role: 'CUSTOMER_ADVANCES', debit: Money.fromFils(m.advance), notes: `استهلاك دفعة مقدمة - ${bill.bill_no}` });
  if (m.tax > 0) lines.push({ ...base, ...client, role: 'WHT_RECEIVABLE', debit: Money.fromFils(m.tax), notes: `ضريبة مخصومة من المنبع - ${bill.bill_no}` });
  lines.push({ ...base, role: 'CONTRACT_REVENUE', credit: Money.fromFils(m.gross - m.other), notes: `إيراد ${bill.bill_type || 'مستخلص'} رقم ${bill.bill_no}${m.other ? ' (بعد استقطاعات أخرى)' : ''}` });
  return { lines, m };
}

async function post(id, user) {
  const who = actorOf(user);
  return db.transaction(async tx => {
    const bill = await tx.get('SELECT * FROM bills WHERE id = ?', [id]);
    if (!bill) throw billError('المستخلص غير موجود', 404);
    if (isPosted(bill)) throw billError('المستخلص مرحل مسبقاً');
    if (bill.status === 'reversed') throw billError('لا يمكن ترحيل مستخلص تم عكسه مسبقاً');
    if (bill.status !== 'approved') throw billError('لا يُرحّل المستخلص إلا بعد اعتماده من مستخدم غير منشئه (draft ← approved ← posted)');
    await assertOpen(bill.date);
    // H6: claim the bill inside the transaction so a second request cannot post it again
    const claim = await tx.run("UPDATE bills SET status = 'posted' WHERE id = ? AND status = 'approved'", [id]);
    if (!Number(claim.changes ?? claim.affectedRows ?? 1)) throw billError('المستخلص قيد الترحيل من طلب آخر', 409);
    const { lines, m } = await billLines(tx, bill);
    const entry = await PostingService.post(tx, {
      date: bill.date, series: 'JE', user,
      description: `استحقاق ${bill.bill_type || 'مستخلص'} رقم ${bill.bill_no} - إجمالي منجز: ${Money.fromFils(m.gross).toLocaleString()} ر.ي`,
      source: { type: BILL_ENTRY_TYPE, id: bill.id, no: bill.bill_no }, dedupe: true, lines
    });
    if (entry.already_existed) throw billError(`للمستخلص قيد مرحّل مسبقاً (${entry.entry_no})`, 409);
    const posterId = await validUserId(tx, who.id);
    const paid = Money.toFils(bill.paid_amount);
    await tx.run(`UPDATE bills SET posted_by = ?, posted_by_name = ?, posted_at = CURRENT_TIMESTAMP, journal_entry_id = ?, remaining_amount = ? WHERE id = ?`,
      [posterId, who.name, entry.id, Money.fromFils(Math.max(0, m.net - paid)), id]);
    if (m.tax > 0) await tx.run("UPDATE tax_withholdings SET journal_entry_id = ? WHERE source_doc_type = 'bill' AND source_doc_id = ? AND journal_entry_id IS NULL", [entry.id, id]);
    if (bill.client_id) await clientChainService.syncClientBalances(bill.client_id, tx);
    return { bill, entry };
  });
}

/**
 * Withholding tax deducted by the client (H10: never invents a retention).
 * Unposted bill: stores the tax on the bill; posting adds the WHT line.
 * Posted bill: a small entry Dr WHT receivable / Cr accounts receivable; the bill entry is untouched.
 */
async function applyWithholdingTax(id, taxRate, user) {
  const rate = Number(taxRate);
  if (!(rate > 0 && rate < 100)) throw billError('نسبة الضريبة غير صالحة');
  return db.transaction(async tx => {
    const bill = await tx.get('SELECT b.*, p.name AS project_name FROM bills b LEFT JOIN projects p ON p.id = b.project_id WHERE b.id = ?', [id]);
    if (!bill) throw billError('المستخلص غير موجود في النظام', 404);
    if (['reversed', 'cancelled'].includes(bill.status)) throw billError(`لا يمكن احتساب ضريبة لمستخلص في حالة [${bill.status}]`);
    if (Number(bill.tax_wht_amount) > 0) throw billError(`ضريبة الخصم من المنبع محتسبة مسبقاً لهذا المستخلص (${bill.tax_wht_amount})`, 409);
    await assertOpen(bill.date);
    const before = billAmounts(bill);
    const tax = Math.round(before.gross * rate / 100);
    const after = amounts({ gross: Money.fromFils(before.gross), advance: Money.fromFils(before.advance), retention: Money.fromFils(before.retention),
      tax: Money.fromFils(tax), totalDeduction: Money.fromFils(before.deduction + tax) });
    const paid = Money.toFils(bill.paid_amount);
    if (paid > after.net) throw billError('المحصّل من المستخلص أكبر من صافيه بعد الضريبة؛ راجع سندات القبض أولاً');
    await tx.run('UPDATE bills SET tax_wht_rate = ?, tax_wht_amount = ?, net_amount = ?, deduction = ?, remaining_amount = ? WHERE id = ?',
      [rate, Money.fromFils(tax), Money.fromFils(after.net), Money.fromFils(after.deduction), Money.fromFils(Math.max(0, after.net - paid)), id]);
    let entry = null;
    if (isPosted(bill) && tax > 0) {
      const center = await projectCostCenter(tx, bill.project_id);
      entry = await PostingService.post(tx, {
        date: bill.date, series: 'JV-TAX', user,
        description: `ضريبة خصم من المنبع ${rate}% على المستخلص ${bill.bill_no}${bill.project_name ? ' - ' + bill.project_name : ''}`,
        source: { type: BILL_TAX_ENTRY_TYPE, id: bill.id, no: bill.bill_no }, dedupe: true,
        lines: [
          { role: 'WHT_RECEIVABLE', debit: Money.fromFils(tax), projectId: bill.project_id, costCenterId: center, partyType: bill.client_id ? 'client' : null, partyId: bill.client_id, notes: `ضريبة مخصومة من المنبع (${rate}%) - ${bill.bill_no}` },
          { role: 'ACCOUNTS_RECEIVABLE', credit: Money.fromFils(tax), projectId: bill.project_id, costCenterId: center, partyType: bill.client_id ? 'client' : null, partyId: bill.client_id, notes: `تخفيض ذمة العميل بالضريبة المخصومة - ${bill.bill_no}` }
        ]
      });
    }
    const withholding_no = await Numbering.next(tx, 'WHT-REC', { table: 'tax_withholdings', column: 'withholding_no', date: bill.date });
    await tx.run(`INSERT INTO tax_withholdings (withholding_no, type, project_id, client_id, source_doc_type, source_doc_id, base_amount, tax_rate, tax_amount, tax_period, date, journal_entry_id, status)
      VALUES (?, 'deducted_from_client', ?, ?, 'bill', ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [withholding_no, bill.project_id, bill.client_id, id, Money.fromFils(before.gross), rate, Money.fromFils(tax), String(bill.date).slice(0, 7), bill.date, entry ? entry.id : (isPosted(bill) ? bill.journal_entry_id : null)]);
    if (bill.client_id && isPosted(bill)) await clientChainService.syncClientBalances(bill.client_id, tx);
    return {
      bill_no: bill.bill_no, gross_amount: Money.fromFils(before.gross), advance_deduction: Money.fromFils(before.advance), retention_deduction: Money.fromFils(before.retention),
      tax_wht_rate: rate, tax_wht_amount: Money.fromFils(tax), net_amount: Money.fromFils(after.net),
      journal_entry_no: entry ? entry.entry_no : null, withholding_no, posted_now: !!entry
    };
  });
}

module.exports = { create, update, approve, post, applyWithholdingTax, billLines, amounts, isPosted, POSTED_BILL_STATUSES, BILL_ENTRY_TYPE, BILL_TAX_ENTRY_TYPE };
