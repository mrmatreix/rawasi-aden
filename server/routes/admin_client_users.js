/**
 * مسارات إدارة حسابات بوابة العملاء (Admin Side - Client Users Management)
 * لنظام شركة رواسي عدن للهندسة والمقاولات
 * محمية بصلاحيات الفريق الداخلي (requireAuth)
 */

const express = require('express');
const router = express.Router();
router.use(require('../middleware/security').requirePermission('settings:users'));
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
 * GET /api/admin/client-users/stats
 * إحصائيات لوحة الإدارة (إجمالي العملاء، المستخدمين، المعلقة، والتطبيقات والرسائل)
 */
router.get('/stats', async (req, res) => {
  try {
    const clientsCount = await db.get(`SELECT COUNT(id) AS total FROM clients`);
    const usersCount = await db.get(`SELECT COUNT(id) AS total FROM client_users`);
    const suspendedCount = await db.get(`SELECT COUNT(id) AS total FROM client_users WHERE status != 'active'`);
    const activeAppsCount = await db.get(`SELECT COUNT(id) AS total FROM client_users WHERE status = 'active' AND (device_token IS NOT NULL OR last_login_at IS NOT NULL)`);
    const pendingMessagesCount = await db.get(`SELECT COUNT(id) AS total FROM client_messages WHERE status = 'open'`);
    const pendingServiceReqsCount = await db.get(`SELECT COUNT(id) AS total FROM service_requests WHERE status = 'new'`);

    res.json({
      success: true,
      stats: {
        total_clients: Number(clientsCount?.total || 0),
        total_users: Number(usersCount?.total || 0),
        suspended_users: Number(suspendedCount?.total || 0),
        active_apps: Number(activeAppsCount?.total || 0),
        pending_messages: Number(pendingMessagesCount?.total || 0),
        pending_service_requests: Number(pendingServiceReqsCount?.total || 0)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب إحصائيات الإدارة' });
  }
});

/**
 * GET /api/admin/client-users/messages
 * جلب جميع رسائل واستفسارات العملاء للإدارة مع الفلترة والإحصائيات
 */
router.get('/messages', async (req, res) => {
  try {
    const { status, project_id, search } = req.query;
    let query = `
      SELECT 
        cm.id,
        cm.client_user_id,
        cm.project_id,
        cm.direction,
        cm.subject,
        cm.body,
        cm.attachment_url,
        cm.priority,
        cm.status,
        cm.replied_by,
        cm.reply_body,
        cm.replied_at,
        cm.created_at,
        cu.full_name AS client_name,
        cu.email AS client_email,
        cu.phone AS client_phone,
        c.name AS company_name,
        p.name AS project_name,
        p.code AS project_code,
        u.username AS replied_by_username
      FROM client_messages cm
      JOIN client_users cu ON cm.client_user_id = cu.id
      LEFT JOIN clients c ON cu.client_id = c.id
      LEFT JOIN projects p ON cm.project_id = p.id
      LEFT JOIN users u ON cm.replied_by = u.id
      WHERE 1=1
    `;
    const params = [];

    if (status && status !== 'all') {
      query += ` AND cm.status = ?`;
      params.push(status);
    }
    if (project_id) {
      query += ` AND cm.project_id = ?`;
      params.push(project_id);
    }
    if (search) {
      query += ` AND (cm.subject LIKE ? OR cm.body LIKE ? OR cu.full_name LIKE ? OR cu.email LIKE ?)`;
      const term = `%${search}%`;
      params.push(term, term, term, term);
    }

    query += ` ORDER BY cm.created_at DESC`;

    const messages = await db.query(query, params);

    const stats = await db.get(`
      SELECT 
        COUNT(*) AS total_count,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS pending_count,
        SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) AS replied_count,
        SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) AS closed_count
      FROM client_messages
    `);

    res.json({
      success: true,
      messages: messages || [],
      stats: {
        total: Number(stats?.total_count || 0),
        pending: Number(stats?.pending_count || 0),
        replied: Number(stats?.replied_count || 0),
        closed: Number(stats?.closed_count || 0)
      }
    });
  } catch (err) {
    console.error('Fetch Admin Client Messages Error:', err);
    res.status(500).json({ success: false, message: 'خطأ أثناء جلب رسائل واستفسارات العملاء' });
  }
});

/**
 * POST /api/admin/client-users/messages/:id/reply
 * إرسال رد رسمي من الإدارة على رسالة أو استفسار العميل
 */
router.post('/messages/:id/reply', async (req, res) => {
  try {
    const messageId = parseInt(req.params.id, 10);
    const { reply_body, status } = req.body;

    if (!reply_body || !reply_body.trim()) {
      return res.status(400).json({ success: false, message: 'نص الرد مطلوب' });
    }

    const message = await db.get(`
      SELECT cm.*, cu.full_name, cu.email, cu.id as user_id 
      FROM client_messages cm
      JOIN client_users cu ON cm.client_user_id = cu.id
      WHERE cm.id = ?
    `, [messageId]);

    if (!message) {
      return res.status(404).json({ success: false, message: 'الرسالة غير موجودة' });
    }

    const newStatus = status || 'replied';
    const repliedBy = req.user?.id || 1;

    await db.run(`
      UPDATE client_messages
      SET reply_body = ?, replied_by = ?, replied_at = CURRENT_TIMESTAMP, status = ?
      WHERE id = ?
    `, [reply_body.trim(), repliedBy, newStatus, messageId]);

    // إرسال إشعار للعميل في تطبيقه
    try {
      await db.run(`
        INSERT INTO client_notifications (client_user_id, title, body, type, reference_type, reference_id, created_at)
        VALUES (?, 'رد جديد على استفسارك', ?, 'message', 'client_messages', ?, CURRENT_TIMESTAMP)
      `, [
        message.user_id,
        `قامت إدارة شركة رواسي عدن بالرد على استفسارك حول: "${message.subject}"`,
        messageId
      ]);
    } catch (notifErr) {
      console.warn('Failed to insert client notification for reply:', notifErr);
    }

    await logAudit(req, {
      action: 'CLIENT_MESSAGE_REPLIED',
      entity_type: 'client_messages',
      entity_id: messageId,
      details: `تم إرسال رد رسمي على رسالة العميل ${message.full_name} بخصوص: ${message.subject}`
    });

    res.json({ success: true, message: 'تم إرسال الرد للعميل بنجاح' });
  } catch (err) {
    console.error('Reply Client Message Error:', err);
    res.status(500).json({ success: false, message: 'حدث خطأ أثناء إرسال الرد للعميل' });
  }
});

/**
 * POST /api/admin/client-users/messages/:id/status
 * تحديث حالة رسالة العميل (open, replied, closed)
 */
router.post('/messages/:id/status', async (req, res) => {
  try {
    const messageId = parseInt(req.params.id, 10);
    const { status } = req.body;
    if (!['open', 'replied', 'closed'].includes(status)) {
      return res.status(400).json({ success: false, message: 'حالة غير صالحة' });
    }

    await db.run(`UPDATE client_messages SET status = ? WHERE id = ?`, [status, messageId]);
    res.json({ success: true, message: 'تم تحديث حالة الرسالة بنجاح' });
  } catch (err) {
    console.error('Update Message Status Error:', err);
    res.status(500).json({ success: false, message: 'خطأ في تحديث حالة الرسالة' });
  }
});

/**
 * GET /api/admin/client-users/:id/details
 * جلب التفاصيل الشاملة للعميل ومستخدميه وصلاحياته ومشاريعه وسجل النشاط
 */
router.get('/:id/details', async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const user = await db.get(`
      SELECT 
        cu.*,
        c.name AS client_name,
        c.company AS client_company,
        c.phone AS client_phone,
        c.email AS client_email,
        c.address AS client_address
      FROM client_users cu
      LEFT JOIN clients c ON c.id = cu.client_id
      WHERE cu.id = ?
    `, [userId]);

    if (!user) {
      return res.status(404).json({ success: false, message: 'مستخدم العميل غير موجود' });
    }

    // المستخدمون المرتبطون بنفس العميل التجاري
    const linkedUsers = await db.query(`
      SELECT id, full_name, email, phone, role, status, last_login_at, created_at
      FROM client_users
      WHERE client_id = ?
      ORDER BY id DESC
    `, [user.client_id]);

    // الصلاحيات والمشاريع المصرح بها
    const projectAccess = await db.query(`
      SELECT 
        cpa.*,
        p.name AS project_name,
        p.code AS project_code,
        p.status AS project_status,
        p.contract_value
      FROM client_project_access cpa
      INNER JOIN projects p ON p.id = cpa.project_id
      WHERE cpa.client_user_id = ?
    `, [userId]);

    // سجل النشاط والتدقيق الخاص بهذا الحساب
    let auditLogs = [];
    try {
      auditLogs = await db.query(`
        SELECT id, action, details, ip_address, created_at
        FROM audit_logs
        WHERE entity_type = 'client_users' AND (entity_id = ? OR details LIKE ?)
        ORDER BY id DESC
        LIMIT 25
      `, [userId, `%${user.email}%`]);
    } catch {
      auditLogs = [];
    }

    res.json({
      success: true,
      user,
      linked_users: linkedUsers,
      project_access: projectAccess,
      audit_logs: auditLogs
    });
  } catch (err) {
    console.error('Fetch client user details error:', err);
    res.status(500).json({ success: false, message: 'حدث خطأ في تحميل تفاصيل الحساب' });
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

const makeTempPassword = () => `Rawasi#${crypto.randomBytes(5).toString('base64url')}`;
const makeOtpCode = () => crypto.randomInt(100000, 1000000).toString();
const buildInviteText = ({ fullName, email, tempPassword, otpCode, portalUrl, message }) => {
  const greeting = String(message || `مرحباً ${fullName}، تم إنشاء حسابك في بوابة عملاء شركة رواسي عدن للهندسة والمقاولات.`).trim();
  return `${greeting}\n\nالبريد: ${email}\nكلمة المرور المؤقتة: ${tempPassword}\nرمز الأمان (OTP): ${otpCode}\nرابط الدخول: ${portalUrl}`;
};

// معاينة قابلة للتحرير: لا تحفظ كلمة مرور ولا رمزاً قبل تأكيد الإرسال.
router.get('/:id/invite-preview', async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const user = await db.get(`SELECT id, full_name, email, phone, status FROM client_users WHERE id = ?`, [userId]);
    if (!user) return res.status(404).json({ success: false, message: 'حساب العميل غير موجود' });
    if (user.status !== 'active') return res.status(400).json({ success: false, message: 'لا يمكن إرسال دعوة لحساب غير نشط' });
    const portalUrl = `${req.protocol}://${req.get('host')}/client-app/`;
    res.json({
      success: true,
      preview: {
        user_id: user.id, full_name: user.full_name, email: user.email, phone: user.phone,
        temp_password: makeTempPassword(), otp_code: makeOtpCode(), expiry_days: 7,
        message: `مرحباً ${user.full_name}، تم إنشاء حسابك في بوابة عملاء شركة رواسي عدن للهندسة والمقاولات.`,
        portal_url: portalUrl
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'تعذر تجهيز معاينة دعوة التفعيل' });
  }
});

/**
 * POST /api/admin/client-users/:id/send-invite
 * يثبت بيانات الدخول فقط بعد مراجعة المدير وتأكيده للإرسال.
 */
router.post('/:id/send-invite', async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const user = await db.get(`SELECT id, full_name, email, phone, status FROM client_users WHERE id = ?`, [userId]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'حساب العميل غير موجود' });
    }

    if (user.status !== 'active') return res.status(400).json({ success: false, message: 'لا يمكن إرسال دعوة لحساب غير نشط' });
    const requested = req.body || {};
    const tempPassword = String(requested.temp_password || makeTempPassword()).trim();
    const otpCode = String(requested.otp_code || makeOtpCode()).trim();
    const expiryDays = Math.max(1, Math.min(30, Number(requested.expiry_days) || 7));
    const portalUrl = `${req.protocol}://${req.get('host')}/client-app/`;
    if (tempPassword.length < 10 || tempPassword.length > 128) {
      return res.status(400).json({ success: false, message: 'كلمة المرور المؤقتة يجب أن تكون بين 10 و128 حرفاً' });
    }
    if (!/^\d{6}$/.test(otpCode)) {
      return res.status(400).json({ success: false, message: 'رمز OTP يجب أن يتكون من 6 أرقام إنجليزية' });
    }
    const message = String(requested.message || '').trim().slice(0, 600);
    const defaultShareText = buildInviteText({ fullName: user.full_name, email: user.email, tempPassword, otpCode, portalUrl, message });
    const whatsappShareText = String(requested.whatsapp_share_text || defaultShareText).trim().slice(0, 2500);
    if (!whatsappShareText) {
      return res.status(400).json({ success: false, message: 'نص رسالة واتساب لا يمكن أن يكون فارغاً' });
    }
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(tempPassword, salt);

    await db.run(`
      UPDATE client_users 
      SET password_hash = ?, otp_code = ?, otp_expires_at = datetime('now', ?), updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [hash, otpCode, `+${expiryDays} days`, userId]);

    await logAudit(req, {
      action: 'CLIENT_USER_INVITE_SENT',
      entity_type: 'client_users',
      entity_id: userId,
      details: `تم اعتماد وتجهيز دعوة تفعيل جديدة لحساب العميل: ${user.full_name} (صلاحية رمز التفعيل: ${expiryDays} أيام)`
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
        portal_url: portalUrl,
        expiry_days: expiryDays,
        whatsapp_share_text: whatsappShareText
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

// =========================================================================
// مسارات إدارة طلبات خدمات العملاء والزوار (Service Requests Management)
// =========================================================================

/**
 * GET /api/admin/client-users/service-requests
 * استعراض كافة طلبات خدمات العملاء والزوار مع الفلترة والإحصائيات
 */
router.get('/service-requests', async (req, res) => {
  try {
    const { status, source, search } = req.query;
    let query = `
      SELECT 
        sr.id,
        sr.request_no,
        sr.client_user_id,
        sr.source,
        sr.client_name,
        sr.phone,
        sr.email,
        sr.project_name,
        sr.project_type,
        sr.location,
        sr.description,
        sr.estimated_budget,
        sr.currency,
        sr.expected_start_date,
        sr.notes,
        sr.attachments,
        sr.status,
        sr.assigned_to,
        sr.admin_notes,
        sr.quoted_amount,
        sr.verification_code,
        sr.created_at,
        sr.updated_at,
        u.username AS assigned_username,
        COALESCE(u.full_name, u.username) AS assigned_name,
        (
          SELECT GROUP_CONCAT(service_title, ' | ') 
          FROM service_request_items 
          WHERE request_id = sr.id
        ) AS requested_services_text
      FROM service_requests sr
      LEFT JOIN users u ON sr.assigned_to = u.id
      WHERE 1=1
    `;
    const params = [];

    if (status && status !== 'all') {
      query += ` AND sr.status = ?`;
      params.push(status);
    }
    if (source && source !== 'all') {
      query += ` AND sr.source = ?`;
      params.push(source);
    }
    if (search) {
      query += ` AND (sr.request_no LIKE ? OR sr.client_name LIKE ? OR sr.phone LIKE ? OR sr.project_name LIKE ?)`;
      const term = `%${search}%`;
      params.push(term, term, term, term);
    }

    query += ` ORDER BY sr.id DESC`;

    const requests = await db.query(query, params);

    // إحصائيات الطلبات
    const stats = await db.get(`
      SELECT 
        COUNT(*) AS total_count,
        SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS new_count,
        SUM(CASE WHEN status = 'under_review' THEN 1 ELSE 0 END) AS review_count,
        SUM(CASE WHEN status = 'pricing' THEN 1 ELSE 0 END) AS pricing_count,
        SUM(CASE WHEN status = 'quoted' THEN 1 ELSE 0 END) AS quoted_count,
        SUM(CASE WHEN status = 'converted' THEN 1 ELSE 0 END) AS converted_count,
        SUM(CASE WHEN source = 'guest' THEN 1 ELSE 0 END) AS guest_count,
        SUM(CASE WHEN source = 'registered_client' THEN 1 ELSE 0 END) AS registered_count
      FROM service_requests
    `);

    // جلب قائمة الموظفين للإسناد
    const engineers = await db.query(`SELECT id, username, full_name AS name, role FROM users WHERE status = 'active' OR status IS NULL`);

    res.json({
      success: true,
      requests: requests || [],
      engineers: engineers || [],
      stats: {
        total: Number(stats?.total_count || 0),
        new: Number(stats?.new_count || 0),
        review: Number(stats?.review_count || 0),
        pricing: Number(stats?.pricing_count || 0),
        quoted: Number(stats?.quoted_count || 0),
        converted: Number(stats?.converted_count || 0),
        guest: Number(stats?.guest_count || 0),
        registered: Number(stats?.registered_count || 0)
      }
    });
  } catch (err) {
    console.error('Fetch service requests error:', err);
    res.status(500).json({ success: false, message: 'خطأ في جلب طلبات الخدمات' });
  }
});

/**
 * GET /api/admin/client-users/service-requests/:id
 * تفاصيل طلب خدمة محدد مع الخدمات المختارة والمرفقات
 */
router.get('/service-requests/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const request = await db.get(`
      SELECT 
        sr.*,
        u.username AS assigned_username,
        u.name AS assigned_name
      FROM service_requests sr
      LEFT JOIN users u ON sr.assigned_to = u.id
      WHERE sr.id = ?
    `, [id]);

    if (!request) {
      return res.status(404).json({ success: false, message: 'الطلب غير موجود' });
    }

    const items = await db.query(`
      SELECT sri.*, es.code, es.icon, es.category
      FROM service_request_items sri
      LEFT JOIN engineering_services es ON sri.service_id = es.id
      WHERE sri.request_id = ?
    `, [id]);

    let attachments = [];
    try {
      attachments = request.attachments ? JSON.parse(request.attachments) : [];
    } catch {
      attachments = [];
    }

    res.json({
      success: true,
      request: {
        ...request,
        attachments,
        items: items || []
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب تفاصيل الطلب' });
  }
});

/**
 * PUT /api/admin/client-users/service-requests/:id
 * تحديث حالة طلب الخدمة، تعيين موظف، حفظ عرض السعر وملاحظات الإدارة
 */
router.put('/service-requests/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { status, assigned_to, admin_notes, quoted_amount } = req.body;

    const request = await db.get(`SELECT * FROM service_requests WHERE id = ?`, [id]);
    if (!request) {
      return res.status(404).json({ success: false, message: 'الطلب غير موجود' });
    }

    const newStatus = status || request.status;
    const newAssignedTo = assigned_to !== undefined ? (assigned_to ? parseInt(assigned_to, 10) : null) : request.assigned_to;
    const newAdminNotes = admin_notes !== undefined ? admin_notes : request.admin_notes;
    const newQuote = quoted_amount !== undefined ? (quoted_amount ? parseFloat(quoted_amount) : null) : request.quoted_amount;

    await db.run(`
      UPDATE service_requests
      SET status = ?, assigned_to = ?, admin_notes = ?, quoted_amount = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [newStatus, newAssignedTo, newAdminNotes, newQuote, id]);

    await logAudit(req, {
      action: 'SERVICE_REQUEST_UPDATED',
      entity_type: 'service_requests',
      entity_id: id,
      details: `تم تحديث حالة طلب الخدمة (${request.request_no}) إلى [${newStatus}]`
    });

    res.json({
      success: true,
      message: 'تم تحديث بيانات الطلب بنجاح'
    });
  } catch (err) {
    console.error('Update service request error:', err);
    res.status(500).json({ success: false, message: 'خطأ في تحديث بيانات الطلب' });
  }
});

