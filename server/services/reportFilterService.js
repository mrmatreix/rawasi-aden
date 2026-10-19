const { AsyncLocalStorage } = require('node:async_hooks');
const context = new AsyncLocalStorage();
const financialLabels = require('../../js/financial-labels');
const round = n => Math.round((Number(n) || 0) * 100) / 100;
function parseFilters(input = {}) {
 if (input.hide_zero !== undefined && !['true','false',true,false,'1','0'].includes(input.hide_zero)) throw Object.assign(new Error('خيار الحسابات الصفرية غير صالح'), { statusCode: 400 });
 const filters = { display_level: input.display_level || 'subsidiary', posting_status: input.posting_status || 'all', cost_center_id: input.cost_center_id ? Number(input.cost_center_id) : null, currency: input.currency || 'YER' };
 if (!['main','subsidiary','main_and_subsidiary'].includes(filters.display_level) || !['all','posted','unposted'].includes(filters.posting_status) || (filters.cost_center_id !== null && (!Number.isInteger(filters.cost_center_id) || filters.cost_center_id <= 0)) || typeof filters.currency !== 'string') throw Object.assign(new Error('خيارات التقرير غير صالحة'), { statusCode: 400 });
 filters.hide_zero = [true,'true','1'].includes(input.hide_zero);
 return filters;
}
function shapeAccountRows(rows, chart, mode) {
 if (!rows?.length) return rows || [];
 const byId = new Map(chart.map(a => [Number(a.id), a]));
 const byCode = new Map(chart.map(a => [String(a.code), a]));
 const source = rows.filter(row => row.account_kind !== 'main');
 if (!source.length) return rows;
 if (mode === 'subsidiary') return source.map(row => ({ ...row, account_kind: 'subsidiary' }));
 const totals = new Map();
 for (const row of source) {
  let account = byCode.get(String(row.code));
  const seen = new Set();
  while (account?.parent_id && !seen.has(Number(account.parent_id))) {
   seen.add(Number(account.parent_id)); account = byId.get(Number(account.parent_id)); if (!account) break;
   let parent = totals.get(Number(account.id));
   if (!parent) { parent = { id: account.id, code: account.code, name: account.name, type: account.type, level: account.level, account_kind: 'main', is_summary: true }; totals.set(Number(account.id), parent); }
   for (const [key, value] of Object.entries(row)) if (['amount','balance','opening_balance','period_debit','period_credit','closing_balance','net_balance'].includes(key)) parent[key] = round((parent[key] || 0) + Number(value || 0));
  }
 }
 for (const parent of totals.values()) {
  if ('opening_balance' in parent) { parent.opening_debit = Math.max(parent.opening_balance, 0); parent.opening_credit = Math.max(-parent.opening_balance, 0); }
  if ('closing_balance' in parent) { parent.closing_debit = Math.max(parent.closing_balance, 0); parent.closing_credit = Math.max(-parent.closing_balance, 0); }
  if (source.some(row => 'item' in row)) parent.item = parent.code + ' - ' + parent.name;
 }
 const standalone = source.filter(row => !byCode.get(String(row.code))?.parent_id);
 return [...totals.values(), ...(mode === 'main_and_subsidiary' ? source : standalone)].sort((a,b) => String(a.code).localeCompare(String(b.code)));
}
function documentBaseAmount(row, value, useLocal = false) {
 if (!context.getStore()) return Number(value) || 0;
 if (useLocal && row.local_amount !== null && row.local_amount !== undefined && Number(row.local_amount) !== 0) return Number(row.local_amount);
 const rate = Number(row.exchange_rate) > 0 ? Number(row.exchange_rate) : context.getStore().rates?.get(row.currency || 'YER') || 1;
 return round((Number(value) || 0) * rate);
}
function monetary(key) {
 return !/(percentage|percent|pct|margin|rate|_id$|count|number|days|is_|total_projects|total_centers)/.test(key) && /amount|balance|debit|credit|cost|income|revenue|profit|cash|receipt|inflow|outflow|budget|retention|advance|contract_value|invoiced|collected|purchases|payments|paid|outstanding|remaining|opening|closing|^net$|^total$|difference|total_equity|total_assets|total_liabilities|_exp$|_rev$|expenses|^assets$|^liabilities$|^equity$|^liabilities_plus_equity$/.test(key);
}
function transformReport(report, filters, chart) {
 if (!report?.success || !report.data) return report;
 const shape = obj => {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
   if (obj.length && obj.every(row => row && row.code !== undefined && ('amount' in row || 'balance' in row || 'period_debit' in row))) return shapeAccountRows(obj, chart, filters.display_level);
   return obj.map(shape);
  }
  return Object.fromEntries(Object.entries(obj).map(([key, value]) => [key, shape(value)]));
 };
 const convert = (obj, key = '') => {
  if (typeof obj === 'number') return monetary(key) ? round(obj / filters.rate) : obj;
  if (Array.isArray(obj)) return obj.map(value => convert(value));
  if (obj && typeof obj === 'object') return Object.fromEntries(Object.entries(obj).map(([k,v]) => [k, convert(v,k)]));
  return obj;
 };
 const decorate = obj => {
  if (Array.isArray(obj)) {
   const rows = obj.map(decorate);
   const fields = ['amount','balance','opening_balance','opening_debit','opening_credit','period_debit','period_credit','closing_balance','closing_debit','closing_credit','net_balance'];
   if (filters.hide_zero && rows.length && rows.every(row => row && typeof row === 'object' && row.code !== undefined && fields.some(field => field in row))) {
    return rows.filter(row => fields.some(field => Math.abs(Number(row[field]) || 0) >= 0.005));
   }
   return rows;
  }
  if (!obj || typeof obj !== 'object') return obj;
  const output = Object.fromEntries(Object.entries(obj).map(([key,value]) => [key,decorate(value)]));
  if (Object.hasOwn(output, 'type')) output.type_label = financialLabels.type(output.type);
  return output;
 };
 const data = decorate(convert(shape(report.data)));
 if (data.client) data.client.currency = filters.symbol;
 if (data.supplier) data.supplier.currency = filters.symbol;
 return { ...report, data, reconciliation: convert(report.reconciliation), meta: { ...report.meta, ...filters, currency: filters.symbol, currency_code: filters.currency, currency_mode: 'display_conversion', rate_to_base: filters.rate, base_currency: 'YER', source: filters.posting_status === 'posted' ? 'دفتر الأستاذ — بعد الترحيل' : filters.posting_status === 'unposted' ? 'الأثر المتوقع — قبل الترحيل' : 'العمليات المرحلة وغير المرحلة دون تكرار' }, warnings: [...(report.warnings || []), ...(filters.cost_center_id ? ['النتيجة تخص مركز التكلفة المحدد؛ قد لا يتوازن طرفا القيود إذا اختلف المركز بين الأسطر.'] : [])] };
}
async function addAccountDetails(report, name, params, db) {
 if (!report?.success || !report.data || !['project-budget','projects-profitability','cost-centers-profitability','client-statement','supplier-statement'].includes(name)) return report;
 const args = [report.meta.from_date || '2024-01-01', report.meta.to_date || new Date().toISOString().slice(0,10)];
 let scope = '1=1';
 if (['project-budget','projects-profitability'].includes(name)) {
  const ids = (report.data.projects || []).map(row => Number(row.project_id ?? row.id));
  scope = ids.length ? 'jel.project_id IN (' + ids.map(() => '?').join(',') + ')' : '1=0'; args.push(...ids);
 } else if (name === 'client-statement') {
  scope = "((je.reference_type = 'سند قبض' AND je.reference_id IN (SELECT id FROM payments WHERE client_id = ?)) OR (je.reference_type IN ('فاتورة','مستخلص','bill','billing') AND je.reference_id IN (SELECT id FROM bills WHERE client_id = ?)))";
  args.push(report.data.client.id, report.data.client.id);
 } else if (name === 'supplier-statement') {
  scope = "((je.reference_type = 'سند صرف' AND je.reference_id IN (SELECT id FROM expenses WHERE supplier_id = ?)) OR (je.reference_type = 'سند صرف' AND je.reference_id IN (SELECT id FROM payments WHERE supplier_id = ?)))";
  args.push(report.data.supplier.id, report.data.supplier.id);
 }
 report.data.account_details = await db.query("SELECT a.id,a.code,a.name,a.type,a.parent_id,a.level,SUM(jel.debit) AS period_debit,SUM(jel.credit) AS period_credit,SUM(jel.debit-jel.credit) AS closing_balance FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.entry_id JOIN accounts a ON a.id = jel.account_id WHERE je.status = 'posted' AND je.date BETWEEN ? AND ? AND (" + scope + ') GROUP BY a.id,a.code,a.name,a.type,a.parent_id,a.level ORDER BY a.code', args);
 return report;
}
module.exports = { addAccountDetails, documentBaseAmount, context, parseFilters, shapeAccountRows, transformReport };
