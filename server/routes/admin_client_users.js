/**
 * مسارات إدارة حسابات بوابة العملاء (Admin Side - Client Users Management)
 * لنظام شركة رواسي عدن للهندسة والمقاولات
 * محمية بصلاحيات الفريق الداخلي (requireAuth)
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../database/db');
const { logAudit } = require('../services/auditService');

/**
 * GET /api/admin/client-users
 * استعراض قائمة حسابات العملاء مع تفاصيل العميل والمشاريع المسموحة
 */
router.get('/', async (req, res) => {
  try {
    const users = await db.query(`
      SELECT 
        cu.id,
        cu.client_id,
        cu.email,
        cu.phone,
        cu.full_name,
        cu.role,
        cu.status,
        cu.two_factor_enabled,
        cu.last_login_at,
        cu.last_login_ip,
        cu.device_platform,
        cu.created_at,
        c.name AS client_name,
        c.company AS client_company,
        (SELECT COUNT(id) FROM client_project_access WHERE client_user_id = cu.id) AS assigned_projects_count
      FROM client_users cu
      LEFT JOIN clients c ON c.id = cu.client_id
      ORDER BY cu.id DESC
    `);

    res.json({
      success: true,
      count: users.length,
      users
    });
  } catch (err) {
    console.error('Admin Client Users List Error:', err);
    res.status(500).json({ success: false, message: 'حدث خطأ في جلب حسابات العملاء' });
  }
});

/**
 * POST /api/admin/client-users
 * إنشاء حساب جديد لمستخدم عميل
 */
router.post('/', async (req, res) => {
  try {
    const { client_id, email, password, full_name, phone, role, status, two_factor_enabled, project_ids } = req.body;

    if (!client_id || !email || !password || !full_name) {
      return res.status(400).json({
        success: false,
        message: 'الحقول المطلوبة: العميل، البريد الإلكتروني، كلمة المرور، الاسم الكامل'
      });
    }

    const parsedClientId = parseInt(client_id, 10);
    if (isNaN(parsedClientId)) {
      return res.status(400).json({
        success: false,
        message: 'معرف العميل غير صحيح'
      });
    }

    const cleanEmail = String(email).trim().toLowerCase();

    // التحقق من عدم تكرار البريد الإلكتروني
    const existing = await db.get(`SELECT id FROM client_users WHERE LOWER(email) = ?`, [cleanEmail]);
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'البريد الإلكتروني مسجل بالفعل لمستخدم آخر'
      });
    }

    // التحقق من وجود العميل في سجلات العملاء
    const client = await db.get(`SELECT id, name FROM clients WHERE id = ?`, [parsedClientId]);
    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'العميل المحدد غير موجود في قاعدة البيانات'
      });
    }

    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(String(password), salt);
    const userRole = ['owner', 'manager', 'viewer'].includes(role) ? role : 'viewer';
    const userStatus = ['active', 'inactive', 'suspended'].includes(status) ? status : 'active';
    const enable2fa = typeof two_factor_enabled === 'boolean' ? (two_factor_enabled ? 1 : 0) : 1;

    const result = await db.run(`
      INSERT INTO client_users 
      (client_id, email, phone, password_hash, full_name, role, status, two_factor_enabled, two_factor_pin, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, '123456', CURRENT_TIMESTAMP)
    `, [
      parsedClientId,
      cleanEmail,
      phone ? String(phone).trim() : null,
      passwordHash,
      String(full_name).trim(),
      userRole,
      userStatus,
      enable2fa
    ]);

    const newUserId = result.lastID || result.lastInsertRowid || result.id;

    // تعيين المشاريع المسموحة إذا تم تمريرها، أو التعيين التلقائي لمشاريع العميل إذا كان المالك أو المدير
    let targetProjectIds = Array.isArray(project_ids) && project_ids.length > 0 ? project_ids : [];
    
    if (targetProjectIds.length === 0) {
      const clientProjs = await db.query(`
        SELECT id FROM projects WHERE client_id = ?
      `, [parsedClientId]);
      targetProjectIds = clientProjs.map(p => p.id);
    }

    if (targetProjectIds.length > 0) {
      for (const pId of targetProjectIds) {
        await db.run(`
          INSERT INTO client_project_access 
          (client_user_id, project_id, can_view_progress, can_view_invoices, can_view_payments, can_view_reports, can_view_drawings, can_approve_invoices, can_send_messages, granted_by)
          VALUES (?, ?, 1, 1, 1, 1, 1, ?, 1, ?)
        `, [newUserId, pId, userRole === 'owner' ? 1 : 0, req.user?.id || 1]);
      }
    }

    // تسجيل في سجل التدقيق
    await logAudit(req, {
      action: 'CLIENT_USER_CREATE',
      entity_type: 'client_users',
      entity_id: newUserId,
      details: `تم إنشاء حساب عميل جديد: ${full_name} (${cleanEmail}) للعميل التجاري ${client.name}`
    });

    res.json({
      success: true,
      message: 'تم إنشاء حساب العميل وتخصيص المشاريع بنجاح',
      user_id: newUserId,
      assigned_projects_count: targetProjectIds.length
    });
  } catch (err) {
    console.error('Create Client User Error:', err);
    res.status(500).json({ success: false, message: 'حدث خطأ في إنشاء حساب العميل: ' + (err.message || '') });
  }
});

