const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync,backup}=require('node:sqlite');

// الفروع والأقسام: المدير العام وحده يديرها؛ لا حذف لوحدة مستخدمة (رسالة مفصّلة)؛ مع الحركات المالية يُعدَّل الاسم فقط.
test('branches and departments: admin-only management, in-use units cannot be deleted, financial activity locks all but the name',async()=>{
 const scratch=path.resolve(__dirname,'../../scratch');fs.mkdirSync(scratch,{recursive:true});
 const temp=fs.mkdtempSync(path.join(scratch,'org-units-'));
 const source=new DatabaseSync(process.env.TEST_SOURCE_DB_PATH,{readOnly:true});let db,server;
 try {
  const filename=path.join(temp,'test.db');await backup(source,filename);source.close();
  process.env.RAWASI_DB_PATH=filename;db=require('../../server/database/db');await db.ready;
  server=require('../../server/server').listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const jwt=require('jsonwebtoken'),secret=require('../../server/middleware/security').JWT_SECRET;
  const base='http://127.0.0.1:'+server.address().port;
  async function api(route,token,method='GET',body){const response=await fetch(base+route,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});let data={};try{data=await response.json();}catch{}return {status:response.status,data};}
  const admin=(await db.get("SELECT id FROM users WHERE username='admin'")).id,A=jwt.sign({id:admin},secret);
  const hash=require('bcryptjs').hashSync('x-password-1',4);
  const mgr=Number((await db.run("INSERT INTO users(username,password_hash,full_name,role,permissions,status,branch_id) VALUES ('org-mgr',?,'Mgr','custom','[\"settings:users\"]','active',1)",[hash])).lastInsertRowid);
  const M=jwt.sign({id:mgr},secret);

  // غير المدير العام ممنوع حتى لو ملك إدارة المستخدمين
  for(const [m,u,b] of [['GET','/api/org/branches'],['POST','/api/org/branches',{code:'X1',name:'x'}],['PUT','/api/org/branches/1',{name:'x'}],['DELETE','/api/org/branches/1'],['POST','/api/org/departments',{code:'X1',name:'x'}]])
   assert.equal((await api(u,M,m,b)).status,403,m+' '+u);

  // إضافة، ورفض التكرار، وتعديل كامل ثم حذف ما دام غير مستخدم
  const add=await api('/api/org/branches',A,'POST',{code:'tst-a',name:'فرع اختبار',address:'عدن'});
  assert.equal(add.status,200);const B=Number(add.data.data.id);assert.equal(add.data.data.code,'TST-A');
  assert.equal((await api('/api/org/branches',A,'POST',{code:'TST-A',name:'آخر'})).status,409);
  assert.equal((await api('/api/org/branches',A,'POST',{code:'TST-B',name:'فرع اختبار'})).status,409);
  assert.equal((await api('/api/org/branches/'+B,A,'PUT',{code:'TST-A2',name:'فرع اختبار',address:'المكلا',status:'inactive'})).status,200);
  const tmp=Number((await api('/api/org/branches',A,'POST',{code:'TST-DEL',name:'فرع للحذف'})).data.data.id);
  assert.equal((await api('/api/org/branches/'+tmp,A,'DELETE')).status,200);
  assert.equal(await db.get('SELECT id FROM branches WHERE id=?',[tmp]),null);

  // فرع عليه مشروع بلا حركة مالية: لا يُحذف (رسالة تذكر المشروع)، لكن تعديل الرمز مسموح
  await api('/api/org/branches/'+B,A,'PUT',{status:'active'});
  const P=Number((await db.run("INSERT INTO projects(name,status,branch_id,department_id) VALUES ('مشروع فرع الاختبار','active',?,1)",[B])).lastInsertRowid);
  const del1=await api('/api/org/branches/'+B,A,'DELETE');
  assert.equal(del1.status,409);assert.equal(del1.data.inUse,true);assert.match(del1.data.message,/قيد العمل/);assert.match(del1.data.message,/مشروع فرع الاختبار/);
  assert.equal((await api('/api/org/branches/'+B,A,'PUT',{code:'TST-A3'})).status,200);

  // مع حركة مالية: الحذف ممنوع برسالة تذكر الحركات، ولا يُعدَّل إلا الاسم
  await db.run("INSERT INTO expenses(expense_type,amount,date,project_id,status) VALUES ('مواد بناء',100,'2026-11-01',?,'draft')",[P]);
  const del2=await api('/api/org/branches/'+B,A,'DELETE');
  assert.equal(del2.status,409);assert.match(del2.data.message,/حركة مالية/);assert.match(del2.data.message,/تعديل اسم الفرع فقط/);
  for(const body of [{code:'TST-A4'},{address:'تعز'},{status:'inactive'}]){const r=await api('/api/org/branches/'+B,A,'PUT',body);assert.equal(r.status,409,JSON.stringify(body));}
  const user=Number((await db.run("INSERT INTO users(username,password_hash,full_name,role,permissions,status,branch_id,branch) VALUES ('org-u',?,'U','custom','[]','active',?,'old')",[hash,B])).lastInsertRowid);
  assert.equal((await api('/api/org/branches/'+B,A,'PUT',{name:'فرع الاختبار المعدّل'})).status,200);
  assert.equal((await db.get('SELECT name,code FROM branches WHERE id=?',[B])).code,'TST-A3');
  assert.equal((await db.get('SELECT branch FROM users WHERE id=?',[user])).branch,'فرع الاختبار المعدّل','user branch text follows the rename');
  const listed=(await api('/api/org/branches',A)).data.data.find(r=>Number(r.id)===B);
  assert.ok(listed.usage.financialCount>=1);assert.equal(listed.usage.projects,1);

  // الأقسام بنفس القواعد
  const D=Number((await api('/api/org/departments',A,'POST',{code:'TST-D',name:'قسم اختبار',manager_name:'م. علي'})).data.data.id);
  await db.run('UPDATE projects SET department_id=? WHERE id=?',[D,P]);
  assert.equal((await api('/api/org/departments/'+D,A,'DELETE')).status,409);
  assert.equal((await api('/api/org/departments/'+D,A,'PUT',{code:'TST-D2'})).status,409);
  assert.equal((await api('/api/org/departments/'+D,A,'PUT',{name:'قسم اختبار 2'})).status,200);

  // الفرع الأساسي لمستخدم: المدير العام وحده يغيّره، والاسم النصي يتبعه
  assert.equal((await api('/api/users/'+user,M,'PUT',{full_name:'U',role:'custom',branch_id:1})).status,403);
  assert.equal((await api('/api/users/'+user,A,'PUT',{full_name:'U',role:'custom',branch_id:B,department_id:D})).status,200);
  const u=await db.get('SELECT branch,department FROM users WHERE id=?',[user]);
  assert.equal(u.branch,'فرع الاختبار المعدّل');assert.equal(u.department,'قسم اختبار 2');
  assert.equal((await api('/api/users/'+user,A,'PUT',{full_name:'U',role:'custom',branch_id:999999})).status,400);

  const actions=(await db.query("SELECT action FROM audit_logs WHERE action LIKE 'ORG_UNIT_%'")).map(r=>r.action);
  for(const a of ['ORG_UNIT_CREATED','ORG_UNIT_UPDATED','ORG_UNIT_DELETED'])assert.ok(actions.includes(a),'audit '+a);
 }finally{if(server)await new Promise(resolve=>server.close(resolve));if(db)await db.closeDatabase();try{source.close()}catch{}assert.ok(path.resolve(temp).startsWith(scratch+path.sep));fs.rmSync(temp,{recursive:true,force:true});}
});
