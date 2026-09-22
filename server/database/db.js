/**
 * وحدة إدارة قاعدة البيانات لنظام رواسي عدن للهندسة والمقاولات
 * تدعم محرك MySQL الأساسي عالي الأداء مع برك الاتصال (Connection Pooling)
 * وتدعم الـ Transactions الذرية والتبديل التلقائي الذكي إلى SQLite عند الحاجة
 */

const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const mysql = require('mysql2/promise');
const connectionManager = require('./connectionManager');

const configPath = path.join(__dirname, 'config.json');

function loadConfig() {
  const defaults = {
    dbEngine: 'mysql', // 'mysql' | 'sqlite'
    mysql: {
      host: process.env.MYSQL_HOST || 'localhost',
      port: Number(process.env.MYSQL_PORT) || 3306,
      user: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_PASSWORD || '',
      database: process.env.MYSQL_DATABASE || 'rawasi_aden',
      waitForConnections: true,
      connectionLimit: 20,
      queueLimit: 0
    },
    dbPath: 'server/database/rawasi_aden.db'
  };

  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '');
      const parsed = JSON.parse(raw);
      return Object.assign(defaults, parsed, {
        mysql: Object.assign(defaults.mysql, parsed.mysql || {})
      });
    } catch (e) {
      console.warn('Config load note:', e.message);
    }
  }

  return defaults;
}

let appConfig = loadConfig();

function resolveSqlitePath() {
  if (process.env.RAWASI_DB_PATH && process.env.RAWASI_DB_PATH.trim()) {
    return path.isAbsolute(process.env.RAWASI_DB_PATH)
      ? process.env.RAWASI_DB_PATH
      : path.join(__dirname, '..', '..', process.env.RAWASI_DB_PATH);
  }
  if (appConfig.dbPath && appConfig.dbPath.trim()) {
    return path.isAbsolute(appConfig.dbPath)
      ? appConfig.dbPath
      : path.join(__dirname, '..', '..', appConfig.dbPath);
  }
  return path.join(__dirname, 'rawasi_aden.db');
}

let sqlitePath = resolveSqlitePath();
let activeEngine = 'sqlite'; // سيتم تحديده عند التهيئة: 'mysql' أو 'sqlite'
let mysqlPool = null;
let sqliteDb = null;

// التأكد من وجود مجلد SQLite
const sqliteParent = path.dirname(sqlitePath);
if (!fs.existsSync(sqliteParent)) {
  fs.mkdirSync(sqliteParent, { recursive: true });
}

// تهيئة محرك SQLite الاحتياطي دائماً للجاهزية
function initSqliteInstance() {
  if (!sqliteDb) {
    sqliteDb = new DatabaseSync(sqlitePath);
    sqliteDb.exec('PRAGMA foreign_keys = ON;');
  }
  return sqliteDb;
}

/**
 * معالج ذكي لمواءمة استعلامات SQL بين MySQL و SQLite
 */
function normalizeSql(sql, targetEngine) {
  if (!sql || typeof sql !== 'string') return sql;
  let normalized = sql;

  if (targetEngine === 'mysql') {
    // 1. استبدال INSERT OR IGNORE بـ INSERT IGNORE
    normalized = normalized.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT IGNORE INTO');
    // 2. استبدال INSERT OR REPLACE بـ REPLACE INTO
    normalized = normalized.replace(/INSERT\s+OR\s+REPLACE\s+INTO/gi, 'REPLACE INTO');
    // 3. استبدال ON CONFLICT(key) بـ ON DUPLICATE KEY UPDATE
    normalized = normalized.replace(/ON\s+CONFLICT\s*\(\s*`?key`?\s*\)\s*DO\s+UPDATE\s+SET\s+value\s*=\s*excluded\.value/gi,
      'ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)');
    // 4. استبدال MAX(0, expr) بـ GREATEST(0, expr)
    normalized = normalized.replace(/MAX\s*\(\s*0\s*,\s*([^)]+)\)/gi, 'GREATEST(0, $1)');
    // 5. تغليف حقل key المحجوز بـ backticks إذا كان في جدول settings
    normalized = normalized.replace(/\bsettings\s*\(\s*key\s*,/gi, 'settings (`key`,');
    normalized = normalized.replace(/\bWHERE\s+key\s*=/gi, 'WHERE `key` =');
  } else {
    // في حالة SQLite
    normalized = normalized.replace(/GREATEST\s*\(\s*0\s*,\s*([^)]+)\)/gi, 'MAX(0, $1)');
    normalized = normalized.replace(/INSERT\s+IGNORE\s+INTO/gi, 'INSERT OR IGNORE INTO');
  }

  return normalized;
}

