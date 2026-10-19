const { test } = require('node:test');
const assert = require('node:assert/strict');
const labels = require('../js/financial-labels');
const Excel = require('../js/excel-export');
const { transformReport } = require('../server/services/reportFilterService');

test('financial classifications have consistent Arabic labels while internal codes remain unchanged',()=>{
 for(const [code,label] of [['asset','الأصول'],['liability','الالتزامات'],['equity','حقوق الملكية'],['expense','المصروفات'],['revenue','الإيرادات'],['cost','التكاليف']]) assert.equal(labels.type(code),label);
 assert.equal(labels.type('مصروفات'),'المصروفات'); assert.equal(labels.type('cash'),'صندوق');
 const report=transformReport({success:true,data:{accounts:[{id:1,code:'1',type:'asset',balance:5}]}},{rate:1,hide_zero:false,display_level:'subsidiary'},[]);
 assert.equal(report.data.accounts[0].type,'asset');assert.equal(report.data.accounts[0].type_label,'الأصول');
});

test('Excel uses English digits and numeric monetary cells without currency text',async()=>{
 assert.equal(Excel.formatNum('٦٦٦٫٥٠'),'666.5'); assert.equal(Excel.formatNum('۱۲٬۳۴۵٫۶۷'),'12,345.67');
 const html=Excel.normalizeExportHtml('<p>عملة العرض USD</p><table><tr><td class="currency">٦٦٦ ر.ي</td><td>۱۲٫۵ $</td><td>USD 42</td><td>فاتورة رقم ١٢</td></tr></table>');
 assert.ok(html.includes('x:num="666">666</td>'));assert.ok(html.includes('<td>12.5</td>'));assert.ok(html.includes('<td>42</td>'));assert.ok(html.includes('فاتورة رقم 12'));assert.ok(html.includes('عملة العرض USD'));
 let blob;const create=URL.createObjectURL;URL.createObjectURL=value=>{blob=value;return 'blob:test';};
 global.document={createElement:()=>({setAttribute(){},click(){}}),body:{appendChild(){},removeChild(){}}};
 try { Excel.download(html,'test');const file=await blob.text();const style=file.match(/\.currency \{[^}]+\}/)[0];assert.ok(!style.includes('ر'));assert.ok(style.includes('[$-409]'));assert.ok(file.includes('x:num="666"')); }
 finally {URL.createObjectURL=create;delete global.document;}
});

test('zero-account hiding preserves active accounts with net-zero balances and never hides movements',()=>{
 const data={accounts:[{code:'1',opening_balance:0,period_debit:0,period_credit:0,closing_balance:0},{code:'2',opening_balance:0,period_debit:10,period_credit:10,closing_balance:0}],movements:[{debit:10,credit:10,running_balance:0}],totals:{period_debit:10,period_credit:10}};
 const output=transformReport({success:true,data},{hide_zero:true,rate:1,display_level:'subsidiary'},[]);
 assert.equal(output.data.accounts.length,1);assert.equal(output.data.accounts[0].code,'2');assert.equal(output.data.movements.length,1);assert.deepEqual(output.data.totals,data.totals);
});
