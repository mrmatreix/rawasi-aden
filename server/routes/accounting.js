const express = require('express');
const router = express.Router();
const { query, get, run, transaction } = require('../database/db');
const bcrypt = require('bcryptjs');
const { logAudit } = require('../services/auditService');
const { checkPeriodOpen } = require('../services/periodService');
const AccountingService = require('../services/accountingService');

// دليل الحسابات الشجري
router.get('/accounts', async (req, res) => {
  try {
    const accounts = await query('SELECT * FROM accounts ORDER BY code ASC');
    res.json({ success: true, data: accounts });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب دليل الحسابات', error: err.message });
  }
});

// إضافة حساب جديد إلى الدليل المحاسبي
router.post('/accounts', async (req, res) => {
  try {
    const { code, name, type, parent_code = '', balance = 0 } = req.body;
    if (!code || !name || !type) {
      return res.status(400).json({ success: false, message: 'رقم الحساب، الاسم، والنوع حقول إلزامية' });
    }
    const existing = await get('SELECT id FROM accounts WHERE code = ?', [code.trim()]);
    if (existing) {
      return res.status(400).json({ success: false, message: 'رقم الحساب موجود مسبقاً' });
    }

    let parent_id = null;
    if (parent_code) {
      const parent = await get('SELECT id FROM accounts WHERE code = ?', [parent_code.trim()]);
      if (parent) parent_id = parent.id;
    }

    const result = await run(`
      INSERT INTO accounts (code, name, type, parent_id, balance)
      VALUES (?, ?, ?, ?, ?)
    `, [code.trim(), name.trim(), type, parent_id, Number(balance || 0)]);

    await logAudit(req, {
      action: 'INSERT',
      entity_type: 'account',
      entity_id: code.trim(),
      details: { code: code.trim(), name: name.trim(), type }
    });

    res.json({ success: true, message: 'تمت إضافة الحساب بنجاح', id: result.lastInsertRowid || result.insertId });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في إضافة الحساب: ' + err.message });
  }
});

// تعديل بيانات حساب مالي
router.put('/accounts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, type, parent_id } = req.body;
    if (!name || !type) {
      return res.status(400).json({ success: false, message: 'اسم الحساب والنوع مطلوبان' });
    }
    await run(`
      UPDATE accounts 
      SET name = ?, type = ?, parent_id = ?
      WHERE id = ?
    `, [name.trim(), type, parent_id ? Number(parent_id) : null, id]);

    await logAudit(req, {
      action: 'UPDATE',
      entity_type: 'account',
      entity_id: id,
      details: { name: name.trim(), type, parent_id }
    });

    res.json({ success: true, message: 'تم تحديث بيانات الحساب بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في تحديث الحساب: ' + err.message });
  }
});

// جلب قائمة العملات وأسعار الصرف
router.get('/currencies', async (req, res) => {
  try {
    const currencies = await query('SELECT * FROM currencies ORDER BY is_base DESC, code ASC');
    res.json({ success: true, data: currencies });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب العملات', error: err.message });
  }
});

// إضافة عملة جديدة
router.post('/currencies', async (req, res) => {
  try {
    const { code, name, symbol, rate_to_base = 1.0, is_base = 0 } = req.body;
    if (!code || !name || !symbol) {
      return res.status(400).json({ success: false, message: 'كود العملة، الاسم، والرمز حقول مطلوبة' });
    }
    const existing = await get('SELECT id FROM currencies WHERE code = ?', [code.trim().toUpperCase()]);
    if (existing) {
      return res.status(400).json({ success: false, message: 'رمز العملة مسجل مسبقاً' });
    }

    if (Number(is_base) === 1) {
      await run('UPDATE currencies SET is_base = 0');
    }

    const result = await run(`
      INSERT INTO currencies (code, name, symbol, rate_to_base, is_base)
      VALUES (?, ?, ?, ?, ?)
    `, [code.trim().toUpperCase(), name.trim(), symbol.trim(), Number(rate_to_base || 1.0), Number(is_base || 0)]);

    res.json({ success: true, message: 'تمت إضافة العملة بنجاح', id: result.lastInsertRowid || result.insertId });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في إضافة العملة: ' + err.message });
  }
});

