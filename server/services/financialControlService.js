/**
 * خدمة الرقابة المالية الصارمة وإدارة دورة المستند المالي (Financial Control & Document Lifecycle Service)
 * تطبق مبادئ المحاسبة المؤسسية ومعايير التدقيق الدولية (GAAP/IFRS):
 * 1. دورة المستند المالي: مسودة -> مراجعة -> اعتماد -> ترحيل -> إقفال -> عكس أو تسوية
 * 2. مبدأ العيون الأربع (Maker-Checker / Four-Eyes Principle): منع منشئ السند من اعتماده بنفسه
 * 3. حماية السجلات المعتمدة والمرحلة من الحذف والتعديل المباشر (Immutability)
 * 4. القيود العكسية المتزنة والتسوية (Storno Reversals & Adjustments)
 * 5. توثيق سجل التدقيق الكامل مع التغيرات السابقة والجديدة والسبب (Audit Delta)
 */

const { get, query, run, transaction } = require('../database/db');
const { checkPeriodOpen } = require('./periodService');
const { logAudit } = require('./auditService');
const ProjectCostService = require('./projectCostService');
const CashBoxService = require('./cashBoxService');

const DOCUMENT_STATUSES = {
  DRAFT: 'draft',               // مسودة (قابلة للتعديل والحذف دون أثر مالي)
  UNDER_REVIEW: 'under_review', // قيد المراجعة والتدقيق
  APPROVED: 'approved',         // معتمد (محمي من الحذف والتعديل المباشر)
  POSTED: 'posted',             // مرحل لدفتر الأستاذ والصندوق (أثر مالي كامل ومحمي)
  CLOSED: 'closed',             // مقفل (ضمن فترة مالية مغلقة)
  REVERSED: 'reversed',         // معكوس بقيد عكسي رسمي
  CANCELLED: 'cancelled'        // مسودة ملغاة
};

