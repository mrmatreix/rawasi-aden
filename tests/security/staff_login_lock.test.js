const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync,backup}=require('node:sqlite');

// قفل حساب الموظف المحفوظ في القاعدة (كلمة المرور + رمز 2FA + فك قفل الشاشة)، وسجل التدقيق، وسياسة CSP، وعدم إرجاع رمز PIN.
test('staff accounts lock after repeated password or 2FA failures, are audited, and never return the PIN',async()=>{
 const scratch=path.resolve(__dirname,'../../scratch');fs.mkdirSync(scratch,{recursive:true});
 const temp=fs.mkdtempSync(path.join(scratch,'staff-lock-'));
 const source=new DatabaseSync(process.env.TEST_SOURCE_DB_PATH,{readOnly:true});let db,server;
 try {
  const filename=path.join(temp,'test.db');await backup(source,filename);source.close();
  process.env.RAWASI_DB_PATH=filename;db=require('../../server/database/db');await db.ready;
  server=require('../../server/server').listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const jwt=require('jsonwebtoken'),secret=require('../../server/middleware/security').JWT_SECRET;
  const base='http://127.0.0.1:'+server.address().port;
  async function api(route,token,method='GET',body){const response=await fetch(base+route,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json(),headers:response.headers};}
  const hash=require('bcryptjs').hashSync('correct-password-1',4);
  const plain=(await db.run("INSERT INTO users(username,password_hash,full_name,role,permissions,status,two_factor_enabled) VALUES ('lock-plain',?,'Plain','custom','[]','active',0)",[hash])).lastInsertRowid;
  const tfa=(await db.run("INSERT INTO users(username,password_hash,full_name,role,permissions,status,two_factor_enabled,two_factor_pin) VALUES ('lock-tfa',?,'Tfa','custom','[]','active',1,'482913')",[hash])).lastInsertRowid;
  const admin=(await db.get("SELECT id FROM users WHERE username='admin'")).id,adminToken=jwt.sign({id:admin},secret);

  // CSP مفعّلة على كل الاستجابات
  const health=await api('/api/health');
  assert.match(health.headers.get('content-security-policy')||'',/frame-ancestors 'none'/);
  assert.match(health.headers.get('content-security-policy')||'',/object-src 'none'/);

  // 5 محاولات خاطئة تقفل الحساب، وكلمة المرور الصحيحة لا تفتحه
  for(let i=1;i<=4;i++){const r=await api('/api/auth/login',null,'POST',{username:'lock-plain',password:'wrong-'+i});assert.equal(r.status,401);assert.equal(r.data.remainingAttempts,5-i);}
  const fifth=await api('/api/auth/login',null,'POST',{username:'lock-plain',password:'wrong-5'});
  assert.equal(fifth.status,429);assert.equal(fifth.data.accountLocked,true);
  assert.equal((await api('/api/auth/login',null,'POST',{username:'lock-plain',password:'correct-password-1'})).status,429);
  assert.ok((await db.get('SELECT login_locked_until FROM users WHERE id=?',[plain])).login_locked_until);
  // فك قفل الشاشة لا يتجاوز القفل
  assert.equal((await api('/api/auth/unlock',null,'POST',{username:'lock-plain',password:'correct-password-1'})).status,429);

  // القائمة تُظهر القفل، والمدير يفكه، ثم ينجح الدخول
  const listed=(await api('/api/users',adminToken)).data.data.find(u=>u.id===Number(plain));
  assert.equal(listed.login_locked,true);assert.equal(listed.login_locked_until,undefined);
  assert.equal((await api('/api/users/'+plain+'/unlock-login',adminToken,'POST')).status,200);
  const ok=await api('/api/auth/login',null,'POST',{username:'lock-plain',password:'correct-password-1'});
  assert.equal(ok.status,200);assert.ok(ok.data.token);
  assert.equal(Number((await db.get('SELECT failed_login_count FROM users WHERE id=?',[plain])).failed_login_count),0);

  // رمز 2FA: المحاولات الخاطئة تقفل الحساب، وإعادة الدخول بكلمة المرور لا تصفّر العداد
  let temp1=(await api('/api/auth/login',null,'POST',{username:'lock-tfa',password:'correct-password-1'})).data.tempToken;assert.ok(temp1);
  for(let i=0;i<3;i++)assert.equal((await api('/api/auth/verify-2fa',null,'POST',{tempToken:temp1,code:'00000'+i})).status,401);
  const temp2=(await api('/api/auth/login',null,'POST',{username:'lock-tfa',password:'correct-password-1'})).data.tempToken;
  assert.equal((await api('/api/auth/verify-2fa',null,'POST',{tempToken:temp2,code:'000009'})).status,401);
  assert.equal((await api('/api/auth/verify-2fa',null,'POST',{tempToken:temp2,code:'000008'})).status,429);
  assert.equal((await api('/api/auth/verify-2fa',null,'POST',{tempToken:temp2,code:'482913'})).status,429);

  // مسار فك القفل لا يكشف وجود اسم المستخدم
  const unknown=await api('/api/auth/unlock',null,'POST',{username:'no-such-user-x',password:'whatever-1'});
  const wrong=await api('/api/users/'+tfa+'/unlock-login',adminToken,'POST');assert.equal(wrong.status,200);
  const known=await api('/api/auth/unlock',null,'POST',{username:'lock-tfa',password:'whatever-1'});
  assert.equal(unknown.status,401);assert.equal(known.status,401);
  assert.ok(!/غير موجود/.test(unknown.data.message));

  // تعديل المستخدم لا يعيد رمز PIN، ويُسجَّل في التدقيق
  const edited=await api('/api/users/'+tfa,adminToken,'PUT',{full_name:'Tfa',role:'custom',status:'inactive'});
  assert.equal(edited.status,200);assert.equal(edited.data.data.two_factor_pin,'');assert.equal(edited.data.data.two_factor_configured,true);
  const actions=(await db.query("SELECT action FROM audit_logs WHERE entity_type IN ('auth','user')")).map(r=>r.action);
  for(const a of ['LOGIN_FAILED','ACCOUNT_LOCKED','LOGIN_SUCCESS','ACCOUNT_UNLOCKED','USER_SECURITY_CHANGE'])assert.ok(actions.includes(a),'missing audit '+a);
  const leaked=await db.get("SELECT COUNT(*) AS n FROM audit_logs WHERE details LIKE '%482913%' OR details LIKE '%correct-password-1%'");
  assert.equal(Number(leaked.n),0);
 }finally{if(server)await new Promise(resolve=>server.close(resolve));if(db)await db.closeDatabase();try{source.close()}catch{}assert.ok(path.resolve(temp).startsWith(scratch+path.sep));fs.rmSync(temp,{recursive:true,force:true});}
});
