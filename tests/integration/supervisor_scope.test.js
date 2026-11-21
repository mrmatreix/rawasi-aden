const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync,backup}=require('node:sqlite');

// خيار "مشرف" (client_app:supervisor): لا يرى طلبات الزوار وردودهم حتى تسندها إليه خدمة العملاء أو المدير العام.
test('supervisor option hides guest requests and replies until customer service or the manager assigns them',async()=>{
 const scratch=path.resolve(__dirname,'../../scratch');fs.mkdirSync(scratch,{recursive:true});
 const temp=fs.mkdtempSync(path.join(scratch,'supervisor-scope-'));
 const source=new DatabaseSync(process.env.TEST_SOURCE_DB_PATH,{readOnly:true});let db,server;
 try {
  const filename=path.join(temp,'test.db');await backup(source,filename);source.close();
  process.env.RAWASI_DB_PATH=filename;db=require('../../server/database/db');await db.ready;
  server=require('../../server/server').listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const jwt=require('jsonwebtoken'),secret=require('../../server/middleware/security').JWT_SECRET;
  const admin=(await db.get("SELECT id FROM users WHERE username='admin'")).id;
  const base=['client_app:requests_view','client_app:requests_edit','client_app:requests_review'];
  const makeStaff=async(name,permissions)=>(await db.run('INSERT INTO users(username,password_hash,full_name,role,permissions,status) VALUES (?,\'unused\',?,\'custom\',?,\'active\')',[name,name,JSON.stringify(permissions)])).lastInsertRowid;
  const customerService=await makeStaff('scope-customer-service',base);
  const supervisor=await makeStaff('scope-supervisor',[...base,'client_app:supervisor']);
  const editor=await makeStaff('scope-editor',base);
  const token=id=>jwt.sign({id},secret),url='http://127.0.0.1:'+server.address().port;
  async function api(route,actor,method='GET',body){const response=await fetch(url+route,{method,headers:{Authorization:'Bearer '+token(actor),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()};}
  const list='/api/admin/client-users/service-requests';
  assert.equal((await api('/api/admin/client-users/service-request-supervisor',admin,'PUT',{supervisor_id:customerService})).status,200);
  const make=async no=>{const id=(await db.run("INSERT INTO service_requests(request_no,source,client_name,phone,status,assigned_to) VALUES (?,'guest','زائر','700000002','new',?)",[no,customerService])).lastInsertRowid;await db.run("INSERT INTO service_request_events(request_id,actor_type,event_type,message) VALUES (?,'guest','message_from_client',?)",[id,'رد زائر '+no]);return id;};
  const first=await make('SCOPE-1'),second=await make('SCOPE-2');

  // قبل الإسناد: لا طلبات ولا ردود ولا تنبيهات ولا تفاصيل
  assert.equal((await api(list,supervisor)).data.requests.length,0);
  assert.equal((await api(list+'/inbox',supervisor)).data.conversations.length,0);
  assert.equal((await api(list+'/alerts',supervisor)).data.alerts.length,0);
  assert.equal((await api(list+'/'+first,supervisor)).status,404);
  const access=(await api(list+'/workflow-access',supervisor)).data.access;
  assert.equal(access.can_assign,false);assert.equal(access.is_scoped_supervisor,true);

  // الإسناد: ليس للمشرف ولا للموظف العادي، بل لخدمة العملاء والمدير العام
  assert.equal((await api(list+'/'+first+'/assignee',supervisor,'PUT',{assigned_to:supervisor})).status,403);
  assert.equal((await api(list+'/'+first+'/assignee',editor,'PUT',{assigned_to:supervisor})).status,403);
  assert.equal((await api(list+'/'+first,editor,'PUT',{assigned_to:supervisor})).status,403);
  assert.equal((await api(list+'/'+first,editor,'PUT',{admin_notes:'تحديث عادي'})).status,200);
  assert.equal((await api(list+'/'+first+'/assignee',customerService,'PUT',{assigned_to:supervisor})).status,200);

  // بعد الإسناد: يرى الطلب المسند ورد الزائر فقط
  const visible=(await api(list,supervisor)).data.requests;
  assert.deepEqual(visible.map(r=>r.id),[Number(first)]);
  const detail=await api(list+'/'+first,supervisor);assert.equal(detail.status,200);
  assert.ok(JSON.stringify(detail.data.request).includes('رد زائر SCOPE-1'));
  assert.equal((await api(list+'/'+second,supervisor)).status,404);

  // لا يتأثر المدير العام ولا الموظف دون الخيار
  assert.equal((await api(list,admin)).data.requests.length>=2,true);
  assert.equal((await api(list,editor)).data.requests.length>=2,true);
  assert.equal((await api(list+'/'+second+'/assignee',admin,'PUT',{assigned_to:supervisor})).status,200);
  assert.equal((await api(list,supervisor)).data.requests.length,2);
 }finally{if(server)await new Promise(resolve=>server.close(resolve));if(db)await db.closeDatabase();try{source.close()}catch{}assert.ok(path.resolve(temp).startsWith(scratch+path.sep));fs.rmSync(temp,{recursive:true,force:true});}
});
