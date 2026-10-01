const express = require('express');
const compression = require('compression');
const cors = require('cors');
const path = require('path');

const config = require('./config/environment');

// إعداد تطبيق Express
const app = express();
const PORT = config.port;

// البرمجيات الوسيطة (Middleware)
app.use(compression()); // ضغط gzip: يقلص index.html (~500KB) وملفات JS (~1MB) لأقل من الربع
// CORS صارم: نفس-الأصل في الإنتاج، مع سماح صريح عبر CORS_ORIGINS (مفصول بفواصل) عند الحاجة
// (مثال: الواجهة على Cloudflare Pages والـ API عبر نفق). التطوير يبقى مفتوحاً للراحة.
{
  const extraOrigins = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  app.use(cors(extraOrigins.length > 0 ? { origin: extraOrigins, credentials: true } : config.cors));
}
// حد عام متواضع للأجسام (5MB قابلة للضبط عبر JSON_BODY_LIMIT) — أرشفة الماسح (Base64 حتى 25MB)
// وحفظ التقارير يحملان حدّهما الخاص 40MB على مساريهما فقط (project_files.js).
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || '5mb';
const _jsonParser = express.json({ limit: JSON_BODY_LIMIT });
const _textParser = express.text({ type: ['text/plain', 'application/json'], limit: JSON_BODY_LIMIT });
// المساران الثقيلان يتجاوزان المحلل العام (يحملان محللهما 40MB) — وإلا رُفضا بـ 413 قبل الوصول إليه.
const BIG_BODY_SUFFIX = ['/scan-archive', '/save-report'];
const _isBigBody = (req) => typeof req.path === 'string' && BIG_BODY_SUFFIX.some(sfx => req.path.endsWith(sfx));
app.use((req, res, next) => (_isBigBody(req) ? next() : _jsonParser(req, res, next)));
app.use((req, res, next) => (_isBigBody(req) ? next() : _textParser(req, res, next)));
app.use(express.urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));
app.use((req, res, next) => {
  if (typeof req.body === 'string') {
    try { req.body = JSON.parse(req.body); } catch {}
  }
  next();
});

const { verifyCsrfToken, requireAuth } = require('./middleware/security');

// خدمة الواجهة الأمامية فقط — قائمة سماح صارمة للأصول العامة.
// (كانت خدمة الجذر الكاملة تكشف قاعدة البيانات وشفرة الخادم عبر HTTP — علة حرجة أُغلقت)
const publicDir = path.join(__dirname, '..');
{
  const frontOpts = { dotfiles: 'deny', index: false, maxAge: '1h' };
  for (const dir of ['css', 'js', 'images', 'assets']) {
    app.use('/' + dir, express.static(path.join(publicDir, dir), frontOpts));
  }
  for (const file of ['manifest.json', 'sw.js']) {
    app.get('/' + file, (req, res) => res.sendFile(path.join(publicDir, file)));
  }
}

// حماية مسارات الـ API بـ CSRF Token
app.use('/api', verifyCsrfToken);

// مسارات واجهات برمجة التطبيقات (API Routes) مع التحقق الأمني
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', requireAuth, require('./routes/users'));
app.use('/api/projects', requireAuth, require('./routes/projects'));
app.use('/api/inventory', requireAuth, require('./routes/inventory'));
app.use('/api/purchases', requireAuth, require('./routes/purchases'));
app.use('/api/expenses', requireAuth, require('./routes/expenses'));
app.use('/api/billing', requireAuth, require('./routes/billing'));
app.use('/api/payments', requireAuth, require('./routes/payments'));
app.use('/api/accounting', requireAuth, require('./routes/accounting'));
app.use('/api/reports', requireAuth, require('./routes/reports'));
app.use('/api/clients', requireAuth, require('./routes/clients'));
app.use('/api/suppliers', requireAuth, require('./routes/suppliers'));
app.use('/api/settings', requireAuth, require('./routes/settings'));
app.use('/api/hr', requireAuth, require('./routes/hr'));
app.use('/api/project-hub', requireAuth, require('./routes/project_management'));
app.use('/api/project-files', requireAuth, require('./routes/project_files'));
app.use('/api/procurement', requireAuth, require('./routes/procurement'));
app.use('/api/bank-reconciliation', requireAuth, require('./routes/bank_reconciliation'));
app.use('/api/taxes-guarantees', requireAuth, require('./routes/taxes_guarantees'));
app.use('/api/project-control', requireAuth, require('./routes/project_control'));


