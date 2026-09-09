const express = require('express');
const router = express.Router();
const { query, get, run } = require('../database/db');

// جلب فواتير المشتريات
router.get('/', (req, res) => {
  try {
    const { supplier_id, project_id } = req.query;
    let sql = `
      SELECT pu.*, 
        s.name as supplier_name, 
        p.name as project_name
      FROM purchases pu
      LEFT JOIN suppliers s ON pu.supplier_id = s.id
      LEFT JOIN projects p ON pu.project_id = p.id
    `;
    const params = [];
    const conditions = [];

    if (supplier_id) {
      conditions.push('pu.supplier_id = ?');
      params.push(supplier_id);
    }
    if (project_id) {
      conditions.push('pu.project_id = ?');
      params.push(project_id);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY pu.date DESC, pu.id DESC';
    const purchases = query(sql, params);
    res.json({ success: true, data: purchases });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب المشتريات', error: err.message });
  }
});

// إنشاء فاتورة شراء جديدة
router.post('/', (req, res) => {
  try {
    const {
      supplier_id,
      project_id,
      total_amount,
      paid_amount = 0,
      payment_status = 'pending',
      payment_method = 'نقدي',
      currency = 'ر.ي',
      date = new Date().toISOString().split('T')[0],
      notes
    } = req.body;

    if (!supplier_id || !total_amount || Number(total_amount) <= 0) {
      return res.status(400).json({ success: false, message: 'يرجى تحديد المورد والمبلغ الإجمالي' });
    }

    const countRes = get('SELECT COUNT(*) as cnt FROM purchases');
    const invoice_no = `PO-${new Date().getFullYear()}-${String((countRes.cnt || 0) + 1).padStart(4, '0')}`;

    const parsedTotal = Number(total_amount);
    const parsedPaid = Number(paid_amount);
    const remaining = parsedTotal - parsedPaid;

    const result = run(`
      INSERT INTO purchases (
        invoice_no, supplier_id, project_id, total_amount, paid_amount, 
        payment_status, payment_method, currency, date, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      invoice_no, supplier_id, project_id || null, parsedTotal, parsedPaid,
      remaining === 0 ? 'paid' : (parsedPaid > 0 ? 'partial' : 'pending'),
      payment_method, currency, date, notes || ''
    ]);

    // زيادة رصيد المورد بالمبلغ المتبقي غير المسدد
    if (remaining > 0) {
      run('UPDATE suppliers SET balance = balance + ? WHERE id = ?', [remaining, supplier_id]);
    }

    // إذا دفعت مبالغ نقداً، تسجيل حركة الصندوق
    if (parsedPaid > 0) {
      const lastCash = get('SELECT current_balance FROM cash_movements ORDER BY id DESC LIMIT 1') || { current_balance: 125000 };
      const prevBal = lastCash.current_balance;
      const newBal = prevBal - parsedPaid;
      run(`
        INSERT INTO cash_movements (previous_balance, cash_in, cash_out, withdrawals, current_balance, date, notes)
        VALUES (?, 0, ?, 0, ?, ?, ?)
      `, [prevBal, parsedPaid, newBal, date, `سداد مشتريات: ${invoice_no}`]);
    }

    res.json({
      success: true,
      message: 'تم تسجيل فاتورة الشراء بنجاح',
      invoice_no,
      id: result.lastInsertRowid
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء إنشاء فاتورة المشتريات', error: err.message });
  }
});

module.exports = router;
