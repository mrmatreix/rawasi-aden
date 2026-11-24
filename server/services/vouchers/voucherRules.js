'use strict';
// Accounting rules for receipt vouchers (stage 4.2, M9).
// 1. The counter account of a receipt is never a cash or bank account (that is a transfer, not a receipt).
// 2. The receipt category decides the counter account:
//      bill_collection (or any receipt linked to a bill) -> the client's receivable (ACCOUNTS_RECEIVABLE or the client's own mapped account)
//      advance_payment   -> CUSTOMER_ADVANCES (a liability, never revenue)
//      retention_release -> RETENTION_RECEIVABLE
//    'general' receipts keep a free choice of non-cash account.
const db = require('../../database/db');
const SystemAccounts = require('../systemAccountService');

const CATEGORY_ROLES = Object.freeze({
  bill_collection: { role: 'ACCOUNTS_RECEIVABLE', label: 'ذمم العملاء' },
  advance_payment: { role: 'CUSTOMER_ADVANCES', label: 'الدفعات المقدمة من العملاء' },
  retention_release: { role: 'RETENTION_RECEIVABLE', label: 'محتجزات الضمان لدى العملاء' }
});

const ruleError = message => Object.assign(new Error(message), { statusCode: 400, code: 'VOUCHER_RULE' });

async function isCashOrBank(h, accountId, account) {
  if (await SystemAccounts.isUnderGroup(accountId, 'CASH_GROUP', h) || await SystemAccounts.isUnderGroup(accountId, 'BANK_GROUP', h)) return true;
  const a = account || await h.get('SELECT code, analytical_type FROM accounts WHERE id = ?', [accountId]);
  return !!a && (['cash', 'bank'].includes(a.analytical_type) || /^1110[12]/.test(String(a.code || '')));
}

/** The account a receipt of this category must credit, or null when the choice is free. */
async function requiredReceiptAccount({ category, billId, clientId }, h = db) {
  const key = billId ? 'bill_collection' : category;
  const rule = CATEGORY_ROLES[key];
  if (!rule) return null;
  if (rule.role === 'ACCOUNTS_RECEIVABLE' && clientId) {
    const party = await h.get("SELECT account_id FROM party_account_mappings WHERE party_type = 'client' AND party_id = ?", [clientId]).catch(() => null);
    if (party?.account_id) {
      const acc = await h.get('SELECT * FROM accounts WHERE id = ?', [party.account_id]);
      if (acc) return { ...acc, rule };
    }
  }
  const acc = await SystemAccounts.resolve(rule.role, h);
  return { ...acc, rule };
}

async function assertReceiptAccount({ accountId, category, billId, clientId }, h = db) {
  const account = await h.get('SELECT id, code, name, analytical_type FROM accounts WHERE id = ?', [accountId]);
  if (!account) throw ruleError('الحساب المالي غير موجود في دليل الحسابات');
  if (await isCashOrBank(h, account.id, account)) {
    throw ruleError(`لا يكون الطرف الدائن في سند القبض حساب صندوق أو بنك [${account.code} - ${account.name}]؛ نقل النقدية بين الصناديق والبنوك يتم بتحويل نقدي لا بسند قبض.`);
  }
  const required = await requiredReceiptAccount({ category, billId, clientId }, h);
  if (required && Number(required.id) !== Number(account.id)) {
    throw ruleError(`سند القبض من نوع (${required.rule.label}) يُقيد على الحساب [${required.code} - ${required.name}] وليس [${account.code} - ${account.name}]${billId ? '؛ تحصيل المستخلص يُقفل ذمة العميل ولا يُسجل إيراداً ثانياً' : ''}.`);
  }
  return account;
}

module.exports = { assertReceiptAccount, requiredReceiptAccount, isCashOrBank, CATEGORY_ROLES };
