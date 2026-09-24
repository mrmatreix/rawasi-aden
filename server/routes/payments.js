const express = require('express');
const router = express.Router();
const { query, get, run, transaction } = require('../database/db');
const { logAudit } = require('../services/auditService');
const { checkPeriodOpen } = require('../services/periodService');
const { requirePermission, parseScopeArray } = require('../middleware/security');
const FinancialControlService = {
  ...require('../services/financialControlService')
};

// جلب سندات القبض والصرف مع بيانات الحسابات ومراكز التكلفة وحالة دورة المستند
router.get('/', requirePermission('revenues:view,expenses:view,accounting:view'), async (req, res) => {
  try {
    const { type, client_id, supplier_id, project_id, status } = req.query;
    let sql = `
      SELECT p.*, 
        c.name as client_name, 
        s.name as supplier_name,
        pr.name as project_name,
        a.name as account_name,
        a.code as account_code,
        cc.name as cost_center_name,
        cc.code as cost_center_code
      FROM payments p
      LEFT JOIN clients c ON p.client_id = c.id
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      LEFT JOIN projects pr ON p.project_id = pr.id
      LEFT JOIN accounts a ON p.account_id = a.id
      LEFT JOIN cost_centers cc ON p.cost_center_id = cc.id
    `;
    const params = [];
    const conditions = [];

    // تطبيق نطاق المشاريع المصرح بها
    if (req.user && req.user.role !== 'admin' && req.user.username !== 'admin') {
      const allowedProjects = parseScopeArray(req.user.scope?.allowed_projects || req.user.allowed_projects);
      if (!allowedProjects.includes('*') && !allowedProjects.includes('all')) {
        if (allowedProjects.length === 0) {
          return res.json({ success: true, data: [] });
        }
        const placeholders = allowedProjects.map(() => '?').join(',');
        conditions.push(`(p.project_id IS NULL OR p.project_id IN (${placeholders}))`);
        params.push(...allowedProjects.map(Number));
      }
    }

    if (type) {
      conditions.push('p.type = ?');
      params.push(type);
    }
    if (client_id) {
      conditions.push('p.client_id = ?');
      params.push(client_id);
    }
    if (supplier_id) {
      conditions.push('p.supplier_id = ?');
      params.push(supplier_id);
    }
    if (project_id) {
      conditions.push('p.project_id = ?');
      params.push(project_id);
    }
    if (status) {
      conditions.push('p.status = ?');
      params.push(status);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY p.date DESC, p.id DESC';
    const payments = await query(sql, params);
    res.json({ success: true, data: payments });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب السندات والمدفوعات', error: err.message });
  }
});

// إنشاء سند قبض أو صرف (مسودة أو ترحيل فوري) مع توثيق المنشئ وفحص الفترة
router.post('/', (req, res, next) => {
  const isReceipt = (req.body?.type === 'قبض');
  const reqPerm = isReceipt ? 'revenues:create' : 'expenses:create';
  return requirePermission(reqPerm)(req, res, next);
}, async (req, res) => {
  try {
    const {
      type = 'قبض', // 'قبض' أو 'صرف'
      client_id,
      supplier_id,
      project_id,
      account_id,
      cost_center_id,
      amount,
      currency = 'ر.ي',
      payment_method = 'نقدي', // تحويل بنكي، نقدي، شيك
      check_no,
      bank_name,
      date = new Date().toISOString().split('T')[0],
      notes,
      status: requestedStatus
    } = req.body;

    // 1. التحقق من إغلاق الفترة المحاسبية لتاريخ السند
    await FinancialControlService.assertPeriodOpen(date);

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'المبلغ مطلوب ويجب أن يكون أكبر من الصفر' });
    }

    if (payment_method === 'شيك' && (!check_no || !String(check_no).trim())) {
      return res.status(400).json({ success: false, message: `عند إصدار سند ${type} بطريقة الدفع (شيك) يجب إدخال رقم الشيك` });
    }

    const parsedAmount = Number(amount);
    const selectedCurrency = currency || 'ر.ي';
    const cleanCheckNo = check_no ? String(check_no).trim() : null;
    const cleanBankName = bank_name ? String(bank_name).trim() : null;

    // توليد رقم السند
    const prefix = type === 'قبض' ? 'RC' : 'PV';
    const currentYear = new Date().getFullYear();
    const countRes = await get('SELECT COUNT(*) as cnt FROM payments WHERE type = ?', [type]);
    let seq = (countRes ? countRes.cnt : 0) + 1;
    let receipt_no = `${prefix}-${currentYear}-${String(seq).padStart(4, '0')}`;
    while (await get('SELECT id FROM payments WHERE receipt_no = ?', [receipt_no])) {
      seq++;
      receipt_no = `${prefix}-${currentYear}-${String(seq).padStart(4, '0')}`;
    }

    const cId = client_id && client_id !== '' ? Number(client_id) : null;
    const sId = supplier_id && supplier_id !== '' ? Number(supplier_id) : null;
    const pId = project_id && project_id !== '' ? Number(project_id) : null;
    const accId = account_id && account_id !== '' ? Number(account_id) : null;
    let finalCcId = cost_center_id && cost_center_id !== '' ? Number(cost_center_id) : null;

    if (!finalCcId && pId) {
      const prjCc = await get('SELECT id FROM cost_centers WHERE project_id = ? LIMIT 1', [pId]);
      if (prjCc) finalCcId = prjCc.id;
    }
    if (!finalCcId) finalCcId = 1;

    const rawCreatorId = req.user?.id || null;
    const creatorId = await FinancialControlService.resolveValidUserId(rawCreatorId);
    const creatorName = req.user?.username || req.user?.full_name || 'مسؤول مالي';
    const finalStatus = (requestedStatus === 'draft') ? 'draft' : 'posted';
    const cleanReceiptCategory = req.body.receipt_category || 'general';

    const txResult = await transaction(async (tx) => {
      // 1. تسجيل السند مع بيانات المنشئ وحالة الدورة وتصنيف المقبوضات
      const result = await tx.run(`
        INSERT INTO payments (
          receipt_no, type, client_id, supplier_id, project_id, 
          account_id, cost_center_id, amount, currency, payment_method, 
          check_no, bank_name, date, notes, receipt_category,
          status, created_by, created_by_name, posted_by, posted_by_name, posted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        receipt_no, type, cId, sId, pId,
        accId, finalCcId, parsedAmount, selectedCurrency, payment_method,
        cleanCheckNo, cleanBankName, date, notes || '', cleanReceiptCategory,
        finalStatus, creatorId, creatorName,
        finalStatus === 'posted' ? creatorId : null,
        finalStatus === 'posted' ? creatorName : null,
        finalStatus === 'posted' ? new Date().toISOString() : null
      ]);

      const paymentId = result.lastInsertRowid || result.insertId;

      // 2. إذا كانت مسودة، لا يتم التأثير المالي حتى الاعتماد والترحيل
      if (finalStatus === 'posted') {
        // التأثير المحاسبي على العميل أو المورد
        if (type === 'قبض' && cId) {
          await tx.run(`
            UPDATE clients SET 
              total_paid = total_paid + ?,
              current_balance = GREATEST(0, current_balance - ?)
            WHERE id = ?
          `, [parsedAmount, parsedAmount, cId]);
        } else if (type === 'صرف' && sId) {
          await tx.run(`
            UPDATE suppliers SET balance = GREATEST(0, balance - ?) WHERE id = ?
          `, [parsedAmount, sId]);
        }

        // التأثير على حركة الصندوق والبنك
        const lastCash = await tx.get('SELECT current_balance FROM cash_movements ORDER BY id DESC LIMIT 1') || { current_balance: 125000 };
        const prevBal = Number(lastCash.current_balance) || 0;
        const newBal = type === 'قبض' ? prevBal + parsedAmount : prevBal - parsedAmount;
        const moveDesc = payment_method === 'شيك' 
          ? `سند ${type} بشيك رقم ${cleanCheckNo}: ${receipt_no}`
          : `سند ${type}: ${receipt_no}`;

        await tx.run(`
          INSERT INTO cash_movements (previous_balance, cash_in, cash_out, withdrawals, current_balance, currency, date, notes)
          VALUES (?, ?, ?, 0, ?, ?, ?, ?)
        `, [
          prevBal,
          type === 'قبض' ? parsedAmount : 0,
          type === 'صرف' ? parsedAmount : 0,
          newBal,
          selectedCurrency,
          date,
          moveDesc
        ]);

        // توليد قيد يومي تلقائي متزن
        const entryCount = await tx.get('SELECT COUNT(*) as cnt FROM journal_entries');
        let jeSeq = (entryCount ? entryCount.cnt : 0) + 1;
        let entryNo = `JE-${String(jeSeq).padStart(5, '0')}`;
        while (await tx.get('SELECT id FROM journal_entries WHERE entry_no = ?', [entryNo])) {
          jeSeq++;
          entryNo = `JE-${String(jeSeq).padStart(5, '0')}`;
        }

        const jeRes = await tx.run(`
          INSERT INTO journal_entries (
            entry_no, date, description, reference_type, reference_id, 
            total_debit, total_credit, status, created_by, created_by_name, posted_by, posted_by_name, posted_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `, [
          entryNo,
          date,
          `سند ${type} رقم ${receipt_no} ${cleanCheckNo ? '(شيك: ' + cleanCheckNo + ')' : ''} - ${notes || ''}`,
          `سند ${type}`,
          paymentId,
          parsedAmount,
          parsedAmount,
          creatorId, creatorName, creatorId, creatorName
        ]);

        const jeId = jeRes.lastInsertRowid || jeRes.insertId;

        // أسطر القيد
        if (type === 'قبض') {
          await tx.run(`
            INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes) 
            VALUES (?, 3, ?, ?, ?, 0, ?)
          `, [jeId, finalCcId, pId, parsedAmount, `قبض في الصندوق / البنك`]);

          let creditAcc = accId;
          let creditNote = 'تحصيل مستخلص / تخفيض ذمة العميل (IFRS 15)';
          if (!creditAcc) {
            if (cleanReceiptCategory === 'advance_payment') {
              creditAcc = 18; // 2105 - التزامات تعاقدية / دفعات مقدمة من العملاء
              creditNote = 'إثبات التزام تعاقدي: دفعة مقدمة من العميل (ليست إيراداً دفترياً)';
            } else if (cleanReceiptCategory === 'retention_release') {
              creditAcc = 16; // 1125 - محتجزات ضمان لدى العملاء
              creditNote = 'تحصيل إفراج عن محتجز ضمان العقد';
            } else {
              creditAcc = 4; // 112 - العملاء (الذمم المدينة)
              creditNote = 'تحصيل مستخلص وتخفيض ذمة العميل المفوترة';
            }
          }

          await tx.run(`
            INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes) 
            VALUES (?, ?, ?, ?, 0, ?, ?)
          `, [jeId, creditAcc, finalCcId, pId, parsedAmount, creditNote]);
        } else {
          const debitAcc = accId || 7;
          await tx.run(`
            INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes) 
            VALUES (?, ?, ?, ?, ?, 0, ?)
          `, [jeId, debitAcc, finalCcId, pId, parsedAmount, `سداد للمورد / إثبات المصروف`]);

          await tx.run(`
            INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes) 
            VALUES (?, 3, ?, ?, 0, ?, ?)
          `, [jeId, finalCcId, pId, parsedAmount, `صرف من الصندوق / البنك`]);
        }
      }

      return result;
    });

    await logAudit(req, {
      action: finalStatus === 'draft' ? 'CREATE_DRAFT' : 'INSERT',
      entity_type: type === 'قبض' ? 'receipt' : 'payment_voucher',
      entity_id: receipt_no,
      details: { type, amount: parsedAmount, status: finalStatus, created_by: creatorName },
      new_values: { receipt_no, type, amount: parsedAmount, date, status: finalStatus, created_by: creatorName }
    });

    res.json({
      success: true,
      message: finalStatus === 'draft'
        ? `تم حفظ مسودة سند ${type} بنجاح برقم ${receipt_no} وهي جاهزة للمراجعة`
        : `تم تسجيل وترحيل سند ال${type} بنجاح برقم ${receipt_no} وحفظ القيد اليومي التلقائي`,
      receipt_no,
      status: finalStatus,
      id: txResult.lastInsertRowid || txResult.insertId
    });
  } catch (err) {
    console.error('Payment transaction error:', err);
    res.status(500).json({ success: false, message: 'خطأ أثناء تسجيل السند: ' + err.message, error: err.message });
  }
});

// إرسال مسودة السند للمراجعة (Draft -> Under Review)
router.post('/:id/submit-review', requirePermission('revenues:create,expenses:create'), async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    const pay = await get('SELECT * FROM payments WHERE id = ?', [id]);
    if (!pay) return res.status(404).json({ success: false, message: 'السند المالي غير موجود' });

    if (pay.status !== 'draft') {
      return res.status(400).json({ success: false, message: `لا يمكن إرسال السند للمراجعة لأنه في حالة [${pay.status}]` });
    }

    const rawRevId = req.user?.id || null;
    const reviewerId = await FinancialControlService.resolveValidUserId(rawRevId);
    const reviewerName = req.user?.username || req.user?.full_name || 'مراجع الحسابات';
    await run(`
      UPDATE payments 
      SET status = 'under_review', reviewed_by = ?, reviewed_by_name = ?, reviewed_at = CURRENT_TIMESTAMP, review_notes = ?
      WHERE id = ?
    `, [reviewerId, reviewerName, notes || null, id]);

    await logAudit(req, {
      action: 'SUBMIT_REVIEW',
      entity_type: pay.type === 'قبض' ? 'receipt' : 'payment_voucher',
      entity_id: pay.receipt_no,
      old_values: { status: 'draft' },
      new_values: { status: 'under_review', reviewed_by: reviewerName }
    });

    res.json({ success: true, message: `تم إرسال سند ${pay.type} (${pay.receipt_no}) للمراجعة بنجاح`, status: 'under_review' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// اعتماد السند المالي مع فحص مبدأ العيون الأربع (Maker-Checker / Four-Eyes Principle)
router.post('/:id/approve', (req, res, next) => {
  return requirePermission('revenues:approve,expenses:approve,accounting:approve')(req, res, next);
}, async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    const pay = await get('SELECT * FROM payments WHERE id = ?', [id]);
    if (!pay) return res.status(404).json({ success: false, message: 'السند المالي غير موجود' });

    // فحص مبدأ العيون الأربع (منع منشئ السند من اعتماده بنفسه)
    try {
      FinancialControlService.assertMakerChecker(pay, req.user, 'اعتماد');
    } catch (soDError) {
      return res.status(403).json({ success: false, message: soDError.message, fourEyesViolation: true });
    }

    await FinancialControlService.assertPeriodOpen(pay.date);

    if (pay.status === 'approved' || pay.status === 'posted') {
      return res.status(400).json({ success: false, message: 'السند معتمد مسبقاً' });
    }

    const rawAppId = req.user?.id || null;
    const approverId = await FinancialControlService.resolveValidUserId(rawAppId);
    const approverName = req.user?.username || req.user?.full_name || 'المدير المالي';
    await run(`
      UPDATE payments 
      SET status = 'approved', approved_by = ?, approved_by_name = ?, approved_at = CURRENT_TIMESTAMP, approval_notes = ?
      WHERE id = ?
    `, [approverId, approverName, notes || null, id]);

    await logAudit(req, {
      action: 'APPROVE',
      entity_type: pay.type === 'قبض' ? 'receipt' : 'payment_voucher',
      entity_id: pay.receipt_no,
      old_values: { status: pay.status },
      new_values: { status: 'approved', approved_by: approverName },
      reason: notes || 'اعتماد مالي قانوني'
    });

    res.json({ success: true, message: `تم اعتماد سند ${pay.type} (${pay.receipt_no}) بنجاح بواسطة [${approverName}]`, status: 'approved' });
  } catch (err) {
    const status = err.message.includes('انتهاك') || err.message.includes('لا يجوز') ? 403 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
});

// ترحيل السند المالي لدفتر الأستاذ والصندوق (Post to GL)
router.post('/:id/post', (req, res, next) => {
  return requirePermission('accounting:post,revenues:create,expenses:create')(req, res, next);
}, async (req, res) => {
  try {
    const { id } = req.params;
    const pay = await get('SELECT * FROM payments WHERE id = ?', [id]);
    if (!pay) return res.status(404).json({ success: false, message: 'السند المالي غير موجود' });

    if (pay.status === 'posted') {
      return res.status(400).json({ success: false, message: 'السند مرحل مسبقاً' });
    }
    if (pay.status === 'reversed') {
      return res.status(400).json({ success: false, message: 'لا يمكن ترحيل سند تم عكسه مسبقاً' });
    }

    await FinancialControlService.assertPeriodOpen(pay.date);

    const rawPosterId = req.user?.id || null;
    const posterId = await FinancialControlService.resolveValidUserId(rawPosterId);
    const posterName = req.user?.username || req.user?.full_name || 'المحاسب المالي';
    const parsedAmount = Number(pay.amount);

    await transaction(async (tx) => {
      // 1. التأثير على العميل أو المورد
      if (pay.type === 'قبض' && pay.client_id) {
        await tx.run(`
          UPDATE clients SET 
            total_paid = total_paid + ?,
            current_balance = GREATEST(0, current_balance - ?)
          WHERE id = ?
        `, [parsedAmount, parsedAmount, pay.client_id]);
      } else if (pay.type === 'صرف' && pay.supplier_id) {
        await tx.run(`
          UPDATE suppliers SET balance = GREATEST(0, balance - ?) WHERE id = ?
        `, [parsedAmount, pay.supplier_id]);
      }

      // 2. حركة الصندوق والبنك
      const lastCash = await tx.get('SELECT current_balance FROM cash_movements ORDER BY id DESC LIMIT 1') || { current_balance: 125000 };
      const prevBal = Number(lastCash.current_balance) || 0;
      const newBal = pay.type === 'قبض' ? prevBal + parsedAmount : prevBal - parsedAmount;
      const moveDesc = pay.payment_method === 'شيك' 
        ? `سند ${pay.type} بشيك رقم ${pay.check_no}: ${pay.receipt_no}`
        : `سند ${pay.type}: ${pay.receipt_no}`;

      await tx.run(`
        INSERT INTO cash_movements (previous_balance, cash_in, cash_out, withdrawals, current_balance, currency, date, notes)
        VALUES (?, ?, ?, 0, ?, ?, ?, ?)
      `, [
        prevBal,
        pay.type === 'قبض' ? parsedAmount : 0,
        pay.type === 'صرف' ? parsedAmount : 0,
        newBal,
        pay.currency || 'ر.ي',
        pay.date,
        moveDesc
      ]);

      // 3. قيد اليومية التلقائي المتزن
      const entryCount = await tx.get('SELECT COUNT(*) as cnt FROM journal_entries');
      let jeSeq = (entryCount ? entryCount.cnt : 0) + 1;
      let entryNo = `JE-${String(jeSeq).padStart(5, '0')}`;
      while (await tx.get('SELECT id FROM journal_entries WHERE entry_no = ?', [entryNo])) {
        jeSeq++;
        entryNo = `JE-${String(jeSeq).padStart(5, '0')}`;
      }

      const jeRes = await tx.run(`
        INSERT INTO journal_entries (
          entry_no, date, description, reference_type, reference_id, 
          total_debit, total_credit, status, created_by, created_by_name, posted_by, posted_by_name, posted_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        entryNo,
        pay.date,
        `سند ${pay.type} مرحل ${pay.receipt_no} - ${pay.notes || ''}`,
        `سند ${pay.type}`,
        pay.id,
        parsedAmount,
        parsedAmount,
        posterId, posterName, posterId, posterName
      ]);

      const jeId = jeRes.lastInsertRowid || jeRes.insertId;
      const finalCcId = pay.cost_center_id || 1;

      if (pay.type === 'قبض') {
        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes) 
          VALUES (?, 3, ?, ?, ?, 0, ?)
        `, [jeId, finalCcId, pay.project_id, parsedAmount, `قبض في الصندوق / البنك`]);

        let creditAcc = pay.account_id;
        let creditNote = 'تخفيض ذمة العميل (مستخلص أعمال)';
        if (!creditAcc) {
          if (pay.receipt_category === 'advance_payment') {
            creditAcc = 18; // 2105 - التزامات تعاقدية / دفعات مقدمة من العملاء
            creditNote = 'إثبات التزام تعاقدي: دفعة مقدمة من العميل (ليست إيراداً دفترياً)';
          } else if (pay.receipt_category === 'retention_release') {
            creditAcc = 16; // 1125 - محتجزات ضمان لدى العملاء
            creditNote = 'تحصيل إفراج عن محتجز ضمان العقد';
          } else {
            creditAcc = 4; // 112 - العملاء (الذمم المدينة)
            creditNote = 'تخفيض ذمة العميل المفوترة';
          }
        }

        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes) 
          VALUES (?, ?, ?, ?, 0, ?, ?)
        `, [jeId, creditAcc, finalCcId, pay.project_id, parsedAmount, creditNote]);
      } else {
        const debitAcc = pay.account_id || 7;
        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes) 
          VALUES (?, ?, ?, ?, ?, 0, ?)
        `, [jeId, debitAcc, finalCcId, pay.project_id, parsedAmount, `سداد للمورد`]);

        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, project_id, debit, credit, notes) 
          VALUES (?, 3, ?, ?, 0, ?, ?)
        `, [jeId, finalCcId, pay.project_id, parsedAmount, `صرف من الصندوق / البنك`]);
      }

      // 4. تحديث حالة السند
      await tx.run(`
        UPDATE payments 
        SET status = 'posted', posted_by = ?, posted_by_name = ?, posted_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [posterId, posterName, pay.id]);
    });

    await logAudit(req, {
      action: 'POST',
      entity_type: pay.type === 'قبض' ? 'receipt' : 'payment_voucher',
      entity_id: pay.receipt_no,
      old_values: { status: pay.status },
      new_values: { status: 'posted', posted_by: posterName }
    });

    res.json({ success: true, message: `تم ترحيل سند ${pay.type} (${pay.receipt_no}) بنجاح وتوليد القيد المحاسبي`, status: 'posted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء ترحيل السند: ' + err.message });
  }
});

// تعديل سند مالي (محمي صارماً: للمسودات فقط)
router.put('/:id', requirePermission('revenues:edit,expenses:edit'), async (req, res) => {
  try {
    const { id } = req.params;
    const pay = await get('SELECT * FROM payments WHERE id = ?', [id]);
    if (!pay) return res.status(404).json({ success: false, message: 'السند المالي غير موجود' });

    try {
      FinancialControlService.assertMutable(pay, 'تعديل قيمة أو بيانات');
    } catch (mErr) {
      return res.status(400).json({ success: false, message: mErr.message, immutable: true });
    }

    await FinancialControlService.assertPeriodOpen(pay.date);

    const { amount, notes, date } = req.body;
    const targetDate = date || pay.date;
    await FinancialControlService.assertPeriodOpen(targetDate);

    const oldVals = { amount: pay.amount, notes: pay.notes, date: pay.date };
    const newVals = { 
      amount: amount ? Number(amount) : pay.amount, 
      notes: notes !== undefined ? notes : pay.notes,
      date: targetDate
    };

    await run(`
      UPDATE payments 
      SET amount = ?, notes = ?, date = ?
      WHERE id = ?
    `, [newVals.amount, newVals.notes, newVals.date, id]);

    await logAudit(req, {
      action: 'UPDATE',
      entity_type: pay.type === 'قبض' ? 'receipt' : 'payment_voucher',
      entity_id: pay.receipt_no,
      old_values: oldVals,
      new_values: newVals,
      reason: req.body.reason || 'تعديل مسودة سند مالي'
    });

    res.json({ success: true, message: 'تم تعديل مسودة السند بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// تنفيذ قيد عكسي لسند القبض أو الصرف (Storno Reversal)
router.post('/:id/reverse', (req, res, next) => {
  return requirePermission('revenues:cancel,expenses:cancel,accounting:approve')(req, res, next);
}, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, reversal_date } = req.body;

    const result = await FinancialControlService.reversePayment(id, {
      user: req.user,
      reason,
      reversal_date,
      req
    });

    res.json(result);
  } catch (err) {
    const status = err.message.includes('لا يمكن') || err.message.includes('يجب كتابة') || err.message.includes('مغلقة') ? 400 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
});

// حذف سند (محمي صارماً: للمسودات فقط! يمنع حذف أي سند معتمد أو مرحل)
router.delete('/:id', (req, res, next) => {
  return requirePermission('revenues:cancel,expenses:cancel')(req, res, next);
}, async (req, res) => {
  try {
    const pay = await get('SELECT * FROM payments WHERE id = ?', [req.params.id]);
    if (!pay) {
      return res.status(404).json({ success: false, message: 'السند غير موجود' });
    }

    try {
      FinancialControlService.assertDeletable(pay);
    } catch (dErr) {
      return res.status(400).json({ 
        success: false, 
        message: dErr.message, 
        financialControlProtected: true 
      });
    }

    await FinancialControlService.assertPeriodOpen(pay.date);

    await run('DELETE FROM payments WHERE id = ?', [req.params.id]);

    await logAudit(req, {
      action: 'DELETE_DRAFT',
      entity_type: pay.type === 'قبض' ? 'receipt' : 'payment_voucher',
      entity_id: pay.receipt_no,
      old_values: { receipt_no: pay.receipt_no, type: pay.type, amount: pay.amount, date: pay.date, status: pay.status },
      reason: req.body?.reason || 'حذف مسودة سند غير معتمدة'
    });

    res.json({ success: true, message: `تم حذف مسودة سند ال${pay.type} بنجاح` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في حذف السند: ' + err.message });
  }
});

module.exports = router;
