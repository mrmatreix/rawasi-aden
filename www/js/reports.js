/**
 * =========================================================================
 * js/reports.js
 * إدارة التقارير، القوائم المالية، كشوفات الحسابات وتصدير Excel - رواسي عدن
 * =========================================================================
 * 
 * المبادئ المحاسبية المعيارية المطبقة:
 * 1. الواجهة الأمامية للعرض والتنسيق فقط (Display & Presentation Layer) وليس محرك حسابات.
 * 2. الاعتماد التام على ردود الخادم (API Response) القادمة من دفتر الأستاذ العام (General Ledger).
 * 3. خلو تام من أي أرقام افتراضية مصطنعة أو Fallback Values (1,250,000 / 850,000 / 35% إلخ).
 * 4. حفظ البيانات الرسمية المستلمة في ذاكرة التقرير (lastReportData) لاستخدامها في التصدير والطباعة.
 */

const Reports = {
  formatNumber(value) {
    const normalized = String(value ?? 0).replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 1632)).replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 1776)).replace(/٬/g, '').replace(/٫/g, '.');
    const number = Number(normalized);
    return Number.isFinite(number) ? number.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '0';
  },
  financialTypeLabel(value) { return (typeof FinancialLabels !== 'undefined' ? FinancialLabels : require('./financial-labels')).type(value); },
  accountDetailsHtml(data) {
    if (!data?.account_details?.length) return '';
    const escape = text => String(text || '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
    return '<h4>تفاصيل الحسابات المتأثرة بالعمليات ضمن خيارات التقرير</h4><table class="custom-table official-report-table"><thead><tr><th>رقم الحساب</th><th>اسم الحساب</th><th>المستوى</th><th>مدين</th><th>دائن</th><th>الصافي</th></tr></thead><tbody>' + data.account_details.map(row => '<tr><td>' + escape(row.code) + '</td><td>' + escape(row.name) + '</td><td>' + (row.account_kind === 'main' ? 'رئيسي (تجميعي)' : 'فرعي') + '</td><td>' + Reports.formatNumber(row.period_debit) + '</td><td>' + Reports.formatNumber(row.period_credit) + '</td><td>' + Reports.formatNumber(row.closing_balance) + '</td></tr>').join('') + '</tbody></table>';
  },
  budgetReportHtml(data, format = value => Reports.formatNumber(value)) {
    const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    const rows = data.projects || [], totals = data.totals || {};
    const cards = [['التقديري لكامل المشروع',totals.planned_cost],['الفعلي المتراكم حتى تاريخ التقرير',totals.actual_cost],['المتبقي من الموازنة',totals.remaining_budget],['التجاوز = الفعلي − التقديري',totals.variance_amount]].map(([name,value])=>'<div style="padding:12px;border:1px solid var(--border-color);border-radius:8px"><small>'+name+'</small><h3>'+format(value||0)+'</h3></div>').join('');
    const body = rows.map(row=>'<tr><td>'+escape(row.project_code)+'</td><td>'+escape(row.project_name)+'</td><td class="currency">'+format(row.planned_cost)+'</td><td class="currency">'+format(row.actual_cost)+'</td><td class="currency">'+format(row.remaining_budget)+'</td><td class="currency">'+format(row.variance_amount)+'</td><td>'+(row.consumed_percentage===null?'غير محسوبة':format(row.consumed_percentage)+'%')+'</td><td>'+escape(row.budget_status)+'</td><td>'+escape(row.budget_source)+'</td></tr>').join('');
    const planned = rows.flatMap(project=>(project.budget_lines||[]).map(line=>'<tr><td>'+escape(project.project_name)+'</td><td>'+escape(line.category)+'</td><td class="currency">'+format(line.planned_cost)+'</td><td>'+escape(line.notes)+'</td></tr>')).join('');
    return '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:16px">'+cards+'</div><p>المقارنة بين الموازنة التقديرية الحالية لكامل المشروع والتكلفة المحاسبية المتراكمة حتى التاريخ المختار. الفرق الموجب يعني تجاوزًا، والسالب يعني مبلغًا متبقيًا. بنود الموازنة والتقديري العام لا يُجمعان معًا.</p><div class="table-responsive"><table class="custom-table official-report-table"><thead><tr><th>رقم المشروع</th><th>المشروع</th><th>التقديري</th><th>الفعلي</th><th>المتبقي</th><th>التجاوز / الفرق</th><th>نسبة الاستهلاك</th><th>الحالة</th><th>مصدر التقديري</th></tr></thead><tbody>'+(body||'<tr><td colspan="9">لا توجد مشاريع ضمن الخيارات المحددة</td></tr>')+'</tbody><tfoot><tr><th colspan="2">الإجمالي</th><td class="currency">'+format(totals.planned_cost||0)+'</td><td class="currency">'+format(totals.actual_cost||0)+'</td><td class="currency">'+format(totals.remaining_budget||0)+'</td><td class="currency">'+format(totals.variance_amount||0)+'</td><td>'+(totals.consumed_percentage===null?'غير محسوبة':format(totals.consumed_percentage||0)+'%')+'</td><td colspan="2">مشاريع تجاوزت الموازنة: '+format(totals.over_budget_count||0)+'</td></tr></tfoot></table></div>'+(planned?'<h4>تفاصيل الموازنة التقديرية</h4><p>بنود تخطيطية؛ لا تُنسب إليها تكلفة فعلية تلقائيًا دون ربط محاسبي محدد.</p><table class="custom-table official-report-table"><thead><tr><th>المشروع</th><th>البند</th><th>التقديري</th><th>ملاحظات</th></tr></thead><tbody>'+planned+'</tbody></table>':'');
  },
  async loadProjectBudget() {
    try {
      const select = document.getElementById('budgetReportProject');
      const current = select?.value || '';
      const projects = await fetch('/api/projects', {cache:'no-store'}).then(response=>response.json());
      if (!projects.success) throw new Error(projects.message || 'تعذر تحميل المشاريع');
      if(select) { select.replaceChildren(new Option('كل المشاريع',''),...(projects.data||[]).map(project=>new Option((project.code||'')+' - '+project.name,project.id)));select.value=current; }
      const date = document.getElementById('budgetReportDate');
      if(date && !date.value) date.value=new Date().toISOString().slice(0,10);
      const params = new URLSearchParams();
      if(select?.value) params.set('project_id',select.value);
      if(date?.value) params.set('as_of_date',date.value);
      const json = await (await this.fetchFinancialReport('/api/reports/project-budget?'+params)).json();
      if (!json.success) return;
      this.lastReportData['project-budget']=json;
      const target = document.getElementById('projectBudgetReportContent');
      if(target) target.innerHTML=this.budgetReportHtml(json.data)+(json.warnings?.length?'<p>'+json.warnings.map(value=>String(value).replace(/</g,'&lt;')).join('<br>')+'</p>':'');
    } catch(error) { console.error('Project budget report',error); App.showToast(error.message || 'تعذر تحميل تقرير موازنة المشروع','error'); }
  },
  reportCurrency() { return this.loadedReportCurrency || 'ر.ي'; },
  async fetchFinancialReport(url) {
    const parsed = new URL(url, window.location.origin);
    this.reportRequests ||= new Map();
    const request = {};
    this.reportRequests.set(parsed.pathname, request);
    for (const [key,id] of [['display_level','financialDisplayLevel'],['cost_center_id','financialCostCenter'],['posting_status','financialPostingStatus'],['currency','financialCurrency']]) {
      const value = document.getElementById(id)?.value || '';
      if (value) parsed.searchParams.set(key, value); else parsed.searchParams.delete(key);
    }
    parsed.searchParams.set('hide_zero', document.getElementById('financialHideZero')?.checked ? 'true' : 'false');
    const response = await fetch(parsed.pathname + parsed.search, { cache: 'no-store' });
    const data = await response.json();
    // A slower response for previous filters must never replace the latest report.
    if (this.reportRequests.get(parsed.pathname) !== request) return { ok: true, status: response.status, json: async () => ({ success: false, stale: true }) };
    if (!response.ok || !data.success) { App.showToast(data.message || 'تعذر تحميل التقرير', 'error'); throw new Error(data.message || 'تعذر تحميل التقرير'); }
    const detail = document.getElementById('financialAccountDetails');
    if (detail) { detail.innerHTML = this.accountDetailsHtml(data.data); detail.style.display = data.data?.account_details?.length ? 'block' : 'none'; }
    this.loadedReportCurrency = data.meta?.currency || 'ر.ي';
    const summary = document.getElementById('financialFilterSummary');
    if (summary) summary.textContent = this.describeReportFilters(data.meta);
    return { ok: response.ok, status: response.status, json: async () => data };
  },
  describeReportFilters(meta = {}) {
    const levels = { main: 'حسابات رئيسية', subsidiary: 'حسابات فرعية', main_and_subsidiary: 'حسابات رئيسية وفرعية' };
    const posting = { all: 'قبل وبعد الترحيل', posted: 'بعد الترحيل فقط', unposted: 'قبل الترحيل فقط' };
    const center = document.getElementById('financialCostCenter');
    const centerName = meta.cost_center_id ? center?.selectedOptions?.[0]?.textContent || meta.cost_center_id : 'كل مراكز التكلفة';
    return [meta.hide_zero ? 'الحسابات الصفرية مخفية' : 'عرض الحسابات الصفرية', levels[meta.display_level], posting[meta.posting_status], centerName, 'عملة العرض: ' + (meta.currency_code || 'YER'), '1 ' + (meta.currency_code || 'YER') + ' = ' + (meta.rate_to_base || 1) + ' ريال يمني', 'الحسابات الرئيسية تجميعية ولا تضاف مرة أخرى إلى الإجماليات'].filter(Boolean).join(' | ');
  },
  async applyFinancialFilters() {
    this.lastReportData = {};
    await this.switchReportTab(this.activeReportTab || 'income-statement');
    if (this.activeReportTab === 'account-movement' && document.getElementById('amAccountId')?.value) await this.loadAccountMovement();
    if (this.activeReportTab === 'client-statement' && document.getElementById('repClientSelect')?.value) await this.fetchFullClientStatement();
    if (this.activeReportTab === 'supplier-statement' && document.getElementById('repSupplierSelect')?.value) await this.fetchFullSupplierStatement();
  },

  activeReportTab: 'income-statement',
  lastReportData: {},

  async init() {
    await this.loadDashboardKPIs();
  },

  // =========================================================================
  // 1. لوحة التحكم المركزية (Dashboard KPIs)
  // =========================================================================
  async loadDashboardKPIs() {
    const kpiIds = [
      'kpiTotalIncome', 'kpiTotalExpenses', 'kpiNetProfit', 'kpiCashBalance',
      'kpiClientReceivables', 'kpiSupplierPayables', 'kpiActiveProjects', 'kpiTotalProjects'
    ];
    kpiIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('skeleton', 'skeleton-text');
    });

    const recentTbody = document.getElementById('recentOperationsTableBody');
    if (recentTbody && window.UI && UI.Skeleton) {
      UI.Skeleton.showTableSkeleton(recentTbody, 4, 5);
    }

    try {
      const res = await fetch('/api/reports/dashboard');
      const json = await res.json();
      if (json.success && json.data) {
        const { kpis, expenses_by_type, monthly_trend, recent_transactions, contracting_summary } = json.data;
        this.lastReportData['dashboard'] = json.data;
        this.updateKPIElements(kpis, contracting_summary);
        this.renderExpensesDonutChart(expenses_by_type);
        this.renderMonthlyTrendChart(monthly_trend);
        this.renderRecentOperationsTable(recent_transactions);
      }
    } catch (e) {
      console.error('❌ Error loading dashboard KPIs:', e);
    }
  },

  updateKPIElements(k = {}, contractingSummary = {}) {
    const setTxt = (id, val) => {
      const el = document.getElementById(id);
      if (el) {
        el.classList.remove('skeleton', 'skeleton-text');
        el.textContent = Reports.formatNumber(val ?? 0);
      }
    };

    setTxt('kpiTotalIncome', k.total_income);
    setTxt('kpiTotalExpenses', k.total_expenses);
    setTxt('kpiNetProfit', k.net_profit);
    setTxt('kpiCashBalance', k.cash_balance);
    setTxt('kpiClientReceivables', k.client_receivables);
    setTxt('kpiSupplierPayables', k.supplier_payables);

    const cs = contractingSummary || {};
    setTxt('matrixTotalReceipts', k.cash_receipts ?? cs.total_cash_receipts ?? 0);
    setTxt('matrixRecognizedRevenue', k.recognized_revenue ?? cs.total_recognized_revenue ?? 0);
    setTxt('matrixGrossBillings', k.progress_billings ?? cs.total_gross_billings ?? 0);
    setTxt('matrixAdvanceLiability', k.advance_payments_liability ?? cs.total_advance_liability ?? 0);
    setTxt('matrixActiveRetention', k.retention_receivable_asset ?? cs.total_active_retention ?? 0);
    setTxt('matrixContractAssetWIP', k.contract_asset_wip ?? cs.total_contract_asset_wip ?? 0);
    setTxt('matrixApprovedVariations', k.approved_variations ?? cs.total_approved_variations ?? 0);
    setTxt('matrixTrueNetProfit', k.true_net_profit ?? cs.total_true_profit ?? 0);

    const activeEl = document.getElementById('kpiActiveProjects');
    if (activeEl) {
      activeEl.classList.remove('skeleton', 'skeleton-text');
      activeEl.textContent = k.active_projects ?? 0;
    }
    const totalEl = document.getElementById('kpiTotalProjects');
    if (totalEl) {
      totalEl.classList.remove('skeleton', 'skeleton-text');
      totalEl.textContent = k.total_projects ?? 0;
    }
  },

  renderExpensesDonutChart(data) {
    if (window.UI && UI.Chart && typeof UI.Chart.Donut === 'function') {
      UI.Chart.Donut('expensesDonutCanvas', {
        data: data || [],
        legendId: 'expensesDonutLegend'
      });
      return;
    }
    const canvas = document.getElementById('expensesDonutCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = 280;
    canvas.height = 220;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  },

  renderMonthlyTrendChart(trendData) {
    if (window.UI && UI.Chart && typeof UI.Chart.TrendLine === 'function') {
      UI.Chart.TrendLine('monthlyTrendCanvas', {
        data: trendData || []
      });
      return;
    }
    const canvas = document.getElementById('monthlyTrendCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = 460;
    canvas.height = 220;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  },

  renderRecentOperationsTable(operations) {
    const tbody = document.getElementById('recentOperationsTableBody');
    if (!tbody) return;

    if (!operations || operations.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-secondary); padding: 14px;">لا توجد حركات مؤخراً في دفتر الأستاذ</td></tr>`;
      return;
    }

    tbody.innerHTML = operations.map(op => {
      const isIncome = op.type === 'إيراد' || op.type === 'سند قبض';
      return `
        <tr>
          <td>${op.date || '-'}</td>
          <td style="font-weight: 700; color: ${isIncome ? 'var(--accent-green)' : 'var(--accent-red)'}">
            ${Reports.formatNumber(op.amount || 0)} ${op.currency || 'ر.ي'}
          </td>
          <td>${op.project_name || 'عام'}</td>
          <td style="color: var(--text-secondary);">${op.description || '-'}</td>
          <td>
            <span class="badge ${isIncome ? 'badge-income' : 'badge-expense'}">
              ${op.type || 'قيد'}
            </span>
          </td>
        </tr>
      `;
    }).join('');
  },

  async filterProfitLoss() {
    const fromDate = document.getElementById('plFromDate')?.value || '';
    const toDate = document.getElementById('plToDate')?.value || '';
    let url = '/api/reports/profit-loss';
    const params = new URLSearchParams();
    if (fromDate) params.append('from_date', fromDate);
    if (toDate) params.append('to_date', toDate);
    const qs = params.toString();
    if (qs) url += '?' + qs;

    try {
      const res = await this.fetchFinancialReport(url);
      const json = await res.json();
      if (json.success && json.data) {
        const d = json.data;
        const inEl = document.getElementById('plTotalIncome');
        const exEl = document.getElementById('plTotalExpenses');
        const netEl = document.getElementById('plNetProfit');

        if (inEl) inEl.textContent = Reports.formatNumber(d.total_income || 0);
        if (exEl) exEl.textContent = Reports.formatNumber(d.total_expenses || 0);
        if (netEl) netEl.textContent = Reports.formatNumber(d.net_profit || 0);

        App.showToast('تم تحديث أرقام الأرباح والخسائر بنجاح', 'success');
        App.navigate('reports');
        this.switchReportTab('profit-loss');
      }
    } catch (e) {
      console.error(e);
      App.showToast('تعذر جلب التقرير', 'error');
    }
  },

  async loadClientStatement() {
    const clientId = document.getElementById('statementClientSelect')?.value;
    if (!clientId) {
      App.showToast('يرجى اختيار العميل أولاً', 'error');
      return;
    }
    App.navigate('reports');
    this.switchReportTab('client-statement');
    await this.initClientStatementDropdown(clientId);
    await this.fetchFullClientStatement(clientId);
  },

  // =========================================================================
  // إدارة التبويبات والشاشات (Tabs Switcher)
  // =========================================================================
  async switchReportTab(tabId) {
    if (tabId === 'profit-loss') tabId = 'income-statement';
    this.activeReportTab = tabId;
    if (typeof Sidebar !== 'undefined' && App.activeView === 'reports') Sidebar.sync('reports', tabId);
    await this.initFinancialReportFilters();
    if (this.activeReportTab !== tabId) return;
    document.querySelectorAll('.report-tab-btn').forEach(btn => btn.classList.remove('active'));
    const clickedBtn = document.getElementById(`tabBtn_${tabId}`);
    if (clickedBtn) clickedBtn.classList.add('active');

    document.querySelectorAll('.report-pane').forEach(p => p.style.display = 'none');
    const target = document.getElementById(`pane_${tabId}`);
    if (target) target.style.display = 'block';

    if (tabId === 'trial-balance') {
      await this.loadTrialBalance();
    } else if (tabId === 'income-statement') {
await this.loadIncomeStatement();
    } else if (tabId === 'account-movement') {
} else if (tabId === 'balance-sheet') {
      await this.loadBalanceSheet();
    } else if (tabId === 'cash-flow') {
      await this.loadCashFlow();
    } else if (tabId === 'project-budget') {
      await this.loadProjectBudget();
    } else if (tabId === 'projects-profitability') {
      await this.loadProjectsProfitability();
    } else if (tabId === 'cost-centers-profitability') {
      await this.loadCostCentersProfitability();
    } else if (tabId === 'client-statement') {
      await this.initClientStatementDropdown();
    } else if (tabId === 'supplier-statement') {
      await this.initSupplierStatementDropdown();
    }
  },

  async initFinancialReportFilters() {
    try {
      const [accountsRes, centersRes, currenciesRes] = await Promise.all([
        fetch('/api/accounting/accounts', { cache: 'no-store' }).then(r => r.json()),
        fetch('/api/accounting/cost-centers', { cache: 'no-store' }).then(r => r.json()),
        fetch('/api/accounting/currencies', { cache: 'no-store' }).then(r => r.json())
      ]);
      const accounts = accountsRes.success ? (accountsRes.data || []) : [];
      const centers = centersRes.success ? (centersRes.data || []) : [];
      const populate = (id, placeholder, rows, labelBuilder) => {
        const select = document.getElementById(id);
        if (!select) return;
        const current = select.value;
        select.innerHTML = `<option value="">${placeholder}</option>` + rows.map(row =>
          `<option value="${row.id}">${labelBuilder(row)}</option>`
        ).join('');
        if (current && rows.some(row => String(row.id) === String(current))) select.value = current;
      };
      const mode = document.getElementById('financialDisplayLevel')?.value || 'subsidiary';
      const selectable = accounts.filter(a => mode === 'main_and_subsidiary' || (mode === 'main' ? Number(a.children_count) > 0 : !Number(a.children_count)));
      populate('amAccountId', 'اختر الحساب من دليل الحسابات', selectable, account => `${account.code} - ${account.name}`);
      populate('financialCostCenter', 'كل مراكز التكلفة', centers, center => center.code + ' - ' + center.name);
      const currencySelect = document.getElementById('financialCurrency');
      if (currencySelect) { const previous = currencySelect.value || 'YER'; currencySelect.replaceChildren(...(currenciesRes.data || []).filter(c => c.status !== 'inactive').map(c => new Option(c.code + ' - ' + c.name, c.code))); currencySelect.value = previous; }
      populate('amCostCenter', 'كل مراكز التكلفة', centers, center => `${center.code} - ${center.name}`);
      populate('isCostCenter', 'كل مراكز التكلفة', centers, center => `${center.code} - ${center.name}`);
    } catch (error) {
      console.error('تعذر تحديث مرشحات التقارير المالية:', error);
      App.showToast('تعذر تحديث دليل الحسابات ومراكز التكلفة', 'error');
    }
  },

  // =========================================================================
  // 1. تقرير الأرباح والخسائر الشامل (P&L)
  // =========================================================================
  async loadFullProfitLoss() {
    const fromDate = document.getElementById('repPlFromDate')?.value || '';
    const toDate = document.getElementById('repPlToDate')?.value || '';
    let url = '/api/reports/profit-loss';
    const params = new URLSearchParams();
    if (fromDate) params.append('from_date', fromDate);
    if (toDate) params.append('to_date', toDate);
    if (params.toString()) url += '?' + params.toString();

    try {
      const res = await this.fetchFinancialReport(url);
      const json = await res.json();
      if (json.success && json.data) {
        const d = json.data;
        this.lastReportData['profit-loss'] = json;

        const incEl = document.getElementById('fullPlIncome');
        const expEl = document.getElementById('fullPlExpense');
        const profEl = document.getElementById('fullPlProfit');

        if (incEl) incEl.textContent = Reports.formatNumber(d.total_income || 0) + ' ' + this.reportCurrency();
        if (expEl) expEl.textContent = Reports.formatNumber(d.total_expenses || 0) + ' ' + this.reportCurrency();
        if (profEl) {
          profEl.textContent = Reports.formatNumber(d.net_profit || 0) + ' ' + this.reportCurrency();
          profEl.style.color = (d.net_profit || 0) >= 0 ? 'var(--gold-light)' : 'var(--accent-red)';
        }

        const tbody = document.getElementById('fullPlBreakdownTable');
        if (tbody) {
          const breakdown = d.expenses_breakdown || [];
          if (breakdown.length === 0) {
            tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--text-secondary); padding: 14px;">لا توجد مصروفات مسجلة في هذه الفترة</td></tr>`;
          } else {
            tbody.innerHTML = breakdown.map(item => `
              <tr>
                <td><strong>${item.name || item.expense_type || 'بند مصروف'}</strong></td>
                <td style="color: var(--accent-red); font-weight: bold;">${Reports.formatNumber(item.amount || item.total || 0)} ${this.reportCurrency()}</td>
                <td>${item.percentage !== undefined ? item.percentage + '%' : Math.round(((item.amount || item.total || 0) / (d.total_expenses || 1)) * 100) + '%'}</td>
              </tr>
            `).join('');
          }
        }
      }
    } catch (e) {
      console.error('❌ Error loading profit-loss:', e);
      App.showToast('تعذر جلب تقرير الأرباح والخسائر', 'error');
    }
  },

  // =========================================================================
  // 2. تقرير ميزان المراجعة والأرصدة (Trial Balance)
  // =========================================================================
  async loadTrialBalance() {
    const fromDate = document.getElementById('tbFromDate')?.value || '';
    const toDate = document.getElementById('tbToDate')?.value || '';
    let url = '/api/reports/trial-balance';
    const params = new URLSearchParams();
    if (fromDate) params.append('from_date', fromDate);
    if (toDate) params.append('to_date', toDate);
    if (params.toString()) url += '?' + params.toString();

    try {
      const res = await this.fetchFinancialReport(url);
      const json = await res.json();
      if (json.success && json.data) {
        const { accounts, totals } = json.data;
        this.lastReportData['trial-balance'] = json;

        const is_balanced = json.reconciliation ? json.reconciliation.is_balanced : totals?.is_balanced;
        const diff = json.reconciliation ? json.reconciliation.period_difference : Math.abs((totals?.total_debit || 0) - (totals?.total_credit || 0));

        const debitEl = document.getElementById('tbTotalDebit');
        const creditEl = document.getElementById('tbTotalCredit');
        const balDebitEl = document.getElementById('tbBalanceDebit');
        const statusEl = document.getElementById('tbBalanceStatus');

        if (debitEl) debitEl.textContent = Reports.formatNumber(totals.period_debit || totals.total_debit || 0) + ' ' + this.reportCurrency();
        if (creditEl) creditEl.textContent = Reports.formatNumber(totals.period_credit || totals.total_credit || 0) + ' ' + this.reportCurrency();
        if (balDebitEl) balDebitEl.textContent = Reports.formatNumber(totals.closing_debit || totals.balance_debit || 0) + ' ' + this.reportCurrency();

        if (statusEl) {
          if (is_balanced) {
            statusEl.textContent = 'متزن 100% ✓';
            statusEl.style.color = 'var(--accent-green)';
          } else {
            statusEl.textContent = `فارق: ${Reports.formatNumber(diff || 0)} ${this.reportCurrency()} ⚠️`;
            statusEl.style.color = 'var(--accent-red)';
          }
        }

        const tbody = document.getElementById('trialBalanceTableBody');
        if (tbody) {
          if (!accounts || accounts.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--text-secondary); padding: 20px;">لا توجد حسابات أو حركات في هذه الفترة</td></tr>`;
          } else {
            tbody.innerHTML = accounts.map(a => `
              <tr>
                <td style="font-family: monospace; font-weight: bold; color: var(--gold-light);">${a.code}</td>
                <td><strong>${a.name}</strong><small style="display:block">${a.account_kind === 'main' ? 'رئيسي (تجميعي)' : 'فرعي'}</small></td>
                <td><span class="badge badge-info">${this.financialTypeLabel(a.type)}</span></td>
                <td style="text-align: left; direction: ltr; font-family: monospace;">${a.opening_debit > 0 ? Reports.formatNumber(a.opening_debit) : '-'}</td>
                <td style="text-align: left; direction: ltr; font-family: monospace;">${a.opening_credit > 0 ? Reports.formatNumber(a.opening_credit) : '-'}</td>
                <td style="text-align: left; direction: ltr; font-family: monospace; color: var(--accent-green);">${a.period_debit > 0 ? Reports.formatNumber(a.period_debit) : '-'}</td>
                <td style="text-align: left; direction: ltr; font-family: monospace; color: #38bdf8;">${a.period_credit > 0 ? Reports.formatNumber(a.period_credit) : '-'}</td>
                <td style="text-align: left; direction: ltr; font-family: monospace; font-weight: bold; color: var(--accent-green);">${a.closing_debit > 0 ? Reports.formatNumber(a.closing_debit) : '-'}</td>
                <td style="text-align: left; direction: ltr; font-family: monospace; font-weight: bold; color: #38bdf8;">${a.closing_credit > 0 ? Reports.formatNumber(a.closing_credit) : '-'}</td>
              </tr>
            `).join('');
          }
        }

        const tfoot = document.getElementById('trialBalanceTableFoot');
        if (tfoot) {
          tfoot.innerHTML = `
            <tr>
              <td colspan="3" style="text-align: center; font-size: 1rem;">الإجمالي الكلي لميزان المراجعة</td>
              <td style="text-align: left; direction: ltr; font-family: monospace;">${Reports.formatNumber(totals.opening_debit || 0)}</td>
              <td style="text-align: left; direction: ltr; font-family: monospace;">${Reports.formatNumber(totals.opening_credit || 0)}</td>
              <td style="text-align: left; direction: ltr; font-family: monospace; color: var(--accent-green); font-size: 1.05rem;">${Reports.formatNumber(totals.period_debit || totals.total_debit || 0)}</td>
              <td style="text-align: left; direction: ltr; font-family: monospace; color: #38bdf8; font-size: 1.05rem;">${Reports.formatNumber(totals.period_credit || totals.total_credit || 0)}</td>
              <td style="text-align: left; direction: ltr; font-family: monospace; color: var(--accent-green); font-size: 1.05rem;">${Reports.formatNumber(totals.closing_debit || totals.balance_debit || 0)}</td>
              <td style="text-align: left; direction: ltr; font-family: monospace; color: #38bdf8; font-size: 1.05rem;">${Reports.formatNumber(totals.closing_credit || totals.balance_credit || 0)}</td>
            </tr>
          `;
        }
      }
    } catch (e) {
      console.error('❌ Error loading trial balance:', e);
      App.showToast('فشل تحميل ميزان المراجعة', 'error');
    }
  },

  // =========================================================================
  // 3. تقرير قائمة الدخل المعيارية (Income Statement)
  // =========================================================================
  async loadIncomeStatement() {
    const fromDate = document.getElementById('isFromDate')?.value || '';
    const toDate = document.getElementById('isToDate')?.value || '';
    let url = '/api/reports/income-statement';
    const params = new URLSearchParams();
    if (fromDate) params.append('from_date', fromDate);
    if (toDate) params.append('to_date', toDate);
    const displayLevel = document.getElementById('isDisplayLevel')?.value || 'subsidiary';
    const costCenterId = document.getElementById('isCostCenter')?.value || '';
    params.append('display_level', displayLevel);
    if (costCenterId) params.append('cost_center_id', costCenterId);
    if (params.toString()) url += '?' + params.toString();

    try {
      const res = await this.fetchFinancialReport(url);
      const json = await res.json();
      if (json.success && json.data) {
        const d = json.data;
        this.lastReportData['income-statement'] = json;

        const revEl = document.getElementById('isTotalRevenues');
        const dirEl = document.getElementById('isDirectCosts');
        const grossEl = document.getElementById('isGrossProfit');
        const expEl = document.getElementById('isTotalExpenses');
        const netEl = document.getElementById('isNetIncome');

        if (revEl) revEl.textContent = Reports.formatNumber(d.total_revenues || 0) + ' ' + this.reportCurrency();
        if (dirEl) dirEl.textContent = Reports.formatNumber(d.total_direct_costs || 0) + ' ' + this.reportCurrency();
        if (grossEl) grossEl.textContent = Reports.formatNumber(d.gross_profit || 0) + ' ' + this.reportCurrency();
        if (expEl) expEl.textContent = Reports.formatNumber(d.total_operating_expenses || 0) + ' ' + this.reportCurrency();
        if (netEl) {
          netEl.textContent = Reports.formatNumber(d.net_profit || 0) + ' ' + this.reportCurrency();
          netEl.style.color = (d.net_profit || 0) >= 0 ? 'var(--gold-light)' : 'var(--accent-red)';
        }

        const revTbody = document.getElementById('isRevenuesTableBody');
        if (revTbody) {
          const revs = d.revenues || [];
          if (revs.length === 0) {
            revTbody.innerHTML = `<tr><td colspan="2" style="text-align: center; color: var(--text-secondary); padding: 14px;">لا توجد إيرادات مسجلة بالأستاذ</td></tr>`;
          } else {
            revTbody.innerHTML = revs.map(r => `
              <tr>
                <td><strong>${r.code ? r.code + ' - ' : ''}${r.name}</strong></td>
                <td style="font-weight: bold; color: var(--accent-green); text-align: left; direction: ltr; font-family: monospace;">${Reports.formatNumber(r.amount || 0)} ${this.reportCurrency()}</td>
              </tr>
            `).join('') + `
              <tr style="background: rgba(16,185,129,0.08); font-weight: bold;">
                <td>إجمالي الإيرادات المعترف بها</td>
                <td style="color: var(--accent-green); text-align: left; direction: ltr; font-family: monospace; font-size: 1.05rem;">${Reports.formatNumber(d.total_revenues || 0)} ${this.reportCurrency()}</td>
              </tr>
            `;
          }
        }

        const expTbody = document.getElementById('isExpensesTableBody');
        if (expTbody) {
          const allCosts = (d.expenses?.length ? d.expenses : [...(d.direct_costs || []), ...(d.operating_expenses || [])]);
          if (allCosts.length === 0) {
            expTbody.innerHTML = `<tr><td colspan="2" style="text-align: center; color: var(--text-secondary); padding: 14px;">لا توجد مصروفات مسجلة بالأستاذ</td></tr>`;
          } else {
            expTbody.innerHTML = allCosts.map(e => `
              <tr>
                <td><strong>${e.code ? e.code + ' - ' : ''}${e.name}</strong></td>
                <td style="font-weight: bold; color: var(--accent-red); text-align: left; direction: ltr; font-family: monospace;">${Reports.formatNumber(e.amount || 0)} ${this.reportCurrency()}</td>
              </tr>
            `).join('') + `
              <tr style="background: rgba(239,68,68,0.08); font-weight: bold;">
                <td>إجمالي التكاليف والمصروفات</td>
                <td style="color: var(--accent-red); text-align: left; direction: ltr; font-family: monospace; font-size: 1.05rem;">${Reports.formatNumber(d.total_expenses || 0)} ${this.reportCurrency()}</td>
              </tr>
            `;
          }
        }
      }
    } catch (e) {
      console.error('❌ Error loading income statement:', e);
      App.showToast('فشل تحميل قائمة الدخل', 'error');
    }
  },

  async loadAccountMovement() {
    const accountId = document.getElementById('amAccountId')?.value || '';
    if (!accountId) {
      App.showToast('يرجى اختيار الحساب أولاً', 'warning');
      return;
    }
    const params = new URLSearchParams({ account_id: accountId });
    const fromDate = document.getElementById('amFromDate')?.value || '';
    const toDate = document.getElementById('amToDate')?.value || '';
    const costCenterId = document.getElementById('amCostCenter')?.value || '';
    if (fromDate) params.append('from_date', fromDate);
    if (toDate) params.append('to_date', toDate);
    if (costCenterId) params.append('cost_center_id', costCenterId);

    try {
      const response = await this.fetchFinancialReport(`/api/reports/account-movement?${params.toString()}`);
      const json = await response.json();
      if (json.stale) return;
      if (!response.ok || !json.success) throw new Error(json.message || 'تعذر تحميل حركة الحساب');
      this.lastReportData['account-movement'] = json;
      const totals = json.data.totals || {};
      const setAmount = (id, value) => {
        const element = document.getElementById(id);
        if (element) element.textContent = `${Reports.formatNumber(value || 0)} ${this.reportCurrency()}`;
      };
      setAmount('amOpeningBalance', totals.opening_balance);
      setAmount('amTotalDebit', totals.total_debit);
      setAmount('amTotalCredit', totals.total_credit);
      setAmount('amClosingBalance', totals.closing_balance);

      const tbody = document.getElementById('accountMovementTableBody');
      const movements = json.data.movements || [];
      if (tbody) {
        tbody.innerHTML = movements.length ? movements.map(row => `
          <tr>
            <td>${row.date || '-'}</td>
            <td style="font-family:monospace; color:var(--gold-light);">${row.entry_no || '-'}</td>
            <td>${row.reference || '-'}</td>
            <td>${row.description || row.notes || '-'}</td>
            <td>${row.cost_center_name ? `${row.cost_center_code || ''} - ${row.cost_center_name}` : 'عام'}</td>
            <td style="color:var(--accent-green); font-weight:bold;">${row.debit > 0 ? Reports.formatNumber(row.debit) : '-'}</td>
            <td style="color:var(--accent-red); font-weight:bold;">${row.credit > 0 ? Reports.formatNumber(row.credit) : '-'}</td>
            <td style="font-weight:bold;">${Reports.formatNumber(row.running_balance || 0)}</td>
          </tr>
        `).join('') : '<tr><td colspan="8" style="text-align:center; padding:20px; color:var(--text-secondary);">لا توجد حركات للحساب ضمن الخيارات المحددة</td></tr>';
      }
    } catch (error) {
      console.error('تعذر تحميل حركة الحساب:', error);
      App.showToast(error.message || 'تعذر تحميل حركة الحساب', 'error');
    }
  },

  // =========================================================================
  // 4. تقرير المركز المالي / الميزانية العمومية (Balance Sheet)
  // =========================================================================
  async loadBalanceSheet() {
    const asOfDate = document.getElementById('bsAsOfDate')?.value || '';
    let url = '/api/reports/balance-sheet';
    if (asOfDate) url += `?as_of_date=${asOfDate}`;

    try {
      const res = await this.fetchFinancialReport(url);
      const json = await res.json();
      if (json.success && json.data) {
        const { assets, liabilities, equity, totals } = json.data;
        this.lastReportData['balance-sheet'] = json;

        const isBalanced = json.reconciliation ? json.reconciliation.is_balanced : (totals.assets === totals.liabilities_plus_equity);
        const badge = document.getElementById('bsReconcileBadge');
        if (badge) {
          if (isBalanced) {
            badge.textContent = '⚖️ معادلة الميزانية: متزنة تماماً (الأصول = الخصوم + الملكية) ✓';
            badge.style.color = '#4ade80';
            badge.style.background = 'rgba(34,197,94,0.15)';
          } else {
            const diff = json.reconciliation?.difference || Math.abs(totals.assets - totals.liabilities_plus_equity);
            badge.textContent = `⚠️ فارق ميزانية: ${Reports.formatNumber(diff)} ${this.reportCurrency()}`;
            badge.style.color = '#f87171';
            badge.style.background = 'rgba(239,68,68,0.15)';
          }
        }

        const assetsTbody = document.getElementById('bsAssetsTable');
        if (assetsTbody) {
          if (!assets || assets.length === 0) {
            assetsTbody.innerHTML = `<tr><td colspan="2" style="text-align: center; color: var(--text-secondary); padding: 14px;">لا توجد أصول مسجلة</td></tr>`;
          } else {
            assetsTbody.innerHTML = assets.map(a => `
              <tr>
                <td>${a.code ? a.code + ' - ' : ''}${a.name}</td>
                <td style="font-weight: bold; text-align: left; direction: ltr; font-family: monospace;">${Reports.formatNumber(a.balance || 0)} ${this.reportCurrency()}</td>
              </tr>
            `).join('');
          }
        }

        const liabTbody = document.getElementById('bsLiabTable');
        if (liabTbody) {
          const combinedLiab = [...(liabilities || []), ...(equity || [])];
          if (combinedLiab.length === 0) {
            liabTbody.innerHTML = `<tr><td colspan="2" style="text-align: center; color: var(--text-secondary); padding: 14px;">لا توجد التزامات أو حقوق ملكية</td></tr>`;
          } else {
            liabTbody.innerHTML = combinedLiab.map(l => `
              <tr>
                <td>${l.code ? l.code + ' - ' : ''}${l.name}</td>
                <td style="font-weight: bold; text-align: left; direction: ltr; font-family: monospace;">${Reports.formatNumber(l.balance || 0)} ${this.reportCurrency()}</td>
              </tr>
            `).join('');
          }
        }

        const totAssetsEl = document.getElementById('bsTotalAssets');
        const totLiabEl = document.getElementById('bsTotalLiabEquity');
        if (totAssetsEl) totAssetsEl.textContent = Reports.formatNumber(totals.assets || 0) + ' ' + this.reportCurrency();
        if (totLiabEl) totLiabEl.textContent = Reports.formatNumber(totals.liabilities_plus_equity || 0) + ' ' + this.reportCurrency();
      }
    } catch (e) {
      console.error('❌ Error loading balance sheet:', e);
      App.showToast('فشل تحميل الميزانية العمومية', 'error');
    }
  },

  // =========================================================================
  // 5. تقرير التدفقات النقدية (Cash Flow)
  // =========================================================================
  async loadCashFlow() {
    const fromDate = document.getElementById('cfFromDate')?.value || '';
    const toDate = document.getElementById('cfToDate')?.value || '';
    let url = '/api/reports/cash-flow';
    const params = new URLSearchParams();
    if (fromDate) params.append('from_date', fromDate);
    if (toDate) params.append('to_date', toDate);
    if (params.toString()) url += '?' + params.toString();

    try {
      const res = await this.fetchFinancialReport(url);
      const json = await res.json();
      if (json.success && json.data) {
        const d = json.data;
        this.lastReportData['cash-flow'] = json;

        const op = d.operating_activities || { inflows: [], outflows: [], net: 0 };
        const inv = d.investing_activities || { inflows: [], outflows: [], net: 0 };
        const fin = d.financing_activities || { inflows: [], outflows: [], net: 0 };

        const openEl = document.getElementById('cfOpeningCash');
        const netOpEl = document.getElementById('cfNetOperating');
        const changeEl = document.getElementById('cfNetChange');
        const closeEl = document.getElementById('cfClosingCash');

        if (openEl) openEl.textContent = Reports.formatNumber(d.opening_balance || 0) + ' ' + this.reportCurrency();
        if (netOpEl) netOpEl.textContent = Reports.formatNumber(op.net || 0) + ' ' + this.reportCurrency();
        if (changeEl) changeEl.textContent = Reports.formatNumber(d.net_cash_change || 0) + ' ' + this.reportCurrency();
        if (closeEl) closeEl.textContent = Reports.formatNumber(d.closing_balance || 0) + ' ' + this.reportCurrency();

        const tbody = document.getElementById('cashFlowTableBody');
        if (tbody) {
          let html = '';

          // 1. الأنشطة التشغيلية
          html += `<tr style="background: rgba(56,189,248,0.12); font-weight: bold;"><td colspan="4">أولاً: التدفقات النقدية من الأنشطة التشغيلية</td></tr>`;
          if ((op.inflows || []).length === 0 && (op.outflows || []).length === 0) {
            html += `<tr><td colspan="4" style="text-align: center; color: var(--text-secondary);">لا توجد حركات تشغيلية</td></tr>`;
          } else {
            (op.inflows || []).forEach(it => {
              html += `
                <tr>
                  <td>${it.item}</td>
                  <td style="text-align: left; direction: ltr; font-family: monospace; color: var(--accent-green);">${Reports.formatNumber(it.amount)}</td>
                  <td style="text-align: left; direction: ltr; font-family: monospace; color: var(--accent-red);">-</td>
                  <td style="text-align: left; direction: ltr; font-family: monospace; font-weight: bold; color: var(--accent-green);">+${Reports.formatNumber(it.amount)} ${this.reportCurrency()}</td>
                </tr>
              `;
            });
            (op.outflows || []).forEach(it => {
              html += `
                <tr>
                  <td>${it.item}</td>
                  <td style="text-align: left; direction: ltr; font-family: monospace; color: var(--accent-green);">-</td>
                  <td style="text-align: left; direction: ltr; font-family: monospace; color: var(--accent-red);">${Reports.formatNumber(it.amount)}</td>
                  <td style="text-align: left; direction: ltr; font-family: monospace; font-weight: bold; color: var(--accent-red);">-${Reports.formatNumber(it.amount)} ${this.reportCurrency()}</td>
                </tr>
              `;
            });
          }
          html += `
            <tr style="background: rgba(255,255,255,0.03); font-weight: bold;">
              <td>صافي النقد من الأنشطة التشغيلية</td>
              <td colspan="2"></td>
              <td style="text-align: left; direction: ltr; font-family: monospace; color: ${op.net >= 0 ? 'var(--accent-green)' : 'var(--accent-red)'}; font-size: 1.05rem;">${Reports.formatNumber(op.net || 0)} ${this.reportCurrency()}</td>
            </tr>
          `;

          // 2. الأنشطة الاستثمارية
          html += `<tr style="background: rgba(168,85,247,0.12); font-weight: bold;"><td colspan="4">ثانياً: التدفقات النقدية من الأنشطة الاستثمارية (شراء/بيع أصول)</td></tr>`;
          if ((inv.inflows || []).length === 0 && (inv.outflows || []).length === 0) {
            html += `<tr><td colspan="4" style="text-align: center; color: var(--text-secondary);">لا توجد حركات استثمارية</td></tr>`;
          } else {
            (inv.inflows || []).forEach(it => {
              html += `<tr><td>${it.item}</td><td style="text-align:left;direction:ltr;color:var(--accent-green);">${Reports.formatNumber(it.amount)}</td><td>-</td><td style="text-align:left;direction:ltr;font-weight:bold;color:var(--accent-green);">+${Reports.formatNumber(it.amount)} ${this.reportCurrency()}</td></tr>`;
            });
            (inv.outflows || []).forEach(it => {
              html += `<tr><td>${it.item}</td><td>-</td><td style="text-align:left;direction:ltr;color:var(--accent-red);">${Reports.formatNumber(it.amount)}</td><td style="text-align:left;direction:ltr;font-weight:bold;color:var(--accent-red);">-${Reports.formatNumber(it.amount)} ${this.reportCurrency()}</td></tr>`;
            });
          }
          html += `
            <tr style="background: rgba(255,255,255,0.03); font-weight: bold;">
              <td>صافي النقد من الأنشطة الاستثمارية</td>
              <td colspan="2"></td>
              <td style="text-align: left; direction: ltr; font-family: monospace; color: ${inv.net >= 0 ? 'var(--accent-green)' : 'var(--accent-red)'}; font-size: 1.05rem;">${Reports.formatNumber(inv.net || 0)} ${this.reportCurrency()}</td>
            </tr>
          `;

          // 3. الأنشطة التمويلية
          html += `<tr style="background: rgba(245,158,11,0.12); font-weight: bold;"><td colspan="4">ثالثاً: التدفقات النقدية من الأنشطة التمويلية (رأس المال والقروض)</td></tr>`;
          if ((fin.inflows || []).length === 0 && (fin.outflows || []).length === 0) {
            html += `<tr><td colspan="4" style="text-align: center; color: var(--text-secondary);">لا توجد حركات تمويلية</td></tr>`;
          } else {
            (fin.inflows || []).forEach(it => {
              html += `<tr><td>${it.item}</td><td style="text-align:left;direction:ltr;color:var(--accent-green);">${Reports.formatNumber(it.amount)}</td><td>-</td><td style="text-align:left;direction:ltr;font-weight:bold;color:var(--accent-green);">+${Reports.formatNumber(it.amount)} ${this.reportCurrency()}</td></tr>`;
            });
            (fin.outflows || []).forEach(it => {
              html += `<tr><td>${it.item}</td><td>-</td><td style="text-align:left;direction:ltr;color:var(--accent-red);">${Reports.formatNumber(it.amount)}</td><td style="text-align:left;direction:ltr;font-weight:bold;color:var(--accent-red);">-${Reports.formatNumber(it.amount)} ${this.reportCurrency()}</td></tr>`;
            });
          }
          html += `
            <tr style="background: rgba(255,255,255,0.03); font-weight: bold;">
              <td>صافي النقد من الأنشطة التمويلية</td>
              <td colspan="2"></td>
              <td style="text-align: left; direction: ltr; font-family: monospace; color: ${fin.net >= 0 ? 'var(--accent-green)' : 'var(--accent-red)'}; font-size: 1.05rem;">${Reports.formatNumber(fin.net || 0)} ${this.reportCurrency()}</td>
            </tr>
          `;

          // إجماليات التدفق الختامية
          html += `
            <tr style="background: rgba(212,175,55,0.15); font-weight: bold; font-size: 1.05rem;">
              <td>صافي التغير في النقدية خلال الفترة</td>
              <td colspan="2"></td>
              <td style="text-align: left; direction: ltr; font-family: monospace; color: var(--gold-light);">${Reports.formatNumber(d.net_cash_change || 0)} ${this.reportCurrency()}</td>
            </tr>
            <tr style="background: rgba(255,255,255,0.06); font-weight: bold;">
              <td>رصيد النقدية والبنوك في نهاية المدة</td>
              <td colspan="2"></td>
              <td style="text-align: left; direction: ltr; font-family: monospace; color: var(--accent-green); font-size: 1.1rem;">${Reports.formatNumber(d.closing_balance || 0)} ${this.reportCurrency()}</td>
            </tr>
          `;

          tbody.innerHTML = html;
        }
      }
    } catch (e) {
      console.error('❌ Error loading cash flow:', e);
      App.showToast('فشل تحميل التدفقات النقدية', 'error');
    }
  },

  // =========================================================================
  // 6. تقرير ربحية المشاريع (Projects Profitability)
  // =========================================================================
  async loadProjectsProfitability() {
    const fromDate = document.getElementById('repProjFromDate')?.value || '';
    const toDate = document.getElementById('repProjToDate')?.value || '';
    const projectId = document.getElementById('repProjFilterSelect')?.value || '';

    let url = '/api/reports/projects-profitability';
    const params = new URLSearchParams();
    if (fromDate) params.append('from_date', fromDate);
    if (toDate) params.append('to_date', toDate);
    if (projectId) params.append('project_id', projectId);
    if (params.toString()) url += '?' + params.toString();

    try {
      const res = await this.fetchFinancialReport(url);
      const json = await res.json();
      if (json.success && json.data) {
        this.lastReportData['projects-profitability'] = json;
        const projects = json.data;

        // تحديث القائمة المنسدلة للمشاريع إذا كانت فارغة
        const select = document.getElementById('repProjFilterSelect');
        if (select && select.options.length <= 1 && projects.length > 0) {
          select.innerHTML = '<option value="">كافة المشاريع</option>' +
            projects.map(p => `<option value="${p.id}">${p.name} (${p.code})</option>`).join('');
          if (projectId) select.value = projectId;
        }

        const tbody = document.getElementById('projProfitTableBody');
        if (tbody) {
          if (projects.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-secondary); padding: 18px;">لا توجد بيانات مشاريع</td></tr>`;
          } else {
            tbody.innerHTML = projects.map(p => {
              const isProfit = (p.calculated_actual_profit || 0) >= 0;
              return `
                <tr>
                  <td><strong>${p.name}</strong> <small style="color:var(--text-secondary)">(${p.code})</small></td>
                  <td>${p.client_name || '-'}</td>
                  <td style="color: var(--gold-light); font-weight: bold;">${Reports.formatNumber(p.contract_value || 0)}</td>
                  <td style="color: var(--accent-red);">${Reports.formatNumber(p.actual_cost || 0)}</td>
                  <td style="color: #38bdf8; font-weight: 600;">${Reports.formatNumber(p.recognized_revenue || 0)}</td>
                  <td style="color: ${isProfit ? 'var(--accent-green)' : 'var(--accent-red)'}; font-weight: bold;">
                    ${Reports.formatNumber(p.calculated_actual_profit || 0)}
                  </td>
                  <td><span class="badge ${isProfit ? 'badge-income' : 'badge-expense'}">${p.profit_margin_percentage || 0}%</span></td>
                  <td>
                    <div style="display: flex; align-items: center; gap: 6px;">
                      <div class="progress-wrap"><div class="progress-bar-fill" style="width: ${Math.min(100, p.progress_percentage || 0)}%"></div></div>
                      <span style="font-size:0.75rem">${p.progress_percentage || 0}%</span>
                    </div>
                  </td>
                </tr>
              `;
            }).join('');
          }
        }
      }
    } catch (e) {
      console.error('❌ Error loading projects profitability:', e);
    }
  },

  // =========================================================================
  // 7. تقرير ربحية مراكز التكلفة (Cost Centers Profitability)
  // =========================================================================
  async loadCostCentersProfitability() {
    const fromDate = document.getElementById('repCcFromDate')?.value || '';
    const toDate = document.getElementById('repCcToDate')?.value || '';
    const ccId = document.getElementById('repCcFilterSelect')?.value || '';

    let url = '/api/reports/cost-centers-profitability';
    const params = new URLSearchParams();
    if (fromDate) params.append('from_date', fromDate);
    if (toDate) params.append('to_date', toDate);
    if (ccId) params.append('cost_center_id', ccId);
    if (params.toString()) url += '?' + params.toString();

    try {
      const res = await this.fetchFinancialReport(url);
      const json = await res.json();
      if (json.success && json.data) {
        const d = json.data;
        this.lastReportData['cost-centers-profitability'] = json;

        // تحديث القائمة المنسدلة لمراكز التكلفة
        const select = document.getElementById('repCcFilterSelect');
        if (select && select.options.length <= 1 && d.centers && d.centers.length > 0) {
          select.innerHTML = '<option value="">كافة مراكز التكلفة</option>' +
            d.centers.map(c => `<option value="${c.id}">${c.name} (${c.code})</option>`).join('');
          if (ccId) select.value = ccId;
        }

        const totRevEl = document.getElementById('ccProfitTotalRev');
        const totExpEl = document.getElementById('ccProfitTotalExp');
        const totNetEl = document.getElementById('ccProfitTotalNet');
        const totMarginEl = document.getElementById('ccProfitTotalMargin');

        if (totRevEl) totRevEl.textContent = Reports.formatNumber(d.totals?.total_revenue || 0) + ' ' + this.reportCurrency();
        if (totExpEl) totExpEl.textContent = Reports.formatNumber(d.totals?.total_expense || 0) + ' ' + this.reportCurrency();
        if (totNetEl) {
          totNetEl.textContent = Reports.formatNumber(d.totals?.net_profit || 0) + ' ' + this.reportCurrency();
          totNetEl.style.color = (d.totals?.net_profit || 0) >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
        }
        if (totMarginEl) totMarginEl.textContent = (d.totals?.overall_margin || 0) + '%';

        const tbody = document.getElementById('ccProfitTableBody');
        if (tbody) {
          if (!d.centers || d.centers.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--text-secondary); padding: 18px;">لا توجد مراكز تكلفة مسجلة</td></tr>';
          } else {
            tbody.innerHTML = d.centers.map(cc => {
              const isProfit = (cc.net_profit || 0) >= 0;
              const statusBadge = isProfit
                ? `<span class="badge" style="background: rgba(34,197,94,0.15); color: #4ade80;">ربح محقق (${cc.profit_margin}%)</span>`
                : `<span class="badge" style="background: rgba(239,68,68,0.15); color: #f87171;">عجز / خسارة (${cc.profit_margin}%)</span>`;

              return `
                <tr>
                  <td><strong>${cc.code}</strong></td>
                  <td><strong style="color: #fff;">${cc.name}</strong></td>
                  <td><span class="badge badge-info">${this.financialTypeLabel(cc.type || 'مركز تكلفة')}</span></td>
                  <td>${cc.project_name || '-'}</td>
                  <td style="color: var(--gold-light); font-weight: bold;">${Reports.formatNumber(cc.total_revenue || 0)} ${this.reportCurrency()}</td>
                  <td style="color: #38bdf8; font-weight: bold;">${Reports.formatNumber(cc.total_expense || 0)} ${this.reportCurrency()}</td>
                  <td style="color: ${isProfit ? 'var(--accent-green)' : 'var(--accent-red)'}; font-weight: bold;">${Reports.formatNumber(cc.net_profit || 0)} ${this.reportCurrency()}</td>
                  <td>${statusBadge}</td>
                </tr>
              `;
            }).join('');
          }
        }
      }
    } catch (e) {
      console.error('❌ Error loading cost centers profitability:', e);
    }
  },

  // =========================================================================
  // 8. كشف حساب عميل مفصل ومطابق للأستاذ (Client Statement)
  // =========================================================================
  async initClientStatementDropdown(selectedId = null) {
    const select = document.getElementById('repClientSelect');
    if (!select) return;

    try {
      const res = await fetch('/api/clients');
      const json = await res.json();
      if (json.success && json.data) {
        select.innerHTML = `<option value="">اختر العميل...</option>` +
          json.data.map(c => `<option value="${c.id}">${c.name}${c.company ? ' (' + c.company + ')' : ''}</option>`).join('');
      }
    } catch (e) {
      console.error('Error fetching clients for dropdown:', e);
    }

    if (selectedId) {
      select.value = selectedId;
    }
  },

  async fetchFullClientStatement(explicitClientId = null) {
    const clientId = explicitClientId || document.getElementById('repClientSelect')?.value;
    if (!clientId) return;

    const fromDate = document.getElementById('repClientFromDate')?.value || '';
    const toDate = document.getElementById('repClientToDate')?.value || '';
    let url = `/api/reports/client-statement/${clientId}`;
    const params = new URLSearchParams();
    if (fromDate) params.append('from_date', fromDate);
    if (toDate) params.append('to_date', toDate);
    if (params.toString()) url += '?' + params.toString();

    try {
      const res = await this.fetchFinancialReport(url);
      const json = await res.json();
      if (json.success && json.data) {
        const { client, statement, summary } = json.data;
        this.lastReportData['client-statement'] = json;
        const cCurr = client.currency || 'ر.ي';

        const infoEl = document.getElementById('repClientInfo');
        if (infoEl) {
          infoEl.innerHTML = `
            <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid var(--border-color); padding: 16px; border-radius: 10px; margin-bottom: 16px;">
              <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                <div>
                  <h3 style="color: #fff; margin: 0 0 4px 0; font-size: 1.2rem;">${client.name} ${client.company ? `<span style="font-size: 0.85rem; color: #38bdf8;">(${client.company})</span>` : ''}</h3>
                  <span style="font-size: 0.8rem; color: var(--text-secondary);">الهاتف: ${client.phone || '-'} | العنوان: ${client.address || '-'}</span>
                </div>
                <div style="display: flex; gap: 14px; background: rgba(0,0,0,0.3); padding: 8px 16px; border-radius: 8px;">
                  <div><span style="font-size:0.75rem;color:var(--text-secondary)">إجمالي المطالبات:</span> <strong style="color:var(--accent-red)">${Reports.formatNumber(summary.total_invoiced || 0)} ${cCurr}</strong></div>
                  <div><span style="font-size:0.75rem;color:var(--text-secondary)">إجمالي المحصل:</span> <strong style="color:var(--accent-green)">${Reports.formatNumber(summary.total_collected || 0)} ${cCurr}</strong></div>
                  <div><span style="font-size:0.75rem;color:var(--text-secondary)">الرصيد المستحق:</span> <strong style="color:var(--gold-light);font-size:1.1rem">${Reports.formatNumber(summary.outstanding_balance || 0)} ${cCurr}</strong></div>
                </div>
              </div>
            </div>
          `;
        }

        const tbody = document.getElementById('repClientStatementTable');
        if (tbody) {
          if (!statement || statement.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 25px; color: var(--text-secondary);">لا توجد حركات مسجلة لهذا العميل في هذه الفترة</td></tr>`;
          } else {
            tbody.innerHTML = statement.map(s => {
              const runBal = Number(s.running_balance || 0);
              const runBalColor = runBal > 0 ? 'var(--accent-red)' : (runBal < 0 ? 'var(--accent-green)' : 'var(--text-secondary)');
              return `
                <tr>
                  <td>${s.date || '-'}</td>
                  <td><strong>${s.type}</strong></td>
                  <td><span style="font-family: monospace; color: #fff;">${s.ref || '-'}</span></td>
                  <td>${s.project_name || '-'}</td>
                  <td style="color: var(--accent-red); font-weight: bold;">${s.debit ? Reports.formatNumber(s.debit) : '-'}</td>
                  <td style="color: var(--accent-green); font-weight: bold;">${s.credit ? Reports.formatNumber(s.credit) : '-'}</td>
                  <td style="font-weight: 800; color: ${runBalColor};">${Reports.formatNumber(runBal)}</td>
                  <td style="font-size: 0.8rem; color: var(--text-secondary); max-width: 250px;">${s.notes || '-'}</td>
                </tr>
              `;
            }).join('');
          }
        }
      }
    } catch (e) {
      console.error('❌ Error fetching client statement:', e);
    }
  },

  // =========================================================================
  // 9. كشف حساب مورد مفصل ومطابق للأستاذ (Supplier Statement)
  // =========================================================================
  async initSupplierStatementDropdown(selectedId = null) {
    const select = document.getElementById('repSupplierSelect');
    if (!select) return;

    try {
      const res = await fetch('/api/suppliers');
      const json = await res.json();
      if (json.success && json.data) {
        select.innerHTML = `<option value="">-- اختر المورد لعرض كشف الحساب --</option>` +
          json.data.map(s => {
            const name = s.company_name || s.name || 'مورد';
            const curr = s.default_currency || s.currency || 'YER';
            return `<option value="${s.id}">${name} (${curr})</option>`;
          }).join('');
      }
    } catch (e) {
      console.warn('Failed to fetch suppliers:', e);
    }

    if (selectedId) {
      select.value = String(selectedId);
      await this.fetchFullSupplierStatement();
    }
  },

  async fetchFullSupplierStatement() {
    const supplierId = document.getElementById('repSupplierSelect')?.value;
    const infoEl = document.getElementById('repSupplierInfo');
    const tbody = document.getElementById('repSupplierStatementTable');
    const tfoot = document.getElementById('repSupplierStatementFooter');

    if (!supplierId) {
      if (infoEl) infoEl.innerHTML = '';
      if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 24px; color: var(--text-secondary);">يرجى اختيار مورد لعرض كشف الحساب</td></tr>`;
      if (tfoot) tfoot.innerHTML = '';
      return;
    }

    const fromDate = document.getElementById('repSupplierFromDate')?.value || '';
    const toDate = document.getElementById('repSupplierToDate')?.value || '';
    let url = `/api/reports/supplier-statement/${supplierId}`;
    const params = new URLSearchParams();
    if (fromDate) params.append('from_date', fromDate);
    if (toDate) params.append('to_date', toDate);
    if (params.toString()) url += '?' + params.toString();

    try {
      const res = await this.fetchFinancialReport(url);
      const json = await res.json();
      if (json.success && json.data) {
        const { supplier, statement, summary } = json.data;
        this.lastReportData['supplier-statement'] = json;
        const sCurr = supplier.currency || 'ر.ي';

        if (infoEl) {
          infoEl.innerHTML = `
            <div style="background: var(--card-bg, #0f172a); border: 1px solid var(--border-color); padding: 16px 20px; border-radius: 12px; margin-bottom: 16px;">
              <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
                <div>
                  <h3 style="margin: 0; font-size: 1.25rem; color: var(--text-primary);">${supplier.name}</h3>
                  <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 4px;">الهاتف: ${supplier.phone || '-'} | العملة: ${sCurr}</div>
                </div>
                <div style="display: grid; grid-template-columns: repeat(3, auto); gap: 14px;">
                  <div style="background: rgba(59,130,246,0.1); padding: 8px 14px; border-radius: 6px; text-align: center;">
                    <div style="font-size: 0.72rem; color: var(--text-secondary);">إجمالي الاستحقاق (له):</div>
                    <strong style="color: #3b82f6;">${Reports.formatNumber(summary.total_invoiced || 0)} ${sCurr}</strong>
                  </div>
                  <div style="background: rgba(16,185,129,0.1); padding: 8px 14px; border-radius: 6px; text-align: center;">
                    <div style="font-size: 0.72rem; color: var(--text-secondary);">إجمالي المسدد (عليه):</div>
                    <strong style="color: #10b981;">${Reports.formatNumber(summary.total_paid || 0)} ${sCurr}</strong>
                  </div>
                  <div style="background: rgba(245,158,11,0.1); padding: 8px 14px; border-radius: 6px; text-align: center;">
                    <div style="font-size: 0.72rem; color: var(--text-secondary);">صافي الرصيد المستحق:</div>
                    <strong style="color: #f59e0b; font-size: 1.05rem;">${Reports.formatNumber(summary.outstanding_balance || 0)} ${sCurr}</strong>
                  </div>
                </div>
              </div>
            </div>
          `;
        }

        if (tbody) {
          if (!statement || statement.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 25px; color: var(--text-secondary);">لا توجد حركات مسجلة لهذا المورد في هذه الفترة</td></tr>`;
            if (tfoot) tfoot.innerHTML = '';
          } else {
            tbody.innerHTML = statement.map(s => {
              const runBalColor = (s.running_balance || 0) > 0 ? 'var(--accent-amber)' : 'var(--accent-green)';
              return `
                <tr>
                  <td style="white-space: nowrap; font-family: monospace;">${s.date || '-'}</td>
                  <td><span class="badge" style="background: rgba(59,130,246,0.12); color: #3b82f6; font-size: 0.78rem;">${s.type}</span></td>
                  <td style="font-weight: 600; font-family: monospace;">${s.ref || '-'}</td>
                  <td style="color: var(--accent-amber); font-weight: 700; text-align: right;">${s.credit ? Reports.formatNumber(s.credit) : '-'}</td>
                  <td style="color: var(--accent-green); font-weight: 700; text-align: right;">${s.debit ? Reports.formatNumber(s.debit) : '-'}</td>
                  <td style="font-weight: 800; text-align: right; color: ${runBalColor};">${Reports.formatNumber(s.running_balance ?? 0)}</td>
                  <td style="font-size: 0.85rem; color: var(--text-secondary);">${s.notes || '-'}</td>
                </tr>
              `;
            }).join('');

            if (tfoot) {
              tfoot.innerHTML = `
                <tr style="background: var(--bg-secondary); font-weight: bold; border-top: 2px solid var(--border-color);">
                  <td colspan="3" style="text-align: center;">الإجمالي العام</td>
                  <td style="color: var(--accent-amber); text-align: right;">${Reports.formatNumber(summary.total_invoiced || 0)}</td>
                  <td style="color: var(--accent-green); text-align: right;">${Reports.formatNumber(summary.total_paid || 0)}</td>
                  <td style="color: #f59e0b; text-align: right; font-size: 1.05rem;">${Reports.formatNumber(summary.outstanding_balance || 0)}</td>
                  <td>${summary.outstanding_balance === 0 ? 'مسوى بالكامل ✓' : 'متبقي مستحق'}</td>
                </tr>
              `;
            }
          }
        }
      }
    } catch (e) {
      console.error('❌ Error fetching supplier statement:', e);
    }
  },

  printSupplierStatement() {
    this.activeReportTab = 'supplier-statement';
    this.printActiveReport();
  },

  // =========================================================================
  // طباعة التقارير المعتمدة الرسمية (Print Official Document)
  // =========================================================================
  printActiveReport() {
    if (!this.lastReportData[this.activeReportTab || 'income-statement']) return App.showToast('اعرض التقرير أولاً قبل الطباعة', 'warning');
    const printArea = document.getElementById('printArea');
    if (!printArea) return;

    const cfg = (typeof Settings !== 'undefined' && Settings.getPrintConfig) ? Settings.getPrintConfig() : {
      sig1: 'المحاسب المالي',
      sig2: 'المدير العام',
      sig3: 'اعتماد الإدارة',
      show_stamp: '0',
      footer_notes: 'تعتبر هذه التقارير والبيانات معتمدة رسمياً ومستخرجة من دفتر الأستاذ العام لشركة رواسي عدن للهندسة والمقاولات'
    };

    const todayDate = new Date().toISOString().split('T')[0];
    const tab = this.activeReportTab || 'income-statement';
    const reportData = this.lastReportData[tab] || {};

    let reportTitle = 'تقرير مالي معتمد';
    let reportBodyHtml = '';
    let reportMeta = [
      { label: 'المصدر المحاسبي', val: 'دفتر الأستاذ العام (General Ledger)' },
      { label: 'تاريخ الإصدار', val: todayDate },
      { label: 'حالة التوازن', val: reportData.reconciliation?.is_balanced === false ? 'يوجد فرق؛ راجع تفاصيل التقرير' : 'بحسب مطابقة التقرير' }
    ];

    if (tab === 'profit-loss' || tab === 'income-statement') {
      reportTitle = (tab === 'income-statement' ? cfg.income_stmt_title : cfg.pl_title) || 'قائمة الدخل والأرباح والخسائر الرسمية';
      const d = reportData.data || {};
      reportBodyHtml = `
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px;">
          <div style="border: 1px solid #86efac; border-radius: 6px; padding: 10px; text-align: center; background: #f0fdf4;">
            <div style="font-size: 0.8rem; color: #15803d;">إجمالي الإيرادات المعترف بها</div>
            <div style="font-weight: 900; font-size: 1.2rem; color: #15803d;">${Reports.formatNumber(d.total_income || d.total_revenues || 0)} ${this.reportCurrency()}</div>
          </div>
          <div style="border: 1px solid #fca5a5; border-radius: 6px; padding: 10px; text-align: center; background: #fef2f2;">
            <div style="font-size: 0.8rem; color: #b91c1c;">إجمالي التكاليف والمصروفات</div>
            <div style="font-weight: 900; font-size: 1.2rem; color: #b91c1c;">${Reports.formatNumber(d.total_expenses || 0)} ${this.reportCurrency()}</div>
          </div>
          <div style="border: 1.5px solid #d4af37; border-radius: 6px; padding: 10px; text-align: center; background: #fdfaf2;">
            <div style="font-size: 0.8rem; color: #b8911c;">صافي الدخل التشغيلي</div>
            <div style="font-weight: 900; font-size: 1.25rem; color: #047857;">${Reports.formatNumber(d.net_profit || 0)} ${this.reportCurrency()}</div>
          </div>
        </div>
        <div style="font-weight: 800; color: #0f2744; font-size: 0.95rem; margin-bottom: 8px;">توزيع بنود الإيرادات والتكاليف:</div>
        <table class="official-report-table">
          <thead><tr><th>البيان المحاسبي</th><th>المبلغ المحقق</th></tr></thead>
          <tbody>
            <tr><td>إجمالي الإيرادات المعترف بها (4)</td><td style="color:#15803d;font-weight:bold">${Reports.formatNumber(d.total_income || d.total_revenues || 0)} ${this.reportCurrency()}</td></tr>
            ${(d.revenues || []).map(row => `<tr><td>${row.code || ""} - ${row.name}</td><td>${Reports.formatNumber(row.amount || 0)} ${this.reportCurrency()}</td></tr>`).join("")}
            ${(d.expenses || []).map(row => `<tr><td>${row.code || ""} - ${row.name}</td><td style="color:#b91c1c">${Reports.formatNumber(row.amount || 0)} ${this.reportCurrency()}</td></tr>`).join("")}
            <tr><td>تكلفة الإيراد المباشرة</td><td style="color:#b91c1c">${Reports.formatNumber(d.total_direct_costs || 0)} ${this.reportCurrency()}</td></tr>
            <tr style="background:#f8fafc;font-weight:bold"><td>مجمل الربح</td><td style="color:#047857">${Reports.formatNumber(d.gross_profit || 0)} ${this.reportCurrency()}</td></tr>
            <tr><td>المصروفات التشغيلية والإدارية</td><td style="color:#b91c1c">${Reports.formatNumber(d.total_operating_expenses || 0)} ${this.reportCurrency()}</td></tr>
            <tr style="background:#f0fdf4;font-weight:900;font-size:1.1rem"><td>صافي الربح / الدخل النهائي</td><td style="color:#047857">${Reports.formatNumber(d.net_profit || 0)} ${this.reportCurrency()}</td></tr>
          </tbody>
        </table>
      `;
    } else if (tab === 'project-budget') {
      reportTitle = 'موازنة المشروع — التقديري مقابل الفعلي';
      reportBodyHtml = '<p>حتى تاريخ: '+(reportData.meta?.as_of_date || '')+'</p>'+this.budgetReportHtml(reportData.data || {});
    } else if (tab === 'account-movement') {
      reportTitle = 'تقرير حركة الحساب';
      const d = reportData.data || {};
      const totals = d.totals || {};
      const rows = (d.movements || []).map(row => `
        <tr><td>${row.date || '-'}</td><td>${row.entry_no || '-'}</td><td>${row.reference || '-'}</td>
        <td>${row.description || row.notes || '-'}</td><td>${row.cost_center_name || 'عام'}</td>
        <td>${row.debit ? Reports.formatNumber(row.debit) : '-'}</td><td>${row.credit ? Reports.formatNumber(row.credit) : '-'}</td>
        <td>${Reports.formatNumber(row.running_balance || 0)}</td></tr>
      `).join('');
      reportBodyHtml = `
        <div style="margin-bottom:12px;font-weight:bold;">${d.account ? `${d.account.code} - ${d.account.name}` : ''}</div>
        <table class="official-report-table"><thead><tr><th>التاريخ</th><th>القيد</th><th>المرجع</th><th>البيان</th><th>مركز التكلفة</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead>
        <tbody><tr style="font-weight:bold"><td colspan="7">الرصيد الافتتاحي</td><td>${Reports.formatNumber(totals.opening_balance || 0)}</td></tr>${rows}
        <tr style="font-weight:bold"><td colspan="5">الإجمالي</td><td>${Reports.formatNumber(totals.total_debit || 0)}</td><td>${Reports.formatNumber(totals.total_credit || 0)}</td><td>${Reports.formatNumber(totals.closing_balance || 0)}</td></tr></tbody></table>`;
    } else if (tab === 'trial-balance') {
      reportTitle = cfg.trial_balance_title || 'ميزان المراجعة بالأرصدة والمجاميع';
      const d = reportData.data || {};
      const rows = (d.accounts || []).map(a => `
        <tr>
          <td style="font-family: monospace;">${a.code}</td>
          <td>${a.name}</td>
          <td>${this.financialTypeLabel(a.type)}</td>
          <td style="text-align: left; font-family: monospace;">${a.period_debit ? Reports.formatNumber(a.period_debit) : '-'}</td>
          <td style="text-align: left; font-family: monospace;">${a.period_credit ? Reports.formatNumber(a.period_credit) : '-'}</td>
          <td style="text-align: left; font-family: monospace; font-weight: bold;">${a.closing_debit ? Reports.formatNumber(a.closing_debit) : '-'}</td>
          <td style="text-align: left; font-family: monospace; font-weight: bold;">${a.closing_credit ? Reports.formatNumber(a.closing_credit) : '-'}</td>
        </tr>
      `).join('');
      reportBodyHtml = `
        <table class="official-report-table">
          <thead>
            <tr><th>رقم الحساب</th><th>اسم الحساب</th><th>النوع</th><th>مدين الفترة</th><th>دائن الفترة</th><th>رصيد مدين</th><th>رصيد دائن</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      `;
    } else if (tab === 'balance-sheet') {
      reportTitle = cfg.balance_sheet_title || 'قائمة المركز المالي والميزانية العمومية';
      const assetsHtml = document.getElementById('bsAssetsTable')?.innerHTML || '';
      const liabHtml = document.getElementById('bsLiabTable')?.innerHTML || '';
      const totA = document.getElementById('bsTotalAssets')?.textContent || '0';
      const totL = document.getElementById('bsTotalLiabEquity')?.textContent || '0';
      reportBodyHtml = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
          <div>
            <div style="font-weight: 800; color: #0f2744; margin-bottom: 6px;">الأصول</div>
            <table class="official-report-table"><tbody>${assetsHtml}<tr style="background:#f0fdf4;font-weight:bold"><td>الإجمالي</td><td>${totA}</td></tr></tbody></table>
          </div>
          <div>
            <div style="font-weight: 800; color: #0f2744; margin-bottom: 6px;">الالتزامات والملكية</div>
            <table class="official-report-table"><tbody>${liabHtml}<tr style="background:#fef2f2;font-weight:bold"><td>الإجمالي</td><td>${totL}</td></tr></tbody></table>
          </div>
        </div>
      `;
    } else if (tab === 'cash-flow') {
      reportTitle = cfg.cash_flow_title || 'قائمة التدفقات النقدية الفعلية';
      const cfHtml = document.getElementById('cashFlowTableBody')?.innerHTML || '';
      reportBodyHtml = `<table class="official-report-table"><thead><tr><th>بيان التدفق</th><th>مقبوضات (+)</th><th>مدفوعات (-)</th><th>الصافي</th></tr></thead><tbody>${cfHtml}</tbody></table>`;
    } else if (tab === 'client-statement') {
      reportTitle = cfg.client_stmt_title || 'كشف حساب عميل معتمد ومطابق للأستاذ';
      const cInfo = document.getElementById('repClientInfo')?.innerHTML || '';
      const cRows = document.getElementById('repClientStatementTable')?.innerHTML || '';
      reportBodyHtml = `<div style="margin-bottom:12px">${cInfo}</div><table class="official-report-table"><thead><tr><th>التاريخ</th><th>نوع الحركة</th><th>المرجع</th><th>المشروع</th><th>مدين</th><th>دائن</th><th>الرصيد</th><th>البيان</th></tr></thead><tbody>${cRows}</tbody></table>`;
    } else if (tab === 'supplier-statement') {
      reportTitle = cfg.supplier_stmt_title || 'كشف حساب مورد معتمد ومطابق للأستاذ';
      const sInfo = document.getElementById('repSupplierInfo')?.innerHTML || '';
      const sRows = document.getElementById('repSupplierStatementTable')?.innerHTML || '';
      reportBodyHtml = `<div style="margin-bottom:12px">${sInfo}</div><table class="official-report-table"><thead><tr><th>التاريخ</th><th>نوع الحركة</th><th>المرجع</th><th>دائن</th><th>مدين</th><th>الرصيد</th><th>البيان</th></tr></thead><tbody>${sRows}</tbody></table>`;
    }

    const docClass = (typeof Settings !== 'undefined' && Settings.getReportDocClass)
      ? Settings.getReportDocClass(cfg)
      : 'multi-page-report-document border-classic density-medium margins-normal';

    const headerHtml = (typeof Settings !== 'undefined' && Settings.renderReportHeader)
      ? Settings.renderReportHeader(reportTitle, reportMeta, cfg)
      : `
        <div class="letterhead-doc-header">
          <div class="letterhead-doc-title-badge">${reportTitle}</div>
          <div class="letterhead-doc-meta">
            <div class="letterhead-doc-meta-item">تاريخ الطباعة: <strong>${todayDate}</strong></div>
          </div>
        </div>
      `;

    const sigHtml = (typeof Settings !== 'undefined' && Settings.renderReportSignatures)
      ? Settings.renderReportSignatures(cfg)
      : `
        <div class="letterhead-signatures-row" style="margin-top: 20px;">
          <div class="letterhead-sig-col"><div class="letterhead-sig-label">${cfg.sig1 || 'المحاسب المالي'}</div><div class="letterhead-sig-dots">المحاسب: ........................</div></div>
          <div class="letterhead-sig-col"><div class="letterhead-sig-label">${cfg.sig2 || 'المدير العام'}</div><div class="letterhead-sig-dots">الاعتماد: ........................</div></div>
          <div class="letterhead-sig-col"><div class="letterhead-sig-label">${cfg.sig3 || 'اعتماد الإدارة'}</div><div class="letterhead-sig-dots">الاعتماد: ........................</div></div>
        </div>
      `;

    reportBodyHtml += this.accountDetailsHtml(reportData.data);
    reportBodyHtml = `<p style="font-size:0.8rem">${this.describeReportFilters(reportData.meta)}</p>` + reportBodyHtml;
    printArea.innerHTML = `
      <div class="${docClass}">
        ${headerHtml}
        <div class="report-content-body">${reportBodyHtml}</div>
        ${sigHtml}
      </div>
    `;

    if (typeof Settings !== 'undefined' && Settings.setPrintTitle) {
      Settings.setPrintTitle(reportTitle);
    }
    window.print();
  },

  // =========================================================================
  // تصدير Excel المتخصص
  // =========================================================================
  exportActiveReportToExcel() {
    if (!this.lastReportData[this.activeReportTab || 'income-statement']) return App.showToast('اعرض التقرير أولاً قبل التصدير', 'warning');
    const tab = this.activeReportTab || 'income-statement';
    const reportData = this.lastReportData[tab] || null;

    if (typeof ExcelExporter !== 'undefined') {
      if (tab === 'profit-loss') {
        ExcelExporter.exportProfitLoss(reportData);
      } else if (tab === 'trial-balance') {
        ExcelExporter.exportTrialBalance(reportData);
      } else if (tab === 'income-statement') {
        ExcelExporter.exportIncomeStatement(reportData);
      } else if (tab === 'project-budget') {
        ExcelExporter.exportProjectBudget(reportData);
      } else if (tab === 'account-movement') {
        ExcelExporter.exportAccountMovement(reportData);
      } else if (tab === 'balance-sheet') {
        ExcelExporter.exportBalanceSheet(reportData);
      } else if (tab === 'cash-flow') {
        ExcelExporter.exportCashFlow(reportData);
      } else if (tab === 'projects-profitability') {
        ExcelExporter.exportProjectsProfitability(reportData);
      } else if (tab === 'cost-centers-profitability') {
        ExcelExporter.exportCostCentersProfitability(reportData);
      } else if (tab === 'client-statement') {
        ExcelExporter.exportClientStatement(reportData);
      } else if (tab === 'supplier-statement') {
        ExcelExporter.exportSupplierStatement(reportData);
      } else {
        App.showToast('يرجى تحديد التقرير المطلوب لتصديره إلى Excel', 'warning');
      }
    }
  },

  // =========================================================================
  // مصفوفة الفصل المالي وإثبات إيراد المقاولات IFRS 15
  // =========================================================================
  async openContractingSeparationModal() {
    App.openModal('contractingSeparationModal');
    const tbody = document.getElementById('contractingMatrixTableBody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="13" style="text-align: center; color: var(--text-secondary); padding: 25px;">جاري تحميل مصفوفة المقاولات المالية (IFRS 15)...</td></tr>';
    }

    try {
      const res = await fetch('/api/billing/contracting-matrix');
      const json = await res.json();
      if (!res.ok || !json.projects) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="13" style="text-align: center; color: var(--accent-red); padding: 20px;">${json.message || 'فشل جلب بيانات مصفوفة المقاولات'}</td></tr>`;
        return;
      }

      if (json.projects.length === 0) {
        if (tbody) tbody.innerHTML = '<tr><td colspan="13" style="text-align: center; color: var(--text-secondary); padding: 25px;">لا توجد مشاريع مسجلة في مصفوفة المقاولات</td></tr>';
        return;
      }

      if (tbody) {
        tbody.innerHTML = json.projects.map(p => {
          const contractVal = p.revised_contract_value || p.base_contract_value || 0;
          const actualCost = p.cumulative_actual_cost || 0;
          const pocPct = (p.cost_to_cost_poc_pct || 0).toFixed(1);
          const recRev = p.recognized_revenue?.cumulative || 0;
          const billed = p.progress_billings?.gross || 0;
          const wip = p.contract_assets?.work_in_progress_wip || 0;
          const cash = p.cash_receipts?.total || 0;
          const adv = p.contract_liabilities?.unamortized_advance || 0;
          const ret = p.contract_assets?.retention_receivable || 0;
          const profit = p.performance_comparison?.net_profit || 0;
          const netCash = p.performance_comparison?.net_cash_flow || 0;

          return `
            <tr>
              <td><strong>${p.project_name}</strong><br><small style="color: var(--text-secondary);">${p.project_code || ''}</small></td>
              <td>${p.client_name || '-'}</td>
              <td style="color: var(--gold-light); font-weight: 600;">${Reports.formatNumber(contractVal)}</td>
              <td style="color: var(--accent-red);">${Reports.formatNumber(actualCost)}</td>
              <td><strong>${pocPct}%</strong></td>
              <td style="color: #38bdf8; font-weight: 600;">${Reports.formatNumber(recRev)}</td>
              <td style="color: var(--accent-green);">${Reports.formatNumber(billed)}</td>
              <td>${Reports.formatNumber(wip)}</td>
              <td style="color: #4ade80;">${Reports.formatNumber(cash)}</td>
              <td style="color: #facc15;">${Reports.formatNumber(adv)}</td>
              <td style="color: #94a3b8;">${Reports.formatNumber(ret)}</td>
              <td style="color: ${profit >= 0 ? '#4ade80' : '#f87171'}; font-weight: bold;">${Reports.formatNumber(profit)}</td>
              <td style="color: ${netCash >= 0 ? '#4ade80' : '#f87171'}; font-weight: bold;">${Reports.formatNumber(netCash)}</td>
              <td style="text-align: center;">
                <button type="button" class="btn btn-secondary btn-sm" onclick="Reports.openRevenueRecognitionModal(${p.project_id})" title="إثبات إيراد دوري" style="padding: 3px 8px; font-size: 0.75rem; white-space: nowrap;">
                  إثبات POC
                </button>
              </td>
            </tr>
          `;
        }).join('');
      }
    } catch (e) {
      console.error(e);
      if (tbody) tbody.innerHTML = `<tr><td colspan="13" style="text-align: center; color: var(--accent-red); padding: 20px;">خطأ في الاتصال بالخادم</td></tr>`;
    }
  },

  async openRevenueRecognitionModal(preselectedProjectId = null) {
    App.openModal('revenueRecognitionModal');
    const select = document.getElementById('revRecProjectId');
    const dateInput = document.getElementById('revRecDate');
    const previewCard = document.getElementById('revRecPreviewCard');
    if (previewCard) previewCard.style.display = 'none';
    if (dateInput && !dateInput.value) {
      dateInput.value = new Date().toISOString().split('T')[0];
    }

    if (select) {
      try {
        const res = await fetch('/api/projects');
        const json = await res.json();
        if (json.success && json.data) {
          select.innerHTML = '<option value="">-- اختر المشروع لتحديث المعايير ونسبة الإنجاز --</option>' +
            json.data.map(p => `<option value="${p.id}">${p.name} (${p.code || p.id})</option>`).join('');

          if (preselectedProjectId) {
            select.value = String(preselectedProjectId);
            this.onRevenueProjectChanged(preselectedProjectId);
          }
        }
      } catch (e) {
        console.error('Error populating projects:', e);
      }
    }
  },

  async onRevenueProjectChanged(projectId) {
    const previewCard = document.getElementById('revRecPreviewCard');
    if (!projectId) {
      if (previewCard) previewCard.style.display = 'none';
      return;
    }

    try {
      const res = await fetch(`/api/billing/contracting-matrix/${projectId}`);
      const json = await res.json();
      if (json.success && json.data && previewCard) {
        const d = json.data;
        previewCard.style.display = 'block';
        const setTxt = (id, val) => {
          const el = document.getElementById(id);
          if (el) el.textContent = typeof val === 'number' ? Reports.formatNumber(val) : (val || '0');
        };
        setTxt('prevContractVal', d.revised_contract_value || d.base_contract_value || 0);
        setTxt('prevActualCost', d.cumulative_actual_cost || 0);
        setTxt('prevPocPct', (d.cost_to_cost_poc_pct || 0).toFixed(1) + '%');
        setTxt('prevPostedRev', d.recognized_revenue?.previously_posted || 0);
        setTxt('prevUnpostedRev', d.recognized_revenue?.unposted_period_revenue || 0);
      }
    } catch (e) {
      console.error('Error fetching project metrics:', e);
    }
  },

  async submitRevenueRecognition(event) {
    if (event) event.preventDefault();
    const projectId = document.getElementById('revRecProjectId')?.value;
    const periodDate = document.getElementById('revRecDate')?.value || new Date().toISOString().split('T')[0];
    const notes = document.getElementById('revRecNotes')?.value || '';

    if (!projectId) {
      App.showToast('يرجى اختيار المشروع', 'warning');
      return;
    }

    try {
      const res = await fetch('/api/billing/recognize-revenue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          period_date: periodDate,
          notes
        })
      });
      const json = await res.json();
      if (json.success) {
        App.showToast(json.message || 'تم إثبات الإيراد المحاسبي بنجاح', 'success');
        App.closeModal('revenueRecognitionModal');
        this.openContractingSeparationModal();
      } else {
        App.showToast(json.message || 'فشل إثبات الإيراد المحاسبي', 'error');
      }
    } catch (e) {
      console.error(e);
      App.showToast('حدث خطأ أثناء الاتصال بالخادم', 'error');
    }
  }
};

if (typeof window !== 'undefined') {
  window.Reports = Reports;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Reports;
}
