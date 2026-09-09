const express = require('express');
const router = express.Router();
const { query, get, run } = require('../database/db');

// جلب جميع العملاء مع أرصدتهم
router.get('/', (req, res) => {
  try {
    const clients = query('SELECT * FROM clients ORDER BY id ASC');
    res.json({ success: true, data: clients });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب العملاء', error: err.message });
  }
});

// جلب عميل بالمعرف
router.get('/:id', (req, res) => {
  try {
    const client = get('SELECT * FROM clients WHERE id = ?', [req.params.id]);
    if (!client) {
      return res.status(404).json({ success: false, message: 'العميل غير موجود' });
    }
    res.json({ success: true, data: client });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب العميل', error: err.message });
  }
});

// إضافة عميل جديد مع التأكيد والتحقق من قاعدة البيانات
router.post('/', (req, res) => {
  try {
    const { name, company, phone, email, address, previous_balance = 0, currency = 'ر.ي', notes } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'اسم العميل مطلوب' });
    }

    const trimmedName = name.trim();
    const prevBal = Number(previous_balance) || 0;
    const selectedCurrency = currency || 'ر.ي';

    // إدراج العميل في قاعدة البيانات
    const result = run(`
      INSERT INTO clients (name, company, phone, email, address, previous_balance, current_balance, currency, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      trimmedName,
      company ? company.trim() : '',
      phone ? phone.trim() : '',
      email ? email.trim() : '',
      address ? address.trim() : '',
      prevBal,
      prevBal,
      selectedCurrency,
      notes ? notes.trim() : ''
    ]);

    if (!result || !result.lastInsertRowid) {
      return res.status(500).json({ success: false, message: 'فشل في حفظ العميل في قاعدة البيانات' });
    }

    // التحقق الفعلي والتأكيد من وجود العميل في قاعدة البيانات
    const confirmedClient = get('SELECT * FROM clients WHERE id = ?', [result.lastInsertRowid]);
    if (!confirmedClient) {
      return res.status(500).json({
        success: false,
        message: 'فشل التأكد من إضافة العميل في قاعدة البيانات بعد محاولة الحفظ'
      });
    }

    res.json({
      success: true,
      message: `تم حفظ وتأكيد إضافة العميل (${confirmedClient.name}) في قاعدة البيانات بنجاح`,
      data: confirmedClient,
      id: confirmedClient.id
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء حفظ العميل: ' + err.message, error: err.message });
  }
});

module.exports = router;
