const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync,backup}=require('node:sqlite');

// «نسيت كلمة المرور»: طلب ← اعتماد المدير ← رمز لمرة واحدة ← كلمة جديدة، مع إلغاء الجلسات، والتحقق بخطوتين، وإعادة ضبط الـ PIN.
// (ملف مستقل عن staff_password_reset_hardening حتى لا يتجاوز الملفان معاً المحدد العام 40 طلباً/دقيقة على /api/auth)
test('staff forgot-password: admin-approved one-time code resets the password, revokes sessions and respects 2FA',async()=>{
 const scratch=path.resolve(__dirname,'../../scratch');fs.mkdirSync(scratch,{recursive:true});
 const temp=fs.mkdtempSync(path.join(scratch,'staff-reset-'));
 const source=new DatabaseSync(process.env.TEST_SOURCE_DB_PATH,{readOnly:true});let db,server;
 try {
  const filename=path.join(temp,'test.db');await backup(source,filename);source.close();
  process.env.RAWASI_DB_PATH=filename;db=require('../../server/database/db');await db.ready;
  server=require('../../server/server').listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const {resetRateLimits}=require('../../server/routes/staff_password_reset');
  const jwt=require('jsonwebtoken'),secret=require('../../server/middleware/security').JWT_SECRET;
  const base='http://127.0.0.1:'+server.address().port;
  async function api(route,token,method='GET',body){const response=await fetch(base+route,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()};}
  const bcrypt=require('bcryptjs');const hash=bcrypt.hashSync('old-password-1',4);
  const plain=Number((await db.run("INSERT INTO users(username,password_hash,full_name,role,permissions,status,two_factor_enabled) VALUES ('rp-plain',?,'Reset Plain','custom','[]','active',0)",[hash])).lastInsertRowid);
  const tfa=Number((await db.run("INSERT INTO users(username,password_hash,full_name,role,permissions,status,two_factor_enabled,two_factor_pin) VALUES ('rp-tfa',?,'Reset Tfa','custom','[]','active',1,'482913')",[hash])).lastInsertRowid);
  const admin=(await db.get("SELECT id FROM users WHERE username='admin'")).id,adminToken=jwt.sign({id:admin},secret);
  const noPerm=jwt.sign({id:plain},secret);

  assert.ok((await db.get("SELECT id FROM schema_migrations WHERE id='0007_staff_password_resets'")),'migration 0007 applied');

  // الطلب
  const req1=await api('/api/auth/password-reset/request',null,'POST',{username:'rp-plain',note:'هاتفي 777'});
  assert.equal(req1.status,202);assert.match(req1.data.ref,/^R-[A-Z2-9]{6}$/);
  const row1=await db.get('SELECT * FROM staff_password_resets WHERE user_id=?',[plain]);
  assert.equal(row1.status,'pending');assert.equal(row1.public_ref,req1.data.ref);assert.equal(row1.requester_note,'هاتفي 777');

  // مسارات المدير محمية بالصلاحية، والقائمة لا تكشف hash
  assert.equal((await api('/api/staff-password-resets',noPerm)).status,403);
  const list=await api('/api/staff-password-resets',adminToken);
  assert.equal(list.status,200);const listed=list.data.data.find(r=>r.user_id===plain);
  assert.ok(listed);assert.equal(listed.code_hash,undefined);
  assert.equal((await api('/api/staff-password-resets/count',adminToken)).data.pending>=1,true);

  // قبل الاعتماد لا يعمل أي رمز
  assert.equal((await api('/api/auth/password-reset/complete',null,'POST',{username:'rp-plain',code:'AAAAA-BBBBB',new_password:'brand-new-pass-9',new_password_confirm:'brand-new-pass-9'})).status,400);

  // الاعتماد يعيد الرمز مرة واحدة ويخزّنه مُجزّأً
  const appr=await api('/api/staff-password-resets/'+row1.id+'/approve',adminToken,'POST',{reset_pin:false});
  assert.equal(appr.status,200);assert.match(appr.data.code,/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  const stored=await db.get('SELECT code_hash,status FROM staff_password_resets WHERE id=?',[row1.id]);
  assert.equal(stored.status,'approved');assert.ok(stored.code_hash.startsWith('$2'));assert.ok(!stored.code_hash.includes(appr.data.code.replace('-','')));

  // جلستان مفتوحتان قبل الإعادة
  const s1='sess-a-'+Date.now(),s2='sess-b-'+Date.now();
  await db.run('UPDATE users SET active_sessions=?,session_token=?,is_logged_in=1 WHERE id=?',[JSON.stringify([{sessionId:s1,lastHeartbeatMs:Date.now()},{sessionId:s2,lastHeartbeatMs:Date.now()}]),s2,plain]);
  const t1=jwt.sign({id:plain,sessionId:s1},secret),t2=jwt.sign({id:plain,sessionId:s2},secret);
  assert.notEqual((await api('/api/users/scopes-meta',t1)).status,401);assert.notEqual((await api('/api/users/scopes-meta',t2)).status,401);

  // سياسة كلمة المرور قبل استهلاك الرمز
  const code=appr.data.code;
  const policy=async(p,c)=>(await api('/api/auth/password-reset/complete',null,'POST',{username:'rp-plain',code,new_password:p,new_password_confirm:c??p})).status;
  assert.equal(await policy('short1'),400);assert.equal(await policy('rp-plain'),400);assert.equal(await policy('brand-new-pass-9','different-pass-9'),400);
  // رمز خاطئ يزيد العداد؛ الأرقام العربية والأحرف الصغيرة والشرطات تُطبَّع
  assert.equal((await api('/api/auth/password-reset/complete',null,'POST',{username:'rp-plain',code:'ZZZZZ-ZZZZZ',new_password:'brand-new-pass-9',new_password_confirm:'brand-new-pass-9'})).status,400);
  assert.equal(Number((await db.get('SELECT attempts FROM staff_password_resets WHERE id=?',[row1.id])).attempts),1);
  // لا يُقبل رمز مستخدم لحساب آخر
  assert.equal((await api('/api/auth/password-reset/complete',null,'POST',{username:'rp-tfa',code,new_password:'brand-new-pass-9',new_password_confirm:'brand-new-pass-9'})).status,400);

  await db.run("UPDATE users SET failed_login_count=3, login_locked_until=? WHERE id=?",[new Date(Date.now()+600000).toISOString(),plain]);
  const done=await api('/api/auth/password-reset/complete',null,'POST',{username:'RP-PLAIN',code:' '+code.toLowerCase()+' ',new_password:'brand-new-pass-9',new_password_confirm:'brand-new-pass-9'});
  assert.equal(done.status,200,JSON.stringify(done.data));
  const after=await db.get('SELECT password_hash,active_sessions,session_token,login_locked_until,failed_login_count,password_changed_at FROM users WHERE id=?',[plain]);
  assert.ok(bcrypt.compareSync('brand-new-pass-9',after.password_hash));assert.equal(after.active_sessions,'[]');assert.equal(after.session_token,null);
  assert.equal(after.login_locked_until,null);assert.equal(Number(after.failed_login_count),0);assert.ok(after.password_changed_at);
  assert.equal((await api('/api/users/scopes-meta',t1)).status,401);assert.equal((await api('/api/users/scopes-meta',t2)).status,401);
  assert.equal((await db.get('SELECT status FROM staff_password_resets WHERE id=?',[row1.id])).status,'used');
  // الرمز لمرة واحدة
  assert.equal((await api('/api/auth/password-reset/complete',null,'POST',{username:'rp-plain',code,new_password:'another-pass-77',new_password_confirm:'another-pass-77'})).status,400);
  // الدخول بالكلمة الجديدة ينجح وبالقديمة يفشل
  assert.equal((await api('/api/auth/login',null,'POST',{username:'rp-plain',password:'old-password-1'})).status,401);
  assert.equal((await api('/api/auth/login',null,'POST',{username:'rp-plain',password:'brand-new-pass-9'})).status,200);

  // حساب بتحقق بخطوتين: الـ PIN الحالي مطلوب ما لم يطلب المدير ضبطه
  resetRateLimits();
  await api('/api/auth/password-reset/request',null,'POST',{username:'rp-tfa'});
  const rowT=await db.get("SELECT id FROM staff_password_resets WHERE user_id=? AND status='pending'",[tfa]);
  const codeT=(await api('/api/staff-password-resets/'+rowT.id+'/approve',adminToken,'POST',{})).data.code;
  const noPin=await api('/api/auth/password-reset/complete',null,'POST',{username:'rp-tfa',code:codeT,new_password:'tfa-new-pass-1',new_password_confirm:'tfa-new-pass-1'});
  assert.equal(noPin.status,401);assert.equal(noPin.data.requiresCurrentPin,true);
  assert.equal(Number((await db.get('SELECT failed_login_count FROM users WHERE id=?',[tfa])).failed_login_count),1);
  const withPin=await api('/api/auth/password-reset/complete',null,'POST',{username:'rp-tfa',code:codeT,current_pin:'٤٨٢٩١٣',new_password:'tfa-new-pass-1',new_password_confirm:'tfa-new-pass-1'});
  assert.equal(withPin.status,200,JSON.stringify(withPin.data));
  assert.equal((await db.get('SELECT two_factor_pin FROM users WHERE id=?',[tfa])).two_factor_pin,'482913');

  // إعادة ضبط الـ PIN بطلب المدير
  await api('/api/auth/password-reset/request',null,'POST',{username:'rp-tfa'});
  const rowP=await db.get("SELECT id FROM staff_password_resets WHERE user_id=? AND status='pending'",[tfa]);
  const codeP=(await api('/api/staff-password-resets/'+rowP.id+'/approve',adminToken,'POST',{reset_pin:true})).data.code;
  const needPin=await api('/api/auth/password-reset/complete',null,'POST',{username:'rp-tfa',code:codeP,new_password:'tfa-new-pass-2',new_password_confirm:'tfa-new-pass-2'});
  assert.equal(needPin.status,400);assert.equal(needPin.data.requiresNewPin,true);
  assert.equal((await api('/api/auth/password-reset/complete',null,'POST',{username:'rp-tfa',code:codeP,new_pin:'123456',new_password:'tfa-new-pass-2',new_password_confirm:'tfa-new-pass-2'})).status,400);
  assert.equal((await api('/api/auth/password-reset/complete',null,'POST',{username:'rp-tfa',code:codeP,new_pin:'583920',new_password:'tfa-new-pass-1',new_password_confirm:'tfa-new-pass-1'})).status,400,'same password as current is refused');
  const pinDone=await api('/api/auth/password-reset/complete',null,'POST',{username:'rp-tfa',code:codeP,new_pin:'583920',new_password:'tfa-new-pass-2',new_password_confirm:'tfa-new-pass-2'});
  assert.equal(pinDone.status,200,JSON.stringify(pinDone.data));
  const temp1=(await api('/api/auth/login',null,'POST',{username:'rp-tfa',password:'tfa-new-pass-2'})).data.tempToken;assert.ok(temp1);
  assert.equal((await api('/api/auth/verify-2fa',null,'POST',{tempToken:temp1,code:'583920'})).status,200);

  // إنهاء الجلسة من شاشة المستخدمين صار فعلياً (active_sessions تُفرَّغ أيضاً)
  const s3='sess-c-'+Date.now();
  await db.run('UPDATE users SET active_sessions=?,session_token=NULL WHERE id=?',[JSON.stringify([{sessionId:s3,lastHeartbeatMs:Date.now()}]),plain]);
  const t3=jwt.sign({id:plain,sessionId:s3},secret);
  assert.notEqual((await api('/api/users/scopes-meta',t3)).status,401);
  assert.equal((await api('/api/users/'+plain+'/disconnect',adminToken,'POST')).status,200);
  assert.equal((await api('/api/users/scopes-meta',t3)).status,401);

  // تغيير المدير لكلمة المرور ينهي جلسات الحساب
  const s4='sess-d-'+Date.now();
  await db.run('UPDATE users SET active_sessions=?,session_token=? WHERE id=?',[JSON.stringify([{sessionId:s4,lastHeartbeatMs:Date.now()}]),s4,plain]);
  const t4=jwt.sign({id:plain,sessionId:s4},secret);
  assert.equal((await api('/api/users/'+plain,adminToken,'PUT',{full_name:'Reset Plain',role:'custom',password:'admin-set-pass-1',password_confirm:'admin-set-pass-1'})).status,200);
  assert.equal((await api('/api/users/scopes-meta',t4)).status,401);

  // سجل التدقيق كامل ولا يحمل رمزاً ولا كلمة مرور ولا PIN
  const actions=(await db.query("SELECT action FROM audit_logs WHERE action LIKE 'PASSWORD_RESET_%'")).map(r=>r.action);
  for(const a of ['PASSWORD_RESET_REQUESTED','PASSWORD_RESET_APPROVED','PASSWORD_RESET_CODE_FAILED','PASSWORD_RESET_COMPLETED'])assert.ok(actions.includes(a),'missing audit '+a);
  const secrets=[code,code.replace('-',''),codeT.replace('-',''),codeP.replace('-',''),'brand-new-pass-9','tfa-new-pass-2','583920','482913'];
  for(const s of secrets){const n=await db.get('SELECT COUNT(*) AS n FROM audit_logs WHERE details LIKE ? OR reason LIKE ?',['%'+s+'%','%'+s+'%']);assert.equal(Number(n.n),0,'secret leaked into audit: '+s);}
 }finally{if(server)await new Promise(resolve=>server.close(resolve));if(db)await db.closeDatabase();try{source.close()}catch{}assert.ok(path.resolve(temp).startsWith(scratch+path.sep));fs.rmSync(temp,{recursive:true,force:true});}
});
