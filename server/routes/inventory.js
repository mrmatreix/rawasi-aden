const express = require('express');
const router = express.Router();
const { query, get, run, transaction } = require('../database/db');

// جلب جميع المواد مع حالة المخزون وتنبيهات النواقص
router.get('/items', async (req, res) => {
  try {
    const items = await query(`
      SELECT *,
        CASE 
          WHEN current_quantity <= min_quantity THEN 1 
          ELSE 0 
        END as is_low_stock
      FROM items 
      ORDER BY id ASC
    `);
    res.json({ success: true, data: items });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب بيانات المواد', error: err.message });
  }
});

// إضافة صنف جديد للمخزن
router.post('/items', async (req, res) => {
  try {
    const { name, category, unit, min_quantity = 10, current_quantity = 0, unit_price = 0, currency = 'ر.ي', notes } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, message: 'اسم المادة مطلوب' });
    }

    const countRes = await get('SELECT COUNT(*) as cnt FROM items');
    const code = `ITM-${String(((countRes ? countRes.cnt : 0) || 0) + 1).padStart(2, '0')}`;
    const selectedCurrency = currency || 'ر.ي';

    const result = await run(`
      INSERT INTO items (code, name, category, unit, min_quantity, current_quantity, unit_price, currency, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [code, name, category || '', unit || '', Number(min_quantity), Number(current_quantity), Number(unit_price), selectedCurrency, notes || '']);

    res.json({
      success: true,
      message: 'تم إضافة الصنف بنجاح للمخزون',
      id: result.lastInsertRowid || result.insertId,
      code
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في إضافة المادة', error: err.message });
  }
});

// جلب حركات المخزون (صرف وتوريد)
router.get('/transactions', async (req, res) => {
  try {
    const { project_id, item_id, type } = req.query;
    let sql = `
      SELECT it.*, i.name as item_name, i.unit, p.name as project_name
      FROM inventory_transactions it
      JOIN items i ON it.item_id = i.id
      LEFT JOIN projects p ON it.project_id = p.id
    `;
    const params = [];
    const conditions = [];

    if (project_id) {
      conditions.push('it.project_id = ?');
      params.push(project_id);
    }
    if (item_id) {
      conditions.push('it.item_id = ?');
      params.push(item_id);
    }
    if (type) {
      conditions.push('it.type = ?');
      params.push(type);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY it.date DESC, it.id DESC';
    const txs = await query(sql, params);
    res.json({ success: true, data: txs });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب حركات المخزون', error: err.message });
  }
});

// تسجيل إذن صرف أو إدخال مخزني داخل Transaction ذرية
router.post('/transactions', async (req, res) => {
  try {
    const {
      item_id,
      project_id,
      type = 'out', // 'out' (صرف لمشروع) أو 'in' (توريد للمخزن)
      quantity,
      unit_price,
      recipient,
      date = new Date().toISOString().split('T')[0],
      notes
    } = req.body;

    if (!item_id || !quantity || Number(quantity) <= 0) {
      return res.status(400).json({ success: false, message: 'يرجى تحديد الصنف والكمية المطلوبة' });
    }

    const parsedQty = Number(quantity);

    const refPrefix = type === 'out' ? 'MAT-OUT' : 'MAT-IN';
    const countRes = await get('SELECT COUNT(*) as cnt FROM inventory_transactions WHERE type = ?', [type]);
    const reference_no = `${refPrefix}-${new Date().getFullYear()}-${String(((countRes ? countRes.cnt : 0) || 0) + 1).padStart(4, '0')}`;

    const txResult = await transaction(async (tx) => {
      const item = await tx.get('SELECT * FROM items WHERE id = ?', [item_id]);
      if (!item) {
        throw new Error('الصنف غير موجود في المخزن');
      }

      const parsedPrice = unit_price !== undefined ? Number(unit_price) : Number(item.unit_price || 0);
      const totalAmount = parsedQty * parsedPrice;

      if (type === 'out') {
        if (Number(item.current_quantity) < parsedQty) {
          throw new Error(`الكمية المتوفرة في المخزن (${item.current_quantity} ${item.unit}) لا تكفي للصرف المطلوب (${parsedQty} ${item.unit})`);
        }
        // إنقاص رصيد المخزن
        await tx.run('UPDATE items SET current_quantity = current_quantity - ? WHERE id = ?', [parsedQty, item_id]);

        // إذا كان الصرف لمشروع، زيادة التكلفة الفعلية للمشروع
        if (project_id) {
          await tx.run('UPDATE projects SET actual_cost = actual_cost + ? WHERE id = ?', [totalAmount, project_id]);
        }
      } else if (type === 'in') {
        // زيادة رصيد المخزن
        await tx.run('UPDATE items SET current_quantity = current_quantity + ? WHERE id = ?', [parsedQty, item_id]);
      }

      const result = await tx.run(`
        INSERT INTO inventory_transactions (
          item_id, project_id, type, quantity, unit_price, total_amount, 
          reference_no, recipient, date, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        item_id, project_id || null, type, parsedQty, parsedPrice, totalAmount,
        reference_no, recipient || '', date, notes || ''
      ]);

      return { result, totalAmount };
    });

    res.json({
      success: true,
      message: `تم تسجيل حركة المخزون (${type === 'out' ? 'صرف لمشروع' : 'توريد'}) وتحديث الأرصدة بنجاح`,
      reference_no,
      id: txResult.result.lastInsertRowid || txResult.result.insertId,
      total_amount: txResult.totalAmount
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

module.exports = router;
