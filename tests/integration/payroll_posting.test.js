// Stage 4.5: payroll accrual (month end, role accounts, pending records only) then payment.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('payroll: accrual by component on role accounts at month end, advances recovered, then a separate payment', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rawasi-payroll-'));
  Object.assign(process.env, { NODE_ENV: 'development', DB_ENGINE: 'sqlite', RAWASI_DB_PATH: path.join(temp, 'fixture.db'), RAWASI_UPLOAD_DIR: path.join(temp, 'uploads'), RAWASI_PROJECTS_DIR: path.join(temp, 'projects'), RAWASI_BACKUP_DIR: path.join(temp, 'backups'), RAWASI_SCRATCH_DIR: path.join(temp, 'scratch'), ENABLE_SCHEDULERS: 'false' });
  const fixture = spawnSync(process.execPath, ['tests/create_fixture.js'], { env: process.env, encoding: 'utf8', windowsHide: true });
  assert.equal(fixture.status, 0, fixture.stderr);
  const db = require('../../server/database/db');
  let server;
  try {
    await db.ready;
    const SystemAccounts = require('../../server/services/systemAccountService');
    const { SYSTEM_ACCOUNT_ROLES } = require('../../server/services/chartOfAccountsRules');
    const id = async code => (await db.get('SELECT id FROM accounts WHERE code = ?', [code]))?.id;
    const addAccount = async (code, name, type, parent) => {
      if (await id(code)) return id(code);
      const level = { 1: 1, 2: 2, 3: 3, 5: 4, 8: 5 }[code.length];
      return (await db.run('INSERT INTO accounts (code, name, type, parent_id, level, is_posting, status) VALUES (?, ?, ?, ?, ?, ?, ?)', [code, name, type, parent ? await id(parent) : null, level, level === 5 ? 1 : 0, 'active'])).lastInsertRowid;
    };
    // Production-shaped payroll accounts
    await addAccount('32101', 'المرتبات والأجور', 'expense', '321');
    for (const c of ['32101001', '32101002', '32101003', '32101004', '32101005', '32101006', '32101008', '32101010']) await addAccount(c, 'رواتب ' + c, 'expense', '32101');
    await addAccount('21', 'قصيرة', 'liability', '2'); await addAccount('212', 'أرصدة دائنة', 'liability', '21'); await addAccount('21202', 'دائنون متنوعون', 'liability', '212');
    for (const c of ['21202001', '21202002', '21202003']) await addAccount(c, 'التزام ' + c, 'liability', '21202');
    await addAccount('214', 'أرصدة دائنة أخرى', 'liability', '21'); await addAccount('21401', 'المصاريف المستحقة', 'liability', '214'); await addAccount('21401001', 'رواتب مستحقة الدفع', 'liability', '21401');
    await addAccount('115', 'السلف', 'asset', '11'); await addAccount('11501', 'السلف', 'asset', '115'); await addAccount('11501003', 'سلف الموظفين', 'asset', '11501');
    for (const [role, def] of Object.entries(SYSTEM_ACCOUNT_ROLES)) {
      if (!role.startsWith('PAYROLL_') && !['SALARIES_PAYABLE', 'SOCIAL_INSURANCE_PAYABLE', 'SKILLS_FUND_PAYABLE', 'EMPLOYEE_ADVANCES'].includes(role)) continue;
      const accId = await id(def.codes[0]); if (accId) await SystemAccounts.setMapping(role, accId);
    }
    await db.run('UPDATE accounts SET cost_center_required = 1 WHERE code LIKE ?', ['32101%']);
    const ccId = (await db.get("SELECT id FROM cost_centers WHERE code = 'CC-100'"))?.id || (await db.run("INSERT INTO cost_centers (code, name, type, status) VALUES ('CC-100', 'الإدارة العامة', 'عام', 'active')")).lastInsertRowid;

    const empA = (await db.run("INSERT INTO employees (employee_no, full_name, basic_salary, status) VALUES ('E-1', 'موظف أ', 300000, 'active')")).lastInsertRowid;
    await db.run("INSERT INTO employee_advances (employee_id, amount, recovered_amount, installment_amount, date, status) VALUES (?, 25000, 0, 10000, '2093-01-10', 'active')", [empA]);

    server = require('../../server/server').listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const { JWT_SECRET } = require('../../server/middleware/security');
    const sign = (uid, username, role) => require('jsonwebtoken').sign({ id: uid, username, role }, JWT_SECRET, { expiresIn: '3m' });
    const admin = (await db.get("SELECT id FROM users WHERE username = 'admin'")).id;
    const tokens = { admin: sign(admin, 'admin', 'admin') };
    const hrUser = (await db.run("INSERT INTO users (username, password_hash, full_name, role, status, two_factor_enabled, permissions) VALUES ('hr1', 'x', 'HR', 'hr', 'active', 0, 'hr:view,hr:create,hr:payroll')")).lastInsertRowid;
    tokens.hr = sign(hrUser, 'hr1', 'hr');
    const api = (who, method, route, body) => fetch(`http://127.0.0.1:${server.address().port}/api/hr${route}`, { method, headers: { Authorization: 'Bearer ' + tokens[who], 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, body: await r.json() }));

    const gen = await api('admin', 'POST', '/payroll/generate', { payroll_month: '2093-02' });
    assert.equal(gen.status, 200, JSON.stringify(gen.body));
    const rec = await db.get("SELECT * FROM payroll WHERE employee_id = ? AND payroll_month = '2093-02'", [empA]);
    assert.equal(rec.loan_installments, 10000);

    // Preview = the lines that will be posted, balanced, all roles mapped
    const preview = await api('admin', 'GET', '/payroll/2093-02/preview-journal');
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.equal(preview.body.data.summary.is_balanced, true);
    assert.deepEqual(preview.body.data.summary.unmapped_roles, []);
    assert.equal(preview.body.data.accrual_date, '2093-02-28');

    // Posting needs the posting permission (H5 policy)
    assert.equal((await api('hr', 'POST', '/payroll/2093-02/post-to-journal')).status, 403);

    // 1. Accrual: dated the last day of the month, each component on its account, net to salaries payable
    const accrual = await api('admin', 'POST', '/payroll/2093-02/post-to-journal');
    assert.equal(accrual.status, 200, JSON.stringify(accrual.body));
    const je = await db.get('SELECT * FROM journal_entries WHERE id = ?', [accrual.body.journal_entry_id]);
    assert.equal(je.date, '2093-02-28');
    const lines = await db.query('SELECT a.code, l.debit, l.credit, l.cost_center_id FROM journal_entry_lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = ?', [je.id]);
    const by = code => lines.filter(l => l.code === code).reduce((s, l) => s + l.debit - l.credit, 0);
    assert.equal(by('32101008'), rec.earned_basic);
    assert.equal(by('32101001'), rec.transport_allowance);
    assert.equal(by('32101004'), rec.living_allowance);
    assert.equal(by('32101006'), rec.insurance_employer);
    assert.equal(by('21401001'), -rec.total_net_salary);
    assert.equal(by('21202001'), -rec.tax_amount);
    assert.equal(by('21202002'), -(rec.insurance_employee + rec.insurance_employer));
    assert.equal(by('11501003'), -10000);
    assert.ok(lines.filter(l => l.code.startsWith('32101')).every(l => l.cost_center_id === Number(ccId)), 'expense lines carry the employee cost centre');
    assert.equal(lines.reduce((s, l) => s + l.debit, 0), lines.reduce((s, l) => s + l.credit, 0));
    assert.equal(await db.get("SELECT COUNT(*) AS n FROM cash_movements WHERE notes LIKE '%2093-02%'").then(r => r.n), 0, 'accrual moves no cash');
    const adv = await db.get('SELECT recovered_amount, status FROM employee_advances WHERE employee_id = ?', [empA]);
    assert.equal(adv.recovered_amount, 10000); assert.equal(adv.status, 'active');
    assert.equal((await api('admin', 'POST', '/payroll/2093-02/post-to-journal')).status, 400, 'already accrued');

    // H9: a record added later is accrued alone, not re-accruing the month
    const empB = (await db.run("INSERT INTO employees (employee_no, full_name, basic_salary, status) VALUES ('E-2', 'موظف ب', 200000, 'active')")).lastInsertRowid;
    await api('admin', 'POST', '/payroll/generate', { payroll_month: '2093-02' });
    const recB = await db.get("SELECT * FROM payroll WHERE employee_id = ? AND payroll_month = '2093-02'", [empB]);
    const accrualB = await api('admin', 'POST', '/payroll/2093-02/post-to-journal');
    assert.equal(accrualB.status, 200, JSON.stringify(accrualB.body));
    assert.equal(accrualB.body.records, 1);
    assert.equal(accrualB.body.total_net, recB.total_net_salary);

    // 2. Payment: Dr salaries payable / Cr cash for all accrued records, once
    const paid = await api('admin', 'POST', '/payroll/2093-02/pay', { date: '2093-03-02' });
    assert.equal(paid.status, 200, JSON.stringify(paid.body));
    assert.equal(paid.body.total_net, rec.total_net_salary + recB.total_net_salary);
    const payLines = await db.query('SELECT a.code, l.debit, l.credit FROM journal_entry_lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = ? ORDER BY l.id', [paid.body.journal_entry_id]);
    assert.deepEqual(payLines.map(l => [l.code, l.debit, l.credit]), [['21401001', paid.body.total_net, 0], ['11101001', 0, paid.body.total_net]]);
    const payable = await db.get("SELECT SUM(l.debit - l.credit) AS n FROM journal_entry_lines l JOIN journal_entries je ON je.id = l.entry_id JOIN accounts a ON a.id = l.account_id WHERE je.status = 'posted' AND a.code = '21401001'");
    assert.equal(payable.n, 0, 'salaries payable cleared');
    const cash = await db.query("SELECT cash_out FROM cash_movements WHERE notes LIKE '%2093-02%'");
    assert.equal(cash.length, 1); assert.equal(cash[0].cash_out, paid.body.total_net);
    assert.equal((await db.get("SELECT COUNT(*) AS n FROM payroll WHERE payroll_month = '2093-02' AND status = 'paid'")).n, 2);
    assert.equal((await api('admin', 'POST', '/payroll/2093-02/pay', { date: '2093-03-02' })).status, 400, 'nothing left to pay');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
  }
});
