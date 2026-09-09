const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { query, get, run } = require('../database/db');

// جلب المستخدمين والأدوار وحالة الاتصال الحية
router.get('/', (req, res) => {
  try {
    const ACTIVE_THRESHOLD_MS = 75 * 1000;
    const now = Date.now();

    const users = query(`
      SELECT u.id, u.username, u.full_name, u.role, u.email, u.phone, u.status, u.permissions, u.created_at,
             u.is_logged_in, u.last_heartbeat, u.last_login_at, u.last_login_ip, u.last_login_device,
             r.display_name as role_name
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      ORDER BY u.id ASC
    `);

    // Parse permissions & active status
    const parsedUsers = users.map(u => {
      let perms = [];
      if (u.permissions) {
        try {
          perms = typeof u.permissions === 'string' && (u.permissions.startsWith('[') || u.permissions.startsWith('{'))
            ? JSON.parse(u.permissions)
            : u.permissions.split(',').map(s => s.trim()).filter(Boolean);
        } catch (e) {
          perms = u.permissions.split(',').map(s => s.trim()).filter(Boolean);
        }
      }

      let isOnline = false;
      if (u.is_logged_in === 1 && u.last_heartbeat) {
        const diff = now - new Date(u.last_heartbeat).getTime();
        if (!isNaN(diff) && diff < ACTIVE_THRESHOLD_MS) {
          isOnline = true;
        }
      }

      return { 
        ...u, 
        permissions_list: perms,
        is_currently_online: isOnline
      };
    });

    const roles = query('SELECT * FROM roles ORDER BY id ASC');
    res.json({ success: true, data: parsedUsers, roles });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب المستخدمين', error: err.message });
  }
});

