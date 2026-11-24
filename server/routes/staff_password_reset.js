'use strict';
// «نسيت كلمة المرور» لموظفي النظام: الموظف يطلب من شاشة الدخول، المدير يتحقق من هويته خارج النظام ويعتمد الطلب،
// فيولّد النظام رمزاً لمرة واحدة (يُعرض للمدير مرة واحدة ويُخزَّن مُجزّأً)، والموظف يختار كلمة مروره الجديدة بنفسه.
// لا يوجد بريد ولا SMS: الرمز يُسلَّم شفهياً أو حضورياً.
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { get, query, run, transaction } = require('../database/db');
const {
  requirePermission,
  registerStaffFailure,
  getStaffLockRemainingMs,
  staffLockedResponse,
  revokeAllStaffSessions,
  clearLoginAttemptsFor,
  JWT_SECRET
} = require('../middleware/security');
const { logAudit } = require('../services/auditService');

const CODE_TTL_MS = 30 * 60 * 1000;          // صلاحية الرمز المعتمد
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;  // صلاحية الطلب المعلّق
const MAX_CODE_ATTEMPTS = 5;
const MIN_RESPONSE_MS = 350;                 // زمن استجابة متقارب للطلب حتى لا يكشف وجود الحساب
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'; // بلا 0/O/1/I/L/U المتشابهة
const BLOCKED_PINS = ['123456', '654321', '889900', '000000', '111111', '123123'];
const COMMON_PASSWORDS = ['12345678', '123456789', '1234567890', 'password', 'password1', 'qwerty123', '11111111', '00000000', 'admin123', 'admin1234', '87654321', 'abcd1234'];

const GENERIC_REQUEST_MESSAGE = 'تم تسجيل طلبك. إذا كان اسم المستخدم صحيحاً فسيظهر الطلب لمدير النظام. اذكر رقم المرجع للمدير عند التواصل معه، ولا يطلب منك أحد كلمة مرورك أبداً.';
const GENERIC_CODE_ERROR = 'الرمز غير صالح أو منتهي الصلاحية، أو البيانات غير صحيحة.';

