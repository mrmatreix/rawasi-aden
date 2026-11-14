const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs'); const assert=require('node:assert/strict');
(async()=>{ const db=new PGlite(); try {
 await db.exec(fs.readFileSync(require('node:path').join(__dirname,'../prisma/migrations/20261114000000_initial/migration.sql'),'utf8'));
 const ids=Array.from({length:24},(_,i)=>`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
 const q=async(sql,params=[])=>db.query(sql,params);
 await q('INSERT INTO roles (id,code,name,updated_at) VALUES ($1,$2,$3,now())',[ids[0],'SUPERVISOR_VENDOR','Vendor']);
 await q('INSERT INTO users (id,full_name,username,password_hash,role_id,updated_at) VALUES ($1,$2,$3,$4,$5,now())',[ids[1],'Vendor','vendor','hash',ids[0]]);
 await q('INSERT INTO regions (id,code,name,updated_at) VALUES ($1,$2,$3,now())',[ids[2],'ADEN','Aden']);
 await q('INSERT INTO service_categories (id,code,name,updated_at) VALUES ($1,$2,$3,now())',[ids[3],'MAINT','Maintenance']);
 await q('INSERT INTO services (id,code,name,category_id,updated_at) VALUES ($1,$2,$3,$4,now())',[ids[4],'AC','Air',ids[3]]);
 const vendor='INSERT INTO vendors (id,user_id,company_name,supervisor_name,region_id,category_id,contract_type,contract_start_date,contract_end_date,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())';
 await assert.rejects(q(vendor,[ids[5],ids[1],'Vendor','Supervisor',ids[2],ids[3],'LABOR_ONLY','2026-01-01','2027-01-01']),/vendor_contract_term/);
 await q(vendor,[ids[5],ids[1],'Vendor','Supervisor',ids[2],ids[3],'LABOR_ONLY','2026-01-01','2029-01-01']);
 const rate='INSERT INTO vendor_rate_cards (id,vendor_id,region_id,service_id,agreed_base_cost,max_base_cost,rawasi_markup_percent,currency,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())';
 await assert.rejects(q(rate,[ids[6],ids[5],ids[2],ids[4],100,99,.3,'YER']),/rate_card_costs/);
 await q(rate,[ids[6],ids[5],ids[2],ids[4],100,150,.3,'YER']);
 await q('INSERT INTO vendor_workers (id,vendor_id,category_id,full_name,employee_number,national_id_number,identity_image_key,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now())',[ids[7],ids[5],ids[3],'Worker','W1','ID','private/one']);
 await q('INSERT INTO orders (id,order_number,client_id,region_id,service_id,vendor_id,worker_id,description,sla_deadline_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now(),now())',[ids[8],'ORD-1',ids[1],ids[2],ids[4],ids[5],ids[7],'Order']);
 const invalid='INSERT INTO orders (id,order_number,client_id,region_id,service_id,worker_id,description,sla_deadline_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now(),now())';
 await assert.rejects(q(invalid,[ids[9],'ORD-2',ids[1],ids[2],ids[4],ids[7],'Order']),/order_worker_vendor/);
 const cost='INSERT INTO order_cost_items (id,order_id,quote_version,item_type,description,vendor_cost,client_price,markup_percent,currency,updated_at) VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8,now())';
 await assert.rejects(q(cost,[ids[10],ids[8],'EXTRA',' ',10,13,.3,'YER']),/order_cost_extra_description/);
 await q(cost,[ids[10],ids[8],'EXTRA','transport',10,13,.3,'YER']);
 await q('INSERT INTO inventory_items (id,sku,name,unit,updated_at) VALUES ($1,$2,$3,$4,now())',[ids[11],'SKU-1','Part','piece']);
 const custody='INSERT INTO custody_transactions (id,vendor_id,order_id,item_id,type,quantity,reference_no,created_by_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)';
 await q(custody,[ids[12],ids[5],ids[8],ids[11],'ISSUE',1,'C-1',ids[1]]);
 await assert.rejects(q(custody,[ids[13],ids[5],ids[8],ids[11],'ISSUE',0,'C-2',ids[1]]),/custody_quantity_positive/);
 await q('INSERT INTO users (id,full_name,username,password_hash,role_id,updated_at) VALUES ($1,$2,$3,$4,$5,now())',[ids[14],'Other','other','hash',ids[0]]);
 await q(vendor,[ids[15],ids[14],'Other','Supervisor',ids[2],ids[3],'FULL_SERVICE','2026-01-01','2029-01-01']);
 await assert.rejects(q(custody,[ids[13],ids[15],ids[8],ids[11],'ISSUE',1,'C-3',ids[1]]),/Custody requires/);
 // Composite foreign key prevents a vendor using a worker from another vendor.
 await assert.rejects(q('INSERT INTO orders (id,order_number,client_id,region_id,service_id,vendor_id,worker_id,description,sla_deadline_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now(),now())',[ids[16],'ORD-OTHER',ids[1],ids[2],ids[4],ids[15],ids[7],'Order']),/orders_worker_id_vendor_id_fkey/);
 // A low quarterly rating must be storable for later alerts, while invalid scores are rejected.
 const rating='INSERT INTO vendor_quarterly_ratings (id,vendor_id,year,quarter,rating,sample_count,measured_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,now(),now())';
 await q(rating,[ids[17],ids[5],2026,1,3.8,5]);
 await assert.rejects(q(rating,[ids[18],ids[5],2026,2,5.1,5]),/vendor_rating_range/);
 await assert.rejects(q(rating,[ids[18],ids[5],2026,5,4.0,5]),/vendor_rating_period/);
 await assert.rejects(q(rating,[ids[18],ids[5],2026,1,4.0,5]),/vendor_quarterly_ratings_vendor_id_year_quarter_key/);
 // The system must persist hidden initial pricing and opt-in budgets safely by default.
 const flags=await q('SELECT hide_initial_price,allow_client_budget FROM services WHERE id=$1',[ids[4]]);
 assert.equal(flags.rows[0].hide_initial_price,true); assert.equal(flags.rows[0].allow_client_budget,false);
 await assert.rejects(q(rate,[ids[19],ids[15],ids[2],ids[4],100,150,1.01,'YER']),/rate_card_markup/);


 const {IssueCustodyUseCase}=await import('../src/features/inventory/application/issue-custody.ts');
 const useCase=new IssueCustodyUseCase({transaction:fn=>db.transaction(tx=>fn({query:(sql,params)=>tx.query(sql,params)}))});
 const principal={userId:ids[1],role:'SUPER_ADMIN',isActive:true};
 await q('UPDATE inventory_items SET available_quantity=10 WHERE id=$1',[ids[11]]);
 const issue={id:ids[19],vendorId:ids[5],orderId:ids[8],itemId:ids[11],referenceNo:'ATOMIC-1',quantity:'3'};
 assert.equal((await useCase.execute(principal,issue)).remainingQuantity,'7.000');
 await assert.rejects(useCase.execute(principal,{...issue,id:ids[20]}),/duplicate key/);
 assert.equal((await q('SELECT available_quantity::text AS qty FROM inventory_items WHERE id=$1',[ids[11]])).rows[0].qty,'7.000');
 await assert.rejects(useCase.execute(principal,{...issue,id:ids[21],referenceNo:'ATOMIC-2',quantity:'8'}),/الرصيد/);
 await assert.rejects(useCase.execute(principal,{...issue,id:ids[21],referenceNo:'ATOMIC-3',vendorId:ids[15]}),/Custody requires/);
 assert.equal((await q('SELECT available_quantity::text AS qty FROM inventory_items WHERE id=$1',[ids[11]])).rows[0].qty,'7.000');
 await assert.rejects(useCase.execute({...principal,role:'CLIENT'},{...issue,id:ids[22],referenceNo:'ATOMIC-4'}));
 const concurrent=await Promise.allSettled([
   useCase.execute(principal,{...issue,id:ids[22],referenceNo:'RACE-1',quantity:'6'}),
   useCase.execute(principal,{...issue,id:ids[23],referenceNo:'RACE-2',quantity:'6'})
 ]);
 assert.equal(concurrent.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(concurrent.filter(x=>x.status==='rejected').length,1);
 assert.equal((await q('SELECT available_quantity::text AS qty FROM inventory_items WHERE id=$1',[ids[11]])).rows[0].qty,'1.000');

 console.log('Migration applied to isolated PostgreSQL-compatible PGlite; contract, pricing, role-independent worker assignment, ratings, service defaults and custody constraints passed.');
 } finally { await db.close(); }})().catch(e=>{console.error(e);process.exitCode=1});
