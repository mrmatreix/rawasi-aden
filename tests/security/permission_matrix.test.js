const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync,backup}=require('node:sqlite');
const catalog=require('../../js/system-catalog');

const root=path.resolve(__dirname,'../..');
// مفاتيح قديمة مقبولة كبديل في الخادم (يُفحص معها مفتاح الكتالوج دائماً)، ومفاتيح بوابة العملاء (جدول آخر)
const LEGACY_ALIASES=new Set(['accounting:delete','suppliers:delete']);
const CLIENT_PORTAL=/^can_/;

test('every permission the server checks exists in the single catalog, and every template uses catalog keys only',()=>{
 const keys=new Set(catalog.permissionKeys);
 const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
 const unknown=[];
 for(const f of walk(path.join(root,'server')).filter(f=>f.endsWith('.js'))){
  const src=fs.readFileSync(f,'utf8');
  for(const m of src.matchAll(/(?:requirePermission|hasUserPermission)\(\s*(?:[a-zA-Z_.?]+\s*,\s*)?['"`]([^'"`$]+)['"`]/g))
   for(const k of m[1].split(',').map(s=>s.trim()).filter(Boolean)){
    if(keys.has(k)||LEGACY_ALIASES.has(k)||CLIENT_PORTAL.test(k)||k.endsWith(':'))continue; // k.endsWith(':') = prefix + dynamic action (client_app:'+action)
    unknown.push(path.relative(root,f)+': '+k);
   }
 }
 assert.deepEqual(unknown,[],'server checks permissions missing from js/system-catalog.js');
 for(const [role,t] of Object.entries(catalog.roles))for(const p of t.permissions)assert.ok(p==='*'||keys.has(p),role+' template uses unknown key '+p);
 // كل وحدة: عمليات من السبع فقط، وبلا تكرار
 const seven=new Set(catalog.actions.map(a=>a.id));
 for(const m of catalog.modules){assert.ok(m.actions.length);for(const a of m.actions)assert.ok(seven.has(a),m.key+':'+a);}
 assert.equal(catalog.actions.length,7);
 // الواجهة تولّد المصفوفة من الكتالوج (لا مربعات ثابتة للوحدات)
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 assert.match(html,/id="permMatrixGrid"/);
 assert.ok(!/value="accounting:view"[^>]*perm-chk|perm-chk[^>]*value="accounting:view"/.test(html),'module permissions are generated, not static');
});

test('legacy permission formats found in production expand to equivalent matrix keys instead of being lost',()=>{
 const x=list=>catalog.expandLegacy(list).sort();
 assert.deepEqual(x(['accounting:journal']),['accounting:create','accounting:edit']);
 assert.deepEqual(x(['projects:manage']),['projects:create','projects:edit','projects:view']);
 assert.deepEqual(x(['revenues:print']),['revenues:export']);
 assert.deepEqual(x(['clients:statement']),['clients:export','clients:view']);
 assert.deepEqual(x(['inventory:manage']),['inventory:create','inventory:issue','inventory:view']);
 assert.deepEqual(x(['all']),['*']);
 assert.ok(x(['accounting']).includes('accounting:post')&&x(['accounting']).includes('accounting:close_period'),'bare module = whole module');
 assert.deepEqual(x(['custody:edit','nonsense']),[],'keys with no server meaning are dropped');
 assert.deepEqual(x(['expenses:view','expenses:view']),['expenses:view']);
});

test('migration 0009 keeps existing accountants exactly as capable as before the implicit rule was removed',()=>{
 const {MIGRATIONS,runMigrations}=require('../../server/database/migrations');
 const m=MIGRATIONS.find(x=>x.id==='0009_preserve_accountant_implicit_permissions');assert.ok(m);
 const {DatabaseSync:DB}=require('node:sqlite');const db=new DB(':memory:');
 db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY, role TEXT, permissions TEXT)');
 const prodLike=JSON.stringify(['dashboard:view','accounting:view','accounting:journal','expenses:approve','hr:view','custody:edit']);
 db.prepare('INSERT INTO users VALUES (1,?,?)').run('accountant',prodLike);
 db.prepare('INSERT INTO users VALUES (2,?,?)').run('accountant','');
 db.prepare('INSERT INTO users VALUES (3,?,?)').run('auditor','["accounting:view"]');
 db.prepare('INSERT INTO users VALUES (4,?,?)').run('accountant','["*"]');
 runMigrations(db,[m]);
 const perms=id=>JSON.parse(db.prepare('SELECT permissions FROM users WHERE id=?').get(id).permissions);
 const a=perms(1);
 for(const k of ['projects:view','accounting:post','accounting:close_period','billing:post','expenses:cancel','cash:export','suppliers:cancel'])assert.ok(a.includes(k),'kept implicit '+k);
 for(const k of ['dashboard:view','hr:view','accounting:create','accounting:edit'])assert.ok(a.includes(k),'kept stored/legacy '+k);
 assert.ok(!a.includes('custody:edit')&&!a.includes('accounting:journal'),'only matrix keys stored');
 assert.ok(!a.some(k=>k.startsWith('hr:')&&k!=='hr:view'),'no new non-financial powers');
 assert.ok(perms(2).includes('hr:payroll')&&perms(2).includes('accounting:post'),'empty accountant keeps old template + implicit');
 assert.deepEqual(perms(3),['accounting:view'],'other roles untouched');
 assert.deepEqual(perms(4),['*']);
 const keys=new Set(catalog.permissionKeys);assert.ok(a.every(k=>keys.has(k)));
 db.close();
});

test('every print function is mapped to an export permission (printing = export)',()=>{
 const auth=fs.readFileSync(path.join(root,'js','auth.js'),'utf8');
 const start=auth.indexOf('PRINT_PERMISSIONS: {');assert.ok(start>0,'PRINT_PERMISSIONS map exists');
 const block=auth.slice(start+'PRINT_PERMISSIONS: {'.length,auth.indexOf('guardPrintFunctions()',start));
 const mapped={};
 for(const m of block.matchAll(/(\w+): \{([\s\S]*?)\}/g))mapped[m[1]]=Object.fromEntries([...m[2].matchAll(/(print\w+): ('([^']*)'|null)/g)].map(x=>[x[1],x[3]??null]));
 const files={Accounting:'accounting.js',HR:'hr.js',ProjectCloseout:'project_closeout.js',ProjectHub:'project_hub.js',Projects:'projects.js',Reports:'reports.js',Settings:'settings.js'};
 const keys=new Set(catalog.permissionKeys);
 for(const [obj,file] of Object.entries(files)){
  const src=fs.readFileSync(path.join(root,'js',file),'utf8');
  for(const m of src.matchAll(/^\s{2}(?:async\s+)?(print\w*)\s*\(/gm)){
   assert.ok(mapped[obj]&&m[1] in mapped[obj],`${obj}.${m[1]} (js/${file}) is not in Auth.PRINT_PERMISSIONS`);
   const perm=mapped[obj][m[1]];
   if(perm)for(const k of perm.split(','))assert.ok(keys.has(k)&&k.endsWith(':export'),`${obj}.${m[1]} maps to unknown/non-export key ${k}`);
  }
 }
 // كل الوحدات تُلفّ عند تحميلها
 const app=fs.readFileSync(path.join(root,'js','app.js'),'utf8');
 assert.ok((app.match(/Auth\.guardPrintFunctions\(\)/g)||[]).length>=2,'guard runs on module load and on view load');
});

test('role templates apply on the server; the accountant creates but cannot approve or post; nobody below the admin can escalate',async()=>{
 const scratch=path.resolve(__dirname,'../../scratch');fs.mkdirSync(scratch,{recursive:true});
 const temp=fs.mkdtempSync(path.join(scratch,'perm-matrix-'));
 const source=new DatabaseSync(process.env.TEST_SOURCE_DB_PATH,{readOnly:true});let db,server;
 try {
  const filename=path.join(temp,'test.db');await backup(source,filename);source.close();
  process.env.RAWASI_DB_PATH=filename;db=require('../../server/database/db');await db.ready;
  server=require('../../server/server').listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const jwt=require('jsonwebtoken'),secret=require('../../server/middleware/security').JWT_SECRET;
  const base='http://127.0.0.1:'+server.address().port;
  async function api(route,token,method='GET',body){const response=await fetch(base+route,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});let data={};try{data=await response.json();}catch{}return {status:response.status,data};}
  const id=r=>Number(r.lastInsertRowid);
  const hash=require('bcryptjs').hashSync('x-password-1',4);
  const mk=async(username,role,perms)=>id(await db.run('INSERT INTO users(username,password_hash,full_name,role,permissions,status,two_factor_enabled) VALUES (?,?,?,?,?,?,0)',[username,hash,username,role,perms,'active']));
  const admin=(await db.get("SELECT id FROM users WHERE username='admin'")).id,A=jwt.sign({id:admin},secret);

  // المحاسب بلا صلاحيات محفوظة: قالب الدور من الكتالوج، بلا اعتماد ولا ترحيل (كان يُمنح كل المالية ضمنياً)
  const acc=await mk('pm-acc','accountant',''),ACC=jwt.sign({id:acc},secret);
  const exp=id(await db.run("INSERT INTO expenses(expense_type,amount,date,status) VALUES ('مصروفات إدارية',10,'2026-11-01','pending')"));
  assert.equal((await api('/api/expenses',ACC)).status,200);
  const ap=await api('/api/expenses/'+exp+'/approve',ACC,'POST',{});
  assert.equal(ap.status,403);assert.equal(ap.data.permissionDenied,true);
  assert.equal((await api('/api/expenses/'+exp+'/post',ACC,'POST',{})).data.permissionDenied,true);
  // المراجع يعتمد (القالب يمنحه expenses:approve) — الرفض إن حدث ليس لسبب الصلاحية
  const aud=await mk('pm-aud','auditor',''),AUD=jwt.sign({id:aud},secret);
  assert.notEqual((await api('/api/expenses/'+exp+'/approve',AUD,'POST',{})).data.permissionDenied,true);
  // أمين المخزن لا يصل للمحاسبة
  const sk=await mk('pm-sk','storekeeper',''),SK=jwt.sign({id:sk},secret);
  assert.equal((await api('/api/expenses',SK)).status,403);

  // مسؤول المستخدمين (settings:users) لا يصعّد
  const um=await mk('pm-users','users_administrator','["settings:users","expenses:view"]'),UM=jwt.sign({id:um},secret);
  const base_user={password:'new-pass-123',password_confirm:'new-pass-123',two_factor_enabled:false};
  assert.equal((await api('/api/users',UM,'POST',{...base_user,username:'pm-x1',full_name:'x',role:'admin'})).status,403,'cannot create an admin');
  assert.equal((await api('/api/users',UM,'POST',{...base_user,username:'pm-x2',full_name:'x',role:'custom',permissions:['*']})).status,403,'cannot grant *');
  assert.equal((await api('/api/users',UM,'POST',{...base_user,username:'pm-x3',full_name:'x',role:'custom',permissions:['accounting:post']})).status,403,'cannot grant what it lacks');
  assert.equal((await api('/api/users',UM,'POST',{...base_user,username:'pm-x4',full_name:'x',role:'auditor'})).status,403,'cannot pick a role whose template it lacks');
  const ok=await api('/api/users',UM,'POST',{...base_user,username:'pm-x5',full_name:'x',role:'custom',permissions:['expenses:view','not:a_key']});
  assert.equal(ok.status,200,JSON.stringify(ok.data));
  assert.deepEqual(JSON.parse((await db.get("SELECT permissions FROM users WHERE username='pm-x5'")).permissions),['expenses:view'],'unknown keys dropped');
  // صيغة قديمة تُحفظ بمقابلها في المصفوفة (المدير العام يحفظ مستخدماً قديماً دون أن يخسر صلاحية)
  const legacy=await api('/api/users',A,'POST',{...base_user,username:'pm-legacy',full_name:'x',role:'custom',permissions:['accounting:journal','projects:manage']});
  assert.equal(legacy.status,200);
  assert.deepEqual(JSON.parse((await db.get("SELECT permissions FROM users WHERE username='pm-legacy'")).permissions).sort(),['accounting:create','accounting:edit','projects:create','projects:edit','projects:view']);
  const x5=Number(ok.data.data.id);
  assert.equal((await api('/api/users/'+x5,UM,'PUT',{full_name:'x',role:'custom',permissions:['expenses:view','accounting:post']})).status,403);
  // حساب بدور المدير العام: لا تعديل ولا تعطيل ولا حذف ولا فصل من غير المدير العام
  const otherAdmin=await mk('pm-admin2','admin','["*"]');
  assert.equal((await api('/api/users/'+otherAdmin,UM,'PUT',{full_name:'hacked',role:'admin'})).status,403);
  assert.equal((await api('/api/users/'+otherAdmin+'/status',UM,'PATCH',{status:'inactive'})).status,403);
  assert.equal((await api('/api/users/'+otherAdmin,UM,'DELETE')).status,403);
  assert.equal((await api('/api/users/'+otherAdmin+'/disconnect',UM,'POST')).status,403);
  assert.equal((await db.get('SELECT full_name,status FROM users WHERE id=?',[otherAdmin])).status,'active');
  // المدير العام يفعل ذلك
  assert.equal((await api('/api/users',A,'POST',{...base_user,username:'pm-x6',full_name:'x',role:'custom',permissions:['*']})).status,200);
  // صلاحية الإلغاء الجديدة تعمل بدل :delete القديمة
  const sup=id(await db.run("INSERT INTO suppliers(name) VALUES ('مورد اختبار مصفوفة')"));
  const canceller=await mk('pm-sup','custom','["suppliers:view","suppliers:cancel"]');
  assert.notEqual((await api('/api/suppliers/'+sup,jwt.sign({id:canceller},secret),'DELETE')).data.permissionDenied,true);
 }finally{if(server)await new Promise(resolve=>server.close(resolve));if(db)await db.closeDatabase();try{source.close()}catch{}assert.ok(path.resolve(temp).startsWith(scratch+path.sep));fs.rmSync(temp,{recursive:true,force:true});}
});
