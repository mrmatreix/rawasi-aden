const express = require('express');
const router = express.Router();
const { query, get, run, transaction } = require('../database/db');

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
    const result = await run(`
      INSERT INTO accounts (code, name, type, parent_code, balance)
      VALUES (?, ?, ?, ?, ?)
    `, [code.trim(), name.trim(), type.trim(), parent_code ? parent_code.trim() : null, Number(balance) || 0]);
    res.json({
      success: true,
      message: 'تمت إضافة الحساب بنجاح',
      id: result.lastInsertRowid || result.insertId
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في إضافة الحساب: ' + err.message });
  }
});

// تعديل بيانات حساب
router.put('/accounts/:id', async (req, res) => {
  try {
    const { name, type, parent_code } = req.body;
    await run(`
      UPDATE accounts 
      SET name = COALESCE(?, name),
          type = COALESCE(?, type),
          parent_code = COALESCE(?, parent_code)
      WHERE id = ?
    `, [name ? name.trim() : null, type ? type.trim() : null, parent_code !== undefined ? parent_code : null, req.params.id]);
    res.json({ success: true, message: 'تم تحديث بيانات الحساب بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في تحديث الحساب: ' + err.message });
  }
});

// العملات وأسعار الصرف
router.get('/currencies', async (req, res) => {
  try {
    const currencies = await query('SELECT * FROM currencies ORDER BY is_base DESC, id ASC');
    res.json({ success: true, data: currencies });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب العملات', error: err.message });
  }
});

