const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const connectionManager = require('./connectionManager');

const configPath = path.join(__dirname, 'config.json');

function resolveDatabasePath() {
  if (process.env.RAWASI_DB_PATH && process.env.RAWASI_DB_PATH.trim()) {
    return path.isAbsolute(process.env.RAWASI_DB_PATH)
      ? process.env.RAWASI_DB_PATH
      : path.join(__dirname, '..', '..', process.env.RAWASI_DB_PATH);
  }

  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '');
      const cfg = JSON.parse(raw);
      if (cfg.dbPath && cfg.dbPath.trim()) {
        return path.isAbsolute(cfg.dbPath)
          ? cfg.dbPath
          : path.join(__dirname, '..', '..', cfg.dbPath);
      }
    } catch (e) {
      console.warn('Config load note:', e.message);
    }
  }

  return path.join(__dirname, 'rawasi_aden.db');
}

let dbPath = resolveDatabasePath();
const schemaPath = path.join(__dirname, 'schema.sql');

// Ensure database parent directory exists
const parentDir = path.dirname(dbPath);
if (!fs.existsSync(parentDir)) {
  fs.mkdirSync(parentDir, { recursive: true });
}

let db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON;');

// Initialize schema if not initialized
function initSchema() {
  if (fs.existsSync(schemaPath)) {
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schemaSql);
  }

  // Safe migration for permissions and session tracking columns in users table
  try {
    const cols = db.prepare("PRAGMA table_info(users)").all();
    const colNames = cols.map(c => c.name);
    if (!colNames.includes('permissions')) {
      db.exec("ALTER TABLE users ADD COLUMN permissions TEXT;");
    }
    if (!colNames.includes('is_logged_in')) {
      db.exec("ALTER TABLE users ADD COLUMN is_logged_in INTEGER DEFAULT 0;");
    }
    if (!colNames.includes('session_token')) {
      db.exec("ALTER TABLE users ADD COLUMN session_token TEXT;");
    }
    if (!colNames.includes('last_heartbeat')) {
      db.exec("ALTER TABLE users ADD COLUMN last_heartbeat DATETIME;");
    }
    if (!colNames.includes('last_login_at')) {
      db.exec("ALTER TABLE users ADD COLUMN last_login_at DATETIME;");
    }
    if (!colNames.includes('last_login_ip')) {
      db.exec("ALTER TABLE users ADD COLUMN last_login_ip TEXT;");
    }
    if (!colNames.includes('last_login_device')) {
      db.exec("ALTER TABLE users ADD COLUMN last_login_device TEXT;");
    }
  } catch (e) {
    console.warn('Migration note (users session tracking):', e.message);
  }

  // Safe migration for currency column in financial tables
  const tablesWithCurrency = ['payments', 'expenses', 'custodies', 'projects', 'items', 'bills', 'clients', 'suppliers', 'cash_movements', 'purchases'];
  tablesWithCurrency.forEach(tableName => {
    try {
      const cols = db.prepare(`PRAGMA table_info(${tableName})`).all();
      const hasCurrency = cols.some(c => c.name === 'currency');
      if (!hasCurrency) {
        db.exec(`ALTER TABLE ${tableName} ADD COLUMN currency TEXT DEFAULT 'ر.ي';`);
      }
    } catch (e) {
      console.warn(`Migration note (${tableName}.currency):`, e.message);
    }
  });

  // Check if database is freshly created (no users) and seed default admin accounts
  try {
    const userCountRow = db.prepare("SELECT count(*) as count FROM users").get();
    if (!userCountRow || userCountRow.count === 0) {
      console.log('🌱 قاعدة بيانات جديدة تم اكتشافها - جاري تهيئة الحسابات والإعدادات الافتراضية...');
      const bcrypt = require('bcryptjs');
      const salt = bcrypt.genSaltSync(10);
      const adminHash = bcrypt.hashSync('admin123', salt);
      const accountantHash = bcrypt.hashSync('account123', salt);

      db.exec(`
        INSERT OR IGNORE INTO roles (id, name, display_name, permissions) VALUES 
        (1, 'admin', 'المدير العام', 'all'),
        (2, 'accountant', 'المحاسب المالي', 'accounting,reports,payments,billing'),
        (3, 'project_manager', 'مدير المشاريع', 'projects,inventory,expenses'),
        (4, 'storekeeper', 'أمين المخزن', 'inventory,items');
      `);

      const insertUser = db.prepare('INSERT INTO users (username, password_hash, full_name, role_id, role, email, phone, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      insertUser.run('admin', adminHash, 'المدير العام', 1, 'admin', 'aalwi@engineer.com', '772332164', 'active');
      insertUser.run('accountant', accountantHash, 'المحاسب المالي', 2, 'accountant', 'accountant@rawasiaden.com', '781278157', 'active');

      const insertSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value, description) VALUES (?, ?, ?)');
      insertSetting.run('company_name', 'رواسي عدن للهندسة والمقاولات', 'اسم الشركة بالعربي');
      insertSetting.run('company_name_en', 'Rawasi Aden for Engineering & Contracting', 'اسم الشركة بالإنجليزي');
      insertSetting.run('slogan', 'نبني الحاضر لنستثمر المستقبل', 'شعار الشركة اللفظي');
      insertSetting.run('phone1', '772332164', 'رقم الهاتف الرئيسي');
      insertSetting.run('phone2', '781278157', 'رقم الهاتف الإضافي');
      insertSetting.run('email', 'aalwi@engineer.com', 'البريد الإلكتروني');
      insertSetting.run('address', 'عدن - إنماء الجديدة - خلف القطيبي', 'عنوان المركز الرئيسي');
      insertSetting.run('currency', 'ر.ي', 'العملة الافتراضية');
    }
  } catch (seedErr) {
    console.warn('Initial seed check note:', seedErr.message);
  }

  // تهيئة إعدادات الاتصال وفحص ما قبل التشغيل
  connectionManager.initFromDb(db);
  connectionManager.verifyOnlineConnection().then(status => {
    console.log(`📡 [Rawasi Aden DB] Status: ${status.isOnline ? '🟢 ONLINE (سحابي متصل)' : '🟠 OFFLINE (محلي نشط)'} - Path: ${dbPath}`);
  }).catch(e => {
    console.warn('Startup connection check note:', e.message);
  });
}

