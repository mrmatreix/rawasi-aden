const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { query, run, get, backupDatabase, restoreDatabase, listBackups, createLogoutBackup, listLogoutBackups, connectionManager, db, dbPath } = require('../database/db');

// جلب إعدادات الشركة
router.get('/', (req, res) => {
  try {
    const settingsRows = query('SELECT * FROM settings');
    const settingsObj = {};
    settingsRows.forEach(row => {
      settingsObj[row.key] = row.value;
    });
    res.json({ success: true, data: settingsObj });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب الإعدادات', error: err.message });
  }
});

// تحديث الإعدادات
router.post('/', (req, res) => {
  try {
    const updates = req.body;
    for (const [key, value] of Object.entries(updates)) {
      run(`
        INSERT INTO settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `, [key, String(value)]);
    }
    res.json({ success: true, message: 'تم حفظ الإعدادات بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في حفظ الإعدادات', error: err.message });
  }
});

// جلب قائمة النسخ الاحتياطية المحفوظة محلياً
router.get('/backups', (req, res) => {
  try {
    const backups = listBackups();
    res.json({ success: true, data: backups });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب قائمة النسخ الاحتياطية', error: err.message });
  }
});

// إنشاء وتنزيل نسخة احتياطية من قاعدة البيانات
router.get('/backup', (req, res) => {
  try {
    const backup = backupDatabase();
    res.download(backup.filePath, backup.fileName, (err) => {
      if (err) {
        console.error('Error sending backup file:', err);
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في إنشاء النسخة الاحتياطية', error: err.message });
  }
});

// استعادة نسخة احتياطية من ملف محلي على السيرفر
router.post('/restore-local', (req, res) => {
  try {
    const { fileName } = req.body;
    if (!fileName) {
      return res.status(400).json({ success: false, message: 'اسم ملف النسخة الاحتياطية مطلوب' });
    }
    const backupsDir = path.join(__dirname, '..', 'database', 'backups');
    const filePath = path.join(backupsDir, fileName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'ملف النسخة الاحتياطية غير موجود على الخادم' });
    }
    const result = restoreDatabase(filePath);
    res.json({
      success: true,
      message: `تمت استعادة النسخة الاحتياطية (${fileName}) بنجاح`,
      data: result
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message, error: err.message });
  }
});

// استعادة نسخة احتياطية مرفوعة (Raw Binary)
router.post('/restore-upload', express.raw({ type: '*/*', limit: '100mb' }), (req, res) => {
  try {
    if (!req.body || req.body.length === 0) {
      return res.status(400).json({ success: false, message: 'لم يتم استلام أي بيانات لملف النسخة الاحتياطية' });
    }
    const result = restoreDatabase(req.body);
    res.json({
      success: true,
      message: 'تمت استعادة قاعدة البيانات بنجاح من الملف المرفوع وتأكيد سلامة الجداول',
      data: result
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message, error: err.message });
  }
});

// =================== مسارات الاتصال السحابي والمحلي (Online/Offline) ===================

// جلب حالة الاتصال الحالية بقاعدة البيانات
router.get('/db-status', async (req, res) => {
  try {
    const status = connectionManager.getStatus();
    const lastBackupRow = get ? get("SELECT value FROM settings WHERE key = 'last_logout_backup'") : null;
    let lastLogoutBackup = null;
    if (lastBackupRow && lastBackupRow.value) {
      try { lastLogoutBackup = JSON.parse(lastBackupRow.value); } catch {}
    }
    res.json({
      success: true,
      data: {
        ...status,
        lastLogoutBackup
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في قراءة حالة الاتصال', error: err.message });
  }
});

// فحص واختبار الاتصال بالسيرفر السحابي
router.post('/test-online-db', async (req, res) => {
  try {
    const { url } = req.body;
    const testResult = await connectionManager.verifyOnlineConnection(url);
    res.json({
      success: testResult.success,
      data: testResult
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في فحص الاتصال', error: err.message });
  }
});

// حفظ وتحديث إعدادات الاتصال السحابي
router.post('/update-db-config', async (req, res) => {
  try {
    const { mode, onlineUrl, apiKey } = req.body;
    connectionManager.updateConfig(db, { mode, onlineUrl, apiKey });
    const verifyResult = await connectionManager.verifyOnlineConnection();
    res.json({
      success: true,
      message: 'تم حفظ إعدادات الاتصال بنجاح',
      data: {
        ...connectionManager.getStatus(),
        verifyResult
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في حفظ إعدادات الاتصال', error: err.message });
  }
});

// =================== مسارات النسخ الاحتياطي التلقائي عند تسجيل الخروج ===================

// إنشاء نسخة احتياطية فورية عند تسجيل الخروج
router.post('/auto-backup-logout', (req, res) => {
  try {
    const { username, mode, notes } = req.body || {};
    const backupItem = createLogoutBackup(username || 'user', { mode, notes });
    res.json({
      success: true,
      message: 'تم حفظ نسخة احتياطية بنجاح عند تسجيل الخروج وتجميد كافة التعديلات الأخيرة',
      data: backupItem
    });
  } catch (err) {
    console.error('Error creating logout backup:', err);
    res.status(500).json({ success: false, message: 'تعذر إنشاء نسخة الخروج الاحتياطية: ' + err.message });
  }
});

// إغلاق النظام وأخذ نسخة احتياطية عند إغلاق النافذة من X
router.post('/shutdown-app', (req, res) => {
  try {
    const { username, mode, notes } = req.body || {};
    const backupItem = createLogoutBackup(username || 'admin', {
      mode: mode || 'offline',
      notes: notes || 'نسخة احتياطية تلقائية عند إغلاق النافذة (زر X)'
    });
    res.json({
      success: true,
      message: 'تم حفظ نسخة احتياطية بنجاح وإغلاق النظام.',
      data: backupItem
    });

    // حفظ نسخة احتياطية آمنة دون إيقاف الخادم لمنع تعطل النظام عند تحديث الصفحة في المتصفح (F5 أو إعادة التحميل)
    if (req.body && req.body.forceExit === true) {
      setTimeout(() => {
        process.exit(0);
      }, 1200);
    }
  } catch (err) {
    console.error('Error in shutdown-app:', err);
    res.status(500).json({ success: false, message: 'خطأ أثناء الإغلاق: ' + err.message });
  }
});

// جلب تفاصيل ومسار ملف قاعدة البيانات
router.get('/database-path', (req, res) => {
  try {
    const configPath = path.join(__dirname, '..', 'database', 'config.json');
    let cfg = {};
    if (fs.existsSync(configPath)) {
      try { cfg = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '')); } catch {}
    }
    const currentPath = dbPath;
    const exists = fs.existsSync(currentPath);
    let size = 0;
    if (exists) {
      size = fs.statSync(currentPath).size;
    }
    res.json({
      success: true,
      data: {
        currentPath,
        configuredPath: cfg.dbPath || currentPath,
        exists,
        sizeKB: (size / 1024).toFixed(1),
        isOnline: connectionManager.isOnline
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب مسار قاعدة البيانات', error: err.message });
  }
});

// حفظ وتعديل مسار ملف قاعدة البيانات
router.post('/database-path', (req, res) => {
  try {
    const { newPath } = req.body;
    if (!newPath || !newPath.trim()) {
      return res.status(400).json({ success: false, message: 'مسار قاعدة البيانات مطلوب' });
    }
    const configPath = path.join(__dirname, '..', 'database', 'config.json');
    let cfg = {};
    if (fs.existsSync(configPath)) {
      try { cfg = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '')); } catch {}
    }
    cfg.dbPath = newPath.trim();
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
    res.json({
      success: true,
      message: 'تم حفظ مسار قاعدة البيانات بنجاح في ملف الإعدادات.',
      data: cfg
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في حفظ مسار قاعدة البيانات', error: err.message });
  }
});

module.exports = router;

