/**
 * إدارة المشاريع والعقود ونسب الإنجاز - شركة رواسي عدن
 */

const Projects = {
  list: [],

  async init() {
    await this.loadProjects();
  },

  async loadProjects() {
    try {
      const res = await fetch('/api/projects');
      const json = await res.json();
      if (json.success) {
        this.list = json.data;
        if (this.currentStatusFilter && this.currentStatusFilter !== 'all') {
          this.filterStatus(this.currentStatusFilter);
        } else {
          this.renderProjectsTable();
        }
      }
    } catch (e) {
      console.error('Error loading projects:', e);
    }
  },

  currentStatusFilter: 'all',

  renderProjectsTable(projectsToRender = null) {
    const tableBodyDashboard = document.getElementById('projectsTableBody');
    const tableBodyFull = document.getElementById('fullProjectsTableBody');

    if (!tableBodyDashboard && !tableBodyFull) return;

    const data = projectsToRender || this.list;
    if (data.length === 0) {
      if (tableBodyDashboard) tableBodyDashboard.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 25px; color: var(--text-secondary);">لا توجد مشاريع مسجلة حالياً</td></tr>`;
      if (tableBodyFull) tableBodyFull.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 25px; color: var(--text-secondary);">لا توجد مشاريع مسجلة حالياً</td></tr>`;
      return;
    }

    const getStatusBadge = (s) => {
      if (s === 'under_study') return '<span class="badge badge-info">تحت الدراسة والتسعير</span>';
      if (s === 'completed') return '<span class="badge" style="background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid rgba(16,185,129,0.3);">مكتمل ومستلم</span>';
      return '<span class="badge badge-active">جاري التنفيذ</span>';
    };

    if (tableBodyDashboard) {
      tableBodyDashboard.innerHTML = data.map(p => {
        const progress = p.progress_percentage || 0;
        const curr = p.currency || 'ر.ي';
        return `
          <tr>
            <td>
              <strong>${p.name}</strong>
              <div style="font-size: 0.72rem; color: var(--text-secondary);">${p.code || ''}</div>
            </td>
            <td>${p.client_name || 'عميل مباشر'}</td>
            <td style="color: var(--gold-light); font-weight: 700;">${App.formatNumber(p.contract_value)} <small style="font-size:0.75rem">${curr}</small></td>
            <td>${App.formatNumber(p.estimated_cost)} <small style="font-size:0.75rem">${curr}</small></td>
            <td style="color: ${p.actual_cost > p.estimated_cost ? 'var(--accent-red)' : 'var(--text-primary)'}; font-weight: 600;">
              ${App.formatNumber(p.actual_cost)} <small style="font-size:0.75rem">${curr}</small>
            </td>
            <td style="min-width: 120px;">
              <div style="display: flex; align-items: center; gap: 6px;">
                <div class="progress-wrap">
                  <div class="progress-bar-fill" style="width: ${progress}%;"></div>
                </div>
                <span class="progress-text">${progress}%</span>
              </div>
            </td>
            <td style="color: var(--accent-blue); font-weight: 600;">${App.formatNumber(p.expected_profit)} <small style="font-size:0.75rem">${curr}</small></td>
            <td style="color: var(--accent-green); font-weight: 700;">${App.formatNumber(p.actual_profit)} <small style="font-size:0.75rem">${curr}</small></td>
            <td>
              <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                <button class="btn btn-secondary btn-sm" onclick="ProjectHub.openProject(${p.id})" title="مركز مستندات المشروع (16 قسم)" style="background: rgba(212,175,55,0.15); color: var(--gold-light); border-color: var(--gold-primary); font-weight: 700;">
                  📁 16 قسم
                </button>
                <button class="btn btn-secondary btn-sm" onclick="Projects.printProjectReport(${p.id})" title="طباعة تقرير المشروع" style="color: var(--gold-light); border-color: var(--gold-primary);">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/></svg>
                </button>
                <button class="btn btn-secondary btn-sm" onclick="Projects.viewDetails(${p.id})" title="عرض التفاصيل">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zm0 12.5c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
                </button>
                <button class="btn btn-danger btn-sm" onclick="Projects.deleteProject(${p.id})" title="حذف المشروع">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }

    if (tableBodyFull) {
      tableBodyFull.innerHTML = data.map(p => {
        const progress = p.progress_percentage || 0;
        const curr = p.currency || 'ر.ي';
        return `
          <tr>
            <td>
              <strong>${p.name}</strong>
              <div style="font-size: 0.72rem; color: var(--text-secondary);">${p.code || ''}</div>
            </td>
            <td>${p.client_name || 'عميل مباشر'}</td>
            <td>${getStatusBadge(p.status)}</td>
            <td style="color: var(--gold-light); font-weight: 700;">${App.formatNumber(p.contract_value)} <small style="font-size:0.75rem">${curr}</small></td>
            <td>${App.formatNumber(p.estimated_cost)} <small style="font-size:0.75rem">${curr}</small></td>
            <td style="color: ${p.actual_cost > p.estimated_cost ? 'var(--accent-red)' : 'var(--text-primary)'}; font-weight: 600;">
              ${App.formatNumber(p.actual_cost)} <small style="font-size:0.75rem">${curr}</small>
            </td>
            <td style="min-width: 120px;">
              <div style="display: flex; align-items: center; gap: 6px;">
                <div class="progress-wrap">
                  <div class="progress-bar-fill" style="width: ${progress}%;"></div>
                </div>
                <span class="progress-text">${progress}%</span>
              </div>
            </td>
            <td style="color: var(--accent-blue); font-weight: 600;">${App.formatNumber(p.expected_profit)} <small style="font-size:0.75rem">${curr}</small></td>
            <td style="color: var(--accent-green); font-weight: 700;">${App.formatNumber(p.actual_profit)} <small style="font-size:0.75rem">${curr}</small></td>
            <td>
              <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                <button class="btn btn-secondary btn-sm" onclick="ProjectHub.openProject(${p.id})" title="مركز مستندات المشروع (16 قسم)" style="background: rgba(212,175,55,0.15); color: var(--gold-light); border-color: var(--gold-primary); font-weight: 700;">
                  📁 16 قسم
                </button>
                <button class="btn btn-secondary btn-sm" onclick="Projects.printProjectReport(${p.id})" title="طباعة تقرير المشروع" style="color: var(--gold-light); border-color: var(--gold-primary);">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/></svg>
                </button>
                <button class="btn btn-secondary btn-sm" onclick="Projects.viewDetails(${p.id})" title="عرض التفاصيل">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zm0 12.5c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
                </button>
                <button class="btn btn-success btn-sm" onclick="Projects.exportFullProjectPackage(${p.id})" title="تصدير وتفريغ كافة ملفات وبيانات المشروع (إيرادات، مصروفات، نثريات وعهد، موردين، مخازن ومواد، صندوق وبنك) في مجلده الخاص" style="background: linear-gradient(135deg, #059669, #10b981); color: #fff; border: 1px solid #10b981; font-weight: bold; display: inline-flex; align-items: center; gap: 3px;">
                  <span>📦</span><span>تصدير</span>
                </button>
                <button class="btn btn-danger btn-sm" onclick="Projects.deleteProject(${p.id})" title="حذف المشروع">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }
  },

  filterStatus(status, clickedBtn) {
    this.currentStatusFilter = status;
    const btn = clickedBtn || document.getElementById('tabBtn_proj_' + status) || document.querySelector(`.report-tab-btn[onclick*="'${status}'"]`);
    if (btn) {
      const parent = btn.parentElement;
      if (parent) {
        parent.querySelectorAll('.report-tab-btn').forEach(b => b.classList.remove('active'));
      }
      btn.classList.add('active');
    }

    if (status === 'all') {
      this.renderProjectsTable(this.list);
    } else {
      const filtered = this.list.filter(p => (p.status || 'active') === status);
      this.renderProjectsTable(filtered);
    }
  },

  openNewModal() {
    // ملء قائمة العملاء في نموذج المشروع
    const select = document.getElementById('projClientSelect');
    if (select) {
      fetch('/api/clients').then(r => r.json()).then(res => {
        if (res.success) {
          select.innerHTML = `<option value="">اختر العميل...</option>` + 
            res.data.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
        }
      });
    }
    App.openModal('newProjectModal');
  },

  async submitNewProject(e) {
    if (e) e.preventDefault();
    const nameInput = document.getElementById('projName');
    const name = nameInput ? nameInput.value.trim() : '';
    const client_id = document.getElementById('projClientSelect')?.value;
    const contract_value = document.getElementById('projContractVal')?.value;
    const currency = document.getElementById('projCurrency')?.value || 'ر.ي';
    const estimated_cost = document.getElementById('projEstimatedCost')?.value || 0;
    const actual_cost = document.getElementById('projActualCost')?.value || 0;
    const progress_percentage = document.getElementById('projProgress')?.value || 0;
    const expected_profit = document.getElementById('projExpectedProfit')?.value || (Number(contract_value || 0) - Number(estimated_cost || 0));
    const actual_profit = document.getElementById('projActualProfit')?.value || (Number(contract_value || 0) - Number(actual_cost || 0));
    const notes = document.getElementById('projNotes')?.value || '';

    if (!name || !contract_value) {
      App.showToast('يرجى كتابة اسم المشروع وقيمة العقد أولاً', 'error');
      if (nameInput) nameInput.focus();
      return;
    }

    const form = document.getElementById('newProjectForm');
    const submitBtn = form ? form.querySelector('button[type="submit"]') : null;
    const originalBtnHtml = submitBtn ? submitBtn.innerHTML : 'حفظ المشروع';

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>⏳</span> جاري الحفظ والتحقق من قاعدة البيانات...';
    }

    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          client_id,
          contract_value,
          currency,
          estimated_cost,
          actual_cost,
          progress_percentage,
          expected_profit,
          actual_profit,
          notes
        })
      });
      const data = await res.json();

      if (res.ok && data.success && data.id) {
        // إظهار رسالة النجاح المؤكدة من قاعدة البيانات
        const successMsg = data.message || `تم حفظ المشروع (${name}) بنجاح وتأكيده في قاعدة البيانات`;
        App.showToast(successMsg, 'success');
        App.closeModal('newProjectModal');
        if (form) form.reset();

        // تحديث جدول المشاريع ومؤشرات لوحة التحكم والقوائم المنسدلة
        await this.loadProjects();
        if (typeof Reports !== 'undefined' && Reports.loadDashboardKPIs) {
          Reports.loadDashboardKPIs();
        }
        if (typeof Accounting !== 'undefined' && Accounting.loadDropdowns) {
          Accounting.loadDropdowns();
        }
      } else {
        App.showToast(data.message || 'فشل في حفظ المشروع في قاعدة البيانات', 'error');
      }
    } catch (err) {
      console.error('Error saving project:', err);
      App.showToast('فشل الاتصال بالخادم أو حفظ المشروع في قاعدة البيانات', 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnHtml;
      }
    }
  },

  async viewDetails(id) {
    try {
      const res = await fetch(`/api/projects/${id}`);
      const data = await res.json();
      if (data.success) {
        const p = data.data;
        this._currentProjectDetails = p;
        const body = document.getElementById('projectDetailsBody');
        if (body) {
          body.innerHTML = `
            <div style="background: rgba(255,255,255,0.03); padding: 16px; border-radius: var(--radius-md); margin-bottom: 16px; border: 1px solid var(--border-light);">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <h4 style="color: var(--gold-light); margin: 0;">${p.name} (${p.code})</h4>
                <button class="btn btn-secondary btn-sm" onclick="Projects.printCurrentProjectDetails()" style="color: var(--gold-light); border-color: var(--gold-primary);">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/></svg>
                  <span>طباعة التقرير</span>
                </button>
              </div>
              <p style="color: var(--text-secondary); font-size: 0.85rem;">العميل: <strong>${p.client_name || 'غير محدد'}</strong> | هاتف: ${p.client_phone || 'غير مسجل'}</p>
              <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 12px;">
                <div><span style="font-size:0.75rem; color:var(--text-secondary)">قيمة العقد:</span> <strong style="color:var(--gold-light)">${App.formatNumber(p.contract_value)} ${p.currency || 'ر.ي'}</strong></div>
                <div><span style="font-size:0.75rem; color:var(--text-secondary)">التكلفة الفعلية:</span> <strong>${App.formatNumber(p.actual_cost)} ${p.currency || 'ر.ي'}</strong></div>
                <div><span style="font-size:0.75rem; color:var(--text-secondary)">نسبة الإنجاز:</span> <strong style="color:var(--accent-green)">${p.progress_percentage}%</strong></div>
              </div>
            </div>

            <h5 style="margin-bottom: 8px; color: #fff;">المصروفات المسجلة على المشروع (${p.expenses?.length || 0}):</h5>
            <div class="table-responsive" style="max-height: 160px; margin-bottom: 16px;">
              <table class="custom-table">
                <thead><tr><th>رقم السند</th><th>النوع</th><th>المبلغ</th><th>التاريخ</th><th>ملاحظات</th></tr></thead>
                <tbody>
                  ${(p.expenses && p.expenses.length > 0) ? p.expenses.map(e => `
                    <tr>
                      <td>${e.receipt_no}</td>
                      <td>${e.expense_type}</td>
                      <td style="color:var(--accent-red)">${App.formatNumber(e.amount)}</td>
                      <td>${e.date}</td>
                      <td>${e.notes || '-'}</td>
                    </tr>
                  `).join('') : '<tr><td colspan="5" style="text-align:center">لا توجد مصروفات مباشرة</td></tr>'}
                </tbody>
              </table>
            </div>

            <h5 style="margin-bottom: 8px; color: #fff;">المستخلصات المعتمدة (${p.bills?.length || 0}):</h5>
            <div class="table-responsive" style="max-height: 160px;">
              <table class="custom-table">
                <thead><tr><th>رقم المستخلص</th><th>المبلغ</th><th>الاستقطاع</th><th>الصافي</th><th>الحالة</th></tr></thead>
                <tbody>
                  ${(p.bills && p.bills.length > 0) ? p.bills.map(b => `
                    <tr>
                      <td>${b.bill_no}</td>
                      <td>${App.formatNumber(b.amount)}</td>
                      <td>${App.formatNumber(b.deduction)}</td>
                      <td style="color:var(--accent-green); font-weight:bold;">${App.formatNumber(b.net_amount)}</td>
                      <td><span class="badge badge-income">${b.status}</span></td>
                    </tr>
                  `).join('') : '<tr><td colspan="5" style="text-align:center">لا توجد مستخلصات</td></tr>'}
                </tbody>
              </table>
            </div>
          `;
          App.openModal('projectDetailsModal');
        }
      }
    } catch (e) {
      App.showToast('تعذر جلب تفاصيل المشروع', 'error');
    }
  },

  printCurrentProjectDetails() {
    if (this._currentProjectDetails) {
      this.generateAndPrintProjectReport(this._currentProjectDetails);
    } else {
      App.showToast('لا توجد بيانات مشروع محددة للطباعة', 'error');
    }
  },

  async printProjectReport(id) {
    try {
      App.showToast('جاري تحضير وتجهيز تقرير المشروع للطباعة...', 'info');
      const res = await fetch(`/api/projects/${id}`);
      const data = await res.json();
      if (data.success && data.data) {
        this.generateAndPrintProjectReport(data.data);
      } else {
        App.showToast('تعذر جلب بيانات المشروع للطباعة', 'error');
      }
    } catch (e) {
      console.error('Error fetching project report:', e);
      App.showToast('خطأ في الاتصال بالخادم لتحضير التقرير', 'error');
    }
  },

  generateAndPrintProjectReport(p) {
    const printArea = document.getElementById('printArea');
    if (!printArea) return;

    const cfg = (typeof Settings !== 'undefined' && Settings.getPrintConfig) ? Settings.getPrintConfig() : {
      header_title: 'شركة رواسي عدن للهندسة والمقاولات',
      header_subtitle: 'عدن - الجمهورية اليمنية | هاتف: 773413937',
      header_en: 'Rawasi Aden for Engineering & Contracting',
      tax_no: 'س.ت: 102948 - ر.ض: 3004918',
      header_style: 'dynamic',
      table_density: 'medium',
      page_margins: 'normal',
      orientation: 'portrait',
      sig_position: 'end',
      show_logo: '1',
      show_stamp: '0',
      show_page_numbers: '1',
      show_print_time: '1',
      sig1: 'مهندس المشروع',
      sig2: 'الإدارة المالية',
      sig3: 'المدير العام',
      border_style: 'classic',
      accent_color: '#d4af37',
      footer_notes: 'تعتبر هذه التقارير والبيانات معتمدة رسمياً من إدارة شركة رواسي عدن للهندسة والمقاولات'
    };

    const curr = p.currency || 'ر.ي';
    const todayDate = new Date().toISOString().split('T')[0];
    const totalExpenses = (p.expenses || []).reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    const totalBills = (p.bills || []).reduce((sum, b) => sum + (Number(b.net_amount) || Number(b.amount) || 0), 0);
    const totalPayments = (p.payments || []).reduce((sum, pay) => sum + (Number(pay.amount) || 0), 0);
    const totalActualCost = Number(p.actual_cost) || (totalExpenses + totalBills) || 0;

    const docClass = (typeof Settings !== 'undefined' && Settings.getReportDocClass)
      ? Settings.getReportDocClass(cfg)
      : 'multi-page-report-document border-classic density-medium margins-normal';

    const timeStr = new Date().toLocaleTimeString('ar-YE', { hour: '2-digit', minute: '2-digit' });
    const userName = (typeof Settings !== 'undefined' && Settings.getCurrentUserName)
      ? Settings.getCurrentUserName()
      : ((typeof Auth !== 'undefined' && Auth.currentUser) ? (Auth.currentUser.full_name || Auth.currentUser.username) : 'علوي محمد باعبيد');

    const headerHtml = (typeof Settings !== 'undefined' && Settings.renderReportHeader)
      ? Settings.renderReportHeader('تقرير حساب وبيانات المشروع', [
          { label: 'كود المشروع', val: p.code || 'PRJ' },
          { label: 'تاريخ ووقت الطباعة', val: `${todayDate} - ${timeStr}` },
          { label: 'المستخدم المسجل بالمشروع', val: userName }
        ], cfg)
      : `
        <div class="letterhead-doc-header">
          <div class="letterhead-doc-title-badge">تقرير حساب وبيانات المشروع</div>
          <div class="letterhead-doc-meta">
            <div class="letterhead-doc-meta-item">كود المشروع: <strong>${p.code || 'PRJ'}</strong></div>
            <div class="letterhead-doc-meta-item">تاريخ ووقت الطباعة: <strong>${todayDate} - ${timeStr}</strong></div>
            <div class="letterhead-doc-meta-item">المستخدم المسجل بالمشروع: <strong>${userName}</strong></div>
          </div>
        </div>
      `;

    const sigHtml = (typeof Settings !== 'undefined' && Settings.renderReportSignatures)
      ? Settings.renderReportSignatures(cfg)
      : `
        <div class="letterhead-signatures-row" style="margin-top: 20px;">
          <div class="letterhead-sig-col">
            <div class="letterhead-sig-label">${cfg.sig1 || 'مهندس المشروع'}</div>
            <div class="letterhead-sig-dots">التوقيع: ........................</div>
          </div>
          <div class="letterhead-sig-col">
            <div class="letterhead-sig-label">${cfg.sig2 || 'الإدارة المالية'}</div>
            <div class="letterhead-sig-dots">المحاسب: ........................</div>
          </div>
          <div class="letterhead-sig-col">
            <div class="letterhead-sig-label">${cfg.sig3 || 'المدير العام'}</div>
            <div class="letterhead-sig-dots">الاعتماد: ........................</div>
          </div>
        </div>
      `;

    const footerHtml = (typeof Settings !== 'undefined' && Settings.renderReportFooter)
      ? Settings.renderReportFooter(cfg)
      : (cfg.footer_notes ? `<div style="margin-top: 10px; padding-top: 6px; border-top: 1px dashed #cbd5e1; font-size: 0.75rem; color: #64748b; text-align: center;">${cfg.footer_notes}</div>` : '');

    const showKpi = (cfg.proj_show_kpi_cards !== '0' && cfg.proj_show_kpi_cards !== 0 && cfg.proj_show_kpi_cards !== false);
    const showExpenses = (cfg.proj_show_expenses_table !== '0' && cfg.proj_show_expenses_table !== 0 && cfg.proj_show_expenses_table !== false);
    const showBills = (cfg.proj_show_supplier_bills !== '0' && cfg.proj_show_supplier_bills !== 0 && cfg.proj_show_supplier_bills !== false);
    const showPayments = (cfg.proj_show_client_payments !== '0' && cfg.proj_show_client_payments !== 0 && cfg.proj_show_client_payments !== false);

    printArea.innerHTML = `
      <div class="${docClass}">
        ${headerHtml}
        
        <div class="report-content-body">
          <!-- بطاقة معلومات المشروع الأساسية -->
          <table class="official-report-table" style="margin-bottom: 14px;">
            <tr style="background: #f8fafc;">
              <td style="font-weight: 800; width: 18%; background: #f1f5f9; color: #0f2744;">اسم المشروع:</td>
              <td style="font-weight: 800; color: #0f2744; width: 32%;">${p.name}</td>
              <td style="font-weight: 800; width: 18%; background: #f1f5f9; color: #0f2744;">العميل / المالك:</td>
              <td style="width: 32%;">${p.client_name || 'عميل مباشر'} ${p.client_phone ? '(' + p.client_phone + ')' : ''}</td>
            </tr>
            <tr>
              <td style="font-weight: 800; background: #f1f5f9; color: #0f2744;">حالة المشروع:</td>
              <td>
                <strong style="${p.status === 'completed' ? 'color:#065f46;' : 'color:#1e40af;'}">
                  ${p.status === 'completed' ? 'مكتمل ومسلّم ✅' : 'قيد التنفيذ والعمل ⚙️'}
                </strong>
              </td>
              <td style="font-weight: 800; background: #f1f5f9; color: #0f2744;">نسبة الإنجاز:</td>
              <td><strong style="color: #059669;">${p.progress_percentage || 0}%</strong></td>
            </tr>
            <tr style="background: #f8fafc;">
              <td style="font-weight: 800; background: #f1f5f9; color: #0f2744;">تاريخ البدء:</td>
              <td>${p.start_date || 'غير محدد'}</td>
              <td style="font-weight: 800; background: #f1f5f9; color: #0f2744;">تاريخ التسليم:</td>
              <td>${p.end_date || 'غير محدد'}</td>
            </tr>
            ${p.notes ? `
            <tr>
              <td style="font-weight: 800; background: #f1f5f9; color: #0f2744;">الموقع / الملاحظات:</td>
              <td colspan="3">${p.notes}</td>
            </tr>
            ` : ''}
          </table>

          <!-- المؤشرات المالية والتعاقدية -->
          ${showKpi ? `
          <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 14px;">
            <div style="border: 1px solid #d4af37; border-radius: 6px; padding: 8px; text-align: center; background: #fdfaf2;">
              <div style="font-size: 0.72rem; color: #666; margin-bottom: 2px;">قيمة العقد</div>
              <div style="font-weight: 900; font-size: 0.98rem; color: #b8911c;">${App.formatNumber(p.contract_value)} <small>${curr}</small></div>
            </div>
            <div style="border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px; text-align: center; background: #f8fafc;">
              <div style="font-size: 0.72rem; color: #666; margin-bottom: 2px;">التكلفة التقديرية</div>
              <div style="font-weight: 800; font-size: 0.98rem; color: #334155;">${App.formatNumber(p.estimated_cost)} <small>${curr}</small></div>
            </div>
            <div style="border: 1px solid #fca5a5; border-radius: 6px; padding: 8px; text-align: center; background: #fef2f2;">
              <div style="font-size: 0.72rem; color: #666; margin-bottom: 2px;">التكلفة الفعلية</div>
              <div style="font-weight: 800; font-size: 0.98rem; color: #dc2626;">${App.formatNumber(totalActualCost)} <small>${curr}</small></div>
            </div>
            <div style="border: 1px solid #86efac; border-radius: 6px; padding: 8px; text-align: center; background: #f0fdf4;">
              <div style="font-size: 0.72rem; color: #666; margin-bottom: 2px;">الربح المحقق</div>
              <div style="font-weight: 800; font-size: 0.98rem; color: #16a34a;">${App.formatNumber(p.actual_profit)} <small>${curr}</small></div>
            </div>
          </div>
          ` : ''}

          <!-- جدول المصروفات المباشرة -->
          ${showExpenses ? `
          <div style="font-weight: 800; color: #0f2744; font-size: 0.88rem; margin: 10px 0 4px 0; border-right: 3px solid #d4af37; padding-right: 6px;">
            تفاصيل المصروفات المباشرة (${(p.expenses || []).length})
          </div>
          <table class="official-report-table" style="margin-bottom: 12px; font-size: 0.82rem;">
            <thead>
              <tr>
                <th>رقم السند</th>
                <th>نوع المصروف</th>
                <th>التاريخ</th>
                <th>البيان</th>
                <th style="text-align: left;">المبلغ (${curr})</th>
              </tr>
            </thead>
            <tbody>
              ${(p.expenses && p.expenses.length > 0) ? p.expenses.map(e => `
                <tr>
                  <td><strong>${e.receipt_no || '-'}</strong></td>
                  <td>${e.expense_type || '-'}</td>
                  <td>${e.date || '-'}</td>
                  <td>${e.notes || '-'}</td>
                  <td style="text-align: left; font-weight: bold; color: #dc2626;">${App.formatNumber(e.amount)}</td>
                </tr>
              `).join('') : `
                <tr><td colspan="5" style="text-align: center; color: #888;">لا توجد مصروفات مباشرة مسجلة</td></tr>
              `}
              <tr style="background: #f8fafc; font-weight: bold;">
                <td colspan="4" style="text-align: right;">إجمالي المصروفات المنصرفة:</td>
                <td style="text-align: left; color: #dc2626;">${App.formatNumber(totalExpenses)} ${curr}</td>
              </tr>
            </tbody>
          </table>
          ` : ''}

          <!-- جدول فواتير ومستخلصات الموردين إن وجدت -->
          ${(showBills && p.bills && p.bills.length > 0) ? `
          <div style="font-weight: 800; color: #0f2744; font-size: 0.88rem; margin: 10px 0 4px 0; border-right: 3px solid #2563eb; padding-right: 6px;">
            فواتير ومشتريات الموردين للمشروع (${p.bills.length})
          </div>
          <table class="official-report-table" style="margin-bottom: 12px; font-size: 0.82rem;">
            <thead>
              <tr>
                <th>رقم الفاتورة</th>
                <th>المورد</th>
                <th>التاريخ</th>
                <th>البيان</th>
                <th style="text-align: left;">المبلغ الصافي (${curr})</th>
              </tr>
            </thead>
            <tbody>
              ${p.bills.map(b => `
                <tr>
                  <td><strong>${b.bill_number || '-'}</strong></td>
                  <td>${b.supplier_name || '-'}</td>
                  <td>${b.date || '-'}</td>
                  <td>${b.notes || 'فاتورة توريد'}</td>
                  <td style="text-align: left; font-weight: bold; color: #dc2626;">${App.formatNumber(b.net_amount || b.amount)}</td>
                </tr>
              `).join('')}
              <tr style="background: #f8fafc; font-weight: bold;">
                <td colspan="4" style="text-align: right;">إجمالي فواتير الموردين:</td>
                <td style="text-align: left; color: #dc2626;">${App.formatNumber(totalBills)} ${curr}</td>
              </tr>
            </tbody>
          </table>
          ` : ''}

          <!-- جدول المقبوضات والدفعات -->
          ${(showPayments && p.payments && p.payments.length > 0) ? `
          <div style="font-weight: 800; color: #0f2744; font-size: 0.88rem; margin: 10px 0 4px 0; border-right: 3px solid #059669; padding-right: 6px;">
            الدفعات والمقبوضات المستلمة من العميل (${p.payments.length})
          </div>
          <table class="official-report-table" style="margin-bottom: 12px; font-size: 0.82rem;">
            <thead>
              <tr>
                <th>رقم السند</th>
                <th>التاريخ</th>
                <th>طريقة الدفع</th>
                <th>البيان</th>
                <th style="text-align: left;">المبلغ (${curr})</th>
              </tr>
            </thead>
            <tbody>
              ${p.payments.map(pay => `
                <tr>
                  <td><strong>${pay.receipt_no}</strong></td>
                  <td>${pay.date}</td>
                  <td>${pay.payment_method}</td>
                  <td>${pay.notes || 'دفعة أعمال'}</td>
                  <td style="text-align: left; font-weight: bold; color: #059669;">${App.formatNumber(pay.amount)}</td>
                </tr>
              `).join('')}
              <tr style="background: #f8fafc; font-weight: bold;">
                <td colspan="4" style="text-align: right;">إجمالي المقبوضات:</td>
                <td style="text-align: left; color: #059669;">${App.formatNumber(totalPayments)} ${curr}</td>
              </tr>
            </tbody>
          </table>
          ` : ''}
        </div>

        ${sigHtml}
        ${footerHtml}
      </div>
    `;

    if (typeof Settings !== 'undefined' && Settings.setPrintTitle) {
      Settings.setPrintTitle(`تقرير مشروع ${p.name || p.code || ''}`);
    } else {
      const orig = document.title;
      document.title = `المستخدم المسجل: ${userName} | نظام رواسي عدن - تقرير مشروع ${p.name || p.code || ''}`;
      setTimeout(() => { document.title = orig; }, 2500);
    }
    window.print();
  },

  async exportFullProjectPackage(projectId) {
    if (!projectId) return;
    try {
      App.showToast('جاري تصدير وتجهيز كافة ملفات وبيانات المشروع في مجلده الخاص...', 'info');
      const res = await fetch(`/api/project-files/${projectId}/export-package`, {
        method: 'POST'
      });
      const json = await res.json();
      if (json.success && json.data) {
        App.showToast(`تم تصدير حزمة ملفات المشروع بنجاح (${json.data.filesGenerated} ملف) 📦✨`, 'success');
        
        // رسالة تأكيد للمستخدم مع إمكانية فتح المجلد في ويندوز مباشرة
        const confirmOpen = confirm(
          `تم تصدير وتفريغ ملفات المشروع بنجاح!\n` +
          `• المشروع: ${json.data.projectName}\n` +
          `• عدد الملفات: ${json.data.filesGenerated} ملفاً رسمياً (Excel + HTML + JSON)\n` +
          `• تشمل: الإيرادات، المصروفات، النثريات والعهد، الموردين، المخازن والمواد، الصندوق والبنك، والملف الشامل.\n` +
          `• المسار في ويندوز:\n${json.data.folderPath}\n\n` +
          `هل تريد فتح مجلد المشروع الآن في نظام ويندوز؟`
        );
        
        if (confirmOpen) {
          fetch(`/api/project-files/${projectId}/open-folder`, { method: 'POST' });
        }
      } else {
        App.showToast(json.message || 'تعذر تصدير حزمة ملفات المشروع', 'error');
      }
    } catch (e) {
      console.error('Export project package error:', e);
      App.showToast('خطأ في الاتصال بالخادم أثناء تصدير المشروع', 'error');
    }
  },

  async deleteProject(id) {
    if (!confirm('هل أنت متأكد من رغبتك في حذف هذا المشروع؟')) return;
    try {
      const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        App.showToast('تم حذف المشروع بنجاح', 'info');
        await this.loadProjects();
        Reports.loadDashboardKPIs();
      }
    } catch (e) {
      App.showToast('خطأ أثناء الحذف', 'error');
    }
  }
};
