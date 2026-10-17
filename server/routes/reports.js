/**
 * =========================================================================
 * server/routes/reports.js
 * مسارات واجهة برمجة التطبيقات (REST API) للتقارير والقوائم المالية الرسمية
 * لشركة رواسي عدن للهندسة والمقاولات
 * =========================================================================
 * 
 * المبادئ المطبقة:
 * 1. مسارات خفيفة جداً: التحقق من الصلاحيات والمدخلات، استدعاء ReportingService، وإرجاع بنية موحدة.
 * 2. التحقق التقويمي الصارم من التواريخ ورفض التواريخ المستحيلة أو المعكوسة برمز HTTP 400.
 * 3. حماية أمنية لمعالجة الأخطاء ومنع تسريب استثناءات SQL للعميل مع توثيق رمز تتبع داخلي Trace ID.
 * 4. الاعتماد الكامل على دفتر الأستاذ العام (General Ledger) كمصدر وحيد وأصيل.
 * 5. بنية استجابة موحدة: { success, data, meta, warnings, reconciliation }.
 */

const express = require('express');
const router = express.Router();
const reportingService = require('../services/reportingService');
const contractingService = require('../services/contractingAccountingService');
const { requirePermission, parseScopeArray } = require('../middleware/security');

/**
 * التحقق التقويمي الصارم من التاريخ بصيغة YYYY-MM-DD
 * يرفض التواريخ المستحيلة كـ 2026-99-99 أو 2026-02-31
 */
function validateDate(dateStr, fieldName = 'التاريخ') {
  if (dateStr === undefined || dateStr === null || dateStr === '') return null;
  if (typeof dateStr !== 'string') {
    const err = new Error(`قيمة ${fieldName} غير صالحة`);
    err.statusCode = 400;
    throw err;
  }
  const trimmed = dateStr.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) {
    const err = new Error(`صيغة ${fieldName} غير صالحة، يجب أن تكون YYYY-MM-DD`);
    err.statusCode = 400;
    throw err;
  }
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  if (month < 1 || month > 12) {
    const err = new Error(`الشهر في ${fieldName} غير صالح (${month})`);
    err.statusCode = 400;
    throw err;
  }
  if (year < 1900 || year > 2100) {
    const err = new Error(`السنة في ${fieldName} خارج النطاق المقبول (${year})`);
    err.statusCode = 400;
    throw err;
  }

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) {
    const err = new Error(`اليوم في ${fieldName} غير صالح لهذا الشهر (${day})`);
    err.statusCode = 400;
    throw err;
  }

  return trimmed;
}

/**
 * التحقق من نطاق التواريخ ومنع التاريخ المعكوس
 */
function parseAndValidateDates(query) {
  const from_date = validateDate(query.from_date, 'تاريخ البداية (from_date)');
  const to_date = validateDate(query.to_date, 'تاريخ النهاية (to_date)');
  if (from_date && to_date && from_date > to_date) {
    const err = new Error('تاريخ البداية يجب ألا يتجاوز تاريخ النهاية');
    err.statusCode = 400;
    throw err;
  }
  return { from_date, to_date };
}

/**
 * معالج الأخطاء الموحد والآمن لمنع تسريب تفاصيل SQL
 */
function handleReportError(err, res, contextName) {
  if (err.statusCode === 400 || err.message?.includes('غير صالح') || err.message?.includes('يجب ألا يتجاوز') || err.message?.includes('صيغة')) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_INPUT',
      message: err.message
    });
  }

  const traceId = 'ERR-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 6);
  console.error(`❌ [Reports API] [${traceId}] خطأ في ${contextName}:`, err);
  return res.status(500).json({
    success: false,
    code: 'REPORT_ERROR',
    message: `حدث خطأ داخلي أثناء إعداد ${contextName}. يرجى تزويد الدعم برمز التتبع`,
    trace_id: traceId
  });
}

/**
 * 1. لوحة التحكم المركزية والمؤشرات المالية الحية
 * GET /api/reports/dashboard
 */
router.get('/dashboard', requirePermission('dashboard:view,reports:view'), async (req, res) => {
  try {
    let allowedProjects = ['*'];
    if (req.user && req.user.role !== 'admin' && req.user.username !== 'admin') {
      allowedProjects = parseScopeArray(req.user.scope?.allowed_projects || req.user.allowed_projects);
    }

    const report = await reportingService.getDashboard({ allowedProjects });
    res.json(report);
  } catch (err) {
    handleReportError(err, res, 'لوحة التحكم المركزية');
  }
});

/**
 * 2. تقرير ميزان المراجعة بالأرصدة والمجاميع
 * GET /api/reports/trial-balance?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD
 */
router.get('/trial-balance', requirePermission('accounting:view,reports:view'), async (req, res) => {
  try {
    const { from_date, to_date } = parseAndValidateDates(req.query);
    const report = await reportingService.getTrialBalance({ from_date, to_date });
    res.json(report);
  } catch (err) {
    handleReportError(err, res, 'ميزان المراجعة');
  }
});

