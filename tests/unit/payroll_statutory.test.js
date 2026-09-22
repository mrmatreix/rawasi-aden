const test = require('node:test');
const assert = require('node:assert/strict');
const PayrollService = require('../../server/services/payrollService');

test('Payroll Service - Statutory Percentages (6% Employee / 9% Employer)', () => {
  const records = [
    { employee_id: 1, basic_salary: 100000, allowances: 20000, deductions: 5000 }
  ];

  const result = PayrollService.calculateStatutoryPayroll(records);
  const emp = result.records[0];

  assert.strictEqual(emp.gross_salary, 120000, 'Gross should be basic + allowances');
  assert.strictEqual(emp.insurance_employee, 6000, 'Employee insurance must be exactly 6% of basic salary');
  assert.strictEqual(emp.insurance_company, 9000, 'Employer contribution must be exactly 9% of basic salary');
  assert.ok(emp.net_salary > 0, 'Net salary must be calculated and positive');
});

test('Payroll Service - Compound Journal Balance (Debit == Credit)', () => {
  const records = [
    { employee_id: 1, basic_salary: 150000, allowances: 30000, deductions: 10000 },
    { employee_id: 2, basic_salary: 80000, allowances: 10000, deductions: 0 }
  ];

  const { summary } = PayrollService.calculateStatutoryPayroll(records);
  const preview = PayrollService.generateCompoundJournalPreview(summary);

  assert.strictEqual(preview.isBalanced, true, 'Compound payroll journal must balance perfectly');
  assert.strictEqual(preview.totalDebit, preview.totalCredit, `Debit (${preview.totalDebit}) must equal Credit (${preview.totalCredit})`);
});
