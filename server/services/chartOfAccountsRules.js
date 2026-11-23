'use strict';
// Shared chart-of-accounts rules: one vocabulary for account types, the normal balance of each type,
// the code -> parent relationship, the system account roles, and a structural audit used by the
// repair script, the read-only audit script and the tests. No I/O here.

const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'];

const TYPE_SYNONYMS = new Map(Object.entries({
  asset: 'asset', assets: 'asset', 'أصول': 'asset', 'اصول': 'asset', 'أصل': 'asset', 'اصل': 'asset', 'أصول ثابتة': 'asset', 'أصول متداولة': 'asset',
  liability: 'liability', liabilities: 'liability', 'خصوم': 'liability', 'التزامات': 'liability', 'التزام': 'liability', 'قروض': 'liability',
  equity: 'equity', 'حقوق ملكية': 'equity', 'حقوق الملكية': 'equity',
  revenue: 'revenue', income: 'revenue', 'إيرادات': 'revenue', 'ايرادات': 'revenue', 'إيراد': 'revenue', 'ايراد': 'revenue',
  expense: 'expense', expenses: 'expense', cost: 'expense', 'مصروفات': 'expense', 'مصاريف': 'expense', 'مصروف': 'expense', 'تكاليف': 'expense'
}));

function normalizeAccountType(value) {
  const key = String(value ?? '').trim().toLowerCase();
  return TYPE_SYNONYMS.get(key) || null;
}

// Debit-natured: assets and expenses. A contra account takes the opposite side of its type.
function normalBalanceFor(type, isContra = 0) {
  const t = normalizeAccountType(type);
  if (!t) return null;
  const debit = t === 'asset' || t === 'expense';
  return (Number(isContra) === 1 ? !debit : debit) ? 'debit' : 'credit';
}

// Codes are 1 / 2 / 3 / 5 / 8 digits for levels 1..5 (e.g. 1, 11, 111, 11101, 11101001).
const LEVEL_BY_LENGTH = new Map([[1, 1], [2, 2], [3, 3], [5, 4], [8, 5]]);
const PARENT_LENGTH = new Map([[2, 1], [3, 2], [5, 3], [8, 5]]);

function levelForCode(code) { return LEVEL_BY_LENGTH.get(String(code).length) || null; }
function prefixParentCode(code) {
  const len = PARENT_LENGTH.get(String(code).length);
  return len ? String(code).slice(0, len) : null;
}

// Approved deviations from the plain prefix rule. Equity (221) is presented beside liabilities
// under root 2 ("الالتزامات وحقوق الملكية") instead of inside long-term liabilities (22).
const PARENT_EXCEPTIONS = Object.freeze({ '221': '2' });
function expectedParentCode(code) {
  return Object.hasOwn(PARENT_EXCEPTIONS, String(code)) ? PARENT_EXCEPTIONS[String(code)] : prefixParentCode(code);
}

