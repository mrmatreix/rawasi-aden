const router=require('express').Router();
const db=require('../database/db');
const {requirePermission,parseScopeArray}=require('../middleware/security');
const groups={direct:'التكاليف المباشرة (الثابتة)',indirect:'التكاليف غير المباشرة (المتغيرة)',shared:'التكاليف المشتركة (تكاليف الإدارة العامة)'};
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const handle=(res,error)=>res.status(error.statusCode||500).json({success:false,message:error.statusCode?error.message:'تعذر تنفيذ العملية'});
router.get('/work-items',requirePermission('projects:view'),async(req,res)=>{
 try{res.json({success:true,data:await db.query('SELECT * FROM work_item_catalog ORDER BY code,id'),groups,currencies:await db.query('SELECT code,symbol,rate_to_base FROM currencies')});}catch(error){handle(res,error);}
});
async function save(req,res){
 try{
  const id=req.params.id?Number(req.params.id):null;
  if(req.params.id&&(!Number.isInteger(id)||id<=0))throw fail('معرف البند غير صالح');
  const value=req.body||{};const code=String(value.code||'').trim(),name=String(value.name||'').trim(),group=value.cost_group;
  const parent=value.parent_id?Number(value.parent_id):null,rate=Number(value.reference_rate||0);
  if(!code||code.length>80||!name||name.length>250||!Object.hasOwn(groups,group)||!Number.isFinite(rate)||rate<0||(parent!==null&&(!Number.isInteger(parent)||parent<=0)))throw fail('تحقق من رقم البند واسمه وتصنيف التكلفة وسعره');
  const result=await db.transaction(async tx=>{
   const all=await tx.query('SELECT * FROM work_item_catalog');const existing=all.find(row=>Number(row.id)===id);
   if(id&&!existing)throw fail('البند غير موجود',404);
   if(all.some(row=>row.code===code&&Number(row.id)!==id))throw fail('رقم البند مستخدم بالفعل');
   let cursor=parent;const visited=new Set(id?[id]:[]);
   if(parent&&await tx.get('SELECT id FROM project_boq WHERE work_item_id=?',[parent]))throw fail('البند الأب مستخدم في جدول كميات؛ اختر بندًا تجميعيًا آخر');
   while(cursor){if(visited.has(cursor))throw fail('لا يمكن إنشاء دورة في شجرة البنود');visited.add(cursor);const row=all.find(row=>Number(row.id)===cursor);if(!row||row.cost_group!==group)throw fail('البند الأب يجب أن يكون من تصنيف التكلفة نفسه');cursor=Number(row.parent_id)||null;}
   if(existing&&existing.cost_group!==group&&all.some(row=>Number(row.parent_id)===id))throw fail('لا يمكن تغيير تصنيف بند له أبناء');
   const fields=[parent,code,name,group,String(value.unit||'').slice(0,40),rate,String(value.notes||''),value.status==='inactive'?'inactive':'active'];
   if(id){await tx.run('UPDATE work_item_catalog SET parent_id=?,code=?,name=?,cost_group=?,unit=?,reference_rate=?,notes=?,status=? WHERE id=?',[...fields,id]);return id;}
   const created=await tx.run('INSERT INTO work_item_catalog(parent_id,code,name,cost_group,unit,reference_rate,notes,status) VALUES (?,?,?,?,?,?,?,?)',fields);return Number(created.lastInsertRowid||created.insertId);
  });res.json({success:true,id:result});
 }catch(error){handle(res,error);}
}
router.post('/work-items',requirePermission('projects:create,projects:edit'),save);
router.put('/work-items/:id',requirePermission('projects:edit'),save);
router.delete('/work-items/:id',requirePermission('projects:cancel'),async(req,res)=>{
 try{await db.transaction(async tx=>{const id=Number(req.params.id);if(!await tx.get('SELECT id FROM work_item_catalog WHERE id=?',[id]))throw fail('البند غير موجود',404);if(await tx.get('SELECT id FROM work_item_catalog WHERE parent_id=?',[id])||await tx.get('SELECT id FROM project_boq WHERE work_item_id=?',[id]))throw fail('البند مرتبط بأبناء أو بجدول كميات؛ أوقفه بدل حذفه');await tx.run('DELETE FROM work_item_catalog WHERE id=?',[id]);});res.json({success:true});}catch(error){handle(res,error);}
});
router.get('/in-progress',requirePermission('projects:view,reports:view'),async(req,res)=>{
 try{
  const date=req.query.as_of_date||new Date().toISOString().slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw fail('تاريخ التقرير غير صالح');
  const allowed=req.user?.role==='admin'||req.user?.username==='admin'?['*']:parseScopeArray(req.user?.scope?.allowed_projects||req.user?.allowed_projects);
  const postedDb={query:(sql,args)=>db.query(sql.replace("je.status='posted'","je.status IN ('posted','closed')"),args)};
  const budget=await require('../services/projectBudgetReportService').getProjectBudget({as_of_date:date,allowedProjects:allowed},postedDb);
  const projects=await db.query('SELECT id,status,progress_percentage FROM projects');
  const statuses=new Map(projects.map(row=>[Number(row.id),row]));
  const active=['active','in_progress','جاري','جارية','قيد التنفيذ','تحت التنفيذ'];
  const rows=budget.data.projects.filter(row=>active.includes(statuses.get(Number(row.project_id))?.status)).map(row=>({...row,status:statuses.get(Number(row.project_id)).status,recorded_progress:Number(statuses.get(Number(row.project_id)).progress_percentage)||0,cost_completion:row.planned_cost>0?Math.min(100,Math.max(0,Math.round(row.actual_cost/row.planned_cost*10000)/100)):null}));
  res.json({success:true,data:rows,as_of_date:date,currency:'ر.ي',method:'نسبة التكلفة = التكلفة الفعلية المرحلة ÷ التكلفة التقديرية × 100، بحد أقصى 100%. لا تنشئ هذه النسبة إيرادًا أو قيدًا محاسبيًا. حالة المشروع ونسبة الإنجاز المسجلة تعكسان الوضع الحالي.'});
 }catch(error){handle(res,error);}
});
module.exports=router;
