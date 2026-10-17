const fs = require('fs');
const path = require('path');

const settingsJsPath = path.join(__dirname, '..', 'js', 'settings.js');
let content = fs.readFileSync(settingsJsPath, 'utf8');

// Find start and end of print settings block
const startMarker = '  // ================== تخصيص ورقة الطباعة والتقارير ==================';
const endMarker = '  // ================== إدارة المستخدمين والصلاحيات ==================';

const startIndex = content.indexOf(startMarker);
const endIndex = content.indexOf(endMarker);

if (startIndex === -1 || endIndex === -1) {
  console.error('Markers not found!');
  process.exit(1);
}

const replacement = `  // ================== تخصيص ورقة الطباعة والتقارير ==================
  getPrintConfig() {
    if (this._printConfig) return this._printConfig;
    const defaults = {
      header_title: 'شركة رواسي عدن للهندسة والمقاولات',
      header_subtitle: 'عدن - الجمهورية اليمنية | هاتف: 773413937',
      header_en: 'Rawasi Aden for Engineering & Contracting',
      tax_no: 'س.ت: 102948 - ر.ض: 3004918',
      slogan: 'نبني الحاضر لنستثمر المستقبل',
      header_style: 'dynamic',
      table_density: 'medium',
      page_margins: 'normal',
      orientation: 'portrait',
      sig_position: 'end',
      logo_size: 'medium',
      font_family: 'Cairo',
      font_size_scale: 'normal',
      show_logo: '1',
      show_stamp: '0',
      show_page_numbers: '1',
      show_print_time: '1',
      sig1: 'المستلم / المحاسب',
      sig2: 'المدير العام',
      sig3: 'اعتماد الإدارة',
      border_style: 'classic',
      accent_color: '#d4af37',
      footer_notes: 'تعتبر هذه السندات والوثائق رسمية ولا يعتمد أي كشط أو تعديل بدون ختم الإدارة',

      // 1. السندات والقيود
      receipt_title: 'سـنـد قـبـض رسـمـي',
      expense_title: 'سـنـد صـرف رسـمـي',
      custody_title: 'سـنـد عـهـدة وتـصـفـيـة مـالـيـة',
      journal_title: 'سـنـد قـيـد يـومـيـة مـحـاسـبـي',
      cash_movement_title: 'كشف حركة الصندوق والسيولة النقدية',
      voucher_layout: 'single_a4',
      voucher_show_tafqeet: '1',
      voucher_show_project: '1',
      voucher_show_payment_method: '1',
      voucher_show_cheque_ref: '1',
      voucher_show_cost_center: '1',
      voucher_show_account: '1',

      // 2. المشاريع والعقود
      proj_report_title: 'تقرير الحساب المالي للمشروع',
      contract_title: 'عقد مقاولة وإنشاءات هندسية رسمي',
      ipc_title: 'شهادة دفع وإنجاز مستخلص جاري (IPC)',
      quotation_title: 'عرض سعر ومواصفات هندسية رسمية',
      change_order_title: 'استمارة أمر تغيير هندسي ومادي',
      daily_report_title: 'التقرير الميداني اليومي لأعمال الموقع',
      handover_title: 'محضر استلام ومخالصة ختامية للمشروع',
      proj_show_kpi_cards: '1',
      proj_show_expenses_table: '1',
      proj_show_supplier_bills: '1',
      proj_show_client_payments: '1',
      proj_show_tasks: '1',
      proj_show_boq_items: '1',
      proj_show_retentions: '1',

      // 3. كشوفات الحسابات والرواتب
      client_stmt_title: 'كشف حساب عميل معتمد ومطابق للأستاذ',
      supplier_stmt_title: 'كشف حساب مورد معتمد ومطابق للأستاذ',
      payroll_title: 'كشف الراتب والأجور الشامل المعتمد',
      pay_slip_title: 'قسيمة استحقاق وصرف راتب موظف',
      stmt_show_summary_card: '1',
      stmt_show_running_balance: '1',
      stmt_show_reference: '1',
      stmt_show_notes: '1',
      stmt_show_match_sig: '1',
      payroll_show_allowances: '1',
      payroll_show_deductions: '1',
      payroll_show_emp_signature: '1',

      // 4. القوائم المالية والمخزون
      pl_title: 'قائمة الأرباح والخسائر الرسمية',
      income_stmt_title: 'قائمة الدخل المعيارية وإثبات الإنجاز POC',
      balance_sheet_title: 'الميزانية العمومية وقائمة المركز المالي',
      cash_flow_title: 'قائمة التدفقات النقدية الفعلية',
      trial_balance_title: 'ميزان المراجعة بالأرصدة والمجاميع',
      profitability_title: 'تقرير ربحية وأداء المشاريع ومراكز التكلفة',
      inventory_title: 'تقرير جرد وتقييم المخزون والمستودعات',
      fin_show_kpi_cards: '1',
      fin_show_expense_breakdown: '1',
      fin_show_dual_balance: '1',
      fin_show_reconcile_badge: '1'
    };

    try {
      const cached = localStorage.getItem('rawasi_print_config');
      if (cached) {
        this._printConfig = Object.assign({}, defaults, JSON.parse(cached));
        return this._printConfig;
      }
    } catch (e) {}

    this._printConfig = defaults;
    return defaults;
  },

  async loadPrintSettings() {
    try {
      const res = await fetch('/api/settings');
      const json = await res.json();
      if (json.success && json.data) {
        const s = json.data;
        const cfg = {
          header_title: s.print_header_title || s.company_name || 'شركة رواسي عدن للهندسة والمقاولات',
          header_subtitle: s.print_header_subtitle || (s.address ? \`\${s.address} | هاتف: \${s.phone1 || '773413937'}\` : 'عدن - الجمهورية اليمنية | هاتف: 773413937'),
          header_en: s.print_header_en || 'Rawasi Aden for Engineering & Contracting',
          tax_no: s.print_tax_no || 'س.ت: 102948 - ر.ض: 3004918',
          slogan: s.print_slogan || s.slogan || 'نبني الحاضر لنستثمر المستقبل',
          header_style: s.print_header_style || 'dynamic',
          table_density: s.print_table_density || 'medium',
          page_margins: s.print_page_margins || 'normal',
          orientation: s.print_orientation || 'portrait',
          sig_position: s.print_sig_position || 'end',
          logo_size: s.print_logo_size || 'medium',
          font_family: s.print_font_family || 'Cairo',
          font_size_scale: s.print_font_size_scale || 'normal',
          show_logo: s.print_show_logo !== undefined ? String(s.print_show_logo) : '1',
          show_stamp: s.print_show_stamp !== undefined ? String(s.print_show_stamp) : '0',
          show_page_numbers: s.print_show_page_numbers !== undefined ? String(s.print_show_page_numbers) : '1',
          show_print_time: s.print_show_print_time !== undefined ? String(s.print_show_print_time) : '1',
          sig1: s.print_sig1 || 'المستلم / المحاسب',
          sig2: s.print_sig2 || 'المدير العام',
          sig3: s.print_sig3 || 'اعتماد الإدارة',
          border_style: s.print_border_style || 'classic',
          accent_color: s.print_accent_color || '#d4af37',
          footer_notes: s.print_footer_notes || 'تعتبر هذه السندات والوثائق رسمية ولا يعتمد أي كشط أو تعديل بدون ختم الإدارة',

          // 1. السندات والقيود
          receipt_title: s.print_receipt_title || 'سـنـد قـبـض رسـمـي',
          expense_title: s.print_expense_title || 'سـنـد صـرف رسـمـي',
          custody_title: s.print_custody_title || 'سـنـد عـهـدة وتـصـفـيـة مـالـيـة',
          journal_title: s.print_journal_title || 'سـنـد قـيـد يـومـيـة مـحـاسـبـي',
          cash_movement_title: s.print_cash_movement_title || 'كشف حركة الصندوق والسيولة النقدية',
          voucher_layout: s.print_voucher_layout || 'single_a4',
          voucher_show_tafqeet: s.print_voucher_show_tafqeet !== undefined ? String(s.print_voucher_show_tafqeet) : '1',
          voucher_show_project: s.print_voucher_show_project !== undefined ? String(s.print_voucher_show_project) : '1',
          voucher_show_payment_method: s.print_voucher_show_payment_method !== undefined ? String(s.print_voucher_show_payment_method) : '1',
          voucher_show_cheque_ref: s.print_voucher_show_cheque_ref !== undefined ? String(s.print_voucher_show_cheque_ref) : '1',
          voucher_show_cost_center: s.print_voucher_show_cost_center !== undefined ? String(s.print_voucher_show_cost_center) : '1',
          voucher_show_account: s.print_voucher_show_account !== undefined ? String(s.print_voucher_show_account) : '1',

          // 2. المشاريع والعقود
          proj_report_title: s.print_proj_report_title || 'تقرير الحساب المالي للمشروع',
          contract_title: s.print_contract_title || 'عقد مقاولة وإنشاءات هندسية رسمي',
          ipc_title: s.print_ipc_title || 'شهادة دفع وإنجاز مستخلص جاري (IPC)',
          quotation_title: s.print_quotation_title || 'عرض سعر ومواصفات هندسية رسمية',
          change_order_title: s.print_change_order_title || 'استمارة أمر تغيير هندسي ومادي',
          daily_report_title: s.print_daily_report_title || 'التقرير الميداني اليومي لأعمال الموقع',
          handover_title: s.print_handover_title || 'محضر استلام ومخالصة ختامية للمشروع',
          proj_show_kpi_cards: s.print_proj_show_kpi_cards !== undefined ? String(s.print_proj_show_kpi_cards) : '1',
          proj_show_expenses_table: s.print_proj_show_expenses_table !== undefined ? String(s.print_proj_show_expenses_table) : '1',
          proj_show_supplier_bills: s.print_proj_show_supplier_bills !== undefined ? String(s.print_proj_show_supplier_bills) : '1',
          proj_show_client_payments: s.print_proj_show_client_payments !== undefined ? String(s.print_proj_show_client_payments) : '1',
          proj_show_tasks: s.print_proj_show_tasks !== undefined ? String(s.print_proj_show_tasks) : '1',
          proj_show_boq_items: s.print_proj_show_boq_items !== undefined ? String(s.print_proj_show_boq_items) : '1',
          proj_show_retentions: s.print_proj_show_retentions !== undefined ? String(s.print_proj_show_retentions) : '1',

          // 3. كشوفات الحسابات والرواتب
          client_stmt_title: s.print_client_stmt_title || 'كشف حساب عميل معتمد ومطابق للأستاذ',
          supplier_stmt_title: s.print_supplier_stmt_title || 'كشف حساب مورد معتمد ومطابق للأستاذ',
          payroll_title: s.print_payroll_title || 'كشف الراتب والأجور الشامل المعتمد',
          pay_slip_title: s.print_pay_slip_title || 'قسيمة استحقاق وصرف راتب موظف',
          stmt_show_summary_card: s.print_stmt_show_summary_card !== undefined ? String(s.print_stmt_show_summary_card) : '1',
          stmt_show_running_balance: s.print_stmt_show_running_balance !== undefined ? String(s.print_stmt_show_running_balance) : '1',
          stmt_show_reference: s.print_stmt_show_reference !== undefined ? String(s.print_stmt_show_reference) : '1',
          stmt_show_notes: s.print_stmt_show_notes !== undefined ? String(s.print_stmt_show_notes) : '1',
          stmt_show_match_sig: s.print_stmt_show_match_sig !== undefined ? String(s.print_stmt_show_match_sig) : '1',
          payroll_show_allowances: s.print_payroll_show_allowances !== undefined ? String(s.print_payroll_show_allowances) : '1',
          payroll_show_deductions: s.print_payroll_show_deductions !== undefined ? String(s.print_payroll_show_deductions) : '1',
          payroll_show_emp_signature: s.print_payroll_show_emp_signature !== undefined ? String(s.print_payroll_show_emp_signature) : '1',

          // 4. القوائم المالية والمخزون
          pl_title: s.print_pl_title || 'قائمة الأرباح والخسائر الرسمية',
          income_stmt_title: s.print_income_stmt_title || 'قائمة الدخل المعيارية وإثبات الإنجاز POC',
          balance_sheet_title: s.print_balance_sheet_title || 'الميزانية العمومية وقائمة المركز المالي',
          cash_flow_title: s.print_cash_flow_title || 'قائمة التدفقات النقدية الفعلية',
          trial_balance_title: s.print_trial_balance_title || 'ميزان المراجعة بالأرصدة والمجاميع',
          profitability_title: s.print_profitability_title || 'تقرير ربحية وأداء المشاريع ومراكز التكلفة',
          inventory_title: s.print_inventory_title || 'تقرير جرد وتقييم المخزون والمستودعات',
          fin_show_kpi_cards: s.print_fin_show_kpi_cards !== undefined ? String(s.print_fin_show_kpi_cards) : '1',
          fin_show_expense_breakdown: s.print_fin_show_expense_breakdown !== undefined ? String(s.print_fin_show_expense_breakdown) : '1',
          fin_show_dual_balance: s.print_fin_show_dual_balance !== undefined ? String(s.print_fin_show_dual_balance) : '1',
          fin_show_reconcile_badge: s.print_fin_show_reconcile_badge !== undefined ? String(s.print_fin_show_reconcile_badge) : '1'
        };

        this._printConfig = cfg;
        localStorage.setItem('rawasi_print_config', JSON.stringify(cfg));

        const setInput = (id, val) => {
          const el = document.getElementById(id);
          if (el && val !== undefined && val !== null) el.value = val;
        };
        const setCheck = (id, val) => {
          const el = document.getElementById(id);
          if (el) el.checked = (val === '1' || val === true || val === 1);
        };

        // عام وترويسة
        setInput('printHeaderTitle', cfg.header_title);
        setInput('printHeaderEn', cfg.header_en);
        setInput('printHeaderSubtitle', cfg.header_subtitle);
        setInput('printTaxNo', cfg.tax_no);
        setInput('printSlogan', cfg.slogan);
        setInput('printHeaderStyle', cfg.header_style);
        setInput('printTableDensity', cfg.table_density);
        setInput('printPageMargins', cfg.page_margins);
        setInput('printOrientation', cfg.orientation);
        setInput('printSigPosition', cfg.sig_position);
        setInput('printLogoSize', cfg.logo_size);
        setInput('printFontFamily', cfg.font_family);
        setInput('printFontSizeScale', cfg.font_size_scale);
        setCheck('printShowLogo', cfg.show_logo);
        setCheck('printShowStamp', cfg.show_stamp);
        setCheck('printShowPageNumbers', cfg.show_page_numbers);
        setCheck('printShowPrintTime', cfg.show_print_time);
        setInput('printSig1', cfg.sig1);
        setInput('printSig2', cfg.sig2);
        setInput('printSig3', cfg.sig3);
        setInput('printBorderStyle', cfg.border_style);
        setInput('printAccentColor', cfg.accent_color);
        setInput('printFooterNotes', cfg.footer_notes);

        // 1. السندات والقيود
        setInput('printReceiptTitle', cfg.receipt_title);
        setInput('printExpenseTitle', cfg.expense_title);
        setInput('printCustodyTitle', cfg.custody_title);
        setInput('printJournalTitle', cfg.journal_title);
        setInput('printCashMovementTitle', cfg.cash_movement_title);
        setInput('printVoucherLayout', cfg.voucher_layout);
        setCheck('printVoucherShowTafqeet', cfg.voucher_show_tafqeet);
        setCheck('printVoucherShowProject', cfg.voucher_show_project);
        setCheck('printVoucherShowPaymentMethod', cfg.voucher_show_payment_method);
        setCheck('printVoucherShowChequeRef', cfg.voucher_show_cheque_ref);
        setCheck('printVoucherShowCostCenter', cfg.voucher_show_cost_center);
        setCheck('printVoucherShowAccount', cfg.voucher_show_account);

        // 2. المشاريع والعقود
        setInput('printProjReportTitle', cfg.proj_report_title);
        setInput('printContractTitle', cfg.contract_title);
        setInput('printIpcTitle', cfg.ipc_title);
        setInput('printQuotationTitle', cfg.quotation_title);
        setInput('printChangeOrderTitle', cfg.change_order_title);
        setInput('printDailyReportTitle', cfg.daily_report_title);
        setInput('printHandoverTitle', cfg.handover_title);
        setCheck('printProjShowKpiCards', cfg.proj_show_kpi_cards);
        setCheck('printProjShowExpensesTable', cfg.proj_show_expenses_table);
        setCheck('printProjShowSupplierBills', cfg.proj_show_supplier_bills);
        setCheck('printProjShowClientPayments', cfg.proj_show_client_payments);
        setCheck('printProjShowTasks', cfg.proj_show_tasks);
        setCheck('printProjShowBoqItems', cfg.proj_show_boq_items);
        setCheck('printProjShowRetentions', cfg.proj_show_retentions);

        // 3. كشوفات الحسابات والرواتب
        setInput('printClientStmtTitle', cfg.client_stmt_title);
        setInput('printSupplierStmtTitle', cfg.supplier_stmt_title);
        setInput('printPayrollTitle', cfg.payroll_title);
        setInput('printPaySlipTitle', cfg.pay_slip_title);
        setCheck('printStmtShowSummaryCard', cfg.stmt_show_summary_card);
        setCheck('printStmtShowRunningBalance', cfg.stmt_show_running_balance);
        setCheck('printStmtShowReference', cfg.stmt_show_reference);
        setCheck('printStmtShowNotes', cfg.stmt_show_notes);
        setCheck('printStmtShowMatchSig', cfg.stmt_show_match_sig);
        setCheck('printPayrollShowAllowances', cfg.payroll_show_allowances);
        setCheck('printPayrollShowDeductions', cfg.payroll_show_deductions);
        setCheck('printPayrollShowEmpSignature', cfg.payroll_show_emp_signature);

        // 4. القوائم المالية والمخزون
        setInput('printPlTitle', cfg.pl_title);
        setInput('printIncomeStmtTitle', cfg.income_stmt_title);
        setInput('printBalanceSheetTitle', cfg.balance_sheet_title);
        setInput('printCashFlowTitle', cfg.cash_flow_title);
        setInput('printTrialBalanceTitle', cfg.trial_balance_title);
        setInput('printProfitabilityTitle', cfg.profitability_title);
        setInput('printInventoryTitle', cfg.inventory_title);
        setCheck('printFinShowKpiCards', cfg.fin_show_kpi_cards);
        setCheck('printFinShowExpenseBreakdown', cfg.fin_show_expense_breakdown);
        setCheck('printFinShowDualBalance', cfg.fin_show_dual_balance);
        setCheck('printFinShowReconcileBadge', cfg.fin_show_reconcile_badge);

        this.updatePrintPreview();
      }
    } catch (e) {
      console.error('Error loading print settings:', e);
    }
  },

  async savePrintSettings(e) {
    if (e) e.preventDefault();

    const getVal = (id, def = '') => document.getElementById(id)?.value || def;
    const getChk = (id) => document.getElementById(id)?.checked ? '1' : '0';

    const cfg = {
      print_header_title: getVal('printHeaderTitle', 'شركة رواسي عدن للهندسة والمقاولات'),
      print_header_en: getVal('printHeaderEn', 'Rawasi Aden for Engineering & Contracting'),
      print_header_subtitle: getVal('printHeaderSubtitle', ''),
      print_tax_no: getVal('printTaxNo', ''),
      print_slogan: getVal('printSlogan', ''),
      print_header_style: getVal('printHeaderStyle', 'dynamic'),
      print_table_density: getVal('printTableDensity', 'medium'),
      print_page_margins: getVal('printPageMargins', 'normal'),
      print_orientation: getVal('printOrientation', 'portrait'),
      print_sig_position: getVal('printSigPosition', 'end'),
      print_logo_size: getVal('printLogoSize', 'medium'),
      print_font_family: getVal('printFontFamily', 'Cairo'),
      print_font_size_scale: getVal('printFontSizeScale', 'normal'),
      print_show_logo: getChk('printShowLogo'),
      print_show_stamp: getChk('printShowStamp'),
      print_show_page_numbers: getChk('printShowPageNumbers'),
      print_show_print_time: getChk('printShowPrintTime'),
      print_sig1: getVal('printSig1', 'المستلم / المحاسب'),
      print_sig2: getVal('printSig2', 'المدير العام'),
      print_sig3: getVal('printSig3', 'اعتماد الإدارة'),
      print_border_style: getVal('printBorderStyle', 'classic'),
      print_accent_color: getVal('printAccentColor', '#d4af37'),
      print_footer_notes: getVal('printFooterNotes', ''),
      
      // 1. السندات والقيود
      print_receipt_title: getVal('printReceiptTitle', 'سـنـد قـبـض رسـمـي'),
      print_expense_title: getVal('printExpenseTitle', 'سـنـد صـرف رسـمـي'),
      print_custody_title: getVal('printCustodyTitle', 'سـنـد عـهـدة وتـصـفـيـة مـالـيـة'),
      print_journal_title: getVal('printJournalTitle', 'سـنـد قـيـد يـومـيـة مـحـاسـبـي'),
      print_cash_movement_title: getVal('printCashMovementTitle', 'كشف حركة الصندوق والسيولة النقدية'),
      print_voucher_layout: getVal('printVoucherLayout', 'single_a4'),
      print_voucher_show_tafqeet: getChk('printVoucherShowTafqeet'),
      print_voucher_show_project: getChk('printVoucherShowProject'),
      print_voucher_show_payment_method: getChk('printVoucherShowPaymentMethod'),
      print_voucher_show_cheque_ref: getChk('printVoucherShowChequeRef'),
      print_voucher_show_cost_center: getChk('printVoucherShowCostCenter'),
      print_voucher_show_account: getChk('printVoucherShowAccount'),

      // 2. المشاريع والعقود
      print_proj_report_title: getVal('printProjReportTitle', 'تقرير الحساب المالي للمشروع'),
      print_contract_title: getVal('printContractTitle', 'عقد مقاولة وإنشاءات هندسية رسمي'),
      print_ipc_title: getVal('printIpcTitle', 'شهادة دفع وإنجاز مستخلص جاري (IPC)'),
      print_quotation_title: getVal('printQuotationTitle', 'عرض سعر ومواصفات هندسية رسمية'),
      print_change_order_title: getVal('printChangeOrderTitle', 'استمارة أمر تغيير هندسي ومادي'),
      print_daily_report_title: getVal('printDailyReportTitle', 'التقرير الميداني اليومي لأعمال الموقع'),
      print_handover_title: getVal('printHandoverTitle', 'محضر استلام ومخالصة ختامية للمشروع'),
      print_proj_show_kpi_cards: getChk('printProjShowKpiCards'),
      print_proj_show_expenses_table: getChk('printProjShowExpensesTable'),
      print_proj_show_supplier_bills: getChk('printProjShowSupplierBills'),
      print_proj_show_client_payments: getChk('printProjShowClientPayments'),
      print_proj_show_tasks: getChk('printProjShowTasks'),
      print_proj_show_boq_items: getChk('printProjShowBoqItems'),
      print_proj_show_retentions: getChk('printProjShowRetentions'),

      // 3. كشوفات الحسابات والرواتب
      print_client_stmt_title: getVal('printClientStmtTitle', 'كشف حساب عميل معتمد ومطابق للأستاذ'),
      print_supplier_stmt_title: getVal('printSupplierStmtTitle', 'كشف حساب مورد معتمد ومطابق للأستاذ'),
      print_payroll_title: getVal('printPayrollTitle', 'كشف الراتب والأجور الشامل المعتمد'),
      print_pay_slip_title: getVal('printPaySlipTitle', 'قسيمة استحقاق وصرف راتب موظف'),
      print_stmt_show_summary_card: getChk('printStmtShowSummaryCard'),
      print_stmt_show_running_balance: getChk('printStmtShowRunningBalance'),
      print_stmt_show_reference: getChk('printStmtShowReference'),
      print_stmt_show_notes: getChk('printStmtShowNotes'),
      print_stmt_show_match_sig: getChk('printStmtShowMatchSig'),
      print_payroll_show_allowances: getChk('printPayrollShowAllowances'),
      print_payroll_show_deductions: getChk('printPayrollShowDeductions'),
      print_payroll_show_emp_signature: getChk('printPayrollShowEmpSignature'),

      // 4. القوائم المالية والمخزون
      print_pl_title: getVal('printPlTitle', 'قائمة الأرباح والخسائر الرسمية'),
      print_income_stmt_title: getVal('printIncomeStmtTitle', 'قائمة الدخل المعيارية وإثبات الإنجاز POC'),
      print_balance_sheet_title: getVal('printBalanceSheetTitle', 'الميزانية العمومية وقائمة المركز المالي'),
      print_cash_flow_title: getVal('printCashFlowTitle', 'قائمة التدفقات النقدية الفعلية'),
      print_trial_balance_title: getVal('printTrialBalanceTitle', 'ميزان المراجعة بالأرصدة والمجاميع'),
      print_profitability_title: getVal('printProfitabilityTitle', 'تقرير ربحية وأداء المشاريع ومراكز التكلفة'),
      print_inventory_title: getVal('printInventoryTitle', 'تقرير جرد وتقييم المخزون والمستودعات'),
      print_fin_show_kpi_cards: getChk('printFinShowKpiCards'),
      print_fin_show_expense_breakdown: getChk('printFinShowExpenseBreakdown'),
      print_fin_show_dual_balance: getChk('printFinShowDualBalance'),
      print_fin_show_reconcile_badge: getChk('printFinShowReconcileBadge')
    };

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg)
      });
      const data = await res.json();
      if (data.success) {
        this._printConfig = {
          header_title: cfg.print_header_title,
          header_en: cfg.print_header_en,
          header_subtitle: cfg.print_header_subtitle,
          tax_no: cfg.print_tax_no,
          slogan: cfg.print_slogan,
          header_style: cfg.print_header_style,
          table_density: cfg.print_table_density,
          page_margins: cfg.print_page_margins,
          orientation: cfg.print_orientation,
          sig_position: cfg.print_sig_position,
          logo_size: cfg.print_logo_size,
          font_family: cfg.print_font_family,
          font_size_scale: cfg.print_font_size_scale,
          show_logo: cfg.print_show_logo,
          show_stamp: cfg.print_show_stamp,
          show_page_numbers: cfg.print_show_page_numbers,
          show_print_time: cfg.print_show_print_time,
          sig1: cfg.print_sig1,
          sig2: cfg.print_sig2,
          sig3: cfg.print_sig3,
          border_style: cfg.print_border_style,
          accent_color: cfg.print_accent_color,
          footer_notes: cfg.print_footer_notes,

          receipt_title: cfg.print_receipt_title,
          expense_title: cfg.print_expense_title,
          custody_title: cfg.print_custody_title,
          journal_title: cfg.print_journal_title,
          cash_movement_title: cfg.print_cash_movement_title,
          voucher_layout: cfg.print_voucher_layout,
          voucher_show_tafqeet: cfg.print_voucher_show_tafqeet,
          voucher_show_project: cfg.print_voucher_show_project,
          voucher_show_payment_method: cfg.print_voucher_show_payment_method,
          voucher_show_cheque_ref: cfg.print_voucher_show_cheque_ref,
          voucher_show_cost_center: cfg.print_voucher_show_cost_center,
          voucher_show_account: cfg.print_voucher_show_account,

          proj_report_title: cfg.print_proj_report_title,
          contract_title: cfg.print_contract_title,
          ipc_title: cfg.print_ipc_title,
          quotation_title: cfg.print_quotation_title,
          change_order_title: cfg.print_change_order_title,
          daily_report_title: cfg.print_daily_report_title,
          handover_title: cfg.print_handover_title,
          proj_show_kpi_cards: cfg.print_proj_show_kpi_cards,
          proj_show_expenses_table: cfg.print_proj_show_expenses_table,
          proj_show_supplier_bills: cfg.print_proj_show_supplier_bills,
          proj_show_client_payments: cfg.print_proj_show_client_payments,
          proj_show_tasks: cfg.print_proj_show_tasks,
          proj_show_boq_items: cfg.print_proj_show_boq_items,
          proj_show_retentions: cfg.print_proj_show_retentions,

          client_stmt_title: cfg.print_client_stmt_title,
          supplier_stmt_title: cfg.print_supplier_stmt_title,
          payroll_title: cfg.print_payroll_title,
          pay_slip_title: cfg.print_pay_slip_title,
          stmt_show_summary_card: cfg.print_stmt_show_summary_card,
          stmt_show_running_balance: cfg.print_stmt_show_running_balance,
          stmt_show_reference: cfg.print_stmt_show_reference,
          stmt_show_notes: cfg.print_stmt_show_notes,
          stmt_show_match_sig: cfg.print_stmt_show_match_sig,
          payroll_show_allowances: cfg.print_payroll_show_allowances,
          payroll_show_deductions: cfg.print_payroll_show_deductions,
          payroll_show_emp_signature: cfg.print_payroll_show_emp_signature,

          pl_title: cfg.print_pl_title,
          income_stmt_title: cfg.print_income_stmt_title,
          balance_sheet_title: cfg.print_balance_sheet_title,
          cash_flow_title: cfg.print_cash_flow_title,
          trial_balance_title: cfg.print_trial_balance_title,
          profitability_title: cfg.print_profitability_title,
          inventory_title: cfg.print_inventory_title,
          fin_show_kpi_cards: cfg.print_fin_show_kpi_cards,
          fin_show_expense_breakdown: cfg.print_fin_show_expense_breakdown,
          fin_show_dual_balance: cfg.print_fin_show_dual_balance,
          fin_show_reconcile_badge: cfg.print_fin_show_reconcile_badge
        };
        localStorage.setItem('rawasi_print_config', JSON.stringify(this._printConfig));
        this.updatePrintPreview();
        App.showToast('تم حفظ وتطبيق كافة إعدادات أوراق الطباعة والتقارير بنجاح 🖨️✨', 'success');
      } else {
        App.showToast(data.message || 'خطأ في حفظ الإعدادات', 'error');
      }
    } catch (err) {
      console.error(err);
      App.showToast('تعذر حفظ إعدادات الطباعة', 'error');
    }
  },

  resetDefaultPrintSettings() {
    const defaults = {
      header_title: 'شركة رواسي عدن للهندسة والمقاولات',
      header_en: 'Rawasi Aden for Engineering & Contracting',
      header_subtitle: 'عدن - الجمهورية اليمنية | هاتف: 773413937',
      tax_no: 'س.ت: 102948 - ر.ض: 3004918',
      slogan: 'نبني الحاضر لنستثمر المستقبل',
      header_style: 'dynamic',
      table_density: 'medium',
      page_margins: 'normal',
      orientation: 'portrait',
      sig_position: 'end',
      logo_size: 'medium',
      font_family: 'Cairo',
      font_size_scale: 'normal',
      show_logo: '1',
      show_stamp: '0',
      show_page_numbers: '1',
      show_print_time: '1',
      sig1: 'المستلم / المحاسب',
      sig2: 'المدير العام',
      sig3: 'اعتماد الإدارة',
      border_style: 'classic',
      accent_color: '#d4af37',
      footer_notes: 'تعتبر هذه السندات والوثائق رسمية ولا يعتمد أي كشط أو تعديل بدون ختم الإدارة',

      receipt_title: 'سـنـد قـبـض رسـمـي',
      expense_title: 'سـنـد صـرف رسـمـي',
      custody_title: 'سـنـد عـهـدة وتـصـفـيـة مـالـيـة',
      journal_title: 'سـنـد قـيـد يـومـيـة مـحـاسـبـي',
      cash_movement_title: 'كشف حركة الصندوق والسيولة النقدية',
      voucher_layout: 'single_a4',
      voucher_show_tafqeet: '1',
      voucher_show_project: '1',
      voucher_show_payment_method: '1',
      voucher_show_cheque_ref: '1',
      voucher_show_cost_center: '1',
      voucher_show_account: '1',

      proj_report_title: 'تقرير الحساب المالي للمشروع',
      contract_title: 'عقد مقاولة وإنشاءات هندسية رسمي',
      ipc_title: 'شهادة دفع وإنجاز مستخلص جاري (IPC)',
      quotation_title: 'عرض سعر ومواصفات هندسية رسمية',
      change_order_title: 'استمارة أمر تغيير هندسي ومادي',
      daily_report_title: 'التقرير الميداني اليومي لأعمال الموقع',
      handover_title: 'محضر استلام ومخالصة ختامية للمشروع',
      proj_show_kpi_cards: '1',
      proj_show_expenses_table: '1',
      proj_show_supplier_bills: '1',
      proj_show_client_payments: '1',
      proj_show_tasks: '1',
      proj_show_boq_items: '1',
      proj_show_retentions: '1',

      client_stmt_title: 'كشف حساب عميل معتمد ومطابق للأستاذ',
      supplier_stmt_title: 'كشف حساب مورد معتمد ومطابق للأستاذ',
      payroll_title: 'كشف الراتب والأجور الشامل المعتمد',
      pay_slip_title: 'قسيمة استحقاق وصرف راتب موظف',
      stmt_show_summary_card: '1',
      stmt_show_running_balance: '1',
      stmt_show_reference: '1',
      stmt_show_notes: '1',
      stmt_show_match_sig: '1',
      payroll_show_allowances: '1',
      payroll_show_deductions: '1',
      payroll_show_emp_signature: '1',

      pl_title: 'قائمة الأرباح والخسائر الرسمية',
      income_stmt_title: 'قائمة الدخل المعيارية وإثبات الإنجاز POC',
      balance_sheet_title: 'الميزانية العمومية وقائمة المركز المالي',
      cash_flow_title: 'قائمة التدفقات النقدية الفعلية',
      trial_balance_title: 'ميزان المراجعة بالأرصدة والمجاميع',
      profitability_title: 'تقرير ربحية وأداء المشاريع ومراكز التكلفة',
      inventory_title: 'تقرير جرد وتقييم المخزون والمستودعات',
      fin_show_kpi_cards: '1',
      fin_show_expense_breakdown: '1',
      fin_show_dual_balance: '1',
      fin_show_reconcile_badge: '1'
    };

    const setInput = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val;
    };
    const setCheck = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.checked = (val === '1');
    };

    setInput('printHeaderTitle', defaults.header_title);
    setInput('printHeaderEn', defaults.header_en);
    setInput('printHeaderSubtitle', defaults.header_subtitle);
    setInput('printTaxNo', defaults.tax_no);
    setInput('printSlogan', defaults.slogan);
    setInput('printHeaderStyle', defaults.header_style);
    setInput('printTableDensity', defaults.table_density);
    setInput('printPageMargins', defaults.page_margins);
    setInput('printOrientation', defaults.orientation);
    setInput('printSigPosition', defaults.sig_position);
    setInput('printLogoSize', defaults.logo_size);
    setInput('printFontFamily', defaults.font_family);
    setInput('printFontSizeScale', defaults.font_size_scale);
    setCheck('printShowLogo', defaults.show_logo);
    setCheck('printShowStamp', defaults.show_stamp);
    setCheck('printShowPageNumbers', defaults.show_page_numbers);
    setCheck('printShowPrintTime', defaults.show_print_time);
    setInput('printSig1', defaults.sig1);
    setInput('printSig2', defaults.sig2);
    setInput('printSig3', defaults.sig3);
    setInput('printBorderStyle', defaults.border_style);
    setInput('printAccentColor', defaults.accent_color);
    setInput('printFooterNotes', defaults.footer_notes);

    // 1. السندات والقيود
    setInput('printReceiptTitle', defaults.receipt_title);
    setInput('printExpenseTitle', defaults.expense_title);
    setInput('printCustodyTitle', defaults.custody_title);
    setInput('printJournalTitle', defaults.journal_title);
    setInput('printCashMovementTitle', defaults.cash_movement_title);
    setInput('printVoucherLayout', defaults.voucher_layout);
    setCheck('printVoucherShowTafqeet', defaults.voucher_show_tafqeet);
    setCheck('printVoucherShowProject', defaults.voucher_show_project);
    setCheck('printVoucherShowPaymentMethod', defaults.voucher_show_payment_method);
    setCheck('printVoucherShowChequeRef', defaults.voucher_show_cheque_ref);
    setCheck('printVoucherShowCostCenter', defaults.voucher_show_cost_center);
    setCheck('printVoucherShowAccount', defaults.voucher_show_account);

    // 2. المشاريع والعقود
    setInput('printProjReportTitle', defaults.proj_report_title);
    setInput('printContractTitle', defaults.contract_title);
    setInput('printIpcTitle', defaults.ipc_title);
    setInput('printQuotationTitle', defaults.quotation_title);
    setInput('printChangeOrderTitle', defaults.change_order_title);
    setInput('printDailyReportTitle', defaults.daily_report_title);
    setInput('printHandoverTitle', defaults.handover_title);
    setCheck('printProjShowKpiCards', defaults.proj_show_kpi_cards);
    setCheck('printProjShowExpensesTable', defaults.proj_show_expenses_table);
    setCheck('printProjShowSupplierBills', defaults.proj_show_supplier_bills);
    setCheck('printProjShowClientPayments', defaults.proj_show_client_payments);
    setCheck('printProjShowTasks', defaults.proj_show_tasks);
    setCheck('printProjShowBoqItems', defaults.proj_show_boq_items);
    setCheck('printProjShowRetentions', defaults.proj_show_retentions);

    // 3. كشوفات الحسابات والرواتب
    setInput('printClientStmtTitle', defaults.client_stmt_title);
    setInput('printSupplierStmtTitle', defaults.supplier_stmt_title);
    setInput('printPayrollTitle', defaults.payroll_title);
    setInput('printPaySlipTitle', defaults.pay_slip_title);
    setCheck('printStmtShowSummaryCard', defaults.stmt_show_summary_card);
    setCheck('printStmtShowRunningBalance', defaults.stmt_show_running_balance);
    setCheck('printStmtShowReference', defaults.stmt_show_reference);
    setCheck('printStmtShowNotes', defaults.stmt_show_notes);
    setCheck('printStmtShowMatchSig', defaults.stmt_show_match_sig);
    setCheck('printPayrollShowAllowances', defaults.payroll_show_allowances);
    setCheck('printPayrollShowDeductions', defaults.payroll_show_deductions);
    setCheck('printPayrollShowEmpSignature', defaults.payroll_show_emp_signature);

    // 4. القوائم المالية والمخزون
    setInput('printPlTitle', defaults.pl_title);
    setInput('printIncomeStmtTitle', defaults.income_stmt_title);
    setInput('printBalanceSheetTitle', defaults.balance_sheet_title);
    setInput('printCashFlowTitle', defaults.cash_flow_title);
    setInput('printTrialBalanceTitle', defaults.trial_balance_title);
    setInput('printProfitabilityTitle', defaults.profitability_title);
    setInput('printInventoryTitle', defaults.inventory_title);
    setCheck('printFinShowKpiCards', defaults.fin_show_kpi_cards);
    setCheck('printFinShowExpenseBreakdown', defaults.fin_show_expense_breakdown);
    setCheck('printFinShowDualBalance', defaults.fin_show_dual_balance);
    setCheck('printFinShowReconcileBadge', defaults.fin_show_reconcile_badge);

    this.updatePrintPreview();
    App.showToast('تم استعادة الإعدادات الافتراضية، اضغط حفظ للتأكيد', 'info');
  },

  // تبديل النموذج المعروض في المعاينة الحية
  setPreviewDoc(type) {
    this._previewDocType = type;
    const buttons = document.querySelectorAll('#printDocSwitcher .print-doc-pill');
    buttons.forEach(b => b.classList.remove('active'));
    
    // تفعيل الزر المناسب من الـ 20 نموذج
    const pillMap = {
      'receipt': 0,
      'expense': 1,
      'custody': 2,
      'journal': 3,
      'cash_movement': 4,
      'client_stmt': 5,
      'supplier_stmt': 6,
      'project': 7,
      'contract': 8,
      'ipc': 9,
      'quotation': 10,
      'change_order': 11,
      'daily_report': 12,
      'handover': 13,
      'payroll': 14,
      'profit_loss': 15,
      'balance_sheet': 16,
      'cash_flow': 17,
      'trial_balance': 18,
      'inventory': 19
    };
    const idx = pillMap[type];
    if (idx !== undefined && buttons[idx]) {
      buttons[idx].classList.add('active');
    }

    this.updatePrintPreview();
  },

  // طباعة تجريبية للنموذج المختار حالياً في المعاينة
  printCurrentPreviewDoc() {
    const previewBox = document.getElementById('printLivePreviewBox');
    if (!previewBox) return;

    const cfg = this.getPrintConfig();
    const docTitle = document.title || 'طباعة نموذج رسمي';
    const orient = cfg.orientation === 'landscape' ? 'landscape' : 'portrait';

    const win = window.open('', '_blank', 'width=950,height=850');
    if (win) {
      win.document.write(\`
        <!DOCTYPE html>
        <html dir="rtl" lang="ar">
        <head>
          <meta charset="utf-8">
          <title>\${docTitle}</title>
          <link rel="stylesheet" href="css/style.css">
          <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&family=Amiri:wght@400;700&family=Tajawal:wght@400;500;700&family=Almarai:wght@400;700&display=swap" rel="stylesheet">
          <style>
            body { 
              background: #fff !important; 
              padding: 20px; 
              font-family: '\${cfg.font_family || 'Cairo'}', sans-serif !important; 
              color: #0f172a;
            }
            @media print {
              @page { size: A4 \${orient}; margin: \${cfg.page_margins === 'narrow' ? '6mm' : (cfg.page_margins === 'wide' ? '18mm' : '10mm')}; }
              body { padding: 0 !important; }
              .no-print { display: none !important; }
            }
          </style>
        </head>
        <body>
          \${previewBox.innerHTML}
          <script>
            window.onload = function() {
              setTimeout(function() { window.print(); window.close(); }, 400);
            };
          <\\/script>
        </body>
        </html>
      \`);
      win.document.close();
    }
  },

  // بناء فئات CSS الموحدة للتقارير والوثائق
  getReportDocClass(cfg = null) {
    const c = cfg || this.getPrintConfig();
    const borderCls = \`border-\${c.border_style || 'classic'}\`;
    const densityCls = \`density-\${c.table_density || 'medium'}\`;
    const marginsCls = \`margins-\${c.page_margins || 'normal'}\`;
    const fontCls = \`font-\${(c.font_family || 'cairo').toLowerCase()}\`;
    const scaleCls = \`scale-\${c.font_size_scale || 'normal'}\`;
    const logoCls = \`logo-size-\${c.logo_size || 'medium'}\`;
    const orientCls = c.orientation === 'landscape' ? 'orientation-landscape' : '';
    return \`multi-page-report-document \${borderCls} \${densityCls} \${marginsCls} \${fontCls} \${scaleCls} \${logoCls} \${orientCls}\`.trim();
  },

  // جلب اسم المستخدم الحالي المسجل بالنظام
  getCurrentUserName() {
    if (typeof Auth !== 'undefined' && Auth.currentUser) {
      return Auth.currentUser.full_name || Auth.currentUser.username || 'علوي محمد باعبيد';
    }
    try {
      const u = localStorage.getItem('rawasi_user');
      if (u) {
        const parsed = JSON.parse(u);
        return parsed.full_name || parsed.username || 'علوي محمد باعبيد';
      }
    } catch (e) {}
    return 'علوي محمد باعبيد';
  },

  // ضبط عنوان نافذة الطباعة ليظهر اسم المستخدم بجانب وقت الطباعة في ترويسة المتصفح
  setPrintTitle(docTitle) {
    const userName = this.getCurrentUserName();
    const origTitle = document.title;
    document.title = \`المستخدم المسجل: \${userName} | \${docTitle || 'تقرير رسمي'} - شركة رواسي عدن\`;
    const restore = () => {
      document.title = origTitle;
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    setTimeout(restore, 2500);
  },

  // إنشاء ترويسة التقارير الرسمية الذكية
  renderReportHeader(title, metaItems = [], cfg = null) {
    const c = cfg || this.getPrintConfig();
    const showLogo = c.show_logo === '1' || c.show_logo === 1 || c.show_logo === true;
    const accent = c.accent_color || '#d4af37';
    const userName = this.getCurrentUserName();
    const now = new Date();
    const todayDate = now.toISOString().split('T')[0];
    const timeStr = now.toLocaleTimeString('ar-YE', { hour: '2-digit', minute: '2-digit' });

    // التأكد من توفر اسم المستخدم والوقت بجانب بعض في بيانات الترويسة
    const items = [...metaItems];
    const hasUser = items.some(m => m.label && (m.label.includes('المستخدم') || m.label.includes('طُبع بواسطة')));
    const dateItem = items.find(m => m.label && (m.label.includes('تاريخ') || m.label.includes('الوقت') || m.label.includes('إصدار')));

    if (dateItem) {
      if (!dateItem.val.includes(timeStr) && !dateItem.val.includes(':')) {
        dateItem.label = 'تاريخ ووقت الطباعة';
        dateItem.val = \`\${dateItem.val} - \${timeStr}\`;
      }
    } else {
      items.push({ label: 'تاريخ ووقت الطباعة', val: \`\${todayDate} - \${timeStr}\` });
    }

    if (!hasUser) {
      items.push({ label: 'المستخدم المسجل بالمشروع', val: userName });
    }
    
    // تحديد قياس الشعار / الشكل بدقة
    let logoDim = 58;
    if (c.logo_size === 'small') logoDim = 42;
    else if (c.logo_size === 'large') logoDim = 76;
    else if (c.logo_size === 'xlarge') logoDim = 95;
    else if (c.logo_size === 'full') logoDim = 115;

    const renderMetaDivs = (list) => {
      return list.map(m => {
        const isUser = m.label && m.label.includes('المستخدم');
        const isTime = m.label && (m.label.includes('تاريخ') || m.label.includes('الوقت'));
        const badgeStyle = isUser 
          ? 'margin: 2px 0; font-size: 0.82rem; color: #0f2744; font-weight: 700; background: #f0f7ff; padding: 2px 8px; border-radius: 4px; border-right: 3px solid #1e3a5f;' 
          : (isTime 
            ? 'margin: 2px 0; font-size: 0.82rem; color: #1e293b; background: #fafaf9; padding: 1px 6px; border-radius: 4px; border-right: 3px solid ' + accent + ';'
            : 'margin: 1px 0;');
        return \`<div style="\${badgeStyle}">\${m.label}: <strong style="color: #0f2744;">\${m.val}</strong></div>\`;
      }).join('');
    };

    if (c.header_style === 'plain') {
      return \`
        <div class="report-header-banner" style="border-bottom-color: \${accent}; padding-bottom: 8px; margin-bottom: 12px;">
          <div class="report-header-badge-box" style="width: 100%; display: flex; justify-content: space-between; align-items: center;">
            <div class="doc-badge" style="background: #0f2744; border-right-color: \${accent}; font-size: 1.15rem; margin: 0;">
              \${title}
            </div>
            <div class="doc-info" style="text-align: left;">
              \${renderMetaDivs(items)}
            </div>
          </div>
        </div>
      \`;
    }

    return \`
      <div class="report-header-banner logo-size-\${c.logo_size || 'medium'}" style="border-bottom-color: \${accent};">
        <div class="report-header-brand">
          \${showLogo ? \`<img src="images/logo.png" alt="رواسي عدن" style="width: \${logoDim}px; height: \${logoDim}px; object-fit: contain;">\` : ''}
          <div class="report-header-titles">
            <h2>\${c.header_title || 'شركة رواسي عدن للهندسة والمقاولات'}</h2>
            <div class="en-title">\${c.header_en || 'Rawasi Aden for Engineering & Contracting'}</div>
            <div class="meta-sub">
              \${c.header_subtitle || ''} 
              \${c.tax_no ? \` | <span style="font-weight: 600;">\${c.tax_no}</span>\` : ''}
            </div>
            \${c.slogan ? \`<div style="font-size: 0.72rem; color: \${accent}; font-weight: 700; margin-top: 1px;">« \${c.slogan} »</div>\` : ''}
          </div>
        </div>
        <div class="report-header-badge-box">
          <div class="doc-badge" style="border-right-color: \${accent};">
            \${title}
          </div>
          <div class="doc-info">
            \${renderMetaDivs(items)}
          </div>
        </div>
      </div>
    \`;
  },

  // إنشاء صف التوقيعات والختم
  renderReportSignatures(cfg = null) {
    const c = cfg || this.getPrintConfig();
    if (c.sig_position === 'none') return '';

    const showStamp = c.show_stamp === '1' || c.show_stamp === 1 || c.show_stamp === true;

    return \`
      <div class="letterhead-signatures-row">
        <div class="letterhead-sig-col">
          <div class="letterhead-sig-label">\${c.sig1 || 'المستلم / المحاسب'}</div>
          <div class="letterhead-sig-dots">التوقيع: ........................</div>
        </div>
        \${showStamp ? \`
        <div class="letterhead-sig-col" style="min-width: 100px;">
          <div class="letterhead-stamp-circle">
            <span>الختم الرسمي</span>
          </div>
        </div>
        \` : \`
        <div class="letterhead-sig-col">
          <div class="letterhead-sig-label">\${c.sig2 || 'المدير العام'}</div>
          <div class="letterhead-sig-dots">الاعتماد: ........................</div>
        </div>
        \`}
        <div class="letterhead-sig-col">
          <div class="letterhead-sig-label">\${c.sig3 || 'اعتماد الإدارة'}</div>
          <div class="letterhead-sig-dots">الاعتماد: ........................</div>
        </div>
      </div>
    \`;
  },

  // إنشاء تذييل التقرير والملاحظات
  renderReportFooter(cfg = null) {
    const c = cfg || this.getPrintConfig();
    const showPageNums = c.show_page_numbers === '1' || c.show_page_numbers === 1 || c.show_page_numbers === true;
    const showPrintTime = c.show_print_time === '1' || c.show_print_time === 1 || c.show_print_time === true;
    const todayDate = new Date().toISOString().split('T')[0];
    const timeStr = new Date().toLocaleTimeString('ar-YE', { hour: '2-digit', minute: '2-digit' });
    const userName = this.getCurrentUserName();

    return \`
      <div style="margin-top: 14px; padding-top: 8px; border-top: 1px dashed #cbd5e1; font-size: 0.74rem; color: #64748b; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px;">
        <div style="flex: 1; text-align: right;">\${c.footer_notes || ''}</div>
        <div style="display: flex; gap: 14px; align-items: center; font-size: 0.7rem; color: #94a3b8;">
          \${showPrintTime ? \`<span>تاريخ ووقت الطباعة: <strong>\${todayDate} \${timeStr}</strong> | المستخدم: <strong style="color: #0f2744;">\${userName}</strong></span>\` : ''}
          \${showPageNums ? \`<span style="background: #f1f5f9; padding: 2px 8px; border-radius: 4px; font-weight: bold; color: #475569;">وثيقة رسمية معتمدة</span>\` : ''}
        </div>
      </div>
    \`;
  },

  updatePrintPreview() {
    const previewBox = document.getElementById('printLivePreviewBox');
    if (!previewBox) return;

    const getVal = (id, def = '') => document.getElementById(id)?.value || def;
    const getChk = (id) => document.getElementById(id)?.checked;

    // عام وترويسة
    const headerTitle = getVal('printHeaderTitle', 'شركة رواسي عدن للهندسة والمقاولات');
    const headerEn = getVal('printHeaderEn', 'Rawasi Aden for Engineering & Contracting');
    const headerSub = getVal('printHeaderSubtitle', 'عدن - الجمهورية اليمنية | هاتف: 773413937');
    const taxNo = getVal('printTaxNo', 'س.ت: 102948 - ر.ض: 3004918');
    const slogan = getVal('printSlogan', 'نبني الحاضر لنستثمر المستقبل');
    const headerStyle = getVal('printHeaderStyle', 'dynamic');
    const tableDensity = getVal('printTableDensity', 'medium');
    const borderStyle = getVal('printBorderStyle', 'classic');
    const accentColor = getVal('printAccentColor', '#d4af37');
    const sigPosition = getVal('printSigPosition', 'end');
    const logoSize = getVal('printLogoSize', 'medium');
    const fontFamily = getVal('printFontFamily', 'Cairo');
    const fontSizeScale = getVal('printFontSizeScale', 'normal');
    const showLogo = getChk('printShowLogo');
    const showStamp = getChk('printShowStamp');
    const showPageNums = getChk('printShowPageNumbers');
    const showPrintTime = getChk('printShowPrintTime');
    const sig1 = getVal('printSig1', 'المستلم / المحاسب');
    const sig2 = getVal('printSig2', 'المدير العام');
    const sig3 = getVal('printSig3', 'اعتماد الإدارة');
    const footerNotes = getVal('printFooterNotes', 'تعتبر هذه السندات والوثائق رسمية ومعتمدة من الإدارة المالية');

    // 1. السندات والقيود
    const receiptTitle = getVal('printReceiptTitle', 'سـنـد قـبـض رسـمـي');
    const expenseTitle = getVal('printExpenseTitle', 'سـنـد صـرف رسـمـي');
    const custodyTitle = getVal('printCustodyTitle', 'سـنـد عـهـدة وتـصـفـيـة مـالـيـة');
    const journalTitle = getVal('printJournalTitle', 'سـنـد قـيـد يـومـيـة مـحـاسـبـي');
    const cashMovementTitle = getVal('printCashMovementTitle', 'كشف حركة الصندوق والسيولة النقدية');
    const voucherLayout = getVal('printVoucherLayout', 'single_a4');
    const voucherShowTafqeet = getChk('printVoucherShowTafqeet');
    const voucherShowProject = getChk('printVoucherShowProject');
    const voucherShowPaymentMethod = getChk('printVoucherShowPaymentMethod');
    const voucherShowChequeRef = getChk('printVoucherShowChequeRef');
    const voucherShowCostCenter = getChk('printVoucherShowCostCenter');
    const voucherShowAccount = getChk('printVoucherShowAccount');

    // 2. المشاريع والعقود
    const projReportTitle = getVal('printProjReportTitle', 'تقرير الحساب المالي للمشروع');
    const contractTitle = getVal('printContractTitle', 'عقد مقاولة وإنشاءات هندسية رسمي');
    const ipcTitle = getVal('printIpcTitle', 'شهادة دفع وإنجاز مستخلص جاري (IPC)');
    const quotationTitle = getVal('printQuotationTitle', 'عرض سعر ومواصفات هندسية رسمية');
    const changeOrderTitle = getVal('printChangeOrderTitle', 'استمارة أمر تغيير هندسي ومادي');
    const dailyReportTitle = getVal('printDailyReportTitle', 'التقرير الميداني اليومي لأعمال الموقع');
    const handoverTitle = getVal('printHandoverTitle', 'محضر استلام ومخالصة ختامية للمشروع');
    const projShowKpi = getChk('printProjShowKpiCards');
    const projShowExp = getChk('printProjShowExpensesTable');
    const projShowBills = getChk('printProjShowSupplierBills');
    const projShowPay = getChk('printProjShowClientPayments');
    const projShowTasks = getChk('printProjShowTasks');
    const projShowBoq = getChk('printProjShowBoqItems');
    const projShowRetentions = getChk('printProjShowRetentions');

    // 3. كشوفات الحسابات والرواتب
    const clientStmtTitle = getVal('printClientStmtTitle', 'كشف حساب عميل معتمد ومطابق للأستاذ');
    const supplierStmtTitle = getVal('printSupplierStmtTitle', 'كشف حساب مورد معتمد ومطابق للأستاذ');
    const payrollTitle = getVal('printPayrollTitle', 'كشف الراتب والأجور الشامل المعتمد');
    const paySlipTitle = getVal('printPaySlipTitle', 'قسيمة استحقاق وصرف راتب موظف');
    const stmtShowSummary = getChk('printStmtShowSummaryCard');
    const stmtShowRunningBal = getChk('printStmtShowRunningBalance');
    const stmtShowRef = getChk('printStmtShowReference');
    const stmtShowNotes = getChk('printStmtShowNotes');
    const stmtShowMatch = getChk('printStmtShowMatchSig');
    const payrollShowAllowances = getChk('printPayrollShowAllowances');
    const payrollShowDeductions = getChk('printPayrollShowDeductions');
    const payrollShowEmpSignature = getChk('printPayrollShowEmpSignature');

    // 4. القوائم المالية والمخزون
    const plTitle = getVal('printPlTitle', 'قائمة الأرباح والخسائر الرسمية');
    const incomeStmtTitle = getVal('printIncomeStmtTitle', 'قائمة الدخل المعيارية وإثبات الإنجاز POC');
    const balanceSheetTitle = getVal('printBalanceSheetTitle', 'الميزانية العمومية وقائمة المركز المالي');
    const cashFlowTitle = getVal('printCashFlowTitle', 'قائمة التدفقات النقدية الفعلية');
    const trialBalanceTitle = getVal('printTrialBalanceTitle', 'ميزان المراجعة بالأرصدة والمجاميع');
    const profitabilityTitle = getVal('printProfitabilityTitle', 'تقرير ربحية وأداء المشاريع ومراكز التكلفة');
    const inventoryTitle = getVal('printInventoryTitle', 'تقرير جرد وتقييم المخزون والمستودعات');
    const finShowKpi = getChk('printFinShowKpiCards');
    const finShowExpBreak = getChk('printFinShowExpenseBreakdown');
    const finShowDualBal = getChk('printFinShowDualBalance');
    const finShowReconcile = getChk('printFinShowReconcileBadge');

    const mockCfg = {
      header_title: headerTitle,
      header_en: headerEn,
      header_subtitle: headerSub,
      tax_no: taxNo,
      slogan: slogan,
      header_style: headerStyle,
      table_density: tableDensity,
      border_style: borderStyle,
      accent_color: accentColor,
      sig_position: sigPosition,
      logo_size: logoSize,
      font_family: fontFamily,
      font_size_scale: fontSizeScale,
      show_logo: showLogo ? '1' : '0',
      show_stamp: showStamp ? '1' : '0',
      show_page_numbers: showPageNums ? '1' : '0',
      show_print_time: showPrintTime ? '1' : '0',
      sig1, sig2, sig3,
      footer_notes: footerNotes
    };

    const fontStyleAttr = \`font-family: '\${fontFamily}', sans-serif;\`;
    const docType = this._previewDocType || 'receipt';
    const docCls = this.getReportDocClass(mockCfg);
    const sigHtml = this.renderReportSignatures(mockCfg);
    const footerHtml = this.renderReportFooter(mockCfg);

    // ==========================================
    // 1. معاينة سند القبض (receipt)
    // ==========================================
    if (docType === 'receipt') {
      const headerHtml = this.renderReportHeader(receiptTitle, [
        { label: 'رقم السند', val: 'RC-2026-0008' },
        { label: 'التاريخ', val: '2026-09-08' }
      ], mockCfg);

      previewBox.innerHTML = \`
        <div class="\${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; \${fontStyleAttr}">
          \${headerHtml}

          <div class="voucher-amount-card" style="padding: 8px 14px; margin: 10px 0 12px 0; border-color: \${accentColor}; background: #fdfaf2;">
            <div>
              <span style="font-size: 0.82rem; color: #475569; font-weight: bold; margin-left: 6px;">المبلغ المقبوض:</span>
              <span class="voucher-amount-value" style="font-size: 1.15rem; color: #047857;">1,500,000 ر.ي</span>
            </div>
            \${voucherShowTafqeet ? \`<div class="voucher-amount-words" style="font-size: 0.78rem; color: #854d0e;">فقط: مليون وخمسمائة ألف ريال يمني لا غير.</div>\` : ''}
          </div>

          <table class="voucher-grid-table" style="margin-bottom: 10px; font-size: 0.78rem;">
            <tr>
              <td class="label-cell" style="width: 28%; padding: 5px 8px; border-right-color: \${accentColor};">استلمنا من الأخ/السادة:</td>
              <td class="val-cell" style="padding: 5px 8px;">علوي محمد باعبيد</td>
            </tr>
            \${voucherShowProject ? \`
            <tr>
              <td class="label-cell" style="padding: 5px 8px; border-right-color: \${accentColor};">المشروع التابع له:</td>
              <td class="val-cell" style="padding: 5px 8px;">مشروع برج الأمل السكني</td>
            </tr>\` : ''}
            \${voucherShowAccount ? \`
            <tr>
              <td class="label-cell" style="padding: 5px 8px; border-right-color: \${accentColor};">رقم الحساب بالأستاذ:</td>
              <td class="val-cell" style="padding: 5px 8px;"><code style="color: #0f2744; font-weight: bold;">12101 - العملاء التجاريين</code></td>
            </tr>\` : ''}
            \${voucherShowCostCenter ? \`
            <tr>
              <td class="label-cell" style="padding: 5px 8px; border-right-color: \${accentColor};">مركز التكلفة:</td>
              <td class="val-cell" style="padding: 5px 8px;">CC-101 (الإنشاءات والخرسانات)</td>
            </tr>\` : ''}
            \${voucherShowPaymentMethod ? \`
            <tr>
              <td class="label-cell" style="padding: 5px 8px; border-right-color: \${accentColor};">طريقة الدفع:</td>
              <td class="val-cell" style="padding: 5px 8px;">نقداً بالصندوق الرئيسي</td>
            </tr>\` : ''}
            \${voucherShowChequeRef ? \`
            <tr>
              <td class="label-cell" style="padding: 5px 8px; border-right-color: \${accentColor};">رقم المرجع / الحوالة:</td>
              <td class="val-cell" style="padding: 5px 8px;">REF-99201</td>
            </tr>\` : ''}
            <tr>
              <td class="label-cell" style="padding: 5px 8px; border-right-color: \${accentColor};">وذلك عن (البيان):</td>
              <td class="val-cell" style="padding: 5px 8px;">دفعة أعمال مقاولات وهندسة للمرحلة الأولى</td>
            </tr>
          </table>

          \${sigHtml}
          \${footerHtml}
        </div>
      \`;
    }

    // ==========================================
    // 2. معاينة سند الصرف (expense)
    // ==========================================
    else if (docType === 'expense') {
      const headerHtml = this.renderReportHeader(expenseTitle, [
        { label: 'رقم السند', val: 'PV-2026-0014' },
        { label: 'التاريخ', val: '2026-09-08' }
      ], mockCfg);

      previewBox.innerHTML = \`
        <div class="\${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; \${fontStyleAttr}">
          \${headerHtml}

          <div class="voucher-amount-card" style="padding: 8px 14px; margin: 10px 0 12px 0; border-color: #dc2626; background: #fff5f5;">
            <div>
              <span style="font-size: 0.82rem; color: #475569; font-weight: bold; margin-left: 6px;">المبلغ المصروف:</span>
              <span class="voucher-amount-value" style="font-size: 1.15rem; color: #dc2626;">850,000 ر.ي</span>
            </div>
            \${voucherShowTafqeet ? \`<div class="voucher-amount-words" style="font-size: 0.78rem; color: #991b1b;">فقط: ثمانمائة وخمسون ألف ريال يمني لا غير.</div>\` : ''}
          </div>

          <table class="voucher-grid-table" style="margin-bottom: 10px; font-size: 0.78rem;">
            <tr>
              <td class="label-cell" style="width: 28%; padding: 5px 8px; border-right-color: #dc2626;">صرفنا إلى الأخ/السادة:</td>
              <td class="val-cell" style="padding: 5px 8px;">شركة الحديد والصلب للتجارة</td>
            </tr>
            <tr>
              <td class="label-cell" style="padding: 5px 8px; border-right-color: #dc2626;">نوع المصروف / البند:</td>
              <td class="val-cell" style="padding: 5px 8px;">توريد مواد بناء وتسليح</td>
            </tr>
            \${voucherShowProject ? \`
            <tr>
              <td class="label-cell" style="padding: 5px 8px; border-right-color: #dc2626;">المشروع التابع له:</td>
              <td class="val-cell" style="padding: 5px 8px;">مشروع برج الأمل السكني</td>
            </tr>\` : ''}
            \${voucherShowAccount ? \`
            <tr>
              <td class="label-cell" style="padding: 5px 8px; border-right-color: #dc2626;">الحساب المدين:</td>
              <td class="val-cell" style="padding: 5px 8px;"><code style="color: #b91c1c; font-weight: bold;">5101 - مواد بناء وإنشاءات</code></td>
            </tr>\` : ''}
            \${voucherShowCostCenter ? \`
            <tr>
              <td class="label-cell" style="padding: 5px 8px; border-right-color: #dc2626;">مركز التكلفة:</td>
              <td class="val-cell" style="padding: 5px 8px;">CC-101 (الإنشاءات والخرسانات)</td>
            </tr>\` : ''}
            \${voucherShowPaymentMethod ? \`
            <tr>
              <td class="label-cell" style="padding: 5px 8px; border-right-color: #dc2626;">طريقة الدفع:</td>
              <td class="val-cell" style="padding: 5px 8px;">شيك بنكي (بنك القطيبي الإسلامي)</td>
            </tr>\` : ''}
            \${voucherShowChequeRef ? \`
            <tr>
              <td class="label-cell" style="padding: 5px 8px; border-right-color: #dc2626;">رقم الشيك:</td>
              <td class="val-cell" style="padding: 5px 8px;">CHQ-88203</td>
            </tr>\` : ''}
            <tr>
              <td class="label-cell" style="padding: 5px 8px; border-right-color: #dc2626;">وذلك عن (البيان):</td>
              <td class="val-cell" style="padding: 5px 8px;">شراء حديد تسليح مقاس 16 ملم للمبنى</td>
            </tr>
          </table>

          \${sigHtml}
          \${footerHtml}
        </div>
      \`;
    }

    // ==========================================
    // 3. معاينة سند العهدة والتصفية (custody)
    // ==========================================
    else if (docType === 'custody') {
      const headerHtml = this.renderReportHeader(custodyTitle, [
        { label: 'رقم العهدة', val: 'CST-2026-004' },
        { label: 'أمين العهدة', val: 'م. أحمد صالح المحضار' },
        { label: 'تاريخ الصرف', val: '2026-09-01' }
      ], mockCfg);

      previewBox.innerHTML = \`
        <div class="\${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; \${fontStyleAttr}">
          \${headerHtml}

          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px;">
            <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 4px; padding: 6px; text-align: center;">
              <div style="font-size: 0.7rem; color: #1e40af;">مبلغ العهدة المصروف</div>
              <div style="font-weight: 800; font-size: 0.95rem; color: #1e3a8a;">500,000 ر.ي</div>
            </div>
            <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 4px; padding: 6px; text-align: center;">
              <div style="font-size: 0.7rem; color: #991b1b;">المصروف بالفواتير</div>
              <div style="font-weight: 800; font-size: 0.95rem; color: #b91c1c;">420,000 ر.ي</div>
            </div>
            <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 4px; padding: 6px; text-align: center;">
              <div style="font-size: 0.7rem; color: #166534;">المتبقي للتوريد للصندوق</div>
              <div style="font-weight: 800; font-size: 0.95rem; color: #15803d;">80,000 ر.ي</div>
            </div>
          </div>

          <div style="font-weight: bold; font-size: 0.78rem; color: #0f2744; margin: 6px 0 4px 0; border-right: 3px solid \${accentColor}; padding-right: 4px;">جدول فواتير ومصروفات تصفية العهدة:</div>
          <table class="official-report-table" style="font-size: 0.74rem; margin-bottom: 10px;">
            <thead><tr><th>م</th><th>التاريخ</th><th>رقم الفاتورة</th><th>البيان والمشتريات</th><th>المبلغ</th></tr></thead>
            <tbody>
              <tr><td>1</td><td>2026-09-02</td><td>INV-109</td><td>شراء مستلزمات كهربائية وأنابيب</td><td>150,000</td></tr>
              <tr><td>2</td><td>2026-09-04</td><td>INV-115</td><td>أجور عمالة يومية ونقل ردميات</td><td>180,000</td></tr>
              <tr><td>3</td><td>2026-09-06</td><td>INV-122</td><td>محروقات ديزل لمولد الموقع</td><td>90,000</td></tr>
              <tr style="background: #f8fafc; font-weight: bold;"><td colspan="4">إجمالي المنصرف المعتمد:</td><td style="color:#b91c1c;">420,000 ر.ي</td></tr>
            </tbody>
          </table>

          \${sigHtml}
          \${footerHtml}
        </div>
      \`;
    }

    // ==========================================
    // 4. معاينة سند قيد اليومية (journal)
    // ==========================================
    else if (docType === 'journal') {
      const headerHtml = this.renderReportHeader(journalTitle, [
        { label: 'رقم القيد', val: 'JV-2026-0038' },
        { label: 'تاريخ القيد', val: '2026-09-08' },
        { label: 'نوع القيد', val: 'قيد تسوية إثبات استحقاق' }
      ], mockCfg);

      previewBox.innerHTML = \`
        <div class="\${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; \${fontStyleAttr}">
          \${headerHtml}

          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 6px 10px; font-size: 0.78rem; margin-bottom: 8px;">
            <strong>البيان العام للقيد:</strong> إثبات استحقاق فاتورة مقاول باطن لأعمال التلييس والدهانات لمشروع برج الأمل
          </div>

          <table class="official-report-table" style="font-size: 0.74rem; margin-bottom: 10px;">
            <thead>
              <tr><th>رقم الحساب</th><th>اسم الحساب المحاسبي</th><th>مركز التكلفة</th><th>مدين (+)</th><th>دائن (-)</th><th>البيان التحليلي</th></tr>
            </thead>
            <tbody>
              <tr><td>5201</td><td>تكاليف مقاولي الباطن</td><td>CC-101</td><td style="font-weight:bold;color:#1e3a8a;">1,200,000</td><td>-</td><td>أعمال دهانات الدور الثاني</td></tr>
              <tr><td>2102</td><td>مستحقات مقاولين باطن</td><td>-</td><td>-</td><td style="font-weight:bold;color:#b91c1c;">1,200,000</td><td>استحقاق مؤسسة الصقر للمقاولات</td></tr>
              <tr style="background: #f0fdf4; font-weight: 800;">
                <td colspan="3" style="text-align: center;">المجموع الكلي للقيد (متزن):</td>
                <td style="color:#1e3a8a;">1,200,000</td>
                <td style="color:#b91c1c;">1,200,000</td>
                <td style="color:#15803d;">متطابق وموزون 100% ✓</td>
              </tr>
            </tbody>
          </table>

          \${sigHtml}
          \${footerHtml}
        </div>
      \`;
    }

    // ==========================================
    // 5. معاينة كشف حركة الصندوق (cash_movement)
    // ==========================================
    else if (docType === 'cash_movement') {
      const headerHtml = this.renderReportHeader(cashMovementTitle, [
        { label: 'الصندوق / الحساب', val: 'الصندوق الرئيسي بالعملة المحلية' },
        { label: 'الفترة', val: '2026-09-01 إلى 2026-09-08' }
      ], mockCfg);

      previewBox.innerHTML = \`
        <div class="\${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; \${fontStyleAttr}">
          \${headerHtml}

          <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 10px;">
            <div style="background: #f1f5f9; padding: 6px; border-radius: 4px; text-align: center;">
              <div style="font-size: 0.68rem; color: #64748b;">رصيد الافتتاح</div>
              <div style="font-weight: 800; font-size: 0.88rem; color: #0f2744;">2,400,000</div>
            </div>
            <div style="background: #f0fdf4; padding: 6px; border-radius: 4px; text-align: center;">
              <div style="font-size: 0.68rem; color: #15803d;">إجمالي المقبوضات (+)</div>
              <div style="font-weight: 800; font-size: 0.88rem; color: #15803d;">4,500,000</div>
            </div>
            <div style="background: #fef2f2; padding: 6px; border-radius: 4px; text-align: center;">
              <div style="font-size: 0.68rem; color: #b91c1c;">إجمالي المدفوعات (-)</div>
              <div style="font-weight: 800; font-size: 0.88rem; color: #b91c1c;">3,100,000</div>
            </div>
            <div style="background: #fdfaf2; padding: 6px; border-radius: 4px; text-align: center; border: 1px solid \${accentColor};">
              <div style="font-size: 0.68rem; color: #b8911c;">الرصيد الفعلي الحالي</div>
              <div style="font-weight: 800; font-size: 0.88rem; color: #047857;">3,800,000</div>
            </div>
          </div>

          <table class="official-report-table" style="font-size: 0.72rem; margin-bottom: 8px;">
            <thead><tr><th>التاريخ</th><th>رقم الحركة</th><th>البيان</th><th>وارد (+)</th><th>صادر (-)</th><th>الرصيد</th></tr></thead>
            <tbody>
              <tr><td>2026-09-01</td><td>RC-101</td><td>سند قبض دفعة مشروع الأمل</td><td>2,000,000</td><td>-</td><td>4,400,000</td></tr>
              <tr><td>2026-09-03</td><td>PV-201</td><td>سند صرف شراء إسمنت ومواد</td><td>-</td><td>1,200,000</td><td>3,200,000</td></tr>
              <tr><td>2026-09-06</td><td>RC-102</td><td>سند قبض دفعة فيلا الشروق</td><td>2,500,000</td><td>-</td><td>5,700,000</td></tr>
              <tr><td>2026-09-07</td><td>PV-202</td><td>سند صرف أجور عمالة موقع</td><td>-</td><td>1,900,000</td><td>3,800,000</td></tr>
            </tbody>
          </table>

          \${sigHtml}
          \${footerHtml}
        </div>
      \`;
    }

    // ==========================================
    // 6. معاينة كشف حساب عميل (client_stmt)
    // ==========================================
    else if (docType === 'client_stmt') {
      const headerHtml = this.renderReportHeader(clientStmtTitle, [
        { label: 'اسم العميل', val: 'علوي محمد باعبيد' },
        { label: 'الفترة', val: 'من 2026-01-01 إلى اليوم' }
      ], mockCfg);

      previewBox.innerHTML = \`
        <div class="\${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; \${fontStyleAttr}">
          \${headerHtml}

          \${stmtShowSummary ? \`
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px;">
            <div style="border: 1px solid #cbd5e1; border-radius: 4px; padding: 6px; text-align: center; background: #f8fafc;">
              <div style="font-size: 0.7rem; color: #64748b;">إجمالي المسحوب (مدين)</div>
              <div style="font-weight: 800; font-size: 0.95rem; color: #0f2744;">5,000,000 ر.ي</div>
            </div>
            <div style="border: 1px solid #86efac; border-radius: 4px; padding: 6px; text-align: center; background: #f0fdf4;">
              <div style="font-size: 0.7rem; color: #15803d;">إجمالي المسدد (دائن)</div>
              <div style="font-weight: 800; font-size: 0.95rem; color: #15803d;">3,500,000 ر.ي</div>
            </div>
            <div style="border: 1px solid #fca5a5; border-radius: 4px; padding: 6px; text-align: center; background: #fef2f2;">
              <div style="font-size: 0.7rem; color: #b91c1c;">الرصيد المتبقي عليه</div>
              <div style="font-weight: 800; font-size: 0.95rem; color: #b91c1c;">1,500,000 ر.ي</div>
            </div>
          </div>\` : ''}

          <table class="official-report-table" style="font-size: 0.75rem; margin-bottom: 10px;">
            <thead>
              <tr>
                <th>التاريخ</th>
                \${stmtShowRef ? \`<th>رقم السند</th>\` : ''}
                \${stmtShowNotes ? \`<th>البيان والتفاصيل</th>\` : ''}
                <th>مدين (عله)</th>
                <th>دائن (له)</th>
                \${stmtShowRunningBal ? \`<th>الرصيد التراكمي</th>\` : ''}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>2026-01-15</td>
                \${stmtShowRef ? \`<td>CNT-01</td>\` : ''}
                \${stmtShowNotes ? \`<td>مستخلص أعمال صب خرسانة الدور الأول</td>\` : ''}
                <td style="color: #0f2744;">3,000,000</td>
                <td>0</td>
                \${stmtShowRunningBal ? \`<td style="font-weight: bold; color: #b91c1c;">3,000,000</td>\` : ''}
              </tr>
              <tr>
                <td>2026-02-01</td>
                \${stmtShowRef ? \`<td>RC-101</td>\` : ''}
                \${stmtShowNotes ? \`<td>دفعة نقدية مسددة في الصندوق</td>\` : ''}
                <td>0</td>
                <td style="color: #059669;">2,000,000</td>
                \${stmtShowRunningBal ? \`<td style="font-weight: bold; color: #b91c1c;">1,000,000</td>\` : ''}
              </tr>
              <tr>
                <td>2026-03-10</td>
                \${stmtShowRef ? \`<td>CNT-02</td>\` : ''}
                \${stmtShowNotes ? \`<td>مستخلص تشطيبات وبناء الدور الثاني</td>\` : ''}
                <td style="color: #0f2744;">2,000,000</td>
                <td>0</td>
                \${stmtShowRunningBal ? \`<td style="font-weight: bold; color: #b91c1c;">3,000,000</td>\` : ''}
              </tr>
              <tr>
                <td>2026-04-05</td>
                \${stmtShowRef ? \`<td>RC-105</td>\` : ''}
                \${stmtShowNotes ? \`<td>سداد بحوالة بنكية</td>\` : ''}
                <td>0</td>
                <td style="color: #059669;">1,500,000</td>
                \${stmtShowRunningBal ? \`<td style="font-weight: bold; color: #b91c1c;">1,500,000</td>\` : ''}
              </tr>
            </tbody>
          </table>

          \${stmtShowMatch ? \`
          <div style="background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 4px; padding: 6px 10px; font-size: 0.72rem; color: #475569; display: flex; justify-content: space-between; align-items: center; margin-top: 8px;">
            <span>أقر أنا العميل المذكور أعلاه بصحة الرصيد الموضح وقدره (1,500,000 ر.ي):</span>
            <span>توقيع العميل: ..........................</span>
          </div>\` : ''}

          \${sigHtml}
          \${footerHtml}
        </div>
      \`;
    }

    // ==========================================
    // 7. معاينة كشف حساب مورد (supplier_stmt)
    // ==========================================
    else if (docType === 'supplier_stmt') {
      const headerHtml = this.renderReportHeader(supplierStmtTitle, [
        { label: 'اسم المورد', val: 'شركة الحديد والصلب للتجارة' },
        { label: 'تاريخ التقرير', val: '2026-09-08' }
      ], mockCfg);

      previewBox.innerHTML = \`
        <div class="\${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; \${fontStyleAttr}">
          \${headerHtml}

          <table class="official-report-table" style="font-size: 0.75rem; margin-bottom: 10px;">
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>رقم الفاتورة/السند</th>
                <th>البيان والمشتريات</th>
                <th>مستحق له (دائن)</th>
                <th>المدفوع له (مدين)</th>
                <th>الرصيد المتبقي</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>2026-02-10</td>
                <td>INV-301</td>
                <td>توريد 15 طن حديد تسليح تركي</td>
                <td style="color: #dc2626;">4,500,000</td>
                <td>0</td>
                <td style="font-weight: bold; color: #dc2626;">4,500,000</td>
              </tr>
              <tr>
                <td>2026-02-25</td>
                <td>PV-201</td>
                <td>دفعة سند صرف نقدي للمورد</td>
                <td>0</td>
                <td style="color: #059669;">3,000,000</td>
                <td style="font-weight: bold; color: #dc2626;">1,500,000</td>
              </tr>
            </tbody>
          </table>

          \${sigHtml}
          \${footerHtml}
        </div>
      \`;
    }

    // ==========================================
    // 8. معاينة تقرير المشروع الشامل (project)
    // ==========================================
    else if (docType === 'project') {
      const headerHtml = this.renderReportHeader(projReportTitle, [
        { label: 'كود المشروع', val: 'PRJ-2026-01' },
        { label: 'اسم المشروع', val: 'برج الأمل السكني' }
      ], mockCfg);

      previewBox.innerHTML = \`
        <div class="\${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; \${fontStyleAttr}">
          \${headerHtml}

          \${projShowKpi ? \`
          <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 10px;">
            <div style="background: #f1f5f9; padding: 6px; border-radius: 4px; text-align: center;">
              <div style="font-size: 0.68rem; color: #64748b;">قيمة العقد</div>
              <div style="font-weight: 800; font-size: 0.88rem; color: #0f2744;">25,000,000</div>
            </div>
            <div style="background: #fef2f2; padding: 6px; border-radius: 4px; text-align: center;">
              <div style="font-size: 0.68rem; color: #b91c1c;">التكلفة الفعلية</div>
              <div style="font-weight: 800; font-size: 0.88rem; color: #b91c1c;">12,400,000</div>
            </div>
            <div style="background: #f0fdf4; padding: 6px; border-radius: 4px; text-align: center;">
              <div style="font-size: 0.68rem; color: #15803d;">المسدد من العميل</div>
              <div style="font-weight: 800; font-size: 0.88rem; color: #15803d;">15,000,000</div>
            </div>
            <div style="background: #fdfaf2; padding: 6px; border-radius: 4px; text-align: center; border: 1px solid \${accentColor};">
              <div style="font-size: 0.68rem; color: #b8911c;">نسبة الإنجاز</div>
              <div style="font-weight: 800; font-size: 0.88rem; color: #047857;">65%</div>
            </div>
          </div>\` : ''}

          \${projShowExp ? \`
          <div style="font-weight: bold; font-size: 0.78rem; color: #0f2744; margin: 8px 0 4px 0; border-right: 3px solid \${accentColor}; padding-right: 4px;">المصروفات المباشرة للمشروع:</div>
          <table class="official-report-table" style="font-size: 0.72rem; margin-bottom: 8px;">
            <thead><tr><th>التاريخ</th><th>البند</th><th>المبلغ</th><th>طريقة الدفع</th></tr></thead>
            <tbody>
              <tr><td>2026-02-01</td><td>حفريات وتجهيز موقع</td><td>1,500,000</td><td>نقدي</td></tr>
              <tr><td>2026-03-10</td><td>صب القواعد والأساسات</td><td>4,800,000</td><td>تحويل</td></tr>
            </tbody>
          </table>\` : ''}

          \${projShowBills ? \`
          <div style="font-weight: bold; font-size: 0.78rem; color: #0f2744; margin: 8px 0 4px 0; border-right: 3px solid #3b82f6; padding-right: 4px;">فواتير وتوريدات الموردين:</div>
          <table class="official-report-table" style="font-size: 0.72rem; margin-bottom: 8px;">
            <thead><tr><th>التاريخ</th><th>المورد</th><th>البيان</th><th>المبلغ</th><th>الحالة</th></tr></thead>
            <tbody>
              <tr><td>2026-02-20</td><td>شركة الأسمنت</td><td>إسمنت بورتلاندي</td><td>3,200,000</td><td>مسدد بالكامل</td></tr>
              <tr><td>2026-03-15</td><td>مؤسسة الحديد</td><td>حديد تسليح 16 ملم</td><td>2,900,000</td><td>مسدد جزئياً</td></tr>
            </tbody>
          </table>\` : ''}

          \${projShowPay ? \`
          <div style="font-weight: bold; font-size: 0.78rem; color: #0f2744; margin: 8px 0 4px 0; border-right: 3px solid #059669; padding-right: 4px;">مقبوضات ودفعات العميل:</div>
          <table class="official-report-table" style="font-size: 0.72rem; margin-bottom: 8px;">
            <thead><tr><th>التاريخ</th><th>رقم السند</th><th>المبلغ المقبوض</th><th>البيان</th></tr></thead>
            <tbody>
              <tr><td>2026-01-20</td><td>RC-101</td><td>5,000,000</td><td>دفعة مقدمة عند توقيع العقد</td></tr>
              <tr><td>2026-03-01</td><td>RC-105</td><td>10,000,000</td><td>مستخلص إنجاز الأساسات</td></tr>
            </tbody>
          </table>\` : ''}

          \${projShowBoq ? \`
          <div style="font-weight: bold; font-size: 0.78rem; color: #0f2744; margin: 8px 0 4px 0; border-right: 3px solid #8b5cf6; padding-right: 4px;">جدول الكميات والمواصفات (BoQ):</div>
          <table class="official-report-table" style="font-size: 0.72rem; margin-bottom: 8px;">
            <thead><tr><th>البند</th><th>الوحدة</th><th>الكمية المخططة</th><th>المنجز الفعلي</th><th>نسبة البند</th></tr></thead>
            <tbody>
              <tr><td>خرسانة مسلحة للقواعد C30</td><td>م3</td><td>240</td><td>240</td><td>100%</td></tr>
              <tr><td>أعمال المباني والبلوك 20سم</td><td>م2</td><td>1,200</td><td>780</td><td>65%</td></tr>
            </tbody>
          </table>\` : ''}

          \${sigHtml}
          \${footerHtml}
        </div>
      \`;
    }

    // ==========================================
    // 9. معاينة العقد الإنشائي الرسمي (contract)
    // ==========================================
    else if (docType === 'contract') {
      const headerHtml = this.renderReportHeader(contractTitle, [
        { label: 'رقم العقد', val: 'CNT-2026-001' },
        { label: 'تاريخ الإبرام', val: '2026-01-15' },
        { label: 'مدة التنفيذ', val: '12 شهراً تقويمياً' }
      ], mockCfg);

      previewBox.innerHTML = \`
        <div class="\${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; \${fontStyleAttr}">
          \${headerHtml}

          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 8px; font-size: 0.76rem; line-height: 1.6; margin-bottom: 10px;">
            <p style="margin: 0 0 6px 0;"><strong>الطرف الأول (المقاول المنفذ):</strong> شركة رواسي عدن للهندسة والمقاولات العامة - عدن، ممثلة بالمدير العام.</p>
            <p style="margin: 0;"><strong>الطرف الثاني (المالك / صاحب العمل):</strong> الأخ/ علوي محمد باعبيد - مشروع إنشاء برج الأمل السكني والتجاري.</p>
          </div>

          <table class="official-report-table" style="font-size: 0.74rem; margin-bottom: 10px;">
            <thead><tr><th>مادة العقد</th><th>البيان والتفصيل القانوني والهندسي</th><th>القيمة / النسبة</th></tr></thead>
            <tbody>
              <tr><td>المادة 1: موضوع العقد</td><td>تنفيذ وتسليم الأعمال الإنشائية والمعمارية لمبنى سكني من 7 طوابق تسليم مفتاح</td><td>كامل المخططات</td></tr>
              <tr><td>المادة 2: القيمة الإجمالية</td><td>المبلغ المتفق عليه شاملاً المواد والمعدات واليد العاملة</td><td style="font-weight:bold;color:#1e3a8a;">25,000,000 ر.ي</td></tr>
              <tr><td>المادة 3: الدفعة المقدمة</td><td>تصرف عند توقيع العقد واستلام الموقع خالي من الموانع</td><td>20% (5,000,000 ر.ي)</td></tr>
              <tr><td>المادة 4: ضمان الصيانة</td><td>استقطاع 10% من كل مستخلص حتى الاستلام النهائي بعد سنة</td><td>10% تأمين صيانة</td></tr>
            </tbody>
          </table>

          \${sigHtml}
          \${footerHtml}
        </div>
      \`;
    }

    // ==========================================
    // 10. معاينة شهادة إنجاز ومستخلص جاري IPC (ipc)
    // ==========================================
    else if (docType === 'ipc') {
      const headerHtml = this.renderReportHeader(ipcTitle, [
        { label: 'رقم المستخلص', val: 'IPC-03 (جاري)' },
        { label: 'المشروع', val: 'برج الأمل السكني' },
        { label: 'الفترة', val: '2026-08-01 إلى 2026-08-31' }
      ], mockCfg);

      previewBox.innerHTML = \`
        <div class="\${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; \${fontStyleAttr}">
          \${headerHtml}

          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 10px;">
            <div style="background: #f1f5f9; padding: 6px; border-radius: 4px; text-align: center;">
              <div style="font-size: 0.68rem; color: #64748b;">إجمالي الأعمال التراكمية</div>
              <div style="font-weight: 800; font-size: 0.88rem; color: #0f2744;">16,250,000 ر.ي</div>
            </div>
            <div style="background: #fef2f2; padding: 6px; border-radius: 4px; text-align: center;">
              <div style="font-size: 0.68rem; color: #b91c1c;">خصم المستخلصات السابقة</div>
              <div style="font-weight: 800; font-size: 0.88rem; color: #b91c1c;">10,000,000 ر.ي</div>
            </div>
            <div style="background: #f0fdf4; padding: 6px; border-radius: 4px; text-align: center;">
              <div style="font-size: 0.68rem; color: #15803d;">قيمة الأعمال الحالية</div>
              <div style="font-weight: 800; font-size: 0.88rem; color: #15803d;">6,250,000 ر.ي</div>
            </div>
          </div>

          \${projShowRetentions ? \`
          <table class="official-report-table" style="font-size: 0.74rem; margin-bottom: 8px;">
            <thead><tr><th>البند الحسابي للمستخلص</th><th>المعادلة</th><th>المبلغ المحقق</th></tr></thead>
            <tbody>
              <tr><td>قيمة أعمال هذا المستخلص (Gross)</td><td>الكميات المنفذة × السعر التعاقدي</td><td style="font-weight:bold;">6,250,000 ر.ي</td></tr>
              <tr><td>استقطاع استرداد الدفعة المقدمة (20%)</td><td>خصم نسبة الاسترداد</td><td style="color:#b91c1c;">(1,250,000) ر.ي</td></tr>
              <tr><td>استقطاع ضمان الصيانة وحسن التنفيذ (10%)</td><td>تأمين محجوز حتى الاستلام النهائي</td><td style="color:#b91c1c;">(625,000) ر.ي</td></tr>
              <tr style="background:#f0fdf4;font-weight:bold;font-size:0.85rem"><td>صافي المبلغ المستحق للصرف للمقاول (Net Payable)</td><td>الصافي النهائي</td><td style="color:#047857;">4,375,000 ر.ي</td></tr>
            </tbody>
          </table>\` : ''}

          \${sigHtml}
          \${footerHtml}
        </div>
      \`;
    }

    // ==========================================
    // 11. معاينة عرض السعر الرسمي (quotation)
    // ==========================================
    else if (docType === 'quotation') {
      const headerHtml = this.renderReportHeader(quotationTitle, [
        { label: 'رقم العرض', val: 'QUO-2026-088' },
        { label: 'العميل المستهدف', val: 'الشيخ عبد الله القحطاني' },
        { label: 'مدة السريان', val: '30 يوماً من تاريخه' }
      ], mockCfg);

      previewBox.innerHTML = \`
        <div class="\${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; \${fontStyleAttr}">
          \${headerHtml}

          <div style="font-size: 0.74rem; margin-bottom: 8px; color: #475569;">
            بناءً على طلبكم الكريم، يسر شركة رواسي عدن تقديم عرض الأسعار والمواصفات التالي لأعمال الهيكل الخرساني والتشطيبات:
          </div>

          <table class="official-report-table" style="font-size: 0.73rem; margin-bottom: 10px;">
            <thead><tr><th>البند</th><th>المواصفات الفنية</th><th>الوحدة</th><th>الكمية</th><th>السعر الإفرادي</th><th>الإجمالي</th></tr></thead>
            <tbody>
              <tr><td>1. أعمال صب الخرسانة المسلحة</td><td>خرسانة مقاومة للأملاح B350 مع الفحص المخبري</td><td>م3</td><td>180</td><td>45,000</td><td>8,100,000</td></tr>
              <tr><td>2. حديد التسليح عالي المقاومة</td><td>حديد تركي معتمد مقاسات 12، 16، 20 ملم</td><td>طن</td><td>14</td><td>650,000</td><td>9,100,000</td></tr>
              <tr><td>3. أعمال البلوك الإسمنتي العازل</td><td>بلوك مجوف أوتوماتيكي مع المونة والمطاط</td><td>حبة</td><td>8,000</td><td>150</td><td>1,200,000</td></tr>
              <tr style="background:#fdfaf2;font-weight:bold;font-size:0.85rem"><td colspan="5">إجمالي قيمة عرض السعر:</td><td style="color:#047857;">18,400,000 ر.ي</td></tr>
            </tbody>
          </table>

          \${sigHtml}
          \${footerHtml}
        </div>
      \`;
    }

    // ==========================================
    // 12. معاينة استمارة أمر التغيير (change_order)
    // ==========================================
    else if (docType === 'change_order') {
      const headerHtml = this.renderReportHeader(changeOrderTitle, [
        { label: 'رقم أمر التغيير', val: 'CO-02' },
        { label: 'المشروع', val: 'برج الأمل السكني' },
        { label: 'الأثر المالي', val: '+ 1,800,000 ر.ي' }
      ], mockCfg);

      previewBox.innerHTML = \`
        <div class="\${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; \${fontStyleAttr}">
          \${headerHtml}

          <table class="voucher-grid-table" style="font-size: 0.74rem; margin-bottom: 10px;">
            <tr><td class="label-cell" style="width:30%;">موضوع التعديل المطلوب:</td><td class="val-cell">تعديل مواصفات أرضيات الصالات من سيراميك عادي إلى رخام إسباني مستورد</td></tr>
            <tr><td class="label-cell">سبب ومبررات التغيير:</td><td class="val-cell">بناءً على طلب المالك الخطي المرفق لتحسين المواصفات الفندقية للمبنى</td></tr>
            <tr><td class="label-cell">التكلفة المالية الإضافية:</td><td class="val-cell" style="font-weight:bold;color:#b91c1c;">1,800,000 ر.ي (تضاف لقيمة العقد الإجمالية)</td></tr>
            <tr><td class="label-cell">التمديد الزمني المطلوب:</td><td class="val-cell">إضافة 14 يوماً تقويمياً للمدة الأصلية للعقد</td></tr>
          </table>

          \${sigHtml}
          \${footerHtml}
        </div>
      \`;
    }

    // ==========================================
    // 13. معاينة التقرير الميداني اليومي (daily_report)
    // ==========================================
    else if (docType === 'daily_report') {
      const headerHtml = this.renderReportHeader(dailyReportTitle, [
        { label: 'المشروع', val: 'برج الأمل السكني' },
        { label: 'تاريخ اليوم', val: '2026-09-08' },
        { label: 'حالة الطقس', val: 'مشمس معتدل - 31°C' }
      ], mockCfg);

      previewBox.innerHTML = \`
        <div class="\${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; \${fontStyleAttr}">
          \${headerHtml}

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px;">
            <div style="background:#f8fafc; border:1px solid #e2e8f0; padding:6px; border-radius:4px; font-size:0.73rem;">
              <strong>👷 العمالة الفنية بالموقع:</strong> مهندس موقع (1)، مساح (1)، حدادين (6)، نجارين (8)، عمال عاديين (12).
            </div>
            <div style="background:#f8fafc; border:1px solid #e2e8f0; padding:6px; border-radius:4px; font-size:0.73rem;">
              <strong>🚜 المعدات والآليات:</strong> مضخة خرسانة 42م، سيارات قلاب (2)، مولد كهربائي 150KVA.
            </div>
          </div>

          <table class="official-report-table" style="font-size: 0.72rem; margin-bottom: 8px;">
            <thead><tr><th>م</th><th>الأعمال المنجزة اليوم</th><th>الموقع / الدور</th><th>نسبة إنجاز اليوم</th><th>الملاحظات الفنية</th></tr></thead>
            <tbody>
              <tr><td>1</td><td>صب أعمدة الدور الثالث بالخرسانة الجاهزة</td><td>المنطقة الشمالية</td><td>100%</td><td>تم أخذ مكعبات للفحص المخبري 7 و 28 يوم</td></tr>
              <tr><td>2</td><td>معالجة ورش خرسانة سقف الدور الثاني بالماء</td><td>كامل المسطح</td><td>مستمر</td><td>مرتان يومياً صباحاً ومساءً</td></tr>
            </tbody>
          </table>

          \${sigHtml}
          \${footerHtml}
        </div>
      \`;
    }

    // ==========================================
    // 14. معاينة محضر الاستلام والمخالصة (handover)
    // ==========================================
    else if (docType === 'handover') {
      const headerHtml = this.renderReportHeader(handoverTitle, [
        { label: 'المشروع', val: 'فيلا الشروق السكنية' },
        { label: 'نوع الاستلام', val: 'استلام ابتدائي نهائي وتسليم مفتاح' },
        { label: 'التاريخ', val: '2026-09-08' }
      ], mockCfg);

      previewBox.innerHTML = \`
        <div class="\${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; \${fontStyleAttr}">
          \${headerHtml}

          <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 4px; padding: 8px; font-size: 0.75rem; line-height: 1.6; margin-bottom: 10px;">
            اجتمعت في هذا اليوم لجنة الفحص والمعاينة المشتركة المكونة من استشاري المشروع وممثل المالك وممثل شركة رواسي عدن، وتمت معاينة كافة الأعمال المدنية والمعمارية والكهربائية والصحية، وأقرت اللجنة بمطابقتها للمخططات والشروط والمواصفات المعتمدة، ولا توجد أي ملاحظات جوهرية تحول دون تشغيل واستخدام المبنى.
          </div>

          <table class="official-report-table" style="font-size: 0.73rem; margin-bottom: 8px;">
            <thead><tr><th>البند</th><th>حالة المطابقة</th><th>المخالصة المالية</th></tr></thead>
            <tbody>
              <tr><td>الهيكل الإنشائي والتشطيبات</td><td>مطابق 100% وخالي من العيوب</td><td>مسدد بالكامل وفق العقد</td></tr>
              <tr><td>الضمانات والتأمين</td><td>سارية المفعول لمدة عام كامل للصيانة</td><td>تم تسليم شهادة الضمان للمالك</td></tr>
            </tbody>
          </table>

          \${sigHtml}
          \${footerHtml}
        </div>
      \`;
    }

    // ==========================================
    // 15. معاينة مسير الرواتب والأجور (payroll)
    // ==========================================
    else if (docType === 'payroll') {
      const headerHtml = this.renderReportHeader(payrollTitle, [
        { label: 'شهر الاستحقاق', val: 'أغسطس 2026' },
        { label: 'عدد الموظفين', val: '18 موظفاً ومهندساً' }
      ], mockCfg);

      previewBox.innerHTML = \`
        <div class="\${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; \${fontStyleAttr}">
          \${headerHtml}

          <table class="official-report-table" style="font-size: 0.71rem; margin-bottom: 8px;">
            <thead>
              <tr>
                <th>كود الموظف</th>
                <th>اسم الموظف</th>
                <th>المسمى الوظيفي</th>
                <th>الأساسي</th>
                \${payrollShowAllowances ? \`<th>إجمالي البدلات</th>\` : ''}
                \${payrollShowDeductions ? \`<th>الاستقطاعات</th>\` : ''}
                <th>صافي الراتب</th>
                \${payrollShowEmpSignature ? \`<th>توقيع الاستلام</th>\` : ''}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>EMP-01</td>
                <td>م. أحمد سالم باراس</td>
                <td>مدير المشاريع</td>
                <td>450,000</td>
                \${payrollShowAllowances ? \`<td>120,000</td>\` : ''}
                \${payrollShowDeductions ? \`<td>(15,000)</td>\` : ''}
                <td style="font-weight:bold;color:#047857;">555,000 ر.ي</td>
                \${payrollShowEmpSignature ? \`<td style="font-size:0.65rem;color:#94a3b8;">.....................</td>\` : ''}
              </tr>
              <tr>
                <td>EMP-02</td>
                <td>أ. فهد ناصر عثمان</td>
                <td>محاسب مالي أول</td>
                <td>320,000</td>
                \${payrollShowAllowances ? \`<td>80,000</td>\` : ''}
                \${payrollShowDeductions ? \`<td>(10,000)</td>\` : ''}
                <td style="font-weight:bold;color:#047857;">390,000 ر.ي</td>
                \${payrollShowEmpSignature ? \`<td style="font-size:0.65rem;color:#94a3b8;">.....................</td>\` : ''}
              </tr>
              <tr style="background:#f0fdf4;font-weight:bold;">
                <td colspan="3">إجمالي مسير الرواتب المستحق:</td>
                <td>770,000</td>
                \${payrollShowAllowances ? \`<td>200,000</td>\` : ''}
                \${payrollShowDeductions ? \`<td>(25,000)</td>\` : ''}
                <td style="color:#047857;">945,000 ر.ي</td>
                \${payrollShowEmpSignature ? \`<td>✓ معتمد</td>\` : ''}
              </tr>
            </tbody>
          </table>

          \${sigHtml}
          \${footerHtml}
        </div>
      \`;
    }

    // ==========================================
    // 16. معاينة الأرباح والخسائر (profit_loss)
    // ==========================================
    else if (docType === 'profit_loss') {
      const headerHtml = this.renderReportHeader(plTitle, [
        { label: 'الفترة المالية', val: '2026-01-01 إلى 2026-09-08' },
        { label: 'الحالة', val: 'معتمد رسمياً' }
      ], mockCfg);

      previewBox.innerHTML = \`
        <div class="\${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; \${fontStyleAttr}">
          \${headerHtml}

          \${finShowKpi ? \`
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px;">
            <div style="border: 1px solid #86efac; border-radius: 4px; padding: 8px; text-align: center; background: #f0fdf4;">
              <div style="font-size: 0.7rem; color: #15803d;">إجمالي الإيرادات</div>
              <div style="font-weight: 800; font-size: 1.05rem; color: #15803d;">35,000,000 ر.ي</div>
            </div>
            <div style="border: 1px solid #fca5a5; border-radius: 4px; padding: 8px; text-align: center; background: #fef2f2;">
              <div style="font-size: 0.7rem; color: #b91c1c;">إجمالي المصروفات</div>
              <div style="font-weight: 800; font-size: 1.05rem; color: #b91c1c;">22,500,000 ر.ي</div>
            </div>
            <div style="border: 1.5px solid \${accentColor}; border-radius: 4px; padding: 8px; text-align: center; background: #fdfaf2;">
              <div style="font-size: 0.7rem; color: #b8911c;">صافي الأرباح التشغيلية</div>
              <div style="font-weight: 800; font-size: 1.15rem; color: #047857;">12,500,000 ر.ي</div>
            </div>
          </div>\` : ''}

          \${finShowExpBreak ? \`
          <div style="font-weight: bold; font-size: 0.78rem; color: #0f2744; margin: 8px 0 4px 0; border-right: 3px solid \${accentColor}; padding-right: 4px;">توزيع بنود المصروفات ونسبتها:</div>
          <table class="official-report-table" style="font-size: 0.75rem; margin-bottom: 10px;">
            <thead><tr><th>بند المصروف</th><th>المبلغ</th><th>النسبة من الإجمالي</th></tr></thead>
            <tbody>
              <tr><td>مواد بناء وتوريدات خرسانة وحديد</td><td>14,500,000 ر.ي</td><td>64.4%</td></tr>
              <tr><td>أجور عمالة ومهندسين ومقاولين باطن</td><td>5,500,000 ر.ي</td><td>24.4%</td></tr>
              <tr><td>مصروفات تشغيلية ومحروقات ونقليات</td><td>2,500,000 ر.ي</td><td>11.2%</td></tr>
            </tbody>
          </table>\` : ''}

          \${finShowReconcile ? \`
          <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:4px; padding:4px 8px; font-size:0.72rem; color:#15803d; margin-bottom:8px;">
            ✓ مطابقة تامة مع سجل القيود المحاسبية وميزان المراجعة الصادر لنفس الفترة.
          </div>\` : ''}

          \${sigHtml}
          \${footerHtml}
        </div>
      \`;
    }

    // ==========================================
    // 17. معاينة الميزانية العمومية (balance_sheet)
    // ==========================================
    else if (docType === 'balance_sheet') {
      const headerHtml = this.renderReportHeader(balanceSheetTitle, [
        { label: 'تاريخ الميزانية', val: '2026-09-08' },
        { label: 'النوع', val: 'مركز مالي ختامي' }
      ], mockCfg);

      previewBox.innerHTML = \`
        <div class="\${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; \${fontStyleAttr}">
          \${headerHtml}

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px;">
            <div>
              <div style="font-weight: bold; font-size: 0.78rem; color: #0f2744; margin-bottom: 4px; border-right: 3px solid #059669; padding-right: 4px;">الأصول والموجودات (Assets)</div>
              <table class="official-report-table" style="font-size: 0.72rem;">
                <tbody>
                  <tr><td>نقدية بالصندوق والبنوك</td><td style="font-weight: bold;">8,500,000</td></tr>
                  <tr><td>مستحقات على العملاء</td><td style="font-weight: bold;">12,000,000</td></tr>
                  <tr><td>أصول ثابتة ومعدات</td><td style="font-weight: bold;">15,000,000</td></tr>
                  <tr style="background: #f0fdf4; font-weight: bold;"><td>إجمالي الأصول:</td><td style="color: #047857;">35,500,000 ر.ي</td></tr>
                </tbody>
              </table>
            </div>
            <div>
              <div style="font-weight: bold; font-size: 0.78rem; color: #0f2744; margin-bottom: 4px; border-right: 3px solid #dc2626; padding-right: 4px;">الالتزامات وحقوق الملكية</div>
              <table class="official-report-table" style="font-size: 0.72rem;">
                <tbody>
                  <tr><td>مستحقات للموردين</td><td style="font-weight: bold;">5,500,000</td></tr>
                  <tr><td>أرباح مرحلة ودورات سابقة</td><td style="font-weight: bold;">10,000,000</td></tr>
                  <tr><td>رأس المال وحقوق الملكية</td><td style="font-weight: bold;">20,000,000</td></tr>
                  <tr style="background: #fef2f2; font-weight: bold;"><td>إجمالي الالتزامات والملكية:</td><td style="color: #b91c1c;">35,500,000 ر.ي</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          \${sigHtml}
          \${footerHtml}
        </div>
      \`;
    }

    // ==========================================
    // 18. معاينة قائمة التدفقات النقدية (cash_flow)
    // ==========================================
    else if (docType === 'cash_flow') {
      const headerHtml = this.renderReportHeader(cashFlowTitle, [
        { label: 'السنة المالية', val: '2026' },
        { label: 'المعيار', val: 'IAS 7 - الطريقة المباشرة' }
      ], mockCfg);

      previewBox.innerHTML = \`
        <div class="\${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; \${fontStyleAttr}">
          \${headerHtml}

          <table class="official-report-table" style="font-size: 0.74rem; margin-bottom: 10px;">
            <thead><tr><th>بيان التدفق النقدي</th><th>مقبوضات (+)</th><th>مدفوعات (-)</th><th>صافي التدفق</th></tr></thead>
            <tbody>
              <tr style="background:#f8fafc;font-weight:bold;"><td colspan="4">أولاً: التدفقات النقدية من الأنشطة التشغيلية:</td></tr>
              <tr><td>مقبوضات دفعات ومستخلصات العملاء</td><td>18,500,000</td><td>-</td><td>+18,500,000</td></tr>
              <tr><td>مدفوعات الموردين ومقاولي الباطن</td><td>-</td><td>11,200,000</td><td>(11,200,000)</td></tr>
              <tr><td>رواتب وأجور ومصروفات إدارية</td><td>-</td><td>3,100,000</td><td>(3,100,000)</td></tr>
              <tr style="background:#f0fdf4;font-weight:bold;"><td>صافي النقدية من الأنشطة التشغيلية:</td><td colspan="3" style="color:#047857;text-align:left;">+ 4,200,000 ر.ي</td></tr>
              
              <tr style="background:#f8fafc;font-weight:bold;"><td colspan="4">ثانياً: التدفقات النقدية من الأنشطة الاستثمارية:</td></tr>
              <tr><td>شراء معدات وآليات ومولدات موقع</td><td>-</td><td>1,500,000</td><td>(1,500,000)</td></tr>
              <tr style="background:#fef2f2;font-weight:bold;"><td>صافي النقدية للأنشطة الاستثمارية:</td><td colspan="3" style="color:#b91c1c;text-align:left;">(1,500,000) ر.ي</td></tr>

              <tr style="background:#fdfaf2;font-weight:bold;font-size:0.85rem;"><td colspan="3">صافي الزيادة في النقدية خلال الفترة:</td><td style="color:#047857;">+ 2,700,000 ر.ي</td></tr>
            </tbody>
          </table>

          \${sigHtml}
          \${footerHtml}
        </div>
      \`;
    }

    // ==========================================
    // 19. معاينة ميزان المراجعة (trial_balance)
    // ==========================================
    else if (docType === 'trial_balance') {
      const headerHtml = this.renderReportHeader(trialBalanceTitle, [
        { label: 'المستوى المحاسبي', val: 'جميع الحسابات (مستوى 3 و 4)' },
        { label: 'تاريخ الميزان', val: '2026-09-08' }
      ], mockCfg);

      previewBox.innerHTML = \`
        <div class="\${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; \${fontStyleAttr}">
          \${headerHtml}

          <table class="official-report-table" style="font-size: 0.72rem; margin-bottom: 8px;">
            <thead>
              <tr><th>رقم الحساب</th><th>اسم الحساب المحاسبي</th><th>النوع</th><th>مدين الفترة</th><th>دائن الفترة</th><th>رصيد مدين</th><th>رصيد دائن</th></tr>
            </thead>
            <tbody>
              <tr><td>1101</td><td>الصندوق الرئيسي - نقدية</td><td>أصول</td><td>6,500,000</td><td>4,200,000</td><td style="font-weight:bold;">2,300,000</td><td>-</td></tr>
              <tr><td>1102</td><td>البنك الأهلي اليمني</td><td>أصول</td><td>12,000,000</td><td>8,000,000</td><td style="font-weight:bold;">4,000,000</td><td>-</td></tr>
              <tr><td>1201</td><td>العملاء التجاريين</td><td>أصول</td><td>15,000,000</td><td>9,500,000</td><td style="font-weight:bold;">5,500,000</td><td>-</td></tr>
              <tr><td>2101</td><td>موردو المواد والمعدات</td><td>خصوم</td><td>4,000,000</td><td>7,500,000</td><td>-</td><td style="font-weight:bold;">3,500,000</td></tr>
              <tr><td>3101</td><td>رأس المال المدفوع</td><td>ملكية</td><td>-</td><td>8,300,000</td><td>-</td><td style="font-weight:bold;">8,300,000</td></tr>
              <tr style="background:#f0fdf4;font-weight:900;">
                <td colspan="3" style="text-align:center;">إجمالي ميزان المراجعة:</td>
                <td>37,500,000</td><td>37,500,000</td>
                <td style="color:#047857;">11,800,000</td>
                <td style="color:#047857;">11,800,000</td>
              </tr>
            </tbody>
          </table>

          \${sigHtml}
          \${footerHtml}
        </div>
      \`;
    }

    // ==========================================
    // 20. معاينة جرد وتقييم المخزون (inventory)
    // ==========================================
    else if (docType === 'inventory') {
      const headerHtml = this.renderReportHeader(inventoryTitle, [
        { label: 'المستودع', val: 'مستودع المواد الإنشائية الرئيسي - المعلا' },
        { label: 'تاريخ الجرد', val: '2026-09-08' }
      ], mockCfg);

      previewBox.innerHTML = \`
        <div class="\${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; \${fontStyleAttr}">
          \${headerHtml}

          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 10px;">
            <div style="background:#eff6ff; border:1px solid #bfdbfe; padding:6px; border-radius:4px; text-align:center;">
              <div style="font-size:0.68rem; color:#1e40af;">عدد الأصناف المجرودة</div>
              <div style="font-weight:800; font-size:0.92rem; color:#1e3a8a;">42 صنفاً معتمداً</div>
            </div>
            <div style="background:#f0fdf4; border:1px solid #bbf7d0; padding:6px; border-radius:4px; text-align:center;">
              <div style="font-size:0.68rem; color:#166534;">إجمالي القيمة التقديرية (FIFO)</div>
              <div style="font-weight:800; font-size:0.92rem; color:#15803d;">8,450,000 ر.ي</div>
            </div>
            <div style="background:#fef2f2; border:1px solid #fecaca; padding:6px; border-radius:4px; text-align:center;">
              <div style="font-size:0.68rem; color:#991b1b;">الأصناف تحت حد الطلب</div>
              <div style="font-weight:800; font-size:0.92rem; color:#b91c1c;">3 أصناف بحاجة لشراء</div>
            </div>
          </div>

          <table class="official-report-table" style="font-size: 0.73rem; margin-bottom: 8px;">
            <thead><tr><th>كود الصنف</th><th>اسم المادة / الصنف</th><th>الوحدة</th><th>الكمية الفعلية</th><th>متوسط التكلفة</th><th>القيمة الإجمالية</th><th>حالة الركود</th></tr></thead>
            <tbody>
              <tr><td>MAT-01</td><td>إسمنت بورتلاندي عادي 50كجم</td><td>كيس</td><td>850</td><td>4,200</td><td>3,570,000</td><td>نشط وطلب مستمر</td></tr>
              <tr><td>MAT-02</td><td>حديد تسليح سابك 16 ملم</td><td>طن</td><td>5.5</td><td>620,000</td><td>3,410,000</td><td>نشط</td></tr>
              <tr><td>MAT-03</td><td>أنابيب سباكة PVC ضغط عالي 4 بوصة</td><td>حبة</td><td>120</td><td>6,500</td><td>780,000</td><td>طبيعي</td></tr>
              <tr><td>MAT-04</td><td>دهان أساس مائي خارجي براميل</td><td>برميل</td><td>35</td><td>19,700</td><td>690,000</td><td>تحت حد الطلب</td></tr>
              <tr style="background:#f0fdf4;font-weight:bold;"><td colspan="5">إجمالي قيمة تقييم المخزون المجرود:</td><td colspan="2" style="color:#047857;">8,450,000 ر.ي</td></tr>
            </tbody>
          </table>

          \${sigHtml}
          \${footerHtml}
        </div>
      \`;
    }
  },
`;

const newContent = content.substring(0, startIndex) + replacement + content.substring(endIndex);
fs.writeFileSync(settingsJsPath, newContent, 'utf8');
console.log('Successfully updated js/settings.js with all 20 document previews and complete customization logic!');
