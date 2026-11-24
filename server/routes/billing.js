const express = require('express');
const router = express.Router();
const { query, get, run, transaction } = require('../database/db');
const { logAudit } = require('../services/auditService');
const { checkPeriodOpen } = require('../services/periodService');
const { requirePermission, parseScopeArray, recordScopeParam, projectScopeSql } = require('../middleware/security');
// كل مسار يحمل :id يفحص مشروع السجل المخزَّن نفسه أولاً (المستخدم المقيّد لا يصل إلى سجل مشروع آخر برقمه)
router.param('id', recordScopeParam('bills'));


// جلب الفواتير والمستخلصات مع تطبيق النطاق الصلاحي
router.get('/', requirePermission('billing:view,revenues:view'), async (req, res) => {
  try {
    const { project_id, client_id, status } = req.query;
    let sql = `
      SELECT b.*, 
        p.name as project_name, 
        c.name as client_name 
      FROM bills b
      LEFT JOIN projects p ON b.project_id = p.id
      LEFT JOIN clients c ON b.client_id = c.id
    `;
    const params = [];
    const conditions = [];

    // تطبيق نطاق المشاريع المصرح بها
    { const scopeSql = projectScopeSql(req.user, 'b.project_id'); if (scopeSql) { conditions.push(scopeSql.sql); params.push(...scopeSql.params); } }

    if (project_id) {
      conditions.push('b.project_id = ?');
      params.push(project_id);
    }
    if (client_id) {
      conditions.push('b.client_id = ?');
      params.push(client_id);
    }
    if (status) {
      conditions.push('b.status = ?');
      params.push(status);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY b.date DESC, b.id DESC';
    const bills = await query(sql, params);
    res.json({ success: true, data: bills });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب المستخلصات', error: err.message });
  }
});

const FinancialControlService = {
  ...require('../services/financialControlService')
};
const clientChainService = require('../services/clientChainService');

const BillingService = require('../services/billing/billingService');
const billStatus = err => err.statusCode || (/انتهاك|لا يجوز/.test(err.message) ? 403 : 500);

// إنشاء مستخلص: يُنشأ دائماً مسودة؛ الاعتماد بمستخدم آخر ثم الترحيل (سياسة الإيراد عند اعتماد المستخلص)
router.post('/', requirePermission('billing:create'), async (req, res) => {
  try {
    const requested = req.body.status;
    const bill = await BillingService.create(req.body, req.user);
    await logAudit(req, {
      action: 'CREATE_DRAFT', entity_type: 'bill', entity_id: bill.bill_no,
      details: { ...bill, requested_status: requested || 'draft' }
    });
    const wantedPosting = requested === 'posted' || requested === 'معتمد' || requested === 'approved';
    res.json({
      success: true,
      message: wantedPosting
        ? `تم حفظ المستخلص (${bill.bill_no}) كمسودة. لا يُرحّل المستخلص لحظة إنشائه: يجب اعتماده بواسطة مستخدم آخر ثم ترحيله.`
        : `تم حفظ مسودة المستخلص (${bill.bill_no}) بنجاح وهي جاهزة للمراجعة والاعتماد`,
      requires_approval: true,
      bill_no: bill.bill_no,
      status: bill.status,
      id: bill.id,
      gross_amount: bill.gross_amount,
      net_amount: bill.net_amount,
      journal_entry_no: null
    });
  } catch (err) {
    res.status(billStatus(err)).json({ success: false, message: 'خطأ في إنشاء المستخلص: ' + err.message, error: err.message });
  }
});

// إرسال مسودة المستخلص للمراجعة (Draft -> Under Review)
router.post('/:id/submit-review', requirePermission('billing:create,billing:edit'), async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    const bill = await get('SELECT * FROM bills WHERE id = ?', [id]);
    if (!bill) return res.status(404).json({ success: false, message: 'المستخلص غير موجود' });

    if (bill.status !== 'draft') {
      return res.status(400).json({ success: false, message: `لا يمكن إرسال المستخلص للمراجعة لأنه في حالة [${bill.status}]` });
    }

    const rawRevId = req.user?.id || null;
    const reviewerId = await FinancialControlService.resolveValidUserId(rawRevId);
    const reviewerName = req.user?.username || req.user?.full_name || 'مهندس التدقيق';

    await run(`
      UPDATE bills 
      SET status = 'under_review', reviewed_by = ?, reviewed_by_name = ?, reviewed_at = CURRENT_TIMESTAMP, review_notes = ?
      WHERE id = ?
    `, [reviewerId, reviewerName, notes || null, id]);

    await logAudit(req, {
      action: 'SUBMIT_REVIEW',
      entity_type: 'bill',
      entity_id: bill.bill_no,
      old_values: { status: 'draft' },
      new_values: { status: 'under_review', reviewed_by: reviewerName }
    });

    res.json({ success: true, message: `تم إرسال المستخلص (${bill.bill_no}) للمراجعة والتدقيق الهندسي بنجاح`, status: 'under_review' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// اعتماد المستخلص مع فحص مبدأ العيون الأربع (Maker-Checker / Four-Eyes Principle)
router.post('/:id/approve', requirePermission('billing:approve,accounting:approve'), async (req, res) => {
  try {
    const { bill, approved_by } = await BillingService.approve(req.params.id, req.user, req.body.notes);
    await logAudit(req, {
      action: 'APPROVE', entity_type: 'bill', entity_id: bill.bill_no,
      old_values: { status: bill.status }, new_values: { status: 'approved', approved_by },
      reason: req.body.notes || 'اعتماد هندسي ومالي معتمد'
    });
    res.json({ success: true, message: `تم اعتماد المستخلص (${bill.bill_no}) بنجاح بواسطة [${approved_by}]`, status: 'approved' });
  } catch (err) {
    const status = billStatus(err);
    res.status(status).json({ success: false, message: err.message, ...(status === 403 ? { fourEyesViolation: true } : {}) });
  }
});

// ترحيل المستخلص المعتمد لدفتر الأستاذ وحسابات العميل (Post to GL) عبر PostingService
router.post('/:id/post', requirePermission('billing:post,accounting:post'), async (req, res) => {
  try {
    const { bill, entry } = await BillingService.post(req.params.id, req.user);
    await logAudit(req, {
      action: 'POST', entity_type: 'bill', entity_id: bill.bill_no,
      old_values: { status: bill.status }, new_values: { status: 'posted', posted_by: req.user?.username, journal_entry_no: entry.entry_no }
    });
    res.json({ success: true, message: `تم ترحيل المستخلص (${bill.bill_no}) بنجاح وتوليد القيد المحاسبي (${entry.entry_no})`, status: 'posted', journal_entry_no: entry.entry_no });
  } catch (err) {
    res.status(billStatus(err)).json({ success: false, message: 'خطأ أثناء ترحيل المستخلص: ' + err.message });
  }
});

// تعديل مستخلص (للمسودات وقيد المراجعة فقط؛ المتبقي يتبع الصافي دائماً)
router.put('/:id', requirePermission('billing:edit'), async (req, res) => {
  try {
    const { before, after, bill } = await BillingService.update(req.params.id, req.body);
    await logAudit(req, {
      action: 'UPDATE', entity_type: 'bill', entity_id: bill.bill_no,
      old_values: before, new_values: after, reason: req.body.reason || 'تعديل مسودة مستخلص'
    });
    res.json({ success: true, message: 'تم تعديل مسودة المستخلص بنجاح' });
  } catch (err) {
    res.status(billStatus(err)).json({ success: false, message: err.message, ...(err.immutable ? { immutable: true } : {}) });
  }
});

// تنفيذ قيد عكسي لمستخلص معتمد/مرحل (IPC Storno Reversal)
router.post('/:id/reverse', requirePermission('billing:approve,accounting:approve'), async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, reversal_date } = req.body;

    const result = await FinancialControlService.reverseBill(id, {
      user: req.user,
      reason,
      reversal_date,
      req
    });

    res.json(result);
  } catch (err) {
    const status = err.statusCode || (err.message.includes('لا يمكن') || err.message.includes('يجب كتابة') || err.message.includes('مغلقة') ? 400 : 500);
    res.status(status).json({ success: false, message: err.message });
  }
});

// حذف مستخلص (محمي صارماً: للمسودات فقط! يمنع حذف أي مستند معتمد أو مرحل)
router.delete('/:id', requirePermission('billing:cancel'), async (req, res) => {
  try {
    const bill = await get('SELECT * FROM bills WHERE id = ?', [req.params.id]);
    if (!bill) return res.status(404).json({ success: false, message: 'المستخلص غير موجود' });

    try {
      FinancialControlService.assertDeletable(bill);
    } catch (dErr) {
      return res.status(400).json({ 
        success: false, 
        message: dErr.message, 
        financialControlProtected: true 
      });
    }

    await FinancialControlService.assertPeriodOpen(bill.date);

    await run('DELETE FROM bills WHERE id = ?', [req.params.id]);

    await logAudit(req, {
      action: 'DELETE_DRAFT',
      entity_type: 'bill',
      entity_id: req.params.id,
      old_values: { bill_no: bill.bill_no, amount: bill.amount, status: bill.status },
      reason: req.body?.reason || 'حذف مسودة مستخلص غير معتمد'
    });

    res.json({ success: true, message: 'تم حذف مسودة المستخلص بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في حذف المستخلص: ' + err.message });
  }
});

// مصفوفة الفصل المالي الشاملة لقطاع المقاولات (IFRS 15 Separation Matrix)
const ContractingAccountingService = require('../services/contractingAccountingService');

router.get('/contracting-matrix', requirePermission('billing:view,revenues:view,reports:view'), async (req, res) => {
  try {
    let allowedProjects = ['*'];
    if (req.user && req.user.role !== 'admin') {
      allowedProjects = parseScopeArray(req.user.scope?.allowed_projects || req.user.allowed_projects);
    }

    const matrix = await ContractingAccountingService.getCompanyWideSeparationMatrix({
      allowedProjectIds: allowedProjects
    });

    res.json(matrix);
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في توليد مصفوفة المقاولات المالية: ' + err.message });
  }
});

// جلب تفاصيل مشروع مفرد في مصفوفة المقاولات
router.get('/contracting-matrix/:projectId', requirePermission('billing:view,revenues:view,reports:view'), async (req, res) => {
  try {
    const { projectId } = req.params;
    const metrics = await ContractingAccountingService.calculateProjectMetrics(projectId);
    res.json({ success: true, data: metrics });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// إثبات الإيراد المحاسبي الدوري لمشروع وفق نسبة الإنجاز POC
router.post('/recognize-revenue', requirePermission('billing:create,accounting:create'), async (req, res) => {
  try {
    const { project_id, period_date, notes } = req.body;
    if (!project_id) {
      return res.status(400).json({ success: false, message: 'يجب تحديد المشروع المطلوب إثبات إيراده' });
    }

    const result = await ContractingAccountingService.recognizeProjectRevenue({
      projectId: project_id,
      periodDate: period_date,
      notes,
      user: req.user,
      req
    });

    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, message: 'خطأ أثناء إثبات الإيراد التعاقدي: ' + err.message, code: err.code });
  }
});

// سجل إثباتات الإيرادات التعاقدية السابقة
router.get('/recognitions', requirePermission('billing:view,revenues:view,accounting:view'), async (req, res) => {
  try {
    const { project_id } = req.query;
    let sql = `
      SELECT cr.*, p.name as project_name, je.entry_no as journal_entry_no
      FROM contract_revenue_recognitions cr
      LEFT JOIN projects p ON cr.project_id = p.id
      LEFT JOIN journal_entries je ON cr.journal_entry_id = je.id
    `;
    const params = [];
    if (project_id) {
      sql += ' WHERE cr.project_id = ?';
      params.push(project_id);
    }
    sql += ' ORDER BY cr.period_date DESC, cr.id DESC';

    const records = await query(sql, params);
    res.json({ success: true, data: records });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;

