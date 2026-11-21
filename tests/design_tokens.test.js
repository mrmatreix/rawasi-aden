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
