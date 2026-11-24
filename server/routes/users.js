const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { query, get, run } = require('../database/db');
const { verifyAdmin, getSecuritySettings } = require('./auth');
const { requirePermission, revokeAllStaffSessions, hasUserPermission } = require('../middleware/security');
const scopeService = require('../services/scopeService');

// الصلاحيات المقبولة = مفاتيح الكتالوج الموحّد فقط (و'*' للمدير العام)؛ أي مفتاح آخر يُسقط ويُبلَّغ عنه
const catalog = require('../../js/system-catalog');
const KNOWN_PERMISSIONS = new Set(catalog.permissionKeys);
function normalizePermissions(value) {
  let list = [];
  if (Array.isArray(value)) list = value;
  else if (typeof value === 'string' && value.trim()) {
    try { const parsed = JSON.parse(value); list = Array.isArray(parsed) ? parsed : value.split(','); } catch { list = value.split(','); }
  }
  // الصيغ القديمة تُحوَّل لمفاتيح المصفوفة المكافئة (لا تُسقط صلاحية فعلية)، وما لا مقابل له يُسقط
  const expanded = catalog.expandLegacy(list);
  const dropped = list.map(p => String(p).trim()).filter(p => p && p !== '*' && p !== 'all' && !KNOWN_PERMISSIONS.has(p) && !catalog.expandLegacy([p]).length);
  return { list: expanded, dropped };
}

/** لا يمنح أحد غير المدير العام دور المدير العام أو '*' أو صلاحية لا يملكها هو، ولا يعدّل حساب مدير عام */
function escalationError(granter, { role, permissions, target }) {
  if (granter.role === 'admin') return null;
  if (target && (target.role === 'admin' || target.username === 'admin')) return '⛔ تعديل حساب المدير العام للمدير العام فقط.';
  if (role === 'admin') return '⛔ منح دور المدير العام للمدير العام فقط.';
  const effective = permissions && permissions.length ? permissions : (catalog.roles[role]?.permissions || []);
  if (effective.includes('*')) return '⛔ منح كل الصلاحيات (*) للمدير العام فقط.';
  const missing = effective.filter(p => !hasUserPermission(granter, p));
  return missing.length ? `⛔ لا يمكنك منح صلاحيات لا تملكها: ${missing.slice(0, 8).join('، ')}${missing.length > 8 ? '…' : ''}` : null;
}

// أسماء الفرع والقسم من جداولهما (للحقلين النصيين branch/department)، مع رفض رقم غير موجود
async function orgNames(branchId, departmentId) {
  const out = {};
  if (branchId) {
    const b = await get('SELECT name FROM branches WHERE id = ?', [branchId]);
    if (!b) return { error: 'الفرع المحدد غير موجود.' };
    out.branch = b.name;
  }
  if (departmentId) {
    const d = await get('SELECT name FROM departments WHERE id = ?', [departmentId]);
    if (!d) return { error: 'القسم المحدد غير موجود.' };
    out.department = d.name;
  }
  return out;
}

// يحفظ نطاق الوصول ويسجّل التغيير في التدقيق (قبل/بعد)
async function saveScopeAudited(req, userId, plan, before) {
  await scopeService.savePlan(userId, plan, req.user?.id);
  const after = await scopeService.describe(userId);
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    await require('../services/auditService').logAudit(req, {
      action: 'USER_SCOPE_CHANGE', entity_type: 'user', entity_id: userId,
      old_values: before, new_values: after
    });
  }
  return after;
}

// أي تعديل على حساب مدير عام (حالة، حذف، فصل، فك قفل، نطاق، أمان...) للمدير العام فقط
router.param('id', async (req, res, next, id) => {
  try {
    if (req.user?.role === 'admin' || req.method === 'GET') return next();
    const target = await get('SELECT role, username FROM users WHERE id = ?', [id]);
    if (target && (target.role === 'admin' || target.username === 'admin')) {
      return res.status(403).json({ success: false, message: '⛔ تعديل حساب المدير العام للمدير العام فقط.' });
    }
    next();
  } catch (err) { next(err); }
});

// نطاق وصول مستخدم: الخطة المحفوظة + عدد المشاريع الفعلية
router.get('/:id/scope', requirePermission('settings:users'), async (req, res) => {
  try {
    const scope = await scopeService.describe(Number.parseInt(req.params.id, 10));
    if (!scope) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    res.json({ success: true, data: scope });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب نطاق المستخدم' });
  }
});

