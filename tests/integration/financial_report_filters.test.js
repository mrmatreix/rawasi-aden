const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync, backup } = require('node:sqlite');

test('financial reports show expense accounts and share posting, hierarchy, center and display-currency filters', async () => {
 const root = path.resolve(__dirname, '../..'); const scratch = path.join(root, 'scratch'); fs.mkdirSync(scratch,{recursive:true});
 const temp = fs.mkdtempSync(path.join(scratch,'report-filters-')); const filename = path.join(temp,'test.db');
 const source = new DatabaseSync(process.env.TEST_SOURCE_DB_PATH || path.join(root,'server/database/rawasi_aden.db'),{readOnly:true}); let db,server;
 try {
  await backup(source,filename); source.close(); process.env.RAWASI_DB_PATH = filename; process.env.DB_ENGINE = 'sqlite';
  db = require('../../server/database/db'); await db.initializeDatabase();
  const app = require('../../server/server'); server = app.listen(0,'127.0.0.1'); await new Promise(resolve=>server.once('listening',resolve));
  const user = await db.get("SELECT id FROM users WHERE username = 'admin'"); const { JWT_SECRET } = require('../../server/middleware/security');
  const token = require('jsonwebtoken').sign({id:user.id,username:'admin',role:'admin'},JWT_SECRET,{expiresIn:'3m'}); const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
  const base = 'http://127.0.0.1:'+server.address().port;
  async function api(route,body) { const res = await fetch(base+route,{headers, ...(body?{method:'POST',body:JSON.stringify(body)}:{})}); return { status:res.status, body:await res.json() }; }
  const cc = (await db.run("INSERT INTO cost_centers(code,name,type,status) VALUES ('RF-A','تقارير أ','عام','active')")).lastInsertRowid;
  const cc2 = (await db.run("INSERT INTO cost_centers(code,name,type,status) VALUES ('RF-B','تقارير ب','عام','active')")).lastInsertRowid;
  const acct = async code => (await db.get('SELECT id FROM accounts WHERE code = ?',[code])).id;
  const cash=await acct('11101001'), exp=await acct('31101001'), op=await acct('32102001'), rev=await acct('41101001');
  const extra=(await db.run("INSERT INTO accounts(code,name,type,parent_id,level,is_posting,status) VALUES ('77770001','مصروف بتصنيف إنجليزي', 'expense', ?,5,1,'active')",[await acct('3')])).lastInsertRowid;
  const date='2098-03-01'; let serial=0;
  async function journal(account,amount,status,center,income=false) {
   const id=(await db.run('INSERT INTO journal_entries(entry_no,date,description,status,reference_type,total_debit,total_credit) VALUES (?,?,?,?,?,?,?)',['REPORT-FILTER-'+(++serial),date,'اختبار تقارير',status,'TEST',amount,amount])).lastInsertRowid;
   await db.run('INSERT INTO journal_entry_lines(entry_id,account_id,cost_center_id,debit,credit) VALUES (?,?,?,?,?)',[id,account,center,income?0:amount,income?amount:0]);
   await db.run('INSERT INTO journal_entry_lines(entry_id,account_id,cost_center_id,debit,credit) VALUES (?,?,?,?,?)',[id,cash,center,income?amount:0,income?0:amount]);
   return id;
  }
  await journal(exp,100,'posted',cc); await journal(op,40,'draft',cc); await journal(op,60,'draft',cc2); await journal(extra,5,'posted',cc);
  await journal(rev,300,'posted',cc,true); await journal(rev,50,'draft',cc2,true);
  await db.run("UPDATE accounting_periods SET status='open' WHERE start_date<=? AND end_date>=?",[date,date]);
  const voucher=await api('/api/expenses',{date,amount:25,account_id:op,settlement_account_id:cash,payment_method:'نقدي',expense_type:'مصروف عام',status:'draft',cost_center_id:cc}); assert.equal(voucher.status,200,JSON.stringify(voucher.body));
  const query='?from_date='+date+'&to_date='+date;
  const report=async (name,opts='')=> { const out=await api('/api/reports/'+name+query+opts); assert.equal(out.status,200,JSON.stringify(out.body)); assert.equal(out.body.success,true,JSON.stringify(out.body)); return out.body; };
  const all=await report('income-statement'); assert.equal(all.data.total_expenses,230); assert.equal(all.data.total_revenues,350); assert.equal(all.data.net_profit,120);
  assert.equal(all.data.expenses.reduce((sum,row)=>sum+row.amount,0),230); assert.ok(all.data.expenses.some(row=>row.code==='77770001')); assert.equal(all.data.total_direct_costs,100);
  const withZero = await report('trial-balance','&hide_zero=false');
  const noZero = await report('trial-balance','&hide_zero=true');
  assert.ok(noZero.data.accounts.length < withZero.data.accounts.length);
  assert.deepEqual(noZero.data.totals, withZero.data.totals);
  assert.equal(noZero.meta.hide_zero,true);
  assert.ok(noZero.data.accounts.every(row => ['opening_balance','period_debit','period_credit','closing_balance'].some(key => Math.abs(Number(row[key])) >= 0.005)));
  assert.equal(noZero.data.accounts.find(row=>row.code==='31101001').type_label,'المصروفات');
  assert.equal((await api('/api/reports/trial-balance'+query+'&hide_zero=invalid')).status,400);
  const posted=await report('income-statement','&posting_status=posted'); const pending=await report('income-statement','&posting_status=unposted');
  assert.equal(posted.data.total_expenses,105); assert.equal(pending.data.total_expenses,125); assert.equal(posted.data.total_expenses+pending.data.total_expenses,all.data.total_expenses);
  const centered=await report('income-statement','&cost_center_id='+cc); assert.equal(centered.data.total_expenses,170); assert.equal(centered.data.total_revenues,300);
  for(const mode of ['main','main_and_subsidiary']) { const shaped=await report('income-statement','&display_level='+mode); assert.equal(shaped.data.total_expenses,230); assert.equal(shaped.data.expenses.find(row=>row.code==='3').amount,230); if(mode==='main') assert.ok(shaped.data.expenses.every(row=>row.account_kind==='main')); }
  const usd=await db.get("SELECT rate_to_base,symbol FROM currencies WHERE code='USD'"); const converted=await report('income-statement','&currency=USD'); assert.equal(converted.meta.currency,usd.symbol); assert.equal(converted.data.total_expenses,Math.round(230/usd.rate_to_base*100)/100);
  const pnl=await report('profit-loss'); assert.equal(pnl.data.expenses_breakdown.reduce((sum,row)=>sum+row.amount,0),230); assert.equal(pnl.data.total_income,350);
  for(const name of ['trial-balance','balance-sheet','cash-flow','projects-profitability','cost-centers-profitability']) {
    for(const status of ['all','posted','unposted']) { const out=await report(name,'&posting_status='+status+'&display_level=main_and_subsidiary&cost_center_id='+cc+'&currency=USD'); assert.equal(out.meta.posting_status,status); assert.equal(out.meta.cost_center_id,cc); assert.equal(out.meta.currency_code,'USD'); }
  }
  const mainMovement=await report('account-movement','&account_id='+(await acct('3'))+'&display_level=main'); assert.equal(mainMovement.data.totals.total_debit,230);
  const result=await api('/api/expenses/'+voucher.body.id+'/post',{}); assert.equal(result.status,200,JSON.stringify(result.body));
  assert.equal((await report('income-statement')).data.total_expenses,230); assert.equal((await report('income-statement','&posting_status=posted')).data.total_expenses,130); assert.equal((await report('income-statement','&posting_status=unposted')).data.total_expenses,100);
  const budgetProject=(await db.run("INSERT INTO projects(code,name,estimated_cost,currency,status) VALUES ('RF-BUDGET','موازنة تجريبية',1000,'ر.ي','جاري')")).lastInsertRowid;
  await db.run("UPDATE journal_entry_lines SET project_id = ? WHERE entry_id IN (SELECT id FROM journal_entries WHERE entry_no LIKE 'REPORT-FILTER-%')",[budgetProject]);
  await db.run("INSERT INTO project_budgets(project_id,category,planned_cost,actual_cost) VALUES (?,'مواد',80,99999),(?,'أجور',70,99999)",[budgetProject,budgetProject]);
  const budget=await report('project-budget','&project_id='+budgetProject);
  assert.equal(budget.data.projects[0].planned_cost,150);
  assert.equal(budget.data.projects[0].actual_cost,205);
  assert.equal(budget.data.projects[0].remaining_budget,-55);
  assert.equal(budget.data.projects[0].consumed_percentage,136.67);
  assert.equal(budget.data.projects[0].budget_status,'تجاوز الموازنة');
  assert.equal(budget.data.projects[0].budget_lines.length,2);
  assert.ok(budget.data.account_details.length>0);
  assert.equal((await report('project-budget','&project_id='+budgetProject+'&posting_status=posted')).data.totals.actual_cost,105);
  assert.equal((await report('project-budget','&project_id='+budgetProject+'&posting_status=unposted')).data.totals.actual_cost,100);
  assert.equal((await report('project-budget','&project_id='+budgetProject+'&cost_center_id='+cc)).data.totals.actual_cost,145);
  assert.equal((await report('project-budget','&project_id='+budgetProject+'&currency=USD')).data.totals.planned_cost,Math.round(150/usd.rate_to_base*100)/100);
  const noBudget=(await db.run("INSERT INTO projects(code,name,estimated_cost,currency,status) VALUES ('RF-EMPTY','بدون موازنة',0,'ر.ي','جاري')")).lastInsertRowid;
  const empty=await report('project-budget','&project_id='+noBudget);
  assert.equal(empty.data.projects[0].consumed_percentage,null);
  assert.equal(empty.data.totals.missing_budget_count,1);
  assert.equal((await report('project-budget','&project_id='+noBudget+'&hide_zero=true')).data.projects.length,0);
  await db.run('DELETE FROM project_budgets WHERE project_id = ?',[budgetProject]);
  assert.equal((await report('project-budget','&project_id='+budgetProject)).data.totals.planned_cost,1000);
  const {getProjectBudget}=require('../../server/services/projectBudgetReportService');
  assert.equal((await getProjectBudget({as_of_date:date,allowedProjects:[]})).data.projects.length,0);
  await assert.rejects(getProjectBudget({as_of_date:date,project_id:budgetProject,allowedProjects:[]}),error=>error.statusCode===403);
  assert.equal((await api('/api/reports/project-budget?project_id=invalid')).status,400);
  assert.equal((await api('/api/reports/project-budget?project_id=999999999')).status,404);
  const client=await db.get('SELECT id FROM clients LIMIT 1'); const supplier=await db.get('SELECT id FROM suppliers LIMIT 1');
  if (supplier) {
    await db.run('UPDATE expenses SET supplier_id = ? WHERE id = ?', [supplier.id,voucher.body.id]);
    const postedParty = await report('supplier-statement/'+supplier.id,'&posting_status=posted&cost_center_id='+cc);
    assert.ok(postedParty.data.statement.some(row=>row.ref===voucher.body.receipt_no));
    const pendingParty = await report('supplier-statement/'+supplier.id,'&posting_status=unposted&cost_center_id='+cc);
    assert.ok(!pendingParty.data.statement.some(row=>row.ref===voucher.body.receipt_no));
    assert.ok(!(await report('supplier-statement/'+supplier.id,'&cost_center_id='+cc2)).data.statement.some(row=>row.ref===voucher.body.receipt_no));
  }
  if (client) {
    await db.run("INSERT INTO payments(receipt_no,type,client_id,date,amount,local_amount,account_id,settlement_account_id,payment_method,cost_center_id,status,currency,exchange_rate) VALUES ('RF-CLIENT','قبض',?,?,12,12,?,?,'نقدي',?,'draft','ر.ي',1)",[client.id,date,rev,cash,cc]);
    const party = await report('client-statement/'+client.id,'&posting_status=unposted&cost_center_id='+cc);
    assert.ok(party.data.statement.some(row=>row.ref==='RF-CLIENT'));
    assert.ok(!(await report('client-statement/'+client.id,'&posting_status=posted&cost_center_id='+cc)).data.statement.some(row=>row.ref==='RF-CLIENT'));
    assert.ok(!(await report('client-statement/'+client.id,'&cost_center_id='+cc2)).data.statement.some(row=>row.ref==='RF-CLIENT'));
  }
  for(const [name,party] of [['client-statement',client],['supplier-statement',supplier]]) if(party) for(const status of ['all','posted','unposted']) await report(name+'/'+party.id,'&posting_status='+status+'&cost_center_id='+cc+'&currency=USD');
  for(const invalid of ['&posting_status=bad','&display_level=bad','&currency=BAD','&cost_center_id=-1','&cost_center_id=999999999']) assert.equal((await api('/api/reports/income-statement'+query+invalid)).status,400);
  const [a,b]=await Promise.all([report('income-statement','&posting_status=posted'),report('income-statement','&posting_status=unposted')]); assert.equal(a.data.total_expenses,130); assert.equal(b.data.total_expenses,100);
 } finally {
  if(server) await new Promise(resolve=>server.close(resolve)); if(db?.db) db.db.close(); try{source.close();}catch{}
  assert.ok(path.resolve(temp).startsWith(path.resolve(scratch)+path.sep)); fs.rmSync(temp,{recursive:true,force:true});
 }
});
