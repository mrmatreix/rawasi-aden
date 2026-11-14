const {test}=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const {DatabaseSync,backup}=require('node:sqlite');
test('manager approval and client response apply to the correct quote and account',async()=>{
 const scratch=path.resolve(__dirname,'../../scratch');fs.mkdirSync(scratch,{recursive:true});const temp=fs.mkdtempSync(path.join(scratch,'request-flow-')),filename=path.join(temp,'test.db');const source=new DatabaseSync(process.env.TEST_SOURCE_DB_PATH,{readOnly:true});let db,server;
 try{
  await backup(source,filename);source.close();process.env.RAWASI_DB_PATH=filename;db=require('../../server/database/db');await db.ready;server=require('../../server/server').listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const jwt=require('jsonwebtoken'),admin=(await db.get("SELECT id FROM users WHERE username='admin'")).id,client=(await db.get('SELECT id FROM clients LIMIT 1')).id;
  const makeClient=async email=>(await db.run("INSERT INTO client_users(client_id,email,password_hash,full_name,role,status) VALUES (?,?,'x','Test','owner','active')",[client,email])).lastInsertRowid;
  const owner=await makeClient('owner-flow@example.invalid'),other=await makeClient('other-flow@example.invalid');
  const request=(await db.run("INSERT INTO service_requests(request_no,client_user_id,client_name,phone,status,assigned_to,verification_code,admin_notes,quoted_amount) VALUES ('SR-TEST-1',?,'Test','123','pricing',?,'123456','private',50)",[owner,admin])).lastInsertRowid;
  const internal=jwt.sign({id:admin},require('../../server/middleware/security').JWT_SECRET), clientSecret=require('../../server/middleware/client_auth').CLIENT_JWT_SECRET;
  const clientToken=id=>jwt.sign({id,client_id:client,type:'client'},clientSecret), base='http://127.0.0.1:'+server.address().port;
  async function api(url,token,method='GET',body){const res=await fetch(base+url,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:res.status,data:await res.json()};}
  const adminPath='/api/admin/client-users/service-requests/'+request, portal='/api/client-portal';
  let track=await api(portal+'/services/requests/track?request_no=SR-TEST-1&verification_code=123456');assert.equal(track.data.request.quoted_amount,null);assert.equal(track.data.request.admin_notes,undefined);
  assert.equal((await api(adminPath,internal,'PUT',{status:'quoted'})).status,409);
  assert.equal((await api(adminPath+'/convert-to-project',internal,'POST',{})).status,409);
  let sent=await api(adminPath+'/quote',internal,'POST',{details:'بند، كمية 2، سعر 50',duration:'أسبوع',amount:100});assert.equal(sent.status,200,JSON.stringify(sent.data));
  const pending=(await db.get('SELECT id FROM service_request_quotes WHERE request_id=?',[request])).id;
  assert.equal((await api(portal+'/my-service-requests',clientToken(owner))).data.requests[0].quote,null);
  assert.equal((await api(adminPath+'/manager-decision',internal,'POST',{decision:'approve',quote_id:pending})).status,200);
  let own=await api(portal+'/my-service-requests',clientToken(owner));assert.equal(own.data.requests[0].quote.id,pending);
  assert.equal((await api(portal+'/my-service-requests/'+request+'/response',clientToken(other),'POST',{decision:'accept',quote_id:pending})).status,404);
  assert.equal((await api(portal+'/my-service-requests/'+request+'/response',clientToken(owner),'POST',{decision:'changes',quote_id:pending,note:'تعديل الكمية'})).status,200);
  assert.equal((await api(portal+'/my-service-requests/'+request+'/response',clientToken(owner),'POST',{decision:'accept',quote_id:pending})).status,409);
  assert.equal((await api(adminPath+'/quote',internal,'POST',{details:'كمية معدلة',duration:'أسبوعان',amount:150})).status,200);
  const second=(await db.get('SELECT id FROM service_request_quotes WHERE request_id=? ORDER BY version DESC',[request])).id;
  assert.equal((await api(adminPath+'/manager-decision',internal,'POST',{decision:'approve',quote_id:second})).status,200);
  assert.equal((await api(portal+'/my-service-requests/'+request+'/response',clientToken(owner),'POST',{decision:'accept',quote_id:pending})).status,409);
  assert.equal((await api(portal+'/my-service-requests/'+request+'/response',clientToken(owner),'POST',{decision:'accept',quote_id:second})).status,200);
  // One accepted quote produces exactly one project and one project cost center, even under concurrent requests.
  const conversions=await Promise.all([api(adminPath+'/convert-to-project',internal,'POST',{}),api(adminPath+'/convert-to-project',internal,'POST',{})]);
  assert.deepEqual(conversions.map(x=>x.status).sort(),[200,409]);
  const converted=conversions.find(x=>x.status===200).data;
  const project=await db.get('SELECT * FROM projects WHERE id=?',[converted.project_id]);
  assert.equal(Number(project.contract_value),150);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM cost_centers WHERE project_id=?',[converted.project_id])).n,1);
  assert.equal((await db.get('SELECT status FROM service_requests WHERE id=?',[request])).status,'converted');
  const failed=(await db.run("INSERT INTO service_requests(request_no,client_user_id,client_name,phone,status,assigned_to) VALUES ('SR-ROLLBACK',?,'Test','123','client_accepted',?)",[owner,admin])).lastInsertRowid;
  await db.run("INSERT INTO service_request_quotes(request_id,version,details,duration,amount,currency,state,created_by) VALUES (?,1,'test','week',42,'YER','accepted',?)",[failed,admin]);
  await db.run("INSERT INTO cost_centers(code,name) VALUES (?,?)",['CC-SR-'+failed,'collision']);
  assert.equal((await api('/api/admin/client-users/service-requests/'+failed+'/convert-to-project',internal,'POST',{})).status,500);
  assert.equal((await db.get('SELECT status FROM service_requests WHERE id=?',[failed])).status,'client_accepted');
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM projects WHERE code=?',['PRJ-SR-'+failed])).n,0);

  assert.equal((await api('/api/admin/client-users/service-request-supervisor',internal,'PUT',{supervisor_id:admin})).status,200);
  const service=(await db.run("INSERT INTO engineering_services(code,title,is_active) VALUES ('S-TEST','Synthetic service',1)")).lastInsertRowid;
  const submitted=await api(portal+'/services/requests',null,'POST',{client_name:'Guest test',phone:'777000000',service_ids:[service]});
  assert.equal(submitted.status,200,JSON.stringify(submitted.data));assert.match(submitted.data.data.verification_code,/^[a-f0-9]{28}$/);
  const guest=submitted.data.data.request_id, code=submitted.data.data.verification_code, number=submitted.data.data.request_no;
  assert.equal(Number((await db.get('SELECT assigned_to FROM service_requests WHERE id=?',[guest])).assigned_to),admin);
  assert.equal((await api(portal+'/services/requests/guest-message',null,'POST',{request_no:number,verification_code:code,message:'تفاصيل إضافية'})).status,200);
  assert.equal((await api(portal+'/services/requests/guest-message',null,'POST',{request_no:number,verification_code:'0000000000000000000000000000',message:'غير مصرح'})).status,404);
  const guestAdmin='/api/admin/client-users/service-requests/'+guest;
  assert.equal((await api(guestAdmin,internal,'PUT',{status:'pricing',assigned_to:admin,admin_notes:'تمت مراجعة الكميات'})).status,200);
  assert.equal((await api(guestAdmin+'/quote',internal,'POST',{details:'أعمال بناء',duration:'أسبوع',amount:42})).status,200);
  const guestQuote=(await db.get('SELECT id FROM service_request_quotes WHERE request_id=?',[guest])).id;
  assert.equal((await api(guestAdmin+'/manager-decision',internal,'POST',{decision:'approve',quote_id:guestQuote})).status,200);
  assert.equal((await api(portal+'/services/requests/guest-response',null,'POST',{request_no:number,verification_code:'123456',decision:'accept',quote_id:guestQuote})).status,400);
  assert.equal((await api(portal+'/services/requests/guest-response',null,'POST',{request_no:number,verification_code:code,decision:'accept',quote_id:guestQuote})).status,200);
 }finally{if(server)await new Promise(resolve=>server.close(resolve));if(db)await db.closeDatabase();try{source.close();}catch{}assert.ok(path.resolve(temp).startsWith(scratch+path.sep));fs.rmSync(temp,{recursive:true,force:true});}
});
