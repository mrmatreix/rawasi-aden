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

// القيود اليومية مع سطورها
router.get('/journal-entries', async (req, res) => {
  try {
    const entries = await query('SELECT * FROM journal_entries ORDER BY date DESC, id DESC');
    const enriched = await Promise.all(entries.map(async (entry) => {
      const lines = await query(`
        SELECT jel.*, a.name as account_name, a.code as account_code, p.name as project_name
        FROM journal_entry_lines jel
        LEFT JOIN accounts a ON jel.account_id = a.id
        LEFT JOIN projects p ON jel.project_id = p.id
        WHERE jel.entry_id = ?
      `, [entry.id]);
      return { ...entry, lines };
    }));
    res.json({ success: true, data: enriched });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب القيود اليومية', error: err.message });
  }
});

// إنشاء قيد يدوي داخل Transaction ذرية
router.post('/journal-entries', async (req, res) => {
  try {
    const { date = new Date().toISOString().split('T')[0], description, lines } = req.body;
    if (!description || !lines || lines.length < 2) {
      return res.status(400).json({ success: false, message: 'القيد اليومي يتطلب بياناً وطرفين على الأقل (مدين ودائن)' });
    }

    let totalDebit = 0;
    let totalCredit = 0;
    for (const line of lines) {
      totalDebit += Number(line.debit || 0);
      totalCredit += Number(line.credit || 0);
    }

    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      return res.status(400).json({ success: false, message: 'القيد غير متزن! إجمالي المدين يجب أن يساوي إجمالي الدائن' });
    }

    const countRes = await get('SELECT COUNT(*) as cnt FROM journal_entries');
    const entry_no = `JE-${String(((countRes ? countRes.cnt : 0) || 0) + 1).padStart(5, '0')}`;

    const txResult = await transaction(async (tx) => {
      const jeRes = await tx.run(`
        INSERT INTO journal_entries (entry_no, date, description, reference_type, total_debit, total_credit)
        VALUES (?, ?, ?, 'قيد يدوي', ?, ?)
      `, [entry_no, date, description, totalDebit, totalCredit]);

      const jeId = jeRes.lastInsertRowid || jeRes.insertId;

      for (const line of lines) {
        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, project_id, debit, credit, notes)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [jeId, line.account_id, line.project_id || null, Number(line.debit || 0), Number(line.credit || 0), line.notes || '']);
      }

      return jeRes;
    });

    res.json({
      success: true,
      message: 'تم حفظ القيد اليومي المتزن بنجاح',
      entry_no,
      id: txResult.lastInsertRowid || txResult.insertId
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في تسجيل القيد: ' + err.message, error: err.message });
  }
});

// جلب النثريات والعهد
router.get('/custodies', async (req, res) => {
  try {
    const custodies = await query('SELECT * FROM custodies ORDER BY date DESC, id DESC');
    res.json({ success: true, data: custodies });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب العهد والنثريات', error: err.message });
  }
});

// تسجيل عهدة أو نثرية
router.post('/custodies', async (req, res) => {
  try {
    const {
      operation_type = 'صرف عهدة',
      employee_name,
      total_amount,
      spent_amount = 0,
      currency = 'ر.ي',
      date = new Date().toISOString().split('T')[0],
      notes
    } = req.body;

    if (!employee_name || !total_amount) {
      return res.status(400).json({ success: false, message: 'اسم الموظف وإجمالي العهدة مطلوبان' });
    }

    const parsedTotal = Number(total_amount);
    const parsedSpent = Number(spent_amount);
    const remaining = parsedTotal - parsedSpent;
    const selectedCurrency = currency || 'ر.ي';

    const result = await run(`
      INSERT INTO custodies (operation_type, employee_name, total_amount, spent_amount, remaining_amount, currency, date, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [operation_type, employee_name, parsedTotal, parsedSpent, remaining, selectedCurrency, date, notes || '']);

    res.json({
      success: true,
      message: 'تم تسجيل العهدة بنجاح',
      id: result.lastInsertRowid || result.insertId,
      remaining
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في تسجيل العهدة', error: err.message });
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
