/**
 * المكونات المشتركة وواجهة المستخدم لتطبيق العميل (Client App UI Helpers)
 * لنظام شركة رواسي عدن للهندسة والمقاولات
 */

const ClientApp = {
  activeTab: 'dashboard',

  init(activeTab = 'dashboard') {
    this.activeTab = activeTab;
    this.renderHeader();
    this.renderBottomNav();
    this.setupToastContainer();
    this.updateNotificationBadge();
  },

  renderHeader() {
    const headerContainer = document.getElementById('appHeader');
    if (!headerContainer) return;

    headerContainer.innerHTML = `
      <div class="top-header">
        <div class="brand-wrapper">
          <div class="brand-logo">
            <img src="images/logo_clean.png" onerror="this.onerror=null; this.src='images/logo.png';" alt="رواسي عدن" style="width: 100%; height: 100%; object-fit: contain;">
          </div>
          <div class="brand-info">
            <h1>رواسي عدن</h1>
            <p>بوابة وخدمات العملاء</p>
          </div>
        </div>
        <div class="header-actions">
          <a href="notifications.html" class="icon-btn" title="الإشعارات">
            <i class="fa-solid fa-bell"></i>
            <span id="notifBadgeDot" class="badge-dot" style="display: none;"></span>
          </a>
          <a href="profile.html" class="icon-btn" title="الملف الشخصي">
            <i class="fa-solid fa-user-gear"></i>
          </a>
        </div>
      </div>
      <div id="offlineBanner" class="offline-banner">
        <i class="fa-solid fa-wifi-slash"></i> تم فقد الاتصال بالإنترنت - يتم عرض البيانات المحفوظة محلياً
      </div>
    `;
  },

  renderBottomNav() {
    const navContainer = document.getElementById('bottomNav');
    if (!navContainer) return;

    const tabs = [
      { id: 'dashboard', label: 'الرئيسية', icon: 'fa-gauge-high', url: 'dashboard.html' },
      { id: 'projects', label: 'المشاريع', icon: 'fa-city', url: 'projects.html' },
      { id: 'invoices', label: 'المستخلصات', icon: 'fa-file-invoice-dollar', url: 'invoices.html' },
      { id: 'payments', label: 'الدفعات', icon: 'fa-money-bill-wave', url: 'payments.html' },
      { id: 'messages', label: 'الرسائل', icon: 'fa-comments', url: 'messages.html' }
    ];

    navContainer.innerHTML = `
      <nav class="bottom-nav">
        ${tabs.map(tab => `
          <a href="${tab.url}" class="nav-item ${this.activeTab === tab.id ? 'active' : ''}">
            <i class="fa-solid ${tab.icon}"></i>
            <span>${tab.label}</span>
          </a>
        `).join('')}
      </nav>
    `;
  },

  async updateNotificationBadge() {
    try {
      const data = await window.ClientAPI.get('/notifications');
      if (data && data.unread_count > 0) {
        const dot = document.getElementById('notifBadgeDot');
        if (dot) dot.style.display = 'block';
      }
    } catch {}
  },

  setupToastContainer() {
    if (!document.getElementById('toastContainer')) {
      const container = document.createElement('div');
      container.id = 'toastContainer';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
  },

  showToast(message, type = 'info') {
    this.setupToastContainer();
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icon = type === 'success' ? 'fa-circle-check' : (type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-info');
    toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span></span>`;
    toast.querySelector('span').textContent = String(message ?? '');
    
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  },

  escape(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  /** بطاقات هيكلية تظهر أثناء التحميل بدل نص "جاري التحميل" */
  skeletonCards(count = 3, label = 'جاري التحميل') {
    const card = '<div class="sk-card"><div class="sk-row"><span class="sk-line lg w-40"></span><span class="sk-line w-30"></span></div><span class="sk-line w-80"></span><span class="sk-line w-60"></span></div>';
    return `<div class="sk-list" role="status" aria-busy="true" aria-label="${this.escape(label)}">${card.repeat(count)}</div>`;
  },

  /** حالة فارغة واضحة: أيقونة + عنوان + شرح + إجراء اختياري */
  emptyState({ icon = 'fa-inbox', title, text = '', actionHref = '', actionLabel = '' }) {
    const action = actionHref && actionLabel ? `<a class="btn btn-primary" href="${this.escape(actionHref)}">${this.escape(actionLabel)}</a>` : '';
    return `<div class="empty-state"><div class="empty-state__icon"><i class="fa-solid ${this.escape(icon)}"></i></div><h3>${this.escape(title)}</h3>${text ? `<p>${this.escape(text)}</p>` : ''}${action}</div>`;
  },

  /** رسالة خطأ مع زر إعادة المحاولة (بدل ترك الصفحة فارغة أو عالقة على التحميل) */
  errorState(message, retryLabel = 'إعادة المحاولة') {
    return `<div class="empty-state is-error" role="alert"><div class="empty-state__icon"><i class="fa-solid fa-triangle-exclamation"></i></div><h3>تعذر تحميل البيانات</h3><p>${this.escape(message || 'تحقق من اتصالك بالإنترنت ثم أعد المحاولة.')}</p><button type="button" class="btn btn-secondary" onclick="location.reload()"><i class="fa-solid fa-rotate-right"></i> ${this.escape(retryLabel)}</button></div>`;
  },

  formatMoney(num, currency = 'ر.ي') {
    if (num === null || num === undefined || isNaN(num)) return `0 ${currency}`;
    const formatted = Number(num).toLocaleString('ar-YE', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    });
    return `${formatted} ${currency}`;
  },

  // نسبة الإنجاز: الخادم يرسل null عندما لا يملك المستخدم صلاحية عرضها، فتُعرض "غير متاح" لا 0%
  isHidden(value) {
    return value === null || value === undefined;
  },

  formatProgress(value) {
    return this.isHidden(value) ? 'غير متاح' : `${Number(value) || 0}%`;
  },

  progressWidth(value) {
    return this.isHidden(value) ? 0 : Math.min(100, Math.max(0, Number(value) || 0));
  },

  formatDate(dateStr) {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('ar-YE', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return dateStr;
    }
  }
};

window.ClientApp = ClientApp;
