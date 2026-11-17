const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync,backup}=require('node:sqlite');
test('project setup persists a safe cost tree, links BOQ references, and scopes the in-progress report',async()=>{
 const scratch=path.resolve(__dirname,'../../scratch');fs.mkdirSync(scratch,{recursive:true});const temp=fs.mkdtempSync(path.join(scratch,'project-setup-')),filename=path.join(temp,'test.db');const source=new DatabaseSync(process.env.TEST_SOURCE_DB_PATH,{readOnly:true});let db,server;
 try{
  await backup(source,filename);source.close();process.env.RAWASI_DB_PATH=filename;db=require('../../server/database/db');await db.ready;await db.initializeDatabase();
  server=require('../../server/server').listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const jwt=require('jsonwebtoken'),secret=require('../../server/middleware/security').JWT_SECRET,user=await db.get("SELECT id FROM users WHERE username='admin'");let token=jwt.sign({id:user.id},secret);
  const base='http://127.0.0.1:'+server.address().port;
  const api=async(route,method='GET',body)=>{const response=await fetch(base+route,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};};
  const catalog='/api/project-setup/work-items';assert.equal(Object.keys((await api(catalog)).body.groups).length,3);
  const add=async(code,group,parent_id=null)=>{const result=await api(catalog,'POST',{code,name:'بند '+code,cost_group:group,parent_id,unit:'م3',reference_rate:100});assert.equal(result.status,200,JSON.stringify(result.body));return result.body.id;};
  const root=await add('D','direct'),leaf=await add('D.1','direct',root),indirect=await add('I','indirect'),shared=await add('S','shared');
  assert.equal((await api(catalog,'POST',{code:'D.1',name:'مكرر',cost_group:'direct'})).status,400);
  assert.equal((await api(catalog+'/'+root,'PUT',{code:'D',name:'دورة',cost_group:'direct',parent_id:leaf})).status,400);
  assert.equal((await api(catalog,'POST',{code:'X',name:'غير متوافق',cost_group:'shared',parent_id:root})).status,400);
  assert.equal((await api(catalog+'/'+root,'DELETE')).status,400);
  const project=(await db.run("INSERT INTO projects(code,name,status,estimated_cost,progress_percentage) VALUES ('SETUP-A','قيد التنفيذ','جاري',1000,40)")).lastInsertRowid;
  await db.run("INSERT INTO projects(code,name,status,estimated_cost) VALUES ('SETUP-B','مكتمل','completed',1000)");
  const boq=await api('/api/project-hub/'+project+'/boq','POST',{item_no:'1',description:'خرسانة',unit:'م3',contract_qty:5,unit_rate:100,work_item_id:leaf});assert.equal(boq.status,200,JSON.stringify(boq.body));assert.equal(boq.body.data.work_item_id,leaf);assert.equal(boq.body.data.total_amount,500);
  assert.equal((await api(catalog+'/'+leaf,'DELETE')).status,400);
  assert.equal((await api('/api/project-hub/'+project+'/boq','POST',{item_no:'2',description:'غير صالح',work_item_id:root})).status,400);
  const edit=await api('/api/project-hub/'+project+'/boq/'+boq.body.data.id,'PUT',{contract_qty:6});assert.equal(edit.status,200,JSON.stringify(edit.body));assert.equal((await db.get('SELECT work_item_id FROM project_boq WHERE id=?',[boq.body.data.id])).work_item_id,leaf);
  const cash=(await db.get("SELECT id FROM accounts WHERE code='11101001'")).id,expense=(await db.get("SELECT id FROM accounts WHERE code='31101001'")).id;
  for(const [status,amount]of [['posted',250],['draft',100]]){const entry=(await db.run('INSERT INTO journal_entries(entry_no,date,description,status,total_debit,total_credit) VALUES (?,?,?,?,?,?)',['SETUP-'+status,'2095-01-01','تكلفة',status,amount,amount])).lastInsertRowid;await db.run('INSERT INTO journal_entry_lines(entry_id,account_id,project_id,debit,credit) VALUES (?,?,?,?,0),(?,?,?,0,?)',[entry,expense,project,amount,entry,cash,project,amount]);}
  const report=await api('/api/project-setup/in-progress?as_of_date=2095-01-31');assert.equal(report.status,200,JSON.stringify(report.body));assert.equal(report.body.data.length,1);assert.equal(report.body.data[0].actual_cost,250);assert.equal(report.body.data[0].cost_completion,25);assert.equal(report.body.data[0].recorded_progress,40);
  const completion=await api('/api/project-control/'+project+'/completion');assert.equal(completion.status,200,JSON.stringify(completion.body));assert.ok(Number.isFinite(completion.body.data.recommended_percentage));assert.ok(completion.body.data.sources.boq);
  assert.equal((await api('/api/project-setup/in-progress?as_of_date=2095-02-31')).status,400);
  const restricted=(await db.run("INSERT INTO users(username,password_hash,full_name,role,permissions,allowed_projects,status) VALUES ('setup-limited','unused','محدود','project_manager',?,'[]','active')",[JSON.stringify(['projects:view','reports:view'])])).lastInsertRowid;token=jwt.sign({id:restricted},secret);
  assert.deepEqual((await api('/api/project-setup/in-progress')).body.data,[]);assert.equal((await api(catalog,'POST',{code:'DENIED',name:'مرفوض',cost_group:'direct'})).status,403);
 }finally{if(server)await new Promise(resolve=>server.close(resolve));if(db)await db.closeDatabase();try{source.close();}catch{}assert.ok(path.resolve(temp).startsWith(scratch+path.sep));fs.rmSync(temp,{recursive:true,force:true});}
});
