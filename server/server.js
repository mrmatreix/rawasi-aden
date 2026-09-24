const express = require('express');
const cors = require('cors');
const path = require('path');

const config = require('./config/environment');

// إعداد تطبيق Express
const app = express();
const PORT = config.port;

// البرمجيات الوسيطة (Middleware)
app.use(cors());
// أرشفة الماسح الضوئي ترسل PDF/صورة بصيغة Base64 (حتى 25MB)،
// لذلك نحتاج هامشاً فوق الحجم الأصلي بسبب زيادة Base64 بنحو الثلث.
app.use(express.json({ limit: '40mb' }));
app.use(express.text({ type: ['text/plain', 'application/json'], limit: '40mb' }));
app.use(express.urlencoded({ extended: true, limit: '40mb' }));
app.use((req, res, next) => {
  if (typeof req.body === 'string') {
    try { req.body = JSON.parse(req.body); } catch {}
  }
  next();
});

const { verifyCsrfToken, requireAuth } = require('./middleware/security');

// خدمة الملفات الثابتة للواجهة الأمامية (HTML, CSS, JS, Images)
const publicDir = path.join(__dirname, '..');
app.use(express.static(publicDir));

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
