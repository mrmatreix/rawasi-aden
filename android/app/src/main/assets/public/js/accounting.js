/**
 * إدارة العمليات المحاسبية، السندات، حركة الصندوق، والعهد - شركة رواسي عدن
 */

const Accounting = {
  clients: [],
  suppliers: [],
  projects: [],
  accounts: [],
  costCenters: [],
  currencies: [],
  employees: [],
  openCustodies: [],
  journalEntries: [],
  currentJournalEntry: null,
  activeJournalTab: 'journalEntries',

  async init() {
    await this.loadDropdowns();
    await this.loadCashMovement();
    await this.loadRecentCustodySummary();
  },

  _targetClientSelectId: null,
  _targetSupplierSelectId: null,

  async loadDropdowns() {
    try {
      const [cRes, sRes, pRes, aRes, ccRes, empRes] = await Promise.all([
        fetch('/api/clients').then(r => r.json()).catch(() => ({ success: false })),
        fetch('/api/suppliers').then(r => r.json()).catch(() => ({ success: false })),
        fetch('/api/projects').then(r => r.json()).catch(() => ({ success: false })),
        fetch('/api/accounting/accounts').then(r => r.json()).catch(() => ({ success: false })),
        fetch('/api/accounting/cost-centers').then(r => r.json()).catch(() => ({ success: false })),
        fetch('/api/hr/employees').then(r => r.json()).catch(() => ({ success: false }))
      ]);

      if (cRes.success) {
        this.clients = cRes.data;
        this.populateSelect('rcClientSelect', cRes.data, 'name');
        this.populateSelect('modalRcClientSelect', cRes.data, 'name');
        this.populateSelect('statementClientSelect', cRes.data, 'name');
        this.populateSelect('projClientSelect', cRes.data, 'name');
      }
      if (sRes.success) {
        this.suppliers = sRes.data;
        this.populateSelect('expSupplierSelect', sRes.data, 'name');
      }
      if (pRes.success) {
        this.projects = pRes.data;
        this.populateSelect('rcProjectSelect', pRes.data, 'name');
        this.populateSelect('modalRcProjectSelect', pRes.data, 'name');
        this.populateSelect('expProjectSelect', pRes.data, 'name');
      }
      if (aRes.success) {
        this.accounts = aRes.data;
        this.populateSelectCustom('rcAccountSelect', aRes.data, a => `${a.code || a.account_code} - ${a.name || a.account_name} (${a.type || a.account_type || ''})`);
        this.populateSelectCustom('modalRcAccountSelect', aRes.data, a => `${a.code || a.account_code} - ${a.name || a.account_name} (${a.type || a.account_type || ''})`);
        this.populateSelectCustom('expAccountSelect', aRes.data, a => `${a.code || a.account_code} - ${a.name || a.account_name} (${a.type || a.account_type || ''})`);
        this.populateSelectCustom('modalExpAccountSelect', aRes.data, a => `${a.code || a.account_code} - ${a.name || a.account_name} (${a.type || a.account_type || ''})`);
      }
      if (ccRes.success) {
        this.costCenters = ccRes.data;
        this.populateSelectCustom('rcCostCenterSelect', ccRes.data, cc => `${cc.code} - ${cc.name}`);
        this.populateSelectCustom('modalRcCostCenterSelect', ccRes.data, cc => `${cc.code} - ${cc.name}`);
        this.populateSelectCustom('expCostCenterSelect', ccRes.data, cc => `${cc.code} - ${cc.name}`);
        this.populateSelectCustom('modalExpCostCenterSelect', ccRes.data, cc => `${cc.code} - ${cc.name}`);
      }
      if (empRes.success) {
        this.employees = empRes.data;
        this.populateSelectCustom('custodyEmployeeSelect', empRes.data, e => `${e.name} (${e.employee_no || e.role || 'موظف'})`);
        this.populateSelectCustom('modalCustodyEmployeeSelect', empRes.data, e => `${e.name} (${e.employee_no || e.role || 'موظف'})`);
      }
    } catch (e) {
      console.error('Error loading dropdowns:', e);
    }
  },

  populateSelect(elementId, items, displayField) {
    const el = document.getElementById(elementId);
    if (!el || !Array.isArray(items)) return;
    const defaultOption = el.options[0] ? el.options[0].outerHTML : '<option value="">اختر...</option>';
    el.innerHTML = defaultOption + items.map(item => `<option value="${item.id}">${item[displayField]}</option>`).join('');
  },

  populateSelectCustom(elementId, items, formatFn) {
    const el = document.getElementById(elementId);
    if (!el || !Array.isArray(items)) return;
    const defaultOption = el.options[0] ? el.options[0].outerHTML : '<option value="">اختر...</option>';
    el.innerHTML = defaultOption + items.map(item => `<option value="${item.id}">${formatFn(item)}</option>`).join('');
  },

  // إظهار/إخفاء حقول الشيك بناء على طريقة الدفع
  handlePaymentMethodChange(selectId, targetRowId) {
    const el = typeof selectId === 'string' ? document.getElementById(selectId) : selectId;
    const row = document.getElementById(targetRowId);
    if (!el || !row) return;
    const isCheck = el.value === 'شيك';
    row.style.display = isCheck ? 'block' : 'none';
    const checkNoInput = row.querySelector('input[type="text"]');
    if (checkNoInput) {
      if (isCheck) {
        checkNoInput.setAttribute('required', 'true');
        checkNoInput.focus();
      } else {
        checkNoInput.removeAttribute('required');
      }
    }
  },

  // التحكم بنوع العهدة (صرف عهدة أو تصفية عهدة)
  handleCustodyTypeChange(selectId, relatedRowId) {
    const el = typeof selectId === 'string' ? document.getElementById(selectId) : selectId;
    const row = document.getElementById(relatedRowId);
    if (!el || !row) return;
    const isLiquidation = el.value === 'تصفية عهدة';
    row.style.display = isLiquidation ? 'block' : 'none';

    const isQuick = relatedRowId.includes('quick');
    const amtLabel = document.getElementById(isQuick ? 'quickCustodyAmountLabel' : 'modalCustodyAmountLabel');
    if (amtLabel) {
      amtLabel.textContent = isLiquidation ? 'المبلغ المراد تصفيته *' : 'إجمالي العهدة *';
    }

    // إذا تم اختيار التصفية، جلب العهد النشطة للموظف المختار
    const empSelectId = isQuick ? 'custodyEmployeeSelect' : 'modalCustodyEmployeeSelect';
    const relSelectId = isQuick ? 'custodyRelatedSelect' : 'modalCustodyRelatedSelect';
    if (isLiquidation) {
      this.onCustodyEmployeeChange(empSelectId, relSelectId);
    }
  },

  // عند تغيير الموظف في العهد: جلب عهده النشطة المفتوحة للتصفية
  async onCustodyEmployeeChange(empSelectId, relatedSelectId) {
    const empSelect = document.getElementById(empSelectId);
    const relSelect = document.getElementById(relatedSelectId);
    if (!empSelect) return;
    const empId = empSelect.value;
    const isQuick = empSelectId === 'custodyEmployeeSelect';

    // مزامنة حقل الاسم النصي إن وجد
    const empObj = this.employees.find(e => String(e.id) === String(empId));
    if (empObj) {
      const nameInput = document.getElementById(isQuick ? 'custodyEmpName' : 'modalCustodyEmpName');
      if (nameInput) nameInput.value = empObj.name;
    }

    if (!relSelect) return;
    relSelect.innerHTML = '<option value="">جاري جلب العهد المفتوحة للتصفية...</option>';

    try {
      const res = await fetch(`/api/accounting/open-custodies${empId ? `?employee_id=${empId}` : ''}`);
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        this.openCustodies = data.data;
        if (data.data.length === 0) {
          relSelect.innerHTML = '<option value="">لا توجد عهد نشطة متبقية لهذا الموظف</option>';
        } else {
          relSelect.innerHTML = '<option value="">اختر العهدة الأصلية المراد تصفيتها...</option>' +
            data.data.map(c => `
              <option value="${c.id}" data-rem="${c.remaining_amount}" data-total="${c.total_amount}" data-no="${c.custody_no || ('CST-' + c.id)}">
                ${c.custody_no || ('CST-' + c.id)} - إجمالي: ${App.formatNumber(c.total_amount)} | متبقي: ${App.formatNumber(c.remaining_amount)} ${c.currency || 'ر.ي'} (${c.date})
              </option>
            `).join('');
        }
      } else {
        relSelect.innerHTML = '<option value="">لا توجد عهد نشطة</option>';
      }
    } catch (e) {
      console.error('Error fetching open custodies:', e);
      relSelect.innerHTML = '<option value="">فشل جلب العهد</option>';
    }
  },

  // عند اختيار عهدة أصلية للتصفية
  onRelatedCustodySelect(selectId, totalAmountId, spentAmountId) {
    const selectEl = document.getElementById(selectId);
    const totalEl = document.getElementById(totalAmountId);
    if (!selectEl || !totalEl) return;
    const selectedOpt = selectEl.options[selectEl.selectedIndex];
    if (!selectedOpt || !selectedOpt.value) return;

    const rem = Number(selectedOpt.getAttribute('data-rem')) || 0;
    totalEl.value = rem;
    totalEl.setAttribute('max', rem);
    App.showToast(`الرصيد المتبقي المتاح للتصفية في هذه العهدة هو: ${App.formatNumber(rem)}`, 'info');
  },

  // ================== تفقيط الأرقام وتحويلها إلى كلمات عربية ==================
  tafqeet(num, currency = 'ر.ي') {
    if (!num || isNaN(num) || Number(num) <= 0) return '';
    if (typeof window !== 'undefined' && typeof window.Tafqeet === 'function') {
      const words = window.Tafqeet(num, currency);
      return words ? `فقط ${words} لا غير` : '';
    }
    return `فقط ${App.formatNumber(num)} ${currency} لا غير`;
  },

  // فتح نافذة منبثقة لتسجيل سند قبض جديد
  openNewReceiptModal() {
    this.loadDropdowns();
    const dateInput = document.getElementById('modalRcDate');
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
    const form = document.getElementById('modalReceiptForm');
    if (form) form.reset();
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
    const checkRow = document.getElementById('modalRcCheckRow');
    if (checkRow) checkRow.style.display = 'none';
    App.openModal('newReceiptModal');
  },

  // حفظ سند قبض من النافذة المنبثقة
  async submitReceiptVoucherModal(e) {
    if (e) e.preventDefault();
    const client_id = document.getElementById('modalRcClientSelect').value;
    const project_id = document.getElementById('modalRcProjectSelect').value;
    const account_id = document.getElementById('modalRcAccountSelect')?.value || null;
    const cost_center_id = document.getElementById('modalRcCostCenterSelect')?.value || null;
    const date = document.getElementById('modalRcDate').value;
    const payment_method = document.getElementById('modalRcPaymentMethod').value;
    const check_no = document.getElementById('modalRcCheckNo')?.value?.trim() || null;
    const bank_name = document.getElementById('modalRcBankName')?.value?.trim() || null;
    const amount = document.getElementById('modalRcAmount').value;
    const currency = document.getElementById('modalRcCurrency')?.value || 'ر.ي';
    const notes = document.getElementById('modalRcNotes').value;

    if (!client_id) {
      App.showToast('يرجى اختيار العميل', 'error');
      return;
    }
    if (!amount || Number(amount) <= 0) {
      App.showToast('يرجى تحديد المبلغ بشكل صحيح', 'error');
      return;
    }
    if (payment_method === 'شيك' && !check_no) {
      App.showToast('يرجى تحديد رقم الشيك عند اختيار طريقة الدفع بشيك', 'error');
      document.getElementById('modalRcCheckNo')?.focus();
      return;
    }

    try {
      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'قبض',
          client_id,
          project_id,
          account_id,
          cost_center_id,
          date,
          payment_method,
          check_no,
          bank_name,
          amount,
          currency,
          notes
        })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(`تم حفظ سند القبض بنجاح (${data.receipt_no})`, 'success');
        App.closeModal('newReceiptModal');
        const form = document.getElementById('modalReceiptForm');
        if (form) form.reset();
        
        // تحديث جميع الجداول والشاشات فوراً
        App.loadRevenuesTable();
        Reports.loadDashboardKPIs();
        this.loadCashMovement();
        
        // إمكانية الطباعة الفورية
        if (confirm(`تم إنشاء سند القبض ${data.receipt_no}. هل تريد طباعة السند الآن؟`)) {
          const acc = (this.accounts || []).find(a => String(a.id) === String(account_id));
          const cc = (this.costCenters || []).find(c => String(c.id) === String(cost_center_id));
          this.printReceipt({
            receipt_no: data.receipt_no,
            date,
            client_name: this.clients.find(c => c.id == client_id)?.name || 'العميل',
            project_name: this.projects.find(p => p.id == project_id)?.name || '-',
            account_code: acc?.code || acc?.account_code || '',
            account_name: acc?.name || acc?.account_name || '',
            cost_center_code: cc?.code || '',
            cost_center_name: cc?.name || '',
            amount,
            currency,
            payment_method,
            check_no,
            bank_name,
            notes
          });
        }
      } else {
        App.showToast(data.message || 'حدث خطأ أثناء الحفظ', 'error');
      }
    } catch (e) {
      App.showToast('فشل الاتصال بالخادم', 'error');
    }
  },

  // حفظ سند قبض من النموذج السريع (الإيرادات)
  async submitReceiptVoucher(e) {
    if (e) e.preventDefault();
    const client_id = document.getElementById('rcClientSelect').value;
    const project_id = document.getElementById('rcProjectSelect').value;
    const account_id = document.getElementById('rcAccountSelect')?.value || null;
    const cost_center_id = document.getElementById('rcCostCenterSelect')?.value || null;
    const date = document.getElementById('rcDate').value;
    const payment_method = document.getElementById('rcPaymentMethod').value;
    const check_no = document.getElementById('rcCheckNo')?.value?.trim() || null;
    const bank_name = document.getElementById('rcBankName')?.value?.trim() || null;
    const amount = document.getElementById('rcAmount').value;
    const currency = document.getElementById('rcCurrency')?.value || 'ر.ي';
    const notes = document.getElementById('rcNotes').value;

    if (!amount || Number(amount) <= 0) {
      App.showToast('يرجى تحديد المبلغ بشكل صحيح', 'error');
      return;
    }
    if (payment_method === 'شيك' && !check_no) {
      App.showToast('يرجى تحديد رقم الشيك عند اختيار طريقة الدفع بشيك', 'error');
      document.getElementById('rcCheckNo')?.focus();
      return;
    }

    try {
      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'قبض',
          client_id,
          project_id,
          account_id,
          cost_center_id,
          date,
          payment_method,
          check_no,
          bank_name,
          amount,
          currency,
          notes
        })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(`تم حفظ سند القبض بنجاح (${data.receipt_no})`, 'success');
        this.resetReceiptForm();
        App.loadRevenuesTable();
        Reports.loadDashboardKPIs();
        this.loadCashMovement();
        // إمكانية الطباعة الفورية
        if (confirm(`تم إنشاء سند القبض ${data.receipt_no}. هل تريد طباعة السند الآن؟`)) {
          const acc = (this.accounts || []).find(a => String(a.id) === String(account_id));
          const cc = (this.costCenters || []).find(c => String(c.id) === String(cost_center_id));
          this.printReceipt({
            receipt_no: data.receipt_no,
            date,
            client_name: this.clients.find(c => c.id == client_id)?.name || 'العميل',
            project_name: this.projects.find(p => p.id == project_id)?.name || '-',
            account_code: acc?.code || acc?.account_code || '',
            account_name: acc?.name || acc?.account_name || '',
            cost_center_code: cc?.code || '',
            cost_center_name: cc?.name || '',
            amount,
            currency,
            payment_method,
            check_no,
            bank_name,
            notes
          });
        }
      } else {
        App.showToast(data.message || 'حدث خطأ', 'error');
      }
    } catch (e) {
      App.showToast('فشل الاتصال بالخادم', 'error');
    }
  },

  resetReceiptForm() {
    const form = document.getElementById('quickReceiptForm');
    if (form) form.reset();
    const dateInput = document.getElementById('rcDate');
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
    const checkRow = document.getElementById('rcCheckFieldsRow');
    if (checkRow) checkRow.style.display = 'none';
  },

  // حفظ سند صرف من النموذج السريع (المصروفات)
  async submitExpenseVoucher(e) {
    if (e) e.preventDefault();
    const expense_type = document.getElementById('expTypeSelect').value;
    const project_id = document.getElementById('expProjectSelect').value;
    const supplier_id = document.getElementById('expSupplierSelect').value;
    const account_id = document.getElementById('expAccountSelect')?.value || null;
    const cost_center_id = document.getElementById('expCostCenterSelect')?.value || null;
    const date = document.getElementById('expDate').value;
    const payment_method = document.getElementById('expPaymentMethod').value;
    const check_no = document.getElementById('expCheckNo')?.value?.trim() || null;
    const bank_name = document.getElementById('expBankName')?.value?.trim() || null;
    const amount = document.getElementById('expAmount').value;
    const currency = document.getElementById('expCurrency')?.value || 'ر.ي';
    const notes = document.getElementById('expNotes').value;

    if (!expense_type || !amount || Number(amount) <= 0) {
      App.showToast('يرجى تحديد نوع المصروف والمبلغ', 'error');
      return;
    }
    if (payment_method === 'شيك' && !check_no) {
      App.showToast('يرجى تحديد رقم الشيك عند الصرف بشيك', 'error');
      document.getElementById('expCheckNo')?.focus();
      return;
    }

    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expense_type,
          project_id,
          supplier_id,
          account_id,
          cost_center_id,
          date,
          payment_method,
          check_no,
          bank_name,
          amount,
          currency,
          notes
        })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(`تم حفظ سند الصرف بنجاح (${data.receipt_no})`, 'success');
        this.resetExpenseForm();
        Reports.loadDashboardKPIs();
        Projects.loadProjects();
        this.loadCashMovement();
      } else {
        App.showToast(data.message || 'حدث خطأ', 'error');
      }
    } catch (e) {
      App.showToast('فشل الاتصال بالخادم', 'error');
    }
  },

  resetExpenseForm() {
    const form = document.getElementById('quickExpenseForm');
    if (form) form.reset();
    const dateInput = document.getElementById('expDate');
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
    const checkRow = document.getElementById('expCheckFieldsRow');
    if (checkRow) checkRow.style.display = 'none';
  },

  // حفظ النثريات والعهد من النموذج السريع
  async submitCustody(e) {
    if (e) e.preventDefault();
    const operation_type = document.getElementById('custodyTypeSelect').value;
    const empSelect = document.getElementById('custodyEmployeeSelect');
    const employee_id = empSelect ? empSelect.value : null;
    const employee_name = empSelect?.options[empSelect.selectedIndex]?.text?.split('(')[0]?.trim() || document.getElementById('custodyEmpName')?.value?.trim();
    const related_custody_id = document.getElementById('custodyRelatedSelect')?.value || null;
    const total_amount = document.getElementById('custodyTotalAmount').value;
    const currency = document.getElementById('custodyCurrency')?.value || 'ر.ي';
    const spent_amount = document.getElementById('custodySpentAmount')?.value || 0;
    const date = document.getElementById('custodyDate').value;
    const notes = document.getElementById('custodyNotes')?.value || '';

    if (!employee_name || !total_amount || Number(total_amount) <= 0) {
      App.showToast('يرجى اختيار الموظف وتحديد مبلغ العهدة', 'error');
      return;
    }
    if (operation_type === 'تصفية عهدة' && !related_custody_id) {
      App.showToast('يرجى اختيار رقم العهدة الأصلية المراد تصفيتها', 'error');
      document.getElementById('custodyRelatedSelect')?.focus();
      return;
    }

    try {
      const res = await fetch('/api/accounting/custodies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation_type,
          employee_id,
          employee_name,
          related_custody_id,
          total_amount,
          spent_amount,
          currency,
          date,
          notes
        })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast('تم تسجيل حركة العهدة بنجاح', 'success');
        this.loadRecentCustodySummary();
        App.loadCustodyTable();
        // إعادة تعيين النموذج السريع
        const form = document.getElementById('quickCustodyForm');
        if (form) form.reset();
        const relRow = document.getElementById('quickCustodyRelatedRow');
        if (relRow) relRow.style.display = 'none';
      } else {
        App.showToast(data.message || 'خطأ', 'error');
      }
    } catch (e) {
      App.showToast('فشل الاتصال بالخادم', 'error');
    }
  },

  // فتح نافذة سند صرف جديد
  openNewExpenseModal() {
    this.loadDropdowns();
    const form = document.getElementById('modalExpenseForm');
    if (form) form.reset();
    const dateInput = document.getElementById('modalExpDate');
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];

    // ملء قوائم المشاريع والموردين والحسابات ومراكز التكلفة
    if (this.projects && this.projects.length) {
      const projSelect = document.getElementById('modalExpProjectSelect');
      if (projSelect) {
        projSelect.innerHTML = `<option value="">اختر المشروع (اختياري)...</option>` +
          this.projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
      }
    }
    if (this.suppliers && this.suppliers.length) {
      const suppSelect = document.getElementById('modalExpSupplierSelect');
      if (suppSelect) {
        suppSelect.innerHTML = `<option value="">اختر المورد (اختياري)...</option>` +
          this.suppliers.map(s => `<option value="${s.id}">${s.name} (${s.category || 'مورد'})</option>`).join('');
      }
    }
    if (this.accounts && this.accounts.length) {
      this.populateSelectCustom('modalExpAccountSelect', this.accounts, a => `${a.code || a.account_code} - ${a.name || a.account_name} (${a.type || a.account_type || ''})`);
    }
    if (this.costCenters && this.costCenters.length) {
      this.populateSelectCustom('modalExpCostCenterSelect', this.costCenters, cc => `${cc.code} - ${cc.name}`);
    }

    const checkRow = document.getElementById('modalExpCheckRow');
    if (checkRow) checkRow.style.display = 'none';

    App.openModal('newExpenseModal');
  },

  // حفظ سند الصرف من النافذة المنبثقة
  async submitExpenseVoucherModal(e) {
    if (e) e.preventDefault();
    const expense_type = document.getElementById('modalExpTypeSelect').value;
    const project_id = document.getElementById('modalExpProjectSelect').value;
    const supplier_id = document.getElementById('modalExpSupplierSelect').value;
    const account_id = document.getElementById('modalExpAccountSelect')?.value || null;
    const cost_center_id = document.getElementById('modalExpCostCenterSelect')?.value || null;
    const date = document.getElementById('modalExpDate').value;
    const payment_method = document.getElementById('modalExpPaymentMethod').value;
    const check_no = document.getElementById('modalExpCheckNo')?.value?.trim() || null;
    const bank_name = document.getElementById('modalExpBankName')?.value?.trim() || null;
    const amount = document.getElementById('modalExpAmount').value;
    const currency = document.getElementById('modalExpCurrency')?.value || 'ر.ي';
    const notes = document.getElementById('modalExpNotes').value;

    if (!expense_type || !amount || Number(amount) <= 0) {
      App.showToast('يرجى تحديد نوع المصروف والمبلغ المطلوب', 'error');
      return;
    }
    if (payment_method === 'شيك' && !check_no) {
      App.showToast('يرجى تحديد رقم الشيك عند الصرف بشيك', 'error');
      document.getElementById('modalExpCheckNo')?.focus();
      return;
    }

    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expense_type,
          project_id,
          supplier_id,
          account_id,
          cost_center_id,
          date,
          payment_method,
          check_no,
          bank_name,
          amount,
          currency,
          notes
        })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(`تم حفظ سند الصرف بنجاح (${data.receipt_no})`, 'success');
        App.closeModal('newExpenseModal');
        const form = document.getElementById('modalExpenseForm');
        if (form) form.reset();

        App.loadExpensesTable();
        Reports.loadDashboardKPIs();
        if (typeof Projects !== 'undefined' && Projects.loadProjects) {
          Projects.loadProjects();
        }
        this.loadCashMovement();

        if (confirm(`تم تسجيل سند الصرف ${data.receipt_no}. هل تريد طباعة السند الآن؟`)) {
          const acc = (this.accounts || []).find(a => String(a.id) === String(account_id));
          const cc = (this.costCenters || []).find(c => String(c.id) === String(cost_center_id));
          this.printExpenseReceipt({
            receipt_no: data.receipt_no,
            date,
            expense_type,
            supplier_name: this.suppliers.find(s => s.id == supplier_id)?.name || '-',
            project_name: this.projects.find(p => p.id == project_id)?.name || '-',
            account_code: acc?.code || acc?.account_code || '',
            account_name: acc?.name || acc?.account_name || '',
            cost_center_code: cc?.code || '',
            cost_center_name: cc?.name || '',
            amount,
            currency,
            payment_method,
            check_no,
            bank_name,
            notes
          });
        }
      } else {
        App.showToast(data.message || 'حدث خطأ أثناء الحفظ', 'error');
      }
    } catch (e) {
      App.showToast('فشل الاتصال بالخادم', 'error');
    }
  },

  // فتح نافذة تسجيل عهدة جديدة
  openNewCustodyModal() {
    this.loadDropdowns();
    const form = document.getElementById('modalCustodyForm');
    if (form) form.reset();
    const dateInput = document.getElementById('modalCustodyDate');
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
    const remInput = document.getElementById('modalCustodyRemainingAmount');
    if (remInput) remInput.value = '0';
    const relRow = document.getElementById('modalCustodyRelatedRow');
    if (relRow) relRow.style.display = 'none';
    App.openModal('newCustodyModal');
  },

  // فتح نافذة تصفية عهدة محددة مسبقاً
  async openSettleCustodyModal(custodyId, custodyNo, employeeName, employeeId, remainingAmount, currency) {
    this.openNewCustodyModal();
    const typeSelect = document.getElementById('modalCustodyTypeSelect');
    if (typeSelect) {
      typeSelect.value = 'تصفية عهدة';
      this.handleCustodyTypeChange('modalCustodyTypeSelect', 'modalCustodyRelatedRow');
    }
    const empSelect = document.getElementById('modalCustodyEmployeeSelect');
    if (empSelect) {
      for (let i = 0; i < empSelect.options.length; i++) {
        if ((employeeName && empSelect.options[i].text.includes(employeeName)) || (employeeId && empSelect.options[i].value == employeeId)) {
          empSelect.selectedIndex = i;
          break;
        }
      }
      await this.onCustodyEmployeeChange('modalCustodyEmployeeSelect', 'modalCustodyRelatedSelect');
      const relSelect = document.getElementById('modalCustodyRelatedSelect');
      if (relSelect) {
        relSelect.value = custodyId;
        this.onRelatedCustodySelect('modalCustodyRelatedSelect', 'modalCustodyTotalAmount', 'modalCustodySpentAmount');
      }
    }
  },

  calcModalCustodyRemaining() {
    const total = Number(document.getElementById('modalCustodyTotalAmount')?.value) || 0;
    const spent = Number(document.getElementById('modalCustodySpentAmount')?.value) || 0;
    const remEl = document.getElementById('modalCustodyRemainingAmount');
    if (remEl) remEl.value = Math.max(0, total - spent);
  },

  // حفظ العهدة من النافذة المنبثقة
  async submitCustodyModal(e) {
    if (e) e.preventDefault();
    const operation_type = document.getElementById('modalCustodyTypeSelect').value;
    const empSelect = document.getElementById('modalCustodyEmployeeSelect');
    const employee_id = empSelect ? empSelect.value : null;
    const employee_name = empSelect?.options[empSelect.selectedIndex]?.text?.split('(')[0]?.trim() || document.getElementById('modalCustodyEmpName')?.value?.trim();
    const related_custody_id = document.getElementById('modalCustodyRelatedSelect')?.value || null;
    const date = document.getElementById('modalCustodyDate').value;
    const currency = document.getElementById('modalCustodyCurrency')?.value || 'ر.ي';
    const total_amount = document.getElementById('modalCustodyTotalAmount').value;
    const spent_amount = document.getElementById('modalCustodySpentAmount').value || 0;
    const notes = document.getElementById('modalCustodyNotes').value;

    if (!employee_name || !total_amount || Number(total_amount) <= 0) {
      App.showToast('يرجى اختيار الموظف وإدخال مبلغ العهدة', 'error');
      return;
    }
    if (operation_type === 'تصفية عهدة' && !related_custody_id) {
      App.showToast('يرجى تحديد رقم العهدة الأصلية المراد تصفيتها', 'error');
      document.getElementById('modalCustodyRelatedSelect')?.focus();
      return;
    }

    try {
      const res = await fetch('/api/accounting/custodies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation_type,
          employee_id,
          employee_name,
          related_custody_id,
          total_amount,
          spent_amount,
          currency,
          date,
          notes
        })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast('تم تسجيل حركة العهدة بنجاح', 'success');
        App.closeModal('newCustodyModal');
        const form = document.getElementById('modalCustodyForm');
        if (form) form.reset();

        App.loadCustodyTable();
        this.loadRecentCustodySummary();
      } else {
        App.showToast(data.message || 'حدث خطأ', 'error');
      }
    } catch (e) {
      App.showToast('فشل الاتصال بالخادم', 'error');
    }
  },

  // طباعة سند صرف رسمي على الورقة الرسمية المعتمدة
  printExpenseReceipt(info) {
    const printArea = document.getElementById('printArea');
    if (!printArea) return;

    let currLabel = 'ريال يمني (ر.ي)';
    if (info.currency === 'ر.س') currLabel = 'ريال سعودي (ر.س)';
    else if (info.currency === '$' || info.currency === 'USD') currLabel = 'دولار أمريكي ($)';

    const words = this.tafqeet(info.amount, info.currency);
    const cfg = (typeof Settings !== 'undefined' && Settings.getPrintConfig) ? Settings.getPrintConfig() : {
      sig1: 'المستلم',
      sig2: 'أمين الصندوق / المحاسب',
      sig3: 'اعتماد الإدارة',
      show_stamp: '1',
      footer_notes: 'تعتبر هذه السندات والوثائق رسمية ومعتمدة من الإدارة المالية',
      expense_title: 'سـنـد صـرف رسـمـي',
      voucher_layout: 'single_a4',
      voucher_show_tafqeet: '1',
      voucher_show_project: '1',
      voucher_show_payment_method: '1',
      voucher_show_cheque_ref: '1'
    };

    const showTafqeet = (cfg.voucher_show_tafqeet !== '0' && cfg.voucher_show_tafqeet !== 0 && cfg.voucher_show_tafqeet !== false);
    const showProject = (cfg.voucher_show_project !== '0' && cfg.voucher_show_project !== 0 && cfg.voucher_show_project !== false);
    const showPaymentMethod = (cfg.voucher_show_payment_method !== '0' && cfg.voucher_show_payment_method !== 0 && cfg.voucher_show_payment_method !== false);
    const titleText = cfg.expense_title || 'سـنـد صـرف رسـمـي';

    const plainClass = (cfg.header_style === 'plain') ? ' plain-mode' : '';
    const fontClass = cfg.font_family ? ` font-${cfg.font_family.toLowerCase()}` : ' font-cairo';
    const scaleClass = cfg.font_size_scale ? ` scale-${cfg.font_size_scale}` : '';
    const isDual = (cfg.voucher_layout === 'dual_a4');

    const renderSingleVoucher = (copyLabel = '') => `
      <div class="letterhead-content-wrap" style="${isDual ? 'min-height: auto; padding: 4px 0;' : ''}">
        <div>
          <!-- ترويسة نوع السند وبياناته -->
          <div class="letterhead-doc-header" style="border-bottom-color: #dc2626;">
            <div class="letterhead-doc-title-badge" style="background: linear-gradient(135deg, #7f1d1d, #991b1b); border-right-color: #ef4444;">
              ${titleText} ${copyLabel ? `<span style="font-size:0.75rem; font-weight:normal;">(${copyLabel})</span>` : ''}
            </div>
            <div class="letterhead-doc-meta">
              <div class="letterhead-doc-meta-item">رقم السند: <strong>${info.receipt_no || ('PV-' + Date.now().toString().slice(-4))}</strong></div>
              <div class="letterhead-doc-meta-item">التاريخ والوقت: <strong>${info.date || new Date().toISOString().split('T')[0]} - ${new Date().toLocaleTimeString('ar-YE', { hour: '2-digit', minute: '2-digit' })}</strong></div>
              <div class="letterhead-doc-meta-item">المستخدم المسجل: <strong>${(typeof Settings !== 'undefined' && Settings.getCurrentUserName) ? Settings.getCurrentUserName() : 'علوي محمد باعبيد'}</strong></div>
            </div>
          </div>

          <!-- بطاقة المبلغ المالي -->
          <div class="voucher-amount-card" style="border-color: #ef4444; background: #fff5f5; ${isDual ? 'padding: 6px 12px; margin: 6px 0 8px 0;' : ''}">
            <div>
              <span style="font-size: 0.95rem; color: #475569; font-weight: bold; margin-left: 8px;">المبلغ المصروف:</span>
              <span class="voucher-amount-value" style="color: #dc2626;">${App.formatNumber(info.amount)} ${currLabel}</span>
            </div>
            ${showTafqeet ? `<div class="voucher-amount-words" style="color: #991b1b;">فقط: ${words} لا غير.</div>` : ''}
          </div>

          <!-- جدول تفاصيل وبيانات السند -->
          <table class="voucher-grid-table" style="${isDual ? 'margin-bottom: 6px;' : ''}">
            <tr>
              <td class="label-cell" style="border-right-color: #dc2626;">صرفنا إلى الأخ/السادة:</td>
              <td class="val-cell">${info.supplier_name && info.supplier_name !== '-' ? info.supplier_name : (info.paid_to || 'المستفيد الميداني')}</td>
            </tr>
            <tr>
              <td class="label-cell" style="border-right-color: #dc2626;">نوع المصروف / البند:</td>
              <td class="val-cell">${info.expense_type || 'مصروفات مشاريع'}</td>
            </tr>
            ${info.account_name ? `
            <tr>
              <td class="label-cell" style="border-right-color: #dc2626;">الحساب المالي (الدليل):</td>
              <td class="val-cell"><strong>${info.account_code ? info.account_code + ' - ' : ''}${info.account_name}</strong></td>
            </tr>` : ''}
            ${info.cost_center_name ? `
            <tr>
              <td class="label-cell" style="border-right-color: #dc2626;">مركز التكلفة:</td>
              <td class="val-cell">${info.cost_center_code ? info.cost_center_code + ' - ' : ''}${info.cost_center_name}</td>
            </tr>` : ''}
            ${showProject ? `
            <tr>
              <td class="label-cell" style="border-right-color: #dc2626;">المشروع التابع له:</td>
              <td class="val-cell">${info.project_name || 'عام / تشغيلي'}</td>
            </tr>` : ''}
            ${showPaymentMethod ? `
            <tr>
              <td class="label-cell" style="border-right-color: #dc2626;">طريقة الدفع:</td>
              <td class="val-cell">${info.payment_method || 'نقدي'}${info.check_no ? ` (شيك رقم: <strong>${info.check_no}</strong>${info.bank_name ? ' - بنك ' + info.bank_name : ''})` : ''}</td>
            </tr>` : ''}
            <tr>
              <td class="label-cell" style="border-right-color: #dc2626;">وذلك عن (البيان):</td>
              <td class="val-cell">${info.notes || 'مصروفات وأعمال مشتريات للمشروع'}</td>
            </tr>
          </table>
        </div>

        <!-- التواقيع والاعتماد والختم -->
        <div>
          ${(typeof Settings !== 'undefined' && Settings.renderReportSignatures) ? Settings.renderReportSignatures(cfg) : `
          <div class="letterhead-signatures-row">
            <div class="letterhead-sig-col">
              <div class="letterhead-sig-label">${cfg.sig1 || 'المستلم'}</div>
              <div class="letterhead-sig-dots">التوقيع: ........................</div>
            </div>
            <div class="letterhead-sig-col">
              <div class="letterhead-sig-label">${cfg.sig2 || 'أمين الصندوق / المحاسب'}</div>
              <div class="letterhead-sig-dots">المحاسب: ........................</div>
            </div>
            <div class="letterhead-sig-col">
              <div class="letterhead-sig-label">${cfg.sig3 || 'اعتماد الإدارة'}</div>
              <div class="letterhead-sig-dots">الاعتماد: ........................</div>
            </div>
          </div>
          `}

          ${cfg.footer_notes ? `<div style="margin-top: ${isDual ? '6px' : '15px'}; padding-top: 6px; border-top: 1px dashed #cbd5e1; font-size: 0.75rem; color: #64748b; text-align: center;">${cfg.footer_notes}</div>` : ''}
        </div>
      </div>
    `;

    if (isDual) {
      printArea.innerHTML = `
        <div class="official-letterhead-page${plainClass}${fontClass}${scaleClass}" style="padding: 10mm 12mm !important; min-height: 270mm; background-image: none !important; background-color: #ffffff !important;">
          <div class="dual-voucher-container">
            <div class="dual-voucher-item">
              ${renderSingleVoucher('نسخة أصلية')}
            </div>
            <div class="dual-voucher-divider">
              <span>✂️ خط القص والتنقيط (سند مزدوج A4)</span>
            </div>
            <div class="dual-voucher-item">
              ${renderSingleVoucher('نسخة الأرشيف / الإدارة')}
            </div>
          </div>
        </div>
      `;
    } else {
      printArea.innerHTML = `
        <div class="official-letterhead-page${plainClass}${fontClass}${scaleClass}" style="padding: 14mm 16mm !important; background-image: none !important; background-color: #ffffff !important;">
          ${renderSingleVoucher()}
        </div>
      `;
    }

    if (typeof Settings !== 'undefined' && Settings.setPrintTitle) {
      Settings.setPrintTitle(`سند صرف - ${info.receipt_no || ''}`);
    }
    window.print();
  },

  // طباعة سند عهدة أو تصفية عهدة رسمي
  printCustodyReceipt(info) {
    const printArea = document.getElementById('printArea');
    if (!printArea) return;

    let currLabel = 'ريال يمني (ر.ي)';
    if (info.currency === 'ر.س') currLabel = 'ريال سعودي (ر.س)';
    else if (info.currency === '$' || info.currency === 'USD') currLabel = 'دولار أمريكي ($)';

    const words = this.tafqeet(info.total_amount, info.currency);
    const cfg = (typeof Settings !== 'undefined' && Settings.getPrintConfig) ? Settings.getPrintConfig() : {
      sig1: 'المستلم / صاحب العهدة',
      sig2: 'أمين الصندوق / المحاسب',
      sig3: 'اعتماد الإدارة',
      footer_notes: 'تعتبر هذه العهدة في ذمة الموظف لحين تقديم الفواتير الرسمية والتصفية',
      voucher_layout: 'single_a4'
    };

    const isDual = (cfg.voucher_layout === 'dual_a4');
    const isLiquidation = (info.operation_type === 'تصفية عهدة');
    const accentColor = isLiquidation ? '#059669' : '#2563eb';
    const titleText = isLiquidation ? 'سـنـد تـصـفـيـة عـهـدة مـالـيـة' : 'سـنـد صـرف عـهـدة مـالـيـة';

    const renderSingleVoucher = (copyLabel = '') => `
      <div class="letterhead-content-wrap" style="${isDual ? 'min-height: auto; padding: 4px 0;' : ''}">
        <div>
          <div class="letterhead-doc-header" style="border-bottom-color: ${accentColor};">
            <div class="letterhead-doc-title-badge" style="background: linear-gradient(135deg, ${accentColor}, #1e3a8a); border-right-color: ${accentColor};">
              ${titleText} ${copyLabel ? `<span style="font-size:0.75rem; font-weight:normal;">(${copyLabel})</span>` : ''}
            </div>
            <div class="letterhead-doc-meta">
              <div class="letterhead-doc-meta-item">رقم السند: <strong>${info.custody_no || ('CST-' + (info.id || Date.now().toString().slice(-4)))}</strong></div>
              <div class="letterhead-doc-meta-item">التاريخ: <strong>${info.date || new Date().toISOString().split('T')[0]}</strong></div>
              <div class="letterhead-doc-meta-item">نوع العملية: <strong>${info.operation_type || 'صرف عهدة'}</strong></div>
            </div>
          </div>

          <div class="voucher-amount-card" style="border-color: ${accentColor}; background: #f8fafc; ${isDual ? 'padding: 6px 12px; margin: 6px 0 8px 0;' : ''}">
            <div>
              <span style="font-size: 0.95rem; color: #475569; font-weight: bold; margin-left: 8px;">مبلغ العهدة / التصفية:</span>
              <span class="voucher-amount-value" style="color: ${accentColor};">${App.formatNumber(info.total_amount)} ${currLabel}</span>
            </div>
            ${words ? `<div class="voucher-amount-words">فقط: ${words} لا غير.</div>` : ''}
          </div>

          <table class="voucher-grid-table" style="${isDual ? 'margin-bottom: 6px;' : ''}">
            <tr>
              <td class="label-cell" style="border-right-color: ${accentColor};">الموظف المسؤول:</td>
              <td class="val-cell"><strong>${info.employee_name || '-'}</strong> ${info.employee_no ? `<span class="badge badge-info" style="margin-right: 8px;">رقم الموظف: ${info.employee_no}</span>` : ''}</td>
            </tr>
            ${isLiquidation ? `
            <tr>
              <td class="label-cell" style="border-right-color: ${accentColor};">العهدة الأصلية المصفاة:</td>
              <td class="val-cell"><strong style="color: #2563eb;">${info.related_custody_no || (info.related_custody_id ? 'CST-' + info.related_custody_id : 'سند عهدة سابق')}</strong></td>
            </tr>
            <tr>
              <td class="label-cell" style="border-right-color: ${accentColor};">المصروف الفعلي:</td>
              <td class="val-cell" style="color: #dc2626; font-weight: bold;">${App.formatNumber(info.spent_amount || 0)} ${currLabel}</td>
            </tr>
            <tr>
              <td class="label-cell" style="border-right-color: ${accentColor};">الرصيد المتبقي:</td>
              <td class="val-cell" style="color: #059669; font-weight: bold;">${App.formatNumber(info.remaining_amount || 0)} ${currLabel}</td>
            </tr>
            ` : ''}
            <tr>
              <td class="label-cell" style="border-right-color: ${accentColor};">الغرض والبيان:</td>
              <td class="val-cell">${info.notes || 'عهدة نثريات ومصروفات ميدانية'}</td>
            </tr>
          </table>
        </div>

        <div>
          <div class="letterhead-signatures-row">
            <div class="letterhead-sig-col">
              <div class="letterhead-sig-label">${cfg.sig1 || 'المستلم / صاحب العهدة'}</div>
              <div class="letterhead-sig-dots">التوقيع: ........................</div>
            </div>
            <div class="letterhead-sig-col">
              <div class="letterhead-sig-label">${cfg.sig2 || 'أمين الصندوق / المحاسب'}</div>
              <div class="letterhead-sig-dots">المحاسب: ........................</div>
            </div>
            <div class="letterhead-sig-col">
              <div class="letterhead-sig-label">${cfg.sig3 || 'اعتماد الإدارة'}</div>
              <div class="letterhead-sig-dots">الاعتماد: ........................</div>
            </div>
          </div>
          ${cfg.footer_notes ? `<div style="margin-top: 15px; padding-top: 6px; border-top: 1px dashed #cbd5e1; font-size: 0.75rem; color: #64748b; text-align: center;">${cfg.footer_notes}</div>` : ''}
        </div>
      </div>
    `;

    printArea.innerHTML = `
      <div class="official-letterhead-page font-cairo" style="padding: 14mm 16mm !important; background-image: none !important; background-color: #ffffff !important;">
        ${renderSingleVoucher()}
      </div>
    `;

    if (typeof Settings !== 'undefined' && Settings.setPrintTitle) {
      Settings.setPrintTitle(`سند عهدة - ${info.custody_no || ''}`);
    }
    window.print();
  },

  // طباعة تجريبية لورقة السند من الإعدادات
  printTestReceipt() {
    this.printReceipt({
      receipt_no: 'RC-2026-0008',
      date: new Date().toISOString().split('T')[0],
      client_name: 'علوي محمد باعبيد',
      amount: 1000,
      currency: '$',
      project_name: 'مدرسة التواهي النموذجية',
      payment_method: 'نقدي',
      notes: 'دفعة أعمال مقاولات وهندسة (نموذج تجريبي للطباعة)'
    });
  },

  // تحديث أرقام بطاقة العهدة في لوحة التحكم
  async loadRecentCustodySummary() {
    try {
      const res = await fetch('/api/accounting/custodies');
      const data = await res.json();
      if (data.success && data.data.length > 0) {
        const latest = data.data[0];
        const totalEl = document.getElementById('custodySummaryTotal');
        const spentEl = document.getElementById('custodySummarySpent');
        const remainEl = document.getElementById('custodySummaryRemain');
        const curr = latest.currency || 'ر.ي';
        if (totalEl) totalEl.textContent = `${App.formatNumber(latest.total_amount)} ${curr}`;
        if (spentEl) spentEl.textContent = `${App.formatNumber(latest.spent_amount)} ${curr}`;
        if (remainEl) remainEl.textContent = `${App.formatNumber(latest.remaining_amount)} ${curr}`;
      }
    } catch (e) {}
  },

  // جلب وتحديث أرقام حركة الصندوق والبنك
  async loadCashMovement() {
    try {
      const res = await fetch('/api/accounting/cash-movements');
      const data = await res.json();
      if (data.success) {
        const s = data.summary;
        const prevBalEl = document.getElementById('cashPrevBalance');
        const inEl = document.getElementById('cashIncome');
        const outEl = document.getElementById('cashExpense');
        const withEl = document.getElementById('cashWithdrawal');
        const curBalEl = document.getElementById('cashCurBalance');

        if (prevBalEl) prevBalEl.textContent = App.formatNumber(s.initial_balance || 50000);
        if (inEl) inEl.textContent = App.formatNumber(s.total_cash_in || 25000);
        if (outEl) outEl.textContent = App.formatNumber(s.total_cash_out || 15000);
        if (withEl) withEl.textContent = App.formatNumber(s.total_withdrawals || 5000);
        if (curBalEl) curBalEl.textContent = App.formatNumber(s.current_balance || 55000);
      }
    } catch (e) {
      console.error('Error loading cash movements:', e);
    }
  },

  // تجهيز وطباعة سند رسمي على الورقة الرسمية المعتمدة
  printReceipt(info) {
    const printArea = document.getElementById('printArea');
    if (!printArea) return;

    const cfg = (typeof Settings !== 'undefined' && Settings.getPrintConfig) ? Settings.getPrintConfig() : {
      sig1: 'المستلم / المحاسب',
      sig2: 'المدير العام',
      sig3: 'اعتماد الإدارة',
      show_stamp: '0',
      footer_notes: 'تعتبر هذه السندات والوثائق رسمية ومعتمدة من الإدارة المالية',
      receipt_title: 'سـنـد قـبـض رسـمـي',
      voucher_layout: 'single_a4',
      voucher_show_tafqeet: '1',
      voucher_show_project: '1',
      voucher_show_payment_method: '1',
      voucher_show_cheque_ref: '1'
    };

    let currLabel = 'ريال يمني (ر.ي)';
    if (info.currency === 'ر.س') currLabel = 'ريال سعودي (ر.س)';
    else if (info.currency === '$' || info.currency === 'USD') currLabel = 'دولار أمريكي ($)';

    const words = this.tafqeet(info.amount, info.currency);
    const showTafqeet = (cfg.voucher_show_tafqeet !== '0' && cfg.voucher_show_tafqeet !== 0 && cfg.voucher_show_tafqeet !== false);
    const showProject = (cfg.voucher_show_project !== '0' && cfg.voucher_show_project !== 0 && cfg.voucher_show_project !== false);
    const showPaymentMethod = (cfg.voucher_show_payment_method !== '0' && cfg.voucher_show_payment_method !== 0 && cfg.voucher_show_payment_method !== false);
    const titleText = cfg.receipt_title || 'سـنـد قـبـض رسـمـي';

    const plainClass = (cfg.header_style === 'plain') ? ' plain-mode' : '';
    const fontClass = cfg.font_family ? ` font-${cfg.font_family.toLowerCase()}` : ' font-cairo';
    const scaleClass = cfg.font_size_scale ? ` scale-${cfg.font_size_scale}` : '';
    const accentColor = cfg.accent_color || '#d4af37';
    const isDual = (cfg.voucher_layout === 'dual_a4');

    const renderSingleVoucher = (copyLabel = '') => `
      <div class="letterhead-content-wrap" style="${isDual ? 'min-height: auto; padding: 4px 0;' : ''}">
        <div>
          <!-- ترويسة نوع السند وبياناته -->
          <div class="letterhead-doc-header" style="border-bottom-color: ${accentColor};">
            <div class="letterhead-doc-title-badge" style="border-right-color: ${accentColor};">
              ${titleText} ${copyLabel ? `<span style="font-size:0.75rem; font-weight:normal;">(${copyLabel})</span>` : ''}
            </div>
            <div class="letterhead-doc-meta">
              <div class="letterhead-doc-meta-item">رقم السند: <strong>${info.receipt_no || ('RC-' + Date.now().toString().slice(-4))}</strong></div>
              <div class="letterhead-doc-meta-item">التاريخ والوقت: <strong>${info.date || new Date().toISOString().split('T')[0]} - ${new Date().toLocaleTimeString('ar-YE', { hour: '2-digit', minute: '2-digit' })}</strong></div>
              <div class="letterhead-doc-meta-item">المستخدم المسجل: <strong>${(typeof Settings !== 'undefined' && Settings.getCurrentUserName) ? Settings.getCurrentUserName() : 'علوي محمد باعبيد'}</strong></div>
            </div>
          </div>

          <!-- بطاقة المبلغ المالي -->
          <div class="voucher-amount-card" style="border-color: ${accentColor}; ${isDual ? 'padding: 6px 12px; margin: 6px 0 8px 0;' : ''}">
            <div>
              <span style="font-size: 0.95rem; color: #475569; font-weight: bold; margin-left: 8px;">المبلغ المقبوض:</span>
              <span class="voucher-amount-value">${App.formatNumber(info.amount)} ${currLabel}</span>
            </div>
            ${showTafqeet ? `<div class="voucher-amount-words">فقط: ${words} لا غير.</div>` : ''}
          </div>

          <!-- جدول تفاصيل وبيانات السند -->
          <table class="voucher-grid-table" style="${isDual ? 'margin-bottom: 6px;' : ''}">
            <tr>
              <td class="label-cell" style="border-right-color: ${accentColor};">استلمنا من الأخ/السادة:</td>
              <td class="val-cell">${info.client_name || '-'}</td>
            </tr>
            ${info.account_name ? `
            <tr>
              <td class="label-cell" style="border-right-color: ${accentColor};">الحساب المالي (الدليل):</td>
              <td class="val-cell"><strong>${info.account_code ? info.account_code + ' - ' : ''}${info.account_name}</strong></td>
            </tr>` : ''}
            ${info.cost_center_name ? `
            <tr>
              <td class="label-cell" style="border-right-color: ${accentColor};">مركز التكلفة:</td>
              <td class="val-cell">${info.cost_center_code ? info.cost_center_code + ' - ' : ''}${info.cost_center_name}</td>
            </tr>` : ''}
            ${showProject ? `
            <tr>
              <td class="label-cell" style="border-right-color: ${accentColor};">المشروع التابع له:</td>
              <td class="val-cell">${info.project_name || 'عام / تشغيلي'}</td>
            </tr>` : ''}
            ${showPaymentMethod ? `
            <tr>
              <td class="label-cell" style="border-right-color: ${accentColor};">طريقة الدفع:</td>
              <td class="val-cell">${info.payment_method || 'نقدي'}${info.check_no ? ` (شيك رقم: <strong>${info.check_no}</strong>${info.bank_name ? ' - بنك ' + info.bank_name : ''})` : ''}</td>
            </tr>` : ''}
            <tr>
              <td class="label-cell" style="border-right-color: ${accentColor};">وذلك عن (البيان):</td>
              <td class="val-cell">${info.notes || 'دفعة أعمال مقاولات وهندسة'}</td>
            </tr>
          </table>
        </div>

        <!-- التواقيع والاعتماد والختم -->
        <div>
          ${(typeof Settings !== 'undefined' && Settings.renderReportSignatures) ? Settings.renderReportSignatures(cfg) : `
          <div class="letterhead-signatures-row">
            <div class="letterhead-sig-col">
              <div class="letterhead-sig-label">${cfg.sig1 || 'المستلم / المحاسب'}</div>
              <div class="letterhead-sig-dots">المحاسب: ........................</div>
            </div>
            <div class="letterhead-sig-col">
              <div class="letterhead-sig-label">${cfg.sig2 || 'المدير العام'}</div>
              <div class="letterhead-sig-dots">الاعتماد: ........................</div>
            </div>
            <div class="letterhead-sig-col">
              <div class="letterhead-sig-label">${cfg.sig3 || 'اعتماد الإدارة'}</div>
              <div class="letterhead-sig-dots">الاعتماد: ........................</div>
            </div>
          </div>
          `}

          ${cfg.footer_notes ? `<div style="margin-top: ${isDual ? '6px' : '15px'}; padding-top: 6px; border-top: 1px dashed #cbd5e1; font-size: 0.78rem; color: #64748b; text-align: center;">${cfg.footer_notes}</div>` : ''}
        </div>
      </div>
    `;

    if (isDual) {
      printArea.innerHTML = `
        <div class="official-letterhead-page${plainClass}${fontClass}${scaleClass}" style="padding: 10mm 12mm !important; min-height: 270mm; background-image: none !important; background-color: #ffffff !important;">
          <div class="dual-voucher-container">
            <div class="dual-voucher-item">
              ${renderSingleVoucher('نسخة العميل')}
            </div>
            <div class="dual-voucher-divider">
              <span>✂️ خط القص والتنقيط (سند مزدوج A4)</span>
            </div>
            <div class="dual-voucher-item">
              ${renderSingleVoucher('نسخة الأرشيف / الإدارة')}
            </div>
          </div>
        </div>
      `;
    } else {
      printArea.innerHTML = `
        <div class="official-letterhead-page${plainClass}${fontClass}${scaleClass}" style="padding: 14mm 16mm !important; background-image: none !important; background-color: #ffffff !important;">
          ${renderSingleVoucher()}
        </div>
      `;
    }

    if (typeof Settings !== 'undefined' && Settings.setPrintTitle) {
      Settings.setPrintTitle(`سند قبض - ${info.receipt_no || ''}`);
    }
    window.print();
  },

  // ================== إدارة العملاء ==================
  openNewClientModal(targetSelectId = null) {
    this._targetClientSelectId = targetSelectId;
    const form = document.getElementById('newClientForm');
    if (form) form.reset();
    App.openModal('newClientModal');
  },

  async submitNewClient(e) {
    if (e) e.preventDefault();
    const nameInput = document.getElementById('clientName');
    const name = nameInput ? nameInput.value.trim() : '';
    const company = document.getElementById('clientCompany') ? document.getElementById('clientCompany').value.trim() : '';
    const phone = document.getElementById('clientPhone') ? document.getElementById('clientPhone').value.trim() : '';
    const email = document.getElementById('clientEmail') ? document.getElementById('clientEmail').value.trim() : '';
    const address = document.getElementById('clientAddress') ? document.getElementById('clientAddress').value.trim() : '';
    const previous_balance = document.getElementById('clientPrevBal') ? document.getElementById('clientPrevBal').value : 0;
    const currency = document.getElementById('clientCurrency')?.value || 'ر.ي';
    const notes = document.getElementById('clientNotes') ? document.getElementById('clientNotes').value.trim() : '';

    if (!name) {
      App.showToast('يرجى إدخال اسم العميل / المستثمر', 'error');
      if (nameInput) nameInput.focus();
      return;
    }

    const form = document.getElementById('newClientForm');
    const submitBtn = form ? form.querySelector('button[type="submit"]') : null;
    const originalBtnHtml = submitBtn ? submitBtn.innerHTML : 'حفظ العميل';

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>⏳</span> جاري الحفظ والتحقق من قاعدة البيانات...';
    }

    try {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, company, phone, email, address, previous_balance, currency, notes
        })
      });
      const data = await res.json();

      if (res.ok && data.success && data.id) {
        // إظهار رسالة النجاح والتأكيد من قاعدة البيانات
        const successMsg = data.message || `تم حفظ العميل (${name}) بنجاح وتأكيده في قاعدة البيانات`;
        App.showToast(successMsg, 'success');
        App.closeModal('newClientModal');
        if (form) form.reset();

        // تحديث القوائم المنسدلة وسجل العملاء والمشاريع
        await this.loadDropdowns();
        if (typeof Projects !== 'undefined' && Projects.loadProjects) {
          Projects.loadProjects();
        }
        if (typeof App !== 'undefined' && App.loadClientsTable) {
          App.loadClientsTable();
        }

        // تحديد العميل المضاف تلقائياً في القائمة الهدف إن وجدت
        if (this._targetClientSelectId) {
          const targetEl = document.getElementById(this._targetClientSelectId);
          if (targetEl && data.id) {
            targetEl.value = String(data.id);
          }
          this._targetClientSelectId = null;
        }
      } else {
        App.showToast(data.message || 'فشل في حفظ العميل في قاعدة البيانات', 'error');
      }
    } catch (e) {
      console.error('Error adding client:', e);
      App.showToast('فشل الاتصال بالخادم أو حفظ العميل في قاعدة البيانات', 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnHtml;
      }
    }
  },

  // ================== إدارة الموردين ==================
  openNewSupplierModal(targetSelectId = null) {
    this._targetSupplierSelectId = targetSelectId;
    const form = document.getElementById('newSupplierForm');
    if (form) form.reset();
    App.openModal('newSupplierModal');
  },

  async submitNewSupplier(e) {
    if (e) e.preventDefault();
    const nameInput = document.getElementById('suppName');
    const name = nameInput ? nameInput.value.trim() : '';
    const category = document.getElementById('suppCategory') ? document.getElementById('suppCategory').value : 'مواد بناء';
    const phone = document.getElementById('suppPhone') ? document.getElementById('suppPhone').value.trim() : '';
    const address = document.getElementById('suppAddress') ? document.getElementById('suppAddress').value.trim() : '';
    const balance = document.getElementById('suppBalance') ? document.getElementById('suppBalance').value : 0;
    const currency = document.getElementById('suppCurrency')?.value || 'ر.ي';
    const notes = document.getElementById('suppNotes') ? document.getElementById('suppNotes').value.trim() : '';

    if (!name) {
      App.showToast('يرجى إدخال اسم المورد', 'error');
      if (nameInput) nameInput.focus();
      return;
    }

    const form = document.getElementById('newSupplierForm');
    const submitBtn = form ? form.querySelector('button[type="submit"]') : null;
    const originalBtnHtml = submitBtn ? submitBtn.innerHTML : 'حفظ المورد';

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>⏳</span> جاري الحفظ والتحقق من قاعدة البيانات...';
    }

    try {
      const res = await fetch('/api/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, category, phone, address, balance, currency, notes
        })
      });
      const data = await res.json();

      if (res.ok && data.success && data.id) {
        const successMsg = data.message || `تم حفظ المورد (${name}) بنجاح وتأكيده في قاعدة البيانات`;
        App.showToast(successMsg, 'success');
        App.closeModal('newSupplierModal');
        if (form) form.reset();

        // تحديث القوائم المنسدلة وسجل الموردين
        await this.loadDropdowns();
        if (typeof App !== 'undefined' && App.loadSuppliersTable) {
          App.loadSuppliersTable();
        }

        // تحديد المورد المضاف تلقائياً في القائمة الهدف إن وجدت
        if (this._targetSupplierSelectId) {
          const targetEl = document.getElementById(this._targetSupplierSelectId);
          if (targetEl && data.id) {
            targetEl.value = String(data.id);
          }
          this._targetSupplierSelectId = null;
        }
      } else {
        App.showToast(data.message || 'فشل في حفظ المورد في قاعدة البيانات', 'error');
      }
    } catch (e) {
      console.error('Error adding supplier:', e);
      App.showToast('فشل الاتصال بالخادم أو حفظ المورد في قاعدة البيانات', 'error');
    } finally {
    }
  },

  // ================== إدارة قيود اليومية العامة (Journal Entries) ==================

  injectPeriodAndAuditButtons() {
    const actions = document.getElementById('journalHeaderActions');
    if (!actions) return;
    if (!document.getElementById('btnJournalPeriods')) {
      const pBtn = document.createElement('button');
      pBtn.id = 'btnJournalPeriods';
      pBtn.className = 'btn btn-warning';
      pBtn.title = 'إدارة وإغلاق الفترات المحاسبية';
      pBtn.innerHTML = '<span>🔒 الفترات المحاسبية</span>';
      pBtn.onclick = () => Accounting.openPeriodsModal();
      actions.insertBefore(pBtn, actions.firstChild);
    }
    if (!document.getElementById('btnJournalAuditLog')) {
      const aBtn = document.createElement('button');
      aBtn.id = 'btnJournalAuditLog';
      aBtn.className = 'btn btn-info';
      aBtn.title = 'سجل التدقيق والرقابة المالية';
      aBtn.innerHTML = '<span>📜 سجل التدقيق</span>';
      aBtn.onclick = () => Accounting.openAuditLogModal();
      const pBtn = document.getElementById('btnJournalPeriods');
      if (pBtn && pBtn.nextSibling) {
        actions.insertBefore(aBtn, pBtn.nextSibling);
      } else {
        actions.appendChild(aBtn);
      }
    }
  },

  async loadJournalEntries() {
    this.injectPeriodAndAuditButtons();
    try {
      const res = await fetch('/api/accounting/journal-entries');
      const data = await res.json();
      if (data.success) {
        this.journalEntries = data.data || [];
        this.renderJournalTable(this.journalEntries);
        this.updateJournalKPIs(this.journalEntries);
      }
    } catch (e) {
      console.error('Error loading journal entries:', e);
      App.showToast('فشل تحميل قيود اليومية', 'error');
    }
  },

  updateJournalKPIs(entries) {
    const countEl = document.getElementById('journalKpiCount');
    const debitEl = document.getElementById('journalKpiDebit');
    const creditEl = document.getElementById('journalKpiCredit');
    const balEl = document.getElementById('journalKpiBalance');

    const totalDebit = entries.reduce((s, e) => s + (Number(e.total_debit) || 0), 0);
    const totalCredit = entries.reduce((s, e) => s + (Number(e.total_credit) || 0), 0);

    if (countEl) countEl.textContent = entries.length;
    if (debitEl) debitEl.textContent = App.formatNumber(totalDebit);
    if (creditEl) creditEl.textContent = App.formatNumber(totalCredit);
    if (balEl) {
      const diff = Math.abs(totalDebit - totalCredit);
      if (diff < 0.01) {
        balEl.textContent = 'متزن 100%';
        balEl.style.color = 'var(--accent-green)';
      } else {
        balEl.textContent = `فارق: ${App.formatNumber(diff)}`;
        balEl.style.color = 'var(--accent-red)';
      }
    }
  },

  renderJournalTable(entries) {
    const tbody = document.getElementById('fullJournalTableBody');
    if (!tbody) return;

    if (!entries || entries.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 25px; color: var(--text-secondary);">لا توجد قيود يومية مسجلة حتى الآن</td></tr>`;
      return;
    }

    tbody.innerHTML = entries.map(je => `
      <tr>
        <td><strong>${je.entry_no}</strong></td>
        <td>${je.date}</td>
        <td>${je.description || '-'}</td>
        <td><span class="badge ${je.reference_type === 'يدوي' ? 'badge-info' : 'badge-active'}">${je.reference_type || 'يدوي'} ${je.reference_no ? '(' + je.reference_no + ')' : ''}</span></td>
        <td style="color: var(--accent-green); font-weight: bold;">${App.formatNumber(je.total_debit)} ${je.currency || 'ر.ي'}</td>
        <td style="color: #38bdf8; font-weight: bold;">${App.formatNumber(je.total_credit)} ${je.currency || 'ر.ي'}</td>
        <td style="text-align: center;">
          <div style="display: flex; gap: 6px; justify-content: center;">
            <button class="btn btn-sm btn-secondary" onclick="Accounting.viewJournalDetails(${je.id})" title="عرض تفاصيل وسطور القيد">👁️ تفاصيل</button>
            <button class="btn btn-sm btn-primary" onclick="Accounting.printJournalEntryById(${je.id})" title="طباعة سند القيد الرسمي">🖨️ طباعة</button>
          </div>
        </td>
      </tr>
    `).join('');
  },

  filterJournalTable() {
    const query = document.getElementById('journalSearchInput')?.value?.toLowerCase()?.trim() || '';
    const refFilter = document.getElementById('journalRefFilter')?.value || '';

    const filtered = this.journalEntries.filter(je => {
      const matchQuery = !query || 
        (je.entry_no && je.entry_no.toLowerCase().includes(query)) ||
        (je.description && je.description.toLowerCase().includes(query)) ||
        (je.reference_no && je.reference_no.toLowerCase().includes(query));

      const matchRef = !refFilter || je.reference_type === refFilter;
      return matchQuery && matchRef;
    });

    this.renderJournalTable(filtered);
  },

  async openNewJournalModal() {
    if (!this.accounts || !this.accounts.length || !this.costCenters || !this.costCenters.length) {
      await this.loadDropdowns();
    }
    const form = document.getElementById('modalJournalForm');
    if (form) form.reset();
    const dateInput = document.getElementById('modalJeDate');
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];

    // تفريغ جدول الأسطر وإضافة سطرين افتراضيين (طرف مدين وطرف دائن)
    const tbody = document.getElementById('journalLinesTableBody');
    if (tbody) {
      tbody.innerHTML = '';
      this.addJournalRow(); // السطر الأول
      this.addJournalRow(); // السطر الثاني
    }
    this.calcJournalBalance();
    App.openModal('newJournalModal');
  },

  addJournalRow(data = {}) {
    const tbody = document.getElementById('journalLinesTableBody');
    if (!tbody) return;

    const rowId = 'je_row_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    const tr = document.createElement('tr');
    tr.id = rowId;
    tr.className = 'journal-line-row';

    const accountOptions = this.accounts.map(a => 
      `<option value="${a.id}" ${data.account_id == a.id ? 'selected' : ''}>${a.code || a.account_code} - ${a.name || a.account_name}</option>`
    ).join('');

    const ccOptions = this.costCenters.map(cc => 
      `<option value="${cc.id}" ${data.cost_center_id == cc.id ? 'selected' : ''}>${cc.code} - ${cc.name}</option>`
    ).join('');

    tr.innerHTML = `
      <td>
        <select class="form-control je-line-account" required style="font-size: 0.85rem;">
          <option value="">اختر الحساب...</option>
          ${accountOptions}
        </select>
      </td>
      <td>
        <select class="form-control je-line-costcenter" style="font-size: 0.85rem;">
          <option value="">مركز التكلفة (اختياري)...</option>
          ${ccOptions}
        </select>
      </td>
      <td>
        <input type="number" class="form-control je-line-debit" value="${data.debit || 0}" min="0" step="any" placeholder="0.00" oninput="Accounting.calcJournalBalance()" style="font-weight: bold; color: var(--accent-green); text-align: left; direction: ltr;">
      </td>
      <td>
        <input type="number" class="form-control je-line-credit" value="${data.credit || 0}" min="0" step="any" placeholder="0.00" oninput="Accounting.calcJournalBalance()" style="font-weight: bold; color: #38bdf8; text-align: left; direction: ltr;">
      </td>
      <td>
        <input type="text" class="form-control je-line-desc" value="${data.description || ''}" placeholder="بيان السطر...">
      </td>
      <td style="text-align: center;">
        <button type="button" class="btn btn-sm btn-danger" onclick="Accounting.removeJournalRow('${rowId}')" title="حذف السطر" style="padding: 2px 8px;">✕</button>
      </td>
    `;

    tbody.appendChild(tr);
    this.calcJournalBalance();
  },

  removeJournalRow(rowId) {
    const tbody = document.getElementById('journalLinesTableBody');
    if (!tbody) return;
    const rows = tbody.querySelectorAll('tr');
    if (rows.length <= 2) {
      App.showToast('يجب أن يحتوي القيد المحاسبي على طرفين على الأقل (مدين ودائن)', 'error');
      return;
    }
    const tr = document.getElementById(rowId);
    if (tr) tr.remove();
    this.calcJournalBalance();
  },

  calcJournalBalance() {
    const rows = document.querySelectorAll('#journalLinesTableBody tr');
    let totalDebit = 0;
    let totalCredit = 0;

    rows.forEach(r => {
      const debitInput = r.querySelector('.je-line-debit');
      const creditInput = r.querySelector('.je-line-credit');
      const debitVal = Number(debitInput?.value) || 0;
      const creditVal = Number(creditInput?.value) || 0;
      totalDebit += debitVal;
      totalCredit += creditVal;
    });

    const diff = Math.round(Math.abs(totalDebit - totalCredit) * 100) / 100;
    const isBalanced = totalDebit > 0 && diff === 0;

    const totDebEl = document.getElementById('modalJeTotalDebit');
    const totCredEl = document.getElementById('modalJeTotalCredit');
    const diffEl = document.getElementById('modalJeDiff');
    const statusEl = document.getElementById('modalJeBalanceStatus');
    const submitBtn = document.getElementById('btnSubmitJournal');

    if (totDebEl) totDebEl.textContent = App.formatNumber(totalDebit);
    if (totCredEl) totCredEl.textContent = App.formatNumber(totalCredit);
    if (diffEl) diffEl.textContent = App.formatNumber(diff);

    if (statusEl) {
      if (isBalanced) {
        statusEl.innerHTML = '✅ القيد متزن وجاهز للحفظ';
        statusEl.style.background = 'rgba(34, 197, 94, 0.15)';
        statusEl.style.color = '#4ade80';
      } else {
        statusEl.innerHTML = `⚠️ القيد غير متزن (الفارق: ${App.formatNumber(diff)})`;
        statusEl.style.background = 'rgba(239, 68, 68, 0.15)';
        statusEl.style.color = '#f87171';
      }
    }

    if (submitBtn) {
      submitBtn.disabled = !isBalanced;
    }
  },

  autoBalanceJournal() {
    const rows = document.querySelectorAll('#journalLinesTableBody tr');
    if (rows.length < 2) return;

    let totalDebit = 0;
    let totalCredit = 0;

    // حساب المجاميع باستثناء السطر الأخير
    for (let i = 0; i < rows.length - 1; i++) {
      const d = Number(rows[i].querySelector('.je-line-debit')?.value) || 0;
      const c = Number(rows[i].querySelector('.je-line-credit')?.value) || 0;
      totalDebit += d;
      totalCredit += c;
    }

    const lastRow = rows[rows.length - 1];
    const lastDebit = lastRow.querySelector('.je-line-debit');
    const lastCredit = lastRow.querySelector('.je-line-credit');

    if (totalDebit > totalCredit) {
      // الطرف الدائن يحتاج للفرق
      lastDebit.value = 0;
      lastCredit.value = totalDebit - totalCredit;
    } else if (totalCredit > totalDebit) {
      // الطرف المدين يحتاج للفرق
      lastCredit.value = 0;
      lastDebit.value = totalCredit - totalDebit;
    }

    this.calcJournalBalance();
    App.showToast('تمت الموازنة التلقائية للسطر الأخير', 'success');
  },

  async submitJournalEntryModal(e) {
    if (e) e.preventDefault();
    const date = document.getElementById('modalJeDate').value;
    const currency = document.getElementById('modalJeCurrency')?.value || 'ر.ي';
    const description = document.getElementById('modalJeDescription').value.trim();

    if (!description) {
      App.showToast('يرجى كتابة البيان العام للقيد', 'error');
      return;
    }

    const rows = document.querySelectorAll('#journalLinesTableBody tr');
    if (rows.length < 2) {
      App.showToast('يجب تسجيل سطرين على الأقل (طرف مدين وطرف دائن)', 'error');
      return;
    }

    const lines = [];
    let totalDebit = 0;
    let totalCredit = 0;
    let hasInvalidAccount = false;

    rows.forEach(r => {
      const account_id = r.querySelector('.je-line-account')?.value;
      const cost_center_id = r.querySelector('.je-line-costcenter')?.value || null;
      const debit = Number(r.querySelector('.je-line-debit')?.value) || 0;
      const credit = Number(r.querySelector('.je-line-credit')?.value) || 0;
      const lineDesc = r.querySelector('.je-line-desc')?.value?.trim() || '';

      if (!account_id) {
        hasInvalidAccount = true;
      }

      if (debit > 0 || credit > 0) {
        lines.push({
          account_id,
          cost_center_id,
          debit,
          credit,
          description: lineDesc
        });
        totalDebit += debit;
        totalCredit += credit;
      }
    });

    if (hasInvalidAccount) {
      App.showToast('يرجى اختيار الحساب المالي لجميع أسطر القيد', 'error');
      return;
    }

    if (lines.length < 2) {
      App.showToast('يجب أن يتضمن القيد سطرين فعليين بمبالغ مالية على الأقل', 'error');
      return;
    }

    const diff = Math.round(Math.abs(totalDebit - totalCredit) * 100) / 100;
    if (diff !== 0 || totalDebit <= 0) {
      App.showToast(`القيد غير متزن! إجمالي المدين: ${totalDebit}، إجمالي الدائن: ${totalCredit}`, 'error');
      return;
    }

    const submitBtn = document.getElementById('btnSubmitJournal');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'جاري حفظ القيد في دفتر اليومية...';
    }

    try {
      const res = await fetch('/api/accounting/journal-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          currency,
          description,
          lines
        })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(`تم حفظ القيد اليومي بنجاح (${data.entry_no})`, 'success');
        App.closeModal('newJournalModal');
        await this.loadJournalEntries();
        if (confirm(`تم إنشاء قيد اليومية ${data.entry_no}. هل تريد استعراض وسند الطباعة الآن؟`)) {
          this.viewJournalDetails(data.id);
        }
      } else {
        App.showToast(data.message || 'فشل حفظ القيد اليومي', 'error');
      }
    } catch (e) {
      console.error('Error saving journal entry:', e);
      App.showToast('فشل الاتصال بالخادم', 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'حفظ القيد اليومي المتزن';
      }
    }
  },

  async viewJournalDetails(id) {
    try {
      const res = await fetch(`/api/accounting/journal-entries/${id}`);
      const data = await res.json();
      if (data.success && data.data) {
        const je = data.data;
        this.currentJournalEntry = je;

        const titleEl = document.getElementById('viewJeTitle');
        if (titleEl) titleEl.textContent = `تفاصيل قيد اليومية: ${je.entry_no}`;

        const contentEl = document.getElementById('viewJeContent');
        if (contentEl) {
          contentEl.innerHTML = `
            <div style="background: rgba(15, 23, 42, 0.5); padding: 14px; border-radius: 8px; border: 1px solid var(--border-color); margin-bottom: 14px;">
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px;">
                <div><span style="color: var(--text-secondary); font-size: 0.8rem;">رقم القيد:</span> <strong style="color: var(--gold-light);">${je.entry_no}</strong></div>
                <div><span style="color: var(--text-secondary); font-size: 0.8rem;">التاريخ:</span> <strong>${je.date}</strong></div>
                <div><span style="color: var(--text-secondary); font-size: 0.8rem;">العملة:</span> <strong>${je.currency || 'ر.ي'}</strong></div>
                <div><span style="color: var(--text-secondary); font-size: 0.8rem;">المرجع:</span> <strong>${je.reference_type || 'يدوي'} ${je.reference_no ? '(' + je.reference_no + ')' : ''}</strong></div>
              </div>
              <div style="margin-top: 10px; padding-top: 8px; border-top: 1px dashed rgba(255,255,255,0.1);">
                <span style="color: var(--text-secondary); font-size: 0.8rem;">البيان العام:</span> <strong>${je.description || '-'}</strong>
              </div>
            </div>

            <div class="table-responsive">
              <table class="custom-table" style="margin-bottom: 0;">
                <thead>
                  <tr>
                    <th>رقم الحساب</th>
                    <th>اسم الحساب المالي</th>
                    <th>مركز التكلفة</th>
                    <th style="color: var(--accent-green);">مدين (منه)</th>
                    <th style="color: #38bdf8;">دائن (له)</th>
                    <th>البيان والملاحظات</th>
                  </tr>
                </thead>
                <tbody>
                  ${(je.lines || []).map(l => `
                    <tr>
                      <td style="font-family: monospace;">${l.account_code || '-'}</td>
                      <td><strong>${l.account_name || '-'}</strong></td>
                      <td>${l.cost_center_name ? `<span class="badge badge-info">${l.cost_center_code ? l.cost_center_code + ' - ' : ''}${l.cost_center_name}</span>` : '-'}</td>
                      <td style="color: var(--accent-green); font-weight: bold; text-align: left; direction: ltr;">${Number(l.debit) > 0 ? App.formatNumber(l.debit) : '-'}</td>
                      <td style="color: #38bdf8; font-weight: bold; text-align: left; direction: ltr;">${Number(l.credit) > 0 ? App.formatNumber(l.credit) : '-'}</td>
                      <td>${l.description || '-'}</td>
                    </tr>
                  `).join('')}
                </tbody>
                <tfoot>
                  <tr style="background: #1e293b; font-weight: bold;">
                    <td colspan="3" style="text-align: left;">المجموع الكلي:</td>
                    <td style="color: var(--accent-green); font-size: 1.05rem; text-align: left; direction: ltr;">${App.formatNumber(je.total_debit)}</td>
                    <td style="color: #38bdf8; font-size: 1.05rem; text-align: left; direction: ltr;">${App.formatNumber(je.total_credit)}</td>
                    <td style="color: var(--accent-green); text-align: center;">متزن 100%</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          `;
        }
        App.openModal('viewJournalModal');
      }
    } catch (e) {
      console.error('Error fetching journal details:', e);
      App.showToast('فشل جلب تفاصيل القيد', 'error');
    }
  },

  async printJournalEntryById(id) {
    try {
      const res = await fetch(`/api/accounting/journal-entries/${id}`);
      const data = await res.json();
      if (data.success && data.data) {
        this.currentJournalEntry = data.data;
        this.printCurrentJournalEntry();
      }
    } catch (e) {
      App.showToast('فشل تجهيز طباعة القيد', 'error');
    }
  },

  printCurrentJournalEntry() {
    const je = this.currentJournalEntry;
    if (!je) {
      App.showToast('لا يوجد قيد محدد للطباعة', 'error');
      return;
    }

    const printArea = document.getElementById('printArea');
    if (!printArea) return;

    const words = this.tafqeet(je.total_debit, je.currency);

    printArea.innerHTML = `
      <div class="official-letterhead-page font-cairo" style="padding: 14mm 16mm !important; background: #ffffff !important;">
        <div class="letterhead-content-wrap">
          <div>
            <div class="letterhead-doc-header" style="border-bottom-color: #2563eb;">
              <div class="letterhead-doc-title-badge" style="background: linear-gradient(135deg, #1e3a8a, #2563eb); border-right-color: #3b82f6;">
                سـنـد قـيـد يـومـيـة عـام
              </div>
              <div class="letterhead-doc-meta">
                <div class="letterhead-doc-meta-item">رقم القيد: <strong>${je.entry_no}</strong></div>
                <div class="letterhead-doc-meta-item">التاريخ: <strong>${je.date}</strong></div>
                <div class="letterhead-doc-meta-item">المرجع: <strong>${je.reference_type || 'يدوي'} ${je.reference_no ? '(' + je.reference_no + ')' : ''}</strong></div>
              </div>
            </div>

            <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px 14px; margin: 12px 0;">
              <strong>البيان العام: </strong> <span>${je.description || '-'}</span>
            </div>

            <table class="custom-table" style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 0.85rem;">
              <thead>
                <tr style="background: #f1f5f9; color: #1e293b; border-bottom: 2px solid #94a3b8;">
                  <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: center; width: 12%;">رقم الحساب</th>
                  <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: right; width: 25%;">اسم الحساب</th>
                  <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: right; width: 18%;">مركز التكلفة</th>
                  <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: center; width: 13%;">مدين (منه)</th>
                  <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: center; width: 13%;">دائن (له)</th>
                  <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: right; width: 19%;">البيان</th>
                </tr>
              </thead>
              <tbody>
                ${(je.lines || []).map(l => `
                  <tr>
                    <td style="padding: 6px 8px; border: 1px solid #cbd5e1; text-align: center; font-family: monospace;">${l.account_code || '-'}</td>
                    <td style="padding: 6px 8px; border: 1px solid #cbd5e1; text-align: right; font-weight: bold;">${l.account_name || '-'}</td>
                    <td style="padding: 6px 8px; border: 1px solid #cbd5e1; text-align: right;">${l.cost_center_name || '-'}</td>
                    <td style="padding: 6px 8px; border: 1px solid #cbd5e1; text-align: left; direction: ltr; font-weight: bold; color: #047857;">${Number(l.debit) > 0 ? App.formatNumber(l.debit) : '-'}</td>
                    <td style="padding: 6px 8px; border: 1px solid #cbd5e1; text-align: left; direction: ltr; font-weight: bold; color: #0369a1;">${Number(l.credit) > 0 ? App.formatNumber(l.credit) : '-'}</td>
                    <td style="padding: 6px 8px; border: 1px solid #cbd5e1; text-align: right;">${l.description || '-'}</td>
                  </tr>
                `).join('')}
              </tbody>
              <tfoot>
                <tr style="background: #e2e8f0; font-weight: bold;">
                  <td colspan="3" style="padding: 8px; border: 1px solid #94a3b8; text-align: left;">الإجمالي المتزن:</td>
                  <td style="padding: 8px; border: 1px solid #94a3b8; text-align: left; direction: ltr; color: #047857;">${App.formatNumber(je.total_debit)}</td>
                  <td style="padding: 8px; border: 1px solid #94a3b8; text-align: left; direction: ltr; color: #0369a1;">${App.formatNumber(je.total_credit)}</td>
                  <td style="padding: 8px; border: 1px solid #94a3b8; text-align: center;">${je.currency || 'ر.ي'}</td>
                </tr>
              </tfoot>
            </table>

            <div style="margin-top: 10px; font-size: 0.85rem; color: #475569;">
              <strong>المبلغ كتابة: </strong> فقط: ${words} لا غير.
            </div>
          </div>

          <div style="margin-top: 40px;">
            <div class="letterhead-signatures-row">
              <div class="letterhead-sig-col">
                <div class="letterhead-sig-label">إعداد المحاسب</div>
                <div class="letterhead-sig-dots">التوقيع: ........................</div>
              </div>
              <div class="letterhead-sig-col">
                <div class="letterhead-sig-label">المراجعة والتدقيق</div>
                <div class="letterhead-sig-dots">المراجع: ........................</div>
              </div>
              <div class="letterhead-sig-col">
                <div class="letterhead-sig-label">اعتماد المدير المالي / الإدارة</div>
                <div class="letterhead-sig-dots">الاعتماد: ........................</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    if (typeof Settings !== 'undefined' && Settings.setPrintTitle) {
      Settings.setPrintTitle(`قيد يومية - ${je.entry_no}`);
    }
    window.print();
  },

  // ================== إدارة تبويبات الحسابات الشاملة (Journal & Accounts Hub) ==================
  switchJournalTab(tabId) {
    this.activeJournalTab = tabId;
    ['journalEntries', 'chartOfAccounts', 'costCenters', 'currencies'].forEach(t => {
      const btn = document.getElementById(`tabBtn_${t}`);
      const pane = document.getElementById(`pane_${t}`);
      if (btn) btn.classList.toggle('active', t === tabId);
      if (pane) pane.style.display = (t === tabId) ? 'block' : 'none';
    });

    const actionBtn = document.getElementById('btnNewJournalAction');
    if (actionBtn) {
      if (tabId === 'journalEntries') {
        actionBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg><span>إضافة قيد يومية جديد +</span>`;
        actionBtn.setAttribute('onclick', 'Accounting.openNewJournalModal()');
      } else if (tabId === 'chartOfAccounts') {
        actionBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg><span>إضافة حساب مالي جديد +</span>`;
        actionBtn.setAttribute('onclick', 'Accounting.openNewAccountModal()');
      } else if (tabId === 'costCenters') {
        actionBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg><span>إضافة مركز تكلفة +</span>`;
        actionBtn.setAttribute('onclick', 'Accounting.openNewCostCenterModal()');
      } else if (tabId === 'currencies') {
        actionBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg><span>إضافة عملة جديدة +</span>`;
        actionBtn.setAttribute('onclick', 'Accounting.openNewCurrencyModal()');
      }
    }

    if (tabId === 'journalEntries') {
      this.loadJournalEntries();
    } else if (tabId === 'chartOfAccounts') {
      this.loadChartOfAccounts();
    } else if (tabId === 'costCenters') {
      this.loadCostCentersTable();
    } else if (tabId === 'currencies') {
      this.loadCurrenciesTable();
    }
  },

  refreshCurrentJournalTab() {
    if (this.activeJournalTab === 'chartOfAccounts') {
      this.loadChartOfAccounts();
    } else if (this.activeJournalTab === 'costCenters') {
      this.loadCostCentersTable();
    } else if (this.activeJournalTab === 'currencies') {
      this.loadCurrenciesTable();
    } else {
      this.loadJournalEntries();
    }
  },

  // 1. دليل الحسابات الشجري
  async loadChartOfAccounts() {
    try {
      const res = await fetch('/api/accounting/accounts');
      const json = await res.json();
      if (json.success) {
        this.accounts = json.data || [];
        this.renderAccountsTable(this.accounts);
      }
    } catch (e) {
      console.error('Error loading accounts:', e);
      App.showToast('فشل تحميل دليل الحسابات', 'error');
    }
  },

  renderAccountsTable(accounts) {
    const tbody = document.getElementById('chartOfAccountsTableBody');
    if (!tbody) return;

    if (!accounts || accounts.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-secondary); padding: 20px;">لا توجد حسابات مسجلة في الدليل</td></tr>`;
      return;
    }

    const typeBadges = {
      'أصول': 'background: rgba(56,189,248,0.15); color: #38bdf8; border: 1px solid rgba(56,189,248,0.3);',
      'خصوم': 'background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.3);',
      'حقوق ملكية': 'background: rgba(168,85,247,0.15); color: #c084fc; border: 1px solid rgba(168,85,247,0.3);',
      'إيرادات': 'background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid rgba(16,185,129,0.3);',
      'مصروفات': 'background: rgba(245,158,11,0.15); color: #f59e0b; border: 1px solid rgba(245,158,11,0.3);',
      'تكاليف': 'background: rgba(249,115,22,0.15); color: #fb923c; border: 1px solid rgba(249,115,22,0.3);'
    };

    tbody.innerHTML = accounts.map(a => `
      <tr>
        <td style="font-family: monospace; font-weight: bold; color: var(--gold-light);">${a.code || a.account_code}</td>
        <td><strong>${a.name || a.account_name}</strong></td>
        <td><span class="badge" style="${typeBadges[a.type || a.account_type] || 'background: #334155; color: #fff;'}">${a.type || a.account_type}</span></td>
        <td style="color: var(--text-secondary);">${a.parent_code || a.parent_id || '-'}</td>
        <td style="font-weight: bold; font-family: monospace; direction: ltr; text-align: left;">${App.formatNumber(a.current_balance || a.balance || 0)} ر.ي</td>
        <td style="text-align: center;"><span class="badge badge-active">نشط</span></td>
      </tr>
    `).join('');
  },

  filterAccountsTable() {
    const q = document.getElementById('accountSearchInput')?.value?.toLowerCase()?.trim() || '';
    const filtered = (this.accounts || []).filter(a => {
      const code = String(a.code || a.account_code || '').toLowerCase();
      const name = String(a.name || a.account_name || '').toLowerCase();
      const type = String(a.type || a.account_type || '').toLowerCase();
      return !q || code.includes(q) || name.includes(q) || type.includes(q);
    });
    this.renderAccountsTable(filtered);
  },

  openNewAccountModal() {
    const c = document.getElementById('modalAccCode');
    const n = document.getElementById('modalAccName');
    const t = document.getElementById('modalAccType');
    const p = document.getElementById('modalAccParent');
    const b = document.getElementById('modalAccBalance');
    if (c) c.value = '';
    if (n) n.value = '';
    if (t) t.value = 'أصول';
    if (p) p.value = '';
    if (b) b.value = '0';
    App.openModal('accountModal');
  },

  async submitNewAccount(e) {
    if (e) e.preventDefault();
    const code = document.getElementById('modalAccCode')?.value?.trim();
    const name = document.getElementById('modalAccName')?.value?.trim();
    const type = document.getElementById('modalAccType')?.value?.trim();
    const parent = document.getElementById('modalAccParent')?.value?.trim() || null;
    const balance = parseFloat(document.getElementById('modalAccBalance')?.value) || 0;

    if (!code || !name || !type) {
      App.showToast('يرجى ملء جميع الحقول المطلوبة', 'error');
      return;
    }

    try {
      const res = await fetch('/api/accounting/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, name, type, parent_code: parent, balance })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(`تمت إضافة الحساب [${code} - ${name}] بنجاح`, 'success');
        App.closeModal('accountModal');
        await this.loadChartOfAccounts();
        await this.loadDropdowns();
      } else {
        App.showToast(data.message || 'فشل حفظ الحساب', 'error');
      }
    } catch (err) {
      console.error(err);
      App.showToast('خطأ أثناء حفظ الحساب', 'error');
    }
  },

  // 2. مراكز التكلفة للمشاريع والعمليات
  async loadCostCentersTable() {
    try {
      const res = await fetch('/api/accounting/cost-centers');
      const json = await res.json();
      if (json.success) {
        this.costCenters = json.data || [];
        this.renderCostCentersTable(this.costCenters);
      }
    } catch (e) {
      console.error('Error loading cost centers:', e);
      App.showToast('فشل تحميل مراكز التكلفة', 'error');
    }
  },

  renderCostCentersTable(items) {
    const tbody = document.getElementById('costCentersTableBody');
    if (!tbody) return;

    if (!items || items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-secondary); padding: 20px;">لا توجد مراكز تكلفة مسجلة</td></tr>`;
      return;
    }

    tbody.innerHTML = items.map(c => `
      <tr>
        <td style="font-family: monospace; font-weight: bold; color: var(--gold-light);">${c.code}</td>
        <td><strong>${c.name}</strong></td>
        <td><span class="badge badge-info">${c.type || 'مشروع'}</span></td>
        <td>${c.project_name ? `<strong>${c.project_name}</strong>` : '<span style="color: var(--text-secondary);">عام</span>'}</td>
        <td style="color: var(--text-secondary);">${c.notes || '-'}</td>
      </tr>
    `).join('');
  },

  filterCostCentersTable() {
    const q = document.getElementById('costCenterSearchInput')?.value?.toLowerCase()?.trim() || '';
    const filtered = (this.costCenters || []).filter(c => {
      const code = String(c.code || '').toLowerCase();
      const name = String(c.name || '').toLowerCase();
      const proj = String(c.project_name || '').toLowerCase();
      return !q || code.includes(q) || name.includes(q) || proj.includes(q);
    });
    this.renderCostCentersTable(filtered);
  },

  openNewCostCenterModal() {
    const c = document.getElementById('modalCcCode');
    const n = document.getElementById('modalCcName');
    const t = document.getElementById('modalCcType');
    const notes = document.getElementById('modalCcNotes');
    if (c) c.value = '';
    if (n) n.value = '';
    if (t) t.value = 'مشروع';
    if (notes) notes.value = '';

    const pSel = document.getElementById('modalCcProjectSelect');
    if (pSel && Array.isArray(this.projects)) {
      pSel.innerHTML = '<option value="">بدون مشروع (عام)...</option>' +
        this.projects.map(p => `<option value="${p.id}">${p.code ? p.code + ' - ' : ''}${p.name}</option>`).join('');
    }

    App.openModal('costCenterModal');
  },

  async submitNewCostCenter(e) {
    if (e) e.preventDefault();
    const code = document.getElementById('modalCcCode')?.value?.trim();
    const name = document.getElementById('modalCcName')?.value?.trim();
    const type = document.getElementById('modalCcType')?.value?.trim() || 'مشروع';
    const project_id = document.getElementById('modalCcProjectSelect')?.value || null;
    const notes = document.getElementById('modalCcNotes')?.value?.trim() || null;

    if (!name) {
      App.showToast('يرجى كتابة اسم مركز التكلفة', 'error');
      return;
    }

    try {
      const res = await fetch('/api/accounting/cost-centers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, name, type, project_id, notes })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(`تمت إضافة مركز التكلفة [${data.data?.code || ''} ${name}] بنجاح`, 'success');
        App.closeModal('costCenterModal');
        await this.loadCostCentersTable();
        await this.loadDropdowns();
      } else {
        App.showToast(data.message || 'فشل حفظ مركز التكلفة', 'error');
      }
    } catch (err) {
      console.error(err);
      App.showToast('خطأ أثناء حفظ مركز التكلفة', 'error');
    }
  },

  // 3. تهيئة العملات وأسعار الصرف
  async loadCurrenciesTable() {
    try {
      const res = await fetch('/api/accounting/currencies');
      const json = await res.json();
      if (json.success) {
        this.currencies = json.data || [];
        this.renderCurrenciesTable(this.currencies);
      }
    } catch (e) {
      console.error('Error loading currencies:', e);
      App.showToast('فشل تحميل جدول العملات', 'error');
    }
  },

  renderCurrenciesTable(items) {
    const tbody = document.getElementById('currenciesTableBody');
    if (!tbody) return;

    if (!items || items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-secondary); padding: 20px;">لا توجد عملات مهيأة</td></tr>`;
      return;
    }

    tbody.innerHTML = items.map(c => `
      <tr>
        <td style="font-family: monospace; font-weight: bold; color: var(--gold-light);">${c.code}</td>
        <td><strong>${c.name}</strong></td>
        <td style="font-weight: bold;">${c.symbol || '-'}</td>
        <td style="font-family: monospace; font-weight: bold; color: var(--accent-green); font-size: 1.05rem; direction: ltr; text-align: left;">
          ${Number(c.exchange_rate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} YER
        </td>
        <td>${c.is_default ? '<span class="badge badge-active">عملة الأساس الرئيسية (1.0)</span>' : '<span class="badge badge-info">عملة أجنبية</span>'}</td>
        <td style="text-align: center;">
          ${c.is_default ? '<span style="color: var(--text-secondary); font-size: 0.8rem;">أساس (ثابت)</span>' : `
            <button class="btn btn-sm btn-secondary" onclick="Accounting.quickUpdateCurrencyRate(${c.id}, ${c.exchange_rate})" title="تعديل سعر الصرف اليومي">
              ✏️ تحديث السعر
            </button>
          `}
        </td>
      </tr>
    `).join('');
  },

  openNewCurrencyModal() {
    const c = document.getElementById('modalCurrCode');
    const n = document.getElementById('modalCurrName');
    const s = document.getElementById('modalCurrSymbol');
    const r = document.getElementById('modalCurrRate');
    if (c) c.value = '';
    if (n) n.value = '';
    if (s) s.value = '';
    if (r) r.value = '1.0';
    App.openModal('currencyModal');
  },

  async submitNewCurrency(e) {
    if (e) e.preventDefault();
    const code = document.getElementById('modalCurrCode')?.value?.trim()?.toUpperCase();
    const name = document.getElementById('modalCurrName')?.value?.trim();
    const symbol = document.getElementById('modalCurrSymbol')?.value?.trim();
    const exchange_rate = parseFloat(document.getElementById('modalCurrRate')?.value) || 1.0;

    if (!code || !name) {
      App.showToast('يرجى ملء كود واسم العملة', 'error');
      return;
    }

    try {
      const res = await fetch('/api/accounting/currencies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, name, symbol, exchange_rate })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(`تمت إضافة العملة [${code} - ${name}] بنجاح`, 'success');
        App.closeModal('currencyModal');
        await this.loadCurrenciesTable();
      } else {
        App.showToast(data.message || 'فشل حفظ العملة', 'error');
      }
    } catch (err) {
      console.error(err);
      App.showToast('خطأ أثناء حفظ العملة', 'error');
    }
  },

  async quickUpdateCurrencyRate(id, currentRate) {
    const newRateStr = prompt(`أدخل سعر الصرف الجديد مقابل الريال اليمني (YER):\nالسعر الحالي: ${currentRate}`, currentRate);
    if (!newRateStr) return;
    const rate = parseFloat(newRateStr);
    if (isNaN(rate) || rate <= 0) {
      App.showToast('سعر الصرف غير صحيح', 'error');
      return;
    }

    try {
      const res = await fetch(`/api/accounting/currencies/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exchange_rate: rate })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast('تم تحديث سعر الصرف بنجاح', 'success');
        await this.loadCurrenciesTable();
      } else {
        App.showToast(data.message || 'فشل التحديث', 'error');
      }
    } catch (e) {
      console.error(e);
      App.showToast('خطأ أثناء التحديث', 'error');
    }
  },

  // أسماء مستعارة لتوافق التنقل والشاشات
  loadAccounts() {
    return this.loadChartOfAccounts();
  },

  loadCostCenters() {
    return this.loadCostCentersTable();
  },

  loadCurrencies() {
    return this.loadCurrenciesTable();
  },

  // ================== إدارة الفترات المحاسبية وإغلاق الحسابات ==================
  async openPeriodsModal() {
    let modal = document.getElementById('accountingPeriodsModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'accountingPeriodsModal';
      modal.className = 'modal';
      modal.innerHTML = `
        <div class="modal-dialog modal-lg" style="max-width: 850px;">
          <div class="modal-content">
            <div class="modal-header">
              <h3 class="modal-title" style="display: flex; align-items: center; gap: 8px;">
                <span>🔒 إدارة الفترات المحاسبية وإغلاق الدفاتر</span>
              </h3>
              <button type="button" class="btn-close" onclick="App.closeModal('accountingPeriodsModal')">✕</button>
            </div>
            <div class="modal-body">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; flex-wrap: wrap; gap: 10px;">
                <p style="color: var(--text-secondary); margin: 0; font-size: 0.88rem;">
                  إغلاق الفترات يمنع تسجيل أو تعديل أي قيد أو سند مالي بتاريخ مغلق لحماية الحسابات من التلاعب.
                </p>
                <button class="btn btn-sm btn-primary" onclick="Accounting.showNewPeriodForm()">+ إضافة فترة جديدة</button>
              </div>

              <!-- نموذج إضافة فترة جديدة (مخفي افتراضياً) -->
              <div id="newPeriodFormContainer" style="display: none; background: rgba(255,255,255,0.03); padding: 15px; border-radius: 8px; border: 1px solid var(--border-color); margin-bottom: 15px;">
                <h4 style="font-size: 0.95rem; margin-bottom: 10px; color: var(--gold-light);">إضافة فترة محاسبية جديدة</h4>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; margin-bottom: 10px;">
                  <div>
                    <label class="form-label" style="font-size: 0.8rem;">اسم الفترة</label>
                    <input type="text" id="newPeriodName" class="form-control" placeholder="مثال: الربع الأول 2026">
                  </div>
                  <div>
                    <label class="form-label" style="font-size: 0.8rem;">تاريخ البدء</label>
                    <input type="date" id="newPeriodStart" class="form-control">
                  </div>
                  <div>
                    <label class="form-label" style="font-size: 0.8rem;">تاريخ الانتهاء</label>
                    <input type="date" id="newPeriodEnd" class="form-control">
                  </div>
                </div>
                <div style="display: flex; gap: 8px; justify-content: flex-end;">
                  <button type="button" class="btn btn-sm btn-secondary" onclick="document.getElementById('newPeriodFormContainer').style.display='none'">إلغاء</button>
                  <button type="button" class="btn btn-sm btn-success" onclick="Accounting.submitNewPeriod()">حفظ الفترة</button>
                </div>
              </div>

              <div class="table-responsive">
                <table class="custom-table">
                  <thead>
                    <tr>
                      <th>اسم الفترة</th>
                      <th>تاريخ البدء</th>
                      <th>تاريخ الانتهاء</th>
                      <th>الحالة</th>
                      <th>ملاحظات الإغلاق / الفتح</th>
                      <th style="text-align: center;">الإجراء</th>
                    </tr>
                  </thead>
                  <tbody id="accountingPeriodsTableBody">
                    <tr><td colspan="6" style="text-align: center;">جاري التحميل...</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" onclick="App.closeModal('accountingPeriodsModal')">إغلاق</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    App.openModal('accountingPeriodsModal');
    await this.loadPeriodsTable();
  },

  showNewPeriodForm() {
    const el = document.getElementById('newPeriodFormContainer');
    if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
  },

  async loadPeriodsTable() {
    const tbody = document.getElementById('accountingPeriodsTableBody');
    if (!tbody) return;

    try {
      const res = await fetch('/api/accounting/periods');
      const json = await res.json();
      if (!json.success || !json.data || json.data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-secondary);">لا توجد فترات محاسبية مسجلة</td></tr>';
        return;
      }

      tbody.innerHTML = json.data.map(p => {
        const isClosed = p.status === 'closed';
        const badge = isClosed 
          ? `<span class="badge" style="background: rgba(239,68,68,0.2); color: #f87171; border: 1px solid #ef4444;">🔒 مغلقة</span>`
          : `<span class="badge" style="background: rgba(34,197,94,0.2); color: #4ade80; border: 1px solid #22c55e;">🟢 مفتوحة</span>`;

        let actionBtn = '';
        if (isClosed) {
          actionBtn = `<button class="btn btn-sm btn-warning" onclick="Accounting.promptReopenPeriod(${p.id}, '${p.period_name}')" style="padding: 3px 8px; font-size: 0.78rem;">🔓 إعادة فتح</button>`;
        } else {
          actionBtn = `<button class="btn btn-sm btn-danger" onclick="Accounting.promptClosePeriod(${p.id}, '${p.period_name}')" style="padding: 3px 8px; font-size: 0.78rem;">🔒 إغلاق الفترة</button>`;
        }

        const notes = isClosed 
          ? `أغلقت بواسطة: ${p.closed_by || 'المدير'} ${p.closing_reason ? `(${p.closing_reason})` : ''}`
          : (p.reopen_reason ? `أعيد فتحها: ${p.reopen_reason}` : 'جاهزة للعمليات');

        return `
          <tr>
            <td style="font-weight: bold; color: #fff;">${p.period_name}</td>
            <td>${p.start_date}</td>
            <td>${p.end_date}</td>
            <td>${badge}</td>
            <td style="font-size: 0.8rem; color: var(--text-secondary);">${notes}</td>
            <td style="text-align: center;">${actionBtn}</td>
          </tr>
        `;
      }).join('');
    } catch (e) {
      console.error(e);
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #f87171;">فشل جلب الفترات المحاسبية</td></tr>';
    }
  },

  async submitNewPeriod() {
    const period_name = document.getElementById('newPeriodName')?.value?.trim();
    const start_date = document.getElementById('newPeriodStart')?.value;
    const end_date = document.getElementById('newPeriodEnd')?.value;

    if (!period_name || !start_date || !end_date) {
      App.showToast('جميع الحقول مطلوبة لإضافة الفترة', 'error');
      return;
    }

    try {
      const res = await fetch('/api/accounting/periods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period_name, start_date, end_date })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast('تمت إضافة الفترة المحاسبية بنجاح', 'success');
        document.getElementById('newPeriodFormContainer').style.display = 'none';
        await this.loadPeriodsTable();
      } else {
        App.showToast(data.message || 'فشل إضافة الفترة', 'error');
      }
    } catch (e) {
      console.error(e);
      App.showToast('خطأ أثناء حفظ الفترة', 'error');
    }
  },

  async promptClosePeriod(id, name) {
    const reason = prompt(`هل أنت متأكد من إغلاق الفترة المحاسبية (${name})؟\nلن يسمح بأي تعديل مالي فيها بعد الإغلاق.\nأدخل سبب الإغلاق إن وجد:`, 'الإقفال الدوري للحسابات');
    if (reason === null) return;

    try {
      const res = await fetch(`/api/accounting/periods/${id}/close`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(data.message, 'success');
        await this.loadPeriodsTable();
      } else {
        App.showToast(data.message || 'فشل إغلاق الفترة', 'error');
      }
    } catch (e) {
      console.error(e);
      App.showToast('خطأ في إغلاق الفترة', 'error');
    }
  },

  async promptReopenPeriod(id, name) {
    const reason = prompt(`⚠️ إعادة فتح فترة مغلقة (${name}) يتطلب إذناً رسمياً.\nأدخل سبب ومبرر إعادة الفتح:`);
    if (!reason || !reason.trim()) {
      App.showToast('يجب إدخال سبب رسمي لإعادة فتح الفترة', 'warning');
      return;
    }

    try {
      const res = await fetch(`/api/accounting/periods/${id}/reopen`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(data.message, 'success');
        await this.loadPeriodsTable();
      } else {
        App.showToast(data.message || 'فشل إعادة فتح الفترة', 'error');
      }
    } catch (e) {
      console.error(e);
      App.showToast('خطأ في إعادة فتح الفترة', 'error');
    }
  },

  // ================== سجل التدقيق والرقابة المالية (Audit Log) ==================
  async openAuditLogModal() {
    let modal = document.getElementById('auditLogModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'auditLogModal';
      modal.className = 'modal';
      modal.innerHTML = `
        <div class="modal-dialog modal-xl" style="max-width: 1050px;">
          <div class="modal-content">
            <div class="modal-header">
              <h3 class="modal-title" style="display: flex; align-items: center; gap: 8px;">
                <span>📜 سجل التدقيق والرقابة المالية (Audit Trail)</span>
              </h3>
              <button type="button" class="btn-close" onclick="App.closeModal('auditLogModal')">✕</button>
            </div>
            <div class="modal-body">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; flex-wrap: wrap; gap: 10px;">
                <p style="color: var(--text-secondary); margin: 0; font-size: 0.88rem;">
                  توثيق دقيق لكل العمليات المالية والإدارية (من أنشأ، من عدّل، متى، والتفاصيل المحاسبية).
                </p>
                <div style="display: flex; gap: 10px; align-items: center;">
                  <select id="auditLogFilterEntity" class="form-control" style="max-width: 170px;" onchange="Accounting.loadAuditLogs()">
                    <option value="">كافة الكيانات...</option>
                    <option value="journal_entry">قيود يومية</option>
                    <option value="expense">سندات صرف</option>
                    <option value="receipt">سندات قبض</option>
                    <option value="payroll">رواتب وأجور</option>
                    <option value="period">فترات محاسبية</option>
                    <option value="account">دليل الحسابات</option>
                  </select>
                  <button class="btn btn-sm btn-secondary" onclick="Accounting.loadAuditLogs()">🔄 تحديث</button>
                </div>
              </div>

              <div class="table-responsive">
                <table class="custom-table">
                  <thead>
                    <tr>
                      <th>التاريخ والوقت</th>
                      <th>المستخدم</th>
                      <th>نوع الحركة</th>
                      <th>الكيان المالي</th>
                      <th>الرقم / المعرف</th>
                      <th>تفاصيل التعديل والبيانات</th>
                      <th>عنوان IP</th>
                    </tr>
                  </thead>
                  <tbody id="auditLogsTableBody">
                    <tr><td colspan="7" style="text-align: center;">جاري التحميل...</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" onclick="App.closeModal('auditLogModal')">إغلاق</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    App.openModal('auditLogModal');
    await this.loadAuditLogs();
  },

  async loadAuditLogs() {
    const tbody = document.getElementById('auditLogsTableBody');
    if (!tbody) return;

    const entityType = document.getElementById('auditLogFilterEntity')?.value || '';
    let url = '/api/accounting/audit-logs?limit=50';
    if (entityType) url += `&entity_type=${encodeURIComponent(entityType)}`;

    try {
      const res = await fetch(url);
      const json = await res.json();
      if (!json.success || !json.data || json.data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-secondary);">لا توجد حركات تدقيق مسجلة حتى الآن</td></tr>';
        return;
      }

      tbody.innerHTML = json.data.map(log => {
        let actionBadge = `<span class="badge badge-info">${log.action}</span>`;
        if (log.action === 'INSERT') actionBadge = `<span class="badge" style="background: rgba(34,197,94,0.2); color: #4ade80;">إضافة +</span>`;
        else if (log.action === 'DELETE') actionBadge = `<span class="badge" style="background: rgba(239,68,68,0.2); color: #f87171;">حذف ✕</span>`;
        else if (log.action === 'UPDATE') actionBadge = `<span class="badge" style="background: rgba(234,179,8,0.2); color: #facc15;">تعديل ✏️</span>`;
        else if (log.action === 'CLOSE_PERIOD') actionBadge = `<span class="badge" style="background: rgba(239,68,68,0.2); color: #f87171;">إغلاق فترة 🔒</span>`;
        else if (log.action === 'REOPEN_PERIOD') actionBadge = `<span class="badge" style="background: rgba(59,130,246,0.2); color: #60a5fa;">فتح فترة 🔓</span>`;

        let detailsDisplay = log.details || '';
        try {
          if (detailsDisplay.startsWith('{') || detailsDisplay.startsWith('[')) {
            const parsed = JSON.parse(detailsDisplay);
            detailsDisplay = Object.entries(parsed)
              .map(([k, v]) => `<span style="color: var(--gold-light);">${k}:</span> ${typeof v === 'number' ? App.formatNumber(v) : v}`)
              .join(' | ');
          }
        } catch (e) {}

        return `
          <tr>
            <td style="font-size: 0.8rem; direction: ltr; text-align: right;">${log.created_at}</td>
            <td style="font-weight: 600; color: #fff;">${log.username || 'نظام'}</td>
            <td>${actionBadge}</td>
            <td><span class="badge badge-secondary">${log.entity_type}</span></td>
            <td style="font-family: monospace; color: #38bdf8;">${log.entity_id || '-'}</td>
            <td style="font-size: 0.8rem; max-width: 300px; overflow: hidden; text-overflow: ellipsis;">${detailsDisplay}</td>
            <td style="font-size: 0.75rem; color: var(--text-secondary); direction: ltr;">${log.ip_address || '-'}</td>
          </tr>
        `;
      }).join('');
    } catch (e) {
      console.error(e);
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #f87171;">فشل جلب سجلات التدقيق</td></tr>';
    }
  },

  exportJournalToExcel() {
    if (typeof ExcelExporter !== 'undefined' && ExcelExporter.exportTable) {
      ExcelExporter.exportTable('#journalView table', 'دفتر قيود اليومية العامة', 'قيود_اليومية_رواسي_عدن');
    } else {
      App.showToast('ميزة التصدير لـ Excel غير متوفرة حالياً', 'info');
    }
  }
};

