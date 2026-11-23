'use strict';
// Employee funds on the ledger: custody disbursement / settlement and salary advances.
// Before this, these documents moved the cash book but wrote no journal entry, so ledger cash drifted from the
// boxes, custody expenses never reached the income statement, and payroll recovered advances (Cr EMPLOYEE_ADVANCES)
// that had never been debited. Every function runs inside the caller's transaction.
const PostingService = require('./postingService');
const SystemAccounts = require('../systemAccountService');
const AccountingService = require('../accountingService');
const { normalizeAccountType } = require('../chartOfAccountsRules');

const fundsError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

async function isCashOrBank(h, accountId) {
  if (!accountId) return false;
  return (await SystemAccounts.isUnderGroup(accountId, 'CASH_GROUP', h)) || (await SystemAccounts.isUnderGroup(accountId, 'BANK_GROUP', h));
}

// The box or bank the money leaves from: an explicit settlement account, else the chosen account when it is
// a box/bank, else the default box (cash) or default bank (transfer).
async function sourceAccount(h, paymentMethod, { settlementAccountId, chosenAccountId }) {
  const explicit = settlementAccountId || ((await isCashOrBank(h, chosenAccountId)) ? chosenAccountId : null);
  const account = await AccountingService.resolveVoucherSettlementAccount(paymentMethod, explicit ? Number(explicit) : null);
  if (!account || !account.id) throw fundsError('تعذر تحديد الصندوق أو البنك المصروف منه');
  return account;
}

// Cash-book row under the document number (PostingService runs with syncCash=false, like vouchers).
async function cashOut(h, { account, amount, date, notes, paymentMethod, referenceNo }) {
  const last = await h.get('SELECT current_balance FROM cash_movements WHERE account_id = ? ORDER BY id DESC LIMIT 1', [account.id]);
  const prev = Number(last?.current_balance) || 0;
  await h.run(`INSERT INTO cash_movements (previous_balance, cash_in, cash_out, withdrawals, current_balance, currency, date, notes, movement_type, payment_method, reference_no, account_id)
    VALUES (?, 0, ?, 0, ?, 'ر.ي', ?, ?, ?, ?, ?, ?)`,
  [prev, amount, prev - amount, date, notes, paymentMethod === 'تحويل بنكي' ? 'بنك' : 'نقدي', paymentMethod, referenceNo, account.id]);
}

/** Custody / petty-cash disbursement: Dr custody with the employee / Cr box or bank. */
async function postCustodyDisbursement(h, { custodyId, custodyNo, date, amount, employeeId, employeeName, projectId, paymentMethod, chosenAccountId, settlementAccountId, user }) {
  const source = await sourceAccount(h, paymentMethod, { settlementAccountId, chosenAccountId });
  const custodyAccountId = chosenAccountId && !(await isCashOrBank(h, chosenAccountId)) ? Number(chosenAccountId) : (await SystemAccounts.resolve('EMPLOYEE_CUSTODY', h)).id;
  const entry = await PostingService.post(h, {
    date, user, syncCash: false,
    description: `صرف عهدة ${custodyNo} للموظف ${employeeName}`,
    source: { type: 'عهدة', id: custodyId, no: custodyNo },
    lines: [
      { accountId: custodyAccountId, debit: amount, projectId, partyType: employeeId ? 'employee' : null, partyId: employeeId, notes: `عهدة لدى ${employeeName}` },
      { accountId: source.id, credit: amount, projectId, notes: `صرف العهدة ${custodyNo}` }
    ]
  });
  await cashOut(h, { account: source, amount, date, paymentMethod, referenceNo: custodyNo, notes: `صرف عهدة: ${custodyNo} للموظف (${employeeName})` });
  return { entry, custodyAccountId, sourceAccountId: source.id };
}

/** Custody settlement: Dr the expense actually incurred / Cr the custody account of the original disbursement. */
async function postCustodySettlement(h, { settlementId, settlementNo, original, date, amount, expenseAccountId, projectId, user }) {
  if (!expenseAccountId) throw fundsError('يرجى اختيار حساب المصروف الذي صُرفت فيه العهدة');
  const expense = await PostingService.loadPostingAccount(h, expenseAccountId);
  if (!['expense'].includes(normalizeAccountType(expense.type))) throw fundsError('حساب تصفية العهدة يجب أن يكون حساب مصروف أو تكلفة فرعياً');
  const custodyAccountId = original.account_id && !(await isCashOrBank(h, original.account_id)) ? Number(original.account_id) : (await SystemAccounts.resolve('EMPLOYEE_CUSTODY', h)).id;
  const entry = await PostingService.post(h, {
    date, user, syncCash: false,
    description: `تصفية العهدة ${original.custody_no} بموجب ${settlementNo}`,
    source: { type: 'تصفية عهدة', id: settlementId, no: settlementNo },
    lines: [
      { accountId: expense.id, debit: amount, projectId, notes: `مصروفات العهدة ${original.custody_no}` },
      { accountId: custodyAccountId, credit: amount, projectId, partyType: original.employee_id ? 'employee' : null, partyId: original.employee_id, notes: `تخفيض عهدة ${original.employee_name}` }
    ]
  });
  return { entry, expenseAccountId: expense.id };
}

/** Salary advance paid out: Dr employee advances (recovered by payroll) / Cr box or bank. */
async function postAdvance(h, { advanceId, date, amount, employeeId, employeeName, paymentMethod = 'نقدي', settlementAccountId, user }) {
  const source = await sourceAccount(h, paymentMethod, { settlementAccountId });
  const advances = await SystemAccounts.resolve('EMPLOYEE_ADVANCES', h);
  const no = `ADV-${advanceId}`;
  const entry = await PostingService.post(h, {
    date, user, syncCash: false,
    description: `سلفة موظف ${no} - ${employeeName}`,
    source: { type: 'سلفة موظف', id: advanceId, no },
    lines: [
      { accountId: advances.id, debit: amount, partyType: 'employee', partyId: employeeId, notes: `سلفة ${employeeName}` },
      { accountId: source.id, credit: amount, notes: `صرف السلفة ${no}` }
    ]
  });
  await cashOut(h, { account: source, amount, date, paymentMethod, referenceNo: no, notes: `سلفة موظف: ${no} (${employeeName})` });
  return { entry };
}

module.exports = { postCustodyDisbursement, postCustodySettlement, postAdvance, isCashOrBank };