/**
 * GET /api/admin/client-users/client-projects/:clientId
 * جلب قائمة المشاريع التابعة لعميل محدد لإتاحة اختيارها عند إضافة مستخدم
 */
router.get('/client-projects/:clientId', async (req, res) => {
  try {
    const clientId = parseInt(req.params.clientId, 10);
    const client = await db.get(`SELECT id, name FROM clients WHERE id = ?`, [clientId]);
    if (!client) {
      return res.json({ success: true, projects: [] });
    }

    const projects = await db.query(`
      SELECT id, name, code, status 
      FROM projects 
      WHERE client_id = ?
      ORDER BY id DESC
    `, [clientId]);

    res.json({ success: true, projects });
  } catch (err) {
    console.error('Error fetching client projects:', err);
    res.status(500).json({ success: false, message: 'خطأ في جلب مشاريع العميل' });
  }
});

/**
 * PUT /api/admin/client-users/:id
 * تعديل بيانات حساب العميل وحالته
 */
router.put('/:id', async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const { full_name, phone, role, status, two_factor_enabled, two_factor_pin } = req.body;

    const user = await db.get(`SELECT id, full_name, status, role FROM client_users WHERE id = ?`, [userId]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    const updates = [];
    const params = [];

    if (full_name) { updates.push('full_name = ?'); params.push(String(full_name).trim()); }
    if (phone !== undefined) { updates.push('phone = ?'); params.push(phone ? String(phone).trim() : null); }
    if (role && ['owner', 'manager', 'viewer'].includes(role)) { updates.push('role = ?'); params.push(role); }
    if (status && ['active', 'inactive', 'suspended'].includes(status)) { 
      updates.push('status = ?'); 
      params.push(status);
      // إذا تم تجميد الحساب، مسح التوكن فوراً للإلغاء اللحظي للجلسة
      if (status !== 'active') {
        updates.push('device_token = NULL');
      }
    }
    if (typeof two_factor_enabled === 'boolean') { updates.push('two_factor_enabled = ?'); params.push(two_factor_enabled ? 1 : 0); }
    if (two_factor_pin) { updates.push('two_factor_pin = ?'); params.push(String(two_factor_pin).trim()); }

    if (updates.length > 0) {
      updates.push('updated_at = CURRENT_TIMESTAMP');
      params.push(userId);
      await db.run(`UPDATE client_users SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    // سجل التدقيق
    await logAudit(req, {
      action: 'CLIENT_USER_UPDATE',
      entity_type: 'client_users',
      entity_id: userId,
      old_values: user,
      new_values: req.body,
      details: `تحديث بيانات حساب العميل (${user.full_name}) - الحالة الجديدة: ${status || user.status}`
    });

    res.json({ success: true, message: 'تم تحديث بيانات الحساب بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'حدث خطأ أثناء تعديل الحساب' });
  }
});

/**
 * POST /api/admin/client-users/:id/reset-password
 * إعادة تعيين كلمة مرور مستخدم العميل
 */
router.post('/:id/reset-password', async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const { new_password } = req.body;

    if (!new_password || String(new_password).length < 6) {
      return res.status(400).json({ success: false, message: 'كلمة المرور يجب أن تتكون من 6 أحرف على الأقل' });
    }

    const user = await db.get(`SELECT id, full_name, email FROM client_users WHERE id = ?`, [userId]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(String(new_password), salt);

    await db.run(`UPDATE client_users SET password_hash = ?, device_token = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [hash, userId]);

    await logAudit(req, {
      action: 'CLIENT_USER_PASSWORD_RESET',
      entity_type: 'client_users',
      entity_id: userId,
      details: `تمت إعادة تعيين كلمة المرور لحساب العميل: ${user.full_name} (${user.email})`
    });

    res.json({ success: true, message: 'تمت إعادة تعيين كلمة المرور بنجاح وإبطال الجلسات السابقة' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في إعادة تعيين كلمة المرور' });
  }
});

/**
 * POST /api/admin/client-users/:id/send-invite
 * توليد ودعوة العميل لتفعيل حسابه ودخوله لأول مرة (Invitation / Temp Access)
 */
router.post('/:id/send-invite', async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const user = await db.get(`SELECT id, full_name, email, phone, status FROM client_users WHERE id = ?`, [userId]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'حساب العميل غير موجود' });
    }

    // إنشاء كلمة مرور مؤقتة وتثبيتها
    const tempPassword = 'Rawasi#' + crypto.randomBytes(3).toString('hex').toUpperCase();
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(tempPassword, salt);

    await db.run(`
      UPDATE client_users 
      SET password_hash = ?, otp_code = ?, otp_expires_at = datetime('now', '+7 days'), updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `, [hash, otpCode, userId]);

    await logAudit(req, {
      action: 'CLIENT_USER_INVITE_SENT',
      entity_type: 'client_users',
      entity_id: userId,
      details: `تم إصداره وتجهيز دعوة تفعيل جديدة لحساب العميل: ${user.full_name}`
    });

    res.json({
      success: true,
      message: 'تمت إنشاء بيانات الدعوة ورمز التفعيل بنجاح',
      invite_details: {
        user_id: user.id,
        full_name: user.full_name,
        email: user.email,
        phone: user.phone,
        temp_password: tempPassword,
        otp_code: otpCode,
        portal_url: `${req.protocol}://${req.get('host')}/client-app/`,
        whatsapp_share_text: `مرحباً ${user.full_name}، تم إنشاء حسابك في بوابة عملاء شركة رواسي عدن للهندسة والمقاولات.\n\nالبريد: ${user.email}\nكلمة المرور المؤقتة: ${tempPassword}\nرمز الأمان (OTP): ${otpCode}\nرابط الدخول: ${req.protocol}://${req.get('host')}/client-app/`
      }
    });
  } catch (err) {
    console.error('Send Invite Error:', err);
    res.status(500).json({ success: false, message: 'حدث خطأ أثناء تجهيز دعوة التفعيل' });
  }
});

