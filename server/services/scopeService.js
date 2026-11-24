'use strict';
// نطاق وصول المستخدم: «كل المؤسسة» أو منح محددة (فروع / أقسام / مشاريع / السجلات العامة بلا مشروع).
// يُحسب من القاعدة في كل طلب (requireAuth)، فتسري أي تغييرات فوراً، وتدخل المشاريع الجديدة في فرع أو قسم ممنوح تلقائياً.
// النتيجة تُوضع في req.user.scope.allowed_projects بالشكل الذي تستعمله الفلاتر الحالية ('*' أو مصفوفة أرقام).
const db = require('../database/db');

const TYPES = ['branch', 'department', 'project', 'general'];
const ALL = Object.freeze({ mode: 'all', all: true, general: true, projectIds: null, branchIds: [], departmentIds: [], explicitProjectIds: [] });

const toIds = list => [...new Set((Array.isArray(list) ? list : []).map(Number).filter(n => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);

function legacyIds(value) {
  if (value === null || value === undefined) return '*';
  if (Array.isArray(value)) return value.some(v => v === '*' || v === 'all') ? '*' : toIds(value);
  const text = String(value).trim();
  if (!text || text === '*' || text === 'all') return '*';
  try { const parsed = text.startsWith('[') ? JSON.parse(text) : text.split(','); return Array.isArray(parsed) ? legacyIds(parsed) : '*'; } catch { return '*'; }
}

/** مشاريع الفروع والأقسام الممنوحة (اتحاد) */
async function projectsOf(branchIds, departmentIds, dbh = db) {
  const parts = [], params = [];
  if (branchIds.length) { parts.push(`branch_id IN (${branchIds.map(() => '?').join(',')})`); params.push(...branchIds); }
  if (departmentIds.length) { parts.push(`department_id IN (${departmentIds.map(() => '?').join(',')})`); params.push(...departmentIds); }
  if (!parts.length) return [];
  return (await dbh.query(`SELECT id FROM projects WHERE ${parts.join(' OR ')}`, params)).map(r => Number(r.id));
}

/** يحسب النطاق من خطة ({mode, branches, departments, projects, general}) دون حفظ — للمعاينة والتحقق */
async function resolvePlan(plan, dbh = db) {
  if (!plan || plan.mode === 'all') return { ...ALL };
  const branchIds = toIds(plan.branches), departmentIds = toIds(plan.departments), explicitProjectIds = toIds(plan.projects);
  const ids = new Set(explicitProjectIds);
  for (const id of await projectsOf(branchIds, departmentIds, dbh)) ids.add(id);
  return { mode: 'limited', all: false, general: Boolean(plan.general), projectIds: [...ids].sort((a, b) => a - b), branchIds, departmentIds, explicitProjectIds };
}

async function loadPlan(userId, dbh = db) {
  const grants = await dbh.query('SELECT scope_type, scope_id FROM user_scope_grants WHERE user_id = ?', [userId]);
  const plan = { mode: 'limited', branches: [], departments: [], projects: [], general: false };
  for (const g of grants) {
    if (g.scope_type === 'branch') plan.branches.push(Number(g.scope_id));
    else if (g.scope_type === 'department') plan.departments.push(Number(g.scope_id));
    else if (g.scope_type === 'project') plan.projects.push(Number(g.scope_id));
    else if (g.scope_type === 'general') plan.general = true;
  }
  return plan;
}

/** النطاق الفعلي لمستخدم (صف users يحوي id و role و scope_mode و allowed_projects) */
async function resolveScope(user) {
  if (!user) return { ...ALL, mode: 'none', all: false, general: false, projectIds: [] };
  if (user.role === 'admin' || user.scope_mode === 'all') return { ...ALL };
  if (user.scope_mode === 'limited') return resolvePlan(await loadPlan(user.id));
  // حساب أُدخل خارج الواجهة ولم يُرحَّل: يُحترم allowed_projects القديم كما كان
  const legacy = legacyIds(user.allowed_projects);
  if (legacy === '*') return { ...ALL, mode: 'legacy' };
  return { mode: 'legacy', all: false, general: true, projectIds: legacy, branchIds: [], departmentIds: [], explicitProjectIds: legacy };
}

/** الشكل الذي توضع به النتيجة في req.user.scope (متوافق مع parseScopeArray والفلاتر الحالية) */
function toRequestScope(scope, user = {}) {
  return {
    mode: scope.mode,
    general: scope.general,
    allowed_projects: scope.all ? '*' : scope.projectIds,
    allowed_branches: '*',
    allowed_departments: '*',
    scope_branches: scope.branchIds || [],
    scope_departments: scope.departmentIds || [],
    branch_id: user.branch_id || 1,
    department_id: user.department_id || 1
  };
}

/** تحويل جسم الطلب إلى خطة نظيفة؛ يقبل الشكل الجديد scope أو allowed_projects القديم */
function planFromBody(body = {}) {
  if (body.scope && typeof body.scope === 'object') {
    const s = body.scope;
    if (s.mode === 'all') return { mode: 'all' };
    if (s.mode !== 'limited') return { error: 'نوع النطاق غير صالح (all أو limited).' };
    return { mode: 'limited', branches: toIds(s.branches), departments: toIds(s.departments), projects: toIds(s.projects), general: Boolean(s.general), allow_empty: Boolean(s.allow_empty) };
  }
  if (body.allowed_projects !== undefined) {
    const legacy = legacyIds(body.allowed_projects);
    if (legacy === '*') return { mode: 'all' };
    return { mode: 'limited', branches: [], departments: [], projects: legacy, general: legacy.length > 0, allow_empty: true };
  }
  return null;
}

/**
 * يتحقق أن المانح لا يمنح أوسع من نطاقه، وأن المراجع موجودة. يعيد { error, status } أو { resolved }.
 * المدير العام بلا حد. من نطاقه «كل المؤسسة» يمنح أي شيء.
 */
async function validatePlan(plan, granter) {
  if (plan.mode === 'limited') {
    const empty = !plan.branches.length && !plan.departments.length && !plan.projects.length && !plan.general;
    if (empty && !plan.allow_empty) return { status: 400, emptyScope: true, error: 'النطاق المحدد فارغ: لن يرى هذا المستخدم أي مشروع. أرسل allow_empty لتأكيد ذلك.' };
    const check = async (table, list, label) => {
      if (!list.length) return null;
      const found = await db.query(`SELECT id FROM ${table} WHERE id IN (${list.map(() => '?').join(',')})`, list);
      return found.length === list.length ? null : `بعض ${label} المحددة غير موجودة.`;
    };
    const missing = (await check('branches', plan.branches, 'الفروع')) || (await check('departments', plan.departments, 'الأقسام')) || (await check('projects', plan.projects, 'المشاريع'));
    if (missing) return { status: 400, error: missing };
  }
  const resolved = await resolvePlan(plan);
  if (granter && granter.role !== 'admin') {
    const own = granter.scopeResolved || await resolveScope(granter);
    if (!own.all) {
      const deny = { status: 403, error: '⛔ لا يمكنك منح نطاق أوسع من نطاقك.' };
      if (resolved.all) return deny;
      if (resolved.general && !own.general) return deny;
      const mine = new Set(own.projectIds);
      if (resolved.projectIds.some(id => !mine.has(id))) return deny;
      // الفرع/القسم الممنوح يشمل مشاريعه المستقبلية؛ لا يمنحه إلا من يملك الفرع/القسم نفسه
      if (plan.branches.some(b => !own.branchIds.includes(b)) || plan.departments.some(d => !own.departmentIds.includes(d))) return deny;
    }
  }
  return { resolved };
}

/** يحفظ الخطة: users.scope_mode + المنح + أعمدة allowed_* القديمة كملخص للتوافق */
async function savePlan(userId, plan, grantedBy) {
  await db.transaction(async tx => {
    await tx.run('DELETE FROM user_scope_grants WHERE user_id = ?', [userId]);
    if (plan.mode === 'all') {
      await tx.run("UPDATE users SET scope_mode = 'all', allowed_projects = '*', allowed_branches = '*', allowed_departments = '*' WHERE id = ?", [userId]);
      return;
    }
    const add = (type, id) => tx.run('INSERT OR IGNORE INTO user_scope_grants (user_id, scope_type, scope_id, granted_by) VALUES (?, ?, ?, ?)', [userId, type, id, grantedBy || null]);
    for (const id of plan.branches) await add('branch', id);
    for (const id of plan.departments) await add('department', id);
    for (const id of plan.projects) await add('project', id);
    if (plan.general) await add('general', 0);
    const resolved = await resolvePlan(plan, tx);
    await tx.run("UPDATE users SET scope_mode = 'limited', allowed_projects = ?, allowed_branches = ?, allowed_departments = ? WHERE id = ?",
      [JSON.stringify(resolved.projectIds), plan.branches.length ? JSON.stringify(plan.branches) : '*', plan.departments.length ? JSON.stringify(plan.departments) : '*', userId]);
  });
}

/** وصف مختصر للواجهة والتدقيق */
async function describe(userId) {
  const user = await db.get('SELECT id, role, scope_mode, allowed_projects FROM users WHERE id = ?', [userId]);
  if (!user) return null;
  const scope = await resolveScope(user);
  const plan = user.scope_mode === 'limited' ? await loadPlan(userId) : null;
  return {
    mode: scope.all ? 'all' : 'limited',
    legacy: scope.mode === 'legacy',
    branches: plan ? toIds(plan.branches) : [],
    departments: plan ? toIds(plan.departments) : [],
    projects: plan ? toIds(plan.projects) : (scope.all ? [] : scope.projectIds),
    general: scope.general,
    effective_project_count: scope.all ? null : scope.projectIds.length
  };
}

module.exports = { TYPES, resolveScope, resolvePlan, loadPlan, toRequestScope, planFromBody, validatePlan, savePlan, describe, legacyIds };
