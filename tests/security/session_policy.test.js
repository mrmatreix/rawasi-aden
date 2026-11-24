const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync,backup}=require('node:sqlite');

// سياسة الجلسات: سقف الأجهزة وطرد الأقدم، منع الجلسة الجديدة، جلسة واحدة، قفل الجهاز، مدة التوكن، ساعات العمل بتوقيت الشركة،
// تسجيل الخروج، النبض، وصلاحيات تعديل السياسة.
test('session policy: device limits, overflow actions, device lock, token lifetime, working hours, logout and heartbeat',async()=>{
 const scratch=path.resolve(__dirname,'../../scratch');fs.mkdirSync(scratch,{recursive:true});
 const temp=fs.mkdtempSync(path.join(scratch,'session-policy-'));
 const source=new DatabaseSync(process.env.TEST_SOURCE_DB_PATH,{readOnly:true});let db,server;
 try {
  const filename=path.join(temp,'test.db');await backup(source,filename);source.close();
  process.env.RAWASI_DB_PATH=filename;db=require('../../server/database/db');await db.ready;
  server=require('../../server/server').listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const jwt=require('jsonwebtoken'),secret=require('../../server/middleware/security').JWT_SECRET;
  const {companyClock}=require('../../server/routes/auth');
  const base='http://127.0.0.1:'+server.address().port;
  async function api(route,token,method='GET',body){const response=await fetch(base+route,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});let data={};try{data=await response.json();}catch{}return {status:response.status,data};}
  const hash=require('bcryptjs').hashSync('session-pass-1',4);
  const mk=async(username,settings)=>Number((await db.run("INSERT INTO users(username,password_hash,full_name,role,permissions,status,two_factor_enabled,security_settings) VALUES (?,?,?,'custom','[\"projects:view\"]','active',0,?)",[username,hash,username,settings?JSON.stringify(settings):null])).lastInsertRowid);
  const login=(username,extra={})=>api('/api/auth/login',null,'POST',{username,password:'session-pass-1',...extra});
  const alive=async token=>(await api('/api/projects',token)).status; // 200 = جلسة صالحة، 401 = ملغاة
  const admin=(await db.get("SELECT id FROM users WHERE username='admin'")).id,A=jwt.sign({id:admin},secret);

  // تعديل السياسة العامة للمدير العام فقط، والقيم غير الصالحة تُتجاهل
  const mgr=Number((await db.run("INSERT INTO users(username,password_hash,full_name,role,permissions,status) VALUES ('sp-mgr',?,'m','custom','[\"settings:users\"]','active')",[hash])).lastInsertRowid);
  const M=jwt.sign({id:mgr},secret);
  assert.equal((await api('/api/auth/security-settings',M,'POST',{session_mode:'single'})).status,403);
  assert.equal((await api('/api/users/'+mgr+'/security-settings',M,'POST',{session_mode:'single'})).status,403,'per-user policy is admin-only');
  assert.equal((await api('/api/auth/security-settings',A,'POST',{session_mode:'bogus',jwt_token_expiry:'99y'})).status,200);
  const g=(await api('/api/auth/security-settings',A)).data.settings;assert.equal(g.session_mode,'multi');assert.equal(g.jwt_token_expiry,'8h');

  // 1) سقف جهازين مع طرد الأقدم
  await mk('sp-kick',{session_mode:'multi',session_device_limit:2,session_overflow_action:'kick_oldest'});
  const k1=(await login('sp-kick')).data.token,k2=(await login('sp-kick')).data.token,k3=(await login('sp-kick')).data.token;
  assert.ok(k1&&k2&&k3);
  assert.equal(await alive(k1),401,'oldest session kicked');assert.equal(await alive(k2),200);assert.equal(await alive(k3),200);
  // النبض على جلسة مطرودة يبلّغ بالإنهاء
  const hb=await api('/api/auth/heartbeat',k1,'POST',{});assert.equal(hb.status,401);

  // 2) منع الجلسة الجديدة: الثانية مرفوضة، ولا يتجاوزها force لغير المدير العام
  await mk('sp-block',{session_mode:'multi',session_device_limit:1,session_overflow_action:'block_new'});
  const b1=(await login('sp-block')).data.token;assert.ok(b1);
  const b2=await login('sp-block');assert.equal(b2.status,409);assert.equal(b2.data.limit_exceeded,true);
  assert.equal((await login('sp-block',{force:true})).status,409,'force does not bypass block_new for a non-admin');
  assert.equal(await alive(b1),200);

  // 3) جلسة واحدة: الدخول الثاني يطرد الأول
  await mk('sp-single',{session_mode:'single'});
  const s1=(await login('sp-single')).data.token,s2=(await login('sp-single')).data.token;
  assert.equal(await alive(s1),401);assert.equal(await alive(s2),200);

  // 4) قفل الجهاز: أول جهاز يُعتمد، غيره مرفوض حتى يعيد المدير ضبطه
  const lockId=await mk('sp-lock',{session_overflow_action:'lock_device'});
  assert.equal((await login('sp-lock',{deviceId:'DEV-A',deviceName:'جهاز أ'})).status,200);
  const other=await login('sp-lock',{deviceId:'DEV-B',deviceName:'جهاز ب'});
  assert.equal(other.status,403);assert.equal(other.data.device_locked,true);
  assert.equal((await login('sp-lock',{deviceId:'DEV-B',force:true})).status,403,'force does not unlock the device for a non-admin');
  assert.equal((await login('sp-lock',{deviceId:'DEV-A'})).status,200);
  assert.equal((await api('/api/users/'+lockId+'/reset-device',M,'POST')).status,403,'device reset is admin-only');
  assert.equal((await api('/api/users/'+lockId+'/reset-device',A,'POST')).status,200);
  assert.equal((await login('sp-lock',{deviceId:'DEV-B'})).status,200);

  // 5) مدة التوكن
  await mk('sp-1h',{jwt_token_expiry:'1h'});
  const t1h=jwt.decode((await login('sp-1h')).data.token);assert.equal(t1h.exp-t1h.iat,3600);

  // 6) ساعات العمل بتوقيت الشركة (عدن): خارج الفترة مرفوض، داخلها مقبول، و«custom» تنتهي مع نهاية الفترة
  const {h,m}=companyClock();const now=h*60+m;const fmt=x=>{x=((x%1440)+1440)%1440;return String(Math.floor(x/60)).padStart(2,'0')+':'+String(x%60).padStart(2,'0');};
  await mk('sp-out',{work_hours_enabled:true,work_start_time:fmt(now+120),work_end_time:fmt(now+180)});
  const out=await login('sp-out');assert.equal(out.status,403);assert.equal(out.data.outside_work_hours,true);
  await mk('sp-in',{work_hours_enabled:true,work_start_time:fmt(now-60),work_end_time:fmt(now+60)});
  assert.equal((await login('sp-in')).status,200);
  await mk('sp-custom',{jwt_token_expiry:'custom',work_start_time:fmt(now-60),work_end_time:fmt(now+120)});
  const tc=jwt.decode((await login('sp-custom')).data.token);
  assert.ok(Math.abs((tc.exp-tc.iat)-120*60)<=120,'custom expiry ends with the working day, got '+(tc.exp-tc.iat));
  // التحويل للتوقيت المحلي فعلي: عدن = UTC+3
  const noonUtc=new Date(Date.UTC(2026,0,1,12,0));assert.deepEqual(companyClock(noonUtc),{h:15,m:0});

  // 7) تسجيل الخروج ينهي الجلسة الحالية فقط
  await mk('sp-out2',{session_mode:'multi',session_device_limit:3});
  const o1=(await login('sp-out2')).data.token,o2=(await login('sp-out2')).data.token;
  assert.equal((await api('/api/auth/logout',o1,'POST',{})).status,200);
  assert.equal(await alive(o1),401);assert.equal(await alive(o2),200);
 }finally{if(server)await new Promise(resolve=>server.close(resolve));if(db)await db.closeDatabase();try{source.close()}catch{}assert.ok(path.resolve(temp).startsWith(scratch+path.sep));fs.rmSync(temp,{recursive:true,force:true});}
});