/**
 * 3. تقرير قائمة الدخل المعيارية
 * GET /api/reports/income-statement?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD
 */
router.get('/income-statement', requirePermission('accounting:view,reports:view'), async (req, res) => {
  try {
    const { from_date, to_date } = parseAndValidateDates(req.query);
    const cost_center_id = req.query.cost_center_id ? Number(req.query.cost_center_id) : null;
    if (req.query.cost_center_id && (!Number.isInteger(cost_center_id) || cost_center_id <= 0)) {
      return res.status(400).json({ success: false, code: 'INVALID_INPUT', message: 'مركز التكلفة المحدد غير صالح' });
    }
    const display_level = req.query.display_level || 'subsidiary';
    if (!['main', 'subsidiary', 'main_and_subsidiary'].includes(display_level)) {
      return res.status(400).json({ success: false, code: 'INVALID_INPUT', message: 'طريقة عرض الحسابات غير صالحة' });
    }
    const report = await reportingService.getIncomeStatement({
      from_date,
      to_date,
      cost_center_id,
      display_level
    });
    res.json(report);
  } catch (err) {
    handleReportError(err, res, 'قائمة الدخل المعيارية');
  }
});

/**
 * تقرير حركة حساب معين خلال فترة مع تصفية اختيارية بمركز التكلفة.
 * GET /api/reports/account-movement?account_id=...&from_date=...&to_date=...&cost_center_id=...
 */
router.get('/account-movement', requirePermission('accounting:view,reports:view'), async (req, res) => {
  try {
    const { from_date, to_date } = parseAndValidateDates(req.query);
    const account_id = Number(req.query.account_id);
    const cost_center_id = req.query.cost_center_id ? Number(req.query.cost_center_id) : null;
    if (!Number.isInteger(account_id) || account_id <= 0) {
      return res.status(400).json({ success: false, code: 'INVALID_INPUT', message: 'يرجى اختيار حساب صحيح' });
    }
    if (req.query.cost_center_id && (!Number.isInteger(cost_center_id) || cost_center_id <= 0)) {
      return res.status(400).json({ success: false, code: 'INVALID_INPUT', message: 'مركز التكلفة المحدد غير صالح' });
    }
    const report = await reportingService.getAccountMovement({
      account_id,
      from_date,
      to_date,
      cost_center_id
    });
    res.json(report);
  } catch (err) {
    handleReportError(err, res, 'تقرير حركة الحساب');
  }
});

/**
 * 4. تقرير الأرباح والخسائر المعياري
 * GET /api/reports/profit-loss?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD
 */
router.get('/profit-loss', requirePermission('reports:view,accounting:view'), async (req, res) => {
  try {
    const { from_date, to_date } = parseAndValidateDates(req.query);
    const report = await reportingService.getProfitLoss({ from_date, to_date });
    res.json(report);
  } catch (err) {
    handleReportError(err, res, 'تقرير الأرباح والخسائر');
  }
});

/**
 * 5. تقرير المركز المالي / الميزانية العمومية
 * GET /api/reports/balance-sheet?as_of_date=YYYY-MM-DD
 */
router.get('/balance-sheet', requirePermission('accounting:view,reports:view'), async (req, res) => {
  try {
    const rawDate = req.query.as_of_date || req.query.to_date;
    const as_of_date = validateDate(rawDate, 'تاريخ الميزانية (as_of_date)');
    const report = await reportingService.getBalanceSheet({ as_of_date });
    res.json(report);
  } catch (err) {
    handleReportError(err, res, 'الميزانية العمومية والمركز المالي');
  }
});

/**
 * 6. تقرير التدفقات النقدية المحاسبي
 * GET /api/reports/cash-flow?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD
 */
router.get('/cash-flow', requirePermission('accounting:view,reports:view,cash:view'), async (req, res) => {
  try {
    const { from_date, to_date } = parseAndValidateDates(req.query);
    const report = await reportingService.getCashFlow({ from_date, to_date });
    res.json(report);
  } catch (err) {
    handleReportError(err, res, 'تقرير التدفقات النقدية');
  }
});

/**
 * 7. تقرير ربحية المشاريع المحاسبية المعترف بها
 * GET /api/reports/projects-profitability?from_date=...&to_date=...&project_id=...
 */
router.get('/projects-profitability', requirePermission('projects:view,reports:view'), async (req, res) => {
  try {
    const { from_date, to_date } = parseAndValidateDates(req.query);
    const project_id = req.query.project_id ? Number(req.query.project_id) : null;

    let allowedProjects = ['*'];
    if (req.user && req.user.role !== 'admin' && req.user.username !== 'admin') {
      allowedProjects = parseScopeArray(req.user.scope?.allowed_projects || req.user.allowed_projects);
    }

    const report = await reportingService.getProjectsProfitability({
      from_date,
      to_date,
      project_id,
      allowedProjects
    });
    res.json(report);
  } catch (err) {
    handleReportError(err, res, 'تقرير ربحية المشاريع');
  }
});

