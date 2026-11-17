const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('cash projection UI uses the selected period, shows results and errors, and guards regeneration',async()=>{
 const ids=['cfMonthFrom','cfMonthTo','cfKpiInitialCash','cfKpiTotalIn','cfKpiTotalOut','cfKpiNetCash','cashFlowMonthsTableBody','cfScenariosWrap','cfProjectionNotice','cfRegenerateButton'];
 const elements=Object.fromEntries(ids.map(id=>[id,{value:'',textContent:'',innerHTML:'',style:{}}]));
 elements.cfMonthFrom.value='2097-01';elements.cfMonthTo.value='2097-02';
 const calls=[],toasts=[];let fail=false,postResolve;
 const context={URLSearchParams,Date,console:{error(){}},window:{},document:{getElementById:id=>elements[id]},App:{formatNumber:n=>Number(n).toLocaleString('en-US'),showToast:(...args)=>toasts.push(args)},fetch:async(url,options)=>{
  calls.push(url);if(options?.method==='POST')return new Promise(resolve=>postResolve=resolve);
  const scenario={name:'اختبار',description:'فترة',final_balance:260};
  return {ok:!fail,json:async()=>fail?{success:false,message:'فترة غير صالحة'}:{success:true,initial_cash:0,total_collections:300,total_payments:40,total_net_cash_flow:260,months:[{period:'2097-01',expected_collections:300,expected_payments:40,net_cash_flow:260,cumulative_balance:260,breakdown:{by_type:{ipc_collections:300,vendor_payments:40,salaries:0}}}],scenarios:{realistic:scenario,optimistic:scenario,pessimistic:scenario}}};
 }};
 vm.createContext(context);vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../js/contracts_cashflow.js'),'utf8'),context);
 const ui=context.window.CashFlowUI;await ui.init();
 assert.ok(calls[1].includes('from=2097-01&to=2097-02'));assert.ok(elements.cashFlowMonthsTableBody.innerHTML.includes('300'));assert.ok(!elements.cashFlowMonthsTableBody.innerHTML.includes('$'));assert.ok(elements.cfKpiTotalIn.textContent.includes('ر.ي'));assert.ok(elements.cfScenariosWrap.innerHTML.includes('260'));
 fail=true;await ui.loadProjections();assert.equal(ui.data,null);assert.ok(elements.cashFlowMonthsTableBody.innerHTML.includes('تعذر تحميل'));assert.equal(elements.cfKpiTotalIn.textContent,'—');assert.ok(toasts.length);
 const first=ui.regenerate();await ui.regenerate();assert.equal(calls.filter(url=>url.includes('regenerate')).length,1);assert.equal(elements.cfRegenerateButton.disabled,true);
 postResolve({ok:false,json:async()=>({success:false,message:'تعذر الحساب'})});await first;assert.equal(elements.cfRegenerateButton.disabled,false);assert.equal(toasts.at(-1)[0],'تعذر الحساب');
});
