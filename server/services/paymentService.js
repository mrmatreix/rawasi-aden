/**
 * خدمة إدارة المدفوعات والتحصيلات الخماسية الطبقات (5-Layer Payment Service)
 * مشروع رواسي عدن للهندسة والمقاولات
 */

const { get, query, run, transaction } = require('../database/db');
const AccountingService = require('./accountingService');

let checkPeriodOpen = async () => ({ isOpen: true });
try {
  const periodSvc = require('./periodService');
  if (periodSvc && periodSvc.checkPeriodOpen) {
    checkPeriodOpen = periodSvc.checkPeriodOpen;
  }
} catch (e) {
  // Graceful fallback if periodService is absent
}

let logAudit = async () => {};
try {
  const auditSvc = require('./auditService');
  if (auditSvc && auditSvc.logAudit) {
    logAudit = auditSvc.logAudit;
  }
} catch (e) {
  // Graceful fallback if auditService is absent
}

const PaymentService = {
  // =========================================================================
  // 1. البيانات المرجعية (Reference Data)
  // =========================================================================

  async getContexts() {
    return await query('SELECT * FROM payment_contexts WHERE is_active = 1 ORDER BY sort_order ASC, code ASC');
  },

  async getInstruments() {
    return await query('SELECT * FROM payment_instruments WHERE is_active = 1 ORDER BY code ASC');
  },

  async getChannels() {
    return await query(`
      SELECT c.*, a.code as account_code, a.name as account_name
      FROM payment_channels c
      LEFT JOIN accounts a ON c.account_id = a.id
      WHERE c.is_active = 1
      ORDER BY c.id ASC
    `);
  },

  async getTimings() {
    return await query('SELECT * FROM payment_timings WHERE is_active = 1 ORDER BY default_days ASC');
  },

  async getDocuments() {
    return await query('SELECT * FROM payment_documents WHERE is_active = 1 ORDER BY code ASC');
  },

  // =========================================================================
  // 2. منطق العمل الرئيسي (Core Business Logic)
  // =========================================================================

  /**
   * إنشاء معاملة دفع/قبض جديدة مع التحقق الخماسي والقيود المحاسبية التلقائية
   */
  async createPaymentTransaction(data, user = null, req = null) {
    const {
      direction, // 'IN' (قبض) | 'OUT' (صرف)
      transaction_date,
      context_code,
      context_ref_id,
      instrument_code,
      instrument_details = {},
      channel_id,
      timing_code = 'IMMEDIATE',
      scheduled_date,
      document_code = 'MANUAL',
      document_number,
      document_file_url,
      client_id,
      supplier_id,
      project_id,
      contract_id,
      cost_center_id,
      debit_account_id,
      credit_account_id,
      amount,
      currency = 'USD',
      exchange_rate = 1.0000,
      notes = '',
      status = 'posted' // 'draft', 'posted'
    } = data;

    // --- (1) التحقق الأساسي من الحقول الإلزامية ---
    if (!direction || !['IN', 'OUT'].includes(direction)) {
      throw new Error('يرجى تحديد اتجاه المعاملة بشكل صحيح (IN للقبض / OUT للصرف)');
    }
    if (!transaction_date) {
      throw new Error('تاريخ المعاملة مطلوب');
    }
    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      throw new Error('المبلغ يجب أن يكون رقماً موجباً أكبر من الصفر');
    }

    // فحص إغلاق الفترة المحاسبية
    const periodCheck = await checkPeriodOpen(transaction_date);
    if (!periodCheck.isOpen) {
      throw new Error(periodCheck.message || 'الفترة المحاسبية لهذا التاريخ مغلقة');
    }

    // --- (2) التحقق من وجود ونشاط الطبقات الـ 5 ---
    const context = await get('SELECT * FROM payment_contexts WHERE code = ? AND is_active = 1', [context_code]);
    if (!context) {
      throw new Error(`سياق الدفع [${context_code}] غير موجود أو غير نشط`);
    }

    const instrument = await get('SELECT * FROM payment_instruments WHERE code = ? AND is_active = 1', [instrument_code]);
    if (!instrument) {
      throw new Error(`وسيلة الدفع [${instrument_code}] غير موجودة أو غير نشطة`);
    }

    const channel = await get('SELECT * FROM payment_channels WHERE id = ? AND is_active = 1', [Number(channel_id)]);
    if (!channel) {
      throw new Error(`قناة الدفع رقم [${channel_id}] غير موجودة أو غير نشطة`);
    }

    const timing = await get('SELECT * FROM payment_timings WHERE code = ? AND is_active = 1', [timing_code]);
    if (!timing) {
      throw new Error(`توقيت الدفع [${timing_code}] غير موجود أو غير نشط`);
    }

    const document = await get('SELECT * FROM payment_documents WHERE code = ? AND is_active = 1', [document_code]);
    if (!document) {
      throw new Error(`مستند الدفع [${document_code}] غير موجود أو غير نشط`);
    }

    // --- (3) فحص الحد الأقصى لوسيلة الدفع (Max Amount Limit) ---
    if (instrument.max_amount !== null && instrument.max_amount !== undefined) {
      const maxLimit = Number(instrument.max_amount);
      let amountInUsd = numAmount;
      if (currency === 'YER') amountInUsd = numAmount / (Number(exchange_rate) || 530);
      else if (currency === 'SAR') amountInUsd = numAmount / (Number(exchange_rate) || 3.75);

      if (amountInUsd > maxLimit) {
        throw new Error(`⛔ المبلغ المدخل (${numAmount} ${currency}) يتجاوز الحد الأقصى المسموح لوسيلة الدفع [${instrument.name_ar}] وهو (${maxLimit} USD). يرجى اختيار وسيلة دفع أخرى.`);
      }
    }

    // --- (4) فحص الحقول الشرطية (Conditional Fields) ---
    let detailsObj = typeof instrument_details === 'string' ? JSON.parse(instrument_details || '{}') : (instrument_details || {});

    if (instrument.requires_cheque === 1 || instrument_code === 'CHEQUE') {
      const chkNo = detailsObj.cheque_no || data.check_no || data.cheque_no;
      const bnkName = detailsObj.bank_name || data.bank_name;
      if (!chkNo || !String(chkNo).trim()) {
        throw new Error('رقم الشيك إلزامي عند استخدام وسيلة الدفع بالشيك');
      }
      if (!bnkName || !String(bnkName).trim()) {
        throw new Error('اسم البنك المسحوب عليه الشيك إلزامي');
      }
      detailsObj.cheque_no = String(chkNo).trim();
      detailsObj.bank_name = String(bnkName).trim();
    }

    if (instrument.requires_iban === 1 || ['BANK_TRF', 'LC'].includes(instrument_code)) {
      const ibanVal = detailsObj.iban || data.iban || channel.iban;
      if (!ibanVal || !String(ibanVal).trim()) {
        throw new Error('رقم الآيبان (IBAN) أو رقم الحساب البنكي إلزامي لهذه الوسيلة');
      }
      detailsObj.iban = String(ibanVal).trim();
    }

    if (instrument.requires_wallet_phone === 1 || instrument_code === 'WALLET') {
      const phoneVal = detailsObj.wallet_phone || data.wallet_phone || data.phone;
      if (!phoneVal || !String(phoneVal).trim()) {
        throw new Error('رقم هاتف المحفظة الرقمية إلزامي لهذه الوسيلة');
      }
      detailsObj.wallet_phone = String(phoneVal).trim();
    }

    let finalDocNumber = document_number;
    if (document.requires_number === 1 && (!finalDocNumber || !String(finalDocNumber).trim())) {
      finalDocNumber = `DOC-${Date.now().toString().slice(-6)}`;
    }

    // --- (5) حساب العمولات والمبالغ الموضعية ---
    const feePct = Number(instrument.fee_percentage || 0);
    const feeAmount = Math.round((numAmount * (feePct / 100)) * 100) / 100;
    const netAmount = direction === 'IN' 
      ? Math.round((numAmount - feeAmount) * 100) / 100
      : Math.round((numAmount + feeAmount) * 100) / 100;

    const rate = Number(exchange_rate) || 1.0;
    const localAmount = Math.round((numAmount * rate) * 100) / 100;

    // --- (6) تحديد وتأكيد الحسابات المالية التلقائية (Deny by Default) ---
    let finalDebitAccountId = debit_account_id ? Number(debit_account_id) : null;
    let finalCreditAccountId = credit_account_id ? Number(credit_account_id) : null;

    // حساب القناة (الصندوق أو البنك)
    let channelAccountId = channel.account_id;
    if (!channelAccountId) {
      if (channel.type === 'cash_box') {
        const cashAccount = await AccountingService.resolveCashAccount();
        channelAccountId = cashAccount.id;
      } else {
        const bankAccount = await AccountingService.resolveBankAccount(null, channel.bank_name);
        channelAccountId = bankAccount.coaAccount.id;
      }
    }

    if (direction === 'IN') {
      // مدين = حساب القناة (الصندوق/البنك)
      if (!finalDebitAccountId) finalDebitAccountId = channelAccountId;
      // دائن = حساب العميل أو الإيراد
      if (!finalCreditAccountId && client_id) {
        const client = await get('SELECT * FROM clients WHERE id = ?', [Number(client_id)]);
        if (client && client.account_id) finalCreditAccountId = client.account_id;
      }
      if (!finalCreditAccountId && context.default_credit_account_code) {
        const defAcc = await get('SELECT id FROM accounts WHERE code = ? AND is_posting = 1', [context.default_credit_account_code]);
        if (defAcc) finalCreditAccountId = defAcc.id;
      }
    } else {
      // OUT: مدين = حساب المورد أو المصروف
      if (!finalDebitAccountId && supplier_id) {
        const supplier = await get('SELECT * FROM suppliers WHERE id = ?', [Number(supplier_id)]);
        if (supplier && supplier.account_id) finalDebitAccountId = supplier.account_id;
      }
      if (!finalDebitAccountId && context.default_debit_account_code) {
        const defAcc = await get('SELECT id FROM accounts WHERE code = ? AND is_posting = 1', [context.default_debit_account_code]);
        if (defAcc) finalDebitAccountId = defAcc.id;
      }
      // دائن = حساب القناة (الصندوق/البنك)
      if (!finalCreditAccountId) finalCreditAccountId = channelAccountId;
    }

    if (!finalDebitAccountId || !finalCreditAccountId) {
      throw new Error('لم يتم التمكن من تحديد الحسابات المالية (المدين والدائن) تلقائياً، يرجى تحديدها يدوياً');
    }

    // التحقق الصارم من أن كلا الحسابين فرعيان أخيران (Deny by Default)
    const debitAccountObj = await AccountingService.assertLeafAccount(finalDebitAccountId);
    const creditAccountObj = await AccountingService.assertLeafAccount(finalCreditAccountId);

    // --- (7) توليد رقم المعاملة الفريد ---
    const currentYear = new Date(transaction_date).getFullYear();
    const countRow = await get('SELECT COUNT(*) as cnt FROM payment_transactions WHERE direction = ?', [direction]);
    const seq = (countRow?.cnt || 0) + 1;
    const prefix = direction === 'IN' ? 'RCV' : 'PAY';
    const txNo = `${prefix}-${currentYear}-${String(seq).padStart(5, '0')}`;

    // حالة المقاصة والتصفية للأداة
    let clearingStatus = 'cleared';
    let actualDateVal = transaction_date;
    if (instrument.clearance_days > 0 || instrument_code === 'CHEQUE' || timing_code === 'DEFERRED') {
      clearingStatus = 'pending';
      actualDateVal = null;
    }

    // --- (8) التحديث والحفظ داخل DB Transaction ذرية ---
    let transactionId = null;
    let journalEntryResult = null;

    await transaction(async (tx) => {
      const res = await tx.run(`
        INSERT INTO payment_transactions (
          transaction_no, transaction_date, direction,
          context_code, context_ref_id,
          instrument_code, instrument_details,
          channel_id, timing_code, scheduled_date, actual_date, clearing_status,
          document_code, document_number, document_file_url,
          client_id, supplier_id, project_id, contract_id, cost_center_id,
          debit_account_id, credit_account_id,
          amount, currency, exchange_rate, local_amount, fee_amount, net_amount,
          status, notes, created_by, approved_by, posted_by, created_at
        ) VALUES (
          ?, ?, ?,
          ?, ?,
          ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, CURRENT_TIMESTAMP
        )
      `, [
        txNo, transaction_date, direction,
        context_code, context_ref_id || null,
        instrument_code, JSON.stringify(detailsObj),
        channel.id, timing_code, scheduled_date || null, actualDateVal, clearingStatus,
        document_code, finalDocNumber || null, document_file_url || null,
        client_id ? Number(client_id) : null,
        supplier_id ? Number(supplier_id) : null,
        project_id ? Number(project_id) : null,
        contract_id ? Number(contract_id) : null,
        cost_center_id ? Number(cost_center_id) : null,
        debitAccountObj.id, creditAccountObj.id,
        numAmount, currency, rate, localAmount, feeAmount, netAmount,
        status, notes.trim(),
        user?.id || null,
        status === 'posted' ? user?.id || null : null,
        status === 'posted' ? user?.id || null : null
      ]);

      transactionId = res.lastInsertRowid || res.insertId;

      // --- (9) إنشاء قيد يومية محاسبي متزن تلقائياً عند الترحيل ---
      if (status === 'posted') {
        const lines = [
          {
            account_id: debitAccountObj.id,
            cost_center_id: cost_center_id || null,
            debit: localAmount,
            credit: 0,
            description: `${direction === 'IN' ? 'قبض' : 'صرف'} - ${context.name_ar} (${txNo}) - ${notes || debitAccountObj.name}`
          },
          {
            account_id: creditAccountObj.id,
            cost_center_id: cost_center_id || null,
            debit: 0,
            credit: localAmount,
            description: `${direction === 'IN' ? 'تحصيل' : 'سداد'} - ${context.name_ar} (${txNo}) - ${notes || creditAccountObj.name}`
          }
        ];

        // تسجيل العمولة المصرفية إذا وجد مبلغ عمولة
        if (feeAmount > 0) {
          const feeLocal = Math.round((feeAmount * rate) * 100) / 100;
          const bankFeeAcc = await tx.get('SELECT id FROM accounts WHERE code = ? AND is_posting = 1', ['52501001']); // عمولات بنكية
          const feeAccId = bankFeeAcc ? bankFeeAcc.id : debitAccountObj.id;
          
          lines.push({
            account_id: feeAccId,
            cost_center_id: cost_center_id || null,
            debit: feeLocal,
            credit: 0,
            description: `عمولة خدمة وسيلة الدفع [${instrument.name_ar}] المعاملة ${txNo}`
          });
          // تعديل الطرف الدائن ليعادل الإجمالي
          lines[1].credit = Math.round((lines[1].credit + feeLocal) * 100) / 100;
        }

        const refType = direction === 'IN' ? 'سند قبض خماسي' : 'سند صرف خماسي';
        const jeDesc = `معاملة [${txNo}] ${context.name_ar} - وسيلة: ${instrument.name_ar} - قناة: ${channel.name_ar}`;

        journalEntryResult = await AccountingService.createJournalEntry(
          {
            date: transaction_date,
            description: jeDesc,
            reference_type: refType,
            reference_id: transactionId,
            status: 'posted'
          },
          lines,
          req,
          tx
        );

        // ربط المعاملة بالقيد المحاسبي
        await tx.run('UPDATE payment_transactions SET journal_entry_id = ? WHERE id = ?', [journalEntryResult.id, transactionId]);
      }

      // --- (10) تحديث رصيد المستخلص / الفاتورة (IPC Balance Update) ---
      if (context_ref_id && (context.requires_ipc === 1 || context_code === 'IPC')) {
        const bill = await tx.get('SELECT * FROM bills WHERE id = ?', [Number(context_ref_id)]);
        if (bill) {
          const updatedPaid = Math.round(((Number(bill.paid_amount || 0)) + numAmount) * 100) / 100;
          const updatedRemaining = Math.max(0, Math.round(((Number(bill.net_amount || bill.amount || 0)) - updatedPaid) * 100) / 100);
          const newPaymentStatus = updatedRemaining <= 0 ? 'paid' : 'partially_paid';

          await tx.run(`
            UPDATE bills
            SET paid_amount = ?, remaining_amount = ?, payment_status = ?
            WHERE id = ?
          `, [updatedPaid, updatedRemaining, newPaymentStatus, bill.id]);
        }
      }
    });

    // --- (11) توثيق التدقيق المالي ---
    if (req) {
      await logAudit(req, {
        action: 'CREATE_PAYMENT_TRANSACTION',
        entity_type: 'payment_transaction',
        entity_id: txNo,
        details: { transaction_no: txNo, direction, amount: numAmount, currency, context_code, instrument_code, channel_id }
      });
    }

    return {
      id: transactionId,
      transaction_no: txNo,
      direction,
      amount: numAmount,
      currency,
      local_amount: localAmount,
      fee_amount: feeAmount,
      net_amount: netAmount,
      journal_entry_id: journalEntryResult?.id || null,
      journal_entry_no: journalEntryResult?.entry_no || null,
      clearing_status: clearingStatus,
      status
    };
  },

  /**
   * جلب المعاملات المالية مع الفلاتر والصفحات (Pagination & Filtering)
   */
  async getTransactions(filters = {}) {
    const {
      direction,
      status,
      clearing_status,
      context_code,
      instrument_code,
      channel_id,
      timing_code,
      project_id,
      client_id,
      supplier_id,
      start_date,
      end_date,
      search,
      page = 1,
      limit = 25
    } = filters;

    let sql = `
      SELECT t.*,
             ctx.name_ar as context_name_ar, ctx.icon as context_icon,
             ins.name_ar as instrument_name_ar, ins.icon as instrument_icon,
             chn.name_ar as channel_name_ar, chn.icon as channel_icon,
             tmg.name_ar as timing_name_ar,
             doc.name_ar as document_name_ar,
             c.name as client_name,
             s.name as supplier_name, s.company_name as supplier_company,
             p.name as project_name, p.code as project_code,
             da.name as debit_account_name, da.code as debit_account_code,
             ca.name as credit_account_name, ca.code as credit_account_code,
             je.entry_no as journal_entry_no
      FROM payment_transactions t
      LEFT JOIN payment_contexts ctx ON t.context_code = ctx.code
      LEFT JOIN payment_instruments ins ON t.instrument_code = ins.code
      LEFT JOIN payment_channels chn ON t.channel_id = chn.id
      LEFT JOIN payment_timings tmg ON t.timing_code = tmg.code
      LEFT JOIN payment_documents doc ON t.document_code = doc.code
      LEFT JOIN clients c ON t.client_id = c.id
      LEFT JOIN suppliers s ON t.supplier_id = s.id
      LEFT JOIN projects p ON t.project_id = p.id
      LEFT JOIN accounts da ON t.debit_account_id = da.id
      LEFT JOIN accounts ca ON t.credit_account_id = ca.id
      LEFT JOIN journal_entries je ON t.journal_entry_id = je.id
      WHERE 1=1
    `;

    const params = [];

    if (direction) {
      sql += ' AND t.direction = ?';
      params.push(direction);
    }
    if (status) {
      sql += ' AND t.status = ?';
      params.push(status);
    }
    if (clearing_status) {
      sql += ' AND t.clearing_status = ?';
      params.push(clearing_status);
    }
    if (context_code) {
      sql += ' AND t.context_code = ?';
      params.push(context_code);
    }
    if (instrument_code) {
      sql += ' AND t.instrument_code = ?';
      params.push(instrument_code);
    }
    if (channel_id) {
      sql += ' AND t.channel_id = ?';
      params.push(Number(channel_id));
    }
    if (timing_code) {
      sql += ' AND t.timing_code = ?';
      params.push(timing_code);
    }
    if (project_id) {
      sql += ' AND t.project_id = ?';
      params.push(Number(project_id));
    }
    if (client_id) {
      sql += ' AND t.client_id = ?';
      params.push(Number(client_id));
    }
    if (supplier_id) {
      sql += ' AND t.supplier_id = ?';
      params.push(Number(supplier_id));
    }
    if (start_date) {
      sql += ' AND t.transaction_date >= ?';
      params.push(start_date);
    }
    if (end_date) {
      sql += ' AND t.transaction_date <= ?';
      params.push(end_date);
    }
    if (search && String(search).trim()) {
      sql += ' AND (t.transaction_no LIKE ? OR t.notes LIKE ? OR t.document_number LIKE ? OR c.name LIKE ? OR s.name LIKE ?)';
      const q = `%${search.trim()}%`;
      params.push(q, q, q, q, q);
    }

    // إحصاء الإجمالي
    const countSql = `SELECT COUNT(*) as total FROM (${sql}) as count_sub`;
    const countRes = await get(countSql, params);
    const totalRecords = countRes?.total || 0;

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Number(limit) || 25);
    const offset = (pageNum - 1) * limitNum;

    sql += ' ORDER BY t.transaction_date DESC, t.id DESC LIMIT ? OFFSET ?';
    params.push(limitNum, offset);

    const data = await query(sql, params);

    return {
      data,
      pagination: {
        total: totalRecords,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(totalRecords / limitNum)
      }
    };
  },

  async getTransactionById(id) {
    const res = await this.getTransactions({ search: '', limit: 1 });
    const item = await get(`
      SELECT t.*,
             ctx.name_ar as context_name_ar, ins.name_ar as instrument_name_ar,
             chn.name_ar as channel_name_ar, tmg.name_ar as timing_name_ar, doc.name_ar as document_name_ar,
             c.name as client_name, s.name as supplier_name, p.name as project_name,
             da.name as debit_account_name, da.code as debit_account_code,
             ca.name as credit_account_name, ca.code as credit_account_code,
             je.entry_no as journal_entry_no
      FROM payment_transactions t
      LEFT JOIN payment_contexts ctx ON t.context_code = ctx.code
      LEFT JOIN payment_instruments ins ON t.instrument_code = ins.code
      LEFT JOIN payment_channels chn ON t.channel_id = chn.id
      LEFT JOIN payment_timings tmg ON t.timing_code = tmg.code
      LEFT JOIN payment_documents doc ON t.document_code = doc.code
      LEFT JOIN clients c ON t.client_id = c.id
      LEFT JOIN suppliers s ON t.supplier_id = s.id
      LEFT JOIN projects p ON t.project_id = p.id
      LEFT JOIN accounts da ON t.debit_account_id = da.id
      LEFT JOIN accounts ca ON t.credit_account_id = ca.id
      LEFT JOIN journal_entries je ON t.journal_entry_id = je.id
      WHERE t.id = ?
    `, [Number(id)]);

    if (!item) throw new Error('المعاملة غير موجودة');

    try {
      item.instrument_details = JSON.parse(item.instrument_details || '{}');
    } catch (e) {
      item.instrument_details = {};
    }

    return item;
  },

  /**
   * اعتماد وتثبيت المسودة (Approve Draft Transaction)
   */
  async approveTransaction(id, user = null, req = null) {
    const txItem = await this.getTransactionById(id);
    if (txItem.status !== 'draft' && txItem.status !== 'pending') {
      throw new Error('المعاملة معتمدة أو مأرشفة بالفعل ولا يمكن إعادة اعتمادها');
    }

    let journalEntryResult = null;
    await transaction(async (tx) => {
      // إنشاء القيد اليومي
      const lines = [
        { account_id: txItem.debit_account_id, debit: txItem.local_amount, credit: 0, description: `اعتماد ${txItem.transaction_no}` },
        { account_id: txItem.credit_account_id, debit: 0, credit: txItem.local_amount, description: `اعتماد ${txItem.transaction_no}` }
      ];

      journalEntryResult = await AccountingService.createJournalEntry({
        date: txItem.transaction_date,
        description: `اعتماد المعاملة [${txItem.transaction_no}]`,
        reference_type: txItem.direction === 'IN' ? 'سند قبض خماسي' : 'سند صرف خماسي',
        reference_id: txItem.id,
        status: 'posted'
      }, lines, req);

      await tx.run(`
        UPDATE payment_transactions
        SET status = 'posted', approved_by = ?, posted_by = ?, journal_entry_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [user?.id || null, user?.id || null, journalEntryResult.id, txItem.id]);
    });

    return { success: true, message: 'تم اعتماد وتثبيت المعاملة وتوليد القيد بنجاح', journal_entry_id: journalEntryResult.id };
  },

  /**
   * مقاصة وتصفية المعاملة (Clear Transaction)
   */
  async clearTransaction(id, user = null, req = null) {
    const txItem = await this.getTransactionById(id);
    if (txItem.clearing_status === 'cleared') {
      throw new Error('المعاملة تم تصفيتها ومقاصتها سابقاً');
    }

    await run(`
      UPDATE payment_transactions
      SET clearing_status = 'cleared', actual_date = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [new Date().toISOString().split('T')[0], Number(id)]);

    return { success: true, message: 'تم مقاصة وتصفية المعاملة بنجاح' };
  },

  /**
   * إرجاع الشيك أو رفض التحويل (Bounce Transaction)
   */
  async bounceTransaction(id, reason = '', user = null, req = null) {
    const txItem = await this.getTransactionById(id);
    if (txItem.clearing_status === 'bounced' || txItem.status === 'bounced') {
      throw new Error('المعاملة مرفوضة / مرجعة بالفعل');
    }

    await transaction(async (tx) => {
      // إذا كان هناك قيد يومية، ننشئ قيداً عكسياً
      if (txItem.journal_entry_id) {
        const origJe = await tx.get('SELECT * FROM journal_entries WHERE id = ?', [txItem.journal_entry_id]);
        if (origJe) {
          const origLines = await query('SELECT * FROM journal_entry_lines WHERE entry_id = ?', [origJe.id]);
          const reverseLines = origLines.map(l => ({
            account_id: l.account_id,
            cost_center_id: l.cost_center_id,
            debit: l.credit,
            credit: l.debit,
            description: `قيد عكسي لرفض المعاملة ${txItem.transaction_no} - ${reason}`
          }));

          await AccountingService.createJournalEntry({
            date: new Date().toISOString().split('T')[0],
            description: `قيد عكسي لارتجاع شيك/رفض المعاملة [${txItem.transaction_no}] - السبب: ${reason}`,
            reference_type: 'إلغاء معاملة دفع',
            reference_id: txItem.id,
            status: 'posted'
          }, reverseLines, req);
        }
      }

      await tx.run(`
        UPDATE payment_transactions
        SET clearing_status = 'bounced', status = 'bounced', notes = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [`[مرفوض/مرجع]: ${reason} | ${txItem.notes || ''}`, Number(id)]);
    });

    return { success: true, message: 'تم تسجيل رفض/ارتجاع المعاملة وإنشاء القيد العكسي بنجاح' };
  },

  /**
   * عكس المعاملة بالكامل (Reverse Transaction)
   */
  async reverseTransaction(id, reason = '', user = null, req = null) {
    const txItem = await this.getTransactionById(id);
    if (txItem.status === 'reversed') {
      throw new Error('المعاملة معكوسة بالفعل');
    }

    await transaction(async (tx) => {
      if (txItem.journal_entry_id) {
        const origLines = await query('SELECT * FROM journal_entry_lines WHERE entry_id = ?', [txItem.journal_entry_id]);
        const revLines = origLines.map(l => ({
          account_id: l.account_id,
          cost_center_id: l.cost_center_id,
          debit: l.credit,
          credit: l.debit,
          description: `عكس معاملة ${txItem.transaction_no} - ${reason}`
        }));

        await AccountingService.createJournalEntry({
          date: new Date().toISOString().split('T')[0],
          description: `قيد عكسي للمعاملة [${txItem.transaction_no}] - السبب: ${reason}`,
          reference_type: 'عكس معاملة خماسية',
          reference_id: txItem.id,
          status: 'posted'
        }, revLines, req);
      }

      // إذا كانت مرتبطة بمستخلص، نعيد تخصيص الرصيد
      if (txItem.context_ref_id) {
        const bill = await tx.get('SELECT * FROM bills WHERE id = ?', [txItem.context_ref_id]);
        if (bill) {
          const updatedPaid = Math.max(0, Math.round(((Number(bill.paid_amount || 0)) - txItem.amount) * 100) / 100);
          const updatedRemaining = Math.round(((Number(bill.net_amount || bill.amount || 0)) - updatedPaid) * 100) / 100;
          const newStatus = updatedPaid <= 0 ? 'unpaid' : 'partially_paid';
          await tx.run('UPDATE bills SET paid_amount = ?, remaining_amount = ?, payment_status = ? WHERE id = ?', [
            updatedPaid, updatedRemaining, newStatus, bill.id
          ]);
        }
      }

      await tx.run(`
        UPDATE payment_transactions
        SET status = 'reversed', notes = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [`[معكوس]: ${reason} | ${txItem.notes || ''}`, Number(id)]);
    });

    return { success: true, message: 'تم عكس المعاملة وتحديث الرصيد بنجاح' };
  },

  // =========================================================================
  // 3. التقارير والتحليلات (Reports & Analytics)
  // =========================================================================

  async getReportByContext(filters = {}) {
    return await query(`
      SELECT ctx.code, ctx.name_ar, ctx.name_en, ctx.icon,
             COUNT(t.id) as total_count,
             SUM(CASE WHEN t.direction = 'IN' THEN t.local_amount ELSE 0 END) as total_in,
             SUM(CASE WHEN t.direction = 'OUT' THEN t.local_amount ELSE 0 END) as total_out
      FROM payment_contexts ctx
      LEFT JOIN payment_transactions t ON ctx.code = t.context_code AND t.status != 'reversed'
      GROUP BY ctx.code, ctx.name_ar, ctx.name_en, ctx.icon
      ORDER BY total_in DESC, total_out DESC
    `);
  },

  async getReportByInstrument(filters = {}) {
    return await query(`
      SELECT ins.code, ins.name_ar, ins.name_en, ins.icon, ins.category,
             COUNT(t.id) as total_count,
             SUM(CASE WHEN t.direction = 'IN' THEN t.local_amount ELSE 0 END) as total_in,
             SUM(CASE WHEN t.direction = 'OUT' THEN t.local_amount ELSE 0 END) as total_out,
             SUM(t.fee_amount) as total_fees
      FROM payment_instruments ins
      LEFT JOIN payment_transactions t ON ins.code = t.instrument_code AND t.status != 'reversed'
      GROUP BY ins.code, ins.name_ar, ins.name_en, ins.icon, ins.category
      ORDER BY total_in DESC
    `);
  },

  async getReportByChannel(filters = {}) {
    return await query(`
      SELECT chn.id, chn.code, chn.name_ar, chn.name_en, chn.type, chn.currency,
             COUNT(t.id) as total_count,
             SUM(CASE WHEN t.direction = 'IN' THEN t.local_amount ELSE 0 END) as total_in,
             SUM(CASE WHEN t.direction = 'OUT' THEN t.local_amount ELSE 0 END) as total_out
      FROM payment_channels chn
      LEFT JOIN payment_transactions t ON chn.id = t.channel_id AND t.status != 'reversed'
      GROUP BY chn.id, chn.code, chn.name_ar, chn.name_en, chn.type, chn.currency
      ORDER BY total_in DESC
    `);
  },

  async getReportByTiming(filters = {}) {
    return await query(`
      SELECT tmg.code, tmg.name_ar, tmg.name_en, tmg.default_days,
             COUNT(t.id) as total_count,
             SUM(CASE WHEN t.direction = 'IN' THEN t.local_amount ELSE 0 END) as total_in,
             SUM(CASE WHEN t.direction = 'OUT' THEN t.local_amount ELSE 0 END) as total_out
      FROM payment_timings tmg
      LEFT JOIN payment_transactions t ON tmg.code = t.timing_code AND t.status != 'reversed'
      GROUP BY tmg.code, tmg.name_ar, tmg.name_en, tmg.default_days
    `);
  },

  async getCashFlowForecast(months = 6) {
    return await query(`
      SELECT strftime('%Y-%m', transaction_date) as month_key,
             SUM(CASE WHEN direction = 'IN' THEN local_amount ELSE 0 END) as total_in,
             SUM(CASE WHEN direction = 'OUT' THEN local_amount ELSE 0 END) as total_out,
             (SUM(CASE WHEN direction = 'IN' THEN local_amount ELSE 0 END) - SUM(CASE WHEN direction = 'OUT' THEN local_amount ELSE 0 END)) as net_flow
      FROM payment_transactions
      WHERE status != 'reversed'
      GROUP BY month_key
      ORDER BY month_key DESC
      LIMIT ?
    `, [Number(months)]);
  },

  async getPendingClearance() {
    return await query(`
      SELECT t.*, ins.name_ar as instrument_name, chn.name_ar as channel_name,
             c.name as client_name, s.name as supplier_name
      FROM payment_transactions t
      JOIN payment_instruments ins ON t.instrument_code = ins.code
      JOIN payment_channels chn ON t.channel_id = chn.id
      LEFT JOIN clients c ON t.client_id = c.id
      LEFT JOIN suppliers s ON t.supplier_id = s.id
      WHERE t.clearing_status = 'pending' AND t.status != 'reversed'
      ORDER BY t.transaction_date ASC
    `);
  },

  // =========================================================================
  // 6. منظومة المدفوعات الحديثة والعمليات المالية المتقدمة (Modern Payment System)
  // =========================================================================

  PAYMENT_STATUSES: {
    PENDING: 'PENDING',
    PAID: 'PAID',
    FAILED: 'FAILED',
    REFUNDED: 'REFUNDED',
    PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
    CANCELED: 'CANCELED'
  },

  async getPaymentMethods() {
    return await query('SELECT * FROM payment_methods WHERE is_active = 1 ORDER BY id ASC');
  },

  async getFinancialAccounts(type = null) {
    let sql = `
      SELECT fa.*, a.code as account_code, a.name as account_name
      FROM financial_accounts fa
      JOIN accounts a ON fa.account_id = a.id
      WHERE fa.is_active = 1
    `;
    const params = [];
    if (type) {
      sql += ' AND fa.type = ?';
      params.push(type);
    }
    sql += ' ORDER BY fa.id ASC';
    return await query(sql, params);
  },

  /**
   * إنشاء معاملة دفع حديثة مع حماية Idempotency والتحقق من الحسابات الفرعية
   */
  async initiatePayment(data) {
    const {
      paymentMethodCode,
      paymentMethodId,
      financialAccountId,
      type = 'قبض',
      amount,
      feeAmount = 0,
      accountId,
      reference,
      externalTransactionId,
      gatewayName,
      notes = '',
      idempotencyKey,
      autoCapture = true,
      user = null,
      date = null
    } = data;

    // 1. فحص منع التكرار المالي عبر مفتاح Idempotency
    if (idempotencyKey) {
      const existing = await get('SELECT * FROM payments WHERE idempotency_key = ?', [idempotencyKey]);
      if (existing) {
        let existingJe = null;
        if (existing.journal_entry_id) {
          existingJe = await get('SELECT * FROM journal_entries WHERE id = ?', [existing.journal_entry_id]);
        }
        return {
          isDuplicate: true,
          payment: existing,
          journalEntry: existingJe
        };
      }
    }

    // 2. التحقق من المدخلات الأساسية
    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      throw new Error('المبلغ يجب أن يكون رقماً موجباً أكبر من الصفر');
    }
    const numFee = Math.max(0, Number(feeAmount) || 0);
    const txnDate = date || new Date().toISOString().split('T')[0];

    // فحص الفترة المحاسبية
    const periodCheck = await checkPeriodOpen(txnDate);
    if (!periodCheck.isOpen) {
      throw new Error(periodCheck.message || 'الفترة المحاسبية لهذا التاريخ مغلقة');
    }

    // 3. التحقق من طريقة الدفع
    let pm = null;
    if (paymentMethodCode) {
      pm = await get('SELECT * FROM payment_methods WHERE code = ? AND is_active = 1', [paymentMethodCode]);
    } else if (paymentMethodId) {
      pm = await get('SELECT * FROM payment_methods WHERE id = ? AND is_active = 1', [paymentMethodId]);
    }
    if (!pm) {
      throw new Error('طريقة الدفع غير صالحة أو غير نشطة');
    }

    // 4. التحقق من الحساب المالي وفصل الصلاحيات (صندوق / بنك / بوابة)
    const fa = await get('SELECT * FROM financial_accounts WHERE id = ? AND is_active = 1', [financialAccountId]);
    if (!fa) {
      throw new Error('الحساب المالي غير موجود أو غير نشط');
    }

    // التحقق الرقابي الصارم: منع ربط حساب بنك بطريقة الدفع نقداً والعكس
    if (pm.code === 'CASH' && fa.type !== 'cash') {
      throw new Error('طريقة الدفع نقداً تتطلب صندوق نقدي وليس حساب بنكي أو بوابة دفع');
    }
    if (pm.code === 'BANK_TRANSFER' && fa.type !== 'bank') {
      throw new Error('طريقة التحويل البنكي تتطلب حساب بنكي وليس صندوق نقدي');
    }
    if (pm.code === 'ONLINE_GATEWAY' && fa.type !== 'gateway') {
      throw new Error('طريقة الدفع عبر البوابة تتطلب حساب بوابة دفع إلكترونية');
    }

    // 5. التحقق الصارم من الحساب المحاسبي الهدف (Deny by default على الحساب الأب)
    if (!accountId) {
      throw new Error('الحساب المحاسبي المقابل مطلوب');
    }
    const targetAccount = await AccountingService.assertLeafAccount(accountId);
    const financialCoaAccount = await AccountingService.assertLeafAccount(fa.account_id);

    // 6. حساب صافي المبلغ ورسوم البوابة/البطاقة
    const netAmount = type === 'قبض'
      ? Math.round((numAmount - numFee) * 100) / 100
      : Math.round((numAmount + numFee) * 100) / 100;

    const initialStatus = autoCapture ? 'PAID' : 'PENDING';
    const paymentNo = `PAY-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;

    // 7. إنشاء السجل في جدول payments
    const res = await run(`
      INSERT INTO payments (
        payment_no, receipt_no, type, date, amount, fee_amount, net_amount,
        payment_method_id, payment_method, financial_account_id, account_id,
        status, idempotency_key, external_transaction_id, gateway_name, notes,
        created_by, created_by_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      paymentNo, paymentNo, type, txnDate, numAmount, numFee, netAmount,
      pm.id, pm.code, fa.id, targetAccount.id,
      initialStatus, idempotencyKey || null, externalTransactionId || null, gatewayName || null, notes,
      user?.id || 1, user?.username || 'admin'
    ]);

    const paymentId = Number(res.id || res.lastInsertRowid || res.insertId);
    const paymentRecord = await get('SELECT * FROM payments WHERE id = ?', [paymentId]);

    let journalEntry = null;

    // 8. إنشاء القيد المحاسبي في حالة الاعتماد الفوري (autoCapture = true)
    if (autoCapture) {
      journalEntry = await this._createPaymentJournalEntry({
        payment: paymentRecord,
        financialCoaAccount,
        targetAccount,
        amount: numAmount,
        fee: numFee,
        net: netAmount,
        type,
        user,
        date: txnDate,
        notes
      });

      await run('UPDATE payments SET journal_entry_id = ? WHERE id = ?', [journalEntry.id, paymentId]);
      paymentRecord.journal_entry_id = journalEntry.id;
    }

    return {
      isDuplicate: false,
      payment: paymentRecord,
      journalEntry
    };
  },

  /**
   * مساعدة داخلية لإنشاء قيد اليومية للسند بدقة متناهية
   */
  async _createPaymentJournalEntry({ payment, financialCoaAccount, targetAccount, amount, fee, net, type, user, date, notes }) {
    const entryNo = `JE-PAY-${Date.now().toString().slice(-6)}`;
    const lines = [];

    // البحث عن حساب مصروف العمولات والرسوم البنكية
    let feeAccount = null;
    if (fee > 0) {
      feeAccount = await get("SELECT * FROM accounts WHERE code = '31101001' AND is_posting = 1") ||
                         await get("SELECT * FROM accounts WHERE name LIKE '%عمولات بنكية%' AND is_posting = 1 LIMIT 1");
      if (!feeAccount) {
        feeAccount = await get("SELECT * FROM accounts WHERE is_posting = 1 AND (code LIKE '5%' OR type IN ('expense', 'مصروفات')) LIMIT 1");
      }
    }

    if (type === 'قبض') {
      if (fee > 0 && feeAccount) {
        // قيد ثلاثي متزن: مدين صافي البنك + مدين رسوم بوابة = دائن إجمالي الإيراد/العميل
        lines.push({
          account_id: financialCoaAccount.id,
          debit: net,
          credit: 0,
          notes: `تحصيل سند رقم [${payment.payment_no}] - صافي في ${financialCoaAccount.name}`
        });
        lines.push({
          account_id: feeAccount.id,
          debit: fee,
          credit: 0,
          notes: `رسوم وعمولة التحصيل لسند رقم [${payment.payment_no}]`
        });
        lines.push({
          account_id: targetAccount.id,
          debit: 0,
          credit: amount,
          notes: notes || `تحصيل مستحق لسند [${payment.payment_no}]`
        });
      } else {
        lines.push({
          account_id: financialCoaAccount.id,
          debit: amount,
          credit: 0,
          notes: `تحصيل نقدي/بنكي لسند رقم [${payment.payment_no}]`
        });
        lines.push({
          account_id: targetAccount.id,
          debit: 0,
          credit: amount,
          notes: notes || `تحصيل مستحق لسند [${payment.payment_no}]`
        });
      }
    } else {
      // صرف
      if (fee > 0 && feeAccount) {
        lines.push({
          account_id: targetAccount.id,
          debit: amount,
          credit: 0,
          notes: notes || `صرف مستحق لسند [${payment.payment_no}]`
        });
        lines.push({
          account_id: feeAccount.id,
          debit: fee,
          credit: 0,
          notes: `رسوم وعمولة الصرف لسند رقم [${payment.payment_no}]`
        });
        lines.push({
          account_id: financialCoaAccount.id,
          debit: 0,
          credit: Math.round((amount + fee) * 100) / 100,
          notes: `صرف من ${financialCoaAccount.name}`
        });
      } else {
        lines.push({
          account_id: targetAccount.id,
          debit: amount,
          credit: 0,
          notes: notes || `صرف مستحق لسند [${payment.payment_no}]`
        });
        lines.push({
          account_id: financialCoaAccount.id,
          debit: 0,
          credit: amount,
          notes: `صرف من ${financialCoaAccount.name}`
        });
      }
    }

    const je = await AccountingService.createJournalEntry({
      date: date || payment.date,
      description: `قيد سند ${type}: ${payment.payment_no}`,
      reference_type: 'PAYMENT',
      reference_id: payment.id,
      status: 'posted'
    }, lines, { user });

    return je;
  },

  /**
   * اعتماد وترحيل عملية الدفع المعلقة (Capture Payment)
   */
  async capturePayment(paymentId, { externalTransactionId, feeAmount, user, req } = {}) {
    const payment = await get('SELECT * FROM payments WHERE id = ?', [Number(paymentId)]);
    if (!payment) {
      throw new Error(`معاملة الدفع برقم [${paymentId}] غير موجودة`);
    }
    if (payment.status !== 'PENDING') {
      throw new Error(`المعاملة بحالة [${payment.status}] وليست في حالة معلقة PENDING`);
    }

    const numAmount = Number(payment.amount);
    const numFee = feeAmount !== undefined ? Math.max(0, Number(feeAmount)) : Number(payment.fee_amount || 0);
    const netAmount = payment.type === 'قبض'
      ? Math.round((numAmount - numFee) * 100) / 100
      : Math.round((numAmount + numFee) * 100) / 100;

    const fa = await get('SELECT * FROM financial_accounts WHERE id = ?', [payment.financial_account_id]);
    const financialCoaAccount = await AccountingService.assertLeafAccount(fa.account_id);
    const targetAccount = await AccountingService.assertLeafAccount(payment.account_id);

    const journalEntry = await this._createPaymentJournalEntry({
      payment,
      financialCoaAccount,
      targetAccount,
      amount: numAmount,
      fee: numFee,
      net: netAmount,
      type: payment.type,
      user,
      date: payment.date,
      notes: payment.notes
    });

    await run(`
      UPDATE payments
      SET status = 'PAID',
          fee_amount = ?,
          net_amount = ?,
          external_transaction_id = COALESCE(?, external_transaction_id),
          journal_entry_id = ?,
          posted_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [numFee, netAmount, externalTransactionId || null, journalEntry.id, payment.id]);

    const updatedPayment = await get('SELECT * FROM payments WHERE id = ?', [payment.id]);
    return {
      payment: updatedPayment,
      journalEntry
    };
  },

  /**
   * الاسترداد المالي (Refund) كامل أو جزئي
   */
  async refundPayment(paymentId, { amount, reason = '', reference = '', user, req } = {}) {
    const payment = await get('SELECT * FROM payments WHERE id = ?', [Number(paymentId)]);
    if (!payment) {
      throw new Error(`معاملة الدفع برقم [${paymentId}] غير موجودة`);
    }
    if (payment.status !== 'PAID' && payment.status !== 'PARTIALLY_REFUNDED') {
      throw new Error(`لا يمكن استرداد معاملة غير مدفوعة (الحالة الحالية: ${payment.status})`);
    }

    const currentRefunded = Number(payment.refunded_amount || 0);
    const originalAmount = Number(payment.amount);
    const remainingToRefund = Math.round((originalAmount - currentRefunded) * 100) / 100;

    const refAmount = Number(amount);
    if (isNaN(refAmount) || refAmount <= 0) {
      throw new Error('مبلغ الاسترداد يجب أن يكون رقماً موجباً أكبر من الصفر');
    }
    if (refAmount > remainingToRefund) {
      throw new Error(`المبلغ المطلوب استرداده (${refAmount}) يتجاوز المتبقي من العملية (${remainingToRefund})`);
    }

    const newRefunded = Math.round((currentRefunded + refAmount) * 100) / 100;
    const newStatus = newRefunded >= originalAmount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    const refundNo = `REF-${Date.now().toString().slice(-6)}`;

    const fa = await get('SELECT * FROM financial_accounts WHERE id = ?', [payment.financial_account_id]);
    const financialCoaAccount = await AccountingService.assertLeafAccount(fa.account_id);
    const targetAccount = await AccountingService.assertLeafAccount(payment.account_id);

    // قيد عكسي للاسترداد المالي
    const lines = [];

    if (payment.type === 'قبض') {
      // استرداد قبض: مدين الحساب الهدف (إيراد/عميل) ودائن الحساب المالي (صندوق/بنك)
      lines.push({
        account_id: targetAccount.id,
        debit: refAmount,
        credit: 0,
        notes: `استرداد دفعة رقم [${payment.payment_no}]: ${reason}`
      });
      lines.push({
        account_id: financialCoaAccount.id,
        debit: 0,
        credit: refAmount,
        notes: `صرف استرداد من ${financialCoaAccount.name}`
      });
    } else {
      // استرداد صرف: مدين الحساب المالي ودائن الحساب الهدف
      lines.push({
        account_id: financialCoaAccount.id,
        debit: refAmount,
        credit: 0,
        notes: `استرداد صرف لسند رقم [${payment.payment_no}]: ${reason}`
      });
      lines.push({
        account_id: targetAccount.id,
        debit: 0,
        credit: refAmount,
        notes: `استرداد مصروف/مورد [${payment.payment_no}]`
      });
    }

    const je = await AccountingService.createJournalEntry({
      date: new Date().toISOString().split('T')[0],
      description: `قيد استرداد مالي [${refundNo}] لسند ${payment.payment_no}`,
      reference_type: 'PAYMENT_REFUND',
      reference_id: payment.id,
      status: 'posted'
    }, lines, { user });

    await run(`
      INSERT INTO payment_refunds (
        refund_no, payment_id, amount, reason, refund_type, status, reference, journal_entry_id, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      refundNo, payment.id, refAmount, reason,
      newStatus === 'REFUNDED' ? 'full' : 'partial',
      newStatus, reference, je.id, user?.id || null
    ]);

    await run(`
      UPDATE payments
      SET status = ?,
          refunded_amount = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [newStatus, newRefunded, payment.id]);

    const updatedPayment = await get('SELECT * FROM payments WHERE id = ?', [payment.id]);

    return {
      refund_no: refundNo,
      status: newStatus,
      amount: refAmount,
      journal_entry: je,
      payment: updatedPayment
    };
  },

  /**
   * معالجة إشعارات Webhook مع منع Replay و Duplicate
   */
  async processWebhook({ gateway, payload, signature, headers } = {}) {
    if (!payload) {
      throw new Error('بيانات الـ Webhook مفقودة');
    }

    const data = payload.data || payload;
    const paymentId = data.payment_id || data.metadata?.payment_id || data.order_id;
    const txnId = data.transaction_id || data.id || payload.event_id;
    const fee = data.fee ? Number(data.fee) : undefined;

    if (!paymentId) {
      return { success: false, message: 'معرف المعاملة غير متوفر في الـ Webhook' };
    }

    const payment = await get('SELECT * FROM payments WHERE id = ?', [Number(paymentId)]);
    if (!payment) {
      throw new Error(`المعاملة رقم [${paymentId}] غير موجودة`);
    }

    // إذا كانت المعاملة قد تم اعتمادها مسبقاً، يتم تجاهل الإشعار المكرر بأمان
    if (payment.status === 'PAID') {
      return {
        alreadyProcessed: true,
        action: 'IGNORED',
        message: 'تم ترحيل المعاملة مسبقاً، تجاهل الإشعار المكرر بأمان'
      };
    }

    if (payload.event === 'payment.succeeded' || data.status === 'succeeded' || data.status === 'paid') {
      await this.capturePayment(payment.id, {
        externalTransactionId: txnId,
        feeAmount: fee
      });
      return {
        alreadyProcessed: false,
        action: 'CAPTURED',
        payment_id: payment.id
      };
    } else if (payload.event === 'payment.failed' || data.status === 'failed') {
      await run("UPDATE payments SET status = 'FAILED' WHERE id = ?", [payment.id]);
      return {
        alreadyProcessed: false,
        action: 'FAILED',
        payment_id: payment.id
      };
    }

    return {
      alreadyProcessed: false,
      action: 'UNHANDLED_EVENT'
    };
  }
};

PaymentService.PAYMENT_STATUSES = PaymentService.PAYMENT_STATUSES;
module.exports = PaymentService;
