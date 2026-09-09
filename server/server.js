const express = require('express');
const cors = require('cors');
const path = require('path');

// إعداد تطبيق Express
const app = express();
const PORT = process.env.PORT || 5500;

// البرمجيات الوسيطة (Middleware)
app.use(cors());
app.use(express.json());
app.use(express.text({ type: ['text/plain', 'application/json'] }));
app.use(express.urlencoded({ extended: true }));
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
app.use('/api/project-hub', require('./routes/project_management'));

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
  console.log(`💼 Port: ${PORT}`);
  console.log('===========================================================');
});

// مؤقت للحفاظ على حيوية الخادم ومنع الإغلاق التلقائي
setInterval(() => {}, 1000 * 60 * 60);

