/**
 * مسارات بوابة وتطبيق العملاء المخصص (Client Portal Routes)
 * لنظام شركة رواسي عدن للهندسة والمقاولات
 *
 * المبدأ الحاكم: Deny by Default
 * - كل عميل يرى فقط بيانات مشاريعه المرتبطة بـ client_id الخاص به
 * - حظر تام للبيانات المالية الداخلية (التكلفة الفعلية، الأرباح، الموردين، الرواتب)
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../database/db');
const { 
  CLIENT_JWT_SECRET, 
  requireClientAuth, 
  checkClientRateLimit,
  logClientAudit,
  isWeakClientPin,
  getOtpLockRemainingMs,
  registerOtpFailure,
  clearOtpFailures,
  issueClientToken,
  BUMP_SESSION_SQL
} = require('../middleware/client_auth');
const crypto = require('crypto');
const pushNotificationService = require('../services/pushNotificationService');

// تطبيق محدد الطلبات العام لبوابة العملاء
router.use(checkClientRateLimit);

// دالة مساعدة لتطبيع الأرقام العربية إلى إنجليزية
function normalizeDigits(str) {
  if (!str) return '';
  const arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  return String(str).replace(/[٠-٩]/g, (w) => arabicDigits.indexOf(w));
}

// توليد رمز OTP عشوائي آمن تشفيرياً مكون من 6 أرقام
function generateOtpCode() {
  return crypto.randomInt(100000, 1000000).toString();
}

// =========================================================================
// 1. تسجيل الدخول والمصادقة (Auth Endpoints)
// =========================================================================

/**
 * POST /api/client-portal/auth/login
 * تسجيل الدخول بالبريد الإلكتروني وكلمة المرور
 */
router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'يرجى إدخال البريد الإلكتروني وكلمة المرور'
      });
    }

    const cleanEmail = String(email).trim().toLowerCase();

    // البحث عن مستخدم العميل
    const user = await db.get(`
      SELECT 
        cu.*,
        c.name AS client_name,
        c.company AS client_company
      FROM client_users cu
      INNER JOIN clients c ON c.id = cu.client_id
      WHERE LOWER(cu.email) = ?
    `, [cleanEmail]);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'بيانات الدخول غير صحيحة (البريد الإلكتروني أو كلمة المرور غير متطابقة)'
      });
    }

    // التحقق من كلمة المرور أولاً، حتى لا تُكشف حالة الحساب لمن لا يعرف كلمة مروره
    const isPasswordValid = bcrypt.compareSync(String(password), user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'بيانات الدخول غير صحيحة (البريد الإلكتروني أو كلمة المرور غير متطابقة)'
      });
    }

    if (user.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'تم تعطيل أو إيقاف حسابك من قِبل الإدارة. يرجى مراجعة إدارة الشركة.'
      });
    }

    // إذا كان التحقق بخطوتين مفعلاً (2FA Enabled)
    if (user.two_factor_enabled) {
      const otpCode = generateOtpCode();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 دقائق

      // حفظ كود الـ OTP
      await db.run(`
        UPDATE client_users 
        SET otp_code = ?, otp_expires_at = ? 
        WHERE id = ?
      `, [otpCode, expiresAt, user.id]);

      // إصدار توكن مؤقت للمصادقة بالـ OTP (صالح لـ 10 دقائق فقط)
      const tempToken = jwt.sign(
        { 
          id: user.id, 
          client_id: user.client_id, 
          type: 'client_temp_otp', 
          email: user.email 
        },
        CLIENT_JWT_SECRET,
        { expiresIn: '10m' }
      );

      return res.json({
        success: true,
        requireOtp: true,
        tempToken,
        maskedPhone: user.phone ? user.phone.replace(/(\d{3})\d+(\d{2})/, '$1****$2') : null,
        message: 'تم إرسال رمز التحقق OTP بنجاح. يرجى إدخال الرمز المكون من 6 أرقام لتأكيد الدخول.',
        // في بيئة التطوير، يتم إرجاع الكود لتسهيل الاختبار السريع
        debugOtp: require('../config/environment').isDev ? otpCode : undefined
      });
    }

    // إصدار التوكن النهائي مباشرة إذا لم يكن 2FA مفعلاً
    const token = issueClientToken(user);

    const ip = req.ip || req.socket.remoteAddress || '127.0.0.1';
    await db.run(`
      UPDATE client_users 
      SET last_login_at = CURRENT_TIMESTAMP, last_login_ip = ? 
      WHERE id = ?
    `, [ip, user.id]);

    await logClientAudit(
      { clientUser: user, headers: req.headers, socket: req.socket },
      'CLIENT_LOGIN_SUCCESS',
      'client_users',
      user.id,
      'تسجيل دخول ناجح لبوابة العملاء'
    );

    res.json({
      success: true,
      requireOtp: false,
      token,
      user: {
        id: user.id,
        client_id: user.client_id,
        full_name: user.full_name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        client_name: user.client_name,
        client_company: user.client_company
      }
    });
  } catch (err) {
    console.error('Client Portal Login Error:', err);
    res.status(500).json({ success: false, message: 'حدث خطأ في الخادم أثناء تسجيل الدخول' });
  }
});

/**
 * POST /api/client-portal/auth/verify-otp
 * التحقق من رمز الـ OTP وإصدار توكن الجلسة النهائي
 */
router.post('/auth/verify-otp', async (req, res) => {
  try {
    const { tempToken, otp, email } = req.body;

    if (!otp) {
      return res.status(400).json({
        success: false,
        message: 'يرجى إدخال رمز التحقق (OTP)'
      });
    }

    const cleanOtp = normalizeDigits(String(otp).trim());

    if(!tempToken)return res.status(401).json({success:false,message:'سجّل الدخول بكلمة المرور أولاً'});
    let decoded;
    if (tempToken) {
      try {
        decoded = jwt.verify(tempToken, CLIENT_JWT_SECRET, {algorithms:['HS256']});
        if(decoded.type!=='client_temp_otp')throw new Error('Invalid verification token');
      } catch {
        return res.status(401).json({
          success: false,
          message: 'انتهت صلاحية جلسة التحقق المؤقتة، يرجى إعادة المحاولة من البداية'
        });
      }
    }

    const userId = decoded ? decoded.id : null;
    const cleanEmail = decoded.email ? String(decoded.email).trim().toLowerCase() : '';

    const user = await db.get(`
      SELECT 
        cu.*,
        c.name AS client_name,
        c.company AS client_company
      FROM client_users cu
      INNER JOIN clients c ON c.id = cu.client_id
      WHERE cu.id = ? AND LOWER(cu.email) = ? AND cu.status = 'active'
    `, [userId || 0, cleanEmail || '']);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'لم يتم العثور على الحساب المطلوب'
      });
    }

    // قفل مؤقت بعد محاولات خاطئة متكررة على هذا الحساب
    const lockMs = getOtpLockRemainingMs(user);
    if (lockMs > 0) {
      return res.status(429).json({
        success: false,
        rateLimited: true,
        message: `تم إيقاف التحقق مؤقتاً بسبب محاولات خاطئة متكررة. حاول بعد ${Math.ceil(lockMs / 60000)} دقيقة.`
      });
    }

    // التحقق من صلاحية الكود:
    // 1. الكود المؤقت otp_code وتاريخ صلاحيته
    // 2. أو رمز الأمان الخاص بالحساب two_factor_pin (يُرفض الرمز الافتراضي أو السهل خارج بيئة التطوير)
    const now = new Date();
    const isOtpValid = Boolean(user.otp_code &&
                       user.otp_code === cleanOtp &&
                       user.otp_expires_at &&
                       new Date(user.otp_expires_at) >= now);

    const storedPin = normalizeDigits(String(user.two_factor_pin || '').trim());
    const pinUsable = Boolean(storedPin) && (require('../config/environment').isDev || !isWeakClientPin(storedPin));
    const isPinValid = pinUsable && storedPin === cleanOtp;

    if (!isOtpValid && !isPinValid) {
      const nowLocked = await registerOtpFailure(user.id);
      await logClientAudit(
        { clientUser: user, headers: req.headers, socket: req.socket },
        'CLIENT_OTP_FAILED',
        'client_users',
        user.id,
        nowLocked ? 'محاولات تحقق خاطئة متكررة - تم القفل المؤقت' : 'محاولة تحقق برمز خاطئ'
      );
      if (!pinUsable) {
        return res.status(403).json({
          success: false,
          message: 'لم يتم إعداد رمز أمان خاص بحسابك بعد. يرجى التواصل مع إدارة الشركة لإرسال دعوة التفعيل.'
        });
      }
      return res.status(400).json({
        success: false,
        message: 'رمز التحقق (OTP) غير صحيح أو منتهي الصلاحية'
      });
    }

    await clearOtpFailures(user.id);

    // تصفير كود الـ OTP بعد استخدامه بنجاح
    await db.run(`
      UPDATE client_users 
      SET otp_code = NULL, otp_expires_at = NULL, last_login_at = CURRENT_TIMESTAMP, last_login_ip = ?
      WHERE id = ?
    `, [req.ip || req.socket.remoteAddress || '127.0.0.1', user.id]);

    // إصدار توكن الجلسة لمدة 30 يوم
    const token = issueClientToken(user);

    await logClientAudit(
      { clientUser: user, headers: req.headers, socket: req.socket },
      'CLIENT_OTP_VERIFIED',
      'client_users',
      user.id,
      'تم التحقق من الـ OTP بنجاح وإصدار جلسة العمل'
    );

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        client_id: user.client_id,
        full_name: user.full_name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        client_name: user.client_name,
        client_company: user.client_company
      }
    });
  } catch (err) {
    console.error('OTP Verification Error:', err);
    res.status(500).json({ success: false, message: 'حدث خطأ أثناء فحص رمز التحقق' });
  }
});

