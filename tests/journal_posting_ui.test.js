const {test}=require('node:test');const assert=require('node:assert/strict');
const Accounting=require('../js/accounting');global.Accounting=Accounting;require('../js/journal-posting');

test('register PDF and Excel include every row, preserve codes, escape text and separate currencies',async()=>{
 const area={innerHTML:''};let printed=0;let workbook;
 global.document={getElementById:()=>area};global.window={print:()=>printed++};global.App={showToast(){},formatNumber:String};
 global.XLSX={utils:{book_new:()=>({sheets:[]}),json_to_sheet:rows=>rows,book_append_sheet:(book,rows,name)=>book.sheets.push({rows,name})},writeFile:book=>{workbook=book;}};
 const vouchers=Array.from({length:26},(_,i)=>({receipt_no:'RC-'+String(i).padStart(4,'0'),date:'2099-01-15',account_code:'00123',amount:i===25?50:10,currency:i===25?'USD':'YER',notes:'<script>bad</script>',status:'draft'}));
 global.fetch=async()=>({ok:true,json:async()=>({success:true,data:vouchers})});
 try{
  await Accounting.exportVoucherRegister('receipt','excel');assert.equal(workbook.sheets[0].rows.length,26);assert.equal(workbook.sheets[0].rows[0]['رقم الحساب'],'00123');assert.equal(typeof workbook.sheets[0].rows[0]['المبلغ'],'number');assert.deepEqual(workbook.sheets[1].rows.map(r=>r['إجمالي مبالغ السجل']),[250,50]);
  await Accounting.exportVoucherRegister('expense','pdf');assert.equal(printed,1);assert(area.innerHTML.includes('RC-0025'));assert(!area.innerHTML.includes('<script>bad'));assert(area.innerHTML.includes('&lt;script&gt;bad'));
 }finally{for(const key of ['document','window','App','fetch','XLSX'])delete global[key];}
});

test('posting selection handles partial failure once and releases controls',async()=>{
 const result={textContent:''};const button={disabled:false};let refreshed=0;let requests=0;let release;
 const previousLoad=Accounting.loadPostingJournals,previousCash=Accounting.loadCashMovement;
 global.document={querySelectorAll:()=>[button],getElementById:()=>result};global.App={showToast(){},loadCashTable:async()=>{}};
 Accounting.loadPostingJournals=async()=>{refreshed++;};Accounting.loadCashMovement=async()=>{};
 global.fetch=async()=>{requests++;if(requests===1)await new Promise(resolve=>{release=resolve;});return {ok:requests===1,json:async()=>({success:requests===1,message:'rejected'})};};
 try{
  const pending=Accounting.executeJournalPosting('post',[1,2]);assert.equal(button.disabled,true);await Accounting.executeJournalPosting('post',[1,2]);assert.equal(requests,1);release();await pending;
  assert.equal(requests,2);assert.equal(refreshed,1);assert.equal(button.disabled,false);assert(result.textContent.includes('نجحت 1'));assert(result.textContent.includes('#2: rejected'));
 }finally{Accounting.loadPostingJournals=previousLoad;Accounting.loadCashMovement=previousCash;for(const key of ['document','App','fetch'])delete global[key];}
});
