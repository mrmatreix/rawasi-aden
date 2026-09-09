const express = require('express');
const router = express.Router();
const { query, get, run } = require('../database/db');

// جلب جميع الموردين
router.get('/', (req, res) => {
  try {
    const suppliers = query('SELECT * FROM suppliers ORDER BY id ASC');
    res.json({ success: true, data: suppliers });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب الموردين', error: err.message });
  }
});

// إضافة مورد جديد مع التأكيد والتحقق من قاعدة البيانات
router.post('/', (req, res) => {
  try {
    const { name, category, phone, email, address, balance = 0, currency = 'ر.ي', notes } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'اسم المورد مطلوب' });
    }

    const trimmedName = name.trim();
    const initialBalance = Number(balance) || 0;
    const selectedCurrency = currency || 'ر.ي';
    const result = run(`
      INSERT INTO suppliers (name, category, phone, email, address, balance, currency, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      trimmedName,
      category || 'مواد بناء',
      phone ? phone.trim() : '',
      email ? email.trim() : '',
      address ? address.trim() : '',
      initialBalance,
      selectedCurrency,
      notes ? notes.trim() : ''
    ]);

    if (!result || !result.lastInsertRowid) {
      return res.status(500).json({ success: false, message: 'فشل في حفظ المورد في قاعدة البيانات' });
    }

    const confirmedSupplier = get('SELECT * FROM suppliers WHERE id = ?', [result.lastInsertRowid]);
    if (!confirmedSupplier) {
      return res.status(500).json({
        success: false,
        message: 'فشل التأكد من إضافة المورد في قاعدة البيانات بعد محاولة الحفظ'
      });
    }

    res.json({
      success: true,
      message: `تم حفظ وتأكيد إضافة المورد (${confirmedSupplier.name}) في قاعدة البيانات بنجاح`,
      data: confirmedSupplier,
      id: confirmedSupplier.id
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء إضافة المورد: ' + err.message, error: err.message });
  }
});

module.exports = router;
