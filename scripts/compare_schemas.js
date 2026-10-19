const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const {spawnSync}=require('node:child_process');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'rawasi-schema-'));const report=path.join(temp,'schema.json');
try{
 const result=spawnSync(process.execPath,['tests/create_fixture.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,NODE_ENV:'development',DB_ENGINE:'sqlite',RAWASI_DB_PATH:path.join(temp,'new.db'),TEST_SCHEMA_REPORT:report},encoding:'utf8',windowsHide:true});
 if(result.status!==0)throw new Error(result.stderr);
 const sqlite=JSON.parse(fs.readFileSync(report,'utf8'));const source=fs.readFileSync(path.join(__dirname,'../server/database/schema_mysql.sql'),'utf8');const mysql={};
 for(const match of source.matchAll(/CREATE TABLE IF NOT EXISTS\s+`?(\w+)`?\s*\(([\s\S]*?)\)\s*(?:ENGINE|;)/gi)){
  mysql[match[1]]=[...match[2].matchAll(/^\s*`?(\w+)`?\s+(?:INT(?:EGER)?|BIGINT|TINYINT|SMALLINT|VARCHAR|TEXT|LONGTEXT|CHAR|DECIMAL|NUMERIC|DOUBLE|FLOAT|REAL|DATE|DATETIME|TIMESTAMP|BOOLEAN|JSON)\b/gmi)].map(m=>m[1]);
 }
 const missing=Object.keys(sqlite).filter(table=>!mysql[table]);const differences=Object.keys(sqlite).filter(table=>mysql[table]).map(table=>({table,missing:sqlite[table].filter(c=>!mysql[table].includes(c))})).filter(row=>row.missing.length);
 const output=['# مقارنة المخططين — 2026-10-19','','هذه مقارنة بنيوية بين قاعدة SQLite تجريبية أُنشئت من الكود الحالي وملف schema_mysql.sql. ليست نتيجة تشغيل MySQL أو ضمان توافق الاستعلامات. قد تضيف ترحيلات MySQL المضمنة جداول أخرى؛ لذلك يجب اختبار ناتج تشغيلها أيضاً.','',`- جداول SQLite بعد التهيئة: ${Object.keys(sqlite).length}.`,`- الجداول المعلنة في schema_mysql.sql: ${Object.keys(mysql).length}.`,`- جداول SQLite غير المعلنة في ملف MySQL: ${missing.length}.`,'','## جداول تحتاج مراجعة','','`'+missing.join('`, `')+'`','','## أعمدة غير معلنة في ملف MySQL','','| الجدول | الأعمدة |','|---|---|',...differences.map(row=>'| '+row.table+' | '+row.missing.join(', ')+' |'),'','القرار: إبقاء SQLite مؤقتاً، وعدم ترحيل الإنتاج إلى MySQL قبل نجاح اختبارات مخططه الفعلي والمعاملات والتقارير ونقل البيانات.',''].join('\n');
 fs.mkdirSync(path.resolve(__dirname,'../docs/security'),{recursive:true});fs.writeFileSync(path.resolve(__dirname,'../docs/security/SCHEMA_COMPARISON_AR.md'),output);console.log('Schema comparison written; SQLite tables: '+Object.keys(sqlite).length+', MySQL declarations: '+Object.keys(mysql).length);
}finally{fs.rmSync(temp,{recursive:true,force:true});}
