const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync,backup}=require('node:sqlite');

// الترحيل 0008: كل مستخدم يرى بعد الترقية ما كان يراه قبلها بالضبط
test('migration 0008 backfills scope grants without widening or narrowing anyone',()=>{
 const {MIGRATIONS,runMigrations}=require('../../server/database/migrations');
 const m=MIGRATIONS.find(x=>x.id==='0008_user_scope_grants');assert.ok(m);
 const db=new DatabaseSync(':memory:');
 db.exec("CREATE TABLE projects(id INTEGER PRIMARY KEY, name TEXT, branch_id INTEGER, department_id INTEGER); INSERT INTO projects(id,name) VALUES (1,'a'),(2,'b');");
 db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY, role TEXT, allowed_projects TEXT, allowed_branches TEXT, allowed_departments TEXT)");
 const rows=[[1,'admin','[1]'],[2,'custom','*'],[3,'custom',''],[4,'custom',null],[5,'custom','[]'],[6,'custom','[1,99]'],[7,'custom','{bad'],[8,'custom','1,2'],[9,'custom','all']];
 for(const r of rows)db.prepare('INSERT INTO users(id,role,allowed_projects) VALUES (?,?,?)').run(...r);
 runMigrations(db,[m]);
 const mode=id=>db.prepare('SELECT scope_mode FROM users WHERE id=?').get(id).scope_mode;
 const grants=id=>db.prepare('SELECT scope_type||char(58)||scope_id AS g FROM user_scope_grants WHERE user_id=? ORDER BY g').all(id).map(r=>r.g);
 for(const id of [1,2,3,4,9])assert.equal(mode(id),'all','user '+id+' had full access before');
 // قيمة تالفة كانت تعني: لا مشاريع، لكن السجلات بلا مشروع ظاهرة
 assert.equal(mode(7),'limited');assert.deepEqual(grants(7),['general:0']);
 assert.equal(mode(5),'limited');assert.deepEqual(grants(5),[],'[] saw nothing before');
 assert.equal(mode(6),'limited');assert.deepEqual(grants(6),['general:0','project:1'],'unknown project 99 dropped, general kept');
 assert.deepEqual(grants(8),['general:0','project:1','project:2']);
 runMigrations(db,[m]);assert.deepEqual(grants(6),['general:0','project:1'],'idempotent');
 db.close();
});

