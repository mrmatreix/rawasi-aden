/**
 * The contracting matrix takes a project's actual cost from the general ledger (found on staging 2026-11-23):
 * adding vouchers + labor lines + purchases counted a labor line twice once a linked voucher settled it
 * (40,000 for 20,000 of work), and missed custody settlements that exist only as ledger entries.
 * Scenario: unpaid labor 20,000 -> linked voucher 20,000 -> custody 30,000 settled for 12,000 => cost 32,000.
 * Runs on its own fresh fixture.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../../server/database/db');
const app = require('../../server/server');
const { ensureRoleAccounts } = require('../fixtures/roleAccounts');

test('contracting matrix: project cost comes from the ledger (linked labor once, custody settlements included)', async (t) => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { if (server.closeAllConnections) server.closeAllConnections(); server.close(); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const userId = 7501;
  await db.run(`INSERT OR REPLACE INTO users (id, username, password_hash, role, full_name, status, permissions, two_factor_enabled)
    VALUES (?, 'matrix_tester', ?, 'admin', 'مختبِر المصفوفة', 'active', '["*"]', 0)`, [userId, await bcrypt.hash('test123', 4)]);
  const token = jwt.sign({ id: userId, username: 'matrix_tester', role: 'admin', permissions: ['*'] }, require('../../server/middleware/security').JWT_SECRET, { expiresIn: '1h' });
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, 'X-CSRF-Token': 'matrix-test-csrf-token-1234567890123456', 'X-Requested-With': 'XMLHttpRequest', Connection: 'close' };
  const api = async (method, path, body) => {
    const res = await fetch(baseUrl + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };

  const acc = await ensureRoleAccounts(db, ['CASH_DEFAULT', 'SALARIES_PAYABLE', 'SITE_LABOR_COST', 'EMPLOYEE_CUSTODY', 'PROJECT_MATERIAL_COST', 'ACCOUNTS_RECEIVABLE', 'CONTRACT_REVENUE']);
  const clientId = (await db.run("INSERT INTO clients (name) VALUES ('عميل اختبار المصفوفة')")).lastInsertRowid;
  const projectId = (await db.run("INSERT INTO projects (code, name, client_id, contract_value, estimated_cost, status) VALUES ('PRJ-MTX', 'مشروع اختبار المصفوفة', ?, 400000, 200000, 'active')", [clientId])).lastInsertRowid;
  await db.run("INSERT OR IGNORE INTO employees (employee_no, full_name, job_title, basic_salary, status) VALUES ('MTX-EMP', 'موظف اختبار المصفوفة', 'مهندس', 100000, 'active')");
  const emp = await db.get("SELECT id FROM employees WHERE employee_no = 'MTX-EMP'");

  // 1. unpaid labor 20,000 (accrual Dr labor cost / Cr wages payable) settled by a linked voucher (Dr payable / Cr cash)
  let r = await api('POST', `/api/project-hub/${projectId}/labor`, { worker_name_or_team: 'طاقم المصفوفة', trade: 'خرسانة', total_amount: 20000, payment_status: 'غير مدفوع', date: '2031-05-02' });
  assert.equal(r.status, 200, 'labor: ' + JSON.stringify(r.data));
  const laborId = r.data.data.id;
  r = await api('POST', '/api/expenses', { expense_type: 'أجور عمالة', project_id: projectId, amount: 20000, payment_method: 'نقدي', date: '2031-05-03', link_labor_id: laborId });
  assert.equal(r.status, 200, 'linked voucher: ' + JSON.stringify(r.data));

  // 2. custody 30,000 settled for 12,000 on the project (a ledger-only cost)
  r = await api('POST', '/api/accounting/custodies', { operation_type: 'صرف عهدة', employee_id: emp.id, project_id: projectId, total_amount: 30000, date: '2031-05-04' });
  assert.equal(r.status, 200, 'custody: ' + JSON.stringify(r.data));
  r = await api('POST', '/api/accounting/custodies', { operation_type: 'تصفية عهدة', related_custody_id: r.data.id, employee_id: emp.id, expense_account_id: acc.PROJECT_MATERIAL_COST, spent_amount: 12000, date: '2031-05-05' });
  assert.equal(r.status, 200, 'settlement: ' + JSON.stringify(r.data));

  // 3. the matrix reads the ledger: 20,000 labor once + 12,000 custody = 32,000
  const ledgerCost = Number((await db.get(`SELECT COALESCE(SUM(l.debit - l.credit), 0) AS c FROM journal_entry_lines l JOIN journal_entries je ON je.id = l.entry_id
    WHERE je.status = 'posted' AND l.project_id = ? AND l.account_id IN (?, ?)`, [projectId, acc.SITE_LABOR_COST, acc.PROJECT_MATERIAL_COST])).c);
  assert.equal(ledgerCost, 32000, 'ledger cost on the project');
  r = await api('GET', `/api/billing/contracting-matrix/${projectId}`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const m = r.data.data;
  assert.equal(m.cumulative_actual_cost, 32000, 'matrix cost = ledger cost (was 40,000: linked labor counted twice, custody missed)');
  assert.equal(m.records_cost, 40000, 'the operational sum is still exposed for comparison');
  assert.equal(m.cost_to_cost_poc_pct, 16, 'completion = 32,000 / 200,000');
  assert.equal(m.recognized_revenue.cumulative, 0, 'no bill posted: no revenue');
  assert.equal(m.financial_analysis.true_recognized_profit, -32000, 'profit = ledger revenue - ledger cost');
});
