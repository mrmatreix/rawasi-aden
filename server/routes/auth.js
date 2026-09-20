const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { get, query, run, connectionManager } = require('../database/db');

const JWT_SECRET = process.env.JWT_SECRET || 'rawasi_aden_secret_key_2024';

function getRoleDefaultPermissions(role) {
  switch (role) {
    case 'admin':
      return [
        'dashboard:view',
        'projects:view', 'projects:manage', 'projects:print',
        'revenues:view', 'revenues:create', 'revenues:print',
        'expenses:view', 'expenses:create',
        'custody:view', 'custody:manage',
        'clients:view', 'clients:manage', 'clients:statement',
        'suppliers:view', 'suppliers:manage', 'suppliers:statement',
        'inventory:view', 'inventory:manage', 'inventory:issue',
        'cash:view',
        'hr:view', 'hr:manage', 'hr:payroll',
        'reports:view',
        'settings:company', 'settings:users', 'settings:backup'
      ];
    case 'accountant':
      return [
        'dashboard:view',
        'revenues:view', 'revenues:create', 'revenues:print',
        'expenses:view', 'expenses:create',
        'custody:view', 'custody:manage',
        'clients:view', 'clients:manage', 'clients:statement',
        'suppliers:view', 'suppliers:manage', 'suppliers:statement',
        'cash:view',
        'hr:view', 'hr:manage', 'hr:payroll',
        'reports:view'
        ,'hr:view'
      ];
    case 'project_manager':
      return [
        'dashboard:view',
        'projects:view', 'projects:manage', 'projects:print',
        'expenses:view', 'expenses:create',
        'custody:view',
        'inventory:view', 'inventory:issue',
        'reports:view'
      ];
    case 'storekeeper':
      return [
        'inventory:view', 'inventory:manage', 'inventory:issue',
        'projects:view'
      ];
    default:
      return ['dashboard:view'];
  }
}

function parseUserPermissions(user) {
  let permissionsList = [];
  if (user.permissions) {
    try {
      permissionsList = typeof user.permissions === 'string' && (user.permissions.startsWith('[') || user.permissions.startsWith('{'))
        ? JSON.parse(user.permissions)
        : user.permissions.split(',').map(s => s.trim()).filter(Boolean);
    } catch (e) {
      permissionsList = user.permissions.split(',').map(s => s.trim()).filter(Boolean);
    }
  }

  if (!permissionsList || permissionsList.length === 0) {
    permissionsList = getRoleDefaultPermissions(user.role);
  }

  return permissionsList;
}

// دالة لمعالجة وتوحيد التوقيت الزمني لـ Heartbeat بدون التباس المناطق الزمنية
function getHeartbeatTimestamp(hb) {
  if (!hb) return 0;
  if (typeof hb === 'number') return hb;
  const str = String(hb).trim();
  if (!str) return 0;
  if (str.endsWith('Z') || str.includes('+')) return new Date(str).getTime();
  return new Date(str.replace(' ', 'T') + 'Z').getTime();
}

// التحقق من أن المستخدم المتصل هو المدير العام (Admin Only)
function verifyAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'يرجى تسجيل الدخول بحساب المدير العام لتنفيذ هذا الإجراء' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'عذراً! ضبط وتعديل خيارات الأمان والجلسات متاح حصرياً لحساب المدير العام' });
    }
    req.adminUser = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'جلسة المدير العام غير صالحة أو منتهية، يرجى إعادة تسجيل الدخول' });
  }
}

