// Re-encrypt into a NEW database, never in place. Keep the old key until rollout is verified.
const fs=require('node:fs');const crypto=require('node:crypto');const {DatabaseSync,backup}=require('node:sqlite');
async function rotateBankKey(source,destination,oldSecret,newSecret){
 if(!oldSecret||!newSecret||newSecret.length<32||oldSecret===newSecret)throw new Error('Independent old and new keys are required');
 if(fs.existsSync(destination))throw new Error('Destination must not exist');
 const input=new DatabaseSync(source,{readOnly:true});try{await backup(input,destination);}finally{input.close();}
 const db=new DatabaseSync(destination);let count=0;
 try{
  const oldKey=crypto.createHash('sha256').update(oldSecret).digest();const newKey=crypto.createHash('sha256').update(newSecret).digest();
  db.exec('BEGIN');
  for(const row of db.prepare("SELECT id,bank_details_encrypted FROM suppliers WHERE bank_details_encrypted IS NOT NULL AND bank_details_encrypted <> ''").all()){
   const parts=row.bank_details_encrypted.split(':');if(parts.length!==3)throw new Error('Invalid encrypted bank record');
   const decipher=crypto.createDecipheriv('aes-256-gcm',oldKey,Buffer.from(parts[0],'hex'));decipher.setAuthTag(Buffer.from(parts[2],'hex'));
   const plain=Buffer.concat([decipher.update(Buffer.from(parts[1],'hex')),decipher.final()]);JSON.parse(plain.toString('utf8'));
   const iv=crypto.randomBytes(12);const cipher=crypto.createCipheriv('aes-256-gcm',newKey,iv);const encrypted=Buffer.concat([cipher.update(plain),cipher.final()]);
   db.prepare('UPDATE suppliers SET bank_details_encrypted=? WHERE id=?').run([iv.toString('hex'),encrypted.toString('hex'),cipher.getAuthTag().toString('hex')].join(':'),row.id);count++;
  }
  db.exec('COMMIT');if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('Integrity check failed');db.close();fs.chmodSync(destination,0o600);return {success:true,records:count};
 }catch(error){try{db.exec('ROLLBACK');}catch{}try{db.close();}catch{}for(const suffix of ['','-wal','-shm'])fs.rmSync(destination+suffix,{force:true});throw error;}
}
if(require.main===module){const [, ,source,destination]=process.argv;if(!source||!destination){console.error('Usage: node scripts/rotate_bank_key.js SOURCE_DB NEW_DB (keys from environment)');process.exitCode=1;}else rotateBankKey(source,destination,process.env.OLD_BANK_ENCRYPTION_KEY,process.env.BANK_ENCRYPTION_KEY).then(result=>console.log(JSON.stringify(result))).catch(()=>{console.error('Key rotation failed; original database unchanged');process.exitCode=1;});}
module.exports={rotateBankKey};
