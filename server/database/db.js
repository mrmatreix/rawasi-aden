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
      (2, 'accountant', 'المحاسب المالي', 'accounting,reports,payments,billing,expenses,revenues,custody,clients,suppliers,cash'),
      (3, 'project_manager', 'مدير المشاريع', 'projects,inventory,expenses'),
      (4, 'storekeeper', 'أمين المخزن', 'inventory,items'),
      (5, 'auditor', 'المراجع والمدقق المالي', 'accounting:view,accounting:approve,accounting:post,accounting:export,reports:view,reports:export,expenses:view,expenses:approve,revenues:view,revenues:approve,billing:view,billing:approve,custody:view,custody:approve,projects:view,projects:export,inventory:view,purchases:view,purchases:approve,hr:view,hr:approve,cash:view');
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
    if (!colNames.includes('branch_id')) sqliteDb.exec("ALTER TABLE users ADD COLUMN branch_id INTEGER DEFAULT 1;");
    if (!colNames.includes('branch')) sqliteDb.exec("ALTER TABLE users ADD COLUMN branch TEXT DEFAULT 'المركز الرئيسي';");
    if (!colNames.includes('department_id')) sqliteDb.exec("ALTER TABLE users ADD COLUMN department_id INTEGER DEFAULT 1;");
    if (!colNames.includes('department')) sqliteDb.exec("ALTER TABLE users ADD COLUMN department TEXT DEFAULT 'الإدارة العامة';");
    if (!colNames.includes('allowed_projects')) sqliteDb.exec("ALTER TABLE users ADD COLUMN allowed_projects TEXT DEFAULT '*';");
    if (!colNames.includes('allowed_branches')) sqliteDb.exec("ALTER TABLE users ADD COLUMN allowed_branches TEXT DEFAULT '*';");
    if (!colNames.includes('allowed_departments')) sqliteDb.exec("ALTER TABLE users ADD COLUMN allowed_departments TEXT DEFAULT '*';");

    // ترقية جداول الفروع والأقسام المؤسسية
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS branches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        address TEXT,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS departments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        manager_name TEXT,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const brCount = sqliteDb.prepare("SELECT count(*) as count FROM branches").get();
    if (!brCount || brCount.count === 0) {
      sqliteDb.exec(`
        INSERT OR IGNORE INTO branches (id, code, name, address, status) VALUES
        (1, 'BR-01', 'المركز الرئيسي - عدن', 'عدن - إنماء الجديدة - خلف القطيبي', 'active'),
        (2, 'BR-02', 'فرع المنصورة', 'عدن - المنصورة - شارع التسعين', 'active'),
        (3, 'BR-03', 'فرع حضرموت / المكلا', 'المكلا - فوه - الشارع العام', 'active');
      `);
    }

    const deptCount = sqliteDb.prepare("SELECT count(*) as count FROM departments").get();
    if (!deptCount || deptCount.count === 0) {
      sqliteDb.exec(`
        INSERT OR IGNORE INTO departments (id, code, name, manager_name, status) VALUES
        (1, 'DEP-01', 'الإدارة العامة والتنفيذية', 'م. علوي', 'active'),
        (2, 'DEP-02', 'الإدارة المالية والمحاسبة', 'المحاسب المالي', 'active'),
        (3, 'DEP-03', 'إدارة المشاريع والمقاولات', 'مدير المشاريع', 'active'),
        (4, 'DEP-04', 'المراجعة والتدقيق الداخلي', 'المراجع الداخلي', 'active'),
        (5, 'DEP-05', 'الموارد البشرية والشؤون الإدارية', 'مسؤول الموارد البشرية', 'active'),
        (6, 'DEP-06', 'المشتريات والمخازن', 'أمين المخزن', 'active');
      `);
    }

    // ترقية أدوار النظام وفصل الصلاحيات (Admin, Accountant, Auditor, Project Manager, Storekeeper)
    sqliteDb.exec(`
      INSERT OR IGNORE INTO roles (id, name, display_name, permissions) VALUES 
      (1, 'admin', 'المدير العام', 'all'),
      (2, 'accountant', 'المحاسب المالي', 'accounting,reports,payments,billing,expenses,revenues,custody,clients,suppliers,cash'),
      (3, 'project_manager', 'مدير المشاريع', 'projects,inventory,expenses'),
      (4, 'storekeeper', 'أمين المخزن', 'inventory,items'),
      (5, 'auditor', 'المراجع والمدقق المالي', 'accounting:view,accounting:approve,accounting:post,accounting:export,reports:view,reports:export,expenses:view,expenses:approve,revenues:view,revenues:approve,billing:view,billing:approve,custody:view,custody:approve,projects:view,projects:export,inventory:view,purchases:view,purchases:approve,hr:view,hr:approve,cash:view');
    `);

    // ترقية أعمدة جدول المشاريع لربطها بالفروع والأقسام
    const prjCols = sqliteDb.prepare("PRAGMA table_info(projects)").all().map(c => c.name);
    if (!prjCols.includes('branch_id')) sqliteDb.exec("ALTER TABLE projects ADD COLUMN branch_id INTEGER DEFAULT 1;");
    if (!prjCols.includes('department_id')) sqliteDb.exec("ALTER TABLE projects ADD COLUMN department_id INTEGER DEFAULT 3;");

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
    // أعمدة دورة المستند المالي والرقابة الثنائية (Maker-Checker / Lifecycle)
    if (!expCols.includes('status')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN status TEXT DEFAULT 'posted';");
    if (!expCols.includes('created_by')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN created_by INTEGER REFERENCES users(id);");
    if (!expCols.includes('created_by_name')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN created_by_name TEXT;");
    if (!expCols.includes('reviewed_by')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN reviewed_by INTEGER REFERENCES users(id);");
    if (!expCols.includes('reviewed_by_name')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN reviewed_by_name TEXT;");
    if (!expCols.includes('reviewed_at')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN reviewed_at DATETIME;");
    if (!expCols.includes('review_notes')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN review_notes TEXT;");
    if (!expCols.includes('approved_by')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN approved_by INTEGER REFERENCES users(id);");
    if (!expCols.includes('approved_by_name')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN approved_by_name TEXT;");
    if (!expCols.includes('approved_at')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN approved_at DATETIME;");
    if (!expCols.includes('approval_notes')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN approval_notes TEXT;");
    if (!expCols.includes('posted_by')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN posted_by INTEGER REFERENCES users(id);");
    if (!expCols.includes('posted_by_name')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN posted_by_name TEXT;");
    if (!expCols.includes('posted_at')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN posted_at DATETIME;");
    if (!expCols.includes('reversed_by')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN reversed_by INTEGER REFERENCES users(id);");
    if (!expCols.includes('reversed_by_name')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN reversed_by_name TEXT;");
    if (!expCols.includes('reversed_at')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN reversed_at DATETIME;");
    if (!expCols.includes('reversal_reason')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN reversal_reason TEXT;");
    if (!expCols.includes('reversal_ref_id')) sqliteDb.exec("ALTER TABLE expenses ADD COLUMN reversal_ref_id INTEGER;");

    const payCols = sqliteDb.prepare("PRAGMA table_info(payments)").all().map(c => c.name);
    if (!payCols.includes('account_id')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN account_id INTEGER REFERENCES accounts(id);");
    if (!payCols.includes('cost_center_id')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN cost_center_id INTEGER REFERENCES cost_centers(id);");
    if (!payCols.includes('check_no')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN check_no TEXT;");
    if (!payCols.includes('bank_name')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN bank_name TEXT;");
    // أعمدة دورة المستند المالي لسندات القبض والصرف
    if (!payCols.includes('status')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN status TEXT DEFAULT 'posted';");
    if (!payCols.includes('created_by')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN created_by INTEGER REFERENCES users(id);");
    if (!payCols.includes('created_by_name')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN created_by_name TEXT;");
    if (!payCols.includes('reviewed_by')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN reviewed_by INTEGER REFERENCES users(id);");
    if (!payCols.includes('reviewed_by_name')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN reviewed_by_name TEXT;");
    if (!payCols.includes('reviewed_at')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN reviewed_at DATETIME;");
    if (!payCols.includes('review_notes')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN review_notes TEXT;");
    if (!payCols.includes('approved_by')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN approved_by INTEGER REFERENCES users(id);");
    if (!payCols.includes('approved_by_name')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN approved_by_name TEXT;");
    if (!payCols.includes('approved_at')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN approved_at DATETIME;");
    if (!payCols.includes('approval_notes')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN approval_notes TEXT;");
    if (!payCols.includes('posted_by')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN posted_by INTEGER REFERENCES users(id);");
    if (!payCols.includes('posted_by_name')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN posted_by_name TEXT;");
    if (!payCols.includes('posted_at')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN posted_at DATETIME;");
    if (!payCols.includes('reversed_by')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN reversed_by INTEGER REFERENCES users(id);");
    if (!payCols.includes('reversed_by_name')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN reversed_by_name TEXT;");
    if (!payCols.includes('reversed_at')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN reversed_at DATETIME;");
    if (!payCols.includes('reversal_reason')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN reversal_reason TEXT;");
    if (!payCols.includes('reversal_ref_id')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN reversal_ref_id INTEGER;");
    if (!payCols.includes('receipt_category')) sqliteDb.exec("ALTER TABLE payments ADD COLUMN receipt_category TEXT DEFAULT 'general';");

    const jeCols = sqliteDb.prepare("PRAGMA table_info(journal_entries)").all().map(c => c.name);
    if (!jeCols.includes('status')) sqliteDb.exec("ALTER TABLE journal_entries ADD COLUMN status TEXT DEFAULT 'posted';");
    if (!jeCols.includes('created_by')) sqliteDb.exec("ALTER TABLE journal_entries ADD COLUMN created_by INTEGER REFERENCES users(id);");
    if (!jeCols.includes('created_by_name')) sqliteDb.exec("ALTER TABLE journal_entries ADD COLUMN created_by_name TEXT;");
    if (!jeCols.includes('approved_by')) sqliteDb.exec("ALTER TABLE journal_entries ADD COLUMN approved_by INTEGER REFERENCES users(id);");
    if (!jeCols.includes('approved_by_name')) sqliteDb.exec("ALTER TABLE journal_entries ADD COLUMN approved_by_name TEXT;");
    if (!jeCols.includes('approved_at')) sqliteDb.exec("ALTER TABLE journal_entries ADD COLUMN approved_at DATETIME;");
    if (!jeCols.includes('posted_by')) sqliteDb.exec("ALTER TABLE journal_entries ADD COLUMN posted_by INTEGER REFERENCES users(id);");
    if (!jeCols.includes('posted_by_name')) sqliteDb.exec("ALTER TABLE journal_entries ADD COLUMN posted_by_name TEXT;");
    if (!jeCols.includes('posted_at')) sqliteDb.exec("ALTER TABLE journal_entries ADD COLUMN posted_at DATETIME;");
    if (!jeCols.includes('reversed_by')) sqliteDb.exec("ALTER TABLE journal_entries ADD COLUMN reversed_by INTEGER REFERENCES users(id);");
    if (!jeCols.includes('reversed_by_name')) sqliteDb.exec("ALTER TABLE journal_entries ADD COLUMN reversed_by_name TEXT;");
    if (!jeCols.includes('reversed_at')) sqliteDb.exec("ALTER TABLE journal_entries ADD COLUMN reversed_at DATETIME;");
    if (!jeCols.includes('reversal_reason')) sqliteDb.exec("ALTER TABLE journal_entries ADD COLUMN reversal_reason TEXT;");
    if (!jeCols.includes('reversal_ref_id')) sqliteDb.exec("ALTER TABLE journal_entries ADD COLUMN reversal_ref_id INTEGER;");

    const auditCols = sqliteDb.prepare("PRAGMA table_info(audit_logs)").all().map(c => c.name);
    if (!auditCols.includes('old_values')) sqliteDb.exec("ALTER TABLE audit_logs ADD COLUMN old_values TEXT;");
    if (!auditCols.includes('new_values')) sqliteDb.exec("ALTER TABLE audit_logs ADD COLUMN new_values TEXT;");
    if (!auditCols.includes('reason')) sqliteDb.exec("ALTER TABLE audit_logs ADD COLUMN reason TEXT;");

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
        INSERT INTO projects (name, client_id, contract_value, estimated_cost, actual_cost, progress_percentage, status, notes)
        VALUES ('مشروع مجمع خورمكسر الطبي (قيد الدراسة والتسعير)', 1, 65000000, 52000000, 0, 0, 'under_study', 'مشروع قيد إعداد جدول الكميات BOQ والتسعير الهندسي للعطاء المنافس');
      `);
    }

    // 6. إضافة أعمدة تصنيف المستخلصات ودورة المستند والفصل المحاسبي للمقاولات
    const billCols = sqliteDb.prepare("PRAGMA table_info(bills)").all().map(c => c.name);
    if (!billCols.includes('gross_amount')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN gross_amount REAL DEFAULT 0;");
    if (!billCols.includes('advance_deduction')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN advance_deduction REAL DEFAULT 0;");
    if (!billCols.includes('retention_deduction')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN retention_deduction REAL DEFAULT 0;");
    if (!billCols.includes('created_by')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN created_by INTEGER REFERENCES users(id);");
    if (!billCols.includes('created_by_name')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN created_by_name TEXT;");
    if (!billCols.includes('reviewed_by')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN reviewed_by INTEGER REFERENCES users(id);");
    if (!billCols.includes('reviewed_by_name')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN reviewed_by_name TEXT;");
    if (!billCols.includes('reviewed_at')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN reviewed_at DATETIME;");
    if (!billCols.includes('review_notes')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN review_notes TEXT;");
    if (!billCols.includes('approved_by')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN approved_by INTEGER REFERENCES users(id);");
    if (!billCols.includes('approved_by_name')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN approved_by_name TEXT;");
    if (!billCols.includes('approved_at')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN approved_at DATETIME;");
    if (!billCols.includes('approval_notes')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN approval_notes TEXT;");
    if (!billCols.includes('posted_by')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN posted_by INTEGER REFERENCES users(id);");
    if (!billCols.includes('posted_by_name')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN posted_by_name TEXT;");
    if (!billCols.includes('posted_at')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN posted_at DATETIME;");
    if (!billCols.includes('reversed_by')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN reversed_by INTEGER REFERENCES users(id);");
    if (!billCols.includes('reversed_by_name')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN reversed_by_name TEXT;");
    if (!billCols.includes('reversed_at')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN reversed_at DATETIME;");
    if (!billCols.includes('reversal_reason')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN reversal_reason TEXT;");
    if (!billCols.includes('reversal_ref_id')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN reversal_ref_id INTEGER;");
    if (!billCols.includes('journal_entry_id')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN journal_entry_id INTEGER REFERENCES journal_entries(id);");

    // أعمدة دورة مستند المشتريات
    const puCols = sqliteDb.prepare("PRAGMA table_info(purchases)").all().map(c => c.name);
    if (!puCols.includes('status')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN status TEXT DEFAULT 'posted';");
    if (!puCols.includes('created_by')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN created_by INTEGER REFERENCES users(id);");
    if (!puCols.includes('created_by_name')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN created_by_name TEXT;");
    if (!puCols.includes('reviewed_by')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN reviewed_by INTEGER REFERENCES users(id);");
    if (!puCols.includes('reviewed_by_name')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN reviewed_by_name TEXT;");
    if (!puCols.includes('reviewed_at')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN reviewed_at DATETIME;");
    if (!puCols.includes('review_notes')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN review_notes TEXT;");
    if (!puCols.includes('approved_by')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN approved_by INTEGER REFERENCES users(id);");
    if (!puCols.includes('approved_by_name')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN approved_by_name TEXT;");
    if (!puCols.includes('approved_at')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN approved_at DATETIME;");
    if (!puCols.includes('approval_notes')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN approval_notes TEXT;");
    if (!puCols.includes('posted_by')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN posted_by INTEGER REFERENCES users(id);");
    if (!puCols.includes('posted_by_name')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN posted_by_name TEXT;");
    if (!puCols.includes('posted_at')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN posted_at DATETIME;");
    if (!puCols.includes('reversed_by')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN reversed_by INTEGER REFERENCES users(id);");
    if (!puCols.includes('reversed_by_name')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN reversed_by_name TEXT;");
    if (!puCols.includes('reversed_at')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN reversed_at DATETIME;");
    if (!puCols.includes('reversal_reason')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN reversal_reason TEXT;");
    if (!puCols.includes('reversal_ref_id')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN reversal_ref_id INTEGER;");
    if (!puCols.includes('journal_entry_id')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN journal_entry_id INTEGER REFERENCES journal_entries(id);");

    // أعمدة إضافية لقيود اليومية (المراجعة والاعتماد)
    if (!jeCols.includes('reviewed_by')) sqliteDb.exec("ALTER TABLE journal_entries ADD COLUMN reviewed_by INTEGER REFERENCES users(id);");
    if (!jeCols.includes('reviewed_by_name')) sqliteDb.exec("ALTER TABLE journal_entries ADD COLUMN reviewed_by_name TEXT;");
    if (!jeCols.includes('reviewed_at')) sqliteDb.exec("ALTER TABLE journal_entries ADD COLUMN reviewed_at DATETIME;");
    if (!jeCols.includes('review_notes')) sqliteDb.exec("ALTER TABLE journal_entries ADD COLUMN review_notes TEXT;");
    if (!jeCols.includes('approval_notes')) sqliteDb.exec("ALTER TABLE journal_entries ADD COLUMN approval_notes TEXT;");

    // مشغلات حماية التوازن المحاسبي الصارم (Zero-Sum Invariant Triggers)
    sqliteDb.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_enforce_journal_balance_insert
      BEFORE INSERT ON journal_entries
      BEGIN
        SELECT CASE 
          WHEN (NEW.total_debit <= 0 OR abs(NEW.total_debit - NEW.total_credit) > 0.001)
          THEN RAISE(ABORT, '⛔ خطأ محاسبي: لا يمكن حفظ قيد غير متزن! إجمالي المدين يجب أن يساوي إجمالي الدائن.')
        END;
      END;
    `);

    sqliteDb.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_enforce_journal_balance_update
      BEFORE UPDATE OF total_debit, total_credit ON journal_entries
      BEGIN
        SELECT CASE 
          WHEN (NEW.total_debit <= 0 OR abs(NEW.total_debit - NEW.total_credit) > 0.001)
          THEN RAISE(ABORT, '⛔ خطأ محاسبي: لا يمكن تحديث قيد ليصبح غير متزن! إجمالي المدين يجب أن يساوي إجمالي الدائن.')
        END;
      END;
    `);

    // 7. إنشاء دليل حسابات المقاولات المعياري (IFRS 15 Construction Accounts)
    sqliteDb.exec(`
      INSERT OR IGNORE INTO accounts (id, code, name, type, parent_id, balance) VALUES
      (16, '1125', 'محتجزات ضمان لدى العملاء (Retention Receivables)', 'أصول', 2, 0),
      (17, '1128', 'أصول تعاقدية - أعمال منجزة غير مفوترة (Contract Assets / WIP)', 'أصول', 2, 0),
      (18, '2105', 'التزامات تعاقدية - دفعات مقدمة من العملاء (Customer Advances)', 'خصوم', 6, 0),
      (19, '2115', 'التزامات تعاقدية - فواتير تزيد عن التكلفة والإنجاز (Contract Liabilities)', 'خصوم', 6, 0),
      (20, '4101', 'إيرادات عقود المقاولات المعترف بها (Recognized Contract Revenue)', 'إيرادات', 9, 0),
      (21, '4102', 'إيرادات أوامر التغيير المعتمدة (Approved Variation Orders)', 'إيرادات', 9, 0);
    `);

    // 8. جدول إثبات وتسجيل الإيرادات التعاقدية ونسب الإنجاز (Contract Revenue Recognitions)
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS contract_revenue_recognitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recognition_no TEXT UNIQUE NOT NULL,
        project_id INTEGER NOT NULL REFERENCES projects(id),
        period_date DATE NOT NULL,
        contract_value REAL DEFAULT 0,
        estimated_cost REAL DEFAULT 0,
        actual_cost_cumulative REAL DEFAULT 0,
        poc_percentage REAL DEFAULT 0,
        cumulative_recognized_revenue REAL DEFAULT 0,
        previous_recognized_revenue REAL DEFAULT 0,
        period_recognized_revenue REAL DEFAULT 0,
        cumulative_billings REAL DEFAULT 0,
        contract_asset_wip REAL DEFAULT 0,
        contract_liability REAL DEFAULT 0,
        journal_entry_id INTEGER REFERENCES journal_entries(id),
        status TEXT DEFAULT 'posted',
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_by_name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 9. إضافة أعمدة إضافية لفواتير المشتريات والمستخلصات والأصناف والعملاء والموردين
    const puColsExt = sqliteDb.prepare("PRAGMA table_info(purchases)").all().map(c => c.name);
    if (!puColsExt.includes('po_id')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN po_id INTEGER;");
    if (!puColsExt.includes('grn_id')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN grn_id INTEGER;");
    if (!puColsExt.includes('matching_status')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN matching_status TEXT DEFAULT 'unmatched';");
    if (!puColsExt.includes('matching_notes')) sqliteDb.exec("ALTER TABLE purchases ADD COLUMN matching_notes TEXT;");

    const billColsExt = sqliteDb.prepare("PRAGMA table_info(bills)").all().map(c => c.name);
    if (!billColsExt.includes('tax_wht_rate')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN tax_wht_rate REAL DEFAULT 0;");
    if (!billColsExt.includes('tax_wht_amount')) sqliteDb.exec("ALTER TABLE bills ADD COLUMN tax_wht_amount REAL DEFAULT 0;");

    const clientCols = sqliteDb.prepare("PRAGMA table_info(clients)").all().map(c => c.name);
    if (!clientCols.includes('tax_number')) sqliteDb.exec("ALTER TABLE clients ADD COLUMN tax_number TEXT;");

    const suppCols = sqliteDb.prepare("PRAGMA table_info(suppliers)").all().map(c => c.name);
    if (!suppCols.includes('tax_number')) sqliteDb.exec("ALTER TABLE suppliers ADD COLUMN tax_number TEXT;");

    const itemCols = sqliteDb.prepare("PRAGMA table_info(items)").all().map(c => c.name);
    if (!itemCols.includes('costing_method')) sqliteDb.exec("ALTER TABLE items ADD COLUMN costing_method TEXT DEFAULT 'wac';");
    if (!itemCols.includes('reorder_level')) sqliteDb.exec("ALTER TABLE items ADD COLUMN reorder_level REAL DEFAULT 10;");
    if (!itemCols.includes('safety_stock')) sqliteDb.exec("ALTER TABLE items ADD COLUMN safety_stock REAL DEFAULT 5;");
    if (!itemCols.includes('has_batch_tracking')) sqliteDb.exec("ALTER TABLE items ADD COLUMN has_batch_tracking INTEGER DEFAULT 0;");

    const invTxCols = sqliteDb.prepare("PRAGMA table_info(inventory_transactions)").all().map(c => c.name);
    if (!invTxCols.includes('warehouse_id')) sqliteDb.exec("ALTER TABLE inventory_transactions ADD COLUMN warehouse_id INTEGER;");
    if (!invTxCols.includes('boq_item_id')) sqliteDb.exec("ALTER TABLE inventory_transactions ADD COLUMN boq_item_id INTEGER;");
    if (!invTxCols.includes('batch_number')) sqliteDb.exec("ALTER TABLE inventory_transactions ADD COLUMN batch_number TEXT;");
    if (!invTxCols.includes('serial_number')) sqliteDb.exec("ALTER TABLE inventory_transactions ADD COLUMN serial_number TEXT;");

    // 10. حسابات الضرائب والضمانات وعجز/فائض المخزون في شجرة الحسابات
    sqliteDb.exec(`
      INSERT OR IGNORE INTO accounts (id, code, name, type, parent_id, balance) VALUES
      (22, '1115', 'غطاء خطابات ضمان لدى البنوك (Restricted Cash Collateral)', 'أصول', 3, 0),
      (23, '1130', 'أرصدة ضريبية مدينة - ضرائب مخصومة من المنبع (WHT Receivable)', 'أصول', 2, 0),
      (24, '2130', 'ضرائب مستحقة الدفع - مصلحة الضرائب (WHT Payable)', 'خصوم', 6, 0),
      (25, '5205', 'رسوم وعمولات خطابات الضمان البنكية (Bank Guarantee Fees)', 'مصروفات', 10, 0),
      (26, '5210', 'عمولات ومصاريف بنكية عامة (Bank Charges & Commissions)', 'مصروفات', 10, 0),
      (27, '5105', 'خسائر عجز وتسويات المخزون (Inventory Shrinkage & Losses)', 'مصروفات', 10, 0),
      (28, '4205', 'أرباح وفائض تسويات المخزون (Inventory Gain & Surpluses)', 'إيرادات', 9, 0);
    `);

    // 11. جداول دورة المشتريات المتقدمة (PR -> RFQ -> PO -> GRN -> 3-Way Match)
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS purchase_requisitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pr_no TEXT UNIQUE NOT NULL,
        project_id INTEGER REFERENCES projects(id),
        boq_item_id INTEGER REFERENCES project_boq(id),
        department TEXT DEFAULT 'إدارة المشاريع',
        required_date DATE,
        urgency TEXT DEFAULT 'عادي',
        estimated_total REAL DEFAULT 0,
        status TEXT DEFAULT 'draft',
        created_by INTEGER REFERENCES users(id),
        created_by_name TEXT,
        approved_by INTEGER REFERENCES users(id),
        approved_by_name TEXT,
        approved_at DATETIME,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS purchase_requisition_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        requisition_id INTEGER NOT NULL REFERENCES purchase_requisitions(id) ON DELETE CASCADE,
        item_id INTEGER REFERENCES items(id),
        item_name TEXT NOT NULL,
        unit TEXT,
        quantity REAL NOT NULL,
        estimated_price REAL DEFAULT 0,
        notes TEXT
      );

      CREATE TABLE IF NOT EXISTS rfqs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rfq_no TEXT UNIQUE NOT NULL,
        requisition_id INTEGER REFERENCES purchase_requisitions(id),
        title TEXT NOT NULL,
        date DATE NOT NULL,
        closing_date DATE,
        winner_supplier_id INTEGER REFERENCES suppliers(id),
        winner_quote_amount REAL DEFAULT 0,
        status TEXT DEFAULT 'draft',
        created_by INTEGER REFERENCES users(id),
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS rfq_vendor_quotes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rfq_id INTEGER NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
        quote_reference TEXT,
        total_price REAL NOT NULL,
        delivery_days INTEGER DEFAULT 1,
        payment_terms TEXT,
        is_selected INTEGER DEFAULT 0,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS purchase_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        po_no TEXT UNIQUE NOT NULL,
        requisition_id INTEGER REFERENCES purchase_requisitions(id),
        rfq_id INTEGER REFERENCES rfqs(id),
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
        project_id INTEGER REFERENCES projects(id),
        warehouse_id INTEGER,
        date DATE NOT NULL,
        expected_delivery_date DATE,
        payment_terms TEXT DEFAULT '30 يوم من تاريخ الاستلام',
        delivery_terms TEXT DEFAULT 'موقع المشروع',
        currency TEXT DEFAULT 'ر.ي',
        subtotal REAL DEFAULT 0,
        tax_amount REAL DEFAULT 0,
        total_amount REAL NOT NULL,
        status TEXT DEFAULT 'draft',
        created_by INTEGER REFERENCES users(id),
        created_by_name TEXT,
        approved_by INTEGER REFERENCES users(id),
        approved_by_name TEXT,
        approved_at DATETIME,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS purchase_order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        po_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
        item_id INTEGER REFERENCES items(id),
        item_name TEXT NOT NULL,
        unit TEXT,
        ordered_qty REAL NOT NULL,
        received_qty REAL DEFAULT 0,
        billed_qty REAL DEFAULT 0,
        unit_price REAL NOT NULL,
        tax_rate REAL DEFAULT 0,
        total_price REAL NOT NULL,
        notes TEXT
      );

      CREATE TABLE IF NOT EXISTS goods_receipt_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        grn_no TEXT UNIQUE NOT NULL,
        po_id INTEGER NOT NULL REFERENCES purchase_orders(id),
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
        project_id INTEGER REFERENCES projects(id),
        warehouse_id INTEGER NOT NULL,
        delivery_note_no TEXT,
        received_date DATE NOT NULL,
        receiver_name TEXT NOT NULL,
        inspector_name TEXT,
        inspection_status TEXT DEFAULT 'accepted',
        status TEXT DEFAULT 'posted',
        created_by INTEGER REFERENCES users(id),
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS goods_receipt_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        grn_id INTEGER NOT NULL REFERENCES goods_receipt_notes(id) ON DELETE CASCADE,
        po_item_id INTEGER REFERENCES purchase_order_items(id),
        item_id INTEGER REFERENCES items(id),
        item_name TEXT NOT NULL,
        unit TEXT,
        received_qty REAL NOT NULL,
        accepted_qty REAL NOT NULL,
        rejected_qty REAL DEFAULT 0,
        rejection_reason TEXT,
        unit_cost REAL DEFAULT 0,
        total_cost REAL DEFAULT 0,
        batch_number TEXT,
        expiry_date DATE
      );
    `);

    // 12. جداول المستودعات المتعددة وتقييم المخزون والتسويات والجرد
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS warehouses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        type TEXT DEFAULT 'central',
        project_id INTEGER REFERENCES projects(id),
        location TEXT,
        manager_name TEXT,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS warehouse_stocks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
        item_id INTEGER NOT NULL REFERENCES items(id),
        quantity REAL DEFAULT 0,
        reorder_level REAL DEFAULT 10,
        safety_stock REAL DEFAULT 5,
        last_cost REAL DEFAULT 0,
        average_cost REAL DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(warehouse_id, item_id)
      );

      CREATE TABLE IF NOT EXISTS inventory_transfers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transfer_no TEXT UNIQUE NOT NULL,
        from_warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
        to_warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
        item_id INTEGER NOT NULL REFERENCES items(id),
        quantity REAL NOT NULL,
        unit_cost REAL DEFAULT 0,
        total_cost REAL DEFAULT 0,
        transfer_date DATE NOT NULL,
        status TEXT DEFAULT 'completed',
        created_by INTEGER REFERENCES users(id),
        received_by TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS inventory_returns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        return_no TEXT UNIQUE NOT NULL,
        return_type TEXT NOT NULL,
        warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
        item_id INTEGER NOT NULL REFERENCES items(id),
        quantity REAL NOT NULL,
        unit_price REAL NOT NULL,
        total_amount REAL NOT NULL,
        supplier_id INTEGER REFERENCES suppliers(id),
        project_id INTEGER REFERENCES projects(id),
        boq_item_id INTEGER REFERENCES project_boq(id),
        date DATE NOT NULL,
        reason TEXT NOT NULL,
        status TEXT DEFAULT 'posted',
        journal_entry_id INTEGER REFERENCES journal_entries(id),
        created_by INTEGER REFERENCES users(id),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS inventory_adjustments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        adjustment_no TEXT UNIQUE NOT NULL,
        warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
        item_id INTEGER NOT NULL REFERENCES items(id),
        system_qty REAL NOT NULL,
        physical_qty REAL NOT NULL,
        diff_qty REAL NOT NULL,
        unit_cost REAL NOT NULL,
        diff_amount REAL NOT NULL,
        adjustment_type TEXT NOT NULL,
        date DATE NOT NULL,
        reason TEXT NOT NULL,
        status TEXT DEFAULT 'posted',
        journal_entry_id INTEGER REFERENCES journal_entries(id),
        created_by INTEGER REFERENCES users(id),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS inventory_valuation_layers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL REFERENCES items(id),
        warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
        grn_id INTEGER REFERENCES goods_receipt_notes(id),
        date DATE NOT NULL,
        initial_qty REAL NOT NULL,
        remaining_qty REAL NOT NULL,
        unit_cost REAL NOT NULL,
        landed_cost_allocated REAL DEFAULT 0,
        batch_number TEXT,
        expiry_date DATE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 13. جداول الحسابات البنكية والتسويات ومحفظة الشيكات
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS bank_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER REFERENCES accounts(id),
        bank_name TEXT NOT NULL,
        account_number TEXT UNIQUE NOT NULL,
        iban TEXT,
        currency TEXT DEFAULT 'ر.ي',
        current_balance REAL DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS bank_statements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bank_account_id INTEGER NOT NULL REFERENCES bank_accounts(id),
        statement_date DATE NOT NULL,
        opening_balance REAL DEFAULT 0,
        closing_balance REAL DEFAULT 0,
        currency TEXT DEFAULT 'ر.ي',
        file_name TEXT,
        status TEXT DEFAULT 'draft',
        imported_by INTEGER REFERENCES users(id),
        imported_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS bank_statement_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        statement_id INTEGER NOT NULL REFERENCES bank_statements(id) ON DELETE CASCADE,
        transaction_date DATE NOT NULL,
        value_date DATE,
        description TEXT NOT NULL,
        reference_no TEXT,
        debit REAL DEFAULT 0,
        credit REAL DEFAULT 0,
        balance REAL DEFAULT 0,
        is_reconciled INTEGER DEFAULT 0,
        matched_entity_type TEXT,
        matched_entity_id TEXT,
        matched_at DATETIME,
        notes TEXT
      );

      CREATE TABLE IF NOT EXISTS bank_reconciliations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reconciliation_no TEXT UNIQUE NOT NULL,
        bank_account_id INTEGER NOT NULL REFERENCES bank_accounts(id),
        statement_id INTEGER REFERENCES bank_statements(id),
        reconciliation_date DATE NOT NULL,
        bank_statement_balance REAL NOT NULL,
        book_balance REAL NOT NULL,
        deposits_in_transit REAL DEFAULT 0,
        outstanding_cheques REAL DEFAULT 0,
        bank_charges_unrecorded REAL DEFAULT 0,
        adjusted_bank_balance REAL NOT NULL,
        adjusted_book_balance REAL NOT NULL,
        variance REAL DEFAULT 0,
        status TEXT DEFAULT 'balanced',
        prepared_by INTEGER REFERENCES users(id),
        approved_by INTEGER REFERENCES users(id),
        approved_at DATETIME,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS cheques (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cheque_no TEXT NOT NULL,
        type TEXT NOT NULL,
        bank_account_id INTEGER REFERENCES bank_accounts(id),
        drawer_name TEXT,
        beneficiary_name TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT DEFAULT 'ر.ي',
        issue_date DATE NOT NULL,
        due_date DATE NOT NULL,
        status TEXT DEFAULT 'pending',
        project_id INTEGER REFERENCES projects(id),
        client_id INTEGER REFERENCES clients(id),
        supplier_id INTEGER REFERENCES suppliers(id),
        payment_id INTEGER REFERENCES payments(id),
        expense_id INTEGER REFERENCES expenses(id),
        clearance_date DATE,
        bounce_date DATE,
        bounce_reason TEXT,
        journal_entry_id INTEGER REFERENCES journal_entries(id),
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 14. جداول الضرائب (الخصم من المنبع) والضمانات البنكية للمقاولات
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS tax_configs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tax_code TEXT UNIQUE NOT NULL,
        tax_name TEXT NOT NULL,
        rate_percentage REAL NOT NULL,
        type TEXT NOT NULL,
        law_reference TEXT,
        is_active INTEGER DEFAULT 1,
        legal_disclaimer TEXT,
        notes TEXT
      );

      CREATE TABLE IF NOT EXISTS tax_withholdings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        withholding_no TEXT UNIQUE NOT NULL,
        type TEXT NOT NULL,
        project_id INTEGER REFERENCES projects(id),
        client_id INTEGER REFERENCES clients(id),
        supplier_id INTEGER REFERENCES suppliers(id),
        source_doc_type TEXT NOT NULL,
        source_doc_id INTEGER NOT NULL,
        base_amount REAL NOT NULL,
        tax_rate REAL NOT NULL,
        tax_amount REAL NOT NULL,
        tax_period TEXT NOT NULL,
        date DATE NOT NULL,
        tax_number TEXT,
        journal_entry_id INTEGER REFERENCES journal_entries(id),
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS bank_guarantees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guarantee_no TEXT UNIQUE NOT NULL,
        type TEXT NOT NULL,
        project_id INTEGER NOT NULL REFERENCES projects(id),
        client_id INTEGER REFERENCES clients(id),
        issuing_bank TEXT NOT NULL,
        bank_account_id INTEGER REFERENCES bank_accounts(id),
        amount REAL NOT NULL,
        currency TEXT DEFAULT 'ر.ي',
        cash_margin_pct REAL DEFAULT 10,
        cash_margin_amount REAL NOT NULL,
        commission_fee REAL DEFAULT 0,
        issue_date DATE NOT NULL,
        expiry_date DATE NOT NULL,
        status TEXT DEFAULT 'active',
        release_date DATE,
        journal_entry_id INTEGER REFERENCES journal_entries(id),
        release_journal_entry_id INTEGER REFERENCES journal_entries(id),
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 15. تهيئة بذور البيانات الافتراضية للمستودعات والحساب البنكي وإعدادات الضرائب اليمنية
    sqliteDb.exec(`
      INSERT OR IGNORE INTO warehouses (id, code, name, type, location, manager_name) VALUES
      (1, 'WH-MAIN', 'المستودع المركزي الرئيسي - خورمكسر', 'central', 'عدن - خورمكسر', 'أمين المستودع العام'),
      (2, 'WH-SITE-1', 'مستودع موقع مشروع برج الصالح', 'site', 'عدن - المعلا', 'مهندس الموقع');

      INSERT OR IGNORE INTO bank_accounts (id, account_id, bank_name, account_number, iban, currency, current_balance) VALUES
      (1, 3, 'البنك الأهلي اليمني', '1023456789', 'YE98NBYE0000001023456789', 'ر.ي', 50000000),
      (2, 3, 'بنك التضامن الإسلامي', '2034567890', 'YE98TDBE0000002034567890', 'ر.ي', 25000000);

      INSERT OR IGNORE INTO tax_configs (id, tax_code, tax_name, rate_percentage, type, law_reference, legal_disclaimer) VALUES
      (1, 'WHT-CONT-3', 'ضريبة أرباح تجارية وصناعية - مقاولات (3%)', 3.0, 'wht_contracting', 'قانون ضرائب الدخل اليمني رقم 17 لسنة 2010 وتعديلاته', 'النسبة قابلة للتعديل حسب اللائحة التنفيذية وتوجيهات مصلحة الضرائب والمحاسب القانوني'),
      (2, 'WHT-SUPP-1', 'ضريبة خصم من المنبع - توريدات ومشتريات (1%)', 1.0, 'wht_supplies', 'قانون ضرائب الدخل اليمني رقم 17 لسنة 2010 وتعديلاته', 'النسبة قابلة للتعديل حسب اللائحة التنفيذية وتوجيهات مصلحة الضرائب والمحاسب القانوني'),
      (3, 'VAT-0', 'ضريبة المبيعات / القيمة المضافة (0% افتراضية للمقاولات)', 0.0, 'vat', 'قانون الضريبة العامة على المبيعات ولائحته التنفيذية', 'معفاة أو خاضعة لنسبة محددة وفق طبيعة العقد والتوريد');
    `);
  } catch (err) {
    console.warn('Accounting migration note (SQLite):', err.message);
  }

  // ============================================================
  // وحدة 15: جداول التحكم المتقدم في المشاريع (Auto-Migration)
  // ============================================================
  try {
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS project_wbs_activities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        parent_id INTEGER REFERENCES project_wbs_activities(id) ON DELETE SET NULL,
        wbs_code TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT, discipline TEXT, activity_type TEXT DEFAULT 'task',
        weight REAL DEFAULT 1.0,
        planned_start DATE, planned_finish DATE, planned_duration_days REAL DEFAULT 0,
        actual_start DATE, actual_finish DATE, actual_duration_days REAL DEFAULT 0,
        percent_complete REAL DEFAULT 0,
        es_days REAL, ef_days REAL, ls_days REAL, lf_days REAL,
        total_float_days REAL, free_float_days REAL, is_critical INTEGER DEFAULT 0,
        status TEXT DEFAULT 'not_started', priority TEXT DEFAULT 'medium',
        assigned_to INTEGER REFERENCES users(id), notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS project_wbs_dependencies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        predecessor_id INTEGER NOT NULL REFERENCES project_wbs_activities(id) ON DELETE CASCADE,
        successor_id INTEGER NOT NULL REFERENCES project_wbs_activities(id) ON DELETE CASCADE,
        dependency_type TEXT DEFAULT 'FS', lag_days REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(predecessor_id, successor_id)
      );
      CREATE TABLE IF NOT EXISTS project_wbs_baselines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        activity_id INTEGER NOT NULL REFERENCES project_wbs_activities(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        planned_start DATE, planned_finish DATE, planned_duration_days REAL,
        is_current INTEGER DEFAULT 1,
        created_by INTEGER REFERENCES users(id),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS project_engineer_certifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        pct REAL NOT NULL CHECK(pct >= 0 AND pct <= 100),
        certified_by INTEGER REFERENCES users(id),
        certified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        certifier_name TEXT, certifier_role TEXT, inspection_date DATE,
        notes TEXT, attachment_base64 TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS project_evm_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        status_date DATE NOT NULL,
        bac REAL, pv REAL, ev REAL, ac REAL, cv REAL, sv REAL,
        cpi REAL, spi REAL, eac REAL, etc REAL, vac REAL, completion_pct REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_id, status_date)
      );
      CREATE TABLE IF NOT EXISTS project_risk_register (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        risk_ref TEXT, title TEXT NOT NULL, description TEXT,
        category TEXT DEFAULT 'general',
        probability INTEGER NOT NULL CHECK(probability BETWEEN 1 AND 5),
        impact INTEGER NOT NULL CHECK(impact BETWEEN 1 AND 5),
        risk_score INTEGER, risk_rating TEXT,
        financial_impact REAL DEFAULT 0, schedule_impact_days INTEGER DEFAULT 0,
        treatment_type TEXT DEFAULT 'mitigate', treatment_plan TEXT,
        owner_id INTEGER REFERENCES users(id),
        status TEXT DEFAULT 'open', review_date DATE,
        last_reviewed_at DATETIME, last_reviewed_by INTEGER REFERENCES users(id),
        closure_notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS project_claims_register (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        claim_ref TEXT, claim_type TEXT NOT NULL, title TEXT NOT NULL,
        description TEXT, claimed_amount REAL DEFAULT 0, claimed_days INTEGER DEFAULT 0,
        approved_amount REAL DEFAULT 0, approved_days INTEGER DEFAULT 0,
        submitted_date DATE, responsible_party TEXT, priority TEXT DEFAULT 'medium',
        status TEXT DEFAULT 'مفتوح', supporting_docs TEXT, response_notes TEXT,
        resolution_date DATE,
        created_by INTEGER REFERENCES users(id),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS project_non_conformance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        ncr_ref TEXT, title TEXT NOT NULL, description TEXT NOT NULL,
        location TEXT, discipline TEXT, severity TEXT DEFAULT 'medium',
        responsible_party TEXT, root_cause TEXT, corrective_action TEXT,
        preventive_action TEXT, due_date DATE, closed_date DATE,
        status TEXT DEFAULT 'مفتوح',
        verified_by INTEGER REFERENCES users(id), verification_notes TEXT,
        reported_by INTEGER REFERENCES users(id),
        reported_date DATE DEFAULT (date('now')), attachments TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS project_rfi (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        rfi_ref TEXT, subject TEXT NOT NULL, description TEXT,
        discipline TEXT, submitted_to TEXT,
        submitted_by INTEGER REFERENCES users(id),
        submitted_date DATE DEFAULT (date('now')),
        required_response_date DATE, response_date DATE, response TEXT,
        priority TEXT DEFAULT 'normal', status TEXT DEFAULT 'معلق', attachments TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS project_wbs_resources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        activity_id INTEGER NOT NULL REFERENCES project_wbs_activities(id) ON DELETE CASCADE,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        resource_type TEXT NOT NULL, resource_name TEXT NOT NULL,
        unit TEXT, planned_qty REAL DEFAULT 0, actual_qty REAL DEFAULT 0,
        unit_cost REAL DEFAULT 0, notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ [Rawasi DB] Advanced Project Control tables initialized');
  } catch (err) {
    console.warn('Project control migration note (SQLite):', err.message);
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
        lastID: result.insertId,
        changes: result.affectedRows,
        affectedRows: result.affectedRows
      };
    } catch (err) {
      if (sqliteDb && (err.code === 'ECONNRESET' || err.code === 'PROTOCOL_CONNECTION_LOST')) {
        const res = sqliteDb.prepare(normalizeSql(sql, 'sqlite')).run(...params);
        return {
          lastInsertRowid: res.lastInsertRowid,
          insertId: res.lastInsertRowid,
          lastID: res.lastInsertRowid,
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
    lastID: res.lastInsertRowid,
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
