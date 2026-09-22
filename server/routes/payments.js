const express = require('express');
const router = express.Router();
const { query, get, run, transaction } = require('../database/db');
const { logAudit } = require('../services/auditService');
const { checkPeriodOpen } = require('../services/periodService');

// جلب سندات القبض والصرف مع بيانات الحسابات ومراكز التكلفة
router.get('/', async (req, res) => {
  try {
    const { type, client_id, supplier_id, project_id } = req.query;
    let sql = `
      SELECT p.*, 
        c.name as client_name, 
        s.name as supplier_name,
        pr.name as project_name,
        a.name as account_name,
        a.code as account_code,
        cc.name as cost_center_name,
        cc.code as cost_center_code
      FROM payments p
      LEFT JOIN clients c ON p.client_id = c.id
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      LEFT JOIN projects pr ON p.project_id = pr.id
      LEFT JOIN accounts a ON p.account_id = a.id
      LEFT JOIN cost_centers cc ON p.cost_center_id = cc.id
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
      account_id,
      cost_center_id,
      amount,
      currency = 'ر.ي',
      payment_method = 'نقدي', // تحويل بنكي، نقدي، شيك
      check_no,
      bank_name,
      date = new Date().toISOString().split('T')[0],
      notes
    } = req.body;

    // 1. التحقق من إغلاق الفترة المحاسبية لتاريخ السند
    const periodCheck = await checkPeriodOpen(date);
    if (!periodCheck.isOpen) {
      return res.status(403).json({ success: false, message: periodCheck.message });
    }

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'المبلغ مطلوب ويجب أن يكون أكبر من الصفر' });
    }

    // شرط التحقق الإلزامي: عند القبض أو الصرف بشيك يجب تحديد رقم الشيك
    if (payment_method === 'شيك' && (!check_no || !String(check_no).trim())) {
      return res.status(400).json({ success: false, message: `عند إصدار سند ${type} بطريقة الدفع (شيك) يجب إدخال رقم الشيك` });
    }

    const parsedAmount = Number(amount);
    const selectedCurrency = currency || 'ر.ي';
    const cleanCheckNo = check_no ? String(check_no).trim() : null;
    const cleanBankName = bank_name ? String(bank_name).trim() : null;

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
    const accId = account_id && account_id !== '' ? Number(account_id) : null;
    let finalCcId = cost_center_id && cost_center_id !== '' ? Number(cost_center_id) : null;

    // إلزامية وإسناد مركز التكلفة تلقائياً
    if (!finalCcId && pId) {
      const prjCc = await get('SELECT id FROM cost_centers WHERE project_id = ? LIMIT 1', [pId]);
      if (prjCc) finalCcId = prjCc.id;
    }
    if (!finalCcId) {
      finalCcId = 1; // مركز التكلفة العام CC-100
    }

    // تنفيذ المعاملة المالية ككتلة واحدة (Atomic Transaction)
    const txResult = await transaction(async (tx) => {
      // 1. تسجيل السند
      const result = await tx.run(`
        INSERT INTO payments (
          receipt_no, type, client_id, supplier_id, project_id, 
          account_id, cost_center_id, amount, currency, payment_method, 
          check_no, bank_name, date, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        receipt_no, type, cId, sId, pId,
        accId, finalCcId, parsedAmount, selectedCurrency, payment_method,
        cleanCheckNo, cleanBankName, date, notes || ''
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
      const moveDesc = payment_method === 'شيك' 
        ? `سند ${type} بشيك رقم ${cleanCheckNo}: ${receipt_no}`
        : `سند ${type}: ${receipt_no}`;

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
        moveDesc
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
        `سند ${type} رقم ${receipt_no} ${cleanCheckNo ? '(شيك: ' + cleanCheckNo + ')' : ''} - ${notes || ''}`,
        `سند ${type}`,
        result.lastInsertRowid || result.insertId,
        parsedAmount,
        parsedAmount
      ]);

      const jeId = jeRes.lastInsertRowid || jeRes.insertId;

      // 5. سطور القيد المدين والدائن مع الحساب ومركز التكلفة المختارين
      if (type === 'قبض') {
        // الطرف المدين: الصندوق والبنك (حساب 3)
        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes) 
          VALUES (?, 3, ?, ?, ?, 0, ?)
        `, [jeId, finalCcId, pId, parsedAmount, `قبض في الصندوق / البنك - طريقة: ${payment_method}${cleanCheckNo ? ' (شيك: ' + cleanCheckNo + ')' : ''}`]);

        // الطرف الدائن: الحساب المختار (أو حساب العملاء 4 افتراضياً)
        const creditAcc = accId || 4;
        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes) 
          VALUES (?, ?, ?, ?, 0, ?, ?)
        `, [jeId, creditAcc, finalCcId, pId, parsedAmount, `تخفيض ذمة العميل / الإيراد المالي`]);
      } else {
        // الطرف المدين: الحساب المختار (أو حساب الموردون 7 افتراضياً)
        const debitAcc = accId || 7;
        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes) 
          VALUES (?, ?, ?, ?, ?, 0, ?)
        `, [jeId, debitAcc, finalCcId, pId, parsedAmount, `سداد للمورد / إثبات المصروف`]);

        // الطرف الدائن: الصندوق والبنك (حساب 3)
        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes) 
          VALUES (?, 3, ?, ?, 0, ?, ?)
        `, [jeId, finalCcId, pId, parsedAmount, `صرف من الصندوق / البنك - طريقة: ${payment_method}${cleanCheckNo ? ' (شيك: ' + cleanCheckNo + ')' : ''}`]);
      }

      return result;
    });

    await logAudit(req, {
      action: 'INSERT',
      entity_type: type === 'قبض' ? 'receipt' : 'payment_voucher',
      entity_id: receipt_no,
      details: { type, amount: parsedAmount, client_id: cId, supplier_id: sId, project_id: pId, cost_center_id: finalCcId, payment_method }
    });

    res.json({
      success: true,
      message: `تم تسجيل سند ال${type} بنجاح برقم ${receipt_no} وحفظ القيد اليومي التلقائي مع الحساب ومركز التكلفة`,
      receipt_no,
      id: txResult.lastInsertRowid || txResult.insertId
    });
  } catch (err) {
    console.error('Payment transaction error:', err);
    res.status(500).json({ success: false, message: 'خطأ أثناء تسجيل السند: ' + err.message, error: err.message });
  }
});

