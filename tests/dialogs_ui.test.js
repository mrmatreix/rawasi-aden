const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');

function walk(dir,out=[]){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory()){if(!/^(?:node_modules|android|ios|scratch)$/.test(e.name))walk(p,out);}else if(/\.(?:js|html)$/.test(e.name))out.push(p);}return out;}

test('browser confirm dialogs are replaced by the shared UIDialog in the system and client app',()=>{
 const files=[path.join(root,'index.html'),...walk(path.join(root,'js')),...walk(path.join(root,'views')),...walk(path.join(root,'client-app','www'))].filter(f=>!/xlsx\.full\.min\.js$|[\\/]dialogs\.js$/.test(f));
 const offenders=[];
 for(const f of files){const lines=fs.readFileSync(f,'utf8').split(/\r?\n/);lines.forEach((line,i)=>{if(/(?<![\w.$])confirm\(/.test(line))offenders.push(path.relative(root,f)+':'+(i+1));});}
 assert.deepEqual(offenders,[],'native confirm() still used');
 const source=fs.readFileSync(path.join(root,'js','dialogs.js'),'utf8');
 assert.equal(fs.readFileSync(path.join(root,'client-app','www','js','dialogs.js'),'utf8'),source,'client-app copy of dialogs.js is out of date');
 assert.match(fs.readFileSync(path.join(root,'index.html'),'utf8'),/<script src="js\/dialogs\.js/);
 assert.match(fs.readFileSync(path.join(root,'views','client_users.html'),'utf8'),/<script src="\/js\/dialogs\.js"/);
 for(const page of fs.readdirSync(path.join(root,'client-app','www')).filter(n=>n.endsWith('.html')))
  assert.match(fs.readFileSync(path.join(root,'client-app','www',page),'utf8'),/<script src="js\/dialogs\.js"/,page+' does not load dialogs.js');
 // الرسالة تُعرض كنص فقط
 assert.ok(!/innerHTML/.test(source));
});
