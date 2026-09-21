const express = require('express');
const router = express.Router();
const { query, get, run, transaction } = require('../database/db');

const today = () => new Date().toISOString().slice(0, 10);
const number = value => Number(value) || 0;

// مؤشرات الموارد البشرية: القوة العاملة، الحضور، الرواتب والسلف المستحقة.
router.get('/dashboard', async (_req, res) => {
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

router.get('/employees', async (_req, res) => {
  try {
    const rows = await query(`SELECT e.*, p.name AS project_name FROM employees e LEFT JOIN projects p ON p.id = e.project_id ORDER BY e.status = 'active' DESC, e.full_name`);
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/employees', async (req, res) => {
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

router.put('/employees/:id', async (req, res) => {
  try {
    const fields = ['full_name','national_id','phone','job_title','department','project_id','employment_type','hire_date','basic_salary','currency','status','bank_name','bank_account','notes'];
    const values = fields.map(key => req.body[key] ?? null);
    await run(`UPDATE employees SET full_name=COALESCE(?,full_name), national_id=COALESCE(?,national_id), phone=COALESCE(?,phone), job_title=COALESCE(?,job_title), department=COALESCE(?,department), project_id=COALESCE(?,project_id), employment_type=COALESCE(?,employment_type), hire_date=COALESCE(?,hire_date), basic_salary=COALESCE(?,basic_salary), currency=COALESCE(?,currency), status=COALESCE(?,status), bank_name=COALESCE(?,bank_name), bank_account=COALESCE(?,bank_account), notes=COALESCE(?,notes) WHERE id=?`, [...values, req.params.id]);
    res.json({ success: true, message: 'تم تحديث بيانات الموظف' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/attendance', async (req, res) => {
  try {
    const date = req.query.date || today();
    const rows = await query(`SELECT a.*, e.full_name, e.employee_no FROM attendance a JOIN employees e ON e.id=a.employee_id WHERE a.date=? ORDER BY e.full_name`, [date]);
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/attendance', async (req, res) => {
  try {
    const { employee_id, date, status, check_in, check_out, overtime_hours, notes } = req.body;
    if (!employee_id) return res.status(400).json({ success: false, message: 'اختر الموظف' });
    const existing = await get('SELECT id FROM attendance WHERE employee_id=? AND date=?', [employee_id, date || today()]);
    if (existing) await run('UPDATE attendance SET status=?, check_in=?, check_out=?, overtime_hours=?, notes=? WHERE id=?', [status || 'present', check_in || null, check_out || null, number(overtime_hours), notes || '', existing.id]);
    else await run('INSERT INTO attendance (employee_id,date,status,check_in,check_out,overtime_hours,notes) VALUES (?,?,?,?,?,?,?)', [employee_id, date || today(), status || 'present', check_in || null, check_out || null, number(overtime_hours), notes || '']);
    res.json({ success: true, message: 'تم حفظ سجل الحضور' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/leaves', async (_req, res) => {
  try {
    const rows = await query('SELECT l.*, e.full_name FROM employee_leaves l JOIN employees e ON e.id=l.employee_id ORDER BY l.created_at DESC');
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/leaves', async (req, res) => {
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

router.put('/leaves/:id/status', async (req, res) => {
  try {
    await run('UPDATE employee_leaves SET status=? WHERE id=?', [req.body.status || 'approved', req.params.id]);
    res.json({ success: true, message: 'تم تحديث حالة الإجازة' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/leave-types', async (_req, res) => {
  try {
    const types = await query('SELECT * FROM leave_types ORDER BY is_paid DESC, id ASC');
    res.json({ success: true, data: types });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب أنواع الإجازات: ' + err.message });
  }
});

router.post('/leave-types', async (req, res) => {
  try {
    const { name, days_per_year = 30, is_paid = 1, description = '' } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ success: false, message: 'اسم نوع الإجازة مطلوب' });
    const result = await run(`
      INSERT INTO leave_types (name, days_per_year, is_paid, description)
      VALUES (?, ?, ?, ?)
    `, [name.trim(), number(days_per_year), is_paid ? 1 : 0, description.trim()]);
    res.json({ success: true, message: 'تمت إضافة نوع الإجازة بنجاح', id: result.lastInsertRowid || result.insertId });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في حفظ نوع الإجازة: ' + err.message });
  }
});

router.get('/advances', async (_req, res) => {
  try {
    const rows = await query('SELECT a.*, e.full_name FROM employee_advances a JOIN employees e ON e.id=a.employee_id ORDER BY a.date DESC');
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/advances', async (req, res) => {
  try {
    const { employee_id, amount, date, installment_amount, notes } = req.body;
    if (!employee_id || !number(amount)) return res.status(400).json({ success: false, message: 'الموظف ومبلغ السلفة مطلوبان' });
    await run('INSERT INTO employee_advances (employee_id, amount, recovered_amount, installment_amount, date, status, notes) VALUES (?, ?, 0, ?, ?, \'active\', ?)',
      [employee_id, number(amount), number(installment_amount), date || today(), notes || '']);
    res.json({ success: true, message: 'تم تسجيل السلفة' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/payroll', async (req, res) => {
  try {
    const month = req.query.month;
    let sql = 'SELECT p.*, e.full_name, e.employee_no FROM payroll p JOIN employees e ON e.id=p.employee_id';
    const params = [];
    if (month) {
      sql += ' WHERE p.payroll_month=?';
      params.push(month);
    }
    sql += ' ORDER BY p.payroll_month DESC, e.full_name';
    res.json({ success: true, data: await query(sql, params) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/payroll/generate', async (req, res) => {
  try {
    const payrollMonth = req.body.payroll_month || today().slice(0, 7);
    const employees = await query("SELECT * FROM employees WHERE status='active'");
    const result = await transaction(async tx => {
      let created = 0;
      for (const e of employees) {
        const exists = await tx.get('SELECT id FROM payroll WHERE employee_id=? AND payroll_month=?', [e.id, payrollMonth]);
        if (exists) continue;
        const advances = await tx.get("SELECT COALESCE(SUM(CASE WHEN installment_amount > 0 THEN MIN(installment_amount, amount-recovered_amount) ELSE 0 END),0) AS total FROM employee_advances WHERE employee_id=? AND status='active'", [e.id]);
        const overtime = await tx.get("SELECT COALESCE(SUM(overtime_hours),0) AS hours FROM attendance WHERE employee_id=? AND substr(date,1,7)=?", [e.id, payrollMonth]);
        const overtimePay = number(overtime?.hours) * (number(e.basic_salary) / 240) * 1.5;
        const deductions = number(advances?.total);
        const net = number(e.basic_salary) + overtimePay - deductions;
        await tx.run('INSERT INTO payroll (employee_id,payroll_month,basic_salary,overtime_amount,deductions,net_salary,status) VALUES (?,?,?,?,?,?,\'draft\')',
          [e.id, payrollMonth, number(e.basic_salary), overtimePay, deductions, net]);
        created++;
      }
      return created;
    });
    res.json({ success: true, data: { created: result }, message: `تم إعداد ${result} مسير راتب` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/payroll/:id/pay', async (req, res) => {
  try {
    await run("UPDATE payroll SET status='paid', paid_date=? WHERE id=?", [req.body.paid_date || today(), req.params.id]);
    res.json({ success: true, message: 'تم اعتماد صرف الراتب' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// تقييمات أداء الموظفين والحوافز والخصومات
router.get('/evaluations', async (req, res) => {
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

router.post('/evaluations', async (req, res) => {
  try {
    const { employee_id, evaluation_date = today(), rating = 'جيد جداً', score = 85, bonuses = 0, deductions = 0, evaluator = 'مدير الموارد البشرية', comments = '' } = req.body;
    if (!employee_id) return res.status(400).json({ success: false, message: 'اختر الموظف المراد تقييمه' });
    const result = await run(`
      INSERT INTO employee_evaluations (employee_id, evaluation_date, rating, score, bonuses, deductions, evaluator, comments)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [employee_id, evaluation_date, rating, number(score), number(bonuses), number(deductions), evaluator, comments]);
    res.json({ success: true, message: 'تم حفظ تقييم الموظف بنجاح', id: result.lastInsertRowid || result.insertId });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في حفظ التقييم: ' + err.message });
  }
});

// ترحيل كشف الراتب آلياً إلى قيد محاسبي متزن في سجل الأستاذ العام
router.post('/payroll/:month/post-to-journal', async (req, res) => {
  try {
    const month = req.params.month;
    const records = await query('SELECT p.*, e.full_name FROM payroll p JOIN employees e ON e.id=p.employee_id WHERE p.payroll_month = ?', [month]);
    if (!records || records.length === 0) {
      return res.status(400).json({ success: false, message: `لا توجد مسيرات رواتب لشهر ${month}` });
    }

    const alreadyPosted = records.filter(r => r.journal_entry_id);
    if (alreadyPosted.length === records.length) {
      return res.status(400).json({ success: false, message: `تم ترحيل مسير رواتب شهر ${month} مسبقاً بقيد يومية` });
    }

    let totalBasic = 0;
    let totalOvertime = 0;
    let totalDeductions = 0;
    let totalNet = 0;

    for (const r of records) {
      totalBasic += number(r.basic_salary);
      totalOvertime += number(r.overtime_amount);
      totalDeductions += number(r.deductions);
      totalNet += number(r.net_salary);
    }

    const totalExpense = totalBasic + totalOvertime;

    // جلب الحسابات المحاسبية المطلوبة للقيد
    let salaryExpAcc = await get("SELECT id FROM accounts WHERE code = '52' OR code = '3201' OR name LIKE '%رواتب%' ORDER BY code ASC LIMIT 1");
    let cashBankAcc = await get("SELECT id FROM accounts WHERE code = '111' OR code = '112' OR type = 'أصول' ORDER BY code ASC LIMIT 1");
    let advanceAcc = await get("SELECT id FROM accounts WHERE code = '114' OR name LIKE '%سلف%' OR name LIKE '%عهد%' LIMIT 1");

    if (!salaryExpAcc) salaryExpAcc = { id: 1 };
    if (!cashBankAcc) cashBankAcc = { id: 2 };

    const currentYear = new Date().getFullYear();
    const countRes = await get('SELECT COUNT(*) as cnt FROM journal_entries');
    let seq = ((countRes ? countRes.cnt : 0) || 0) + 1;
    let entry_no = `JV-PAY-${currentYear}-${String(seq).padStart(4, '0')}`;
    while (await get('SELECT id FROM journal_entries WHERE entry_no = ?', [entry_no])) {
      seq++;
      entry_no = `JV-PAY-${currentYear}-${String(seq).padStart(4, '0')}`;
    }

    const txResult = await transaction(async (tx) => {
      // إدراج القيد اليومي
      const jeRes = await tx.run(`
        INSERT INTO journal_entries (entry_no, date, description, reference_type, total_debit, total_credit)
        VALUES (?, ?, ?, 'ترحيل رواتب', ?, ?)
      `, [entry_no, today(), `إثبات وصرف استحقاق مسير رواتب شهر ${month} لعدد ${records.length} موظف`, totalExpense, totalExpense]);

      const jeId = jeRes.lastInsertRowid || jeRes.insertId;

      // طرف مدين: حساب مصروف الرواتب والأجور
      await tx.run(`
        INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, notes)
        VALUES (?, ?, ?, 0, ?)
      `, [jeId, salaryExpAcc.id, totalExpense, `إجمالي استحقاق رواتب شهر ${month}`]);

      // طرف دائن: الصندوق / البنك بصافي الرواتب
      await tx.run(`
        INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, notes)
        VALUES (?, ?, 0, ?, ?)
      `, [jeId, cashBankAcc.id, totalNet, `صافي رواتب محولة للموظفين لشهر ${month}`]);

      // طرف دائن إضافي: استرداد السلف والخصومات إن وجدت
      if (totalDeductions > 0 && advanceAcc) {
        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, notes)
          VALUES (?, ?, 0, ?, ?)
        `, [jeId, advanceAcc.id, totalDeductions, `خصومات واسترداد سلف موظفين شهر ${month}`]);
      }

      // تحديث حالة المسير إلى paid وتخزين رقم القيد
      await tx.run(`
        UPDATE payroll 
        SET status = 'paid', paid_date = ?, journal_entry_id = ?
        WHERE payroll_month = ?
      `, [today(), jeId, month]);

      return { jeId, entry_no };
    });

    res.json({
      success: true,
      message: `تم ترحيل مسير رواتب شهر ${month} بنجاح وإنشاء القيد المحاسبي المتزن رقم ${txResult.entry_no}`,
      entry_no: txResult.entry_no,
      journal_entry_id: txResult.jeId,
      total_expense: totalExpense,
      total_net: totalNet
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في ترحيل مسير الرواتب: ' + err.message });
  }
});

module.exports = router;
