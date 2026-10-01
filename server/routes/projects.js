const express = require('express');
const router = express.Router();
const { query, get, run } = require('../database/db');
const { requirePermission, parseScopeArray } = require('../middleware/security');

// جلب جميع المشاريع مع اسم العميل وتطبيق نطاق الصلاحيات
router.get('/', requirePermission('projects:view'), async (req, res) => {
  try {
    const { status } = req.query;
    let sql = `
      SELECT p.*, c.name as client_name 
      FROM projects p
      LEFT JOIN clients c ON p.client_id = c.id
    `;
    const params = [];
    const conditions = [];

    // فلترة نطاق المشاريع المصرح بها للمستخدم (Project Scoping)
    if (req.user && req.user.role !== 'admin' && req.user.username !== 'admin') {
      const allowedProjects = parseScopeArray(req.user.scope?.allowed_projects || req.user.allowed_projects);
      if (!allowedProjects.includes('*') && !allowedProjects.includes('all')) {
        if (allowedProjects.length === 0) {
          return res.json({ success: true, data: [] });
        }
        const placeholders = allowedProjects.map(() => '?').join(',');
        conditions.push(`p.id IN (${placeholders})`);
        params.push(...allowedProjects.map(Number));
      }
    }

    if (status) {
      conditions.push(`p.status = ?`);
      params.push(status);
    }

    if (conditions.length > 0) {
      sql += ` WHERE ` + conditions.join(' AND ');
    }

    sql += ` ORDER BY p.id ASC`;
    const projects = await query(sql, params);
    res.json({ success: true, data: projects });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب بيانات المشاريع', error: err.message });
  }
});

// جلب مشروع محدد بالتفصيل مع فحص الصلاحية والنطاق
router.get('/:id', requirePermission('projects:view', { projectParam: 'id' }), async (req, res) => {
  try {
    const project = await get(`
      SELECT p.*, c.name as client_name, c.phone as client_phone
      FROM projects p
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE p.id = ?
    `, [req.params.id]);

    if (!project) {
      return res.status(404).json({ success: false, message: 'المشروع غير موجود' });
    }

    const expenses = await query(`SELECT * FROM expenses WHERE project_id = ? ORDER BY date DESC`, [req.params.id]);
    const bills = await query(`SELECT * FROM bills WHERE project_id = ? ORDER BY date DESC`, [req.params.id]);
    const payments = await query(`SELECT * FROM payments WHERE project_id = ? AND type = 'قبض' ORDER BY date DESC`, [req.params.id]);
    const inventory = await query(`
      SELECT it.*, i.name as item_name, i.unit 
      FROM inventory_transactions it
      JOIN items i ON it.item_id = i.id
      WHERE it.project_id = ?
      ORDER BY it.date DESC
    `, [req.params.id]);

    res.json({
      success: true,
      data: {
        ...project,
        expenses,
        bills,
        payments,
        inventory
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب تفاصيل المشروع', error: err.message });
  }
});

// إنشاء مشروع جديد مع التأكيد والتحقق من قاعدة البيانات
router.post('/', requirePermission('projects:create'), async (req, res) => {
  try {
    const {
      name,
      client_id,
      contract_value = 0,
      estimated_cost = 0,
      actual_cost = 0,
      currency = 'ر.ي',
      progress_percentage = 0,
      expected_profit = 0,
      actual_profit = 0,
      status = 'active',
      start_date,
      end_date,
      notes
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'اسم المشروع مطلوب' });
    }

    const trimmedName = name.trim();
    const selectedCurrency = currency || 'ر.ي';

    // توليد كود المشروع تلقائياً
    const countRes = await get('SELECT COUNT(*) as cnt FROM projects');
    const code = `PRJ-${String(((countRes ? countRes.cnt : 0) || 0) + 1).padStart(3, '0')}`;

    const result = await run(`
      INSERT INTO projects (
        code, name, client_id, contract_value, estimated_cost, 
        actual_cost, currency, progress_percentage, expected_profit, actual_profit, 
        status, start_date, end_date, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      code, trimmedName, client_id ? Number(client_id) : null, Number(contract_value) || 0, Number(estimated_cost) || 0,
      Number(actual_cost) || 0, selectedCurrency, Number(progress_percentage) || 0, Number(expected_profit) || 0, Number(actual_profit) || 0,
      status || 'active', start_date || null, end_date || null, notes ? notes.trim() : ''
    ]);

    const newId = result.lastInsertRowid || result.insertId;

    const confirmedProject = await get(`
      SELECT p.*, c.name as client_name 
      FROM projects p 
      LEFT JOIN clients c ON p.client_id = c.id 
      WHERE p.id = ?
    `, [newId]);

    res.json({
      success: true,
      message: `تم حفظ وتأكيد إضافة المشروع (${confirmedProject ? confirmedProject.name : trimmedName}) في قاعدة البيانات بنجاح`,
      data: confirmedProject,
      id: newId,
      code: confirmedProject ? confirmedProject.code : code
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء إنشاء المشروع: ' + err.message, error: err.message });
  }
});

// تحديث مشروع مع فحص الصلاحية والنطاق
router.put('/:id', requirePermission('projects:edit', { projectParam: 'id' }), async (req, res) => {
  try {
    const {
      name,
      client_id,
      contract_value,
      estimated_cost,
      actual_cost,
      progress_percentage,
      expected_profit,
      actual_profit,
      status,
      currency,
      start_date,
      end_date,
      notes
    } = req.body;

    await run(`
      UPDATE projects SET
        name = COALESCE(?, name),
        client_id = COALESCE(?, client_id),
        contract_value = COALESCE(?, contract_value),
        estimated_cost = COALESCE(?, estimated_cost),
        actual_cost = COALESCE(?, actual_cost),
        currency = COALESCE(?, currency),
        progress_percentage = COALESCE(?, progress_percentage),
        expected_profit = COALESCE(?, expected_profit),
        actual_profit = COALESCE(?, actual_profit),
        status = COALESCE(?, status),
        start_date = COALESCE(?, start_date),
        end_date = COALESCE(?, end_date),
        notes = COALESCE(?, notes)
      WHERE id = ?
    `, [
      name, client_id, contract_value, estimated_cost, actual_cost,
      currency, progress_percentage, expected_profit, actual_profit, status,
      start_date, end_date, notes, req.params.id
    ]);

    res.json({ success: true, message: 'تم تحديث بيانات المشروع بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في تعديل المشروع', error: err.message });
  }
});

// حذف مشروع مع فحص الصلاحية والنطاق
router.delete('/:id', requirePermission('projects:cancel', { projectParam: 'id' }), async (req, res) => {
  try {
    await run('DELETE FROM projects WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'تم حذف المشروع بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في حذف المشروع', error: err.message });
  }
});

module.exports = router;
