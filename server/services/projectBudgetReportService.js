const ledger = require('./reportingLedger');
const { context } = require('./reportFilterService');
const round = value => Math.round((Number(value) || 0) * 100) / 100;

async function getProjectBudget({ as_of_date, project_id = null, allowedProjects = ['*'] }, db = ledger) {
  const asOf = as_of_date || new Date().toISOString().slice(0,10);
  const unrestricted = allowedProjects.includes('*') || allowedProjects.includes('all');
  const allowed = allowedProjects.map(Number).filter(Number.isInteger);
  if (project_id && !unrestricted && !allowed.includes(Number(project_id))) throw Object.assign(new Error('المشروع خارج نطاق صلاحياتك'), { statusCode: 403 });
  const where = []; const args = [];
  if (!unrestricted) { where.push(allowed.length ? 'p.id IN (' + allowed.map(() => '?').join(',') + ')' : '1=0'); args.push(...allowed); }
  if (project_id) { where.push('p.id = ?'); args.push(Number(project_id)); }
  const projects = await db.query('SELECT p.id,p.code,p.name,p.currency,p.estimated_cost FROM projects p' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY p.code,p.id',args);
  if (project_id && !projects.length) throw Object.assign(new Error('المشروع غير موجود'), { statusCode: 404 });
  const currencies = await db.query('SELECT code,symbol,rate_to_base FROM currencies');
  const rates = new Map(currencies.flatMap(row=>[[row.code,Number(row.rate_to_base)],[row.symbol,Number(row.rate_to_base)]]));
  const ids = projects.map(row=>row.id); const marks = ids.map(()=>'?').join(',');
  const budgets = ids.length ? await db.query('SELECT id,project_id,category,planned_cost,notes FROM project_budgets WHERE project_id IN ('+marks+') ORDER BY project_id,id',ids) : [];
  const actuals = ids.length ? await db.query("SELECT jel.project_id, SUM(jel.debit-jel.credit) AS actual_cost FROM journal_entry_lines jel JOIN journal_entries je ON je.id=jel.entry_id JOIN accounts a ON a.id=jel.account_id WHERE je.status='posted' AND je.date <= ? AND jel.project_id IN ("+marks+") AND (a.type IN ('expense','cost','مصروفات','تكاليف') OR a.code LIKE '3%' OR a.code LIKE '5%') GROUP BY jel.project_id",[asOf,...ids]) : [];
  const byProject = new Map(actuals.map(row=>[Number(row.project_id),Number(row.actual_cost)||0]));
  const planByProject = new Map();
  for (const row of budgets) { const id=Number(row.project_id); if(!planByProject.has(id)) planByProject.set(id,[]); planByProject.get(id).push(row); }
  let rows = projects.map(project=>{
    const rate = rates.get(project.currency || 'ر.ي');
    if (!(rate > 0)) throw Object.assign(new Error('سعر عملة المشروع غير محدد: '+project.name),{statusCode:400});
    const lines = planByProject.get(Number(project.id)) || [];
    const planned = round((lines.length ? lines.reduce((sum,row)=>sum+Number(row.planned_cost||0),0) : Number(project.estimated_cost)||0)*rate);
    const actual = round(byProject.get(Number(project.id)) || 0);
    const remaining = round(planned-actual);
    return { project_id:project.id, project_code:project.code, project_name:project.name,
      planned_cost:planned, actual_cost:actual, variance_amount:round(actual-planned), remaining_budget:remaining,
      consumed_percentage:planned>0?round(actual/planned*100):null,
      budget_source:lines.length?'بنود موازنة المشروع':'التكلفة التقديرية في بيانات المشروع',
      budget_status:planned<=0?'بلا موازنة موجبة':actual>planned?'تجاوز الموازنة':'ضمن الموازنة',
      budget_lines:lines.map(line=>({id:line.id,category:line.category,planned_cost:round(Number(line.planned_cost||0)*rate),notes:line.notes||''}))
    };
  });
  const planned=round(rows.reduce((sum,row)=>sum+row.planned_cost,0));
  const actual=round(rows.reduce((sum,row)=>sum+row.actual_cost,0));
  const totals={planned_cost:planned,actual_cost:actual,variance_amount:round(actual-planned),remaining_budget:round(planned-actual),consumed_percentage:planned>0?round(actual/planned*100):null,projects_count:rows.length,over_budget_count:rows.filter(row=>row.planned_cost>0&&row.actual_cost>row.planned_cost).length,missing_budget_count:rows.filter(row=>row.planned_cost<=0).length};
  if(context.getStore()?.hide_zero) rows=rows.filter(row=>row.planned_cost!==0||row.actual_cost!==0);
  return {success:true,data:{projects:rows,totals},meta:{report_name:'موازنة المشروع — التقديري مقابل الفعلي',from_date:'1900-01-01',to_date:asOf,as_of_date:asOf,currency:'ر.ي',generated_at:new Date().toISOString()},warnings:[...(totals.missing_budget_count?['توجد مشاريع بلا موازنة موجبة؛ لا تُحسب لها نسبة استهلاك افتراضية.']:[]),...(context.getStore()?.cost_center_id?['الموازنة تخص كامل المشروع، بينما التكلفة الفعلية تخص مركز التكلفة المختار فقط.']:[])],reconciliation:{actual_source:'صافي المصروفات والتكاليف المحاسبية المرتبطة بالمشروع حتى تاريخ التقرير',planned_source:'مجموع بنود الموازنة، وإلا تقديري المشروع؛ لا يجمع المصدران معًا'}};
}
module.exports = { getProjectBudget };
