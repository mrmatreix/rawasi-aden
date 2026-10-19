const definitions = { client: {table:'clients',prefix:'CL'}, supplier:{table:'suppliers',prefix:'SUP'} };
const statuses = {active:'نشط',inactive:'موقف',suspended:'معلق'};
function validateStatus(value) { if(!Object.hasOwn(statuses,value)) throw Object.assign(new Error('الحالة المسموحة: نشط، موقف، معلق'),{statusCode:400}); return value; }
async function initializePartyRegistry(db, mysql=false) {
 await db.run('CREATE TABLE IF NOT EXISTS party_sequences (kind VARCHAR(20) PRIMARY KEY,last_value INTEGER NOT NULL DEFAULT 0)');
 for(const [kind,definition] of Object.entries(definitions)) {
  const columns = mysql ? (await db.query('SHOW COLUMNS FROM '+definition.table)).map(row=>row.Field) : (await db.query('PRAGMA table_info('+definition.table+')')).map(row=>row.name);
  if(!columns.includes('party_no')) await db.run('ALTER TABLE '+definition.table+' ADD COLUMN party_no '+(mysql?'VARCHAR(30)':'TEXT'));
  if(kind==='client'&&!columns.includes('status')) await db.run("ALTER TABLE clients ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active'");
  const rows=await db.query('SELECT id,party_no FROM '+definition.table+' ORDER BY id');
  let maximum=0;
  for(const row of rows) {
   const number=row.party_no || definition.prefix+'-'+String(row.id).padStart(6,'0');
   if(!row.party_no) await db.run('UPDATE '+definition.table+' SET party_no=? WHERE id=?',[number,row.id]);
   maximum=Math.max(maximum,Number(String(number).split('-').pop())||0);
  }
  if(mysql) {
   const indices=await db.query('SHOW INDEX FROM '+definition.table+' WHERE Key_name = ?',['idx_'+definition.table+'_party_no']);
   if(!indices.length) await db.run('CREATE UNIQUE INDEX idx_'+definition.table+'_party_no ON '+definition.table+' (party_no)');
   await db.run('INSERT IGNORE INTO party_sequences(kind,last_value) VALUES (?,?)',[kind,maximum]);
  } else {
   await db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_'+definition.table+'_party_no ON '+definition.table+' (party_no)');
   await db.run('INSERT OR IGNORE INTO party_sequences(kind,last_value) VALUES (?,?)',[kind,maximum]);
  }
  await db.run('UPDATE party_sequences SET last_value=? WHERE kind=? AND last_value < ?',[maximum,kind,maximum]);
 }
}
async function nextPartyNumber(tx,kind) {
 if(!definitions[kind]) throw new Error('نوع السجل غير صالح');
 await tx.run('UPDATE party_sequences SET last_value=last_value+1 WHERE kind=?',[kind]);
 const row=await tx.get('SELECT last_value FROM party_sequences WHERE kind=?',[kind]);
 if(!row) throw new Error('تسلسل الأرقام غير مهيأ');
 return definitions[kind].prefix+'-'+String(row.last_value).padStart(6,'0');
}
function initializeSqlitePartyRegistry(database) {
 database.exec('CREATE TABLE IF NOT EXISTS party_sequences (kind VARCHAR(20) PRIMARY KEY,last_value INTEGER NOT NULL DEFAULT 0)');
 database.exec('SAVEPOINT party_registry_migration');
 try {
  for (const [kind, definition] of Object.entries(definitions)) {
   const columns = database.prepare('PRAGMA table_info(' + definition.table + ')').all().map(row => row.name);
   if (!columns.includes('party_no')) database.exec('ALTER TABLE ' + definition.table + ' ADD COLUMN party_no TEXT');
   if (kind === 'client' && !columns.includes('status')) database.exec("ALTER TABLE clients ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
   let maximum = 0;
   for (const row of database.prepare('SELECT id,party_no FROM ' + definition.table + ' ORDER BY id').all()) {
    const number = row.party_no || definition.prefix + '-' + String(row.id).padStart(6, '0');
    if (!row.party_no) database.prepare('UPDATE ' + definition.table + ' SET party_no=? WHERE id=?').run(number, row.id);
    maximum = Math.max(maximum, Number(String(number).split('-').pop()) || 0);
   }
   database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_' + definition.table + '_party_no ON ' + definition.table + ' (party_no)');
   database.prepare('INSERT OR IGNORE INTO party_sequences(kind,last_value) VALUES (?,?)').run(kind, maximum);
   database.prepare('UPDATE party_sequences SET last_value=? WHERE kind=? AND last_value < ?').run(maximum, kind, maximum);
  }
  database.exec('RELEASE party_registry_migration');
 } catch (error) {
  database.exec('ROLLBACK TO party_registry_migration');
  database.exec('RELEASE party_registry_migration');
  throw error;
 }
}
module.exports={initializeSqlitePartyRegistry,initializePartyRegistry,nextPartyNumber,validateStatus,statuses};
