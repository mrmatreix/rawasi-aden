-- ============================================================================
-- مخطط جداول نظام النسخ الاحتياطي واستعادة البيانات وإدارة الكوارث المتقدم
-- نظام رواسي عدن للهندسة والمقاولات (Rawasi Aden System)
-- ============================================================================

-- 1. جدول سجلات النسخ الاحتياطية المعتمدة (Backup Records Registry)
CREATE TABLE IF NOT EXISTS backup_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    backup_uid TEXT UNIQUE NOT NULL,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    sha256_hash TEXT NOT NULL,
    backup_type TEXT NOT NULL DEFAULT 'manual', -- 'manual', 'scheduled_daily', 'scheduled_weekly', 'scheduled_monthly', 'pre_migration', 'logout'
    scope TEXT NOT NULL DEFAULT 'database_only', -- 'database_only', 'full_bundle_with_files'
    storage_tier TEXT NOT NULL DEFAULT 'local_persistent', -- 'local_persistent', 'cloud_vault', 'offsite_s3'
    storage_path TEXT,
    encrypted INTEGER DEFAULT 0,
    encryption_algo TEXT DEFAULT 'NONE', -- 'NONE', 'AES-256-GCM-PBKDF2-100K'
    status TEXT NOT NULL DEFAULT 'healthy', -- 'healthy', 'verified', 'corrupt', 'failed', 'purged'
    verification_status TEXT NOT NULL DEFAULT 'unverified', -- 'unverified', 'passed', 'failed'
    verification_details TEXT, -- JSON containing tables_count, integrity_check, stats
    is_protected INTEGER DEFAULT 0, -- 1 = محمي من الحذف والتدوير التلقائي
    protected_reason TEXT,
    protected_by TEXT,
    created_by TEXT DEFAULT 'system',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_tested_at DATETIME,
    test_status TEXT DEFAULT 'not_tested' -- 'not_tested', 'test_passed', 'test_failed'
);

CREATE INDEX IF NOT EXISTS idx_backup_uid ON backup_records(backup_uid);
CREATE INDEX IF NOT EXISTS idx_backup_type ON backup_records(backup_type);
CREATE INDEX IF NOT EXISTS idx_backup_created ON backup_records(created_at);
CREATE INDEX IF NOT EXISTS idx_backup_status ON backup_records(status);
CREATE INDEX IF NOT EXISTS idx_backup_protected ON backup_records(is_protected);

-- 2. جدول عمليات استعادة البيانات (Restore Operations Audit)
CREATE TABLE IF NOT EXISTS restore_operations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    restore_uid TEXT UNIQUE NOT NULL,
    target_type TEXT NOT NULL DEFAULT 'production', -- 'production', 'test_sandbox'
    backup_record_id INTEGER REFERENCES backup_records(id),
    backup_file_name TEXT NOT NULL,
    safety_backup_file TEXT, -- مسار نسخة الحماية الطارئة التي أُخذت قبل الاستعادة
    initiated_by TEXT NOT NULL,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'validating', 'in_progress', 'completed', 'rolled_back', 'failed'
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    duration_ms INTEGER,
    validation_report TEXT, -- JSON تقرير الفحص قبل وبعد الاستعادة
    error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_restore_uid ON restore_operations(restore_uid);
CREATE INDEX IF NOT EXISTS idx_restore_status ON restore_operations(status);
CREATE INDEX IF NOT EXISTS idx_restore_started ON restore_operations(started_at);

-- 3. جدول سجلات اختبار الاستعادة في البيئة المعزولة (Sandbox Test Restore Logs)
CREATE TABLE IF NOT EXISTS backup_test_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    test_uid TEXT UNIQUE NOT NULL,
    backup_file_name TEXT NOT NULL,
    integrity_check_result TEXT, -- 'ok' or error text from PRAGMA integrity_check
    tables_count INTEGER DEFAULT 0,
    users_count INTEGER DEFAULT 0,
    accounts_count INTEGER DEFAULT 0,
    journal_entries_count INTEGER DEFAULT 0,
    projects_count INTEGER DEFAULT 0,
    is_balanced INTEGER DEFAULT 1, -- 1 if debit == credit, 0 otherwise
    duration_ms INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'passed', -- 'passed', 'failed'
    error_message TEXT,
    tested_by TEXT DEFAULT 'system',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_test_uid ON backup_test_logs(test_uid);
CREATE INDEX IF NOT EXISTS idx_test_created ON backup_test_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_test_status ON backup_test_logs(status);
