/**
 * taxAndGuaranteeService.js
 * 
 * محرك الضرائب والخصم من المنبع والضمانات البنكية للمقاولات (Tax Engine & Bank Guarantees Suite)
 * مبني وفق:
 *  1. قانون ضرائب الدخل اليمني رقم 17 لسنة 2010 وتعديلاته (الخصم والإضافة تحت حساب الضريبة)
 *  2. استقطاعات المستخلصات المعتمدة (WHT & Retentions & Advance Amortization)
 *  3. الفاتورة الضريبية والرقم الضريبي للشركات والموردين والعملاء
 *  4. تقرير الإقرارات الضريبية الدورية لمصلحة الضرائب
 *  5. إدارة خطابات الضمان البنكية (L/G) وتتبع الغطاء النقدي (Cash Margin Collateral) والقيود المحاسبية
 */

const { query, get, run, transaction } = require('../database/db');
const PostingService = require('./ledger/postingService');
const SystemAccounts = require('./systemAccountService');
const { projectCostCenter } = require('./ledger/costCenters');
const Numbering = require('./numberingService');
const { logAudit } = require('./auditService');
const { assertPeriodOpen, resolveValidUserId } = require('./financialControlService');

// أرقام الحسابات الثابتة أزيلت: كل القيود تستخدم أدوار حسابات النظام (المرحلة 4.6)
const TAX_GL_ACCOUNTS = Object.freeze({});

const LEGAL_DISCLAIMER = 'تنبيه مهني وقانوني: النسب والآليات المالية المضمنة في هذا النظام هي للاسترشاد ومبنية على التطبيق العملي الشائع لقانون ضرائب الدخل اليمني رقم 17 لسنة 2010 وتعديلاته، ويجب مراجعة وتحديث النسب دورياً بالتنسيق مع المحاسب القانوني المعتمد للشركة ومصلحة الضرائب.';

