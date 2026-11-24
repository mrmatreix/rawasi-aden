const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseFilters, shapeAccountRows, transformReport } = require('../server/services/reportFilterService');
const Reports = require('../js/reports');

test('report amounts use Western digits for opening balances and budget numbers', () => {
 assert.equal(Reports.formatNumber('١٢٬٣٤٥٫٦٧'), '12,345.67');
 assert.equal(Reports.formatNumber('۱۲۳۴۵٫۶۷'), '12,345.67');
 assert.equal(Reports.formatNumber(-1200.5), '-1,200.5');
 assert.equal(Reports.formatNumber(null), '0');
});

test('slower old report filters cannot overwrite the latest posting and account level selection', async () => {
 const fields = { financialPostingStatus: {value:'posted'}, financialDisplayLevel:{value:'subsidiary'}, financialCurrency:{value:'YER'}, financialFilterSummary:{textContent:''} };
 const pending = [];
 global.document = { getElementById:id => fields[id] || null };
 global.window = {location:{origin:'https://example.test'}};
 global.App = {showToast:()=>{}};
 global.fetch = url => new Promise(resolve=>pending.push({url,resolve}));
 try {
  const old = Reports.fetchFinancialReport('/api/reports/trial-balance');
  fields.financialPostingStatus.value='unposted'; fields.financialDisplayLevel.value='main';
  const current = Reports.fetchFinancialReport('/api/reports/trial-balance');
  assert.ok(pending[1].url.includes('posting_status=unposted'));
  assert.ok(pending[1].url.includes('display_level=main'));
  pending[1].resolve({ok:true,status:200,json:async()=>({success:true,data:{accounts:[]},meta:{posting_status:'unposted',display_level:'main',currency:'ر.ي'}})});
  assert.equal((await (await current).json()).success,true);
  const summary=fields.financialFilterSummary.textContent;
  pending[0].resolve({ok:true,status:200,json:async()=>({success:true,data:{accounts:[]},meta:{posting_status:'posted',display_level:'subsidiary'}})});
  assert.equal((await (await old).json()).stale,true);
  assert.equal(fields.financialFilterSummary.textContent,summary);
  assert.ok(summary.includes('قبل الترحيل فقط')); assert.ok(summary.includes('حسابات رئيسية'));
 } finally { delete global.document; delete global.window; delete global.App; delete global.fetch; Reports.reportRequests = new Map(); }
});

test('hierarchy aggregation nets parent balances and keeps source totals and identifiers unchanged',()=>{
 const chart=[{id:1,code:'3',name:'مصروفات',parent_id:null,level:1},{id:2,code:'31',name:'النشاط',parent_id:1,level:2},{id:3,code:'31101001',name:'أ',parent_id:2,level:5},{id:4,code:'31101002',name:'ب',parent_id:2,level:5}];
 const rows=[{id:3,code:'31101001',name:'أ',opening_balance:80,opening_debit:80,opening_credit:0,period_debit:100,period_credit:0,closing_balance:180,closing_debit:180,closing_credit:0},{id:4,code:'31101002',name:'ب',opening_balance:-50,opening_debit:0,opening_credit:50,period_debit:0,period_credit:60,closing_balance:-110,closing_debit:0,closing_credit:110}];
 const main=shapeAccountRows(rows,chart,'main'); assert.equal(main.length,2); assert.equal(main[0].opening_debit,30); assert.equal(main[0].opening_credit,0); assert.equal(main[0].closing_debit,70); assert.equal(main[0].closing_credit,0);
 const report={success:true,data:{accounts:rows,totals:{period_debit:100,period_credit:60},projects:[{id:3,profit_margin_pct:25,contract_value:100}],total_projects:2},meta:{},reconciliation:{difference:40}};
 const output=transformReport(report,{display_level:'main_and_subsidiary',posting_status:'all',rate:10,symbol:'$',currency:'USD'},chart);
 assert.equal(output.data.accounts.length,4); assert.equal(output.data.totals.period_debit,10); assert.equal(output.data.projects[0].profit_margin_pct,25); assert.equal(output.data.projects[0].id,3); assert.equal(output.data.projects[0].contract_value,10); assert.equal(output.data.total_projects,2); assert.equal(output.reconciliation.difference,4); assert.equal(report.data.totals.period_debit,100);
 for(const value of [{posting_status:'invalid'},{display_level:'invalid'},{cost_center_id:'1 OR 1=1'}]) assert.throws(()=>parseFilters(value));
});

test('income report displays each expense account and prints the same expense details and display currency',async()=>{
 const elements=Object.fromEntries(['isExpensesTableBody','isRevenuesTableBody','isTotalRevenues','isDirectCosts','isGrossProfit','isTotalExpenses','isNetIncome','printArea'].map(id=>[id,{innerHTML:'',textContent:'',style:{}}]));
 global.document={getElementById:id=>elements[id]||null}; global.App={formatNumber:String,showToast:()=>{}}; let printed=false; global.window={print:()=>{printed=true;}};
 const previous=Reports.fetchFinancialReport, cache=Reports.lastReportData, currency=Reports.loadedReportCurrency;
 Reports.loadedReportCurrency='$'; Reports.lastReportData={};
 Reports.fetchFinancialReport=async()=>({json:async()=>({success:true,data:{revenues:[{code:'41101001',name:'إيراد',amount:100}],expenses:[{code:'31101001',name:'أسمنت',amount:30},{code:'32102001',name:'كهرباء',amount:20}],total_expenses:50,total_revenues:100,net_profit:50},meta:{currency:'$',currency_code:'USD',rate_to_base:1584,posting_status:'unposted',display_level:'subsidiary'}})});
 try { await Reports.loadIncomeStatement(); assert.ok(elements.isExpensesTableBody.innerHTML.includes('31101001 - أسمنت')); assert.ok(elements.isExpensesTableBody.innerHTML.includes('32102001 - كهرباء')); assert.ok(elements.isExpensesTableBody.innerHTML.includes('50 $')); Reports.activeReportTab='income-statement'; Reports.printActiveReport(); assert.ok(printed); assert.ok(elements.printArea.innerHTML.includes('31101001 - أسمنت')); assert.ok(elements.printArea.innerHTML.includes('32102001 - كهرباء')); assert.ok(elements.printArea.innerHTML.includes('قبل الترحيل فقط')); assert.ok(elements.printArea.innerHTML.includes('USD')); }
 finally { Reports.fetchFinancialReport=previous;Reports.lastReportData=cache;Reports.loadedReportCurrency=currency;delete global.document;delete global.App;delete global.window; }
});