test('scope grants: branches/departments include future projects, general records, empty scope, no escalation, audited',async()=>{
 const scratch=path.resolve(__dirname,'../../scratch');fs.mkdirSync(scratch,{recursive:true});
 const temp=fs.mkdtempSync(path.join(scratch,'user-scope-'));
 const source=new DatabaseSync(process.env.TEST_SOURCE_DB_PATH,{readOnly:true});let db,server;
 try {
  const filename=path.join(temp,'test.db');await backup(source,filename);source.close();
  process.env.RAWASI_DB_PATH=filename;db=require('../../server/database/db');await db.ready;
  server=require('../../server/server').listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const jwt=require('jsonwebtoken'),secret=require('../../server/middleware/security').JWT_SECRET;
  const base='http://127.0.0.1:'+server.address().port;
  async function api(route,token,method='GET',body){const response=await fetch(base+route,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});let data={};try{data=await response.json();}catch{}return {status:response.status,data};}
  const id=r=>Number(r.lastInsertRowid);
  const admin=(await db.get("SELECT id FROM users WHERE username='admin'")).id,adminToken=jwt.sign({id:admin},secret);
  const B1=id(await db.run("INSERT INTO branches(code,name,status) VALUES ('SC-B1','فرع اختبار 1','active')"));
  const B2=id(await db.run("INSERT INTO branches(code,name,status) VALUES ('SC-B2','فرع اختبار 2','active')"));
  const D1=id(await db.run("INSERT INTO departments(code,name,status) VALUES ('SC-D1','قسم اختبار 1','active')"));
  const D2=id(await db.run("INSERT INTO departments(code,name,status) VALUES ('SC-D2','قسم اختبار 2','active')"));
  const proj=async(name,b,d)=>id(await db.run("INSERT INTO projects(name,status,branch_id,department_id) VALUES (?,'active',?,?)",[name,b,d]));
  const P11=await proj('P-B1-D1',B1,D1),P12=await proj('P-B1-D2',B1,D2),P21=await proj('P-B2-D1',B2,D1),P22=await proj('P-B2-D2',B2,D2);
  const perms=JSON.stringify(['projects:view','projects:create','expenses:view','expenses:edit','purchases:view']);
  const hash=require('bcryptjs').hashSync('x-password-1',4);
  const eng=id(await db.run("INSERT INTO users(username,password_hash,full_name,role,permissions,status) VALUES ('sc-eng',?,'Eng','custom',?,'active')",[hash,perms]));
  const token=jwt.sign({id:eng},secret);
  const visible=async()=>(await api('/api/projects',token)).data.data.map(p=>Number(p.id)).filter(x=>[P11,P12,P21,P22].includes(x)).sort((a,b)=>a-b);
  const setScope=async(body,who=adminToken)=>api('/api/users/'+eng+'/scope',who,'PUT',body);

  // فرع واحد: مشاريعه فقط، والمشروع الجديد في الفرع يدخل تلقائياً
  assert.equal((await setScope({mode:'limited',branches:[B1]})).status,200);
  assert.deepEqual(await visible(),[P11,P12].sort((a,b)=>a-b));
  const P13=await proj('P-B1-new',B1,D2);
  assert.ok((await api('/api/projects',token)).data.data.some(p=>Number(p.id)===P13),'new project in a granted branch is visible at once');
  // قسم واحد (عبر الفروع)
  await setScope({mode:'limited',departments:[D1]});
  assert.deepEqual(await visible(),[P11,P21].sort((a,b)=>a-b));
  // اتحاد: فرع + مشروع من فرع آخر
  await setScope({mode:'limited',branches:[B2],projects:[P11]});
  assert.deepEqual(await visible(),[P11,P21,P22].sort((a,b)=>a-b));
  // المعاينة تطابق
  const prev=await api('/api/users/scope-preview',adminToken,'POST',{mode:'limited',branches:[B2],projects:[P11]});
  assert.equal(prev.status,200);assert.equal(prev.data.data.project_count,3);
  assert.deepEqual(prev.data.data.projects.map(p=>p.via).sort(),['branch','branch','project']);

  // السجلات العامة: مخفية بلا منح general، ظاهرة معه (قائمة + بالرقم)
  const gen=id(await db.run("INSERT INTO expenses(expense_type,amount,date,project_id,status) VALUES ('مصروفات إدارية',50,'2026-11-01',NULL,'draft')"));
  const listExp=async()=>((await api('/api/expenses',token)).data.data||[]).map(e=>Number(e.id));
  await setScope({mode:'limited',projects:[P11]});
  assert.ok(!(await listExp()).includes(gen),'general expense hidden without the general grant');
  assert.equal((await api('/api/expenses/'+gen,token,'PUT',{amount:50})).status,403);
  await setScope({mode:'limited',projects:[P11],general:true});
  assert.ok((await listExp()).includes(gen),'general expense visible with the general grant');
  assert.notEqual((await api('/api/expenses/'+gen,token,'PUT',{amount:50})).data.scopeDenied,true);

  // النطاق الفارغ: يُرفض بلا تأكيد، ومع التأكيد لا يرى شيئاً (ولا تفتح المشتريات كل شيء كما كان)
  const empty=await setScope({mode:'limited'});
  assert.equal(empty.status,400);assert.equal(empty.data.emptyScope,true);
  const pu=id(await db.run("INSERT INTO purchases(total_amount,date,project_id,status) VALUES (10,'2026-11-01',?,'draft')",[P22]));
  assert.equal((await setScope({mode:'limited',allow_empty:true})).status,200);
  assert.deepEqual(await visible(),[]);
  assert.ok(!((await api('/api/purchases',token)).data.data||[]).some(r=>Number(r.id)===pu),'empty scope must not fall open in purchases');

  // عدم التصعيد: مدير مستخدمين مقيّد بفرع B1 لا يمنح الكل ولا B2، ويمنح B1
  const mgr=id(await db.run("INSERT INTO users(username,password_hash,full_name,role,permissions,status) VALUES ('sc-mgr',?,'Mgr','custom','[\"settings:users\",\"projects:view\"]','active')",[hash]));
  assert.equal((await api('/api/users/'+mgr+'/scope',adminToken,'PUT',{mode:'limited',branches:[B1]})).status,200);
  const mgrToken=jwt.sign({id:mgr},secret);
  assert.equal((await setScope({mode:'all'},mgrToken)).status,403);
  assert.equal((await setScope({mode:'limited',branches:[B2]},mgrToken)).status,403);
  assert.equal((await setScope({mode:'limited',projects:[P21]},mgrToken)).status,403);
  assert.equal((await setScope({mode:'limited',general:true},mgrToken)).status,403);
  assert.equal((await setScope({mode:'limited',branches:[B1]},mgrToken)).status,200);
  // ولا عبر تعديل المستخدم بالحقل القديم allowed_projects
  assert.equal((await api('/api/users/'+eng,mgrToken,'PUT',{full_name:'Eng',role:'custom',allowed_projects:'*'})).status,403);

  // المشروع الذي ينشئه مستخدم مقيّد خارج منحه يُمنح له صراحةً
  await setScope({mode:'limited',branches:[B1]});
  const created=await api('/api/projects',token,'POST',{name:'P-created-B2',code:'SC-NEW-1',branch_id:B2,department_id:D2,status:'active'});
  assert.ok([200,201].includes(created.status),'project create: '+created.status+' '+JSON.stringify(created.data).slice(0,200));
  const newId=Number((await db.get("SELECT id FROM projects WHERE name='P-created-B2' ORDER BY id DESC LIMIT 1")).id);
  assert.ok((await api('/api/projects',token)).data.data.some(p=>Number(p.id)===newId),'creator sees the project they created');
  assert.ok(await db.get("SELECT 1 FROM user_scope_grants WHERE user_id=? AND scope_type='project' AND scope_id=?",[eng,newId]));

  // الحقل القديم من الإدارة: مصفوفة = مشاريع محددة + عام؛ '*' = كل المؤسسة
  assert.equal((await api('/api/users/'+eng,adminToken,'PUT',{full_name:'Eng',role:'custom',allowed_projects:[P22]})).status,200);
  const desc=(await api('/api/users/'+eng+'/scope',adminToken)).data.data;
  assert.equal(desc.mode,'limited');assert.deepEqual(desc.projects,[P22]);assert.equal(desc.general,true);
  assert.equal((await api('/api/users/'+eng,adminToken,'PUT',{full_name:'Eng',role:'custom',allowed_projects:'*'})).status,200);
  assert.equal((await api('/api/users/'+eng+'/scope',adminToken)).data.data.mode,'all');

  // مراجع غير موجودة تُرفض، وكل تغيير مسجَّل في التدقيق
  assert.equal((await setScope({mode:'limited',branches:[999999]})).status,400);
  const audits=Number((await db.get("SELECT COUNT(*) AS n FROM audit_logs WHERE action='USER_SCOPE_CHANGE' AND entity_id=?",[String(eng)])).n);
  assert.ok(audits>=8,'scope changes are audited, got '+audits);
  // قائمة المستخدمين تحمل ملخص النطاق
  const listed=(await api('/api/users',adminToken)).data.data.find(u=>u.id===eng);
  assert.equal(listed.scope.mode,'all');
 }finally{if(server)await new Promise(resolve=>server.close(resolve));if(db)await db.closeDatabase();try{source.close()}catch{}assert.ok(path.resolve(temp).startsWith(scratch+path.sep));fs.rmSync(temp,{recursive:true,force:true});}
});
