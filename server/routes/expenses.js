const express = require('express');
const router = express.Router();
const { query, get, run } = require('../database/db');

// جلب جميع المصروفات
router.get('/', (req, res) => {
  try {
    const { project_id, type } = req.query;
    let sql = `
      SELECT e.*, p.name as project_name, s.name as supplier_name
      FROM expenses e
      LEFT JOIN projects p ON e.project_id = p.id
      LEFT JOIN suppliers s ON e.supplier_id = s.id
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

    const expenses = query(sql, params);
    res.json({ success: true, data: expenses });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب المصروفات', error: err.message });
  }
});

// ملخص المصروفات حسب النوع (Donut Chart Data)
router.get('/types-summary', (req, res) => {
  try {
    const stats = query(`
      SELECT expense_type, SUM(amount) as total, COUNT(*) as count
      FROM expenses
      GROUP BY expense_type
      ORDER BY total DESC
    `);
    const totalAmount = stats.reduce((sum, item) => sum + (item.total || 0), 0);
    const formatted = stats.map(item => ({
      type: item.expense_type,
      total: item.total,
      percentage: totalAmount > 0 ? Math.round((item.total / totalAmount) * 100) : 0
    }));
    res.json({ success: true, data: formatted, grand_total: totalAmount });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب ملخص المصروفات', error: err.message });
  }
});

// إنشاء سند صرف جديد
router.post('/', (req, res) => {
  try {
    const {
      expense_type,
      project_id,
      supplier_id,
      amount,
      currency = 'ر.ي',
      payment_method = 'نقدي',
      date = new Date().toISOString().split('T')[0],
      notes,
      recipient
    } = req.body;

    if (!expense_type || !amount || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'يرجى تحديد نوع المصروف والمبلغ بشكل صحيح' });
    }

    // توليد رقم سند الصرف
    const countRes = get('SELECT COUNT(*) as cnt FROM expenses');
    const receipt_no = `EP-${new Date().getFullYear()}-${String((countRes.cnt || 0) + 1).padStart(4, '0')}`;

    const parsedAmount = Number(amount);
    const selectedCurrency = currency || 'ر.ي';

    const result = run(`
      INSERT INTO expenses (
        receipt_no, expense_type, project_id, supplier_id, 
        amount, currency, payment_method, recipient, date, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      receipt_no, expense_type, project_id || null, supplier_id || null,
      parsedAmount, selectedCurrency, payment_method, recipient || '', date, notes || ''
    ]);

    // إذا كان مرتبطاً بمشروع، زيادة التكلفة الفعلية للمشروع
    if (project_id) {
      run(`UPDATE projects SET actual_cost = actual_cost + ? WHERE id = ?`, [parsedAmount, project_id]);
    }

    // إذا كان المورد محدداً، تحديث رصيد المورد
    if (supplier_id) {
      run(`UPDATE suppliers SET balance = balance + ? WHERE id = ?`, [parsedAmount, supplier_id]);
    }

    // تحديث حركة الصندوق والبنك
    const lastCash = get('SELECT current_balance FROM cash_movements ORDER BY id DESC LIMIT 1') || { current_balance: 125000 };
    const prevBal = lastCash.current_balance;
    const newBal = prevBal - parsedAmount;
    run(`
      INSERT INTO cash_movements (previous_balance, cash_in, cash_out, withdrawals, current_balance, date, notes)
      VALUES (?, 0, ?, 0, ?, ?, ?)
    `, [prevBal, parsedAmount, newBal, date, `سند صرف: ${receipt_no} - ${expense_type}`]);

    // تسجيل قيد يومي تلقائي
    const entryCount = get('SELECT COUNT(*) as cnt FROM journal_entries');
    const entryNo = `JE-${String((entryCount.cnt || 0) + 1).padStart(5, '0')}`;
    const jeRes = run(`
      INSERT INTO journal_entries (entry_no, date, description, reference_type, reference_id, total_debit, total_credit)
      VALUES (?, ?, ?, 'سند صرف', ?, ?, ?)
    `, [entryNo, date, `سند صرف ${receipt_no} - ${notes || expense_type}`, result.lastInsertRowid, parsedAmount, parsedAmount]);

    // خطوط القيد: من حساب المصروفات إلى حساب الصندوق/البنك
    run(`INSERT INTO journal_entry_lines (entry_id, account_id, project_id, debit, credit, notes) VALUES (?, 10, ?, ?, 0, ?)`,
      [jeRes.lastInsertRowid, project_id || null, parsedAmount, `مصروف ${expense_type}`]
    );
    run(`INSERT INTO journal_entry_lines (entry_id, account_id, project_id, debit, credit, notes) VALUES (?, 3, ?, 0, ?, ?)`,
      [jeRes.lastInsertRowid, project_id || null, parsedAmount, `الصندوق الرئيسي - طريقة الدفع: ${payment_method}`]
    );

    res.json({
      success: true,
      message: 'تم حفظ سند الصرف بنجاح وتحديث الحسابات والمشروع',
      receipt_no,
      id: result.lastInsertRowid
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء إضافة سند الصرف', error: err.message });
  }
});

// حذف سند صرف
router.delete('/:id', (req, res) => {
  try {
    const exp = get('SELECT * FROM expenses WHERE id = ?', [req.params.id]);
    if (exp && exp.project_id) {
      run(`UPDATE projects SET actual_cost = MAX(0, actual_cost - ?) WHERE id = ?`, [exp.amount, exp.project_id]);
    }
    run('DELETE FROM expenses WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'تم حذف سند الصرف بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في حذف سند الصرف', error: err.message });
  }
});

module.exports = router;
