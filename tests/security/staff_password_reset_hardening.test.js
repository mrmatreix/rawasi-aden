const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync,backup}=require('node:sqlite');

// «نسيت كلمة المرور»: عدم كشف أسماء المستخدمين، حدود المحاولات، انتهاء الصلاحية، وفصل الأدوار في الاعتماد.
test('staff forgot-password does not enumerate accounts, limits attempts, expires codes and blocks self-approval',async()=>{
 const scratch=path.resolve(__dirname,'../../scratch');fs.mkdirSync(scratch,{recursive:true});
 const temp=fs.mkdtempSync(path.join(scratch,'staff-reset-h-'));
 const source=new DatabaseSync(process.env.TEST_SOURCE_DB_PATH,{readOnly:true});let db,server;
 try {
  const filename=path.join(temp,'test.db');await backup(source,filename);source.close();
  process.env.RAWASI_DB_PATH=filename;db=require('../../server/database/db');await db.ready;
  server=require('../../server/server').listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const {resetRateLimits}=require('../../server/routes/staff_password_reset');
  const jwt=require('jsonwebtoken'),secret=require('../../server/middleware/security').JWT_SECRET;
  const base='http://127.0.0.1:'+server.address().port;
  async function api(route,token,method='GET',body){const response=await fetch(base+route,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()};}
  const hash=require('bcryptjs').hashSync('old-password-1',4);
  const live=Number((await db.run("INSERT INTO users(username,password_hash,full_name,role,permissions,status,two_factor_enabled) VALUES ('rh-live',?,'Live','custom','[]','active',0)",[hash])).lastInsertRowid);
  await db.run("INSERT INTO users(username,password_hash,full_name,role,permissions,status,two_factor_enabled) VALUES ('rh-off',?,'Off','custom','[]','inactive',0)",[hash]);
  const admin=(await db.get("SELECT id FROM users WHERE username='admin'")).id,adminToken=jwt.sign({id:admin},secret);
  const count=async()=>Number((await db.get('SELECT COUNT(*) AS n FROM staff_password_resets')).n);
  const before=await count();

  // نفس الحالة ونفس شكل الرد لاسم موجود أو غير موجود أو معطّل
  const shape=r=>[r.status,Object.keys(r.data).sort().join(','),r.data.message,/^R-[A-Z2-9]{6}$/.test(r.data.ref)];
  const a=await api('/api/auth/password-reset/request',null,'POST',{username:'rh-live'});
  const b=await api('/api/auth/password-reset/request',null,'POST',{username:'no-such-user-zz'});
  const c=await api('/api/auth/password-reset/request',null,'POST',{username:'rh-off'});
  assert.deepEqual(shape(a),shape(b));assert.deepEqual(shape(a),shape(c));assert.equal(a.status,202);
  assert.equal(await count(),before+1,'only the active account creates a row');
  // التكرار يعيد المرجع نفسه في الحالتين، فلا يميّز التكرار الحساب الحقيقي
  resetRateLimits();
  assert.equal((await api('/api/auth/password-reset/request',null,'POST',{username:'rh-live'})).data.ref,a.data.ref);
  assert.equal((await api('/api/auth/password-reset/request',null,'POST',{username:'no-such-user-zz'})).data.ref,b.data.ref);
  assert.equal(await count(),before+1,'duplicate request does not add a row');
  // حد الطلبات لكل IP
  assert.equal((await api('/api/auth/password-reset/request',null,'POST',{username:'rh-x1'})).status,202);
  const limited=await api('/api/auth/password-reset/request',null,'POST',{username:'rh-x2'});
  assert.equal(limited.status,429);assert.equal(limited.data.rateLimited,true);
  resetRateLimits();

  // 5 رموز خاطئة تُبطل الطلب، والرمز الصحيح بعدها مرفوض
  const row=await db.get("SELECT id FROM staff_password_resets WHERE user_id=? AND status='pending'",[live]);
  const code=(await api('/api/staff-password-resets/'+row.id+'/approve',adminToken,'POST',{})).data.code;assert.ok(code);
  for(let i=0;i<5;i++)assert.equal((await api('/api/auth/password-reset/complete',null,'POST',{username:'rh-live',code:'WRONG'+i+'CODE',new_password:'brand-new-pass-9',new_password_confirm:'brand-new-pass-9'})).status,400);
  assert.equal((await db.get('SELECT status FROM staff_password_resets WHERE id=?',[row.id])).status,'expired');
  assert.equal((await api('/api/auth/password-reset/complete',null,'POST',{username:'rh-live',code,new_password:'brand-new-pass-9',new_password_confirm:'brand-new-pass-9'})).status,400);

  // انتهاء صلاحية الرمز المعتمد
  await api('/api/auth/password-reset/request',null,'POST',{username:'rh-live'});
  const row2=await db.get("SELECT id FROM staff_password_resets WHERE user_id=? AND status='pending'",[live]);
  const code2=(await api('/api/staff-password-resets/'+row2.id+'/approve',adminToken,'POST',{})).data.code;
  await db.run('UPDATE staff_password_resets SET code_expires_at=? WHERE id=?',[new Date(Date.now()-1000).toISOString(),row2.id]);
  assert.equal((await api('/api/auth/password-reset/complete',null,'POST',{username:'rh-live',code:code2,new_password:'brand-new-pass-9',new_password_confirm:'brand-new-pass-9'})).status,400);
  assert.equal((await db.get('SELECT status FROM staff_password_resets WHERE id=?',[row2.id])).status,'expired');
  assert.ok(require('bcryptjs').compareSync('old-password-1',(await db.get('SELECT password_hash FROM users WHERE id=?',[live])).password_hash));

  // الرفض والإلغاء
  await api('/api/auth/password-reset/request',null,'POST',{username:'rh-live'});
  const row3=await db.get("SELECT id FROM staff_password_resets WHERE user_id=? AND status='pending'",[live]);
  assert.equal((await api('/api/staff-password-resets/'+row3.id+'/revoke',adminToken,'POST',{})).status,409,'cannot revoke a pending request');
  assert.equal((await api('/api/staff-password-resets/'+row3.id+'/reject',adminToken,'POST',{reason:'لم يتم التحقق من الهوية'})).status,200);
  assert.equal((await db.get('SELECT status FROM staff_password_resets WHERE id=?',[row3.id])).status,'rejected');
  assert.equal((await api('/api/staff-password-resets/'+row3.id+'/approve',adminToken,'POST',{})).status,409);

  // لا يعتمد المدير طلبه بنفسه، ومستخدم غير مدير لا يعتمد طلب مدير
  resetRateLimits();
  await api('/api/auth/password-reset/request',null,'POST',{username:'admin'});
  const own=await db.get("SELECT id FROM staff_password_resets WHERE user_id=? AND status='pending'",[admin]);assert.ok(own);
  assert.equal((await api('/api/staff-password-resets/'+own.id+'/approve',adminToken,'POST',{})).status,403);
  const manager=Number((await db.run("INSERT INTO users(username,password_hash,full_name,role,permissions,status) VALUES ('rh-manager',?,'Manager','custom','[\"settings:users\"]','active')",[hash])).lastInsertRowid);
  assert.equal((await api('/api/staff-password-resets/'+own.id+'/approve',jwt.sign({id:manager},secret),'POST',{})).status,403);
  assert.equal((await db.get('SELECT status FROM staff_password_resets WHERE id=?',[own.id])).status,'pending');

  // لا يوجد استثناء CSRF لمسارات المدير
  const csrf=await fetch(base+'/api/staff-password-resets/'+own.id+'/reject',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  assert.ok([401,403].includes(csrf.status));
 }finally{if(server)await new Promise(resolve=>server.close(resolve));if(db)await db.closeDatabase();try{source.close()}catch{}assert.ok(path.resolve(temp).startsWith(scratch+path.sep));fs.rmSync(temp,{recursive:true,force:true});}
});
