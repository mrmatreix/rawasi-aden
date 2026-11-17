/**
 * إدارة إعدادات النظام، بيانات الشركة، النسخ الاحتياطي، والمستخدمين والصلاحيات - رواسي عدن
 */

const Settings = {
  _cachedUsers: [],
  _selectedBackupFile: null,
  _selectedServerBackupName: null,
  _printConfig: null,
  activeTab: 'users',
  populateAdditionalRoles() {
    const select=document.getElementById('userRoleVal');
    for(const [id,role] of Object.entries(SystemCatalog.roles))if(![...select.options].some(option=>option.value===id))select.add(new Option(role.label,id),select.querySelector('option[value="custom"]'));
  },
  escapeText(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));},
  operationTitles(){return Object.fromEntries(SystemCatalog.operations.map(operation=>[operation.id,document.getElementById('operationTitle_'+operation.id)?.value||'']));},
  renderOperationSettings(titles={}) {
    const target=document.getElementById('printOperationCatalog');if(!target)return;
    target.innerHTML=SystemCatalog.operations.map(operation=>'<div class="form-group"><label for="operationTitle_'+operation.id+'">'+this.escapeText(operation.label)+'</label><input class="form-control" maxlength="200" id="operationTitle_'+operation.id+'" placeholder="'+this.escapeText(operation.label)+'" value="'+this.escapeText(titles[operation.id]||'')+'"><button type="button" class="btn btn-secondary btn-sm" onclick="Settings.previewOperation(\''+operation.id+'\')">معاينة</button></div>').join('');
  },
  getOperationTitle(id,fallback) {return this.getPrintConfig().operation_titles?.[id]||fallback;},
  applyTitleOverrides(config){const fields={receipt_title:'receipt',expense_title:'expense',custody_title:'custody',journal_title:'journal',cash_movement_title:'cash_movement',proj_report_title:'project',contract_title:'contract',ipc_title:'ipc',quotation_title:'quotation',change_order_title:'change_order',daily_report_title:'daily_report',handover_title:'handover',client_stmt_title:'client_stmt',supplier_stmt_title:'supplier_stmt',payroll_title:'payroll',pay_slip_title:'payslip',pl_title:'profit_loss',income_stmt_title:'income_statement',balance_sheet_title:'balance_sheet',cash_flow_title:'cash_flow',trial_balance_title:'trial_balance',profitability_title:'project_profitability',inventory_title:'inventory'};for(const [key,id]of Object.entries(fields))if(config.operation_titles?.[id])config[key]=config.operation_titles[id];return config;},
  previewOperation(id){this._previewDocType='operation:'+id;this.updatePrintPreview();},
  async exportOperationPreview(){await App.loadModule('excelExport');const preview=document.getElementById('printLivePreviewBox');if(preview)ExcelExporter.download('<p>معاينة توضيحية — ليست مستندًا ماليًا</p>'+preview.innerHTML,'معاينة_قالب','المعاينة',false);},

  async init() {
    if(Auth.hasPermission('settings:company')){await this.loadCompanySettings();await this.loadPrintSettings();}
    if(Auth.hasPermission('settings:users'))await this.loadUsers();
    const tabs={users:'settings:users',company:'settings:company',backup:'settings:backup',client_app:'settings:users,client_app:view'};
    if(!Auth.hasPermission(tabs[this.activeTab]||'settings:company'))this.activeTab=Object.keys(tabs).find(tab=>Auth.hasPermission(tabs[tab]))||'users';
  },

  // ================== تبديل تبويبات الإعدادات ==================
  switchTab(tab) {
    const needed={users:'settings:users',company:'settings:company',print:'settings:company',backup:'settings:backup',client_app:'settings:users,client_app:view'}[tab];
    if (needed && !Auth.hasPermission(needed)) return App.showToast('لا تملك صلاحية هذا القسم','error');
    this.activeTab = tab;
    if (typeof Sidebar !== 'undefined' && App.activeView === 'settings') Sidebar.sync('settings', tab);
    document.querySelectorAll('.settings-pane').forEach(p => p.style.display = 'none');
    document.querySelectorAll('.report-tabs-bar .report-tab-btn').forEach(b => b.classList.remove('active'));

    const activePane = document.getElementById(`pane_settings_${tab}`);
    const activeBtn = document.getElementById(`tabBtn_settings_${tab}`);
    if (activePane) activePane.style.display = 'block';
    if (activeBtn) activeBtn.classList.add('active');

    if (tab === 'users') {
      this.loadUsers();
      if (typeof Auth !== 'undefined' && Auth.updateLockTimeoutBadge) Auth.updateLockTimeoutBadge();
    } else if (tab === 'company') {
      this.loadCompanySettings();
    } else if (tab === 'print') {
      this.loadPrintSettings();
    } else if (tab === 'backup') {
      this.loadDisasterRecoveryDashboard();
      this.loadBackupRecords();
      this.loadDbConfig();
      this.loadAutoBackupSchedule();
      this.loadLogoutBackups();
      this.loadMysqlStatus();
      this.loadCloudBackupStatus();
    } else if (tab === 'client_app') {
      this.loadClientUsersForSettings();
    }
  },

  // ================== إدارة حسابات تطبيـق العمالاء ==================
  async loadClientUsersForSettings() {
    try {
      const token = localStorage.getItem('rawasi_token') || sessionStorage.getItem('rawasi_token') || localStorage.getItem('token') || '';
      const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
      const res = await fetch('/api/admin/client-users', { headers });
      const json = await res.json();
      if (!json.success) return;

      const tbody = document.getElementById('clientUsersSettingsTableBody');
      if (!tbody) return;

      tbody.innerHTML = '';
      const users = json.users || [];

      const statTot = document.getElementById('statClientUsersTotal');
      const statAct = document.getElementById('statClientUsersActive');
      if (statTot) statTot.textContent = users.length;
      if (statAct) statAct.textContent = users.filter(u => u.status === 'active').length;

      if (users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 20px;">لا توجد حسابات عملاء مسجلة حالياً للتطبيق. انقر على "+ إضافة حساب عميل جديد" لإنشاء حساب.</td></tr>';
        return;
      }

      users.forEach(u => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${u.full_name}</strong></td>
          <td>${u.client_company || u.client_name || '-'}</td>
          <td><div>${u.email}</div><small style="color: var(--text-muted);">${u.phone || ''}</small></td>
          <td><span class="badge" style="background: rgba(212, 175, 55, 0.2); color: #d4af37;">${u.role === 'owner' ? 'مالك (Owner)' : (u.role === 'manager' ? 'مدير (Manager)' : 'مطلع (Viewer)')}</span></td>
          <td><span class="badge" style="background: rgba(59, 130, 246, 0.2); color: #60a5fa;">${u.assigned_projects_count || 0} مشاريع</span></td>
          <td><span class="badge" style="background: rgba(16, 185, 129, 0.2); color: #34d399;">${u.two_factor_enabled ? 'مفعل (OTP)' : 'معطل'}</span></td>
          <td><span class="badge" style="background: ${u.status === 'active' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)'}; color: ${u.status === 'active' ? '#34d399' : '#f87171'};">${u.status === 'active' ? 'نشط' : 'موقوف'}</span></td>
          <td>
            <a href="/views/client_users.html" target="_blank" class="btn btn-secondary btn-sm" style="padding: 3px 8px; font-size: 0.8rem; color: #34d399; border-color: #10b981;">إدارة التفاصيل ↗</a>
            <button type="button" class="btn btn-secondary btn-sm" onclick="Settings.deleteClientUser(${u.id}, '${(u.full_name || '').replace(/'/g, "\\'")}')" style="padding: 3px 8px; font-size: 0.8rem; color: #f87171; border-color: rgba(239, 68, 68, 0.4); background: rgba(239, 68, 68, 0.1); margin-right: 4px;" title="حذف حساب العميل">🗑️ حذف</button>
          </td>
        `;
        tbody.appendChild(tr);
      });
    } catch (e) {
      console.error('Error loading client users for settings:', e);
    }
  },

  openClientUserModal() {
    window.open('/views/client_users.html', '_blank');
  },

  async deleteClientUser(id, fullName) {
    if (!confirm(`هل أنت تأكد من رغبتك في حذف حساب العميل (${fullName}) نهائياً؟`)) {
      return;
    }

    try {
      const token = localStorage.getItem('rawasi_token') || sessionStorage.getItem('rawasi_token') || localStorage.getItem('token') || '';
      const res = await fetch(`/api/admin/client-users/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        if (typeof App !== 'undefined' && App.showNotification) {
          App.showNotification('نجاح', data.message || 'تم حذف حساب العميل بنجاح', 'success');
        } else {
          alert(data.message || 'تم حذف حساب العميل بنجاح');
        }
        this.loadClientUsersForSettings();
      } else {
        alert(data.message || 'خطأ في حذف حساب العميل');
      }
    } catch (e) {
      console.error('Error deleting client user:', e);
    }
  },

  // ================== إعدادات الشركة ==================
  async loadCompanySettings() {
    try {
      const res = await fetch('/api/settings');
      const json = await res.json();
      if (json.success) {
        const s = json.data;
        const setVal = (id, val) => {
          const el = document.getElementById(id);
          if (el && val !== undefined && val !== null) el.value = val;
        };

        setVal('setCompanyName', s.company_name);
        setVal('setPhone1', s.phone1);
        setVal('setPhone2', s.phone2);
        setVal('setEmail', s.email);
        setVal('setAddress', s.address);
        setVal('setSlogan', s.slogan);

        // تحديث تذييل الصفحة (Footer)
        this.updateFooter(s);
      }
    } catch (e) {
      console.error('Error loading settings:', e);
    }
  },

  updateFooter(s) {
    if (!s) return;
    const phoneEl = document.getElementById('footerPhone');
    if (phoneEl) {
      if (s.phone1 && s.phone2 && s.phone1 !== s.phone2) {
        phoneEl.textContent = `${s.phone1} / ${s.phone2}`;
      } else {
        phoneEl.textContent = s.phone1 || s.phone2 || '773413937';
      }
    }
    const emailEl = document.getElementById('footerEmail');
    if (emailEl && s.email) emailEl.textContent = s.email;
    const addressEl = document.getElementById('footerAddress');
    if (addressEl && s.address) addressEl.textContent = s.address;
    const sloganEl = document.getElementById('footerSlogan');
    if (sloganEl && s.slogan) sloganEl.textContent = s.slogan;
  },

  async saveCompanySettings(e) {
    if (e) e.preventDefault();
    const updates = {
      company_name: document.getElementById('setCompanyName')?.value,
      phone1: document.getElementById('setPhone1')?.value,
      phone2: document.getElementById('setPhone2')?.value,
      email: document.getElementById('setEmail')?.value,
      address: document.getElementById('setAddress')?.value,
      slogan: document.getElementById('setSlogan')?.value
    };

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      const data = await res.json();
      if (data.success) {
        this.updateFooter(updates);
        App.showToast('تم حفظ وتحديث بيانات الشركة بنجاح وتم التأكيد في قاعدة البيانات!', 'success');
      }
    } catch (e) {
      App.showToast('تعذر حفظ الإعدادات', 'error');
    }
  },

  _previewDocType: 'receipt',

  // ================== تخصيص ورقة الطباعة والتقارير ==================
  getPrintConfig() {
    if (this._printConfig) return this.applyTitleOverrides(this._printConfig);
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
      pl_title: 'قائمة الدخل الرسمية',
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
        return this.applyTitleOverrides(this._printConfig);
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
          header_subtitle: s.print_header_subtitle || (s.address ? `${s.address} | هاتف: ${s.phone1 || '773413937'}` : 'عدن - الجمهورية اليمنية | هاتف: 773413937'),
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
          pl_title: s.print_pl_title || 'قائمة الدخل الرسمية',
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

        try{cfg.operation_titles=JSON.parse(s.print_operation_titles||'{}');}catch{cfg.operation_titles={};}
        this.renderOperationSettings(cfg.operation_titles);
        this._printConfig = cfg;
        this._printSettingsLoaded=true;
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
        if(Auth.hasPermission('settings:company'))this.loadPrintProfiles();
      }
    } catch (e) {
      console.error('Error loading print settings:', e);
    }
  },

  serializePrintForm() {
    const config = {};
    document.querySelectorAll('#printSettingsForm input, #printSettingsForm select, #printSettingsForm textarea').forEach(el => {
      if (!el.id || el.id.startsWith('printProfile') || el.id.startsWith('designer') || el.type === 'submit' || el.type === 'button') return;
      config[el.id] = el.type === 'checkbox' ? Boolean(el.checked) : el.value;
    });
    return config;
  },

  applyPrintForm(config) {
    Object.entries(config || {}).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = Boolean(value);
      else el.value = value;
    });
    this.updatePrintPreview();
  },

  async loadPrintProfiles() {
    try {
      const res = await fetch('/api/settings/print-profiles');
      const json = await res.json();
      if (!json.success) return;
      const select = document.getElementById('printProfileSelect');
      if (select) select.innerHTML = '<option value="">الإعدادات الحالية</option>' + json.data.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
      const audit = document.getElementById('printProfileAudit');
      if (audit) audit.textContent = json.audit?.length ? `آخر العمليات: ${json.audit.map(a => `${a.action} «${a.profile_name}» بواسطة ${a.actor}`).join(' • ')}` : 'لم يُحفظ قالب مستقل بعد.';
    } catch (err) { console.warn('Print profile loading failed', err); }
  },

  async savePrintProfile() {
    const name = document.getElementById('printProfileName')?.value.trim();
    if (!name) return App.showToast('اكتب اسم القالب أولاً', 'warning');
    try {
      const res = await fetch('/api/settings/print-profiles', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ name, config:this.serializePrintForm() }) });
      const json = await res.json();
      if (!json.success) return App.showToast(json.message || 'تعذر حفظ القالب', 'error');
      App.showToast(json.message, 'success');
      await this.loadPrintProfiles();
    } catch { App.showToast('تعذر الاتصال لحفظ القالب', 'error'); }
  },

  async applyPrintProfile(id) {
    if (!id) return;
    try {
      const res = await fetch(`/api/settings/print-profiles/${encodeURIComponent(id)}`);
      const json = await res.json();
      if (!json.success) return App.showToast(json.message || 'تعذر تطبيق القالب', 'error');
      this.applyPrintForm(json.data.config);
      const name = document.getElementById('printProfileName'); if (name) name.value = json.data.name;
      App.showToast(`تم تحميل قالب «${json.data.name}». اضغط حفظ وتطبيق لاعتماده.`, 'info');
    } catch { App.showToast('تعذر تحميل القالب', 'error'); }
  },

  async savePrintSettings(e) {
    if (e) e.preventDefault();

    const getVal = (id, def = '') => document.getElementById(id)?.value || def;
    const getChk = (id) => document.getElementById(id)?.checked ? '1' : '0';

    const cfg = {
      print_operation_titles: JSON.stringify(this.operationTitles()),
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
      print_pl_title: getVal('printPlTitle', 'قائمة الدخل الرسمية'),
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
        this._printConfig.operation_titles=JSON.parse(cfg.print_operation_titles);
        localStorage.setItem('rawasi_print_config', JSON.stringify(this._printConfig));
        this.updatePrintPreview();
        this.designerMarkSaved?.();
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
    this.renderOperationSettings({});
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

      pl_title: 'قائمة الدخل الرسمية',
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
      win.document.write(`
        <!DOCTYPE html>
        <html dir="rtl" lang="ar">
        <head>
          <meta charset="utf-8">
          <title>${docTitle}</title>
          <link rel="stylesheet" href="css/style.css">
          <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&family=Amiri:wght@400;700&family=Tajawal:wght@400;500;700&family=Almarai:wght@400;700&display=swap" rel="stylesheet">
          <style>
            body { 
              background: #fff !important; 
              padding: 20px; 
              font-family: '${cfg.font_family || 'Cairo'}', sans-serif !important; 
              color: #0f172a;
            }
            @media print {
              @page { size: A4 ${orient}; margin: ${cfg.page_margins === 'narrow' ? '6mm' : (cfg.page_margins === 'wide' ? '18mm' : '10mm')}; }
              body { padding: 0 !important; }
              .no-print { display: none !important; }
            }
          </style>
        </head>
        <body>
          ${previewBox.innerHTML}
          <script>
            window.onload = function() {
              setTimeout(function() { window.print(); window.close(); }, 400);
            };
          <\/script>
        </body>
        </html>
      `);
      win.document.close();
    }
  },

  // بناء فئات CSS الموحدة للتقارير والوثائق
  getReportDocClass(cfg = null) {
    const c = cfg || this.getPrintConfig();
    const borderCls = `border-${c.border_style || 'classic'}`;
    const densityCls = `density-${c.table_density || 'medium'}`;
    const marginsCls = `margins-${c.page_margins || 'normal'}`;
    const fontCls = `font-${(c.font_family || 'cairo').toLowerCase()}`;
    const scaleCls = `scale-${c.font_size_scale || 'normal'}`;
    const logoCls = `logo-size-${c.logo_size || 'medium'}`;
    const orientCls = c.orientation === 'landscape' ? 'orientation-landscape' : '';
    return `multi-page-report-document ${borderCls} ${densityCls} ${marginsCls} ${fontCls} ${scaleCls} ${logoCls} ${orientCls}`.trim();
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
    document.title = `المستخدم المسجل: ${userName} | ${docTitle || 'تقرير رسمي'} - شركة رواسي عدن`;
    const restore = () => {
      document.title = origTitle;
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    setTimeout(restore, 2500);
  },

  // إنشاء ترويسة التقارير الرسمية الذكية
  renderReportHeader(title, metaItems = [], cfg = null) {
    const normalized=String(title).replace(/ـ/g,'');
    const aliases={client_boq:'جدول كميات العميل',audit_boq:'تدقيق جدول الكميات',boq:'جدول الكميات',payslip:'قسيمة راتب',inventory:'جرد وتقييم',project:'تقرير حساب وبيانات المشروع',receipt:'سند قبض',expense:'سند صرف',custody:'عهد',journal:'قيد يوم',cash_movement:'حركة الصندوق',account_movement:'حركة حساب',client_stmt:'كشف حساب عميل',supplier_stmt:'كشف حساب مورد',trial_balance:'ميزان المراجعة',balance_sheet:'الميزانية العمومية',cash_flow:'التدفقات النقدية',project_budget:'موازنة المشروع',quotation:'عرض سعر',contract:'عقد تنفيذ',ipc:'مستخلص',settlement:'الحساب الختامي',change_order:'أمر تغيير',daily_report:'تقرير الموقع اليومي',weekly_report:'الإنجاز الأسبوعي',handover:'محضر استلام',correspondence:'خطاب مراسلة',payroll:'رواتب'};
    const match=Object.entries(aliases).find(([,label])=>normalized.includes(label));
    if(match)title=this.getOperationTitle(match[0],title);
    title=this.escapeText(title);
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
        dateItem.val = `${dateItem.val} - ${timeStr}`;
      }
    } else {
      items.push({ label: 'تاريخ ووقت الطباعة', val: `${todayDate} - ${timeStr}` });
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
        return `<div style="${badgeStyle}">${m.label}: <strong style="color: #0f2744;">${m.val}</strong></div>`;
      }).join('');
    };

    if (c.header_style === 'plain') {
      return `
        <div class="report-header-banner" style="border-bottom-color: ${accent}; padding-bottom: 8px; margin-bottom: 12px;">
          <div class="report-header-badge-box" style="width: 100%; display: flex; justify-content: space-between; align-items: center;">
            <div class="doc-badge" style="background: #0f2744; border-right-color: ${accent}; font-size: 1.15rem; margin: 0;">
              ${title}
            </div>
            <div class="doc-info" style="text-align: left;">
              ${renderMetaDivs(items)}
            </div>
          </div>
        </div>
      `;
    }

    return `
      <div class="report-header-banner logo-size-${c.logo_size || 'medium'}" style="border-bottom-color: ${accent};">
        <div class="report-header-brand">
          ${showLogo ? `<img src="images/logo.png" alt="رواسي عدن" style="width: ${logoDim}px; height: ${logoDim}px; object-fit: contain;">` : ''}
          <div class="report-header-titles">
            <h2>${c.header_title || 'شركة رواسي عدن للهندسة والمقاولات'}</h2>
            <div class="en-title">${c.header_en || 'Rawasi Aden for Engineering & Contracting'}</div>
            <div class="meta-sub">
              ${c.header_subtitle || ''} 
              ${c.tax_no ? ` | <span style="font-weight: 600;">${c.tax_no}</span>` : ''}
            </div>
            ${c.slogan ? `<div style="font-size: 0.72rem; color: ${accent}; font-weight: 700; margin-top: 1px;">« ${c.slogan} »</div>` : ''}
          </div>
        </div>
        <div class="report-header-badge-box">
          <div class="doc-badge" style="border-right-color: ${accent};">
            ${title}
          </div>
          <div class="doc-info">
            ${renderMetaDivs(items)}
          </div>
        </div>
      </div>
    `;
  },

  // إنشاء صف التوقيعات والختم
  renderReportSignatures(cfg = null) {
    const c = cfg || this.getPrintConfig();
    if (c.sig_position === 'none') return '';

    const showStamp = c.show_stamp === '1' || c.show_stamp === 1 || c.show_stamp === true;

    return `
      <div class="letterhead-signatures-row">
        <div class="letterhead-sig-col">
          <div class="letterhead-sig-label">${c.sig1 || 'المستلم / المحاسب'}</div>
          <div class="letterhead-sig-dots">التوقيع: ........................</div>
        </div>
        ${showStamp ? `
        <div class="letterhead-sig-col" style="min-width: 100px;">
          <div class="letterhead-stamp-circle">
            <span>الختم الرسمي</span>
          </div>
        </div>
        ` : `
        <div class="letterhead-sig-col">
          <div class="letterhead-sig-label">${c.sig2 || 'المدير العام'}</div>
          <div class="letterhead-sig-dots">الاعتماد: ........................</div>
        </div>
        `}
        <div class="letterhead-sig-col">
          <div class="letterhead-sig-label">${c.sig3 || 'اعتماد الإدارة'}</div>
          <div class="letterhead-sig-dots">الاعتماد: ........................</div>
        </div>
      </div>
    `;
  },

  // إنشاء تذييل التقرير والملاحظات
  renderReportFooter(cfg = null) {
    const c = cfg || this.getPrintConfig();
    const showPageNums = c.show_page_numbers === '1' || c.show_page_numbers === 1 || c.show_page_numbers === true;
    const showPrintTime = c.show_print_time === '1' || c.show_print_time === 1 || c.show_print_time === true;
    const todayDate = new Date().toISOString().split('T')[0];
    const timeStr = new Date().toLocaleTimeString('ar-YE', { hour: '2-digit', minute: '2-digit' });
    const userName = this.getCurrentUserName();

    return `
      <div style="margin-top: 14px; padding-top: 8px; border-top: 1px dashed #cbd5e1; font-size: 0.74rem; color: #64748b; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px;">
        <div style="flex: 1; text-align: right;">${c.footer_notes || ''}</div>
        <div style="display: flex; gap: 14px; align-items: center; font-size: 0.7rem; color: #94a3b8;">
          ${showPrintTime ? `<span>تاريخ ووقت الطباعة: <strong>${todayDate} ${timeStr}</strong> | المستخدم: <strong style="color: #0f2744;">${userName}</strong></span>` : ''}
          ${showPageNums ? `<span style="background: #f1f5f9; padding: 2px 8px; border-radius: 4px; font-weight: bold; color: #475569;">وثيقة رسمية معتمدة</span>` : ''}
        </div>
      </div>
    `;
  },

  updatePrintPreview() {
    const previewBox = document.getElementById('printLivePreviewBox');
    if (!previewBox) return;
    if(this._previewDocType?.startsWith('operation:')){
      const id=this._previewDocType.slice(10),operation=SystemCatalog.operations.find(value=>value.id===id);if(!operation)return;
      const title=document.getElementById('operationTitle_'+id)?.value||operation.label;
      const cfg={...this.getPrintConfig(),header_title:document.getElementById('printHeaderTitle')?.value||this.getPrintConfig().header_title,operation_titles:{}};
      previewBox.innerHTML='<div class="official-report-document">'+this.renderReportHeader(title,[],cfg)+'<p>معاينة توضيحية للقالب — ليست بيانات فعلية أو مستندًا ماليًا.</p><table class="official-report-table"><thead><tr><th>المستند / التقرير</th><th>العملية</th></tr></thead><tbody><tr><td>'+this.escapeText(operation.label)+'</td><td>طباعة PDF / تقرير / تصدير بحسب شاشة المستند</td></tr></tbody></table>'+this.renderReportSignatures(cfg)+this.renderReportFooter(cfg)+'</div>';return;
    }

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
    const plTitle = getVal('printPlTitle', 'قائمة الدخل الرسمية');
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

    const fontStyleAttr = `font-family: '${fontFamily}', sans-serif;`;
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

      previewBox.innerHTML = `
        <div class="${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; ${fontStyleAttr}">
          ${headerHtml}

          <div class="voucher-amount-card" style="padding: 8px 14px; margin: 10px 0 12px 0; border-color: ${accentColor}; background: #fdfaf2;">
            <div>
              <span style="font-size: 0.82rem; color: #475569; font-weight: bold; margin-left: 6px;">المبلغ المقبوض:</span>
              <span class="voucher-amount-value" style="font-size: 1.15rem; color: #047857;">1,500,000 ر.ي</span>
            </div>
            ${voucherShowTafqeet ? `<div class="voucher-amount-words" style="font-size: 0.78rem; color: #854d0e;">فقط: مليون وخمسمائة ألف ريال يمني لا غير.</div>` : ''}
          </div>

          <table class="voucher-grid-table" style="margin-bottom: 10px; font-size: 0.78rem;">
            <tr>
              <td class="label-cell" style="width: 28%; padding: 5px 8px; border-right-color: ${accentColor};">استلمنا من الأخ/السادة:</td>
              <td class="val-cell" style="padding: 5px 8px;">علوي محمد باعبيد</td>
            </tr>
            ${voucherShowProject ? `
            <tr>
              <td class="label-cell" style="padding: 5px 8px; border-right-color: ${accentColor};">المشروع التابع له:</td>
              <td class="val-cell" style="padding: 5px 8px;">مشروع برج الأمل السكني</td>
            </tr>` : ''}
            ${voucherShowAccount ? `
            <tr>
              <td class="label-cell" style="padding: 5px 8px; border-right-color: ${accentColor};">رقم الحساب بالأستاذ:</td>
              <td class="val-cell" style="padding: 5px 8px;"><code style="color: #0f2744; font-weight: bold;">12101 - العملاء التجاريين</code></td>
            </tr>` : ''}
            ${voucherShowCostCenter ? `
            <tr>
              <td class="label-cell" style="padding: 5px 8px; border-right-color: ${accentColor};">مركز التكلفة:</td>
              <td class="val-cell" style="padding: 5px 8px;">CC-101 (الإنشاءات والخرسانات)</td>
            </tr>` : ''}
            ${voucherShowPaymentMethod ? `
            <tr>
              <td class="label-cell" style="padding: 5px 8px; border-right-color: ${accentColor};">طريقة الدفع:</td>
              <td class="val-cell" style="padding: 5px 8px;">نقداً بالصندوق الرئيسي</td>
            </tr>` : ''}
            ${voucherShowChequeRef ? `
            <tr>
              <td class="label-cell" style="padding: 5px 8px; border-right-color: ${accentColor};">رقم المرجع / الحوالة:</td>
              <td class="val-cell" style="padding: 5px 8px;">REF-99201</td>
            </tr>` : ''}
            <tr>
              <td class="label-cell" style="padding: 5px 8px; border-right-color: ${accentColor};">وذلك عن (البيان):</td>
              <td class="val-cell" style="padding: 5px 8px;">دفعة أعمال مقاولات وهندسة للمرحلة الأولى</td>
            </tr>
          </table>

          ${sigHtml}
          ${footerHtml}
        </div>
      `;
    }

    // ==========================================
    // 2. معاينة سند الصرف (expense)
    // ==========================================
    else if (docType === 'expense') {
      const headerHtml = this.renderReportHeader(expenseTitle, [
        { label: 'رقم السند', val: 'PV-2026-0014' },
        { label: 'التاريخ', val: '2026-09-08' }
      ], mockCfg);

      previewBox.innerHTML = `
        <div class="${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; ${fontStyleAttr}">
          ${headerHtml}

          <div class="voucher-amount-card" style="padding: 8px 14px; margin: 10px 0 12px 0; border-color: #dc2626; background: #fff5f5;">
            <div>
              <span style="font-size: 0.82rem; color: #475569; font-weight: bold; margin-left: 6px;">المبلغ المصروف:</span>
              <span class="voucher-amount-value" style="font-size: 1.15rem; color: #dc2626;">850,000 ر.ي</span>
            </div>
            ${voucherShowTafqeet ? `<div class="voucher-amount-words" style="font-size: 0.78rem; color: #991b1b;">فقط: ثمانمائة وخمسون ألف ريال يمني لا غير.</div>` : ''}
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
            ${voucherShowProject ? `
            <tr>
              <td class="label-cell" style="padding: 5px 8px; border-right-color: #dc2626;">المشروع التابع له:</td>
              <td class="val-cell" style="padding: 5px 8px;">مشروع برج الأمل السكني</td>
            </tr>` : ''}
            ${voucherShowAccount ? `
            <tr>
              <td class="label-cell" style="padding: 5px 8px; border-right-color: #dc2626;">الحساب المدين:</td>
              <td class="val-cell" style="padding: 5px 8px;"><code style="color: #b91c1c; font-weight: bold;">5101 - مواد بناء وإنشاءات</code></td>
            </tr>` : ''}
            ${voucherShowCostCenter ? `
            <tr>
              <td class="label-cell" style="padding: 5px 8px; border-right-color: #dc2626;">مركز التكلفة:</td>
              <td class="val-cell" style="padding: 5px 8px;">CC-101 (الإنشاءات والخرسانات)</td>
            </tr>` : ''}
            ${voucherShowPaymentMethod ? `
            <tr>
              <td class="label-cell" style="padding: 5px 8px; border-right-color: #dc2626;">طريقة الدفع:</td>
              <td class="val-cell" style="padding: 5px 8px;">شيك بنكي (بنك القطيبي الإسلامي)</td>
            </tr>` : ''}
            ${voucherShowChequeRef ? `
            <tr>
              <td class="label-cell" style="padding: 5px 8px; border-right-color: #dc2626;">رقم الشيك:</td>
              <td class="val-cell" style="padding: 5px 8px;">CHQ-88203</td>
            </tr>` : ''}
            <tr>
              <td class="label-cell" style="padding: 5px 8px; border-right-color: #dc2626;">وذلك عن (البيان):</td>
              <td class="val-cell" style="padding: 5px 8px;">شراء حديد تسليح مقاس 16 ملم للمبنى</td>
            </tr>
          </table>

          ${sigHtml}
          ${footerHtml}
        </div>
      `;
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

      previewBox.innerHTML = `
        <div class="${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; ${fontStyleAttr}">
          ${headerHtml}

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

          <div style="font-weight: bold; font-size: 0.78rem; color: #0f2744; margin: 6px 0 4px 0; border-right: 3px solid ${accentColor}; padding-right: 4px;">جدول فواتير ومصروفات تصفية العهدة:</div>
          <table class="official-report-table" style="font-size: 0.74rem; margin-bottom: 10px;">
            <thead><tr><th>م</th><th>التاريخ</th><th>رقم الفاتورة</th><th>البيان والمشتريات</th><th>المبلغ</th></tr></thead>
            <tbody>
              <tr><td>1</td><td>2026-09-02</td><td>INV-109</td><td>شراء مستلزمات كهربائية وأنابيب</td><td>150,000</td></tr>
              <tr><td>2</td><td>2026-09-04</td><td>INV-115</td><td>أجور عمالة يومية ونقل ردميات</td><td>180,000</td></tr>
              <tr><td>3</td><td>2026-09-06</td><td>INV-122</td><td>محروقات ديزل لمولد الموقع</td><td>90,000</td></tr>
              <tr style="background: #f8fafc; font-weight: bold;"><td colspan="4">إجمالي المنصرف المعتمد:</td><td style="color:#b91c1c;">420,000 ر.ي</td></tr>
            </tbody>
          </table>

          ${sigHtml}
          ${footerHtml}
        </div>
      `;
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

      previewBox.innerHTML = `
        <div class="${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; ${fontStyleAttr}">
          ${headerHtml}

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

          ${sigHtml}
          ${footerHtml}
        </div>
      `;
    }

    // ==========================================
    // 5. معاينة كشف حركة الصندوق (cash_movement)
    // ==========================================
    else if (docType === 'cash_movement') {
      const headerHtml = this.renderReportHeader(cashMovementTitle, [
        { label: 'الصندوق / الحساب', val: 'الصندوق الرئيسي بالعملة المحلية' },
        { label: 'الفترة', val: '2026-09-01 إلى 2026-09-08' }
      ], mockCfg);

      previewBox.innerHTML = `
        <div class="${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; ${fontStyleAttr}">
          ${headerHtml}

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
            <div style="background: #fdfaf2; padding: 6px; border-radius: 4px; text-align: center; border: 1px solid ${accentColor};">
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

          ${sigHtml}
          ${footerHtml}
        </div>
      `;
    }

    // ==========================================
    // 6. معاينة كشف حساب عميل (client_stmt)
    // ==========================================
    else if (docType === 'client_stmt') {
      const headerHtml = this.renderReportHeader(clientStmtTitle, [
        { label: 'اسم العميل', val: 'علوي محمد باعبيد' },
        { label: 'الفترة', val: 'من 2026-01-01 إلى اليوم' }
      ], mockCfg);

      previewBox.innerHTML = `
        <div class="${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; ${fontStyleAttr}">
          ${headerHtml}

          ${stmtShowSummary ? `
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
          </div>` : ''}

          <table class="official-report-table" style="font-size: 0.75rem; margin-bottom: 10px;">
            <thead>
              <tr>
                <th>التاريخ</th>
                ${stmtShowRef ? `<th>رقم السند</th>` : ''}
                ${stmtShowNotes ? `<th>البيان والتفاصيل</th>` : ''}
                <th>مدين (عله)</th>
                <th>دائن (له)</th>
                ${stmtShowRunningBal ? `<th>الرصيد التراكمي</th>` : ''}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>2026-01-15</td>
                ${stmtShowRef ? `<td>CNT-01</td>` : ''}
                ${stmtShowNotes ? `<td>مستخلص أعمال صب خرسانة الدور الأول</td>` : ''}
                <td style="color: #0f2744;">3,000,000</td>
                <td>0</td>
                ${stmtShowRunningBal ? `<td style="font-weight: bold; color: #b91c1c;">3,000,000</td>` : ''}
              </tr>
              <tr>
                <td>2026-02-01</td>
                ${stmtShowRef ? `<td>RC-101</td>` : ''}
                ${stmtShowNotes ? `<td>دفعة نقدية مسددة في الصندوق</td>` : ''}
                <td>0</td>
                <td style="color: #059669;">2,000,000</td>
                ${stmtShowRunningBal ? `<td style="font-weight: bold; color: #b91c1c;">1,000,000</td>` : ''}
              </tr>
              <tr>
                <td>2026-03-10</td>
                ${stmtShowRef ? `<td>CNT-02</td>` : ''}
                ${stmtShowNotes ? `<td>مستخلص تشطيبات وبناء الدور الثاني</td>` : ''}
                <td style="color: #0f2744;">2,000,000</td>
                <td>0</td>
                ${stmtShowRunningBal ? `<td style="font-weight: bold; color: #b91c1c;">3,000,000</td>` : ''}
              </tr>
              <tr>
                <td>2026-04-05</td>
                ${stmtShowRef ? `<td>RC-105</td>` : ''}
                ${stmtShowNotes ? `<td>سداد بحوالة بنكية</td>` : ''}
                <td>0</td>
                <td style="color: #059669;">1,500,000</td>
                ${stmtShowRunningBal ? `<td style="font-weight: bold; color: #b91c1c;">1,500,000</td>` : ''}
              </tr>
            </tbody>
          </table>

          ${stmtShowMatch ? `
          <div style="background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 4px; padding: 6px 10px; font-size: 0.72rem; color: #475569; display: flex; justify-content: space-between; align-items: center; margin-top: 8px;">
            <span>أقر أنا العميل المذكور أعلاه بصحة الرصيد الموضح وقدره (1,500,000 ر.ي):</span>
            <span>توقيع العميل: ..........................</span>
          </div>` : ''}

          ${sigHtml}
          ${footerHtml}
        </div>
      `;
    }

    // ==========================================
    // 7. معاينة كشف حساب مورد (supplier_stmt)
    // ==========================================
    else if (docType === 'supplier_stmt') {
      const headerHtml = this.renderReportHeader(supplierStmtTitle, [
        { label: 'اسم المورد', val: 'شركة الحديد والصلب للتجارة' },
        { label: 'تاريخ التقرير', val: '2026-09-08' }
      ], mockCfg);

      previewBox.innerHTML = `
        <div class="${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; ${fontStyleAttr}">
          ${headerHtml}

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

          ${sigHtml}
          ${footerHtml}
        </div>
      `;
    }

    // ==========================================
    // 8. معاينة تقرير المشروع الشامل (project)
    // ==========================================
    else if (docType === 'project') {
      const headerHtml = this.renderReportHeader(projReportTitle, [
        { label: 'كود المشروع', val: 'PRJ-2026-01' },
        { label: 'اسم المشروع', val: 'برج الأمل السكني' }
      ], mockCfg);

      previewBox.innerHTML = `
        <div class="${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; ${fontStyleAttr}">
          ${headerHtml}

          ${projShowKpi ? `
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
            <div style="background: #fdfaf2; padding: 6px; border-radius: 4px; text-align: center; border: 1px solid ${accentColor};">
              <div style="font-size: 0.68rem; color: #b8911c;">نسبة الإنجاز</div>
              <div style="font-weight: 800; font-size: 0.88rem; color: #047857;">65%</div>
            </div>
          </div>` : ''}

          ${projShowExp ? `
          <div style="font-weight: bold; font-size: 0.78rem; color: #0f2744; margin: 8px 0 4px 0; border-right: 3px solid ${accentColor}; padding-right: 4px;">المصروفات المباشرة للمشروع:</div>
          <table class="official-report-table" style="font-size: 0.72rem; margin-bottom: 8px;">
            <thead><tr><th>التاريخ</th><th>البند</th><th>المبلغ</th><th>طريقة الدفع</th></tr></thead>
            <tbody>
              <tr><td>2026-02-01</td><td>حفريات وتجهيز موقع</td><td>1,500,000</td><td>نقدي</td></tr>
              <tr><td>2026-03-10</td><td>صب القواعد والأساسات</td><td>4,800,000</td><td>تحويل</td></tr>
            </tbody>
          </table>` : ''}

          ${projShowBills ? `
          <div style="font-weight: bold; font-size: 0.78rem; color: #0f2744; margin: 8px 0 4px 0; border-right: 3px solid #3b82f6; padding-right: 4px;">فواتير وتوريدات الموردين:</div>
          <table class="official-report-table" style="font-size: 0.72rem; margin-bottom: 8px;">
            <thead><tr><th>التاريخ</th><th>المورد</th><th>البيان</th><th>المبلغ</th><th>الحالة</th></tr></thead>
            <tbody>
              <tr><td>2026-02-20</td><td>شركة الأسمنت</td><td>إسمنت بورتلاندي</td><td>3,200,000</td><td>مسدد بالكامل</td></tr>
              <tr><td>2026-03-15</td><td>مؤسسة الحديد</td><td>حديد تسليح 16 ملم</td><td>2,900,000</td><td>مسدد جزئياً</td></tr>
            </tbody>
          </table>` : ''}

          ${projShowPay ? `
          <div style="font-weight: bold; font-size: 0.78rem; color: #0f2744; margin: 8px 0 4px 0; border-right: 3px solid #059669; padding-right: 4px;">مقبوضات ودفعات العميل:</div>
          <table class="official-report-table" style="font-size: 0.72rem; margin-bottom: 8px;">
            <thead><tr><th>التاريخ</th><th>رقم السند</th><th>المبلغ المقبوض</th><th>البيان</th></tr></thead>
            <tbody>
              <tr><td>2026-01-20</td><td>RC-101</td><td>5,000,000</td><td>دفعة مقدمة عند توقيع العقد</td></tr>
              <tr><td>2026-03-01</td><td>RC-105</td><td>10,000,000</td><td>مستخلص إنجاز الأساسات</td></tr>
            </tbody>
          </table>` : ''}

          ${projShowBoq ? `
          <div style="font-weight: bold; font-size: 0.78rem; color: #0f2744; margin: 8px 0 4px 0; border-right: 3px solid #8b5cf6; padding-right: 4px;">جدول الكميات والمواصفات (BoQ):</div>
          <table class="official-report-table" style="font-size: 0.72rem; margin-bottom: 8px;">
            <thead><tr><th>البند</th><th>الوحدة</th><th>الكمية المخططة</th><th>المنجز الفعلي</th><th>نسبة البند</th></tr></thead>
            <tbody>
              <tr><td>خرسانة مسلحة للقواعد C30</td><td>م3</td><td>240</td><td>240</td><td>100%</td></tr>
              <tr><td>أعمال المباني والبلوك 20سم</td><td>م2</td><td>1,200</td><td>780</td><td>65%</td></tr>
            </tbody>
          </table>` : ''}

          ${sigHtml}
          ${footerHtml}
        </div>
      `;
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

      previewBox.innerHTML = `
        <div class="${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; ${fontStyleAttr}">
          ${headerHtml}

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

          ${sigHtml}
          ${footerHtml}
        </div>
      `;
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

      previewBox.innerHTML = `
        <div class="${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; ${fontStyleAttr}">
          ${headerHtml}

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

          ${projShowRetentions ? `
          <table class="official-report-table" style="font-size: 0.74rem; margin-bottom: 8px;">
            <thead><tr><th>البند الحسابي للمستخلص</th><th>المعادلة</th><th>المبلغ المحقق</th></tr></thead>
            <tbody>
              <tr><td>قيمة أعمال هذا المستخلص (Gross)</td><td>الكميات المنفذة × السعر التعاقدي</td><td style="font-weight:bold;">6,250,000 ر.ي</td></tr>
              <tr><td>استقطاع استرداد الدفعة المقدمة (20%)</td><td>خصم نسبة الاسترداد</td><td style="color:#b91c1c;">(1,250,000) ر.ي</td></tr>
              <tr><td>استقطاع ضمان الصيانة وحسن التنفيذ (10%)</td><td>تأمين محجوز حتى الاستلام النهائي</td><td style="color:#b91c1c;">(625,000) ر.ي</td></tr>
              <tr style="background:#f0fdf4;font-weight:bold;font-size:0.85rem"><td>صافي المبلغ المستحق للصرف للمقاول (Net Payable)</td><td>الصافي النهائي</td><td style="color:#047857;">4,375,000 ر.ي</td></tr>
            </tbody>
          </table>` : ''}

          ${sigHtml}
          ${footerHtml}
        </div>
      `;
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

      previewBox.innerHTML = `
        <div class="${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; ${fontStyleAttr}">
          ${headerHtml}

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

          ${sigHtml}
          ${footerHtml}
        </div>
      `;
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

      previewBox.innerHTML = `
        <div class="${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; ${fontStyleAttr}">
          ${headerHtml}

          <table class="voucher-grid-table" style="font-size: 0.74rem; margin-bottom: 10px;">
            <tr><td class="label-cell" style="width:30%;">موضوع التعديل المطلوب:</td><td class="val-cell">تعديل مواصفات أرضيات الصالات من سيراميك عادي إلى رخام إسباني مستورد</td></tr>
            <tr><td class="label-cell">سبب ومبررات التغيير:</td><td class="val-cell">بناءً على طلب المالك الخطي المرفق لتحسين المواصفات الفندقية للمبنى</td></tr>
            <tr><td class="label-cell">التكلفة المالية الإضافية:</td><td class="val-cell" style="font-weight:bold;color:#b91c1c;">1,800,000 ر.ي (تضاف لقيمة العقد الإجمالية)</td></tr>
            <tr><td class="label-cell">التمديد الزمني المطلوب:</td><td class="val-cell">إضافة 14 يوماً تقويمياً للمدة الأصلية للعقد</td></tr>
          </table>

          ${sigHtml}
          ${footerHtml}
        </div>
      `;
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

      previewBox.innerHTML = `
        <div class="${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; ${fontStyleAttr}">
          ${headerHtml}

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

          ${sigHtml}
          ${footerHtml}
        </div>
      `;
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

      previewBox.innerHTML = `
        <div class="${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; ${fontStyleAttr}">
          ${headerHtml}

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

          ${sigHtml}
          ${footerHtml}
        </div>
      `;
    }

    // ==========================================
    // 15. معاينة مسير الرواتب والأجور (payroll)
    // ==========================================
    else if (docType === 'payroll') {
      const headerHtml = this.renderReportHeader(payrollTitle, [
        { label: 'شهر الاستحقاق', val: 'أغسطس 2026' },
        { label: 'عدد الموظفين', val: '18 موظفاً ومهندساً' }
      ], mockCfg);

      previewBox.innerHTML = `
        <div class="${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; ${fontStyleAttr}">
          ${headerHtml}

          <table class="official-report-table" style="font-size: 0.71rem; margin-bottom: 8px;">
            <thead>
              <tr>
                <th>كود الموظف</th>
                <th>اسم الموظف</th>
                <th>المسمى الوظيفي</th>
                <th>الأساسي</th>
                ${payrollShowAllowances ? `<th>إجمالي البدلات</th>` : ''}
                ${payrollShowDeductions ? `<th>الاستقطاعات</th>` : ''}
                <th>صافي الراتب</th>
                ${payrollShowEmpSignature ? `<th>توقيع الاستلام</th>` : ''}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>EMP-01</td>
                <td>م. أحمد سالم باراس</td>
                <td>مدير المشاريع</td>
                <td>450,000</td>
                ${payrollShowAllowances ? `<td>120,000</td>` : ''}
                ${payrollShowDeductions ? `<td>(15,000)</td>` : ''}
                <td style="font-weight:bold;color:#047857;">555,000 ر.ي</td>
                ${payrollShowEmpSignature ? `<td style="font-size:0.65rem;color:#94a3b8;">.....................</td>` : ''}
              </tr>
              <tr>
                <td>EMP-02</td>
                <td>أ. فهد ناصر عثمان</td>
                <td>محاسب مالي أول</td>
                <td>320,000</td>
                ${payrollShowAllowances ? `<td>80,000</td>` : ''}
                ${payrollShowDeductions ? `<td>(10,000)</td>` : ''}
                <td style="font-weight:bold;color:#047857;">390,000 ر.ي</td>
                ${payrollShowEmpSignature ? `<td style="font-size:0.65rem;color:#94a3b8;">.....................</td>` : ''}
              </tr>
              <tr style="background:#f0fdf4;font-weight:bold;">
                <td colspan="3">إجمالي مسير الرواتب المستحق:</td>
                <td>770,000</td>
                ${payrollShowAllowances ? `<td>200,000</td>` : ''}
                ${payrollShowDeductions ? `<td>(25,000)</td>` : ''}
                <td style="color:#047857;">945,000 ر.ي</td>
                ${payrollShowEmpSignature ? `<td>✓ معتمد</td>` : ''}
              </tr>
            </tbody>
          </table>

          ${sigHtml}
          ${footerHtml}
        </div>
      `;
    }

    // ==========================================
    // 16. معاينة الأرباح والخسائر (profit_loss)
    // ==========================================
    else if (docType === 'profit_loss') {
      const headerHtml = this.renderReportHeader(plTitle, [
        { label: 'الفترة المالية', val: '2026-01-01 إلى 2026-09-08' },
        { label: 'الحالة', val: 'معتمد رسمياً' }
      ], mockCfg);

      previewBox.innerHTML = `
        <div class="${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; ${fontStyleAttr}">
          ${headerHtml}

          ${finShowKpi ? `
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px;">
            <div style="border: 1px solid #86efac; border-radius: 4px; padding: 8px; text-align: center; background: #f0fdf4;">
              <div style="font-size: 0.7rem; color: #15803d;">إجمالي الإيرادات</div>
              <div style="font-weight: 800; font-size: 1.05rem; color: #15803d;">35,000,000 ر.ي</div>
            </div>
            <div style="border: 1px solid #fca5a5; border-radius: 4px; padding: 8px; text-align: center; background: #fef2f2;">
              <div style="font-size: 0.7rem; color: #b91c1c;">إجمالي المصروفات</div>
              <div style="font-weight: 800; font-size: 1.05rem; color: #b91c1c;">22,500,000 ر.ي</div>
            </div>
            <div style="border: 1.5px solid ${accentColor}; border-radius: 4px; padding: 8px; text-align: center; background: #fdfaf2;">
              <div style="font-size: 0.7rem; color: #b8911c;">صافي الأرباح التشغيلية</div>
              <div style="font-weight: 800; font-size: 1.15rem; color: #047857;">12,500,000 ر.ي</div>
            </div>
          </div>` : ''}

          ${finShowExpBreak ? `
          <div style="font-weight: bold; font-size: 0.78rem; color: #0f2744; margin: 8px 0 4px 0; border-right: 3px solid ${accentColor}; padding-right: 4px;">توزيع بنود المصروفات ونسبتها:</div>
          <table class="official-report-table" style="font-size: 0.75rem; margin-bottom: 10px;">
            <thead><tr><th>بند المصروف</th><th>المبلغ</th><th>النسبة من الإجمالي</th></tr></thead>
            <tbody>
              <tr><td>مواد بناء وتوريدات خرسانة وحديد</td><td>14,500,000 ر.ي</td><td>64.4%</td></tr>
              <tr><td>أجور عمالة ومهندسين ومقاولين باطن</td><td>5,500,000 ر.ي</td><td>24.4%</td></tr>
              <tr><td>مصروفات تشغيلية ومحروقات ونقليات</td><td>2,500,000 ر.ي</td><td>11.2%</td></tr>
            </tbody>
          </table>` : ''}

          ${finShowReconcile ? `
          <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:4px; padding:4px 8px; font-size:0.72rem; color:#15803d; margin-bottom:8px;">
            ✓ مطابقة تامة مع سجل القيود المحاسبية وميزان المراجعة الصادر لنفس الفترة.
          </div>` : ''}

          ${sigHtml}
          ${footerHtml}
        </div>
      `;
    }

    // ==========================================
    // 17. معاينة الميزانية العمومية (balance_sheet)
    // ==========================================
    else if (docType === 'balance_sheet') {
      const headerHtml = this.renderReportHeader(balanceSheetTitle, [
        { label: 'تاريخ الميزانية', val: '2026-09-08' },
        { label: 'النوع', val: 'مركز مالي ختامي' }
      ], mockCfg);

      previewBox.innerHTML = `
        <div class="${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; ${fontStyleAttr}">
          ${headerHtml}

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

          ${sigHtml}
          ${footerHtml}
        </div>
      `;
    }

    // ==========================================
    // 18. معاينة قائمة التدفقات النقدية (cash_flow)
    // ==========================================
    else if (docType === 'cash_flow') {
      const headerHtml = this.renderReportHeader(cashFlowTitle, [
        { label: 'السنة المالية', val: '2026' },
        { label: 'المعيار', val: 'IAS 7 - الطريقة المباشرة' }
      ], mockCfg);

      previewBox.innerHTML = `
        <div class="${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; ${fontStyleAttr}">
          ${headerHtml}

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

          ${sigHtml}
          ${footerHtml}
        </div>
      `;
    }

    // ==========================================
    // 19. معاينة ميزان المراجعة (trial_balance)
    // ==========================================
    else if (docType === 'trial_balance') {
      const headerHtml = this.renderReportHeader(trialBalanceTitle, [
        { label: 'المستوى المحاسبي', val: 'جميع الحسابات (مستوى 3 و 4)' },
        { label: 'تاريخ الميزان', val: '2026-09-08' }
      ], mockCfg);

      previewBox.innerHTML = `
        <div class="${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; ${fontStyleAttr}">
          ${headerHtml}

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

          ${sigHtml}
          ${footerHtml}
        </div>
      `;
    }

    // ==========================================
    // 20. معاينة جرد وتقييم المخزون (inventory)
    // ==========================================
    else if (docType === 'inventory') {
      const headerHtml = this.renderReportHeader(inventoryTitle, [
        { label: 'المستودع', val: 'مستودع المواد الإنشائية الرئيسي - المعلا' },
        { label: 'تاريخ الجرد', val: '2026-09-08' }
      ], mockCfg);

      previewBox.innerHTML = `
        <div class="${docCls}" style="width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 6px; padding: 12px; ${fontStyleAttr}">
          ${headerHtml}

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

          ${sigHtml}
          ${footerHtml}
        </div>
      `;
    }
  },
  // ================== إدارة المستخدمين والصلاحيات ==================
  async loadUsers() {
    try {
      const res = await fetch('/api/users');
      const json = await res.json();
      if (json.success) {
        this._cachedUsers = json.data || [];
        const tbody = document.getElementById('usersTableBody');
        if (!tbody) return;

        if (this._cachedUsers.length === 0) {
          tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-secondary); padding: 20px;">لا يوجد مستخدمون مسجلون حالياً</td></tr>`;
          return;
        }

        tbody.innerHTML = this._cachedUsers.map(u => {
          // Role badge class
          let roleBadgeClass = 'badge-role-accountant';
          let roleTitle = SystemCatalog.roles[u.role]?.label || u.role_name || u.role;
          if (u.role === 'admin') {
            roleBadgeClass = 'badge-role-admin';
            roleTitle = 'المدير العام';
          } else if (u.role === 'accountant') {
            roleBadgeClass = 'badge-role-accountant';
            roleTitle = 'المحاسب المالي';
          } else if (u.role === 'auditor') {
            roleBadgeClass = 'badge-warning';
            roleTitle = 'المراجع المالي (مدقق)';
          } else if (u.role === 'project_manager') {
            roleBadgeClass = 'badge-role-pm';
            roleTitle = 'مهندس المشاريع';
          } else if (u.role === 'storekeeper') {
            roleBadgeClass = 'badge-role-storekeeper';
            roleTitle = 'أمين المخزن';
          }

          // Permissions summary
          const perms = u.permissions_list || [];
          let permsHtml = '';
          if (u.role === 'admin' || perms.includes('all') || perms.length >= 25) {
            permsHtml = `<span class="badge badge-role-admin">كافة الصلاحيات (شامل)</span>`;
          } else if (perms.length === 0) {
            permsHtml = `<span class="badge" style="background: rgba(255,255,255,0.06); color: var(--text-secondary);">صلاحيات افتراضية (${roleTitle})</span>`;
          } else {
            permsHtml = `<span class="badge badge-active" title="${perms.join(', ')}">${perms.length} صلاحية مخصصة</span>`;
          }

          // Scope summary
          let scopeHtml = '';
          const scopeParts = [];
          if (u.branch) scopeParts.push(`🏢 ${u.branch}`);
          if (u.department) scopeParts.push(`📑 ${u.department}`);
          if (u.allowed_projects && u.allowed_projects !== 'all' && u.allowed_projects !== '*' && u.allowed_projects !== '[]') {
            scopeParts.push(`🏗️ مشاريع محددة`);
          }
          if (scopeParts.length > 0) {
            scopeHtml = `<div style="font-size: 0.72rem; color: #38bdf8; margin-top: 3px; font-weight: 600;">${scopeParts.join(' | ')}</div>`;
          }

          // User security & session badge
          const uSec = u.security_settings;
          let secBadgeHtml = '';
          if (uSec && typeof uSec === 'object') {
            const isLock = uSec.session_overflow_action === 'lock_device' || uSec.overflowAction === 'lock_device';
            const isSingle = uSec.session_mode === 'single' || isLock;
            const devLimit = uSec.session_device_limit || 1;
            const exp = uSec.jwt_token_expiry || '8h';
            const label = isLock ? `جهاز معتمد واحد (${exp})` : (isSingle ? `جلسة واحدة (${exp})` : `متعددة (${devLimit}) (${exp})`);
            const icon = isLock ? '🔒' : '🛡️';
            secBadgeHtml = `<div style="margin-top: 5px;"><span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.4); font-size: 0.72rem; cursor: pointer;" onclick="Auth.openSecuritySessionsModal(${u.id})" title="إعدادات أمان مخصصة لهذا المستخدم - انقر للتعديل">${icon} ${label} ⭐</span></div>`;
          } else {
            const isLock = Auth.securitySettings?.session_overflow_action === 'lock_device';
            const isSingle = Auth.securitySettings?.session_mode === 'single' || isLock;
            const devLimit = Auth.securitySettings?.session_device_limit || 3;
            const exp = Auth.securitySettings?.jwt_token_expiry || '8h';
            const label = isLock ? `جهاز معتمد واحد (${exp})` : (isSingle ? `جلسة واحدة (${exp})` : `متعددة (${devLimit}) (${exp})`);
            secBadgeHtml = `<div style="margin-top: 5px;"><span class="badge" style="background: rgba(148, 163, 184, 0.08); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.2); font-size: 0.72rem; cursor: pointer;" onclick="Auth.openSecuritySessionsModal(${u.id})" title="يرث الإعدادات العامة للنظام - انقر لتخصيص هذا المستخدم">⚙️ عام: ${label}</span></div>`;
          }

          // 2FA PIN Badge
          let tfaBadgeHtml = '';
          const has2Fa = (u.two_factor_enabled !== 0 && u.two_factor_enabled !== false);
          if (u.role === 'admin' || u.username === 'admin' || has2Fa) {
            const currentPin = u.two_factor_pin || '123456';
            tfaBadgeHtml = `<div style="margin-top: 5px;">
              <span class="badge" style="background: rgba(212, 175, 55, 0.15); color: var(--gold-light); border: 1px solid rgba(212, 175, 55, 0.4); font-size: 0.72rem; cursor: pointer;" onclick="Settings.openEditUserModal(${u.id}, true)" title="رمز التحقق بخطوتين (PIN) المعتمد لهذا الحساب - انقر للتعديل وتغيير الرمز">
                🔐 PIN: <strong style="font-family: monospace; letter-spacing: 1px; color: #fbbf24;">${currentPin}</strong>
              </span>
            </div>`;
          }

          // Status Badge & Live Connection Indicator
          const isActive = u.status === 'active';
          const statusBadge = isActive
            ? `<span class="badge-status-active">نشط</span>`
            : `<span class="badge-status-inactive">معطل</span>`;

          const isOnline = !!u.is_currently_online;
          const onlineBadge = isOnline
            ? `<div style="margin-top: 4px;"><span class="badge" style="background: rgba(16, 185, 129, 0.18); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4); font-size: 0.72rem; padding: 2px 8px;"><span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:#10b981; margin-left:4px; box-shadow: 0 0 6px #10b981;"></span>متصل الآن 🟢</span></div>`
            : `<div style="margin-top: 4px;"><span class="badge" style="background: rgba(148, 163, 184, 0.08); color: #94a3b8; font-size: 0.72rem; padding: 2px 8px;">غير متصل ⚪</span></div>`;

          const isRootAdmin = u.username === 'admin' || u.id === 1;
          const isCurrentUserAdmin = Auth.currentUser?.role === 'admin' || Auth.currentUser?.username === 'admin';

          return `
            <tr>
              <td>
                <div style="font-weight: 700; color: var(--gold-light); font-size: 0.9rem;">${u.username}</div>
                <div style="font-size: 0.72rem; color: var(--text-secondary);">ID: #${u.id}</div>
              </td>
              <td><strong>${u.full_name}</strong></td>
              <td><span class="badge ${roleBadgeClass}">${roleTitle}</span></td>
              <td>
                <div style="font-size: 0.82rem;">${u.phone || '-'}</div>
                ${u.email ? `<div style="font-size: 0.72rem; color: var(--text-secondary);">${u.email}</div>` : ''}
              </td>
              <td>
                ${permsHtml}
                ${scopeHtml}
                ${secBadgeHtml}
                ${tfaBadgeHtml}
              </td>
              <td>
                ${statusBadge}
                ${onlineBadge}
              </td>
              <td>
                <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
                  <button type="button" class="btn btn-secondary btn-sm" onclick="Settings.openEditUserModal(${u.id})" title="تعديل المستخدم والصلاحيات">
                    ✏️ تعديل
                  </button>
                  ${isCurrentUserAdmin ? `
                    <button type="button" class="btn btn-secondary btn-sm" style="color: #10b981; border-color: rgba(16, 185, 129, 0.4); background: rgba(16, 185, 129, 0.08); font-weight: 600;" onclick="Auth.openSecuritySessionsModal(${u.id})" title="تخصيص سياسة الأمان والجلسات لهذا المستخدم">
                      🛡️ أمان وجلسات
                    </button>
                  ` : ''}
                  ${isOnline ? `
                    <button type="button" class="btn btn-secondary btn-sm" style="color: #fbbf24; border-color: rgba(245,158,11,0.4);" onclick="Settings.disconnectUser(${u.id}, '${u.full_name || u.username}')" title="إنهاء الجلسة وفصل المستخدم عن النظام لمنع التكرار">
                      🔌 فصل
                    </button>
                  ` : ''}
                  <button type="button" class="btn btn-secondary btn-sm" onclick="Settings.toggleUserStatus(${u.id})" title="${isActive ? 'تعطيل الحساب' : 'تفعيل الحساب'}" ${isRootAdmin ? 'disabled style="opacity:0.4;"' : ''}>
                    ${isActive ? '⏸️ تعطيل' : '▶️ تنشيط'}
                  </button>
                  ${!isRootAdmin ? `
                    <button type="button" class="btn btn-secondary btn-sm" style="color: var(--accent-red); border-color: rgba(239,68,68,0.3);" onclick="Settings.deleteUser(${u.id}, '${u.username}')" title="حذف المستخدم">
                      🗑️
                    </button>
                  ` : ''}
                </div>
              </td>
            </tr>
          `;
        }).join('');
      }
    } catch (e) {
      console.error('Error loading users:', e);
    }
  },

  // ================== إدارة نطاق الصلاحيات (المشاريع، الفروع، الأقسام) ==================
  async fetchScopesMeta() {
    if (this._scopesMeta) return this._scopesMeta;
    try {
      const res = await fetch('/api/users/scopes-meta', {
        headers: Auth.token ? { 'Authorization': `Bearer ${Auth.token}` } : {}
      });
      const data = await res.json();
      if (data.success) {
        this._scopesMeta = data;
        return data;
      }
    } catch (e) {
      console.error('Error fetching scopes meta:', e);
    }
    return null;
  },

  async renderScopesControls(user = null) {
    const meta = await this.fetchScopesMeta();
    const branchSelect = document.getElementById('userBranchVal');
    const deptSelect = document.getElementById('userDepartmentVal');
    const projectsList = document.getElementById('userProjectsCheckList');
    const allProjChk = document.getElementById('userAllProjectsScopeChk');
    const projContainer = document.getElementById('userProjectsScopeContainer');

    if (branchSelect) {
      const currentBranchId = user ? (user.branch_id || '') : '';
      branchSelect.innerHTML = `<option value="">كافة الفروع (غير مقيد)</option>` +
        (meta?.branches || []).map(b => `<option value="${b.id}" ${String(b.id) === String(currentBranchId) ? 'selected' : ''}>🏢 ${b.name} (${b.city || ''})</option>`).join('');
    }

    if (deptSelect) {
      const currentDeptId = user ? (user.department_id || '') : '';
      deptSelect.innerHTML = `<option value="">كافة الأقسام (غير مقيد)</option>` +
        (meta?.departments || []).map(d => `<option value="${d.id}" ${String(d.id) === String(currentDeptId) ? 'selected' : ''}>📑 ${d.name}</option>`).join('');
    }

    if (projectsList) {
      let allowedProjIds = [];
      if (user && user.allowed_projects) {
        try {
          allowedProjIds = typeof user.allowed_projects === 'string' && (user.allowed_projects.startsWith('[') || user.allowed_projects.startsWith('{'))
            ? JSON.parse(user.allowed_projects)
            : String(user.allowed_projects).split(',').map(s => s.trim());
        } catch (e) {
          allowedProjIds = [String(user.allowed_projects)];
        }
      }

      const isAll = !user || allowedProjIds.length === 0 || allowedProjIds.includes('*') || allowedProjIds.includes('all');
      if (allProjChk) allProjChk.checked = isAll;
      if (projContainer) projContainer.style.display = isAll ? 'none' : 'block';

      projectsList.innerHTML = (meta?.projects || []).map(p => {
        const checked = !isAll && allowedProjIds.some(id => String(id) === String(p.id));
        return `
          <label style="display: flex; align-items: center; gap: 6px; font-size: 0.76rem; color: #f1f5f9; cursor: pointer; background: rgba(255,255,255,0.04); padding: 4px 8px; border-radius: 4px;">
            <input type="checkbox" class="user-proj-scope-chk" value="${p.id}" ${checked ? 'checked' : ''} style="accent-color: #38bdf8;">
            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${p.name}</span>
          </label>
        `;
      }).join('');
    }
  },

  onAllProjectsScopeToggle(isAll) {
    const projContainer = document.getElementById('userProjectsScopeContainer');
    if (projContainer) {
      projContainer.style.display = isAll ? 'none' : 'block';
    }
    if (isAll) {
      document.querySelectorAll('.user-proj-scope-chk').forEach(c => c.checked = false);
    }
  },

  // ================== نافذة إضافة مستخدم جديد ==================
  async openNewUserModal() {
    this.populateAdditionalRoles();
    document.getElementById('userPasswordConfirm').value='';
    document.getElementById('userPasswordConfirm').required=true;
    const titleEl = document.getElementById('userModalTitle');
    if (titleEl) titleEl.textContent = 'إضافة مستخدم جديد وتحديد الصلاحيات';

    document.getElementById('userIdVal').value = '';
    document.getElementById('userNameVal').value = '';
    document.getElementById('userUsernameVal').value = '';
    
    const pwdInput = document.getElementById('userPasswordVal');
    if (pwdInput) {
      pwdInput.value = '';
      pwdInput.required = true;
      pwdInput.placeholder = 'كلمة المرور (8 خانات على الأقل)';
    }
    if (typeof Auth !== 'undefined' && Auth.checkPasswordStrength) {
      Auth.checkPasswordStrength('', 'userPasswordStrengthBox');
    }

    const pwdHint = document.getElementById('userPasswordHint');
    if (pwdHint) pwdHint.style.display = 'none';

    document.getElementById('userPhoneVal').value = '';
    document.getElementById('userEmailVal').value = '';
    document.getElementById('userStatusVal').value = 'active';

    const roleSelect = document.getElementById('userRoleVal');
    if (roleSelect) {
      roleSelect.value = 'accountant';
      this.applyRolePermissionsPreset('accountant');
    }

    // تجهيز نطاق الصلاحيات الجغرافي والإداري (فروع، أقسام، مشاريع)
    await this.renderScopesControls(null);

    // تجهيز بطاقة الأمان والجلسات المخصصة (المكان الأخضر)
    const isCurrentUserAdmin = Auth.currentUser?.role === 'admin' || Auth.currentUser?.username === 'admin';
    const secCard = document.getElementById('userModalSecurityCard');
    if (secCard) {
      secCard.style.display = isCurrentUserAdmin ? 'block' : 'none';
    }
    this.populateUserSecurityCard(null);

    // ضبط حقل رمز التحقق 2FA الافتراضي وحالته
    const pinInput = document.getElementById('user2FaPinVal');
    if (pinInput) {
      pinInput.value = '';
      pinInput.type = 'password';
    }
    const tfaEnabledChk = document.getElementById('user2FaEnabledVal');
    if (tfaEnabledChk) tfaEnabledChk.checked = true;
    const eyeIcon = document.getElementById('user2FaEyeIcon');
    if (eyeIcon) eyeIcon.textContent = '👁️';

    App.openModal('newUserModal');
  },

  // ================== نافذة تعديل مستخدم ==================
  async openEditUserModal(userId, focus2Fa = false) {
    const user = this._cachedUsers.find(u => u.id === userId);
    if (!user) {
      App.showToast('لم يتم العثور على بيانات المستخدم', 'error');
      return;
    }

    const titleEl = document.getElementById('userModalTitle');
    if (titleEl) titleEl.textContent = `تعديل بيانات وصلاحيات المستخدم (${user.full_name})`;

    this.populateAdditionalRoles();
    document.getElementById('userPasswordConfirm').value='';
    document.getElementById('userPasswordConfirm').required=false;
    document.getElementById('userIdVal').value = user.id;
    document.getElementById('userNameVal').value = user.full_name || '';
    document.getElementById('userUsernameVal').value = user.username || '';

    const pwdInput = document.getElementById('userPasswordVal');
    if (pwdInput) {
      pwdInput.value = '';
      pwdInput.required = false;
      pwdInput.placeholder = 'اتركه فارغاً للاحتفاظ بكلمة المرور الحالية';
    }
    if (typeof Auth !== 'undefined' && Auth.checkPasswordStrength) {
      Auth.checkPasswordStrength('', 'userPasswordStrengthBox');
    }

    const pwdHint = document.getElementById('userPasswordHint');
    if (pwdHint) pwdHint.style.display = 'block';

    document.getElementById('userPhoneVal').value = user.phone || '';
    document.getElementById('userEmailVal').value = user.email || '';
    document.getElementById('userStatusVal').value = user.status || 'active';

    const roleSelect = document.getElementById('userRoleVal');
    if (roleSelect) {
      roleSelect.value = user.role || 'custom';
    }

    // تجهيز نطاق الصلاحيات الجغرافي والإداري لهذا المستخدم
    await this.renderScopesControls(user);

    // تعبئة حقل رمز التحقق بخطوتين (2FA PIN) وحالته للمستخدم الحالي
    const editPinInput = document.getElementById('user2FaPinVal');
    if (editPinInput) {
      // PINs are write-only: leaving this field blank keeps the saved PIN.
      editPinInput.value = '';
      editPinInput.placeholder = user.two_factor_configured ? '••••••  اتركه فارغاً للاحتفاظ بالرمز الحالي' : 'أدخل رمزاً من 6 أرقام';
      editPinInput.type = 'password';
    }
    const editTfaEnabledChk = document.getElementById('user2FaEnabledVal');
    if (editTfaEnabledChk) {
      editTfaEnabledChk.checked = (user.two_factor_enabled !== undefined && user.two_factor_enabled !== null)
        ? (user.two_factor_enabled !== 0 && user.two_factor_enabled !== false)
        : true;
    }
    const editEyeIcon = document.getElementById('user2FaEyeIcon');
    if (editEyeIcon) editEyeIcon.textContent = '👁️';

    // تجهيز بطاقة الأمان والجلسات للمستخدم داخل نافذة التعديل (المكان الأخضر)
    const isCurrentUserAdmin = Auth.currentUser?.role === 'admin' || Auth.currentUser?.username === 'admin';
    const secCard = document.getElementById('userModalSecurityCard');
    if (secCard) {
      secCard.style.display = isCurrentUserAdmin ? 'block' : 'none';
    }
    this.populateUserSecurityCard(user.security_settings);

    // Uncheck all checkboxes first
    this.selectAllPermissions(false);

    // Check user's assigned permissions
    const perms = user.permissions_list || [];
    if (user.username === 'admin' || perms.includes('all')) {
      this.selectAllPermissions(true);
    } else if (perms.length > 0) {
      perms.forEach(p => {
        const chk = document.querySelector(`.perm-chk[value="${p}"]`);
        if (chk) chk.checked = true;
      });
      // إذا كانت الصلاحيات مخصصة، نظهر الدور كـ "مخصص" في القائمة
      const totalCheckboxes = document.querySelectorAll('.perm-chk').length;
      if (roleSelect && perms.length < totalCheckboxes && ![...roleSelect.options].some(option => option.value === user.role)) {
        roleSelect.value = 'custom';
      }
    } else if (user.role === 'admin') {
      this.selectAllPermissions(true);
    } else {
      // If no custom perms, apply role default
      this.applyRolePermissionsPreset(user.role || 'accountant');
    }

    App.openModal('newUserModal');

    if (focus2Fa) {
      setTimeout(() => {
        const card = document.getElementById('user2FaCardContainer');
        const pinInput = document.getElementById('user2FaPinVal');
        if (card) {
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          card.style.transition = 'box-shadow 0.4s ease, border-color 0.4s ease';
          card.style.borderColor = 'var(--gold-primary)';
          card.style.boxShadow = '0 0 16px rgba(212, 175, 55, 0.4)';
          setTimeout(() => {
            card.style.boxShadow = '';
            card.style.borderColor = 'rgba(212, 175, 55, 0.35)';
          }, 1500);
        }
        if (pinInput) {
          pinInput.focus();
          pinInput.select();
        }
      }, 350);
    }
  },

  // ================== دوال التحكم برمز التحقق بخطوتين (2FA PIN) ==================
  toggle2FaPinVisibility() {
    const pinInput = document.getElementById('user2FaPinVal');
    const eyeIcon = document.getElementById('user2FaEyeIcon');
    if (!pinInput) return;
    if (pinInput.type === 'password') {
      pinInput.type = 'text';
      if (eyeIcon) eyeIcon.textContent = '🙈';
    } else {
      pinInput.type = 'password';
      if (eyeIcon) eyeIcon.textContent = '👁️';
    }
  },

  generateRandom2FaPin() {
    const pinInput = document.getElementById('user2FaPinVal');
    if (!pinInput) return;
    const randomPin = String(Math.floor(100000 + Math.random() * 900000));
    pinInput.value = randomPin;
    pinInput.type = 'text';
    const eyeIcon = document.getElementById('user2FaEyeIcon');
    if (eyeIcon) eyeIcon.textContent = '🙈';
    App.showToast(`تم توليد رمز أمان جديد: ${randomPin} 🎲 - يرجى حفظ التعديلات للاعتماد`, 'info');
  },

  resetDefault2FaPin() {
    const pinInput = document.getElementById('user2FaPinVal');
    if (!pinInput) return;
    pinInput.value = '';
    App.showToast('لا يوجد رمز افتراضي؛ أدخل رمزاً خاصاً أو استخدم زر التوليد.', 'info');
  },

  // تعبئة وضبط خيارات الأمان والجلسات في البطاقة الخضراء
  populateUserSecurityCard(secSettings) {
    const policySelect = document.getElementById('userSecPolicyType');
    const limitSelect = document.getElementById('userSecDeviceLimit');
    const overflowSelect = document.getElementById('userSecOverflowAction');
    const tokenExpSelect = document.getElementById('userSecTokenExpiry');
    const startInput = document.getElementById('userSecStartTime');
    const endInput = document.getElementById('userSecEndTime');

    let sec = secSettings;
    if (typeof sec === 'string') {
      try { sec = JSON.parse(sec); } catch (e) { sec = null; }
    }

    const isLockDevice = (sec?.session_overflow_action === 'lock_device' || sec?.overflowAction === 'lock_device');

    if (sec && (sec.sessionMode === 'strict_single' || sec.sessionMode === 'multi_device' || isLockDevice)) {
      if (policySelect) {
        if (isLockDevice) {
          policySelect.value = 'lock_device';
        } else {
          policySelect.value = sec.sessionMode;
        }
      }
      if (limitSelect) limitSelect.value = String(sec.maxSessions || sec.session_device_limit || 3);
      if (overflowSelect) overflowSelect.value = sec.overflowAction || sec.session_overflow_action || (isLockDevice ? 'lock_device' : 'kick_oldest');
      if (tokenExpSelect) {
        if (sec.jwt_token_expiry === 'custom' || sec.tokenExpiryPreset === 'custom' || sec.work_hours_enabled) {
          tokenExpSelect.value = 'custom';
        } else if (sec.tokenExpiryPreset) {
          tokenExpSelect.value = sec.tokenExpiryPreset;
        } else if (sec.tokenExpiryHours) {
          tokenExpSelect.value = sec.tokenExpiryHours + 'h';
        } else {
          tokenExpSelect.value = '8h';
        }
      }
      if (startInput) startInput.value = sec.work_start_time || '08:00';
      if (endInput) endInput.value = sec.work_end_time || '16:00';
    } else {
      if (policySelect) policySelect.value = 'inherit';
      if (limitSelect) limitSelect.value = '3';
      if (overflowSelect) overflowSelect.value = 'kick_oldest';
      if (tokenExpSelect) tokenExpSelect.value = '8h';
      if (startInput) startInput.value = '08:00';
      if (endInput) endInput.value = '16:00';
    }

    // شريط الجهاز المعتمد
    const boundBox = document.getElementById('userSecBoundDeviceBox');
    const boundText = document.getElementById('userSecBoundDeviceText');
    const boundResetBtn = document.getElementById('btnUserSecResetBoundDevice');
    if (boundBox) {
      if (isLockDevice || sec?.authorized_device_id) {
        boundBox.style.display = 'flex';
        if (sec?.authorized_device_id) {
          boundText.innerHTML = `📱 <strong>الجهاز المعتمد:</strong> <span style="color:#38bdf8;">${sec.authorized_device_name || 'جهاز مسجل'}</span>`;
          if (boundResetBtn) boundResetBtn.style.display = 'inline-block';
        } else {
          boundText.innerHTML = `📱 <strong>الجهاز المعتمد:</strong> <span style="color:#94a3b8;">لم يسجل بعد (سيتم قفل أول جهاز).</span>`;
          if (boundResetBtn) boundResetBtn.style.display = 'none';
        }
      } else {
        boundBox.style.display = 'none';
      }
    }

    this.onUserSecurityPolicyChange();
    this.onWorkHoursChange();
  },

  // عند تغيير خيار سياسة الأمان داخل نافذة المستخدم
  onUserSecurityPolicyChange() {
    const policyType = document.getElementById('userSecPolicyType')?.value || 'inherit';
    const multiBox = document.getElementById('userSecMultiControls');
    const tokenBox = document.getElementById('userSecTokenBox');
    const badge = document.getElementById('userSecBadgeType');
    const note = document.getElementById('userSecHelpNote');
    const boundBox = document.getElementById('userSecBoundDeviceBox');
    const overflowSelect = document.getElementById('userSecOverflowAction');

    if (policyType === 'lock_device') {
      if (multiBox) multiBox.style.display = 'none';
      if (tokenBox) tokenBox.style.display = 'block';
      if (boundBox) boundBox.style.display = 'flex';
      if (overflowSelect) overflowSelect.value = 'lock_device';
      if (badge) {
        badge.textContent = 'منع أي جهاز جديد 🛡️';
        badge.style.background = 'rgba(16, 185, 129, 0.2)';
        badge.style.color = '#10b981';
      }
      if (note) {
        note.innerHTML = '🛡️ <strong>قفل على جهاز واحد:</strong> يُسمح للمستخدم بالدخول من جهاز واحد فقط معتمد، ويمنع النظام تماماً الدخول من أي جهاز آخر جديد.';
      }
    } else if (policyType === 'strict_single') {
      if (multiBox) multiBox.style.display = 'none';
      if (tokenBox) tokenBox.style.display = 'block';
      if (boundBox) boundBox.style.display = 'none';
      if (overflowSelect && overflowSelect.value === 'lock_device') overflowSelect.value = 'kick_oldest';
      if (badge) {
        badge.textContent = 'جلسة واحدة (مخصص)';
        badge.style.background = 'rgba(239, 68, 68, 0.15)';
        badge.style.color = '#f87171';
      }
      if (note) {
        note.innerHTML = '🔒 <strong>جلسة واحدة صارمة:</strong> يُسمح بتسجيل الدخول من جهاز واحد فقط، وسيتم تطبيق الإجراء المختار فوراً.';
      }
    } else if (policyType === 'multi_device') {
      if (multiBox) multiBox.style.display = 'block';
      if (tokenBox) tokenBox.style.display = 'block';
      if (boundBox) boundBox.style.display = 'none';
      if (overflowSelect && overflowSelect.value === 'lock_device') overflowSelect.value = 'kick_oldest';
      if (badge) {
        badge.textContent = 'متعدد الأجهزة (مخصص)';
        badge.style.background = 'rgba(16, 185, 129, 0.15)';
        badge.style.color = '#34d399';
      }
      if (note) {
        note.innerHTML = '📱💻 <strong>أجهزة متعددة:</strong> يُسمح بفتح الحساب من عدة أجهزة في نفس الوقت حتى السقف المحدد.';
      }
    } else {
      // inherit
      if (multiBox) multiBox.style.display = 'none';
      if (tokenBox) tokenBox.style.display = 'none';
      if (boundBox) boundBox.style.display = 'none';
      if (badge) {
        badge.textContent = 'افتراضي النظام';
        badge.style.background = 'rgba(212, 175, 55, 0.15)';
        badge.style.color = 'var(--gold-light)';
      }
      if (note) {
        note.innerHTML = '⚙️ <strong>وراثة الافتراضي:</strong> يتبع المستخدم إعدادات الأمان والجلسات العامة المعتمدة في النظام.';
      }
    }

    this.onWorkHoursChange();
  },

  // عند تغيير خيار فترة وساعات العمل المخصصة
  onWorkHoursChange() {
    const tokenExpSelect = document.getElementById('userSecTokenExpiry');
    const workHoursBox = document.getElementById('userSecWorkHoursBox');
    const startInput = document.getElementById('userSecStartTime');
    const endInput = document.getElementById('userSecEndTime');
    const badge = document.getElementById('userSecWorkDurationBadge');

    const isCustom = tokenExpSelect?.value === 'custom';
    if (workHoursBox) {
      workHoursBox.style.display = isCustom ? 'block' : 'none';
    }

    if (isCustom && startInput && endInput && badge) {
      const [h1, m1] = (startInput.value || '08:00').split(':').map(Number);
      const [h2, m2] = (endInput.value || '16:00').split(':').map(Number);
      let diff = (h2 * 60 + m2) - (h1 * 60 + m1);
      if (diff <= 0) diff += 24 * 60;
      const hours = (diff / 60).toFixed(1).replace('.0', '');
      badge.textContent = `${hours} ساعات عمل`;
    }
  },

  // ================== تطبيق قوالب الصلاحيات التلقائية ==================

  // فك قفل الجهاز المعتمد لمستخدم من داخل نافذة تعديل المستخدم
  async resetUserBoundDevice() {
    const userId = document.getElementById('userId')?.value;
    if (!userId) {
      const boundText = document.getElementById('userSecBoundDeviceText');
      const boundResetBtn = document.getElementById('btnUserSecResetBoundDevice');
      if (boundText) boundText.textContent = '📱 الجهاز المعتمد: لم يسجل بعد';
      if (boundResetBtn) boundResetBtn.style.display = 'none';
      return;
    }
    if (!confirm('هل تريد فك قفل الجهاز المعتمد لهذا المستخدم؟ سيتمكن من تسجيل الدخول من جهاز جديد واعتماده.')) {
      return;
    }
    try {
      const res = await fetch(`/api/users/${userId}/reset-device`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': Auth.token ? `Bearer ${Auth.token}` : ''
        }
      });
      const data = await res.json();
      if (data.success) {
        const boundText = document.getElementById('userSecBoundDeviceText');
        const boundResetBtn = document.getElementById('btnUserSecResetBoundDevice');
        if (boundText) boundText.textContent = '📱 الجهاز المعتمد: تم فك الارتباط (سيتم اعتماد الجهاز القادم)';
        if (boundResetBtn) boundResetBtn.style.display = 'none';
        if (typeof App !== 'undefined' && App.showToast) {
          App.showToast(data.message, 'success');
        } else {
          alert(data.message);
        }
        await this.loadUsers();
      } else {
        alert(data.message || 'حدث خطأ أثناء فك الربط');
      }
    } catch (e) {
      alert('خطأ: ' + e.message);
    }
  },

  onRoleChange() {
    const role = document.getElementById('userRoleVal')?.value;
    if (role && role !== 'custom') {
      this.applyRolePermissionsPreset(role);
    }
  },

  applyRolePermissionsPreset(role) {
    this.selectAllPermissions(false);
    if (SystemCatalog.roles[role]) {
      for (const permission of SystemCatalog.roles[role].permissions) { const box=document.querySelector(`.perm-chk[value="${permission}"]`); if(box)box.checked=true; }
      return;
    }

    let permsToSelect = [];

    switch (role) {
      case 'admin':
        this.selectAllPermissions(true);
        return;
      case 'accountant':
        permsToSelect = [
          'dashboard:view', 'dashboard:export',
          'accounting:view', 'accounting:create', 'accounting:edit', 'accounting:export',
          'expenses:view', 'expenses:create', 'expenses:edit', 'expenses:export',
          'revenues:view', 'revenues:create', 'revenues:edit', 'revenues:export',
          'billing:view', 'billing:create', 'billing:edit', 'billing:export',
          'custody:view', 'custody:create', 'custody:export',
          'clients:view', 'clients:create', 'clients:export',
          'suppliers:view', 'suppliers:create', 'suppliers:export',
          'cash:view',
          'hr:view',
          'reports:view', 'reports:export'
        ];
        break;
      case 'auditor':
        permsToSelect = [
          'dashboard:view', 'dashboard:export',
          'accounting:view', 'accounting:approve', 'accounting:post', 'accounting:export',
          'expenses:view', 'expenses:approve', 'expenses:export',
          'revenues:view', 'revenues:approve', 'revenues:export',
          'billing:view', 'billing:approve', 'billing:export',
          'custody:view', 'custody:approve', 'custody:export',
          'projects:view', 'projects:export',
          'inventory:view', 'inventory:export',
          'purchases:view', 'purchases:approve', 'purchases:export',
          'hr:view', 'hr:approve', 'hr:export',
          'reports:view', 'reports:export',
          'cash:view'
        ];
        break;
      case 'project_manager':
        permsToSelect = [
          'dashboard:view',
          'projects:view', 'projects:create', 'projects:edit', 'projects:approve', 'projects:export',
          'expenses:view', 'expenses:create',
          'custody:view',
          'inventory:view', 'inventory:issue',
          'reports:view'
        ];
        break;
      case 'storekeeper':
        permsToSelect = [
          'inventory:view', 'inventory:create', 'inventory:edit', 'inventory:issue', 'inventory:export',
          'purchases:view',
          'projects:view'
        ];
        break;
      default:
        return;
    }

    permsToSelect.forEach(val => {
      const chk = document.querySelector(`.perm-chk[value="${val}"]`);
      if (chk) chk.checked = true;
    });
  },

  selectAllPermissions(select) {
    document.querySelectorAll('.perm-chk').forEach(chk => {
      chk.checked = !!select;
    });
  },

  // ================== حفظ المستخدم والصلاحيات ==================
  async submitUserForm(e) {
    if (e) e.preventDefault();

    const id = document.getElementById('userIdVal')?.value;
    const full_name = document.getElementById('userNameVal')?.value?.trim();
    const username = document.getElementById('userUsernameVal')?.value?.trim();
    const password = document.getElementById('userPasswordVal')?.value;
    const passwordConfirm = document.getElementById('userPasswordConfirm')?.value || '';
    if ((!id || password || passwordConfirm) && (!password || password.length < 8 || password !== passwordConfirm)) return App.showToast('أدخل كلمة مرور من 8 خانات على الأقل وتأكيدًا مطابقًا','error');
    const role = document.getElementById('userRoleVal')?.value;
    const phone = document.getElementById('userPhoneVal')?.value?.trim();
    const email = document.getElementById('userEmailVal')?.value?.trim();
    const status = document.getElementById('userStatusVal')?.value || 'active';

    if (!full_name || !username) {
      App.showToast('يرجى ملء الاسم الكامل واسم المستخدم', 'error');
      return;
    }

    if (!id && (!password || password.length < 4)) {
      App.showToast('يرجى إدخال كلمة مرور مناسبة (4 خانات على الأقل)', 'error');
      return;
    }

    // Gather checked permissions
    const checkedPerms = Array.from(document.querySelectorAll('.perm-chk:checked')).map(c => c.value);

    // استخراج وضبط إعدادات الأمان والجلسات من البطاقة المخصصة
    let userSecuritySettings = undefined;
    const isCurrentUserAdmin = Auth.currentUser?.role === 'admin' || Auth.currentUser?.username === 'admin';

    if (isCurrentUserAdmin) {
      const policyType = document.getElementById('userSecPolicyType')?.value || 'inherit';
      const expVal = document.getElementById('userSecTokenExpiry')?.value || '8h';
      const isCustomWorkHours = (expVal === 'custom');
      const startWork = document.getElementById('userSecStartTime')?.value || '08:00';
      const endWork = document.getElementById('userSecEndTime')?.value || '16:00';

      let hours = 8;
      if (isCustomWorkHours) {
        const [h1, m1] = startWork.split(':').map(Number);
        const [h2, m2] = endWork.split(':').map(Number);
        let diff = (h2 * 60 + m2) - (h1 * 60 + m1);
        if (diff <= 0) diff += 24 * 60;
        hours = Math.max(1, Math.round(diff / 60));
      } else if (expVal.endsWith('h')) {
        hours = parseInt(expVal);
      } else if (expVal.endsWith('d')) {
        hours = parseInt(expVal) * 24;
      }

      if (policyType === 'lock_device') {
        userSecuritySettings = {
          sessionMode: 'strict_single',
          maxSessions: 1,
          overflowAction: 'lock_device',
          session_overflow_action: 'lock_device',
          session_mode: 'single',
          session_device_limit: 1,
          jwt_token_expiry: expVal,
          tokenExpiryPreset: expVal,
          tokenExpiryHours: hours,
          work_start_time: startWork,
          work_end_time: endWork,
          work_hours_enabled: isCustomWorkHours,
          updated_at: new Date().toISOString()
        };
      } else if (policyType === 'strict_single') {
        const overflow = document.getElementById('userSecOverflowAction')?.value || 'kick_oldest';
        userSecuritySettings = {
          sessionMode: 'strict_single',
          maxSessions: 1,
          overflowAction: overflow,
          session_overflow_action: overflow,
          session_mode: 'single',
          session_device_limit: 1,
          jwt_token_expiry: expVal,
          tokenExpiryPreset: expVal,
          tokenExpiryHours: hours,
          work_start_time: startWork,
          work_end_time: endWork,
          work_hours_enabled: isCustomWorkHours,
          updated_at: new Date().toISOString()
        };
      } else if (policyType === 'multi_device') {
        const limit = parseInt(document.getElementById('userSecDeviceLimit')?.value || '3');
        const overflow = document.getElementById('userSecOverflowAction')?.value || 'kick_oldest';

        userSecuritySettings = {
          sessionMode: 'multi_device',
          maxSessions: limit,
          overflowAction: overflow,
          session_overflow_action: overflow,
          session_mode: 'multi',
          session_device_limit: limit,
          jwt_token_expiry: expVal,
          tokenExpiryPreset: expVal,
          tokenExpiryHours: hours,
          work_start_time: startWork,
          work_end_time: endWork,
          work_hours_enabled: isCustomWorkHours,
          updated_at: new Date().toISOString()
        };
      } else {
        // inherit: نرسل null ليتم وراثة إعدادات النظام العامة
        userSecuritySettings = null;
      }

      // إذا كان المستخدم قيد التعديل ولديه جهاز معتمد مسجل، نحافظ على بيانات الجهاز المعتمد
      const editUserId = document.getElementById('userIdVal')?.value;
      if (editUserId && userSecuritySettings) {
        const existingUser = this._cachedUsers?.find(u => String(u.id) === String(editUserId));
        let prevSec = {};
        if (existingUser && existingUser.security_settings) {
          try {
            prevSec = typeof existingUser.security_settings === 'string'
              ? JSON.parse(existingUser.security_settings)
              : existingUser.security_settings;
          } catch (e) {}
        }
        if (prevSec.authorized_device_id) {
          userSecuritySettings.authorized_device_id = prevSec.authorized_device_id;
          userSecuritySettings.authorized_device_name = prevSec.authorized_device_name;
          userSecuritySettings.authorized_device_at = prevSec.authorized_device_at;
        }
      }
    }

    let finalPerms = [...checkedPerms];
    let finalRole = role;

    const totalCheckboxes = document.querySelectorAll('.perm-chk').length;
    if (finalRole === 'admin' && finalPerms.length >= totalCheckboxes) {
      if (!finalPerms.includes('all')) finalPerms.unshift('all');
    } else if (finalPerms.length < totalCheckboxes && finalRole === 'admin' && username !== 'admin') {
      finalRole = 'custom';
    }

    // قراءة والتحقق من رمز التحقق بخطوتين (2FA PIN)
    const pinInput = document.getElementById('user2FaPinVal');
    const tfaEnabledChk = document.getElementById('user2FaEnabledVal');
    
    const normalizeDigits = (str) => {
      if (!str) return '';
      return String(str)
        .replace(/[٠-٩]/g, d => '0123456789'['٠١٢٣٤٥٦٧٨٩'.indexOf(d)])
        .replace(/[۰-۹]/g, d => '0123456789'['۰۱۲۳۴۵۶۷۸۹'.indexOf(d)])
        .replace(/[^0-9]/g, '')
        .trim();
    };

    const twoFactorPin = normalizeDigits(pinInput ? pinInput.value : '');
    const twoFactorEnabled = tfaEnabledChk ? (tfaEnabledChk.checked ? 1 : 0) : 1;

    if (twoFactorPin && !/^\d{6}$/.test(twoFactorPin)) {
      App.showToast('رمز التحقق بخطوتين (PIN) يجب أن يتكون من 6 أرقام تماماً', 'warning');
      if (pinInput) pinInput.focus();
      return;
    }
    if (twoFactorEnabled && !id && !twoFactorPin) {
      App.showToast('أدخل رمز PIN خاصاً من 6 أرقام لتفعيل التحقق بخطوتين للمستخدم الجديد', 'warning');
      if (pinInput) pinInput.focus();
      return;
    }

    // قراءة وتحديد نطاق الصلاحيات الجغرافي والإداري (Branch / Dept / Projects)
    const branch_id = document.getElementById('userBranchVal')?.value || null;
    const department_id = document.getElementById('userDepartmentVal')?.value || null;
    const allProjScope = document.getElementById('userAllProjectsScopeChk')?.checked;
    let allowed_projects = 'all';
    if (!allProjScope) {
      const selectedProjIds = Array.from(document.querySelectorAll('.user-proj-scope-chk:checked')).map(c => Number(c.value));
      allowed_projects = selectedProjIds;
    }

    const payload = {
      full_name,
      username,
      role: finalRole,
      phone,
      email,
      status,
      permissions: finalPerms,
      two_factor_enabled: twoFactorEnabled,
      branch_id: branch_id ? Number(branch_id) : null,
      department_id: department_id ? Number(department_id) : null,
      allowed_projects
    };

    // On edit, omit a blank PIN so the database keeps the existing secret.
    if (twoFactorPin) payload.two_factor_pin = twoFactorPin;

    if (userSecuritySettings !== undefined) {
      payload.security_settings = userSecuritySettings;
    }

    if (password && password.trim().length > 0) {
      payload.password = password;
      payload.password_confirm = passwordConfirm;
    }

    const saveBtn = document.getElementById('btnSaveUser');
    const originalBtnText = saveBtn ? saveBtn.innerHTML : 'حفظ';
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span>⏳</span> جاري الحفظ والتحقق من قاعدة البيانات...';
    }

    try {
      const url = id ? `/api/users/${id}` : '/api/users';
      const method = id ? 'PUT' : 'POST';

      const headers = { 'Content-Type': 'application/json' };
      if (Auth.token) {
        headers['Authorization'] = `Bearer ${Auth.token}`;
      }

      const res = await fetch(url, {
        method,
        headers,
        body: JSON.stringify(payload)
      });

      let data;
      const text = await res.text();
      try {
        data = JSON.parse(text);
      } catch (e) {
        throw new Error('استجابة غير متوقعة من الخادم (' + res.status + '). يرجى إعادة تشغيل الخادم وتحديث الصفحة.');
      }

      if (res.ok && data.success) {
        App.showToast(data.message || 'تم حفظ المستخدم وتعيين الصلاحيات بنجاح!', 'success');
        App.closeModal('newUserModal');
        await this.loadUsers();
      } else {
        App.showToast(data.message || 'حدث خطأ أثناء حفظ المستخدم', 'error');
      }
    } catch (err) {
      console.error('Error saving user:', err);
      App.showToast('تعذر الاتصال بالخادم لحفظ المستخدم', 'error');
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = originalBtnText;
      }
    }
  },

  // ================== تبديل حالة المستخدم ==================
  async toggleUserStatus(userId) {
    try {
      const res = await fetch(`/api/users/${userId}/status`, {
        method: 'PATCH'
      });
      const data = await res.json();
      if (res.ok && data.success) {
        App.showToast(data.message, 'success');
        await this.loadUsers();
      } else {
        App.showToast(data.message || 'تعذر تغيير حالة الحساب', 'error');
      }
    } catch (e) {
      App.showToast('خطأ في الاتصال بالخادم', 'error');
    }
  },

  // ================== حذف مستخدم ==================
  async deleteUser(userId, username) {
    if (window.UI && UI.UndoManager) {
      const row = document.querySelector(`tr[data-user-id="${userId}"]`) || document.getElementById(`userRow_${userId}`);
      if (row) row.style.display = 'none';

      UI.UndoManager.deferAction({
        id: `delete_user_${userId}`,
        description: `🗑️ تم حذف حساب المستخدم (${username}) مؤقتاً`,
        timeout: 6500,
        onUndo: () => {
          if (row) row.style.display = '';
        },
        onCommit: async () => {
          try {
            const res = await fetch(`/api/users/${userId}`, { method: 'DELETE' });
            const data = await res.json();
            if (res.ok && data.success) {
              await this.loadUsers();
            } else {
              App.showToast(data.message || 'تعذر حذف المستخدم', 'error');
              if (row) row.style.display = '';
            }
          } catch (e) {
            App.showToast('خطأ في الاتصال بالخادم', 'error');
            if (row) row.style.display = '';
          }
        }
      });
    } else {
      if (!confirm(`هل أنت متأكد من حذف المستخدم (${username}) نهائياً من النظام؟`)) {
        return;
      }

      try {
        const res = await fetch(`/api/users/${userId}`, {
          method: 'DELETE'
        });
        const data = await res.json();
        if (res.ok && data.success) {
          App.showToast(data.message, 'success');
          await this.loadUsers();
        } else {
          App.showToast(data.message || 'تعذر حذف المستخدم', 'error');
        }
      } catch (e) {
        App.showToast('خطأ في الاتصال بالخادم', 'error');
      }
    }
  },

  // ================== إنهاء جلسة مستخدم وفصله عن النظام ==================
  async disconnectUser(userId, userName) {
    const isConfirm = confirm(`هل أنت متأكد من رغبتك في إنهاء جلسة المستخدم (${userName}) وفصله عن النظام فوراً لمنع التكرار؟`);
    if (!isConfirm) return;

    try {
      const res = await fetch(`/api/users/${userId}/disconnect`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        App.showToast(data.message || `تم إنهاء جلسة (${userName}) وفصله بنجاح`, 'success');
        await this.loadUsers();
      } else {
        App.showToast(data.message || 'تعذر إنهاء جلسة المستخدم', 'error');
      }
    } catch (e) {
      App.showToast('خطأ في الاتصال بالخادم أثناء فصل المستخدم', 'error');
    }
  },

  // ================== تنزيل نسخة احتياطية كاملة ==================
  async downloadBackup() {
    const btn = document.querySelector('button[onclick="Settings.downloadBackup()"]');
    const originalText = btn ? btn.innerHTML : '';
    try {
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span>⏳ جاري إعداد وتنزيل النسخة...</span>';
      }
      App.showToast('جاري تحضير وتنزيل النسخة الاحتياطية لكافة بيانات ومشاريع وحسابات النظام...', 'info');

      const token = (window.Auth && window.Auth.token)
        || localStorage.getItem('rawasi_token')
        || sessionStorage.getItem('rawasi_token')
        || '';

      const downloadUrl = `/api/settings/backup${token ? `?token=${encodeURIComponent(token)}` : ''}`;

      // محاولة التنزيل المباشر كـ Blob مع توثيق التوكن لضمان الحفظ الموثوق
      const res = await fetch(downloadUrl, {
        method: 'GET',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });

      if (!res.ok) {
        let errMsg = `فشل تنزيل النسخة الاحتياطية (رمز: ${res.status})`;
        try {
          const errData = await res.json();
          if (errData && errData.message) errMsg = errData.message;
        } catch (_) {}
        throw new Error(errMsg);
      }

      const blob = await res.blob();
      const contentDisposition = res.headers.get('content-disposition');
      let fileName = `backup_rawasi_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.db`;
      if (contentDisposition) {
        const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
        if (match && match[1]) {
          fileName = match[1].replace(/['"]/g, '').trim();
        }
      }

      // إنشاء رابط التنزيل وتفعيله برمجياً
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = blobUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();

      setTimeout(() => {
        window.URL.revokeObjectURL(blobUrl);
        a.remove();
      }, 2000);

      App.showToast('تم تنزيل النسخة الاحتياطية الكاملة بنجاح والاحتفاظ بها على جهازك بأمان 💾', 'success');
      if (typeof this.loadServerBackups === 'function') {
        this.loadServerBackups();
      }
    } catch (e) {
      console.error('Backup download error:', e);
      // في حالة وجود إشكال مع Blob، نوفر fallback بالرابط المباشر متضمناً التوكن
      const token = (window.Auth && window.Auth.token)
        || localStorage.getItem('rawasi_token')
        || sessionStorage.getItem('rawasi_token')
        || '';
      if (token) {
        App.showToast('جاري بدء التنزيل المباشر كحل بديل...', 'info');
        window.location.href = `/api/settings/backup?token=${encodeURIComponent(token)}`;
      } else {
        App.showToast(e.message || 'خطأ في تنزيل النسخة الاحتياطية', 'error');
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalText;
      }
    }
  },

  async downloadServerBackup(fileName) {
    try {
      const token = (window.Auth && window.Auth.token)
        || localStorage.getItem('rawasi_token')
        || sessionStorage.getItem('rawasi_token')
        || '';
      const url = `/api/settings/backups/download/${encodeURIComponent(fileName)}${token ? `?token=${encodeURIComponent(token)}` : ''}`;
      
      const res = await fetch(url, {
        method: 'GET',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });

      if (!res.ok) {
        throw new Error(`تعذر تنزيل الملف (رمز: ${res.status})`);
      }

      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = blobUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        window.URL.revokeObjectURL(blobUrl);
        a.remove();
      }, 2000);

      App.showToast(`تم تنزيل النسخة الاحتياطية (${fileName}) بنجاح 💾`, 'success');
    } catch (e) {
      console.error('Error downloading server backup:', e);
      const token = (window.Auth && window.Auth.token)
        || localStorage.getItem('rawasi_token')
        || sessionStorage.getItem('rawasi_token')
        || '';
      if (token) {
        window.location.href = `/api/settings/backups/download/${encodeURIComponent(fileName)}?token=${encodeURIComponent(token)}`;
      } else {
        App.showToast('تعذر تنزيل النسخة المحددة', 'error');
      }
    }
  },

  // ================== استعادة النسخ الاحتياطية ==================
  openRestoreModal() {
    this._selectedBackupFile = null;
    this._selectedServerBackupName = null;

    const fileInput = document.getElementById('backupFileInput');
    if (fileInput) fileInput.value = '';

    const dropzoneText = document.getElementById('selectedBackupFileName');
    if (dropzoneText) dropzoneText.textContent = 'أو اسحب وأفلت الملف هنا';

    const confirmBtn = document.getElementById('btnConfirmRestore');
    if (confirmBtn) confirmBtn.disabled = true;

    App.openModal('restoreBackupModal');
    this.loadServerBackups();
  },

  handleFileSelected(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    if (!file.name.endsWith('.db') && !file.name.endsWith('.sqlite')) {
      App.showToast('يرجى اختيار ملف قاعدة بيانات صالح بصيغة (.db أو .sqlite)', 'error');
      return;
    }

    this._selectedBackupFile = file;
    this._selectedServerBackupName = null;

    const dropzoneText = document.getElementById('selectedBackupFileName');
    if (dropzoneText) {
      const sizeKB = (file.size / 1024).toFixed(1);
      dropzoneText.innerHTML = `<strong style="color: var(--gold-light);">الملف المحدد:</strong> ${file.name} (${sizeKB} KB)`;
    }

    const confirmBtn = document.getElementById('btnConfirmRestore');
    if (confirmBtn) confirmBtn.disabled = false;
  },

  selectServerBackup(fileName) {
    this._selectedServerBackupName = fileName;
    this._selectedBackupFile = null;

    const fileInput = document.getElementById('backupFileInput');
    if (fileInput) fileInput.value = '';

    const dropzoneText = document.getElementById('selectedBackupFileName');
    if (dropzoneText) {
      dropzoneText.innerHTML = `<strong style="color: var(--accent-blue);">تم اختيار نسخة من الخادم:</strong> ${fileName}`;
    }

    const confirmBtn = document.getElementById('btnConfirmRestore');
    if (confirmBtn) confirmBtn.disabled = false;

    App.showToast(`تم اختيار النسخة: ${fileName}`, 'info');
  },

  async loadServerBackups() {
    try {
      const res = await fetch('/api/settings/backups');
      const json = await res.json();
      const container = document.getElementById('serverBackupsList');
      const section = document.getElementById('serverBackupsSection');
      if (container && section) {
        if (json.success && json.data && json.data.length > 0) {
          section.style.display = 'block';
          container.innerHTML = json.data.map(b => {
            const dateStr = new Date(b.createdAt).toLocaleString('ar-YE');
            const sizeKB = (b.size / 1024).toFixed(1);
            return `
              <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.03); padding: 8px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-light);">
                <div>
                  <div style="font-size: 0.85rem; font-weight: 600; color: var(--gold-light);">${b.fileName}</div>
                  <div style="font-size: 0.75rem; color: var(--text-secondary);">${dateStr} | ${sizeKB} KB</div>
                </div>
                <button type="button" class="btn btn-secondary btn-sm" onclick="Settings.selectServerBackup('${b.fileName}')">
                  اختيار هذه النسخة
                </button>
              </div>
            `;
          }).join('');
        } else {
          section.style.display = 'none';
        }
      }
    } catch (e) {
      console.error('Error loading backups:', e);
    }
  },

  async executeRestore() {
    const confirmBtn = document.getElementById('btnConfirmRestore');
    if (!this._selectedBackupFile && !this._selectedServerBackupName) {
      App.showToast('يرجى اختيار ملف النسخة الاحتياطية أولاً', 'error');
      return;
    }

    const targetName = this._selectedBackupFile ? this._selectedBackupFile.name : this._selectedServerBackupName;
    if (!confirm(`هل أنت متأكد تماماً من استعادة النسخة الاحتياطية (${targetName})؟\n\nتنبيه: سيتم استبدال كافة البيانات الحالية ببيانات النسخة المحددة.`)) {
      return;
    }

    const originalBtnHtml = confirmBtn ? confirmBtn.innerHTML : 'بدء الاستعادة والتأكيد';
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<span>⏳</span> جاري استعادة قاعدة البيانات والتحقق...';
    }

    try {
      let res;
      if (this._selectedBackupFile) {
        res = await fetch('/api/settings/restore-upload', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-Filename': encodeURIComponent(this._selectedBackupFile.name)
          },
          body: this._selectedBackupFile
        });
      } else {
        res = await fetch('/api/settings/restore-local', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: this._selectedServerBackupName })
        });
      }

      const data = await res.json();
      if (res.ok && data.success) {
        App.showToast(data.message || 'تمت استعادة قاعدة البيانات بنجاح! جاري تحديث الصفحة...', 'success');
        App.closeModal('restoreBackupModal');
        setTimeout(() => {
          window.location.reload();
        }, 1800);
      } else {
        App.showToast(data.message || 'فشلت عملية استعادة النسخة الاحتياطية', 'error');
      }
    } catch (e) {
      console.error('Restore error:', e);
      App.showToast('فشل الاتصال بالخادم أثناء استعادة النسخة الاحتياطية', 'error');
    } finally {
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = originalBtnHtml;
      }
    }
  },

  // =========================================================================
  // منظومة النسخ الاحتياطي واستعادة البيانات وإدارة الكوارث الموحدة (Disaster Recovery)
  // =========================================================================

  async loadDisasterRecoveryDashboard() {
    try {
      const res = await fetch('/api/settings/backup/dr-status');
      const json = await res.json();
      if (!json.success || !json.data) return;
      const d = json.data;

      // 1. آخر نسخة معتمدة
      const lastBackupDateEl = document.getElementById('drLastBackupDate');
      const lastBackupFileEl = document.getElementById('drLastBackupFile');
      const lastBackupHashEl = document.getElementById('drLastBackupHash');
      if (d.lastBackup) {
        const dt = new Date(d.lastBackup.createdAt);
        const sizeMb = (d.lastBackup.size / (1024 * 1024)).toFixed(2);
        if (lastBackupDateEl) lastBackupDateEl.textContent = `${dt.toLocaleDateString('ar-YE')} ${dt.toLocaleTimeString('ar-YE', { hour: '2-digit', minute: '2-digit' })}`;
        if (lastBackupFileEl) lastBackupFileEl.innerHTML = `<span style="color:var(--gold-light); font-weight:600;">${d.lastBackup.fileName}</span> <span style="color:#94a3b8;">(${sizeMb} MB)</span> ${d.lastBackup.encrypted ? '🔒' : '📄'}`;
        if (lastBackupHashEl) lastBackupHashEl.innerHTML = `<code style="font-size:0.72rem; color:#38bdf8;">SHA-256: ${d.lastBackup.sha256 ? d.lastBackup.sha256.slice(0, 16) + '...' : '-'}</code>`;
      } else {
        if (lastBackupDateEl) lastBackupDateEl.textContent = 'لا توجد نسخ مسجلة بعد';
        if (lastBackupFileEl) lastBackupFileEl.textContent = '-';
        if (lastBackupHashEl) lastBackupHashEl.textContent = '';
      }

      // 2. آخر اختبار استعادة
      const lastTestStatusEl = document.getElementById('drLastTestStatus');
      const lastTestDetailsEl = document.getElementById('drLastTestDetails');
      if (d.lastTest) {
        const testDt = new Date(d.lastTest.createdAt);
        if (lastTestStatusEl) {
          lastTestStatusEl.innerHTML = d.lastTest.status === 'passed' 
            ? '🟢 مجاز وسليم (Passed)' 
            : '🔴 فشل الفحص الأخير';
          lastTestStatusEl.style.color = d.lastTest.status === 'passed' ? '#4ade80' : '#f87171';
        }
        if (lastTestDetailsEl) {
          lastTestDetailsEl.innerHTML = `${testDt.toLocaleDateString('ar-YE')} | ${d.lastTest.tablesCount} جدول | توازن الحسابات: ${d.lastTest.isBalanced ? 'متزن ⚖️' : 'غير متزن ⚠️'} | (${d.lastTest.durationMs}ms)`;
        }
      } else {
        if (lastTestStatusEl) {
          lastTestStatusEl.innerHTML = '⚠️ لم يتم إجراء اختبار بعد';
          lastTestStatusEl.style.color = '#facc15';
        }
        if (lastTestDetailsEl) lastTestDetailsEl.textContent = 'يُوصى بإجراء اختبار في بيئة معزولة Sandbox للتحقق من جاهزية الاستعادة';
      }

      // 3. مسار التخزين والديمومة
      const storagePathEl = document.getElementById('drStoragePath');
      const storagePersistEl = document.getElementById('drStoragePersist');
      if (storagePathEl) storagePathEl.textContent = d.storage.path || '-';
      if (storagePersistEl) {
        if (d.storage.isRailwayPersistent) {
          storagePersistEl.innerHTML = '🟢 تخزين دائم مؤكد (Railway Volume Persistent) 🛡️';
          storagePersistEl.style.color = '#4ade80';
        } else {
          storagePersistEl.innerHTML = '⚠️ تخزين محلي داخل الحاوية (Ephemeral Storage) - يُنصح بربط Railway Volume';
          storagePersistEl.style.color = '#facc15';
        }
      }

      // 4. إجمالي النسخ والحجم
      const totalCountEl = document.getElementById('drTotalCount');
      const totalSizeEl = document.getElementById('drTotalSize');
      if (totalCountEl) totalCountEl.textContent = `${d.stats.totalBackups} نسخة صالحة`;
      if (totalSizeEl) totalSizeEl.textContent = `${d.stats.totalSizeMB} ميجابايت`;

    } catch (e) {
      console.error('Error loading DR status:', e);
    }
  },

  async loadBackupRecords() {
    const tbody = document.getElementById('backupRecordsTableBody');
    if (!tbody) return;

    try {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 20px; color: var(--text-secondary);">⏳ جاري تحميل سجلات النسخ الاحتياطية...</td></tr>';
      const res = await fetch('/api/settings/backup/records');
      const json = await res.json();

      if (!json.success || !json.data || json.data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 25px; color: var(--text-secondary);">لا توجد نسخ احتياطية مسجلة حتى الآن. اضغط على (إنشاء نسخة احتياطية فورية) لبدء النسخ المعتمد.</td></tr>';
        return;
      }

      tbody.innerHTML = json.data.map(rec => {
        const dt = new Date(rec.created_at);
        const dateStr = `${dt.toLocaleDateString('ar-YE')} ${dt.toLocaleTimeString('ar-YE', { hour: '2-digit', minute: '2-digit' })}`;
        const sizeMb = (rec.file_size / (1024 * 1024)).toFixed(2);
        
        // نوع النسخة
        let typeBadge = '<span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3);">يدوي 👤</span>';
        if (rec.backup_type === 'scheduled_daily') typeBadge = '<span class="badge" style="background: rgba(74, 222, 128, 0.15); color: #4ade80; border: 1px solid rgba(74, 222, 128, 0.3);">مجدول يومي 📅</span>';
        if (rec.backup_type === 'scheduled_weekly') typeBadge = '<span class="badge" style="background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.3);">مجدول أسبوعي 📆</span>';
        if (rec.backup_type === 'scheduled_monthly') typeBadge = '<span class="badge" style="background: rgba(234, 179, 8, 0.15); color: #facc15; border: 1px solid rgba(234, 179, 8, 0.3);">مجدول شهري 🗓️</span>';
        if (rec.backup_type === 'logout') typeBadge = '<span class="badge" style="background: rgba(148, 163, 184, 0.15); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.3);">خروج 🚪</span>';
        if (rec.backup_type === 'pre_migration') typeBadge = '<span class="badge" style="background: rgba(249, 115, 22, 0.15); color: #fb923c; border: 1px solid rgba(249, 115, 22, 0.3);">أمان قبل الترقية ⚙️</span>';

        // التشفير
        const encBadge = rec.encrypted 
          ? '<span style="color:#4ade80; font-size:0.8rem; font-weight:600;" title="مشفر عبر AES-256-GCM">🔒 مشفر</span>'
          : '<span style="color:#94a3b8; font-size:0.8rem;">📄 غير مشفر</span>';

        // حالة التحقق
        const integrityBadge = rec.integrity_check_result === 'ok'
          ? '<span style="color:#4ade80; font-size:0.8rem;">سليمة ✅</span>'
          : `<span style="color:#f87171; font-size:0.8rem;">⚠️ ${rec.integrity_check_result || 'غير محدد'}</span>`;

        // حالة اختبار الاستعادة
        let testBadge = '<span style="color:#facc15; font-size:0.75rem;">لم تُختبر</span>';
        if (rec.test_status === 'test_passed') {
          testBadge = '<span style="color:#4ade80; font-size:0.78rem; font-weight:600;" title="تم فحص وتأكيد الاستعادة في بيئة معزولة Sandbox">🧪 مجاز بنجاح</span>';
        } else if (rec.test_status === 'test_failed') {
          testBadge = '<span style="color:#f87171; font-size:0.78rem; font-weight:600;">❌ فشل الاختبار</span>';
        }

        // الحماية
        const protectIcon = rec.is_protected
          ? `<button type="button" class="btn btn-sm" onclick="Settings.toggleBackupProtection(${rec.id}, 1)" title="نسخة محمية من الحذف التلقائي. اضغط لإلغاء التثبيت" style="background: rgba(234, 179, 8, 0.2); color: #facc15; border: 1px solid rgba(234, 179, 8, 0.4);">📌 مثبتة ومحمية</button>`
          : `<button type="button" class="btn btn-sm btn-secondary" onclick="Settings.toggleBackupProtection(${rec.id}, 0)" title="تثبيت وحماية من الحذف التلقائي">📌 حماية</button>`;

        const safeFileName = rec.file_name.replace(/'/g, "\\'");

        return `
          <tr>
            <td>
              <div style="font-weight:600; color:var(--gold-light); font-size:0.88rem; direction:ltr; text-align:right;">${rec.file_name}</div>
              <div style="font-size:0.72rem; color:#94a3b8; font-family:monospace;">${rec.backup_uid}</div>
            </td>
            <td>${typeBadge}</td>
            <td><strong>${sizeMb} MB</strong></td>
            <td><span style="font-size:0.8rem;">${dateStr}</span></td>
            <td>${encBadge}</td>
            <td>${integrityBadge}</td>
            <td>${testBadge}</td>
            <td>${protectIcon}</td>
            <td style="text-align: center; white-space: nowrap;">
              <button type="button" class="btn btn-secondary btn-sm" onclick="Settings.downloadBackupRecord('${rec.id}', '${safeFileName}')" title="تنزيل النسخة" style="margin-left: 4px;">
                📥
              </button>
              <button type="button" class="btn btn-secondary btn-sm" onclick="Settings.runSandboxTest('${rec.id}', '${safeFileName}')" title="فحص واختبار الاستعادة في بيئة معزولة Sandbox" style="border-color: #38bdf8; color: #38bdf8; margin-left: 4px;">
                🧪 فحص Sandbox
              </button>
              <button type="button" class="btn btn-secondary btn-sm" onclick="Settings.openProductionRestoreModal('${rec.id}', '${safeFileName}', ${rec.encrypted ? 1 : 0})" title="استعادة إلى الإنتاج مع نسخة أمان وتراجع تلقائي" style="border-color: #f59e0b; color: #f59e0b; margin-left: 4px;">
                ↩️ استعادة
              </button>
              ${rec.is_protected ? '' : `
                <button type="button" class="btn btn-danger btn-sm" onclick="Settings.deleteBackupRecord('${rec.id}', '${safeFileName}')" title="حذف النسخة" style="padding: 4px 8px;">
                  🗑️
                </button>
              `}
            </td>
          </tr>
        `;
      }).join('');
    } catch (e) {
      console.error('Error loading backup records:', e);
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 20px; color: var(--accent-red);">خطأ أثناء تحميل سجلات النسخ: ${e.message}</td></tr>`;
    }
  },

  openCreateBackupModal() {
    App.openModal('createBackupModal');
  },

  async executeCreateBackup(event) {
    if (event) event.preventDefault();
    const btn = document.getElementById('btnSubmitCreateBackup');
    const origHtml = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span>⏳ جاري الإنشاء والتحقق من النزاهة وحساب البصمة...</span>';
    }

    const scope = document.getElementById('newBackupScope')?.value || 'database_only';
    const encrypt = document.getElementById('newBackupEncrypt')?.checked || false;
    const passphrase = document.getElementById('newBackupPassphrase')?.value || '';
    const isProtected = document.getElementById('newBackupProtected')?.checked || false;
    const protectedReason = document.getElementById('newBackupProtectedReason')?.value || '';

    if (encrypt && (!passphrase || passphrase.trim().length < 4)) {
      App.showToast('كلمة مرور التشفير يجب ألا تقل عن 4 خانات', 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = origHtml; }
      return;
    }

    try {
      const res = await fetch('/api/settings/backup/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope,
          encrypt,
          passphrase,
          isProtected,
          protectedReason
        })
      });

      const json = await res.json();
      if (json.success) {
        App.showToast(json.message || 'تم إنشاء النسخة الاحتياطية المعتمدة بنجاح 🛡️', 'success');
        App.closeModal('createBackupModal');
        await this.loadDisasterRecoveryDashboard();
        await this.loadBackupRecords();
      } else {
        App.showToast(json.message || 'فشل إنشاء النسخة الاحتياطية', 'error');
      }
    } catch (err) {
      App.showToast('خطأ في الاتصال بالخادم أثناء إنشاء النسخة', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origHtml;
      }
    }
  },

  async runSandboxTest(backupId, fileName) {
    let passphrase = '';
    if (fileName && fileName.endsWith('.enc')) {
      passphrase = prompt(`النسخة (${fileName}) مشفرة. يرجى إدخال كلمة مرور فك التشفير لإجراء الاختبار التجريبي:`);
      if (passphrase === null) return;
    }

    App.showToast(`🧪 بدء اختبار الاستعادة في بيئة معزولة Sandbox (${fileName})...`, 'info');

    const modal = document.getElementById('sandboxTestProgressModal');
    if (modal) {
      const targetNameEl = document.getElementById('sandboxTestTargetName');
      if (targetNameEl) targetNameEl.textContent = fileName;
      const resBox = document.getElementById('sandboxTestResultBox');
      if (resBox) resBox.style.display = 'none';
      const sp = document.getElementById('sandboxTestSpinner');
      if (sp) sp.style.display = 'block';
      App.openModal('sandboxTestProgressModal');
    }

    try {
      const res = await fetch('/api/settings/backup/test-restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backupId, passphrase })
      });

      const json = await res.json();
      const spinner = document.getElementById('sandboxTestSpinner');
      const resultBox = document.getElementById('sandboxTestResultBox');
      if (spinner) spinner.style.display = 'none';

      if (json.success && json.data) {
        const d = json.data;
        if (resultBox) {
          resultBox.style.display = 'block';
          resultBox.className = 'alert alert-success';
          resultBox.innerHTML = `
            <div style="font-weight: 700; font-size: 1rem; color: #4ade80; margin-bottom: 8px;">
              ✅ اجتازت النسخة الاحتياطية الاختبار التجريبي بنجاح تام!
            </div>
            <div style="font-size: 0.85rem; line-height: 1.6; color: #f8fafc;">
              <div>• <strong>فحص بنية B-Tree و SQLite:</strong> سليم ومطابق للمواصفات (${d.integrityResult})</div>
              <div>• <strong>إجمالي الجداول المفحوصة:</strong> ${d.stats?.total_tables || 0} جدول</div>
              <div>• <strong>مستخدمي النظام النشطين:</strong> ${d.stats?.users_count || 0} مستخدم</div>
              <div>• <strong>حسابات دليل الحسابات:</strong> ${d.stats?.accounts_count || 0} حساب</div>
              <div>• <strong>القيود المحاسبية اليومية:</strong> ${d.stats?.journal_entries_count || 0} قيد</div>
              <div>• <strong>ميزان المراجعة والاتزان:</strong> ${d.stats?.is_balanced ? '<span style="color:#4ade80;">متزن تماماً (المدين = الدائن) ⚖️</span>' : '<span style="color:#f87171;">غير متزن ⚠️</span>'}</div>
              <div>• <strong>زمن التنفيذ والفحص:</strong> ${d.durationMs} ملي ثانية</div>
              <div style="margin-top: 6px; font-size: 0.78rem; color: #94a3b8;">
                * تم فحص النسخة في مجلد عمل مؤقت معزول وتم حذفه فوراً دون المساس إطلاقاً ببيانات الإنتاج الحالية.
              </div>
            </div>
          `;
        }
        App.showToast('اجتازت النسخة اختبار الاستعادة التجريبي بنجاح! 🧪✅', 'success');
        await this.loadDisasterRecoveryDashboard();
        await this.loadBackupRecords();
      } else {
        if (resultBox) {
          resultBox.style.display = 'block';
          resultBox.className = 'alert alert-danger';
          resultBox.innerHTML = `
            <div style="font-weight: 700; color: #f87171; margin-bottom: 4px;">❌ فشل اختبار الاستعادة:</div>
            <div style="font-size: 0.85rem; color: #fca5a5;">${json.message || 'حدث خطأ غير معروف'}</div>
          `;
        }
        App.showToast(json.message || 'فشل فحص النسخة', 'error');
        await this.loadBackupRecords();
      }
    } catch (e) {
      App.showToast('خطأ أثناء تشغيل فحص Sandbox: ' + e.message, 'error');
    }
  },

  openProductionRestoreModal(backupId, fileName, isEncrypted) {
    this._drRestoreTargetId = backupId;
    this._drRestoreTargetName = fileName;

    const nameEl = document.getElementById('drRestoreFileName');
    if (nameEl) nameEl.textContent = fileName;

    const passGroup = document.getElementById('drRestorePassphraseGroup');
    if (passGroup) passGroup.style.display = isEncrypted ? 'block' : 'none';

    const confirmInp = document.getElementById('drRestoreConfirmInput');
    if (confirmInp) confirmInp.value = '';

    const reasonInp = document.getElementById('drRestoreReasonInput');
    if (reasonInp) reasonInp.value = 'استعادة معتمدة بطلب من الإدارة';

    App.openModal('drProductionRestoreModal');
  },

  async executeProductionRestore() {
    const backupId = this._drRestoreTargetId;
    const fileName = this._drRestoreTargetName;
    if (!backupId) return;

    const confirmText = document.getElementById('drRestoreConfirmInput')?.value?.trim();
    if (confirmText !== 'استعادة' && confirmText !== 'RESTORE') {
      App.showToast('لتأكيد الاستعادة الإنتاجية، يجب كتابة كلمة (استعادة) صراحة في الحقل المخصص', 'error');
      return;
    }

    const passphrase = document.getElementById('drRestorePassphraseInput')?.value || '';
    const reason = document.getElementById('drRestoreReasonInput')?.value || 'استعادة إنتاجية معتمدة';

    const btn = document.getElementById('btnConfirmDrProductionRestore');
    const origHtml = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span>⏳ جاري الفحص المسبق في Sandbox وحفظ نسخة الأمان والاستعادة...</span>';
    }

    try {
      const res = await fetch('/api/settings/backup/restore-production', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          backupId,
          passphrase,
          reason,
          confirmationText: confirmText
        })
      });

      const json = await res.json();
      if (json.success) {
        App.showToast('تمت الاستعادة الإنتاجية بنجاح تام وتم التحقق من الجداول والحسابات! 🚀 جاري إعادة تحميل الصفحة...', 'success');
        App.closeModal('drProductionRestoreModal');
        setTimeout(() => {
          window.location.reload();
        }, 2200);
      } else {
        App.showToast(`فشلت الاستعادة: ${json.message}`, 'error');
      }
    } catch (err) {
      App.showToast('خطأ في الاتصال أثناء تنفيذ الاستعادة: ' + err.message, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origHtml;
      }
    }
  },

  async toggleBackupProtection(backupId, currentProtection) {
    const isProtected = currentProtection === 1 ? false : true;
    let reason = '';
    if (isProtected) {
      reason = prompt('يرجى إدخال سبب حماية وتثبيت هذه النسخة (مثال: إقفال الحسابات السنوية):') || 'مثبتة بطلب من المسؤول';
    }

    try {
      const res = await fetch('/api/settings/backup/protect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backupId, isProtected, reason })
      });
      const json = await res.json();
      if (json.success) {
        App.showToast(json.message, 'success');
        await this.loadBackupRecords();
      } else {
        App.showToast(json.message, 'error');
      }
    } catch (e) {
      App.showToast('خطأ أثناء تعديل حماية النسخة', 'error');
    }
  },

  async deleteBackupRecord(backupId, fileName) {
    if (!confirm(`هل أنت متأكد من رغبتك في حذف النسخة الاحتياطية (${fileName}) نهائياً؟\n\nتنبيه: لا يمكن التراجع عن هذا الإجراء.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/settings/backup/records/${backupId}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        App.showToast(json.message || 'تم حذف النسخة بنجاح', 'success');
        await this.loadDisasterRecoveryDashboard();
        await this.loadBackupRecords();
      } else {
        App.showToast(json.message || 'فشل حذف النسخة', 'error');
      }
    } catch (e) {
      App.showToast('خطأ أثناء حذف النسخة: ' + e.message, 'error');
    }
  },

  async downloadBackupRecord(idOrName, fileName) {
    try {
      const token = (window.Auth && window.Auth.token)
        || localStorage.getItem('rawasi_token')
        || sessionStorage.getItem('rawasi_token')
        || '';
      const url = `/api/settings/backup/download-record/${encodeURIComponent(idOrName)}${token ? `?token=${encodeURIComponent(token)}` : ''}`;

      App.showToast(`جاري تنزيل النسخة الاحتياطية (${fileName})...`, 'info');

      const res = await fetch(url, {
        method: 'GET',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });

      if (!res.ok) {
        throw new Error(`تعذر تنزيل الملف (رمز: ${res.status})`);
      }

      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = blobUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        window.URL.revokeObjectURL(blobUrl);
        a.remove();
      }, 2000);

      App.showToast(`تم تنزيل النسخة (${fileName}) بنجاح والاحتفاظ بها بأمان 💾`, 'success');
    } catch (e) {
      console.error('Error downloading backup record:', e);
      const token = (window.Auth && window.Auth.token)
        || localStorage.getItem('rawasi_token')
        || sessionStorage.getItem('rawasi_token')
        || '';
      if (token) {
        window.location.href = `/api/settings/backup/download-record/${encodeURIComponent(idOrName)}?token=${encodeURIComponent(token)}`;
      } else {
        App.showToast('تعذر تنزيل النسخة المحددة', 'error');
      }
    }
  },

  // ================== إدارة الربط السحابي وقاعدة البيانات ==================
  async loadDbConfig() {
    try {
      const res = await fetch('/api/settings/db-status');
      const json = await res.json();
      if (json && json.success) {
        const d = json.data;
        const modeEl = document.getElementById('cfgDbMode');
        const urlEl = document.getElementById('cfgOnlineUrl');
        const statusBox = document.getElementById('dbConfigStatusBox');

        if (modeEl && d.mode) modeEl.value = d.mode;
        if (urlEl) urlEl.value = d.rawOnlineUrl || '';

        if (statusBox) {
          const badgeClass = d.isOnline ? 'badge-active' : 'badge-warning';
          const badgeText = d.isOnline ? '🟢 أونلاين (سحابي متصل)' : '🟠 أوفلاين (محلي نشط)';
          statusBox.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; flex-wrap: wrap; gap: 8px;">
              <span>حالة الاتصال الحالية: <strong class="badge ${badgeClass}">${badgeText}</strong></span>
              <span>زمن الاستجابة: <strong>${d.latencyMs || 0} ms</strong></span>
            </div>
            <div style="font-size: 0.8rem; color: var(--text-secondary); line-height: 1.4;">${d.statusMessage}</div>
          `;
        }
      }
    } catch (e) {
      console.error('Error loading db config:', e);
    }
  },

  async testOnlineDb() {
    const urlInput = document.getElementById('cfgOnlineUrl');
    const resultBox = document.getElementById('onlineDbTestResult');
    const btn = document.getElementById('btnTestOnlineDb');
    const testUrl = urlInput ? urlInput.value.trim() : '';

    if (!testUrl) {
      App.showToast('يرجى إدخال رابط السيرفر/قاعدة البيانات السحابية للاختبار أولاً', 'warning');
      if (urlInput) urlInput.focus();
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = 'جاري الفحص والتحقق... ⏳';
    }
    if (resultBox) {
      resultBox.style.display = 'block';
      resultBox.innerHTML = '<span style="color: var(--text-secondary);">جاري إرسال إشارة الفحص والتحقق من الاستجابة...</span>';
    }

    try {
      const res = await fetch('/api/settings/test-online-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: testUrl })
      });
      const json = await res.json();
      const d = json.data || {};

      if (json.success && d.isOnline) {
        App.showToast('تم التحقق بنجاح! السيرفر السحابي متصل ومستجيب 🟢', 'success');
        if (resultBox) {
          resultBox.innerHTML = `
            <div style="color: var(--accent-green); font-weight: 700; margin-bottom: 4px;">✅ تم الاتصال بنجاح (${d.latencyMs} ms)</div>
            <div style="font-size: 0.82rem; color: var(--text-secondary);">${d.message}</div>
          `;
        }
      } else {
        App.showToast('تعذر الاتصال بالسيرفر السحابي، التحويل التلقائي للقاعدة المحلية نشط 🟠', 'warning');
        if (resultBox) {
          resultBox.innerHTML = `
            <div style="color: var(--accent-red); font-weight: 700; margin-bottom: 4px;">⚠️ تعذر الاتصال بالسيرفر السحابي</div>
            <div style="font-size: 0.82rem; color: var(--text-secondary);">${d.message || json.message}</div>
          `;
        }
      }
    } catch (e) {
      if (resultBox) {
        resultBox.innerHTML = `<div style="color: var(--accent-red);">خطأ أثناء محاولة الفحص: ${e.message}</div>`;
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = 'فحص الاتصال والتحقق الآن 🔍';
      }
    }
  },

  async saveDbConfig(e) {
    if (e) e.preventDefault();
    const mode = document.getElementById('cfgDbMode')?.value || 'auto';
    const onlineUrl = document.getElementById('cfgOnlineUrl')?.value || '';

    try {
      const res = await fetch('/api/settings/update-db-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, onlineUrl })
      });
      const json = await res.json();
      if (json.success) {
        App.showToast('تم حفظ إعدادات الاتصال وتحديث وضع العمل بنجاح ✅', 'success');
        await this.loadDbConfig();
        if (typeof App !== 'undefined' && App.checkDatabaseStatus) {
          await App.checkDatabaseStatus();
        }
      } else {
        App.showToast('تعذر حفظ إعدادات الاتصال: ' + json.message, 'error');
      }
    } catch (err) {
      App.showToast('خطأ أثناء حفظ الإعدادات: ' + err.message, 'error');
    }
  },

  // ================== نسخ الخروج الاحتياطية التلقائية ==================
  async loadLogoutBackups() {
    try {
      const res = await fetch('/api/settings/logout-backups');
      const json = await res.json();
      const tbody = document.getElementById('logoutBackupsTableBody');
      if (!tbody) return;

      if (json.success && json.data && json.data.length > 0) {
        tbody.innerHTML = json.data.map(b => {
          const sizeKB = (b.size / 1024).toFixed(1);
          const modeBadge = b.mode === 'online' 
            ? '<span class="badge badge-active" style="font-size: 0.72rem;">أونلاين سحابي</span>'
            : '<span class="badge badge-warning" style="font-size: 0.72rem;">أوفلاين محلي</span>';

          return `
            <tr>
              <td>
                <div style="font-weight: 700; color: var(--gold-light); font-size: 0.85rem;">${b.fileName}</div>
                <small style="color: var(--text-secondary);">${b.notes || '-'}</small>
              </td>
              <td><span class="badge badge-secondary">${b.username || 'مستخدم'}</span></td>
              <td>${b.displayTime || b.timestamp}</td>
              <td>${sizeKB} KB</td>
              <td>${modeBadge}</td>
              <td style="text-align: center;">
                <button type="button" class="btn btn-secondary btn-sm" onclick="Settings.confirmRestoreLogoutBackup('${b.fileName}')" title="استعادة هذه النقطة الزمنية">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="vertical-align: middle;"><path d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/></svg>
                  <span>استعادة</span>
                </button>
              </td>
            </tr>
          `;
        }).join('');
      } else {
        tbody.innerHTML = `
          <tr>
            <td colspan="6" style="text-align: center; padding: 25px; color: var(--text-secondary);">
              لم يتم تسجيل أي نسخ خروج تلقائية بعد. سيقوم النظام بإنشاء نسخة فورية عند كل تسجيل خروج للمستخدم لحفظ آخر التعديلات.
            </td>
          </tr>
        `;
      }
    } catch (e) {
      console.error('Error loading logout backups:', e);
    }
  },

  confirmRestoreLogoutBackup(fileName) {
    if (!confirm(`هل ترغب في استعادة النسخة الاحتياطية (${fileName})؟\n\nستتم إعادة المشروع تماماً إلى اللحظة التي تم فيها تسجيل الخروج وحفظ تلك النسخة.`)) {
      return;
    }
    this.selectServerBackup(fileName);
    this.executeRestore();
  },

  // ================== الجدولة التلقائية للنسخ الاحتياطي ومسار التخزين ==================
  async loadAutoBackupSchedule() {
    try {
      const res = await fetch('/api/settings/auto-backup/status');
      const json = await res.json();
      if (!json.success || !json.data) return;
      const d = json.data;

      // ملء حقول النموذج
      const enabledSel = document.getElementById('cfgAutoBackupEnabled');
      const intervalSel = document.getElementById('cfgAutoBackupInterval');
      const daySel = document.getElementById('cfgAutoBackupDayOfWeek');
      const timeInp = document.getElementById('cfgAutoBackupTime');
      const maxFilesSel = document.getElementById('cfgAutoBackupMaxFiles');
      const pathInp = document.getElementById('cfgAutoBackupPath');

      if (enabledSel) enabledSel.value = d.enabled ? 'true' : 'false';
      if (intervalSel) intervalSel.value = d.interval || 'daily';
      if (daySel) daySel.value = String(d.dayOfWeek !== undefined ? d.dayOfWeek : 5);
      if (timeInp) timeInp.value = d.time || '02:00';
      if (maxFilesSel) maxFilesSel.value = String(d.maxFiles || 14);
      if (pathInp) {
        pathInp.value = d.storagePath || d.defaultStoragePath || '';
        pathInp.dataset.defaultPath = d.defaultStoragePath || '';
      }

      this.toggleAutoBackupFields();

      // تحديث بطاقة الحالة الحية
      const statusBadge = document.getElementById('liveBackupStatusBadge');
      const intervalText = document.getElementById('liveBackupIntervalText');
      const lastRunText = document.getElementById('liveBackupLastRunText');
      const nextRunText = document.getElementById('liveBackupNextRunText');
      const pathStatus = document.getElementById('cfgAutoBackupPathStatus');

      if (statusBadge) {
        if (!d.enabled) {
          statusBadge.innerHTML = '🟡 معطل مؤقتاً';
          statusBadge.style.color = '#facc15';
        } else if (d.lastStatus === 'failed') {
          statusBadge.innerHTML = '🔴 فشل آخر نسخ';
          statusBadge.style.color = '#f87171';
        } else {
          statusBadge.innerHTML = '🟢 مفعل ومنتظم';
          statusBadge.style.color = '#4ade80';
        }
      }

      if (intervalText) {
        intervalText.textContent = d.interval === 'weekly'
          ? `أسبوعياً (كل ${d.dayOfWeekName || 'جمعة'} في تمام ${d.time || '02:00'})`
          : `يومياً في تمام ${d.time || '02:00'}`;
      }

      if (lastRunText) {
        if (d.lastRun) {
          const lrDate = new Date(d.lastRun);
          const sizeMb = d.lastSize ? `(${(d.lastSize / (1024 * 1024)).toFixed(2)} MB)` : '';
          lastRunText.innerHTML = `${lrDate.toLocaleDateString('ar-YE')} ${lrDate.toLocaleTimeString('ar-YE', { hour: '2-digit', minute: '2-digit' })} ${sizeMb} ${d.lastStatus === 'success' ? '✅' : '❌'}`;
        } else {
          lastRunText.textContent = 'لا توجد نسخ سابقة';
        }
      }

      if (nextRunText) {
        if (d.nextRun && d.enabled) {
          const nrDate = new Date(d.nextRun);
          const nextTime = `${nrDate.toLocaleDateString('ar-YE')} ${nrDate.toLocaleTimeString('ar-YE', { hour: '2-digit', minute: '2-digit' })}`;
          nextRunText.innerHTML = `${nextTime} <span style="font-size:0.8rem; color:#94a3b8;">(${d.countdownText || ''})</span>`;
        } else {
          nextRunText.textContent = d.enabled ? 'جاري الحساب...' : 'الجدولة متوقفة';
        }
      }

      if (pathStatus) {
        if (d.storagePathExists && d.storagePathWritable) {
          pathStatus.innerHTML = '<span style="color:#4ade80;">(مسار صالح ومؤكد ✅)</span>';
        } else if (d.storagePathExists) {
          pathStatus.innerHTML = '<span style="color:#facc15;">(المسار موجود - يتطلب فحص الصلاحيات)</span>';
        } else {
          pathStatus.innerHTML = '<span style="color:#38bdf8;">(سيتم إنشاء المجلد تلقائياً)</span>';
        }
      }
    } catch (e) {
      console.error('Error loading auto backup schedule:', e);
    }
  },

  toggleAutoBackupFields() {
    const enabled = document.getElementById('cfgAutoBackupEnabled')?.value === 'true';
    const interval = document.getElementById('cfgAutoBackupInterval')?.value;
    const dayGroup = document.getElementById('cfgAutoBackupDayGroup');

    if (dayGroup) {
      dayGroup.style.display = (enabled && interval === 'weekly') ? 'block' : 'none';
    }
  },

  async saveAutoBackupSchedule(event) {
    if (event) event.preventDefault();
    const btn = document.getElementById('btnSaveAutoBackupConfig');
    const origHtml = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span>جاري الحفظ... ⏳</span>';
    }

    const payload = {
      enabled: document.getElementById('cfgAutoBackupEnabled')?.value === 'true',
      interval: document.getElementById('cfgAutoBackupInterval')?.value || 'daily',
      dayOfWeek: Number(document.getElementById('cfgAutoBackupDayOfWeek')?.value || 5),
      time: document.getElementById('cfgAutoBackupTime')?.value || '02:00',
      maxFiles: Number(document.getElementById('cfgAutoBackupMaxFiles')?.value || 14),
      storagePath: document.getElementById('cfgAutoBackupPath')?.value?.trim() || ''
    };

    try {
      const res = await fetch('/api/settings/auto-backup/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (json.success) {
        App.showToast(json.message || 'تم حفظ إعدادات الجدولة التلقائية بنجاح 🛡️', 'success');
        await this.loadAutoBackupSchedule();
        if (typeof App !== 'undefined' && App.fetchAutoBackupStatus) {
          App.fetchAutoBackupStatus();
        }
      } else {
        App.showToast(json.message || 'فشل حفظ الإعدادات', 'error');
      }
    } catch (err) {
      App.showToast('خطأ أثناء حفظ إعدادات الجدولة', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origHtml;
      }
    }
  },

  async runAutoBackupNow() {
    const btn = document.getElementById('btnSettingsRunBackupNow');
    const origHtml = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span>جاري التنفيذ... ⏳</span>';
    }

    try {
      const res = await fetch('/api/settings/auto-backup/run-now', { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        App.showToast(json.message || 'تم إنشاء النسخة التلقائية المجدولة بنجاح وحفظها 🛡️', 'success');
        await this.loadAutoBackupSchedule();
        if (typeof App !== 'undefined' && App.fetchAutoBackupStatus) {
          App.fetchAutoBackupStatus();
        }
      } else {
        App.showToast(json.message || 'فشل تنفيذ النسخ التلقائي', 'error');
      }
    } catch (err) {
      App.showToast('خطأ أثناء تشغيل النسخ التلقائي', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origHtml;
      }
    }
  },

  async testStoragePath() {
    const pathInp = document.getElementById('cfgAutoBackupPath');
    const resultBox = document.getElementById('autoBackupTestResultBox');
    const pathStatus = document.getElementById('cfgAutoBackupPathStatus');
    const pathVal = pathInp?.value?.trim();

    if (!pathVal) {
      App.showToast('يرجى إدخال مسار التخزين أولاً', 'warning');
      return;
    }

    if (resultBox) {
      resultBox.style.display = 'block';
      resultBox.style.background = 'rgba(255,255,255,0.05)';
      resultBox.style.color = '#94a3b8';
      resultBox.innerHTML = 'جاري اختبار المسار وصلاحيات الكتابة... ⏳';
    }

    try {
      const res = await fetch('/api/settings/auto-backup/test-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: pathVal })
      });
      const json = await res.json();
      if (resultBox) {
        if (json.success) {
          resultBox.style.background = 'rgba(34, 197, 94, 0.15)';
          resultBox.style.color = '#4ade80';
          resultBox.style.border = '1px solid rgba(34, 197, 94, 0.3)';
          resultBox.innerHTML = `<strong>${json.message}</strong><br><small style="direction:ltr; display:block; color:#f8fafc; font-family:monospace;">${json.resolvedPath}</small>`;
          if (pathStatus) pathStatus.innerHTML = '<span style="color:#4ade80;">(مسار صالح ومؤكد ✅)</span>';
        } else {
          resultBox.style.background = 'rgba(239, 68, 68, 0.15)';
          resultBox.style.color = '#f87171';
          resultBox.style.border = '1px solid rgba(239, 68, 68, 0.3)';
          resultBox.innerHTML = `<strong>⚠️ ${json.message}</strong>`;
          if (pathStatus) pathStatus.innerHTML = '<span style="color:#f87171;">(تعذر استخدام المسار ❌)</span>';
        }
      }
    } catch (err) {
      if (resultBox) {
        resultBox.style.background = 'rgba(239, 68, 68, 0.15)';
        resultBox.style.color = '#f87171';
        resultBox.innerHTML = 'خطأ أثناء الاتصال بالخادم لاختبار المسار';
      }
    }
  },

  resetDefaultStoragePath() {
    const pathInp = document.getElementById('cfgAutoBackupPath');
    if (pathInp) {
      pathInp.value = pathInp.dataset.defaultPath || 'server/database/backups';
      App.showToast('تم استعادة المسار الافتراضي للنسخ الاحتياطية', 'info');
      this.testStoragePath();
    }
  },

  // ================== إدارة ومزامنة خادم MySQL ==================
  async loadMysqlStatus() {
    try {
      const res = await fetch('/api/settings/mysql-status');
      const json = await res.json();
      if (json && json.success) {
        const d = json.data;
        const statusBox = document.getElementById('mysqlStatusBox');
        const hostInput = document.getElementById('mysqlHost');
        const portInput = document.getElementById('mysqlPort');
        const userInput = document.getElementById('mysqlUser');
        const dbInput = document.getElementById('mysqlDatabase');

        if (d.mysqlConfig) {
          if (hostInput && !hostInput.value) hostInput.value = d.mysqlConfig.host || 'localhost';
          if (portInput && !portInput.value) portInput.value = d.mysqlConfig.port || 3306;
          if (userInput && !userInput.value) userInput.value = d.mysqlConfig.user || 'root';
          if (dbInput && !dbInput.value) dbInput.value = d.mysqlConfig.database || 'rawasi_aden';
        }

        if (statusBox) {
          const isMySqlActive = d.activeEngine === 'mysql';
          const isConnected = d.isConnected;
          let badgeClass = 'badge-warning';
          let badgeText = 'محرك SQLite المحلي نشط (نمط الطوارئ / أوفلاين)';

          if (isMySqlActive && isConnected) {
            badgeClass = 'badge-active';
            badgeText = `خادم MySQL نشط ومتصل بنجاح (${d.serverVersion || 'v8.x'}) 🟢`;
          } else if (isConnected) {
            badgeClass = 'badge-info';
            badgeText = 'خادم MySQL متصل وجاهز للتبديل ✅';
          }

          statusBox.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; flex-wrap: wrap; gap: 8px;">
              <span>المحرك النشط حالياً: <strong class="badge ${badgeClass}">${badgeText}</strong></span>
              <span>الإصدار: <strong>${d.serverVersion || 'SQLite 3.x'}</strong></span>
            </div>
            <div style="font-size: 0.82rem; color: var(--text-secondary); line-height: 1.5;">${d.message}</div>
          `;
        }
      }
    } catch (e) {
      console.error('Error loading MySQL status:', e);
    }
  },

  async testMysqlConnection() {
    const host = document.getElementById('mysqlHost')?.value.trim() || 'localhost';
    const port = document.getElementById('mysqlPort')?.value.trim() || 3306;
    const user = document.getElementById('mysqlUser')?.value.trim() || 'root';
    const password = document.getElementById('mysqlPassword')?.value || '';
    const database = document.getElementById('mysqlDatabase')?.value.trim() || 'rawasi_aden';
    const resultBox = document.getElementById('mysqlTestResult');
    const btn = document.getElementById('btnTestMysql');

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = 'جاري اختبار الاتصال بقاعدة MySQL... ⏳';
    }
    if (resultBox) {
      resultBox.style.display = 'block';
      resultBox.innerHTML = '<span style="color: var(--text-secondary);">جاري محاولة الاتصال بـ MySQL عبر المنفذ ' + port + '...</span>';
    }

    try {
      const res = await fetch('/api/settings/test-mysql-conn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port, user, password, database })
      });
      const json = await res.json();

      if (json.success) {
        App.showToast('تم الاتصال بنجاح بخادم MySQL 🚀', 'success');
        if (resultBox) {
          resultBox.innerHTML = `
            <div style="color: var(--accent-green); font-weight: 700; margin-bottom: 4px;">✅ تم الاتصال بنجاح بخادم MySQL (${json.latencyMs} ms)</div>
            <div style="font-size: 0.82rem; color: var(--text-secondary);">${json.message} | إصدار الخادم: ${json.version || 'غير محدد'} | المستخدم: ${json.user || user}</div>
          `;
        }
      } else {
        App.showToast('تعذر الاتصال بـ MySQL: ' + json.message, 'error');
        if (resultBox) {
          resultBox.innerHTML = `
            <div style="color: var(--accent-red); font-weight: 700; margin-bottom: 4px;">⚠️ فشل الاتصال بخادم MySQL</div>
            <div style="font-size: 0.82rem; color: var(--text-secondary);">${json.message}</div>
            <div style="font-size: 0.78rem; color: var(--gold-light); margin-top: 6px;">💡 تلميح: تأكد من تشغيل خادم MySQL (مثل XAMPP أو WampServer أو خدمة MySQL)، أو فحص كلمة المرور واسم المستخدم.</div>
          `;
        }
      }
    } catch (e) {
      if (resultBox) {
        resultBox.innerHTML = `<div style="color: var(--accent-red);">خطأ أثناء محاولة الفحص: ${e.message}</div>`;
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = 'اختبار الاتصال بـ MySQL 🔍';
      }
    }
  },

  async saveMysqlSettings(e) {
    if (e) e.preventDefault();
    const host = document.getElementById('mysqlHost')?.value.trim() || 'localhost';
    const port = document.getElementById('mysqlPort')?.value.trim() || 3306;
    const user = document.getElementById('mysqlUser')?.value.trim() || 'root';
    const password = document.getElementById('mysqlPassword')?.value || '';
    const database = document.getElementById('mysqlDatabase')?.value.trim() || 'rawasi_aden';
    const btn = document.getElementById('btnSaveMysql');

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = 'جاري الحفظ والتطبيق... ⏳';
    }

    try {
      const res = await fetch('/api/settings/save-mysql-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port, user, password, database })
      });
      const json = await res.json();
      if (json.success) {
        App.showToast(json.message || 'تم حفظ إعدادات MySQL بنجاح ✅', 'success');
        await this.loadMysqlStatus();
      } else {
        App.showToast(json.message || 'حدث خطأ أثناء حفظ الإعدادات', 'error');
      }
    } catch (err) {
      App.showToast('خطأ في حفظ الإعدادات: ' + err.message, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = 'حفظ الإعدادات وتفعيل المحرك 💾';
      }
    }
  },

  async runMysqlMigration() {
    const isConfirmed = confirm(
      "هل أنت متأكد من رغبتك في بدء ترحيل كافة الجداول والبيانات من SQLite إلى MySQL الآن؟\n\n" +
      "• سيتم نسخ كافة المشاريع، الفواتير، السندات، الحسابات، والعملاء.\n" +
      "• لن يتم حذف بياناتك القديمة من SQLite بل ستبقى محفوظة بأمان كنسخة احتياطية."
    );
    if (!isConfirmed) return;

    const resultBox = document.getElementById('mysqlMigrationResult');
    const btn = document.getElementById('btnRunMigration');

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = 'جاري الترحيل الشامل للجداول والبيانات... ⏳';
    }
    if (resultBox) {
      resultBox.style.display = 'block';
      resultBox.innerHTML = '<div style="color: var(--gold-light);">جاري قراءة الجداول من SQLite وتحويلها إلى MySQL، يرجى الانتظار بضع ثوانٍ... ⏳</div>';
    }

    try {
      const res = await fetch('/api/settings/run-migration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const json = await res.json();
      if (json.success) {
        App.showToast('تم ترحيل كافة البيانات إلى MySQL بنجاح باهر! 🎉', 'success');
        if (resultBox) {
          resultBox.innerHTML = `
            <div style="color: var(--accent-green); font-weight: 700; margin-bottom: 4px;">🎉 اكتملت عملية الترحيل بنجاح تام!</div>
            <div style="font-size: 0.85rem; color: var(--text-secondary);">${json.message}</div>
          `;
        }
        await this.loadMysqlStatus();
      } else {
        App.showToast('فشل الترحيل: ' + json.message, 'error');
        if (resultBox) {
          resultBox.innerHTML = `
            <div style="color: var(--accent-red); font-weight: 700; margin-bottom: 4px;">⚠️ تعذر إتمام الترحيل</div>
            <div style="font-size: 0.85rem; color: var(--text-secondary);">${json.message}</div>
          `;
        }
      }
    } catch (err) {
      App.showToast('خطأ أثناء عملية الترحيل: ' + err.message, 'error');
      if (resultBox) {
        resultBox.innerHTML = `<div style="color: var(--accent-red);">خطأ غير متوقع: ${err.message}</div>`;
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = 'بدء ترحيل البيانات الآن (Migrate SQLite to MySQL) 🚀';
      }
    }
  },

  // ================== محرك الأرشفة الشاملة والمزامنة السحابية المشفرة ==================
  _cloudVaultItems: [],
  _selectedVaultRestoreFile: null,
  _selectedVaultArchiveName: null,

  async loadCloudBackupStatus() {
    try {
      const res = await fetch('/api/settings/cloud-backup/status');
      const json = await res.json();
      if (!json.success) return;

      const { config, vaultItems, systemStats } = json;
      this._cloudVaultItems = vaultItems || [];

      // تحديث شارات وبطاقات الحالة
      const badge = document.getElementById('cloudStatusBadge');
      if (badge) {
        if (config.lastSyncStatus === 'success') {
          badge.innerHTML = '<span style="color: #34d399;">🟢 متزامن ومحمي سحابياً</span>';
        } else if (config.lastSyncStatus === 'failed') {
          badge.innerHTML = '<span style="color: #f87171;">⚠️ تعثرت آخر مزامنة</span>';
        } else {
          badge.innerHTML = '<span style="color: #38bdf8;">☁️ جاهز للمزامنة</span>';
        }
      }

      const lastSyncEl = document.getElementById('cloudLastSyncTimeText');
      if (lastSyncEl) {
        lastSyncEl.textContent = config.lastSyncTime 
          ? new Date(config.lastSyncTime).toLocaleString('ar-YE')
          : 'لا توجد مزامنة سابقة';
      }

      const countEl = document.getElementById('cloudVaultFilesCountText');
      if (countEl) {
        countEl.textContent = `${this._cloudVaultItems.length} أرشيف محفوظ`;
      }

      // تعبئة نموذج إعدادات السحابة
      const pSelect = document.getElementById('cfgCloudProvider');
      if (pSelect && config.provider) pSelect.value = config.provider;

      const endInp = document.getElementById('cfgCloudEndpoint');
      if (endInp) endInp.value = config.endpointUrl || '';

      const tokInp = document.getElementById('cfgCloudToken');
      if (tokInp) tokInp.value = config.authToken || '';

      const fldInp = document.getElementById('cfgCloudFolder');
      if (fldInp) fldInp.value = config.syncedFolder || '';

      const autoSyncCheck = document.getElementById('cfgCloudAutoSync');
      if (autoSyncCheck) autoSyncCheck.checked = Boolean(config.autoSyncAfterBackup);

      this.toggleCloudProviderFields();
      this.renderCloudVaultTable();
    } catch (err) {
      console.warn('⚠️ [Settings] خطأ أثناء جلب حالة الخزنة السحابية:', err.message);
    }
  },

  toggleArchiveCryptoFields() {
    const chk = document.getElementById('cfgArchiveEncrypt');
    const grp = document.getElementById('archivePassphraseGroup');
    if (grp) {
      grp.style.display = (chk && chk.checked) ? 'block' : 'none';
    }
  },

  async generatePassphraseForArchive() {
    try {
      const res = await fetch('/api/settings/cloud-backup/generate-key');
      const json = await res.json();
      if (json.success && json.key) {
        const inp = document.getElementById('cfgArchivePassphrase');
        if (inp) {
          inp.value = json.key;
          inp.type = 'text';
          App.showToast('تم توليد مفتاح أمان تشفير فائق القوة 🔑', 'success');
        }
      }
    } catch (e) {
      // توليد محلي في حال الانقطاع
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*';
      let k = '';
      for (let i = 0; i < 24; i++) k += chars[Math.floor(Math.random() * chars.length)];
      const inp = document.getElementById('cfgArchivePassphrase');
      if (inp) inp.value = k;
      App.showToast('تم توليد مفتاح أمان عشوائي محلي 🔑', 'info');
    }
  },

  toggleCloudProviderFields() {
    const pVal = document.getElementById('cfgCloudProvider')?.value || 'not_configured';
    const endGrp = document.getElementById('grpCloudEndpoint');
    const tokGrp = document.getElementById('grpCloudToken');
    const fldGrp = document.getElementById('grpCloudFolder');

    if (endGrp) endGrp.style.display = (pVal === 'offsite_webhook' || pVal === 's3_webhook') ? 'block' : 'none';
    if (tokGrp) tokGrp.style.display = (pVal === 'offsite_webhook' || pVal === 's3_webhook') ? 'block' : 'none';
    if (fldGrp) fldGrp.style.display = (pVal === 'local_cloud_folder') ? 'block' : 'none';
  },

  async saveCloudSyncConfig(e) {
    if (e && e.preventDefault) e.preventDefault();
    const provider = document.getElementById('cfgCloudProvider')?.value || 'not_configured';
    const endpointUrl = document.getElementById('cfgCloudEndpoint')?.value?.trim() || '';
    const authToken = document.getElementById('cfgCloudToken')?.value?.trim() || '';
    const syncedFolder = document.getElementById('cfgCloudFolder')?.value?.trim() || '';
    const autoSyncAfterBackup = Boolean(document.getElementById('cfgCloudAutoSync')?.checked);

    try {
      App.showToast('جاري حفظ وتطبيق إعدادات السحابة...', 'info');
      const res = await fetch('/api/settings/cloud-backup/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: true,
          provider,
          endpointUrl,
          authToken,
          syncedFolder,
          autoSyncAfterBackup
        })
      });
      const json = await res.json();
      if (json.success) {
        App.showToast(json.message, 'success');
        this.loadCloudBackupStatus();
      } else {
        App.showToast('فشل الحفظ: ' + json.message, 'error');
      }
    } catch (err) {
      App.showToast('خطأ أثناء حفظ إعدادات السحابة', 'error');
    }
  },

  async testCloudConnection() {
    const btn = document.getElementById('btnTestCloudConn');
    const resBox = document.getElementById('cloudConnectionTestResult');
    const provider = document.getElementById('cfgCloudProvider')?.value || 'not_configured';
    const endpointUrl = document.getElementById('cfgCloudEndpoint')?.value?.trim() || '';
    const authToken = document.getElementById('cfgCloudToken')?.value?.trim() || '';
    const syncedFolder = document.getElementById('cfgCloudFolder')?.value?.trim() || '';

    if (btn) btn.disabled = true;
    if (resBox) {
      resBox.style.display = 'block';
      resBox.style.background = 'rgba(255,255,255,0.05)';
      resBox.style.color = '#94a3b8';
      resBox.textContent = 'جاري اختبار الاتصال واستجابة السحابة... ⏳';
    }

    try {
      const res = await fetch('/api/settings/cloud-backup/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, endpointUrl, authToken, syncedFolder })
      });
      const json = await res.json();
      if (resBox) {
        if (json.success) {
          resBox.style.background = 'rgba(16, 185, 129, 0.15)';
          resBox.style.color = '#34d399';
          resBox.style.border = '1px solid rgba(16, 185, 129, 0.3)';
          resBox.innerHTML = `<strong>✅ ${json.message}</strong>${json.latencyMs ? ` <span style="font-size:0.75rem;">(${json.latencyMs} ms)</span>` : ''}`;
        } else {
          resBox.style.background = 'rgba(239, 68, 68, 0.15)';
          resBox.style.color = '#f87171';
          resBox.style.border = '1px solid rgba(239, 68, 68, 0.3)';
          resBox.innerHTML = `<strong>❌ ${json.message}</strong>`;
        }
      }
    } catch (e) {
      if (resBox) {
        resBox.style.background = 'rgba(239, 68, 68, 0.15)';
        resBox.style.color = '#f87171';
        resBox.textContent = 'تعذر الاتصال بالخادم لاختبار السحابة: ' + e.message;
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  async createFullSystemArchive() {
    const btn = document.getElementById('btnCreateArchiveNow');
    const encrypt = Boolean(document.getElementById('cfgArchiveEncrypt')?.checked);
    const passphrase = document.getElementById('cfgArchivePassphrase')?.value?.trim() || '';
    const includeProjectsFiles = Boolean(document.getElementById('cfgArchiveIncludeFiles')?.checked);

    if (encrypt && (!passphrase || passphrase.length < 4)) {
      App.showToast('يرجى إدخال كلمة مرور أو مفتاح أمان لا يقل عن 4 خانات لتشفير الأرشيف', 'warning');
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '⏳ جاري حزم وتشفير النظام بالكامل...';
    }

    App.showToast('جاري إنشاء الأرشيف الشامل وحزم قاعدة البيانات والمشاريع...', 'info');

    try {
      const res = await fetch('/api/settings/cloud-backup/create-archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ encrypt, passphrase, includeProjectsFiles })
      });
      const json = await res.json();

      if (json.success && json.data) {
        App.showToast(json.message, 'success');
        // بدء التنزيل المباشر للأرشيف إلى جهاز المستخدم
        const downloadUrl = `/api/settings/cloud-backup/download/${encodeURIComponent(json.data.fileName)}`;
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = json.data.fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        await this.loadCloudBackupStatus();
      } else {
        App.showToast('فشل إنشاء الأرشيف: ' + json.message, 'error');
      }
    } catch (err) {
      App.showToast('خطأ أثناء إنشاء الأرشيف: ' + err.message, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<span>📦🔒 إنشاء وتنزيل الأرشيف الشامل فوراً</span>';
      }
    }
  },

  async syncToCloudNow(fileName = null) {
    const btn = document.getElementById('btnQuickCloudSync');
    if (btn) btn.disabled = true;
    App.showToast('جاري رفع ومزامنة الأرشيف إلى السحابة... ☁️', 'info');

    try {
      const res = await fetch('/api/settings/cloud-backup/sync-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName })
      });
      const json = await res.json();
      if (json.success) {
        App.showToast(json.message, 'success');
        await this.loadCloudBackupStatus();
      } else {
        App.showToast('تعذر إتمام المزامنة السحابية: ' + json.message, 'error');
      }
    } catch (err) {
      App.showToast('خطأ أثناء المزامنة السحابية: ' + err.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  renderCloudVaultTable() {
    const tbody = document.getElementById('cloudVaultTableBody');
    if (!tbody) return;

    if (!this._cloudVaultItems || this._cloudVaultItems.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 24px; color: var(--text-secondary);">
            خزنة الأرشيفات السحابية فارغة حالياً. يمكنك إنشاء أول أرشيف شامل ومشفر عبر الزر أعلاه 📦
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = this._cloudVaultItems.map(item => {
      const isEnc = item.encrypted;
      const sizeMB = (item.size / (1024 * 1024)).toFixed(2);
      const dateStr = new Date(item.createdAt).toLocaleString('ar-YE');
      const isBundle = item.includeProjectsFiles || item.fileName.includes('bundle');

      const encBadge = isEnc
        ? '<span style="background: rgba(16, 185, 129, 0.15); color: #34d399; padding: 2px 8px; border-radius: 4px; border: 1px solid rgba(16, 185, 129, 0.3); font-size: 0.75rem;">🔒 مشفر AES-256</span>'
        : '<span style="background: rgba(255, 255, 255, 0.05); color: var(--text-secondary); padding: 2px 8px; border-radius: 4px; font-size: 0.75rem;">🔓 قياسي (غير مشفر)</span>';

      const typeBadge = isBundle
        ? '<span style="color: var(--gold-light); font-weight: 600;">📦 أرشيف نظام شامل</span>'
        : '<span style="color: var(--accent-blue);">🗄️ قاعدة بيانات فقط</span>';

      const cloudBadge = item.cloudSynced
        ? '<span style="color: #38bdf8; display: inline-flex; align-items: center; gap: 4px;">☁️ مرفوع سحابياً</span>'
        : '<span style="color: var(--text-secondary); display: inline-flex; align-items: center; gap: 4px;">💻 محلي بالخزنة</span>';

      return `
        <tr>
          <td>
            <div style="font-weight: 600; color: #f8fafc; font-family: monospace; font-size: 0.85rem;">${item.fileName}</div>
            ${item.sha256 ? `<small style="color: var(--text-secondary); font-size: 0.68rem; font-family: monospace;">SHA: ${item.sha256.substring(0, 16)}...</small>` : ''}
          </td>
          <td>${typeBadge}</td>
          <td>${encBadge}</td>
          <td style="font-weight: 600; font-family: monospace;">${sizeMB} MB</td>
          <td>${cloudBadge}</td>
          <td style="font-size: 0.8rem; color: var(--text-secondary);">${dateStr}</td>
          <td style="text-align: center;">
            <div style="display: inline-flex; gap: 6px;">
              <a href="javascript:void(0)" onclick="Settings.downloadCloudArchive('${item.fileName}')" class="btn btn-secondary btn-sm" title="تنزيل الأرشيف إلى جهازك" style="padding: 4px 8px;">
                📥 تنزيل
              </a>
              ${!item.cloudSynced ? `
                <button type="button" class="btn btn-secondary btn-sm" onclick="Settings.syncToCloudNow('${item.fileName}')" title="رفع إلى السحابة" style="padding: 4px 8px; color: #38bdf8;">
                  ☁️ رفع
                </button>
              ` : ''}
              <button type="button" class="btn btn-primary btn-sm" onclick="Settings.openEncryptedRestoreModal('${item.fileName}')" title="فحص واستعادة هذه النسخة" style="padding: 4px 8px; background: #059669; border-color: #059669;">
                ↩️ استعادة
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  },

  // ================== نافذة استعادة الأرشيف المشفر ==================
  openEncryptedRestoreModal(preselectedFileName = null) {
    this._selectedVaultRestoreFile = null;
    this._selectedVaultArchiveName = preselectedFileName || null;

    const fileInp = document.getElementById('vaultRestoreFileInput');
    if (fileInp) fileInp.value = '';

    const passInp = document.getElementById('vaultRestorePassphrase');
    if (passInp) passInp.value = '';

    const inspectBox = document.getElementById('vaultRestoreInspectionBox');
    if (inspectBox) {
      inspectBox.style.display = 'none';
      inspectBox.innerHTML = '';
    }

    const confirmBtn = document.getElementById('btnConfirmEncryptedRestore');
    if (confirmBtn) confirmBtn.disabled = true;

    const dropHeader = document.getElementById('vaultRestoreFileHeader');
    const dropName = document.getElementById('vaultRestoreFileName');

    if (preselectedFileName) {
      if (dropHeader) dropHeader.textContent = 'تم اختيار نسخة من الخزنة السحابية:';
      if (dropName) dropName.innerHTML = `<strong style="color: #38bdf8;">${preselectedFileName}</strong>`;
    } else {
      if (dropHeader) dropHeader.textContent = 'اضغط هنا لاختيار ملف الأرشيف (.rawasi.enc / .zip / .db)';
      if (dropName) dropName.textContent = 'أو اسحب وأفلت الملف هنا مباشرة';
    }

    App.openModal('encryptedRestoreModal');
  },

  handleVaultRestoreFileSelected(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    this._selectedVaultRestoreFile = file;
    this._selectedVaultArchiveName = null;

    const dropHeader = document.getElementById('vaultRestoreFileHeader');
    const dropName = document.getElementById('vaultRestoreFileName');
    const sizeKB = (file.size / 1024).toFixed(1);

    if (dropHeader) dropHeader.textContent = 'الملف المحدد للاستعادة:';
    if (dropName) dropName.innerHTML = `<strong style="color: var(--gold-light);">${file.name}</strong> (${sizeKB} KB)`;

    const confirmBtn = document.getElementById('btnConfirmEncryptedRestore');
    if (confirmBtn) confirmBtn.disabled = true; // يتطلب فحص أولاً

    const inspectBox = document.getElementById('vaultRestoreInspectionBox');
    if (inspectBox) inspectBox.style.display = 'none';

    App.showToast('تم تحديد الملف، يرجى الضغط على "فحص سلامة الأرشيف ومعاينته"', 'info');
  },

  async inspectSelectedArchive() {
    const btn = document.getElementById('btnInspectArchive');
    const inspectBox = document.getElementById('vaultRestoreInspectionBox');
    const passphrase = document.getElementById('vaultRestorePassphrase')?.value?.trim() || '';

    if (!this._selectedVaultRestoreFile && !this._selectedVaultArchiveName) {
      App.showToast('يرجى اختيار ملف أرشيف خارجي أو تحديد نسخة من الخزنة أولاً', 'warning');
      return;
    }

    if (btn) btn.disabled = true;
    if (inspectBox) {
      inspectBox.style.display = 'block';
      inspectBox.style.background = 'rgba(255,255,255,0.05)';
      inspectBox.style.color = '#94a3b8';
      inspectBox.textContent = 'جاري فحص التشفير والنزاهة وقراءة بيان الأرشيف... ⏳';
    }

    try {
      let bodyData = null;
      const headers = {};
      if (passphrase) {
        headers['x-passphrase'] = encodeURIComponent(passphrase);
      }

      if (this._selectedVaultRestoreFile) {
        bodyData = this._selectedVaultRestoreFile;
        headers['Content-Type'] = 'application/octet-stream';
      } else if (this._selectedVaultArchiveName) {
        headers['x-vault-filename'] = this._selectedVaultArchiveName;
      }

      const res = await fetch('/api/settings/cloud-backup/inspect', {
        method: 'POST',
        headers,
        body: bodyData
      });
      const json = await res.json();

      if (json.success && json.data) {
        const d = json.data;
        if (d.requiresPassphrase) {
          inspectBox.style.background = 'rgba(245, 158, 11, 0.15)';
          inspectBox.style.color = '#fbbf24';
          inspectBox.style.border = '1px solid rgba(245, 158, 11, 0.3)';
          inspectBox.innerHTML = `
            <strong>🔒 هذا الأرشيف مشفر بنظام AES-256-GCM</strong>
            <p style="margin: 4px 0 0 0; font-size: 0.8rem;">يرجى كتابة كلمة مرور فك التشفير في الحقل أعلاه ثم إعادة الضغط على زر الفحص.</p>
          `;
          document.getElementById('vaultRestorePassphrase')?.focus();
          return;
        }

        inspectBox.style.background = 'rgba(16, 185, 129, 0.15)';
        inspectBox.style.color = '#34d399';
        inspectBox.style.border = '1px solid rgba(16, 185, 129, 0.3)';

        const m = d.manifest;
        let detailsHtml = '';
        if (m) {
          detailsHtml = `
            <div style="margin-top: 6px; font-size: 0.8rem; color: #f8fafc; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 6px;">
              <div><strong>تاريخ إنشاء الأرشيف:</strong> ${new Date(m.timestamp).toLocaleString('ar-YE')}</div>
              <div><strong>نوع الحزمة:</strong> ${m.archive_type} | <strong>المشاريع المرفقة:</strong> ${d.projectFilesCount} ملف</div>
              ${m.stats ? `<div><strong>الإحصائيات:</strong> ${m.stats.projectsCount || 0} مشروع | ${m.stats.contractsCount || 0} عقد | ${m.stats.vouchersCount || 0} سند مالي</div>` : ''}
            </div>
          `;
        }

        inspectBox.innerHTML = `
          <div style="font-weight: 700;">✅ الأرشيف سليم وصالح للاستعادة بنجاح!</div>
          <div style="font-size: 0.8rem;">التشفير: ${d.encrypted ? '🔒 مفكوك ومؤكد' : '🔓 غير مشفر'} | قاعدة البيانات متطابقة بنسبة 100%</div>
          ${detailsHtml}
        `;

        const confirmBtn = document.getElementById('btnConfirmEncryptedRestore');
        if (confirmBtn) confirmBtn.disabled = false;
        App.showToast('تم فحص سلامة الأرشيف بنجاح وهو جاهز للاستعادة ✅', 'success');
      } else {
        inspectBox.style.background = 'rgba(239, 68, 68, 0.15)';
        inspectBox.style.color = '#f87171';
        inspectBox.style.border = '1px solid rgba(239, 68, 68, 0.3)';
        inspectBox.innerHTML = `<strong>❌ خطأ أثناء الفحص:</strong> ${json.message}`;
      }
    } catch (err) {
      if (inspectBox) {
        inspectBox.style.background = 'rgba(239, 68, 68, 0.15)';
        inspectBox.style.color = '#f87171';
        inspectBox.innerHTML = `<strong>خطأ في فحص الملف:</strong> ${err.message}`;
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  async executeEncryptedRestore() {
    const confirmBtn = document.getElementById('btnConfirmEncryptedRestore');
    const passphrase = document.getElementById('vaultRestorePassphrase')?.value?.trim() || '';
    const restoreFiles = Boolean(document.getElementById('vaultRestoreFilesCheck')?.checked);

    if (!confirm('تحذير نهائي: هل أنت متأكد من استعادة هذا الأرشيف وتحديث بيانات النظام والمشاريع؟\nسيقوم النظام بحفظ نسخة أمان طارئة تلقائياً.')) {
      return;
    }

    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '⏳ جاري استعادة النظام وقاعدة البيانات...';
    }

    App.showToast('جاري تنفيذ الاستعادة الشاملة...', 'info');

    try {
      let bodyData = null;
      const headers = {
        'x-restore-files': String(restoreFiles)
      };
      if (passphrase) {
        headers['x-passphrase'] = encodeURIComponent(passphrase);
      }

      if (this._selectedVaultRestoreFile) {
        bodyData = this._selectedVaultRestoreFile;
        headers['Content-Type'] = 'application/octet-stream';
      } else if (this._selectedVaultArchiveName) {
        headers['x-vault-filename'] = this._selectedVaultArchiveName;
      }

      const res = await fetch('/api/settings/cloud-backup/restore', {
        method: 'POST',
        headers,
        body: bodyData
      });
      const json = await res.json();

      if (json.success) {
        App.showToast(json.message, 'success');
        App.closeModal('encryptedRestoreModal');
        setTimeout(() => {
          App.showToast('جاري تحديث واجهة النظام وتنشيط الجداول المحدثة...', 'info');
          setTimeout(() => window.location.reload(), 1500);
        }, 1000);
      } else {
        App.showToast('فشلت الاستعادة: ' + json.message, 'error');
        if (confirmBtn) {
          confirmBtn.disabled = false;
          confirmBtn.innerHTML = '<span>🛡️ تأكيد وتنفيذ الاستعادة الشاملة</span>';
        }
      }
    } catch (err) {
      App.showToast('خطأ أثناء تنفيذ الاستعادة: ' + err.message, 'error');
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = '<span>🛡️ تأكيد وتنفيذ الاستعادة الشاملة</span>';
      }
    }
  }
};

if (typeof window !== 'undefined') {
  window.Settings = Settings;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Settings;
}

