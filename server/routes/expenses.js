const express = require('express');
const router = express.Router();
const { query, get, run, transaction } = require('../database/db');
const { logAudit } = require('../services/auditService');
const { checkPeriodOpen } = require('../services/periodService');
const { requirePermission, parseScopeArray } = require('../middleware/security');
const FinancialControlService = {
  ...require('../services/financialControlService')
};

// جلب جميع المصروفات مع بيانات الحساب ومركز التكلفة والمشروع والمورد مع تطبيق النطاق
router.get('/', requirePermission('expenses:view'), async (req, res) => {
  try {
    const { project_id, type, status } = req.query;
    let sql = `
      SELECT e.*, 
             p.name as project_name, 
             s.name as supplier_name,
             a.name as account_name,
             a.code as account_code,
             cc.name as cost_center_name,
             cc.code as cost_center_code
      FROM expenses e
      LEFT JOIN projects p ON e.project_id = p.id
      LEFT JOIN suppliers s ON e.supplier_id = s.id
      LEFT JOIN accounts a ON e.account_id = a.id
      LEFT JOIN cost_centers cc ON e.cost_center_id = cc.id
    `;
    const params = [];
    const conditions = [];

    // تطبيق نطاق المشاريع للمستخدم
    if (req.user && req.user.role !== 'admin' && req.user.username !== 'admin') {
      const allowedProjects = parseScopeArray(req.user.scope?.allowed_projects || req.user.allowed_projects);
      if (!allowedProjects.includes('*') && !allowedProjects.includes('all')) {
        if (allowedProjects.length === 0) {
          return res.json({ success: true, data: [] });
        }
        const placeholders = allowedProjects.map(() => '?').join(',');
        conditions.push(`(e.project_id IS NULL OR e.project_id IN (${placeholders}))`);
        params.push(...allowedProjects.map(Number));
      }
    }

    if (project_id) {
      conditions.push(`e.project_id = ?`);
      params.push(project_id);
    }
    if (type) {
      conditions.push(`e.expense_type = ?`);
      params.push(type);
    }
    if (status) {
      conditions.push(`e.status = ?`);
      params.push(status);
    }
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY e.date DESC, e.id DESC';

    const expenses = await query(sql, params);
    res.json({ success: true, data: expenses });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب المصروفات', error: err.message });
  }
});

// ملخص المصروفات حسب النوع (Donut Chart Data)
router.get('/types-summary', requirePermission('expenses:view'), async (req, res) => {
  try {
    const stats = await query(`
      SELECT expense_type, SUM(amount) as total, COUNT(*) as count
      FROM expenses
      WHERE status NOT IN ('reversed', 'cancelled', 'draft')
      GROUP BY expense_type
      ORDER BY total DESC
    `);
    const totalAmount = stats.reduce((sum, item) => sum + (Number(item.total) || 0), 0);
    const formatted = stats.map(item => ({
      type: item.expense_type,
      total: Number(item.total) || 0,
      percentage: totalAmount > 0 ? Math.round(((Number(item.total) || 0) / totalAmount) * 100) : 0
    }));
    res.json({ success: true, data: formatted, grand_total: totalAmount });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب ملخص المصروفات', error: err.message });
  }
});

