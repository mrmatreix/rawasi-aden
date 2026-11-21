const { test } = require('node:test');
const assert = require('node:assert/strict');
const Accounting = require('../js/accounting');

test('saving immediately locks every form, blocks double submit, and preserves the retry key', async () => {
  const storage = new Map();
  global.sessionStorage = { getItem: key => storage.get(key) || null, setItem: (key,value) => storage.set(key,value), removeItem: key => storage.delete(key) };
  const button = { disabled: false, innerHTML: 'حفظ', textContent: '' };
  const input = { id: 'amount', value: '100', files: [] };
  global.document = { getElementById: () => ({ querySelectorAll: selector => selector === '[type="submit"]' ? [button] : [input] }) };
  try {
    for (const form of ['modalReceiptForm','quickReceiptForm','modalExpenseForm','quickExpenseForm','modalJournalForm']) {
      let release; let calls=0;
      const operation = () => { calls++; return new Promise(resolve => { release=resolve; }); };
      const pending = Accounting.withFinancialSave(form, operation);
      assert.equal(button.disabled,true);
      await Accounting.withFinancialSave(form, operation);
      assert.equal(calls,1);
      const firstKey=Accounting.financialSaveKey(form);
      release();await pending;
      assert.equal(button.disabled,false);assert.equal(button.innerHTML,'حفظ');
      await Accounting.withFinancialSave(form, async()=>assert.equal(Accounting.financialSaveKey(form),firstKey));
      input.value='101';
      await Accounting.withFinancialSave(form, async()=>assert.notEqual(Accounting.financialSaveKey(form),firstKey));
      await assert.rejects(Accounting.withFinancialSave(form, async()=>{throw Error('network lost');}));
      assert.equal(button.disabled,false);
      const oldKey=Accounting.financialSaveKey(form);
      Accounting.completeFinancialSave(form);
      await Accounting.withFinancialSave(form, async()=>assert.notEqual(Accounting.financialSaveKey(form),oldKey));
      input.value='100';
    }
  } finally { delete global.document;delete global.sessionStorage; }
});

test('draft deletion follows user permission and refreshes the matching register', async()=>{
  const notices=[];const requested=[];const refreshed=[];
  global.Auth={hasPermission:permission=>permission==='expenses:cancel'};
  assert(Accounting.draftDeleteButton('expense',1).includes('حذف المسودة'));
  assert.equal(Accounting.draftDeleteButton('receipt',1),'');
  global.confirm=()=>true;
  global.fetch=async(url,options)=>{requested.push([url,options.method]);return {ok:true,json:async()=>({success:true,message:'deleted'})};};
  global.App={showToast:(...args)=>notices.push(args),closeModal(){},loadExpensesTable:async()=>refreshed.push('expense'),loadRevenuesTable:async()=>refreshed.push('receipt')};
  const original=Accounting.loadJournalEntries;
  Accounting.loadJournalEntries=async()=>refreshed.push('journal');
  try {
    for(const kind of ['expense','receipt','journal'])await Accounting.deleteDraft(kind,5);
    assert.deepEqual(requested,[['/api/expenses/5','DELETE'],['/api/payments/5','DELETE'],['/api/accounting/journal-entries/5','DELETE']]);
    assert.deepEqual(refreshed,['expense','receipt','journal']);
    global.fetch=async()=>({ok:false,json:async()=>({success:false,message:'posted protected'})});
    await Accounting.deleteDraft('expense',6);assert.deepEqual(notices.at(-1),['posted protected','error']);
    global.confirm=()=>false;const before=requested.length;await Accounting.deleteDraft('journal',7);assert.equal(requested.length,before);
  }finally{Accounting.loadJournalEntries=original;for(const key of ['Auth','confirm','fetch','App'])delete global[key];}
});
