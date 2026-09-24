/**
 * المنظم الرئيسي للنظام - نظام رواسي عدن للهندسة والمقاولات (SPA Controller)
 */

const App = {
  assetVersion: '1.0.0.20260924-89im',
  activeView: 'dashboard',
  dbStatus: null,

  // ============================================================
  // ⚡ سجل مسارات الوحدات للتحميل الكسول عند الطلب (Code Splitting)
  // ============================================================
  _moduleRegistry: {
    tafqeet: 'js/tafqeet.js?v=1.0.0.20260924-89im',
    projects: 'js/projects.js?v=1.0.0.20260924-89im',
    projectHub: 'js/project_hub.js?v=1.0.0.20260924-89im',
    accounting: 'js/accounting.js?v=1.0.0.20260924-89im',
    hr: 'js/hr.js?v=1.0.0.20260924-89im',
    reports: 'js/reports.js?v=1.0.0.20260924-89im',
    inventory: 'js/inventory.js?v=1.0.0.20260924-89im',
    settings: 'js/settings.js?v=1.0.0.20260924-89im',
    excelExport: 'js/excel-export.js?v=1.0.0.20260924-89im'
  },
  _loadedModules: {},
  _loadingPromises: {},

  loadModule(name) {
    if (this._loadedModules[name]) return Promise.resolve();
    if (this._loadingPromises[name]) return this._loadingPromises[name];

    const src = this._moduleRegistry[name];
    if (!src) {
      console.warn(`[ModuleLoader] وحدة غير مسجلة: ${name}`);
      return Promise.resolve();
    }

    const p = new Promise((resolve, reject) => {
      // فحص ما إذا كان السكربت موجوداً مسبقاً في DOM
      const existing = document.querySelector(`script[src*="${name}.js"]`) || 
                       document.querySelector(`script[src*="${src.split('?')[0]}"]`);
      if (existing) {
        this._loadedModules[name] = true;
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => {
        this._loadedModules[name] = true;
        console.log(`⚡ [CodeSplitting] تم تحميل الوحدة بنجاح: ${name}`);
        resolve();
      };
      script.onerror = (err) => {
        console.error(`❌ [CodeSplitting] فشل تحميل الوحدة: ${name}`, err);
        delete this._loadingPromises[name];
        reject(err);
      };
      document.body.appendChild(script);
    });

    this._loadingPromises[name] = p;
    return p;
  },

  async loadModulesForView(viewId) {
    const viewMap = {
      dashboard: ['reports', 'projects'],
      projects: ['projects'],
      projectHub: ['projects', 'projectHub', 'tafqeet', 'accounting'],
      revenues: ['tafqeet', 'accounting'],
      expenses: ['tafqeet', 'accounting'],
      custody: ['tafqeet', 'accounting'],
      journal: ['tafqeet', 'accounting', 'excelExport'],
      chartOfAccounts: ['accounting'],
      costCenters: ['accounting'],
      currencies: ['accounting'],
      clients: ['tafqeet', 'accounting', 'reports'],
      suppliers: ['tafqeet', 'accounting', 'reports'],
      cash: ['tafqeet', 'accounting'],
      reports: ['reports', 'tafqeet', 'accounting', 'excelExport'],
      inventory: ['inventory'],
      hr: ['hr'],
      settings: ['settings']
    };

    const modules = viewMap[viewId] || [];
    for (const mod of modules) {
      await this.loadModule(mod);
    }
  },

  // التحميل الكسول المسبق في أوقات خمول المتصفح (Idle Preload)
  prefetchRemainingModules() {
    const allModules = Object.keys(this._moduleRegistry);
    allModules.forEach(mod => {
      if (!this._loadedModules[mod] && !this._loadingPromises[mod]) {
        this.loadModule(mod).catch(() => {});
      }
    });
  },

  async init() {
    console.log('🚀 تهيئة نظام رواسي عدن للهندسة والمقاولات (فائق السرعة والأداء)...');

    // تطبيق المظهر المحفوظ فورياً قبل تحميل أي شيء
    this.initTheme();

    // التحقق المسبق من الاتصال بقاعدة البيانات (أونلاين / أوفلاين)
    await this.checkDatabaseStatus();

    // تهيئة وحدة الأمان والمصادقة الأساسية
    if (typeof Auth !== 'undefined' && Auth.init) {
      await Auth.init();
    }

    // تحميل وتهيئة وحدات لوحة التحكم الرئيسية فقط (Dashboard) لتسريع الإقلاع بنسبة 75%+
    await this.loadModulesForView('dashboard');
    if (typeof Projects !== 'undefined' && Projects.init) {
      await Projects.init();
      Projects._initialized = true;
    }
    if (typeof Reports !== 'undefined' && Reports.init) {
      await Reports.init();
      Reports._initialized = true;
    }

    this.bindEvents();
    this.setupDatePickers();
    this.setupNetworkWatchers();
    this.setupHardwareBackButton();

    // تهيئة مسار التنقل الدلالي ووحدة تجربة المستخدم والتحميل الكسول
    if (window.UI && UI.Breadcrumbs) UI.Breadcrumbs.update(this.activeView);
    if (window.UI && UI.LazyLoader) UI.LazyLoader.init();

    // جدولة تحميل باقي الوحدات في خلفية خمول المتصفح لضمان استجابة فورية لأي نقرة قادمة
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(() => this.prefetchRemainingModules());
    } else {
      setTimeout(() => this.prefetchRemainingModules(), 1800);
    }

    console.log('✅ تم تشغيل نظام رواسي عدن بنجاح بأعلى كفاءة!');
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

        // إغلاق القائمة الجانبية تلقائياً عند النقر على أي رابط داخلها على الهواتف والأجهزة اللوحية
    document.addEventListener('click', (e) => {
      const link = e.target.closest('.sidebar-nav a, .nav-sub-item');
      if (link && window.innerWidth <= 1024) {
        this.closeMobileSidebar();
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
    if (sidebar) {
      const isOpen = sidebar.classList.toggle('mobile-open');
      if (backdrop) backdrop.classList.toggle('active', isOpen);
      if (window.innerWidth <= 1024) {
        document.body.style.overflow = isOpen ? 'hidden' : '';
      }
    }
  },

  closeMobileSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (sidebar) sidebar.classList.remove('mobile-open');
    if (backdrop) backdrop.classList.remove('active');
    document.body.style.overflow = '';
  },

  setupHardwareBackButton() {
    // 1. دعم زر الرجوع الفعلي لأجهزة أندرويد عبر Capacitor
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
      window.Capacitor.Plugins.App.addListener('backButton', () => {
        const handled = this.handleDismissOrBack();
        if (!handled) {
          if (this.activeView !== 'dashboard') {
            this.navigate('dashboard');
          } else {
            window.Capacitor.Plugins.App.exitApp();
          }
        }
      });
    }

    // 2. زر Escape في لوحة المفاتيح
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.keyCode === 27) {
        this.handleDismissOrBack();
      }
    });

    // 3. سجل تصفح المتصفح (PopState)
    window.addEventListener('popstate', () => {
      this.handleDismissOrBack();
    });
  },

  handleDismissOrBack() {
    // إغلاق أي نافذة منبثقة مفتوحة
    const activeModals = document.querySelectorAll('.modal-overlay.active, .modal.active');
    if (activeModals.length > 0) {
      const topModal = activeModals[activeModals.length - 1];
      topModal.classList.remove('active');
      const remaining = document.querySelectorAll('.modal-overlay.active, .modal.active');
      if (remaining.length === 0) {
        document.body.style.overflow = '';
      }
      return true;
    }

    // إغلاق القائمة الجانبية إذا كانت مفتوحة
    const sidebar = document.querySelector('.sidebar');
    if (sidebar && sidebar.classList.contains('mobile-open')) {
      this.closeMobileSidebar();
      return true;
    }

    // إغلاق قائمة الإشعارات إذا كانت مفتوحة
    const dropdown = document.getElementById('notificationsDropdown');
    if (dropdown && dropdown.classList.contains('active')) {
      dropdown.classList.remove('active');
      return true;
    }

    return false;
  },

  // ============================================
  // 🌙☀️ تبديل الوضع الليلي / النهاري
  // ============================================
  initTheme() {
    // استرجاع الوضع المحفوظ من localStorage
    const savedTheme = localStorage.getItem('rawasi_theme') || 'dark';
    this.applyTheme(savedTheme);
  },

  toggleTheme() {
    const isLight = document.body.classList.contains('light-mode');
    const newTheme = isLight ? 'dark' : 'light';
    localStorage.setItem('rawasi_theme', newTheme);
    this.applyTheme(newTheme);

    // تلميح مرئي للمستخدم
    const label = newTheme === 'light' ? 'نهاري' : 'ليلي';
    this.showToast(`تم التبديل إلى الوضع ${label} ✨`, 'info');
  },

  applyTheme(theme) {
    const isLight = theme === 'light';
    document.body.classList.toggle('light-mode', isLight);
    document.documentElement.classList.toggle('light-mode', isLight);

    // تحديث نص وأيقونة زر التبديل
    const label = document.getElementById('themeToggleLabel');
    if (label) label.textContent = isLight ? 'نهاري' : 'ليلي';

    // تحديث meta theme-color للمتصفح
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', isLight ? '#16304f' : '#0f172a');
  },

  // التحكم بالقوائم الشجرية المنسدلة (Accordion Groups)
  toggleNavGroup(groupId) {
    const groupEl = document.getElementById(groupId);
    if (!groupEl) return;
    const isOpen = groupEl.classList.contains('open');
    groupEl.classList.toggle('open', !isOpen);
  },

  // التنقل الشجري العميق إلى إدارة وتبويب محدد
  async navigateDeep(viewId, subTab, clickedEl = null) {
    // فتح مجموعة القائمة الحاضنة للتبويب
    if (clickedEl) {
      const parentGroup = clickedEl.closest('.nav-group');
      if (parentGroup) parentGroup.classList.add('open');
      document.querySelectorAll('.nav-sub-item').forEach(el => el.classList.remove('active'));
      clickedEl.classList.add('active');
    }

    // الانتقال للشاشة الرئيسية أولاً وتحميل حزمتها البرمجية
    await this.navigate(viewId, null);

    // تحديث مسار التنقل الدلالي ليشمل التبويب المتخصص
    if (window.UI && UI.Breadcrumbs) {
      UI.Breadcrumbs.update(viewId, subTab);
    }

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
  async navigateProjectHubSection(sectionNumber) {
    await this.navigate('projectHub');
    if (typeof ProjectHub !== 'undefined') {
      if (ProjectHub.switchSection) {
        ProjectHub.switchSection(sectionNumber);
      } else if (ProjectHub.showSection) {
        ProjectHub.showSection(sectionNumber);
      }
    }
  },

  // التنقل بين الأقسام والشاشات مع التحميل عند الطلب (Code Splitting)
  async navigate(viewId, clickedEl = null) {
    // التحقق الأمني من صلاحية المستخدم للوصول للشاشة لمنع أي تلاعب عبر الـ DOM أو الكونسول
    if (typeof Auth !== 'undefined' && typeof Auth.canAccessView === 'function') {
      if (!Auth.canAccessView(viewId)) {
        console.warn(`[Security] تم رفض الوصول للشاشة: ${viewId} لعدم كفاية الصلاحيات.`);
        if (typeof this.showToast === 'function') {
          this.showToast('⛔ عذراً، لا تملك الصلاحية الكافية للوصول إلى هذا القسم.', 'error');
        }
        return false;
      }
    }

    // تحميل الوحدات المطلوبة للشاشة المستهدفة كودياً عند الطلب
    await this.loadModulesForView(viewId);

    // تهيئة الوحدة في حال لم يتم تهيئتها بعد
    if (viewId === 'projects' && typeof Projects !== 'undefined' && !Projects._initialized && Projects.init) {
      await Projects.init();
      Projects._initialized = true;
    } else if (viewId === 'projectHub' && typeof ProjectHub !== 'undefined' && !ProjectHub._initialized && ProjectHub.init) {
      await ProjectHub.init();
      ProjectHub._initialized = true;
    } else if (['revenues', 'expenses', 'custody', 'journal', 'chartOfAccounts', 'costCenters', 'currencies', 'cash'].includes(viewId)) {
      if (typeof Accounting !== 'undefined' && !Accounting._initialized && Accounting.init) {
        await Accounting.init();
        Accounting._initialized = true;
      }
    } else if (viewId === 'inventory' && typeof Inventory !== 'undefined' && !Inventory._initialized && Inventory.init) {
      await Inventory.init();
      Inventory._initialized = true;
    } else if (viewId === 'hr' && typeof HR !== 'undefined' && !HR._initialized && HR.init) {
      HR.init();
      HR._initialized = true;
    } else if (viewId === 'settings' && typeof Settings !== 'undefined' && !Settings._initialized && Settings.init) {
      await Settings.init();
      Settings._initialized = true;
    } else if (viewId === 'reports' && typeof Reports !== 'undefined' && !Reports._initialized && Reports.init) {
      await Reports.init();
      Reports._initialized = true;
    }

    this.activeView = viewId;
    this.closeMobileSidebar();

    // تحديث مسار التنقل الدلالي تلقائياً
    if (window.UI && UI.Breadcrumbs) {
      UI.Breadcrumbs.update(viewId);
    }

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
    const accountingViews = ['journal', 'revenues', 'expenses', 'custody', 'chartOfAccounts', 'costCenters', 'currencies', 'cash'];
    const projectViews = ['projects', 'projectHub'];

    document.querySelectorAll('.bottom-nav-item').forEach(btn => {
      const navTarget = btn.getAttribute('data-nav');
      if (!navTarget) return;

      let isMatch = (navTarget === viewId);
      if (navTarget === 'projects' && projectViews.includes(viewId)) isMatch = true;
      if (navTarget === 'journal' && accountingViews.includes(viewId)) isMatch = true;

      if (isMatch) {
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
    } else if (viewId === 'chartOfAccounts') {
      Accounting.loadAccounts();
    } else if (viewId === 'costCenters') {
      Accounting.loadCostCenters();
    } else if (viewId === 'currencies') {
      Accounting.loadCurrencies();
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
    const tbody = document.getElementById('fullRevenuesTableBody');
    if (tbody && window.UI && UI.Skeleton) {
      UI.Skeleton.showTableSkeleton(tbody, 5, 10);
    }

    try {
      const res = await fetch('/api/payments?type=قبض');
      const json = await res.json();
      if (json.success) {
        const list = json.data || [];
        const total = list.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
        const kpiTotal = document.getElementById('revKpiTotal');
        const kpiCount = document.getElementById('revKpiCount');
        if (kpiTotal) kpiTotal.textContent = this.formatNumber(total);
        if (kpiCount) kpiCount.textContent = list.length;

        if (tbody) {
          if (list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 20px; color: var(--text-secondary);">لا توجد سندات قبض مسجلة حتى الآن</td></tr>`;
            const pag = document.getElementById('revenuesPagination');
            if (pag) pag.innerHTML = '';
          } else {
            const renderSingleRow = (p) => {
              const accStr = p.account_code ? `${p.account_code} - ${p.account_name}` : (p.account_name || '-');
              const ccStr = p.cost_center_code ? `${p.cost_center_code} - ${p.cost_center_name}` : (p.cost_center_name || '-');
              const paymentStr = p.payment_method === 'شيك' 
                ? `<span class="badge badge-active" style="background: rgba(212, 175, 55, 0.2); color: var(--gold-light); border: 1px solid var(--gold-light);">شيك: ${p.check_no || 'غير محدد'}</span>`
                : `<span class="badge badge-active">${p.payment_method}</span>`;

              return `
                <tr>
                  <td><strong style="color: var(--gold-light); font-family: monospace;">${p.receipt_no}</strong></td>
                  <td>${p.date}</td>
                  <td><strong>${p.client_name || '-'}</strong></td>
                  <td><span style="font-size: 0.82rem; color: #94a3b8;">${accStr}</span></td>
                  <td><span style="font-size: 0.82rem; color: #38bdf8;">${ccStr}</span></td>
                  <td>${p.project_name || '-'}</td>
                  <td style="color: var(--accent-green); font-weight: bold;">${this.formatNumber(p.amount)} ${p.currency || 'ر.ي'}</td>
                  <td>${paymentStr}</td>
                  <td>${p.notes || '-'}</td>
                  <td style="text-align: center;">
                    <button class="btn btn-secondary btn-sm" onclick="Accounting.printReceipt({
                      receipt_no: '${p.receipt_no}',
                      date: '${p.date}',
                      client_name: '${(p.client_name || 'العميل').replace(/'/g, "\\'")}',
                      account_code: '${p.account_code || ''}',
                      account_name: '${(p.account_name || '').replace(/'/g, "\\'")}',
                      cost_center_code: '${p.cost_center_code || ''}',
                      cost_center_name: '${(p.cost_center_name || '').replace(/'/g, "\\'")}',
                      project_name: '${(p.project_name || '-').replace(/'/g, "\\'")}',
                      amount: ${p.amount},
                      currency: '${p.currency || 'ر.ي'}',
                      payment_method: '${p.payment_method}',
                      check_no: '${(p.check_no || '').replace(/'/g, "\\'")}',
                      bank_name: '${(p.bank_name || '').replace(/'/g, "\\'")}',
                      notes: '${(p.notes || '').replace(/'/g, "\\'")}'
                    })">
                      <svg class="icon"><use href="#icon-print"></use></svg>
                      <span>طباعة</span>
                    </button>
                  </td>
                </tr>
              `;
            };

            const renderRows = (pageList) => {
              if (pageList.length > 30 && window.UI && UI.VirtualTable) {
                UI.VirtualTable.attach({
                  tableBodyId: 'fullRevenuesTableBody',
                  data: pageList,
                  rowHeight: 46,
                  renderRow: renderSingleRow
                });
              } else {
                tbody.innerHTML = pageList.map(renderSingleRow).join('');
              }
            };

            if (window.UI && UI.Pagination && document.getElementById('revenuesPagination')) {
              UI.Pagination.create({
                containerId: 'revenuesPagination',
                data: list,
                pageSize: 15,
                onPageChange: (pageData) => renderRows(pageData)
              });
            } else {
              renderRows(list);
            }
          }
        }
      }
    } catch (e) {
      console.error('Error loading revenues:', e);
    }
  },

  async loadExpensesTable() {
    const tbody = document.getElementById('fullExpensesTableBody');
    if (tbody && window.UI && UI.Skeleton) {
      UI.Skeleton.showTableSkeleton(tbody, 5, 10);
    }

    try {
      const res = await fetch('/api/expenses');
      const json = await res.json();
      if (json.success) {
        const list = json.data || [];
        const total = list.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
        const kpiTotal = document.getElementById('expKpiTotal');
        const kpiCount = document.getElementById('expKpiCount');
        if (kpiTotal) kpiTotal.textContent = this.formatNumber(total);
        if (kpiCount) kpiCount.textContent = list.length;

        if (tbody) {
          if (list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="11" style="text-align: center; padding: 20px; color: var(--text-secondary);">لا توجد سندات صرف مسجلة حتى الآن</td></tr>`;
            const pag = document.getElementById('expensesPagination');
            if (pag) pag.innerHTML = '';
          } else {
            const renderSingleRow = (e) => {
              const accStr = e.account_code ? `${e.account_code} - ${e.account_name}` : (e.account_name || '-');
              const ccStr = e.cost_center_code ? `${e.cost_center_code} - ${e.cost_center_name}` : (e.cost_center_name || '-');
              const paymentStr = e.payment_method === 'شيك' 
                ? `<span class="badge badge-active" style="background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4);">شيك: ${e.check_no || 'غير محدد'}</span>`
                : `<span class="badge badge-active">${e.payment_method}</span>`;

              return `
                <tr>
                  <td><strong style="color: var(--accent-red); font-family: monospace;">${e.receipt_no}</strong></td>
                  <td>${e.date}</td>
                  <td><span class="badge badge-expense">${e.expense_type}</span></td>
                  <td><span style="font-size: 0.82rem; color: #94a3b8;">${accStr}</span></td>
                  <td><span style="font-size: 0.82rem; color: #38bdf8;">${ccStr}</span></td>
                  <td>${e.project_name || '-'}</td>
                  <td><strong>${e.supplier_name || '-'}</strong></td>
                  <td style="color: var(--accent-red); font-weight: bold;">${this.formatNumber(e.amount)} ${e.currency || 'ر.ي'}</td>
                  <td>${paymentStr}</td>
                  <td>${e.notes || '-'}</td>
                  <td style="text-align: center;">
                    <button class="btn btn-secondary btn-sm" onclick="Accounting.printExpenseReceipt({
                      receipt_no: '${e.receipt_no}',
                      date: '${e.date}',
                      expense_type: '${(e.expense_type || '').replace(/'/g, "\\'")}',
                      account_code: '${e.account_code || ''}',
                      account_name: '${(e.account_name || '').replace(/'/g, "\\'")}',
                      cost_center_code: '${e.cost_center_code || ''}',
                      cost_center_name: '${(e.cost_center_name || '').replace(/'/g, "\\'")}',
                      supplier_name: '${(e.supplier_name || '-').replace(/'/g, "\\'")}',
                      project_name: '${(e.project_name || '-').replace(/'/g, "\\'")}',
                      amount: ${e.amount},
                      currency: '${e.currency || 'ر.ي'}',
                      payment_method: '${e.payment_method}',
                      check_no: '${(e.check_no || '').replace(/'/g, "\\'")}',
                      bank_name: '${(e.bank_name || '').replace(/'/g, "\\'")}',
                      notes: '${(e.notes || '').replace(/'/g, "\\'")}'
                    })">
                      <svg class="icon"><use href="#icon-print"></use></svg>
                      <span>طباعة</span>
                    </button>
                  </td>
                </tr>
              `;
            };

            const renderRows = (pageList) => {
              if (pageList.length > 30 && window.UI && UI.VirtualTable) {
                UI.VirtualTable.attach({
                  tableBodyId: 'fullExpensesTableBody',
                  data: pageList,
                  rowHeight: 46,
                  renderRow: renderSingleRow
                });
              } else {
                tbody.innerHTML = pageList.map(renderSingleRow).join('');
              }
            };

            if (window.UI && UI.Pagination && document.getElementById('expensesPagination')) {
              UI.Pagination.create({
                containerId: 'expensesPagination',
                data: list,
                pageSize: 15,
                onPageChange: (pageData) => renderRows(pageData)
              });
            } else {
              renderRows(list);
            }
          }
        }
      }
    } catch (e) {
      console.error('Error loading expenses:', e);
    }
  },

  async loadCustodyTable() {
    const tbody = document.getElementById('fullCustodyTableBody');
    if (tbody && window.UI && UI.Skeleton) {
      UI.Skeleton.showTableSkeleton(tbody, 5, 9);
    }

    try {
      const res = await fetch('/api/accounting/custodies');
      const json = await res.json();
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
            tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 20px; color: var(--text-secondary);">لا توجد حركات عهد مسجلة</td></tr>`;
            const pag = document.getElementById('custodyPagination');
            if (pag) pag.innerHTML = '';
          } else {
            const renderRows = (pageList) => {
              tbody.innerHTML = pageList.map(c => {
                const empDisplay = `<strong>${c.employee_name}</strong>${c.employee_no ? `<br><small style="color: var(--gold-light); font-family: monospace; font-weight: bold;">(الرقم: ${c.employee_no})</small>` : ''}`;
                const origCustodyDisplay = c.related_custody_no 
                  ? `<span style="color: #38bdf8; font-weight: bold; font-family: monospace;">تصفية لـ: ${c.related_custody_no}</span>`
                  : `<span style="color: var(--text-secondary);">-</span>`;

                return `
                  <tr>
                    <td>${c.date}</td>
                    <td>${empDisplay}</td>
                    <td>
                      <span class="badge ${c.operation_type === 'تصفية عهدة' ? 'badge-income' : 'badge-active'}">${c.operation_type}</span>
                      ${c.custody_no ? `<br><small style="font-family: monospace; color: var(--gold-light); font-weight: bold;">${c.custody_no}</small>` : ''}
                    </td>
                    <td>${origCustodyDisplay}</td>
                    <td>${this.formatNumber(c.total_amount)} ${c.currency || 'ر.ي'}</td>
                    <td style="color: var(--accent-red); font-weight: bold;">${this.formatNumber(c.spent_amount)} ${c.currency || 'ر.ي'}</td>
                    <td style="color: var(--accent-green); font-weight: bold;">${this.formatNumber(c.remaining_amount)} ${c.currency || 'ر.ي'}</td>
                    <td>${c.notes || '-'}</td>
                    <td style="text-align: center; white-space: nowrap;">
                      <div style="display: inline-flex; gap: 4px; align-items: center; justify-content: center;">
                        ${c.operation_type === 'صرف عهدة' && Number(c.remaining_amount) > 0 ? `
                          <button class="btn btn-sm btn-primary" title="تصفية هذه العهدة بحسب عملية الصرف" onclick="Accounting.openSettleCustodyModal(${c.id}, '${c.custody_no || ('CST-' + c.id)}', '${(c.employee_name || '').replace(/'/g, "\\'")}', ${c.employee_id || 'null'}, ${c.remaining_amount}, '${c.currency || 'ر.ي'}')">
                            ⚖️ تصفية
                          </button>
                        ` : (c.operation_type === 'تصفية عهدة' ? `<span class="badge badge-income">مصفاة</span>` : `<span class="badge badge-inactive">مسددة</span>`)}
                        <button class="btn btn-sm btn-secondary" title="طباعة سند العهدة / التصفية" onclick="Accounting.printCustodyReceipt({
                          id: ${c.id},
                          custody_no: '${c.custody_no || ('CST-' + c.id)}',
                          date: '${c.date}',
                          operation_type: '${c.operation_type || 'صرف عهدة'}',
                          employee_name: '${(c.employee_name || '').replace(/'/g, "\\'")}',
                          employee_no: '${(c.employee_no || '').replace(/'/g, "\\'")}',
                          related_custody_id: ${c.related_custody_id || 'null'},
                          related_custody_no: '${(c.related_custody_no || '').replace(/'/g, "\\'")}',
                          total_amount: ${c.total_amount || 0},
                          spent_amount: ${c.spent_amount || 0},
                          remaining_amount: ${c.remaining_amount || 0},
                          currency: '${c.currency || 'ر.ي'}',
                          notes: '${(c.notes || '').replace(/'/g, "\\'")}'
                        })">
                          🖨️ طباعة
                        </button>
                      </div>
                    </td>
                  </tr>
                `;
              }).join('');
            };

            if (window.UI && UI.Pagination && document.getElementById('custodyPagination')) {
              UI.Pagination.create({
                containerId: 'custodyPagination',
                data: list,
                pageSize: 15,
                onPageChange: (pageData) => renderRows(pageData)
              });
            } else {
              renderRows(list);
            }
          }
        }
      }
    } catch (e) {
      console.error('Error loading custodies:', e);
    }
  },

  async loadClientsTable() {
    const tbody = document.getElementById('fullClientsTableBody');
    if (tbody && window.UI && UI.Skeleton) {
      UI.Skeleton.showTableSkeleton(tbody, 5, 8);
    }

    try {
      const res = await fetch('/api/clients');
      const json = await res.json();
      if (tbody && json.success) {
        const list = json.data || [];
        if (list.length === 0) {
          tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 20px; color: var(--text-secondary);">لا يوجد عملاء مسجلين</td></tr>`;
          const pag = document.getElementById('clientsPagination');
          if (pag) pag.innerHTML = '';
        } else {
          const renderRows = (pageList) => {
            tbody.innerHTML = pageList.map(c => `
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
          };

          if (window.UI && UI.Pagination && document.getElementById('clientsPagination')) {
            UI.Pagination.create({
              containerId: 'clientsPagination',
              data: list,
              pageSize: 15,
              onPageChange: (pageData) => renderRows(pageData)
            });
          } else {
            renderRows(list);
          }
        }
      }
    } catch (e) {}
  },

  async loadSuppliersTable() {
    const tbody = document.getElementById('fullSuppliersTableBody');
    if (tbody && window.UI && UI.Skeleton) {
      UI.Skeleton.showTableSkeleton(tbody, 5, 7);
    }

    try {
      const res = await fetch('/api/suppliers');
      const json = await res.json();
      if (tbody && json.success) {
        const list = json.data || [];
        if (list.length === 0) {
          tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 20px; color: var(--text-secondary);">لا يوجد موردين مسجلين</td></tr>`;
          const pag = document.getElementById('suppliersPagination');
          if (pag) pag.innerHTML = '';
        } else {
          const renderRows = (pageList) => {
            tbody.innerHTML = pageList.map(s => `
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
          };

          if (window.UI && UI.Pagination && document.getElementById('suppliersPagination')) {
            UI.Pagination.create({
              containerId: 'suppliersPagination',
              data: list,
              pageSize: 15,
              onPageChange: (pageData) => renderRows(pageData)
            });
          } else {
            renderRows(list);
          }
        }
      }
    } catch (e) {}
  },

  async loadCashTable() {
    const tbody = document.getElementById('fullCashTableBody');
    if (tbody && window.UI && UI.Skeleton) {
      UI.Skeleton.showTableSkeleton(tbody, 5, 7);
    }

    try {
      const res = await fetch('/api/accounting/cash-movements');
      const json = await res.json();
      if (tbody && json.success) {
        const list = json.data || [];
        if (list.length === 0) {
          tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 20px; color: var(--text-secondary);">لا توجد حركات نقدية مسجلة</td></tr>`;
          const pag = document.getElementById('cashPagination');
          if (pag) pag.innerHTML = '';
        } else {
          const renderRows = (pageList) => {
            tbody.innerHTML = pageList.map(m => `
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
          };

          if (window.UI && UI.Pagination && document.getElementById('cashPagination')) {
            UI.Pagination.create({
              containerId: 'cashPagination',
              data: list,
              pageSize: 15,
              onPageChange: (pageData) => renderRows(pageData)
            });
          } else {
            renderRows(list);
          }
        }
      }
    } catch (e) {}
  },


  // النوافذ المنبثقة
  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('active');
      document.body.style.overflow = 'hidden';

      // فحص واستعادة المسودات المحفوظة تلقائياً للنموذج
      const form = modal.querySelector('form');
      if (form && form.id && window.UI && UI.DraftManager) {
        UI.DraftManager.checkAndPromptDraft(form.id);
      }
    }
  },

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('active');
      const anyOtherModal = document.querySelectorAll('.modal-overlay.active, .modal.active');
      if (anyOtherModal.length === 0) {
        document.body.style.overflow = '';
      }
    }
  },

  // رسائل التنبيه العائمة الفاخرة متعددة الطبقات (Toast Suite)
  showToast(message, type = 'info', action = null, duration = 4500) {
    // التوجيه إلى وحدة UI.Toast المتطورة مع شريط العد التنازلي والتراجع
    if (window.UI && UI.Toast) {
      return UI.Toast.show(message, type, action, duration);
    }

    const existing = document.querySelectorAll('.toast-msg');
    existing.forEach(t => t.remove());

    const toast = document.createElement('div');
    toast.className = `toast-msg toast-${type}`;

    let icon = '🔔';
    if (type === 'success') icon = '✅';
    else if (type === 'error') icon = '⚠️';
    else if (type === 'warning') icon = '⚡';
    else if (type === 'info') icon = 'ℹ️';

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

    requestAnimationFrame(() => {
      toast.classList.add('toast-visible');
    });

    setTimeout(() => {
      if (toast.parentElement) {
        toast.classList.remove('toast-visible');
        setTimeout(() => {
          if (toast.parentElement) toast.remove();
        }, 350);
      }
    }, duration);
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