/**
 * POST /api/client-portal/auth/forgot-password
 * طلب استعادة كلمة المرور وإرسال كود OTP
 */
router.post('/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'يرجى إدخال البريد الإلكتروني' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const user = await db.get(`SELECT id, full_name, phone, status FROM client_users WHERE LOWER(email) = ?`, [cleanEmail]);

    if (!user || user.status !== 'active') {
      // إرجاع استجابة نجاح وهمية لحماية الأمان والخصوصية من كشف وجود البريد
      return res.json({
        success: true,
        message: 'إذا كان البريد الإلكتروني مسجلاً لدينا ومفعلاً، فسيتم إرسال تعليمات إعادة التعيين إليه.'
      });
    }

    const otpCode = generateOtpCode();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 دقيقة

    await db.run(`UPDATE client_users SET otp_code = ?, otp_expires_at = ? WHERE id = ?`, [otpCode, expiresAt, user.id]);

    // استجابة مطابقة تماماً لحالة البريد غير المسجل حتى لا يُكشف وجود الحساب
    res.json({
      success: true,
      message: 'إذا كان البريد الإلكتروني مسجلاً لدينا ومفعلاً، فسيتم إرسال تعليمات إعادة التعيين إليه.',
      debugOtp: require('../config/environment').isDev ? otpCode : undefined
    });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ success: false, message: 'حدث خطأ أثناء طلب استعادة كلمة المرور' });
  }
});

/**
 * POST /api/client-portal/auth/reset-password
 * تعيين كلمة مرور جديدة ذاتياً باستخدام رمز الأمان الخاص بالحساب (المرسل في دعوة التفعيل)
 * أو رمز الاستعادة المؤقت من forgot-password (عند ربط خدمة إرسال الرسائل مستقبلاً)
 */
