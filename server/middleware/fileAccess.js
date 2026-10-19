const fs=require('node:fs');
const path=require('node:path');
const config=require('../config/environment');
function safePath(base, candidate, {existing=true}={}) {
  const resolved=path.resolve(base,candidate);
  if(!config.contained(base,resolved)) throw Object.assign(new Error('مسار الملف غير مسموح'),{statusCode:403});
  if (!existing && fs.existsSync(resolved) && fs.lstatSync(resolved).isSymbolicLink()) throw Object.assign(new Error('الروابط الرمزية غير مسموحة للكتابة'),{statusCode:403});
  if(existing){const realBase=fs.realpathSync(base);const real=fs.realpathSync(resolved);if(!config.contained(realBase,real)||!fs.statSync(real).isFile())throw Object.assign(new Error('الملف غير مسموح'),{statusCode:403});return real;}
  let parent=path.dirname(resolved);while(!fs.existsSync(parent)&&parent!==path.dirname(parent))parent=path.dirname(parent);
  if(fs.existsSync(base)&&!config.contained(fs.realpathSync(base),fs.realpathSync(parent)))throw Object.assign(new Error('مسار الملف غير مسموح'),{statusCode:403});
  return resolved;
}
function publicFiles(app){
  const express=require('express');const root=config.rootDir;
  const publicExtension=/\.(?:html|css|js|png|jpg|jpeg|webp|gif|svg|ico|woff2?|ttf|webmanifest|map)$/i;
  function guard(req,res,next){if(!publicExtension.test(req.path)||req.path.split('/').some(p=>p.startsWith('.')))return res.sendStatus(404);next();}
  for(const dir of ['css','js','images','assets','views'])app.use('/'+dir,guard,express.static(path.join(root,dir),{dotfiles:'deny',index:false,fallthrough:false}));
  for(const file of ['index.html','manifest.json','sw.js','offline.html','favicon.ico'])app.get('/'+file,(req,res)=>{const target=path.join(root,file);if(!fs.existsSync(target))return res.sendStatus(404);if(file==='sw.js')res.set('Cache-Control','no-cache');res.sendFile(target);});
  app.get('/',(_req,res)=>res.sendFile(path.join(root,'index.html')));
  app.use('/client-app',express.static(path.join(root,'client-app/www'),{dotfiles:'deny',fallthrough:false}));
}
module.exports={safePath,publicFiles};