/**
 * POST /api/admin/client-users/service-requests/:id/convert-to-project
 * تحويل طلب الخدمة إلى مشروع رسمي في النظام
 */
router.post('/service-requests/:id/convert-to-project', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const request = await db.get(`SELECT * FROM service_requests WHERE id = ?`, [id]);
    if (!request) {
      return res.status(404).json({ success: false, message: 'الطلب غير موجود' });
    }

    // 1. فحص وجود العميل أو إنشائه في دليل العملاء
    let clientId = null;
    if (request.client_user_id) {
      const cu = await db.get(`SELECT client_id FROM client_users WHERE id = ?`, [request.client_user_id]);
      clientId = cu?.client_id;
    }
    if (!clientId) {
      const existingClient = await db.get(`SELECT id FROM clients WHERE phone = ? OR name = ?`, [request.phone, request.client_name]);
      if (existingClient) {
        clientId = existingClient.id;
      } else {
        const ledgerAccount = await db.get(`SELECT id FROM accounts WHERE code = '12301001'`);
        if (!ledgerAccount) {
          return res.status(409).json({ success: false, message: 'تعذر إنشاء العميل: الحساب 12301001 غير موجود في دليل الحسابات' });
        }
        const clientInsert = await db.run(`
          INSERT INTO clients (account_id, name, phone, email, notes, created_at)
          VALUES (?, ?, ?, ?, 'تم الإنشاء تلقائياً من طلب خدمة مكتب الهندسة والمقاولات ' || ?, CURRENT_TIMESTAMP)
        `, [ledgerAccount.id, request.client_name, request.phone, request.email, request.request_no]);
        clientId = clientInsert.lastID || clientInsert.insertId;
      }
    }

    // 2. إنشاء المشروع
    const projName = request.project_name || `مشروع ${request.client_name} - ${request.project_type || 'أعمال هندسية'}`;
    const projCode = `PRJ-${Date.now().toString().slice(-4)}`;
    const contractVal = request.quoted_amount || request.estimated_budget || 0;

    const projNotes = request.description || ('مشروع محول من طلب الخدمة: ' + request.request_no);
    const projInsert = await db.run(`
      INSERT INTO projects (
        code, name, client_id, status, contract_value, location, description, notes, created_at
      ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [
      projCode,
      projName,
      clientId,
      contractVal,
      request.location || 'عدن',
      projNotes,
      projNotes
    ]);

    const newProjectId = projInsert.lastID || projInsert.insertId;

    // 3. تحديث حالة طلب الخدمة إلى محول
    await db.run(`
      UPDATE service_requests
      SET status = 'converted', admin_notes = COALESCE(admin_notes, '') || ' [تم التحويل لمشروع كود: ' || ? || ']', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [projCode, id]);

    await logAudit(req, {
      action: 'SERVICE_REQUEST_CONVERTED',
      entity_type: 'service_requests',
      entity_id: id,
      details: `تم تحويل طلب الخدمة (${request.request_no}) إلى مشروع (${projName}) بكود (${projCode})`
    });

    res.json({
      success: true,
      message: `تم تحويل الطلب بنجاح إلى مشروع جديد بكود: ${projCode}`,
      project_id: newProjectId,
      project_code: projCode
    });
  } catch (err) {
    console.error('Convert to project error:', err);
    res.status(500).json({ success: false, message: 'حدث خطأ أثناء تحويل الطلب إلى مشروع' });
  }
});

module.exports = router;