/**
 * POST /api/admin/client-users/:id/revoke-sessions
 * إنهاء وإبطال جميع الجلسات الفعالة لحساب العميل عند تجميد الحساب أو الاشتباه بالسيادة الأجهزة
 */
router.post('/:id/revoke-sessions', async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const user = await db.get(`SELECT id, full_name, email FROM client_users WHERE id = ?`, [userId]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'حساب العميل غير موجود' });
    }

    // إبطال الجلسة ومسح التوكن وحظر الدخول
    await db.run(`
      UPDATE client_users 
      SET device_token = NULL, status = 'suspended', updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `, [userId]);

    await logAudit(req, {
      action: 'CLIENT_USER_SESSIONS_REVOKED',
      entity_type: 'client_users',
      entity_id: userId,
      details: `تم إبطال جميع جلسات الدخول وتجميد الحساب فوراً لحساب العميل: ${user.full_name}`
    });

    res.json({ success: true, message: 'تم إبطال جميع الجلسات الفعالة وتجميد الحساب بنجاح' });
  } catch (err) {
    console.error('Revoke Sessions Error:', err);
    res.status(500).json({ success: false, message: 'حدث خطأ أثناء إبطال الجلسات' });
  }
});

/**
 * GET /api/admin/client-users/:id/projects
 * جلب المشاريع المخصصة للمستخدم
 */
