const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync,backup}=require('node:sqlite');

// البحث الشامل (Ctrl+K): يوحّد الكتابة العربية ويحترم صلاحيات كل شاشة ونطاق المشاريع والطلبات
test('global search normalizes Arabic and only returns what each user may see',async()=>{
 const scratch=path.resolve(__dirname,'../../scratch');fs.mkdirSync(scratch,{recursive:true});
 const temp=fs.mkdtempSync(path.join(scratch,'global-search-'));
 const source=new DatabaseSync(process.env.TEST_SOURCE_DB_PATH,{readOnly:true});let db,server;
 try {
  const filename=path.join(temp,'test.db');await backup(source,filename);source.close();
  process.env.RAWASI_DB_PATH=filename;db=require('../../server/database/db');await db.ready;
  server=require('../../server/server').listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const jwt=require('jsonwebtoken'),secret=require('../../server/middleware/security').JWT_SECRET;
  const url='http://127.0.0.1:'+server.address().port;
  const search=async(actor,q)=>{const r=await fetch(url+'/api/search?q='+encodeURIComponent(q),{headers:{Authorization:'Bearer '+jwt.sign({id:actor},secret)}});return {status:r.status,data:await r.json()};};
  const types=r=>r.data.results.map(x=>x.type+':'+x.title);

  const client=(await db.run("INSERT INTO clients(name,phone) VALUES ('مؤسسة الإعمار الحديثة','777000111')")).lastInsertRowid;
  const p1=(await db.run("INSERT INTO projects(code,name,client_id) VALUES ('PRJ-SRCH-1','فيلا الإعمار بالمنصورة',?)",[client])).lastInsertRowid;
  const p2=(await db.run("INSERT INTO projects(code,name,client_id) VALUES ('PRJ-SRCH-2','عمارة الإعمار بكريتر',?)",[client])).lastInsertRowid;
  await db.run("INSERT INTO suppliers(name,company_name,phone) VALUES ('مورد الإعمار للحديد','مورد الإعمار للحديد','733000222')");
  const admin=(await db.get("SELECT id FROM users WHERE username='admin'")).id;
  const staff=async(name,permissions,allowed='*')=>(await db.run("INSERT INTO users(username,password_hash,full_name,role,permissions,allowed_projects,status) VALUES (?,'unused',?,'custom',?,?,'active')",[name,name,JSON.stringify(permissions),allowed])).lastInsertRowid;
  const scoped=await staff('search-scoped',['projects:view'],JSON.stringify([Number(p1)]));
  const nobody=await staff('search-nobody',['hr:view']);
  const supervisor=await staff('search-supervisor',['client_app:requests_view','client_app:requests_edit','client_app:requests_review','client_app:supervisor']);
  const mine=(await db.run("INSERT INTO service_requests(request_no,source,client_name,phone,status,assigned_to) VALUES ('SR-SRCH-1','guest','زائر الإعمار','700000009','new',?)",[supervisor])).lastInsertRowid;
  await db.run("INSERT INTO service_requests(request_no,source,client_name,phone,status) VALUES ('SR-SRCH-2','guest','زائر الإعمار آخر','700000010','new')");

  // المدير: كل الأنواع، والبحث بدون همزات/تاء مربوطة يطابق
  const all=await search(admin,'موسسه الاعمار');
  assert.equal(all.status,200);
  assert.ok(types(all).includes('client:مؤسسة الإعمار الحديثة'),JSON.stringify(types(all)));
  const wide=types(await search(admin,'الاعمار'));
  for(const t of ['project:فيلا الإعمار بالمنصورة','project:عمارة الإعمار بكريتر','supplier:مورد الإعمار للحديد','request:SR-SRCH-1 — زائر الإعمار'])assert.ok(wide.includes(t),t+' missing: '+JSON.stringify(wide));
  assert.ok(types(await search(admin,'PRJ-SRCH-2')).includes('project:عمارة الإعمار بكريتر'));
  assert.ok(types(await search(admin,'٧٧٧٠٠٠١١١')).includes('client:مؤسسة الإعمار الحديثة'),'arabic digits should match phone');

  // نطاق المشاريع: يرى المشروع المسموح فقط، ولا عملاء ولا موردين ولا طلبات
  const scopedTypes=types(await search(scoped,'الاعمار'));
  assert.deepEqual(scopedTypes,['project:فيلا الإعمار بالمنصورة']);

  // بلا صلاحيات ذات صلة: لا شيء
  assert.deepEqual((await search(nobody,'الاعمار')).data.results,[]);

  // المشرف المقيّد: الطلب المسند إليه فقط
  const supTypes=types(await search(supervisor,'SR-SRCH'));
  assert.deepEqual(supTypes,['request:SR-SRCH-1 — زائر الإعمار']);
  assert.equal((await search(supervisor,'SR-SRCH')).data.results[0].id,Number(mine));

  // كلمة قصيرة جداً أو بدون تسجيل دخول
  assert.deepEqual((await search(admin,'ا')).data.results,[]);
  assert.equal((await fetch(url+'/api/search?q=test')).status,401);
 }finally{if(server)await new Promise(resolve=>server.close(resolve));if(db)await db.closeDatabase();try{source.close()}catch{}assert.ok(path.resolve(temp).startsWith(scratch+path.sep));fs.rmSync(temp,{recursive:true,force:true});}
});
