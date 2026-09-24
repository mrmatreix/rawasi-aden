const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');
const {
  query, run, get, backupDatabase, restoreDatabase, listBackups,
  createLogoutBackup, listLogoutBackups, connectionManager,
  getActiveEngine, getMysqlConfig, dbPath, initializeDatabase
} = require('../database/db');
const { runMigration } = require('../database/migrate_to_mysql');
const { requirePermission } = require('../middleware/security');

// جلب إعدادات الشركة
router.get('/', requirePermission('settings:view,settings:company'), async (req, res) => {
  try {
    const settingsRows = await query('SELECT * FROM settings');
    const settingsObj = {};
    settingsRows.forEach(row => {
      settingsObj[row.key] = row.value;
    });
    settingsObj.active_db_engine = getActiveEngine();
    res.json({ success: true, data: settingsObj });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب الإعدادات', error: err.message });
  }
});

// تحديث الإعدادات
router.post('/', requirePermission('settings:company'), async (req, res) => {
  try {
    const updates = req.body;
    for (const [key, value] of Object.entries(updates)) {
      await run(`
        INSERT INTO settings (\`key\`, \`value\`) VALUES (?, ?)
        ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`)
      `, [key, String(value)]);
    }
    res.json({ success: true, message: 'تم حفظ الإعدادات بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في حفظ الإعدادات: ' + err.message, error: err.message });
  }
});

// جلب قائمة النسخ الاحتياطية المحفوظة محلياً
router.get('/backups', requirePermission('settings:backup'), (req, res) => {
  try {
    const backups = listBackups();
    res.json({ success: true, data: backups });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب قائمة النسخ الاحتياطية', error: err.message });
  }
});

const { logAudit } = require('../services/auditService');

// إنشاء وتنزيل نسخة احتياطية من قاعدة البيانات
router.get('/backup', requirePermission('settings:backup'), async (req, res) => {
  try {
    const backup = backupDatabase();
    await logAudit(req, {
      action: 'BACKUP_DOWNLOAD',
      entity_type: 'database',
      entity_id: backup.fileName,
      details: { fileName: backup.fileName, fileSize: backup.fileSize }
    });

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
router.post('/restore-local', requirePermission('settings:backup'), async (req, res) => {
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

    await logAudit(req, {
      action: 'BACKUP_RESTORE_LOCAL',
      entity_type: 'database',
      entity_id: fileName,
      details: { fileName }
    });

    res.json({
      success: true,
      message: `تمت استعادة النسخة الاحتياطية (${fileName}) بنجاح`,
      data: result
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message, error: err.message });
  }
});

// استعادة نسخة احتياطية مرفوعة
router.post('/restore-upload', requirePermission('settings:backup'), express.raw({ type: '*/*', limit: '100mb' }), async (req, res) => {
  try {
    if (!req.body || req.body.length === 0) {
      return res.status(400).json({ success: false, message: 'لم يتم استلام أي بيانات لملف النسخة الاحتياطية' });
    }
    const result = restoreDatabase(req.body);

    await logAudit(req, {
      action: 'BACKUP_RESTORE_UPLOAD',
      entity_type: 'database',
      entity_id: 'uploaded_database_file',
      details: { bytesLength: req.body.length }
    });

    res.json({
      success: true,
      message: 'تمت استعادة قاعدة البيانات بنجاح من الملف المرفوع وتأكيد سلامة الجداول',
      data: result
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message, error: err.message });
  }
});

// =================== مسارات فحص وضبط MySQL ===================

// جلب حالة إعدادات ومحرك MySQL
router.get('/mysql-status', requirePermission('settings:view,settings:company'), async (req, res) => {
  try {
    const activeEngine = getActiveEngine();
    const mysqlCfg = getMysqlConfig();
    let isConnected = false;
    let message = '';
    let serverVersion = null;

    try {
      const conn = await mysql.createConnection({
        host: mysqlCfg.host,
        port: mysqlCfg.port,
        user: mysqlCfg.user,
        password: mysqlCfg.password,
        connectTimeout: 2000
      });
      const [vRows] = await conn.query('SELECT VERSION() as ver;');
      serverVersion = vRows && vRows[0] ? vRows[0].ver : null;
      await conn.end();
      isConnected = true;
      message = 'خادم MySQL متصل وجاهز للعمل ✅';
    } catch (e) {
      isConnected = false;
      message = `خادم MySQL غير متاح حالياً (${e.message}). النظام يعمل بنمط الاحتياط الذكي.`;
    }

    res.json({
      success: true,
      data: {
        activeEngine,
        isConnected,
        serverVersion,
        message,
        mysqlConfig: {
          host: mysqlCfg.host,
          port: mysqlCfg.port,
          user: mysqlCfg.user,
          database: mysqlCfg.database
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// فحص اتصال مخصص بخادم MySQL
router.post('/test-mysql-conn', requirePermission('settings:company'), async (req, res) => {
  try {
    const { host = 'localhost', port = 3306, user = 'root', password = '', database = 'rawasi_aden' } = req.body;
    const startTime = Date.now();

    const conn = await mysql.createConnection({
      host,
      port: Number(port) || 3306,
      user,
      password,
      connectTimeout: 3000
    });

    const [vRows] = await conn.query('SELECT VERSION() as ver, CURRENT_USER() as cur_user;');
    const latencyMs = Date.now() - startTime;
    await conn.end();

    res.json({
      success: true,
      message: `تم الاتصال بنجاح بخادم MySQL (${host}:${port}) في ${latencyMs}ms 🚀`,
      version: vRows[0]?.ver,
      user: vRows[0]?.cur_user,
      latencyMs
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      message: `تعذر الاتصال بخادم MySQL: ${err.message}`
    });
  }
});

// حفظ إعدادات MySQL في config.json وإعادة الاتصال
router.post('/save-mysql-config', requirePermission('settings:company'), async (req, res) => {
  try {
    const { host, port, user, password, database } = req.body;
    const configPath = path.join(__dirname, '..', 'database', 'config.json');
    let cfg = {};
    if (fs.existsSync(configPath)) {
      try { cfg = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '')); } catch {}
    }

    cfg.dbEngine = 'mysql';
    cfg.mysql = Object.assign(cfg.mysql || {}, {
      host: host || 'localhost',
      port: Number(port) || 3306,
      user: user || 'root',
      password: password !== undefined ? password : '',
      database: database || 'rawasi_aden'
    });

    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');

    // إعادة تهيئة المحرك
    await initializeDatabase();

    res.json({
      success: true,
      message: 'تم حفظ إعدادات MySQL بنجاح وتحديث المحرك النشط للنظام.',
      activeEngine: getActiveEngine()
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في حفظ إعدادات MySQL: ' + err.message });
  }
});

// ترحيل البيانات الحالية من SQLite إلى MySQL
router.post('/run-migration', requirePermission('settings:company'), async (req, res) => {
  try {
    await runMigration();
    res.json({
      success: true,
      message: 'تم ترحيل كافة الجداول والبيانات إلى MySQL بنجاح وبأعلى دقة.'
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء الترحيل: ' + err.message });
  }
});

// إنشاء نسخة احتياطية فورية عند تسجيل الخروج
router.post('/auto-backup-logout', async (req, res) => {
  try {
    const { username, mode, notes } = req.body || {};
    const backupItem = createLogoutBackup(username || 'user', { mode, notes });

    if (backupItem && backupItem.fileName) {
      await logAudit(req, {
        action: 'AUTO_BACKUP_LOGOUT',
        entity_type: 'database',
        entity_id: backupItem.fileName,
        details: { username: username || 'user', mode: mode || 'manual' }
      });
    }

    res.json({
      success: true,
      message: 'تم حفظ نسخة احتياطية بنجاح عند تسجيل الخروج',
      data: backupItem
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'تعذر إنشاء نسخة الخروج: ' + err.message });
  }
});

// جلب سجل نسخ الخروج الاحتياطية
router.get('/logout-backups', requirePermission('settings:backup'), (req, res) => {
  try {
    const list = listLogoutBackups();
    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