// ---------------- أدوات ----------------
const nowIso = () => new Date().toISOString();
const randomChars = n => Array.from({ length: n }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
const newRef = () => 'R-' + randomChars(6);
const newCode = () => randomChars(10);
const formatCode = c => c.slice(0, 5) + '-' + c.slice(5);
const latinDigits = s => String(s ?? '')
  .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
  .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
const normalizeCode = s => latinDigits(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
const normalizePin = s => latinDigits(s).replace(/\D/g, '');
// مرجع ثابت لاسم غير موجود (نفس المرجع عند التكرار في نفس اليوم) حتى لا يُميَّز عن طلب حقيقي مفتوح يعيد مرجعه نفسه
const fakeRef = username => {
  const h = crypto.createHmac('sha256', JWT_SECRET).update('staff-reset-ref:' + String(username).toLowerCase() + ':' + new Date().toISOString().slice(0, 10)).digest();
  return 'R-' + Array.from(h.subarray(0, 6), b => ALPHABET[b % ALPHABET.length]).join('');
};
let _dummyHash = null;
const dummyHash = () => (_dummyHash ||= bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10));
const sleepUntil =async (started, ms) => { const left = ms - (Date.now() - started); if (left > 0) await new Promise(r => setTimeout(r, left)); };
const clientIp = req => String(req.ip || req.socket?.remoteAddress || '').slice(0, 64);
const userAgent = req => String(req.get('user-agent') || '').slice(0, 200);
const auditReq = (req, user) => ({ ip: req.ip, socket: req.socket, headers: {}, user: user ? { id: user.id, username: user.username } : { id: null, username: 'غير معروف' } });

// حد المحاولات بحسب IP (في الذاكرة، يكمّل المحدد العام على /api/auth)
const buckets = new Map();
function ipLimiter(name, max, windowMs, message) {
  return (req, res, next) => {
    const key = name + '::' + clientIp(req);
    const now = Date.now();
    const hits = (buckets.get(key) || []).filter(t => now - t < windowMs);
    if (hits.length >= max) {
      buckets.set(key, hits);
      return res.status(429).json({ success: false, rateLimited: true, retryAfterSeconds: Math.ceil((windowMs - (now - hits[0])) / 1000), message });
    }
    hits.push(now); buckets.set(key, hits); next();
  };
}
function resetRateLimits() { buckets.clear(); }

async function expireStale() {
  const now = nowIso();
  await run("UPDATE staff_password_resets SET status = 'expired', closed_at = ? WHERE status = 'pending' AND requested_at < ?", [now, new Date(Date.now() - PENDING_TTL_MS).toISOString()]);
  await run("UPDATE staff_password_resets SET status = 'expired', closed_at = ? WHERE status = 'approved' AND code_expires_at < ?", [now, now]);
}

function isTwoFactorEnabled(user) {
  if (user.two_factor_enabled !== undefined && user.two_factor_enabled !== null && user.two_factor_enabled !== '') return Number(user.two_factor_enabled) === 1 || user.two_factor_enabled === true;
  return user.role === 'admin' || user.username === 'admin';
}
async function expectedPinFor(user) {
  const own = normalizePin(user.two_factor_pin);
  if (own) return own;
  if (user.role !== 'admin') return '';
  try { return normalizePin((await get("SELECT value FROM settings WHERE `key` = 'admin_2fa_pin'"))?.value); } catch { return ''; }
}

function passwordPolicyError(password, confirm, username) {
  if (typeof password !== 'string' || password.length < 8) return 'كلمة المرور الجديدة يجب أن تكون 8 خانات على الأقل.';
  if (password.length > 128) return 'كلمة المرور الجديدة طويلة جداً.';
  if (password !== confirm) return 'كلمة المرور وتأكيدها غير متطابقين.';
  if (password.trim().toLowerCase() === String(username || '').trim().toLowerCase()) return 'لا يجوز أن تطابق كلمة المرور اسم المستخدم.';
  if (COMMON_PASSWORDS.includes(password.toLowerCase())) return 'كلمة المرور شائعة وسهلة التخمين، اختر كلمة أقوى.';
  return null;
}

// ==========================================================
// المسارات العامة: /api/auth/password-reset
// ==========================================================
const publicRouter = express.Router();

publicRouter.post('/request',
  ipLimiter('request', 3, 15 * 60 * 1000, 'تم إرسال طلبات كثيرة من هذا الجهاز. حاول بعد قليل.'),
  async (req, res) => {
    const started = Date.now();
    try {
      const username = String(req.body?.username || '').trim().slice(0, 80);
      const note = String(req.body?.note || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200) || null;
      if (!username) return res.status(400).json({ success: false, message: 'يرجى إدخال اسم المستخدم' });

      await expireStale();
      let ref = fakeRef(username);
      const user = await get('SELECT id, username, status FROM users WHERE LOWER(username) = LOWER(?)', [username]);
      if (user && user.status === 'active') {
        const open = await get("SELECT public_ref FROM staff_password_resets WHERE user_id = ? AND status IN ('pending','approved')", [user.id]);
        if (open) {
          ref = open.public_ref;
        } else {
          ref = newRef();
          await run(`INSERT INTO staff_password_resets (user_id, public_ref, status, requester_note, requested_at, requested_ip, requested_user_agent)
                     VALUES (?, ?, 'pending', ?, ?, ?, ?)`, [user.id, ref, note, nowIso(), clientIp(req), userAgent(req)]);
          await logAudit(auditReq(req, user), { action: 'PASSWORD_RESET_REQUESTED', entity_type: 'auth', entity_id: user.id, details: { ref, user_agent: userAgent(req) } });
        }
      } else {
        await logAudit(auditReq(req, null), { action: 'PASSWORD_RESET_REQUESTED', entity_type: 'auth', entity_id: null, details: { attempted: username, stage: user ? 'inactive' : 'unknown_username' } });
      }
      await sleepUntil(started, MIN_RESPONSE_MS);
      return res.status(202).json({ success: true, ref, message: GENERIC_REQUEST_MESSAGE });
    } catch (err) {
      console.error('Password reset request error:', err);
      await sleepUntil(started, MIN_RESPONSE_MS);
      return res.status(500).json({ success: false, message: 'تعذر تسجيل الطلب حالياً، حاول لاحقاً.' });
    }
  });

publicRouter.post('/complete',
  ipLimiter('complete', 10, 15 * 60 * 1000, 'محاولات كثيرة من هذا الجهاز. حاول بعد قليل.'),
  async (req, res) => {
    try {
      const body = req.body || {};
      const username = String(body.username || '').trim().slice(0, 80);
      const code = normalizeCode(body.code);
      if (!username || !code || !body.new_password) return res.status(400).json({ success: false, message: 'يرجى إكمال جميع الحقول المطلوبة' });
      const policy = passwordPolicyError(body.new_password, body.new_password_confirm, username);
      if (policy) return res.status(400).json({ success: false, message: policy });

      await expireStale();
      const user = await get('SELECT * FROM users WHERE LOWER(username) = LOWER(?)', [username]);
      const row = user && user.status === 'active'
        ? await get("SELECT * FROM staff_password_resets WHERE user_id = ? AND status = 'approved'", [user.id])
        : null;
      if (!row || !row.code_hash) {
        bcrypt.compareSync(code, dummyHash()); // زمن متقارب سواء وُجد طلب معتمد أم لا
        return res.status(400).json({ success: false, message: GENERIC_CODE_ERROR });
      }

      if (!bcrypt.compareSync(code, row.code_hash)) {
        const attempts = Number(row.attempts || 0) + 1;
        const exhausted = attempts >= MAX_CODE_ATTEMPTS;
        await run(`UPDATE staff_password_resets SET attempts = ?${exhausted ? ", status = 'expired', closed_at = ?, close_reason = 'too_many_attempts'" : ''} WHERE id = ?`,
          exhausted ? [attempts, nowIso(), row.id] : [attempts, row.id]);
        await logAudit(auditReq(req, user), { action: 'PASSWORD_RESET_CODE_FAILED', entity_type: 'auth', entity_id: user.id, details: { ref: row.public_ref, attempts, exhausted } });
        return res.status(400).json({ success: false, message: GENERIC_CODE_ERROR });
      }

      // الرمز صحيح. إن كان التحقق بخطوتين مفعّلاً ولم يطلب المدير ضبط الـ PIN، فالـ PIN الحالي مطلوب (عامل ثانٍ مستقل عن الرمز)
      const resetPin = Number(row.reset_pin) === 1;
      const twoFa = isTwoFactorEnabled(user);
      if (twoFa && !resetPin) {
        const lockMs = getStaffLockRemainingMs(user);
        if (lockMs) return staffLockedResponse(res, lockMs);
        const expected = await expectedPinFor(user);
        const given = normalizePin(body.current_pin);
        if (!expected || !given || given !== expected) {
          const fail = await registerStaffFailure(user.id);
          await logAudit(auditReq(req, user), { action: fail.locked ? 'ACCOUNT_LOCKED' : 'PASSWORD_RESET_CODE_FAILED', entity_type: 'auth', entity_id: user.id, details: { ref: row.public_ref, stage: '2fa_pin' } });
          if (fail.locked) return staffLockedResponse(res, fail.lockoutSeconds * 1000);
          return res.status(401).json({ success: false, requiresCurrentPin: true, remainingAttempts: fail.remainingAttempts, message: `رمز الأمان (PIN) الحالي غير صحيح (متبقي ${fail.remainingAttempts} محاولات قبل قفل الحساب)` });
        }
      }
      let newPin = '';
      if (resetPin) {
        newPin = normalizePin(body.new_pin);
        if (!/^\d{6}$/.test(newPin)) return res.status(400).json({ success: false, requiresNewPin: true, message: 'طلب المدير تعيين رمز أمان (PIN) جديد: أدخل 6 أرقام.' });
        if (BLOCKED_PINS.includes(newPin)) return res.status(400).json({ success: false, requiresNewPin: true, message: 'رمز PIN سهل التخمين، اختر 6 أرقام أخرى.' });
      }
      if (bcrypt.compareSync(body.new_password, user.password_hash || '')) return res.status(400).json({ success: false, message: 'كلمة المرور الجديدة يجب أن تختلف عن الحالية.' });

      const hash = bcrypt.hashSync(body.new_password, 10);
      const now = nowIso();
      await transaction(async tx => {
        // التحقق من أن الطلب ما زال معتمداً (لا يُستعمل الرمز مرتين في طلبين متزامنين)
        const claimed = await tx.run("UPDATE staff_password_resets SET status = 'used', used_at = ?, used_ip = ?, code_hash = NULL WHERE id = ? AND status = 'approved'", [now, clientIp(req), row.id]);
        if (!Number(claimed.changes)) throw Object.assign(new Error('already used'), { code: 'RESET_ALREADY_USED' });
        await tx.run(`UPDATE users SET password_hash = ?, password_changed_at = ?, must_change_password = 0, failed_login_count = 0, login_locked_until = NULL${newPin ? ', two_factor_pin = ?' : ''} WHERE id = ?`,
          newPin ? [hash, now, newPin, user.id] : [hash, now, user.id]);
        if (newPin && user.username === 'admin') await tx.run("INSERT OR REPLACE INTO settings (`key`, `value`) VALUES ('admin_2fa_pin', ?)", [newPin]);
        await revokeAllStaffSessions(user.id, { dbh: tx });
      });
      clearLoginAttemptsFor(user.username);
      await logAudit(auditReq(req, user), { action: 'PASSWORD_RESET_COMPLETED', entity_type: 'auth', entity_id: user.id, details: { ref: row.public_ref, pin_reset: resetPin, sessions_revoked: true } });
      return res.json({ success: true, message: 'تم تغيير كلمة المرور بنجاح، وأُنهيت جميع الجلسات المفتوحة على حسابك. سجّل الدخول الآن بكلمة المرور الجديدة.' });
    } catch (err) {
      if (err.code === 'RESET_ALREADY_USED') return res.status(400).json({ success: false, message: GENERIC_CODE_ERROR });
      console.error('Password reset complete error:', err);
      return res.status(500).json({ success: false, message: 'تعذر إكمال إعادة التعيين حالياً، حاول لاحقاً.' });
    }
  });

// ==========================================================
// مسارات المدير: /api/staff-password-resets (خلف requireAuth)
// ==========================================================
const adminRouter = express.Router();
adminRouter.use(requirePermission('settings:users'));

const PUBLIC_COLUMNS = `r.id, r.user_id, r.public_ref, r.status, r.requester_note, r.requested_at, r.requested_ip, r.requested_user_agent,
  r.approved_by, r.approved_at, r.code_expires_at, r.reset_pin, r.attempts, r.used_at, r.closed_at, r.close_reason,
  u.username, u.full_name, u.role, u.two_factor_enabled, a.full_name AS approved_by_name`;

adminRouter.get('/', async (req, res) => {
  try {
    await expireStale();
    const all = req.query.status === 'all';
    const rows = await query(`SELECT ${PUBLIC_COLUMNS} FROM staff_password_resets r
      JOIN users u ON u.id = r.user_id LEFT JOIN users a ON a.id = r.approved_by
      ${all ? '' : "WHERE r.status IN ('pending','approved')"} ORDER BY r.id DESC LIMIT 200`);
    res.json({ success: true, data: rows.map(r => ({ ...r, is_self: Number(r.user_id) === Number(req.user.id) })) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب طلبات إعادة التعيين' });
  }
});

adminRouter.get('/count', async (req, res) => {
  try {
    await expireStale();
    const row = await get("SELECT COUNT(*) AS n FROM staff_password_resets WHERE status = 'pending'");
    res.json({ success: true, pending: Number(row?.n || 0) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب عدد الطلبات' });
  }
});

async function loadForAction(req, res, allowed) {
  await expireStale();
  const id = Number.parseInt(req.params.id, 10);
  const row = Number.isFinite(id) ? await get('SELECT r.*, u.username, u.full_name, u.role, u.status AS user_status FROM staff_password_resets r JOIN users u ON u.id = r.user_id WHERE r.id = ?', [id]) : null;
  if (!row) { res.status(404).json({ success: false, message: 'الطلب غير موجود' }); return null; }
  if (!allowed.includes(row.status)) { res.status(409).json({ success: false, message: 'لا يمكن تنفيذ هذا الإجراء على طلب حالته الآن: ' + row.status }); return null; }
  return row;
}

adminRouter.post('/:id/approve', async (req, res) => {
  try {
    const row = await loadForAction(req, res, ['pending', 'approved']);
    if (!row) return;
    if (Number(row.user_id) === Number(req.user.id)) return res.status(403).json({ success: false, message: 'لا يمكنك اعتماد طلب إعادة تعيين لحسابك أنت. اطلب ذلك من مدير آخر أو استعمل سكربت الطرفية.' });
    if (row.role === 'admin' && req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'طلبات حسابات المدير العام يعتمدها مدير عام آخر فقط.' });
    if (row.user_status !== 'active') return res.status(409).json({ success: false, message: 'الحساب غير نشط، فعّله أولاً.' });
    const code = newCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
    const resetPin = req.body?.reset_pin ? 1 : 0;
    await run(`UPDATE staff_password_resets SET status = 'approved', approved_by = ?, approved_at = ?, code_hash = ?, code_expires_at = ?, reset_pin = ?, attempts = 0 WHERE id = ?`,
      [req.user.id, nowIso(), bcrypt.hashSync(code, 10), expiresAt, resetPin, row.id]);
    await logAudit(req, { action: 'PASSWORD_RESET_APPROVED', entity_type: 'user', entity_id: row.user_id, details: { ref: row.public_ref, target: row.username, reset_pin: !!resetPin, reissued: row.status === 'approved' } });
    res.json({ success: true, code: formatCode(code), expires_at: expiresAt, reset_pin: !!resetPin, ref: row.public_ref,
      message: `رمز إعادة التعيين للمستخدم (${row.full_name || row.username}) صالح 30 دقيقة ولمرة واحدة. سلّمه للموظف شخصياً أو هاتفياً. لن يُعرض الرمز مرة أخرى.` });
  } catch (err) {
    console.error('Password reset approve error:', err);
    res.status(500).json({ success: false, message: 'تعذر اعتماد الطلب' });
  }
});

function closeHandler(allowed, status, action) {
  return async (req, res) => {
    try {
      const row = await loadForAction(req, res, allowed);
      if (!row) return;
      const reason = String(req.body?.reason || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200) || null;
      await run('UPDATE staff_password_resets SET status = ?, closed_by = ?, closed_at = ?, close_reason = ?, code_hash = NULL WHERE id = ?', [status, req.user.id, nowIso(), reason, row.id]);
      await logAudit(req, { action, entity_type: 'user', entity_id: row.user_id, details: { ref: row.public_ref, target: row.username }, reason });
      res.json({ success: true, message: status === 'rejected' ? 'تم رفض الطلب.' : 'تم إلغاء الرمز المعتمد.' });
    } catch (err) {
      res.status(500).json({ success: false, message: 'تعذر تنفيذ الإجراء' });
    }
  };
}
adminRouter.post('/:id/reject', closeHandler(['pending', 'approved'], 'rejected', 'PASSWORD_RESET_REJECTED'));
adminRouter.post('/:id/revoke', closeHandler(['approved'], 'revoked', 'PASSWORD_RESET_REVOKED'));

module.exports = { publicRouter, adminRouter, resetRateLimits, _internals: { normalizeCode, passwordPolicyError, fakeRef } };