// تعديل سعر صرف العملة
router.put('/currencies/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { rate_to_base, name, symbol, is_base } = req.body;
    if (rate_to_base !== undefined && Number(rate_to_base) <= 0) {
      return res.status(400).json({ success: false, message: 'سعر الصرف يجب أن يكون أكبر من الصفر' });
    }

    if (Number(is_base) === 1) {
      await run('UPDATE currencies SET is_base = 0');
    }

    await run(`
      UPDATE currencies 
      SET rate_to_base = COALESCE(?, rate_to_base),
          name = COALESCE(?, name),
          symbol = COALESCE(?, symbol),
          is_base = COALESCE(?, is_base),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [rate_to_base !== undefined ? Number(rate_to_base) : null, name, symbol, is_base !== undefined ? Number(is_base) : null, id]);

    res.json({ success: true, message: 'تم تحديث العملة وسعر الصرف بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في تحديث العملة: ' + err.message });
  }
});

// جلب قائمة مراكز التكلفة
router.get('/cost-centers', async (req, res) => {
  try {
    const centers = await query(`
      SELECT cc.*, p.name as project_name 
      FROM cost_centers cc
      LEFT JOIN projects p ON cc.project_id = p.id
      ORDER BY cc.code ASC
    `);
    res.json({ success: true, data: centers });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب مراكز التكلفة', error: err.message });
  }
});

// إضافة مركز تكلفة جديد
router.post('/cost-centers', async (req, res) => {
  try {
    const { code, name, type = 'مشروع', project_id, notes } = req.body;
    if (!code || !name) {
      return res.status(400).json({ success: false, message: 'كود المركز واسمه مطلوبان' });
    }
    const existing = await get('SELECT id FROM cost_centers WHERE code = ?', [code.trim()]);
    if (existing) {
      return res.status(400).json({ success: false, message: 'كود مركز التكلفة مسجل مسبقاً' });
    }

    const pId = project_id && project_id !== '' ? Number(project_id) : null;
    const result = await run(`
      INSERT INTO cost_centers (code, name, type, project_id, notes)
      VALUES (?, ?, ?, ?, ?)
    `, [code.trim(), name.trim(), type, pId, notes || '']);

    await logAudit(req, {
      action: 'INSERT',
      entity_type: 'cost_center',
      entity_id: code.trim(),
      details: { code: code.trim(), name: name.trim(), type, project_id: pId }
    });

    res.json({ success: true, message: 'تم إنشاء مركز التكلفة بنجاح', id: result.lastInsertRowid || result.insertId });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في إنشاء مركز التكلفة: ' + err.message });
  }
});

// جلب قيود اليومية العامة
router.get('/journal-entries', async (req, res) => {
  try {
    const { from_date, to_date, reference_type } = req.query;
    let sql = `
      SELECT je.*, 
        COUNT(jel.id) as lines_count
      FROM journal_entries je
      LEFT JOIN journal_entry_lines jel ON je.id = jel.entry_id
    `;
    const params = [];
    const conditions = [];

    if (from_date) {
      conditions.push('je.date >= ?');
      params.push(from_date);
    }
    if (to_date) {
      conditions.push('je.date <= ?');
      params.push(to_date);
    }
    if (reference_type) {
      conditions.push('je.reference_type = ?');
      params.push(reference_type);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' GROUP BY je.id ORDER BY je.date DESC, je.id DESC LIMIT 100';
    const entries = await query(sql, params);
    res.json({ success: true, data: entries });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب قيود اليومية', error: err.message });
  }
});

// جلب تفاصيل قيد يومية محدد مع كافة أطرافه المحاسبية
router.get('/journal-entries/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const entry = await get('SELECT * FROM journal_entries WHERE id = ?', [id]);
    if (!entry) {
      return res.status(404).json({ success: false, message: 'القيد غير موجود' });
    }

    const lines = await query(`
      SELECT jel.*, 
        a.code as account_code, 
        a.name as account_name,
        a.type as account_type,
        p.name as project_name,
        cc.code as cost_center_code,
        cc.name as cost_center_name
      FROM journal_entry_lines jel
      LEFT JOIN accounts a ON jel.account_id = a.id
      LEFT JOIN projects p ON jel.project_id = p.id
      LEFT JOIN cost_centers cc ON jel.cost_center_id = cc.id
      WHERE jel.entry_id = ?
      ORDER BY jel.id ASC
    `, [id]);

    res.json({ success: true, data: { ...entry, lines } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب تفاصيل القيد', error: err.message });
  }
});

// نقطة فحص فوري لحالة الفترة المحاسبية لتاريخ محدد (تستخدمها الواجهات ونماذج الإدخال)
router.get('/check-period', async (req, res) => {
  try {
    const { date } = req.query;
    const result = await checkPeriodOpen(date || new Date().toISOString().split('T')[0]);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// إنشاء قيد يدوي متزن بطرفين أو أطراف متعددة مع الفحص الصارم للاتزان وإغلاق الفترات ومراكز التكلفة
router.post('/journal-entries', async (req, res) => {
  try {
    const { 
      date = new Date().toISOString().split('T')[0], 
      description, 
      reference_type = 'قيد يدوي',
      reference_id = null,
      lines 
    } = req.body;

    const result = await AccountingService.createJournalEntry({
      date,
      description,
      reference_type,
      reference_id
    }, lines, req);

    res.json({
      success: true,
      message: 'تم حفظ وتوثيق القيد اليومي المتزن بنجاح وتحديث السجلات المحاسبية',
      entry_no: result.entry_no,
      id: result.id,
      total_debit: result.total_debit,
      total_credit: result.total_credit
    });
  } catch (err) {
    const status = err.message.includes('لا يمكن') || err.message.includes('غير متزن') || err.message.includes('مغلقة') ? 400 : 500;
    res.status(status).json({ success: false, message: err.message, error: err.message });
  }
});

// جلب قائمة العهد المفتوحة وغير المصفاة (للتصفية السريعة)
router.get('/open-custodies', async (req, res) => {
  try {
    const { employee_id } = req.query;
    let sql = `
      SELECT c.*, e.employee_no as emp_code, e.full_name as emp_full_name, e.job_title
      FROM custodies c
      LEFT JOIN employees e ON c.employee_id = e.id
      WHERE c.operation_type = 'صرف عهدة' AND c.remaining_amount > 0
    `;
    const params = [];
    if (employee_id) {
      sql += ' AND c.employee_id = ?';
      params.push(employee_id);
    }
    sql += ' ORDER BY c.date DESC, c.id DESC';

    const list = await query(sql, params);
    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب العهد المفتوحة', error: err.message });
  }
});

// جلب النثريات والعهد مع بيانات الموظف والعهدة الأصلية
router.get('/custodies', async (req, res) => {
  try {
    const custodies = await query(`
      SELECT c.*, 
             e.employee_no as emp_code, 
             e.full_name as emp_full_name, 
             e.job_title as emp_job_title
      FROM custodies c
      LEFT JOIN employees e ON c.employee_id = e.id
      ORDER BY c.date DESC, c.id DESC
    `);
    res.json({ success: true, data: custodies });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب العهد والنثريات', error: err.message });
  }
});

// تسجيل عهدة أو نثرية أو تصفية عهدة سابقة
router.post('/custodies', async (req, res) => {
  try {
    const {
      operation_type = 'صرف عهدة',
      employee_id,
      employee_name,
      related_custody_id,
      total_amount,
      spent_amount = 0,
      currency = 'ر.ي',
      date = new Date().toISOString().split('T')[0],
      notes
    } = req.body;

    // 1. التحقق من إغلاق الفترة المحاسبية لتاريخ العهدة
    const periodCheck = await checkPeriodOpen(date);
    if (!periodCheck.isOpen) {
      return res.status(403).json({ success: false, message: periodCheck.message });
    }

    const parsedAmount = Number(total_amount || 0);
    const parsedSpent = Number(spent_amount || 0);
    const selectedCurrency = currency || 'ر.ي';

    // 2. استخراج بيانات الموظف
    let empId = employee_id ? Number(employee_id) : null;
    let empNo = null;
    let empName = employee_name ? employee_name.trim() : '';

    if (empId) {
      const emp = await get('SELECT id, employee_no, full_name FROM employees WHERE id = ?', [empId]);
      if (emp) {
        empNo = emp.employee_no;
        empName = emp.full_name;
      }
    }

    if (!empName) {
      return res.status(400).json({ success: false, message: 'يرجى تحديد الموظف أو كتابة اسمه' });
    }

    const currentYear = new Date().getFullYear();

    // ================== معالجة تصفية عهدة سابقة ==================
    if (operation_type === 'تصفية عهدة') {
      if (!related_custody_id) {
        return res.status(400).json({ success: false, message: 'رقم العهدة الأصلية المراد تصفيتها مطلوب' });
      }

      const origCustody = await get('SELECT * FROM custodies WHERE id = ?', [related_custody_id]);
      if (!origCustody) {
        return res.status(404).json({ success: false, message: 'العهدة الأصلية المحددة غير موجودة في النظام' });
      }

      const remainingInOrig = Number(origCustody.remaining_amount || 0);
      const settleAmount = parsedSpent > 0 ? parsedSpent : parsedAmount;

      if (settleAmount <= 0) {
        return res.status(400).json({ success: false, message: 'مبلغ التصفية الفعلي يجب أن يكون أكبر من الصفر' });
      }

      if (settleAmount > remainingInOrig) {
        return res.status(400).json({ 
          success: false, 
          message: `مبلغ التصفية (${settleAmount.toLocaleString()}) يتجاوز الرصيد المتبقي في العهدة (${remainingInOrig.toLocaleString()} ${origCustody.currency || selectedCurrency})` 
        });
      }

      // توليد رقم عملية التصفية
      const countRes = await get('SELECT COUNT(*) as cnt FROM custodies');
      const seq = ((countRes ? countRes.cnt : 0) || 0) + 1;
      const custody_no = `STL-${currentYear}-${String(seq).padStart(4, '0')}`;

      const txResult = await transaction(async (tx) => {
        // 1. تحديث رصيد العهدة الأصلية
        const newSpent = Number(origCustody.spent_amount || 0) + settleAmount;
        const newRemaining = remainingInOrig - settleAmount;
        const newStatus = newRemaining <= 0 ? 'مصفاة بالكامل' : 'تصفية جزئية';

        await tx.run(`
          UPDATE custodies 
          SET spent_amount = ?, remaining_amount = ?, status = ?
          WHERE id = ?
        `, [newSpent, newRemaining, newStatus, origCustody.id]);

        // 2. تسجيل حركة التصفية في جدول العهد
        const result = await tx.run(`
          INSERT INTO custodies (
            custody_no, operation_type, related_custody_id, related_custody_no,
            employee_id, employee_no, employee_name,
            total_amount, spent_amount, remaining_amount, currency, status, date, notes
          ) VALUES (?, 'تصفية عهدة', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'تمت التصفية', ?, ?)
        `, [
          custody_no, origCustody.id, origCustody.custody_no,
          empId || origCustody.employee_id, empNo || origCustody.employee_no, empName || origCustody.employee_name,
          settleAmount, settleAmount, 0, selectedCurrency, date, notes || `تصفية للعهدة رقم ${origCustody.custody_no}`
        ]);

        return { result, newRemaining, newStatus };
      });

      // توثيق التصفية في سجل التدقيق والرقابة
      await logAudit(req, {
        action: 'SETTLE',
        entity_type: 'custody',
        entity_id: custody_no,
        details: { custody_no, related_custody_no: origCustody.custody_no, settleAmount, empName }
      });

      return res.json({
        success: true,
        message: `تم تسجيل تصفية العهدة بنجاح برقم ${custody_no}. الرصيد المتبقي في العهدة الأصلية: ${txResult.newRemaining.toLocaleString()} ${selectedCurrency}`,
        custody_no,
        settle_amount: settleAmount,
        remaining_in_original: txResult.newRemaining
      });
    }

    // ================== صرف عهدة جديدة أو نثرية ==================
    if (parsedAmount <= 0) {
      return res.status(400).json({ success: false, message: 'مبلغ العهدة يجب أن يكون أكبر من الصفر' });
    }

    const countRes = await get('SELECT COUNT(*) as cnt FROM custodies');
    let seq = ((countRes ? countRes.cnt : 0) || 0) + 1;
    const prefix = operation_type === 'نثرية' ? 'PET' : 'CST';
    let custody_no = `${prefix}-${currentYear}-${String(seq).padStart(4, '0')}`;
    while (await get('SELECT id FROM custodies WHERE custody_no = ?', [custody_no])) {
      seq++;
      custody_no = `${prefix}-${currentYear}-${String(seq).padStart(4, '0')}`;
    }

    const remaining = Math.max(0, parsedAmount - parsedSpent);

    const result = await run(`
      INSERT INTO custodies (
        custody_no, operation_type, employee_id, employee_no, employee_name,
        total_amount, spent_amount, remaining_amount, currency, status, date, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'مفتوحة', ?, ?)
    `, [
      custody_no, operation_type, empId, empNo, empName,
      parsedAmount, parsedSpent, remaining, selectedCurrency, date, notes || ''
    ]);

    await logAudit(req, {
      action: 'INSERT',
      entity_type: 'custody',
      entity_id: custody_no,
      details: { custody_no, operation_type, empName, total_amount: parsedAmount }
    });

    res.json({
      success: true,
      message: `تم تسجيل ${operation_type} بنجاح برقم ${custody_no}`,
      custody_no,
      id: result.lastInsertRowid || result.insertId,
      remaining
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في تسجيل العهدة: ' + err.message, error: err.message });
  }
});

// حركة الصندوق والبنك
router.get('/cash-movements', async (req, res) => {
  try {
    const movements = await query('SELECT * FROM cash_movements ORDER BY date DESC, id DESC LIMIT 50');
    const summary = await get(`
      SELECT 
        (SELECT previous_balance FROM cash_movements ORDER BY id ASC LIMIT 1) as initial_balance,
        SUM(cash_in) as total_cash_in,
        SUM(cash_out) as total_cash_out,
        SUM(withdrawals) as total_withdrawals,
        (SELECT current_balance FROM cash_movements ORDER BY id DESC LIMIT 1) as current_balance
      FROM cash_movements
    `) || { initial_balance: 50000, total_cash_in: 25000, total_cash_out: 15000, total_withdrawals: 5000, current_balance: 55000 };

    res.json({ success: true, data: movements, summary });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب حركة الصندوق', error: err.message });
  }
});

// ============================================================
// 🔒 إدارة الفترات المحاسبية وإغلاق الحسابات (Period Locking)
// ============================================================

// استعراض الفترات المحاسبية وحالتها
router.get('/periods', async (req, res) => {
  try {
    const periods = await query('SELECT * FROM accounting_periods ORDER BY fiscal_year DESC, start_date DESC');
    res.json({ success: true, data: periods });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب الفترات المحاسبية', error: err.message });
  }
});

// إنشاء فترة محاسبية جديدة
router.post('/periods', async (req, res) => {
  try {
    const { period_name, fiscal_year, start_date, end_date, notes } = req.body;
    if (!period_name || !start_date || !end_date) {
      return res.status(400).json({ success: false, message: 'اسم الفترة وتاريخ البداية والنهاية حقول مطلوبة' });
    }
    const fYear = Number(fiscal_year) || new Date(start_date).getFullYear();

    const result = await run(`
      INSERT INTO accounting_periods (period_name, fiscal_year, start_date, end_date, status, notes)
      VALUES (?, ?, ?, ?, 'open', ?)
    `, [period_name.trim(), fYear, start_date, end_date, notes || '']);

    const periodId = result.lastInsertRowid || result.insertId;

    await logAudit(req, {
      action: 'INSERT',
      entity_type: 'period',
      entity_id: periodId,
      details: { period_name: period_name.trim(), fiscal_year: fYear, start_date, end_date }
    });

    res.json({ success: true, message: 'تم إنشاء الفترة المحاسبية بنجاح', id: periodId });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في إنشاء الفترة المحاسبية: ' + err.message });
  }
});

// إغلاق فترة محاسبية رسمياً لمنع التعديل على أي تاريخ يقع داخلها (يتطلب تفويض وكلمة مرور المدير)
router.put('/periods/:id/close', async (req, res) => {
  try {
    const { id } = req.params;
    const { notes, manager_password } = req.body;

    if (!manager_password || !String(manager_password).trim()) {
      return res.status(400).json({ 
        success: false, 
        message: '⛔ إقفال الفترة المحاسبية يتطلب إدخال كلمة مرور المدير المالي / المشرف للتفويض القانوني.' 
      });
    }

    const period = await get('SELECT * FROM accounting_periods WHERE id = ?', [id]);
    if (!period) {
      return res.status(404).json({ success: false, message: 'الفترة المحاسبية غير موجودة' });
    }

    if (period.status === 'closed') {
      return res.status(400).json({ success: false, message: 'الفترة المحاسبية مغلقة مسبقاً' });
    }

    // التحقق الأمني من صحة كلمة مرور المدير
    let isAuthorized = false;
    let authorizedUser = null;

    // 1. فحص المستخدم الحالي المسجل
    if (req.user && req.user.id) {
      const currentUser = await get('SELECT * FROM users WHERE id = ?', [req.user.id]);
      if (currentUser && currentUser.password_hash) {
        if (bcrypt.compareSync(manager_password, currentUser.password_hash)) {
          isAuthorized = true;
          authorizedUser = currentUser;
        }
      }
    }

    // 2. إذا لم يتطابق، التحقق هل كلمة المرور تخص أحد حسابات المدراء (Admin / Manager)
    if (!isAuthorized) {
      const adminUsers = await query("SELECT * FROM users WHERE role IN ('admin', 'general_manager') OR username = 'admin'");
      for (const admin of adminUsers) {
        if (admin.password_hash && bcrypt.compareSync(manager_password, admin.password_hash)) {
          isAuthorized = true;
          authorizedUser = admin;
          break;
        }
      }
    }

    if (!isAuthorized) {
      return res.status(401).json({ 
        success: false, 
        message: '⛔ كلمة مرور المدير غير صحيحة! لا يمكن إقفال الفترة بدون تفويض مالي معتمد.' 
      });
    }

    const username = authorizedUser?.full_name || authorizedUser?.username || req.user?.username || 'المدير العام';
    await run(`
      UPDATE accounting_periods 
      SET status = 'closed', closed_at = CURRENT_TIMESTAMP, closed_by = ?, notes = COALESCE(?, notes)
      WHERE id = ?
    `, [username, notes || null, id]);

    await logAudit(req, {
      action: 'CLOSE_PERIOD',
      entity_type: 'period',
      entity_id: id,
      details: { period_name: period.period_name, closed_by: username, notes, authorized_user_id: authorizedUser?.id }
    });

    res.json({ 
      success: true, 
      message: `🔒 تم إغلاق وتأمين الفترة المحاسبية (${period.period_name}) بنجاح بواسطة [${username}]، وتم قفل كافة المعاملات والقيود بين ${period.start_date} و ${period.end_date}.` 
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في إغلاق الفترة المحاسبية: ' + err.message });
  }
});

// إعادة فتح فترة محاسبية مغلقة (يتطلب سبباً مبرراً وتوثيقاً في سجل التدقيق)
router.put('/periods/:id/reopen', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    if (!reason || !reason.trim()) {
      return res.status(400).json({ success: false, message: 'يجب ذكر سبب رسمي ومبرر إداري لإعادة فتح الفترة المحاسبية المغلقة' });
    }

    const period = await get('SELECT * FROM accounting_periods WHERE id = ?', [id]);
    if (!period) {
      return res.status(404).json({ success: false, message: 'الفترة المحاسبية غير موجودة' });
    }

    const username = req.user?.username || req.user?.full_name || 'المدير العام';
    await run(`
      UPDATE accounting_periods 
      SET status = 'open', reopened_at = CURRENT_TIMESTAMP, reopened_by = ?, reopen_reason = ?
      WHERE id = ?
    `, [username, reason.trim(), id]);

    await logAudit(req, {
      action: 'REOPEN_PERIOD',
      entity_type: 'period',
      entity_id: id,
      details: { period_name: period.period_name, reopened_by: username, reason: reason.trim() }
    });

    res.json({ 
      success: true, 
      message: `تمت إعادة فتح الفترة المحاسبية (${period.period_name}) بنجاح وتوثيق سبب الإجراء في سجل الرقابة` 
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في إعادة فتح الفترة: ' + err.message });
  }
});

// ============================================================
// 📜 سجل التدقيق والرقابة المالية (Audit Log API)
// ============================================================
router.get('/audit-logs', async (req, res) => {
  try {
    const { entity_type, action, from_date, to_date, page = 1, limit = 20 } = req.query;
    let sql = 'SELECT * FROM audit_logs';
    const conditions = [];
    const params = [];

    if (entity_type) {
      conditions.push('entity_type = ?');
      params.push(entity_type.toLowerCase());
    }
    if (action) {
      conditions.push('action = ?');
      params.push(action.toUpperCase());
    }
    if (from_date) {
      conditions.push('created_at >= ?');
      params.push(from_date + ' 00:00:00');
    }
    if (to_date) {
      conditions.push('created_at <= ?');
      params.push(to_date + ' 23:59:59');
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    const countSql = sql.replace('SELECT * FROM audit_logs', 'SELECT COUNT(*) as total FROM audit_logs');
    const countRow = await get(countSql, params);
    const total = countRow ? countRow.total : 0;

    sql += ' ORDER BY id DESC LIMIT ? OFFSET ?';
    const p = Math.max(1, Number(page) || 1);
    const l = Math.min(100, Math.max(5, Number(limit) || 20));
    params.push(l, (p - 1) * l);

    const rows = await query(sql, params);
    res.json({
      success: true,
      data: rows,
      pagination: { total, page: p, limit: l, totalPages: Math.ceil(total / l) }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب سجل التدقيق: ' + err.message });
  }
});

module.exports = router;
