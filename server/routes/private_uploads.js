const router=require('express').Router();
const path=require('node:path');
const config=require('../config/environment');
const {safePath}=require('../middleware/fileAccess');
const {requireAuth,requirePermission}=require('../middleware/security');
const {requireClientAuth,CLIENT_JWT_SECRET}=require('../middleware/client_auth');
const jwt=require('jsonwebtoken');
const db=require('../database/db');
router.use((req,res,next)=>{
 const token=(req.headers.authorization||'').replace(/^Bearer /,'');
 try {const decoded=jwt.verify(token,CLIENT_JWT_SECRET,{algorithms:['HS256']});if(decoded.type==='client')return requireClientAuth(req,res,next);}catch{}
 return requireAuth(req,res,next);
});
router.get('/service_requests/:name',async(req,res)=>{
 try {
  const file=safePath(path.join(config.storage.uploads,'service_requests'),req.params.name);
  const requests=await db.query('SELECT id,client_user_id,attachments FROM service_requests WHERE attachments IS NOT NULL');
  const record=requests.find(row=>{try{return JSON.parse(row.attachments).some(att=>att.diskFileName===req.params.name||att.url==='/uploads/service_requests/'+req.params.name);}catch{return false;}});
  if(!record)return res.sendStatus(404);
  if(req.clientUser){if(record.client_user_id!==req.clientUser.id)return res.sendStatus(403);}
  else {let permitted=false;requirePermission('settings:users')(req,{status(){return this;},json(){return this;}},()=>{permitted=true;});if(!permitted)return res.sendStatus(403);}
  res.set({'Content-Type':'application/octet-stream','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(req.params.name),'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});
  res.sendFile(file);
 }catch(error){res.sendStatus(error.statusCode||404);}
});
router.use((_req,res)=>res.sendStatus(404));
module.exports=router;
