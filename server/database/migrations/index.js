'use strict';
// Numbered schema migrations (stage 5). Each migration runs once, inside its own transaction, and is recorded
// in schema_migrations. A failing migration stops the boot with a clear message instead of being swallowed.
// Rules: never edit an applied migration; add a new numbered one. `up` must be idempotent-safe on databases that
// already received the same columns from the older inline boot code (check before ALTER).
const columns = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
const addColumns = (db, table, defs) => {
  const have = columns(db, table);
  if (!have.length) return;
  for (const [name, def] of defs) if (!have.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
};

const DEBIT_TYPES = "('asset','assets','أصول','اصول','أصل','اصل','أصول ثابتة','أصول متداولة','expense','expenses','cost','مصروفات','مصاريف','مصروف','تكاليف')";
const NORMAL_BALANCE = `CASE WHEN LOWER(TRIM(NEW.type)) IN ${DEBIT_TYPES} THEN (CASE WHEN COALESCE(NEW.is_contra,0)=1 THEN 'credit' ELSE 'debit' END)
  ELSE (CASE WHEN COALESCE(NEW.is_contra,0)=1 THEN 'debit' ELSE 'credit' END) END`;

const MIGRATIONS = [
  {
    id: '0001_chart_of_accounts_columns_and_roles',
    description: 'Accounts: parent_code, is_contra, is_active, normal_balance (+ triggers), updated_at; system_account_mappings table',
    up(db) {
      addColumns(db, 'accounts', [['parent_code', 'TEXT'], ['is_contra', 'INTEGER DEFAULT 0'], ['is_active', 'INTEGER DEFAULT 1'],
        ['normal_balance', 'TEXT'], ['updated_at', 'DATETIME']]);
      db.exec(`
        DROP TRIGGER IF EXISTS trg_accounts_normal_balance_insert;
        CREATE TRIGGER trg_accounts_normal_balance_insert AFTER INSERT ON accounts
        BEGIN UPDATE accounts SET normal_balance = ${NORMAL_BALANCE} WHERE id = NEW.id; END;
        DROP TRIGGER IF EXISTS trg_accounts_normal_balance_update;
        CREATE TRIGGER trg_accounts_normal_balance_update AFTER UPDATE OF type, is_contra ON accounts
        BEGIN UPDATE accounts SET normal_balance = ${NORMAL_BALANCE} WHERE id = NEW.id; END;`);
      db.exec(`UPDATE accounts SET normal_balance = CASE WHEN LOWER(TRIM(type)) IN ${DEBIT_TYPES}
        THEN (CASE WHEN COALESCE(is_contra,0)=1 THEN 'credit' ELSE 'debit' END) ELSE (CASE WHEN COALESCE(is_contra,0)=1 THEN 'debit' ELSE 'credit' END) END
        WHERE normal_balance IS NULL`);
      db.exec(require('../chartOfAccountsRepair').MAPPINGS_DDL);
    }
  },
  {
    id: '0002_payroll_columns',
    description: 'Comprehensive payroll/employee columns (previously only from migrate_comprehensive_payroll.js) and payroll payment entry',
    up(db) {
      addColumns(db, 'payroll', [['allowances', 'REAL DEFAULT 0'], ['overtime_amount', 'REAL DEFAULT 0'], ['earned_basic', 'REAL DEFAULT 0'],
        ['transport_allowance', 'REAL DEFAULT 0'], ['appearance_allowance', 'REAL DEFAULT 0'], ['nature_of_work_allowance', 'REAL DEFAULT 0'],
        ['living_allowance', 'REAL DEFAULT 0'], ['health_insurance_allowance', 'REAL DEFAULT 0'], ['gross_salary', 'REAL DEFAULT 0'],
        ['insurance_employee', 'REAL DEFAULT 0'], ['insurance_employer', 'REAL DEFAULT 0'], ['absence_penalty_deductions', 'REAL DEFAULT 0'],
        ['loan_installments', 'REAL DEFAULT 0'], ['taxable_base', 'REAL DEFAULT 0'], ['tax_amount', 'REAL DEFAULT 0'], ['skills_fund', 'REAL DEFAULT 0'],
        ['unpaid_leave_deduction', 'REAL DEFAULT 0'], ['total_net_salary', 'REAL DEFAULT 0'], ['working_days', 'INTEGER DEFAULT 31'],
        ['month_days', 'INTEGER DEFAULT 31'], ['cost_center', "TEXT DEFAULT 'الإدارة العامة'"], ['bank_account', "TEXT DEFAULT ''"],
        ['payment_journal_entry_id', 'INTEGER REFERENCES journal_entries(id)']]);
      addColumns(db, 'employees', [['transport_pct', 'REAL DEFAULT 20'], ['appearance_pct', 'REAL DEFAULT 25'], ['nature_of_work_pct', 'REAL DEFAULT 30'],
        ['living_allowance', 'REAL DEFAULT 90000'], ['health_insurance_allowance', 'REAL DEFAULT 30000'],
        ['cost_center', "TEXT DEFAULT 'الإدارة العامة'"], ['bank_account', "TEXT DEFAULT ''"]]);
    }
  },
  {
    id: '0003_journal_line_party',
    description: 'Subledger dimension on journal lines: party_type, party_id (+ index)',
    up(db) {
      addColumns(db, 'journal_entry_lines', [['party_type', 'TEXT'], ['party_id', 'INTEGER']]);
      db.exec('CREATE INDEX IF NOT EXISTS idx_jel_party ON journal_entry_lines(party_type, party_id)');
    }
  },
  {
    id: '0004_production_parity',
    description: 'Columns and tables production has but a fresh database lacked (payment wizard, profitability, contract lifecycle, legacy columns)',
    up(db) {
      // columns that production received from one-off scripts over time
      addColumns(db, 'items', [['currency', "TEXT DEFAULT 'ر.ي'"]]);
      addColumns(db, 'purchases', [['currency', "TEXT DEFAULT 'ر.ي'"]]);
      addColumns(db, 'bills', [['currency', "TEXT DEFAULT 'ر.ي'"]]);
      addColumns(db, 'expenses', [['source_table', 'TEXT'], ['source_id', 'INTEGER']]);
      addColumns(db, 'accounts', [['currencies', "TEXT DEFAULT 'YER'"], ['report_type', "TEXT DEFAULT 'balance_sheet'"], ['inclusion', "TEXT DEFAULT '='"]]);
      addColumns(db, 'project_contracts', [['retention_due_date', 'DATE'], ['ipc_cycle_days', 'INTEGER DEFAULT 30'], ['supervision_monthly_fee', 'DECIMAL(15,2) DEFAULT 0.00']]);
      addColumns(db, 'project_labor_expenses', [['paid_amount', 'REAL DEFAULT 0']]);
      addColumns(db, 'employee_advances', [['request_date', 'DATE'], ['reason', 'TEXT']]);
      addColumns(db, 'leave_types', [['days_per_year', 'INTEGER DEFAULT 30'], ['description', 'TEXT']]);
      addColumns(db, 'employee_evaluations', [['bonuses', 'REAL DEFAULT 0'], ['deductions', 'REAL DEFAULT 0'], ['evaluator', 'TEXT'], ['comments', 'TEXT']]);
      // tables that only existed through SQL files nothing ran: applied ONLY when missing, because the payment file
      // uses INSERT OR REPLACE for its reference data and must never overwrite what production edited
      const fs = require('node:fs'); const path = require('node:path');
      const hasTable = name => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
      for (const [table, file] of [['payment_transactions', 'migration_payment_layers.sql'], ['project_profitability_view', 'migration_profitability.sql'], ['contract_lifecycle', 'migration_contract_lifecycle.sql']]) {
        if (hasTable(table)) continue;
        let sql = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
        // payment channels carry hard-coded account ids (1, 2, 3) that do not exist on a fresh chart:
        // seed them unlinked; the channel's ledger account is chosen in the settings screen
        if (file === 'migration_payment_layers.sql') sql = sql.replace(/,\s*(\d+),\s*'(YER|USD|SAR|EUR)',\s*(\d)\)/g, ", NULL, '$2', $3)");
        db.exec(sql);
      }
    }
  },
  {
    id: '0005_tax_configs_seed',
    description: 'Yemeni tax reference rates (WHT contracting 3%, WHT supplies 1%, VAT 0%) on databases that have none of them',
    up(db) {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tax_configs'").get()) return;
      // INSERT OR IGNORE on the unique tax_code: a rate production already holds (or edited) is never touched
      const law = 'قانون ضرائب الدخل اليمني رقم 17 لسنة 2010 وتعديلاته';
      const note = 'النسبة قابلة للتعديل حسب اللائحة التنفيذية وتوجيهات مصلحة الضرائب والمحاسب القانوني';
      const insert = db.prepare(`INSERT OR IGNORE INTO tax_configs (tax_code, tax_name, rate_percentage, type, law_reference, is_active, legal_disclaimer)
        VALUES (?, ?, ?, ?, ?, 1, ?)`);
      insert.run('WHT-CONT-3', 'ضريبة أرباح تجارية وصناعية - مقاولات (3%)', 3.0, 'wht_contracting', law, note);
      insert.run('WHT-SUPP-1', 'ضريبة خصم من المنبع - توريدات ومشتريات (1%)', 1.0, 'wht_supplies', law, note);
      insert.run('VAT-0', 'ضريبة المبيعات / القيمة المضافة (0% افتراضية للمقاولات)', 0.0, 'vat', 'قانون الضريبة العامة على المبيعات ولائحته التنفيذية',
        'معفاة أو خاضعة لنسبة محددة وفق طبيعة العقد والتوريد');
    }
  },
  {
    id: '0006_request_time_schema',
    description: 'Schema that services created lazily inside the first request (idempotency table, cash-box index, cost-link columns) now exists at boot',
    up(db) {
      // financialSave used CREATE TABLE inside the first idempotent financial request
      db.exec(`CREATE TABLE IF NOT EXISTS financial_save_requests (
        request_id VARCHAR(64) PRIMARY KEY,
        fingerprint VARCHAR(64) NOT NULL,
        status_code INTEGER,
        response_json TEXT
      )`);
      // cashBoxService added the column and index on its first call
      addColumns(db, 'cash_movements', [['project_id', 'INTEGER']]);
      if (columns(db, 'cash_movements').length) db.exec('CREATE INDEX IF NOT EXISTS idx_cash_box ON cash_movements (project_id, id)');
      // ProjectCostService.ensureSchema ran on expense / project-hub requests
      addColumns(db, 'expenses', [['source_table', 'TEXT'], ['source_id', 'INTEGER']]);
      addColumns(db, 'project_labor_expenses', [['linked_expense_id', 'INTEGER'], ['paid_amount', 'REAL DEFAULT NULL']]);
      addColumns(db, 'project_purchases', [['linked_expense_id', 'INTEGER']]);
      // the one-time paid_amount backfill ProjectCostService repeated after every start
      if (columns(db, 'project_labor_expenses').includes('paid_amount')) {
        db.exec("UPDATE project_labor_expenses SET paid_amount = total_amount WHERE paid_amount IS NULL AND payment_status = 'مدفوع'");
        db.exec('UPDATE project_labor_expenses SET paid_amount = 0 WHERE paid_amount IS NULL');
      }
    }
  },
  {
    id: '0007_staff_password_resets',
    description: 'Staff forgot-password requests approved by an administrator (one-time hashed code); users.password_changed_at / must_change_password',
    up(db) {
      db.exec(`CREATE TABLE IF NOT EXISTS staff_password_resets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        public_ref TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','used','rejected','expired','revoked')),
        requester_note TEXT,
        requested_at TEXT NOT NULL,
        requested_ip TEXT,
        requested_user_agent TEXT,
        approved_by INTEGER,
        approved_at TEXT,
        code_hash TEXT,
        code_expires_at TEXT,
        reset_pin INTEGER NOT NULL DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 0,
        used_at TEXT,
        used_ip TEXT,
        closed_by INTEGER,
        closed_at TEXT,
        close_reason TEXT
      )`);
      // one open (pending or approved) request per account
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_staff_reset_open ON staff_password_resets(user_id) WHERE status IN ('pending','approved')`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_staff_reset_status ON staff_password_resets(status, requested_at)');
      addColumns(db, 'users', [['password_changed_at', 'TEXT'], ['must_change_password', 'INTEGER DEFAULT 0']]);
    }
  }
];

function ensureTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    description TEXT,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
}

/** Applies pending migrations in order. Throws (and rolls back that migration) on the first failure. */
function runMigrations(db, list = MIGRATIONS) {
  ensureTable(db);
  const applied = new Set(db.prepare('SELECT id FROM schema_migrations').all().map(r => r.id));
  const ran = [];
  for (const m of list) {
    if (applied.has(m.id)) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      m.up(db);
      db.prepare('INSERT INTO schema_migrations (id, description) VALUES (?, ?)').run(m.id, m.description || null);
      db.exec('COMMIT');
      ran.push(m.id);
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch {}
      throw Object.assign(new Error(`Schema migration ${m.id} failed: ${err.message}`), { code: 'MIGRATION_FAILED', migration: m.id, cause: err });
    }
  }
  return ran;
}

module.exports = { MIGRATIONS, runMigrations };
