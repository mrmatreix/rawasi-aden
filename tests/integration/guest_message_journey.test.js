const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync,backup}=require('node:sqlite');

test('guest request moves through customer service, supervisor and manager before the guest sees the reply',async()=>{
 const scratch=path.resolve(__dirname,'../../scratch');fs.mkdirSync(scratch,{recursive:true});
 const temp=fs.mkdtempSync(path.join(scratch,'guest-journey-'));
 const source=new DatabaseSync(process.env.TEST_SOURCE_DB_PATH,{readOnly:true});let db,server;
 try {
  const filename=path.join(temp,'test.db');await backup(source,filename);source.close();
  process.env.RAWASI_DB_PATH=filename;db=require('../../server/database/db');await db.ready;
  server=require('../../server/server').listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const jwt=require('jsonwebtoken'),secret=require('../../server/middleware/security').JWT_SECRET;
  const admin=(await db.get("SELECT id FROM users WHERE username='admin'")).id;
  const makeStaff=async name=>(await db.run('INSERT INTO users(username,password_hash,full_name,role,permissions,status) VALUES (?,\'unused\',?,\'custom\',?,\'active\')',[name,name,JSON.stringify(['client_app:requests_view','client_app:requests_edit','client_app:requests_review'])])).lastInsertRowid;
  const customerService=await makeStaff('journey-customer-service'),supervisor=await makeStaff('journey-supervisor');
  const token=id=>jwt.sign({id},secret),base='http://127.0.0.1:'+server.address().port;
  async function api(url,actor,method='GET',body){const response=await fetch(base+url,{method,headers:{...(actor?{Authorization:'Bearer '+token(actor)}:{}),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')};}
  assert.equal((await api('/api/admin/client-users/service-request-supervisor',admin,'PUT',{supervisor_id:customerService})).status,200);
  const service=(await db.run("INSERT INTO engineering_services(code,title,is_active) VALUES ('JOURNEY','اختبار داخلي',1)")).lastInsertRowid;
  const submitted=await api('/api/client-portal/services/requests',null,'POST',{client_name:'زائر اختبار',phone:'700000001',service_ids:[service],description:'طلب اختبار'});
  assert.equal(submitted.status,200);const {request_id:id,request_no:number,verification_code:code}=submitted.data.data;
  assert.equal(Number((await db.get('SELECT assigned_to FROM service_requests WHERE id=?',[id])).assigned_to),Number(customerService));
  const root='/api/admin/client-users/service-requests/'+id;
  const tracked='/api/client-portal/services/requests/track?request_no='+encodeURIComponent(number)+'&verification_code='+encodeURIComponent(code);
  assert.equal((await api(root,customerService)).status,200);
  assert.equal((await api(root+'/assignee',customerService,'PUT',{assigned_to:supervisor})).status,200);
  assert.equal(Number((await db.get('SELECT assigned_to FROM service_requests WHERE id=?',[id])).assigned_to),Number(supervisor));
  const sent=await api(root+'/message',supervisor,'POST',{message:'رد تجريبي معتمد للزائر'});
  assert.equal(sent.status,200);assert.equal(sent.data.pending_approval,true);
  let guest=await api(tracked,null);assert.equal(guest.data.request.messages.some(m=>m.message==='رد تجريبي معتمد للزائر'),false);
  const pending=await db.get("SELECT id FROM service_request_events WHERE request_id=? AND event_type='message_pending_approval'",[id]);
  assert.equal((await api(root+'/message-decision',supervisor,'POST',{event_id:pending.id,decision:'approve'})).status,403);
  const managerView=await api(root,admin);assert.equal(managerView.data.request.events.some(e=>e.id===pending.id&&e.event_type==='message_pending_approval'),true);
  assert.equal((await api(root+'/message-decision',admin,'POST',{event_id:pending.id,decision:'approve'})).status,200);
  guest=await api(tracked,null);assert.equal(guest.data.request.messages.some(m=>m.message==='رد تجريبي معتمد للزائر'),true);
  assert.equal((await api('/api/client-portal/services/requests/track?request_no='+number+'&verification_code=wrong',null)).status,404);
 }finally{if(server)await new Promise(resolve=>server.close(resolve));if(db)await db.closeDatabase();try{source.close()}catch{}assert.ok(path.resolve(temp).startsWith(scratch+path.sep));fs.rmSync(temp,{recursive:true,force:true});}
});
