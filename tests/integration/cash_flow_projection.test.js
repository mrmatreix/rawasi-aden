const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync,backup}=require('node:sqlite');
test('cash-flow upgrades schema, renders real balances, regenerates live documents and validates periods',async()=>{
 const scratch=path.resolve(__dirname,'../../scratch');fs.mkdirSync(scratch,{recursive:true});
 const temp=fs.mkdtempSync(path.join(scratch,'cash-projection-')),filename=path.join(temp,'test.db');
 const source=new DatabaseSync(process.env.TEST_SOURCE_DB_PATH,{readOnly:true});let db,server;
 try {
  await backup(source,filename);source.close();process.env.RAWASI_DB_PATH=filename;
  db=require('../../server/database/db');await db.ready;
  await db.run('DROP TABLE cash_flow_projections');await db.run('DROP TABLE cash_flow_scenarios');
  await db.initializeDatabase();await db.initializeDatabase();
  const app=require('../../server/server');server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const user=await db.get("SELECT id FROM users WHERE username='admin'");
  const token=require('jsonwebtoken').sign({id:user.id,username:'admin',role:'admin'},require('../../server/middleware/security').JWT_SECRET,{expiresIn:'3m'});
  const base='http://127.0.0.1:'+server.address().port,headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
  const api=async(route,body)=>{const res=await fetch(base+'/api/cash-flow/'+route,{headers,...(body?{method:'POST',body:JSON.stringify(body)}:{})});return {status:res.status,body:await res.json()};};
  const period='2097-01',query='?from='+period+'&to=2097-02';
  let result=await api('projection'+query);assert.equal(result.status,200);assert.equal(result.body.initial_cash,0);assert.equal(result.body.months.length,2);
  result=await api('projection/regenerate',{from:period,to:'2097-02'});assert.equal(result.status,200,JSON.stringify(result.body));
  result=await api('projection'+query);assert.equal(result.body.total_payments,0);assert.equal(result.body.total_collections,0);
  const cash=(await db.get("SELECT id FROM accounts WHERE code='11101001'")).id;
  const liability=(await db.get("SELECT id FROM accounts WHERE code='22101001'")).id;
  const entry=(await db.run("INSERT INTO journal_entries(entry_no,date,description,status,total_debit,total_credit) VALUES ('CF-OPEN','2020-01-01','فتح','posted',500,500)")).lastInsertRowid;
  await db.run('INSERT INTO journal_entry_lines(entry_id,account_id,debit,credit) VALUES (?,?,0,500),(?,?,500,0)',[entry,cash,entry,liability]);
  const project=(await db.run("INSERT INTO projects(code,name,status,contract_value) VALUES ('CF-P','مشروع تدفق','جاري',0)")).lastInsertRowid;
  await db.run("INSERT INTO bills(bill_no,project_id,amount,net_amount,paid_amount,status,date) VALUES ('CF-B',?,400,400,100,'approved','2097-01-05')",[project]);
  await db.run("INSERT INTO purchases(invoice_no,project_id,total_amount,paid_amount,status,date) VALUES ('CF-V',?,70,30,'posted','2097-01-05')",[project]);
  result=await api('projection/regenerate',{from:period,to:'2097-02'});assert.equal(result.status,200,JSON.stringify(result.body));
  result=await api('projection'+query);assert.equal(result.body.initial_cash,-500);assert.equal(result.body.total_collections,300);assert.equal(result.body.total_payments,40);assert.equal(result.body.final_cumulative_balance,-240);assert.equal(result.body.currency,'YER');
  const again=await api('projection/regenerate',{from:period,to:'2097-02'});assert.equal(again.status,200);
  assert.deepEqual((await api('projection'+query)).body,result.body);
  const scenario=await api('scenarios'+query);assert.equal(scenario.status,200);assert.equal(scenario.body.scenarios.realistic.months.length,2);assert.equal(scenario.body.scenarios.realistic.final_balance,-270);
  for(const value of ['?from=2097-13&to=2098-01','?from=2098-01&to=2097-01','?from=2000-01&to=2097-01'])assert.equal((await api('projection'+value)).status,400);
 } finally {
  if(server)await new Promise(resolve=>server.close(resolve));if(db)await db.closeDatabase();try{source.close();}catch{}
  assert.ok(path.resolve(temp).startsWith(scratch+path.sep));fs.rmSync(temp,{recursive:true,force:true});
 }
});
