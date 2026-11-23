/**
 * Employee funds on the ledger: custody disbursement / settlement and salary advances.
 * - Disbursement: Dr custody with the employee (EMPLOYEE_CUSTODY) / Cr box, one cash-book row under the custody number.
 * - Settlement: Dr the expense actually incurred / Cr custody, on the original custody's project, no cash movement;
 *   an unknown account, a non-expense account and a missing account are refused, and a refusal changes nothing.
 * - Advance: Dr employee advances (EMPLOYEE_ADVANCES, recovered later by payroll — payroll_posting.test.js) / Cr box.
 * - The ledger agrees with the documents: custody balance = remaining custody, box ledger = cash book.
 * Year-end closing is covered by period_closing.test.js; this suite runs on its own fresh fixture.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../../server/database/db');
const app = require('../../server/server');
const { ensureRoleAccounts } = require('../fixtures/roleAccounts');

test('Employee funds - custody disbursement, settlement and advances post balanced ledger entries', async (t) => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  t.after(() => { if (server.closeAllConnections) server.closeAllConnections(); server.close(); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const testerId = 7204;
  await db.run(`INSERT OR REPLACE INTO users (id, username, password_hash, role, full_name, status, permissions)
    VALUES (?, 'custody_tester', ?, 'admin', 'مختبِر العهد', 'active', '["*"]')`, [testerId, await bcrypt.hash('test123', 4)]);
  const token = jwt.sign({ id: testerId, username: 'custody_tester', role: 'admin', permissions: ['*'] },
    require('../../server/middleware/security').JWT_SECRET, { expiresIn: '1h' });
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, 'X-CSRF-Token': 'custody-test-csrf-token-1234567890123456', 'X-Requested-With': 'XMLHttpRequest', Connection: 'close' };
  const api = async (method, path, body) => {
    const res = await fetch(baseUrl + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };

  const acc = await ensureRoleAccounts(db, ['CASH_DEFAULT', 'EMPLOYEE_CUSTODY', 'EMPLOYEE_ADVANCES', 'PROJECT_MATERIAL_COST', 'ACCOUNTS_RECEIVABLE']);
  await db.run(`INSERT OR IGNORE INTO employees (employee_no, full_name, job_title, department, basic_salary, status)
    VALUES ('TEST-CUST-001', 'موظف اختبار العهد', 'مهندس موقع', 'المشاريع', 150000, 'active')`);
  const emp = await db.get("SELECT id FROM employees WHERE employee_no = 'TEST-CUST-001'");
  let r = await api('POST', '/api/projects', { code: 'TEST-BOX-A', name: 'TEST-BOX-A مشروع العهد', contract_value: 500000, status: 'active', start_date: '2031-01-01' });
  assert.equal(r.status, 200, 'project: ' + JSON.stringify(r.data));
  const project = r.data.data.id;

  const lines = entryId => db.query('SELECT account_id, debit, credit, project_id, party_type, party_id FROM journal_entry_lines WHERE entry_id = ? ORDER BY id', [entryId]);
  const balance = async accountId => {
    const row = await db.get(`SELECT COALESCE(SUM(l.debit - l.credit), 0) AS b FROM journal_entry_lines l JOIN journal_entries je ON je.id = l.entry_id
      WHERE l.account_id = ? AND je.status = 'posted'`, [accountId]);
    return Number(row.b);
  };
  const boxBefore = await balance(acc.CASH_DEFAULT);

  // 1. Disbursement: balanced posted entry on the project, employee as party, one cash-book row
  r = await api('POST', '/api/accounting/custodies', { operation_type: 'صرف عهدة', employee_id: emp.id, project_id: project, total_amount: 30000, date: '2031-01-10', notes: 'TEST عهدة' });
  assert.equal(r.status, 200, 'disbursement: ' + JSON.stringify(r.data));
  assert.ok(r.data.journal_entry_id && r.data.entry_no, 'the disbursement returns its entry');
  const custodyId = r.data.id; const custodyNo = r.data.custody_no;
  assert.equal((await db.get('SELECT status FROM journal_entries WHERE id = ?', [r.data.journal_entry_id])).status, 'posted');
  assert.deepEqual((await lines(r.data.journal_entry_id)).map(l => ({ ...l })), [
    { account_id: acc.EMPLOYEE_CUSTODY, debit: 30000, credit: 0, project_id: project, party_type: 'employee', party_id: emp.id },
    { account_id: acc.CASH_DEFAULT, debit: 0, credit: 30000, project_id: project, party_type: null, party_id: null }
  ]);
  const cashRows = await db.query('SELECT account_id, cash_out FROM cash_movements WHERE reference_no = ?', [custodyNo]);
  assert.deepEqual(cashRows.map(c => ({ ...c })), [{ account_id: acc.CASH_DEFAULT, cash_out: 30000 }], 'one cash-book row on the box');

  // 2. Settlement guards: unknown, non-expense and missing accounts are refused without side effects
  for (const [body, why] of [[{ expense_account_id: 999999 }, 'unknown'], [{ expense_account_id: acc.ACCOUNTS_RECEIVABLE }, 'not an expense'], [{}, 'missing']]) {
    r = await api('POST', '/api/accounting/custodies', { operation_type: 'تصفية عهدة', related_custody_id: custodyId, employee_id: emp.id, spent_amount: 12000, date: '2031-01-15', ...body });
    assert.equal(r.status, 400, `${why} expense account refused: ` + JSON.stringify(r.data));
  }
  assert.equal(Number((await db.get('SELECT remaining_amount FROM custodies WHERE id = ?', [custodyId])).remaining_amount), 30000, 'a refused settlement changes nothing');

  // 3. Settlement: Dr expense / Cr custody on the original project, no cash movement
  r = await api('POST', '/api/accounting/custodies', { operation_type: 'تصفية عهدة', related_custody_id: custodyId, employee_id: emp.id, expense_account_id: acc.PROJECT_MATERIAL_COST, spent_amount: 12000, date: '2031-01-15' });
  assert.equal(r.status, 200, 'settlement: ' + JSON.stringify(r.data));
  assert.ok(r.data.journal_entry_id);
  const settleLines = await lines(r.data.journal_entry_id);
  assert.ok(settleLines.find(l => l.account_id === acc.PROJECT_MATERIAL_COST && Number(l.debit) === 12000 && l.project_id === project), 'Dr the expense on the custody project');
  assert.ok(settleLines.find(l => l.account_id === acc.EMPLOYEE_CUSTODY && Number(l.credit) === 12000 && l.party_id === emp.id), 'Cr the employee custody');
  assert.equal((await db.query('SELECT id FROM cash_movements WHERE reference_no = ?', [r.data.custody_no])).length, 0, 'no cash moves on settlement');
  assert.equal(Number((await db.get('SELECT remaining_amount FROM custodies WHERE id = ?', [custodyId])).remaining_amount), 18000);
  assert.equal(await balance(acc.EMPLOYEE_CUSTODY), 18000, 'ledger custody balance = remaining custody');

  // 4. Advance: validation, then Dr employee advances / Cr box
  r = await api('POST', '/api/hr/advances', { employee_id: emp.id, amount: 50000, installment_amount: 60000, request_date: '2031-01-12' });
  assert.equal(r.status, 400, 'an instalment above the advance is refused');
  r = await api('POST', '/api/hr/advances', { employee_id: emp.id, amount: 50000, installment_amount: 10000, request_date: '2031-01-12', reason: 'TEST سلفة' });
  assert.equal(r.status, 200, 'advance: ' + JSON.stringify(r.data));
  assert.ok(r.data.journal_entry_id);
  const advLines = await lines(r.data.journal_entry_id);
  assert.ok(advLines.find(l => l.account_id === acc.EMPLOYEE_ADVANCES && Number(l.debit) === 50000 && l.party_type === 'employee' && l.party_id === emp.id));
  assert.ok(advLines.find(l => l.account_id === acc.CASH_DEFAULT && Number(l.credit) === 50000));
  assert.equal(await balance(acc.EMPLOYEE_ADVANCES), 50000, 'advances receivable carries the advance until payroll recovers it');

  // 5. The box ledger moved exactly by what left the cash book for these documents
  assert.equal(boxBefore - await balance(acc.CASH_DEFAULT), 80000, 'box ledger = 30k custody + 50k advance');
  const outflow = await db.get("SELECT COALESCE(SUM(cash_out), 0) AS t FROM cash_movements WHERE account_id = ? AND date LIKE '2031-01%'", [acc.CASH_DEFAULT]);
  assert.equal(Number(outflow.t), 80000, 'cash book agrees with the ledger');
});