// تعديل نطاق الوصول وحده: { mode: 'all' | 'limited', branches, departments, projects, general, allow_empty }
router.put('/:id/scope', requirePermission('settings:users'), async (req, res) => {
  try {
    const userId = Number.parseInt(req.params.id, 10);
    const before = await scopeService.describe(userId);
    if (!before) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    const plan = scopeService.planFromBody({ scope: req.body || {} });
    if (!plan || plan.error) return res.status(400).json({ success: false, message: plan?.error || 'نطاق غير صالح' });
    const check = await scopeService.validatePlan(plan, req.user);
    if (check.error) return res.status(check.status).json({ success: false, emptyScope: check.emptyScope, message: check.error });
    const after = await saveScopeAudited(req, userId, plan, before);
    res.json({ success: true, message: 'تم حفظ نطاق الوصول.', data: after });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في حفظ نطاق المستخدم' });
  }
});

// معاينة حية: كم مشروعاً سيصل إليه المستخدم بهذه الخطة، وعبر أي منح
router.post('/scope-preview', requirePermission('settings:users'), async (req, res) => {
  try {
    const plan = scopeService.planFromBody({ scope: req.body || {} });
    if (!plan || plan.error) return res.status(400).json({ success: false, message: plan?.error || 'نطاق غير صالح' });
    const resolved = await scopeService.resolvePlan(plan);
    if (resolved.all) return res.json({ success: true, data: { all: true, general: true, project_count: null, projects: [] } });
    const ids = resolved.projectIds;
    const rows = ids.length ? await query(`SELECT id, name, branch_id, department_id FROM projects WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY name`, ids) : [];
    const projects = rows.map(p => ({
      id: p.id, name: p.name,
      via: plan.projects.includes(Number(p.id)) ? 'project' : plan.branches.includes(Number(p.branch_id)) ? 'branch' : 'department'
    }));
    res.json({ success: true, data: { all: false, general: resolved.general, project_count: projects.length, projects } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في معاينة النطاق' });
  }
});

// جلب بيانات الفروع والأقسام والمشاريع لنطاق الصلاحيات
router.get('/scopes-meta', requirePermission('settings:users'), async (req, res) => {
  try {
    const branches = await query("SELECT id, code, name FROM branches WHERE status = 'active' ORDER BY id ASC");
    const departments = await query("SELECT id, code, name FROM departments WHERE status = 'active' ORDER BY id ASC");
    const projects = await query('SELECT id, code, name, status FROM projects ORDER BY id ASC');
    const roles = await query('SELECT id, name, display_name FROM roles ORDER BY id ASC');
    res.json({ success: true, branches, departments, projects, roles });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب بيانات النطاقات: ' + err.message });
  }
});

// جلب المستخدمين والأدوار وحالة الاتصال الحية
router.get('/', requirePermission('settings:users'), async (req, res) => {
  try {
    const ACTIVE_THRESHOLD_MS = 75 * 1000;
    const now = Date.now();

    const users = await query(`
      SELECT u.id, u.username, u.full_name, u.role, u.email, u.phone, u.status, u.permissions, u.security_settings, u.two_factor_pin, u.two_factor_enabled, u.created_at, u.login_locked_until,
             u.branch_id, u.branch, u.department_id, u.department, u.allowed_projects, u.allowed_branches, u.allowed_departments,
             u.is_logged_in, u.last_heartbeat, u.last_login_at, u.last_login_ip, u.last_login_device,
             r.display_name as role_name
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      ORDER BY u.id ASC
    `);

    // Parse permissions & active status & security_settings
    const parsedUsers = (users || []).map(u => {
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

      let secSettings = null;
      if (u.security_settings) {
        try {
          secSettings = typeof u.security_settings === 'string'
            ? JSON.parse(u.security_settings)
            : u.security_settings;
        } catch (e) {}
      }

      let allowedPrjs = '*';
      if (u.allowed_projects) {
        try {
          allowedPrjs = typeof u.allowed_projects === 'string' && (u.allowed_projects.startsWith('[') || u.allowed_projects.startsWith('{'))
            ? JSON.parse(u.allowed_projects)
            : u.allowed_projects;
        } catch (e) {
          allowedPrjs = u.allowed_projects;
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
        // Never return a secret PIN in a user-management response.  The UI only
        // needs to know whether one exists; exposing or substituting a default
        // PIN caused edits to overwrite a valid configuration in production.
        two_factor_pin: '',
        two_factor_configured: Boolean(u.two_factor_pin),
        login_locked: Boolean(u.login_locked_until && new Date(u.login_locked_until).getTime() > Date.now()),
        failed_login_count: undefined,
        login_locked_until: undefined,
        two_factor_enabled: u.two_factor_enabled !== undefined && u.two_factor_enabled !== null ? u.two_factor_enabled : 1,
        branch_id: u.branch_id || 1,
        branch: u.branch || 'المركز الرئيسي',
        department_id: u.department_id || 1,
        department: u.department || 'الإدارة العامة',
        allowed_projects: allowedPrjs,
        allowed_branches: u.allowed_branches || '*',
        allowed_departments: u.allowed_departments || '*',
        permissions_list: perms,
        security_settings: secSettings,
        is_currently_online: isOnline
      };
    });

    // ملخص نطاق الوصول لكل مستخدم (للعمود «النطاق» في الجدول)
    for (const u of parsedUsers) u.scope = await scopeService.describe(u.id);

    const roles = await query('SELECT * FROM roles ORDER BY id ASC');
    res.json({ success: true, data: parsedUsers, roles });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب المستخدمين', error: err.message });
  }
});

// إضافة مستخدم جديد مع الصلاحيات
router.post('/', requirePermission('settings:users'), async (req, res) => {
  try {
    if (typeof req.body.password !== 'string' || req.body.password.length < 8 || req.body.password !== req.body.password_confirm) return res.status(400).json({success:false,message:'كلمة المرور يجب أن تكون 8 خانات على الأقل ومطابقة للتأكيد'});
    const { 
      username, password, full_name, role_id, role, email, phone, status = 'active', 
      permissions, security_settings, two_factor_pin, two_factor_enabled,
      branch_id, branch, department_id, department, allowed_projects, allowed_branches, allowed_departments
    } = req.body;
    
    if (!username || !password || !full_name) {
      return res.status(400).json({ success: false, message: 'اسم المستخدم وكلمة المرور والاسم الكامل حقول مطلوبة' });
    }

    const cleanUsername = username.trim();
    const existing = await get('SELECT id FROM users WHERE LOWER(username) = LOWER(?)', [cleanUsername]);
    if (existing) {
      return res.status(400).json({ success: false, message: `اسم المستخدم (${cleanUsername}) مسجل مسبقاً، يرجى اختيار اسم آخر.` });
    }

    const salt = bcrypt.genSaltSync(10);
    const password_hash = bcrypt.hashSync(password, salt);

    let roleName = role || 'accountant';
    let roleIdVal = role_id;
    if (role_id) {
      const roleObj = await get('SELECT name FROM roles WHERE id = ?', [role_id]);
      if (roleObj) roleName = roleObj.name;
    } else if (role) {
      const roleObj = await get('SELECT id FROM roles WHERE name = ?', [role]);
      if (roleObj) roleIdVal = roleObj.id;
    }

    const permsNorm = normalizePermissions(permissions);
    const escalation = escalationError(req.user, { role: roleName, permissions: permsNorm.list });
    if (escalation) return res.status(403).json({ success: false, message: escalation });
    const permsString = permissions === undefined || permissions === null || permissions === '' ? '' : JSON.stringify(permsNorm.list);
    const secString = security_settings ? (typeof security_settings === 'string' ? security_settings : JSON.stringify(security_settings)) : null;

    const allowedProjectsStr = Array.isArray(allowed_projects) 
      ? JSON.stringify(allowed_projects) 
      : (allowed_projects || '*');
    const allowedBranchesStr = Array.isArray(allowed_branches) 
      ? JSON.stringify(allowed_branches) 
      : (allowed_branches || '*');
    const allowedDepartmentsStr = Array.isArray(allowed_departments) 
      ? JSON.stringify(allowed_departments) 
      : (allowed_departments || '*');

    const cleanPin = two_factor_pin !== undefined ? String(two_factor_pin).replace(/\D/g, '') : '';
    const tfaEnabled = two_factor_enabled !== undefined ? (two_factor_enabled ? 1 : 0) : 1;
    if (tfaEnabled && !/^\d{6}$/.test(cleanPin)) {
      return res.status(400).json({ success: false, message: 'يتطلب التحقق بخطوتين رمز PIN خاصاً من 6 أرقام.' });
    }

    // نطاق الوصول: بلا scope ولا allowed_projects = «كل المؤسسة» كما كان سابقاً، ويخضع لقاعدة عدم منح أوسع من نطاق المانح
    // الفرع الأساسي لمستخدم جديد: المدير العام يختار أي فرع؛ غيره يُنشئ في فرعه هو فقط
    if (branch_id && req.user.role !== 'admin' && Number(branch_id) !== Number(req.user.branch_id || 0)) {
      return res.status(403).json({ success: false, message: '⛔ تعيين الفرع الأساسي لفرع آخر للمدير العام فقط.' });
    }
    const orgCreate = await orgNames(branch_id, department_id);
    if (orgCreate.error) return res.status(400).json({ success: false, message: orgCreate.error });

    const scopePlan = scopeService.planFromBody(req.body) || { mode: 'all' };
    if (scopePlan.error) return res.status(400).json({ success: false, message: scopePlan.error });
    const scopeCheck = await scopeService.validatePlan(scopePlan, req.user);
    if (scopeCheck.error) return res.status(scopeCheck.status).json({ success: false, emptyScope: scopeCheck.emptyScope, message: scopeCheck.error });

    const result = await run(`
      INSERT INTO users (
        username, password_hash, full_name, role_id, role, email, phone, status, 
        permissions, security_settings, two_factor_pin, two_factor_enabled,
        branch_id, branch, department_id, department, allowed_projects, allowed_branches, allowed_departments
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      cleanUsername, password_hash, full_name.trim(), roleIdVal || null, roleName, email || '', phone || '', status,
      permsString, secString, cleanPin, tfaEnabled,
      branch_id || 1, orgCreate.branch || branch || 'المركز الرئيسي', department_id || 1, orgCreate.department || department || 'الإدارة العامة',
      allowedProjectsStr, allowedBranchesStr, allowedDepartmentsStr
    ]);

    if (cleanUsername === 'admin') {
      try {
        await run("INSERT OR REPLACE INTO settings (`key`, `value`) VALUES ('admin_2fa_pin', ?)", [cleanPin]);
        await run("INSERT OR REPLACE INTO settings (`key`, `value`) VALUES ('admin_2fa_enabled', ?)", [String(tfaEnabled)]);
      } catch (e) {}
    }

    const newId = result.insertId || result.lastInsertRowid;
    await saveScopeAudited(req, Number(newId), scopePlan, null);
    const insertedUser = await get(`
      SELECT u.id, u.username, u.full_name, u.role, u.email, u.phone, u.status, u.permissions, u.security_settings, u.two_factor_pin, u.two_factor_enabled, u.created_at,
             u.branch_id, u.branch, u.department_id, u.department, u.allowed_projects, u.allowed_branches, u.allowed_departments,
             r.display_name as role_name
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE u.id = ?
    `, [newId]);

    if (!insertedUser) {
      throw new Error('فشل التحقق من حفظ المستخدم في قاعدة البيانات');
    }

    await require('../services/auditService').logAudit(req, {
      action: 'USER_CREATED', entity_type: 'user', entity_id: newId,
      details: { target: insertedUser.username, role: insertedUser.role }
    });
    const { two_factor_pin: _newPin, ...safeInserted } = insertedUser;
    res.json({
      success: true,
      message: `تم إضافة المستخدم (${insertedUser.full_name}) وتعيين صلاحياته ونطاقه بنجاح!`,
      data: { ...safeInserted, two_factor_pin: '', two_factor_configured: Boolean(_newPin) }
    });
  } catch (err) {
    console.error('Error creating user:', err);
    res.status(500).json({ success: false, message: 'خطأ أثناء إنشاء المستخدم: ' + err.message });
  }
});

// تعديل بيانات وصلاحيات مستخدم
router.put('/:id', requirePermission('settings:users'), async (req, res) => {
  try {
    if ((req.body.password || req.body.password_confirm) && (typeof req.body.password !== 'string' || req.body.password.length < 8 || req.body.password !== req.body.password_confirm)) return res.status(400).json({success:false,message:'كلمة المرور الجديدة يجب أن تكون 8 خانات على الأقل ومطابقة للتأكيد'});
    const userId = parseInt(req.params.id);
    const { 
      username, password, full_name, role_id, role, email, phone, status, 
      permissions, security_settings, two_factor_pin, two_factor_enabled,
      branch_id, branch, department_id, department, allowed_projects, allowed_branches, allowed_departments
    } = req.body;

    const user = await get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    // Check username uniqueness if changed
    if (username && username.trim().toLowerCase() !== user.username.toLowerCase()) {
      const dup = await get('SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?', [username.trim(), userId]);
      if (dup) {
        return res.status(400).json({ success: false, message: `اسم المستخدم (${username}) مسجل لمستخدم آخر.` });
      }
    }

    let roleName = role || user.role;
    let roleIdVal = role_id !== undefined ? role_id : user.role_id;
    if(role && !role_id)roleIdVal=(await get('SELECT id FROM roles WHERE name=?',[role]))?.id || null;
    if (role_id) {
      const roleObj = await get('SELECT name FROM roles WHERE id = ?', [role_id]);
      if (roleObj) roleName = roleObj.name;
    }

    const permsNorm = permissions !== undefined ? normalizePermissions(permissions) : null;
    const roleChanged = roleName !== user.role;
    if (permsNorm || roleChanged || req.user.role !== 'admin') {
      const escalation = escalationError(req.user, { role: roleName, permissions: permsNorm ? permsNorm.list : normalizePermissions(user.permissions).list, target: user });
      if (escalation) return res.status(403).json({ success: false, message: escalation });
    }
    const permsString = permsNorm ? JSON.stringify(permsNorm.list) : user.permissions;

    const secString = security_settings !== undefined
      ? (security_settings ? (typeof security_settings === 'string' ? security_settings : JSON.stringify(security_settings)) : null)
      : user.security_settings;

    const allowedProjectsStr = allowed_projects !== undefined 
      ? (Array.isArray(allowed_projects) ? JSON.stringify(allowed_projects) : allowed_projects)
      : user.allowed_projects;
    const allowedBranchesStr = allowed_branches !== undefined
      ? (Array.isArray(allowed_branches) ? JSON.stringify(allowed_branches) : allowed_branches)
      : user.allowed_branches;
    const allowedDepartmentsStr = allowed_departments !== undefined
      ? (Array.isArray(allowed_departments) ? JSON.stringify(allowed_departments) : allowed_departments)
      : user.allowed_departments;

    // الفرع الأساسي يغيّره المدير العام فقط؛ والاسم النصي يتبع الفرع/القسم المختار
    if (branch_id !== undefined && req.user.role !== 'admin' && Number(branch_id || 0) !== Number(user.branch_id || 0)) {
      return res.status(403).json({ success: false, message: '⛔ تغيير الفرع الأساسي للمستخدم للمدير العام فقط.' });
    }
    const org = await orgNames(branch_id, department_id);
    if (org.error) return res.status(400).json({ success: false, message: org.error });
    const branchIdVal = branch_id !== undefined ? branch_id : (user.branch_id || 1);
    const branchVal = branch_id !== undefined && org.branch ? org.branch : (branch !== undefined ? branch : (user.branch || 'المركز الرئيسي'));
    const deptIdVal = department_id !== undefined ? department_id : (user.department_id || 1);
    const deptVal = department_id !== undefined && org.department ? org.department : (department !== undefined ? department : (user.department || 'الإدارة العامة'));

    // A blank PIN on edit means "keep the existing PIN".  It must never be
    // silently converted to a public default.
    const submittedPin = two_factor_pin === undefined ? '' : String(two_factor_pin).replace(/\D/g, '');
    if (submittedPin && !/^\d{6}$/.test(submittedPin)) {
      return res.status(400).json({ success: false, message: 'رمز PIN يجب أن يتكون من 6 أرقام.' });
    }
    const cleanPin = submittedPin || user.two_factor_pin || '';
    const tfaEnabled = two_factor_enabled !== undefined 
      ? (two_factor_enabled ? 1 : 0) 
      : (user.two_factor_enabled !== undefined && user.two_factor_enabled !== null ? user.two_factor_enabled : 1);
    if (tfaEnabled && !/^\d{6}$/.test(cleanPin)) {
      return res.status(400).json({ success: false, message: 'لا يمكن تفعيل التحقق بخطوتين قبل تعيين رمز PIN خاص من 6 أرقام.' });
    }

    // نطاق الوصول (scope الجديد أو allowed_projects القديم): يُتحقق منه قبل أي حفظ
    const scopePlan = scopeService.planFromBody(req.body);
    if (scopePlan?.error) return res.status(400).json({ success: false, message: scopePlan.error });
    const scopeBefore = scopePlan ? await scopeService.describe(userId) : null;
    if (scopePlan) {
      const check = await scopeService.validatePlan(scopePlan, req.user);
      if (check.error) return res.status(check.status).json({ success: false, emptyScope: check.emptyScope, message: check.error });
    }

    if (password && password.trim().length > 0) {
      const salt = bcrypt.genSaltSync(10);
      const password_hash = bcrypt.hashSync(password, salt);
      await run(`
        UPDATE users
        SET username = ?, password_hash = ?, full_name = ?, role_id = ?, role = ?, email = ?, phone = ?, status = ?, 
            permissions = ?, security_settings = ?, two_factor_pin = ?, two_factor_enabled = ?,
            branch_id = ?, branch = ?, department_id = ?, department = ?, 
            allowed_projects = ?, allowed_branches = ?, allowed_departments = ?,
            failed_login_count = 0, login_locked_until = NULL, password_changed_at = CURRENT_TIMESTAMP
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
        secString,
        cleanPin,
        tfaEnabled,
        branchIdVal,
        branchVal,
        deptIdVal,
        deptVal,
        allowedProjectsStr,
        allowedBranchesStr,
        allowedDepartmentsStr,
        userId
      ]);
      // تغيير كلمة المرور ينهي كل جلسات الحساب المفتوحة (ويُبقي جلسة المدير الحالية إن غيّر كلمته بنفسه)
      await revokeAllStaffSessions(userId, { keepSessionId: Number(req.user.id) === Number(userId) ? (req.user.sessionId || null) : null });
    } else {
      await run(`
        UPDATE users
        SET username = ?, full_name = ?, role_id = ?, role = ?, email = ?, phone = ?, status = ?, 
            permissions = ?, security_settings = ?, two_factor_pin = ?, two_factor_enabled = ?,
            branch_id = ?, branch = ?, department_id = ?, department = ?, 
            allowed_projects = ?, allowed_branches = ?, allowed_departments = ?
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
        secString,
        cleanPin,
        tfaEnabled,
        branchIdVal,
        branchVal,
        deptIdVal,
        deptVal,
        allowedProjectsStr,
        allowedBranchesStr,
        allowedDepartmentsStr,
        userId
      ]);
    }

    if (user.username === 'admin' || user.id === 1 || (username && username.trim().toLowerCase() === 'admin')) {
      try {
        await run("INSERT OR REPLACE INTO settings (`key`, `value`) VALUES ('admin_2fa_pin', ?)", [cleanPin]);
        await run("INSERT OR REPLACE INTO settings (`key`, `value`) VALUES ('admin_2fa_enabled', ?)", [String(tfaEnabled)]);
      } catch (e) {}
    }

    if (scopePlan) await saveScopeAudited(req, userId, scopePlan, scopeBefore);

    const updatedUser = await get(`
      SELECT u.id, u.username, u.full_name, u.role, u.email, u.phone, u.status, u.permissions, u.security_settings, u.two_factor_pin, u.two_factor_enabled, u.created_at,
             u.branch_id, u.branch, u.department_id, u.department, u.allowed_projects, u.allowed_branches, u.allowed_departments,
             r.display_name as role_name
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE u.id = ?
    `, [userId]);

    // سجل تدقيق: ما الذي تغيّر في الحساب (بدون أي قيم سرية)
    const changed = [];
    if ((updatedUser.role || '') !== (user.role || '')) changed.push('role');
    if ((updatedUser.permissions || '') !== (user.permissions || '')) changed.push('permissions');
    if ((updatedUser.status || '') !== (user.status || '')) changed.push('status');
    if (password && password.trim().length > 0) changed.push('password_reset');
    if ((updatedUser.two_factor_pin || '') !== (user.two_factor_pin || '')) changed.push('2fa_pin');
    if (String(updatedUser.two_factor_enabled) !== String(user.two_factor_enabled)) changed.push('2fa_enabled');
    if ((updatedUser.allowed_projects || '') !== (user.allowed_projects || '')) changed.push('allowed_projects');
    if (changed.length) {
      await require('../services/auditService').logAudit(req, {
        action: 'USER_SECURITY_CHANGE', entity_type: 'user', entity_id: userId,
        details: { target: updatedUser.username, changed },
        old_values: { role: user.role, status: user.status, permissions: user.permissions },
        new_values: { role: updatedUser.role, status: updatedUser.status, permissions: updatedUser.permissions }
      });
    }

    const { two_factor_pin: _hiddenPin, ...safeUser } = updatedUser;
    res.json({
      success: true,
      message: `تم تحديث بيانات وصلاحيات ونطاق المستخدم (${updatedUser.full_name}) بنجاح!`,
      data: { ...safeUser, two_factor_pin: '', two_factor_configured: Boolean(_hiddenPin) }
    });
  } catch (err) {
    console.error('Error updating user:', err);
    res.status(500).json({ success: false, message: 'خطأ أثناء تحديث المستخدم: ' + err.message });
  }
});

// تبديل حالة المستخدم (نشط / معطل)
router.patch('/:id/status', requirePermission('settings:users'), async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const user = await get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    if (user.username === 'admin' && user.status === 'active') {
      return res.status(400).json({ success: false, message: 'لا يمكن تعطيل حساب المدير العام الرئيسي للنظام' });
    }

    const newStatus = user.status === 'active' ? 'inactive' : 'active';
    await run('UPDATE users SET status = ? WHERE id = ?', [newStatus, userId]);
    await require('../services/auditService').logAudit(req, {
      action: 'USER_SECURITY_CHANGE', entity_type: 'user', entity_id: userId,
      details: { target: user.username, changed: ['status'] }, old_values: { status: user.status }, new_values: { status: newStatus }
    });

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
router.delete('/:id', requirePermission('settings:users'), async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const user = await get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    if (user.username === 'admin' || user.id === 1) {
      return res.status(400).json({ success: false, message: 'لا يمكن حذف حساب المدير العام الرئيسي للنظام' });
    }

    await run('DELETE FROM users WHERE id = ?', [userId]);
    res.json({
      success: true,
      message: `تم حذف المستخدم (${user.full_name}) بنجاح.`
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء حذف المستخدم', error: err.message });
  }
});

// فك قفل الدخول المؤقت عن حساب موظف بعد محاولات خاطئة متكررة
router.post('/:id/unlock-login', requirePermission('settings:users'), async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const user = await get('SELECT id, username, full_name FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    await run('UPDATE users SET failed_login_count = 0, login_locked_until = NULL WHERE id = ?', [userId]);
    require('../middleware/security').clearLoginAttemptsFor(user.username);
    await require('../services/auditService').logAudit(req, { action: 'ACCOUNT_UNLOCKED', entity_type: 'user', entity_id: userId, details: { target: user.username } });
    res.json({ success: true, message: `تم فك قفل الدخول عن حساب (${user.full_name || user.username}).` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'تعذر فك قفل الحساب' });
  }
});

// إنهاء جلسة مستخدم وفصله عن النظام (Disconnect Active Session)
router.post('/:id/disconnect', requirePermission('settings:users'), async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const user = await get('SELECT id, username, full_name FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    // تفريغ active_sessions أيضاً، وإلا يظل requireAuth يقبل الجلسة المسجّلة فيها
    await revokeAllStaffSessions(userId);
    res.json({
      success: true,
      message: `تم إنهاء جلسة المستخدم (${user.full_name || user.username}) وفصله عن النظام بنجاح.`
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء إنهاء جلسة المستخدم', error: err.message });
  }
});
// جلب إعدادات الأمان وسياسة الجلسات المخصصة لمستخدم محدد
router.get('/:id/security-settings', requirePermission('settings:users'), async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const user = await get('SELECT id, username, full_name, role, security_settings FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    const defaultSettings = await getSecuritySettings();
    let userCustom = null;
    let isCustom = false;

    if (user.security_settings) {
      try {
        userCustom = typeof user.security_settings === 'string'
          ? JSON.parse(user.security_settings)
          : user.security_settings;
        isCustom = !!(userCustom && typeof userCustom === 'object');
      } catch {}
    }

    const effectiveSettings = Object.assign({}, defaultSettings, userCustom || {});

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role
      },
      isCustom,
      settings: effectiveSettings,
      defaultSettings
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب إعدادات أمان المستخدم: ' + err.message });
  }
});

// حفظ أو إعادة ضبط إعدادات الأمان والجلسات لمستخدم محدد (مقتصرة حصرياً على حساب المدير العام)
router.post('/:id/security-settings', verifyAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const user = await get('SELECT id, username, full_name, role FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    const { session_mode, session_device_limit, session_overflow_action, jwt_token_expiry, jwt_custom_minutes, work_start_time, work_end_time, work_hours_enabled, reset_to_default } = req.body || {};

    if (reset_to_default) {
      await run('UPDATE users SET security_settings = NULL WHERE id = ?', [userId]);
      const defaults = await getSecuritySettings();
      return res.json({
        success: true,
        message: `تمت استعادة الإعدادات العامة الافتراضية للنظام للمستخدم (${user.full_name}) بنجاح 🛡️`,
        isCustom: false,
        settings: defaults
      });
    }

    const validModes = ['multi', 'single'];
    const validOverflow = ['kick_oldest', 'block_new', 'lock_device'];
    const validExpiries = ['1h', '4h', '8h', '24h', '7d', '30d', 'custom'];

    let existingSec = {};
    const fullUser = await get('SELECT security_settings FROM users WHERE id = ?', [userId]);
    if (fullUser && fullUser.security_settings) {
      try { existingSec = JSON.parse(fullUser.security_settings); } catch (e) {}
    }
    const userSec = Object.assign({}, existingSec);

    if (req.body.reset_authorized_device) {
      delete userSec.authorized_device_id;
      delete userSec.authorized_device_name;
      delete userSec.authorized_device_at;
    }

    if (session_mode && validModes.includes(session_mode)) {
      userSec.session_mode = session_mode;
    }
    if (session_device_limit) {
      userSec.session_device_limit = Number(session_device_limit) || 1;
    }
    if (session_overflow_action && validOverflow.includes(session_overflow_action)) {
      userSec.session_overflow_action = session_overflow_action;
      if (session_overflow_action === 'lock_device') {
        userSec.session_mode = 'single';
        userSec.session_device_limit = 1;
      }
    }
    if (jwt_token_expiry && validExpiries.includes(jwt_token_expiry)) {
      userSec.jwt_token_expiry = jwt_token_expiry;
    }
    if (jwt_custom_minutes && Number(jwt_custom_minutes) > 0) {
      userSec.jwt_custom_minutes = Number(jwt_custom_minutes);
    }
    if (work_start_time) {
      userSec.work_start_time = String(work_start_time);
    }
    if (work_end_time) {
      userSec.work_end_time = String(work_end_time);
    }
    if (work_hours_enabled !== undefined) {
      userSec.work_hours_enabled = !!work_hours_enabled;
    }

    const secJson = JSON.stringify(userSec);
    await run('UPDATE users SET security_settings = ? WHERE id = ?', [secJson, userId]);

    const effectiveSettings = await getSecuritySettings({ security_settings: secJson });

    res.json({
      success: true,
      message: `تم حفظ وتطبيق خيارات الأمان وسياسة الجلسات المخصصة للمستخدم (${user.full_name}) بنجاح 🛡️`,
      isCustom: true,
      settings: effectiveSettings
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في حفظ إعدادات أمان المستخدم: ' + err.message });
  }
});

// فك قفل الجهاز المعتمد لمستخدم محدد (حصرياً للمدير العام)
router.post('/:id/reset-device', verifyAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const user = await get('SELECT id, username, full_name, security_settings FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });

    let sec = {};
    if (user.security_settings) {
      try { sec = JSON.parse(user.security_settings); } catch (e) {}
    }
    delete sec.authorized_device_id;
    delete sec.authorized_device_name;
    delete sec.authorized_device_at;

    await run('UPDATE users SET security_settings = ? WHERE id = ?', [JSON.stringify(sec), userId]);
    res.json({
      success: true,
      message: `تم فك قفل الجهاز للمستخدم (${user.full_name || user.username}) بنجاح. سيتم اعتماد أول جهاز جديد يسجل منه.`
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ: ' + err.message });
  }
});

module.exports = router;