// إنشاء سند صرف جديد (مسودة أو ترحيل فوري) مع توثيق المنشئ وفحص الفترة
router.post('/', requirePermission('expenses:create'), async (req, res) => {
  try {
    const {
      expense_type,
      project_id,
      supplier_id,
      account_id,
      cost_center_id,
      amount,
      currency = 'ر.ي',
      payment_method = 'نقدي',
      check_no,
      bank_name,
      date = new Date().toISOString().split('T')[0],
      notes,
      recipient,
      status: requestedStatus // 'draft' أو 'posted'
    } = req.body;

    // 1. التحقق من إغلاق الفترة المحاسبية لتاريخ السند
    await FinancialControlService.assertPeriodOpen(date);

    if (!expense_type || !amount || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'يرجى تحديد نوع المصروف والمبلغ بشكل صحيح' });
    }

    if (payment_method === 'شيك' && (!check_no || !String(check_no).trim())) {
      return res.status(400).json({ success: false, message: 'عند اختيار طريقة الدفع (شيك) يجب إدخال رقم الشيك' });
    }

    // توليد رقم سند الصرف
    const countRes = await get('SELECT COUNT(*) as cnt FROM expenses');
    let seq = ((countRes ? countRes.cnt : 0) || 0) + 1;
    const currentYear = new Date().getFullYear();
    let receipt_no = `EP-${currentYear}-${String(seq).padStart(4, '0')}`;
    while (await get('SELECT id FROM expenses WHERE receipt_no = ?', [receipt_no])) {
      seq++;
      receipt_no = `EP-${currentYear}-${String(seq).padStart(4, '0')}`;
    }

    const parsedAmount = Number(amount);
    const selectedCurrency = currency || 'ر.ي';
    const cleanCheckNo = check_no ? String(check_no).trim() : null;
    const cleanBankName = bank_name ? String(bank_name).trim() : null;

    const pId = project_id && project_id !== '' ? Number(project_id) : null;
    const sId = supplier_id && supplier_id !== '' ? Number(supplier_id) : null;
    const accId = account_id && account_id !== '' ? Number(account_id) : null;
    let finalCcId = cost_center_id && cost_center_id !== '' ? Number(cost_center_id) : null;

    if (!finalCcId && pId) {
      const prjCc = await get('SELECT id FROM cost_centers WHERE project_id = ? LIMIT 1', [pId]);
      if (prjCc) finalCcId = prjCc.id;
    }
    if (!finalCcId) finalCcId = 1;

    const rawCreatorId = req.user?.id || null;
    const creatorId = await FinancialControlService.resolveValidUserId(rawCreatorId);
    const creatorName = req.user?.username || req.user?.full_name || 'مسؤول مالي';
    const finalStatus = (requestedStatus === 'draft') ? 'draft' : 'posted';

    const txResult = await transaction(async (tx) => {
      // 1. تسجيل سند الصرف مع هوية المنشئ وحالة دورة المستند
      const result = await tx.run(`
        INSERT INTO expenses (
          receipt_no, expense_type, project_id, supplier_id, 
          account_id, cost_center_id, amount, currency, payment_method, 
          check_no, bank_name, recipient, date, notes,
          status, created_by, created_by_name, posted_by, posted_by_name, posted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        receipt_no, expense_type, pId, sId,
        accId, finalCcId, parsedAmount, selectedCurrency, payment_method,
        cleanCheckNo, cleanBankName, recipient || '', date, notes || '',
        finalStatus, creatorId, creatorName,
        finalStatus === 'posted' ? creatorId : null,
        finalStatus === 'posted' ? creatorName : null,
        finalStatus === 'posted' ? new Date().toISOString() : null
      ]);

      const expenseId = result.lastInsertRowid || result.insertId;

      // 2. إذا كانت مسودة، لا يتم التأثير المالي على الدفاتر العامة أو الصندوق حتى المراجعة والاعتماد
      if (finalStatus === 'posted') {
        // تحديث التكلفة الفعلية للمشروع إن وجد
        if (pId) {
          await tx.run(`UPDATE projects SET actual_cost = actual_cost + ? WHERE id = ?`, [parsedAmount, pId]);
        }

        // تحديث رصيد المورد إن كان محدداً
        if (sId) {
          await tx.run(`UPDATE suppliers SET balance = balance + ? WHERE id = ?`, [parsedAmount, sId]);
        }

        // تحديث حركة الصندوق والبنك
        const lastCash = await tx.get('SELECT current_balance FROM cash_movements ORDER BY id DESC LIMIT 1') || { current_balance: 125000 };
        const prevBal = Number(lastCash.current_balance) || 0;
        const newBal = prevBal - parsedAmount;
        const moveDesc = payment_method === 'شيك' 
          ? `سند صرف بشيك رقم ${cleanCheckNo}: ${receipt_no} - ${expense_type}`
          : `سند صرف: ${receipt_no} - ${expense_type}`;

        await tx.run(`
          INSERT INTO cash_movements (previous_balance, cash_in, cash_out, withdrawals, current_balance, currency, date, notes)
          VALUES (?, 0, ?, 0, ?, ?, ?, ?)
        `, [prevBal, parsedAmount, newBal, selectedCurrency, date, moveDesc]);

        // تسجيل قيد يومي تلقائي متزن
        const entryCount = await tx.get('SELECT COUNT(*) as cnt FROM journal_entries');
        let jeSeq = ((entryCount ? entryCount.cnt : 0) || 0) + 1;
        let entryNo = `JE-${String(jeSeq).padStart(5, '0')}`;
        while (await tx.get('SELECT id FROM journal_entries WHERE entry_no = ?', [entryNo])) {
          jeSeq++;
          entryNo = `JE-${String(jeSeq).padStart(5, '0')}`;
        }
        const jeRes = await tx.run(`
          INSERT INTO journal_entries (
            entry_no, date, description, reference_type, reference_id, 
            total_debit, total_credit, status, created_by, created_by_name, posted_by, posted_by_name, posted_at
          )
          VALUES (?, ?, ?, 'سند صرف', ?, ?, ?, 'posted', ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `, [
          entryNo, date,
          `سند صرف ${receipt_no} ${cleanCheckNo ? '(شيك: ' + cleanCheckNo + ')' : ''} - ${notes || expense_type}`,
          expenseId, parsedAmount, parsedAmount,
          creatorId, creatorName, creatorId, creatorName
        ]);

        const jeId = jeRes.lastInsertRowid || jeRes.insertId;
        const debitAccountId = accId || 10;

        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes) 
          VALUES (?, ?, ?, ?, ?, 0, ?)
        `, [jeId, debitAccountId, finalCcId, pId, parsedAmount, `مصروف ${expense_type}${cleanCheckNo ? ' - شيك: ' + cleanCheckNo : ''}`]);

        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes) 
          VALUES (?, 3, ?, ?, 0, ?, ?)
        `, [jeId, finalCcId, pId, parsedAmount, `الصندوق الرئيسي / البنك - طريقة الدفع: ${payment_method}${cleanCheckNo ? ' (شيك: ' + cleanCheckNo + ')' : ''}`]);
      }

      return result;
    });

    await logAudit(req, {
      action: finalStatus === 'draft' ? 'CREATE_DRAFT' : 'INSERT',
      entity_type: 'expense',
      entity_id: receipt_no,
      details: { amount: parsedAmount, expense_type, project_id: pId, status: finalStatus, created_by: creatorName },
      new_values: { receipt_no, amount: parsedAmount, date, status: finalStatus, created_by: creatorName }
    });

    res.json({
      success: true,
      message: finalStatus === 'draft' 
        ? `تم حفظ مسودة سند الصرف بنجاح برقم ${receipt_no} وهي جاهزة للمراجعة والاعتماد`
        : `تم حفظ وترحيل سند الصرف بنجاح برقم ${receipt_no} وتحديث الحسابات ومراكز التكلفة داخل معاملة ذرية آمنة`,
      receipt_no,
      status: finalStatus,
      id: txResult.lastInsertRowid || txResult.insertId
    });
  } catch (err) {
    const status = err.message.includes('لا يمكن') || err.message.includes('مغلقة') ? 400 : 500;
    res.status(status).json({ success: false, message: 'خطأ أثناء إضافة سند الصرف: ' + err.message, error: err.message });
  }
});

// إرسال المسودة للمراجعة (Draft -> Under Review)
router.post('/:id/submit-review', requirePermission('expenses:edit,expenses:create'), async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    const exp = await get('SELECT * FROM expenses WHERE id = ?', [id]);
    if (!exp) return res.status(404).json({ success: false, message: 'سند الصرف غير موجود' });

    if (exp.status !== 'draft') {
      return res.status(400).json({ success: false, message: `لا يمكن إرسال السند للمراجعة لأنه في حالة [${exp.status}]` });
    }

    const rawRevId = req.user?.id || null;
    const reviewerId = await FinancialControlService.resolveValidUserId(rawRevId);
    const reviewerName = req.user?.username || req.user?.full_name || 'مراجع الحسابات';
    await run(`
      UPDATE expenses 
      SET status = 'under_review', reviewed_by = ?, reviewed_by_name = ?, reviewed_at = CURRENT_TIMESTAMP, review_notes = ?
      WHERE id = ?
    `, [reviewerId, reviewerName, notes || null, id]);

    await logAudit(req, {
      action: 'SUBMIT_REVIEW',
      entity_type: 'expense',
      entity_id: exp.receipt_no,
      old_values: { status: 'draft' },
      new_values: { status: 'under_review', reviewed_by: reviewerName }
    });

    res.json({ success: true, message: `تم إرسال سند الصرف (${exp.receipt_no}) للمراجعة بنجاح`, status: 'under_review' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// اعتماد سند الصرف مع تطبيق مبدأ العيون الأربع (Maker-Checker / Four-Eyes Principle)
router.post('/:id/approve', requirePermission('expenses:approve'), async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    const exp = await get('SELECT * FROM expenses WHERE id = ?', [id]);
    if (!exp) return res.status(404).json({ success: false, message: 'سند الصرف غير موجود' });

    // 1. فحص مبدأ العيون الأربع (لا يجوز لمنشئ السند اعتماده بنفسه)
    try {
      FinancialControlService.assertMakerChecker(exp, req.user, 'اعتماد');
    } catch (soDError) {
      return res.status(403).json({ success: false, message: soDError.message, fourEyesViolation: true });
    }

    // 2. فحص الفترة المحاسبية
    await FinancialControlService.assertPeriodOpen(exp.date);

    if (exp.status === 'approved' || exp.status === 'posted') {
      return res.status(400).json({ success: false, message: 'السند معتمد مسبقاً' });
    }

    const rawAppId = req.user?.id || null;
    const approverId = await FinancialControlService.resolveValidUserId(rawAppId);
    const approverName = req.user?.username || req.user?.full_name || 'المدير المالي';
    await run(`
      UPDATE expenses 
      SET status = 'approved', approved_by = ?, approved_by_name = ?, approved_at = CURRENT_TIMESTAMP, approval_notes = ?
      WHERE id = ?
    `, [approverId, approverName, notes || null, id]);

    await logAudit(req, {
      action: 'APPROVE',
      entity_type: 'expense',
      entity_id: exp.receipt_no,
      old_values: { status: exp.status },
      new_values: { status: 'approved', approved_by: approverName },
      reason: notes || 'اعتماد مالي قانوني'
    });

    res.json({ success: true, message: `تم اعتماد سند الصرف (${exp.receipt_no}) بنجاح من قبل [${approverName}]`, status: 'approved' });
  } catch (err) {
    const status = err.message.includes('انتهاك') || err.message.includes('لا يجوز') ? 403 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
});

// ترحيل سند الصرف لدفتر الأستاذ والصندوق (Post to GL)
router.post('/:id/post', requirePermission('expenses:post,accounting:post'), async (req, res) => {
  try {
    const { id } = req.params;
    const exp = await get('SELECT * FROM expenses WHERE id = ?', [id]);
    if (!exp) return res.status(404).json({ success: false, message: 'سند الصرف غير موجود' });

    if (exp.status === 'posted') {
      return res.status(400).json({ success: false, message: 'السند مرحل مسبقاً' });
    }
    if (exp.status === 'reversed') {
      return res.status(400).json({ success: false, message: 'لا يمكن ترحيل سند تم عكسه مسبقاً' });
    }

    await FinancialControlService.assertPeriodOpen(exp.date);

    const rawPosterId = req.user?.id || null;
    const posterId = await FinancialControlService.resolveValidUserId(rawPosterId);
    const posterName = req.user?.username || req.user?.full_name || 'المحاسب المالي';
    const parsedAmount = Number(exp.amount);

    await transaction(async (tx) => {
      // 1. تحديث التكلفة الفعلية للمشروع
      if (exp.project_id) {
        await tx.run(`UPDATE projects SET actual_cost = actual_cost + ? WHERE id = ?`, [parsedAmount, exp.project_id]);
      }

      // 2. تحديث رصيد المورد
      if (exp.supplier_id) {
        await tx.run(`UPDATE suppliers SET balance = balance + ? WHERE id = ?`, [parsedAmount, exp.supplier_id]);
      }

      // 3. تحديث حركة الصندوق والبنك
      const lastCash = await tx.get('SELECT current_balance FROM cash_movements ORDER BY id DESC LIMIT 1') || { current_balance: 125000 };
      const prevBal = Number(lastCash.current_balance) || 0;
      const newBal = prevBal - parsedAmount;
      const moveDesc = exp.payment_method === 'شيك' 
        ? `سند صرف بشيك رقم ${exp.check_no}: ${exp.receipt_no} - ${exp.expense_type}`
        : `سند صرف: ${exp.receipt_no} - ${exp.expense_type}`;

      await tx.run(`
        INSERT INTO cash_movements (previous_balance, cash_in, cash_out, withdrawals, current_balance, currency, date, notes)
        VALUES (?, 0, ?, 0, ?, ?, ?, ?)
      `, [prevBal, parsedAmount, newBal, exp.currency || 'ر.ي', exp.date, moveDesc]);

      // 4. تسجيل قيد يومي تلقائي متزن
      const entryCount = await tx.get('SELECT COUNT(*) as cnt FROM journal_entries');
      let jeSeq = ((entryCount ? entryCount.cnt : 0) || 0) + 1;
      let entryNo = `JE-${String(jeSeq).padStart(5, '0')}`;
      while (await tx.get('SELECT id FROM journal_entries WHERE entry_no = ?', [entryNo])) {
        jeSeq++;
        entryNo = `JE-${String(jeSeq).padStart(5, '0')}`;
      }
      const jeRes = await tx.run(`
        INSERT INTO journal_entries (
          entry_no, date, description, reference_type, reference_id, 
          total_debit, total_credit, status, created_by, created_by_name, posted_by, posted_by_name, posted_at
        )
        VALUES (?, ?, ?, 'سند صرف', ?, ?, ?, 'posted', ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        entryNo, exp.date,
        `سند صرف مرحل ${exp.receipt_no} - ${exp.notes || exp.expense_type}`,
        exp.id, parsedAmount, parsedAmount,
        posterId, posterName, posterId, posterName
      ]);

      const jeId = jeRes.lastInsertRowid || jeRes.insertId;
      const debitAccountId = exp.account_id || 10;
      const finalCcId = exp.cost_center_id || 1;

      await tx.run(`
        INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes) 
        VALUES (?, ?, ?, ?, ?, 0, ?)
      `, [jeId, debitAccountId, finalCcId, exp.project_id, parsedAmount, `مصروف ${exp.expense_type}`]);

      await tx.run(`
        INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes) 
        VALUES (?, 3, ?, ?, 0, ?, ?)
      `, [jeId, finalCcId, exp.project_id, parsedAmount, `الصندوق / البنك - ترحيل سند صرف`]);

      // 5. تحديث حالة السند
      await tx.run(`
        UPDATE expenses 
        SET status = 'posted', posted_by = ?, posted_by_name = ?, posted_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [posterId, posterName, exp.id]);
    });

    await logAudit(req, {
      action: 'POST',
      entity_type: 'expense',
      entity_id: exp.receipt_no,
      old_values: { status: exp.status },
      new_values: { status: 'posted', posted_by: posterName }
    });

    res.json({ success: true, message: `تم ترحيل سند الصرف (${exp.receipt_no}) بنجاح وتوليد القيد المحاسبي`, status: 'posted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء ترحيل سند الصرف: ' + err.message });
  }
});

// تعديل سند صرف (محمي: ممنوع للمستندات المعتمدة أو المرحلة أو المقفلة)
router.put('/:id', requirePermission('expenses:edit'), async (req, res) => {
  try {
    const { id } = req.params;
    const exp = await get('SELECT * FROM expenses WHERE id = ?', [id]);
    if (!exp) return res.status(404).json({ success: false, message: 'سند الصرف غير موجود' });

    // التحقق الصارم من حظر التعديل المباشر على المستندات المحاسبية المعتمدة أو المرحلة
    try {
      FinancialControlService.assertMutable(exp, 'تعديل قيمة أو بيانات');
    } catch (mErr) {
      return res.status(400).json({ success: false, message: mErr.message, immutable: true });
    }

    await FinancialControlService.assertPeriodOpen(exp.date);

    const { expense_type, amount, recipient, notes, date } = req.body;
    const targetDate = date || exp.date;
    await FinancialControlService.assertPeriodOpen(targetDate);

    const oldVals = { expense_type: exp.expense_type, amount: exp.amount, notes: exp.notes, date: exp.date };
    const newVals = { 
      expense_type: expense_type || exp.expense_type, 
      amount: amount ? Number(amount) : exp.amount, 
      recipient: recipient !== undefined ? recipient : exp.recipient, 
      notes: notes !== undefined ? notes : exp.notes,
      date: targetDate
    };

    await run(`
      UPDATE expenses 
      SET expense_type = ?, amount = ?, recipient = ?, notes = ?, date = ?
      WHERE id = ?
    `, [newVals.expense_type, newVals.amount, newVals.recipient, newVals.notes, newVals.date, id]);

    await logAudit(req, {
      action: 'UPDATE',
      entity_type: 'expense',
      entity_id: exp.receipt_no,
      old_values: oldVals,
      new_values: newVals,
      reason: req.body.reason || 'تعديل مسودة سند صرف'
    });

    res.json({ success: true, message: 'تم تعديل مسودة سند الصرف بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// تنفيذ قيد عكسي لسند الصرف (Storno Reversal / التصحيح المحاسبي القانوني)
router.post('/:id/reverse', requirePermission('expenses:cancel,expenses:approve,accounting:approve'), async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, reversal_date } = req.body;

    const result = await FinancialControlService.reverseExpense(id, {
      user: req.user,
      reason,
      reversal_date,
      req
    });

    res.json(result);
  } catch (err) {
    const status = err.message.includes('لا يمكن') || err.message.includes('يجب كتابة') || err.message.includes('مغلقة') ? 400 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
});

// حذف سند صرف (محمي صارماً: للمسودات فقط! يمنع حذف أي مستند معتمد أو مرحل)
router.delete('/:id', requirePermission('expenses:cancel'), async (req, res) => {
  try {
    const exp = await get('SELECT * FROM expenses WHERE id = ?', [req.params.id]);
    if (!exp) {
      return res.status(404).json({ success: false, message: 'سند الصرف غير موجود' });
    }

    // التحقق الصارم من منع الحذف المباشر للسجلات المالية المعتمدة/المرحلة
    try {
      FinancialControlService.assertDeletable(exp);
    } catch (dErr) {
      return res.status(400).json({ 
        success: false, 
        message: dErr.message, 
        financialControlProtected: true 
      });
    }

    await FinancialControlService.assertPeriodOpen(exp.date);

    await run('DELETE FROM expenses WHERE id = ?', [req.params.id]);

    await logAudit(req, {
      action: 'DELETE_DRAFT',
      entity_type: 'expense',
      entity_id: req.params.id,
      old_values: { receipt_no: exp.receipt_no, amount: exp.amount, date: exp.date, status: exp.status },
      reason: req.body?.reason || 'حذف مسودة سند صرف غير معتمدة'
    });

    res.json({ success: true, message: 'تم حذف مسودة سند الصرف بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في حذف سند الصرف: ' + err.message, error: err.message });
  }
});

module.exports = router;
