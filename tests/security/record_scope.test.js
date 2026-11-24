const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync,backup}=require('node:sqlite');

// مستخدم مقيّد بمشروع لا يصل إلى سجل مشروع آخر برقمه (عرض/تعديل/حذف/اعتماد/ترحيل/عكس)،
// ولا يتجاوز النطاق حساب اسمه admin ما لم يكن دوره admin.
test('project-scoped users cannot act on another project\'s records by id, and the username admin grants nothing',async()=>{
 const scratch=path.resolve(__dirname,'../../scratch');fs.mkdirSync(scratch,{recursive:true});
 const temp=fs.mkdtempSync(path.join(scratch,'record-scope-'));
 const source=new DatabaseSync(process.env.TEST_SOURCE_DB_PATH,{readOnly:true});let db,server;
 try {
  const filename=path.join(temp,'test.db');await backup(source,filename);source.close();
  process.env.RAWASI_DB_PATH=filename;db=require('../../server/database/db');await db.ready;
  server=require('../../server/server').listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const jwt=require('jsonwebtoken'),secret=require('../../server/middleware/security').JWT_SECRET;
  const base='http://127.0.0.1:'+server.address().port;
  async function api(route,token,method='GET',body){const response=await fetch(base+route,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});let data={};try{data=await response.json();}catch{}return {status:response.status,data};}
  const id=r=>Number(r.lastInsertRowid);
  const A=id(await db.run("INSERT INTO projects(name,status) VALUES ('Scope A','active')"));
  const B=id(await db.run("INSERT INTO projects(name,status) VALUES ('Scope B','active')"));
  const perms=JSON.stringify(['expenses:view','expenses:create','expenses:edit','expenses:cancel','expenses:approve','revenues:view','revenues:edit','revenues:cancel','revenues:approve','purchases:view','purchases:edit','purchases:cancel','purchases:approve','billing:view','billing:edit','billing:cancel','billing:approve','accounting:view','accounting:post','accounting:approve','accounting:create']);
  const hash=require('bcryptjs').hashSync('x-password-1',4);
  const scoped=id(await db.run("INSERT INTO users(username,password_hash,full_name,role,permissions,status,allowed_projects) VALUES ('scope-eng',?,'Scoped','custom',?,'active',?)",[hash,perms,JSON.stringify([A])]));
  // حساب اسمه admin مختلف الحالة لا يمكن إنشاؤه (الاسم فريد)، فنختبر بإعادة تسمية مؤقتة لمستخدم مقيّد
  const token=jwt.sign({id:scoped},secret);
  const rows={};
  for(const p of [['A',A],['B',B]]){
   rows['expenses'+p[0]]=id(await db.run("INSERT INTO expenses(expense_type,amount,date,project_id,status) VALUES ('مواد بناء',100,'2026-11-01',?,'draft')",[p[1]]));
   rows['payments'+p[0]]=id(await db.run("INSERT INTO payments(type,amount,date,project_id,status) VALUES ('صرف',100,'2026-11-01',?,'draft')",[p[1]]));
   rows['purchases'+p[0]]=id(await db.run("INSERT INTO purchases(total_amount,date,project_id,status) VALUES (100,'2026-11-01',?,'draft')",[p[1]]));
   rows['billing'+p[0]]=id(await db.run("INSERT INTO bills(amount,net_amount,date,project_id,status) VALUES (100,100,'2026-11-01',?,'draft')",[p[1]]));
  }
  const tableOf={expenses:'expenses',payments:'payments',purchases:'purchases',billing:'bills'};

  // سجلات المشروع B: كل إجراء بالرقم يُرفض بـ 403، والسجل باقٍ كما هو
  for(const mod of ['expenses','payments','purchases','billing']){
   const other=rows[mod+'B'];
   for(const [method,suffix,body] of [['PUT','',{amount:1}],['DELETE','',null],['POST','/approve',{}],['POST','/post',{}],['POST','/reverse',{reason:'x'}],['POST','/submit-review',{}]]){
    const r=await api('/api/'+mod+'/'+other+suffix,token,method,body);
    assert.equal(r.status,403,`${method} /api/${mod}/${other}${suffix} should be 403, got ${r.status} ${JSON.stringify(r.data).slice(0,160)}`);
    assert.equal(r.data.scopeDenied,true);
   }
   const still=await db.get(`SELECT ${mod==='purchases'?'total_amount':'amount'} AS amount,status FROM ${tableOf[mod]} WHERE id=?`,[other]);
   assert.ok(still,'record in project B still exists: '+mod);assert.equal(Number(still.amount),100);
   // سجل المشروع A لا يُرفض بسبب النطاق (قد يُرفض لسبب آخر، لكن ليس scopeDenied)
   const own=await api('/api/'+mod+'/'+rows[mod+'A'],token,'PUT',{amount:100});
   assert.notEqual(own.data.scopeDenied,true,'own project must not be scope-denied: '+mod);
   // نقل سجل A إلى المشروع B عبر التعديل يُرفض
   const move=await api('/api/'+mod+'/'+rows[mod+'A'],token,'PUT',{amount:100,project_id:B});
   assert.equal(move.status,403,'moving a record into project B must be refused: '+mod);
  }

  // سندات الدفع الموحّدة (payment_transactions) بالرقم
  const pick=async(sql)=>(await db.get(sql))||null;
  const ctx=await pick('SELECT code FROM payment_contexts LIMIT 1'),ins=await pick('SELECT code FROM payment_instruments LIMIT 1'),ch=await pick('SELECT id FROM payment_channels LIMIT 1'),acc=await pick('SELECT id FROM accounts LIMIT 1');
  if(ctx&&ins&&ch&&acc){
   await db.run('PRAGMA foreign_keys=OFF');
   const tx=id(await db.run("INSERT INTO payment_transactions(transaction_no,transaction_date,direction,context_code,instrument_code,channel_id,project_id,debit_account_id,credit_account_id,amount,local_amount,net_amount,status) VALUES ('SCOPE-TX-B','2026-11-01','OUT',?,?,?,?,?,?,100,100,100,'draft')",[ctx.code,ins.code,ch.id,B,acc.id,acc.id]));
   await db.run('PRAGMA foreign_keys=ON');
   const r=await api('/api/payments/transactions/'+tx,token);
   assert.equal(r.status,403,'payment transaction of project B must be 403, got '+r.status);
  }else console.log('record_scope: payment_transactions check skipped (no payment lookup rows in fixture)');

  // اسم المستخدم admin لا يمنح تجاوز النطاق: نعيد تسمية المدير مؤقتاً ونسمّي المقيّد admin
  await db.run("UPDATE users SET username='admin-real-tmp' WHERE username='admin'");
  await db.run("UPDATE users SET username='admin' WHERE id=?",[scoped]);
  const projects=(await api('/api/projects',token)).data.data||[];
  assert.ok(!projects.some(p=>Number(p.id)===B),'a non-admin role named admin must not see project B');
  assert.equal((await api('/api/expenses/'+rows.expensesB,token,'DELETE')).status,403);
  await db.run("UPDATE users SET username='scope-eng' WHERE id=?",[scoped]);
  await db.run("UPDATE users SET username='admin' WHERE username='admin-real-tmp'");

  // المدير العام (الدور) يبقى بلا قيد
  const admin=(await db.get("SELECT id FROM users WHERE username='admin'")).id;
  const adminRes=await api('/api/expenses/'+rows.expensesB,jwt.sign({id:admin},secret),'PUT',{amount:100});
  assert.notEqual(adminRes.data.scopeDenied,true);
 }finally{if(server)await new Promise(resolve=>server.close(resolve));if(db)await db.closeDatabase();try{source.close()}catch{}assert.ok(path.resolve(temp).startsWith(scratch+path.sep));fs.rmSync(temp,{recursive:true,force:true});}
});
