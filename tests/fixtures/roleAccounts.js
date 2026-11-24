'use strict';
// The shared test fixture carries a minimal chart. Suites that post through system account roles
// create the role's account path (same codes as the standard chart) and map the role to its leaf.
const ROLE_PATHS = {
  CASH_DEFAULT: ['111', '11101', '11101001', 'asset', '11'],
  BANK_DEFAULT: ['111', '11102', '11102001', 'asset', '11'],
  INVENTORY: ['113', '11301', '11301001', 'asset', '11'],
  ACCOUNTS_RECEIVABLE: ['112', '11201', '11201001', 'asset', '11'],
  RETENTION_RECEIVABLE: ['112', '11202', '11202001', 'asset', '11'],
  GUARANTEE_CASH_MARGIN: ['119', '11901', '11901001', 'asset', '11'],
  EMPLOYEE_CUSTODY: ['115', '11501', '11501001', 'asset', '11'],
  EMPLOYEE_ADVANCES: ['115', '11501', '11501003', 'asset', '11'],
  WHT_RECEIVABLE: ['118', '11801', '11801001', 'asset', '11'],
  VAT_INPUT: ['118', '11801', '11801002', 'asset', '11'],
  SUPPLIERS_PAYABLE: ['21', '211', '21101', '21101001', 'liability', '2'],
  SUBCONTRACTORS_PAYABLE: ['21', '211', '21101', '21101002', 'liability', '2'],
  SALARIES_PAYABLE: ['21', '214', '21401', '21401001', 'liability', '2'],
  CUSTOMER_ADVANCES: ['21', '214', '21402', '21402001', 'liability', '2'],
  WHT_PAYABLE: ['21', '215', '21501', '21501001', 'liability', '2'],
  VAT_OUTPUT: ['21', '215', '21501', '21501002', 'liability', '2'],
  CONTRACT_REVENUE: ['411', '41101', '41101001', 'revenue', '41'],
  PROJECT_MATERIAL_COST: ['311', '31101', '31101009', 'expense', '31'],
  SITE_LABOR_COST: ['311', '31101', '31101005', 'expense', '31'],
  INVENTORY_SHRINKAGE_LOSS: ['321', '32105', '32105002', 'expense', '32'],
  BANK_CHARGES: ['321', '32105', '32105003', 'expense', '32'],
  GUARANTEE_COMMISSION_EXPENSE: ['321', '32105', '32105004', 'expense', '32'],
  INVENTORY_SURPLUS_GAIN: ['412', '41203', '41203004', 'revenue', '41']
};
const TOP = { 1: 'asset', 11: 'asset', 2: 'liability', 3: 'expense', 31: 'expense', 32: 'expense', 4: 'revenue', 41: 'revenue' };
const LEVEL = { 1: 1, 2: 2, 3: 3, 5: 4, 8: 5 };

async function ensureRoleAccounts(db, roles = Object.keys(ROLE_PATHS)) {
  const SystemAccounts = require('../../server/services/systemAccountService');
  const id = async code => (await db.get('SELECT id FROM accounts WHERE code = ?', [code]))?.id;
  const add = async (code, name, type, parent) => {
    const have = await id(code); if (have) return have;
    const level = LEVEL[code.length];
    return (await db.run('INSERT INTO accounts (code, name, type, parent_id, level, is_posting, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [code, name, type, parent ? await id(parent) : null, level, level === 5 ? 1 : 0, 'active'])).lastInsertRowid;
  };
  const mapped = {};
  for (const role of roles) {
    const spec = ROLE_PATHS[role]; if (!spec) throw new Error('No test path for role ' + role);
    const parent = spec[spec.length - 1]; const type = spec[spec.length - 2]; const codes = spec.slice(0, -2);
    // make sure the top of the path exists too (the minimal chart may lack it)
    const chain = []; for (let c = parent; c; c = c.length > 1 ? c.slice(0, -1) : null) chain.unshift(c);
    let up = null; for (const c of chain) { await add(c, `${TOP[c] || type} ${c}`, TOP[c] || type, up); up = c; }
    let p = parent; for (const code of codes) { await add(code, `${role} ${code}`, type, p); p = code; }
    const leaf = await id(codes[codes.length - 1]);
    await SystemAccounts.setMapping(role, leaf);
    mapped[role] = leaf;
  }
  return mapped;
}

// Older suites address warehouse 1 (central), warehouse 2 (site) and item 1 by id; the fixture has none.
async function ensureInventoryBasics(db) {
  await db.run("INSERT OR IGNORE INTO warehouses (id, code, name, type, location, status) VALUES (1, 'WH-CENTRAL', 'المستودع المركزي', 'central', 'عدن', 'active')");
  await db.run("INSERT OR IGNORE INTO warehouses (id, code, name, type, location, status) VALUES (2, 'WH-SITE', 'مستودع الموقع', 'site', 'عدن', 'active')");
  await db.run("INSERT OR IGNORE INTO items (id, code, name, category, unit, current_quantity, unit_price) VALUES (1, 'ITM-BASE-1', 'خرسانة جاهزة', 'خرسانة', 'م3', 0, 36000)");
}

// Older banking suites address bank account 1; link it to the BANK_DEFAULT ledger account.
async function ensureBankAccount(db) {
  const { BANK_DEFAULT } = await ensureRoleAccounts(db, ['BANK_DEFAULT']);
  await db.run("INSERT OR IGNORE INTO bank_accounts (id, bank_name, account_number, account_id, current_balance) VALUES (1, 'بنك الاختبار', 'ACC-TEST-1', ?, 0)", [BANK_DEFAULT]);
}

module.exports = { ensureRoleAccounts, ensureInventoryBasics, ensureBankAccount, ROLE_PATHS };
