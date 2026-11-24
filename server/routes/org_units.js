'use strict';
// إدارة الفروع والأقسام (نطاق الوصول): المدير العام وحده يضيف ويعدّل ويحذف.
// الحذف ممنوع ما دام للفرع/القسم أي مشروع أو موظف أو منح نطاق أو حركة مالية، مع رسالة تفصّل السبب.
// عند وجود حركة مالية يُسمح بتعديل الاسم فقط.
const express = require('express');
const { get, query, run } = require('../database/db');
const { logAudit } = require('../services/auditService');

const router = express.Router();

router.use((req, res, next) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ success: false, message: '⛔ إدارة الفروع والأقسام للمدير العام فقط.' });
  next();
});

const KINDS = {
  branches: { table: 'branches', projectColumn: 'branch_id', userColumn: 'branch_id', grantType: 'branch', label: 'الفرع', extra: 'address' },
  departments: { table: 'departments', projectColumn: 'department_id', userColumn: 'department_id', grantType: 'department', label: 'القسم', extra: 'manager_name' }
};

// جداول الحركات المالية المرتبطة بمشروع (تُفحص فقط إن وُجد الجدول والعمود)
const FINANCIAL_TABLES = [
  ['journal_entry_lines', 'سطر قيد'], ['expenses', 'مصروف'], ['payments', 'سند'], ['payment_transactions', 'حركة دفع'],
  ['bills', 'مستخلص'], ['project_invoices', 'فاتورة'], ['purchases', 'مشتريات'], ['purchase_orders', 'أمر شراء'],
  ['project_purchases', 'مشتريات مشروع'], ['project_labor_expenses', 'أجور عمالة'], ['cheques', 'شيك'],
  ['cash_movements', 'حركة صندوق'], ['inventory_transactions', 'حركة مخزون'], ['goods_receipt_notes', 'سند استلام'],
  ['tax_withholdings', 'استقطاع ضريبي'], ['contract_revenue_recognitions', 'إثبات إيراد'], ['bank_guarantees', 'ضمان بنكي'],
  ['project_final_settlements', 'تسوية ختامية']
];
const columnCache = new Map();
async function hasColumn(table, column) {
  const key = table + '.' + column;
  if (!columnCache.has(key)) columnCache.set(key, (await query(`PRAGMA table_info(${table})`)).some(c => c.name === column));
  return columnCache.get(key);
}

/** استخدام الوحدة: المشاريع، الموظفون، منح النطاق، والحركات المالية في مشاريعها */
async function usageOf(kind, id) {
  const k = KINDS[kind];
  const projects = await query(`SELECT id, name FROM projects WHERE ${k.projectColumn} = ? ORDER BY id`, [id]);
  const users = Number((await get(`SELECT COUNT(*) AS n FROM users WHERE ${k.userColumn} = ?`, [id]))?.n || 0);
  const grants = Number((await get('SELECT COUNT(*) AS n FROM user_scope_grants WHERE scope_type = ? AND scope_id = ?', [k.grantType, id]))?.n || 0);
  const financial = [];
  if (projects.length) {
    const ids = projects.map(p => p.id), ph = ids.map(() => '?').join(',');
    for (const [table, label] of FINANCIAL_TABLES) {
      if (!(await hasColumn(table, 'project_id'))) continue;
      const n = Number((await get(`SELECT COUNT(*) AS n FROM ${table} WHERE project_id IN (${ph})`, ids))?.n || 0);
      if (n) financial.push({ table, label, count: n });
    }
  }
  const financialCount = financial.reduce((s, f) => s + f.count, 0);
  return { projects: projects.length, projectNames: projects.slice(0, 5).map(p => p.name), users, grants, financial, financialCount, inUse: Boolean(projects.length || users || grants || financialCount) };
}

function usageMessage(k, unit, u) {
  const lines = [`⛔ لا يمكن حذف ${k.label} «${unit.name}» لأنه قيد العمل:`];
  if (u.projects) lines.push(`• لديه ${u.projects} مشروع${u.projectNames.length ? ' (منها: ' + u.projectNames.join('، ') + (u.projects > u.projectNames.length ? '…' : '') + ')' : ''}.`);
  if (u.financialCount) lines.push(`• توجد ${u.financialCount} حركة مالية في مشاريعه: ${u.financial.map(f => `${f.count} ${f.label}`).join('، ')}.`);
  if (u.users) lines.push(`• ${u.users} مستخدم مرتبطون به كـ${k.label} أساسي.`);
  if (u.grants) lines.push(`• ${u.grants} منح نطاق وصول تشير إليه.`);
  lines.push(u.financialCount ? `يمكنك تعديل اسم ${k.label} فقط.` : `انقل المشاريع والمستخدمين إلى ${k.label} آخر أولاً، أو عدّل بياناته.`);
  return lines.join('\n');
}

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

