'use strict';
// PayrollPostingService (stage 4.5, H8/H9). Two entries per month, both through PostingService:
//   1. accrual (dated the last day of the payroll month):
//        Dr each pay component on its own expense account (basic, transport, appearance, nature of work, living, health),
//           employer social insurance, employer skills fund
//        Cr salaries payable (net), payroll tax payable, social insurance payable (employee + employer),
//           skills fund payable, employee advances (instalments recovered), penalty income (other deductions)
//   2. payment: Dr salaries payable / Cr cash or bank (net of the accrued, still unpaid records).
// Accounts come from system account roles, never from name matching. Only records not yet accrued are accrued.
const db = require('../../database/db');
const { checkPeriodOpen } = require('../periodService');
const SystemAccounts = require('../systemAccountService');
const PostingService = require('../ledger/postingService');
const Money = require('../ledger/money');

const payrollError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const F = v => Money.toFils(v || 0);

const COMPONENTS = [
  ['transport_allowance', 'PAYROLL_TRANSPORT_EXPENSE', 'بدل انتقال'],
  ['appearance_allowance', 'PAYROLL_APPEARANCE_EXPENSE', 'بدل مظهر'],
  ['nature_of_work_allowance', 'PAYROLL_NATURE_EXPENSE', 'بدل طبيعة العمل'],
  ['living_allowance', 'PAYROLL_LIVING_EXPENSE', 'بدل معيشة'],
  ['health_insurance_allowance', 'PAYROLL_HEALTH_EXPENSE', 'تأمين صحي']
];