router.post('/currencies', async (req, res) => {
  try {
    const { code, name, symbol, rate_to_base = 1.0, is_base = 0 } = req.body;
    if (!code || !name) {
      return res.status(400).json({ success: false, message: 'رمز واسم العملة مطلوبان' });
    }
    const existing = await get('SELECT id FROM currencies WHERE code = ?', [code.trim().toUpperCase()]);
    if (existing) {
      return res.status(400).json({ success: false, message: 'العملة مضافة مسبقاً' });
    }
    const result = await run(`
      INSERT INTO currencies (code, name, symbol, rate_to_base, is_base)
      VALUES (?, ?, ?, ?, ?)
    `, [code.trim().toUpperCase(), name.trim(), symbol || code.trim(), Number(rate_to_base) || 1.0, is_base ? 1 : 0]);
    res.json({
      success: true,
      message: 'تمت إضافة العملة بنجاح',
      id: result.lastInsertRowid || result.insertId
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في إضافة العملة: ' + err.message });
  }
});

router.put('/currencies/:id', async (req, res) => {
  try {
    const { name, symbol, rate_to_base, is_base } = req.body;
    await run(`
      UPDATE currencies 
      SET name = COALESCE(?, name),
          symbol = COALESCE(?, symbol),
          rate_to_base = COALESCE(?, rate_to_base),
          is_base = COALESCE(?, is_base)
      WHERE id = ?
    `, [name, symbol, rate_to_base !== undefined ? Number(rate_to_base) : null, is_base !== undefined ? (is_base ? 1 : 0) : null, req.params.id]);
    res.json({ success: true, message: 'تم تحديث العملة بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في تحديث العملة: ' + err.message });
  }
});

// دليل مراكز التكلفة
router.get('/cost-centers', async (req, res) => {
  try {
    const costCenters = await query(`
      SELECT cc.*, p.name as project_name
      FROM cost_centers cc
      LEFT JOIN projects p ON cc.project_id = p.id
      ORDER BY cc.code ASC
    `);
    res.json({ success: true, data: costCenters });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب مراكز التكلفة', error: err.message });
  }
});

// إضافة مركز تكلفة جديد
router.post('/cost-centers', async (req, res) => {
  try {
    const { code, name, type = 'مشروع', project_id = null, notes = '' } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'اسم مركز التكلفة مطلوب' });
    }

    let finalCode = code && code.trim();
    if (!finalCode) {
      const countRes = await get('SELECT COUNT(*) as cnt FROM cost_centers');
      finalCode = `CC-${String(((countRes ? countRes.cnt : 0) || 0) + 1).padStart(3, '0')}`;
    }

    const result = await run(`
      INSERT INTO cost_centers (code, name, type, project_id, notes)
      VALUES (?, ?, ?, ?, ?)
    `, [finalCode, name.trim(), type, project_id || null, notes.trim()]);

    res.json({
      success: true,
      message: 'تمت إضافة مركز التكلفة بنجاح',
      id: result.lastInsertRowid || result.insertId,
      code: finalCode
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في إضافة مركز التكلفة: ' + err.message, error: err.message });
  }
});

// القيود اليومية مع سطورها ومراكز تكلفتها
router.get('/journal-entries', async (req, res) => {
  try {
    const entries = await query('SELECT * FROM journal_entries ORDER BY date DESC, id DESC');
    const enriched = await Promise.all(entries.map(async (entry) => {
      const lines = await query(`
        SELECT jel.*, 
               a.name as account_name, a.code as account_code, 
               cc.name as cost_center_name, cc.code as cost_center_code,
               p.name as project_name
        FROM journal_entry_lines jel
        LEFT JOIN accounts a ON jel.account_id = a.id
        LEFT JOIN cost_centers cc ON jel.cost_center_id = cc.id
        LEFT JOIN projects p ON jel.project_id = p.id
        WHERE jel.entry_id = ?
        ORDER BY jel.id ASC
      `, [entry.id]);
      return { ...entry, lines };
    }));
    res.json({ success: true, data: enriched });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب القيود اليومية', error: err.message });
  }
});

// تفاصيل قيد يومي واحد
router.get('/journal-entries/:id', async (req, res) => {
  try {
    const entry = await get('SELECT * FROM journal_entries WHERE id = ?', [req.params.id]);
    if (!entry) {
      return res.status(404).json({ success: false, message: 'القيد غير موجود' });
    }
    const lines = await query(`
      SELECT jel.*, 
             a.name as account_name, a.code as account_code, 
             cc.name as cost_center_name, cc.code as cost_center_code,
             p.name as project_name
      FROM journal_entry_lines jel
      LEFT JOIN accounts a ON jel.account_id = a.id
      LEFT JOIN cost_centers cc ON jel.cost_center_id = cc.id
      LEFT JOIN projects p ON jel.project_id = p.id
      WHERE jel.entry_id = ?
      ORDER BY jel.id ASC
    `, [entry.id]);

    res.json({ success: true, data: { ...entry, lines } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب تفاصيل القيد', error: err.message });
  }
});

// إنشاء قيد يدوي متزن بطرفين أو أطراف متعددة داخل Transaction ذرية
router.post('/journal-entries', async (req, res) => {
  try {
    const { 
      date = new Date().toISOString().split('T')[0], 
      description, 
      reference_type = 'قيد يدوي',
      currency = 'ر.ي',
      lines 
    } = req.body;

    if (!description || !lines || lines.length < 2) {
      return res.status(400).json({ success: false, message: 'القيد اليومي يتطلب بياناً وطرفين على الأقل (مدين ودائن)' });
    }

    let totalDebit = 0;
    let totalCredit = 0;
    for (const line of lines) {
      totalDebit += Number(line.debit || 0);
      totalCredit += Number(line.credit || 0);
      if (!line.account_id) {
        return res.status(400).json({ success: false, message: 'يجب تحديد الحساب المالي لكل طرف في القيد' });
      }
    }

    // التحقق الصارم من اتزان القيد
    const diff = Math.abs(totalDebit - totalCredit);
    if (diff > 0.01) {
      return res.status(400).json({ 
        success: false, 
        message: `القيد غير متزن! إجمالي المدين (${totalDebit.toLocaleString()}) لا يساوي إجمالي الدائن (${totalCredit.toLocaleString()}). الفارق: ${diff.toLocaleString()}` 
      });
    }

    const currentYear = new Date().getFullYear();
    const countRes = await get('SELECT COUNT(*) as cnt FROM journal_entries');
    let seq = ((countRes ? countRes.cnt : 0) || 0) + 1;
    let entry_no = `JE-${currentYear}-${String(seq).padStart(5, '0')}`;
    while (await get('SELECT id FROM journal_entries WHERE entry_no = ?', [entry_no])) {
      seq++;
      entry_no = `JE-${currentYear}-${String(seq).padStart(5, '0')}`;
    }

    const txResult = await transaction(async (tx) => {
      const jeRes = await tx.run(`
        INSERT INTO journal_entries (entry_no, date, description, reference_type, total_debit, total_credit)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [entry_no, date, description, reference_type, totalDebit, totalCredit]);

      const jeId = jeRes.lastInsertRowid || jeRes.insertId;

      for (const line of lines) {
        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
          jeId, 
          line.account_id, 
          line.cost_center_id || null, 
          line.project_id || null, 
          Number(line.debit || 0), 
          Number(line.credit || 0), 
          line.notes || ''
        ]);
      }

      return jeRes;
    });

    res.json({
      success: true,
      message: 'تم حفظ القيد اليومي المتزن بنجاح وتحديث السجلات المحاسبية',
      entry_no,
      id: txResult.lastInsertRowid || txResult.insertId
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في تسجيل القيد: ' + err.message, error: err.message });
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

    const parsedAmount = Number(total_amount || 0);
    const parsedSpent = Number(spent_amount || 0);
    const selectedCurrency = currency || 'ر.ي';

    // 1. استخراج بيانات الموظف
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

        // 2. تسجيل حركة التصفية في السجل
        const result = await tx.run(`
          INSERT INTO custodies (
            custody_no, operation_type, employee_id, employee_no, employee_name,
            related_custody_id, related_custody_no, total_amount, spent_amount, 
            remaining_amount, currency, status, date, notes
          ) VALUES (?, 'تصفية عهدة', ?, ?, ?, ?, ?, ?, ?, 0, ?, 'تصفية', ?, ?)
        `, [
          custody_no,
          origCustody.employee_id || empId,
          origCustody.employee_no || empNo,
          origCustody.employee_name || empName,
          origCustody.id,
          origCustody.custody_no || `CST-${origCustody.id}`,
          settleAmount,
          settleAmount,
          selectedCurrency,
          date,
          notes || `تصفية بموجب العهدة رقم ${origCustody.custody_no || origCustody.id}`
        ]);

        return { result, newRemaining, newStatus, custody_no };
      });

      return res.json({
        success: true,
        message: `تمت تصفية العهدة بنجاح بمبلغ ${settleAmount.toLocaleString()} ${selectedCurrency}. الرصيد المتبقي في العهدة الأصلية: ${txResult.newRemaining.toLocaleString()}`,
        custody_no: txResult.custody_no,
        remaining: txResult.newRemaining,
        status: txResult.newStatus
      });
    }

    // ================== معالجة صرف عهدة جديدة أو نثريات ==================
    if (parsedAmount <= 0) {
      return res.status(400).json({ success: false, message: 'إجمالي مبلغ العهدة مطلوب ويجب أن يكون أكبر من الصفر' });
    }

    // توليد رقم العهدة التسلسلي
    const countRes = await get('SELECT COUNT(*) as cnt FROM custodies WHERE operation_type = ?', [operation_type]);
    const prefix = operation_type === 'صرف عهدة' ? 'CST' : 'EXP-PETTY';
    let seq = ((countRes ? countRes.cnt : 0) || 0) + 1;
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

module.exports = router;