/**
 * الاتصال بمحرك MySQL مع إنشاء قاعدة البيانات والجداول تلقائياً إن لم تكن موجودة
 */
async function initMysql() {
  const mysqlCfg = appConfig.mysql;
  console.log(`📡 [Rawasi DB] Checking MySQL connection on ${mysqlCfg.host}:${mysqlCfg.port}...`);

  // 1. الاتصال بدون تحديد اسم قاعدة البيانات لضمان إنشائها أولاً
  let initConn;
  try {
    initConn = await mysql.createConnection({
      host: mysqlCfg.host,
      port: mysqlCfg.port,
      user: mysqlCfg.user,
      password: mysqlCfg.password,
      connectTimeout: 4000
    });

    await initConn.query(`CREATE DATABASE IF NOT EXISTS \`${mysqlCfg.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
    await initConn.end();
  } catch (err) {
    throw new Error(`MySQL connection failed: ${err.message}`);
  }

  // 2. إنشاء بركة الاتصال (Connection Pool)
  mysqlPool = mysql.createPool({
    host: mysqlCfg.host,
    port: mysqlCfg.port,
    user: mysqlCfg.user,
    password: mysqlCfg.password,
    database: mysqlCfg.database,
    waitForConnections: mysqlCfg.waitForConnections !== false,
    connectionLimit: mysqlCfg.connectionLimit || 20,
    queueLimit: mysqlCfg.queueLimit || 0,
    multipleStatements: true,
    charset: 'utf8mb4_unicode_ci'
  });

  // فحص الاتصال بالبركة
  const testConn = await mysqlPool.getConnection();
  testConn.release();

  // 3. التحقق من وجود الجداول وتطبيق schema_mysql.sql إن كانت جديدة
  const [rows] = await mysqlPool.query("SHOW TABLES LIKE 'users'");
  if (!rows || rows.length === 0) {
    console.log('🌱 [Rawasi DB] New MySQL database detected - Initializing 31 tables...');
    const schemaMysqlPath = path.join(__dirname, 'schema_mysql.sql');
    if (fs.existsSync(schemaMysqlPath)) {
      const schemaSql = fs.readFileSync(schemaMysqlPath, 'utf8');
      await mysqlPool.query(schemaSql);
    }
  }

  // 4. التحقق من وجود المستخدم الرئيسي الافتراضي في MySQL
  const [userCountRows] = await mysqlPool.query("SELECT count(*) as count FROM users");
  if (!userCountRows || userCountRows[0].count === 0) {
    console.log('👤 تهيئة حسابات الإدارة الافتراضية في MySQL...');
    const bcrypt = require('bcryptjs');
    const salt = bcrypt.genSaltSync(10);
    const adminHash = bcrypt.hashSync('admin123', salt);
    const accountantHash = bcrypt.hashSync('account123', salt);

    await mysqlPool.query(`
      INSERT IGNORE INTO roles (id, name, display_name, permissions) VALUES 
      (1, 'admin', 'المدير العام', 'all'),
      (2, 'accountant', 'المحاسب المالي', 'accounting,reports,payments,billing'),
      (3, 'project_manager', 'مدير المشاريع', 'projects,inventory,expenses'),
      (4, 'storekeeper', 'أمين المخزن', 'inventory,items');
    `);

    await mysqlPool.query(`
      INSERT INTO users (username, password_hash, full_name, role_id, role, email, phone, status)
      VALUES 
      ('admin', ?, 'المدير العام', 1, 'admin', 'aalwi@engineer.com', '772332164', 'active'),
      ('accountant', ?, 'المحاسب المالي', 2, 'accountant', 'accountant@rawasiaden.com', '781278157', 'active');
    `, [adminHash, accountantHash]);

    await mysqlPool.query(`
      INSERT INTO settings (\`key\`, \`value\`, description) VALUES 
      ('company_name', 'رواسي عدن للهندسة والمقاولات', 'اسم الشركة بالعربي'),
      ('company_name_en', 'Rawasi Aden for Engineering & Contracting', 'اسم الشركة بالإنجليزي'),
      ('slogan', 'نبني الحاضر لنستثمر المستقبل', 'شعار الشركة اللفظي'),
      ('phone1', '772332164', 'رقم الهاتف الرئيسي'),
      ('phone2', '781278157', 'رقم الهاتف الإضافي'),
      ('email', 'aalwi@engineer.com', 'البريد الإلكتروني'),
      ('address', 'عدن - إنماء الجديدة - خلف القطيبي', 'عنوان المركز الرئيسي'),
      ('currency', 'ر.ي', 'العملة الافتراضية')
      ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`);
    `);
  }

  // فحص حقل active_sessions و security_settings في جدول users في MySQL
  try {
    const [cols] = await mysqlPool.query("SHOW COLUMNS FROM users LIKE 'active_sessions'");
    if (!cols || cols.length === 0) {
      await mysqlPool.query("ALTER TABLE users ADD COLUMN active_sessions TEXT NULL");
    }
  } catch {}
  try {
    const [secCols] = await mysqlPool.query("SHOW COLUMNS FROM users LIKE 'security_settings'");
    if (!secCols || secCols.length === 0) {
      await mysqlPool.query("ALTER TABLE users ADD COLUMN security_settings TEXT NULL");
    }
  } catch {}
  try {
    const [pinCols] = await mysqlPool.query("SHOW COLUMNS FROM users LIKE 'two_factor_pin'");
    if (!pinCols || pinCols.length === 0) {
      await mysqlPool.query("ALTER TABLE users ADD COLUMN two_factor_pin VARCHAR(20) DEFAULT '123456'");
    }
  } catch {}
  try {
    const [tfaCols] = await mysqlPool.query("SHOW COLUMNS FROM users LIKE 'two_factor_enabled'");
    if (!tfaCols || tfaCols.length === 0) {
      await mysqlPool.query("ALTER TABLE users ADD COLUMN two_factor_enabled TINYINT(1) DEFAULT 1");
    }
  } catch {}

  // ترقية جداول MySQL التلقائية لمراكز التكلفة والشيكات والعهد
  try {
    await mysqlPool.query(`
      CREATE TABLE IF NOT EXISTS cost_centers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(200) NOT NULL,
        type VARCHAR(100) DEFAULT 'مشروع',
        project_id INT NULL,
        status VARCHAR(50) DEFAULT 'active',
        notes TEXT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    const [ccCount] = await mysqlPool.query("SELECT count(*) as count FROM cost_centers");
    if (!ccCount || ccCount[0].count === 0) {
      await mysqlPool.query(`
        INSERT IGNORE INTO cost_centers (code, name, type, notes) VALUES
        ('CC-100', 'الإدارة العامة والمصروفات المشتركة', 'إدارة عامة', 'مركز تكلفة الإدارة الرئيسية والمصروفات العمومية'),
        ('CC-200', 'المعدات والآليات والتشغيل الميداني', 'معدات وآليات', 'مركز تكلفة المحروقات وصيانة المعدات');
      `);
      await mysqlPool.query(`
        INSERT IGNORE INTO cost_centers (code, name, type, project_id, notes)
        SELECT CONCAT('CC-', LPAD(id, 3, '0')), name, 'مشروع', id, 'مركز تكلفة خاص بالمشروع'
        FROM projects;
      `);
    }

    const checkAndAddCol = async (table, col, def) => {
      const [cols] = await mysqlPool.query(`SHOW COLUMNS FROM \`${table}\` LIKE '${col}'`);
      if (!cols || cols.length === 0) {
        await mysqlPool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${col}\` ${def}`);
      }
    };

    await checkAndAddCol('expenses', 'account_id', 'INT NULL');
    await checkAndAddCol('expenses', 'cost_center_id', 'INT NULL');
    await checkAndAddCol('expenses', 'check_no', 'VARCHAR(100) NULL');
    await checkAndAddCol('expenses', 'bank_name', 'VARCHAR(150) NULL');

    await checkAndAddCol('payments', 'account_id', 'INT NULL');
    await checkAndAddCol('payments', 'cost_center_id', 'INT NULL');
    await checkAndAddCol('payments', 'check_no', 'VARCHAR(100) NULL');
    await checkAndAddCol('payments', 'bank_name', 'VARCHAR(150) NULL');

    await checkAndAddCol('journal_entry_lines', 'cost_center_id', 'INT NULL');

    await checkAndAddCol('custodies', 'custody_no', 'VARCHAR(100) NULL');
    await checkAndAddCol('custodies', 'employee_id', 'INT NULL');
    await checkAndAddCol('custodies', 'employee_no', 'VARCHAR(50) NULL');
    await checkAndAddCol('custodies', 'related_custody_id', 'INT NULL');
    await checkAndAddCol('custodies', 'related_custody_no', 'VARCHAR(100) NULL');
    await checkAndAddCol('custodies', 'status', 'VARCHAR(50) DEFAULT \'مفتوحة\'');

    await checkAndAddCol('payroll', 'journal_entry_id', 'INT NULL');

    await mysqlPool.query(`
      CREATE TABLE IF NOT EXISTS currencies (
        id INT AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(10) NOT NULL UNIQUE,
        name VARCHAR(100) NOT NULL,
        symbol VARCHAR(20) NOT NULL,
        rate_to_base DECIMAL(12,4) DEFAULT 1.0,
        is_base TINYINT(1) DEFAULT 0,
        status VARCHAR(50) DEFAULT 'active',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await mysqlPool.query(`
      INSERT IGNORE INTO currencies (code, name, symbol, rate_to_base, is_base, status) VALUES
      ('YER', 'ريال يمني', 'ر.ي', 1.0, 1, 'active'),
      ('SAR', 'ريال سعودي', 'ر.س', 535.0, 0, 'active'),
      ('USD', 'دولار أمريكي', '$', 2040.0, 0, 'active');
    `);

    await mysqlPool.query(`
      CREATE TABLE IF NOT EXISTS leave_types (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        days_allowed INT DEFAULT 30,
        is_paid TINYINT(1) DEFAULT 1,
        notes TEXT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await mysqlPool.query(`
      INSERT IGNORE INTO leave_types (name, days_allowed, is_paid, notes) VALUES
      ('إجازة سنوية اعتيادية', 30, 1, 'رصيد سنوي مدفوع الأجر بالكامل'),
      ('إجازة مرضية', 15, 1, 'بتقرير طبي معتمد مدفوعة الأجر'),
      ('إجازة طارئة وعارضة', 6, 1, 'إجازة ظروف طارئة مقتطعة من الرصيد'),
      ('إجازة بدون راتب', 90, 0, 'إجازة خاصة غير مدفوعة'),
      ('إجازة حج وعمرة', 15, 1, 'تمنح لمرة واحدة طوال الخدمة');
    `);

    await mysqlPool.query(`
      CREATE TABLE IF NOT EXISTS employee_evaluations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        employee_id INT NOT NULL,
        evaluator_name VARCHAR(150) NULL,
        period VARCHAR(100) NOT NULL,
        evaluation_date DATE NOT NULL,
        score DECIMAL(5,2) DEFAULT 100,
        rating VARCHAR(50) DEFAULT 'ممتاز',
        strengths TEXT NULL,
        improvements TEXT NULL,
        recommendations TEXT NULL,
        notes TEXT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  } catch (err) {
    console.warn('Accounting migration note (MySQL):', err.message);
  }

  activeEngine = 'mysql';
  console.log(`🐬 [Rawasi DB] MySQL engine active! Connected to [${mysqlCfg.database}] on ${mysqlCfg.host}:${mysqlCfg.port}`);
}

/**
 * تهيئة محرك SQLite الاحتياطي
 */
function initSqlite() {
  initSqliteInstance();
  const schemaPath = path.join(__dirname, 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    sqliteDb.exec(schemaSql);
  }

  // Safe migration for SQLite
  try {
    const cols = sqliteDb.prepare("PRAGMA table_info(users)").all();
    const colNames = cols.map(c => c.name);
    if (!colNames.includes('permissions')) sqliteDb.exec("ALTER TABLE users ADD COLUMN permissions TEXT;");
    if (!colNames.includes('is_logged_in')) sqliteDb.exec("ALTER TABLE users ADD COLUMN is_logged_in INTEGER DEFAULT 0;");
    if (!colNames.includes('session_token')) sqliteDb.exec("ALTER TABLE users ADD COLUMN session_token TEXT;");
    if (!colNames.includes('last_heartbeat')) sqliteDb.exec("ALTER TABLE users ADD COLUMN last_heartbeat DATETIME;");
    if (!colNames.includes('last_login_at')) sqliteDb.exec("ALTER TABLE users ADD COLUMN last_login_at DATETIME;");
    if (!colNames.includes('last_login_ip')) sqliteDb.exec("ALTER TABLE users ADD COLUMN last_login_ip TEXT;");
    if (!colNames.includes('last_login_device')) sqliteDb.exec("ALTER TABLE users ADD COLUMN last_login_device TEXT;");
    if (!colNames.includes('active_sessions')) sqliteDb.exec("ALTER TABLE users ADD COLUMN active_sessions TEXT;");
    if (!colNames.includes('security_settings')) sqliteDb.exec("ALTER TABLE users ADD COLUMN security_settings TEXT;");
    if (!colNames.includes('two_factor_pin')) sqliteDb.exec("ALTER TABLE users ADD COLUMN two_factor_pin TEXT DEFAULT '123456';");
    if (!colNames.includes('two_factor_enabled')) sqliteDb.exec("ALTER TABLE users ADD COLUMN two_factor_enabled INTEGER DEFAULT 1;");

    // مزامنة الرمز مع إعدادات المدير العام إن وجدت
    try {
      const adminPinRow = sqliteDb.prepare("SELECT value FROM settings WHERE `key` = 'admin_2fa_pin'").get();
      if (adminPinRow && adminPinRow.value) {
        sqliteDb.prepare("UPDATE users SET two_factor_pin = ? WHERE username = 'admin' AND (two_factor_pin IS NULL OR two_factor_pin = '')").run(adminPinRow.value);
      }
    } catch {}

    // ترقية مراكز التكلفة وجداول المحاسبة والشيكات والعهد
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS cost_centers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        type TEXT DEFAULT 'مشروع',
        project_id INTEGER REFERENCES projects(id),
        status TEXT DEFAULT 'active',
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const ccCount = sqliteDb.prepare("SELECT count(*) as count FROM cost_centers").get();
    if (!ccCount || ccCount.count === 0) {
      sqliteDb.exec(`
        INSERT OR IGNORE INTO cost_centers (code, name, type, notes) VALUES
        ('CC-100', 'الإدارة العامة والمصروفات المشتركة', 'إدارة عامة', 'مركز تكلفة الإدارة الرئيسية والمصروفات العمومية'),
        ('CC-200', 'المعدات والآليات والتشغيل الميداني', 'معدات وآليات', 'مركز تكلفة المحروقات وصيانة المعدات');
      `);
      sqliteDb.exec(`
        INSERT OR IGNORE INTO cost_centers (code, name, type, project_id, notes)
        SELECT 'CC-' || printf('%03d', id), name, 'مشروع', id, 'مركز تكلفة خاص بالمشروع'
        FROM projects;
      `);
    }

    const expCols = sqliteDb.prepare("PRAGMA table_info(expenses)").all().map(c => c.name);
    if (!expCols.includes('account_id')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN account_id INTEGER REFERENCES accounts(id);");
    if (!expCols.includes('cost_center_id')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN cost_center_id INTEGER REFERENCES cost_centers(id);");
    if (!expCols.includes('check_no')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN check_no TEXT;");
    if (!expCols.includes('bank_name')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN bank_name TEXT;");

    const payCols = sqliteDb.prepare("PRAGMA table_info(payments)").all().map(c => c.name);
    if (!payCols.includes('account_id')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN account_id INTEGER REFERENCES accounts(id);");
    if (!payCols.includes('cost_center_id')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN cost_center_id INTEGER REFERENCES cost_centers(id);");
    if (!payCols.includes('check_no')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN check_no TEXT;");
    if (!payCols.includes('bank_name')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN bank_name TEXT;");

    const jelCols = sqliteDb.prepare("PRAGMA table_info(journal_entry_lines)").all().map(c => c.name);
    if (!jelCols.includes('cost_center_id')) sqliteDb.exec("ALTER TABLE journal_entry_lines ADD COLUMN cost_center_id INTEGER REFERENCES cost_centers(id);");

    const custCols = sqliteDb.prepare("PRAGMA table_info(custodies)").all().map(c => c.name);
    if (!custCols.includes('custody_no')) sqliteDb.exec("ALTER TABLE custodies ADD COLUMN custody_no TEXT;");
    if (!custCols.includes('employee_id')) sqliteDb.exec("ALTER TABLE custodies ADD COLUMN employee_id INTEGER REFERENCES employees(id);");
    if (!custCols.includes('employee_no')) sqliteDb.exec("ALTER TABLE custodies ADD COLUMN employee_no TEXT;");
    if (!custCols.includes('related_custody_id')) sqliteDb.exec("ALTER TABLE custodies ADD COLUMN related_custody_id INTEGER REFERENCES custodies(id);");
    if (!custCols.includes('related_custody_no')) sqliteDb.exec("ALTER TABLE custodies ADD COLUMN related_custody_no TEXT;");
    if (!custCols.includes('status')) sqliteDb.exec("ALTER TABLE custodies ADD COLUMN status TEXT DEFAULT 'مفتوحة';");

    sqliteDb.exec(`
      UPDATE custodies SET custody_no = 'CST-2024-' || printf('%04d', id) WHERE custody_no IS NULL OR custody_no = '';
    `);

    // ترقية جداول الإدارات المؤسسية الـ 7:
    // 1. جدول العملات وأسعار الصرف
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS currencies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        symbol TEXT NOT NULL,
        rate_to_base REAL DEFAULT 1.0,
        is_base INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    const curCount = sqliteDb.prepare("SELECT COUNT(*) as cnt FROM currencies").get();
    if (!curCount || curCount.cnt === 0) {
      sqliteDb.exec(`
        INSERT OR IGNORE INTO currencies (code, name, symbol, rate_to_base, is_base, status) VALUES
        ('YER', 'ريال يمني', 'ر.ي', 1.0, 1, 'active'),
        ('SAR', 'ريال سعودي', 'ر.س', 535.0, 0, 'active'),
        ('USD', 'دولار أمريكي', '$', 2040.0, 0, 'active');
      `);
    }

    // 2. جدول أنواع الإجازات
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS leave_types (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        days_allowed INTEGER DEFAULT 30,
        is_paid INTEGER DEFAULT 1,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    const ltCount = sqliteDb.prepare("SELECT COUNT(*) as cnt FROM leave_types").get();
    if (!ltCount || ltCount.cnt === 0) {
      sqliteDb.exec(`
        INSERT OR IGNORE INTO leave_types (name, days_allowed, is_paid, notes) VALUES
        ('إجازة سنوية اعتيادية', 30, 1, 'رصيد سنوي مدفوع الأجر بالكامل'),
        ('إجازة مرضية', 15, 1, 'بتقرير طبي معتمد مدفوعة الأجر'),
        ('إجازة طارئة وعارضة', 6, 1, 'إجازة ظروف طارئة مقتطعة من الرصيد'),
        ('إجازة بدون راتب', 90, 0, 'إجازة خاصة غير مدفوعة'),
        ('إجازة حج وعمرة', 15, 1, 'تمنح لمرة واحدة طوال الخدمة');
      `);
    }

    // 3. جدول تقييم أداء الموظفين
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS employee_evaluations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL REFERENCES employees(id),
        evaluator_name TEXT,
        period TEXT NOT NULL,
        evaluation_date DATE NOT NULL,
        score REAL DEFAULT 100,
        rating TEXT DEFAULT 'ممتاز',
        strengths TEXT,
        improvements TEXT,
        recommendations TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 4. ربط مسير الرواتب برقم القيد اليومي عند الترحيل المحاسبي
    const prCols = sqliteDb.prepare("PRAGMA table_info(payroll)").all().map(c => c.name);
    if (!prCols.includes('journal_entry_id')) {
      sqliteDb.exec("ALTER TABLE payroll ADD COLUMN journal_entry_id INTEGER REFERENCES journal_entries(id);");
    }

    // 5. تهيئة عينة لمشاريع تحت الدراسة إن لم تكن موجودة
    const studyProj = sqliteDb.prepare("SELECT COUNT(*) as cnt FROM projects WHERE status = 'under_study'").get();
    if (!studyProj || studyProj.cnt === 0) {
      sqliteDb.exec(`
        INSERT INTO projects (name, client_id, contract_value, estimated_cost, actual_cost, progress, status, notes)
        VALUES ('مشروع مجمع خورمكسر الطبي (قيد الدراسة والتسعير)', 1, 65000000, 52000000, 0, 0, 'under_study', 'مشروع قيد إعداد جدول الكميات BOQ والتسعير الهندسي للعطاء المنافس');
      `);
    }
  } catch (err) {
    console.warn('Accounting migration note (SQLite):', err.message);
  }

  activeEngine = 'sqlite';
  console.log(`📦 [Rawasi DB] SQLite engine active -> rawasi_aden.db`);
}

/**
 * دالة التهيئة والتشغيل العامة عند بدء الخادم
 */
async function initializeDatabase() {
  appConfig = loadConfig();

  if (appConfig.dbEngine === 'mysql') {
    try {
      await initMysql();
      return;
    } catch (err) {
      const isRefused = err.message.includes('ECONNREFUSED');
      console.warn(`⚠️  [Rawasi DB] MySQL server is offline (${isRefused ? 'Connection refused on port ' + (appConfig.mysql?.port || 3306) : err.message})`);
      console.warn('👉 [Rawasi DB] Fallback active: Automatically running on local SQLite.');
    }
  }

  initSqlite();
}

// بدء التهيئة الفورية
initializeDatabase().catch(e => {
  console.error('Fatal database initialization error:', e);
});

// =================== دوال الاستعلام العامة (Unified Query Layer) ===================

/**
 * استعلام يعيد كافة السجلات المطابقة كـ Array
 */
async function query(sql, params = []) {
  const targetSql = normalizeSql(sql, activeEngine);

  if (activeEngine === 'mysql' && mysqlPool) {
    try {
      const [rows] = await mysqlPool.query(targetSql, params);
      return rows;
    } catch (err) {
      // محاولة تنفيذ استعلام احتياطي على SQLite إذا فشل اتصال MySQL فجأة
      if (sqliteDb && (err.code === 'ECONNRESET' || err.code === 'PROTOCOL_CONNECTION_LOST')) {
        console.warn('MySQL connection lost, fallback query to SQLite:', err.message);
        return sqliteDb.prepare(normalizeSql(sql, 'sqlite')).all(...params);
      }
      throw err;
    }
  }

  initSqliteInstance();
  return sqliteDb.prepare(targetSql).all(...params);
}

/**
 * استعلام يعيد سجلاً واحداً (أو null)
 */
async function get(sql, params = []) {
  const targetSql = normalizeSql(sql, activeEngine);

  if (activeEngine === 'mysql' && mysqlPool) {
    try {
      const [rows] = await mysqlPool.query(targetSql, params);
      return (rows && rows.length > 0) ? rows[0] : null;
    } catch (err) {
      if (sqliteDb && (err.code === 'ECONNRESET' || err.code === 'PROTOCOL_CONNECTION_LOST')) {
        return sqliteDb.prepare(normalizeSql(sql, 'sqlite')).get(...params) || null;
      }
      throw err;
    }
  }

  initSqliteInstance();
  return sqliteDb.prepare(targetSql).get(...params) || null;
}

/**
 * تنفيذ جمل INSERT / UPDATE / DELETE
 * يعيد كائناً موحداً يحتوي { lastInsertRowid, insertId, changes, affectedRows }
 */
async function run(sql, params = []) {
  const targetSql = normalizeSql(sql, activeEngine);

  if (activeEngine === 'mysql' && mysqlPool) {
    try {
      const [result] = await mysqlPool.query(targetSql, params);
      return {
        lastInsertRowid: result.insertId,
        insertId: result.insertId,
        changes: result.affectedRows,
        affectedRows: result.affectedRows
      };
    } catch (err) {
      if (sqliteDb && (err.code === 'ECONNRESET' || err.code === 'PROTOCOL_CONNECTION_LOST')) {
        const res = sqliteDb.prepare(normalizeSql(sql, 'sqlite')).run(...params);
        return {
          lastInsertRowid: res.lastInsertRowid,
          insertId: res.lastInsertRowid,
          changes: res.changes,
          affectedRows: res.changes
        };
      }
      throw err;
    }
  }

  initSqliteInstance();
  const res = sqliteDb.prepare(targetSql).run(...params);
  return {
    lastInsertRowid: res.lastInsertRowid,
    insertId: res.lastInsertRowid,
    changes: res.changes,
    affectedRows: res.changes
  };
}

/**
 * تنفيذ سكربت أو مجموعة استعلامات نصية
 */
async function exec(sql) {
  const targetSql = normalizeSql(sql, activeEngine);
  if (activeEngine === 'mysql' && mysqlPool) {
    return mysqlPool.query(targetSql);
  }
  initSqliteInstance();
  return sqliteDb.exec(targetSql);
}

/**
 * تنفيذ معاملة مالية ذرية (Atomic Transaction) تدعم كلاً من MySQL و SQLite
 */
async function transaction(callback) {
  if (activeEngine === 'mysql' && mysqlPool) {
    const connection = await mysqlPool.getConnection();
    await connection.beginTransaction();
    try {
      // توفير دوال تنفيذ محلية تابعة لنفس الاتصال المعزول
      const tx = {
        query: async (sql, params = []) => {
          const [rows] = await connection.query(normalizeSql(sql, 'mysql'), params);
          return rows;
        },
        get: async (sql, params = []) => {
          const [rows] = await connection.query(normalizeSql(sql, 'mysql'), params);
          return (rows && rows.length > 0) ? rows[0] : null;
        },
        run: async (sql, params = []) => {
          const [res] = await connection.query(normalizeSql(sql, 'mysql'), params);
          return {
            lastInsertRowid: res.insertId,
            insertId: res.insertId,
            changes: res.affectedRows,
            affectedRows: res.affectedRows
          };
        }
      };

      const result = await callback(tx);
      await connection.commit();
      return result;
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  // في حالة SQLite
  initSqliteInstance();
  sqliteDb.exec('BEGIN TRANSACTION;');
  try {
    const tx = {
      query: async (sql, params = []) => sqliteDb.prepare(normalizeSql(sql, 'sqlite')).all(...params),
      get: async (sql, params = []) => sqliteDb.prepare(normalizeSql(sql, 'sqlite')).get(...params) || null,
      run: async (sql, params = []) => {
        const res = sqliteDb.prepare(normalizeSql(sql, 'sqlite')).run(...params);
        return {
          lastInsertRowid: res.lastInsertRowid,
          insertId: res.lastInsertRowid,
          changes: res.changes,
          affectedRows: res.changes
        };
      }
    };
    const result = await callback(tx);
    sqliteDb.exec('COMMIT;');
    return result;
  } catch (err) {
    sqliteDb.exec('ROLLBACK;');
    throw err;
  }
}

// =================== دوال النسخ الاحتياطي وإدارة السيرفر ===================

function backupDatabase() {
  const backupsDir = path.join(__dirname, 'backups');
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFileName = `backup_rawasi_${timestamp}.db`;
  const backupFilePath = path.join(backupsDir, backupFileName);
  if (fs.existsSync(sqlitePath)) {
    fs.copyFileSync(sqlitePath, backupFilePath);
  }
  return { fileName: backupFileName, filePath: backupFilePath };
}

function restoreDatabase(sourceFilePathOrBuffer) {
  const backupsDir = path.join(__dirname, 'backups');
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safetyBackupPath = path.join(backupsDir, `safety_before_restore_${timestamp}.db`);
  if (fs.existsSync(sqlitePath)) {
    fs.copyFileSync(sqlitePath, safetyBackupPath);
  }

  try {
    if (sqliteDb) {
      try { sqliteDb.close(); } catch {}
      sqliteDb = null;
    }

    if (Buffer.isBuffer(sourceFilePathOrBuffer)) {
      fs.writeFileSync(sqlitePath, sourceFilePathOrBuffer);
    } else if (typeof sourceFilePathOrBuffer === 'string') {
      fs.copyFileSync(sourceFilePathOrBuffer, sqlitePath);
    }

    initSqliteInstance();
    return {
      success: true,
      message: 'تمت استعادة نسخة قاعدة البيانات بنجاح'
    };
  } catch (err) {
    if (fs.existsSync(safetyBackupPath)) {
      fs.copyFileSync(safetyBackupPath, sqlitePath);
      initSqliteInstance();
    }
    throw err;
  }
}

function listBackups() {
  const backupsDir = path.join(__dirname, 'backups');
  if (!fs.existsSync(backupsDir)) return [];
  const files = fs.readdirSync(backupsDir);
  const backups = [];
  files.forEach(file => {
    if (file.endsWith('.db') || file.endsWith('.sqlite') || file.endsWith('.sql')) {
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

function createLogoutBackup(username = 'unknown', meta = {}) {
  const backupsDir = path.join(__dirname, 'backups');
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }

  if (sqliteDb) {
    try { sqliteDb.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch {}
  }

  const safeUser = String(username || 'user').replace(/[^a-zA-Z0-9_\u0600-\u06FF]/g, '_');
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const backupFileName = `backup_logout_${safeUser}_${dateStr}.db`;
  const backupFilePath = path.join(backupsDir, backupFileName);

  if (fs.existsSync(sqlitePath)) {
    fs.copyFileSync(sqlitePath, backupFilePath);
  }

  const stat = fs.existsSync(backupFilePath) ? fs.statSync(backupFilePath) : { size: 0 };
  const backupItem = {
    fileName: backupFileName,
    filePath: backupFilePath,
    username: username || 'مستخدم',
    timestamp: now.toISOString(),
    displayTime: now.toLocaleString('ar-YE'),
    size: stat.size,
    mode: meta.mode || activeEngine,
    engine: activeEngine,
    notes: meta.notes || 'نسخة تلقائية تم إنشاؤها فور تسجيل الخروج'
  };

  return backupItem;
}

function listLogoutBackups() {
  const backupsDir = path.join(__dirname, 'backups');
  if (!fs.existsSync(backupsDir)) return [];
  const files = fs.readdirSync(backupsDir);
  const list = [];
  files.forEach(f => {
    if (f.startsWith('backup_logout_')) {
      const p = path.join(backupsDir, f);
      const stat = fs.statSync(p);
      list.push({
        fileName: f,
        filePath: p,
        timestamp: stat.mtime.toISOString(),
        displayTime: new Date(stat.mtime).toLocaleString('ar-YE'),
        size: stat.size,
        engine: activeEngine
      });
    }
  });
  return list.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

function getActiveEngine() {
  return activeEngine;
}

function getMysqlConfig() {
  return appConfig.mysql;
}

module.exports = {
  db: sqliteDb,
  mysqlPool,
  query,
  get,
  run,
  exec,
  transaction,
  initializeDatabase,
  backupDatabase,
  restoreDatabase,
  listBackups,
  createLogoutBackup,
  listLogoutBackups,
  getActiveEngine,
  getMysqlConfig,
  connectionManager,
  dbPath: sqlitePath
};