router.get('/:id/projects', async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const access = await db.query(`
      SELECT 
        cpa.*,
        p.name AS project_name,
        p.code AS project_code,
        p.status AS project_status
      FROM client_project_access cpa
      INNER JOIN projects p ON p.id = cpa.project_id
      WHERE cpa.client_user_id = ?
    `, [userId]);

    res.json({ success: true, access });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب صلاحيات المشاريع' });
  }
});

/**
 * POST /api/admin/client-users/:id/projects
 * تحديث صلاحيات الوصول التفصيلية للمشاريع
 */
router.post('/:id/projects', async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const { projects } = req.body; // Array of { project_id, can_view_progress, can_view_invoices, can_view_payments, can_view_reports, can_view_drawings, can_approve_invoices, can_send_messages }

    if (!Array.isArray(projects)) {
      return res.status(400).json({ success: false, message: 'صيغة البيانات غير صحيحة' });
    }

    const user = await db.get(`SELECT id, full_name FROM client_users WHERE id = ?`, [userId]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'حساب العميل غير موجود' });
    }

    // حذف الصلاحيات السابقة وإعادة الإدراج بتفصيل دقيق
    await db.run(`DELETE FROM client_project_access WHERE client_user_id = ?`, [userId]);

    for (const p of projects) {
      await db.run(`
        INSERT INTO client_project_access 
        (client_user_id, project_id, can_view_progress, can_view_invoices, can_view_payments, can_view_reports, can_view_drawings, can_approve_invoices, can_send_messages, granted_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        userId,
        p.project_id,
        p.can_view_progress !== undefined ? (p.can_view_progress ? 1 : 0) : 1,
        p.can_view_invoices !== undefined ? (p.can_view_invoices ? 1 : 0) : 1,
        p.can_view_payments !== undefined ? (p.can_view_payments ? 1 : 0) : 1,
        p.can_view_reports !== undefined ? (p.can_view_reports ? 1 : 0) : 1,
        p.can_view_drawings !== undefined ? (p.can_view_drawings ? 1 : 0) : 1,
        p.can_approve_invoices !== undefined ? (p.can_approve_invoices ? 1 : 0) : 0,
        p.can_send_messages !== undefined ? (p.can_send_messages ? 1 : 0) : 1,
        req.user?.id || 1
      ]);
    }

    await logAudit(req, {
      action: 'CLIENT_USER_PERMISSIONS_UPDATE',
      entity_type: 'client_users',
      entity_id: userId,
      details: `تم تحديث مصفوفة الصلاحيات والمشاريع لـ ${user.full_name} (${projects.length} مشروع)`
    });

    res.json({ success: true, message: 'تم تحديث صلاحيات المشاريع بنجاح' });
  } catch (err) {
    console.error('Update client projects error:', err);
    res.status(500).json({ success: false, message: 'خطأ في تحديث صلاحيات المشاريع' });
  }
});

/**
 * DELETE /api/admin/client-users/:id
 * حذف حساب مستخدم العميل نهائياً
 */
router.delete('/:id', async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const user = await db.get(`SELECT id, full_name, email FROM client_users WHERE id = ?`, [userId]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'حساب العميل غير موجود' });
    }

    // حذف الصلاحيات والمشاريع المرتبطة أولاً
    await db.run(`DELETE FROM client_project_access WHERE client_user_id = ?`, [userId]);
    // حذف حساب العميل
    await db.run(`DELETE FROM client_users WHERE id = ?`, [userId]);

    await logAudit(req, {
      action: 'CLIENT_USER_DELETE',
      entity_type: 'client_users',
      entity_id: userId,
      details: `تم حذف حساب مستخدم العميل (${user.full_name} - ${user.email}) نهائياً`
    });

    res.json({ success: true, message: `تم حذف حساب العميل (${user.full_name}) بنجاح` });
  } catch (err) {
    console.error('Delete Client User Error:', err);
    res.status(500).json({ success: false, message: 'حدث خطأ أثناء حذف حساب العميل' });
  }
});

module.exports = router;