// دالة مساعدة لتنسيق الوقت بالعربية
function formatTimeArabic(timeStr) {
  if (!timeStr) return '';
  const [hStr, mStr] = timeStr.split(':');
  let h = parseInt(hStr, 10);
  const m = mStr || '00';
  const ampm = h >= 12 ? 'مساءً' : 'صباحاً';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${m} ${ampm}`;
}

// دالة مساعدة لجلب إعدادات الأمان وسياسة الجلسات والتوكن (افتراضية أو مخصصة لمستخدم)
async function getSecuritySettings(user = null) {
  const defaults = {
    session_mode: 'multi', // 'multi' | 'single'
    session_device_limit: 3, // 2 | 3 | 5
    session_overflow_action: 'kick_oldest', // 'kick_oldest' | 'block_new'
    jwt_token_expiry: '8h', // '1h' | '4h' | '8h' | '24h' | '7d' | '30d' | 'custom'
    jwt_custom_minutes: 480,
    work_start_time: '08:00',
    work_end_time: '16:00',
    work_hours_enabled: false
  };
  try {
    const rows = await query("SELECT `key`, `value` FROM settings WHERE `key` IN ('session_mode', 'session_device_limit', 'session_overflow_action', 'jwt_token_expiry', 'jwt_custom_minutes', 'work_start_time', 'work_end_time')");
    if (rows && rows.length > 0) {
      rows.forEach(r => {
        if (r.key === 'session_device_limit' || r.key === 'jwt_custom_minutes') {
          defaults[r.key] = Number(r.value) || defaults[r.key];
        } else if (r.value) {
          defaults[r.key] = r.value;
        }
      });
    }
  } catch (e) {
    console.warn('Could not read security settings from DB, using defaults:', e.message);
  }

  // إذا تم تمرير مستخدم ولديه إعدادات أمان وجلسات مخصصة حددها المدير العام
  if (user && user.security_settings) {
    try {
      const userCustom = typeof user.security_settings === 'string'
        ? JSON.parse(user.security_settings)
        : user.security_settings;
      if (userCustom && typeof userCustom === 'object') {
        return Object.assign({}, defaults, userCustom, { is_custom: true });
      }
    } catch (e) {}
  }

  return defaults;
}

// 0. جلب إعدادات الأمان وسياسة الجلسات والتوكن العامة
router.get('/security-settings', async (req, res) => {
  try {
    const settings = await getSecuritySettings();
    res.json({ success: true, settings });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب إعدادات الأمان: ' + err.message });
  }
});

// 0. حفظ وتطبيق إعدادات الأمان وسياسة الجلسات والتوكن العامة (مقتصرة على المدير العام فقط)
router.post('/security-settings', verifyAdmin, async (req, res) => {
  try {
    const { session_mode, session_device_limit, session_overflow_action, jwt_token_expiry, jwt_custom_minutes, work_start_time, work_end_time } = req.body || {};

    const validModes = ['multi', 'single'];
    const validLimits = [2, 3, 5];
    const validOverflow = ['kick_oldest', 'block_new'];
    const validExpiries = ['1h', '4h', '8h', '24h', '7d', '30d', 'custom'];

    const updates = {};
    if (session_mode && validModes.includes(session_mode)) {
      updates['session_mode'] = session_mode;
    }
    if (session_device_limit && (validLimits.includes(Number(session_device_limit)) || Number(session_device_limit) > 0)) {
      updates['session_device_limit'] = String(Number(session_device_limit));
    }
    if (session_overflow_action && validOverflow.includes(session_overflow_action)) {
      updates['session_overflow_action'] = session_overflow_action;
    }
    if (jwt_token_expiry && validExpiries.includes(jwt_token_expiry)) {
      updates['jwt_token_expiry'] = jwt_token_expiry;
    }
    if (jwt_custom_minutes && Number(jwt_custom_minutes) > 0) {
      updates['jwt_custom_minutes'] = String(Number(jwt_custom_minutes));
    }
    if (work_start_time) {
      updates['work_start_time'] = String(work_start_time);
    }
    if (work_end_time) {
      updates['work_end_time'] = String(work_end_time);
    }

    for (const [k, v] of Object.entries(updates)) {
      await run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [k, String(v)]);
    }

    const current = await getSecuritySettings();
    res.json({ success: true, message: 'تم حفظ وتطبيق إعدادات الأمان وسياسة الجلسات بنجاح 🛡️', settings: current });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في حفظ إعدادات الأمان: ' + err.message });
  }
});

// 1. تسجيل الدخول (Login) مع فحص عدم تكرار اتصال نفس المستخدم بالتزامن وسقف الجلسات
router.post('/login', async (req, res) => {
  try {
    const { username, password, force, deviceInfo } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'يرجى إدخال اسم المستخدم وكلمة المرور' });
    }

    const cleanUsername = String(username).trim();
    const user = await get('SELECT * FROM users WHERE LOWER(username) = LOWER(?)', [cleanUsername]);
    if (!user) {
      return res.status(401).json({ success: false, message: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }

    if (user.status === 'inactive') {
      return res.status(403).json({ success: false, message: 'هذا الحساب معطل حالياً، يرجى مراجعة إدارة النظام' });
    }

    const isMatch = bcrypt.compareSync(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }

    // قراءة إعدادات الأمان المخصصة لهذا المستخدم (أو الافتراضية)
    const secSettings = await getSecuritySettings(user);
    
    // فحص فترة وساعات العمل المسموحة إذا كانت مخصصة لهذا المستخدم (من ساعة كذا إلى كذا خلال 24 ساعة)
    if (user.username !== 'admin' && (secSettings.jwt_token_expiry === 'custom' || secSettings.work_hours_enabled)) {
      const startTime = secSettings.work_start_time || '08:00';
      const endTime = secSettings.work_end_time || '16:00';

      const now = new Date();
      const currentH = now.getHours();
      const currentM = now.getMinutes();
      const currentTimeStr = `${String(currentH).padStart(2, '0')}:${String(currentM).padStart(2, '0')}`;

      let isAllowed = false;
      if (startTime <= endTime) {
        isAllowed = (currentTimeStr >= startTime && currentTimeStr <= endTime);
      } else {
        // وردية ليلية تمتد عبر منتصف الليل (مثلاً: 22:00 إلى 06:00)
        isAllowed = (currentTimeStr >= startTime || currentTimeStr <= endTime);
      }

      if (!isAllowed) {
        return res.status(403).json({
          success: false,
          outside_work_hours: true,
          message: `عذراً (${user.full_name || user.username})! الحساب مبرمج بفترة عمل محددة من الساعة (${formatTimeArabic(startTime)}) إلى الساعة (${formatTimeArabic(endTime)}). لا يُسمح بتسجيل الدخول خارج أوقات العمل الرسمية المصرح بها.`
        });
      }
    }

    // حساب مدة صلاحية التوكن (JWT)
    let tokenExpiry = secSettings.jwt_token_expiry || '8h';
    if (tokenExpiry === 'custom') {
      const startTime = secSettings.work_start_time || '08:00';
      const endTime = secSettings.work_end_time || '16:00';
      const now = new Date();
      const currentH = now.getHours();
      const currentM = now.getMinutes();
      const [endH, endM] = endTime.split(':').map(Number);

      let remainingMins = (endH * 60 + endM) - (currentH * 60 + currentM);
      if (remainingMins <= 0 && startTime > endTime) {
        remainingMins += 24 * 60;
      }
      if (remainingMins <= 0 || isNaN(remainingMins)) remainingMins = 60; // حد أدنى ساعة واحدة
      tokenExpiry = `${remainingMins}m`;
    }

    // استخراج الجلسات النشطة المخزنة لهذا المستخدم
    const ACTIVE_THRESHOLD_MS = 75 * 1000; // مهلة النشاط 75 ثانية
    const nowMs = Date.now();
    let activeSessions = [];
    try {
      activeSessions = user.active_sessions ? JSON.parse(user.active_sessions) : [];
    } catch (e) {
      activeSessions = [];
    }
    if (!Array.isArray(activeSessions)) activeSessions = [];

    // تنقية الجلسات غير النشطة
    activeSessions = activeSessions.filter(s => {
      const hb = s.lastHeartbeatMs || getHeartbeatTimestamp(s.lastHeartbeat);
      return (nowMs - hb) < ACTIVE_THRESHOLD_MS;
    });

    // توافقية مع الحقول القديمة إذا لم تكن مسجلة في active_sessions
    if (activeSessions.length === 0 && user.is_logged_in === 1 && user.session_token && user.last_heartbeat) {
      const lastHb = getHeartbeatTimestamp(user.last_heartbeat);
      if ((nowMs - lastHb) < ACTIVE_THRESHOLD_MS) {
        activeSessions.push({
          sessionId: user.session_token,
          device: user.last_login_device || 'متصفح النظام',
          ip: user.last_login_ip || '',
          loginAt: user.last_login_at || user.last_heartbeat,
          lastHeartbeat: user.last_heartbeat,
          lastHeartbeatMs: lastHb
        });
      }
    }

    // فحص سقف الأجهزة حسب السياسة المحددة (جلسة واحدة صارمة أو جلسات متعددة)
    const isSingleMode = secSettings.session_mode === 'single';
    const maxDevices = isSingleMode ? 1 : (Number(secSettings.session_device_limit) || 3);
    const overflowAction = secSettings.session_overflow_action || 'kick_oldest';

    if (activeSessions.length >= maxDevices) {
      if (overflowAction === 'block_new' && !force) {
        const policyDesc = isSingleMode ? 'جلسة واحدة صارمة' : `سقف الجلسات المتعددة (${maxDevices} أجهزة)`;
        return res.status(409).json({
          success: false,
          already_logged_in: true,
          limit_exceeded: true,
          message: `المستخدم (${user.full_name || user.username}) متصل حالياً وبلغ الحد الأقصى للجلسات المسموح بها (${policyDesc}). لمنع التكرار والحفاظ على سرية البيانات، لا يمكن فتح جلسة جديدة. يرجى تسجيل الخروج أولاً أو استخدام الدخول الإجباري لطرد الجلسات القديمة.`,
          last_active: user.last_heartbeat,
          last_login_device: user.last_login_device,
          user: {
            id: user.id,
            username: user.username,
            full_name: user.full_name
          }
        });
      } else {
        // طرد الجلسات الأقدم حتى يقل العدد عن السقف المسموح
        activeSessions.sort((a, b) => {
          const tA = a.lastHeartbeatMs || getHeartbeatTimestamp(a.lastHeartbeat || a.loginAt);
          const tB = b.lastHeartbeatMs || getHeartbeatTimestamp(b.lastHeartbeat || b.loginAt);
          return tA - tB;
        });
        while (activeSessions.length >= maxDevices) {
          activeSessions.shift();
        }
      }
    }

    const permissionsList = parseUserPermissions(user);
    const sessionId = crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).substring(2));
    const nowIsoDb = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const nowIsoFull = new Date().toISOString();
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    const deviceStr = deviceInfo || req.headers['user-agent'] || 'متصفح النظام';

    activeSessions.push({
      sessionId,
      ip: String(clientIp),
      device: String(deviceStr).substring(0, 200),
      loginAt: nowIsoDb,
      lastHeartbeat: nowIsoFull,
      lastHeartbeatMs: nowMs
    });

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, full_name: user.full_name, sessionId },
      JWT_SECRET,
      { expiresIn: tokenExpiry }
    );

    // تحديث حالة الاتصال وبصمة الجلسة في قاعدة البيانات
    await run(`
      UPDATE users SET 
        is_logged_in = 1,
        session_token = ?,
        active_sessions = ?,
        last_heartbeat = ?,
        last_login_at = ?,
        last_login_ip = ?,
        last_login_device = ?
      WHERE id = ?
    `, [sessionId, JSON.stringify(activeSessions), nowIsoDb, nowIsoDb, String(clientIp), String(deviceStr).substring(0, 250), user.id]);

    let dbStatus = connectionManager ? connectionManager.getStatus() : { isOnline: false, mode: 'offline' };

    res.json({
      success: true,
      message: `مرحباً بك ${user.full_name}! تم تسجيل الدخول بنجاح`,
      token,
      sessionId,
      dbStatus,
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role,
        email: user.email,
        phone: user.phone,
        status: user.status,
        permissions: permissionsList
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'خطأ في الخادم أثناء تسجيل الدخول: ' + err.message, error: err.message });
  }
});

// 2. نبض الحفاظ على الجلسة والتحقق من عدم تكرار الدخول
router.post('/heartbeat', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'جلسة غير صالحة' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await get('SELECT id, is_logged_in, session_token, active_sessions, status, full_name, username FROM users WHERE id = ?', [decoded.id]);
    if (!user || user.status === 'inactive') {
      return res.status(401).json({ success: false, session_terminated: true, message: 'الحساب معطل أو غير موجود' });
    }

    let activeSessions = [];
    try {
      activeSessions = user.active_sessions ? JSON.parse(user.active_sessions) : [];
    } catch (e) {
      activeSessions = [];
    }
    if (!Array.isArray(activeSessions)) activeSessions = [];

    const nowIsoDb = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const nowIsoFull = new Date().toISOString();
    const nowMs = Date.now();

    // إذا كانت هناك مصفوفة جلسات نشطة مسجلة
    if (activeSessions.length > 0) {
      const currentSess = activeSessions.find(s => s.sessionId === decoded.sessionId);
      if (!currentSess) {
        return res.status(401).json({
          success: false,
          session_terminated: true,
          message: 'تم إنهاء هذه الجلسة تلقائياً نظراً لتسجيل الدخول من جهاز آخر تجاوز سقف الأجهزة أو تم إنهاء الجلسة القديمة.'
        });
      }
      currentSess.lastHeartbeat = nowIsoFull;
      currentSess.lastHeartbeatMs = nowMs;
    } else {
      // فحص الجلسة المفردة
      if (decoded.sessionId && user.session_token && decoded.sessionId !== user.session_token) {
        return res.status(401).json({
          success: false,
          session_terminated: true,
          message: 'تم تسجيل الدخول بحسابك من جهاز أو متصفح آخر. تم إنهاء هذه الجلسة تلقائياً منعاً لتكرار نفس المستخدم.'
        });
      }
      if (decoded.sessionId) {
        activeSessions.push({ sessionId: decoded.sessionId, lastHeartbeat: nowIsoFull, lastHeartbeatMs: nowMs });
      }
    }

    await run("UPDATE users SET last_heartbeat = ?, active_sessions = ?, is_logged_in = 1 WHERE id = ?", [nowIsoDb, JSON.stringify(activeSessions), user.id]);
    res.json({ success: true, is_logged_in: true });
  } catch (err) {
    res.status(401).json({ success: false, message: 'انتهت صلاحية الجلسة' });
  }
});

// 3. التحقق من صحة الجلسة (Verify Token)
router.get('/me', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'جلسة غير صالحة' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await get('SELECT id, username, full_name, role, email, phone, status, permissions, is_logged_in, session_token, active_sessions FROM users WHERE id = ?', [decoded.id]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    if (user.status === 'inactive') {
      return res.status(403).json({ success: false, message: 'هذا الحساب معطل حالياً' });
    }

    let activeSessions = [];
    try {
      activeSessions = user.active_sessions ? JSON.parse(user.active_sessions) : [];
    } catch (e) {
      activeSessions = [];
    }
    if (!Array.isArray(activeSessions)) activeSessions = [];

    if (activeSessions.length > 0) {
      const currentSess = activeSessions.find(s => s.sessionId === decoded.sessionId);
      if (!currentSess) {
        return res.status(401).json({
          success: false,
          session_terminated: true,
          message: 'تم إنهاء هذه الجلسة تلقائياً نظراً لتسجيل الدخول من جهاز آخر تجاوز سقف الأجهزة المسموح بها.'
        });
      }
    } else if (decoded.sessionId && user.session_token && decoded.sessionId !== user.session_token) {
      return res.status(401).json({
        success: false,
        session_terminated: true,
        message: 'تم تسجيل الدخول بهذا الحساب من جهاز أو نافذة أخرى. تم إنهاء هذه الجلسة منعاً للتكرار.'
      });
    }

    const nowIso = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await run("UPDATE users SET last_heartbeat = ?, is_logged_in = 1 WHERE id = ?", [nowIso, user.id]);

    const permissionsList = parseUserPermissions(user);

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role,
        email: user.email,
        phone: user.phone,
        status: user.status,
        permissions: permissionsList
      }
    });
  } catch (err) {
    res.status(401).json({ success: false, message: 'انتهت صلاحية الجلسة' });
  }
});

// 4. تسجيل الخروج وإنهاء الجلسة فوراً
router.post('/logout', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    let userId = req.body?.userId;
    let username = req.body?.username;
    let currentSessionId = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
        userId = userId || decoded.id;
        username = username || decoded.username;
        currentSessionId = decoded.sessionId;
      } catch {}
    }

    if (userId || username) {
      const targetUser = userId 
        ? await get("SELECT id, active_sessions, session_token FROM users WHERE id = ?", [userId])
        : await get("SELECT id, active_sessions, session_token FROM users WHERE LOWER(username) = LOWER(?)", [username]);

      if (targetUser) {
        let activeSessions = [];
        try {
          activeSessions = targetUser.active_sessions ? JSON.parse(targetUser.active_sessions) : [];
        } catch (e) {}

        if (currentSessionId && Array.isArray(activeSessions)) {
          activeSessions = activeSessions.filter(s => s.sessionId !== currentSessionId);
        } else {
          activeSessions = [];
        }

        const isLogged = activeSessions.length > 0 ? 1 : 0;
        const lastToken = activeSessions.length > 0 ? activeSessions[activeSessions.length - 1].sessionId : null;
        await run("UPDATE users SET is_logged_in = ?, active_sessions = ?, session_token = ? WHERE id = ?", [
          isLogged,
          JSON.stringify(activeSessions),
          lastToken,
          targetUser.id
        ]);
      }
    }

    res.json({ success: true, message: 'تم إنهاء الجلسة بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء تسجيل الخروج: ' + err.message, error: err.message });
  }
});

// 5. جلب قائمة المستخدمين المتصلين حالياً بالنظام
router.get('/connected-users', async (req, res) => {
  try {
    const ACTIVE_THRESHOLD_MS = 75 * 1000;
    const now = Date.now();

    const users = await query(`
      SELECT id, username, full_name, role, email, phone, last_heartbeat, last_login_at, last_login_device, last_login_ip, is_logged_in
      FROM users
      WHERE is_logged_in = 1 AND last_heartbeat IS NOT NULL
      ORDER BY last_heartbeat DESC
    `);

    const connectedUsers = users.filter(u => {
      const diff = now - new Date(u.last_heartbeat).getTime();
      return !isNaN(diff) && diff < ACTIVE_THRESHOLD_MS;
    });

    res.json({
      success: true,
      count: connectedUsers.length,
      users: connectedUsers
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب المستخدمين المتصلين', error: err.message });
  }
});

// 6. فك قفل الشاشة بالتحقق من كلمة المرور للمستخدم الحالي
router.post('/unlock', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'يرجى إدخال كلمة المرور لإلغاء القفل' });
    }

    const cleanUsername = String(username).trim();
    const user = await get('SELECT * FROM users WHERE LOWER(username) = LOWER(?)', [cleanUsername]);
    if (!user) {
      return res.status(401).json({ success: false, message: 'اسم المستخدم غير موجود' });
    }

    if (user.status === 'inactive') {
      return res.status(403).json({ success: false, message: 'هذا الحساب معطل حالياً' });
    }

    const isMatch = bcrypt.compareSync(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'كلمة المرور غير صحيحة، يرجى المحاولة مرة أخرى' });
    }

    // تحديث نبض الجلسة
    const nowIso = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await run('UPDATE users SET last_heartbeat = ?, is_logged_in = 1 WHERE id = ?', [nowIso, user.id]);

    res.json({
      success: true,
      message: 'تم فك القفل واستئناف العمل بنجاح',
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role
      }
    });
  } catch (err) {
    console.error('Unlock error:', err);
    res.status(500).json({ success: false, message: 'خطأ في التحقق من كلمة المرور: ' + err.message });
  }
});

router.verifyAdmin = verifyAdmin;
router.getSecuritySettings = getSecuritySettings;
router.JWT_SECRET = JWT_SECRET;

module.exports = router;