initSchema();

/**
 * Run a query returning all rows
 */
function query(sql, params = []) {
  const stmt = db.prepare(sql);
  return stmt.all(...params);
}

/**
 * Run a query returning a single row
 */
function get(sql, params = []) {
  const stmt = db.prepare(sql);
  return stmt.get(...params);
}

/**
 * Execute INSERT, UPDATE, DELETE returning { changes, lastInsertRowid }
 */
function run(sql, params = []) {
  const stmt = db.prepare(sql);
  return stmt.run(...params);
}

/**
 * Execute raw SQL script
 */
function exec(sql) {
  return db.exec(sql);
}

/**
 * Backup the database file
 */
function backupDatabase() {
  const backupsDir = path.join(__dirname, 'backups');
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFileName = `backup_rawasi_${timestamp}.db`;
  const backupFilePath = path.join(backupsDir, backupFileName);
  fs.copyFileSync(dbPath, backupFilePath);
  return { fileName: backupFileName, filePath: backupFilePath };
}

/**
 * Restore database from a file path or Buffer
 */
function restoreDatabase(sourceFilePathOrBuffer) {
  const backupsDir = path.join(__dirname, 'backups');
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }

  // 1. Create a safety backup of the current database before restoring
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safetyBackupPath = path.join(backupsDir, `safety_before_restore_${timestamp}.db`);
  if (fs.existsSync(dbPath)) {
    fs.copyFileSync(dbPath, safetyBackupPath);
  }

  try {
    // 2. Close current database instance
    if (db) {
      try {
        db.close();
      } catch (e) {
        console.warn('DB close note:', e.message);
      }
    }

    // 3. Remove WAL/SHM auxiliary files if present
    const walPath = `${dbPath}-wal`;
    const shmPath = `${dbPath}-shm`;
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);

    // 4. Overwrite active database file
    if (Buffer.isBuffer(sourceFilePathOrBuffer)) {
      fs.writeFileSync(dbPath, sourceFilePathOrBuffer);
    } else if (typeof sourceFilePathOrBuffer === 'string') {
      fs.copyFileSync(sourceFilePathOrBuffer, dbPath);
    } else {
      throw new Error('بيانات النسخة الاحتياطية غير صالحة');
    }

    // 5. Reopen database connection
    db = new DatabaseSync(dbPath);
    db.exec('PRAGMA foreign_keys = ON;');

    // 6. Verify restored database tables
    const testStmt = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'");
    const tables = testStmt.all();
    if (!tables || tables.length === 0) {
      throw new Error('الملف المستعاد لا يحتوي على جداول صالحة لنظام رواسي عدن');
    }

    return {
      success: true,
      message: 'تمت استعادة قاعدة البيانات بنجاح',
      tablesCount: tables.length,
      safetyBackup: path.basename(safetyBackupPath)
    };
  } catch (err) {
    console.error('Error during database restore:', err);

    // Rollback to safety backup
    try {
      if (fs.existsSync(safetyBackupPath)) {
        fs.copyFileSync(safetyBackupPath, dbPath);
        db = new DatabaseSync(dbPath);
        db.exec('PRAGMA foreign_keys = ON;');
      }
    } catch (rbErr) {
      console.error('Failed to rollback safety backup:', rbErr);
    }

    throw new Error('فشلت عملية استعادة النسخة الاحتياطية: ' + err.message);
  }
}