// Roles the application posts to automatically. `codes` are the default candidates, first match wins.
const SYSTEM_ACCOUNT_ROLES = Object.freeze({
  CASH_GROUP: { label: 'مجموعة حسابات الصناديق', type: 'asset', group: true, codes: ['11101'] },
  BANK_GROUP: { label: 'مجموعة حسابات البنوك', type: 'asset', group: true, codes: ['11102'] },
  CASH_DEFAULT: { label: 'الصندوق الافتراضي', type: 'asset', codes: ['11101001'] },
  BANK_DEFAULT: { label: 'البنك الافتراضي', type: 'asset', codes: ['11102001'] },
  ACCOUNTS_RECEIVABLE: { label: 'ذمم العملاء - المستخلصات', type: 'asset', codes: ['11201001', '11201002'] },
  RETENTION_RECEIVABLE: { label: 'محتجزات الضمان لدى العملاء', type: 'asset', codes: ['11202001'] },
  CONTRACT_ASSET: { label: 'أصول العقود (إيرادات مستحقة غير مفوترة)', type: 'asset', codes: ['11701001'] },
  INVENTORY: { label: 'مخزون مواد المواقع', type: 'asset', codes: ['11301001'] },
  WHT_RECEIVABLE: { label: 'ضريبة مخصومة من المنبع لدى العملاء', type: 'asset', codes: ['11801001'] },
  VAT_INPUT: { label: 'ضريبة القيمة المضافة - المدخلات', type: 'asset', codes: ['11801002'] },
  ACCUMULATED_DEPRECIATION: { label: 'مجمع إهلاك الأصول الثابتة', type: 'asset', contra: true, codes: ['12401001'] },
  SUPPLIERS_PAYABLE: { label: 'الموردون المحليون', type: 'liability', codes: ['21101001'] },
  SUBCONTRACTORS_PAYABLE: { label: 'مستحقات مقاولي الباطن', type: 'liability', codes: ['21101002'] },
  SUBCONTRACTOR_RETENTION: { label: 'تأمينات محتجزة لمقاولي الباطن', type: 'liability', codes: ['21101003'] },
  CUSTOMER_ADVANCES: { label: 'الدفعات المقدمة من العملاء', type: 'liability', codes: ['21402001', '21101004'] },
  SALARIES_PAYABLE: { label: 'مرتبات وأجور مستحقة الدفع', type: 'liability', codes: ['21401001'] },
  WHT_PAYABLE: { label: 'ضريبة الخصم من المنبع مستحقة الدفع', type: 'liability', codes: ['21501001'] },
  VAT_OUTPUT: { label: 'ضريبة القيمة المضافة - المخرجات', type: 'liability', codes: ['21501002'] },
  CURRENT_YEAR_PROFIT: { label: 'أرباح وخسائر العام الجاري', type: 'equity', codes: ['22101002'] },
  RETAINED_EARNINGS: { label: 'الأرباح المحتجزة', type: 'equity', codes: ['22104001'] },
  CONTRACT_REVENUE: { label: 'إيرادات المشاريع', type: 'revenue', codes: ['41101001'] },
  FX_GAIN: { label: 'أرباح فروق العملة', type: 'revenue', codes: ['41203002'] },
  FX_LOSS: { label: 'خسائر فروق العملة', type: 'expense', codes: ['32105001'] },
  // المخزون والبنوك (المرحلة 4.6، M8): لا إيراد مشاريع لفائض الجرد ولا مصروفات إدارية للتلف
  PROJECT_MATERIAL_COST: { label: 'تكلفة المواد المصروفة للمشاريع', type: 'expense', codes: ['31101009'] },
  SITE_LABOR_COST: { label: 'رواتب وأجور عمالة الموقع', type: 'expense', codes: ['31101005'] },
  INVENTORY_SHRINKAGE_LOSS: { label: 'عجز وتلف المخزون', type: 'expense', codes: ['32105002'] },
  INVENTORY_SURPLUS_GAIN: { label: 'فائض جرد المخزون', type: 'revenue', codes: ['41203004'] },
  BANK_CHARGES: { label: 'عمولات ومصاريف بنكية', type: 'expense', codes: ['32105003'] },
  GUARANTEE_CASH_MARGIN: { label: 'غطاء خطابات الضمان لدى البنوك', type: 'asset', codes: ['11901001'] },
  GUARANTEE_COMMISSION_EXPENSE: { label: 'عمولات خطابات الضمان', type: 'expense', codes: ['32105004', '32105003'] },
  // الرواتب (المرحلة 4.5): مصروف كل بند على حسابه، والاستقطاعات على التزاماتها
  PAYROLL_BASIC_EXPENSE: { label: 'المرتبات والأجور الأساسية', type: 'expense', codes: ['32101008'] },
  PAYROLL_TRANSPORT_EXPENSE: { label: 'بدل انتقال', type: 'expense', codes: ['32101001'] },
  PAYROLL_APPEARANCE_EXPENSE: { label: 'بدل مظهر', type: 'expense', codes: ['32101002'] },
  PAYROLL_NATURE_EXPENSE: { label: 'بدل طبيعة العمل', type: 'expense', codes: ['32101003'] },
  PAYROLL_LIVING_EXPENSE: { label: 'بدل معيشة', type: 'expense', codes: ['32101004'] },
  PAYROLL_HEALTH_EXPENSE: { label: 'تأمين صحي', type: 'expense', codes: ['32101005'] },
  PAYROLL_SOCIAL_INSURANCE_EXPENSE: { label: 'مساهمة المنشأة في التأمينات الاجتماعية', type: 'expense', codes: ['32101006'] },
  PAYROLL_SKILLS_FUND_EXPENSE: { label: 'مساهمة صندوق تنمية المهارات', type: 'expense', codes: ['32101010'] },
  PAYROLL_TAX_PAYABLE: { label: 'ضرائب المرتبات والأجور مستحقة الدفع', type: 'liability', codes: ['21202001'] },
  SOCIAL_INSURANCE_PAYABLE: { label: 'التأمينات الاجتماعية مستحقة الدفع', type: 'liability', codes: ['21202002'] },
  SKILLS_FUND_PAYABLE: { label: 'صندوق تنمية المهارات مستحق الدفع', type: 'liability', codes: ['21202003'] },
  EMPLOYEE_ADVANCES: { label: 'سلف الموظفين', type: 'asset', codes: ['11501003'] },
  EMPLOYEE_CUSTODY: { label: 'عهد المواقع لدى الموظفين', type: 'asset', codes: ['11501001', '11501002'] },
  PAYROLL_PENALTY_INCOME: { label: 'إيراد الجزاءات والغياب', type: 'revenue', codes: ['41203003'] },
  DEPRECIATION_EXPENSE: { label: 'مصروف الإهلاك', type: 'expense', codes: ['32104001'] }
});