// حذف سند قبض أو صرف
router.delete('/:id', async (req, res) => {
  try {
    const pay = await get('SELECT * FROM payments WHERE id = ?', [req.params.id]);
    if (!pay) {
      return res.status(404).json({ success: false, message: 'السند غير موجود' });
    }

    const periodCheck = await checkPeriodOpen(pay.date);
    if (!periodCheck.isOpen) {
      return res.status(403).json({ success: false, message: periodCheck.message });
    }

    await transaction(async (tx) => {
      // إرجاع أرصدة العملاء أو الموردين
      if (pay.client_id && pay.type === 'قبض') {
        await tx.run('UPDATE clients SET current_balance = current_balance + ? WHERE id = ?', [pay.amount, pay.client_id]);
      } else if (pay.supplier_id && pay.type === 'صرف') {
        await tx.run('UPDATE suppliers SET balance = balance + ? WHERE id = ?', [pay.amount, pay.supplier_id]);
      }

      await tx.run('DELETE FROM payments WHERE id = ?', [req.params.id]);
    });

    await logAudit(req, {
      action: 'DELETE',
      entity_type: pay.type === 'قبض' ? 'receipt' : 'payment_voucher',
      entity_id: pay.receipt_no,
      details: { receipt_no: pay.receipt_no, type: pay.type, amount: pay.amount, date: pay.date }
    });

    res.json({ success: true, message: `تم حذف سند ال${pay.type} بنجاح` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في حذف السند: ' + err.message });
  }
});

module.exports = router;