/**
 * 8. تقرير ربحية مراكز التكلفة المحاسبية
 * GET /api/reports/cost-centers-profitability?from_date=...&to_date=...&cost_center_id=...
 */
router.get('/cost-centers-profitability', requirePermission('accounting:view,reports:view'), async (req, res) => {
  try {
    const { from_date, to_date } = parseAndValidateDates(req.query);
    const cost_center_id = req.query.cost_center_id ? Number(req.query.cost_center_id) : null;

    const report = await reportingService.getCostCentersProfitability({
      from_date,
      to_date,
      cost_center_id
    });
    res.json(report);
  } catch (err) {
    handleReportError(err, res, 'تقرير ربحية مراكز التكلفة');
  }
});

/**
 * 9. كشف حساب عميل مفصل ومطابق للأستاذ العام
 * GET /api/reports/client-statement/:id?from_date=...&to_date=...
 */
router.get('/client-statement/:id', requirePermission('clients:view,reports:view,accounting:view'), async (req, res) => {
  try {
    const clientId = Number(req.params.id);
    if (!clientId) {
      return res.status(400).json({ success: false, code: 'INVALID_INPUT', message: 'معرف العميل غير صالح' });
    }

    const { from_date, to_date } = parseAndValidateDates(req.query);
    const report = await reportingService.getClientStatement(clientId, { from_date, to_date });
    res.json(report);
  } catch (err) {
    handleReportError(err, res, 'كشف حساب العميل');
  }
});

/**
 * 10. ملف العميل الشامل (العقود، المشاريع، المستخلصات، وسلسلة المراحل التساعية)
 * GET /api/reports/client-profile/:id
 */
router.get('/client-profile/:id', requirePermission('clients:view,reports:view,accounting:view'), async (req, res) => {
  try {
    const clientId = Number(req.params.id);
    if (!clientId) {
      return res.status(400).json({ success: false, code: 'INVALID_INPUT', message: 'معرف العميل غير صالح' });
    }

    const statementReport = await reportingService.getClientStatement(clientId, {});
    res.json(statementReport);
  } catch (err) {
    handleReportError(err, res, 'ملف العميل الشامل');
  }
});

/**
 * 11. كشف حساب مورد مفصل ومطابق للأستاذ العام
 * GET /api/reports/supplier-statement/:id?from_date=...&to_date=...
 */
router.get('/supplier-statement/:id', requirePermission('suppliers:view,reports:view,accounting:view'), async (req, res) => {
  try {
    const supplierId = Number(req.params.id);
    if (!supplierId) {
      return res.status(400).json({ success: false, code: 'INVALID_INPUT', message: 'معرف المورد غير صالح' });
    }

    const { from_date, to_date } = parseAndValidateDates(req.query);
    const report = await reportingService.getSupplierStatement(supplierId, { from_date, to_date });
    res.json(report);
  } catch (err) {
    handleReportError(err, res, 'كشف حساب المورد');
  }
});

/**
 * 12. مصفوفة الفصل المالي لقطاع المقاولات IFRS 15
 * GET /api/reports/contracting-financial-separation
 */
router.get('/contracting-financial-separation', requirePermission('reports:view,accounting:view,projects:view'), async (req, res) => {
  try {
    let allowedProjects = ['*'];
    if (req.user && req.user.role !== 'admin' && req.user.username !== 'admin') {
      allowedProjects = parseScopeArray(req.user.scope?.allowed_projects || req.user.allowed_projects);
    }

    const matrix = await contractingService.getCompanyWideSeparationMatrix({
      allowedProjectIds: allowedProjects
    });

    const isMatrixBalanced = matrix?.totals ? matrix.totals.cost_plus_profit === matrix.totals.recognized_revenue : true;

    res.json({
      success: true,
      data: matrix,
      meta: {
        report_name: 'مصفوفة الفصل المالي لقطاع المقاولات IFRS 15',
        currency: 'ر.ي',
        generated_at: new Date().toISOString()
      },
      warnings: [],
      reconciliation: { is_balanced: isMatrixBalanced }
    });
  } catch (err) {
    handleReportError(err, res, 'مصفوفة المقاولات');
  }
});

/**
 * 13. الفحص الشامل لسلامة البيانات والأستاذ العام والتسويات (Financial Integrity Check)
 * مخصص للمحاسب والمدير المالي لتدقيق الاتزان وسلامة القيود
 * GET /api/reports/integrity-check
 */
router.get('/integrity-check', requirePermission('reports:view,accounting:view'), async (req, res) => {
  try {
    const report = await reportingService.getIntegrityCheck();
    res.json(report);
  } catch (err) {
    handleReportError(err, res, 'فحص السلامة المحاسبية');
  }
});

module.exports = router;
