/**
 * خدمة الحسابات المالية العامة (Accounting Service)
 * تفصل منطق الأعمال والتحقق المالي عن مسارات الـ HTTP/Routes
 */

const { get, query, run, transaction } = require('../database/db');
const { logAudit } = require('./auditService');
const SystemAccounts = require('./systemAccountService');
const { normalizeAccountType } = require('./chartOfAccountsRules');
const PostingService = require('./ledger/postingService');
const Money = require('./ledger/money');

async function syncJournalCashMovements(db, entryId) {
  const entry = await db.get('SELECT * FROM journal_entries WHERE id = ?', [entryId]);
  if (!entry || entry.status !== 'posted') return 0;

  const rows = await db.query(`
    SELECT jel.account_id, a.code, a.name,
           SUM(COALESCE(jel.debit, 0)) AS debit,
           SUM(COALESCE(jel.credit, 0)) AS credit
    FROM journal_entry_lines jel
    JOIN accounts a ON a.id = jel.account_id
    WHERE jel.entry_id = ?
      AND (a.code LIKE '11101%' OR a.code LIKE '11102%')
    GROUP BY jel.account_id, a.code, a.name
  `, [entryId]);

  let inserted = 0;
  for (const row of rows) {
    const existing = await db.get(
      'SELECT id FROM cash_movements WHERE reference_no = ? AND account_id = ? LIMIT 1',
      [entry.entry_no, row.account_id]
    );
    if (existing) continue;

    const net = Math.round(((Number(row.debit) || 0) - (Number(row.credit) || 0)) * 100) / 100;
    if (Math.abs(net) < 0.005) continue;
    const last = await db.get(
      'SELECT current_balance FROM cash_movements WHERE account_id = ? ORDER BY id DESC LIMIT 1',
      [row.account_id]
    );
    const previous = Number(last?.current_balance) || 0;
    const cashIn = net > 0 ? net : 0;
    const cashOut = net < 0 ? Math.abs(net) : 0;
    const current = Math.round((previous + net) * 100) / 100;
    const isBank = String(row.code || '').startsWith('11102');
    const movementType = isBank ? 'بنك' : 'نقدي';
    const paymentMethod = isBank ? 'تحويل بنكي' : 'نقدي';

    await db.run(`
      INSERT INTO cash_movements
        (previous_balance, cash_in, cash_out, withdrawals, current_balance, currency, date, notes, movement_type, payment_method, reference_no, account_id)
      VALUES (?, ?, ?, 0, ?, 'ر.ي', ?, ?, ?, ?, ?, ?)
    `, [
      previous, cashIn, cashOut, current, entry.date,
      `قيد يومية ${entry.entry_no}: ${entry.description || row.name}`,
      movementType, paymentMethod, entry.entry_no, row.account_id
    ]);
    inserted++;
  }
  return inserted;
}

