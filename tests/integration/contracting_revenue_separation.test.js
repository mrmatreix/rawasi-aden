/**
 * Contracting accounting under the company policy (2026-11-22): revenue is recognised when an approved bill (IPC)
 * is posted — never from cash, never a second time from percentage of completion.
 * 1. An advance receipt is a contract liability (CUSTOMER_ADVANCES), not revenue.
 * 2. Approved change orders revise the contract value; pending ones stay out.
 * 3. Cost-to-cost completion is computed for display, but a POC revenue entry is refused (no duplicate revenue).
 * 4. Posting the approved bill books the compound entry: Dr receivable (net) + retention + advance amortised /
 *    Cr contract revenue (gross), after maker-checker approval.
 * 5. The contracting matrix and the company dashboard read those figures from the ledger.
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

test('Contracting accounting - revenue at billing, advances as liabilities, POC for display only', async (t) => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { if (server.closeAllConnections) server.closeAllConnections(); server.close(); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const { JWT_SECRET } = require('../../server/middleware/security');
  const hash = await bcrypt.hash('test123', 4);
  const user = async (id, username) => {
    await db.run(`INSERT OR REPLACE INTO users (id, username, password_hash, role, full_name, status, permissions, two_factor_enabled)
      VALUES (?, ?, ?, 'admin', ?, 'active', '["*"]', 0)`, [id, username, hash, username]);
    const token = jwt.sign({ id, username, role: 'admin', permissions: ['*'] }, JWT_SECRET, { expiresIn: '1h' });
    return { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, 'X-CSRF-Token': 'ifrs-test-csrf-token-1234567890123456', 'X-Requested-With': 'XMLHttpRequest', Connection: 'close' };
  };
  const maker = await user(7401, 'ifrs_maker');
  const checker = await user(7402, 'ifrs_checker');
  const call = async (headers, method, path, body) => {
    const res = await fetch(baseUrl + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };

  const acc = await ensureRoleAccounts(db, ['CASH_DEFAULT', 'BANK_DEFAULT', 'ACCOUNTS_RECEIVABLE', 'RETENTION_RECEIVABLE', 'CUSTOMER_ADVANCES', 'CONTRACT_REVENUE', 'PROJECT_MATERIAL_COST']);
  const clientId = (await db.run("INSERT INTO clients (name, company, phone, current_balance) VALUES ('شركة الأفق الإنشائية - عميل اختباري', 'مجموعة الأفق', '770000001', 0)")).lastInsertRowid;
  const projectId = (await db.run(`INSERT INTO projects (code, name, client_id, contract_value, estimated_cost, actual_cost, progress_percentage, status)
    VALUES ('PRJ-IFRS-1', 'مشروع مجمع الأفق التجاري', ?, 400000, 200000, 0, 0, 'active')`, [clientId])).lastInsertRowid;
  await db.run("INSERT INTO cost_centers (code, name, type, project_id, status) VALUES ('CC-IFRS', 'مركز مشروع الأفق', 'project', ?, 'active')", [projectId]);
  await db.run(`INSERT INTO project_contracts (project_id, contract_no, title, contract_value, advance_payment_pct, advance_payment_amount, retention_pct, status)
    VALUES (?, 'CNT-IFRS-001', 'عقد تنفيذ مجمع الأفق التجاري', 400000, 25, 100000, 10, 'ساري')`, [projectId]);
  const matrix = async () => {
    const r = await call(maker, 'GET', `/api/billing/contracting-matrix/${projectId}`);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data.data;
  };
  const ledgerRevenue = async () => Number((await db.get(`SELECT COALESCE(SUM(l.credit - l.debit), 0) AS r FROM journal_entry_lines l
    JOIN journal_entries je ON je.id = l.entry_id WHERE je.status = 'posted' AND l.account_id = ? AND l.project_id = ?`, [acc.CONTRACT_REVENUE, projectId])).r);

  // 1. Advance received: credited to customer advances (a liability), no revenue
  let r = await call(maker, 'POST', '/api/payments', { type: 'قبض', client_id: clientId, project_id: projectId, amount: 100000, receipt_category: 'advance_payment', account_id: acc.CUSTOMER_ADVANCES, payment_method: 'تحويل بنكي', date: '2026-09-01', notes: 'دفعة مقدمة 25%' });
  assert.equal(r.status, 200, 'advance receipt: ' + JSON.stringify(r.data));
  const advLines = await db.query(`SELECT l.account_id, l.debit, l.credit FROM journal_entries je JOIN journal_entry_lines l ON l.entry_id = je.id
    WHERE je.reference_type = 'سند قبض' AND je.reference_id = ?`, [r.data.id]);
  assert.ok(advLines.find(l => l.account_id === acc.CUSTOMER_ADVANCES && Number(l.credit) === 100000), 'Cr customer advances: ' + JSON.stringify(advLines));
  assert.equal(await ledgerRevenue(), 0, 'cash is not revenue');
  let m = await matrix();
  assert.equal(m.cash_receipts.total, 100000);
  assert.equal(m.advance_payments.unamortized_liability, 100000);
  assert.equal(m.recognized_revenue.cumulative, 0, 'no revenue despite 100k in cash');

  // 2. Change orders: approved ones revise the contract value, pending ones do not
  await db.run("INSERT INTO project_change_orders (project_id, change_no, title, amount, status, request_date, approval_date) VALUES (?, 'CO-01', 'مصاعد بانورامية', 50000, 'معتمد', '2026-09-02', '2026-09-05')", [projectId]);
  await db.run("INSERT INTO project_change_orders (project_id, change_no, title, amount, status, request_date) VALUES (?, 'CO-02', 'واجهات زجاجية', 30000, 'قيد المراجعة', '2026-09-06')", [projectId]);
  m = await matrix();
  assert.equal(m.base_contract_value, 400000);
  assert.equal(m.variation_orders.approved_amount, 50000);
  assert.equal(m.variation_orders.pending_amount, 30000);
  assert.equal(m.revised_contract_value, 450000);

  // 3. Site cost; completion is shown, but a POC revenue entry is refused by policy
  r = await call(maker, 'POST', '/api/expenses', { project_id: projectId, amount: 47500, expense_type: 'مواد بناء', recipient: 'مصنع الخرسانة', payment_method: 'نقدي', date: '2026-09-10', account_id: acc.PROJECT_MATERIAL_COST });
  assert.equal(r.status, 200, 'site cost: ' + JSON.stringify(r.data));
  m = await matrix();
  assert.equal(m.cumulative_actual_cost, 47500);
  // display only: the revised estimate adds approved change orders at full value (200,000 + 50,000)
  assert.equal(m.revised_estimated_cost, 250000);
  assert.equal(m.cost_to_cost_poc_pct, 19, 'completion = 47,500 / 250,000');
  const entriesBefore = (await db.get('SELECT COUNT(*) AS n FROM journal_entries')).n;
  r = await call(maker, 'POST', '/api/billing/recognize-revenue', { project_id: projectId, period_date: '2026-09-10' });
  assert.ok(r.status >= 400 && r.status < 500, 'POC revenue entry refused: ' + JSON.stringify(r.data));
  assert.match(r.data.message, /المستخلص/, 'the refusal explains the billing policy');
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM journal_entries')).n, entriesBefore, 'nothing posted');
  assert.equal(await ledgerRevenue(), 0);

  // 4. Bill: created as a draft, approved by a checker, then posted as one compound entry
  r = await call(maker, 'POST', '/api/billing', { bill_type: 'مستخلص جاري رقم 1', project_id: projectId, client_id: clientId, amount: 70000, advance_deduction: 17500, retention_deduction: 7000, status: 'معتمد', date: '2026-09-15' });
  assert.equal(r.status, 200, 'bill: ' + JSON.stringify(r.data));
  const billId = r.data.id;
  assert.equal(r.data.status, 'draft', 'creation never posts');
  assert.equal((await call(maker, 'POST', `/api/billing/${billId}/approve`)).status, 403, 'the maker cannot approve their own bill');
  r = await call(checker, 'POST', `/api/billing/${billId}/approve`, { notes: 'تدقيق واعتماد' });
  assert.equal(r.status, 200, 'approve: ' + JSON.stringify(r.data));
  r = await call(checker, 'POST', `/api/billing/${billId}/post`);
  assert.equal(r.status, 200, 'post: ' + JSON.stringify(r.data));
  const bill = await db.get('SELECT net_amount, journal_entry_id FROM bills WHERE id = ?', [billId]);
  assert.equal(Number(bill.net_amount), 45500, '70,000 - 17,500 advance - 7,000 retention');
  const lines = await db.query('SELECT account_id, debit, credit FROM journal_entry_lines WHERE entry_id = ?', [bill.journal_entry_id]);
  const side = (accountId, k) => lines.filter(l => l.account_id === accountId).reduce((s, l) => s + Number(l[k]), 0);
  assert.equal(side(acc.ACCOUNTS_RECEIVABLE, 'debit'), 45500, 'Dr receivable by the net');
  assert.equal(side(acc.RETENTION_RECEIVABLE, 'debit'), 7000, 'Dr retention receivable');
  assert.equal(side(acc.CUSTOMER_ADVANCES, 'debit'), 17500, 'Dr advances amortised');
  assert.equal(side(acc.CONTRACT_REVENUE, 'credit'), 70000, 'Cr revenue by the gross');
  assert.equal(lines.reduce((s, l) => s + Number(l.debit), 0), lines.reduce((s, l) => s + Number(l.credit), 0), 'balanced');
  assert.equal(await ledgerRevenue(), 70000, 'revenue = the posted bill, once');

  // 5. Matrix and dashboard read the ledger
  m = await matrix();
  assert.equal(m.recognized_revenue.cumulative, 70000);
  assert.equal(m.advance_payments.unamortized_liability, 82500, '100,000 received - 17,500 amortised');
  assert.equal(m.retention_money.active_retention_asset, 7000);
  r = await call(maker, 'GET', '/api/reports/dashboard');
  assert.equal(r.status, 200);
  const kpis = r.data.data.kpis;
  assert.equal(kpis.recognized_revenue, 70000, 'dashboard revenue = the ledger: ' + JSON.stringify(kpis));
  assert.equal(kpis.net_profit, 22500, '70,000 revenue - 47,500 cost');
  // the advance is a liability: the client owes the bill's net (45,500), not net minus the whole advance again
  assert.equal(kpis.client_receivables, 45500, 'receivable = bill net; the advance is not deducted twice');
  r = await call(maker, 'GET', '/api/reports/contracting-financial-separation');
  assert.equal(r.status, 200);
  assert.ok(r.data.data.projects.some(p => Number(p.project_id ?? p.id) === projectId), 'the project is in the separation report');
  assert.equal(r.data.data.summary.total_recognized_revenue, 70000, 'company-wide revenue = the ledger, not the POC estimate');
});
