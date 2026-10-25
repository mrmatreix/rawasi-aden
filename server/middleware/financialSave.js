const { createHash } = require('node:crypto');
const db = require('../database/db');
let schema;

function ensureSchema() {
  if (!schema) schema = db.run(`CREATE TABLE IF NOT EXISTS financial_save_requests (
    request_id VARCHAR(64) PRIMARY KEY,
    fingerprint VARCHAR(64) NOT NULL,
    status_code INTEGER,
    response_json TEXT
  )`).catch(error => { schema = null; throw error; });
  return schema;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

// Reserve before invoking the handler. A pending reservation survives a restart:
// never re-run an uncertain financial write after a lost response or process crash.
async function financialSave(req, res, next) {
  const key = req.get('Idempotency-Key') || req.get('X-Idempotency-Key') || req.body?.idempotency_key;
  if (!key) return next(); // Compatibility with older clients.
  if (typeof key !== 'string' || key.length > 120) return res.status(400).json({ success: false, message: 'مفتاح الحفظ غير صالح' });
  const hash = text => createHash('sha256').update(text).digest('hex');
  const requestId = hash(JSON.stringify([req.user.id, req.method, req.baseUrl, req.path, key]));
  const { idempotency_key, ...body } = req.body || {};
  const fingerprint = hash(JSON.stringify(canonical(body)));
  try {
    await ensureSchema();
    try {
      await db.run('INSERT INTO financial_save_requests (request_id, fingerprint) VALUES (?, ?)', [requestId, fingerprint]);
    } catch (error) {
      const existing = await db.get('SELECT * FROM financial_save_requests WHERE request_id = ?', [requestId]);
      if (!existing) throw error;
      if (existing.fingerprint !== fingerprint) return res.status(409).json({ success: false, message: 'تغيّرت بيانات عملية الحفظ؛ افتح عملية جديدة قبل الإرسال' });
      if (existing.response_json) {
        res.set('Idempotency-Replayed', 'true');
        return res.status(existing.status_code).json(JSON.parse(existing.response_json));
      }
      return res.status(409).json({ success: false, pending: true, message: 'عملية الحفظ قيد التنفيذ أو التحقق. حدّث السجل للتحقق منها قبل إنشاء عملية جديدة.' });
    }
    const send = res.json.bind(res);
    res.json = result => {
      // Persist the response before sending it so retries return the same document.
      db.run('UPDATE financial_save_requests SET status_code = ?, response_json = ? WHERE request_id = ?',
        [res.statusCode, JSON.stringify(result), requestId])
        .then(() => send(result))
        .catch(error => {
          console.error('Financial save response persistence failed:', error.message);
          res.status(503);
          send({ success: false, pending: true, message: 'تعذر تأكيد نتيجة الحفظ؛ حدّث السجل للتحقق قبل إعادة العملية.' });
        });
      return res;
    };
    next();
  } catch (error) {
    next(error);
  }
}

async function lockFinancialDocument(tx, table, id) {
  if (!['expenses', 'payments', 'journal_entries'].includes(table)) throw new Error('Invalid financial table');
  const document = await tx.get(`SELECT * FROM ${table} WHERE id = ?${db.getActiveEngine() === 'mysql' ? ' FOR UPDATE' : ''}`, [id]);
  if (!document) throw Object.assign(new Error('المستند غير موجود؛ حدّث السجل'), { statusCode: 404 });
  return document;
}

module.exports = { financialSave, lockFinancialDocument };
