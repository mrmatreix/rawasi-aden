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

router.get('/leaves', async (_req, res) => { try { res.json({ success: true, data: await query('SELECT l.*, e.full_name FROM employee_leaves l JOIN employees e ON e.id=l.employee_id ORDER BY l.created_at DESC') }); } catch (err) { res.status(500).json({ success:false, message:err.message }); } });
router.post('/leaves', async (req, res) => {
  try { const { employee_id, leave_type, start_date, end_date, days_count, status, notes } = req.body; if (!employee_id || !start_date || !end_date) return res.status(400).json({success:false,message:'الموظف وفترة الإجازة مطلوبان'}); await run('INSERT INTO employee_leaves (employee_id,leave_type,start_date,end_date,days_count,status,notes) VALUES (?,?,?,?,?,?,?)', [employee_id, leave_type || 'سنوية', start_date, end_date, number(days_count) || 1, status || 'pending', notes || '']); res.json({success:true,message:'تم تسجيل طلب الإجازة'}); } catch(err) { res.status(500).json({success:false,message:err.message}); }
});
router.put('/leaves/:id/status', async (req,res) => { try { await run('UPDATE employee_leaves SET status=? WHERE id=?',[req.body.status || 'approved',req.params.id]); res.json({success:true,message:'تم تحديث حالة الإجازة'}); } catch(err) {res.status(500).json({success:false,message:err.message});} });

router.get('/advances', async (_req,res) => { try { res.json({success:true,data:await query('SELECT a.*, e.full_name FROM employee_advances a JOIN employees e ON e.id=a.employee_id ORDER BY a.date DESC')}); } catch(err){res.status(500).json({success:false,message:err.message});} });
router.post('/advances', async (req,res) => { try { const {employee_id,amount,date,installment_amount,notes}=req.body; if(!employee_id || !number(amount)) return res.status(400).json({success:false,message:'الموظف ومبلغ السلفة مطلوبان'}); await run('INSERT INTO employee_advances (employee_id,amount,recovered_amount,installment_amount,date,status,notes) VALUES (?, ?, 0, ?, ?, \'active\', ?)',[employee_id,number(amount),number(installment_amount),date||today(),notes||'']);res.json({success:true,message:'تم تسجيل السلفة'}); }catch(err){res.status(500).json({success:false,message:err.message});} });

router.get('/payroll', async (req,res) => { try { const month=req.query.month; let sql='SELECT p.*, e.full_name, e.employee_no FROM payroll p JOIN employees e ON e.id=p.employee_id'; const params=[]; if(month){sql+=' WHERE p.payroll_month=?';params.push(month);} sql+=' ORDER BY p.payroll_month DESC, e.full_name';res.json({success:true,data:await query(sql,params)}); }catch(err){res.status(500).json({success:false,message:err.message});} });
router.post('/payroll/generate', async (req,res) => {
  try { const payrollMonth=req.body.payroll_month || today().slice(0,7); const employees=await query("SELECT * FROM employees WHERE status='active'"); const result=await transaction(async tx => { let created=0; for(const e of employees){ const exists=await tx.get('SELECT id FROM payroll WHERE employee_id=? AND payroll_month=?',[e.id,payrollMonth]); if(exists) continue; const advances=await tx.get("SELECT COALESCE(SUM(CASE WHEN installment_amount > 0 THEN MIN(installment_amount, amount-recovered_amount) ELSE 0 END),0) AS total FROM employee_advances WHERE employee_id=? AND status='active'",[e.id]); const overtime=await tx.get("SELECT COALESCE(SUM(overtime_hours),0) AS hours FROM attendance WHERE employee_id=? AND substr(date,1,7)=?",[e.id,payrollMonth]); const overtimePay=number(overtime?.hours)*(number(e.basic_salary)/240)*1.5; const deductions=number(advances?.total); const net=number(e.basic_salary)+overtimePay-deductions; await tx.run('INSERT INTO payroll (employee_id,payroll_month,basic_salary,overtime_amount,deductions,net_salary,status) VALUES (?,?,?,?,?,?,\'draft\')',[e.id,payrollMonth,number(e.basic_salary),overtimePay,deductions,net]); created++; } return created; }); res.json({success:true,data:{created:result},message:`تم إعداد ${result} مسير راتب`}); }catch(err){res.status(500).json({success:false,message:err.message});} });
router.put('/payroll/:id/pay', async (req,res) => { try { await run("UPDATE payroll SET status='paid', paid_date=? WHERE id=?",[req.body.paid_date||today(),req.params.id]);res.json({success:true,message:'تم اعتماد صرف الراتب'}); }catch(err){res.status(500).json({success:false,message:err.message});} });

module.exports = router;
