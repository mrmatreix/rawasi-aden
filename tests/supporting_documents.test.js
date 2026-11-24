const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateDocuments, saveDocuments } = require('../server/services/supportingDocumentService');
const Accounting = require('../js/accounting');
const pdf = { name: 'فاتورة.pdf', content_base64: Buffer.from('%PDF-1.7\n%%EOF').toString('base64') };

test('documents reject spoofed formats, malformed requests and excessive attachments', () => {
  assert.equal(validateDocuments([pdf])[0].mime, 'application/pdf');
  assert.deepEqual(validateDocuments(undefined), []);
  for (const files of [[null], {}, Array(11).fill(pdf), [{ ...pdf, name: 'file.exe' }], [{ ...pdf, content_base64: Buffer.from('spoof').toString('base64') }]]) {
    assert.throws(() => validateDocuments(files), error => error.statusCode === 400);
  }
  assert.throws(() => validateDocuments([{ name: 'large.pdf', content_base64: Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(10 * 1024 * 1024)]).toString('base64') }]), /10/);
});

test('append enforces the overall size and count of saved documents', async () => {
  const db = { get: async () => ({ count: 10, size: 0 }), run: async () => assert.fail('must not save') };
  await assert.rejects(saveDocuments(db, 'expense', 1, [pdf]), /10/);
  db.get = async () => ({ count: 1, size: 20 * 1024 * 1024 });
  await assert.rejects(saveDocuments(db, 'journal', 1, [pdf]), /20/);
});

test('PDF printing uses filtered rows, original voucher numbers, escaped descriptions and balanced totals', () => {
  const area = { innerHTML: '' };
  global.document = { getElementById: () => area };
  global.App = { formatNumber: String };
  let printed = false;
  global.window = { print: () => { printed = true; } };
  const previous = Accounting.filteredJournalEntries;
  try {
    Accounting.filteredJournalEntries = [{ entry_no: 'JV-INTERNAL', display_no: 'EP-1', date: '2026-10-19', description: '<script>unsafe</script>', total_debit: 37, total_credit: 37, status: 'draft' }];
    Accounting.printJournalListPdf();
    assert.ok(printed);
    assert.ok(area.innerHTML.includes('EP-1'));
    assert.ok(!area.innerHTML.includes('JV-INTERNAL'));
    assert.ok(!area.innerHTML.includes('<script>'));
    assert.ok(area.innerHTML.includes('&lt;script&gt;'));
    assert.ok(area.innerHTML.includes('<th>37</th><th>37</th>'));
  } finally { Accounting.filteredJournalEntries = previous; delete global.document; delete global.App; delete global.window; }
});