const AccountingService = {
  syncJournalCashMovements,

  async resolveAccountOperationCenter(account, value, db = { get }) {
    return PostingService.resolveCostCenter(db, account, value);
  },

  async assertVoucherAccount(voucherType, accountId) {
    const account = await this.assertLeafAccount(accountId);
    if (voucherType === 'سند صرف') {
      const seen = new Set();
      let current = account;
      while (current && !seen.has(Number(current.id))) {
        seen.add(Number(current.id));
        const text = `${current.type || ''} ${current.name || ''}`.normalize('NFKC').toLowerCase()
          .replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[أإآ]/g, 'ا');
        if (/ايراد|revenue|income/.test(text) || String(current.code).startsWith('4')) {
          throw new Error('لا يمكن اختيار حساب إيرادات كحساب مقابل لسند الصرف');
        }
        current = current.parent_id ? await get('SELECT id, code, name, type, parent_id FROM accounts WHERE id = ?', [current.parent_id]) : null;
      }
    }
    return account;
  },
  /**
   * التحقق الصارم من أن الحساب فرعي أخير (Leaf Account) ومؤهل لتسجيل القيود
   * يرفض أي حساب أب أو حساب تجميعي أو موقوف أو غير نشط
   */
  async assertLeafAccount(accountId, db = { get }) {
    return PostingService.loadPostingAccount(db, accountId);
  },

  /**
   * جلب وتأكيد حساب الصندوق الرئيسي (الفرعي الأخير)
   */
  async resolveCashAccount() {
    const mapped = await SystemAccounts.resolveOptional('CASH_DEFAULT');
    if (mapped) return mapped;
    const cashAccount = await get(`
      SELECT a.*,
             (SELECT COUNT(*) FROM accounts c WHERE c.parent_id = a.id) as children_count
      FROM accounts a
      WHERE (a.is_posting = 1 OR a.is_posting IS NULL)
        AND (a.status IS NULL OR a.status = 'active')
        AND (a.is_active IS NULL OR a.is_active = 1)
        AND (SELECT COUNT(*) FROM accounts c WHERE c.parent_id = a.id) = 0
        AND a.code = '11101001'
      ORDER BY a.id ASC
      LIMIT 1
    `);
    if (!cashAccount) {
      throw new Error('لم يتم العثور على حساب الصندوق الرئيسي (الفرعي الأخير) في دليل الحسابات');
    }
    return cashAccount;
  },

  async resolveVoucherSettlementAccount(method, accountId) {
    const isBank = method === 'تحويل بنكي' || method === 'BANK_TRANSFER';
    if (!accountId) return isBank ? (await this.resolveBankAccount()).coaAccount : this.resolveCashAccount();
    const account = await this.assertLeafAccount(accountId);
    // The settlement account must sit under the cash or bank group, follow the code sequence of that
    // group, and be an asset: a broken parent link alone can no longer make furniture a cash box.
    const groupRole = isBank ? 'BANK_GROUP' : 'CASH_GROUP';
    const group = await SystemAccounts.resolveOptional(groupRole);
    const rootCode = group ? String(group.code) : (isBank ? '11102' : '11101');
    const underGroup = group ? await SystemAccounts.isUnderGroup(account.id, groupRole) : true;
    if (underGroup && String(account.code).startsWith(rootCode) && normalizeAccountType(account.type) === 'asset') return account;
    throw new Error(isBank ? 'يرجى اختيار حساب بنكي فرعي من دليل الحسابات' : 'يرجى اختيار حساب صندوق فرعي من دليل الحسابات');
  },

  /**
   * جلب وتأكيد حساب البنك (الفرعي الأخير) المرتبط
   */
  async resolveBankAccount(bankAccountId = null, bankName = null) {
    let bankRecord = null;
    if (bankAccountId) {
      bankRecord = await get('SELECT * FROM bank_accounts WHERE id = ?', [Number(bankAccountId)]);
    } else if (bankName) {
      bankRecord = await get('SELECT * FROM bank_accounts WHERE bank_name = ? LIMIT 1', [String(bankName).trim()]);
    }

    if (bankRecord && bankRecord.account_id) {
      try {
        const leafAcc = await this.assertLeafAccount(bankRecord.account_id);
        return { bankRecord, coaAccount: leafAcc };
      } catch (err) {
        // إذا كان الحساب المرتبط غير صالح كـ leaf نبحث عن حساب بديل أدناه
      }
    }

    const mappedBank = await SystemAccounts.resolveOptional('BANK_DEFAULT');
    if (mappedBank) return { bankRecord, coaAccount: mappedBank };
    const defaultBank = await get(`
      SELECT a.*,
             (SELECT COUNT(*) FROM accounts c WHERE c.parent_id = a.id) as children_count
      FROM accounts a
      WHERE (a.is_posting = 1 OR a.is_posting IS NULL)
        AND (a.status IS NULL OR a.status = 'active')
        AND (a.is_active IS NULL OR a.is_active = 1)
        AND (SELECT COUNT(*) FROM accounts c WHERE c.parent_id = a.id) = 0
        AND a.code = '11102001'
      ORDER BY a.id ASC
      LIMIT 1
    `);

    if (!defaultBank) {
      throw new Error('لم يتم العثور على حساب بنك فرعي نهائي قابل للتسجيل في دليل الحسابات');
    }

    return { bankRecord, coaAccount: defaultBank };
  },

  /**
   * التحقق المالي الصارم من توازن وصحة سطور القيد اليومي ومراكز التكلفة
   */
  /**
   * التحقق من سطور القيد (معاينة بلا حفظ). المنطق الفعلي في PostingService.prepareLines.
   */
  async validateJournalEntryLines(lines) {
    const prepared = await PostingService.prepareLines({ get, query, run }, lines);
    const total = prepared.total / 100;
    return {
      sanitizedLines: prepared.lines.map(l => ({ account_id: l.account_id, cost_center_id: l.cost_center_id, project_id: l.project_id,
        debit: l.debit / 100, credit: l.credit / 100, description: l.notes })),
      totalDebit: total,
      totalCredit: total
    };
  },

  /**
   * إنشاء قيد يومية: غلاف رقيق حول PostingService (التحقق والترقيم والحفظ في معاملة واحدة)
   */
  async createJournalEntry(entryData, lines, req = null, externalTx = null) {
    const { date, description, reference_type = 'قيد يدوي', reference_id = null, reference_no = null } = entryData;
    const status = entryData.status || 'posted';
    const series = reference_type === 'سند قبض' ? 'JV-RC' : reference_type === 'سند صرف' ? 'JV-PV' : (entryData.series || 'JV');
    const postIt = tx => PostingService.post(tx, {
      date, description, status, series, lines, user: req?.user || entryData.user || null, documents: entryData.supporting_documents,
      source: { type: reference_type, id: reference_id, no: reference_no }
    });
    const result = externalTx ? await postIt(externalTx) : await transaction(postIt);

    if (req) {
      await logAudit(req, {
        action: status === 'draft' ? 'CREATE_DRAFT' : 'INSERT',
        entity_type: 'journal_entry',
        entity_id: result.entry_no,
        details: { entry_no: result.entry_no, date, total_debit: result.total_debit, total_credit: result.total_credit, lines_count: result.lines.length, status },
        new_values: { entry_no: result.entry_no, date, total_debit: result.total_debit, total_credit: result.total_credit, status, created_by: req?.user?.username || 'المحاسب المالي' }
      });
    }
    return { id: result.id, entry_no: result.entry_no, total_debit: result.total_debit, total_credit: result.total_credit, status };
  },

  /**
   * قيد سند الصرف/القبض عبر PostingService مع منع الترحيل المكرر:
   * - سند الصرف: مدين الحساب المختار / دائن الصندوق أو البنك
   * - سند القبض: مدين الصندوق أو البنك / دائن الحساب المختار
   */
  async createVoucherJournalEntry({
    voucherType, // 'سند صرف' | 'سند قبض'
    voucherId,
    receiptNo,
    referenceNo = null,
    date,
    amount,
    accountId,
    paymentMethod = 'نقدي',
    settlementAccountId = null,
    bankAccountId = null,
    bankName = null,
    costCenterId = null,
    projectId = null,
    notes = '',
    user = null,
    req = null,
    // جدول المستند المصدر: سند الصرف قد يكون من expenses أو من payments (نوع صرف)
    sourceTable = voucherType === 'سند صرف' ? 'expenses' : 'payments',
    // الأستاذ المساعد: طرف السطر غير النقدي (عميل في القبض، مورد في الصرف)
    partyType = null,
    partyId = null
  }, externalTx = null) {
    if (!voucherId || !voucherType || !amount || Number(amount) <= 0) {
      throw new Error('بيانات السند غير مكتملة لإنشاء القيد المحاسبي');
    }
    if (!['expenses', 'payments'].includes(sourceTable)) throw new Error('جدول مصدر السند غير صالح');

    const selectedLeafAccount = await this.assertVoucherAccount(voucherType, accountId);
    const isBank = (paymentMethod === 'تحويل بنكي' || paymentMethod === 'شيك');
    let opposingAccount = null;
    let bankInfo = null;
    if (settlementAccountId) {
      opposingAccount = await this.resolveVoucherSettlementAccount(paymentMethod, settlementAccountId);
    } else if (isBank) {
      const resolved = await this.resolveBankAccount(bankAccountId, bankName);
      opposingAccount = resolved.coaAccount;
      bankInfo = resolved.bankRecord;
    } else {
      opposingAccount = await this.resolveCashAccount();
    }

    const runInTx = async (tx) => {
      // منع الترحيل المكرر: الربط المباشر أولاً ثم نوع المرجع + رقمه + رقم السند
      // (رقم المعرّف وحده لا يكفي لأن سندات الصرف في expenses و payments تتشارك نوع المرجع)
      const sourceRow = await tx.get(`SELECT journal_entry_id FROM ${sourceTable} WHERE id = ?`, [voucherId]);
      const linked = sourceRow?.journal_entry_id ? await tx.get('SELECT id, entry_no FROM journal_entries WHERE id = ?', [sourceRow.journal_entry_id]) : null;
      if (linked) return { id: linked.id, entry_no: linked.entry_no, already_existed: true };

      const numAmount = Money.round2(amount);
      const methodLabel = isBank ? `(تحويل بنكي: ${bankInfo?.bank_name || opposingAccount.name})` : '(نقداً: الصندوق)';
      let centerId = await PostingService.resolveCostCenter(tx, selectedLeafAccount, costCenterId);
      centerId = await PostingService.resolveCostCenter(tx, opposingAccount, centerId);
      const isPayment = voucherType === 'سند صرف';
      const selectedLine = { accountId: selectedLeafAccount.id, costCenterId: centerId, projectId, partyType, partyId,
        notes: `${selectedLeafAccount.name} - ${voucherType} ${receiptNo}`, [isPayment ? 'debit' : 'credit']: numAmount };
      const settlementLine = { accountId: opposingAccount.id, costCenterId: centerId, projectId,
        notes: `${opposingAccount.name} - ${isPayment ? 'سداد سند صرف' : 'تحصيل سند قبض'} ${receiptNo}`, [isPayment ? 'credit' : 'debit']: numAmount };

      const result = await PostingService.post(tx, {
        date,
        description: `${voucherType} رقم ${receiptNo} ${methodLabel} - ${notes || selectedLeafAccount.name}`,
        series: isPayment ? 'JV-PV' : 'JV-RC',
        source: { type: voucherType, id: voucherId, no: referenceNo || receiptNo },
        lines: isPayment ? [selectedLine, settlementLine] : [settlementLine, selectedLine],
        user, dedupe: true,
        // مسارات السندات تكتب حركة الصندوق بنفسها برقم السند؛ لا حركة ثانية برقم القيد
        syncCash: false
      });
      if (!result.already_existed) {
        await tx.run(`UPDATE ${sourceTable} SET journal_entry_id = ?, bank_account_id = ? WHERE id = ?`, [result.id, bankInfo?.id || null, voucherId]);
      }
      if (result.already_existed) return { id: result.id, entry_no: result.entry_no, already_existed: true };
      return {
        id: result.id,
        entry_no: result.entry_no,
        debit_account_id: isPayment ? selectedLeafAccount.id : opposingAccount.id,
        credit_account_id: isPayment ? opposingAccount.id : selectedLeafAccount.id,
        amount: numAmount
      };
    };

    return externalTx ? runInTx(externalTx) : transaction(runInTx);
  }
};

module.exports = AccountingService;
