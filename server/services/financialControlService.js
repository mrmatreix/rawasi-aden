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

const DOCUMENT_STATUSES = {
  DRAFT: 'draft',               // مسودة (قابلة للتعديل والحذف دون أثر مالي)
  UNDER_REVIEW: 'under_review', // قيد المراجعة والتدقيق
  APPROVED: 'approved',         // معتمد (محمي من الحذف والتعديل المباشر)
  POSTED: 'posted',             // مرحل لدفتر الأستاذ والصندوق (أثر مالي كامل ومحمي)
  CLOSED: 'closed',             // مقفل (ضمن فترة مالية مغلقة)
  REVERSED: 'reversed',         // معكوس بقيد عكسي رسمي
  CANCELLED: 'cancelled'        // مسودة ملغاة
};

// =========================================================================
// قواعد العكس الموحدة (Storno):
// 1. لا يُعكس إلا قيد مرحّل فعلاً في دفتر الأستاذ؛ المستند بلا قيد مرحّل لا يُعكس محاسبياً.
// 2. القيد العكسي مرآة حرفية لسطور القيد الأصلي (الحساب، مركز التكلفة، المشروع، المبلغ).
// 3. القيد الأصلي يبقى "مرحّلاً" ويُعلَّم بـ reversal_ref_id؛ فيتقابل الأصل والعكس ويصبح الأثر صفراً
//    في كل التقارير، ولا تتغير أرقام الفترة الأصلية بأثر رجعي.
// =========================================================================
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
      throw Object.assign(new Error(check.message), { statusCode: 400 });
    }
    return true;
  },

  // العكس انتقل إلى ReversalService (المرحلة 4.3)؛ هذه الأسماء باقية للمسارات والاختبارات القائمة
  reverseExpense(...args) { return require('./ledger/reversalService').reverseExpense(...args); },
  reversePayment(...args) { return require('./ledger/reversalService').reversePayment(...args); },
  reverseJournalEntry(...args) { return require('./ledger/reversalService').reverseJournalEntry(...args); },
  reverseBill(...args) { return require('./ledger/reversalService').reverseBill(...args); },
  reversePurchase(...args) { return require('./ledger/reversalService').reversePurchase(...args); }
};

module.exports = FinancialControlService;
