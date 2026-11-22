'use strict';
// Unified error layer (stage 5, M13).
// - Typed errors: ValidationError 400, ForbiddenError 403, NotFoundError 404, ConflictError 409, DomainError 422.
// - classify(err): HTTP status + safe message for any error, including node:sqlite errors (trigger messages are
//   business rules -> 409 with their Arabic text; UNIQUE/FOREIGN KEY -> 409/400 with a plain message).
// - safeErrorResponses: about 235 routes still answer `res.status(500).json({ message: ... err.message })`.
//   Instead of rewriting each one, any failed JSON response whose text looks technical (SQL, stack traces,
//   JS runtime errors, file paths) gets a generic message and a reference id; the details go to the server log.
//   Business messages (Arabic validation text) pass through unchanged.
// - errorHandler: the final Express handler, using classify().
const crypto = require('node:crypto');

class AppError extends Error {
  constructor(message, { statusCode = 500, code = 'APP_ERROR', details } = {}) {
    super(message);
    this.name = this.constructor.name; this.statusCode = statusCode; this.code = code;
    if (details !== undefined) this.details = details;
  }
}
class ValidationError extends AppError { constructor(m, o = {}) { super(m, { statusCode: 400, code: 'VALIDATION', ...o }); } }
class ForbiddenError extends AppError { constructor(m, o = {}) { super(m, { statusCode: 403, code: 'FORBIDDEN', ...o }); } }
class NotFoundError extends AppError { constructor(m, o = {}) { super(m, { statusCode: 404, code: 'NOT_FOUND', ...o }); } }
class ConflictError extends AppError { constructor(m, o = {}) { super(m, { statusCode: 409, code: 'CONFLICT', ...o }); } }
class DomainError extends AppError { constructor(m, o = {}) { super(m, { statusCode: 422, code: 'DOMAIN_RULE', ...o }); } }

const TECHNICAL = [
  /SQLITE_|SQL logic error|no such (table|column|function)|syntax error|near "[^"]*": syntax/i,
  /constraint failed|FOREIGN KEY|UNIQUE constraint|NOT NULL constraint|CHECK constraint/i,
  /ER_[A-Z_]+|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOENT|EACCES/,
  /\b(TypeError|ReferenceError|RangeError|SyntaxError)\b|Cannot read propert|is not a function|is not defined|of undefined|of null/i,
  /\bat [\w.<>$]+ \(.*:\d+:\d+\)|[A-Za-z]:\\|\/(home|usr|app|var)\/[\w/.-]+\.js/
];
const isTechnical = text => typeof text === 'string' && TECHNICAL.some(re => re.test(text));
const ARABIC = /[؀-ۿ]/;

function sqliteClassify(err) {
  if (!err || err.code !== 'ERR_SQLITE_ERROR') return null;
  const msg = String(err.message || '');
  // RAISE(ABORT, '...') from our triggers carries an Arabic business rule
  if (ARABIC.test(msg) && !/constraint failed/i.test(msg)) return { status: 409, code: 'LEDGER_RULE', message: msg.replace(/^.*?:\s*(?=[؀-ۿ⛔])/, '') };
  if (/UNIQUE constraint/i.test(msg)) return { status: 409, code: 'DUPLICATE', message: 'السجل موجود مسبقاً (قيمة مكررة)' };
  if (/FOREIGN KEY constraint/i.test(msg)) return { status: 400, code: 'INVALID_REFERENCE', message: 'مرجع غير صالح: السجل المرتبط غير موجود أو مستخدم في سجلات أخرى' };
  if (/NOT NULL constraint/i.test(msg)) return { status: 400, code: 'MISSING_FIELD', message: 'حقل إلزامي مفقود' };
  return null;
}

/** HTTP status, code and a message that is safe to show the user. */
function classify(err) {
  const sqlite = sqliteClassify(err);
  if (sqlite) return { ...sqlite, safe: true };
  const status = Number(err && (err.statusCode || err.status)) || 500;
  const message = String((err && err.message) || '');
  if (status < 500 && message && !isTechnical(message)) return { status, code: err.code || 'REQUEST_ERROR', message, safe: true };
  if (status < 500) return { status, code: err.code || 'REQUEST_ERROR', message: 'الطلب غير صالح', safe: false };
  if (message && !isTechnical(message) && ARABIC.test(message)) return { status, code: err.code || 'APP_ERROR', message, safe: true };
  return { status, code: (err && err.code) || 'INTERNAL', message: 'حدث خطأ داخلي غير متوقع', safe: false };
}

const refId = () => crypto.randomBytes(4).toString('hex').toUpperCase();

/** Wraps res.json so failed responses never carry SQL, stack traces or JS runtime errors. */
function safeErrorResponses(req, res, next) {
  const json = res.json.bind(res);
  res.json = body => {
    if (body && typeof body === 'object' && body.success === false && res.statusCode >= 400) {
      const technical = ['message', 'error', 'details'].filter(k => isTechnical(typeof body[k] === 'string' ? body[k] : ''));
      if (technical.length) {
        const id = refId();
        console.error(`[${id}] ${req.method} ${req.originalUrl} -> ${res.statusCode}:`, technical.map(k => `${k}=${body[k]}`).join(' | '));
        const cleaned = { ...body, error_ref: id };
        for (const k of technical) delete cleaned[k];
        if (technical.includes('message') || !cleaned.message) {
          // keep a business prefix ("خطأ في ترحيل السند: ...") when the route added one
          const prefix = typeof body.message === 'string' ? body.message.split(/:\s/)[0] : '';
          cleaned.message = (prefix && ARABIC.test(prefix) && !isTechnical(prefix) && prefix !== body.message ? prefix + ': ' : '')
            + `حدث خطأ داخلي غير متوقع (رقم المرجع ${id})`;
        }
        return json(cleaned);
      }
    }
    return json(body);
  };
  next();
}

function errorHandler(error, req, res, _next) {
  const c = classify(error);
  const id = refId();
  if (c.status >= 500 || !c.safe) console.error(`[${id}] ${req.method} ${req.originalUrl} -> ${c.status}:`, error && (error.stack || error.message || error));
  if (res.headersSent) return;
  res.status(c.status).json({ success: false, message: c.safe ? c.message : `${c.message} (رقم المرجع ${id})`, code: c.code, ...(c.safe ? {} : { error_ref: id }) });
}

module.exports = { AppError, ValidationError, ForbiddenError, NotFoundError, ConflictError, DomainError, classify, isTechnical, safeErrorResponses, errorHandler };
