#!/usr/bin/env node
'use strict';

// Safe, repeatable loader for the user's approved chart of accounts.
// It only runs in the isolated Railway staging database and never deletes data.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

if (process.env.NODE_ENV !== 'staging' || process.env.ALLOW_STAGING_DB_INIT !== 'true') {
  throw new Error('Chart synchronization is restricted to the isolated staging environment');
}
const dbPath = path.resolve(process.env.RAWASI_DB_PATH || '');
if (!dbPath || !fs.existsSync(dbPath)) throw new Error('The staging database was not found');

const source = JSON.parse(fs.readFileSync(path.join(__dirname, '../server/database/standard_chart_of_accounts.json'), 'utf8'));

// Correct broken parent links in the supplied workbook without changing account numbers.
const parentOverrides = {
  '121': '12', '12101': '121', '12101001': '12101', '122': '12', '123': '12', '12301': '123', '12301001': '12301',
  '211': '21', '21101': '211', '21101001': '21101', '21101002': '21101', '21101003': '21101', '21101004': '21101', '21102': '211', '21102001': '21102',
  '212': '21', '21201': '212', '21201001': '21201', '21202': '212', '21202001': '21202', '21202002': '21202', '21202003': '21202',
  '213': '21', '214': '21', '21401': '214', '21401001': '21401', '21401002': '21401', '21402': '214'
};

// Language corrections approved for display; all account numbers remain English digits.
const nameCorrections = {
  '1':'الأصول','11':'الأصول المتداولة','11101':'صندوق الإدارة','11101001':'صندوق الإدارة','11102001':'بنك الكريمي','11102002':'بنك التضامن',
  '11201':'عملاء محليون','11201002':'عملاء محليون','114':'مدينون آخرون','11401':'إشعارات مدينة','11401001':'إشعارات مدينة','11401002':'أوراق قبض',
  '115':'سلف الموظفين وعهد المواقع','11501':'سلف الموظفين وعهد المواقع','11501001':'عهد المواقع لدى الموظفين','11501002':'عهد تشغيلية لدى الموظفين',
  '116':'الأرصدة المدينة الأخرى والدفعات المقدمة','11601':'المصروفات المدفوعة مقدماً','11601001':'مصاريف مدفوعة مقدماً','11601002':'دفعات مقدمة لموردي المواد','11601003':'دفعات مقدمة لمقاولي الباطن',
  '12':'الأصول الثابتة','121':'الأثاث والتجهيزات','12101':'الأثاث المكتبي','12101001':'الأثاث المكتبي','123':'الأصول غير المتداولة','12301':'الأصول غير المتداولة','12301001':'مصاريف التأسيس',
  '21':'التزامات قصيرة الأجل','21101':'موردون محليون','21101001':'موردون محليون','21101002':'مستحقات مقاولي الباطن','21102':'موردون خارجيون','21102001':'موردون خارجيون',
  '212':'أرصدة دائنة','21201':'أوراق الدفع','21201001':'أوراق الدفع','21202':'دائنون متنوعون','21202001':'ضرائب المرتبات والأجور مستحقة الدفع','21202002':'التأمينات الاجتماعية مستحقة الدفع','21202003':'صندوق تنمية المهارات',
  '213':'أرصدة دائنة أخرى','214':'الأرصدة الدائنة الأخرى','21401001':'مرتبات وأجور مستحقة الدفع','21401002':'مصاريف مستحقة','21402':'إيرادات مدفوعة مقدماً',
  '22':'التزامات طويلة الأجل','22101':'رأس المال','22101001':'رأس المال','22101002':'الأرباح والخسائر','22103':'مجمع الإهلاك','22103001':'مجمع الإهلاك',
  '3':'المصروفات','31':'مصاريف النشاط الجاري','311':'مصاريف النشاط','31101':'مصاريف النشاط الجاري','31101001':'مشتريات الأسمنت','31101003':'تكلفة حديد التسليح والهياكل','31101005':'رواتب وأجور عمالة الموقع',
  '32':'مصاريف إدارية وعامة','321':'مصاريف إدارية','32101':'المرتبات والأجور','32101005':'تأمين صحي','32101006':'مصاريف التأمين الاجتماعي','32101007':'ضريبة المرتبات والأجور','32101008':'المرتبات والأجور الأساسية','32101009':'إكراميات','32101010':'صندوق تنمية المهارات',
  '32102':'المصاريف العامة','32102001':'مصاريف الماء والكهرباء','32102002':'مصاريف الهاتف والإنترنت','32102003':'مصاريف صيانة المكتب','32102004':'مصاريف البرمجيات وصيانتها','32102008':'بدل السفر والانتقال والمواصلات',
  '32103':'التزامات قانونية وضريبية مستحقة','32103001':'مصروف ضريبة الدخل','32103002':'مصاريف رسوم حكومية','32103003':'غرامات وجزاءات',
  '4':'الإيرادات','41':'إيرادات النشاط الجاري','411':'إيرادات النشاط الجاري','41101':'إيرادات المشاريع تحت التنفيذ','41101001':'إيرادات المشاريع تحت التنفيذ','41101002':'إيرادات دراسات الجدوى','41101003':'إيرادات خدمات الاستشارات','41101004':'إيرادات جزاءات وغرامات','41101005':'إيرادات أوامر التغيير',
  '412':'إيرادات أخرى','41201':'إيرادات رأسمالية','41201001':'إيرادات بيع أصول','41203':'إيرادات أخرى','41203001':'إيرادات أخرى','41203002':'إيرادات فروق عملة','41203003':'إيرادات الجزاءات والغياب'
};

