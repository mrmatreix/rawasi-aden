const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync,backup}=require('node:sqlite');
test('party numbering, edits, statuses and attachments on an isolated database',async()=>{
 const root=path.resolve(__dirname,'../..');const scratch=path.join(root,'scratch');fs.mkdirSync(scratch,{recursive:true});
 const temp=fs.mkdtempSync(path.join(scratch,'party-registry-'));const dbPath=path.join(temp,'test.db');
 const source=new DatabaseSync(process.env.TEST_SOURCE_DB_PATH || path.join(root,'server/database/rawasi_aden.db'),{readOnly:true});let db,server;
 try{
  await backup(source,dbPath);source.close();process.env.RAWASI_DB_PATH=dbPath;process.env.DB_ENGINE='sqlite';
  db=require('../../server/database/db');await db.initializeDatabase();
  const initial=await db.query('SELECT id,party_no FROM clients ORDER BY id');
  await db.initializeDatabase();assert.deepEqual(await db.query('SELECT id,party_no FROM clients ORDER BY id'),initial);
  for(const table of ['clients','suppliers']){
   const rows=await db.query('SELECT party_no FROM '+table);assert.equal(new Set(rows.map(r=>r.party_no)).size,rows.length);assert.ok(rows.every(r=>r.party_no));
  }
  const app=require('../../server/server');server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const jwt=require('jsonwebtoken');const {JWT_SECRET}=require('../../server/middleware/security');const user=await db.get("SELECT id FROM users WHERE username='admin'");
  const token=jwt.sign({id:user.id,username:'admin',role:'admin'},JWT_SECRET,{expiresIn:'5m'});
  const api=async(route,body,method=body?'POST':'GET')=>{const res=await fetch('http://127.0.0.1:'+server.address().port+'/api/'+route,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:res.status,body:await res.json()};};
  const before=await db.get("SELECT last_value FROM party_sequences WHERE kind='client'");
  const created=await Promise.all([api('clients',{name:'عميل اختبار أول',previous_balance:150,notes:'ملاحظات محفوظة'}),api('clients',{name:'عميل اختبار ثان'})]);
  for(const c of created)assert.equal(c.status,200,JSON.stringify(c.body));
  assert.deepEqual(created.map(c=>Number(c.body.data.party_no.split('-')[1])).sort((a,b)=>a-b),[before.last_value+1,before.last_value+2]);
  const client=created[0].body.data;const clientGet=await api('clients/'+client.id);assert.equal(clientGet.body.data.notes,'ملاحظات محفوظة');
  for(const status of ['active','inactive','suspended']){
   const changed=await api('clients/'+client.id,{name:'تعديل العميل',status,party_no:'BAD',account_id:0,previous_balance:999},'PUT');assert.equal(changed.status,200,JSON.stringify(changed.body));
   assert.equal(changed.body.data.status,status);assert.equal(changed.body.data.party_no,client.party_no);assert.equal(changed.body.data.previous_balance,150);assert.equal(changed.body.data.account_id,client.account_id);
  }
  assert.equal((await api('clients/'+client.id,{status:'bad'},'PUT')).status,400);
  assert.equal((await api('clients/99999999',{name:'مفقود'},'PUT')).status,404);
  const attachment=JSON.stringify([{id:'test-file',name:'فاتورة.pdf',type:'application/pdf',data:'data:application/pdf;base64,JVBERi0xLjc='}]);
  const fixture={company_name:'مورد اختبار',contact_person:'المسؤول',phone_number:'777123456',default_currency:'YER',bank_iban:'YE12345678',bank_name:'بنك اختبار',balance:230,supply_lead_time_days:17,invoice_attachment:attachment};
  const supBefore=await db.get("SELECT last_value FROM party_sequences WHERE kind='supplier'");
  const suppliers=await Promise.all([api('suppliers',fixture),api('suppliers',{...fixture,company_name:'مورد ثان'})]);
  for(const s of suppliers)assert.equal(s.status,201,JSON.stringify(s.body));
  assert.deepEqual(suppliers.map(s=>Number(s.body.data.party_no.split('-')[1])).sort((a,b)=>a-b),[supBefore.last_value+1,supBefore.last_value+2]);
  const vendor=suppliers[0].body.data;
  for(const status of ['active','inactive','suspended']){
   const changed=await api('suppliers/'+vendor.id,{company_name:'تعديل المورد',status,party_no:'BAD'},'PUT');assert.equal(changed.status,200,JSON.stringify(changed.body));
   const stored=await db.get('SELECT * FROM suppliers WHERE id=?',[vendor.id]);assert.equal(stored.status,status);assert.equal(stored.party_no,vendor.party_no);assert.equal(stored.balance,230);assert.equal(stored.bank_iban,fixture.bank_iban);assert.equal(stored.supply_lead_time_days,17);assert.equal(stored.invoice_attachment,attachment);
   assert.equal(changed.body.data.invoice_attachment,attachment);
  }
  assert.equal((await api('suppliers/'+vendor.id,{status:'bad'},'PUT')).status,400);
  const count=await db.get("SELECT last_value FROM party_sequences WHERE kind='supplier'");
  await assert.rejects(db.transaction(async tx=>{await require('../../server/services/partyRegistryService').nextPartyNumber(tx,'supplier');throw Error('rollback fixture');}));
  assert.equal((await db.get("SELECT last_value FROM party_sequences WHERE kind='supplier'")).last_value,count.last_value);
  const list=await api('suppliers?limit=100');assert.equal(list.body.data.find(s=>s.id===vendor.id).status,'suspended');
  const clients=await api('clients');assert.equal(clients.body.data.find(c=>c.id===client.id).party_no,client.party_no);
  const lookups=await api('suppliers/lookups');assert.deepEqual(lookups.body.data.statuses.map(s=>s.code),['active','inactive','suspended']);
 }finally{
  if(server)await new Promise(r=>server.close(r));if(db?.db)db.db.close();try{source.close();}catch{}
  assert.ok(path.resolve(temp).startsWith(path.resolve(scratch)+path.sep));fs.rmSync(temp,{recursive:true,force:true});
 }
});
