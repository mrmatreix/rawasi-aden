const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync, backup } = require('node:sqlite');

test('upgrade legacy journal schema and save/post manual journal, expense and receipt on an isolated copy', async () => {
  const root = path.resolve(__dirname, '../..');
  const scratch = path.join(root, 'scratch');
  fs.mkdirSync(scratch, { recursive: true });
  const tempDir = fs.mkdtempSync(path.join(scratch, 'journal-reference-'));
  const testPath = path.join(tempDir, 'test.db');
  const source = new DatabaseSync(process.env.TEST_SOURCE_DB_PATH || path.join(root, 'server/database/rawasi_aden.db'), { readOnly: true });
  let server;
  let db;
  try {
    await backup(source, testPath);
    source.close();
    const legacy = new DatabaseSync(testPath);
    if (legacy.prepare('PRAGMA table_info(journal_entries)').all().some(col => col.name === 'reference_no')) {
      legacy.exec('ALTER TABLE journal_entries DROP COLUMN reference_no');
    }
    legacy.close();
    process.env.RAWASI_DB_PATH = testPath;
    process.env.DB_ENGINE = 'sqlite';
    db = require('../../server/database/db');
    await db.initializeDatabase();
    const countBefore = await db.get('SELECT COUNT(*) AS count FROM journal_entries');
    await db.initializeDatabase();
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM journal_entries')).count, countBefore.count);
    assert.equal((await db.query('PRAGMA table_info(journal_entries)')).filter(col => col.name === 'reference_no').length, 1);

    const app = require('../../server/server');
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const jwt = require('jsonwebtoken');
    const { JWT_SECRET } = require('../../server/middleware/security');
    const user = await db.get("SELECT id FROM users WHERE username = 'admin'");
    const token = jwt.sign({ id: user.id, username: 'admin', role: 'admin' }, JWT_SECRET, { expiresIn: '2m' });
    const request = async (route, body = {}, method = 'POST') => {
      const res = await fetch(`http://127.0.0.1:${server.address().port}${route}`, {
        method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      return { status: res.status, body: await res.json() };
    };
    let numberingParent = null;
    let leaf;
    for (let level = 1; level <= 5; level++) {
      const suggested = await fetch(`http://127.0.0.1:${server.address().port}/api/accounting/accounts/suggest-code${numberingParent ? '?parent_id=' + numberingParent : ''}`, { headers: { Authorization: `Bearer ${token}` } });
      const next = await suggested.json();
      assert.equal(next.level, level);
      const payload = { name: 'اختبار التسلسل ' + level, type: 'asset', parent_id: numberingParent };
      const skipped = await request('/api/accounting/accounts', { ...payload, code: String(Number(next.suggested_code) + 1) });
      assert.equal(skipped.status, 400);
      assert.equal(skipped.body.suggested_code, next.suggested_code);
      const created = await request('/api/accounting/accounts', { ...payload, code: next.suggested_code });
      assert.equal(created.status, 200, JSON.stringify(created.body));
      numberingParent = created.body.id;
      leaf = { ...payload, code: next.suggested_code, id: numberingParent };
    }
    assert.equal((await request('/api/accounting/accounts/' + leaf.id,
      { ...leaf, code: String(Number(leaf.code) + 8) }, 'PUT')).status, 400);
    const assets = await db.query(`SELECT a.id FROM accounts a WHERE a.code LIKE '1%'
      AND a.code NOT LIKE '11101%' AND a.code NOT LIKE '11102%'
      AND (a.is_posting = 1 OR a.level = 5) AND COALESCE(a.status, 'active') = 'active'
      AND NOT EXISTS (SELECT 1 FROM accounts child WHERE child.parent_id = a.id) ORDER BY a.code LIMIT 2`);
    const cash = await db.get(`SELECT a.id FROM accounts a WHERE a.code LIKE '11101%'
      AND (a.is_posting = 1 OR a.level = 5) AND COALESCE(a.status, 'active') = 'active'
      AND NOT EXISTS (SELECT 1 FROM accounts child WHERE child.parent_id = a.id) ORDER BY a.code LIMIT 1`);
    assert.equal(assets.length, 2);
    assert.ok(cash);
    const base = 'http://127.0.0.1:' + server.address().port;
    const headers = { Authorization: 'Bearer ' + token };
    const document = { name: 'فاتورة.pdf', content_base64: Buffer.from('%PDF-1.7\nfixture\n%%EOF').toString('base64') };
    const docsFor = async (kind, id) => {
      const res = await fetch(base + '/api/supporting-documents/' + kind + '/' + id, { headers });
      assert.equal(res.status, 200);
      return (await res.json()).data;
    };
    const date = '2099-01-15';
    // Only the isolated copy is adjusted so the fixture date is guaranteed open.
    await db.run("UPDATE accounting_periods SET status = 'open' WHERE start_date <= ? AND end_date >= ?", [date, date]);
    const manual = await request('/api/accounting/journal-entries', {
      supporting_documents: [document], date, description: 'اختبار مرجع القيد', reference_no: 'INV-REFERENCE-001', status: 'draft',
      lines: [{ account_id: assets[0].id, debit: 1000, credit: 0 }, { account_id: assets[1].id, debit: 0, credit: 1000 }]
    });
    assert.equal(manual.status, 200, JSON.stringify(manual.body));
    assert.equal((await db.get('SELECT reference_no FROM journal_entries WHERE id = ?', [manual.body.id])).reference_no, 'INV-REFERENCE-001');
    assert.equal((await request('/api/accounting/journal-entries/' + manual.body.id, { supporting_documents: [document] }, 'PUT')).status, 200);
    assert.equal((await docsFor('journal', manual.body.id)).length, 2);
    const counts = await db.get('SELECT COUNT(*) AS count FROM journal_entries');
    const invalid = await request('/api/accounting/journal-entries', { date, description: 'رفض مؤيد مزيف', status: 'draft', supporting_documents: [{ name: 'bad.pdf', content_base64: Buffer.from('not PDF').toString('base64') }], lines: [{ account_id: assets[0].id, debit: 2, credit: 0 }, { account_id: assets[1].id, debit: 0, credit: 2 }] });
    assert.equal(invalid.status, 400, JSON.stringify(invalid.body));
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM journal_entries')).count, counts.count);
    assert.equal((await request('/api/accounting/journal-entries/' + manual.body.id + '/post')).status, 200);
    const listed = await fetch(`http://127.0.0.1:${server.address().port}/api/accounting/journal-entries`, { headers: { Authorization: `Bearer ${token}` } }).then(res => res.json());
    assert.equal(listed.data.find(entry => entry.id === manual.body.id).description, 'اختبار مرجع القيد');

    const expenseAccount = await db.get("SELECT a.id FROM accounts a WHERE a.type = 'expense' AND a.is_posting = 1 AND COALESCE(a.status, 'active') = 'active' AND NOT EXISTS (SELECT 1 FROM accounts c WHERE c.parent_id = a.id) LIMIT 1");
    const revenueAccount = await db.get("SELECT a.id FROM accounts a WHERE a.type = 'revenue' AND a.is_posting = 1 AND COALESCE(a.status, 'active') = 'active' AND NOT EXISTS (SELECT 1 FROM accounts c WHERE c.parent_id = a.id) LIMIT 1");
    const center = await db.get('SELECT id FROM cost_centers LIMIT 1');
    assert.ok(expenseAccount && revenueAccount && center);
    const expenseParent = await db.get('SELECT parent_id FROM accounts WHERE id = ?', [expenseAccount.id]);
    const nextAccount = await fetch(`http://127.0.0.1:${server.address().port}/api/accounting/accounts/suggest-code?parent_id=${expenseParent.parent_id}`, { headers: { Authorization: `Bearer ${token}` } }).then(res => res.json());
    const accountPayload = { code: nextAccount.suggested_code, name: 'اختبار حساب ومركز تكلفة', type: 'asset', parent_id: expenseParent.parent_id };
    assert.equal((await request('/api/accounting/accounts', accountPayload)).status, 400);
    assert.equal((await request('/api/accounting/accounts', { ...accountPayload, default_cost_center_id: 999999 })).status, 400);
    const centeredAccount = await request('/api/accounting/accounts', { ...accountPayload, default_cost_center_id: center.id, analytical_type: 'general' });
    assert.equal(centeredAccount.status, 200, JSON.stringify(centeredAccount.body));
    const storedAccount = await db.get('SELECT type, default_cost_center_id FROM accounts WHERE id = ?', [centeredAccount.body.id]);
    assert.equal(storedAccount.type, 'expense');
    for (const analytical_type of ['general', 'cash', 'bank', 'employee_receivables', 'customers', 'suppliers']) {
      const edited = await request('/api/accounting/accounts/' + centeredAccount.body.id, { ...accountPayload, default_cost_center_id: center.id, analytical_type }, 'PUT');
      assert.equal(edited.status, 200, JSON.stringify(edited.body));
      assert.equal((await db.get('SELECT analytical_type FROM accounts WHERE id = ?', [centeredAccount.body.id])).analytical_type, analytical_type);
    }
    assert.equal((await request('/api/accounting/accounts/' + centeredAccount.body.id, { ...accountPayload, default_cost_center_id: center.id, analytical_type: 'invalid' }, 'PUT')).status, 400);
    assert.equal(storedAccount.default_cost_center_id, center.id);
    assert.equal((await request('/api/accounting/accounts/' + centeredAccount.body.id, { ...accountPayload, default_cost_center_id: null }, 'PUT')).status, 400);
    const invalidExpense = await request('/api/expenses', { date, amount: 20, account_id: revenueAccount.id,
      settlement_account_id: cash.id, payment_method: 'نقدي', status: 'draft', expense_type: 'مصروف عام' });
    assert.equal(invalidExpense.status, 400, JSON.stringify(invalidExpense.body));
    for (const cc of [null, center.id]) {
      const nominal = await request('/api/accounting/journal-entries', { date, description: 'قيد بمركز اختياري', status: 'draft',
        lines: [{ account_id: expenseAccount.id, debit: 20, credit: 0, cost_center_id: cc },
          { account_id: revenueAccount.id, debit: 0, credit: 20, cost_center_id: cc }] });
      assert.equal(nominal.status, 200, JSON.stringify(nominal.body));
      assert.ok((await db.query('SELECT cost_center_id FROM journal_entry_lines WHERE entry_id = ?', [nominal.body.id])).every(line => line.cost_center_id === cc));
      for (const route of ['expenses', 'payments']) {
        const payload = { date, amount: 20, account_id: route === 'expenses' ? expenseAccount.id : revenueAccount.id,
          settlement_account_id: cash.id, cost_center_id: cc, payment_method: 'نقدي', status: 'draft', type: 'قبض', expense_type: 'مصروف عام' };
        const voucher = await request('/api/' + route, payload);
        assert.equal(voucher.status, 200, JSON.stringify(voucher.body));
        assert.equal((await db.get(`SELECT cost_center_id FROM ${route} WHERE id = ?`, [voucher.body.id])).cost_center_id, cc);
        const edited = await request(`/api/${route}/${voucher.body.id}`, { cost_center_id: cc === null ? center.id : null }, 'PUT');
        assert.equal(edited.status, 200, JSON.stringify(edited.body));
        const restored = await request(`/api/${route}/${voucher.body.id}`, { cost_center_id: cc }, 'PUT');
        assert.equal(restored.status, 200, JSON.stringify(restored.body));
        const posted = await request(`/api/${route}/${voucher.body.id}/post`);
        assert.equal(posted.status, 200, JSON.stringify(posted.body));
        const entry = await db.get('SELECT id FROM journal_entries WHERE reference_id = ? AND reference_type = ?',
          [voucher.body.id, route === 'expenses' ? 'سند صرف' : 'سند قبض']);
        assert.ok((await db.query('SELECT cost_center_id FROM journal_entry_lines WHERE entry_id = ?', [entry.id])).every(line => line.cost_center_id === cc));
      }
    }

    for (const [route, kind, amount] of [['expenses', 'سند صرف', 150], ['payments', 'سند قبض', 250]]) {
      const created = await request(`/api/${route}`, {
        date, amount, local_amount: amount, currency: 'ر.ي', exchange_rate: 1,
        account_id: assets[0].id, settlement_account_id: cash.id, payment_method: 'نقدي',
        status: 'draft', expense_type: 'مصروف عام', type: 'قبض',
        supporting_documents: [document], notes: 'اختبار ترحيل معزول', reference_no: 'INV-REFERENCE-002'
      });
      assert.equal(created.status, 200, JSON.stringify(created.body));
      const entityKind = route === 'expenses' ? 'expense' : 'payment';
      let docs = await docsFor(entityKind, created.body.id);
      assert.equal(docs.length, 1);
      assert.equal(docs[0].file_name, document.name);
      assert.equal(docs[0].content_base64, undefined);
      assert.equal((await request('/api/' + route + '/' + created.body.id, { supporting_documents: [document] }, 'PUT')).status, 200);
      docs = await docsFor(entityKind, created.body.id);
      assert.equal(docs.length, 2);
      const downloadPath = '/api/supporting-documents/' + entityKind + '/' + created.body.id + '/' + docs[0].id;
      assert.equal((await fetch(base + downloadPath)).status, 401);
      const downloaded = await fetch(base + downloadPath, { headers });
      assert.equal(downloaded.headers.get('content-type'), 'application/pdf');
      assert.equal(Buffer.from(await downloaded.arrayBuffer()).toString('base64'), document.content_base64);
      assert.equal((await fetch(base + '/api/supporting-documents/journal/' + manual.body.id + '/' + docs[0].id, { headers })).status, 404);
      const beforeInvalid = await db.get('SELECT COUNT(*) AS count FROM ' + route);
      const invalidVoucher = await request('/api/' + route, { date, amount: 3, account_id: assets[0].id, settlement_account_id: cash.id, payment_method: 'نقدي', status: 'draft', expense_type: 'مصروف عام', type: 'قبض', supporting_documents: [{ name: 'file.exe', content_base64: 'AAAA' }] });
      assert.equal(invalidVoucher.status, 400, JSON.stringify(invalidVoucher.body));
      assert.equal((await db.get('SELECT COUNT(*) AS count FROM ' + route)).count, beforeInvalid.count);
      const posted = await request('/api/' + route + '/' + created.body.id + '/post');
      assert.equal(posted.status, 200, JSON.stringify(posted.body));
      assert.equal((await db.get(`SELECT status FROM ${route} WHERE id = ?`, [created.body.id])).status, 'posted');
      const entries = await db.query('SELECT * FROM journal_entries WHERE reference_type = ? AND reference_id = ?', [kind, created.body.id]);
      assert.equal(entries.length, 1);
      assert.equal((await docsFor('journal', entries[0].id)).length, 2);
      const linkedDownload = await fetch(base + '/api/supporting-documents/journal/' + entries[0].id + '/' + docs[0].id, { headers });
      assert.equal(linkedDownload.status, 200);
      assert.equal(entries[0].total_debit, amount);
      assert.equal(entries[0].total_credit, amount);
      const listedEntry = await fetch(`http://127.0.0.1:${server.address().port}/api/accounting/journal-entries/${entries[0].id}`, { headers: { Authorization: `Bearer ${token}` } }).then(res => res.json());
      assert.equal(listedEntry.data.display_no, created.body.receipt_no);
      assert.equal(listedEntry.data.entry_no, entries[0].entry_no);
      if (route === 'expenses') assert.equal(entries[0].reference_no, 'INV-REFERENCE-002');
      assert.equal((await request(`/api/${route}/${created.body.id}/post`)).status, 400);
      assert.equal((await db.get('SELECT COUNT(*) AS count FROM journal_entries WHERE reference_type = ? AND reference_id = ?', [kind, created.body.id])).count, 1);
    }
  } finally {
    try { source.close(); } catch {}
    if (server) await new Promise(resolve => server.close(resolve));
    if (db?.db) db.db.close();
    const resolved = path.resolve(tempDir);
    if (resolved.startsWith(path.resolve(scratch) + path.sep)) fs.rmSync(resolved, { recursive: true, force: true });
  }
});
