// Stage 5: numbered migrations, no swallowed boot errors, unified error layer with safe responses.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { spawnSync } = require('node:child_process');
const errors = require('../../server/middleware/errors');
const { runMigrations, MIGRATIONS } = require('../../server/database/migrations');

test('error classification: trigger rules, constraints, typed errors and technical messages', () => {
  const trig = Object.assign(new Error('⛔ لا يمكن تعديل سطور قيد مرحّل'), { code: 'ERR_SQLITE_ERROR', errcode: 1811 });
  assert.deepEqual(errors.classify(trig), { status: 409, code: 'LEDGER_RULE', message: '⛔ لا يمكن تعديل سطور قيد مرحّل', safe: true });
  const uniq = Object.assign(new Error('UNIQUE constraint failed: accounts.code'), { code: 'ERR_SQLITE_ERROR', errcode: 2067 });
  assert.equal(errors.classify(uniq).status, 409);
  assert.doesNotMatch(errors.classify(uniq).message, /accounts\.code/);
  assert.deepEqual(errors.classify(new errors.ConflictError('المستخلص مرحل مسبقاً')), { status: 409, code: 'CONFLICT', message: 'المستخلص مرحل مسبقاً', safe: true });
  assert.equal(errors.classify(new errors.ValidationError('الحقل إلزامي')).status, 400);
  const tech = errors.classify(new TypeError("Cannot read properties of undefined (reading 'id')"));
  assert.equal(tech.status, 500); assert.equal(tech.safe, false); assert.doesNotMatch(tech.message, /undefined/);
  assert.equal(errors.classify(new Error('لا يمكن ترحيل مستخلص غير معتمد')).message, 'لا يمكن ترحيل مستخلص غير معتمد', 'Arabic business text survives even without a status');
  assert.ok(errors.isTechnical('SQLITE_ERROR: no such column: a.is_active'));
  assert.ok(!errors.isTechnical('يرجى اختيار الحساب المالي'));
});

test('failed responses never expose SQL or runtime errors; business messages pass through', async () => {
  const express = require('express');
  const app = express();
  app.use(errors.safeErrorResponses);
  app.get('/sql', (_q, res) => res.status(500).json({ success: false, message: 'خطأ في جلب المستخلصات: no such column: b.foo', error: 'no such column: b.foo' }));
  app.get('/biz', (_q, res) => res.status(400).json({ success: false, message: 'لا يمكن عكس مسودة' }));
  app.get('/throw', () => { throw Object.assign(new Error('UNIQUE constraint failed: bills.bill_no'), { code: 'ERR_SQLITE_ERROR' }); });
  app.use(errors.errorHandler);
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const errLog = console.error; console.error = () => {};
  try {
    const get = p => fetch(`http://127.0.0.1:${server.address().port}${p}`).then(async r => ({ status: r.status, body: await r.json() }));
    const sql = await get('/sql');
    assert.equal(sql.status, 500);
    assert.doesNotMatch(JSON.stringify(sql.body), /no such column|b\.foo/);
    assert.match(sql.body.message, /^خطأ في جلب المستخلصات: حدث خطأ داخلي غير متوقع \(رقم المرجع [0-9A-F]{8}\)$/);
    assert.match(sql.body.error_ref, /^[0-9A-F]{8}$/);
    assert.deepEqual((await get('/biz')).body, { success: false, message: 'لا يمكن عكس مسودة' });
    const thrown = await get('/throw');
    assert.equal(thrown.status, 409); assert.equal(thrown.body.code, 'DUPLICATE'); assert.doesNotMatch(thrown.body.message, /bill_no/);
  } finally { console.error = errLog; server.close(); }
});

test('numbered migrations: applied once, recorded, and a failing migration stops with a rollback', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rawasi-migrations-'));
  const db = new DatabaseSync(path.join(temp, 'm.db'));
  try {
    db.exec(`CREATE TABLE accounts (id INTEGER PRIMARY KEY, code TEXT, name TEXT, type TEXT, parent_id INTEGER, is_posting INTEGER, status TEXT);
      CREATE TABLE journal_entries (id INTEGER PRIMARY KEY); CREATE TABLE journal_entry_lines (id INTEGER PRIMARY KEY, entry_id INTEGER, account_id INTEGER);
      CREATE TABLE payroll (id INTEGER PRIMARY KEY); CREATE TABLE employees (id INTEGER PRIMARY KEY);`);
    // the schema-only migrations; 0004 needs the full application tables and is covered by the boot test below
    const core = MIGRATIONS.filter(m => m.id < '0004');
    assert.deepEqual(runMigrations(db, core), core.map(m => m.id));
    assert.deepEqual(runMigrations(db, core), [], 'nothing runs twice');
    assert.ok(db.prepare('PRAGMA table_info(journal_entry_lines)').all().some(c => c.name === 'party_id'));
    db.prepare("INSERT INTO accounts (code, name, type, is_posting, status) VALUES ('1', 'x', 'asset', 0, 'active')").run();
    assert.equal(db.prepare("SELECT normal_balance FROM accounts WHERE code = '1'").get().normal_balance, 'debit', 'normal-balance trigger installed');
    const broken = [{ id: '9999_broken', up(d) { d.exec('ALTER TABLE accounts ADD COLUMN half_done TEXT'); throw new Error('boom'); } }];
    assert.throws(() => runMigrations(db, broken), err => err.code === 'MIGRATION_FAILED' && /9999_broken/.test(err.message));
    assert.ok(!db.prepare('PRAGMA table_info(accounts)').all().some(c => c.name === 'half_done'), 'the failed migration is rolled back');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE id = '9999_broken'").get().n, 0);
  } finally { db.close(); fs.rmSync(temp, { recursive: true, force: true }); }
});

test('a fresh database boots with every migration applied and no swallowed schema issue', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rawasi-boot-'));
  Object.assign(process.env, { NODE_ENV: 'development', DB_ENGINE: 'sqlite', RAWASI_DB_PATH: path.join(temp, 'fixture.db'), RAWASI_UPLOAD_DIR: path.join(temp, 'uploads'), RAWASI_PROJECTS_DIR: path.join(temp, 'projects'), RAWASI_BACKUP_DIR: path.join(temp, 'backups'), RAWASI_SCRATCH_DIR: path.join(temp, 'scratch'), ENABLE_SCHEDULERS: 'false' });
  const fixture = spawnSync(process.execPath, ['tests/create_fixture.js'], { env: process.env, encoding: 'utf8', windowsHide: true });
  assert.equal(fixture.status, 0, fixture.stderr);
  const db = require('../../server/database/db');
  await db.ready;
  assert.deepEqual(db.getBootIssues(), []);
  const applied = (await db.query('SELECT id FROM schema_migrations ORDER BY id')).map(r => r.id);
  assert.deepEqual(applied, MIGRATIONS.map(m => m.id));
  assert.ok((await db.get("SELECT COUNT(*) AS n FROM system_account_mappings WHERE role = 'CASH_DEFAULT'")).n === 1, 'role mappings seeded after migrations');
  const rates = await db.query("SELECT type, rate_percentage FROM tax_configs WHERE is_active = 1 ORDER BY tax_code");
  assert.deepEqual(rates.map(r => [r.type, Number(r.rate_percentage)]), [['vat', 0], ['wht_contracting', 3], ['wht_supplies', 1]], 'tax reference rates seeded');
});
