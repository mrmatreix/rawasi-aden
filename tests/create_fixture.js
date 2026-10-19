// Synthetic fixture only. No customer database is read or seeded.
const fs = require('node:fs');
if (!process.env.RAWASI_DB_PATH || fs.existsSync(process.env.RAWASI_DB_PATH)) throw new Error('A new disposable RAWASI_DB_PATH is required');
process.env.NODE_ENV='development'; process.env.DB_ENGINE='sqlite';
(async()=>{
 const db=require('../server/database/db');await db.ready;
 await db.run("INSERT INTO users(username,password_hash,full_name,role,status,two_factor_enabled) VALUES ('admin',?,'Synthetic administrator','admin','active',0)",[require('bcryptjs').hashSync(require('node:crypto').randomUUID(),4)]);
 const codes=['1','11','111','11101','11101001','11102','11102001','11102002','12','123','12301','12301001','114','11401','11401001','121','12101','12101002','2','22','221','22101','22101001','22101001','3','31','311','31101','31101001','32','321','32102','32102001','4','41','411','41101','41101001'];
 const ids=new Map();
 for(const code of new Set(codes)){
  const parent=[...ids.keys()].filter(p=>code.startsWith(p)&&p!==code).sort((a,b)=>b.length-a.length)[0];
  const level=code.length===1?1:code.length===2?2:code.length===3?3:code.length===5?4:5;
  const type=code[0]==='3'?'expense':code[0]==='4'?'revenue':code[0]==='2'?'liability':'asset';
  const analytical=code.startsWith('11101')?'cash':code.startsWith('11102')?'bank':'general';
  const name=code==='11101001'?'الصندوق التجريبي':code.startsWith('11102')?'البنوك التجريبية':'حساب تجريبي '+code;
  const row=await db.run('INSERT INTO accounts(code,name,type,parent_id,level,is_posting,status,analytical_type) VALUES (?,?,?,?,?,?,?,?)',[code,name,type,ids.get(parent)||null,level,level===5?1:0,'active',analytical]);ids.set(code,row.lastInsertRowid);
 }
 await db.run("INSERT INTO clients(name) VALUES ('Synthetic client')");
 await db.run("INSERT INTO suppliers(name,company_name) VALUES ('Synthetic supplier','Synthetic supplier')");
 await db.run("INSERT INTO cost_centers(code,name,type,status) VALUES ('CC-TEST','Synthetic center','عام','active')");
 if(process.env.TEST_SCHEMA_REPORT){const tables=await db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");const schema={};for(const row of tables)schema[row.name]=(await db.query('PRAGMA table_info('+row.name+')')).map(c=>c.name);fs.writeFileSync(process.env.TEST_SCHEMA_REPORT,JSON.stringify(schema,null,2));}
 await db.closeDatabase();
})().catch(error=>{console.error(error);process.exitCode=1;});
