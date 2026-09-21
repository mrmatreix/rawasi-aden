const express = require('express');
const router = express.Router();
const { query, get, run, transaction } = require('../database/db');
const { logAudit } = require('../services/auditService');
const { checkPeriodOpen } = require('../services/periodService');

// جلب جميع المصروفات مع بيانات الحساب ومركز التكلفة والمشروع والمورد
router.get('/', async (req, res) => {
  try {
    const { project_id, type } = req.query;
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
    if (project_id) {
      conditions.push(`e.project_id = ?`);
      params.push(project_id);
    }
    if (type) {
      conditions.push(`e.expense_type = ?`);
      params.push(type);
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
router.get('/types-summary', async (req, res) => {
  try {
    const stats = await query(`
      SELECT expense_type, SUM(amount) as total, COUNT(*) as count
      FROM expenses
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

// إنشاء سند صرف جديد داخل Transaction متكاملة
router.post('/', async (req, res) => {
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
      recipient
    } = req.body;

    // 1. التحقق من إغلاق الفترة المحاسبية لتاريخ السند
    const periodCheck = await checkPeriodOpen(date);
    if (!periodCheck.isOpen) {
      return res.status(403).json({ success: false, message: periodCheck.message });
    }

    if (!expense_type || !amount || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'يرجى تحديد نوع المصروف والمبلغ بشكل صحيح' });
    }

    // شرط التحقق الإلزامي: عند الصرف بشيك يجب تحديد رقم الشيك
    if (payment_method === 'شيك' && (!check_no || !String(check_no).trim())) {
      return res.status(400).json({ success: false, message: 'عند اختيار طريقة الدفع (شيك) يجب إدخال رقم الشيك' });
    }

    // توليد رقم سند الصرف
    const countRes = await get('SELECT COUNT(*) as cnt FROM expenses');
    const receipt_no = `EP-${new Date().getFullYear()}-${String(((countRes ? countRes.cnt : 0) || 0) + 1).padStart(4, '0')}`;

    const parsedAmount = Number(amount);
    const selectedCurrency = currency || 'ر.ي';
    const cleanCheckNo = check_no ? String(check_no).trim() : null;
    const cleanBankName = bank_name ? String(bank_name).trim() : null;

    const pId = project_id && project_id !== '' ? Number(project_id) : null;
    const sId = supplier_id && supplier_id !== '' ? Number(supplier_id) : null;
    const accId = account_id && account_id !== '' ? Number(account_id) : null;
    let finalCcId = cost_center_id && cost_center_id !== '' ? Number(cost_center_id) : null;

    // إلزامية وإسناد مركز التكلفة تلقائياً لمنع كسر تقارير الربحية
    if (!finalCcId && pId) {
      const prjCc = await get('SELECT id FROM cost_centers WHERE project_id = ? LIMIT 1', [pId]);
      if (prjCc) finalCcId = prjCc.id;
    }
    if (!finalCcId) {
      finalCcId = 1; // مركز التكلفة العام CC-100
    }

    const txResult = await transaction(async (tx) => {
      // 1. تسجيل سند الصرف
      const result = await tx.run(`
        INSERT INTO expenses (
          receipt_no, expense_type, project_id, supplier_id, 
          account_id, cost_center_id, amount, currency, payment_method, 
          check_no, bank_name, recipient, date, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        receipt_no, expense_type, pId, sId,
        accId, finalCcId, parsedAmount, selectedCurrency, payment_method,
        cleanCheckNo, cleanBankName, recipient || '', date, notes || ''
      ]);

      // 2. تحديث التكلفة الفعلية للمشروع إن وجد
      if (pId) {
        await tx.run(`UPDATE projects SET actual_cost = actual_cost + ? WHERE id = ?`, [parsedAmount, pId]);
      }

      // 3. تحديث رصيد المورد إن كان محدداً
      if (sId) {
        await tx.run(`UPDATE suppliers SET balance = balance + ? WHERE id = ?`, [parsedAmount, sId]);
      }

      // 4. تحديث حركة الصندوق والبنك
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

      // 5. تسجيل قيد يومي تلقائي متزن
      const entryCount = await tx.get('SELECT COUNT(*) as cnt FROM journal_entries');
      const entryNo = `JE-${String(((entryCount ? entryCount.cnt : 0) || 0) + 1).padStart(5, '0')}`;
      const jeRes = await tx.run(`
        INSERT INTO journal_entries (entry_no, date, description, reference_type, reference_id, total_debit, total_credit)
        VALUES (?, ?, ?, 'سند صرف', ?, ?, ?)
      `, [entryNo, date, `سند صرف ${receipt_no} ${cleanCheckNo ? '(شيك: ' + cleanCheckNo + ')' : ''} - ${notes || expense_type}`, result.lastInsertRowid || result.insertId, parsedAmount, parsedAmount]);

      const jeId = jeRes.lastInsertRowid || jeRes.insertId;

      // أسطر القيد: الطرف المدين (حساب المصروف المختار أو 10) والطرف الدائن (الصندوق والبنك 3)
      const debitAccountId = accId || 10;
      await tx.run(`
        INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes) 
        VALUES (?, ?, ?, ?, ?, 0, ?)
      `, [jeId, debitAccountId, finalCcId, pId, parsedAmount, `مصروف ${expense_type}${cleanCheckNo ? ' - شيك: ' + cleanCheckNo : ''}`]);

      await tx.run(`
        INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes) 
        VALUES (?, 3, ?, ?, 0, ?, ?)
      `, [jeId, finalCcId, pId, parsedAmount, `الصندوق الرئيسي / البنك - طريقة الدفع: ${payment_method}${cleanCheckNo ? ' (شيك: ' + cleanCheckNo + ')' : ''}`]);

      return result;
    });

    await logAudit(req, {
      action: 'INSERT',
      entity_type: 'expense',
      entity_id: receipt_no,
      details: { amount: parsedAmount, expense_type, project_id: pId, cost_center_id: finalCcId, payment_method }
    });

    res.json({
      success: true,
      message: 'تم حفظ سند الصرف بنجاح وتحديث الحسابات ومراكز التكلفة داخل معاملة ذرية آمنة',
      receipt_no,
      id: txResult.lastInsertRowid || txResult.insertId
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء إضافة سند الصرف: ' + err.message, error: err.message });
  }
});

// حذف سند صرف
router.delete('/:id', async (req, res) => {
  try {
    const exp = await get('SELECT * FROM expenses WHERE id = ?', [req.params.id]);
    if (!exp) {
      return res.status(404).json({ success: false, message: 'سند الصرف غير موجود' });
    }

    const periodCheck = await checkPeriodOpen(exp.date);
    if (!periodCheck.isOpen) {
      return res.status(403).json({ success: false, message: periodCheck.message });
    }

    if (exp.project_id) {
      await run(`UPDATE projects SET actual_cost = GREATEST(0, actual_cost - ?) WHERE id = ?`, [exp.amount, exp.project_id]);
    }
    await run('DELETE FROM expenses WHERE id = ?', [req.params.id]);

    await logAudit(req, {
      action: 'DELETE',
      entity_type: 'expense',
      entity_id: req.params.id,
      details: { receipt_no: exp.receipt_no, amount: exp.amount, date: exp.date }
    });

    res.json({ success: true, message: 'تم حذف سند الصرف بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في حذف سند الصرف', error: err.message });
  }
});

module.exports = router;
