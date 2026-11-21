/**
 * البحث الشامل (Ctrl+K): مشاريع، عملاء، موردون، طلبات خدمات.
 * كل نوع يخضع لنفس صلاحيات شاشته ونطاقه:
 *  - المشاريع: صلاحية عرض المشاريع + المشاريع المسموح بها للمستخدم (allowed_projects)
 *  - العملاء/الموردون: clients:view / suppliers:view
 *  - طلبات الخدمات: client_app:requests_view، والمشرف المقيّد يرى المسندة إليه فقط
 * المطابقة تتم بعد توحيد الكتابة العربية (أ/إ/آ→ا، ة→ه، ى→ي، إزالة التشكيل، الأرقام العربية).
 */
const express = require('express');
const router = express.Router();
const { query } = require('../database/db');
const { hasUserPermission, parseScopeArray, isScopedRequestSupervisor } = require('../middleware/security');

const PER_TYPE = 6;
const SCAN_LIMIT = 5000;
const PROJECT_PERMS = 'projects:view,projects,accounting:view,accounting,expenses:view,expenses:create,revenues:view,revenues:create,billing:view,cash:view';

function normalizeArabic(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')          // التشكيل والتطويل
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/\s+/g, ' ')
    .trim();
}

/** كل كلمات البحث يجب أن تظهر في أحد الحقول؛ الأولوية لمن يبدأ بالكلمة */
function rank(fields, terms) {
  const hay = normalizeArabic(fields.filter(Boolean).join(' | '));
  if (!terms.every(t => hay.includes(t))) return -1;
  const first = normalizeArabic(fields[0] || '');
  return (first.startsWith(terms[0]) ? 0 : 2) + (first.includes(terms.join(' ')) ? 0 : 1);
}

function pick(rows, terms, fieldsOf, map) {
  return rows
    .map(row => ({ row, score: rank(fieldsOf(row), terms) }))
    .filter(x => x.score >= 0)
    .sort((a, b) => a.score - b.score)
    .slice(0, PER_TYPE)
    .map(x => map(x.row));
}

async function safeQuery(sql, params = []) {
  try { return await query(sql, params); } catch (err) { console.error('search query failed:', err.message); return []; }
}

router.get('/', async (req, res) => {
  const raw = String(req.query.q || '').slice(0, 80);
  const terms = normalizeArabic(raw).split(' ').filter(Boolean);
  if (!terms.length || terms.join('').length < 2) return res.json({ success: true, results: [] });

  const user = req.user;
  const isAdmin = user.role === 'admin' || user.username === 'admin';
  const results = [];

  if (hasUserPermission(user, PROJECT_PERMS)) {
    let sql = `SELECT p.id, p.name, p.code, p.status, c.name AS client_name FROM projects p LEFT JOIN clients c ON p.client_id = c.id`;
    const params = [];
    let allowed = ['*'];
    if (!isAdmin) {
      allowed = parseScopeArray(user.scope?.allowed_projects || user.allowed_projects);
      if (!allowed.includes('*') && !allowed.includes('all')) {
        const ids = allowed.map(Number).filter(Number.isSafeInteger);
        sql += ids.length ? ` WHERE p.id IN (${ids.map(() => '?').join(',')})` : ' WHERE 1=0';
        params.push(...ids);
      }
    }
    const rows = await safeQuery(sql + ` ORDER BY p.id DESC LIMIT ${SCAN_LIMIT}`, params);
    results.push(...pick(rows, terms, r => [r.name, r.code, r.client_name], r => ({
      type: 'project', id: r.id, title: r.name, subtitle: [r.code, r.client_name].filter(Boolean).join(' · ')
    })));
  }

  if (hasUserPermission(user, 'clients:view')) {
    const rows = await safeQuery(`SELECT id, name, company, phone, email, party_no FROM clients ORDER BY id DESC LIMIT ${SCAN_LIMIT}`);
    results.push(...pick(rows, terms, r => [r.name, r.company, r.party_no, r.phone, r.email], r => ({
      type: 'client', id: r.id, title: r.name, subtitle: [r.company, r.phone || r.email].filter(Boolean).join(' · ')
    })));
  }

  if (hasUserPermission(user, 'suppliers:view')) {
    const rows = await safeQuery(`SELECT id, name, phone, party_no FROM suppliers ORDER BY id DESC LIMIT ${SCAN_LIMIT}`);
    results.push(...pick(rows, terms, r => [r.name, r.party_no, r.phone], r => ({
      type: 'supplier', id: r.id, title: r.name, subtitle: r.phone || ''
    })));
  }

  if (hasUserPermission(user, 'client_app:requests_view')) {
    let sql = `SELECT id, request_no, client_name, phone, project_name, status FROM service_requests`;
    const params = [];
    if (isScopedRequestSupervisor(user)) { sql += ' WHERE assigned_to = ?'; params.push(user.id); }
    const rows = await safeQuery(sql + ` ORDER BY id DESC LIMIT ${SCAN_LIMIT}`, params);
    results.push(...pick(rows, terms, r => [r.request_no, r.client_name, r.project_name, r.phone], r => ({
      type: 'request', id: r.id, title: r.request_no + (r.client_name ? ' — ' + r.client_name : ''), subtitle: r.project_name || ''
    })));
  }

  res.json({ success: true, results });
});

module.exports = router;
module.exports.normalizeArabic = normalizeArabic;
