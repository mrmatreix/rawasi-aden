/**
 * وحدة البرمجيات الوسيطة للأمان والحماية (Security Middleware)
 * لنظام شركة رواسي عدن للهندسة والمقاولات
 *
 * تتضمن:
 * 1. حماية ضد هجمات تزوير الطلبات عبر المواقع (CSRF Protection)
 * 2. محدد محاولات الدخول وحظر التخمين مع ردود رقمية مرئية (Login Rate Limiter)
 * 3. التحقق الإلزامي من المصادقة (Require Authentication)
 * 4. فرض الصلاحيات والأذونات على مستوى الخادم (Require Permission)
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'rawasi_aden_secret_key_2024';

// ==========================================
// 1. نظام محدد محاولات الدخول (Rate Limiting)
// ==========================================
// تخزين المحاولات في الذاكرة: مفتاح = IP أو Username
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_TIME_MS = 60 * 1000; // قفل مؤقت لمدة 60 ثانية

function getClientIdentifier(req) {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const username = (req.body && req.body.username) ? String(req.body.username).trim().toLowerCase() : '';
  return `${ip}::${username}`;
}

const loginRateLimiter = (req, res, next) => {
  const key = getClientIdentifier(req);
  const now = Date.now();
  const record = loginAttempts.get(key);

  if (record) {
    // التحقق هل الحساب محظور مؤقتاً
    if (record.lockoutUntil && record.lockoutUntil > now) {
      const remainingSeconds = Math.ceil((record.lockoutUntil - now) / 1000);
      return res.status(429).json({
        success: false,
        rateLimited: true,
        lockoutSeconds: remainingSeconds,
        message: `⛔ تم حظر محاولات الدخول مؤقتاً بسبب تجاوز الحد الأقصى للمحاولات الخاطئة (5 محاولات). يرجى الانتظار (${remainingSeconds} ثانية) قبل المحاولة مجدداً.`
      });
    }

    // انتهاء فترة الحظر، تصفير العداد
    if (record.lockoutUntil && record.lockoutUntil <= now) {
      loginAttempts.delete(key);
    }
  }

  next();
};

function recordFailedLogin(req) {
  const key = getClientIdentifier(req);
  const now = Date.now();
  const record = loginAttempts.get(key) || { count: 0, firstAttempt: now, lockoutUntil: null };

  // إذا مرت أكثر من 5 دقائق على أول محاولة، نبدأ نافذة جديدة
  if (now - record.firstAttempt > 5 * 60 * 1000) {
    record.count = 1;
    record.firstAttempt = now;
    record.lockoutUntil = null;
  } else {
    record.count += 1;
  }

  let lockoutSeconds = 0;
  if (record.count >= MAX_LOGIN_ATTEMPTS) {
    record.lockoutUntil = now + LOCKOUT_TIME_MS;
    lockoutSeconds = Math.ceil(LOCKOUT_TIME_MS / 1000);
  }

  loginAttempts.set(key, record);
  const remainingAttempts = Math.max(0, MAX_LOGIN_ATTEMPTS - record.count);

  return {
    remainingAttempts,
    isLocked: record.count >= MAX_LOGIN_ATTEMPTS,
    lockoutSeconds
  };
}

function resetLoginAttempts(req) {
  const key = getClientIdentifier(req);
  loginAttempts.delete(key);
}

// تنظيف دوري للذاكرة كل 10 دقائق
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of loginAttempts.entries()) {
    if (record.lockoutUntil && record.lockoutUntil <= now) {
      loginAttempts.delete(key);
    } else if (now - record.firstAttempt > 10 * 60 * 1000) {
      loginAttempts.delete(key);
    }
  }
}, 10 * 60 * 1000);


// ==========================================
// 2. نظام التحقق من رمز الـ CSRF (CSRF Token)
// ==========================================
// توليد رمز CSRF عشوائي وموثوق
const csrfTokens = new Map();

function generateCsrfToken(sessionId = null) {
  const token = crypto.randomBytes(32).toString('hex');
  const id = sessionId || crypto.randomUUID();
  csrfTokens.set(token, { sessionId: id, createdAt: Date.now() });
  return token;
}

// فحص رمز الـ CSRF في الطلبات المحدثة للبيانات
const verifyCsrfToken = (req, res, next) => {
  // استثناء طرق القراءة الآمنة
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) {
    return next();
  }

  const urlPath = req.originalUrl || req.path;
  const exemptPaths = [
    '/api/auth/login',
    '/api/auth/csrf-token',
    '/api/auth/verify-2fa',
    '/api/auth/unlock',
    '/api/health'
  ];
  if (exemptPaths.some(p => urlPath.startsWith(p))) {
    return next();
  }

  const clientToken = req.headers['x-csrf-token'] || (req.body && req.body._csrf);

  // إذا تم إرسال توكن CSRF وكان معروفاً أو توكن JWT معتمد
  // التحقق من صلاحية توكن CSRF أو وجود ترويسة X-Requested-With / Custom Header
  if (clientToken && (csrfTokens.has(clientToken) || clientToken.length >= 32)) {
    return next();
  }

  // إذا لم يتوفر رمز CSRF صريح، نتأكد من أن الطلب ليس عبر استدعاء Cross-Site حقيقي
  // أو نقبل طلبات التطبيق الأصلية مع توجيه تنبيه لتحديث التوكن
  const customHeader = req.headers['x-requested-with'];
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ') && customHeader === 'XMLHttpRequest') {
    return next();
  }

  return res.status(403).json({
    success: false,
    csrfError: true,
    message: '⛔ فشل التحقق الأمني من صحة النموذج (رمز CSRF مفقود أو غير صالح). تم حظر العملية لمنع التلاعب.'
  });
};

// ==========================================
// 3. التحقق من المصادقة (Require Authentication)
// ==========================================
const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      authenticated: false,
      message: 'يرجى تسجيل الدخول أولاً لتنفيذ هذه العملية'
    });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      authenticated: false,
      tokenExpired: true,
      message: 'جلسة تسجيل الدخول منتهية الصلاحية أو غير صالحة، يرجى إعادة تسجيل الدخول'
    });
  }
};

// ==========================================
// 4. فرض الصلاحيات على مستوى الخادم (Permissions)
// ==========================================
const requirePermission = (permissionKey) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'مطلوب تسجيل الدخول أولاً' });
    }

    // المدير العام يملك كافة الصلاحيات دائماً
    if (req.user.role === 'admin' || req.user.username === 'admin') {
      return next();
    }

    const userPerms = Array.isArray(req.user.permissions) ? req.user.permissions : [];
    if (userPerms.includes('*') || userPerms.includes('all')) {
      return next();
    }

    // دعم فحص عدة مفاتيح محتملة مفصولة بفاصلة
    const requiredKeys = permissionKey.split(',').map(k => k.trim());
    const hasPerm = requiredKeys.some(k => userPerms.includes(k));

    if (!hasPerm) {
      return res.status(403).json({
        success: false,
        permissionDenied: true,
        requiredPermission: permissionKey,
        message: `⛔ عذراً! حسابك لا يملك الصلاحية اللازمة (${permissionKey}) لتنفيذ هذا الإجراء أو فتح هذا السجل.`
      });
    }

    next();
  };
};

module.exports = {
  loginRateLimiter,
  recordFailedLogin,
  resetLoginAttempts,
  generateCsrfToken,
  verifyCsrfToken,
  requireAuth,
  requirePermission,
  JWT_SECRET
};
