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

function appliedMigrations(db) {
  ensureTable(db);
  return db.prepare('SELECT id, description, applied_at FROM schema_migrations ORDER BY id').all();
}

module.exports = { MIGRATIONS, runMigrations, appliedMigrations };