function monthEnd(month) {
  if (!/^\d{4}-\d{2}$/.test(String(month))) throw payrollError('صيغة شهر المسير يجب أن تكون YYYY-MM');
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

async function assertOpen(date) {
  const p = await checkPeriodOpen(date);
  if (!p.isOpen) throw payrollError(p.message, 403);
}

// The payroll row stores the cost centre as text ("الإدارة العامة CC-100" or just a name): match code first, then name.
async function costCenterOf(h, text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const active = "COALESCE(status, 'active') = 'active'";
  const code = raw.match(/cc-\d+/i)?.[0];
  if (code) {
    const row = await h.get(`SELECT id FROM cost_centers WHERE LOWER(code) = LOWER(?) AND ${active}`, [code]);
    if (row) return row.id;
  }
  const name = raw.replace(/cc-\d+/i, '').trim();
  const row = await h.get(`SELECT id FROM cost_centers WHERE (name = ? OR name LIKE ?) AND ${active} ORDER BY LENGTH(name) LIMIT 1`, [name, name + '%']);
  return row ? row.id : null;
}

/** Per-record amounts in fils, with the identity gross = net + employee insurance + tax + deductions + unpaid leave checked. */
function recordAmounts(r) {
  const gross = r.gross_salary != null ? F(r.gross_salary) : F(r.basic_salary) + F(r.overtime_amount) + F(r.allowances);
  const insEmp = F(r.insurance_employee); const insOrg = F(r.insurance_employer); const skills = F(r.skills_fund);
  const tax = F(r.tax_amount); const deductions = F(r.deductions); const unpaid = F(r.unpaid_leave_deduction);
  const net = r.total_net_salary != null ? F(r.total_net_salary) : F(r.net_salary);
  const loans = Math.min(deductions, r.loan_installments != null ? F(r.loan_installments) : deductions);
  const otherDeductions = deductions - loans;
  if (Math.abs(gross - insEmp - tax - deductions - unpaid - net) > 1) {
    throw payrollError(`مسير الموظف ${r.full_name || r.employee_id} غير متسق: الإجمالي ${Money.fromFils(gross)} لا يساوي الصافي ${Money.fromFils(net)} + الاستقطاعات`);
  }
  const components = COMPONENTS.map(([col, role, label]) => ({ role, label, amount: F(r[col]) }));
  const allowancesTotal = components.reduce((s, c) => s + c.amount, 0);
  // basic = whatever of the gross is not an itemised allowance, less unpaid leave (which reduces the cost, not a liability)
  const basic = gross - allowancesTotal - unpaid;
  return { gross, insEmp, insOrg, skills, tax, deductions, loans, otherDeductions, unpaid, net, basic, components };
}

/** Builds the accrual lines for a set of records (grouped by cost centre). Returns { lines, totals }. */
async function accrualLines(h, records, month) {
  const groups = new Map();
  const totals = { gross: 0, insEmp: 0, insOrg: 0, skills: 0, tax: 0, loans: 0, otherDeductions: 0, unpaid: 0, net: 0 };
  for (const r of records) {
    const a = recordAmounts(r);
    for (const k of Object.keys(totals)) totals[k] += a[k];
    const cc = await costCenterOf(h, r.cost_center);
    const g = groups.get(cc) || { basic: 0, insOrg: 0, skills: 0, comp: new Map() };
    g.basic += a.basic; g.insOrg += a.insOrg; g.skills += a.skills;
    for (const c of a.components) if (c.amount) g.comp.set(c.role, { label: c.label, amount: (g.comp.get(c.role)?.amount || 0) + c.amount });
    groups.set(cc, g);
  }
  const has = async role => !!(await SystemAccounts.resolveOptional(role, h));
  const lines = [];
  for (const [cc, g] of groups) {
    let basic = g.basic;
    for (const [role, c] of g.comp) {
      if (await has(role)) lines.push({ role, costCenterId: cc, debit: Money.fromFils(c.amount), notes: `${c.label} - مسير ${month}` });
      else basic += c.amount; // no dedicated account mapped: stays with basic salaries
    }
    if (basic) lines.push({ role: 'PAYROLL_BASIC_EXPENSE', costCenterId: cc, debit: Money.fromFils(basic), notes: `المرتبات والأجور الأساسية - مسير ${month}` });
    if (g.insOrg) lines.push({ role: 'PAYROLL_SOCIAL_INSURANCE_EXPENSE', costCenterId: cc, debit: Money.fromFils(g.insOrg), notes: `مساهمة المنشأة في التأمينات - مسير ${month}` });
    if (g.skills) lines.push({ role: 'PAYROLL_SKILLS_FUND_EXPENSE', costCenterId: cc, debit: Money.fromFils(g.skills), notes: `مساهمة صندوق تنمية المهارات - مسير ${month}` });
  }
  const credit = (role, amount, notes) => { if (amount) lines.push({ role, credit: Money.fromFils(amount), notes }); };
  credit('SALARIES_PAYABLE', totals.net, `صافي رواتب مستحقة الدفع - مسير ${month}`);
  credit('PAYROLL_TAX_PAYABLE', totals.tax, `ضريبة كسب العمل المستقطعة - مسير ${month}`);
  credit('SOCIAL_INSURANCE_PAYABLE', totals.insEmp + totals.insOrg, `التأمينات الاجتماعية (حصة العامل + حصة المنشأة) - مسير ${month}`);
  credit('SKILLS_FUND_PAYABLE', totals.skills, `صندوق تنمية المهارات - مسير ${month}`);
  credit('EMPLOYEE_ADVANCES', totals.loans, `استرداد أقساط سلف الموظفين - مسير ${month}`);
  credit('PAYROLL_PENALTY_INCOME', totals.otherDeductions, `جزاءات وخصومات أخرى - مسير ${month}`);
  return { lines, totals };
}

const MONTH_SQL = 'SELECT p.*, e.full_name FROM payroll p JOIN employees e ON e.id = p.employee_id WHERE p.payroll_month = ?';

/** Preview without posting: the same lines the accrual will post, resolved to accounts. */
async function preview(month) {
  const records = await db.query(MONTH_SQL + ' AND p.journal_entry_id IS NULL', [month]);
  const all = await db.query(MONTH_SQL, [month]);
  if (!all.length) throw payrollError(`لا توجد مسيرات رواتب لشهر ${month}`, 404);
  const { lines, totals } = await accrualLines(db, records, month);
  const resolved = [];
  for (const l of lines) {
    const acc = await SystemAccounts.resolveOptional(l.role, db);
    const cc = l.costCenterId ? await db.get('SELECT code, name FROM cost_centers WHERE id = ?', [l.costCenterId]) : null;
    resolved.push({ side: l.debit ? 'مدين (منه)' : 'دائن (له)', role: l.role, account_code: acc?.code || '—', account_name: acc?.name || `غير مربوط: ${l.role}`,
      debit: l.debit || 0, credit: l.credit || 0, cost_center: cc ? `${cc.code} ${cc.name}` : '—', notes: l.notes, mapped: !!acc });
  }
  const debit = resolved.reduce((s, l) => s + F(l.debit), 0); const credit = resolved.reduce((s, l) => s + F(l.credit), 0);
  return { month, accrual_date: monthEnd(month), employee_count: all.length, pending_count: records.length, lines: resolved,
    summary: { total_gross: Money.fromFils(totals.gross), insurance_employer_9pct: Money.fromFils(totals.insOrg), insurance_employee_6pct: Money.fromFils(totals.insEmp),
      total_insurance_15pct: Money.fromFils(totals.insEmp + totals.insOrg), total_skills_fund_1pct: Money.fromFils(totals.skills), total_tax: Money.fromFils(totals.tax),
      total_advances: Money.fromFils(totals.loans), total_other_deductions: Money.fromFils(totals.otherDeductions), total_net_payable: Money.fromFils(totals.net),
      total_debit: Money.fromFils(debit), total_credit: Money.fromFils(credit), diff: Money.fromFils(Math.abs(debit - credit)), is_balanced: debit === credit,
      unmapped_roles: resolved.filter(l => !l.mapped).map(l => l.role) } };
}

/** Applies the recovered instalments to the employee's active advances, oldest first. */
async function recoverAdvances(h, employeeId, amountFils) {
  let left = amountFils;
  const advances = await h.query("SELECT * FROM employee_advances WHERE employee_id = ? AND status = 'active' ORDER BY date ASC, id ASC", [employeeId]);
  for (const adv of advances) {
    if (left <= 0) break;
    const open = F(adv.amount) - F(adv.recovered_amount);
    if (open <= 0) continue;
    const take = Math.min(open, left);
    const recovered = F(adv.recovered_amount) + take;
    await h.run('UPDATE employee_advances SET recovered_amount = ?, status = ? WHERE id = ?',
      [Money.fromFils(recovered), recovered >= F(adv.amount) ? 'settled' : 'active', adv.id]);
    left -= take;
  }
}

async function accrue(month, user) {
  const date = monthEnd(month);
  await assertOpen(date);
  return db.transaction(async tx => {
    const records = await tx.query(MONTH_SQL + ' AND p.journal_entry_id IS NULL ORDER BY p.id', [month]);
    if (!records.length) {
      const any = await tx.get('SELECT COUNT(*) AS n FROM payroll WHERE payroll_month = ?', [month]);
      throw payrollError(any.n ? `مسير رواتب شهر ${month} مستحق مسبقاً بقيد يومية` : `لا توجد مسيرات رواتب لشهر ${month}`);
    }
    const { lines, totals } = await accrualLines(tx, records, month);
    const entry = await PostingService.post(tx, {
      date, series: 'JV-PAY', user, lines,
      description: `استحقاق مسير رواتب شهر ${month} (${records.length} موظف) والتأمينات والضرائب`,
      source: { type: 'استحقاق رواتب', no: month }
    });
    for (const r of records) {
      await tx.run("UPDATE payroll SET status = 'accrued', journal_entry_id = ? WHERE id = ? AND journal_entry_id IS NULL", [entry.id, r.id]);
      const a = recordAmounts(r);
      if (a.loans > 0) await recoverAdvances(tx, r.employee_id, a.loans);
    }
    return { entry, totals, count: records.length, date };
  });
}

async function pay(month, { user, date, settlementAccountId = null, paymentMethod = 'نقدي' } = {}) {
  const payDate = date || new Date().toISOString().slice(0, 10);
  await assertOpen(payDate);
  if (payDate < monthEnd(month).slice(0, 8) + '01') throw payrollError('تاريخ صرف الرواتب يجب ألا يسبق شهر المسير');
  const Accounting = require('../accountingService');
  const settlement = settlementAccountId
    ? await Accounting.resolveVoucherSettlementAccount(paymentMethod, settlementAccountId)
    : (paymentMethod === 'تحويل بنكي' ? (await Accounting.resolveBankAccount()).coaAccount : await Accounting.resolveCashAccount());
  return db.transaction(async tx => {
    const records = await tx.query("SELECT p.* FROM payroll p WHERE p.payroll_month = ? AND p.status = 'accrued' AND p.journal_entry_id IS NOT NULL AND p.payment_journal_entry_id IS NULL", [month]);
    if (!records.length) throw payrollError(`لا توجد رواتب مستحقة غير مصروفة لشهر ${month}؛ رحّل الاستحقاق أولاً`);
    const net = records.reduce((s, r) => s + recordAmounts(r).net, 0);
    const entry = await PostingService.post(tx, {
      date: payDate, series: 'JV-PAY', user,
      description: `صرف صافي رواتب شهر ${month} (${records.length} موظف)`,
      source: { type: 'صرف رواتب', no: month },
      lines: [
        { role: 'SALARIES_PAYABLE', debit: Money.fromFils(net), notes: `سداد رواتب مستحقة - مسير ${month}` },
        { accountId: settlement.id, credit: Money.fromFils(net), notes: `صرف صافي رواتب شهر ${month}` }
      ]
    });
    for (const r of records) {
      await tx.run("UPDATE payroll SET status = 'paid', paid_date = ?, payment_journal_entry_id = ? WHERE id = ? AND payment_journal_entry_id IS NULL", [payDate, entry.id, r.id]);
    }
    return { entry, net: Money.fromFils(net), count: records.length, date: payDate };
  });
}

module.exports = { preview, accrue, pay, monthEnd, recordAmounts };