const TaxAndGuaranteeService = {
  TAX_GL_ACCOUNTS,
  LEGAL_DISCLAIMER,

  /**
   * جلب وتحديث نسب الضرائب والإعدادات
   */
  async getTaxConfigs() {
    const configs = await query('SELECT * FROM tax_configs WHERE is_active = 1');
    return {
      legal_disclaimer: LEGAL_DISCLAIMER,
      configs
    };
  },

  /**
   * احتساب ومعالجة ضرائب الخصم من المنبع في مستخلصات المقاولات (IPC Tax Handling)
   * يولد القيد المحاسبي المتزن شاملاً كافة الاستقطاعات التعاقدية والضريبية
   */
  async processBillTaxDeduction(billId, taxRate = 3.0, user = null, req = null) {
    // سياسة الإيراد عند اعتماد المستخلص: الضريبة قيد صغير مستقل (مدين ضريبة مخصومة / دائن ذمة العميل)
    // ولا تُنشئ قيد مستخلص ثانياً ولا إيراداً مكرراً ولا محتجزاً مفترضاً.
    const result = await require('./billing/billingService').applyWithholdingTax(billId, taxRate, user);
    if (req) {
      await logAudit(req, { action: 'PROCESS_BILL_TAX', entity_type: 'bill_tax', entity_id: result.bill_no, details: { billId, ...result } });
    }
    return result;
  },

  /**
   * تقرير الإقرارات الضريبية الدورية لمصلحة الضرائب
   */
  async getTaxDeclarationReport(taxPeriod) {
    const periodFilter = taxPeriod || new Date().toISOString().substring(0, 7);

    // 1. الضرائب المخصومة على الشركة من قبل العملاء (أرصدة ضريبية مدينة قابلة للتسوية)
    const clientWithholdings = await query(`
      SELECT tw.*, p.name as project_name, c.name as client_name, c.tax_number as client_tax_number
      FROM tax_withholdings tw
      LEFT JOIN projects p ON tw.project_id = p.id
      LEFT JOIN clients c ON tw.client_id = c.id
      WHERE tw.type = 'deducted_from_client' AND tw.tax_period = ?
      ORDER BY tw.date ASC
    `, [periodFilter]);

    // 2. الضرائب المخصومة من الشركة على الموردين والمقاولين الباطن (التزامات واجبة التوريد للمصلحة)
    const supplierWithholdings = await query(`
      SELECT tw.*, s.name as supplier_name, s.tax_number as supplier_tax_number
      FROM tax_withholdings tw
      LEFT JOIN suppliers s ON tw.supplier_id = s.id
      WHERE tw.type = 'withheld_from_supplier' AND tw.tax_period = ?
      ORDER BY tw.date ASC
    `, [periodFilter]);

    const totalClientWht = clientWithholdings.reduce((sum, r) => sum + Number(r.tax_amount || 0), 0);
    const totalSupplierWht = supplierWithholdings.reduce((sum, r) => sum + Number(r.tax_amount || 0), 0);

    return {
      tax_period: periodFilter,
      legal_disclaimer: LEGAL_DISCLAIMER,
      summary: {
        total_wht_deducted_by_clients: totalClientWht, // ضريبة مقاولات مسددة مقدماً
        total_wht_withheld_from_suppliers: totalSupplierWht, // ضريبة توريدات واجبة السداد
        net_tax_position: totalSupplierWht - totalClientWht
      },
      client_withholdings: clientWithholdings,
      supplier_withholdings: supplierWithholdings
    };
  },

  /**
   * إصدار وإدارة خطاب ضمان بنكي للمشروع (Bank Guarantee - L/G)
   * يولد القيد المحاسبي المتزن للغطاء النقدي والعمولات المصرفية
   */
  async issueBankGuarantee(data, req = null) {
    const {
      guarantee_no,
      type = 'performance_bond', // 'bid_bond', 'performance_bond', 'advance_payment', 'maintenance_bond'
      project_id,
      client_id,
      issuing_bank,
      bank_account_id = 1,
      amount,
      currency = 'ر.ي',
      cash_margin_pct = 10, // نسبة الغطاء النقدي المحتجز لدى البنك (افتراضياً 10%)
      commission_fee = 0,
      issue_date = new Date().toISOString().split('T')[0],
      expiry_date,
      notes,
      user
    } = data;

    if (!guarantee_no || !project_id || !issuing_bank || !amount || Number(amount) <= 0) {
      throw new Error('يرجى تحديد رقم الضمان، المشروع، البنك المصدر، ومبلغ الضمان');
    }

    await assertPeriodOpen(issue_date);
    const userId = await resolveValidUserId(user?.id);
    const totalGuaranteeAmount = Number(amount);
    const marginPct = Number(cash_margin_pct) || 10;
    const cashMarginAmount = (totalGuaranteeAmount * marginPct) / 100;
    const parsedCommission = Number(commission_fee) || 0;
    const totalBankDeduction = cashMarginAmount + parsedCommission;

    return await transaction(async (tx) => {
      // 1. توليد قيد اليومية للغطاء النقدي والعمولات:
      // من مذكورين:
      //  حـ/ غطاء خطابات ضمان (أصل متداول مقيد 1115) بمبلغ الغطاء
      //  حـ/ رسوم وعمولات خطابات الضمان (مصروف 5205) بمبلغ العمولة
      // إلى حـ/ البنك الجاري (3) بإجمالي المسحوب
      // مدين غطاء خطابات الضمان (نقد مقيد) + عمولة الإصدار / دائن حساب البنك في الدليل
      const bankRow = bank_account_id ? await tx.get('SELECT account_id FROM bank_accounts WHERE id = ?', [bank_account_id]) : null;
      const bankGl = bankRow?.account_id || (await SystemAccounts.resolve('BANK_DEFAULT', tx)).id;
      const lgCenter = await projectCostCenter(tx, project_id);
      const lines = [{ role: 'GUARANTEE_CASH_MARGIN', debit: cashMarginAmount, projectId: project_id, notes: `مدين: غطاء نقدي بنسبة ${marginPct}% لخطاب الضمان ${guarantee_no}` }];
      if (parsedCommission > 0) lines.push({ role: 'GUARANTEE_COMMISSION_EXPENSE', debit: parsedCommission, projectId: project_id, costCenterId: lgCenter, notes: `مدين: عمولة ومصاريف إصدار خطاب الضمان ${guarantee_no}` });
      lines.push({ accountId: bankGl, credit: totalBankDeduction, notes: `دائن: خصم الغطاء والعمولة لخطاب الضمان ${guarantee_no}` });
      const posted = await PostingService.post(tx, {
        date: issue_date, series: 'JV-LG', user, source: { type: 'خطاب ضمان بنكي', no: guarantee_no },
        description: `إثبات غطاء خطاب ضمان بنكي (${guarantee_no}) لدى ${issuing_bank}`, lines
      });
      const entry_no = posted.entry_no;
      const entryId = posted.id;

      // 2. تحديث رصيد الحساب البنكي
      await tx.run('UPDATE bank_accounts SET current_balance = current_balance - ? WHERE id = ?', [totalBankDeduction, bank_account_id]);

      // 3. تسجيل خطاب الضمان
      const lgRes = await tx.run(`
        INSERT INTO bank_guarantees (
          guarantee_no, type, project_id, client_id, issuing_bank, bank_account_id,
          amount, currency, cash_margin_pct, cash_margin_amount, commission_fee,
          issue_date, expiry_date, status, journal_entry_id, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
      `, [
        guarantee_no, type, project_id, client_id || null, issuing_bank, bank_account_id,
        totalGuaranteeAmount, currency, marginPct, cashMarginAmount, parsedCommission,
        issue_date, expiry_date || issue_date, entryId, notes || ''
      ]);

      if (req) {
        await logAudit(req, {
          action: 'ISSUE_BANK_GUARANTEE',
          entity_type: 'bank_guarantee',
          entity_id: guarantee_no,
          details: { guarantee_no, type, amount: totalGuaranteeAmount, cashMarginAmount, entry_no }
        });
      }

      return {
        id: lgRes.lastInsertRowid || lgRes.insertId,
        guarantee_no,
        type,
        amount: totalGuaranteeAmount,
        cash_margin_amount: cashMarginAmount,
        commission_fee: parsedCommission,
        journal_entry_no: entry_no,
        status: 'active'
      };
    });
  },

  /**
   * الإفراج عن خطاب الضمان واسترداد الغطاء النقدي (Release Bank Guarantee)
   */
  async releaseBankGuarantee(guaranteeId, releaseData = {}, req = null) {
    const { release_date = new Date().toISOString().split('T')[0], user } = releaseData;

    const lg = await get('SELECT * FROM bank_guarantees WHERE id = ?', [guaranteeId]);
    if (!lg) throw new Error('خطاب الضمان غير موجود');
    if (lg.status === 'released') throw new Error('تم الإفراج عن هذا الضمان مسبقاً');

    await assertPeriodOpen(release_date);
    const userId = user ? await resolveValidUserId(user?.id) : null;
    const marginToRefund = Number(lg.cash_margin_amount) || 0;

    return await transaction(async (tx) => {
      // 1. توليد قيد استرداد الغطاء النقدي:
      // من حـ/ البنك الجاري (3) إلى حـ/ غطاء خطابات الضمان (1115)
      // مدين حساب البنك / دائن غطاء خطابات الضمان
      const bankRow = lg.bank_account_id ? await tx.get('SELECT account_id FROM bank_accounts WHERE id = ?', [lg.bank_account_id]) : null;
      const bankGl = bankRow?.account_id || (await SystemAccounts.resolve('BANK_DEFAULT', tx)).id;
      const posted = await PostingService.post(tx, {
        date: release_date, series: 'JV-REL', user, source: { type: 'استرداد غطاء ضمان', id: Number(guaranteeId), no: lg.guarantee_no },
        description: `استرداد الغطاء النقدي لخطاب الضمان المفرج عنه (${lg.guarantee_no})`,
        lines: [
          { accountId: bankGl, debit: marginToRefund, notes: `مدين: استرداد غطاء خطاب الضمان ${lg.guarantee_no}` },
          { role: 'GUARANTEE_CASH_MARGIN', credit: marginToRefund, projectId: lg.project_id, notes: `دائن: إقفال الغطاء المسترد لخطاب الضمان ${lg.guarantee_no}` }
        ]
      });
      const entry_no = posted.entry_no;
      const entryId = posted.id;

      // 2. إعادة الغطاء لرصيد الحساب البنكي
      if (lg.bank_account_id) {
        await tx.run('UPDATE bank_accounts SET current_balance = current_balance + ? WHERE id = ?', [marginToRefund, lg.bank_account_id]);
      }

      // 3. تحديث حالة خطاب الضمان
      await tx.run(`
        UPDATE bank_guarantees
        SET status = 'released', release_date = ?, release_journal_entry_id = ?
        WHERE id = ?
      `, [release_date, entryId, guaranteeId]);

      if (req) {
        await logAudit(req, {
          action: 'RELEASE_BANK_GUARANTEE',
          entity_type: 'bank_guarantee',
          entity_id: lg.guarantee_no,
          details: { guaranteeId, guarantee_no: lg.guarantee_no, marginToRefund, entry_no }
        });
      }

      return {
        id: guaranteeId,
        guarantee_no: lg.guarantee_no,
        refunded_margin: marginToRefund,
        journal_entry_no: entry_no,
        status: 'released',
        message: 'تم الإفراج عن خطاب الضمان واسترداد الغطاء النقدي وترحيل القيد بنجاح'
      };
    });
  }
};

module.exports = TaxAndGuaranteeService;