// إضافة مستخدم جديد مع الصلاحيات
router.post('/', (req, res) => {
  try {
    const { username, password, full_name, role_id, role, email, phone, status = 'active', permissions } = req.body;
    
    if (!username || !password || !full_name) {
      return res.status(400).json({ success: false, message: 'اسم المستخدم وكلمة المرور والاسم الكامل حقول مطلوبة' });
    }

    const cleanUsername = username.trim();
    const existing = get('SELECT id FROM users WHERE LOWER(username) = LOWER(?)', [cleanUsername]);
    if (existing) {
      return res.status(400).json({ success: false, message: `اسم المستخدم (${cleanUsername}) مسجل مسبقاً، يرجى اختيار اسم آخر.` });
    }

    const salt = bcrypt.genSaltSync(10);
    const password_hash = bcrypt.hashSync(password, salt);

    let roleName = role || 'accountant';
    let roleIdVal = role_id;
    if (role_id) {
      const roleObj = get('SELECT name FROM roles WHERE id = ?', [role_id]);
      if (roleObj) roleName = roleObj.name;
    } else if (role) {
      const roleObj = get('SELECT id FROM roles WHERE name = ?', [role]);
      if (roleObj) roleIdVal = roleObj.id;
    }

    const permsString = Array.isArray(permissions) ? JSON.stringify(permissions) : (permissions || '');

    const result = run(`
      INSERT INTO users (username, password_hash, full_name, role_id, role, email, phone, status, permissions)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [cleanUsername, password_hash, full_name.trim(), roleIdVal || 2, roleName, email || '', phone || '', status, permsString]);

    const insertedUser = get(`
      SELECT u.id, u.username, u.full_name, u.role, u.email, u.phone, u.status, u.permissions, u.created_at, r.display_name as role_name
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE u.id = ?
    `, [result.lastInsertRowid]);

    if (!insertedUser) {
      throw new Error('فشل التحقق من حفظ المستخدم في قاعدة البيانات');
    }

    res.json({
      success: true,
      message: `تم إضافة المستخدم (${insertedUser.full_name}) وتعيين صلاحياته بنجاح وتم التأكيد في قاعدة البيانات!`,
      data: insertedUser
    });
  } catch (err) {
    console.error('Error creating user:', err);
    res.status(500).json({ success: false, message: 'خطأ أثناء إنشاء المستخدم: ' + err.message });
  }
});

// تعديل بيانات وصلاحيات مستخدم
router.put('/:id', (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { username, password, full_name, role_id, role, email, phone, status, permissions } = req.body;

    const user = get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    // Check username uniqueness if changed
    if (username && username.trim().toLowerCase() !== user.username.toLowerCase()) {
      const dup = get('SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?', [username.trim(), userId]);
      if (dup) {
        return res.status(400).json({ success: false, message: `اسم المستخدم (${username}) مسجل لمستخدم آخر.` });
      }
    }

    let roleName = role || user.role;
    let roleIdVal = role_id !== undefined ? role_id : user.role_id;
    if (role_id) {
      const roleObj = get('SELECT name FROM roles WHERE id = ?', [role_id]);
      if (roleObj) roleName = roleObj.name;
    }

    const permsString = Array.isArray(permissions) ? JSON.stringify(permissions) : (permissions !== undefined ? permissions : user.permissions);

    if (password && password.trim().length > 0) {
      const salt = bcrypt.genSaltSync(10);
      const password_hash = bcrypt.hashSync(password, salt);
      run(`
        UPDATE users
        SET username = ?, password_hash = ?, full_name = ?, role_id = ?, role = ?, email = ?, phone = ?, status = ?, permissions = ?
        WHERE id = ?
      `, [
        username ? username.trim() : user.username,
        password_hash,
        full_name ? full_name.trim() : user.full_name,
        roleIdVal,
        roleName,
        email !== undefined ? email : user.email,
        phone !== undefined ? phone : user.phone,
        status || user.status,
        permsString,
        userId
      ]);
    } else {
      run(`
        UPDATE users
        SET username = ?, full_name = ?, role_id = ?, role = ?, email = ?, phone = ?, status = ?, permissions = ?
        WHERE id = ?
      `, [
        username ? username.trim() : user.username,
        full_name ? full_name.trim() : user.full_name,
        roleIdVal,
        roleName,
        email !== undefined ? email : user.email,
        phone !== undefined ? phone : user.phone,
        status || user.status,
        permsString,
        userId
      ]);
    }

    const updatedUser = get(`
      SELECT u.id, u.username, u.full_name, u.role, u.email, u.phone, u.status, u.permissions, u.created_at, r.display_name as role_name
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE u.id = ?
    `, [userId]);

    res.json({
      success: true,
      message: `تم تحديث بيانات وصلاحيات المستخدم (${updatedUser.full_name}) بنجاح!`,
      data: updatedUser
    });
  } catch (err) {
    console.error('Error updating user:', err);
    res.status(500).json({ success: false, message: 'خطأ أثناء تحديث المستخدم: ' + err.message });
  }
});

// تبديل حالة المستخدم (نشط / معطل)
router.patch('/:id/status', (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const user = get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    if (user.username === 'admin' && user.status === 'active') {
      return res.status(400).json({ success: false, message: 'لا يمكن تعطيل حساب المدير العام الرئيسي للنظام' });
    }

    const newStatus = user.status === 'active' ? 'inactive' : 'active';
    run('UPDATE users SET status = ? WHERE id = ?', [newStatus, userId]);

    const statusLabel = newStatus === 'active' ? 'تنشيط' : 'تعطيل';
    res.json({
      success: true,
      message: `تم ${statusLabel} حساب المستخدم (${user.full_name}) بنجاح.`,
      newStatus
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء تغيير حالة المستخدم', error: err.message });
  }
});

// حذف مستخدم
router.delete('/:id', (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const user = get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    if (user.username === 'admin' || user.id === 1) {
      return res.status(400).json({ success: false, message: 'لا يمكن حذف حساب المدير العام الرئيسي للنظام' });
    }

    run('DELETE FROM users WHERE id = ?', [userId]);
    res.json({
      success: true,
      message: `تم حذف المستخدم (${user.full_name}) بنجاح.`
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء حذف المستخدم', error: err.message });
  }
});

// إنهاء جلسة مستخدم وفصله عن النظام (Disconnect Active Session)
router.post('/:id/disconnect', (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const user = get('SELECT id, username, full_name FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    run("UPDATE users SET is_logged_in = 0, session_token = NULL, last_heartbeat = NULL WHERE id = ?", [userId]);
    res.json({
      success: true,
      message: `تم إنهاء جلسة المستخدم (${user.full_name || user.username}) وفصله عن النظام بنجاح.`
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء إنهاء جلسة المستخدم', error: err.message });
  }
});

module.exports = router;

