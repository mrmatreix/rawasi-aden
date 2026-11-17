const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');const os = require('node:os');const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('period journal list includes every entry; approval, posting and period locking retain financial controls', async () => {
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'rawasi-posting-periods-'));
 Object.assign(process.env,{NODE_ENV:'development',DB_ENGINE:'sqlite',RAWASI_DB_PATH:path.join(temp,'fixture.db'),RAWASI_UPLOAD_DIR:path.join(temp,'uploads'),RAWASI_PROJECTS_DIR:path.join(temp,'projects'),RAWASI_BACKUP_DIR:path.join(temp,'backups'),RAWASI_SCRATCH_DIR:path.join(temp,'scratch'),ENABLE_SCHEDULERS:'false'});
 const fixture=spawnSync(process.execPath,['tests/create_fixture.js'],{env:process.env,encoding:'utf8',windowsHide:true});assert.equal(fixture.status,0,fixture.stderr);
 const db=require('../../server/database/db');let server;
 try{
  await db.ready;server=require('../../server/server').listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const password='qa-'+require('node:crypto').randomUUID();const hash=require('bcryptjs').hashSync(password,4);
  const maker=await db.get("SELECT id FROM users WHERE username='admin'");await db.run('UPDATE users SET password_hash=? WHERE id=?',[hash,maker.id]);
  const reviewer=await db.run("INSERT INTO users(username,password_hash,full_name,role,status,two_factor_enabled) VALUES ('qa-reviewer',?,'Reviewer','admin','active',0)",[hash]);
  const jwt=require('jsonwebtoken'),secret=require('../../server/middleware/security').JWT_SECRET;
  const token=jwt.sign({id:maker.id,username:'admin',role:'admin'},secret,{expiresIn:'5m'});
  const reviewToken=jwt.sign({id:Number(reviewer.lastInsertRowid),username:'qa-reviewer',role:'admin'},secret,{expiresIn:'5m'});
  const request=async(route,body,method='POST',auth=token)=>{
   const response=await fetch(`http://127.0.0.1:${server.address().port}/api/accounting/${route}`,{method,headers:{Authorization:'Bearer '+auth,'Content-Type':'application/json'},body:method==='GET'?undefined:JSON.stringify(body)});
   return {status:response.status,body:await response.json()};
  };
  assert.equal((await request('periods',{period_name:'Invalid',start_date:'2099-01-31',end_date:'2099-01-01'})).status,400);
  const period=await request('periods',{period_name:'اختبار الفترة',start_date:'2099-01-01',end_date:'2099-01-31'});assert.equal(period.status,200,JSON.stringify(period));
  const cash=await db.get("SELECT id FROM accounts WHERE code='11101001'");const bank=await db.get("SELECT id FROM accounts WHERE code='11102001'");
  const payload={date:'2099-01-15',description:'اختبار قيود الفترة',status:'draft',lines:[{account_id:cash.id,debit:100,credit:0},{account_id:bank.id,debit:0,credit:100}]};
  const ids=[];for(let index=0;index<105;index++){const entry=await request('journal-entries',{...payload,reference_no:'QA-'+index});assert.equal(entry.status,200,JSON.stringify(entry));ids.push(entry.body.id);}
  const outside=await request('journal-entries',{...payload,date:'2099-02-01'});assert.equal(outside.status,200);
  const route='journal-entries?from_date=2099-01-01&to_date=2099-01-31';
  assert.equal((await request(route,null,'GET')).body.data.length,100);
  const all=await request(route+'&all=true&include_closed=true',null,'GET');assert.equal(all.body.data.length,105);assert(!all.body.data.some(entry=>entry.id===outside.body.id));
  assert.equal((await request('journal-entries/'+ids[0]+'/approve',{})).status,403,'maker cannot approve own journal');
  assert.equal((await request('journal-entries/'+ids[0]+'/approve',{},'POST',reviewToken)).status,200);
  assert.equal((await request('journal-entries/'+ids[0]+'/approve',{},'POST',reviewToken)).status,400);
  assert.equal((await request('journal-entries/'+ids[0]+'/post',{})).status,200);
  assert.equal((await request('journal-entries/'+ids[0]+'/post',{})).status,400);
  await db.run("UPDATE journal_entries SET status='cancelled' WHERE id=?",[ids[1]]);
  assert.equal((await request('journal-entries/'+ids[1]+'/approve',{},'POST',reviewToken)).status,400);
  assert.equal((await request('journal-entries/'+ids[1]+'/post',{})).status,400);
  assert.equal((await request('periods/'+period.body.id+'/close',{manager_password:'wrong'},'PUT')).status,401);
  assert.equal((await request('periods/'+period.body.id+'/close',{manager_password:password,notes:'QA close'},'PUT')).status,200);
  const closedPost=await request('journal-entries/'+ids[2]+'/post',{});assert.equal(closedPost.status,400,JSON.stringify(closedPost));
  assert.equal((await request(route+'&all=true&include_closed=true',null,'GET')).body.data.length,105,'closed period remains readable');
  assert.equal((await request('periods/'+period.body.id+'/reopen',{},'PUT')).status,400);
  assert.equal((await request('periods/'+period.body.id+'/reopen',{reason:'QA reopening'},'PUT')).status,200);
  assert.equal((await request('journal-entries/'+ids[2]+'/post',{})).status,200);
  const audits=await db.query("SELECT DISTINCT action FROM audit_logs WHERE action IN ('APPROVE','POST','CLOSE_PERIOD','REOPEN_PERIOD')");assert.equal(audits.length,4);
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await db.closeDatabase();assert.equal(path.dirname(temp),os.tmpdir());fs.rmSync(temp,{recursive:true,force:true});}
});
