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
            <i class="fa-solid fa-helmet-safety"></i>
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
    toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
    
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  },

  formatMoney(num, currency = 'ر.ي') {
    if (num === null || num === undefined || isNaN(num)) return `0 ${currency}`;
    const formatted = Number(num).toLocaleString('ar-YE', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    });
    return `${formatted} ${currency}`;
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
