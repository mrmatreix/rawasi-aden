const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync,backup}=require('node:sqlite');
test('sales creates a project quotation and a client invoice draft without posting',async()=>{
 const scratch=path.resolve(__dirname,'../../scratch');fs.mkdirSync(scratch,{recursive:true});
 const temp=fs.mkdtempSync(path.join(scratch,'sales-create-')),filename=path.join(temp,'test.db');
 const source=new DatabaseSync(process.env.TEST_SOURCE_DB_PATH,{readOnly:true});let db,server;
 try {
  await backup(source,filename);source.close();process.env.RAWASI_DB_PATH=filename;
  db=require('../../server/database/db');await db.ready;
  const app=require('../../server/server');server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const user=await db.get("SELECT id FROM users WHERE username='admin'");
  const token=require('jsonwebtoken').sign({id:user.id,username:'admin',role:'admin'},require('../../server/middleware/security').JWT_SECRET,{expiresIn:'3m'});
  const base='http://127.0.0.1:'+server.address().port,headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
  const client=(await db.get('SELECT id FROM clients LIMIT 1')).id;
  const project=(await db.run("INSERT INTO projects(code,name,client_id,status,contract_value) VALUES ('SALES-P','مشروع مبيعات',?,'جاري',1000)",[client])).lastInsertRowid;
  const quote=await fetch(base+'/api/project-hub/'+project+'/quotations',{method:'POST',headers,body:JSON.stringify({quotation_no:'QA-SALES-1',title:'عرض سعر اختبار',date:'2096-01-01',subtotal:500,discount:50,total_amount:450,status:'مسودة'})});
  const quoteResult=await quote.json();assert.equal(quote.status,200,JSON.stringify(quoteResult));assert.equal(quoteResult.success,true);
  const savedQuote=await db.get("SELECT * FROM project_quotations WHERE quotation_no='QA-SALES-1'");assert.equal(savedQuote.project_id,project);assert.equal(savedQuote.total_amount,450);
  const journals=(await db.get('SELECT COUNT(*) AS count FROM journal_entries')).count;
  const invoice=await fetch(base+'/api/billing',{method:'POST',headers,body:JSON.stringify({bill_type:'فاتورة',client_id:client,project_id:project,amount:400,gross_amount:400,date:'2096-01-01',status:'draft'})});
  const result=await invoice.json();assert.equal(invoice.status,200,JSON.stringify(result));assert.equal(result.success,true);
  const bill=await db.get('SELECT * FROM bills WHERE id=?',[result.id]);assert.equal(bill.bill_type,'فاتورة');assert.equal(bill.status,'draft');assert.equal(bill.client_id,client);assert.equal(bill.project_id,project);assert.equal(bill.amount,400);
  assert.equal((await db.get('SELECT COUNT(*) AS count FROM journal_entries')).count,journals);
 } finally {
  if(server)await new Promise(resolve=>server.close(resolve));if(db)await db.closeDatabase();try{source.close();}catch{}
  assert.ok(path.resolve(temp).startsWith(scratch+path.sep));fs.rmSync(temp,{recursive:true,force:true});
 }
});