router.post('/auth/reset-password', async (req, res) => {
  const genericError = 'البريد الإلكتروني أو رمز الأمان غير صحيح';
  try {
    const { email, code, new_password } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanCode = normalizeDigits(String(code || '').trim());
    const newPassword = String(new_password || '');

    if (!cleanEmail || !cleanCode || !newPassword) {
      return res.status(400).json({ success: false, message: 'يرجى إدخال البريد الإلكتروني ورمز الأمان وكلمة المرور الجديدة' });
    }
    if (newPassword.length < 8 || newPassword.length > 128) {
      return res.status(400).json({ success: false, message: 'كلمة المرور الجديدة يجب أن تكون بين 8 و128 حرفاً' });
    }

    const user = await db.get(`
      SELECT id, client_id, email, full_name, status, otp_code, otp_expires_at, two_factor_pin, otp_locked_until
      FROM client_users WHERE LOWER(email) = ?
    `, [cleanEmail]);

    // رسالة موحدة للحساب غير الموجود أو غير النشط لمنع كشف وجود الحساب
    if (!user || user.status !== 'active') {
      return res.status(400).json({ success: false, message: genericError });
    }

    const lockMs = getOtpLockRemainingMs(user);
    if (lockMs > 0) {
      return res.status(429).json({
        success: false,
        rateLimited: true,
        message: `تم إيقاف المحاولات مؤقتاً بسبب محاولات خاطئة متكررة. حاول بعد ${Math.ceil(lockMs / 60000)} دقيقة.`
      });
    }

    const isOtpValid = Boolean(user.otp_code &&
      user.otp_code === cleanCode &&
      user.otp_expires_at &&
      new Date(user.otp_expires_at) >= new Date());
    const storedPin = normalizeDigits(String(user.two_factor_pin || '').trim());
    const pinUsable = Boolean(storedPin) && (require('../config/environment').isDev || !isWeakClientPin(storedPin));
    const isPinValid = pinUsable && storedPin === cleanCode;

    if (!isOtpValid && !isPinValid) {
      const nowLocked = await registerOtpFailure(user.id);
      await logClientAudit(
        { clientUser: user, headers: req.headers, socket: req.socket },
        'CLIENT_PASSWORD_RESET_FAILED',
        'client_users',
        user.id,
        nowLocked ? 'محاولات استعادة خاطئة متكررة - تم القفل المؤقت' : 'محاولة استعادة كلمة المرور برمز خاطئ'
      );
      return res.status(400).json({ success: false, message: genericError });
    }

    await clearOtpFailures(user.id);
    const hash = bcrypt.hashSync(newPassword, bcrypt.genSaltSync(10));
    await db.run(`
      UPDATE client_users
      SET password_hash = ?, otp_code = NULL, otp_expires_at = NULL, device_token = NULL, ${BUMP_SESSION_SQL}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [hash, user.id]);

    await logClientAudit(
      { clientUser: user, headers: req.headers, socket: req.socket },
      'CLIENT_PASSWORD_RESET',
      'client_users',
      user.id,
      'قام العميل بتعيين كلمة مرور جديدة ذاتياً'
    );

    res.json({ success: true, message: 'تم تعيين كلمة المرور الجديدة بنجاح. يمكنك تسجيل الدخول الآن.' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ success: false, message: 'حدث خطأ أثناء تعيين كلمة المرور' });
  }
});

// =========================================================================
// 1.1 خدمات مكتب الهندسة والمقاولات وطلبات الزوار والعملاء (Services & Guest Requests)
// متاحة للزوار والعملاء دون الحاجة لحساب مسبق
// =========================================================================

/**
 * GET /api/client-portal/services
 * جلب قائمة الخدمات الهندسية النشطة المسموح بطلبها
 */
router.get('/services', async (req, res) => {
  try {
    const services = await db.query(`
      SELECT id, code, title,
        CASE category
          WHEN 'التصميم والإشراف' THEN 'design'
          WHEN 'المقاولات' THEN 'execution'
          WHEN 'ترميم وصيانة' THEN 'finishing'
          WHEN 'تشطيبات' THEN 'finishing'
          WHEN 'أنظمة' THEN 'systems'
          WHEN 'بنية تحتية' THEN 'infrastructure'
          WHEN 'استشارات' THEN 'consulting'
          WHEN 'توريد' THEN 'supply'
          WHEN 'survey' THEN 'infrastructure'
          ELSE category END AS category,
        description, icon, display_order
      FROM engineering_services
      WHERE is_active = 1
      ORDER BY CASE category
        WHEN 'design' THEN 10 WHEN 'execution' THEN 20 WHEN 'finishing' THEN 30
        WHEN 'systems' THEN 40 WHEN 'infrastructure' THEN 50 WHEN 'consulting' THEN 60
        WHEN 'supply' THEN 70 ELSE 90 END, display_order ASC, id ASC
    `);

    res.json({
      success: true,
      services: services || []
    });
  } catch (err) {
    console.error('Fetch engineering services error:', err);
    res.status(500).json({ success: false, message: 'خطأ أثناء جلب قائمة الخدمات' });
  }
});

/**
 * POST /api/client-portal/services/requests
 * تقديم طلب خدمات جديد (سواء كان زائر أو عميل مسجل)
 */
router.post('/services/requests', async (req, res) => {
  const writtenFiles=[];let requestCommitted=false;
  try {
    const {
      client_name,
      phone,
      email,
      project_name,
      project_type,
      location,
      description,
      estimated_budget,
      currency = 'YER',
      expected_start_date,
      notes,
      service_ids,
      attachments = []
    } = req.body;

    // 1. التحقق من البيانات الإلزامية
    if (!client_name || !String(client_name).trim()) {
      return res.status(400).json({ success: false, message: 'اسم العميل / الزائر مطلوب' });
    }
    if (!phone || !String(phone).trim()) {
      return res.status(400).json({ success: false, message: 'رقم الهاتف مطلوب' });
    }

    // التحقق من الخدمات المختارة
    let parsedServiceIds = [];
    if (Array.isArray(service_ids)) {
      parsedServiceIds = service_ids.map(id => parseInt(id, 10)).filter(id => !isNaN(id) && id > 0);
    } else if (typeof service_ids === 'string') {
      parsedServiceIds = service_ids.split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id) && id > 0);
    }

    if (parsedServiceIds.length === 0) {
      return res.status(400).json({ success: false, message: 'يرجى اختيار خدمة هندسية واحدة على الأقل' });
    }

    // جلب الخدمات المختارة للتأكد من وجودها ونشاطها
    const placeholders = parsedServiceIds.map(() => '?').join(',');
    const activeServices = await db.query(`
      SELECT id, title FROM engineering_services
      WHERE id IN (${placeholders}) AND is_active = 1
    `, parsedServiceIds);

    if (!activeServices || activeServices.length === 0) {
      return res.status(400).json({ success: false, message: 'الخدمات المختارة غير صالحة أو غير نشطة حالياً' });
    }

    // 2. التحقق من هوية المرسل (زائر أم عميل مسجل)
    let clientUserId = null;
    let source = 'guest';

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, CLIENT_JWT_SECRET,{algorithms:['HS256']});
        if (decoded && decoded.type==='client' && decoded.id && decoded.client_id) {
          const userCheck = await db.get(`SELECT id, session_version FROM client_users WHERE id = ? AND client_id = ? AND status = 'active'`, [decoded.id,decoded.client_id]);
          // جلسة ملغاة (بعد تغيير كلمة المرور) لا تربط الطلب بالحساب ويُعامل المرسل كزائر
          if (userCheck && Number(decoded.sv || 0) === Number(userCheck.session_version || 0)) {
            clientUserId = userCheck.id;
            source = 'registered_client';
          }
        }
      } catch (tokenErr) {
        // إذا كان التوكن غير صالح، يستمر كزائر
      }
    }

    // Reserve a durable sequence before saving files, including after request deletion.
    const requestNo=await require('../services/serviceRequestRetentionService').reserveNumber(new Date().getFullYear());

    // توليد كود تحقق آمن
    const verificationCode = require('crypto').randomBytes(14).toString('hex');

    // 4. معالجة وحفظ المرفقات المرفوعة بأمان
    if(!Array.isArray(attachments)||attachments.length>10)throw Object.assign(new Error('الحد الأقصى عشرة مرفقات'),{statusCode:400});
    const savedAttachments = [];
    if (Array.isArray(attachments) && attachments.length > 0) {
      const uploadDir = path.join(require('../config/environment').storage.uploads, 'service_requests');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      for (let i = 0; i < Math.min(attachments.length, 10); i++) {
        const att = attachments[i];
        if (!att || !att.contentBase64 || !att.fileName) throw Object.assign(new Error('مرفق غير مكتمل'),{statusCode:400});

        const allowedExts = ['.pdf', '.dwg', '.dxf', '.doc', '.docx', '.xls', '.xlsx', '.png', '.jpg', '.jpeg', '.webp', '.zip', '.rar'];
        const fileExt = path.extname(att.fileName).toLowerCase();
        if (!allowedExts.includes(fileExt)) throw Object.assign(new Error('نوع المرفق غير مسموح'),{statusCode:400});

        const base64Clean = String(att.contentBase64).replace(/^data:[^;]+;base64,/, '');
        const fileBuf = Buffer.from(base64Clean, 'base64');
        if (fileBuf.length > 25 * 1024 * 1024) continue; // أقصى حجم 25MB

        const safeOriginalName = path.basename(att.fileName).replace(/[^\w\u0600-\u06FF.-]/g, '_');
        const diskFileName = `${requestNo}_${require('crypto').randomUUID()}${fileExt}`;
        const diskPath = path.join(uploadDir, diskFileName);

        require('../services/uploadValidationService').validateUpload(att.fileName,fileBuf);
        fs.writeFileSync(diskPath, fileBuf, {flag:'wx',mode:0o600});
        writtenFiles.push(diskPath);
        savedAttachments.push({
          fileName: safeOriginalName,
          diskFileName,
          url: `/uploads/service_requests/${diskFileName}`,
          size: fileBuf.length,
          type: att.type || 'application/octet-stream',
          uploadedAt: new Date().toISOString()
        });
      }
    }

    // 5. حفظ الطلب الرئيسي في قاعدة البيانات
    const cleanClientName = String(client_name).trim();
    const cleanPhone = normalizeDigits(String(phone).trim());
    const cleanEmail = email ? String(email).trim().toLowerCase() : null;
    const cleanProjName = project_name ? String(project_name).trim() : null;
    const cleanProjType = project_type ? String(project_type).trim() : null;
    const cleanLocation = location ? String(location).trim() : null;
    const cleanDesc = description ? String(description).trim() : null;
    const cleanNotes = notes ? String(notes).trim() : null;
    const budgetNum = estimated_budget ? parseFloat(estimated_budget) : null;

    const supervisorSetting=await db.get("SELECT value FROM settings WHERE `key`='service_request_supervisor_id'");
    let supervisorId=Number(supervisorSetting?.value)||null;
    if(supervisorId){
      const supervisor=await db.get("SELECT u.id,u.role,u.permissions,(SELECT permissions FROM roles WHERE name=u.role LIMIT 1) AS role_permissions FROM users u WHERE u.id=? AND (u.status='active' OR u.status IS NULL)",[supervisorId]);
      let permissions=[];try{permissions=JSON.parse(supervisor?.permissions||supervisor?.role_permissions||'[]');}catch{}
      if(!supervisor || !require('../middleware/security').hasUserPermission({...supervisor,permissions},'client_app:requests_review'))supervisorId=null;
    }

    const requestId = await db.transaction(async tx=>{
    const insertResult = await tx.run(`
      INSERT INTO service_requests (
        request_no, client_user_id, source, client_name, phone, email,
        project_name, project_type, location, description,
        estimated_budget, currency, expected_start_date, notes,
        attachments, status, verification_code, assigned_to, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [
      requestNo,
      clientUserId,
      source,
      cleanClientName,
      cleanPhone,
      cleanEmail,
      cleanProjName,
      cleanProjType,
      cleanLocation,
      cleanDesc,
      budgetNum,
      currency || 'YER',
      expected_start_date || null,
      cleanNotes,
      JSON.stringify(savedAttachments),
      verificationCode,
      supervisorId
    ]);

    const requestId = insertResult.lastID || insertResult.insertId;

    // 6. حفظ عناصر الخدمات المختارة ضمن الطلب الرئيسي الواحد
    for (const s of activeServices) {
      await tx.run(`
        INSERT INTO service_request_items (request_id, service_id, service_title, created_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      `, [requestId, s.id, s.title]);
    }

    await tx.run('INSERT INTO service_request_events (request_id,actor_type,actor_id,event_type,message) VALUES (?,?,?,?,?)', [requestId,'system',null,'request_received','مرحباً بكم في رواسي عدن، استلمنا طلبكم وسيتم تحويله للمشرف لمراجعته والتواصل معكم.']);
    if(supervisorId) await tx.run('INSERT INTO service_request_events (request_id,actor_type,actor_id,event_type,message) VALUES (?,?,?,?,?)',[requestId,'system',null,'supervisor_assigned',`أُحيل الطلب إلى مشرف الخدمة رقم ${supervisorId}`]);

      return requestId;
    });
    requestCommitted=true;

    // 7. إرسال إشعار داخلي في لوحة التحكم / التدقيق
    try {
      const servicesListStr = activeServices.map(s => s.title).join('، ');
      await db.run(`
        INSERT INTO audit_logs (user_id, username, action, entity_type, entity_id, details, ip_address, created_at)
        VALUES (NULL, 'بوابة العملاء', 'NEW_SERVICE_REQUEST', 'service_requests', ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        String(requestId),
        `طلب خدمات جديد (${requestNo}) من ${source === 'guest' ? 'الزائر' : 'العميل'}: ${cleanClientName} - الخدمات: [${servicesListStr}]`,
        req.ip || req.socket.remoteAddress || '127.0.0.1'
      ]);
    } catch (auditErr) {
      console.warn('Could not insert audit log for service request:', auditErr);
    }

    if (source === 'guest') {
      const configured=await db.get("SELECT value FROM settings WHERE `key`='guest_request_access_days'");
      const days=Number(configured?.value); const lifetime=Number.isInteger(days)&&days>=1&&days<=365?days:30;
      const token=jwt.sign({type:'guest_request',request_no:requestNo,verification_code:verificationCode},CLIENT_JWT_SECRET,{algorithm:'HS256',expiresIn:lifetime*86400});
      res.cookie('rawasi_guest_request',token,{httpOnly:true,secure:!['localhost','127.0.0.1','::1'].includes(req.hostname),sameSite:'lax',path:'/api/client-portal/services/requests',maxAge:lifetime*86400000});
    }
    res.json({
      success: true,
      message: 'مرحباً بكم في رواسي عدن، استلمنا طلبكم وسيتم تحويله للمشرف لمراجعته والتواصل معكم.',
      data: {
        request_id: requestId,
        request_no: requestNo,
        verification_code: verificationCode,
        client_name: cleanClientName,
        phone: cleanPhone,
        source,
        services_count: activeServices.length,
        services: activeServices.map(s => s.title),
        created_at: new Date().toISOString()
      }
    });
  } catch (err) {
    if(!requestCommitted)for(const file of writtenFiles){try{fs.unlinkSync(file);}catch{}}
    console.error('Submit service request failed:', err.code||err.name);
    res.status(err.statusCode||500).json({ success: false, message: err.statusCode===400?err.message:'حدث خطأ في الخادم أثناء تقديم الطلب' });
  }
});

/**
 * GET /api/client-portal/services/requests/track
 * متابعة حالة الطلب للزائر باستخدام رقم الطلب ورمز التحقق
 */
router.get('/services/requests/guest-session', async (req,res) => {
  res.set('Cache-Control','no-store');
  try {
    const part=String(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('rawasi_guest_request='));
    const token=part ? decodeURIComponent(part.slice('rawasi_guest_request='.length)) : '';
    const data=jwt.verify(token,CLIENT_JWT_SECRET,{algorithms:['HS256']});
    if(data.type!=='guest_request'||!data.request_no||!/^[a-f0-9]{28}$/.test(data.verification_code||'')) throw new Error('invalid');
    const found=await db.get("SELECT id FROM service_requests WHERE request_no=? AND verification_code=? AND source='guest'",[data.request_no,data.verification_code]);
    if(!found) throw new Error('invalid');
    res.json({success:true,request_no:data.request_no,verification_code:data.verification_code,expires_at:new Date(data.exp*1000).toISOString()});
  } catch {res.status(401).json({success:false,message:'انتهت جلسة متابعة الزائر أو لم تبدأ'});}
});

router.get('/services/requests/track', async (req, res) => {
  res.set('Cache-Control','no-store');
  try {
    const { request_no, verification_code } = req.query;
    if (!request_no || !verification_code) {
      return res.status(400).json({
        success: false,
        message: 'رقم الطلب ورمز التحقق مطلوبان للمتابعة'
      });
    }

    const request = await db.get(`
      SELECT 
        sr.id, sr.request_no, sr.client_name, sr.project_name, sr.project_type, sr.source,
        sr.location, sr.status,
        CASE WHEN EXISTS (SELECT 1 FROM service_request_quotes q WHERE q.request_id=sr.id AND q.state IN ('sent','accepted')) THEN sr.quoted_amount ELSE NULL END AS quoted_amount,
        sr.currency,
        sr.created_at, sr.updated_at
      FROM service_requests sr
      WHERE UPPER(sr.request_no) = UPPER(?) AND sr.verification_code = ?
    `, [String(request_no).trim(), String(verification_code).trim()]);

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'لم يتم العثور على طلب يطابق البيانات المدخلة. يرجى التحقق من رقم الطلب ورمز التحقق.'
      });
    }

    const items = await db.query(`
      SELECT service_title FROM service_request_items WHERE request_id = ?
    `, [request.id]);
    if (String(verification_code).length >= 28) {
      request.quote = await db.get("SELECT id,version,details,duration,amount,currency,state FROM service_request_quotes WHERE request_id=? AND state IN ('sent','accepted') ORDER BY version DESC LIMIT 1",[request.id]);
      request.messages = await db.query("SELECT actor_type,message,created_at FROM service_request_events WHERE request_id=? AND event_type IN ('request_received','message_to_client','message_from_client') ORDER BY id",[request.id]);
    }

    res.json({
      success: true,
      request: {
        ...request,
        services: (items || []).map(i => i.service_title)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب بيانات متابعة الطلب' });
  }
});

router.post('/services/requests/guest-message', async (req,res) => {
  const {request_no,verification_code}=req.body, message=String(req.body.message||'').trim();
  if(!request_no || !/^[a-f0-9]{28}$/.test(String(verification_code||'')) || !message || message.length>4000)return res.status(400).json({success:false,message:'أدخل رمز المتابعة والرسالة'});
  try {
    const request=await db.get("SELECT id FROM service_requests WHERE UPPER(request_no)=UPPER(?) AND verification_code=? AND source='guest'",[String(request_no).trim(),verification_code]);
    if(!request)return res.status(404).json({success:false,message:'الطلب غير موجود'});
    await db.run('INSERT INTO service_request_events (request_id,actor_type,actor_id,event_type,message) VALUES (?,?,?,?,?)',[request.id,'guest',null,'message_from_client',message]);
    res.json({success:true});
  }catch(err){res.status(500).json({success:false,message:'تعذر إرسال الرسالة'});}
});

router.post('/services/requests/guest-response', async (req,res) => {
  const {request_no,verification_code,decision,quote_id}=req.body;
  const note=String(req.body.note||'').trim();
  if(!request_no || !/^[a-f0-9]{28}$/.test(String(verification_code||'')) || !['accept','changes'].includes(decision) || (decision==='changes'&&!note) || note.length>4000)
    return res.status(400).json({success:false,message:'بيانات الرد غير صالحة؛ للطلبات القديمة يرجى التواصل مع الإدارة'});
  try {
    const result=await db.transaction(async tx=>{
      const request=await tx.get("SELECT id,status FROM service_requests WHERE UPPER(request_no)=UPPER(?) AND verification_code=? AND source='guest'",[String(request_no).trim(),verification_code]);
      if(!request)return {status:404,message:'الطلب غير موجود'};
      const quote=await tx.get("SELECT id FROM service_request_quotes WHERE request_id=? AND state='sent' ORDER BY version DESC LIMIT 1",[request.id]);
      if(request.status!=='quoted'||!quote||Number(quote.id)!==Number(quote_id))return {status:409,message:'العرض تغير أو تمت الإجابة عليه'};
      const updated=await tx.run("UPDATE service_requests SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='quoted'",[decision==='accept'?'client_accepted':'client_changes',request.id]);
      if(!updated.changes)return {status:409,message:'حالة الطلب تغيرت'};
      await tx.run('UPDATE service_request_quotes SET state=?,client_response=?,client_responded_at=CURRENT_TIMESTAMP WHERE id=?',[decision==='accept'?'accepted':'changes_requested',note,quote.id]);
      await tx.run('INSERT INTO service_request_events (request_id,actor_type,actor_id,event_type,message) VALUES (?,?,?,?,?)',[request.id,'guest',null,decision==='accept'?'client_accepted':'client_changes',note]);
      return {status:200};
    });
    res.status(result.status).json({success:result.status===200,...result});
  } catch(err){console.error('guest quote response',err);res.status(500).json({success:false,message:'تعذر تسجيل الرد'});}
});

// =========================================================================
// المسارات المحمية بالكامل بـ requireClientAuth (Deny by Default)
// =========================================================================
router.use(requireClientAuth);

// The authenticated client can only access requests submitted by that account.
router.get('/my-service-requests', async (req, res) => {
  try {
    const requests = await db.query(`SELECT id,request_no,project_name,status,created_at,updated_at FROM service_requests WHERE client_user_id=? ORDER BY id DESC`,[req.clientUser.id]);
    for (const request of requests) {
      request.quote = await db.get(`SELECT id,version,details,duration,amount,currency,state,client_response,approved_at FROM service_request_quotes WHERE request_id=? AND state IN ('sent','accepted') ORDER BY version DESC LIMIT 1`,[request.id]);
      request.messages = await db.query("SELECT actor_type,message,created_at FROM service_request_events WHERE request_id=? AND event_type IN ('request_received','message_to_client','message_from_client') ORDER BY id",[request.id]);
    }
    res.json({success:true,requests});
  } catch(err) { console.error('client requests',err); res.status(500).json({success:false,message:'تعذر جلب الطلبات'}); }
});

router.post('/my-service-requests/:id/message', async (req,res) => {
  const id=Number(req.params.id), message=String(req.body.message||'').trim();
  if(!message || message.length>4000) return res.status(400).json({success:false,message:'أدخل رسالة لا تزيد عن 4000 حرف'});
  try {
    if(!(await db.get('SELECT id FROM service_requests WHERE id=? AND client_user_id=?',[id,req.clientUser.id]))) return res.status(404).json({success:false,message:'الطلب غير موجود'});
    await db.run('INSERT INTO service_request_events (request_id,actor_type,actor_id,event_type,message) VALUES (?,?,?,?,?)',[id,'client',req.clientUser.id,'message_from_client',message]);
    res.json({success:true});
  } catch(err) {res.status(500).json({success:false,message:'تعذر إرسال الرسالة'});}
});

router.post('/my-service-requests/:id/response', async (req,res) => {
  const decision=req.body.decision, note=String(req.body.note||'').trim();
  if (!['accept','changes'].includes(decision) || (decision==='changes'&&!note) || note.length>4000) return res.status(400).json({success:false,message:'أدخل الملاحظات عند طلب التعديل'});
  try {
    const result=await db.transaction(async tx=>{
      const id=Number(req.params.id);
      const request=await tx.get('SELECT id,status FROM service_requests WHERE id=? AND client_user_id=?',[id,req.clientUser.id]);
      if(!request) return {status:404,message:'الطلب غير موجود'};
      const quote=await tx.get("SELECT id FROM service_request_quotes WHERE request_id=? AND state='sent' ORDER BY version DESC LIMIT 1",[id]);
      if(request.status!=='quoted'||!quote||quote.id!==Number(req.body.quote_id)) return {status:409,message:'العرض تغير أو تمت الإجابة عليه'};
      const update=await tx.run("UPDATE service_requests SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='quoted'",[decision==='accept'?'client_accepted':'client_changes',id]);
      if(!update.changes)return {status:409,message:'حالة الطلب تغيرت'};
      await tx.run('UPDATE service_request_quotes SET state=?,client_response=?,client_responded_at=CURRENT_TIMESTAMP WHERE id=?',[decision==='accept'?'accepted':'changes_requested',note,quote.id]);
      await tx.run('INSERT INTO service_request_events (request_id,actor_type,actor_id,event_type,message) VALUES (?,?,?,?,?)',[id,'client',req.clientUser.id,decision==='accept'?'client_accepted':'client_changes',note]);
      return {status:200};
    });
    res.status(result.status).json({success:result.status===200,...result});
  } catch(err) {console.error('client quote response',err);res.status(500).json({success:false,message:'تعذر تسجيل الرد'});}
});

/**
 * يبني شرط SQL يقصر النتائج على المشاريع التي يملك فيها المستخدم كل الصلاحيات المطلوبة
 * @param {object} req
 * @param {string|string[]} perms اسم صلاحية أو أكثر (يجب توفرها جميعاً)
 * @param {string} column عمود رقم المشروع في الاستعلام
 */
function permissionProjectFilter(req, perms, column) {
  const permList = Array.isArray(perms) ? perms : [perms];
  let ids = null;
  for (const perm of permList) {
    const allowed = req.clientUser.allowedProjectIdsFor(perm);
    if (allowed === null) continue;
    ids = ids === null ? allowed : ids.filter(id => allowed.includes(id));
  }
  if (ids === null) return { sql: '', params: [] };
  if (ids.length === 0) return { sql: ' AND 1=0', params: [] };
  return { sql: ` AND ${column} IN (${ids.map(() => '?').join(',')})`, params: ids };
}

/**
 * GET /api/client-portal/dashboard
 * ملخص لوحة التحكم للعميل (أرقام وإحصائيات مشاريعه فقط دون أي تكاليف داخلية)
 */
router.get('/dashboard', async (req, res) => {
  try {
    const clientId = req.clientUser.client_id;
    const clientUserId = req.clientUser.id;

    // 1. إحصائيات المشاريع الخاصة بالعميل
    let projectFilterClause = 'WHERE p.client_id = ?';
    let projectParams = [clientId];

    if (req.clientUser.hasExplicitProjectAccess && req.clientUser.role !== 'owner') {
      const allowedIds = Object.keys(req.clientUser.allowedProjects);
      if (allowedIds.length > 0) {
        projectFilterClause += ` AND p.id IN (${allowedIds.map(() => '?').join(',')})`;
        projectParams.push(...allowedIds);
      } else {
        projectFilterClause += ' AND 1=0';
      }
    }

    const projectsSummary = await db.get(`
      SELECT 
        COUNT(p.id) AS total_projects,
        SUM(CASE WHEN p.status = 'active' THEN 1 ELSE 0 END) AS active_projects,
        SUM(CASE WHEN p.status = 'completed' THEN 1 ELSE 0 END) AS completed_projects,
        ROUND(SUM(COALESCE(p.contract_value, 0)), 2) AS total_contract_values
      FROM projects p
      ${projectFilterClause}
    `, projectParams);

    // متوسط الإنجاز يُحسب فقط من المشاريع المسموح فيها بعرض نسبة الإنجاز
    const progressFilter = permissionProjectFilter(req, 'can_view_progress', 'p.id');
    const progressSummary = await db.get(`
      SELECT ROUND(AVG(COALESCE(p.progress_percentage, 0)), 1) AS avg_progress
      FROM projects p
      ${projectFilterClause}${progressFilter.sql}
    `, [...projectParams, ...progressFilter.params]);

    // 2. إحصائيات المستخلصات الخاصة بمشاريع العميل (جدول bills)
    const invoicesFilter = permissionProjectFilter(req, 'can_view_invoices', 'b.project_id');
    const billsSummary = await db.get(`
      SELECT 
        COUNT(b.id) AS total_bills_count,
        ROUND(SUM(COALESCE(b.net_amount, b.amount, 0)), 2) AS total_invoiced,
        ROUND(SUM(COALESCE(b.paid_amount, 0)), 2) AS total_paid_on_bills,
        SUM(CASE WHEN b.client_approval_status = 'pending' OR b.client_approval_status IS NULL THEN 1 ELSE 0 END) AS pending_approval_count
      FROM bills b
      WHERE b.client_id = ? AND (b.status != 'cancelled' OR b.status IS NULL)${invoicesFilter.sql}
    `, [clientId, ...invoicesFilter.params]);

    // 3. إجمالي سندات القبض المستلمة من العميل (سندات قبض فعلية)
    const paymentsFilter = permissionProjectFilter(req, 'can_view_payments', 'project_id');
    const paymentsSummary = await db.get(`
      SELECT
        ROUND(SUM(COALESCE(amount, 0)), 2) AS total_collected
      FROM payments
      WHERE client_id = ? AND type = 'قبض' AND (status IN ('cleared', 'posted', 'approved') OR status IS NULL)${paymentsFilter.sql}
    `, [clientId, ...paymentsFilter.params]);

    // 4. الإشعارات غير المقروءة والرسائل المفتوحة
    const notifCount = await db.get(`
      SELECT COUNT(id) AS unread_count 
      FROM client_notifications 
      WHERE client_user_id = ? AND is_read = 0
    `, [clientUserId]);

    const messagesCount = await db.get(`
      SELECT COUNT(id) AS open_count 
      FROM client_messages 
      WHERE client_user_id = ? AND status IN ('open', 'under_review')
    `, [clientUserId]);

    // 5. أحدث المشاريع النشطة (حد أقصى 5 مشاريع)
    const recentProjects = await db.query(`
      SELECT 
        p.id,
        p.code,
        p.name,
        p.contract_value,
        p.progress_percentage,
        p.status,
        p.start_date,
        p.end_date
      FROM projects p
      ${projectFilterClause}
      ORDER BY p.id DESC
      LIMIT 5
    `, projectParams);
    recentProjects.forEach(p => {
      if (!req.clientUser.hasPermission(p.id, 'can_view_progress')) p.progress_percentage = null;
    });

    const totalContract = Number(projectsSummary?.total_contract_values || 0);
    const totalInvoiced = Number(billsSummary?.total_invoiced || 0);
    const totalPaid = Number(paymentsSummary?.total_collected || billsSummary?.total_paid_on_bills || 0);
    const outstandingBalance = Math.max(0, totalInvoiced - totalPaid);

    res.json({
      success: true,
      client: {
        id: req.clientUser.client_id,
        name: req.clientUser.client_name,
        company: req.clientUser.client_company,
        user_name: req.clientUser.full_name,
        user_role: req.clientUser.role
      },
      stats: {
        total_projects: Number(projectsSummary?.total_projects || 0),
        active_projects: Number(projectsSummary?.active_projects || 0),
        completed_projects: Number(projectsSummary?.completed_projects || 0),
        // null عندما لا يوجد أي مشروع مسموح بعرض إنجازه، لتعرضه الواجهة "غير متاح" لا 0%
        avg_progress: progressSummary?.avg_progress == null ? null : Number(progressSummary.avg_progress),
        total_contract_value: totalContract,
        total_invoiced: totalInvoiced,
        total_paid: totalPaid,
        outstanding_balance: outstandingBalance,
        pending_approval_invoices: Number(billsSummary?.pending_approval_count || 0),
        unread_notifications: Number(notifCount?.unread_count || 0),
        open_messages: Number(messagesCount?.open_count || 0)
      },
      recent_projects: recentProjects
    });
  } catch (err) {
    console.error('Client Dashboard Error:', err);
    res.status(500).json({ success: false, message: 'حدث خطأ في تحميل بيانات لوحة التحكم' });
  }
});

/**
 * GET /api/client-portal/projects
 * استعراض قائمة مشاريع العميل مع نسب الإنجاز
 */
router.get('/projects', async (req, res) => {
  try {
    const clientId = req.clientUser.client_id;
    let querySql = `
      SELECT 
        p.id,
        p.code,
        p.name,
        p.contract_value,
        p.progress_percentage,
        p.status,
        p.start_date,
        p.end_date,
        p.notes,
        pc.contract_no AS contract_number,
        pc.duration_days,
        (SELECT COUNT(id) FROM bills WHERE project_id = p.id) AS bills_count
      FROM projects p
      LEFT JOIN project_contracts pc ON pc.project_id = p.id
      WHERE p.client_id = ?
    `;
    const params = [clientId];

    // فلترة إذا كانت هناك صلاحيات محددة على مستوى المشاريع
    if (req.clientUser.hasExplicitProjectAccess && req.clientUser.role !== 'owner') {
      const allowedIds = Object.keys(req.clientUser.allowedProjects);
      if (allowedIds.length > 0) {
        querySql += ` AND p.id IN (${allowedIds.map(() => '?').join(',')})`;
        params.push(...allowedIds);
      } else {
        querySql += ' AND 1=0';
      }
    }

    querySql += ' ORDER BY p.id DESC';

    const projects = await db.query(querySql, params);
    projects.forEach(p => {
      if (!req.clientUser.hasPermission(p.id, 'can_view_progress')) p.progress_percentage = null;
      if (!req.clientUser.hasPermission(p.id, 'can_view_invoices')) p.bills_count = null;
    });

    res.json({
      success: true,
      count: projects.length,
      projects
    });
  } catch (err) {
    console.error('Client Projects List Error:', err);
    res.status(500).json({ success: false, message: 'حدث خطأ في جلب قائمة المشاريع' });
  }
});

/**
 * GET /api/client-portal/projects/:id
 * تفاصيل مشروع محدد (المستخلصات + الدفعات + المخططات + التقارير الهندسية)
 */
router.get('/projects/:id', async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const clientId = req.clientUser.client_id;

    if (!projectId || !req.clientUser.canAccessProject(projectId)) {
      return res.status(403).json({
        success: false,
        message: 'ليس لديك صلاحية للاطلاع على هذا المشروع'
      });
    }

    // 1. جلب تفاصيل المشروع مع التحقق الصارم من client_id (Deny by Default)
    const project = await db.get(`
      SELECT 
        p.id,
        p.code,
        p.name,
        p.client_id,
        p.contract_value,
        p.progress_percentage,
        p.status,
        p.start_date,
        p.end_date,
        p.notes,
        pc.contract_no AS contract_number,
        pc.contract_date AS signing_date,
        pc.duration_days,
        pc.advance_payment_pct,
        pc.retention_pct,
        pc.notes AS contract_notes
      FROM projects p
      LEFT JOIN project_contracts pc ON pc.project_id = p.id
      WHERE p.id = ? AND p.client_id = ?
    `, [projectId, clientId]);

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'المشروع غير موجود أو لا يتبع حسابك'
      });
    }

    // صلاحيات المستخدم على هذا المشروع
    const perms = {};
    ['can_view_progress', 'can_view_invoices', 'can_view_payments', 'can_view_reports',
     'can_view_drawings', 'can_view_correspondence', 'can_approve_invoices', 'can_send_messages']
      .forEach(name => { perms[name] = req.clientUser.hasPermission(projectId, name); });

    if (!perms.can_view_progress) project.progress_percentage = null;

    // 2. مستخلصات المشروع (Bills)
    const invoices = !perms.can_view_invoices ? [] : await db.query(`
      SELECT 
        id,
        bill_no,
        bill_type,
        date,
        gross_amount,
        deduction,
        advance_deduction,
        retention_deduction,
        net_amount,
        paid_amount,
        remaining_amount,
        payment_status,
        status,
        client_approval_status,
        client_approved_at,
        client_approval_notes
      FROM bills
      WHERE project_id = ? AND client_id = ?
      ORDER BY id DESC
    `, [projectId, clientId]);

    // 3. دفعات وتحصيلات المشروع
    const payments = !perms.can_view_payments ? [] : await db.query(`
      SELECT
        id,
        receipt_no,
        date,
        amount,
        currency,
        payment_method,
        bank_name,
        check_no,
        receipt_category,
        notes
      FROM payments
      WHERE project_id = ? AND client_id = ? AND type = 'قبض'
      ORDER BY id DESC
    `, [projectId, clientId]);

    // 4. المخططات الهندسية المعتمدة (Drawings)
    let drawings = [];
    if (perms.can_view_drawings) try {
      // الأسماء البديلة (AS) تحافظ على أسماء الحقول التي يقرؤها تطبيق العملاء
      // ويُعرض للعميل المعتمد فقط (الواجهة تصف كل مخطط بأنه معتمد)
      drawings = await db.query(`
        SELECT
          id,
          drawing_no AS drawing_number,
          title,
          category,
          category AS discipline,
          revision,
          scale,
          status,
          approval_date,
          file_name,
          created_at
        FROM project_drawings
        WHERE project_id = ? AND (status IN ('معتمد', 'معتمد بملاحظات', 'approved') OR status IS NULL)
        ORDER BY id DESC
      `, [projectId]);
    } catch (err) {
      console.error('Client project drawings query failed:', err.message);
      drawings = [];
    }

    // 5. تقارير الموقع اليومية (الملخص فقط المتاح للعميل)
    let dailyReports = [];
    if (perms.can_view_reports) try {
      dailyReports = await db.query(`
        SELECT
          id,
          date AS report_date,
          weather,
          work_performed AS work_summary,
          status,
          created_at
        FROM project_daily_reports
        WHERE project_id = ? AND (status = 'approved' OR status = 'معتمد' OR status IS NULL)
        ORDER BY date DESC
        LIMIT 15
      `, [projectId]);
    } catch (err) {
      console.error('Client project daily reports query failed:', err.message);
      dailyReports = [];
    }

    res.json({
      success: true,
      project,
      invoices,
      payments,
      drawings,
      daily_reports: dailyReports,
      permissions: perms
    });
  } catch (err) {
    console.error('Project Details Error:', err);
    res.status(500).json({ success: false, message: 'حدث خطأ في تحميل تفاصيل المشروع' });
  }
});

/**
 * GET /api/client-portal/invoices
 * سجل المستخلصات الخاص بالعميل
 */
router.get('/invoices', async (req, res) => {
  try {
    const clientId = req.clientUser.client_id;
    const { project_id, status } = req.query;

    let sql = `
      SELECT 
        b.id,
        b.bill_no,
        b.bill_type,
        b.project_id,
        p.name AS project_name,
        p.code AS project_code,
        b.date,
        COALESCE(b.gross_amount, b.amount) AS gross_amount,
        b.deduction,
        b.advance_deduction,
        b.retention_deduction,
        b.net_amount,
        b.paid_amount,
        b.remaining_amount,
        b.payment_status,
        b.status,
        b.client_approval_status,
        b.client_approved_at,
        b.client_approval_notes,
        b.created_at
      FROM bills b
      INNER JOIN projects p ON p.id = b.project_id
      WHERE b.client_id = ?
    `;
    const params = [clientId];

    const invFilter = permissionProjectFilter(req, 'can_view_invoices', 'b.project_id');
    sql += invFilter.sql;
    params.push(...invFilter.params);

    if (project_id) {
      sql += ' AND b.project_id = ?';
      params.push(parseInt(project_id, 10));
    }

    if (status && status !== 'all') {
      sql += ' AND (b.client_approval_status = ? OR b.status = ?)';
      params.push(status, status);
    }

    sql += ' ORDER BY b.id DESC';

    const invoices = await db.query(sql, params);

    res.json({
      success: true,
      count: invoices.length,
      invoices
    });
  } catch (err) {
    console.error('Client Invoices Error:', err);
    res.status(500).json({ success: false, message: 'حدث خطأ في جلب سجل المستخلصات' });
  }
});

/**
 * POST /api/client-portal/invoices/:id/approve
 * اعتماد أو رفض المستخلص وإرسال ملاحظات العميل
 */
router.post('/invoices/:id/approve', async (req, res) => {
  try {
    const billId = parseInt(req.params.id, 10);
    const clientId = req.clientUser.client_id;
    const { decision, notes } = req.body; // decision: 'approved' | 'rejected'

    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({
        success: false,
        message: 'القرار يجب أن يكون إما معتمد (approved) أو مرفوض (rejected)'
      });
    }

    // التحقق من ملكية المستخلص للعميل
    const bill = await db.get(`
      SELECT b.id, b.bill_no, b.project_id, b.client_id, p.name AS project_name
      FROM bills b
      INNER JOIN projects p ON p.id = b.project_id
      WHERE b.id = ? AND b.client_id = ?
    `, [billId, clientId]);

    if (!bill) {
      return res.status(404).json({
        success: false,
        message: 'المستخلص غير موجود أو لا يتبع حسابك'
      });
    }

    // فحص صلاحية الاعتماد للمستخدم
    if (!req.clientUser.hasPermission(bill.project_id, 'can_approve_invoices')) {
      return res.status(403).json({
        success: false,
        message: 'ليس لديك صلاحية اعتماد أو رفض المستخلصات. يرجى مراجعة المالك.'
      });
    }

    const approvalStatusText = decision === 'approved' ? 'معتمد من العميل' : 'مرفوض من العميل';
    const notesText = notes ? String(notes).trim() : '';

    await db.run(`
      UPDATE bills 
      SET 
        client_approval_status = ?,
        client_approved_at = CURRENT_TIMESTAMP,
        client_approval_notes = ?,
        client_approved_by_id = ?
      WHERE id = ?
    `, [decision, notesText, req.clientUser.id, billId]);

    // تسجيل العملية في سجل التدقيق
    await logClientAudit(
      req,
      decision === 'approved' ? 'CLIENT_APPROVE_INVOICE' : 'CLIENT_REJECT_INVOICE',
      'bills',
      billId,
      {
        bill_no: bill.bill_no,
        project_name: bill.project_name,
        decision,
        notes: notesText
      }
    );

    // إنشاء إشعار في النظام
    await db.run(`
      INSERT INTO client_notifications 
      (client_user_id, project_id, type, title, body, reference_type, reference_id, is_read, created_at)
      VALUES (?, ?, 'ipc_issued', ?, ?, 'invoice', ?, 0, CURRENT_TIMESTAMP)
    `, [
      req.clientUser.id,
      bill.project_id,
      `تم ${approvalStatusText}: ${bill.bill_no}`,
      `قام ${req.clientUser.full_name} بتسجيل قرار (${approvalStatusText}) على المستخلص ${bill.bill_no}.`,
      billId
    ]);

    res.json({
      success: true,
      message: `تم تسجيل القرار (${approvalStatusText}) بنجاح.`,
      decision,
      bill_id: billId
    });
  } catch (err) {
    console.error('Invoice Approval Error:', err);
    res.status(500).json({ success: false, message: 'حدث خطأ أثناء معالجة قرار المستخلص' });
  }
});

/**
 * GET /api/client-portal/payments
 * سجل الدفعات والمبالغ المحصلة والمتبقية
 */
router.get('/payments', async (req, res) => {
  try {
    const clientId = req.clientUser.client_id;
    const { project_id } = req.query;

    let sql = `
      SELECT 
        pay.id,
        pay.receipt_no,
        pay.date,
        pay.amount,
        pay.currency,
        pay.payment_method,
        pay.bank_name,
        pay.check_no,
        pay.receipt_category,
        pay.status,
        pay.notes,
        p.id AS project_id,
        p.name AS project_name
      FROM payments pay
      LEFT JOIN projects p ON p.id = pay.project_id
      WHERE pay.client_id = ? AND pay.type = 'قبض'
    `;
    const params = [clientId];

    const payFilter = permissionProjectFilter(req, 'can_view_payments', 'pay.project_id');
    sql += payFilter.sql;
    params.push(...payFilter.params);

    if (project_id) {
      sql += ' AND pay.project_id = ?';
      params.push(parseInt(project_id, 10));
    }

    sql += ' ORDER BY pay.date DESC, pay.id DESC';

    const payments = await db.query(sql, params);

    // حساب الإجماليات
    const totalCollected = payments.reduce((acc, p) => acc + Number(p.amount || 0), 0);

    res.json({
      success: true,
      count: payments.length,
      total_collected: totalCollected,
      payments
    });
  } catch (err) {
    console.error('Client Payments Error:', err);
    res.status(500).json({ success: false, message: 'حدث خطأ في تحميل سجل الدفعات' });
  }
});

/**
 * GET /api/client-portal/statement
 * كشف حساب العميل التحليلي (Real Accounting Ledger Statement)
 * يربط الفواتير المعتمدة (مدين) بالسندات والتحصيلات (دائن) مع حساب الرصيد التراكمي
 */
router.get('/statement', async (req, res) => {
  try {
    const clientId = req.clientUser.client_id;
    const { project_id, from_date, to_date } = req.query;

    // 1. جلب فواتير العميل (مدين - Debit)
    let invSql = `
      SELECT 
        b.id,
        b.bill_no AS doc_no,
        'مستخلص رقم ' || b.bill_no AS description,
        b.date AS entry_date,
        COALESCE(b.net_amount, b.amount, 0) AS debit,
        0 AS credit,
        p.name AS project_name
      FROM bills b
      LEFT JOIN projects p ON p.id = b.project_id
      WHERE b.client_id = ? AND (b.status != 'cancelled' OR b.status IS NULL)
    `;
    const invParams = [clientId];
    // كشف الحساب يتطلب صلاحيتي المستخلصات والدفعات معاً حتى لا يكون الرصيد مضللاً
    const stmtPerms = ['can_view_invoices', 'can_view_payments'];
    const invStmtFilter = permissionProjectFilter(req, stmtPerms, 'b.project_id');
    invSql += invStmtFilter.sql; invParams.push(...invStmtFilter.params);
    if (project_id) { invSql += ' AND b.project_id = ?'; invParams.push(parseInt(project_id, 10)); }
    if (from_date) { invSql += ' AND b.date >= ?'; invParams.push(from_date); }
    if (to_date) { invSql += ' AND b.date <= ?'; invParams.push(to_date); }

    const invoices = await db.query(invSql, invParams);

    // 2. جلب سندات قبض العميل (دائن - Credit)
    let paySql = `
      SELECT 
        pay.id,
        pay.receipt_no AS doc_no,
        'سند قبض رقم ' || COALESCE(pay.receipt_no, pay.id) || ' (' || COALESCE(pay.payment_method, 'نقد') || ')' AS description,
        pay.date AS entry_date,
        0 AS debit,
        COALESCE(pay.amount, 0) AS credit,
        p.name AS project_name
      FROM payments pay
      LEFT JOIN projects p ON p.id = pay.project_id
      WHERE pay.client_id = ? AND pay.type = 'قبض'
    `;
    const payParams = [clientId];
    const payStmtFilter = permissionProjectFilter(req, stmtPerms, 'pay.project_id');
    paySql += payStmtFilter.sql; payParams.push(...payStmtFilter.params);
    if (project_id) { paySql += ' AND pay.project_id = ?'; payParams.push(parseInt(project_id, 10)); }
    if (from_date) { paySql += ' AND pay.date >= ?'; payParams.push(from_date); }
    if (to_date) { paySql += ' AND pay.date <= ?'; payParams.push(to_date); }

    const payments = await db.query(paySql, payParams);

    // دمج وترتيب القيود تسلسلياً حسب التاريخ
    const combined = [...invoices, ...payments].sort((a, b) => new Date(a.entry_date) - new Date(b.entry_date));

    let runningBalance = 0;
    let totalDebit = 0;
    let totalCredit = 0;

    const statement = combined.map(item => {
      totalDebit += Number(item.debit || 0);
      totalCredit += Number(item.credit || 0);
      runningBalance += Number(item.debit || 0) - Number(item.credit || 0);
      return {
        ...item,
        running_balance: runningBalance
      };
    });

    res.json({
      success: true,
      client_name: req.clientUser.client_name,
      company_name: req.clientUser.client_company,
      summary: {
        total_debit: totalDebit,
        total_credit: totalCredit,
        ending_balance: runningBalance
      },
      count: statement.length,
      statement
    });
  } catch (err) {
    console.error('Client Statement Error:', err);
    res.status(500).json({ success: false, message: 'حدث خطأ في استخراج كشف الحساب' });
  }
});

/**
 * GET /api/client-portal/notifications
 * استعراض إشعارات العميل
 */
router.get('/notifications', async (req, res) => {
  try {
    const clientUserId = req.clientUser.id;

    const notifications = await db.query(`
      SELECT 
        cn.*,
        p.name AS project_name
      FROM client_notifications cn
      LEFT JOIN projects p ON p.id = cn.project_id
      WHERE cn.client_user_id = ?
      ORDER BY cn.id DESC
      LIMIT 50
    `, [clientUserId]);

    const unreadCount = notifications.filter(n => !n.is_read).length;

    res.json({
      success: true,
      unread_count: unreadCount,
      notifications
    });
  } catch (err) {
    console.error('Client Notifications Error:', err);
    res.status(500).json({ success: false, message: 'حدث خطأ في جلب الإشعارات' });
  }
});

/**
 * POST /api/client-portal/notifications/:id/read
 * تحديد إشعار كمقروء
 */
router.post('/notifications/:id/read', async (req, res) => {
  try {
    const notifId = parseInt(req.params.id, 10);
    const clientUserId = req.clientUser.id;

    await db.run(`
      UPDATE client_notifications 
      SET is_read = 1 
      WHERE id = ? AND client_user_id = ?
    `, [notifId, clientUserId]);

    res.json({ success: true, message: 'تم تحديث الإشعار' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في تحديث الإشعار' });
  }
});

/**
 * POST /api/client-portal/notifications/read-all
 * تحديد جميع الإشعارات كمقروءة
 */
router.post('/notifications/read-all', async (req, res) => {
  try {
    const clientUserId = req.clientUser.id;
    await db.run(`
      UPDATE client_notifications 
      SET is_read = 1 
      WHERE client_user_id = ?
    `, [clientUserId]);

    res.json({ success: true, message: 'تم تحديد جميع الإشعارات كمقروءة' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في تحديث الإشعارات' });
  }
});

/**
 * POST /api/client-portal/device/register
 * تسجيل رمز جهاز العميل لـ Push Notifications
 */
router.post('/device/register', async (req, res) => {
  try {
    const { device_token, platform } = req.body;
    if (!device_token) {
      return res.status(400).json({ success: false, message: 'رمز الجهاز device_token مطلوب' });
    }

    await pushNotificationService.registerDevice(req.clientUser.id, device_token, platform || 'android');

    res.json({ success: true, message: 'تم تسجيل الجهاز بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في تسجيل الجهاز' });
  }
});

/**
 * GET /api/client-portal/messages
 * استعراض رسائل وتذاكر العميل
 */
router.get('/messages', async (req, res) => {
  try {
    const clientUserId = req.clientUser.id;
    const messages = await db.query(`
      SELECT 
        cm.*,
        p.name AS project_name
      FROM client_messages cm
      LEFT JOIN projects p ON p.id = cm.project_id
      WHERE cm.client_user_id = ?
      ORDER BY cm.id DESC
    `, [clientUserId]);

    res.json({
      success: true,
      count: messages.length,
      messages
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'حدث خطأ في تحميل الرسائل' });
  }
});

/**
 * POST /api/client-portal/messages
 * إرسال رسالة أو استفسار للإدارة
 */
router.post('/messages', async (req, res) => {
  try {
    const { project_id, subject, body, priority, attachment_url } = req.body;

    if (!subject || !body) {
      return res.status(400).json({
        success: false,
        message: 'الموضوع ونص الرسالة مطلوبان'
      });
    }

    // رابط المرفق: يُقبل رابط https أو ملف مرفوع على النظام نفسه فقط، لمنع روابط javascript: وأمثالها
    let cleanAttachment = null;
    if (attachment_url) {
      const value = String(attachment_url).trim();
      const isHttps = /^https:\/\/[^\s<>"']+$/i.test(value);
      const isLocalUpload = /^\/uploads\/[A-Za-z0-9._\-\/]+$/.test(value) && !value.includes('..');
      if (value.length > 1000 || (!isHttps && !isLocalUpload)) {
        return res.status(400).json({ success: false, message: 'رابط المرفق غير صالح. يُقبل رابط يبدأ بـ https:// أو ملف مرفوع على النظام فقط.' });
      }
      cleanAttachment = value;
    }

    const projectIdNum = project_id ? parseInt(project_id, 10) : null;
    if (projectIdNum && !req.clientUser.hasPermission(projectIdNum, 'can_send_messages')) {
      return res.status(403).json({
        success: false,
        message: 'ليس لديك صلاحية لإرسال رسالة مرتبطة بهذا المشروع'
      });
    }
    if (!projectIdNum) {
      const msgProjects = req.clientUser.allowedProjectIdsFor('can_send_messages');
      if (msgProjects !== null && msgProjects.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'ليس لديك صلاحية إرسال الرسائل. يرجى مراجعة المالك.'
        });
      }
    }

    const insertResult = await db.run(`
      INSERT INTO client_messages 
      (client_user_id, project_id, direction, subject, body, priority, attachment_url, status, created_at)
      VALUES (?, ?, 'outgoing', ?, ?, ?, ?, 'open', CURRENT_TIMESTAMP)
    `, [
      req.clientUser.id,
      projectIdNum,
      String(subject).trim(),
      String(body).trim(),
      ['low', 'normal', 'high', 'urgent'].includes(priority) ? priority : 'normal',
      cleanAttachment
    ]);

    await logClientAudit(
      req,
      'CLIENT_SEND_MESSAGE',
      'client_messages',
      insertResult.lastID || insertResult.lastInsertRowid,
      { subject, project_id: projectIdNum }
    );

    res.json({
      success: true,
      message: 'تم إرسال رسالتك للإدارة بنجاح، سيتم الرد عليك في أقرب وقت',
      message_id: insertResult.lastID || insertResult.lastInsertRowid
    });
  } catch (err) {
    console.error('Send Message Error:', err);
    res.status(500).json({ success: false, message: 'حدث خطأ أثناء إرسال الرسالة' });
  }
});

/**
 * GET /api/client-portal/profile
 * جلب بيانات الملف الشخصي والشركة
 */
router.get('/profile', async (req, res) => {
  try {
    const user = await db.get(`
      SELECT 
        cu.id,
        cu.email,
        cu.phone,
        cu.full_name,
        cu.role,
        cu.two_factor_enabled,
        cu.device_platform,
        cu.created_at,
        cu.last_login_at,
        c.id AS client_id,
        c.name AS client_name,
        c.company AS client_company,
        c.phone AS client_phone,
        c.email AS client_email,
        c.address AS client_address
      FROM client_users cu
      INNER JOIN clients c ON c.id = cu.client_id
      WHERE cu.id = ?
    `, [req.clientUser.id]);

    res.json({
      success: true,
      profile: user
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في تحميل الملف الشخصي' });
  }
});

/**
 * PUT /api/client-portal/profile
 * تحديث بيانات الملف الشخصي وكلمة المرور
 */
router.put('/profile', async (req, res) => {
  try {
    const { full_name, phone, current_password, new_password, two_factor_pin, two_factor_enabled } = req.body;

    const user = await db.get(`SELECT * FROM client_users WHERE id = ?`, [req.clientUser.id]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    // التغييرات الأمنية (كلمة المرور، رمز الأمان، إيقاف التحقق بخطوتين) تتطلب كلمة المرور الحالية،
    // حتى لا يستطيع من يملك جلسة مسروقة إضعاف حماية الحساب
    const wantsNewPassword = Boolean(new_password);
    const wantsNewPin = Boolean(two_factor_pin && String(two_factor_pin).trim());
    const wantsDisable2fa = two_factor_enabled === false && Number(user.two_factor_enabled) === 1;

    if (wantsNewPassword || wantsNewPin || wantsDisable2fa) {
      if (!current_password) {
        return res.status(400).json({ success: false, message: 'يرجى إدخال كلمة المرور الحالية لتأكيد تغيير إعدادات الأمان' });
      }
      if (!bcrypt.compareSync(String(current_password), user.password_hash)) {
        return res.status(400).json({ success: false, message: 'كلمة المرور الحالية غير صحيحة' });
      }
    }

    let updatedPin = user.two_factor_pin;
    if (wantsNewPin) {
      updatedPin = normalizeDigits(String(two_factor_pin).trim());
      if (isWeakClientPin(updatedPin)) {
        return res.status(400).json({ success: false, message: 'رمز الأمان يجب أن يكون 6 أرقام وألا يكون رمزاً سهلاً مثل 123456' });
      }
    }

    let newHash = null;
    if (wantsNewPassword) {
      if (String(new_password).length < 8 || String(new_password).length > 128) {
        return res.status(400).json({ success: false, message: 'كلمة المرور الجديدة يجب أن تكون بين 8 و128 حرفاً' });
      }
      newHash = bcrypt.hashSync(String(new_password), bcrypt.genSaltSync(10));
    }

    const updatedName = full_name ? String(full_name).trim() : user.full_name;
    const updatedPhone = phone ? String(phone).trim() : user.phone;
    const updated2fa = typeof two_factor_enabled === 'boolean' ? (two_factor_enabled ? 1 : 0) : user.two_factor_enabled;

    await db.run(`
      UPDATE client_users
      SET full_name = ?, phone = ?, two_factor_pin = ?, two_factor_enabled = ?,
          password_hash = COALESCE(?, password_hash),
          ${newHash ? `${BUMP_SESSION_SQL},` : ''}
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [updatedName, updatedPhone, updatedPin, updated2fa, newHash, user.id]);

    const changes = [wantsNewPassword && 'كلمة المرور', wantsNewPin && 'رمز الأمان', wantsDisable2fa && 'إيقاف التحقق بخطوتين'].filter(Boolean);
    await logClientAudit(req, wantsNewPassword ? 'CLIENT_CHANGE_PASSWORD' : 'CLIENT_UPDATE_PROFILE', 'client_users', user.id,
      changes.length ? `تحديث الملف الشخصي مع تغيير: ${changes.join('، ')}` : 'تم تحديث بيانات الملف الشخصي');

    // عند تغيير كلمة المرور تُلغى كل الجلسات الأخرى، ويحصل هذا الجهاز على جلسة جديدة
    let token;
    if (newHash) {
      const fresh = await db.get(`SELECT * FROM client_users WHERE id = ?`, [user.id]);
      token = issueClientToken(fresh);
    }

    res.json({
      success: true,
      message: newHash ? 'تم تحديث الملف الشخصي وتغيير كلمة المرور. تم تسجيل الخروج من الأجهزة الأخرى.' : 'تم تحديث الملف الشخصي بنجاح',
      token
    });
  } catch (err) {
    console.error('Update Profile Error:', err);
    res.status(500).json({ success: false, message: 'خطأ أثناء تحديث الملف الشخصي' });
  }
});

module.exports = router;
