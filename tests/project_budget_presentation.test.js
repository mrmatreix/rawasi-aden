const {test}=require('node:test');
const assert=require('node:assert/strict');
const Reports=require('../js/reports');
const Excel=require('../js/excel-export');
test('project budget shows variance, null percentages and escapes project/category names in PDF and Excel content',()=>{
 const data={projects:[{project_code:'P1',project_name:'<script>مشروع</script>',planned_cost:100,actual_cost:120,remaining_budget:-20,variance_amount:20,consumed_percentage:120,budget_status:'تجاوز الموازنة',budget_source:'بنود الموازنة',budget_lines:[{category:'مواد <أ>',planned_cost:100}]}],totals:{planned_cost:100,actual_cost:120,remaining_budget:-20,variance_amount:20,consumed_percentage:120,over_budget_count:1}};
 const html=Reports.budgetReportHtml(data,value=>Excel.formatNum(value));
 assert.ok(html.includes('120%'));assert.ok(html.includes('-20'));assert.ok(html.includes('تجاوز الموازنة'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('مواد &lt;أ&gt;'));
 assert.ok(!/[٠-٩]/.test(Excel.normalizeExportHtml(html)));
 data.projects[0].consumed_percentage=null;assert.ok(Reports.budgetReportHtml(data,String).includes('غير محسوبة'));
});