for (const kind of Object.keys(KINDS)) {
  const k = KINDS[kind];

  router.get(`/${kind}`, async (req, res) => {
    try {
      const rows = await query(`SELECT * FROM ${k.table} ORDER BY id`);
      for (const r of rows) r.usage = await usageOf(kind, r.id);
      res.json({ success: true, data: rows });
    } catch (err) {
      res.status(500).json({ success: false, message: 'خطأ في جلب البيانات' });
    }
  });

  router.post(`/${kind}`, async (req, res) => {
    try {
      const name = clean(req.body?.name, 120), code = clean(req.body?.code, 30).toUpperCase(), extra = clean(req.body?.[k.extra], 200) || null;
      if (!name || !code) return res.status(400).json({ success: false, message: `اسم ${k.label} ورمزه مطلوبان.` });
      if (!/^[A-Z0-9_-]{2,30}$/.test(code)) return res.status(400).json({ success: false, message: 'الرمز من 2 إلى 30 حرفاً لاتينياً أو رقماً أو - أو _.' });
      if (await get(`SELECT id FROM ${k.table} WHERE UPPER(code) = ?`, [code])) return res.status(409).json({ success: false, message: `الرمز (${code}) مستخدم لـ${k.label} آخر.` });
      if (await get(`SELECT id FROM ${k.table} WHERE TRIM(name) = ?`, [name])) return res.status(409).json({ success: false, message: `يوجد ${k.label} بالاسم نفسه.` });
      const r = await run(`INSERT INTO ${k.table} (code, name, ${k.extra}, status) VALUES (?, ?, ?, 'active')`, [code, name, extra]);
      const id = Number(r.lastInsertRowid || r.insertId);
      await logAudit(req, { action: 'ORG_UNIT_CREATED', entity_type: kind, entity_id: id, new_values: { code, name, [k.extra]: extra } });
      res.json({ success: true, message: `تمت إضافة ${k.label} «${name}».`, data: await get(`SELECT * FROM ${k.table} WHERE id = ?`, [id]) });
    } catch (err) {
      res.status(500).json({ success: false, message: 'تعذر الحفظ' });
    }
  });

  router.put(`/${kind}/:id`, async (req, res) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      const unit = await get(`SELECT * FROM ${k.table} WHERE id = ?`, [id]);
      if (!unit) return res.status(404).json({ success: false, message: `${k.label} غير موجود.` });
      const name = req.body?.name !== undefined ? clean(req.body.name, 120) : unit.name;
      const code = req.body?.code !== undefined ? clean(req.body.code, 30).toUpperCase() : unit.code;
      const extra = req.body?.[k.extra] !== undefined ? (clean(req.body[k.extra], 200) || null) : unit[k.extra];
      const status = req.body?.status !== undefined ? String(req.body.status) : unit.status;
      if (!name) return res.status(400).json({ success: false, message: `اسم ${k.label} مطلوب.` });
      if (!['active', 'inactive'].includes(status)) return res.status(400).json({ success: false, message: 'الحالة غير صالحة.' });
      const usage = await usageOf(kind, id);
      const otherChanged = code !== unit.code || (extra || null) !== (unit[k.extra] || null) || status !== unit.status;
      if (usage.financialCount && otherChanged) {
        return res.status(409).json({ success: false, inUse: true, usage, message: `${k.label} «${unit.name}» عليه ${usage.financialCount} حركة مالية في مشاريعه، فلا يُسمح إلا بتعديل الاسم.` });
      }
      if (!/^[A-Z0-9_-]{2,30}$/.test(code)) return res.status(400).json({ success: false, message: 'الرمز من 2 إلى 30 حرفاً لاتينياً أو رقماً أو - أو _.' });
      if (code !== unit.code && await get(`SELECT id FROM ${k.table} WHERE UPPER(code) = ? AND id <> ?`, [code, id])) return res.status(409).json({ success: false, message: `الرمز (${code}) مستخدم لـ${k.label} آخر.` });
      if (name !== unit.name && await get(`SELECT id FROM ${k.table} WHERE TRIM(name) = ? AND id <> ?`, [name, id])) return res.status(409).json({ success: false, message: `يوجد ${k.label} بالاسم نفسه.` });
      await run(`UPDATE ${k.table} SET name = ?, code = ?, ${k.extra} = ?, status = ? WHERE id = ?`, [name, code, extra, status, id]);
      // الاسم المخزَّن نصاً في المستخدمين يتبع الاسم الجديد
      if (name !== unit.name && kind === 'branches' && await hasColumn('users', 'branch')) await run('UPDATE users SET branch = ? WHERE branch_id = ?', [name, id]);
      if (name !== unit.name && kind === 'departments' && await hasColumn('users', 'department')) await run('UPDATE users SET department = ? WHERE department_id = ?', [name, id]);
      await logAudit(req, { action: 'ORG_UNIT_UPDATED', entity_type: kind, entity_id: id, old_values: { code: unit.code, name: unit.name, [k.extra]: unit[k.extra], status: unit.status }, new_values: { code, name, [k.extra]: extra, status } });
      res.json({ success: true, message: `تم تحديث ${k.label} «${name}».` });
    } catch (err) {
      res.status(500).json({ success: false, message: 'تعذر الحفظ' });
    }
  });

  router.delete(`/${kind}/:id`, async (req, res) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      const unit = await get(`SELECT * FROM ${k.table} WHERE id = ?`, [id]);
      if (!unit) return res.status(404).json({ success: false, message: `${k.label} غير موجود.` });
      const usage = await usageOf(kind, id);
      if (usage.inUse) return res.status(409).json({ success: false, inUse: true, usage, message: usageMessage(k, unit, usage) });
      await run(`DELETE FROM ${k.table} WHERE id = ?`, [id]);
      await logAudit(req, { action: 'ORG_UNIT_DELETED', entity_type: kind, entity_id: id, old_values: { code: unit.code, name: unit.name } });
      res.json({ success: true, message: `تم حذف ${k.label} «${unit.name}».` });
    } catch (err) {
      res.status(500).json({ success: false, message: 'تعذر الحذف' });
    }
  });
}

module.exports = router;
