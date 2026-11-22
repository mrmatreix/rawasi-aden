#!/usr/bin/env node
/**
 * إعادة تعيين كلمة مرور موظف (ورمز التحقق بخطوتين) من داخل الخادم — مثلاً من Console في Railway.
 * الكتابة مخفية: لا تظهر كلمة المرور ولا الرمز على الشاشة ولا في السجلات.
 *
 * الاستخدام:  node scripts/reset_staff_password.js admin
 */
const readline = require('node:readline');
const bcrypt = require('bcryptjs');

const username = (process.argv[2] || '').trim();
if (!username) { console.error('Usage: node scripts/reset_staff_password.js <username>'); process.exit(1); }

// واجهة واحدة لكل الأسئلة؛ ما يكتبه المستخدم لا يُعرض (يظهر نص السؤال فقط)
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
let currentQuestion = '';
rl._writeToOutput = function (s) { if (currentQuestion && s.includes(currentQuestion)) process.stdout.write(currentQuestion); };
const pendingLines = [];
const waiters = [];
// بعض الطرفيات على الويب (مثل Console في Railway) ترسل سطراً فارغاً إضافياً بعد Enter؛ نتجاهله
rl.on('line', line => { if (!String(line).trim()) return; const w = waiters.shift(); if (w) w(line); else pendingLines.push(line); });
function askHidden(question) {
  currentQuestion = question;
  process.stdout.write(question);
  return new Promise(resolve => {
    const done = line => { process.stdout.write('\n'); resolve(String(line).trim()); };
    if (pendingLines.length) done(pendingLines.shift()); else waiters.push(done);
  });
}

(async () => {
  const db = require('../server/database/db');
  await db.ready;
  const user = await db.get('SELECT id, username, status, two_factor_enabled FROM users WHERE LOWER(username) = LOWER(?)', [username]);
  if (!user) { console.error('User not found: ' + username); process.exit(1); }

  const pass1 = await askHidden('New password (min 8 chars, hidden): ');
  const pass2 = await askHidden('Repeat new password: ');
  if (pass1.length < 8) { console.error('Too short. Nothing changed.'); process.exit(1); }
  if (pass1 !== pass2) { console.error('Passwords do not match. Nothing changed.'); process.exit(1); }

  let pin = '';
  if (Number(user.two_factor_enabled)) {
    pin = (await askHidden('New 6-digit 2FA PIN (hidden): ')).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
    if (!/^\d{6}$/.test(pin) || ['123456', '654321', '889900', '000000'].includes(pin)) { console.error('PIN must be 6 digits and not a common code. Nothing changed.'); process.exit(1); }
  }

  const hash = bcrypt.hashSync(pass1, 10);
  await db.run('UPDATE users SET password_hash = ?, failed_login_count = 0, login_locked_until = NULL' + (pin ? ', two_factor_pin = ?' : '') + ' WHERE id = ?', pin ? [hash, pin, user.id] : [hash, user.id]);
  try { await db.run("INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, created_at) VALUES (?, 'PASSWORD_RESET_CONSOLE', 'user', ?, ?, CURRENT_TIMESTAMP)", [user.id, user.id, JSON.stringify({ username: user.username, pinReset: !!pin })]); } catch {}
  rl.close();
  console.log(`Done: password${pin ? ' and 2FA PIN' : ''} reset for "${user.username}" (status: ${user.status}). Lock cleared.`);
  await db.closeDatabase?.();
  process.exit(0);
})().catch(err => { console.error('Failed:', err.message); process.exit(1); });
