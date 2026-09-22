const express = require('express');
const router = express.Router();
const { query, get, run, transaction } = require('../database/db');
const { logAudit } = require('../services/auditService');
const { checkPeriodOpen } = require('../services/periodService');

// جلب الفواتير والمستخلصات
router.get('/', async (req, res) => {
  try {
    const { project_id, client_id, status } = req.query;
    let sql = `
      SELECT b.*, 
        p.name as project_name, 
        c.name as client_name 
      FROM bills b
      LEFT JOIN projects p ON b.project_id = p.id
      LEFT JOIN clients c ON b.client_id = c.id
    `;
    const params = [];
    const conditions = [];

    if (project_id) {
      conditions.push('b.project_id = ?');
      params.push(project_id);
    }
    if (client_id) {
      conditions.push('b.client_id = ?');
      params.push(client_id);
    }
    if (status) {
      conditions.push('b.status = ?');
      params.push(status);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY b.date DESC, b.id DESC';
    const bills = await query(sql, params);
    res.json({ success: true, data: bills });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب المستخلصات', error: err.message });
  }
});

// إنشاء مستخلص أو فاتورة أعمال جديدة داخل Transaction آمنة
router.post('/', async (req, res) => {
  try {
    const {
      bill_type = 'مستخلص جاري',
      project_id,
      client_id,
      amount,
      deduction = 0,
      status = 'معتمد',
      date = new Date().toISOString().split('T')[0],
      notes
    } = req.body;

    // 1. التحقق من إغلاق الفترة المحاسبية لتاريخ المستخلص
    const periodCheck = await checkPeriodOpen(date);
    if (!periodCheck.isOpen) {
      return res.status(403).json({ success: false, message: periodCheck.message });
    }

    if (!project_id || !amount || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'يرجى تحديد المشروع والمبلغ الإجمالي' });
    }

    const parsedAmount = Number(amount);
    const parsedDeduction = Number(deduction);
    const net_amount = parsedAmount - parsedDeduction;

    // جلب معرف العميل إن لم يكن محدد
    let finalClientId = client_id;
    if (!finalClientId) {
      const proj = await get('SELECT client_id FROM projects WHERE id = ?', [project_id]);
      if (proj) finalClientId = proj.client_id;
    }

    // توليد رقم المستخلص
    const countRes = await get('SELECT COUNT(*) as cnt FROM bills');
    const bill_no = `INV-${new Date().getFullYear()}-${String((countRes ? countRes.cnt : 0) + 1).padStart(4, '0')}`;

    const txResult = await transaction(async (tx) => {
      const result = await tx.run(`
        INSERT INTO bills (
          bill_no, bill_type, project_id, client_id, 
          amount, deduction, net_amount, status, date, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        bill_no, bill_type, project_id, finalClientId || null,
        parsedAmount, parsedDeduction, net_amount, status, date, notes || ''
      ]);

      // زيادة مستحقات العميل (الذمم المدينة) بصافي المستخلص
      if (finalClientId && status === 'معتمد') {
        await tx.run(`
          UPDATE clients SET 
            total_due = total_due + ?,
            current_balance = current_balance + ?
          WHERE id = ?
        `, [net_amount, net_amount, finalClientId]);
      }

      return result;
    });

    await logAudit(req, {
      action: 'INSERT',
      entity_type: 'bill',
      entity_id: bill_no,
      details: { bill_no, bill_type, project_id, client_id: finalClientId, amount: parsedAmount, net_amount, status, date }
    });

    res.json({
      success: true,
      message: 'تم إنشاء المستخلص واعتماده بنجاح',
      bill_no,
      id: txResult.lastInsertRowid || txResult.insertId,
      net_amount
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في إنشاء المستخلص: ' + err.message, error: err.message });
  }
});

module.exports = router;
