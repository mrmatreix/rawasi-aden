const { test } = require('node:test');
const assert = require('node:assert/strict');
const Accounting = require('../js/accounting');

test('expense selectors exclude revenue while receipt selectors retain it', () => {
  const accounts = [{ id: 1, code: '31001001', type: 'expense' },
    { id: 2, code: '41001001', type: 'revenue' }, { id: 3, code: '11201001', type: 'asset' },
    { id: 4, code: '11701001', type: 'asset', name: 'الإيـرادات المستحقة' },
    { id: 5, code: '21402001', type: 'liability', name: 'الايرادات المدفوعة مقدما' },
    { id: 6, code: '11801001', type: 'asset', name: 'حساب تابع', parent_id: 7 },
    { id: 8, code: '11101001', type: 'asset' }, { id: 9, code: '11102001', type: 'asset' }];
  const allAccounts = [{ id: 7, code: '11801', type: 'asset', name: 'إيرادات أخرى' }];
  assert.deepEqual(Accounting.voucherAccounts.call({ accounts, allAccounts }, 'expense').map(a => a.id), [1, 3, 8, 9]);
  assert.deepEqual(Accounting.voucherAccounts.call({ accounts, allAccounts }, 'receipt').map(a => a.id), [2, 4, 5, 6, 8, 9]);
});

test('journal table displays the complete multiline general description safely', () => {
  const tbody = { innerHTML: '' };
  global.document = { getElementById: () => tbody };
  global.App = { formatNumber: value => String(value) };
  try {
    Accounting.renderJournalTable([{ id: 1, entry_no: 'JV-1', date: '2026-10-19',
      display_no: 'EP-2026-0001', description: 'البيان العام كامل\nسطر ثان <تفاصيل>', status: 'draft', lines: [] }]);
    assert.ok(tbody.innerHTML.includes('<strong>EP-2026-0001</strong>'));
    assert.ok(tbody.innerHTML.includes('البيان العام كامل\nسطر ثان &lt;تفاصيل&gt;'));
    assert.ok(tbody.innerHTML.includes('white-space: pre-wrap'));
  } finally { delete global.document; delete global.App; }
});