const FinancialControlService = {
  DOCUMENT_STATUSES,

  /**
   * التأكد من وجود المستخدم في قاعدة البيانات قبل الربط لمنع أخطاء Foreign Key Constraints
   */
  async resolveValidUserId(id) {
    if (!id) return null;
    const numId = Number(id);
    if (!numId) return null;
    try {
      const u = await get('SELECT id FROM users WHERE id = ?', [numId]);
      return u ? u.id : null;
    } catch {
      return null;
    }
  },

  /**
   * تطبيق مبدأ العيون الأربع (Maker-Checker / Four-Eyes Principle)
   * يمنع منشئ السند من اعتماده أو ترحيله بنفسه في العمليات الحساسة
   */
  assertMakerChecker(doc, currentUser, operationLabel = 'اعتماد') {
    if (!doc || !currentUser) return;

    const creatorId = doc.created_by ? Number(doc.created_by) : null;
    const currentUserId = currentUser.id ? Number(currentUser.id) : null;
    const creatorName = (doc.created_by_name || '').trim().toLowerCase();
    const currentUserName = (currentUser.username || currentUser.full_name || '').trim().toLowerCase();

    const isSameUser = (creatorId && currentUserId && creatorId === currentUserId) ||
                       (creatorName && currentUserName && creatorName === currentUserName);

    if (isSameUser) {
      throw new Error(
        `⛔ انتهاك لمبدأ الرقابة الثنائية (Maker-Checker / Four-Eyes Principle): لا يجوز لمنشئ السند [${doc.created_by_name || currentUser.username}] ${operationLabel}ه بنفسه في العمليات المالية الحساسة. يجب مراجعة واعتماد السند بواسطة مدقق أو مسؤول مالي آخر لمنع تعارض المصالح.`
      );
    }
  },

  /**
   * منع التعديل المباشر على المستندات المعتمدة أو المرحلة أو المقفلة أو المعكوسة
   */
  assertMutable(doc, actionLabel = 'تعديل') {
    if (!doc) return;
    const status = (doc.status || 'posted').toLowerCase();
    const immutableStatuses = [DOCUMENT_STATUSES.APPROVED, DOCUMENT_STATUSES.POSTED, DOCUMENT_STATUSES.CLOSED, DOCUMENT_STATUSES.REVERSED];

    if (immutableStatuses.includes(status)) {
      throw new Error(
        `⛔ لا يمكن ${actionLabel} مستند مالي في حالة [${status}] مباشرة! النظام يمنع التعديل المباشر على المبالغ أو الحسابات لحماية التسلسل والنزاهة المحاسبية (GAAP/IFRS). التصحيح المحاسبي يتم حصراً عبر قيد عكسي (Storno) أو قيد تسوية إضافي.`
      );
    }
  },

  /**
   * منع الحذف النهائي للمستندات غير المسودة
   */
  assertDeletable(doc) {
    if (!doc) return;
    const status = (doc.status || 'posted').toLowerCase();

    if (status !== DOCUMENT_STATUSES.DRAFT) {
      throw new Error(
        `⛔ لا يمكن حذف مستند مالي نهائياً في حالة [${status}]! الحذف المباشر للسجلات المالية المعتمدة أو المرحلة ممنوع منعاً باتاً لضمان حفظ الأثر المالي وسجل التدقيق. يمكنك إلغاء المسودات فقط، أو إجراء قيد عكسي رسمي للمستند المعتمد/المرحل.`
      );
    }
  },

  /**
   * التحقق من أن تاريخ المعاملة يقع داخل فترة محاسبية مفتوحة
   */
  async assertPeriodOpen(date) {
    const check = await checkPeriodOpen(date);
    if (!check.isOpen) {
      throw new Error(check.message);
    }
    return true;
  },

  /**
   * تنفيذ قيد عكسي ذري لسند صرف مالي (Storno Reversal)
   * يعكس الأثر المالي في الصندوق/المشروع/المورد ويولد قيداً يومياً متزناً ويوثق التغيير في سجل التدقيق
   */
  async reverseExpense(id, { user, reason, reversal_date, req = null }) {
    if (!reason || String(reason).trim().length < 3) {
      throw new Error('يجب كتابة سبب رسمي ومبرر واضح لإجراء القيد العكسي (Reversal Reason)');
    }

    const exp = await get('SELECT * FROM expenses WHERE id = ?', [id]);
    if (!exp) {
      throw new Error('سند الصرف غير موجود');
    }

    const currentStatus = (exp.status || 'posted').toLowerCase();
    if (currentStatus === DOCUMENT_STATUSES.REVERSED) {
      throw new Error('سند الصرف تم عكسه مسبقاً بقيد عكسي آخر');
    }
    if (currentStatus === DOCUMENT_STATUSES.DRAFT) {
      throw new Error('لا يمكن عمل قيد عكسي لمسودة صرف؛ يمكن إلغاء المسودة أو حذفها مباشرة');
    }

    const revDate = reversal_date || new Date().toISOString().split('T')[0];
    await this.assertPeriodOpen(revDate);
    await ProjectCostService.ensureSchema(); // تجهيز مخطط توحيد التكلفة قبل المعاملة

    const revUser = user || (req ? req.user : null) || { id: null, username: 'المدير المالي' };
    const revUserId = await this.resolveValidUserId(revUser.id);
    const revUserName = revUser.username || revUser.full_name || 'مسؤول مالي';
    const amount = Number(exp.amount);
    const cleanReason = String(reason).trim();

    let reversingJeId = null;
    let reversingEntryNo = null;

    // SUGGESTION-7: كشف سند التسوية من دليل القيد الأصلي (مدين 21) — لا استنتاج
    let settleInfo = null;
    const origJe = await get(
      `SELECT id FROM journal_entries WHERE reference_type = 'سند صرف' AND reference_id = ? ORDER BY id DESC LIMIT 1`,
      [exp.id]
    );
    if (origJe) {
      const apAcc = await get("SELECT id FROM accounts WHERE code = '21' LIMIT 1");
      if (apAcc) {
        const drAp = await get(
          'SELECT id FROM journal_entry_lines WHERE entry_id = ? AND account_id = ? AND debit > 0 LIMIT 1',
          [origJe.id, apAcc.id]
        );
        if (drAp) {
          const pur = await get('SELECT * FROM project_purchases WHERE linked_expense_id = ?', [exp.id]);
          if (!pur) throw new Error('لا يمكن العكس: الفاتورة المرتبطة بسند التسوية غير موجودة');
          if (!pur.supplier_id) throw new Error('لا يمكن العكس: فاتورة التسوية بلا مورد مسجل');
          settleInfo = { purchase: pur, apAccId: apAcc.id };
        }
      }
    }

    await transaction(async (tx) => {
      // 1. تعويض نقدي في صندوق المشروع (SUGGESTION-7: واعٍ بالصناديق بدل الإدخال الخام العام)
      const cashNotes = `قيد عكسي لسند الصرف ${exp.receipt_no}: ${cleanReason}`;
      await CashBoxService.appendMovement(tx, {
        projectId: exp.project_id ?? null, cashIn: amount,
        currency: exp.currency || 'ر.ي', date: revDate, notes: cashNotes
      });

      // 2. (توحيد التكلفة: تُعاد إعادة الاحتساب من المصادر في نهاية المعاملة بعد تثبيت حالة reversed)

      // 3. المورد: استعادة الذمة والمسدد لسند التسوية، تخفيض للسلوك الأصلي
      if (settleInfo) {
        await tx.run('UPDATE suppliers SET balance = balance + ? WHERE id = ?', [amount, settleInfo.purchase.supplier_id]);
        const restoredPaid = Math.max(0, (Number(settleInfo.purchase.paid_amount) || 0) - amount);
        const restoredRemaining = Number(settleInfo.purchase.total_amount) - restoredPaid;
        const restoredStatus = restoredRemaining <= 0.005 ? 'مدفوع' : (restoredPaid > 0.005 ? 'جزئي' : 'غير مدفوع');
        await tx.run(
          'UPDATE project_purchases SET paid_amount = ?, payment_status = ? WHERE id = ?',
          [restoredPaid, restoredStatus, settleInfo.purchase.id]
        );
      } else if (exp.supplier_id) {
        await tx.run(`
          UPDATE suppliers SET balance = GREATEST(0, balance - ?) WHERE id = ?
        `, [amount, exp.supplier_id]);
      }

      // 4. إنشاء قيد يومي عكسي متزن بالكامل (Storno Journal Entry)
      const countRes = await tx.get('SELECT COUNT(*) as cnt FROM journal_entries');
      let seq = ((countRes ? countRes.cnt : 0) || 0) + 1;
      reversingEntryNo = `REV-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`;
      while (await tx.get('SELECT id FROM journal_entries WHERE entry_no = ?', [reversingEntryNo])) {
        seq++;
        reversingEntryNo = `REV-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`;
      }

      const jeRes = await tx.run(`
        INSERT INTO journal_entries (
          entry_no, date, description, reference_type, reference_id, 
          total_debit, total_credit, status, created_by, created_by_name, posted_by, posted_by_name, posted_at
        )
        VALUES (?, ?, ?, 'قيد عكسي سند صرف', ?, ?, ?, 'posted', ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        reversingEntryNo, revDate,
        `قيد عكسي لسند الصرف رقم ${exp.receipt_no} - سبب العكس: ${cleanReason}`,
        exp.id, amount, amount,
        revUserId, revUserName, revUserId, revUserName
      ]);

      reversingJeId = jeRes.lastInsertRowid || jeRes.insertId;

      // أسطر القيد العكسي: يتم عكس الطرفين تماماً
      // المدين: الصندوق والبنك (حساب 3)
      // الدائن: حساب المصروف الأصلي (accId أو 10) — أو الموردون (21) لسند التسوية
      const expenseAccId = settleInfo ? settleInfo.apAccId : (exp.account_id || 10);
      const creditNote = settleInfo
        ? `إلغاء تسوية الذمم وإعادة الالتزام للمورد - فاتورة #${settleInfo.purchase.id} - ${cleanReason}`
        : `إلغاء قيد المصروف الأصلي بموجب قيد عكسي - ${cleanReason}`;
      const finalCcId = exp.cost_center_id || 1;

      await tx.run(`
        INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes)
        VALUES (?, 3, ?, ?, ?, 0, ?)
      `, [reversingJeId, finalCcId, exp.project_id, amount, `إعادة المبلغ للصندوق/البنك بموجب قيد عكسي - ${cleanReason}`]);

      await tx.run(`
        INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes)
        VALUES (?, ?, ?, ?, 0, ?, ?)
      `, [reversingJeId, expenseAccId, finalCcId, exp.project_id, amount, creditNote]);

      // 5. تحديث حالة سند الصرف الأصلي إلى "معكوس" مع حفظ بيانات العكس
      await tx.run(`
        UPDATE expenses 
        SET status = 'reversed', 
            reversed_by = ?, 
            reversed_by_name = ?, 
            reversed_at = CURRENT_TIMESTAMP, 
            reversal_reason = ?, 
            reversal_ref_id = ?
        WHERE id = ?
      `, [revUserId, revUserName, cleanReason, reversingJeId, exp.id]);

      // 6. توحيد التكلفة: إعادة الاحتساب من المصادر بعد تثبيت حالة reversed
      if (exp.project_id) {
        await ProjectCostService.recalculateProjectCost(exp.project_id, tx);
      }
    });

    // 6. تسجيل العملية بدقة في سجل التدقيق الرقابي مع بيانات القيمة السابقة والجديدة والسبب
    if (req || user) {
      await logAudit(req, {
        action: 'REVERSE',
        entity_type: 'expense',
        entity_id: exp.receipt_no || String(exp.id),
        details: { receipt_no: exp.receipt_no, amount, reversing_entry_no: reversingEntryNo, reversing_je_id: reversingJeId },
        old_values: { status: exp.status || 'posted', amount: exp.amount, date: exp.date, account_id: exp.account_id },
        new_values: { status: 'reversed', reversal_ref_id: reversingJeId, reversed_by: revUserName, reversal_date: revDate },
        reason: cleanReason
      });
    }

    return {
      success: true,
      message: `تم عمل القيد العكسي بنجاح برقم (${reversingEntryNo}) وتأكيد عكس الأثر المالي لسند الصرف (${exp.receipt_no})`,
      reversing_entry_no: reversingEntryNo,
      reversing_je_id: reversingJeId,
      receipt_no: exp.receipt_no,
      amount
    };
  },

  /**
   * تنفيذ قيد عكسي ذري لسند قبض أو صرف (Payments Storno Reversal)
   */
  async reversePayment(id, { user, reason, reversal_date, req = null }) {
    if (!reason || String(reason).trim().length < 3) {
      throw new Error('يجب كتابة سبب رسمي ومبرر واضح لإجراء القيد العكسي (Reversal Reason)');
    }

    const pay = await get('SELECT * FROM payments WHERE id = ?', [id]);
    if (!pay) {
      throw new Error('السند المالي غير موجود');
    }

    const currentStatus = (pay.status || 'posted').toLowerCase();
    if (currentStatus === DOCUMENT_STATUSES.REVERSED) {
      throw new Error('السند تم عكسه مسبقاً بقيد عكسي آخر');
    }
    if (currentStatus === DOCUMENT_STATUSES.DRAFT) {
      throw new Error('لا يمكن عمل قيد عكسي لمسودة؛ يمكن إلغاء المسودة مباشرة');
    }

    const revDate = reversal_date || new Date().toISOString().split('T')[0];
    await this.assertPeriodOpen(revDate);

    const revUser = user || (req ? req.user : null) || { id: null, username: 'المدير المالي' };
    const revUserId = await this.resolveValidUserId(revUser.id);
    const revUserName = revUser.username || revUser.full_name || 'مسؤول مالي';
    const amount = Number(pay.amount);
    const cleanReason = String(reason).trim();
    const isReceipt = (pay.type === 'قبض');

    let reversingJeId = null;
    let reversingEntryNo = null;

    await transaction(async (tx) => {
      // 1. عكس حركة الصندوق في سلسلة صندوق المشروع (SUGGESTION-7: واعٍ بالصناديق)
      const cashIn = isReceipt ? 0 : amount;
      const cashOut = isReceipt ? amount : 0;
      const cashNotes = `قيد عكسي لسند ${pay.type} ${pay.receipt_no}: ${cleanReason}`;

      await CashBoxService.appendMovement(tx, {
        projectId: pay.project_id ?? null, cashIn, cashOut,
        currency: pay.currency || 'ر.ي', date: revDate, notes: cashNotes
      });

      // 2. عكس أرصدة العميل أو المورد
      if (isReceipt && pay.client_id) {
        await tx.run(`
          UPDATE clients SET 
            total_paid = GREATEST(0, total_paid - ?),
            current_balance = current_balance + ?
          WHERE id = ?
        `, [amount, amount, pay.client_id]);
      } else if (!isReceipt && pay.supplier_id) {
        await tx.run(`
          UPDATE suppliers SET balance = balance + ? WHERE id = ?
        `, [amount, pay.supplier_id]);
      }
 
      const countRes = await tx.get('SELECT COUNT(*) as cnt FROM journal_entries');
      let seq = ((countRes ? countRes.cnt : 0) || 0) + 1;
      reversingEntryNo = `REV-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`;
      while (await tx.get('SELECT id FROM journal_entries WHERE entry_no = ?', [reversingEntryNo])) {
        seq++;
        reversingEntryNo = `REV-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`;
      }

      const jeRes = await tx.run(`
        INSERT INTO journal_entries (
          entry_no, date, description, reference_type, reference_id, 
          total_debit, total_credit, status, created_by, created_by_name, posted_by, posted_by_name, posted_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        reversingEntryNo, revDate,
        `قيد عكسي لسند ${pay.type} رقم ${pay.receipt_no} - سبب العكس: ${cleanReason}`,
        `قيد عكسي سند ${pay.type}`,
        pay.id, amount, amount,
        revUserId, revUserName, revUserId, revUserName
      ]);

      reversingJeId = jeRes.lastInsertRowid || jeRes.insertId;
      const finalCcId = pay.cost_center_id || 1;

      if (isReceipt) {
        // كان الأصلي: مدين (صندوق 3) ودائن (عملاء 4)
        // العكسي: مدين (عملاء 4 أو accId) ودائن (صندوق 3)
        const clientAccId = pay.account_id || 4;
        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes)
          VALUES (?, ?, ?, ?, ?, 0, ?)
        `, [reversingJeId, clientAccId, finalCcId, pay.project_id, amount, `إعادة إثبات ذمة العميل بموجب قيد عكسي - ${cleanReason}`]);

        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes)
          VALUES (?, 3, ?, ?, 0, ?, ?)
        `, [reversingJeId, finalCcId, pay.project_id, amount, `تخفيض الصندوق/البنك بموجب قيد عكسي - ${cleanReason}`]);
      } else {
        // كان الأصلي: مدين (موردين 7) ودائن (صندوق 3)
        // العكسي: مدين (صندوق 3) ودائن (موردين 7 أو accId)
        const suppAccId = pay.account_id || 7;
        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes)
          VALUES (?, 3, ?, ?, ?, 0, ?)
        `, [reversingJeId, finalCcId, pay.project_id, amount, `إعادة المبلغ للصندوق/البنك بموجب قيد عكسي - ${cleanReason}`]);

        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes)
          VALUES (?, ?, ?, ?, 0, ?, ?)
        `, [reversingJeId, suppAccId, finalCcId, pay.project_id, amount, `إعادة إثبات استحقاق المورد بموجب قيد عكسي - ${cleanReason}`]);
      }

      // 4. تحديث حالة السند الأصلي
      await tx.run(`
        UPDATE payments 
        SET status = 'reversed', 
            reversed_by = ?, 
            reversed_by_name = ?, 
            reversed_at = CURRENT_TIMESTAMP, 
            reversal_reason = ?, 
            reversal_ref_id = ?
        WHERE id = ?
      `, [revUserId, revUserName, cleanReason, reversingJeId, pay.id]);
    });

    if (req || user) {
      await logAudit(req, {
        action: 'REVERSE',
        entity_type: isReceipt ? 'receipt' : 'payment_voucher',
        entity_id: pay.receipt_no || String(pay.id),
        details: { receipt_no: pay.receipt_no, type: pay.type, amount, reversing_entry_no: reversingEntryNo },
        old_values: { status: pay.status || 'posted', amount: pay.amount, date: pay.date },
        new_values: { status: 'reversed', reversal_ref_id: reversingJeId, reversed_by: revUserName },
        reason: cleanReason
      });
    }

    return {
      success: true,
      message: `تم عمل القيد العكسي بنجاح برقم (${reversingEntryNo}) وعكس الأثر المالي لسند ${pay.type} (${pay.receipt_no})`,
      reversing_entry_no: reversingEntryNo,
      reversing_je_id: reversingJeId,
      receipt_no: pay.receipt_no,
      amount
    };
  },

  /**
   * تنفيذ قيد عكسي ذري لقيد يومية عام (Manual Journal Entry Reversal)
   */
  async reverseJournalEntry(id, { user, reason, reversal_date, req = null }) {
    if (!reason || String(reason).trim().length < 3) {
      throw new Error('يجب كتابة سبب رسمي ومبرر واضح لإجراء القيد العكسي (Reversal Reason)');
    }

    const entry = await get('SELECT * FROM journal_entries WHERE id = ?', [id]);
    if (!entry) {
      throw new Error('القيد اليومي غير موجود');
    }

    const currentStatus = (entry.status || 'posted').toLowerCase();
    if (currentStatus === DOCUMENT_STATUSES.REVERSED) {
      throw new Error('القيد تم عكسه مسبقاً بقيد عكسي آخر');
    }

    const revDate = reversal_date || new Date().toISOString().split('T')[0];
    await this.assertPeriodOpen(revDate);

    const lines = await query('SELECT * FROM journal_entry_lines WHERE entry_id = ?', [id]);
    if (!lines || lines.length === 0) {
      throw new Error('القيد لا يحتوي على أسطر صالحة للعكس');
    }

    const revUser = user || (req ? req.user : null) || { id: null, username: 'المدير المالي' };
    const revUserId = await this.resolveValidUserId(revUser.id);
    const revUserName = revUser.username || revUser.full_name || 'مسؤول مالي';
    const cleanReason = String(reason).trim();

    let reversingJeId = null;
    let reversingEntryNo = null;

    await transaction(async (tx) => {
      const countRes = await tx.get('SELECT COUNT(*) as cnt FROM journal_entries');
      const seq = ((countRes ? countRes.cnt : 0) || 0) + 1;
      reversingEntryNo = `REV-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`;

      const totalDebit = Number(entry.total_credit || entry.total_debit);
      const totalCredit = Number(entry.total_debit || entry.total_credit);

      const jeRes = await tx.run(`
        INSERT INTO journal_entries (
          entry_no, date, description, reference_type, reference_id, 
          total_debit, total_credit, status, created_by, created_by_name, posted_by, posted_by_name, posted_at
        )
        VALUES (?, ?, ?, 'قيد عكسي', ?, ?, ?, 'posted', ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        reversingEntryNo, revDate,
        `قيد عكسي للقيد رقم ${entry.entry_no} - سبب العكس: ${cleanReason}`,
        entry.id, totalDebit, totalCredit,
        revUserId, revUserName, revUserId, revUserName
      ]);

      reversingJeId = jeRes.lastInsertRowid || jeRes.insertId;

      // عكس المدين والدائن لكل سطر
      for (const line of lines) {
        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
          reversingJeId,
          line.account_id,
          line.cost_center_id,
          line.project_id,
          Number(line.credit || 0), // عكس
          Number(line.debit || 0),  // عكس
          `عكس سطر القيد ${entry.entry_no} - ${cleanReason}`
        ]);
      }

      await tx.run(`
        UPDATE journal_entries 
        SET status = 'reversed', 
            reversed_by = ?, 
            reversed_by_name = ?, 
            reversed_at = CURRENT_TIMESTAMP, 
            reversal_reason = ?, 
            reversal_ref_id = ?
        WHERE id = ?
      `, [revUserId, revUserName, cleanReason, reversingJeId, entry.id]);
    });

    if (req || user) {
      await logAudit(req, {
        action: 'REVERSE',
        entity_type: 'journal_entry',
        entity_id: entry.entry_no || String(entry.id),
        details: { entry_no: entry.entry_no, reversing_entry_no: reversingEntryNo },
        old_values: { status: entry.status || 'posted', total_debit: entry.total_debit, total_credit: entry.total_credit },
        new_values: { status: 'reversed', reversal_ref_id: reversingJeId, reversed_by: revUserName },
        reason: cleanReason
      });
    }

    return {
      success: true,
      message: `تم عمل القيد العكسي بنجاح برقم (${reversingEntryNo}) وعكس القيد (${entry.entry_no})`,
      reversing_entry_no: reversingEntryNo,
      reversing_je_id: reversingJeId,
      original_entry_no: entry.entry_no
    };
  },

  /**
   * تنفيذ قيد عكسي ذري لمستخلص أعمال معتمد/مرحل (Interim Payment Certificate - IPC Reversal)
   * يعكس ذمة العميل، استهلاك الدفعة المقدمة، محتجز الضمان، وفوترة الأعمال مع توليد قيد يومي عكسي متزن
   */
  async reverseBill(id, { user, reason, reversal_date, req = null }) {
    if (!reason || String(reason).trim().length < 3) {
      throw new Error('يجب كتابة سبب رسمي ومبرر واضح لإجراء القيد العكسي للمستخلص (Reversal Reason)');
    }

    const bill = await get('SELECT * FROM bills WHERE id = ?', [id]);
    if (!bill) {
      throw new Error('المستخلص غير موجود');
    }

    const currentStatus = (bill.status || 'معتمد').toLowerCase();
    if (currentStatus === DOCUMENT_STATUSES.REVERSED) {
      throw new Error('المستخلص تم عكسه مسبقاً بقيد عكسي آخر');
    }
    if (currentStatus === DOCUMENT_STATUSES.DRAFT) {
      throw new Error('لا يمكن عمل قيد عكسي لمسودة مستخلص؛ يمكن إلغاء المسودة أو حذفها مباشرة');
    }

    const revDate = reversal_date || new Date().toISOString().split('T')[0];
    await this.assertPeriodOpen(revDate);

    const revUser = user || (req ? req.user : null) || { id: null, username: 'المدير المالي' };
    const revUserId = await this.resolveValidUserId(revUser.id);
    const revUserName = revUser.username || revUser.full_name || 'مسؤول مالي';
    const cleanReason = String(reason).trim();

    const grossAmount = Number(bill.gross_amount || bill.amount || 0);
    const netAmount = Number(bill.net_amount || (bill.amount - (bill.deduction || 0)) || 0);
    const retDeduction = Number(bill.retention_deduction || 0);
    const advDeduction = Number(bill.advance_deduction || 0);

    let reversingJeId = null;
    let reversingEntryNo = null;

    await transaction(async (tx) => {
      // 1. عكس رصيد العميل إن وجد
      if (bill.client_id && netAmount > 0) {
        await tx.run(`
          UPDATE clients SET 
            total_due = GREATEST(0, total_due - ?),
            current_balance = GREATEST(0, current_balance - ?)
          WHERE id = ?
        `, [netAmount, netAmount, bill.client_id]);
      }

      // 2. إنشاء قيد يومي عكسي متزن بالكامل
      const countRes = await tx.get('SELECT COUNT(*) as cnt FROM journal_entries');
      let seq = ((countRes ? countRes.cnt : 0) || 0) + 1;
      reversingEntryNo = `REV-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`;
      while (await tx.get('SELECT id FROM journal_entries WHERE entry_no = ?', [reversingEntryNo])) {
        seq++;
        reversingEntryNo = `REV-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`;
      }

      const jeRes = await tx.run(`
        INSERT INTO journal_entries (
          entry_no, date, description, reference_type, reference_id, 
          total_debit, total_credit, status, created_by, created_by_name, posted_by, posted_by_name, posted_at
        )
        VALUES (?, ?, ?, 'قيد عكسي مستخلص أعمال', ?, ?, ?, 'posted', ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        reversingEntryNo, revDate,
        `قيد عكسي للمستخلص رقم ${bill.bill_no} - سبب العكس: ${cleanReason}`,
        bill.id, grossAmount, grossAmount,
        revUserId, revUserName, revUserId, revUserName
      ]);

      reversingJeId = jeRes.lastInsertRowid || jeRes.insertId;

      // سطر مدين: إلغاء تفويت الأعمال المنجزة (حساب 17 دائن أصلاً، يصبح مدين بالعكس)
      await tx.run(`
        INSERT INTO journal_entry_lines (entry_id, account_id, project_id, debit, credit, notes)
        VALUES (?, 17, ?, ?, 0, ?)
      `, [reversingJeId, bill.project_id, grossAmount, `عكس فوترة أعمال المستخلص ${bill.bill_no} - ${cleanReason}`]);

      // سطر دائن: عكس ذمة العميل (حساب 4 مدين أصلاً، يصبح دائن بالعكس)
      if (netAmount > 0) {
        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, project_id, debit, credit, notes)
          VALUES (?, 4, ?, 0, ?, ?)
        `, [reversingJeId, bill.project_id, netAmount, `عكس استحقاق ذمة العميل بالمستخلص - ${cleanReason}`]);
      }

      // سطر دائن: عكس محتجز الضمان (حساب 16 مدين أصلاً، يصبح دائن بالعكس)
      if (retDeduction > 0) {
        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, project_id, debit, credit, notes)
          VALUES (?, 16, ?, 0, ?, ?)
        `, [reversingJeId, bill.project_id, retDeduction, `عكس استقطاع محتجز الضمان بالمستخلص - ${cleanReason}`]);
      }

      // سطر دائن: إعادة التزام الدفعة المقدمة المستهلكة (حساب 18 مدين أصلاً بالإطفاء، يصبح دائن بالعكس)
      if (advDeduction > 0) {
        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, project_id, debit, credit, notes)
          VALUES (?, 18, ?, 0, ?, ?)
        `, [reversingJeId, bill.project_id, advDeduction, `إعادة إثبات التزام الدفعة المقدمة المستهلكة - ${cleanReason}`]);
      }

      // 3. تحديث حالة المستخلص
      await tx.run(`
        UPDATE bills 
        SET status = 'reversed', 
            reversed_by = ?, 
            reversed_by_name = ?, 
            reversed_at = CURRENT_TIMESTAMP, 
            reversal_reason = ?, 
            reversal_ref_id = ?
        WHERE id = ?
      `, [revUserId, revUserName, cleanReason, reversingJeId, bill.id]);
    });

    if (req || user) {
      await logAudit(req, {
        action: 'REVERSE',
        entity_type: 'bill',
        entity_id: bill.bill_no || String(bill.id),
        details: { bill_no: bill.bill_no, gross_amount: grossAmount, net_amount: netAmount, reversing_entry_no: reversingEntryNo },
        old_values: { status: bill.status, amount: bill.amount, net_amount: bill.net_amount },
        new_values: { status: 'reversed', reversal_ref_id: reversingJeId, reversed_by: revUserName },
        reason: cleanReason
      });
    }

    return {
      success: true,
      message: `تم عمل القيد العكسي بنجاح برقم (${reversingEntryNo}) وعكس الأثر المالي للمستخلص (${bill.bill_no})`,
      reversing_entry_no: reversingEntryNo,
      reversing_je_id: reversingJeId,
      bill_no: bill.bill_no,
      amount: grossAmount
    };
  },

  /**
   * تنفيذ قيد عكسي لفاتورة مشتريات (Purchase Invoice Reversal)
   */
  async reversePurchase(id, { user, reason, reversal_date, req = null }) {
    if (!reason || String(reason).trim().length < 3) {
      throw new Error('يجب كتابة سبب رسمي ومبرر واضح لإجراء القيد العكسي للمشتريات (Reversal Reason)');
    }

    const pu = await get('SELECT * FROM purchases WHERE id = ?', [id]);
    if (!pu) {
      throw new Error('فاتورة المشتريات غير موجودة');
    }

    const currentStatus = (pu.status || 'posted').toLowerCase();
    if (currentStatus === DOCUMENT_STATUSES.REVERSED) {
      throw new Error('فاتورة المشتريات تم عكسها مسبقاً');
    }
    if (currentStatus === DOCUMENT_STATUSES.DRAFT) {
      throw new Error('لا يمكن عمل قيد عكسي لمسودة شراء؛ يمكن حذفها مباشرة');
    }

    const revDate = reversal_date || new Date().toISOString().split('T')[0];
    await this.assertPeriodOpen(revDate);

    const revUser = user || (req ? req.user : null) || { id: null, username: 'المدير المالي' };
    const revUserId = await this.resolveValidUserId(revUser.id);
    const revUserName = revUser.username || revUser.full_name || 'مسؤول مالي';
    const cleanReason = String(reason).trim();

    const totalAmount = Number(pu.total_amount || 0);
    const paidAmount = Number(pu.paid_amount || 0);
    const remaining = totalAmount - paidAmount;

    let reversingJeId = null;
    let reversingEntryNo = null;

    await transaction(async (tx) => {
      // 1. تخفيض رصيد المورد بالمبلغ المتبقي غير المسدد
      if (pu.supplier_id && remaining > 0) {
        await tx.run('UPDATE suppliers SET balance = GREATEST(0, balance - ?) WHERE id = ?', [remaining, pu.supplier_id]);
      }

      // 2. إعادة النقدية لصندوق المشروع إن كان هناك جزء مدفوع نقداً (SUGGESTION-7: واعٍ بالصناديق)
      if (paidAmount > 0) {
        await CashBoxService.appendMovement(tx, {
          projectId: pu.project_id ?? null, cashIn: paidAmount,
          currency: pu.currency || 'ر.ي', date: revDate, notes: `قيد عكسي لمشتريات ${pu.invoice_no}: ${cleanReason}`
        });
      }

      // 3. توليد قيد يومي عكسي متزن
      const countRes = await tx.get('SELECT COUNT(*) as cnt FROM journal_entries');
      let seq = ((countRes ? countRes.cnt : 0) || 0) + 1;
      reversingEntryNo = `REV-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`;
      while (await tx.get('SELECT id FROM journal_entries WHERE entry_no = ?', [reversingEntryNo])) {
        seq++;
        reversingEntryNo = `REV-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`;
      }

      const jeRes = await tx.run(`
        INSERT INTO journal_entries (
          entry_no, date, description, reference_type, reference_id, 
          total_debit, total_credit, status, created_by, created_by_name, posted_by, posted_by_name, posted_at
        )
        VALUES (?, ?, ?, 'قيد عكسي فاتورة شراء', ?, ?, ?, 'posted', ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        reversingEntryNo, revDate,
        `قيد عكسي لفاتورة المشتريات رقم ${pu.invoice_no} - ${cleanReason}`,
        pu.id, totalAmount, totalAmount,
        revUserId, revUserName, revUserId, revUserName
      ]);

      reversingJeId = jeRes.lastInsertRowid || jeRes.insertId;

      // مدين: إلغاء استحقاق المورد بالآجل أو استرداد النقد للصندوق
      if (remaining > 0) {
        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, project_id, debit, credit, notes)
          VALUES (?, 7, ?, ?, 0, ?)
        `, [reversingJeId, pu.project_id, remaining, `إلغاء استحقاق المورد عن مشتريات ${pu.invoice_no}`]);
      }
      if (paidAmount > 0) {
        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, project_id, debit, credit, notes)
          VALUES (?, 3, ?, ?, 0, ?)
        `, [reversingJeId, pu.project_id, paidAmount, `استرداد النقدية للصندوق عن مشتريات ${pu.invoice_no}`]);
      }

      // دائن: حساب المصروف أو مشتريات المشروع
      await tx.run(`
        INSERT INTO journal_entry_lines (entry_id, account_id, project_id, debit, credit, notes)
        VALUES (?, 10, ?, 0, ?, ?)
      `, [reversingJeId, pu.project_id, totalAmount, `عكس قيد المشتريات ${pu.invoice_no}`]);

      // 4. تحديث حالة الفاتورة
      await tx.run(`
        UPDATE purchases 
        SET status = 'reversed', 
            reversed_by = ?, 
            reversed_by_name = ?, 
            reversed_at = CURRENT_TIMESTAMP, 
            reversal_reason = ?, 
            reversal_ref_id = ?
        WHERE id = ?
      `, [revUserId, revUserName, cleanReason, reversingJeId, pu.id]);
    });

    if (req || user) {
      await logAudit(req, {
        action: 'REVERSE',
        entity_type: 'purchase',
        entity_id: pu.invoice_no || String(pu.id),
        details: { invoice_no: pu.invoice_no, total_amount: totalAmount, reversing_entry_no: reversingEntryNo },
        old_values: { status: pu.status, total_amount: pu.total_amount },
        new_values: { status: 'reversed', reversal_ref_id: reversingJeId, reversed_by: revUserName },
        reason: cleanReason
      });
    }

    return {
      success: true,
      message: `تم عمل القيد العكسي بنجاح برقم (${reversingEntryNo}) وعكس فاتورة المشتريات (${pu.invoice_no})`,
      reversing_entry_no: reversingEntryNo,
      reversing_je_id: reversingJeId,
      invoice_no: pu.invoice_no,
      amount: totalAmount
    };
  },

  // ─── SUGGESTION-4 (§12): الإقفال السنوي ─────────────────────────────────────
  // قيد إقفال مركب بتاريخ نهاية الفترة: تصفير حسابات 4/5 في الأرباح المحتجزة،
  // ثم قفل الفترة ذرياً. يُرفض تكرار الإقفال عبر close_entry_id.

  async ensureCloseSchema() {
    if (this._closeSchemaEnsured) return true;
    const { getActiveEngine } = require('../database/db');
    const engine = typeof getActiveEngine === 'function' ? getActiveEngine() : 'sqlite';

    const ensureColumn = async (table, column, sqliteDef, mysqlDef) => {
      if (engine === 'mysql') {
        const cols = await query(`SHOW COLUMNS FROM ${table}`);
        const names = (cols || []).map(c => c.Field || c.field || c.COLUMN_NAME);
        if (!names.includes(column)) {
          await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${mysqlDef}`);
        }
      } else {
        const cols = await query(`PRAGMA table_info(${table})`);
        const names = (cols || []).map(c => c.name);
        if (!names.includes(column)) {
          await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${sqliteDef}`);
        }
      }
    };

    try {
      await ensureColumn('accounting_periods', 'close_entry_id', 'INTEGER', 'INT NULL');
      // حساب الأرباح المحتجزة (33) ابناً لحقوق الملكية (3) إن لم يوجد
      const retained = await get("SELECT id FROM accounts WHERE code = '33'");
      if (!retained) {
        const parent = await get("SELECT id FROM accounts WHERE code = '3'");
        await run(
          'INSERT INTO accounts (code, name, type, parent_id, balance) VALUES (?, ?, ?, ?, 0)',
          ['33', 'الأرباح المحتجزة والمرحّلة', 'حقوق ملكية', parent ? parent.id : null]
        );
      }
      this._closeSchemaEnsured = true;
      return true;
    } catch (err) {
      console.warn('⚠️ [YearClose] تعذر التأكد من مخطط الإقفال:', err.message);
      throw err;
    }
  },

  /** صافي حسابات النتيجة (4/5) بأرصدتها الكاملة حتى تاريخ معين — نفس منهج التقارير */
  async getYearClosePreview(endDate) {
    await this.ensureCloseSchema();
    const accounts = await query(
      `SELECT * FROM accounts
       WHERE type IN ('إيرادات', 'مصروفات', 'تكاليف')
          OR code LIKE '4%' OR code LIKE '5%'
       ORDER BY code ASC`
    );
    const move = await query(`
      SELECT jel.account_id,
             COALESCE(SUM(jel.debit), 0) as d, COALESCE(SUM(jel.credit), 0) as c
      FROM journal_entry_lines jel
      JOIN journal_entries je ON jel.entry_id = je.id
      WHERE je.status = 'posted' AND je.date <= ?
      GROUP BY jel.account_id
    `, [endDate]);
    const moveMap = {};
    (move || []).forEach(r => {
      moveMap[r.account_id] = { d: Number(r.d) || 0, c: Number(r.c) || 0 };
    });

    const revenues = [];
    const expenses = [];
    for (const acc of accounts) {
      const t = (acc.type || '').trim();
      const code = String(acc.code || '');
      const isRevenue = t === 'إيرادات' || (!['مصروفات', 'تكاليف'].includes(t) && code.startsWith('4'));
      const isExpense = t === 'مصروفات' || t === 'تكاليف' ||
        (!['إيرادات'].includes(t) && code.startsWith('5'));
      if (!isRevenue && !isExpense) continue;
      const m = moveMap[acc.id] || { d: 0, c: 0 };
      const opening = Number(acc.balance) || 0;
      let totalD = m.d;
      let totalC = m.c;
      if (isExpense) {
        if (opening >= 0) totalD += opening; else totalC += -opening;
      } else {
        if (opening >= 0) totalC += opening; else totalD += -opening;
      }
      const net = isExpense ? (totalD - totalC) : (totalC - totalD);
      if (Math.abs(net) < 0.005) continue;
      const row = {
        account_id: acc.id, code: acc.code, name: acc.name,
        total_debit: totalD, total_credit: totalC, net
      };
      if (isRevenue) revenues.push(row); else expenses.push(row);
    }
    const totalRev = revenues.reduce((s, r) => s + r.net, 0);
    const totalExp = expenses.reduce((s, r) => s + r.net, 0);
    return { revenues, expenses, total_revenues: totalRev, total_expenses: totalExp, net: totalRev - totalExp };
  },

  /**
   * تنفيذ الإقفال السنوي + قفل الفترة ذرياً.
   * closedBy: اسم المفوَّض (تُتحقق كلمة المرور في المسار قبل الاستدعاء).
   */
  async executeYearClose(periodId, { closedBy, notes = null, req = null } = {}) {
    await this.ensureCloseSchema();
    const period = await get('SELECT * FROM accounting_periods WHERE id = ?', [periodId]);
    if (!period) throw new Error('الفترة المحاسبية غير موجودة');
    if (period.close_entry_id) {
      const je = await get('SELECT entry_no FROM journal_entries WHERE id = ?', [period.close_entry_id]);
      throw new Error(`تم إقفال هذه الفترة محاسبياً مسبقاً بالقيد (${je ? je.entry_no : period.close_entry_id})`);
    }
    if (period.status === 'closed') {
      throw new Error('الفترة مقفلة بدون قيد إقفال — أعد فتحها ثم نفّذ الإقفال السنوي');
    }
    await this.assertPeriodOpen(period.end_date);

    const preview = await this.getYearClosePreview(period.end_date);
    const retained = await get("SELECT id FROM accounts WHERE code = '33'");
    if (!retained) throw new Error('حساب الأرباح المحتجزة (33) غير موجود');

    const userId = req?.user?.id || null;
    const posterId = await this.resolveValidUserId(userId);
    const posterName = closedBy || req?.user?.username || 'المدير العام';
    const fYear = period.fiscal_year || String(period.end_date).slice(0, 4);

    const result = await transaction(async (tx) => {
      let jeId = null;
      let entryNo = null;

      // سطور الإقفال: تصفير كل حساب نتيجة ثم الفرق للأرباح المحتجزة
      const closeLines = [];
      for (const r of preview.revenues) {
        if (r.net >= 0) closeLines.push({ account_id: r.account_id, debit: r.net, credit: 0 });
        else closeLines.push({ account_id: r.account_id, debit: 0, credit: -r.net });
      }
      for (const e of preview.expenses) {
        if (e.net >= 0) closeLines.push({ account_id: e.account_id, debit: 0, credit: e.net });
        else closeLines.push({ account_id: e.account_id, debit: e.net, credit: 0 });
      }
      const lineDr = closeLines.reduce((s, l) => s + l.debit, 0);
      const lineCr = closeLines.reduce((s, l) => s + l.credit, 0);
      const plug = Math.round((lineDr - lineCr) * 100) / 100;
      if (Math.abs(plug) >= 0.005) {
        if (plug > 0) closeLines.push({ account_id: retained.id, debit: 0, credit: plug });
        else closeLines.push({ account_id: retained.id, debit: -plug, credit: 0 });
      }

      if (closeLines.length > 0) {
        const entryCount = await tx.get('SELECT COUNT(*) as cnt FROM journal_entries');
        let jeSeq = ((entryCount ? entryCount.cnt : 0) || 0) + 1;
        entryNo = `CLS-${fYear}-${String(jeSeq).padStart(4, '0')}`;
        while (await tx.get('SELECT id FROM journal_entries WHERE entry_no = ?', [entryNo])) {
          jeSeq++;
          entryNo = `CLS-${fYear}-${String(jeSeq).padStart(4, '0')}`;
        }
        const total = closeLines.reduce((s, l) => s + l.debit, 0);
        const jeRes = await tx.run(`
          INSERT INTO journal_entries (
            entry_no, date, description, reference_type, reference_id,
            total_debit, total_credit, status, created_by, created_by_name, posted_by, posted_by_name, posted_at
          )
          VALUES (?, ?, ?, 'إقفال سنوي', ?, ?, ?, 'posted', ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `, [
          entryNo, period.end_date,
          `قيد الإقفال السنوي للفترة (${period.period_name}) — تصفير حسابات النتيجة في الأرباح المحتجزة`,
          period.id, total, total, posterId, posterName, posterId, posterName
        ]);
        jeId = jeRes.lastInsertRowid || jeRes.insertId;

        for (const l of closeLines) {
          await tx.run(`
            INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, notes)
            VALUES (?, ?, ?, ?, ?)
          `, [jeId, l.account_id, l.debit, l.credit, `إقفال ${period.period_name}`]);
        }
      }

      await tx.run(`
        UPDATE accounting_periods
        SET status = 'closed', closed_at = CURRENT_TIMESTAMP, closed_by = ?,
            close_entry_id = ?, notes = COALESCE(?, notes)
        WHERE id = ?
      `, [posterName, jeId, notes || null, period.id]);

      return { jeId, entryNo, lines_count: closeLines.length };
    });

    if (req) {
      await logAudit(req, {
        action: 'CLOSE_PERIOD',
        entity_type: 'period',
        entity_id: periodId,
        details: {
          period_name: period.period_name, closed_by: posterName,
          close_entry_no: result.entryNo, total_revenues: preview.total_revenues,
          total_expenses: preview.total_expenses, net: preview.net
        }
      });
    }

    return {
      success: true,
      entry_no: result.entryNo,
      journal_entry_id: result.jeId,
      lines_count: result.lines_count,
      total_revenues: preview.total_revenues,
      total_expenses: preview.total_expenses,
      net: preview.net,
      locked: true
    };
  }
};

module.exports = FinancialControlService;
