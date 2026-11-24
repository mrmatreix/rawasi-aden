/**
 * Financial reports read the general ledger only (posted entries), with no substitutes:
 * - trial balance: a draft is invisible, posting moves it by exactly the entry; earlier movement becomes opening balance;
 * - balance sheet: stays balanced and follows the as-of date;
 * - income statement: revenue is what the ledger recognised (revenue at billing / journal), never a cash receipt;
 *   an expense draft and an operational payroll row without a journal entry do not count.
 * Runs on its own fresh fixture; the 2030 dates are isolated.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../../server/database/db');
const app = require('../../server/server');
const { ensureRoleAccounts } = require('../fixtures/roleAccounts');

test('Financial Reports - posted-only trial balance, live balance sheet, ledger-only income statement', async (t) => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  t.after(() => { if (server.closeAllConnections) server.closeAllConnections(); server.close(); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const testerId = 7301;
  await db.run(`INSERT OR REPLACE INTO users (id, username, password_hash, role, full_name, status, permissions)
    VALUES (?, 'finrep_tester', ?, 'admin', 'مختبِر التقارير', 'active', '["*"]')`, [testerId, await bcrypt.hash('test123', 4)]);
  const token = jwt.sign({ id: testerId, username: 'finrep_tester', role: 'admin', permissions: ['*'] },
    require('../../server/middleware/security').JWT_SECRET, { expiresIn: '1h' });
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, 'X-CSRF-Token': 'finrep-test-csrf-token-123456789012345', 'X-Requested-With': 'XMLHttpRequest', Connection: 'close' };
  const api = async (method, path, body) => {
    const res = await fetch(baseUrl + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };

  const acc = await ensureRoleAccounts(db, ['CASH_DEFAULT', 'EMPLOYEE_CUSTODY', 'ACCOUNTS_RECEIVABLE', 'CONTRACT_REVENUE', 'PROJECT_MATERIAL_COST', 'BANK_CHARGES']);
  const center = (await db.get('SELECT id FROM cost_centers ORDER BY id LIMIT 1'))?.id;
  const code = async id => (await db.get('SELECT code FROM accounts WHERE id = ?', [id])).code;
  const custodyCode = await code(acc.EMPLOYEE_CUSTODY);
  let r = await api('POST', '/api/projects', { code: 'TEST-FINREP-2030', name: 'TEST-FINREP مشروع التقارير', contract_value: 1000000, status: 'active', start_date: '2030-01-01' });
  assert.equal(r.status, 200, 'project: ' + JSON.stringify(r.data));
  const projectId = r.data.data.id;

  const journal = async (date, description, lines, status = 'posted') => {
    const res = await api('POST', '/api/accounting/journal-entries', { date, description, status, lines });
    assert.equal(res.status, 200, description + ': ' + JSON.stringify(res.data));
    return res.data;
  };
  const tb = async (q = '?from_date=2030-01-01&to_date=2030-12-31') => {
    const res = await api('GET', '/api/reports/trial-balance' + q);
    assert.equal(res.status, 200, JSON.stringify(res.data));
    return res.data;
  };

  // 1. Trial balance: a draft is invisible; posting moves both sides by exactly the entry
  const base = (await tb()).data.totals;
  const draft = await journal('2030-06-15', 'TEST-FINREP قيد مسودة', [
    { account_id: acc.EMPLOYEE_CUSTODY, debit: 50000, credit: 0 },
    { account_id: acc.CASH_DEFAULT, debit: 0, credit: 50000 }
  ], 'draft');
  assert.equal(draft.status, 'draft');
  let totals = (await tb()).data.totals;
  assert.equal(totals.closing_debit, base.closing_debit, 'a draft does not raise the debit side');
  assert.equal(totals.closing_credit, base.closing_credit, 'a draft does not raise the credit side');
  r = await api('POST', `/api/accounting/journal-entries/${draft.id}/post`);
  assert.equal(r.status, 200, 'post: ' + JSON.stringify(r.data));
  const report = await tb();
  assert.equal(report.data.totals.closing_debit, base.closing_debit + 50000, 'debit delta = 50k');
  assert.equal(report.data.totals.closing_credit, base.closing_credit + 50000, 'credit delta = 50k');
  assert.equal(report.data.totals.is_balanced, true);

  // 2. Movement before the period is the opening balance of the next one
  const july = await tb('?from_date=2030-07-01&to_date=2030-07-31');
  const custodyRow = july.data.accounts.find(a => a.code === custodyCode);
  assert.ok(custodyRow, 'custody account row present');
  assert.equal(Number(custodyRow.opening_debit), 50000, 'June movement opens July');
  assert.equal(Number(custodyRow.period_debit), 0, 'no July movement');

  // 3. Balance sheet: balanced at both dates and live on the as-of date
  const bs = async asOf => (await api('GET', '/api/reports/balance-sheet?as_of=' + asOf)).data;
  const before = await bs('2030-06-14'); const after = await bs('2030-06-30');
  assert.equal(before.reconciliation.is_balanced, true); assert.equal(after.reconciliation.is_balanced, true);
  assert.equal(after.data.totals.assets, before.data.totals.assets, 'custody up, box down: total assets unchanged');

  // 4. Income statement in an isolated period: ledger only
  await journal('2030-08-05', 'TEST-FINREP إيراد معترف به', [
    { account_id: acc.ACCOUNTS_RECEIVABLE, debit: 100000, credit: 0, project_id: projectId },
    { account_id: acc.CONTRACT_REVENUE, debit: 0, credit: 100000, project_id: projectId, cost_center_id: center }
  ]);
  r = await api('POST', '/api/expenses', { expense_type: 'مواد بناء', project_id: projectId, amount: 20000, payment_method: 'نقدي', date: '2030-08-10', account_id: acc.PROJECT_MATERIAL_COST });
  assert.equal(r.status, 200, 'project expense: ' + JSON.stringify(r.data));
  r = await api('POST', '/api/expenses', { expense_type: 'مصروفات بنكية', amount: 5000, payment_method: 'نقدي', date: '2030-08-11', account_id: acc.BANK_CHARGES });
  assert.equal(r.status, 200, 'general expense: ' + JSON.stringify(r.data));
  r = await api('POST', '/api/expenses', { expense_type: 'مسودة مستبعدة', amount: 999999, payment_method: 'نقدي', date: '2030-08-12', status: 'draft', account_id: acc.BANK_CHARGES });
  assert.equal(r.status, 200, 'expense draft: ' + JSON.stringify(r.data));
  // a payroll row without a journal entry is operational data, not ledger: it must not reach the statement
  await db.run(`INSERT OR IGNORE INTO employees (employee_no, full_name, job_title, basic_salary, status) VALUES ('TEST-FINREP-001', 'موظف اختبار التقارير', 'محاسب', 30000, 'active')`);
  const emp = await db.get("SELECT id FROM employees WHERE employee_no = 'TEST-FINREP-001'");
  await db.run("INSERT INTO payroll (employee_id, payroll_month, basic_salary, net_salary, status, paid_date) VALUES (?, '2030-08', 30000, 30000, 'paid', '2030-08-20')", [emp.id]);

  r = await api('GET', '/api/reports/income-statement?from_date=2030-08-01&to_date=2030-08-31');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const is = r.data.data;
  assert.equal(is.total_revenues, 100000, 'revenue = what the ledger recognised');
  assert.equal(is.total_expenses, 25000, 'expenses = 20k project + 5k general (draft and payroll row excluded)');
  assert.equal(is.net_profit, 75000);
  assert.equal(is.total_revenues - is.total_expenses, is.net_profit);
});
