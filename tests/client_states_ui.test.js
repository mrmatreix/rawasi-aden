const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');

test('client app loading, empty and error states are escaped and never leave a spinner behind',()=>{
 const context={window:{},document:{getElementById:()=>null}};vm.createContext(context);
 vm.runInContext(fs.readFileSync(path.join(root,'client-app','www','js','client-app.js'),'utf8'),context);
 const app=context.window.ClientApp;
 const empty=app.emptyState({icon:'fa-inbox',title:'<img src=x onerror=1>',text:'"quoted"',actionHref:'services.html',actionLabel:'طلب'});
 assert.ok(!empty.includes('<img'));assert.ok(empty.includes('&lt;img'));assert.ok(empty.includes('&quot;quoted&quot;'));assert.ok(empty.includes('href="services.html"'));
 const error=app.errorState('<b>x</b>');assert.ok(error.includes('&lt;b&gt;'));assert.ok(error.includes('role="alert"'));
 assert.match(app.skeletonCards(2),/aria-busy="true"/);
 // لا تبقى أيقونة التحميل الدوارة في صفحات القوائم، ولكل صفحة قائمة حالة خطأ
 for(const page of ['invoices','messages','notifications','payments','projects','service-requests']){
  const html=fs.readFileSync(path.join(root,'client-app','www',page+'.html'),'utf8');
  assert.ok(!/fa-spinner fa-spin[^]*?جاري تحميل/.test(html.split('<script')[0]),page+' still shows a spinner placeholder');
  assert.match(html,/class="sk-list"/,page+' has no skeleton');
  assert.match(html,/ClientApp\.errorState\(/,page+' has no error state');
 }
});
