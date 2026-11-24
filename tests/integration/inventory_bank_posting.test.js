// Stage 4.6: inventory, material, bank and guarantee entries through PostingService on role accounts (M8).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('inventory surplus/deficit, project returns, bank charges, bounced cheques and guarantees use the right accounts', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rawasi-inventory-bank-'));
  Object.assign(process.env, { NODE_ENV: 'development', DB_ENGINE: 'sqlite', RAWASI_DB_PATH: path.join(temp, 'fixture.db'), RAWASI_UPLOAD_DIR: path.join(temp, 'uploads'), RAWASI_PROJECTS_DIR: path.join(temp, 'projects'), RAWASI_BACKUP_DIR: path.join(temp, 'backups'), RAWASI_SCRATCH_DIR: path.join(temp, 'scratch'), ENABLE_SCHEDULERS: 'false' });
  const fixture = spawnSync(process.execPath, ['tests/create_fixture.js'], { env: process.env, encoding: 'utf8', windowsHide: true });
  assert.equal(fixture.status, 0, fixture.stderr);
  const db = require('../../server/database/db');
  await db.ready;
  const SystemAccounts = require('../../server/services/systemAccountService');
  const Inventory = require('../../server/services/inventoryValuationService');
  const Bank = require('../../server/services/bankReconciliationService');
  const Guarantees = require('../../server/services/taxAndGuaranteeService');
  const id = async code => (await db.get('SELECT id FROM accounts WHERE code = ?', [code]))?.id;
  const addAccount = async (code, name, type, parent) => {
    if (await id(code)) return id(code);
    const level = { 1: 1, 2: 2, 3: 3, 5: 4, 8: 5 }[code.length];
    return (await db.run('INSERT INTO accounts (code, name, type, parent_id, level, is_posting, status) VALUES (?, ?, ?, ?, ?, ?, ?)', [code, name, type, parent ? await id(parent) : null, level, level === 5 ? 1 : 0, 'active'])).lastInsertRowid;
  };
  const roles = {
    INVENTORY: ['113', '11301', '11301001', 'asset', '11'],
    SUPPLIERS_PAYABLE: ['21', '211', '21101', '21101001', 'liability', '2'],
    ACCOUNTS_RECEIVABLE: ['112', '11201', '11201001', 'asset', '11'],
    PROJECT_MATERIAL_COST: ['31101009', 'expense', '31101'],
    INVENTORY_SHRINKAGE_LOSS: ['32105', '32105002', 'expense', '321'],
    INVENTORY_SURPLUS_GAIN: ['412', '41203', '41203004', 'revenue', '41'],
    BANK_CHARGES: ['32105003', 'expense', '32105'],
    GUARANTEE_CASH_MARGIN: ['119', '11901', '11901001', 'asset', '11'],
    GUARANTEE_COMMISSION_EXPENSE: ['32105004', 'expense', '32105']
  };
  for (const [role, spec] of Object.entries(roles)) {
    const parent = spec[spec.length - 1]; const type = spec[spec.length - 2]; const codes = spec.slice(0, -2);
    let p = parent; for (const code of codes) { await addAccount(code, `${role} ${code}`, type, p); p = code; }
    await SystemAccounts.setMapping(role, await id(codes[codes.length - 1]));
  }
  const user = { id: (await db.get("SELECT id FROM users WHERE username = 'admin'")).id, username: 'admin' };
  const lines = async entryNo => (await db.query('SELECT a.code, l.debit, l.credit, l.project_id FROM journal_entry_lines l JOIN journal_entries je ON je.id = l.entry_id JOIN accounts a ON a.id = l.account_id WHERE je.entry_no = ? ORDER BY l.id', [entryNo])).map(r => ({ ...r }));

  const wh = (await db.run("INSERT INTO warehouses (code, name, type, status) VALUES ('WH-T', 'مستودع اختبار', 'central', 'active')")).lastInsertRowid;
  const item = (await db.run("INSERT INTO items (code, name, unit, unit_price, current_quantity) VALUES ('ITM-T', 'أسمنت', 'كيس', 100, 50)")).lastInsertRowid;
  await db.run('INSERT INTO warehouse_stocks (warehouse_id, item_id, quantity, last_cost, average_cost) VALUES (?, ?, 50, 100, 100)', [wh, item]);

  // M8: a stock-count surplus is "inventory surplus", never project revenue
  const surplus = await Inventory.processStocktakingAdjustment({ warehouse_id: wh, item_id: item, physical_qty: 53, reason: 'جرد', date: '2098-07-01', user });
  assert.deepEqual(await lines(surplus.journal_entry_no), [{ code: '11301001', debit: 300, credit: 0, project_id: null }, { code: '41203004', debit: 0, credit: 300, project_id: null }]);
  const deficit = await Inventory.processStocktakingAdjustment({ warehouse_id: wh, item_id: item, physical_qty: 51, reason: 'جرد', date: '2098-07-02', user });
  assert.deepEqual(await lines(deficit.journal_entry_no), [{ code: '32105002', debit: 200, credit: 0, project_id: null }, { code: '11301001', debit: 0, credit: 200, project_id: null }]);

  // M8: a site return reduces the project's material cost (on the project), not an administrative expense
  const projectId = (await db.run("INSERT INTO projects (name, code, status) VALUES ('مشروع المواد', 'PRJ-MAT', 'active')")).lastInsertRowid;
  const ret = await Inventory.processProjectReturn({ project_id: projectId, warehouse_id: wh, item_id: item, quantity: 2, reason: 'فائض', date: '2098-07-03', user });
  assert.deepEqual(await lines(ret.journal_entry_no), [{ code: '11301001', debit: 200, credit: 0, project_id: null }, { code: '31101009', debit: 0, credit: 200, project_id: Number(projectId) }]);

  // Bank charge on the bank's own ledger account; bounced received cheque reopens the receivable
  const bankGl = await id('11102001');
  const bankAcc = (await db.run("INSERT INTO bank_accounts (bank_name, account_number, account_id, current_balance) VALUES ('بنك الاختبار', 'ACC-1', ?, 10000)", [bankGl])).lastInsertRowid;
  const charge = await Bank.recordBankCharge({ bank_account_id: bankAcc, amount: 75, date: '2098-07-04', user });
  assert.deepEqual(await lines(charge.entry_no), [{ code: '32105003', debit: 75, credit: 0, project_id: null }, { code: '11102001', debit: 0, credit: 75, project_id: null }]);
  const cheque = await Bank.createCheque({ cheque_no: 'CHQ-1', type: 'received', bank_account_id: bankAcc, beneficiary_name: 'الشركة', amount: 900, issue_date: '2098-07-05' });
  const bounced = await Bank.processBouncedCheque(cheque.id, { bounce_date: '2098-07-06', user });
  assert.deepEqual((await lines(bounced.journal_entry_no)).map(l => [l.code, l.debit, l.credit]), [['11201001', 900, 0], ['11102001', 0, 900]]);

  // Guarantee: cash margin to the restricted-cash account, commission to its expense, both against the bank account
  const lg = await Guarantees.issueBankGuarantee({ guarantee_no: 'LG-T', project_id: projectId, issuing_bank: 'بنك الاختبار', bank_account_id: bankAcc, amount: 10000, cash_margin_pct: 10, commission_fee: 50, issue_date: '2098-07-07', user });
  assert.deepEqual((await lines(lg.journal_entry_no)).map(l => [l.code, l.debit, l.credit]), [['11901001', 1000, 0], ['32105004', 50, 0], ['11102001', 0, 1050]]);
  const released = await Guarantees.releaseBankGuarantee(lg.id, { release_date: '2098-07-08', user });
  assert.deepEqual((await lines(released.journal_entry_no)).map(l => [l.code, l.debit, l.credit]), [['11102001', 1000, 0], ['11901001', 0, 1000]]);

  // Nothing left on hard-coded ids: every entry above balances and only uses mapped leaf accounts
  const bad = await db.query("SELECT je.entry_no FROM journal_entries je JOIN journal_entry_lines l ON l.entry_id = je.id GROUP BY je.id HAVING ABS(SUM(l.debit) - SUM(l.credit)) > 0.005");
  assert.deepEqual(bad, []);
});