const database = new DatabaseSync(dbPath);
try {
  const existing = new Set(database.prepare('PRAGMA table_info(accounts)').all().map(c => c.name));
  const extra = { parent_code:'TEXT', currencies:"TEXT DEFAULT 'YER'", report_type:"TEXT DEFAULT 'balance_sheet'", inclusion:"TEXT DEFAULT '='", is_contra:'INTEGER DEFAULT 0', is_active:'INTEGER DEFAULT 1', updated_at:'DATETIME' };
  for (const [column, definition] of Object.entries(extra)) if (!existing.has(column)) database.exec(`ALTER TABLE accounts ADD COLUMN ${column} ${definition}`);
  database.exec('CREATE INDEX IF NOT EXISTS idx_accounts_parent_code ON accounts(parent_code)');

  const codes = new Set(source.map(a => String(a.code)));
  if (codes.size !== 130) throw new Error(`Expected 130 accounts, received ${codes.size}`);
  const accounts = source.map(a => {
    const code = String(a.code);
    const parent_code = Object.hasOwn(parentOverrides, code) ? parentOverrides[code] : a.parent_code;
    if (parent_code && !codes.has(String(parent_code))) throw new Error(`Missing parent ${parent_code} for ${code}`);
    return { code, parent_code: parent_code || null, name:nameCorrections[code] || a.name, type:a.type, level:Number(a.level), is_posting:Number(a.is_posting), currencies:a.currencies, report_type:a.report_type, inclusion:a.inclusion || '=', is_contra:Number(a.is_contra || 0) };
  });
  database.exec('BEGIN IMMEDIATE');
  const upsert = database.prepare(`INSERT INTO accounts (code,name,type,parent_code,level,is_posting,currencies,report_type,inclusion,is_contra,is_active,status,balance,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,'active',0,CURRENT_TIMESTAMP) ON CONFLICT(code) DO UPDATE SET name=excluded.name,type=excluded.type,parent_code=excluded.parent_code,level=excluded.level,is_posting=excluded.is_posting,currencies=excluded.currencies,report_type=excluded.report_type,inclusion=excluded.inclusion,is_contra=excluded.is_contra,is_active=1,status='active',updated_at=CURRENT_TIMESTAMP`);
  for (const a of accounts) upsert.run(a.code,a.name,a.type,a.parent_code,a.level,a.is_posting,a.currencies,a.report_type,a.inclusion,a.is_contra);
  const placeholders = accounts.map(() => '?').join(',');
  const values = accounts.map(a => a.code);
  database.prepare(`UPDATE accounts SET parent_id=(SELECT p.id FROM accounts p WHERE p.code=accounts.parent_code) WHERE code IN (${placeholders})`).run(...values);
  database.prepare(`UPDATE accounts SET parent_id=NULL WHERE parent_code IS NULL AND code IN (${placeholders})`).run(...values);
  database.exec('COMMIT');
  const missing = database.prepare('SELECT COUNT(*) AS count FROM accounts c LEFT JOIN accounts p ON p.code=c.parent_code WHERE c.parent_code IS NOT NULL AND p.id IS NULL').get().count;
  if (missing) throw new Error(`Synchronization left ${missing} orphan accounts`);
  console.log(`Synchronized ${accounts.length} approved accounts with English-numbered codes.`);
} catch (error) {
  try { database.exec('ROLLBACK'); } catch {}
  throw error;
} finally { database.close(); }
