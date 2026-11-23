const express = require('express');
const PayrollPosting = require('../services/payroll/payrollPostingService');
const router = express.Router();
const { query, get, run, transaction } = require('../database/db');
const { logAudit } = require('../services/auditService');
const { checkPeriodOpen } = require('../services/periodService');
const PayrollService = require('../services/payrollService');
const { requirePermission, parseScopeArray } = require('../middleware/security');

const today = () => new Date().toISOString().slice(0, 10);
const number = value => Number(value) || 0;

// مؤشرات الموارد البشرية: القوة العاملة، الحضور، الرواتب والسلف المستحقة.
router.get('/dashboard', requirePermission('hr:view'), async (_req, res) => {
  try {
    const [employees, attendance, payroll, advances, leaves] = await Promise.all([
      get("SELECT COUNT(*) AS count FROM employees WHERE status = 'active'"),
      get("SELECT COUNT(*) AS count FROM attendance WHERE date = ? AND status = 'present'", [today()]),
      get("SELECT COALESCE(SUM(net_salary), 0) AS total FROM payroll WHERE status != 'paid'"),
      get("SELECT COALESCE(SUM(amount - recovered_amount), 0) AS total FROM employee_advances WHERE status = 'active'"),
      get("SELECT COUNT(*) AS count FROM employee_leaves WHERE status = 'pending'")
    ]);
    res.json({ success: true, data: {
      activeEmployees: number(employees?.count), presentToday: number(attendance?.count),
      unpaidPayroll: number(payroll?.total), activeAdvances: number(advances?.total), pendingLeaves: number(leaves?.count)
    }});
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/employees', requirePermission('hr:view'), async (req, res) => {
  try {
    let sql = `SELECT e.*, p.name AS project_name FROM employees e LEFT JOIN projects p ON p.id = e.project_id`;
    const params = [];
    const conditions = [];

    const allowedProjects = parseScopeArray(req.user?.scope?.allowed_projects || req.user?.allowed_projects);
    if (allowedProjects.length > 0 && !allowedProjects.includes('*') && !allowedProjects.includes('all')) {
      const placeholders = allowedProjects.map(() => '?').join(',');
      conditions.push(`(e.project_id IS NULL OR e.project_id IN (${placeholders}))`);
      params.push(...allowedProjects);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ` ORDER BY e.status = 'active' DESC, e.full_name`;
    const rows = await query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/employees', requirePermission('hr:create'), async (req, res) => {
  try {
    const { employee_no, full_name, national_id, phone, job_title, department, project_id, employment_type, hire_date, basic_salary, currency, status, bank_name, bank_account, notes } = req.body;
    if (!full_name?.trim()) return res.status(400).json({ success: false, message: 'اسم الموظف مطلوب' });
    const count = await get('SELECT COUNT(*) AS count FROM employees');
    const code = employee_no?.trim() || `EMP-${String(number(count?.count) + 1).padStart(4, '0')}`;
    const result = await run(`INSERT INTO employees (employee_no, full_name, national_id, phone, job_title, department, project_id, employment_type, hire_date, basic_salary, currency, status, bank_name, bank_account, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [code, full_name.trim(), national_id || '', phone || '', job_title || '', department || '', project_id || null, employment_type || 'دوام كامل', hire_date || today(), number(basic_salary), currency || 'ر.ي', status || 'active', bank_name || '', bank_account || '', notes || '']);
    res.json({ success: true, id: result.lastInsertRowid || result.insertId, message: 'تمت إضافة الموظف بنجاح' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.put('/employees/:id', requirePermission('hr:edit'), async (req, res) => {
  try {
    const fields = ['full_name','national_id','phone','job_title','department','project_id','employment_type','hire_date','basic_salary','currency','status','bank_name','bank_account','notes'];
    const values = fields.map(key => req.body[key] ?? null);
    await run(`UPDATE employees SET full_name=COALESCE(?,full_name), national_id=COALESCE(?,national_id), phone=COALESCE(?,phone), job_title=COALESCE(?,job_title), department=COALESCE(?,department), project_id=COALESCE(?,project_id), employment_type=COALESCE(?,employment_type), hire_date=COALESCE(?,hire_date), basic_salary=COALESCE(?,basic_salary), currency=COALESCE(?,currency), status=COALESCE(?,status), bank_name=COALESCE(?,bank_name), bank_account=COALESCE(?,bank_account), notes=COALESCE(?,notes) WHERE id=?`, [...values, req.params.id]);
    res.json({ success: true, message: 'تم تحديث بيانات الموظف' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/attendance', requirePermission('hr:view'), async (req, res) => {
  try {
    const date = req.query.date || today();
    const rows = await query(`SELECT a.*, e.full_name, e.employee_no FROM attendance a JOIN employees e ON e.id=a.employee_id WHERE a.date=? ORDER BY e.full_name`, [date]);
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/attendance', requirePermission('hr:create'), async (req, res) => {
  try {
    const { employee_id, date, status, check_in, check_out, overtime_hours, notes } = req.body;
    if (!employee_id) return res.status(400).json({ success: false, message: 'اختر الموظف' });
    const existing = await get('SELECT id FROM attendance WHERE employee_id=? AND date=?', [employee_id, date || today()]);
    if (existing) await run('UPDATE attendance SET status=?, check_in=?, check_out=?, overtime_hours=?, notes=? WHERE id=?', [status || 'present', check_in || null, check_out || null, number(overtime_hours), notes || '', existing.id]);
    else await run('INSERT INTO attendance (employee_id,date,status,check_in,check_out,overtime_hours,notes) VALUES (?,?,?,?,?,?,?)', [employee_id, date || today(), status || 'present', check_in || null, check_out || null, number(overtime_hours), notes || '']);
    res.json({ success: true, message: 'تم حفظ سجل الحضور' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/leaves', requirePermission('hr:view'), async (_req, res) => {
  try {
    const rows = await query('SELECT l.*, e.full_name FROM employee_leaves l JOIN employees e ON e.id=l.employee_id ORDER BY l.created_at DESC');
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/leaves', requirePermission('hr:create'), async (req, res) => {
  try {
    const { employee_id, leave_type, start_date, end_date, days_count, status, notes } = req.body;
    if (!employee_id || !start_date || !end_date) return res.status(400).json({ success: false, message: 'الموظف وفترة الإجازة مطلوبان' });
    await run('INSERT INTO employee_leaves (employee_id, leave_type, start_date, end_date, days_count, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [employee_id, leave_type || 'سنوية', start_date, end_date, number(days_count) || 1, status || 'pending', notes || '']);
    res.json({ success: true, message: 'تم تسجيل طلب الإجازة' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/leaves/:id/status', requirePermission('hr:approve'), async (req, res) => {
  try {
    await run('UPDATE employee_leaves SET status=? WHERE id=?', [req.body.status || 'approved', req.params.id]);
    res.json({ success: true, message: 'تم تحديث حالة الإجازة' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/leave-types', requirePermission('hr:view'), async (_req, res) => {
  try {
    const types = await query('SELECT * FROM leave_types ORDER BY is_paid DESC, id ASC');
    res.json({ success: true, data: types });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب أنواع الإجازات: ' + err.message });
  }
});

router.post('/leave-types', requirePermission('hr:create'), async (req, res) => {
  try {
    const { name, days_per_year = 30, is_paid = 1, description = '' } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ success: false, message: 'اسم نوع الإجازة مطلوب' });
    const result = await run(`
      INSERT INTO leave_types (name, days_per_year, days_allowed, is_paid, description, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [name.trim(), number(days_per_year), number(days_per_year), is_paid ? 1 : 0, description.trim(), description.trim()]);
    res.json({ success: true, message: 'تمت إضافة نوع الإجازة بنجاح', id: result.lastInsertRowid || result.insertId });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/advances', requirePermission('hr:view'), async (_req, res) => {
  try {
    const rows = await query(`SELECT a.*, e.full_name, e.employee_no FROM employee_advances a JOIN employees e ON e.id = a.employee_id ORDER BY a.id DESC`);
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/advances', requirePermission('hr:create'), async (req, res) => {
  try {
    const { employee_id, amount, request_date = today(), installment_amount, reason, payment_method = 'نقدي', settlement_account_id } = req.body;
    const employee = employee_id ? await get('SELECT id, full_name FROM employees WHERE id = ?', [employee_id]) : null;
    if (!employee) return res.status(400).json({ success: false, message: 'يرجى اختيار الموظف' });
    if (!(number(amount) > 0)) return res.status(400).json({ success: false, message: 'مبلغ السلفة يجب أن يكون أكبر من الصفر' });
    if (number(installment_amount) < 0 || number(installment_amount) > number(amount)) return res.status(400).json({ success: false, message: 'القسط الشهري يجب أن يكون بين الصفر ومبلغ السلفة' });
    if (!['نقدي', 'تحويل بنكي'].includes(payment_method)) return res.status(400).json({ success: false, message: 'طريقة الدفع المتاحة هي نقداً أو تحويل بنكي فقط' });
    // السلفة المصروفة قيد (مدين سلف الموظفين / دائن الصندوق أو البنك) + حركة صندوق؛ المسير يستردها دائناً لاحقاً
    const { id, entry } = await transaction(async tx => {
      const ins = await tx.run('INSERT INTO employee_advances (employee_id,amount,request_date,date,installment_amount,reason,notes) VALUES (?,?,?,?,?,?,?)',
        [employee.id, number(amount), request_date, request_date, number(installment_amount), reason, reason]);
      const advanceId = ins.lastInsertRowid || ins.insertId;
      const { entry } = await require('../services/ledger/employeeFundsService').postAdvance(tx, {
        advanceId, date: request_date, amount: number(amount), employeeId: employee.id, employeeName: employee.full_name,
        paymentMethod: payment_method, settlementAccountId: settlement_account_id || null, user: req.user
      });
      return { id: advanceId, entry };
    });
    await logAudit(req, {
      action: 'INSERT',
      entity_type: 'advance',
      entity_id: employee_id,
      details: { amount, installment_amount, reason, entry_no: entry.entry_no }
    });
    res.json({ success: true, message: 'تم تسجيل السلفة وترحيل قيد صرفها', id, journal_entry_id: entry.id, entry_no: entry.entry_no });
  } catch (err) { res.status(err.statusCode || 500).json({ success: false, message: err.message }); }
});

router.get('/payroll', requirePermission('hr:view,hr:payroll'), async (req, res) => {
  try {
    const month = req.query.month;
    let sql = `SELECT p.*, e.full_name, e.employee_no, e.job_title, e.department, 
               COALESCE(p.bank_account, e.bank_account, '') as bank_account, 
               COALESCE(p.cost_center, e.cost_center, 'الإدارة العامة') as cost_center 
               FROM payroll p 
               JOIN employees e ON e.id=p.employee_id`;
    const params = [];
    if (month) {
      sql += ' WHERE p.payroll_month=?';
      params.push(month);
    }
    sql += ' ORDER BY p.payroll_month DESC, p.id ASC, e.employee_no ASC';
    res.json({ success: true, data: await query(sql, params) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// إعداد واحتساب مسير الرواتب وفق القواعد النظامية الشاملة المعتمدة
router.post('/payroll/generate', requirePermission('hr:create,hr:payroll'), async (req, res) => {
  try {
    const payrollMonth = req.body.payroll_month || today().slice(0, 7);
    const employees = await query("SELECT * FROM employees WHERE status='active' ORDER BY id ASC");
    if (!employees || employees.length === 0) {
      return res.status(400).json({ success: false, message: 'لا يوجد موظفون نشطون لإعداد المسير' });
    }

    const result = await transaction(async tx => {
      let created = 0;
      for (const e of employees) {
        const exists = await tx.get('SELECT id FROM payroll WHERE employee_id=? AND payroll_month=?', [e.id, payrollMonth]);
        if (exists) continue;

        const advances = await tx.get("SELECT COALESCE(SUM(CASE WHEN installment_amount > 0 THEN MIN(installment_amount, amount-recovered_amount) ELSE 0 END),0) AS total FROM employee_advances WHERE employee_id=? AND status='active'", [e.id]);
        const overtime = await tx.get("SELECT COALESCE(SUM(overtime_hours),0) AS hours FROM attendance WHERE employee_id=? AND substr(date,1,7)=?", [e.id, payrollMonth]);

        const basic = number(e.basic_salary);
        const workingDays = 31;
        const monthDays = 31;
        const earnedBasic = Math.round(basic * (workingDays / monthDays));

        const transportPct = e.transport_pct != null ? number(e.transport_pct) : 20;
        const appearancePct = e.appearance_pct != null ? number(e.appearance_pct) : 25;
        const natureOfWorkPct = e.nature_of_work_pct != null ? number(e.nature_of_work_pct) : 30;

        const transport = Math.round(earnedBasic * (transportPct / 100));
        const appearance = Math.round(earnedBasic * (appearancePct / 100));
        const nature = Math.round(earnedBasic * (natureOfWorkPct / 100));
        const living = e.living_allowance != null ? number(e.living_allowance) : 90000;
        const health = e.health_insurance_allowance != null ? number(e.health_insurance_allowance) : 30000;

        const totalAllowances = transport + appearance + nature + living + health;
        const gross = earnedBasic + totalAllowances;

        // التأمينات 6% موظف و 9% منشأة على الراتب الشامل
        const insEmp = Math.round(gross * 0.06);
        const insOrg = Math.round(gross * 0.09);

        // الخصميات والجزاءات وأقساط السلف
        const advanceDeductions = number(advances?.total);
        const totalDeductions = advanceDeductions;

        // الوعاء الضريبي = الراتب الشامل - تأمينات 6% - حد الإعفاء 65,000 - الخصميات
        const taxableBase = Math.max(0, gross - insEmp - 65000 - totalDeductions);

        // ضريبة كسب العمل (شرائح: 10% لأول 40,000 و 15% لما زاد)
        let tax = 0;
        if (taxableBase > 0) {
          if (taxableBase <= 40000) {
            tax = Math.round(taxableBase * 0.10);
          } else {
            tax = Math.round(taxableBase * 0.15 - 2000);
          }
        }

        // صافي الراتب المستحق
        const net = Math.max(0, gross - insEmp - tax - totalDeductions);

        // صندوق تنمية المهارات 1% (محسوب على الوعاء)
        const skillsFund = Math.round(taxableBase * 0.01);
        const unpaidLeave = 0;
        const grandNet = net - unpaidLeave;

        await tx.run(`
          INSERT INTO payroll (
            employee_id, payroll_month, basic_salary, earned_basic,
            transport_allowance, appearance_allowance, nature_of_work_allowance,
            living_allowance, health_insurance_allowance, allowances,
            gross_salary, insurance_employee, insurance_employer,
            absence_penalty_deductions, loan_installments, deductions,
            taxable_base, tax_amount, net_salary, skills_fund,
            unpaid_leave_deduction, total_net_salary, working_days, month_days,
            cost_center, bank_account, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
        `, [
          e.id, payrollMonth, basic, earnedBasic,
          transport, appearance, nature,
          living, health, totalAllowances,
          gross, insEmp, insOrg,
          0, advanceDeductions, totalDeductions,
          taxableBase, tax, net, skillsFund,
          unpaidLeave, grandNet, workingDays, monthDays,
          e.cost_center || 'الإدارة العامة CC-100', e.bank_account || ''
        ]);
        created++;
      }
      return created;
    });

    await logAudit(req, {
      action: 'GENERATE_PAYROLL',
      entity_type: 'payroll',
      entity_id: payrollMonth,
      details: { month: payrollMonth, records_count: result }
    });

    res.json({ 
      success: true, 
      data: { created: result }, 
      message: `تم إعداد ${result} مسير راتب لشهر ${payrollMonth} وفق القواعد الشاملة والنظامية المعتمدة` 
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// تقييمات أداء الموظفين والحوافز والخصومات
router.get('/evaluations', requirePermission('hr:view'), async (req, res) => {
  try {
    const { employee_id } = req.query;
    let sql = `
      SELECT ev.*, e.full_name as employee_name, e.employee_no, e.job_title, e.department
      FROM employee_evaluations ev
      JOIN employees e ON e.id = ev.employee_id
    `;
    const params = [];
    if (employee_id) {
      sql += ' WHERE ev.employee_id = ?';
      params.push(employee_id);
    }
    sql += ' ORDER BY ev.evaluation_date DESC, ev.id DESC';
    const rows = await query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب تقييمات الأداء: ' + err.message });
  }
});

router.post('/evaluations', requirePermission('hr:create'), async (req, res) => {
  try {
    const { employee_id, evaluation_date = today(), rating = 'جيد جداً', score = 85, bonuses = 0, deductions = 0, evaluator = 'مدير الموارد البشرية', comments = '' } = req.body;
    if (!employee_id) return res.status(400).json({ success: false, message: 'اختر الموظف المراد تقييمه' });
    const evalPeriod = new Date(evaluation_date).getFullYear().toString();
    const result = await run(`
      INSERT INTO employee_evaluations (employee_id, period, evaluation_date, rating, score, bonuses, deductions, evaluator, evaluator_name, comments, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [employee_id, evalPeriod, evaluation_date, rating, number(score), number(bonuses), number(deductions), evaluator, evaluator, comments, comments]);
    res.json({ success: true, message: 'تم حفظ تقييم الموظف بنجاح', id: result.lastInsertRowid || result.insertId });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في حفظ التقييم: ' + err.message });
  }
});

// معاينة قيد استحقاق الرواتب قبل الترحيل (نفس سطور الترحيل الفعلي، من أدوار حسابات النظام)
router.get('/payroll/:month/preview-journal', requirePermission('hr:view,accounting:view'), async (req, res) => {
  try {
    res.json({ success: true, data: await PayrollPosting.preview(req.params.month) });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, message: 'خطأ في جلب معاينة قيد الرواتب: ' + err.message });
  }
});

// 1) قيد استحقاق الرواتب بتاريخ آخر يوم في شهر المسير، للسجلات غير المستحقة فقط (H9)
router.post('/payroll/:month/post-to-journal', requirePermission('accounting:post'), async (req, res) => {
  try {
    const month = req.params.month;
    const { entry, totals, count, date } = await PayrollPosting.accrue(month, req.user);
    await logAudit(req, { action: 'POST_PAYROLL_JOURNAL', entity_type: 'payroll', entity_id: month,
      details: { month, entry_no: entry.entry_no, date, records: count, total_net: totals.net / 100 } });
    res.json({
      success: true,
      message: `تم ترحيل استحقاق رواتب شهر ${month} بالقيد ${entry.entry_no} بتاريخ ${date}. الخطوة التالية: صرف الرواتب.`,
      entry_no: entry.entry_no, journal_entry_id: entry.id, accrual_date: date, records: count,
      total_expense: entry.total_debit, total_net: totals.net / 100, total_tax: totals.tax / 100, total_insurance: (totals.insEmp + totals.insOrg) / 100
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, message: 'خطأ في ترحيل مسير الرواتب: ' + err.message });
  }
});

// 2) صرف الرواتب المستحقة: مدين رواتب مستحقة / دائن الصندوق أو البنك
router.post('/payroll/:month/pay', requirePermission('accounting:post'), async (req, res) => {
  try {
    const month = req.params.month;
    const { entry, net, count, date } = await PayrollPosting.pay(month, {
      user: req.user, date: req.body.date, settlementAccountId: req.body.settlement_account_id ? Number(req.body.settlement_account_id) : null,
      paymentMethod: req.body.payment_method || 'نقدي'
    });
    await logAudit(req, { action: 'PAY_PAYROLL', entity_type: 'payroll', entity_id: month, details: { month, entry_no: entry.entry_no, date, records: count, net } });
    res.json({ success: true, message: `تم صرف صافي رواتب شهر ${month} (${net}) بالقيد ${entry.entry_no}`, entry_no: entry.entry_no, journal_entry_id: entry.id, total_net: net, records: count });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, message: 'خطأ في صرف الرواتب: ' + err.message });
  }
});

module.exports = router;
