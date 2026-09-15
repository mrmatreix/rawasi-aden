const express = require('express');
const router = express.Router();
const { query, get, run, transaction } = require('../database/db');

// جلب سندات القبض والصرف
router.get('/', async (req, res) => {
  try {
    const { type, client_id, supplier_id, project_id } = req.query;
    let sql = `
      SELECT p.*, 
        c.name as client_name, 
        s.name as supplier_name,
        pr.name as project_name
      FROM payments p
      LEFT JOIN clients c ON p.client_id = c.id
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      LEFT JOIN projects pr ON p.project_id = pr.id
    `;
    const params = [];
    const conditions = [];

    if (type) {
      conditions.push('p.type = ?');
      params.push(type);
    }
    if (client_id) {
      conditions.push('p.client_id = ?');
      params.push(client_id);
    }
    if (supplier_id) {
      conditions.push('p.supplier_id = ?');
      params.push(supplier_id);
    }
    if (project_id) {
      conditions.push('p.project_id = ?');
      params.push(project_id);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY p.date DESC, p.id DESC';
    const payments = await query(sql, params);
    res.json({ success: true, data: payments });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب السندات والمدفوعات', error: err.message });
  }
});

// إنشاء سند قبض أو صرف داخل Transaction متكاملة
router.post('/', async (req, res) => {
  try {
    const {
      type = 'قبض', // 'قبض' أو 'صرف'
      client_id,
      supplier_id,
      project_id,
      amount,
      currency = 'ر.ي',
      payment_method = 'تحويل بنكي', // تحويل بنكي، نقدي، شيك
      date = new Date().toISOString().split('T')[0],
      notes
    } = req.body;

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'المبلغ مطلوب ويجب أن يكون أكبر من الصفر' });
    }

    const parsedAmount = Number(amount);
    const selectedCurrency = currency || 'ر.ي';

    // توليد رقم السند بطريقة آمنة تمنع التكرار: RC-2026-0001 أو PV-2026-0001
    const prefix = type === 'قبض' ? 'RC' : 'PV';
    const currentYear = new Date().getFullYear();
    const countRes = await get('SELECT COUNT(*) as cnt FROM payments WHERE type = ?', [type]);
    let seq = (countRes ? countRes.cnt : 0) + 1;
    let receipt_no = `${prefix}-${currentYear}-${String(seq).padStart(4, '0')}`;
    while (await get('SELECT id FROM payments WHERE receipt_no = ?', [receipt_no])) {
      seq++;
      receipt_no = `${prefix}-${currentYear}-${String(seq).padStart(4, '0')}`;
    }

    const cId = client_id && client_id !== '' ? Number(client_id) : null;
    const sId = supplier_id && supplier_id !== '' ? Number(supplier_id) : null;
    const pId = project_id && project_id !== '' ? Number(project_id) : null;

    // تنفيذ المعاملة المالية ككتلة واحدة (Atomic Transaction)
    const txResult = await transaction(async (tx) => {
      // 1. تسجيل السند
      const result = await tx.run(`
        INSERT INTO payments (
          receipt_no, type, client_id, supplier_id, project_id, 
          amount, currency, payment_method, date, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        receipt_no, type, cId, sId, pId,
        parsedAmount, selectedCurrency, payment_method, date, notes || ''
      ]);

      // 2. التأثير المحاسبي على العميل أو المورد
      if (type === 'قبض' && cId) {
        await tx.run(`
          UPDATE clients SET 
            total_paid = total_paid + ?,
            current_balance = GREATEST(0, current_balance - ?)
          WHERE id = ?
        `, [parsedAmount, parsedAmount, cId]);
      } else if (type === 'صرف' && sId) {
        await tx.run(`
          UPDATE suppliers SET balance = GREATEST(0, balance - ?) WHERE id = ?
        `, [parsedAmount, sId]);
      }

      // 3. التأثير على حركة الصندوق والبنك
      const lastCash = await tx.get('SELECT current_balance FROM cash_movements ORDER BY id DESC LIMIT 1') || { current_balance: 125000 };
      const prevBal = Number(lastCash.current_balance) || 0;
      const newBal = type === 'قبض' ? prevBal + parsedAmount : prevBal - parsedAmount;

      await tx.run(`
        INSERT INTO cash_movements (previous_balance, cash_in, cash_out, withdrawals, current_balance, currency, date, notes)
        VALUES (?, ?, ?, 0, ?, ?, ?, ?)
      `, [
        prevBal,
        type === 'قبض' ? parsedAmount : 0,
        type === 'صرف' ? parsedAmount : 0,
        newBal,
        selectedCurrency,
        date,
        `سند ${type}: ${receipt_no}`
      ]);

      // 4. توليد قيد يومي تلقائي متزن
      const entryCount = await tx.get('SELECT COUNT(*) as cnt FROM journal_entries');
      let jeSeq = (entryCount ? entryCount.cnt : 0) + 1;
      let entryNo = `JE-${String(jeSeq).padStart(5, '0')}`;
      while (await tx.get('SELECT id FROM journal_entries WHERE entry_no = ?', [entryNo])) {
        jeSeq++;
        entryNo = `JE-${String(jeSeq).padStart(5, '0')}`;
      }

      const jeRes = await tx.run(`
        INSERT INTO journal_entries (entry_no, date, description, reference_type, reference_id, total_debit, total_credit)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        entryNo,
        date,
        `سند ${type} رقم ${receipt_no} - ${notes || ''}`,
        `سند ${type}`,
        result.lastInsertRowid || result.insertId,
        parsedAmount,
        parsedAmount
      ]);

      const jeId = jeRes.lastInsertRowid || jeRes.insertId;

      // 5. سطور القيد المدين والدائن
      if (type === 'قبض') {
        // مدين: الصندوق والبنك (حساب 3) | دائن: العملاء (حساب 4)
        await tx.run(`INSERT INTO journal_entry_lines (entry_id, account_id, project_id, debit, credit, notes) VALUES (?, 3, ?, ?, 0, ?)`,
          [jeId, pId || null, parsedAmount, `قبض في الصندوق / البنك - طريقة: ${payment_method}`]
        );
        await tx.run(`INSERT INTO journal_entry_lines (entry_id, account_id, project_id, debit, credit, notes) VALUES (?, 4, ?, 0, ?, ?)`,
          [jeId, pId || null, parsedAmount, `تخفيض ذمة العميل`]
        );
      } else {
        // مدين: الموردون (حساب 7) | دائن: الصندوق والبنك (حساب 3)
        await tx.run(`INSERT INTO journal_entry_lines (entry_id, account_id, project_id, debit, credit, notes) VALUES (?, 7, ?, ?, 0, ?)`,
          [jeId, pId || null, parsedAmount, `سداد للمورد`]
        );
        await tx.run(`INSERT INTO journal_entry_lines (entry_id, account_id, project_id, debit, credit, notes) VALUES (?, 3, ?, 0, ?, ?)`,
          [jeId, pId || null, parsedAmount, `صرف من الصندوق`]
        );
      }

      return result;
    });

    res.json({
      success: true,
      message: `تم تسجيل سند ال${type} بنجاح برقم ${receipt_no} وحفظ القيد اليومي التلقائي`,
      receipt_no,
      id: txResult.lastInsertRowid || txResult.insertId
    });
  } catch (err) {
    console.error('Payment transaction error:', err);
    res.status(500).json({ success: false, message: 'خطأ أثناء تسجيل السند: ' + err.message, error: err.message });
  }
});

module.exports = router;
