/**
 * خدمة سجل التدقيق والرقابة المالية (Audit Log Service)
 * توثق هوية المستخدم والعملية والكيان المتأثر وتفاصيل التغيير وعنوان IP
 */

const { run } = require('../database/db');

async function logAudit(req, { action, entity_type, entity_id = null, details = null }) {
  try {
    const user = req?.user || {};
    const userId = user.id || null;
    const username = user.username || user.full_name || req?.headers?.['x-user-name'] || 'المدير العام (نظام)';
    const ip = req ? (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1') : '127.0.0.1';

    let detailsStr = details;
    if (typeof details === 'object' && details !== null) {
      try {
        detailsStr = JSON.stringify(details);
      } catch (e) {
        detailsStr = String(details);
      }
    }

    await run(`
      INSERT INTO audit_logs (user_id, username, action, entity_type, entity_id, details, ip_address)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      userId,
      username,
      String(action || 'ACTION').toUpperCase(),
      String(entity_type || 'GENERAL').toLowerCase(),
      entity_id ? String(entity_id) : null,
      detailsStr,
      ip
    ]);
  } catch (err) {
    console.error('⚠️ [AuditLog] خطأ أثناء تسجيل حركة التدقيق:', err.message);
  }
}

module.exports = { logAudit };