/**
 * List all backup files
 */
function listBackups() {
  const backupsDir = path.join(__dirname, 'backups');
  if (!fs.existsSync(backupsDir)) {
    return [];
  }
  const files = fs.readdirSync(backupsDir);
  const backups = [];
  files.forEach(file => {
    if (file.endsWith('.db') || file.endsWith('.sqlite')) {
      const filePath = path.join(backupsDir, file);
      const stat = fs.statSync(filePath);
      backups.push({
        fileName: file,
        size: stat.size,
        createdAt: stat.mtime
      });
    }
  });
  return backups.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/**
 * إنشاء نسخة احتياطية مخصصة وفورية عند تسجيل الخروج
 * لحفظ وتجميد أحدث تعديلات المشروع بدقة
 */
function createLogoutBackup(username = 'unknown', meta = {}) {
  const backupsDir = path.join(__dirname, 'backups');
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }

  // 1. مزامنة وتفريغ الذاكرة المؤقتة (WAL Checkpoint) لضمان كتابة كافة التعديلات على القرص
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch (e) {
    console.warn('WAL checkpoint note:', e.message);
  }

  // 2. توليد اسم ملف فريد ومعبر
  const safeUser = String(username || 'user').replace(/[^a-zA-Z0-9_\u0600-\u06FF]/g, '_');
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const backupFileName = `backup_logout_${safeUser}_${dateStr}.db`;
  const backupFilePath = path.join(backupsDir, backupFileName);

  // 3. نسخ ملف قاعدة البيانات فورياً
  fs.copyFileSync(dbPath, backupFilePath);
  const stat = fs.statSync(backupFilePath);

  // 4. تسجيل البيانات الوصفية في ملف المانيفست logout_backups_manifest.json
  const manifestPath = path.join(backupsDir, 'logout_backups_manifest.json');
  let manifest = [];
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (!Array.isArray(manifest)) manifest = [];
    } catch {
      manifest = [];
    }
  }

  const backupItem = {
    fileName: backupFileName,
    filePath: backupFilePath,
    username: username || 'مستخدم',
    timestamp: now.toISOString(),
    displayTime: now.toLocaleString('ar-YE', { dateStyle: 'medium', timeStyle: 'medium' }),
    size: stat.size,
    mode: meta.mode || (connectionManager.isOnline ? 'online' : 'offline'),
    notes: meta.notes || 'نسخة تلقائية تم إنشاؤها فور تسجيل الخروج لحفظ أحدث التعديلات'
  };

  manifest.unshift(backupItem);
  // الاحتفاظ بأحدث 50 نسخة خروج تلقائية
  if (manifest.length > 50) manifest = manifest.slice(0, 50);

  try {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  } catch (err) {
    console.warn('Failed to write logout_backups_manifest.json:', err.message);
  }

  // 5. حفظ البيانات في جدول settings لسرعة الرجوع إليها
  try {
    const stmt = db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    stmt.run('last_logout_backup', JSON.stringify(backupItem));
  } catch (e) {
    console.warn('Note updating last_logout_backup setting:', e.message);
  }

  return backupItem;
}

/**
 * جلب قائمة نسخ الخروج الاحتياطية
 */
function listLogoutBackups() {
  const backupsDir = path.join(__dirname, 'backups');
  const manifestPath = path.join(backupsDir, 'logout_backups_manifest.json');
  if (fs.existsSync(manifestPath)) {
    try {
      const list = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (Array.isArray(list)) {
        return list.filter(item => fs.existsSync(item.filePath || path.join(backupsDir, item.fileName)));
      }
    } catch {
      // fallback to folder scan
    }
  }

  if (!fs.existsSync(backupsDir)) return [];
  const files = fs.readdirSync(backupsDir);
  const list = [];
  files.forEach(f => {
    if (f.startsWith('backup_logout_') && (f.endsWith('.db') || f.endsWith('.sqlite'))) {
      const p = path.join(backupsDir, f);
      const stat = fs.statSync(p);
      const parts = f.split('_');
      list.push({
        fileName: f,
        filePath: p,
        username: parts[2] || 'مستخدم',
        timestamp: stat.mtime.toISOString(),
        displayTime: new Date(stat.mtime).toLocaleString('ar-YE'),
        size: stat.size,
        mode: 'auto',
        notes: 'نسخة تسجيل خروج محفوظة'
      });
    }
  });

  return list.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

module.exports = {
  db,
  query,
  get,
  run,
  exec,
  backupDatabase,
  restoreDatabase,
  listBackups,
  createLogoutBackup,
  listLogoutBackups,
  connectionManager,
  dbPath
};

