const express = require('express');
const cors = require('cors');
const path = require('path');

// إعداد تطبيق Express
const app = express();
const PORT = process.env.PORT || 5500;

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

// خدمة الملفات الثابتة للواجهة الأمامية (HTML, CSS, JS, Images)
const publicDir = path.join(__dirname, '..');
app.use(express.static(publicDir));

// مسارات واجهات برمجة التطبيقات (API Routes)
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/purchases', require('./routes/purchases'));
app.use('/api/expenses', require('./routes/expenses'));
app.use('/api/billing', require('./routes/billing'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/accounting', require('./routes/accounting'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/clients', require('./routes/clients'));
app.use('/api/suppliers', require('./routes/suppliers'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/hr', require('./routes/hr'));
app.use('/api/project-hub', require('./routes/project_management'));
app.use('/api/project-files', require('./routes/project_files'));

// نقطة فحص صحة النظام
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    system: 'رواسي عدن للهندسة والمقاولات',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
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
