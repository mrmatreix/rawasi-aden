const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {DatabaseSync,backup}=require('node:sqlite');const {spawnSync}=require('node:child_process');
const jwt=require('jsonwebtoken');
test('security boundaries and durable SQLite operations use an isolated synthetic database',async t=>{
 assert.ok(process.env.TEST_SOURCE_DB_PATH,'Run npm test to create the isolated fixture');
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'rawasi-security-'));const filename=path.join(temp,'test.db');
 const source=new DatabaseSync(process.env.TEST_SOURCE_DB_PATH,{readOnly:true});await backup(source,filename);source.close();
 process.env.RAWASI_DB_PATH=filename;
 const db=require('../../server/database/db');await db.ready;const app=require('../../server/server');
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;
 const {JWT_SECRET}=require('../../server/middleware/security');const {CLIENT_JWT_SECRET}=require('../../server/middleware/client_auth');
 const admin=await db.get("SELECT id FROM users WHERE username='admin'");
 const token=jwt.sign({id:admin.id,role:'admin'},JWT_SECRET,{expiresIn:'5m'});
 const call=(url,auth,options={})=>fetch(base+url,{...options,headers:{...(auth?{Authorization:'Bearer '+auth}:{}),...options.headers}});
 try{
  await t.test('static source, data, backup and encoded traversal paths are not public',async()=>{
   for(const url of ['/server/server.js','/server/database/rawasi_aden.db','/server/database/config.json','/.env','/.git/config','/package.json','/backups/test.db','/css/%2e%2e%2fserver%2fserver.js'])assert.ok([400,403,404].includes((await call(url)).status),url);
   assert.equal((await call('/')).status,200);assert.equal((await call('/js/auth.js')).status,200);
   assert.equal((await call('/api/ready')).status,200);assert.equal((await call('/api/users')).status,401);
   const html=await (await call('/')).text();
   for(const match of html.matchAll(/<script\s+src="(js\/[^"?]+)(?:\?[^"]*)?"/g)){const asset=await call('/'+match[1]);assert.equal(asset.status,200,match[1]);await asset.arrayBuffer();}
   for(const route of ['projects','inventory','purchases','expenses','billing','payments','accounting','reports','clients','suppliers','settings','hr','project-hub','project-files','procurement','bank-reconciliation','taxes-guarantees','project-control','material-management','project-closeout','profitability','cash-flow','contracts','admin/client-users','docs/spec'])assert.equal((await call('/api/'+route)).status,401,route);
  });
  await t.test('persisted permissions and suspension override claims in existing JWTs',async()=>{
   const id=(await db.run("INSERT INTO users(username,password_hash,full_name,role,permissions,status) VALUES ('security-limited','unused','Limited','storekeeper','[]','active')")).lastInsertRowid;
   const forgedRole=jwt.sign({id,role:'admin',permissions:'all'},JWT_SECRET);
   assert.equal((await call('/api/admin/client-users',forgedRole)).status,403);
   assert.equal((await call('/api/auth/2fa-status',forgedRole)).status,403);
   await db.run("UPDATE users SET status='inactive' WHERE id=?",[id]);
   assert.equal((await call('/api/users',forgedRole)).status,401);
   const ticket=jwt.sign({id:admin.id,purpose:'realtime'},JWT_SECRET);assert.equal((await call('/api/users',ticket)).status,401);
  });
  await t.test('pending authentication cannot change security settings and published master PINs are rejected',async()=>{
   const pending=jwt.sign({id:admin.id,role:'admin',isPending2FA:true},JWT_SECRET);
   assert.equal((await call('/api/auth/2fa-status',pending)).status,403);assert.equal((await call('/api/auth/me',pending)).status,403);
   await db.run("UPDATE users SET two_factor_pin='428571' WHERE id=?",[admin.id]);
   for(const code of ['889900','654321','123456']){
    const response=await call('/api/auth/verify-2fa',null,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tempToken:pending,code})});assert.equal(response.status,401);
   }
   const status=await (await call('/api/auth/2fa-status',token)).json();assert.equal(Object.hasOwn(status,'pin'),false);assert.equal(Object.hasOwn(status,'backupCode'),false);
  });
  await t.test('forged CSRF, cross-origin writes and OTP without password preauthentication are denied',async()=>{
   assert.equal((await call('/api/clients',null,{method:'POST',headers:{'Content-Type':'application/json','x-csrf-token':'a'.repeat(64),'x-requested-with':'XMLHttpRequest'},body:'{}'})).status,403);
   assert.equal((await call('/api/clients',token,{method:'POST',headers:{Origin:'https://attacker.invalid','Content-Type':'application/json'},body:'{}'})).status,403);
   assert.equal((await call('/api/client-portal/auth/verify-otp',null,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'other@example.invalid',otp:'123456'})})).status,401);
  });
  await t.test('project file download checks the actual owner, scope and traversal boundaries',async()=>{
   const projectIds=[];for(const name of ['one','two'])projectIds.push((await db.run('INSERT INTO projects(code,name) VALUES (?,?)',['SEC-'+name,name])).lastInsertRowid);
   const user=await db.get("SELECT id FROM users WHERE username='security-limited'");await db.run("UPDATE users SET status='active',role='project_manager',permissions=?,allowed_projects=? WHERE id=?",[JSON.stringify(['projects:view']),JSON.stringify([projectIds[0]]),user.id]);
   const limited=jwt.sign({id:user.id},JWT_SECRET);
   const folders=[];for(const id of projectIds){const response=await call('/api/project-files/'+id+'/folder',token);assert.equal(response.status,200);folders.push((await response.json()).data.folderPath);}
   for(const folder of folders)fs.writeFileSync(path.join(folder,'test.pdf'),'%PDF-1.7\nscope');
   const ownDownload=await call('/api/project-files/download?path='+encodeURIComponent(path.join(folders[0],'test.pdf')),limited);assert.equal(ownDownload.status,200,await ownDownload.text());
   assert.equal((await call('/api/project-files/download?path='+encodeURIComponent(path.join(folders[1],'test.pdf')),limited)).status,403);
   assert.equal((await call('/api/project-files/'+projectIds[1]+'/files',limited)).status,403);
   assert.equal((await call('/api/project-files/download?path='+encodeURIComponent(filename),token)).status,403);
   const {validateUpload}=require('../../server/services/uploadValidationService');assert.throws(()=>validateUpload('invoice.pdf',Buffer.from('<script>alert(1)</script>')));
  });
  await t.test('private attachments require their owning client or an authorized administrator',async()=>{
   const client=await db.get('SELECT id FROM clients LIMIT 1');const ids=[];
   for(const name of ['owner','other'])ids.push((await db.run('INSERT INTO client_users(client_id,email,password_hash,full_name,status) VALUES (?,?,?,?,?)',[client.id,name+'@example.invalid','unused',name,'active'])).lastInsertRowid);
   const directory=path.join(require('../../server/config/environment').storage.uploads,'service_requests');fs.mkdirSync(directory,{recursive:true});
   const name='private-test.pdf';fs.writeFileSync(path.join(directory,name),'%PDF-1.7\nprivate');
   await db.run('INSERT INTO service_requests(request_no,client_user_id,client_name,phone,attachments) VALUES (?,?,?,?,?)',['SEC-PRIVATE',ids[0],'Owner','000',JSON.stringify([{diskFileName:name}])]);
   const url='/uploads/service_requests/'+name;const clientToken=id=>jwt.sign({id,client_id:client.id,type:'client'},CLIENT_JWT_SECRET);
   assert.equal((await call(url)).status,401);assert.equal((await call(url,clientToken(ids[1]))).status,403);
   const result=await call(url,clientToken(ids[0]));assert.equal(result.status,200);assert.match(result.headers.get('content-disposition'),/^attachment/);
   assert.equal((await call(url,token)).status,200);
  });
  await t.test('guest requests save all service items atomically and reject spoofed attachments without orphan files',async()=>{
   const service=(await db.run("INSERT INTO engineering_services(code,title,is_active) VALUES ('SEC-SERVICE','Synthetic service',1)")).lastInsertRowid;
   const directory=path.join(require('../../server/config/environment').storage.uploads,'service_requests');const before=fs.readdirSync(directory).sort();
   const payload={client_name:'Synthetic guest',phone:'000000',service_ids:[service]};
   const options=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   const bad=await call('/api/client-portal/services/requests',null,options({...payload,attachments:[{fileName:'good.pdf',contentBase64:Buffer.from('%PDF-1.7\nfixture').toString('base64')},{fileName:'bad.pdf',contentBase64:Buffer.from('<script>bad</script>').toString('base64')}]}));assert.equal(bad.status,400);assert.deepEqual(fs.readdirSync(directory).sort(),before);
   const result=await call('/api/client-portal/services/requests',null,options(payload));assert.equal(result.status,200);const data=(await result.json()).data;assert.ok(data.request_id);
   assert.equal((await db.get('SELECT COUNT(*) AS n FROM service_request_items WHERE request_id=?',[data.request_id])).n,1);
   assert.ok(await db.get("SELECT id FROM audit_logs WHERE action='NEW_SERVICE_REQUEST' AND entity_id=?",[String(data.request_id)]),JSON.stringify(await db.query('SELECT action,entity_id FROM audit_logs')));
  });
  await t.test('a failed asynchronous transaction cannot roll back another request',async()=>{
   await db.exec('CREATE TABLE security_concurrency(id INTEGER PRIMARY KEY, value TEXT)');
   const failed=db.transaction(async tx=>{await tx.run("INSERT INTO security_concurrency VALUES (1,'rollback')");await new Promise(r=>setTimeout(r,40));throw new Error('intentional rollback');});
   const other=db.run("INSERT INTO security_concurrency VALUES (2,'keep')");
   const results=await Promise.allSettled([failed,other]);assert.equal(results[0].status,'rejected');assert.equal(results[1].status,'fulfilled');
   assert.deepEqual((await db.query('SELECT id FROM security_concurrency')).map(r=>r.id),[2]);
  });
  await t.test('native backup includes committed WAL changes and restores into a separate database',async()=>{
   await db.run("INSERT INTO security_concurrency VALUES (3,'durable')");const snapshot=path.join(temp,'snapshot.db');await db.backupSnapshot(snapshot);
   const restored=new DatabaseSync(snapshot);try{assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(restored.prepare('PRAGMA foreign_key_check').all().length,0);assert.equal(restored.prepare('SELECT value FROM security_concurrency WHERE id=3').get().value,'durable');}finally{restored.close();}
   const {safePath}=require('../../server/middleware/fileAccess');assert.throws(()=>safePath(temp,path.join(temp+'-outside','secret'),{existing:false}));assert.throws(()=>safePath(temp,'../secret',{existing:false}));
  });
  await t.test('MySQL connection failure never creates or switches to SQLite',()=>{
   const fallback=path.join(temp,'must-not-exist.db');const result=spawnSync(process.execPath,['-e',"const d=require('./server/database/db');d.ready.then(()=>process.exit(2)).catch(()=>d.closeDatabase().then(()=>process.exit(0)))"],{cwd:path.resolve(__dirname,'../..'),env:{...process.env,DB_ENGINE:'mysql',MYSQL_HOST:'127.0.0.1',MYSQL_PORT:'1',RAWASI_DB_PATH:fallback},timeout:15000,encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr);assert.equal(fs.existsSync(fallback),false);
  });
  await t.test('full bundle restores database and attachments, boots twice and rejects corrupt archives',async()=>{
   const config=require('../../server/config/environment');
   fs.mkdirSync(config.storage.projects,{recursive:true});fs.writeFileSync(path.join(config.storage.projects,'contract.pdf'),'%PDF-1.7\ncontract');
   const engine=require('../../server/services/unifiedBackupEngine');
   const archive=await engine.createBackup({scope:'full_bundle_with_files',user:'synthetic-test'});
   assert.equal((await engine.runSandboxTestRestore(archive.recordId)).success,true);
   const {restoreBundle}=require('../../scripts/restore_bundle');const destination=path.join(temp,'restored');
   assert.equal(restoreBundle(archive.filePath,destination).success,true);
   assert.equal(fs.readFileSync(path.join(destination,'projects/contract.pdf'),'utf8'),'%PDF-1.7\ncontract');
   assert.ok(fs.existsSync(path.join(destination,'uploads/service_requests/private-test.pdf')));
   assert.throws(()=>restoreBundle(archive.filePath,destination),/must not exist/);
   const zip=new(require('adm-zip'))(archive.filePath);zip.updateFile('database/rawasi_aden.db',Buffer.from('damaged'));assert.throws(()=>restoreBundle(zip.toBuffer(),path.join(temp,'corrupt')),/hash mismatch/);
   const {fork}=require('node:child_process');
   for(let restart=0;restart<2;restart++){
    const child=fork(path.resolve(__dirname,'../../server/server.js'),[],{silent:true,windowsHide:true,env:{...process.env,NODE_ENV:restart===0?'staging':'production',RAWASI_DATA_DIR:destination,RAWASI_SCRATCH_DIR:path.join(destination,'scratch'),PORT:'0',RAWASI_DB_PATH:path.join(destination,'rawasi_aden.db'),RAWASI_UPLOAD_DIR:path.join(destination,'uploads'),RAWASI_PROJECTS_DIR:path.join(destination,'projects'),RAWASI_BACKUP_DIR:path.join(destination,'backups'),ENABLE_SCHEDULERS:'false'}});
    let logs='';child.stderr.on('data',data=>{logs+=data.toString();});child.stdout.on('data',()=>{});
    try{
     const ready=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Startup timeout '+logs)),15000);child.once('message',value=>{clearTimeout(timer);resolve(value);});child.once('exit',code=>{clearTimeout(timer);reject(new Error('Startup exited '+code+' '+logs));});});
     const url='http://127.0.0.1:'+ready.port;
     assert.equal((await fetch(url+'/api/ready')).status,200);
     assert.equal((await fetch(url+'/api/reports/trial-balance',{headers:{Authorization:'Bearer '+token}})).status,200);
     const doc=await fetch(url+'/uploads/service_requests/private-test.pdf',{headers:{Authorization:'Bearer '+token}});assert.equal(doc.status,200);assert.match(await doc.text(),/private/);
    }finally{const exit=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await exit;}
   }
  });
  await t.test('production refuses unset secrets and refuses demo seeding',()=>{
   const root=path.resolve(__dirname,'../..');const env={...process.env,NODE_ENV:'production',JWT_SECRET:'',CLIENT_JWT_SECRET:'',BANK_ENCRYPTION_KEY:''};
   const result=spawnSync(process.execPath,['-e',"require('./server/config/environment').validateProduction()"],{cwd:root,env,encoding:'utf8',windowsHide:true});assert.notEqual(result.status,0);assert.match(result.stderr,/JWT_SECRET/);
   const seed=spawnSync(process.execPath,['server/database/seed.js'],{cwd:root,env,encoding:'utf8',windowsHide:true});assert.notEqual(seed.status,0);assert.match(seed.stderr,/forbidden/);
  });
  await t.test('settings responses redact backup credentials and blank updates preserve stored tokens',async()=>{
   await db.run("INSERT OR REPLACE INTO settings(key,value) VALUES ('cloud_backup_token','synthetic-private-token'),('cloud_backup_passphrase','synthetic-private-passphrase')");
   const settings=await (await call('/api/settings',token)).text();assert.ok(!settings.includes('synthetic-private-token'));assert.ok(!settings.includes('synthetic-private-passphrase'));
   const status=await (await call('/api/settings/cloud-backup/status',token)).json();assert.equal(status.config.authToken,'');assert.equal(status.config.authTokenConfigured,true);
   const service=require('../../server/services/cloudBackupCryptoService');await service.saveCloudConfig({authToken:''});assert.equal((await service.getCloudConfig()).authToken,'synthetic-private-token');
  });
  await t.test('WebSocket upgrades require a current authorized user and accept short-lived tickets',async()=>{
   require('../../server/services/contractAlertsService').attachWebSocket(server);
   const handshake=protocol=>new Promise((resolve,reject)=>{
    const socket=require('node:net').connect(server.address().port,'127.0.0.1');socket.setTimeout(3000,()=>{socket.destroy();reject(new Error('Handshake timeout'));});socket.once('error',reject);socket.once('data',data=>{resolve(data.toString('utf8').split('\r\n')[0]);socket.destroy();});
    socket.once('connect',()=>socket.write('GET /ws/alerts HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: '+require('crypto').randomBytes(16).toString('base64')+'\r\n'+(protocol?'Sec-WebSocket-Protocol: rawasi-auth, ticket.'+protocol+'\r\n':'')+'\r\n'));
   });
   assert.match(await handshake(),/401/);
   const response=await call('/api/auth/realtime-ticket',token,{method:'POST'});assert.equal(response.status,200);const {ticket}=await response.json();assert.match(await handshake(ticket),/101/);
  });
  await t.test('bank key rotation creates a separate database and preserves decryptability',async()=>{
   const crypto=require('node:crypto');const old='old-test-key-'+crypto.randomBytes(32).toString('hex');const next='new-test-key-'+crypto.randomBytes(32).toString('hex');const key=crypto.createHash('sha256').update(old).digest();const iv=crypto.randomBytes(12);const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);const plain=JSON.stringify({bank_name:'synthetic bank'});const encrypted=Buffer.concat([cipher.update(plain),cipher.final()]);const vault=[iv.toString('hex'),encrypted.toString('hex'),cipher.getAuthTag().toString('hex')].join(':');
   await db.run('UPDATE suppliers SET bank_details_encrypted=?',[vault]);const {rotateBankKey}=require('../../scripts/rotate_bank_key');const target=path.join(temp,'rotated.db');const result=await rotateBankKey(filename,target,old,next);assert.ok(result.records>0);
   const rotated=new DatabaseSync(target,{readOnly:true});const saved=rotated.prepare('SELECT bank_details_encrypted FROM suppliers LIMIT 1').get().bank_details_encrypted;rotated.close();const [ivHex,dataHex,tagHex]=saved.split(':');const decipher=crypto.createDecipheriv('aes-256-gcm',crypto.createHash('sha256').update(next).digest(),Buffer.from(ivHex,'hex'));decipher.setAuthTag(Buffer.from(tagHex,'hex'));assert.equal(Buffer.concat([decipher.update(Buffer.from(dataHex,'hex')),decipher.final()]).toString(),plain);
   assert.equal((await db.get('SELECT bank_details_encrypted FROM suppliers LIMIT 1')).bank_details_encrypted,vault);
  });
  await t.test('unavailable database makes readiness and protected operations fail closed',async()=>{
   await db.closeDatabase();assert.equal((await call('/api/ready')).status,503);assert.equal((await call('/api/clients',token)).status,503);
  });
 }finally{await new Promise(r=>server.close(r));await db.closeDatabase();fs.rmSync(temp,{recursive:true,force:true});}
});
