const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync,backup}=require('node:sqlite');

// جلسة الموظف في المتصفح تُحمل في كوكي HttpOnly (لا تقرؤه سكربتات الصفحة)، وتطبيق الجوال يبقى على Bearer.
test('browser staff session lives in an HttpOnly cookie with CSRF protection; mobile keeps bearer tokens',async()=>{
 const scratch=path.resolve(__dirname,'../../scratch');fs.mkdirSync(scratch,{recursive:true});
 const temp=fs.mkdtempSync(path.join(scratch,'staff-cookie-'));
 const source=new DatabaseSync(process.env.TEST_SOURCE_DB_PATH,{readOnly:true});let db,server;
 try {
  const filename=path.join(temp,'test.db');await backup(source,filename);source.close();
  process.env.RAWASI_DB_PATH=filename;db=require('../../server/database/db');await db.ready;
  server=require('../../server/server').listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  async function api(route,{method='GET',headers={},body}={}){const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});let data={};try{data=await response.json();}catch{}return {status:response.status,data,headers:response.headers};}
  const hash=require('bcryptjs').hashSync('cookie-pass-1',4);
  await db.run("INSERT INTO users(username,password_hash,full_name,role,permissions,status,two_factor_enabled) VALUES ('cookie-user',?,'Cookie','admin','[\"*\"]','active',0)",[hash]);
  const creds={username:'cookie-user',password:'cookie-pass-1',force:true};

  // دخول المتصفح: لا توكن في الاستجابة، والكوكي HttpOnly + SameSite=Strict
  const web=await api('/api/auth/login',{method:'POST',headers:{'X-Auth-Mode':'cookie'},body:creds});
  assert.equal(web.status,200);assert.equal(web.data.cookieSession,true);assert.equal(web.data.token,undefined);assert.ok(web.data.tokenExpiresAt);
  const setCookie=web.headers.get('set-cookie')||'';
  assert.match(setCookie,/rawasi_token=[\w-]+\.[\w-]+\.[\w-]+/);
  assert.match(setCookie,/HttpOnly/i);assert.match(setCookie,/SameSite=Strict/i);assert.match(setCookie,/Path=\//);
  const cookie=setCookie.split(';')[0];

  // الكوكي وحده يكفي، ووسم المتصفح غير السري في Authorization يُتجاهل لصالح الكوكي
  assert.equal((await api('/api/auth/me',{headers:{Cookie:cookie}})).status,200);
  assert.equal((await api('/api/auth/me',{headers:{Cookie:cookie,Authorization:'Bearer cookie-session'}})).status,200);
  assert.equal((await api('/api/auth/me',{headers:{Authorization:'Bearer cookie-session'}})).status,401);

  // CSRF: طلب كتابة بالكوكي دون X-Requested-With يُرفض، ومعه يُقبل
  const noHeader=await api('/api/auth/heartbeat',{method:'POST',headers:{Cookie:cookie}});
  assert.equal(noHeader.status,403);assert.equal(noHeader.data.csrfError,true);
  assert.equal((await api('/api/auth/heartbeat',{method:'POST',headers:{Cookie:cookie,'X-Requested-With':'XMLHttpRequest'}})).status,200);

  // تطبيق الجوال: يستلم التوكن ويستخدمه في الترويسة كالسابق
  const mobile=await api('/api/auth/login',{method:'POST',body:creds});
  assert.equal(mobile.status,200);assert.match(mobile.data.token||'',/^[\w-]+\.[\w-]+\.[\w-]+$/);
  assert.equal((await api('/api/auth/me',{headers:{Authorization:'Bearer '+mobile.data.token}})).status,200);
  assert.equal((await api('/api/auth/heartbeat',{method:'POST',headers:{Authorization:'Bearer '+mobile.data.token}})).status,200);

  // توكن الجلسة في الرابط مرفوض (يتسرب للسجلات وسجل المتصفح)
  assert.equal((await api('/api/auth/me?token='+encodeURIComponent(mobile.data.token))).status,401);

  // ترحيل جلسة قديمة محفوظة في التخزين إلى كوكي
  const adopted=await api('/api/auth/session-cookie',{method:'POST',headers:{Authorization:'Bearer '+mobile.data.token}});
  assert.equal(adopted.status,200);assert.match(adopted.headers.get('set-cookie')||'',/rawasi_token=.*HttpOnly/i);

  // الخروج يمسح الكوكي وينهي الجلسة في الخادم
  const out=await api('/api/auth/logout',{method:'POST',headers:{Cookie:cookie,'X-Requested-With':'XMLHttpRequest'}});
  assert.equal(out.status,200);
  assert.match(out.headers.get('set-cookie')||'',/rawasi_token=;.*Expires=Thu, 01 Jan 1970/i);
  assert.equal((await api('/api/auth/me',{headers:{Cookie:cookie}})).status,401);
 }finally{if(server)await new Promise(resolve=>server.close(resolve));if(db)await db.closeDatabase();try{source.close()}catch{}assert.ok(path.resolve(temp).startsWith(scratch+path.sep));fs.rmSync(temp,{recursive:true,force:true});}
});
