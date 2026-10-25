/* Sidebar navigation: real module routes, permission-aware search and active state. */
const Sidebar = {
  init() {
    document.getElementById('sidebarSearch')?.addEventListener('input', () => this.filter());
    document.getElementById('sidebarSearchClear')?.addEventListener('click', () => {
      document.getElementById('sidebarSearch').value = ''; this.filter(); document.getElementById('sidebarSearch').focus();
    });
    this.refresh(); this.sync(App.activeView || 'dashboard');
  },
  normalize(text) { return String(text).normalize('NFKD').replace(/[\u064b-\u065f\u0670ـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').toLowerCase(); },
  refresh() {
    document.querySelectorAll('#sidebarNavList .nav-group').forEach(group => {
      const permitted = [...group.querySelectorAll('[data-nav-leaf]')].filter(row => typeof Auth === 'undefined' || Auth.hasPermission(row.dataset.perm));
      group.dataset.permitted = String(permitted.length > 0);
      group.querySelector('.nav-group-count').textContent = permitted.length;
      group.style.display = permitted.length ? '' : 'none';
    });
    const count = [...document.querySelectorAll('#sidebarNavList .nav-group')].filter(group => group.dataset.permitted === 'true').length;
    const label = document.getElementById('sidebarGroupCount'); if (label) label.textContent = count + ' أقسام';
    this.filter();
  },
  setOpen(group, open) {
    group.classList.toggle('open', open);
    group.querySelector('.nav-group-header').setAttribute('aria-expanded', String(open));
  },
  filter() {
    const query = this.normalize(document.getElementById('sidebarSearch')?.value || '').trim();
    let matches = 0;
    document.querySelectorAll('#sidebarNavList .nav-group').forEach(group => {
      if (query && !this.searching) group.dataset.wasOpen = String(group.classList.contains('open'));
      const groupMatch = this.normalize(group.querySelector('.nav-group-name').textContent).includes(query);
      let visible = 0;
      group.querySelectorAll('[data-nav-leaf]').forEach(row => {
        const allowed = typeof Auth === 'undefined' || Auth.hasPermission(row.dataset.perm);
        const show = allowed && (!query || groupMatch || this.normalize(row.textContent).includes(query));
        row.hidden = !show; row.style.display = show ? '' : 'none'; if (show) visible++;
      });
      group.querySelectorAll('.nav-sub-section').forEach(section => { section.hidden = ![...section.querySelectorAll('[data-nav-leaf]')].some(row => !row.hidden); });
      group.hidden = visible === 0; group.style.display = visible ? '' : 'none';
      if (query) this.setOpen(group, visible > 0);
      else if (this.searching) this.setOpen(group, group.dataset.wasOpen === 'true');
      matches += visible;
    });
    this.searching = Boolean(query);
    const empty = document.getElementById('sidebarEmpty'); if (empty) empty.hidden = !query || matches > 0;
    const clear = document.getElementById('sidebarSearchClear'); if (clear) clear.hidden = !query;
  },
  sync(view, tab) {
    const links = [...document.querySelectorAll('#sidebarNavList a[data-view]')];
    const moduleTab = tab || ({ reports: typeof Reports !== 'undefined' ? Reports.activeReportTab : '', projectHub: typeof ProjectHub !== 'undefined' ? ProjectHub.activeTab : '', settings: typeof Settings !== 'undefined' ? Settings.activeTab : '', inventory: typeof Inventory !== 'undefined' ? Inventory.activeTab : '' })[view] || '';
    const matched = links.find(link => link.dataset.view === view && link.dataset.tab === moduleTab && !link.dataset.navAction) || links.find(link => link.dataset.view === view && !link.dataset.navAction);
    for (const link of links) { const active = link === matched; link.classList.toggle('active', active); if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); }
    document.querySelectorAll('#sidebarNavList .nav-group').forEach(group => group.classList.toggle('has-active', Boolean(matched && group.contains(matched))));
    if (matched?.closest('.nav-group')) this.setOpen(matched.closest('.nav-group'), true);
  },
  async open(link) {
    const view = link.dataset.view, tab = link.dataset.tab || '', action = link.dataset.navAction || '';
    const permission = link.closest('[data-perm]')?.dataset.perm;
    if (typeof Auth !== 'undefined' && permission && !Auth.hasPermission(permission)) return App.showToast('لا تملك صلاحية الوصول إلى هذه العملية', 'error');
    try {
      if (action === 'connection') { App.showConnectionModal(); return; }
      if (tab) { if (await App.navigateDeep(view, tab) === false) return; } else if (await App.navigate(view) === false) return;
      if (action === 'client') Accounting.openNewClientModal();
      if (action === 'supplier') Accounting.openNewSupplierModal();
      if (action === 'periods') await Accounting.openPeriodsModal();
      this.sync(view, tab);
    } catch (error) { console.error('Navigation failed:', error); App.showToast('تعذر فتح العملية، يرجى المحاولة مجدداً', 'error'); }
  }
};