// Structural audit. `accounts` rows need id, code, name, type, parent_id, level, is_posting, status
// and optionally is_contra/is_active/normal_balance. Inactive accounts are reported only when broken links exist.
function auditChart(accounts) {
  const errors = [];
  const warnings = [];
  const byId = new Map(accounts.map(a => [Number(a.id), a]));
  const byCode = new Map(accounts.map(a => [String(a.code), a]));
  const kids = new Map();
  for (const a of accounts) if (a.parent_id != null) kids.set(Number(a.parent_id), (kids.get(Number(a.parent_id)) || 0) + 1);
  const active = a => (a.status == null || a.status === 'active') && (a.is_active == null || Number(a.is_active) === 1);
  for (const a of accounts) {
    const code = String(a.code);
    const add = (list, rule, detail) => list.push({ rule, code, name: a.name, detail });
    if (!/^\d+$/.test(code) || !levelForCode(code)) { add(errors, 'invalid_code', code); continue; }
    const type = normalizeAccountType(a.type);
    if (!type) add(errors, 'unknown_type', a.type);
    else if (type !== a.type) add(errors, 'type_not_normalized', a.type);
    const parent = a.parent_id != null ? byId.get(Number(a.parent_id)) : null;
    if (a.parent_id != null && !parent) add(errors, 'orphan_parent', a.parent_id);
    const wantParent = expectedParentCode(code);
    if ((parent ? String(parent.code) : null) !== wantParent) add(errors, 'wrong_parent', `${parent ? parent.code : 'none'} -> expected ${wantParent || 'none'}`);
    if (wantParent && !byCode.has(wantParent)) add(errors, 'missing_parent_account', wantParent);
    if (a.parent_code !== undefined && (a.parent_code || null) !== (parent ? String(parent.code) : null)) add(errors, 'parent_code_mismatch', `${a.parent_code} vs ${parent ? parent.code : null}`);
    if (Number(a.level) !== levelForCode(code)) add(errors, 'wrong_level', `${a.level} -> ${levelForCode(code)}`);
    const hasKids = (kids.get(Number(a.id)) || 0) > 0;
    if (hasKids && Number(a.is_posting) === 1) add(errors, 'posting_account_has_children');
    if (!hasKids && Number(a.is_posting) === 1 && levelForCode(code) !== 5) add(errors, 'posting_account_not_level5');
    if (!hasKids && Number(a.is_posting) !== 1 && active(a)) add(warnings, 'empty_group', 'header without children (cannot be posted to)');
    if (parent && type && active(a)) {
      const parentType = normalizeAccountType(parent.type);
      const rootException = Object.hasOwn(PARENT_EXCEPTIONS, code);
      if (parentType && parentType !== type && !rootException) add(errors, 'type_differs_from_parent', `${type} under ${parent.code} (${parentType})`);
    }
    if (a.normal_balance !== undefined && type && a.normal_balance !== normalBalanceFor(type, a.is_contra)) add(errors, 'wrong_normal_balance', `${a.normal_balance} -> ${normalBalanceFor(type, a.is_contra)}`);
  }
  return { errors, warnings };
}

module.exports = {
  ACCOUNT_TYPES, normalizeAccountType, normalBalanceFor, levelForCode, prefixParentCode,
  expectedParentCode, PARENT_EXCEPTIONS, SYSTEM_ACCOUNT_ROLES, auditChart
};
