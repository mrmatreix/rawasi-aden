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

// 1. تسجيل الدخول (Login) مع فحص عدم تكرار اتصال نفس المستخدم بالتزامن
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

    // فحص ما إذا كان المستخدم متصلاً حالياً لمنع تكرار تسجيل الدخول لنفس المستخدم
    const ACTIVE_THRESHOLD_MS = 60 * 1000; // مهلة النشاط 60 ثانية
    let isCurrentlyActive = false;
    if (user.is_logged_in === 1 && user.last_heartbeat) {
      const lastHbTime = new Date(user.last_heartbeat).getTime();
      const diff = Date.now() - lastHbTime;
      if (!isNaN(diff) && diff < ACTIVE_THRESHOLD_MS) {
        isCurrentlyActive = true;
      }
    }

    // إذا كان المستخدم متصلاً بالفعل ولم يطلب إنهاء الجلسة السابقة (Force Takeover)
    if (isCurrentlyActive && !force) {
      return res.status(409).json({
        success: false,
        already_logged_in: true,
        message: `المستخدم (${user.full_name || user.username}) متصل بالنظام حالياً من جهاز أو جلسة أخرى. لمنع التكرار والحفاظ على أمان البيانات، لا يمكن تسجيل الدخول بنفس المستخدم بالتزامن.`,
        last_active: user.last_heartbeat,
        last_login_device: user.last_login_device,
        user: {
          id: user.id,
          username: user.username,
          full_name: user.full_name
        }
      });
    }

    const permissionsList = parseUserPermissions(user);
    const sessionId = crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).substring(2));

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, full_name: user.full_name, sessionId },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // تحديث حالة الاتصال وبصمة الجلسة في قاعدة البيانات
    const nowIso = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    const deviceStr = deviceInfo || req.headers['user-agent'] || 'متصفح النظام';
    await run(`
      UPDATE users SET 
        is_logged_in = 1,
        session_token = ?,
        last_heartbeat = ?,
        last_login_at = ?,
        last_login_ip = ?,
        last_login_device = ?
      WHERE id = ?
    `, [sessionId, nowIso, nowIso, String(clientIp), String(deviceStr).substring(0, 250), user.id]);

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
    const user = await get('SELECT id, is_logged_in, session_token, status, full_name, username FROM users WHERE id = ?', [decoded.id]);
    if (!user || user.status === 'inactive') {
      return res.status(401).json({ success: false, session_terminated: true, message: 'الحساب معطل أو غير موجود' });
    }

    // إذا تغير معرف الجلسة في قاعدة البيانات (تم تسجيل الدخول من مكان آخر)
    if (decoded.sessionId && user.session_token && decoded.sessionId !== user.session_token) {
      return res.status(401).json({
        success: false,
        session_terminated: true,
        message: 'تم تسجيل الدخول بحسابك من جهاز أو متصفح آخر. تم إنهاء هذه الجلسة تلقائياً منعاً لتكرار نفس المستخدم.'
      });
    }

    const nowIso = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await run("UPDATE users SET last_heartbeat = ?, is_logged_in = 1 WHERE id = ?", [nowIso, user.id]);
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
    const user = await get('SELECT id, username, full_name, role, email, phone, status, permissions, is_logged_in, session_token FROM users WHERE id = ?', [decoded.id]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    if (user.status === 'inactive') {
      return res.status(403).json({ success: false, message: 'هذا الحساب معطل حالياً' });
    }

    // التحقق من تطابق معرف الجلسة
    if (decoded.sessionId && user.session_token && decoded.sessionId !== user.session_token) {
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

    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
        userId = userId || decoded.id;
        username = username || decoded.username;
      } catch {}
    }

    if (userId) {
      await run("UPDATE users SET is_logged_in = 0, session_token = NULL, last_heartbeat = NULL WHERE id = ?", [userId]);
    } else if (username) {
      await run("UPDATE users SET is_logged_in = 0, session_token = NULL, last_heartbeat = NULL WHERE LOWER(username) = LOWER(?)", [username]);
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

module.exports = router;