// مسار توثيق الـ API التفاعلي ومواصفة OpenAPI 3.0
const docsModule = require('./routes/docs');
app.use('/api', docsModule.router);
app.get('/api-docs', (_req, res) => res.send(docsModule.renderDocsHtml()));

// نقطة فحص صحة النظام
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    system: config.appName,
    version: config.version,
    environment: config.env,
    timestamp: new Date().toISOString()
  });
});

// نقطة فحص إصدار النظام والبيئة التشغيلية
app.get('/api/version', (req, res) => {
  res.json({
    success: true,
    version: config.version,
    environment: config.env,
    port: config.port,
    system: config.appName,
    isDev: config.isDev,
    isStaging: config.isStaging,
    timestamp: new Date().toISOString()
  });
});

// تدفئة مخطط توحيد التكلفة عند الإقلاع (غير حاجبة — تُعاد تلقائياً عند أول طلب عند الحاجة)
try {
  require('./services/projectCostService').ensureSchema().catch(() => {});
} catch {}

// تدفئة مخطط الصناديق وربط العهد والإقفال السنوي (SUGGESTION-4)
try {
  require('./services/cashBoxService').ensureSchema().catch(() => {});
  require('./services/accountingService').ensureCustodyJournalLinks().catch(() => {});
  require('./services/financialControlService').ensureCloseSchema().catch(() => {});
} catch {}

// أي مسار API غير معروف يرجع JSON دائماً بدلاً من صفحة HTML
app.all('/api/*', (req, res) => {
  res.status(404).json({ success: false, message: `المسار غير موجود في الخادم: ${req.method} ${req.originalUrl}` });
});

// المسار الافتراضي يوجه لصفحة النظام الرئيسية
app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// معالجة الأخطاء غير المتوقعة لضمان استمرار الخادم دائماً
process.on('uncaughtException', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('===========================================================');
    console.error(`⚠️  [Port Conflict] Port ${PORT} is already in use!`);
    console.error(`👉 Another instance of Rawasi Aden is already running.`);
    console.error(`🌐 Access your system directly at: http://localhost:${PORT}`);
    console.error('===========================================================');
    process.exit(0);
  }
  console.error('⚠️ [Server] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ [Server] Unhandled Rejection:', reason);
});

if (require.main === module) {
  // تشغيل الخادم
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('===========================================================');
    console.log(`🚀 Rawasi Aden System Server is Running!`);
    console.log(`🌐 System URL: http://localhost:${PORT}`);
    console.log(`💼 Port:       ${PORT}`);
    console.log('===========================================================');

    // بدء خدمة الجدولة التلقائية للنسخ الاحتياطي
    try {
      const backupSchedulerService = require('./services/backupSchedulerService');
      backupSchedulerService.init().catch(err => {
        console.error('⚠️ [BackupScheduler] Error initializing scheduler:', err.message);
      });
    } catch (e) {
      console.error('⚠️ [BackupScheduler] Failed to load backupSchedulerService:', e.message);
    }
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error('===========================================================');
      console.error(`⚠️  [Port Conflict] Port ${PORT} is already running!`);
      console.error(`🌐 The system is ready at: http://localhost:${PORT}`);
      console.error('===========================================================');
      process.exit(0);
    } else {
      console.error('⚠️ [Server] Listen error:', err.message);
    }
  });

  // مؤقت للحفاظ على حيوية الخادم ومنع الإغلاق التلقائي
  setInterval(() => {}, 1000 * 60 * 60);
}

module.exports = app;
