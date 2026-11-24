'use strict';
// ReversalService (stage 4.3): every storno in the system goes through here.
// Rules: only posted entries are reversed; the reversal mirrors the original lines exactly (PostingService.reverse);
// the original stays posted and is marked with reversal_ref_id; the source document is updated in the same transaction.
const { get, query, run, transaction } = require('../../database/db');
const { checkPeriodOpen } = require('../periodService');
const { logAudit } = require('../auditService');
const PostingService = require('./postingService');

const DOCUMENT_STATUSES = { DRAFT: 'draft', POSTED: 'posted', CLOSED: 'closed', REVERSED: 'reversed' };

const POSTED_ENTRY_STATUSES = ['posted', 'closed'];

function reversalError(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function assertReason(reason, label) {
  if (!reason || String(reason).trim().length < 3) {
    throw reversalError(`يجب كتابة سبب رسمي ومبرر واضح لإجراء القيد العكسي${label ? ' ' + label : ''} (Reversal Reason)`);
  }
  return String(reason).trim();
}

/**
 * البحث عن القيد الأصلي للمستند: بالربط المباشر journal_entry_id أولاً،
 * ثم بنوع المرجع ورقمه (ومع رقم السند إن وُجد لتفادي تشابه أرقام السندات بين الجداول).
 */
async function findSourceEntry(tx, { journalEntryId, referenceTypes = [], referenceId, referenceNo }) {
  if (journalEntryId) {
    const linked = await tx.get('SELECT * FROM journal_entries WHERE id = ?', [Number(journalEntryId)]);
    if (linked) return linked;
  }
  if (!referenceTypes.length || !referenceId) return null;
  const params = [...referenceTypes, Number(referenceId)];
  let sql = `SELECT * FROM journal_entries WHERE reference_type IN (${referenceTypes.map(() => '?').join(',')}) AND reference_id = ?`;
  if (referenceNo) { sql += ' AND reference_no = ?'; params.push(String(referenceNo)); }
  return tx.get(sql + ' ORDER BY id DESC LIMIT 1', params);
}

async function loadEntryForReversal(tx, source, label) {
  const entry = await findSourceEntry(tx, source);
  if (!entry) {
    throw reversalError(`لا يمكن عكس ${label}: لا يوجد له قيد مرحّل في دفتر الأستاذ. لا يُعكس محاسبياً إلا ما رُحّل فعلاً.`);
  }
  if (entry.reversal_ref_id || entry.status === DOCUMENT_STATUSES.REVERSED) {
    throw reversalError(`القيد ${entry.entry_no} معكوس مسبقاً بقيد عكسي آخر`);
  }
  if (!POSTED_ENTRY_STATUSES.includes(entry.status)) {
    throw reversalError(`لا يمكن عكس القيد ${entry.entry_no} لأنه بحالة [${entry.status}] ولم يُرحّل إلى دفتر الأستاذ`);
  }
  const lines = await tx.query('SELECT * FROM journal_entry_lines WHERE entry_id = ? ORDER BY id ASC', [entry.id]);
  if (lines.length < 2) throw reversalError(`القيد ${entry.entry_no} لا يحتوي على سطور صالحة للعكس`);
  return { entry, lines };
}

/** يرحّل قيداً عكسياً مرآةً لسطور القيد الأصلي عبر PostingService ويعلّم الأصل بمرجع العكس. */
function postMirrorReversal(tx, original, { date, description, referenceType, referenceId, userId, userName, reason }) {
  return PostingService.reverse(tx, original, { date, description, referenceType, referenceId, reason, user: { id: userId, username: userName } });
}

function localAmount(doc) {
  return Number(doc.local_amount) > 0 ? Number(doc.local_amount) : Number(doc.amount) || 0;
}

/** Which document produced a journal entry (so the document is reversed, not only its entry). */
async function documentForEntry(h, entry) {
  const id = Number(entry.id);
  const pay = await h.get('SELECT id, type FROM payments WHERE journal_entry_id = ?', [id]);
  if (pay) return { kind: 'payment', id: pay.id, reverse: o => ReversalService.reversePayment(pay.id, o) };
  const exp = await h.get('SELECT id FROM expenses WHERE journal_entry_id = ?', [id]);
  if (exp) return { kind: 'expense', id: exp.id, reverse: o => ReversalService.reverseExpense(exp.id, o) };
  if (['مصروف مرآة عمالة', 'مصروف مرآة مشتريات'].includes(entry.reference_type) && entry.reference_id) {
    return { kind: 'expense', id: entry.reference_id, reverse: o => ReversalService.reverseExpense(entry.reference_id, o) };
  }
  const bill = await h.get('SELECT id, bill_no FROM bills WHERE journal_entry_id = ?', [id]);
  if (bill) return { kind: 'bill', id: bill.id, reverse: o => ReversalService.reverseBill(bill.id, o) };
  if (entry.reference_type === 'ضريبة مستخلص') {
    return { kind: 'bill_tax', id: entry.reference_id, message: `قيد ضريبة المستخلص ${entry.reference_no || ''} يُعكس مع المستخلص نفسه من شاشة المستخلصات` };
  }
  const ptx = await h.get('SELECT id FROM payment_transactions WHERE journal_entry_id = ?', [id]).catch(() => null);
  if (ptx) return { kind: 'payment_transaction', id: ptx.id, reverse: o => ReversalService.reversePaymentTransaction(ptx.id, o) };
  return { kind: 'journal', id };
}

async function context(user, req, reversalDate) {
  const revDate = reversalDate || new Date().toISOString().split('T')[0];
  const period = await checkPeriodOpen(revDate);
  if (!period.isOpen) throw reversalError(period.message);
  const revUser = user || (req ? req.user : null) || { id: null, username: 'المدير المالي' };
  const row = revUser.id ? await get('SELECT id FROM users WHERE id = ?', [Number(revUser.id)]) : null;
  return { revDate, revUserId: row ? row.id : null, revUserName: revUser.username || revUser.full_name || 'مسؤول مالي' };
}

const ReversalService = {
  /**
   * تنفيذ قيد عكسي ذري لسند صرف مالي (Storno Reversal)
   * يعكس قيد السند المرحّل حرفياً، ويعيد أثره على المورد/الأجور/المشتريات وتكلفة المشروع
   */
  async reverseExpense(id, { user, reason, reversal_date, req = null }) {
    const cleanReason = assertReason(reason);
    const exp = await get('SELECT * FROM expenses WHERE id = ?', [id]);
    if (!exp) throw reversalError('سند الصرف غير موجود');
    const currentStatus = (exp.status || 'posted').toLowerCase();
    if (currentStatus === DOCUMENT_STATUSES.REVERSED) throw reversalError('سند الصرف تم عكسه مسبقاً بقيد عكسي آخر');
    if (currentStatus === DOCUMENT_STATUSES.DRAFT) throw reversalError('لا يمكن عمل قيد عكسي لمسودة صرف؛ يمكن إلغاء المسودة أو حذفها مباشرة');
    if (![DOCUMENT_STATUSES.POSTED, DOCUMENT_STATUSES.CLOSED].includes(currentStatus)) {
      throw reversalError(`لا يمكن عكس سند صرف بحالة [${exp.status}] لأنه لم يُرحّل؛ ألغِ الاعتماد بدلاً من العكس`);
    }

    const { revDate, revUserId, revUserName } = await context(user, req, reversal_date);
    const amount = localAmount(exp);
    let reversal = null;

    await transaction(async (tx) => {
      // سندات المرآة (أجور/مشتريات الموقع) تُرحَّل بنوع مرجع خاص وبلا ربط journal_entry_id
      const mirror = exp.journal_entry_id ? null : await tx.get(
        "SELECT id FROM journal_entries WHERE reference_id = ? AND reference_type IN ('مصروف مرآة عمالة', 'مصروف مرآة مشتريات') ORDER BY id ASC LIMIT 1",
        [exp.id]
      );
      const source = await loadEntryForReversal(tx, {
        journalEntryId: exp.journal_entry_id || mirror?.id, referenceTypes: ['سند صرف'], referenceId: exp.id, referenceNo: exp.receipt_no
      }, `سند الصرف ${exp.receipt_no}`);

      // تحديد البند الفرعي المسدَّد (ذمة مورد أو أجور مستحقة) من الطرف المدين للقيد الأصلي
      const debitAccountId = Number(source.lines.find(line => Number(line.debit) > 0)?.account_id);
      // same resolvers the accruals and the settling voucher use (role first, legacy chart fallback)
      const ProjectCost = require('../projectCostService');
      const apId = await ProjectCost.resolvePayableAccounts(tx).then(a => a.apAccId).catch(() => null);
      const wpId = await ProjectCost.resolveWageAccounts(tx).then(a => a.wagesPayableAccId).catch(() => null);
      const apAcc = apId ? { id: apId } : null;
      const wpAcc = wpId ? { id: wpId } : null;
      // the two payables may share one account on a small chart, so the linked record decides, not the first match
      let settleInfo = null;
      if (apAcc && debitAccountId === Number(apAcc.id)) {
        const pur = await tx.get('SELECT * FROM project_purchases WHERE linked_expense_id = ?', [exp.id]);
        if (pur && pur.supplier_id) settleInfo = { kind: 'purchase', purchase: pur };
      }
      if (!settleInfo && wpAcc && debitAccountId === Number(wpAcc.id)) {
        const lab = await tx.get('SELECT * FROM project_labor_expenses WHERE linked_expense_id = ?', [exp.id]);
        if (lab) settleInfo = { kind: 'labor', labor: lab };
      }

      reversal = await postMirrorReversal(tx, source, {
        date: revDate, referenceType: 'قيد عكسي سند صرف', referenceId: exp.id,
        description: `قيد عكسي لسند الصرف رقم ${exp.receipt_no} - سبب العكس: ${cleanReason}`,
        userId: revUserId, userName: revUserName, reason: cleanReason
      });

      if (settleInfo && settleInfo.kind === 'labor') {
        const restoredPaid = Math.max(0, (Number(settleInfo.labor.paid_amount) || 0) - amount);
        const restoredRemaining = Number(settleInfo.labor.total_amount) - restoredPaid;
        const restoredStatus = restoredRemaining <= 0.005 ? 'مدفوع' : (restoredPaid > 0.005 ? 'جزئي' : 'غير مدفوع');
        await tx.run('UPDATE project_labor_expenses SET paid_amount = ?, payment_status = ? WHERE id = ?', [restoredPaid, restoredStatus, settleInfo.labor.id]);
      } else if (settleInfo && settleInfo.kind === 'purchase') {
        await tx.run('UPDATE suppliers SET balance = balance + ? WHERE id = ?', [amount, settleInfo.purchase.supplier_id]);
        const restoredPaid = Math.max(0, (Number(settleInfo.purchase.paid_amount) || 0) - amount);
        const restoredRemaining = Number(settleInfo.purchase.total_amount) - restoredPaid;
        const restoredStatus = restoredRemaining <= 0.005 ? 'مدفوع' : (restoredPaid > 0.005 ? 'جزئي' : 'غير مدفوع');
        await tx.run('UPDATE project_purchases SET paid_amount = ?, payment_status = ? WHERE id = ?', [restoredPaid, restoredStatus, settleInfo.purchase.id]);
      } else if (exp.supplier_id) {
        await tx.run('UPDATE suppliers SET balance = balance - ? WHERE id = ?', [amount, exp.supplier_id]);
      }

      await tx.run(`
        UPDATE expenses
        SET status = 'reversed', reversed_by = ?, reversed_by_name = ?, reversed_at = CURRENT_TIMESTAMP,
            reversal_reason = ?, reversal_ref_id = ?
        WHERE id = ?
      `, [revUserId, revUserName, cleanReason, reversal.id, exp.id]);

      if (exp.project_id) {
        const ProjectCostService = require('../projectCostService');
        await ProjectCostService.recalculateProjectCost(exp.project_id, tx);
      }
    });

    if (req || user) {
      await logAudit(req, {
        action: 'REVERSE',
        entity_type: 'expense',
        entity_id: exp.receipt_no || String(exp.id),
        details: { receipt_no: exp.receipt_no, amount, reversing_entry_no: reversal.entry_no, reversing_je_id: reversal.id },
        old_values: { status: exp.status || 'posted', amount: exp.amount, date: exp.date, account_id: exp.account_id },
        new_values: { status: 'reversed', reversal_ref_id: reversal.id, reversed_by: revUserName, reversal_date: revDate },
        reason: cleanReason
      });
    }

    return {
      success: true,
      message: `تم عمل القيد العكسي بنجاح برقم (${reversal.entry_no}) وتأكيد عكس الأثر المالي لسند الصرف (${exp.receipt_no})`,
      reversing_entry_no: reversal.entry_no,
      reversing_je_id: reversal.id,
      receipt_no: exp.receipt_no,
      amount
    };
  },

  /**
   * تنفيذ قيد عكسي ذري لسند قبض أو صرف (Payments Storno Reversal)
   */
  async reversePayment(id, { user, reason, reversal_date, req = null }) {
    const cleanReason = assertReason(reason);
    const pay = await get('SELECT * FROM payments WHERE id = ?', [id]);
    if (!pay) throw reversalError('السند المالي غير موجود');
    const currentStatus = (pay.status || 'posted').toLowerCase();
    if (currentStatus === DOCUMENT_STATUSES.REVERSED) throw reversalError('السند تم عكسه مسبقاً بقيد عكسي آخر');
    if (currentStatus === DOCUMENT_STATUSES.DRAFT) throw reversalError('لا يمكن عمل قيد عكسي لمسودة؛ يمكن إلغاء المسودة مباشرة');
    if (![DOCUMENT_STATUSES.POSTED, DOCUMENT_STATUSES.CLOSED, 'paid'].includes(currentStatus)) {
      throw reversalError(`لا يمكن عكس سند بحالة [${pay.status}] لأنه لم يُرحّل؛ ألغِ الاعتماد بدلاً من العكس`);
    }

    const { revDate, revUserId, revUserName } = await context(user, req, reversal_date);
    const amount = localAmount(pay);
    const isReceipt = (pay.type === 'قبض');
    let reversal = null;

    await transaction(async (tx) => {
      const source = await loadEntryForReversal(tx, {
        journalEntryId: pay.journal_entry_id, referenceTypes: [isReceipt ? 'سند قبض' : 'سند صرف'], referenceId: pay.id, referenceNo: pay.receipt_no
      }, `سند ال${pay.type} ${pay.receipt_no}`);

      reversal = await postMirrorReversal(tx, source, {
        date: revDate, referenceType: `قيد عكسي سند ${pay.type}`, referenceId: pay.id,
        description: `قيد عكسي لسند ${pay.type} رقم ${pay.receipt_no} - سبب العكس: ${cleanReason}`,
        userId: revUserId, userName: revUserName, reason: cleanReason
      });

      if (isReceipt && pay.client_id) {
        await tx.run('UPDATE clients SET total_paid = GREATEST(0, total_paid - ?), current_balance = current_balance + ? WHERE id = ?', [amount, amount, pay.client_id]);
      } else if (!isReceipt && pay.supplier_id) {
        await tx.run('UPDATE suppliers SET balance = balance + ? WHERE id = ?', [amount, pay.supplier_id]);
      }

      await tx.run(`
        UPDATE payments
        SET status = 'reversed', reversed_by = ?, reversed_by_name = ?, reversed_at = CURRENT_TIMESTAMP,
            reversal_reason = ?, reversal_ref_id = ?
        WHERE id = ?
      `, [revUserId, revUserName, cleanReason, reversal.id, pay.id]);

      if (isReceipt) {
        const clientChainService = require('../clientChainService');
        if (pay.bill_id) await clientChainService.reversePaymentFromBill(pay.bill_id, amount, tx);
        if (pay.client_id) await clientChainService.syncClientBalances(pay.client_id, tx);
      }
    });

    if (req || user) {
      await logAudit(req, {
        action: 'REVERSE',
        entity_type: isReceipt ? 'receipt' : 'payment_voucher',
        entity_id: pay.receipt_no || String(pay.id),
        details: { receipt_no: pay.receipt_no, type: pay.type, amount, reversing_entry_no: reversal.entry_no },
        old_values: { status: pay.status || 'posted', amount: pay.amount, date: pay.date },
        new_values: { status: 'reversed', reversal_ref_id: reversal.id, reversed_by: revUserName },
        reason: cleanReason
      });
    }

    return {
      success: true,
      message: `تم عمل القيد العكسي بنجاح برقم (${reversal.entry_no}) وعكس الأثر المالي لسند ${pay.type} (${pay.receipt_no})`,
      reversing_entry_no: reversal.entry_no,
      reversing_je_id: reversal.id,
      receipt_no: pay.receipt_no,
      amount
    };
  },

  /**
   * تنفيذ قيد عكسي ذري لقيد يومية عام (Manual Journal Entry Reversal)
   */
  async reverseJournalEntry(id, { user, reason, reversal_date, req = null }) {
    const cleanReason = assertReason(reason);
    const entry = await get('SELECT * FROM journal_entries WHERE id = ?', [id]);
    if (!entry) throw reversalError('القيد اليومي غير موجود');

    // قيد مولَّد من مستند: يُعكس المستند نفسه حتى لا يبقى المستند "مرحّلاً" وقيده معكوس
    const doc = await documentForEntry({ get }, entry);
    if (doc && doc.kind !== 'journal') {
      if (!doc.reverse) throw reversalError(doc.message);
      const result = await doc.reverse({ user, reason: cleanReason, reversal_date, req });
      return { ...result, original_entry_no: entry.entry_no, reversed_document: { kind: doc.kind, id: doc.id } };
    }

    const { revDate, revUserId, revUserName } = await context(user, req, reversal_date);
    let reversal = null;

    await transaction(async (tx) => {
      const source = await loadEntryForReversal(tx, { journalEntryId: entry.id }, `القيد ${entry.entry_no}`);
      reversal = await postMirrorReversal(tx, source, {
        date: revDate, referenceType: 'قيد عكسي', referenceId: entry.id,
        description: `قيد عكسي للقيد رقم ${entry.entry_no} - سبب العكس: ${cleanReason}`,
        userId: revUserId, userName: revUserName, reason: cleanReason
      });
    });

    if (req || user) {
      await logAudit(req, {
        action: 'REVERSE',
        entity_type: 'journal_entry',
        entity_id: entry.entry_no || String(entry.id),
        details: { entry_no: entry.entry_no, reversing_entry_no: reversal.entry_no },
        old_values: { status: entry.status || 'posted', total_debit: entry.total_debit, total_credit: entry.total_credit },
        new_values: { reversal_ref_id: reversal.id, reversed_by: revUserName },
        reason: cleanReason
      });
    }

    return {
      success: true,
      message: `تم عمل القيد العكسي بنجاح برقم (${reversal.entry_no}) وعكس القيد (${entry.entry_no})`,
      reversing_entry_no: reversal.entry_no,
      reversing_je_id: reversal.id,
      original_entry_no: entry.entry_no
    };
  },

  /**
   * تنفيذ قيد عكسي ذري لمستخلص أعمال مرحّل (Interim Payment Certificate - IPC Reversal)
   * يعكس قيد المستخلص حرفياً ثم يعيد احتساب رصيد العميل بعد تغيير حالة المستخلص
   */
  async reverseBill(id, { user, reason, reversal_date, req = null }) {
    const cleanReason = assertReason(reason, 'للمستخلص');
    const bill = await get('SELECT * FROM bills WHERE id = ?', [id]);
    if (!bill) throw reversalError('المستخلص غير موجود');
    const currentStatus = (bill.status || '').toLowerCase();
    if (currentStatus === DOCUMENT_STATUSES.REVERSED) throw reversalError('المستخلص تم عكسه مسبقاً بقيد عكسي آخر');
    if (currentStatus === DOCUMENT_STATUSES.DRAFT) throw reversalError('لا يمكن عمل قيد عكسي لمسودة مستخلص؛ يمكن إلغاء المسودة أو حذفها مباشرة');
    if (![DOCUMENT_STATUSES.POSTED, DOCUMENT_STATUSES.CLOSED, 'معتمد'].includes(currentStatus)) {
      throw reversalError(`لا يمكن عكس مستخلص بحالة [${bill.status}] لأنه لم يُرحّل إلى دفتر الأستاذ`);
    }
    if (Number(bill.paid_amount) > 0.005) {
      throw reversalError(`لا يمكن عكس المستخلص ${bill.bill_no} وعليه تحصيلات بمبلغ ${Number(bill.paid_amount)}؛ يجب عكس سندات القبض المرتبطة أولاً`);
    }

    const { revDate, revUserId, revUserName } = await context(user, req, reversal_date);
    const grossAmount = Number(bill.gross_amount || bill.amount || 0);
    let reversal = null;

    await transaction(async (tx) => {
      const source = await loadEntryForReversal(tx, {
        journalEntryId: bill.journal_entry_id, referenceTypes: ['مستخلص أعمال معتمد', 'مستخلص ضريبي'], referenceId: bill.id
      }, `المستخلص ${bill.bill_no}`);

      reversal = await postMirrorReversal(tx, source, {
        date: revDate, referenceType: 'قيد عكسي مستخلص أعمال', referenceId: bill.id,
        description: `قيد عكسي للمستخلص رقم ${bill.bill_no} - سبب العكس: ${cleanReason}`,
        userId: revUserId, userName: revUserName, reason: cleanReason
      });

      // قيد ضريبة الخصم المستقل (إن وجد) يُعكس مع المستخلص
      const taxEntry = await tx.get("SELECT * FROM journal_entries WHERE reference_type = 'ضريبة مستخلص' AND reference_id = ? AND reversal_ref_id IS NULL AND status IN ('posted','closed') ORDER BY id DESC LIMIT 1", [bill.id]);
      if (taxEntry) {
        const taxLines = await tx.query('SELECT * FROM journal_entry_lines WHERE entry_id = ? ORDER BY id ASC', [taxEntry.id]);
        await postMirrorReversal(tx, { entry: taxEntry, lines: taxLines }, {
          date: revDate, referenceType: 'قيد عكسي مستخلص أعمال', referenceId: bill.id,
          description: `قيد عكسي لضريبة المستخلص رقم ${bill.bill_no} - سبب العكس: ${cleanReason}`,
          userId: revUserId, userName: revUserName, reason: cleanReason
        });
      }

      await tx.run(`
        UPDATE bills
        SET status = 'reversed', reversed_by = ?, reversed_by_name = ?, reversed_at = CURRENT_TIMESTAMP,
            reversal_reason = ?, reversal_ref_id = ?
        WHERE id = ?
      `, [revUserId, revUserName, cleanReason, reversal.id, bill.id]);

      // بعد تغيير الحالة حتى يُستبعد المستخلص المعكوس من رصيد العميل
      if (bill.client_id) await require('../clientChainService').syncClientBalances(bill.client_id, tx);
    });

    if (req || user) {
      await logAudit(req, {
        action: 'REVERSE',
        entity_type: 'bill',
        entity_id: bill.bill_no || String(bill.id),
        details: { bill_no: bill.bill_no, gross_amount: grossAmount, net_amount: bill.net_amount, reversing_entry_no: reversal.entry_no },
        old_values: { status: bill.status, amount: bill.amount, net_amount: bill.net_amount },
        new_values: { status: 'reversed', reversal_ref_id: reversal.id, reversed_by: revUserName },
        reason: cleanReason
      });
    }

    return {
      success: true,
      message: `تم عمل القيد العكسي بنجاح برقم (${reversal.entry_no}) وعكس الأثر المالي للمستخلص (${bill.bill_no})`,
      reversing_entry_no: reversal.entry_no,
      reversing_je_id: reversal.id,
      bill_no: bill.bill_no,
      amount: grossAmount
    };
  },

  /**
   * تنفيذ قيد عكسي لفاتورة مشتريات (Purchase Invoice Reversal)
   * يتطلب وجود قيد مرحّل للفاتورة؛ مسار ترحيل المشتريات الحالي لا يُنشئ قيداً، لذلك يُرفض العكس
   * المحاسبي حتى يُربط ترحيل المشتريات بدفتر الأستاذ (المرحلة 4 من الخطة).
   */
  /**
   * عكس معاملة دفع من المعالج الخماسي (عكس أو ارتجاع شيك): مرآة قيدها الأصلي مرة واحدة فقط،
   * بتاريخ في فترة مفتوحة وبسبب مكتوب، مع إعادة أثرها على المستخلص المرتبط.
   */
  async reversePaymentTransaction(id, { user, reason, reversal_date, req = null, bounced = false }) {
    const cleanReason = assertReason(reason, bounced ? 'لارتجاع المعاملة' : 'للمعاملة');
    const item = await get('SELECT * FROM payment_transactions WHERE id = ?', [Number(id)]);
    if (!item) throw reversalError('المعاملة غير موجودة');
    if (['reversed', 'bounced'].includes(item.status)) throw reversalError('المعاملة معكوسة أو مرتجعة مسبقاً');
    const { revDate, revUserId, revUserName } = await context(user, req, reversal_date);
    let reversal = null;
    await transaction(async (tx) => {
      if (item.journal_entry_id) {
        const source = await loadEntryForReversal(tx, { journalEntryId: item.journal_entry_id }, `المعاملة ${item.transaction_no}`);
        reversal = await postMirrorReversal(tx, source, {
          date: revDate, referenceType: bounced ? 'إلغاء معاملة دفع' : 'عكس معاملة خماسية', referenceId: item.id,
          description: `${bounced ? 'ارتجاع شيك/رفض' : 'قيد عكسي'} للمعاملة [${item.transaction_no}] - السبب: ${cleanReason}`,
          userId: revUserId, userName: revUserName, reason: cleanReason
        });
      }
      if (item.context_ref_id && item.direction === 'IN') {
        const bill = await tx.get('SELECT id, client_id FROM bills WHERE id = ?', [item.context_ref_id]);
        if (bill) {
          const chain = require('../clientChainService');
          await chain.reversePaymentFromBill(bill.id, Number(item.local_amount) || Number(item.amount) || 0, tx);
          if (bill.client_id) await chain.syncClientBalances(bill.client_id, tx);
        }
      }
      const status = bounced ? 'bounced' : 'reversed';
      await tx.run(`UPDATE payment_transactions SET status = ?, clearing_status = CASE WHEN ? = 'bounced' THEN 'bounced' ELSE clearing_status END,
        notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [status, status, `[${bounced ? 'مرفوض/مرجع' : 'معكوس'}]: ${cleanReason} | ${item.notes || ''}`, item.id]);
    });
    if (req || user) {
      await logAudit(req, { action: bounced ? 'BOUNCE' : 'REVERSE', entity_type: 'payment_transaction', entity_id: item.transaction_no || String(item.id),
        details: { reversing_entry_no: reversal?.entry_no || null }, old_values: { status: item.status }, new_values: { status: bounced ? 'bounced' : 'reversed' }, reason: cleanReason });
    }
    return { success: true, message: reversal ? `تم عكس المعاملة بالقيد (${reversal.entry_no})` : 'تم تسجيل حالة المعاملة (لا يوجد لها قيد مرحّل)',
      reversing_entry_no: reversal?.entry_no || null, reversing_je_id: reversal?.id || null };
  },

  async reversePurchase(id, { user, reason, reversal_date, req = null }) {
    const cleanReason = assertReason(reason, 'للمشتريات');
    const pu = await get('SELECT * FROM purchases WHERE id = ?', [id]);
    if (!pu) throw reversalError('فاتورة المشتريات غير موجودة');
    const currentStatus = (pu.status || 'posted').toLowerCase();
    if (currentStatus === DOCUMENT_STATUSES.REVERSED) throw reversalError('فاتورة المشتريات تم عكسها مسبقاً');
    if (currentStatus === DOCUMENT_STATUSES.DRAFT) throw reversalError('لا يمكن عمل قيد عكسي لمسودة شراء؛ يمكن حذفها مباشرة');
    if (![DOCUMENT_STATUSES.POSTED, DOCUMENT_STATUSES.CLOSED].includes(currentStatus)) {
      throw reversalError(`لا يمكن عكس فاتورة شراء بحالة [${pu.status}] لأنها لم تُرحّل`);
    }

    const { revDate, revUserId, revUserName } = await context(user, req, reversal_date);
    const totalAmount = Number(pu.total_amount || 0);
    const paidAmount = Number(pu.paid_amount || 0);
    const remaining = totalAmount - paidAmount;
    let reversal = null;

    await transaction(async (tx) => {
      const source = await loadEntryForReversal(tx, {
        journalEntryId: pu.journal_entry_id, referenceTypes: ['فاتورة شراء', 'مشتريات'], referenceId: pu.id
      }, `فاتورة المشتريات ${pu.invoice_no}`);

      reversal = await postMirrorReversal(tx, source, {
        date: revDate, referenceType: 'قيد عكسي فاتورة شراء', referenceId: pu.id,
        description: `قيد عكسي لفاتورة المشتريات رقم ${pu.invoice_no} - ${cleanReason}`,
        userId: revUserId, userName: revUserName, reason: cleanReason
      });

      if (pu.supplier_id && remaining > 0) {
        await tx.run('UPDATE suppliers SET balance = balance - ? WHERE id = ?', [remaining, pu.supplier_id]);
      }

      await tx.run(`
        UPDATE purchases
        SET status = 'reversed', reversed_by = ?, reversed_by_name = ?, reversed_at = CURRENT_TIMESTAMP,
            reversal_reason = ?, reversal_ref_id = ?
        WHERE id = ?
      `, [revUserId, revUserName, cleanReason, reversal.id, pu.id]);
    });

    if (req || user) {
      await logAudit(req, {
        action: 'REVERSE',
        entity_type: 'purchase',
        entity_id: pu.invoice_no || String(pu.id),
        details: { invoice_no: pu.invoice_no, total_amount: totalAmount, reversing_entry_no: reversal.entry_no },
        old_values: { status: pu.status, total_amount: pu.total_amount },
        new_values: { status: 'reversed', reversal_ref_id: reversal.id, reversed_by: revUserName },
        reason: cleanReason
      });
    }

    return {
      success: true,
      message: `تم عمل القيد العكسي بنجاح برقم (${reversal.entry_no}) وعكس فاتورة المشتريات (${pu.invoice_no})`,
      reversing_entry_no: reversal.entry_no,
      reversing_je_id: reversal.id,
      invoice_no: pu.invoice_no,
      amount: totalAmount
    };
  }
};

module.exports = Object.assign(ReversalService, { loadEntryForReversal, findSourceEntry, postMirrorReversal, assertReason, reversalError, context });
