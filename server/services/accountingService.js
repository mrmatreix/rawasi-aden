const { saveDocuments } = require('./supportingDocumentService');
/**
 * خدمة الحسابات المالية العامة (Accounting Service)
 * تفصل منطق الأعمال والتحقق المالي عن مسارات الـ HTTP/Routes
 */

const { get, query, run, transaction } = require('../database/db');
const { checkPeriodOpen } = require('./periodService');
const { logAudit } = require('./auditService');

function journalPrefix(referenceType, year) {
  if (referenceType === 'سند قبض') return `JV-RC-${year}-`;
  if (referenceType === 'سند صرف') return `JV-PV-${year}-`;
  return `JV-${year}-`;
}

async function nextJournalNumber(db, date, referenceType) {
  const prefix = journalPrefix(referenceType, new Date(date).getFullYear());
  const last = await db.get(
    'SELECT entry_no FROM journal_entries WHERE entry_no LIKE ? ORDER BY entry_no DESC LIMIT 1',
    [`${prefix}%`]
  );
  let sequence = last?.entry_no?.startsWith(prefix)
    ? (Number(last.entry_no.slice(prefix.length)) || 0) + 1
    : 1;
  let entryNo = `${prefix}${String(sequence).padStart(4, '0')}`;
  while (await db.get('SELECT id FROM journal_entries WHERE entry_no = ?', [entryNo])) {
    sequence++;
    entryNo = `${prefix}${String(sequence).padStart(4, '0')}`;
  }
  return entryNo;
}

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
  async resolveOptionalCostCenter(value, db = { get }) {
    if (value === undefined || value === null || value === '') return null;
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0 || !await db.get('SELECT id FROM cost_centers WHERE id = ?', [id])) {
      throw new Error('مركز التكلفة المحدد غير صالح');
    }
    return id;
  },

  async resolveAccountOperationCenter(account, value, db = { get }) {
    const center = await this.resolveOptionalCostCenter(value, db);
    if (Number(account.cost_center_required) === 1 && !center) throw Object.assign(new Error('مركز التكلفة إلزامي للحساب ' + account.code + ' - ' + account.name), { statusCode: 400 });
    return center;
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
  async assertLeafAccount(accountId) {
    if (!accountId) {
      throw new Error('يرجى تحديد الحساب المالي');
    }
    const idNum = Number(accountId);
    if (!idNum) {
      throw new Error('معرف الحساب غير صالح');
    }
    const account = await get(`
      SELECT a.*,
             (SELECT COUNT(*) FROM accounts c WHERE c.parent_id = a.id) as children_count
      FROM accounts a
      WHERE a.id = ?
    `, [idNum]);

    if (!account) {
      throw new Error('الحساب المالي غير موجود في دليل الحسابات');
    }

    if (account.status === 'restricted' || account.status === 'inactive' || account.is_active === 0) {
      throw new Error(`الحساب [${account.code} - ${account.name}] موقوف ومقيد، ولا يمكن تسجيل قيود يومية عليه`);
    }

    const isLeaf = (account.is_posting === 1 || account.is_posting === true) && Number(account.children_count || 0) === 0;
    if (!isLeaf) {
      throw new Error('لا يمكن تسجيل العملية على هذا الحساب، يرجى اختيار الحساب الفرعي الأخير.');
    }

    return account;
  },

  /**
   * جلب وتأكيد حساب الصندوق الرئيسي (الفرعي الأخير)
   */
  async resolveCashAccount() {
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
    const rootCode = isBank ? '11102' : '11101';
    let current = account;
    const visited = new Set();
    while (current && !visited.has(current.id)) {
      if (String(current.code) === rootCode) return account;
      visited.add(current.id);
      current = current.parent_id ? await get('SELECT id, code, parent_id FROM accounts WHERE id = ?', [current.parent_id]) : null;
    }
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
  async validateJournalEntryLines(lines) {
    if (!Array.isArray(lines) || lines.length < 2) {
      throw new Error('يجب أن يحتوي القيد على سطرين على الأقل (طرف مدين وطرف دائن)');
    }

    let totalDebit = 0;
    let totalCredit = 0;
    const sanitizedLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const accountId = Number(line.account_id);
      if (!accountId) {
        throw new Error(`السطر رقم ${i + 1}: يرجى تحديد الحساب المالي`);
      }

      const debit = Math.round(Number(line.debit || 0) * 100) / 100;
      const credit = Math.round(Number(line.credit || 0) * 100) / 100;

      if (debit < 0 || credit < 0) {
        throw new Error(`السطر رقم ${i + 1}: لا يمكن إدخال مبالغ سالبة`);
      }
      if (debit === 0 && credit === 0) {
        continue; // تجاهل السطور الفارغة
      }
      if (debit > 0 && credit > 0) {
        throw new Error(`السطر رقم ${i + 1}: لا يمكن تحديد مبلغ مدين ودائن معاً لنفس الحساب في نفس السطر`);
      }

      // التحقق الصارم من الحساب: يجب أن يكون فرعياً أخيراً ونشطاً
      const account = await this.assertLeafAccount(accountId);

      const costCenterId = await this.resolveAccountOperationCenter(account, line.cost_center_id);

      totalDebit += debit;
      totalCredit += credit;

      sanitizedLines.push({
        account_id: accountId,
        cost_center_id: costCenterId,
        debit,
        credit,
        description: (line.description || line.notes || '').trim()
      });
    }

    totalDebit = Math.round(totalDebit * 100) / 100;
    totalCredit = Math.round(totalCredit * 100) / 100;

    if (sanitizedLines.length < 2) {
      throw new Error('يجب إدخال قيمتين ماليتين موجبتين على الأقل لتكوين القيد');
    }
    if (totalDebit <= 0) {
      throw new Error('إجمالي قيمة القيد يجب أن تكون أكبر من الصفر');
    }

    const diff = Math.abs(totalDebit - totalCredit);
    if (diff > 0.001) {
      throw new Error(`⛔ القيد غير متزن محاسبياً! إجمالي المدين (${totalDebit}) لا يساوي إجمالي الدائن (${totalCredit})، يوجد فرق قدره (${diff})`);
    }

    return {
      sanitizedLines,
      totalDebit,
      totalCredit
    };
  },

  /**
   * إنشاء قيد يومية جديد مع فحص الفترة المحاسبية وحفظ سطور القيد داخل Transaction ذرية
   */
  async createJournalEntry(entryData, lines, req = null, externalTx = null) {
    const { date, description, reference_type = 'قيد يدوي', reference_id = null, reference_no = null } = entryData;

    if (!date || !description) {
      throw new Error('تاريخ القيد والبيان حقول إلزامية');
    }

    // 1. فحص إغلاق الفترة المحاسبية
    const periodCheck = await checkPeriodOpen(date);
    if (!periodCheck.isOpen) {
      throw new Error(periodCheck.message);
    }

    // 2. التحقق المالي الصارم من التوازن ومراكز التكلفة
    const { sanitizedLines, totalDebit, totalCredit } = await this.validateJournalEntryLines(lines);

    // 3. توليد رقم القيد التسلسلي
    const entryNo = await nextJournalNumber({ get }, date, reference_type);

    // 4. الحفظ الذري مع توثيق المنشئ وحالة الترحيل
    let validCreatorId = null;
    const rawCreatorId = req?.user?.id || null;
    if (rawCreatorId) {
      try {
        const u = await get('SELECT id FROM users WHERE id = ?', [Number(rawCreatorId)]);
        if (u) validCreatorId = u.id;
      } catch {}
    }
    const creatorName = req?.user?.username || req?.user?.full_name || 'المحاسب المالي';
    const status = entryData.status || 'posted';

    let entryId = null;
    const runInTx = async (tx) => {
      const res = await tx.run(`
        INSERT INTO journal_entries (
          entry_no, date, description, reference_type, reference_id, reference_no,
          total_debit, total_credit, status, 
          created_by, created_by_name, posted_by, posted_by_name, posted_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        entryNo, date, description.trim(), reference_type, reference_id, reference_no ? String(reference_no).trim() : null,
        totalDebit, totalCredit, status,
        validCreatorId, creatorName, 
        status === 'posted' ? validCreatorId : null,
        status === 'posted' ? creatorName : null,
        status === 'posted' ? new Date().toISOString() : null
      ]);

      entryId = res.lastInsertRowid || res.insertId;

      for (const line of sanitizedLines) {
        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, debit, credit, notes)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [entryId, line.account_id, line.cost_center_id, line.debit, line.credit, line.description]);
      }
      await saveDocuments(tx, 'journal', entryId, entryData.supporting_documents);
      if (status === 'posted') await syncJournalCashMovements(tx, entryId);
    };

    if (externalTx) {
      await runInTx(externalTx);
    } else {
      await transaction(runInTx);
    }

    // 5. تسجيل التدقيق الرقابي مع بيانات القيمة والحالة
    if (req) {
      await logAudit(req, {
        action: status === 'draft' ? 'CREATE_DRAFT' : 'INSERT',
        entity_type: 'journal_entry',
        entity_id: entryNo,
        details: { entry_no: entryNo, date, total_debit: totalDebit, total_credit: totalCredit, lines_count: sanitizedLines.length, status },
        new_values: { entry_no: entryNo, date, total_debit: totalDebit, total_credit: totalCredit, status, created_by: creatorName }
      });
    }

    return {
      id: entryId,
      entry_no: entryNo,
      total_debit: totalDebit,
      total_credit: totalCredit,
      status
    };
  },

  /**
   * إنشاء قيد يومية تلقائي متزن لسندات الصرف والقبض مع منع الترحيل المكرر
   * يطبق بدقة القواعد المحاسبية:
   * - في سند الصرف: Debit = Selected Account, Credit = Cash/Bank Leaf Account
   * - في سند القبض: Debit = Cash/Bank Leaf Account, Credit = Selected Account
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
    req = null
  }, externalTx = null) {
    if (!voucherId || !voucherType || !amount || Number(amount) <= 0) {
      throw new Error('بيانات السند غير مكتملة لإنشاء القيد المحاسبي');
    }

    // 1. التحقق الصارم من الحساب المالي المختار أنه حساب فرعي أخير
    const selectedLeafAccount = await this.assertVoucherAccount(voucherType, accountId);

    // 2. التحقق من طريقة الدفع وتحديد الحساب المقابل (صندوق أو بنك)
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
      // 3. منع الترحيل المكرر: فحص وجود قيد سابق لنفس السند
      const existingJe = await tx.get(
        'SELECT id, entry_no FROM journal_entries WHERE reference_type = ? AND reference_id = ?',
        [voucherType, voucherId]
      );
      if (existingJe) {
        return {
          id: existingJe.id,
          entry_no: existingJe.entry_no,
          already_existed: true
        };
      }

      // 4. توليد رقم القيد اليومي التسلسلي
      const entryNo = await nextJournalNumber(tx, date, voucherType);

      const numAmount = Math.round(Number(amount) * 100) / 100;
      const creatorId = user?.id || null;
      const creatorName = user?.username || user?.full_name || 'مسؤول الحسابات';

      const methodLabel = isBank ? `(تحويل بنكي: ${bankInfo?.bank_name || opposingAccount.name})` : '(نقداً: الصندوق)';
      const jeDesc = `${voucherType} رقم ${receiptNo} ${methodLabel} - ${notes || selectedLeafAccount.name}`;

      const jeRes = await tx.run(`
        INSERT INTO journal_entries (
          entry_no, date, description, reference_type, reference_id, reference_no,
          total_debit, total_credit, status,
          created_by, created_by_name, posted_by, posted_by_name, posted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        entryNo, date, jeDesc, voucherType, voucherId, referenceNo || receiptNo,
        numAmount, numAmount,
        creatorId, creatorName, creatorId, creatorName
      ]);

      const jeId = jeRes.lastInsertRowid || jeRes.insertId;

      const finalCcId = await this.resolveAccountOperationCenter(selectedLeafAccount, costCenterId, tx);
      await this.resolveAccountOperationCenter(opposingAccount, finalCcId, tx);

      let validProjectId = null;
      if (projectId) {
        const prjExists = await tx.get('SELECT id FROM projects WHERE id = ?', [Number(projectId)]);
        if (prjExists) validProjectId = prjExists.id;
      }

      // 5. إنشاء سطور القيد حسب القواعد المحاسبية الصارمة:
      if (voucherType === 'سند صرف') {
        // مدين: الحساب المختار (المصروف أو الالتزام)
        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes)
          VALUES (?, ?, ?, ?, ?, 0, ?)
        `, [jeId, selectedLeafAccount.id, finalCcId, validProjectId, numAmount, `${selectedLeafAccount.name} - سند صرف ${receiptNo}`]);

        // دائن: الصندوق أو البنك
        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes)
          VALUES (?, ?, ?, ?, 0, ?, ?)
        `, [jeId, opposingAccount.id, finalCcId, validProjectId, numAmount, `${opposingAccount.name} - سداد سند صرف ${receiptNo}`]);

        // ربط السند بمعرف القيد وحساب البنك
        await tx.run('UPDATE expenses SET journal_entry_id = ?, bank_account_id = ? WHERE id = ?', [
          jeId, bankInfo?.id || null, voucherId
        ]);
      } else {
        // سند قبض:
        // مدين: الصندوق أو البنك
        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes)
          VALUES (?, ?, ?, ?, ?, 0, ?)
        `, [jeId, opposingAccount.id, finalCcId, validProjectId, numAmount, `${opposingAccount.name} - تحصيل سند قبض ${receiptNo}`]);

        // دائن: الحساب المختار (الإيراد أو العميل)
        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes)
          VALUES (?, ?, ?, ?, 0, ?, ?)
        `, [jeId, selectedLeafAccount.id, finalCcId, validProjectId, numAmount, `${selectedLeafAccount.name} - سند قبض ${receiptNo}`]);

        // ربط السند بمعرف القيد وحساب البنك
        await tx.run('UPDATE payments SET journal_entry_id = ?, bank_account_id = ? WHERE id = ?', [
          jeId, bankInfo?.id || null, voucherId
        ]);
      }

      return {
        id: jeId,
        entry_no: entryNo,
        debit_account_id: voucherType === 'سند صرف' ? selectedLeafAccount.id : opposingAccount.id,
        credit_account_id: voucherType === 'سند صرف' ? opposingAccount.id : selectedLeafAccount.id,
        amount: numAmount
      };
    };

    if (externalTx) {
      return await runInTx(externalTx);
    } else {
      return await transaction(runInTx);
    }
  }
};

module.exports = AccountingService;
