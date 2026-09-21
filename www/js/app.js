/**
 * المنظم الرئيسي للنظام - نظام رواسي عدن للهندسة والمقاولات (SPA Controller)
 */

const App = {
  activeView: 'dashboard',
  dbStatus: null,

  async init() {
    console.log('🚀 تهيئة نظام رواسي عدن للهندسة والمقاولات...');
    
    // التحقق المسبق من الاتصال بقاعدة البيانات (أونلاين / أوفلاين)
    await this.checkDatabaseStatus();

    // تهيئة الوحدات
    Auth.init();
    await Projects.init();
    if (typeof ProjectHub !== 'undefined') await ProjectHub.init();
    await Accounting.init();
    await Reports.init();
    await Inventory.init();
    if (typeof HR !== 'undefined') HR.init();
    await Settings.init();

    this.bindEvents();
    this.setupDatePickers();
    this.setupNetworkWatchers();

    console.log('✅ تم تشغيل كافة وحدات النظام بنجاح!');
  },

  bindEvents() {
    // إغلاق النوافذ المنبثقة بالنقر على الخلفية
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.classList.remove('active');
        }
      });
    });

    // إغلاق قائمة الإشعارات المنسدلة عند النقر خارجها
    document.addEventListener('click', (e) => {
      const wrapper = document.getElementById('notificationsWrapper');
      const dropdown = document.getElementById('notificationsDropdown');
      if (dropdown && dropdown.classList.contains('active') && wrapper && !wrapper.contains(e.target)) {
        dropdown.classList.remove('active');
      }
    });

    // استجابة تغيير حجم النافذة للرسوم البيانية
    window.addEventListener('resize', () => {
      if (this.activeView === 'dashboard') {
        Reports.loadDashboardKPIs();
      }
    });
  },

  setupDatePickers() {
    const today = new Date().toISOString().split('T')[0];
    const dateInputs = ['rcDate', 'expDate', 'custodyDate', 'plToDate'];
    dateInputs.forEach(id => {
      const el = document.getElementById(id);
      if (el && !el.value) el.value = today;
    });

    const fromInput = document.getElementById('plFromDate');
    if (fromInput && !fromInput.value) fromInput.value = '2024-01-01';
  },

  // التحكم بالقائمة الجانبية للشاشات الصغيرة والهواتف
  toggleMobileSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (sidebar) sidebar.classList.toggle('mobile-open');
    if (backdrop) backdrop.classList.toggle('active');
  },

  closeMobileSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (sidebar) sidebar.classList.remove('mobile-open');
    if (backdrop) backdrop.classList.remove('active');
  },

  // التحكم بالقوائم الشجرية المنسدلة (Accordion Groups)
  toggleNavGroup(groupId) {
    const groupEl = document.getElementById(groupId);
    if (!groupEl) return;
    const isOpen = groupEl.classList.contains('open');
    groupEl.classList.toggle('open', !isOpen);
  },

  // التنقل الشجري العميق إلى إدارة وتبويب محدد
  navigateDeep(viewId, subTab, clickedEl = null) {
    // فتح مجموعة القائمة الحاضنة للتبويب
    if (clickedEl) {
      const parentGroup = clickedEl.closest('.nav-group');
      if (parentGroup) parentGroup.classList.add('open');
      document.querySelectorAll('.nav-sub-item').forEach(el => el.classList.remove('active'));
      clickedEl.classList.add('active');
    }

    // الانتقال للشاشة الرئيسية أولاً
    this.navigate(viewId, null);

    // توجيه التبويب الفرعي المتخصص
    if (viewId === 'settings') {
      if (typeof Settings !== 'undefined' && Settings.switchTab) {
        Settings.switchTab(subTab);
      }
    } else if (viewId === 'journal') {
      if (typeof Accounting !== 'undefined' && Accounting.switchJournalTab) {
        Accounting.switchJournalTab(subTab);
      }
    } else if (viewId === 'reports') {
      if (typeof Reports !== 'undefined' && Reports.switchReportTab) {
        Reports.switchReportTab(subTab);
      }
    } else if (viewId === 'hr') {
      if (typeof HR !== 'undefined' && HR.showPane) {
        const btn = document.querySelector(`#hrView .report-tab-btn[onclick*="'${subTab}'"]`);
        HR.showPane(subTab, btn);
      }
    } else if (viewId === 'projects') {
      if (typeof Projects !== 'undefined' && Projects.filterStatus) {
        Projects.filterStatus(subTab);
      }
    } else if (viewId === 'inventory') {
      if (typeof Inventory !== 'undefined' && Inventory.switchTab) {
        Inventory.switchTab(subTab);
      }
    }
  },

  // التنقل السريع إلى قسم محدد داخل مركز مستندات المشروع الـ 16
  navigateProjectHubSection(sectionNumber) {
    this.navigate('projectHub');
    if (typeof ProjectHub !== 'undefined') {
      if (ProjectHub.switchSection) {
        ProjectHub.switchSection(sectionNumber);
      } else if (ProjectHub.showSection) {
        ProjectHub.showSection(sectionNumber);
      }
    }
  },

  // التنقل بين الأقسام والشاشات
  navigate(viewId, clickedEl = null) {
    this.activeView = viewId;
    this.closeMobileSidebar();

    // تحديث رابط القائمة الجانبية النشط
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.remove('active');
    });
    if (clickedEl && clickedEl.classList.contains('nav-item')) {
      clickedEl.classList.add('active');
    } else {
      // مطابقة العنصر في القائمة الجانبية تلقائياً
      const matchedNavItem = document.querySelector(`.nav-item[onclick*="'${viewId}'"]`);
      if (matchedNavItem) matchedNavItem.classList.add('active');
    }

    // تحديث أزرار شريط التنقل السفلي للهواتف
    document.querySelectorAll('.bottom-nav-item').forEach(btn => {
      if (btn.getAttribute('data-nav') === viewId) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // إخفاء كافة الشاشات وإظهار الشاشة المطلوبة
    const views = document.querySelectorAll('.app-view-section');
    views.forEach(v => v.style.display = 'none');

    const targetView = document.getElementById(viewId + 'View');
    if (targetView) {
      targetView.style.display = 'block';
    } else {
      // إذا كانت شاشة افتراضية ترجع إلى لوحة التحكم
      const dash = document.getElementById('dashboardView');
      if (dash) dash.style.display = 'block';
    }

    // تمرير الشاشة للأعلى بسلاسة
    const mainContent = document.querySelector('.main-content');
    if (mainContent) mainContent.scrollTop = 0;
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // تحديث المحتوى وفق الشاشة
    if (viewId === 'dashboard') {
      Reports.loadDashboardKPIs();
      Projects.loadProjects();
    } else if (viewId === 'reports') {
      Reports.switchReportTab(Reports.activeReportTab || 'profit-loss');
    } else if (viewId === 'hr') {
      HR.load();
    } else if (viewId === 'projects') {
      Projects.loadProjects();
    } else if (viewId === 'projectHub') {
      if (typeof ProjectHub !== 'undefined') {
        ProjectHub.populateProjectSelect().then(() => ProjectHub.loadProjectData());
      }
    } else if (viewId === 'inventory') {
      Inventory.loadItems();
    } else if (viewId === 'revenues') {
      this.loadRevenuesTable();
    } else if (viewId === 'expenses') {
      this.loadExpensesTable();
    } else if (viewId === 'custody') {
      Accounting.loadRecentCustodySummary();
      this.loadCustodyTable();
    } else if (viewId === 'journal') {
      Accounting.loadJournalEntries();
    } else if (viewId === 'clients') {
      this.loadClientsTable();
    } else if (viewId === 'suppliers') {
      this.loadSuppliersTable();
    } else if (viewId === 'cash') {
      Accounting.loadCashMovement();
      this.loadCashTable();
    } else if (viewId === 'settings') {
      Settings.loadCompanySettings();
      Settings.loadUsers();
    }
  },

  async loadRevenuesTable() {
    try {
      const res = await fetch('/api/payments?type=قبض');
      const json = await res.json();
      const tbody = document.getElementById('fullRevenuesTableBody');
      if (json.success) {
        const list = json.data || [];
        const total = list.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
        const kpiTotal = document.getElementById('revKpiTotal');
        const kpiCount = document.getElementById('revKpiCount');
        if (kpiTotal) kpiTotal.textContent = this.formatNumber(total);
        if (kpiCount) kpiCount.textContent = list.length;

        if (tbody) {
          if (list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 20px; color: var(--text-secondary);">لا توجد سندات قبض مسجلة حتى الآن</td></tr>`;
          } else {
            tbody.innerHTML = list.map(p => `
              <tr>
                <td><strong style="color: var(--gold-light);">${p.receipt_no}</strong></td>
                <td>${p.date}</td>
                <td><strong>${p.client_name || '-'}</strong></td>
                <td>${p.project_name || '-'}</td>
                <td style="color: var(--accent-green); font-weight: bold;">${this.formatNumber(p.amount)} ${p.currency || 'ر.ي'}</td>
                <td><span class="badge badge-active">${p.payment_method}</span></td>
                <td>${p.notes || '-'}</td>
                <td style="text-align: center;">
                  <button class="btn btn-secondary btn-sm" onclick="Accounting.printReceipt({
                    receipt_no: '${p.receipt_no}',
                    date: '${p.date}',
                    client_name: '${(p.client_name || 'العميل').replace(/'/g, "\\'")}',
                    project_name: '${(p.project_name || '-').replace(/'/g, "\\'")}',
                    amount: ${p.amount},
                    currency: '${p.currency || 'ر.ي'}',
                    payment_method: '${p.payment_method}',
                    notes: '${(p.notes || '').replace(/'/g, "\\'")}'
                  })">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="vertical-align: middle;"><path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/></svg>
                    <span>طباعة</span>
                  </button>
                </td>
              </tr>
            `).join('');
          }
        }
      }
    } catch (e) {
      console.error('Error loading revenues:', e);
    }
  },

  async loadExpensesTable() {
    try {
      const res = await fetch('/api/expenses');
      const json = await res.json();
      const tbody = document.getElementById('fullExpensesTableBody');
      if (json.success) {
        const list = json.data || [];
        const total = list.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
        const kpiTotal = document.getElementById('expKpiTotal');
        const kpiCount = document.getElementById('expKpiCount');
        if (kpiTotal) kpiTotal.textContent = this.formatNumber(total);
        if (kpiCount) kpiCount.textContent = list.length;

        if (tbody) {
          if (list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 20px; color: var(--text-secondary);">لا توجد سندات صرف مسجلة حتى الآن</td></tr>`;
          } else {
            tbody.innerHTML = list.map(e => `
              <tr>
                <td><strong style="color: var(--accent-red);">${e.receipt_no}</strong></td>
                <td>${e.date}</td>
                <td><span class="badge badge-expense">${e.expense_type}</span></td>
                <td>${e.project_name || '-'}</td>
                <td><strong>${e.supplier_name || '-'}</strong></td>
                <td style="color: var(--accent-red); font-weight: bold;">${this.formatNumber(e.amount)} ${e.currency || 'ر.ي'}</td>
                <td><span class="badge badge-active">${e.payment_method}</span></td>
                <td>${e.notes || '-'}</td>
                <td style="text-align: center;">
                  <button class="btn btn-secondary btn-sm" onclick="Accounting.printExpenseReceipt({
                    receipt_no: '${e.receipt_no}',
                    date: '${e.date}',
                    expense_type: '${(e.expense_type || '').replace(/'/g, "\\'")}',
                    supplier_name: '${(e.supplier_name || '-').replace(/'/g, "\\'")}',
                    project_name: '${(e.project_name || '-').replace(/'/g, "\\'")}',
                    amount: ${e.amount},
                    currency: '${e.currency || 'ر.ي'}',
                    payment_method: '${e.payment_method}',
                    notes: '${(e.notes || '').replace(/'/g, "\\'")}'
                  })">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="vertical-align: middle;"><path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/></svg>
                    <span>طباعة</span>
                  </button>
                </td>
              </tr>
            `).join('');
          }
        }
      }
    } catch (e) {
      console.error('Error loading expenses:', e);
    }
  },

  async loadCustodyTable() {
    try {
      const res = await fetch('/api/accounting/custodies');
      const json = await res.json();
      const tbody = document.getElementById('fullCustodyTableBody');
      if (json.success) {
        const list = json.data || [];
        const totalAmount = list.reduce((sum, c) => sum + (Number(c.total_amount) || 0), 0);
        const totalSpent = list.reduce((sum, c) => sum + (Number(c.spent_amount) || 0), 0);
        const totalRemaining = list.reduce((sum, c) => sum + (Number(c.remaining_amount) || 0), 0);

        const kpiTotal = document.getElementById('custodyKpiTotal');
        const kpiSpent = document.getElementById('custodyKpiSpent');
        const kpiRemain = document.getElementById('custodyKpiRemaining');
        if (kpiTotal) kpiTotal.textContent = this.formatNumber(totalAmount);
        if (kpiSpent) kpiSpent.textContent = this.formatNumber(totalSpent);
        if (kpiRemain) kpiRemain.textContent = this.formatNumber(totalRemaining);

        if (tbody) {
          if (list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 20px; color: var(--text-secondary);">لا توجد حركات عهد مسجلة</td></tr>`;
          } else {
            tbody.innerHTML = list.map(c => `
              <tr>
                <td>${c.date}</td>
                <td>
                  <strong>${c.employee_name}</strong>
                  ${c.employee_no ? `<br><small style="color: var(--text-secondary); font-family: monospace;">(${c.employee_no})</small>` : ''}
                </td>
                <td>
                  <span class="badge ${c.operation_type === 'تصفية عهدة' ? 'badge-income' : 'badge-active'}">${c.operation_type}</span>
                  ${c.custody_no ? `<br><small style="font-family: monospace; color: var(--gold-light); font-weight: bold;">${c.custody_no}</small>` : ''}
                  ${c.related_custody_no ? `<br><small style="color: #38bdf8;">تصفية لـ: <strong>${c.related_custody_no}</strong></small>` : ''}
                </td>
                <td>${this.formatNumber(c.total_amount)} ${c.currency || 'ر.ي'}</td>
                <td style="color: var(--accent-red); font-weight: bold;">${this.formatNumber(c.spent_amount)} ${c.currency || 'ر.ي'}</td>
                <td style="color: var(--accent-green); font-weight: bold;">${this.formatNumber(c.remaining_amount)} ${c.currency || 'ر.ي'}</td>
                <td>${c.notes || '-'}</td>
              </tr>
            `).join('');
          }
        }
      }
    } catch (e) {
      console.error('Error loading custodies:', e);
    }
  },

  async loadClientsTable() {
    try {
      const res = await fetch('/api/clients');
      const json = await res.json();
      const tbody = document.getElementById('fullClientsTableBody');
      if (tbody && json.success) {
        tbody.innerHTML = json.data.map(c => `
          <tr>
            <td><strong>${c.name}</strong></td>
            <td>${c.company || '-'}</td>
            <td>${c.phone || '-'}</td>
            <td>${c.address || '-'}</td>
            <td>${this.formatNumber(c.total_paid)} ${c.currency || 'ر.ي'}</td>
            <td>${this.formatNumber(c.total_due)} ${c.currency || 'ر.ي'}</td>
            <td style="color: var(--gold-light); font-weight: bold;">${this.formatNumber(c.current_balance)} ${c.currency || 'ر.ي'}</td>
            <td>
              <button class="btn btn-secondary btn-sm" onclick="App.navigate('reports'); Reports.switchReportTab('client-statement'); document.getElementById('repClientSelect').value = ${c.id}; Reports.fetchFullClientStatement();">
                كشف الحساب
              </button>
            </td>
          </tr>
        `).join('');
      }
    } catch (e) {}
  },

  async loadSuppliersTable() {
    try {
      const res = await fetch('/api/suppliers');
      const json = await res.json();
      const tbody = document.getElementById('fullSuppliersTableBody');
      if (tbody && json.success) {
        tbody.innerHTML = json.data.map(s => `
          <tr>
            <td><strong>${s.name}</strong></td>
            <td><span class="badge badge-active">${s.category || 'مواد بناء'}</span></td>
            <td>${s.phone || '-'}</td>
            <td>${s.address || '-'}</td>
            <td style="color: var(--accent-amber); font-weight: bold;">${this.formatNumber(s.balance)} ${s.currency || 'ر.ي'}</td>
            <td>${s.notes || '-'}</td>
            <td>
              <button class="btn btn-secondary btn-sm" onclick="App.navigate('reports'); Reports.switchReportTab('supplier-statement'); document.getElementById('repSupplierSelect').value = ${s.id}; Reports.fetchFullSupplierStatement();">
                كشف الحساب
              </button>
            </td>
          </tr>
        `).join('');
      }
    } catch (e) {}
  },

  async loadCashTable() {
    try {
      const res = await fetch('/api/accounting/cash-movements');
      const json = await res.json();
      const tbody = document.getElementById('fullCashTableBody');
      if (tbody && json.success) {
        tbody.innerHTML = json.data.map(m => `
          <tr>
            <td>${m.date}</td>
            <td>${this.formatNumber(m.previous_balance)}</td>
            <td style="color: var(--accent-green); font-weight: bold;">${m.cash_in ? '+' + this.formatNumber(m.cash_in) : '-'}</td>
            <td style="color: var(--accent-red); font-weight: bold;">${m.cash_out ? '-' + this.formatNumber(m.cash_out) : '-'}</td>
            <td>${m.withdrawals ? this.formatNumber(m.withdrawals) : '-'}</td>
            <td style="color: var(--gold-light); font-weight: bold;">${this.formatNumber(m.current_balance)}</td>
            <td>${m.notes || '-'}</td>
          </tr>
        `).join('');
      }
    } catch (e) {}
  },


  // النوافذ المنبثقة
  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('active');
    }
  },

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('active');
    }
  },

  // رسائل التنبيه العائمة الفاخرة (Toast)
  showToast(message, type = 'info') {
    const existing = document.querySelectorAll('.toast-msg');
    existing.forEach(t => t.remove());

    const toast = document.createElement('div');
    toast.className = `toast-msg toast-${type}`;

    let icon = '🔔';
    if (type === 'success') {
      icon = '✅';
    } else if (type === 'error') {
      icon = '⚠️';
    } else if (type === 'warning') {
      icon = '⚡';
    } else if (type === 'info') {
      icon = 'ℹ️';
    }

    toast.innerHTML = `
      <div class="toast-icon">${icon}</div>
      <div class="toast-content">
        <div class="toast-text">${message}</div>
      </div>
      <button type="button" class="toast-close" title="إغلاق">&times;</button>
    `;

    const closeBtn = toast.querySelector('.toast-close');
    if (closeBtn) {
      closeBtn.onclick = () => {
        toast.classList.remove('toast-visible');
        setTimeout(() => toast.remove(), 250);
      };
    }

    document.body.appendChild(toast);

    // تفعيل ظهور الرسالة بانسيابية
    requestAnimationFrame(() => {
      toast.classList.add('toast-visible');
    });

    // إخفاء الرسالة تلقائياً بعد 4 ثوانٍ
    setTimeout(() => {
      if (toast.parentElement) {
        toast.classList.remove('toast-visible');
        setTimeout(() => {
          if (toast.parentElement) toast.remove();
        }, 350);
      }
    }, 4500);
  },

  // تنسيق الأرقام بالفواصل المالية
  formatNumber(num) {
    if (num === null || num === undefined || isNaN(num)) return '0';
    return Number(num).toLocaleString('en-US');
  },

  // مراقبة اتصال الشبكة في المتصفح وتحديث حالة قاعدة البيانات
  setupNetworkWatchers() {
    window.addEventListener('online', async () => {
      await this.checkDatabaseStatus();
      this.showToast('تم استعادة الاتصال بالشبكة، جاري فحص السيرفر السحابي 🌐', 'info');
    });

    window.addEventListener('offline', () => {
      this.updateConnectionUI({
        isOnline: false,
        mode: 'offline',
        activeDb: 'local',
        statusMessage: 'المتصفح في وضع عدم الاتصال - يعمل النظام محلياً (أوفلاين)'
      });
      this.showToast('أنت الآن غير متصل بالإنترنت - يتم حفظ بياناتك على قاعدة البيانات المحلية 🟠', 'warning');
    });
  },

  // التحقق المسبق من حالة قاعدة البيانات والاتصال
  async checkDatabaseStatus() {
    try {
      const res = await fetch('/api/settings/db-status');
      const json = await res.json();
      if (json && json.success) {
        this.dbStatus = json.data;
        this.updateConnectionUI(json.data);
        return json.data;
      }
    } catch (e) {
      console.warn('Database status check failed, using local offline mode:', e);
      const fallback = {
        isOnline: false,
        mode: 'offline',
        activeDb: 'local',
        statusMessage: 'الوضع المحلي (أوفلاين) نشط'
      };
      this.dbStatus = fallback;
      this.updateConnectionUI(fallback);
      return fallback;
    }
  },

  // التحكم بفتح وإغلاق قائمة الإشعارات المنسدلة وحالة الاتصال
  toggleNotificationsDropdown(e) {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    const dropdown = document.getElementById('notificationsDropdown');
    if (!dropdown) return;

    const isActive = dropdown.classList.contains('active');
    if (isActive) {
      dropdown.classList.remove('active');
    } else {
      this.renderNotificationsList();
      dropdown.classList.add('active');
    }
  },

  closeNotificationsDropdown() {
    const dropdown = document.getElementById('notificationsDropdown');
    if (dropdown) dropdown.classList.remove('active');
  },

  // تحديث شارة وحالة الاتصال داخل قائمة الإشعارات وشاشة تسجيل الدخول
  updateConnectionUI(status) {
    const isOnline = !!(status && status.isOnline);
    const latency = (status && status.latencyMs) || 0;

    // 1. بطاقة الاتصال الرئيسية داخل قائمة الإشعارات
    const notifCard = document.getElementById('notifConnCard');
    const notifIcon = document.getElementById('notifConnIcon');
    const notifTitle = document.getElementById('notifConnStatusTitle');
    const notifDesc = document.getElementById('notifConnStatusDesc');
    const notifBadge = document.getElementById('notifConnBadge');

    if (notifCard) {
      notifCard.className = `notif-conn-card ${isOnline ? 'status-online' : 'status-offline'}`;
    }
    if (notifIcon) {
      notifIcon.textContent = isOnline ? '🟢' : '🔴';
    }
    if (notifTitle) {
      notifTitle.textContent = isOnline ? `متصل بالسيرفر السحابي (${latency}ms)` : 'قاعدة البيانات المحلية (أوفلاين)';
    }
    if (notifDesc) {
      notifDesc.textContent = isOnline 
        ? 'المشروع متصل بقاعدة البيانات السحابية المركزية، وتتم المزامنة تلقائياً'
        : 'يعمل النظام محلياً على قاعدة بيانات SQLite، مع حفظ كافة التعديلات بأمان تام';
    }
    if (notifBadge) {
      notifBadge.className = `notif-conn-badge ${isOnline ? 'online' : 'offline'}`;
      notifBadge.textContent = isOnline ? '🟢 أونلاين' : '🔴 أوفلاين';
    }

    // 2. نقطة الإشعار على أيقونة الجرس
    const notifDot = document.getElementById('headerNotificationDot');
    if (notifDot) {
      notifDot.className = `notification-dot ${isOnline ? 'online' : 'offline'}`;
    }

    // 3. نقطة الحالة على صورة المستخدم
    const userAvatarDot = document.getElementById('userAvatarStatusDot');
    if (userAvatarDot) {
      userAvatarDot.className = `user-avatar-dot ${isOnline ? 'online' : 'offline'}`;
      userAvatarDot.setAttribute('title', isOnline ? 'أونلاين (سحابي)' : 'أوفلاين (محلي)');
    }

    // 4. شارة شاشة تسجيل الدخول
    const loginBadge = document.getElementById('loginConnectionBadge');
    const loginText = document.getElementById('loginConnectionText');
    const loginDot = document.getElementById('loginConnectionDot');

    if (loginBadge) {
      loginBadge.className = `connection-status-pill ${isOnline ? 'status-online' : 'status-offline'}`;
      loginBadge.setAttribute('title', isOnline ? `السيرفر السحابي متصل (${latency}ms) - انقر للتفاصيل` : 'قاعدة البيانات المحلية نشطة (أوفلاين) - انقر للتفاصيل');
    }
    if (loginText) {
      loginText.textContent = isOnline ? `متصل سحابياً (${latency}ms)` : 'قاعدة البيانات المحلية (أوفلاين)';
    }
    if (loginDot) {
      loginDot.className = `status-indicator-dot ${isOnline ? 'online' : 'offline'}`;
    }

    // 5. إعادة بناء قائمة الإشعارات
    this.renderNotificationsList();
  },

  // بناء عناصر قائمة الإشعارات ديناميكياً
  renderNotificationsList() {
    const listEl = document.getElementById('notifList');
    if (!listEl) return;

    const s = this.dbStatus || {};
    const isOnline = !!s.isOnline;
    const user = (typeof Auth !== 'undefined' && Auth.currentUser) ? Auth.currentUser.full_name : 'المستخدم';

    const items = [
      {
        icon: isOnline ? '🟢' : '🔴',
        iconClass: isOnline ? 'success' : 'warning',
        title: isOnline ? 'تم التحقق من الاتصال السحابي' : 'يعمل النظام على قاعدة البيانات المحلية',
        desc: isOnline ? `تم فحص السيرفر السحابي بنجاح (${s.latencyMs || 0}ms)` : 'الاتصال السحابي غير مفعل - البيانات تحفظ محلياً',
        time: 'عند تسجيل الدخول'
      },
      {
        icon: '💾',
        iconClass: 'info',
        title: 'نظام النسخ الاحتياطي التلقائي نشط',
        desc: 'يتم أخذ نسخة احتياطية فورية تلقائياً عند تسجيل الخروج لضمان عدم ضياع أي تعديل',
        time: 'تلقائي دائم'
      },
      {
        icon: '🛡️',
        iconClass: 'success',
        title: 'حماية وتكامل البيانات 100%',
        desc: 'كافة القيود والسندات والمشاريع تخزن فورياً بأعلى معايير الأمان المالي',
        time: 'النظام مؤمن'
      }
    ];

    listEl.innerHTML = items.map(item => `
      <div class="notif-item">
        <div class="notif-item-icon ${item.iconClass}">${item.icon}</div>
        <div class="notif-item-content">
          <div class="notif-item-title">${item.title}</div>
          <div style="font-size: 0.72rem; color: var(--text-secondary); margin-bottom: 2px;">${item.desc}</div>
          <div class="notif-item-time">${item.time}</div>
        </div>
      </div>
    `).join('');
  },

  // إظهار نافذة تفاصيل الاتصال والنسخ الاحتياطي
  showConnectionModal() {
    const modal = document.getElementById('connectionDetailsModal');
    if (!modal) return;

    const s = this.dbStatus || {};
    const modeEl = document.getElementById('connModalMode');
    const statusTextEl = document.getElementById('connModalStatusText');
    const latencyEl = document.getElementById('connModalLatency');
    const dbFileEl = document.getElementById('connModalDbFile');
    const lastBackupEl = document.getElementById('connModalLastBackup');

    if (modeEl) {
      modeEl.textContent = s.isOnline ? 'سحابي (Online)' : 'محلي (Offline - SQLite)';
      modeEl.className = s.isOnline ? 'badge badge-active' : 'badge badge-warning';
    }
    if (statusTextEl) statusTextEl.textContent = s.statusMessage || 'يعمل على قاعدة البيانات المحلية';
    if (latencyEl) latencyEl.textContent = s.isOnline ? `${s.latencyMs || 0} ms` : '0 ms (محلي فوري)';
    if (dbFileEl) dbFileEl.textContent = s.localDbFile || 'rawasi_aden.db';

    if (lastBackupEl) {
      if (s.lastLogoutBackup) {
        lastBackupEl.innerHTML = `
          <strong style="color: var(--gold-light);">${s.lastLogoutBackup.fileName}</strong><br>
          <small style="color: var(--text-secondary);">المستخدم: ${s.lastLogoutBackup.username} | التاريخ: ${s.lastLogoutBackup.displayTime} | الحجم: ${(s.lastLogoutBackup.size / 1024).toFixed(1)} KB</small>
        `;
      } else {
        lastBackupEl.innerHTML = '<span style="color: var(--text-secondary);">سيتم إنشاء أول نسخة تلقائياً عند تسجيل الخروج القادم</span>';
      }
    }

    this.openModal('connectionDetailsModal');
  },

  // إعادة فحص الاتصال يدوياً من النافذة
  async recheckConnectionModal() {
    const btn = document.getElementById('btnRecheckConn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = 'جاري التحقق... ⏳';
    }
    try {
      const data = await this.checkDatabaseStatus();
      this.showConnectionModal();
      if (data && data.isOnline) {
        this.showToast('تم التحقق بنجاح: متصل بالسيرفر السحابي 🟢', 'success');
      } else {
        this.showToast('تم التحقق: النظام يعمل بنجاح على قاعدة البيانات المحلية 🟠', 'info');
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = 'إعادة فحص الاتصال الآن 🔄';
      }
    }
  }
};

// تشغيل التطبيق عند اكتمال تحميل الصفحة
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
