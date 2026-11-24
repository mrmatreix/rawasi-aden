// Restore to a NEW, isolated directory. Never overwrites a running installation.
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const {DatabaseSync}=require('node:sqlite');
function restoreBundle(archive,destination){
 const target=path.resolve(destination);
 if(fs.existsSync(target))throw new Error('Restore destination must not exist; use a new isolated directory');
 const zip=new(require('adm-zip'))(archive);const entries=zip.getEntries();let total=0;
 for(const entry of entries){
  const name=entry.entryName.replaceAll('\\','/');total+=entry.header.size;
  if(total>512*1024*1024)throw new Error('Restore exceeds the 512 MB safety limit');
  if(name.startsWith('/')||name.split('/').some(p=>p==='..'||p.includes(':'))||! /^(?:manifest\.json|database\/rawasi_aden\.db|uploads\/.*|ملفات_المشاريع\/.*)$/.test(name))throw new Error('Unsafe or unsupported archive path');
 }
 const database=zip.getEntry('database/rawasi_aden.db');if(!database)throw new Error('Database missing');
 const manifest=JSON.parse(zip.readAsText('manifest.json'));
 const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
 if(hash(database.getData())!==manifest.db_sha256)throw new Error('Database hash mismatch');
 fs.mkdirSync(target,{recursive:false});
 try{
  for(const entry of entries){
   if(entry.isDirectory)continue;
   const bytes=entry.getData();
   if(manifest.file_hashes?.[entry.entryName]&&hash(bytes)!==manifest.file_hashes[entry.entryName])throw new Error('Attachment hash mismatch');
   const relative=entry.entryName==='database/rawasi_aden.db'?'rawasi_aden.db':entry.entryName.replace(/^ملفات_المشاريع\//,'projects/');
   const file=path.resolve(target,relative);const rel=path.relative(target,file);
   if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw new Error('Unsafe restore path');
   fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});
  }
  const db=new DatabaseSync(path.join(target,'rawasi_aden.db'),{readOnly:true});
  try{
   if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('Integrity check failed');
   if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Foreign key check failed');
   if(db.prepare('SELECT entry_id FROM journal_entry_lines GROUP BY entry_id HAVING ABS(SUM(debit)-SUM(credit))>0.05 LIMIT 1').get())throw new Error('Unbalanced journal');
  }finally{db.close();}
  return {success:true,files:entries.filter(e=>!e.isDirectory).length};
 }catch(error){fs.rmSync(target,{recursive:true,force:true});throw error;}
}
if(require.main===module){try{const [, ,archive,destination]=process.argv;if(!archive||!destination)throw new Error('Usage: node scripts/restore_bundle.js archive.zip NEW_DIRECTORY');console.log(JSON.stringify(restoreBundle(archive,destination)));}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={restoreBundle};
