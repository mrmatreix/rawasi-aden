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
  logClientAudit 
} = require('../middleware/client_auth');
const pushNotificationService = require('../services/pushNotificationService');

// تطبيق محدد الطلبات العام لبوابة العملاء
router.use(checkClientRateLimit);

// دالة مساعدة لتطبيع الأرقام العربية إلى إنجليزية
function normalizeDigits(str) {
  if (!str) return '';
  const arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  return String(str).replace(/[٠-٩]/g, (w) => arabicDigits.indexOf(w));
}

// توليد رمز OTP عشوائي مكون من 6 أرقام
function generateOtpCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
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

    if (user.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'تم تعطيل أو إيقاف حسابك من قِبل الإدارة. يرجى مراجعة إدارة الشركة.'
      });
    }

    // التحقق من كلمة المرور
    const isPasswordValid = bcrypt.compareSync(String(password), user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'بيانات الدخول غير صحيحة (البريد الإلكتروني أو كلمة المرور غير متطابقة)'
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
    const token = jwt.sign(
      {
        id: user.id,
        client_id: user.client_id,
        type: 'client',
        role: user.role,
        email: user.email
      },
      CLIENT_JWT_SECRET,
      { expiresIn: '30d' }
    );

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

    // التحقق من صلاحية الكود:
    // 1. الكود المؤقت otp_code وتاريخ صلاحيته
    // 2. أو رمز two_factor_pin الثابت كرمز أمان احتياطي
    const now = new Date();
    const isOtpValid = user.otp_code && 
                       user.otp_code === cleanOtp && 
                       user.otp_expires_at && 
                       new Date(user.otp_expires_at) >= now;

    const isPinValid = user.two_factor_pin && normalizeDigits(user.two_factor_pin) === cleanOtp;

    if (!isOtpValid && !isPinValid) {
      return res.status(400).json({
        success: false,
        message: 'رمز التحقق (OTP) غير صحيح أو منتهي الصلاحية'
      });
    }

    // تصفير كود الـ OTP بعد استخدامه بنجاح
    await db.run(`
      UPDATE client_users 
      SET otp_code = NULL, otp_expires_at = NULL, last_login_at = CURRENT_TIMESTAMP, last_login_ip = ?
      WHERE id = ?
    `, [req.ip || req.socket.remoteAddress || '127.0.0.1', user.id]);

    // إصدار توكن الجلسة لمدة 30 يوم
    const token = jwt.sign(
      {
        id: user.id,
        client_id: user.client_id,
        type: 'client',
        role: user.role,
        email: user.email
      },
      CLIENT_JWT_SECRET,
      { expiresIn: '30d' }
    );

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

    res.json({
      success: true,
      message: 'تمت إرسال تعليمات ورمز إعادة تعيين كلمة المرور بنجاح',
      maskedPhone: user.phone ? user.phone.replace(/(\d{3})\d+(\d{2})/, '$1****$2') : null,
      debugOtp: require('../config/environment').isDev ? otpCode : undefined
    });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ success: false, message: 'حدث خطأ أثناء طلب استعادة كلمة المرور' });
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
          const userCheck = await db.get(`SELECT id FROM client_users WHERE id = ? AND client_id = ? AND status = 'active'`, [decoded.id,decoded.client_id]);
          if (userCheck) {
            clientUserId = userCheck.id;
            source = 'registered_client';
          }
        }
      } catch (tokenErr) {
        // إذا كان التوكن غير صالح، يستمر كزائر
      }
    }

    // 3. توليد رقم طلب فريد SR-YYYY-XXXX
    const currentYear = new Date().getFullYear();
    const countRow = await db.get(`
      SELECT COUNT(id) as total FROM service_requests
      WHERE request_no LIKE ?
    `, [`SR-${currentYear}-%`]);
    const nextSeq = (Number(countRow?.total || 0) + 1).toString().padStart(4, '0');
    const requestNo = `SR-${currentYear}-${nextSeq}`;

    // توليد كود تحقق آمن
    const verificationCode = require('crypto').randomInt(100000,1000000).toString();

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

    const requestId = await db.transaction(async tx=>{
    const insertResult = await tx.run(`
      INSERT INTO service_requests (
        request_no, client_user_id, source, client_name, phone, email,
        project_name, project_type, location, description,
        estimated_budget, currency, expected_start_date, notes,
        attachments, status, verification_code, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
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
      verificationCode
    ]);

    const requestId = insertResult.lastID || insertResult.insertId;

    // 6. حفظ عناصر الخدمات المختارة ضمن الطلب الرئيسي الواحد
    for (const s of activeServices) {
      await tx.run(`
        INSERT INTO service_request_items (request_id, service_id, service_title, created_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      `, [requestId, s.id, s.title]);
    }

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

    res.json({
      success: true,
      message: 'تم إرسال طلبكم بنجاح إلى إدارة مكتب رواسي عدن. سيقوم مهندسونا بالتواصل معكم في أقرب وقت.',
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
router.get('/services/requests/track', async (req, res) => {
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
        sr.id, sr.request_no, sr.client_name, sr.project_name, sr.project_type,
        sr.location, sr.status, sr.admin_notes, sr.quoted_amount, sr.currency,
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

// =========================================================================
// المسارات المحمية بالكامل بـ requireClientAuth (Deny by Default)
// =========================================================================
router.use(requireClientAuth);

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
        ROUND(AVG(COALESCE(p.progress_percentage, 0)), 1) AS avg_progress,
        ROUND(SUM(COALESCE(p.contract_value, 0)), 2) AS total_contract_values
      FROM projects p
      ${projectFilterClause}
    `, projectParams);

    // 2. إحصائيات المستخلصات الخاصة بمشاريع العميل (جدول bills)
    const billsSummary = await db.get(`
      SELECT 
        COUNT(b.id) AS total_bills_count,
        ROUND(SUM(COALESCE(b.net_amount, b.amount, 0)), 2) AS total_invoiced,
        ROUND(SUM(COALESCE(b.paid_amount, 0)), 2) AS total_paid_on_bills,
        SUM(CASE WHEN b.client_approval_status = 'pending' OR b.client_approval_status IS NULL THEN 1 ELSE 0 END) AS pending_approval_count
      FROM bills b
      WHERE b.client_id = ? AND (b.status != 'cancelled' OR b.status IS NULL)
    `, [clientId]);

    // 3. إجمالي سندات القبض المستلمة من العميل (سندات قبض فعلية)
    const paymentsSummary = await db.get(`
      SELECT 
        ROUND(SUM(COALESCE(amount, 0)), 2) AS total_collected
      FROM payments
      WHERE client_id = ? AND type = 'قبض' AND (status IN ('cleared', 'posted', 'approved') OR status IS NULL)
    `, [clientId]);

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
        avg_progress: Number(projectsSummary?.avg_progress || 0),
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

    // 2. مستخلصات المشروع (Bills)
    const invoices = await db.query(`
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
    const payments = await db.query(`
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
    try {
      drawings = await db.query(`
        SELECT 
          id,
          drawing_number,
          title,
          category,
          discipline,
          revision,
          scale,
          status,
          file_path,
          created_at
        FROM project_drawings
        WHERE project_id = ?
        ORDER BY id DESC
      `, [projectId]);
    } catch {
      drawings = [];
    }

    // 5. تقارير الموقع اليومية (الملخص فقط المتاح للعميل)
    let dailyReports = [];
    try {
      dailyReports = await db.query(`
        SELECT 
          id,
          report_date,
          weather,
          work_summary,
          status,
          created_at
        FROM project_daily_reports
        WHERE project_id = ? AND (status = 'approved' OR status = 'معتمد' OR status IS NULL)
        ORDER BY report_date DESC
        LIMIT 15
      `, [projectId]);
    } catch {
      dailyReports = [];
    }

    res.json({
      success: true,
      project,
      invoices,
      payments,
      drawings,
      daily_reports: dailyReports
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
    if (!req.clientUser.hasPermission(bill.project_id, 'can_approve_invoices') && req.clientUser.role === 'viewer') {
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

    const projectIdNum = project_id ? parseInt(project_id, 10) : null;
    if (projectIdNum && !req.clientUser.canAccessProject(projectIdNum)) {
      return res.status(403).json({
        success: false,
        message: 'ليس لديك صلاحية لإرسال رسالة مرتبطة بهذا المشروع'
      });
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
      priority || 'normal',
      attachment_url || null
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

    // إذا طلب تغيير كلمة المرور
    if (new_password) {
      if (!current_password) {
        return res.status(400).json({ success: false, message: 'يرجى إدخال كلمة المرور الحالية لتأكيد التغيير' });
      }
      const isMatch = bcrypt.compareSync(String(current_password), user.password_hash);
      if (!isMatch) {
        return res.status(400).json({ success: false, message: 'كلمة المرور الحالية غير صحيحة' });
      }
      if (String(new_password).length < 6) {
        return res.status(400).json({ success: false, message: 'كلمة المرور الجديدة يجب ألا تقل عن 6 خانات' });
      }
      const salt = bcrypt.genSaltSync(10);
      const newHash = bcrypt.hashSync(String(new_password), salt);
      await db.run(`UPDATE client_users SET password_hash = ? WHERE id = ?`, [newHash, user.id]);
    }

    // تحديث البيانات الأساسية
    const updatedName = full_name ? String(full_name).trim() : user.full_name;
    const updatedPhone = phone ? String(phone).trim() : user.phone;
    const updatedPin = two_factor_pin ? normalizeDigits(String(two_factor_pin).trim()) : user.two_factor_pin;
    const updated2fa = typeof two_factor_enabled === 'boolean' ? (two_factor_enabled ? 1 : 0) : user.two_factor_enabled;

    await db.run(`
      UPDATE client_users 
      SET full_name = ?, phone = ?, two_factor_pin = ?, two_factor_enabled = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [updatedName, updatedPhone, updatedPin, updated2fa, user.id]);

    await logClientAudit(req, 'CLIENT_UPDATE_PROFILE', 'client_users', user.id, 'تم تحديث بيانات الملف الشخصي');

    res.json({
      success: true,
      message: 'تم تحديث الملف الشخصي بنجاح'
    });
  } catch (err) {
    console.error('Update Profile Error:', err);
    res.status(500).json({ success: false, message: 'خطأ أثناء تحديث الملف الشخصي' });
  }
});

module.exports = router;
