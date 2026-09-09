/**
 * إدارة العمليات المحاسبية، السندات، حركة الصندوق، والعهد - شركة رواسي عدن
 */

const Accounting = {
  clients: [],
  suppliers: [],
  projects: [],

  async init() {
    await this.loadDropdowns();
    await this.loadCashMovement();
    await this.loadRecentCustodySummary();
  },

  _targetClientSelectId: null,
  _targetSupplierSelectId: null,

  async loadDropdowns() {
    try {
      const [cRes, sRes, pRes] = await Promise.all([
        fetch('/api/clients').then(r => r.json()),
        fetch('/api/suppliers').then(r => r.json()),
        fetch('/api/projects').then(r => r.json())
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
    } catch (e) {
      console.error('Error loading dropdowns:', e);
    }
  },

  populateSelect(elementId, items, displayField) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const defaultOption = el.options[0] ? el.options[0].outerHTML : '<option value="">اختر...</option>';
    el.innerHTML = defaultOption + items.map(item => `<option value="${item.id}">${item[displayField]}</option>`).join('');
  },

  // ================== تفقيط الأرقام وتحويلها إلى كلمات عربية ==================
  tafqeet(num, currency = 'ر.ي') {
    if (!num || isNaN(num) || num <= 0) return '';
    num = Math.floor(Number(num));

    const ones = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'];
    const teens = ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
    const tens = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
    const hundreds = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];

    function convertGroup(n) {
      let res = [];
      const h = Math.floor(n / 100);
      const remainder = n % 100;

      if (h > 0) res.push(hundreds[h]);

      if (remainder > 0) {
        if (remainder < 10) {
          res.push(ones[remainder]);
        } else if (remainder < 20) {
          res.push(teens[remainder - 10]);
        } else {
          const o = remainder % 10;
          const t = Math.floor(remainder / 10);
          if (o > 0) {
            res.push(ones[o] + ' و' + tens[t]);
          } else {
            res.push(tens[t]);
          }
        }
      }
      return res.join(' و');
    }

    let parts = [];
    const billions = Math.floor(num / 1000000000);
    num %= 1000000000;
    const millions = Math.floor(num / 1000000);
    num %= 1000000;
    const thousands = Math.floor(num / 1000);
    const units = num % 1000;

    if (billions > 0) {
      parts.push(convertGroup(billions) + (billions === 1 ? ' مليار' : (billions === 2 ? ' ملياران' : (billions <= 10 ? ' مليارات' : ' مليار'))));
    }
    if (millions > 0) {
      parts.push(convertGroup(millions) + (millions === 1 ? ' مليون' : (millions === 2 ? ' مليونان' : (millions <= 10 ? ' ملايين' : ' مليون'))));
    }
    if (thousands > 0) {
      if (thousands === 1) parts.push('ألف');
      else if (thousands === 2) parts.push('ألفان');
      else if (thousands <= 10) parts.push(convertGroup(thousands) + ' آلاف');
      else parts.push(convertGroup(thousands) + ' ألف');
    }
    if (units > 0) {
      parts.push(convertGroup(units));
    }

    let currName = 'ريال يمني';
    if (currency === 'ر.س') currName = 'ريال سعودي';
    else if (currency === '$' || currency === 'USD') currName = 'دولار أمريكي';

    return 'فقط ' + parts.join(' و') + ' ' + currName + ' لا غير';
  },

  // فتح نافذة منبثقة لتسجيل سند قبض جديد
  openNewReceiptModal() {
    this.loadDropdowns();
    const dateInput = document.getElementById('modalRcDate');
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
    const form = document.getElementById('modalReceiptForm');
    if (form) form.reset();
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
    App.openModal('newReceiptModal');
  },

  // حفظ سند قبض من النافذة المنبثقة
  async submitReceiptVoucherModal(e) {
    if (e) e.preventDefault();
    const client_id = document.getElementById('modalRcClientSelect').value;
    const project_id = document.getElementById('modalRcProjectSelect').value;
    const date = document.getElementById('modalRcDate').value;
    const payment_method = document.getElementById('modalRcPaymentMethod').value;
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

    try {
      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'قبض',
          client_id,
          project_id,
          date,
          payment_method,
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
          this.printReceipt({
            receipt_no: data.receipt_no,
            date,
            client_name: this.clients.find(c => c.id == client_id)?.name || 'العميل',
            project_name: this.projects.find(p => p.id == project_id)?.name || '-',
            amount,
            currency,
            payment_method,
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
    const date = document.getElementById('rcDate').value;
    const payment_method = document.getElementById('rcPaymentMethod').value;
    const amount = document.getElementById('rcAmount').value;
    const currency = document.getElementById('rcCurrency')?.value || 'ر.ي';
    const notes = document.getElementById('rcNotes').value;

    if (!amount || Number(amount) <= 0) {
      App.showToast('يرجى تحديد المبلغ بشكل صحيح', 'error');
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
          date,
          payment_method,
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
          this.printReceipt({
            receipt_no: data.receipt_no,
            date,
            client_name: this.clients.find(c => c.id == client_id)?.name || 'العميل',
            project_name: this.projects.find(p => p.id == project_id)?.name || '-',
            amount,
            currency,
            payment_method,
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
  },

  // حفظ سند صرف من النموذج السريع (المصروفات)
  async submitExpenseVoucher(e) {
    if (e) e.preventDefault();
    const expense_type = document.getElementById('expTypeSelect').value;
    const project_id = document.getElementById('expProjectSelect').value;
    const supplier_id = document.getElementById('expSupplierSelect').value;
    const date = document.getElementById('expDate').value;
    const payment_method = document.getElementById('expPaymentMethod').value;
    const amount = document.getElementById('expAmount').value;
    const currency = document.getElementById('expCurrency')?.value || 'ر.ي';
    const notes = document.getElementById('expNotes').value;

    if (!expense_type || !amount || Number(amount) <= 0) {
      App.showToast('يرجى تحديد نوع المصروف والمبلغ', 'error');
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
          date,
          payment_method,
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
  },

  // حفظ النثريات والعهد من النموذج السريع
  async submitCustody(e) {
    if (e) e.preventDefault();
    const operation_type = document.getElementById('custodyTypeSelect').value;
    const employee_name = document.getElementById('custodyEmpName').value.trim();
    const total_amount = document.getElementById('custodyTotalAmount').value;
    const currency = document.getElementById('custodyCurrency')?.value || 'ر.ي';
    const spent_amount = document.getElementById('custodySpentAmount')?.value || 0;
    const date = document.getElementById('custodyDate').value;
    const notes = document.getElementById('custodyNotes')?.value || '';

    if (!employee_name || !total_amount || Number(total_amount) <= 0) {
      App.showToast('يرجى كتابة اسم الموظف وإجمالي العهدة', 'error');
      return;
    }

    try {
      const res = await fetch('/api/accounting/custodies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation_type,
          employee_name,
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
      } else {
        App.showToast(data.message || 'خطأ', 'error');
      }
    } catch (e) {
      App.showToast('فشل الاتصال بالخادم', 'error');
    }
  },

  // فتح نافذة سند صرف جديد
  openNewExpenseModal() {
    const form = document.getElementById('modalExpenseForm');
    if (form) form.reset();
    const dateInput = document.getElementById('modalExpDate');
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];

    // ملء قوائم المشاريع والموردين
    const projSelect = document.getElementById('modalExpProjectSelect');
    if (projSelect) {
      projSelect.innerHTML = `<option value="">اختر المشروع (اختياري)...</option>` +
        this.projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    }
    const suppSelect = document.getElementById('modalExpSupplierSelect');
    if (suppSelect) {
      suppSelect.innerHTML = `<option value="">اختر المورد (اختياري)...</option>` +
        this.suppliers.map(s => `<option value="${s.id}">${s.name} (${s.category || 'مورد'})</option>`).join('');
    }

    App.openModal('newExpenseModal');
  },

  // حفظ سند الصرف من النافذة المنبثقة
  async submitExpenseVoucherModal(e) {
    if (e) e.preventDefault();
    const expense_type = document.getElementById('modalExpTypeSelect').value;
    const project_id = document.getElementById('modalExpProjectSelect').value;
    const supplier_id = document.getElementById('modalExpSupplierSelect').value;
    const date = document.getElementById('modalExpDate').value;
    const payment_method = document.getElementById('modalExpPaymentMethod').value;
    const amount = document.getElementById('modalExpAmount').value;
    const currency = document.getElementById('modalExpCurrency')?.value || 'ر.ي';
    const notes = document.getElementById('modalExpNotes').value;

    if (!expense_type || !amount || Number(amount) <= 0) {
      App.showToast('يرجى تحديد نوع المصروف والمبلغ المطلوب', 'error');
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
          date,
          payment_method,
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
          this.printExpenseReceipt({
            receipt_no: data.receipt_no,
            date,
            expense_type,
            supplier_name: this.suppliers.find(s => s.id == supplier_id)?.name || '-',
            project_name: this.projects.find(p => p.id == project_id)?.name || '-',
            amount,
            currency,
            payment_method,
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
    const form = document.getElementById('modalCustodyForm');
    if (form) form.reset();
    const dateInput = document.getElementById('modalCustodyDate');
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
    const remInput = document.getElementById('modalCustodyRemainingAmount');
    if (remInput) remInput.value = '0';
    App.openModal('newCustodyModal');
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
    const employee_name = document.getElementById('modalCustodyEmpName').value.trim();
    const date = document.getElementById('modalCustodyDate').value;
    const currency = document.getElementById('modalCustodyCurrency')?.value || 'ر.ي';
    const total_amount = document.getElementById('modalCustodyTotalAmount').value;
    const spent_amount = document.getElementById('modalCustodySpentAmount').value || 0;
    const notes = document.getElementById('modalCustodyNotes').value;

    if (!employee_name || !total_amount || Number(total_amount) <= 0) {
      App.showToast('يرجى إدخال اسم الموظف وإجمالي مبلغ العهدة', 'error');
      return;
    }

    try {
      const res = await fetch('/api/accounting/custodies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation_type,
          employee_name,
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
            ${showProject ? `
            <tr>
              <td class="label-cell" style="border-right-color: #dc2626;">المشروع التابع له:</td>
              <td class="val-cell">${info.project_name || 'عام / تشغيلي'}</td>
            </tr>` : ''}
            ${showPaymentMethod ? `
            <tr>
              <td class="label-cell" style="border-right-color: #dc2626;">طريقة الدفع:</td>
              <td class="val-cell">${info.payment_method || 'نقدي'}</td>
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
            ${showProject ? `
            <tr>
              <td class="label-cell" style="border-right-color: ${accentColor};">المشروع التابع له:</td>
              <td class="val-cell">${info.project_name || 'عام / تشغيلي'}</td>
            </tr>` : ''}
            ${showPaymentMethod ? `
            <tr>
              <td class="label-cell" style="border-right-color: ${accentColor};">طريقة الدفع:</td>
              <td class="val-cell">${info.payment_method || 'نقدي'}</td>
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
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnHtml;
      }
    }
  }
};
