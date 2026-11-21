const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');

test('text colors use the unified design tokens so they stay readable in light and dark mode',()=>{
 const css=fs.readFileSync(path.join(root,'css','style.css'),'utf8');
 for(const token of ['--color-success','--color-danger','--color-warning','--color-info'])
  assert.ok((css.match(new RegExp(token+'\\s*:','g'))||[]).length>=2,token+' must be defined for dark and light mode');
 const run=spawnSync(process.execPath,[path.join(root,'scripts','apply_design_tokens.js'),'--check'],{encoding:'utf8'});
 assert.equal(run.status,0,'hard-coded dark-theme text colors found; run: node scripts/apply_design_tokens.js\n'+run.stdout);
});

test('every btn-* class used in the UI is defined by the unified button system',()=>{
 const css=fs.readFileSync(path.join(root,'css','style.css'),'utf8');
 const sources=['index.html',...fs.readdirSync(path.join(root,'js')).filter(f=>f.endsWith('.js')).map(f=>'js/'+f)];
 const used=new Set();
 for(const rel of sources){
  const src=fs.readFileSync(path.join(root,rel),'utf8');
  for(const m of src.matchAll(/class="([^"]*)"/g)) for(const c of m[1].split(/\s+/)) if(/^btn-[\w-]+$/.test(c)) used.add(c);
 }
 const missing=[...used].filter(c=>!new RegExp('\\.'+c.replace(/-/g,'\\-')+'(?![\\w-])').test(css));
 assert.deepEqual(missing,[],'button classes used without a definition in css/style.css');
 for(const size of ['btn-xs','btn-sm','btn-lg']) assert.ok(used.has(size)||css.includes('.'+size),size);
});

test('buttons do not repaint themselves with inline gradients instead of a variant class',()=>{
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const painted=[...html.matchAll(/<button\b[^<>]*class="[^"]*\bbtn\b[^"]*"[^<>]*style="[^"]*background:\s*linear-gradient\(135deg,\s*#(?:059669|10b981|b91c1c|ef4444|2563eb)/g)];
 assert.equal(painted.length,0,'use btn-success / btn-danger / btn-info');
});
