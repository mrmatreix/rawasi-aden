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
const unifiedBackupEngine = require('../services/unifiedBackupEngine');


const runtime=require('../config/environment');
const secretSetting=key=>/(password|passphrase|credential|secret|token|api.?key|private.?key|encryption.?key|online_db_key)/i.test(key);
const publicCloudConfig=config=>({...config,authToken:'',authTokenConfigured:Boolean(config.authToken)});
router.use((req,res,next)=>{
  if((runtime.isProd||runtime.isStaging)&&req.method!=='GET'&&['/save-mysql-config','/run-migration','/restore-local','/restore-upload','/backup/restore-production','/cloud-backup/restore'].includes(req.path))return res.status(409).json({success:false,message:'هذه العملية تتطلب صيانة منفصلة واعتماداً خارج واجهة الإنتاج'});
  next();
});
// جلب إعدادات الشركة
router.get('/', requirePermission('settings:view,settings:company'), async (req, res) => {
  try {
    const settingsRows = await query('SELECT * FROM settings');
    const settingsObj = {};
    settingsRows.forEach(row => {
      if(!secretSetting(row.key)) settingsObj[row.key] = row.value;
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
    const engine = getActiveEngine();
    for (const [key, value] of Object.entries(updates)) {
      if(secretSetting(key)||/(?:db_engine|db_mode|online_db_url|projects_base_folder|backup.*path)/i.test(key))return res.status(400).json({success:false,message:'استخدم واجهة الإعداد المتخصصة لهذه القيمة'});
      if (engine === 'sqlite') {
        await run(`
          INSERT INTO settings (\`key\`, \`value\`) VALUES (?, ?)
          ON CONFLICT(\`key\`) DO UPDATE SET \`value\` = excluded.\`value\`
        `, [key, String(value)]);
      } else {
        await run(`
          INSERT INTO settings (\`key\`, \`value\`) VALUES (?, ?)
          ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`)
        `, [key, String(value)]);
      }
    }
    res.json({ success: true, message: 'تم حفظ الإعدادات بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في حفظ الإعدادات: ' + err.message, error: err.message });
  }
});

// Saved print-template profiles. They complement the global printing settings
// with reusable official/internal/customer layouts and an auditable history.
async function ensurePrintTemplateTables() {
  if (getActiveEngine() === 'mysql') {
    await run(`CREATE TABLE IF NOT EXISTS print_template_profiles (
      id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL UNIQUE,
      config TEXT NOT NULL, created_by VARCHAR(100), created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);
    await run(`CREATE TABLE IF NOT EXISTS print_template_audit (
      id INT AUTO_INCREMENT PRIMARY KEY, profile_name VARCHAR(100), action VARCHAR(30), actor VARCHAR(100), created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
  } else {
    await run(`CREATE TABLE IF NOT EXISTS print_template_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, config TEXT NOT NULL,
      created_by TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(`CREATE TABLE IF NOT EXISTS print_template_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT, profile_name TEXT, action TEXT, actor TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
  }
}

router.get('/print-profiles', requirePermission('settings:company'), async (req, res) => {
  try {
    await ensurePrintTemplateTables();
    const profiles = await query('SELECT id, name, created_by, created_at, updated_at FROM print_template_profiles ORDER BY updated_at DESC');
    const audit = await query('SELECT profile_name, action, actor, created_at FROM print_template_audit ORDER BY id DESC LIMIT 8');
    res.json({ success: true, data: profiles, audit });
  } catch (err) { res.status(500).json({ success: false, message: 'تعذر جلب قوالب الطباعة: ' + err.message }); }
});

router.get('/print-profiles/:id', requirePermission('settings:company'), async (req, res) => {
  try {
    await ensurePrintTemplateTables();
    const profile = await get('SELECT id, name, config FROM print_template_profiles WHERE id = ?', [Number(req.params.id)]);
    if (!profile) return res.status(404).json({ success: false, message: 'قالب الطباعة غير موجود' });
    await run('INSERT INTO print_template_audit (profile_name, action, actor) VALUES (?, ?, ?)', [profile.name, 'apply', req.user.username]);
    res.json({ success: true, data: { id: profile.id, name: profile.name, config: JSON.parse(profile.config) } });
  } catch (err) { res.status(500).json({ success: false, message: 'تعذر تطبيق قالب الطباعة: ' + err.message }); }
});

router.post('/print-profiles', requirePermission('settings:company'), async (req, res) => {
  try {
    await ensurePrintTemplateTables();
    const name = String(req.body?.name || '').trim().slice(0, 100);
    const config = req.body?.config;
    if (!name || !config || typeof config !== 'object') return res.status(400).json({ success: false, message: 'اسم القالب وإعداداته مطلوبان' });
    const payload = JSON.stringify(config);
    const current = await get('SELECT id FROM print_template_profiles WHERE name = ?', [name]);
    if (current) await run('UPDATE print_template_profiles SET config = ?, created_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [payload, req.user.username, current.id]);
    else await run('INSERT INTO print_template_profiles (name, config, created_by) VALUES (?, ?, ?)', [name, payload, req.user.username]);
    await run('INSERT INTO print_template_audit (profile_name, action, actor) VALUES (?, ?, ?)', [name, current ? 'update' : 'create', req.user.username]);
    res.json({ success: true, message: `تم حفظ قالب الطباعة «${name}»` });
  } catch (err) { res.status(500).json({ success: false, message: 'تعذر حفظ قالب الطباعة: ' + err.message }); }
});

// =========================================================================
// منظومة إدارة النسخ الاحتياطي واستعادة البيانات الموحدة (Disaster Recovery Engine)
// =========================================================================

// 1. استخراج حالة المنظومة ومؤشرات DR للوحة التحكم
router.get('/backup/dr-status', requirePermission('settings:backup'), async (req, res) => {
  try {
    const status = await unifiedBackupEngine.getDashboardStatus();
    res.json({ success: true, data: status });
  } catch (err) {
    res.status(500).json({ success: false, message: 'تعذر جلب حالة منظومة النسخ والاستعادة: ' + err.message });
  }
});

// 2. إنشاء نسخة احتياطية فورية معتمدة وفق دورة الحياة الكاملة
router.post('/backup/create', requirePermission('settings:backup'), async (req, res) => {
  try {
    const { scope, encrypt, passphrase, isProtected, protectedReason } = req.body || {};
    const result = await unifiedBackupEngine.createBackup({
      backupType: 'manual',
      scope: scope || 'database_only',
      encrypt: Boolean(encrypt),
      passphrase: passphrase || '',
      isProtected: Boolean(isProtected),
      protectedReason: protectedReason || '',
      user: req.user?.username || 'admin',
      req
    });

    res.json({
      success: true,
      message: result.encrypted
        ? `تم إنشاء النسخة الاحتياطية وتشفيرها بنجاح 🔒 (${result.fileName})`
        : `تم إنشاء النسخة الاحتياطية واعتمادها بنجاح 🛡️ (${result.fileName})`,
      data: result
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'فشل إنشاء النسخة الاحتياطية: ' + err.message });
  }
});

// 3. جلب قائمة سجلات النسخ الاحتياطية من جدول backup_records
router.get('/backup/records', requirePermission('settings:backup'), async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const records = await query(`
      SELECT * FROM backup_records 
      WHERE status != 'purged'
      ORDER BY created_at DESC 
      LIMIT ?
    `, [limit]);

    res.json({ success: true, data: records });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب سجلات النسخ الاحتياطية: ' + err.message });
  }
});

// 4. إجراء اختبار استعادة تجريبي في بيئة معزولة (Sandbox Test Restore)
router.post('/backup/test-restore', requirePermission('settings:backup'), async (req, res) => {
  try {
    const { backupId, passphrase } = req.body || {};
    if (!backupId) {
      return res.status(400).json({ success: false, message: 'يرجى تحديد النسخة المراد اختبارها' });
    }

    const testReport = await unifiedBackupEngine.runSandboxTestRestore(
      backupId,
      passphrase || null,
      req.user?.username || 'admin'
    );

    res.json({
      success: true,
      message: `اجتازت النسخة الاحتياطية اختبار الاستعادة بنجاح في البيئة المعزولة (${testReport.fileName}) 🧪✅`,
      data: testReport
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// 5. استعادة آمنة إلى قاعدة الإنتاج مع إنشاء نقطة تراجع طارئة وتراجع تلقائي
router.post('/backup/restore-production', requirePermission('settings:backup'), async (req, res) => {
  try {
    const { backupId, passphrase, reason, confirmationText } = req.body || {};

    if (!backupId) {
      return res.status(400).json({ success: false, message: 'يرجى تحديد النسخة المراد استعادتها' });
    }

    // التأكيد الإلزامي لمنع الخطأ البشري
    const cleanConfirm = String(confirmationText || '').trim();
    if (cleanConfirm !== 'استعادة' && cleanConfirm !== 'RESTORE') {
      return res.status(400).json({
        success: false,
        message: 'لتأكيد الاستعادة الإنتاجية واستبدال البيانات، يجب كتابة كلمة (استعادة) صراحة في حقل التأكيد'
      });
    }

    const result = await unifiedBackupEngine.restoreToProduction(backupId, {
      passphrase: passphrase || null,
      reason: reason || 'استعادة إنتاجية بطلب من المستخدم',
      user: req.user?.username || 'admin',
      req
    });

    res.json({
      success: true,
      message: result.message,
      data: result
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 6. حماية نسخة معينة من التدوير والحذف التلقائي
router.post('/backup/protect', requirePermission('settings:backup'), async (req, res) => {
  try {
    const { backupId, isProtected, reason } = req.body || {};
    if (!backupId) {
      return res.status(400).json({ success: false, message: 'يرجى تحديد النسخة' });
    }

    const result = await unifiedBackupEngine.toggleProtection(
      backupId,
      Boolean(isProtected),
      reason || '',
      req.user?.username || 'admin'
    );

    res.json({
      success: true,
      message: isProtected ? 'تم تثبيت وحماية النسخة الاحتياطية من الحذف التلقائي 📌' : 'تم فك حماية النسخة الاحتياطية',
      data: result
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 7. حذف نسخة احتياطية يدوياً
router.delete('/backup/records/:id', requirePermission('settings:backup'), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await unifiedBackupEngine.deleteBackup(id, req.user?.username || 'admin');
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// 8. سجلات اختبارات الاستعادة السابقة
router.get('/backup/test-logs', requirePermission('settings:backup'), async (req, res) => {
  try {
    const logs = await query(`
      SELECT * FROM backup_test_logs 
      ORDER BY created_at DESC 
      LIMIT 30
    `);
    res.json({ success: true, data: logs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 9. تنزيل نسخة احتياطية مسجلة بالمعرف أو الاسم مع حماية وتدقيق
router.get('/backup/download-record/:idOrName', requirePermission('settings:backup'), async (req, res) => {
  try {
    const { idOrName } = req.params;
    let rec = null;
    if (/^\d+$/.test(idOrName)) {
      rec = await get('SELECT * FROM backup_records WHERE id = ?', [idOrName]);
    } else {
      rec = await get('SELECT * FROM backup_records WHERE file_name = ? OR backup_uid = ?', [idOrName, idOrName]);
    }

    let filePath = null;
    let fileName = null;

    if (rec && fs.existsSync(rec.file_path)) {
      filePath = rec.file_path;
      fileName = rec.file_name;
    } else {
      const safeName = path.basename(idOrName);
      const candidate = path.join(unifiedBackupEngine.defaultStorageDir, safeName);
      if (fs.existsSync(candidate)) {
        filePath = candidate;
        fileName = safeName;
      }
    }

    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'ملف النسخة الاحتياطية المطلوب غير موجود على الخادم' });
    }

    await logAudit(req, {
      action: 'BACKUP_RECORD_DOWNLOAD',
      entity_type: 'backup_records',
      entity_id: fileName,
      details: { fileName, filePath }
    });

    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.download(filePath, fileName);
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء تنزيل النسخة: ' + err.message });
  }
});

// جلب قائمة النسخ الاحتياطية المحفوظة محلياً (التوافق مع المسار القديم)
router.get('/backups', requirePermission('settings:backup'), (req, res) => {
  try {
    const backups = listBackups();
    res.json({ success: true, data: backups });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب قائمة النسخ الاحتياطية', error: err.message });
  }
});

const { logAudit } = require('../services/auditService');

// إنشاء وتنزيل نسخة احتياطية فورية معتمدة عبر المحرك المركزي الموحد
router.get('/backup', requirePermission('settings:backup'), async (req, res) => {
  try {
    // نستخدم المحرك المركزي الموحد لضمان checkpoint والتحقق من النزاهة وحساب sha256
    const backup = await unifiedBackupEngine.createBackup({
      backupType: 'manual',
      scope: 'database_only',
      user: req.user?.username || 'admin',
      req
    });

    try {
      await logAudit(req, {
        action: 'BACKUP_DOWNLOAD',
        entity_type: 'database',
        entity_id: backup.fileName,
        details: { fileName: backup.fileName, fileSize: backup.fileSize, sha256: backup.sha256 }
      });
    } catch (auditErr) {
      console.warn('Audit log warning on backup download:', auditErr.message);
    }

    if (!fs.existsSync(backup.filePath)) {
      return res.status(404).json({ success: false, message: 'ملف النسخة الاحتياطية غير موجود على الخادم' });
    }

    res.setHeader('Content-Type', 'application/x-sqlite3');
    res.setHeader('X-Backup-SHA256', backup.sha256);
    res.download(backup.filePath, backup.fileName, (err) => {
      if (err) {
        console.error('Error sending backup file:', err);
        if (!res.headersSent) {
          res.status(500).json({ success: false, message: 'فشل إرسال ملف النسخة الاحتياطية: ' + err.message });
        }
      }
    });
  } catch (err) {
    console.error('Backup creation error:', err);
    res.status(500).json({ success: false, message: 'خطأ في إنشاء وتنزيل النسخة الاحتياطية: ' + err.message, error: err.message });
  }
});

// تنزيل نسخة احتياطية محددة من مجلد النسخ الاحتياطية على الخادم (التوافق مع المسار القديم)
router.get('/backups/download/:fileName', requirePermission('settings:backup'), (req, res) => {
  try {
    const { fileName } = req.params;
    const safeName = path.basename(fileName);
    const backupsDir = unifiedBackupEngine.defaultStorageDir;
    const filePath = path.join(backupsDir, safeName);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'ملف النسخة الاحتياطية المطلوب غير موجود' });
    }

    res.setHeader('Content-Type', 'application/x-sqlite3');
    res.download(filePath, safeName, (err) => {
      if (err) {
        console.error('Error downloading backup file:', err);
        if (!res.headersSent) {
          res.status(500).json({ success: false, message: 'خطأ في تنزيل الملف' });
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء تنزيل النسخة: ' + err.message });
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
    const backupItem = await createLogoutBackup(username || 'user', { mode, notes });

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

// =================== الجدولة التلقائية للنسخ الاحتياطي (Scheduled Auto-Backup) ===================
const backupSchedulerService = require('../services/backupSchedulerService');

// جلب حالة الجدولة التلقائية الحالية (مفتوح لكافة المستخدمين المصرحين لتحديث الهيدر)
router.get('/auto-backup/status', async (req, res) => {
  try {
    const status = backupSchedulerService.getStatus();
    res.json({ success: true, data: status });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب حالة الجدولة التلقائية: ' + err.message });
  }
});

// حفظ وتحديث إعدادات الجدولة التلقائية والمسار
router.post('/auto-backup/config', requirePermission('settings:backup'), async (req, res) => {
  try {
    const result = await backupSchedulerService.saveConfig(req.body, req.user?.username || 'admin', req);
    res.json({
      success: true,
      message: 'تم حفظ وتطبيق إعدادات الجدولة التلقائية ومسار التخزين بنجاح 🛡️',
      data: result
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في حفظ إعدادات الجدولة: ' + err.message });
  }
});

// تشغيل نسخة احتياطية مجدولة فوراً الآن
router.post('/auto-backup/run-now', requirePermission('settings:backup'), async (req, res) => {
  try {
    const result = await backupSchedulerService.executeBackup('manual_instant', req.user?.username || 'admin', req);
    res.json({
      success: true,
      message: `تم إنشاء النسخة التلقائية المجدولة بنجاح وحفظها بالمسار المحدد (${result.fileName}) 🚀`,
      data: result
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'فشل تنفيذ النسخ التلقائي الآن: ' + err.message });
  }
});

// اختبار وفحص مسار التخزين المخصص
router.post('/auto-backup/test-path', requirePermission('settings:backup'), (req, res) => {
  try {
    const { path: testPath } = req.body || {};
    const result = backupSchedulerService.testStoragePath(testPath);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء اختبار المسار: ' + err.message });
  }
});

// =================== محرك النسخ الاحتياطي السحابي المشفر والأرشفة الشاملة ===================
const cloudBackupCryptoService = require('../services/cloudBackupCryptoService');

// جلب حالة الخزنة السحابية وإعدادات التشفير
router.get('/cloud-backup/status', requirePermission('settings:backup'), async (req, res) => {
  try {
    const config = await cloudBackupCryptoService.getCloudConfig();
    const vaultItems = cloudBackupCryptoService.listVaultItems();
    const stats = await cloudBackupCryptoService.getSystemSummaryStats();

    res.json({
      success: true,
      config: publicCloudConfig(config),
      vaultItems,
      systemStats: stats
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'تعذر جلب حالة الخزنة السحابية: ' + err.message });
  }
});

// حفظ إعدادات المزامنة السحابية
router.post('/cloud-backup/config', requirePermission('settings:backup'), async (req, res) => {
  try {
    const updated = await cloudBackupCryptoService.saveCloudConfig(req.body, req.user?.username || 'admin', req);
    res.json({
      success: true,
      message: 'تم حفظ إعدادات المزامنة السحابية بنجاح ☁️💾',
      config: publicCloudConfig(updated)
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'تعذر حفظ إعدادات المزامنة السحابية: ' + err.message });
  }
});

// اختبار الاتصال بالسيرفر أو المجلد السحابي
router.post('/cloud-backup/test-connection', requirePermission('settings:backup'), async (req, res) => {
  try {
    const result = await cloudBackupCryptoService.testCloudConnection(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: 'فشل اختبار الاتصال السحابي: ' + err.message });
  }
});

// توليد مفتاح أمان تشفير فائق القوة
router.get('/cloud-backup/generate-key', requirePermission('settings:backup'), (req, res) => {
  try {
    const key = cloudBackupCryptoService.generateSecureKey(24);
    res.json({ success: true, key });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// إنشاء أرشيف شامل للنظام (مشفر أو عادي)
router.post('/cloud-backup/create-archive', requirePermission('settings:backup'), async (req, res) => {
  try {
    const { encrypt, passphrase, includeProjectsFiles } = req.body || {};
    const result = await cloudBackupCryptoService.createFullSystemArchive({
      encrypt: Boolean(encrypt),
      passphrase: passphrase || '',
      includeProjectsFiles: includeProjectsFiles !== undefined ? Boolean(includeProjectsFiles) : true,
      user: req.user?.username || 'admin',
      req
    });

    res.json({
      success: true,
      message: result.encrypted 
        ? `تم إنشاء الأرشيف الشامل وتشفيره عسكرياً بنجاح (AES-256-GCM) 🔒 (${result.fileName})`
        : `تم إنشاء الأرشيف الشامل للنظام بنجاح 📦 (${result.fileName})`,
      data: {
        fileName: result.fileName,
        fileSize: result.fileSize,
        rawZipSize: result.rawZipSize,
        encrypted: result.encrypted,
        sha256: result.sha256,
        timestamp: result.timestamp
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'فشل إنشاء الأرشيف: ' + err.message });
  }
});

// تنزيل ملف أرشيف أو نسخة من الخزنة
router.get('/cloud-backup/download/:fileName', requirePermission('settings:backup'), (req, res) => {
  try {
    const { fileName } = req.params;
    // التحقق من أمان اسم الملف ومنع Path Traversal
    const safeName = path.basename(fileName);
    const filePath = path.join(cloudBackupCryptoService.vaultDir, safeName);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'الملف المطلوب غير موجود في الخزنة' });
    }

    res.download(filePath, safeName, (err) => {
      if (err) {
        console.error('Error downloading vault archive:', err);
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء تنزيل الملف: ' + err.message });
  }
});

// فحص ومعاينة الأرشيف قبل الاستعادة (Inspection)
router.post('/cloud-backup/inspect', requirePermission('settings:backup'), express.raw({ type: '*/*', limit: '150mb' }), (req, res) => {
  try {
    const passphrase = req.headers['x-passphrase'] ? decodeURIComponent(req.headers['x-passphrase']) : null;
    const fileName = req.headers['x-vault-filename'] || null;

    let targetBufferOrPath;
    if (Buffer.isBuffer(req.body) && req.body.length > 0) {
      targetBufferOrPath = req.body;
    } else if (fileName) {
      const safeName = path.basename(fileName);
      targetBufferOrPath = path.join(cloudBackupCryptoService.vaultDir, safeName);
    } else {
      return res.status(400).json({ success: false, message: 'يرجى إرسال ملف الأرشيف أو اختيار نسخة من الخزنة' });
    }

    const inspection = cloudBackupCryptoService.inspectArchive(targetBufferOrPath, passphrase);
    res.json({ success: true, data: inspection });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// استعادة النظام من أرشيف الخزنة أو من ملف مرفوع
router.post('/cloud-backup/restore', requirePermission('settings:backup'), express.raw({ type: '*/*', limit: '150mb' }), async (req, res) => {
  try {
    const passphrase = req.headers['x-passphrase'] ? decodeURIComponent(req.headers['x-passphrase']) : null;
    const restoreFiles = req.headers['x-restore-files'] !== 'false';
    const vaultFileName = req.headers['x-vault-filename'] || null;

    let targetBufferOrPath;
    if (Buffer.isBuffer(req.body) && req.body.length > 0) {
      targetBufferOrPath = req.body;
    } else if (vaultFileName) {
      const safeName = path.basename(vaultFileName);
      targetBufferOrPath = path.join(cloudBackupCryptoService.vaultDir, safeName);
    } else {
      return res.status(400).json({ success: false, message: 'يرجى تقديم ملف الأرشيف أو تحديد ملف من الخزنة' });
    }

    const result = await cloudBackupCryptoService.restoreFullSystemArchive(targetBufferOrPath, {
      passphrase,
      restoreFiles,
      user: req.user?.username || 'admin',
      req
    });

    res.json({
      success: true,
      message: result.message,
      data: result
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'فشلت عملية استعادة الأرشيف: ' + err.message });
  }
});

// مزامنة فورية إلى السحابة
router.post('/cloud-backup/sync-now', requirePermission('settings:backup'), async (req, res) => {
  try {
    const { fileName } = req.body || {};
    let result;
    if (fileName) {
      result = await cloudBackupCryptoService.syncArchiveToCloud(path.basename(fileName));
    } else {
      result = await cloudBackupCryptoService.syncLatestBackupToCloud();
    }
    res.json({
      success: true,
      message: result.message,
      data: result
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'تعذر إتمام المزامنة السحابية: ' + err.message });
  }
});

module.exports = router;
