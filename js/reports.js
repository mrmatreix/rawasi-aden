/**
 * إدارة التقارير، الرسوم البيانية التفاعلية، كشوفات الحسابات وتصدير Excel - رواسي عدن
 */

const Reports = {
  activeReportTab: 'profit-loss',

  async init() {
    await this.loadDashboardKPIs();
  },

  async loadDashboardKPIs() {
    const kpiIds = ['kpiTotalIncome', 'kpiTotalExpenses', 'kpiNetProfit', 'kpiCashBalance', 'kpiClientReceivables', 'kpiSupplierPayables', 'kpiActiveProjects', 'kpiTotalProjects'];
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
      if (json.success) {
        const { kpis, expenses_by_type, monthly_trend, recent_transactions, contracting_summary } = json.data;
        this.updateKPIElements(kpis, contracting_summary);
        this.renderExpensesDonutChart(expenses_by_type);
        this.renderMonthlyTrendChart(monthly_trend);
        this.renderRecentOperationsTable(recent_transactions);
      }
    } catch (e) {
      console.error('Error loading dashboard KPIs:', e);
    }
  },

  updateKPIElements(k, contractingSummary) {
    const setTxt = (id, val) => {
      const el = document.getElementById(id);
      if (el) {
        el.classList.remove('skeleton', 'skeleton-text');
        el.textContent = App.formatNumber(val);
      }
    };

    setTxt('kpiTotalIncome', k.total_income);
    setTxt('kpiTotalExpenses', k.total_expenses);
    setTxt('kpiNetProfit', k.net_profit);
    setTxt('kpiCashBalance', k.cash_balance);
    setTxt('kpiClientReceivables', k.client_receivables);
    setTxt('kpiSupplierPayables', k.supplier_payables);

    // تحديث ركائز المقاولات الـ 8 المفصولة في اللوحة الرئيسية
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
      activeEl.textContent = k.active_projects;
    }
    const totalEl = document.getElementById('kpiTotalProjects');
    if (totalEl) {
      totalEl.classList.remove('skeleton', 'skeleton-text');
      totalEl.textContent = k.total_projects;
    }
  },

  // رسم المخطط الدائري (Donut Chart) للمصروفات عبر محرك الرسوم البيانية المتخصص
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
    const width = canvas.width = 280;
    const height = canvas.height = 220;
    ctx.clearRect(0, 0, width, height);
  },

  // رسم المخطط الخطي لمسار 6 أشهر عبر محرك الرسوم البيانية المتخصص عالي الدقة
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
    const width = canvas.width = 460;
    const height = canvas.height = 220;
    ctx.clearRect(0, 0, width, height);
  },

  // جدول آخر العمليات في لوحة التحكم
  renderRecentOperationsTable(operations) {
    const tbody = document.getElementById('recentOperationsTableBody');
    if (!tbody) return;

    if (!operations || operations.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-secondary); padding: 14px;">لا توجد حركات مؤخراً</td></tr>`;
      return;
    }

    tbody.innerHTML = operations.map(op => {
      const isIncome = op.type === 'إيراد';
      return `
        <tr>
          <td>${op.date}</td>
          <td style="font-weight: 700; color: ${isIncome ? 'var(--accent-green)' : 'var(--accent-red)'}">
            ${App.formatNumber(op.amount)} ${op.currency || 'ر.ي'}
          </td>
          <td>${op.project_name || 'عام'}</td>
          <td style="color: var(--text-secondary);">${op.description || '-'}</td>
          <td>
            <span class="badge ${isIncome ? 'badge-income' : 'badge-expense'}">
              ${op.type}
            </span>
          </td>
        </tr>
      `;
    }).join('');
  },

  // تقرير الأرباح والخسائر السريع في لوحة التحكم
  async filterProfitLoss() {
    const fromDate = document.getElementById('plFromDate')?.value || '2024-01-01';
    const toDate = document.getElementById('plToDate')?.value || '2024-05-20';

    try {
      const res = await fetch(`/api/reports/profit-loss?from_date=${fromDate}&to_date=${toDate}`);
      const json = await res.json();
      if (json.success) {
        const d = json.data;
        const inEl = document.getElementById('plTotalIncome');
        const exEl = document.getElementById('plTotalExpenses');
        const netEl = document.getElementById('plNetProfit');

        if (inEl) inEl.textContent = App.formatNumber(d.total_income);
        if (exEl) exEl.textContent = App.formatNumber(d.total_expenses);
        if (netEl) netEl.textContent = App.formatNumber(d.net_profit);

        App.showToast('تم تحديث أرقام الأرباح والخسائر بنجاح', 'success');
        // تحويل المستخدم لشاشة التقارير الموسعة لعرض التفاصيل
        App.navigate('reports');
        this.switchReportTab('profit-loss');
      }
    } catch (e) {
      console.error(e);
      App.showToast('تعذر جلب التقرير', 'error');
    }
  },

  // كشف حساب عميل السريع في لوحة التحكم
  async loadClientStatement() {
    const clientId = document.getElementById('statementClientSelect')?.value;
    if (!clientId) {
      App.showToast('يرجى اختيار العميل أولاً', 'error');
      return;
    }

    try {
      const res = await fetch(`/api/reports/client-statement/${clientId}`);
      const json = await res.json();
      if (json.success) {
        const c = json.data.client;
        const prevBal = document.getElementById('csPrevBalance');
        const totalPaid = document.getElementById('csTotalPaid');
        const totalDue = document.getElementById('csTotalDue');
        const curBal = document.getElementById('csCurBalance');

        if (prevBal) prevBal.textContent = App.formatNumber(c.previous_balance || 120000);
        if (totalPaid) totalPaid.textContent = App.formatNumber(c.total_paid || 550000);
        if (totalDue) totalDue.textContent = App.formatNumber(c.total_due || 320000);
        if (curBal) curBal.textContent = App.formatNumber(c.current_balance || 190000);

        App.showToast(`تم تحديث كشف حساب: ${c.name}`, 'success');
        
        // فتح شاشة كشوفات الحسابات الموسعة
        App.navigate('reports');
        this.switchReportTab('client-statement');
        const repClientSelect = document.getElementById('repClientSelect');
        if (repClientSelect) {
          repClientSelect.value = clientId;
          this.fetchFullClientStatement();
        }
      }
    } catch (e) {
      console.error(e);
    }
  },

  // =========================================================================
  // شاشة مركز التقارير الشاملة (Full Reports Hub)
  // =========================================================================

  switchReportTab(tabId) {
    this.activeReportTab = tabId;
    document.querySelectorAll('.report-tab-btn').forEach(btn => btn.classList.remove('active'));
    const clickedBtn = document.getElementById(`tabBtn_${tabId}`);
    if (clickedBtn) clickedBtn.classList.add('active');

    document.querySelectorAll('.report-pane').forEach(p => p.style.display = 'none');
    const target = document.getElementById(`pane_${tabId}`);
    if (target) target.style.display = 'block';

    if (tabId === 'profit-loss') {
      this.loadFullProfitLoss();
    } else if (tabId === 'trial-balance') {
      this.loadTrialBalance();
    } else if (tabId === 'income-statement') {
      this.loadIncomeStatement();
    } else if (tabId === 'balance-sheet') {
      this.loadBalanceSheet();
    } else if (tabId === 'cash-flow') {
      this.loadCashFlow();
    } else if (tabId === 'projects-profitability') {
      this.loadProjectsProfitability();
    } else if (tabId === 'cost-centers-profitability') {
      this.loadCostCentersProfitability();
    } else if (tabId === 'client-statement') {
      this.initClientStatementDropdown();
    } else if (tabId === 'supplier-statement') {
      this.initSupplierStatementDropdown();
    }
  },

  // 1. تقرير الأرباح والخسائر الشامل
  async loadFullProfitLoss() {
    const fromDate = document.getElementById('repPlFromDate')?.value || '2024-01-01';
    const toDate = document.getElementById('repPlToDate')?.value || '2024-05-20';

    try {
      const res = await fetch(`/api/reports/profit-loss?from_date=${fromDate}&to_date=${toDate}`);
      const json = await res.json();
      if (json.success) {
        const d = json.data;
        document.getElementById('fullPlIncome').textContent = App.formatNumber(d.total_income) + ' ر.ي';
        document.getElementById('fullPlExpense').textContent = App.formatNumber(d.total_expenses) + ' ر.ي';
        document.getElementById('fullPlProfit').textContent = App.formatNumber(d.net_profit) + ' ر.ي';

        const tbody = document.getElementById('fullPlBreakdownTable');
        if (tbody) {
          tbody.innerHTML = d.expenses_breakdown.map(item => `
            <tr>
              <td><strong>${item.expense_type}</strong></td>
              <td style="color: var(--accent-red); font-weight: bold;">${App.formatNumber(item.total)} ر.ي</td>
              <td>${Math.round((item.total / (d.total_expenses || 1)) * 100)}%</td>
            </tr>
          `).join('');
        }
      }
    } catch (e) {
      console.error(e);
    }
  },

  // 2. تقرير ربحية المشاريع
  async loadProjectsProfitability() {
    try {
      const res = await fetch('/api/reports/projects-profitability');
      const json = await res.json();
      if (json.success) {
        const tbody = document.getElementById('projProfitTableBody');
        if (tbody) {
          tbody.innerHTML = json.data.map(p => `
            <tr>
              <td><strong>${p.name}</strong> (${p.code})</td>
              <td>${p.client_name || '-'}</td>
              <td style="color: var(--gold-light); font-weight: bold;">${App.formatNumber(p.contract_value)}</td>
              <td>${App.formatNumber(p.actual_cost)}</td>
              <td style="color: var(--accent-green); font-weight: bold;">${App.formatNumber(p.calculated_actual_profit)}</td>
              <td><span class="badge badge-income">${p.profit_margin_percentage}%</span></td>
              <td>
                <div style="display: flex; align-items: center; gap: 6px;">
                  <div class="progress-wrap"><div class="progress-bar-fill" style="width: ${p.progress_percentage}%"></div></div>
                  <span style="font-size:0.75rem">${p.progress_percentage}%</span>
                </div>
              </td>
            </tr>
          `).join('');
        }
      }
    } catch (e) {
      console.error(e);
    }
  },

  // 2.ب تقرير ربحية مراكز التكلفة والمشاريع الشامل
  async loadCostCentersProfitability() {
    try {
      const fromDate = document.getElementById('repCcFromDate')?.value || '';
      const toDate = document.getElementById('repCcToDate')?.value || '';
      let url = '/api/reports/cost-centers-profitability';
      if (fromDate && toDate) url += `?from_date=${fromDate}&to_date=${toDate}`;

      const res = await fetch(url);
      const json = await res.json();
      if (json.success && json.data) {
        const d = json.data;
        const totRevEl = document.getElementById('ccProfitTotalRev');
        const totExpEl = document.getElementById('ccProfitTotalExp');
        const totNetEl = document.getElementById('ccProfitTotalNet');
        const totMarginEl = document.getElementById('ccProfitTotalMargin');

        if (totRevEl) totRevEl.textContent = App.formatNumber(d.totals.total_revenue) + ' ر.ي';
        if (totExpEl) totExpEl.textContent = App.formatNumber(d.totals.total_expense) + ' ر.ي';
        if (totNetEl) {
          totNetEl.textContent = App.formatNumber(d.totals.net_profit) + ' ر.ي';
          totNetEl.style.color = d.totals.net_profit >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
        }
        if (totMarginEl) totMarginEl.textContent = d.totals.overall_margin + '%';

        const tbody = document.getElementById('ccProfitTableBody');
        if (tbody) {
          if (!d.centers || d.centers.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--text-secondary);">لا توجد بيانات مراكز تكلفة مسجلة</td></tr>';
            return;
          }
          tbody.innerHTML = d.centers.map(cc => {
            const isProfit = cc.net_profit >= 0;
            const statusBadge = isProfit
              ? `<span class="badge" style="background: rgba(34,197,94,0.15); color: #4ade80;">ربح محقق (${cc.profit_margin}%)</span>`
              : `<span class="badge" style="background: rgba(239,68,68,0.15); color: #f87171;">عجز / خسارة (${cc.profit_margin}%)</span>`;

            return `
              <tr>
                <td><strong>${cc.code}</strong></td>
                <td><strong style="color: #fff;">${cc.name}</strong></td>
                <td><span class="badge badge-info">${cc.type}</span></td>
                <td>${cc.project_name}</td>
                <td style="color: var(--gold-light); font-weight: bold;">${App.formatNumber(cc.total_revenue)} ر.ي</td>
                <td style="color: #38bdf8; font-weight: bold;">${App.formatNumber(cc.total_expense)} ر.ي</td>
                <td style="color: ${isProfit ? 'var(--accent-green)' : 'var(--accent-red)'}; font-weight: bold;">${App.formatNumber(cc.net_profit)} ر.ي</td>
                <td>${statusBadge}</td>
              </tr>
            `;
          }).join('');
        }
      }
    } catch (e) {
      console.error('Error loading cost centers profitability:', e);
    }
  },

  // 3. الميزانية العمومية
  async loadBalanceSheet() {
    try {
      const res = await fetch('/api/reports/balance-sheet');
      const json = await res.json();
      if (json.success) {
        const { assets, liabilities, equity, totals } = json.data;
        
        const assetsTbody = document.getElementById('bsAssetsTable');
        if (assetsTbody) {
          assetsTbody.innerHTML = assets.map(a => `
            <tr>
              <td>${a.code} - ${a.name}</td>
              <td style="font-weight: bold;">${App.formatNumber(a.balance)} ر.ي</td>
            </tr>
          `).join('');
        }

        const liabTbody = document.getElementById('bsLiabTable');
        if (liabTbody) {
          liabTbody.innerHTML = liabilities.map(l => `
            <tr>
              <td>${l.code} - ${l.name}</td>
              <td style="font-weight: bold;">${App.formatNumber(l.balance)} ر.ي</td>
            </tr>
          `).join('') + equity.map(e => `
            <tr>
              <td>${e.code} - ${e.name}</td>
              <td style="font-weight: bold;">${App.formatNumber(e.balance)} ر.ي</td>
            </tr>
          `).join('');
        }

        document.getElementById('bsTotalAssets').textContent = App.formatNumber(totals.assets) + ' ر.ي';
        document.getElementById('bsTotalLiabEquity').textContent = App.formatNumber(totals.liabilities_plus_equity) + ' ر.ي';
      }
    } catch (e) {
      console.error(e);
    }
  },

  // 4. كشف حساب عميل مفصل
  initClientStatementDropdown() {
    const select = document.getElementById('repClientSelect');
    if (select && Accounting.clients.length > 0) {
      select.innerHTML = `<option value="">اختر العميل...</option>` +
        Accounting.clients.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    }
  },

  async fetchFullClientStatement() {
    const clientId = document.getElementById('repClientSelect')?.value;
    if (!clientId) return;

    try {
      const res = await fetch(`/api/reports/client-statement/${clientId}`);
      const json = await res.json();
      if (json.success) {
        const { client, statement } = json.data;
        const cCurr = client.currency || 'ر.ي';
        document.getElementById('repClientInfo').innerHTML = `
          <div style="background: rgba(212,175,55,0.06); border: 1px solid var(--border-color); padding: 14px; border-radius: var(--radius-md); margin-bottom: 14px;">
            <h4 style="color: var(--gold-light);">${client.name}</h4>
            <div style="display: flex; gap: 24px; font-size: 0.85rem; margin-top: 8px;">
              <span>الهاتف: <strong>${client.phone || '-'}</strong></span>
              <span>الرصيد السابق: <strong>${App.formatNumber(client.previous_balance)} ${cCurr}</strong></span>
              <span>الرصيد الحالي المستحق: <strong style="color: var(--accent-red); font-size: 1rem;">${App.formatNumber(client.current_balance)} ${cCurr}</strong></span>
            </div>
          </div>
        `;

        const tbody = document.getElementById('repClientStatementTable');
        if (tbody) {
          let runningBalance = Number(client.previous_balance || 0);
          tbody.innerHTML = statement.map(s => {
            runningBalance += (s.debit || 0) - (s.credit || 0);
            return `
              <tr>
                <td>${s.date}</td>
                <td>${s.type}</td>
                <td>${s.ref || '-'}</td>
                <td style="color: var(--accent-red); font-weight: bold;">${s.debit ? App.formatNumber(s.debit) : '-'}</td>
                <td style="color: var(--accent-green); font-weight: bold;">${s.credit ? App.formatNumber(s.credit) : '-'}</td>
                <td style="font-weight: bold;">${App.formatNumber(runningBalance)}</td>
                <td>${s.notes || '-'}</td>
              </tr>
            `;
          }).join('');
        }
      }
    } catch (e) {
      console.error(e);
    }
  },

  // 5. كشف حساب مورد مفصل
  initSupplierStatementDropdown() {
    const select = document.getElementById('repSupplierSelect');
    if (select && Accounting.suppliers.length > 0) {
      select.innerHTML = `<option value="">اختر المورد...</option>` +
        Accounting.suppliers.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    }
  },

  async fetchFullSupplierStatement() {
    const supplierId = document.getElementById('repSupplierSelect')?.value;
    if (!supplierId) return;

    try {
      const res = await fetch(`/api/reports/supplier-statement/${supplierId}`);
      const json = await res.json();
      if (json.success) {
        const { supplier, statement } = json.data;
        const sCurr = supplier.currency || 'ر.ي';
        document.getElementById('repSupplierInfo').innerHTML = `
          <div style="background: rgba(56,189,248,0.06); border: 1px solid var(--border-color); padding: 14px; border-radius: var(--radius-md); margin-bottom: 14px;">
            <h4 style="color: var(--accent-blue);">${supplier.name} (${supplier.category || 'مورد'})</h4>
            <div style="display: flex; gap: 24px; font-size: 0.85rem; margin-top: 8px;">
              <span>الهاتف: <strong>${supplier.phone || '-'}</strong></span>
              <span>الرصيد المستحق للمورد: <strong style="color: var(--accent-amber); font-size: 1rem;">${App.formatNumber(supplier.balance)} ${sCurr}</strong></span>
            </div>
          </div>
        `;

        const tbody = document.getElementById('repSupplierStatementTable');
        if (tbody) {
          tbody.innerHTML = statement.map(s => `
            <tr>
              <td>${s.date}</td>
              <td>${s.type}</td>
              <td>${s.ref || '-'}</td>
              <td style="color: var(--accent-amber); font-weight: bold;">${s.credit ? App.formatNumber(s.credit) : '-'}</td>
              <td style="color: var(--accent-green); font-weight: bold;">${s.debit ? App.formatNumber(s.debit) : '-'}</td>
              <td>${s.notes || '-'}</td>
            </tr>
          `).join('');
        }
      }
    } catch (e) {
      console.error(e);
    }
  },

  // طباعة أي تقرير نشط على الورقة الرسمية المعتمدة
  printActiveReport() {
    const printArea = document.getElementById('printArea');
    if (!printArea) return;

    const cfg = (typeof Settings !== 'undefined' && Settings.getPrintConfig) ? Settings.getPrintConfig() : {
      sig1: 'المحاسب المالي',
      sig2: 'المدير العام',
      sig3: 'اعتماد الإدارة',
      show_stamp: '0',
      footer_notes: 'تعتبر هذه التقارير والبيانات معتمدة رسمياً من إدارة شركة رواسي عدن للهندسة والمقاولات'
    };

    const showStamp = (cfg.show_stamp === '1' || cfg.show_stamp === 1 || cfg.show_stamp === true);
    const todayDate = new Date().toISOString().split('T')[0];
    const tab = this.activeReportTab || 'profit-loss';

    let reportTitle = 'تقرير مالي معتمد';
    let reportBodyHtml = '';
    let reportMeta = [
      { label: 'تاريخ الطباعة', val: todayDate },
      { label: 'الحالة', val: 'معتمد رسمياً ✅' }
    ];

    if (tab === 'profit-loss') {
      reportTitle = 'تقرير الأرباح والخسائر (قائمة الدخل)';
      const fromDate = document.getElementById('repPlFromDate')?.value || document.getElementById('plFromDate')?.value || '2024-01-01';
      const toDate = document.getElementById('repPlToDate')?.value || document.getElementById('plToDate')?.value || todayDate;
      const income = document.getElementById('fullPlIncome')?.textContent || document.getElementById('plTotalIncome')?.textContent || '0';
      const expense = document.getElementById('fullPlExpense')?.textContent || document.getElementById('plTotalExpenses')?.textContent || '0';
      const profit = document.getElementById('fullPlProfit')?.textContent || document.getElementById('plNetProfit')?.textContent || '0';

      const showKpi = (cfg.fin_show_kpi_cards !== '0' && cfg.fin_show_kpi_cards !== 0 && cfg.fin_show_kpi_cards !== false);
      const showBreakdown = (cfg.fin_show_expense_breakdown !== '0' && cfg.fin_show_expense_breakdown !== 0 && cfg.fin_show_expense_breakdown !== false);

      reportMeta = [
        { label: 'الفترة المالية', val: `${fromDate} إلى ${toDate}` },
        { label: 'تاريخ الإصدار', val: todayDate }
      ];

      const breakdownRows = document.getElementById('fullPlBreakdownTable')?.innerHTML || '';

      reportBodyHtml = `
        ${showKpi ? `
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 16px;">
          <div style="border: 1px solid #86efac; border-radius: 6px; padding: 10px; text-align: center; background: #f0fdf4;">
            <div style="font-size: 0.78rem; color: #15803d; margin-bottom: 4px;">إجمالي الإيرادات</div>
            <div style="font-weight: 900; font-size: 1.15rem; color: #15803d;">${income}</div>
          </div>
          <div style="border: 1px solid #fca5a5; border-radius: 6px; padding: 10px; text-align: center; background: #fef2f2;">
            <div style="font-size: 0.78rem; color: #b91c1c; margin-bottom: 4px;">إجمالي المصروفات</div>
            <div style="font-weight: 900; font-size: 1.15rem; color: #b91c1c;">${expense}</div>
          </div>
          <div style="border: 1.5px solid #d4af37; border-radius: 6px; padding: 10px; text-align: center; background: #fdfaf2;">
            <div style="font-size: 0.78rem; color: #b8911c; margin-bottom: 4px;">صافي الأرباح التشغيلية</div>
            <div style="font-weight: 900; font-size: 1.25rem; color: #047857;">${profit}</div>
          </div>
        </div>
        ` : ''}

        ${showBreakdown ? `
        <div style="font-weight: 800; color: #0f2744; font-size: 0.9rem; margin: 12px 0 6px 0; border-right: 3px solid #d4af37; padding-right: 6px;">
          تفاصيل وتوزيع بنود المصروفات:
        </div>
        <table class="official-report-table">
          <thead>
            <tr>
              <th>بند المصروف</th>
              <th>المبلغ</th>
              <th>النسبة من الإجمالي</th>
            </tr>
          </thead>
          <tbody>
            ${breakdownRows || '<tr><td colspan="3" style="text-align: center;">لا توجد تفاصيل إضافية</td></tr>'}
          </tbody>
        </table>
        ` : ''}
      `;
    } else if (tab === 'client-statement') {
      reportTitle = 'كشف حساب عميل تفصيلي';
      const select = document.getElementById('repClientSelect');
      const clientName = select ? select.options[select.selectedIndex]?.text : 'عميل';
      const clientInfo = document.getElementById('repClientInfo')?.innerHTML || '';
      const tableRows = document.getElementById('repClientStatementTable')?.innerHTML || '';
      const showSummary = (cfg.stmt_show_summary_card !== '0' && cfg.stmt_show_summary_card !== 0 && cfg.stmt_show_summary_card !== false);
      const showMatchSig = (cfg.stmt_show_match_sig !== '0' && cfg.stmt_show_match_sig !== 0 && cfg.stmt_show_match_sig !== false);

      reportMeta = [
        { label: 'اسم العميل', val: clientName },
        { label: 'تاريخ الإصدار', val: todayDate }
      ];

      reportBodyHtml = `
        ${showSummary ? `
        <div style="margin-bottom: 12px;">
          ${clientInfo}
        </div>` : ''}
        <table class="official-report-table">
          <thead>
            <tr>
              <th>التاريخ</th>
              <th>نوع الحركة</th>
              <th>المرجع / السند</th>
              <th>مدين (عله)</th>
              <th>دائن (له)</th>
              <th>الرصيد التراكمي</th>
              <th>البيان والملاحظات</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows || '<tr><td colspan="7" style="text-align: center;">لا توجد حركات مسجلة</td></tr>'}
          </tbody>
        </table>
        ${showMatchSig ? `
        <div style="background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 4px; padding: 8px 12px; font-size: 0.76rem; color: #475569; display: flex; justify-content: space-between; align-items: center; margin-top: 10px;">
          <span>إقرار ومصادقة: أقر أنا العميل الموضح أعلاه بصحة الرصيد الموضح حتى تاريخ هذا الكشف:</span>
          <span>توقيع العميل: ..........................</span>
        </div>` : ''}
      `;
    } else if (tab === 'supplier-statement') {
      reportTitle = 'كشف حساب مورد تفصيلي';
      const select = document.getElementById('repSupplierSelect');
      const supplierName = select ? select.options[select.selectedIndex]?.text : 'مورد';
      const supplierInfo = document.getElementById('repSupplierInfo')?.innerHTML || '';
      const tableRows = document.getElementById('repSupplierStatementTable')?.innerHTML || '';

      reportMeta = [
        { label: 'اسم المورد', val: supplierName },
        { label: 'تاريخ الإصدار', val: todayDate }
      ];

      reportBodyHtml = `
        <div style="margin-bottom: 12px;">
          ${supplierInfo}
        </div>
        <table class="official-report-table">
          <thead>
            <tr>
              <th>التاريخ</th>
              <th>نوع الحركة</th>
              <th>رقم الفاتورة/السند</th>
              <th>مستحق له (دائن)</th>
              <th>المدفوع له (مدين)</th>
              <th>البيان والملاحظات</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows || '<tr><td colspan="6" style="text-align: center;">لا توجد حركات مسجلة</td></tr>'}
          </tbody>
        </table>
      `;
    } else if (tab === 'balance-sheet') {
      reportTitle = 'تقرير الميزانية العمومية والمركز المالي';
      const assetsRows = document.getElementById('bsAssetsTable')?.innerHTML || '';
      const liabRows = document.getElementById('bsLiabTable')?.innerHTML || '';
      const totalAssets = document.getElementById('bsTotalAssets')?.textContent || '0';
      const totalLiab = document.getElementById('bsTotalLiabEquity')?.textContent || '0';

      reportMeta = [
        { label: 'تاريخ الميزانية', val: todayDate },
        { label: 'حالة الاعتماد', val: 'معتمد رسمياً' }
      ];

      reportBodyHtml = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 16px;">
          <div>
            <div style="font-weight: 800; color: #0f2744; font-size: 0.95rem; margin-bottom: 6px; border-right: 3px solid #059669; padding-right: 6px;">
              الأصول والموجودات (Assets)
            </div>
            <table class="official-report-table">
              <tbody>
                ${assetsRows}
                <tr style="background: #f0fdf4; font-weight: 900;">
                  <td>إجمالي الأصول:</td>
                  <td style="color: #047857; text-align: left;">${totalAssets}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div>
            <div style="font-weight: 800; color: #0f2744; font-size: 0.95rem; margin-bottom: 6px; border-right: 3px solid #dc2626; padding-right: 6px;">
              الالتزامات وحقوق الملكية (Liabilities & Equity)
            </div>
            <table class="official-report-table">
              <tbody>
                ${liabRows}
                <tr style="background: #fef2f2; font-weight: 900;">
                  <td>إجمالي الالتزامات وحقوق الملكية:</td>
                  <td style="color: #b91c1c; text-align: left;">${totalLiab}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      `;
    } else if (tab === 'projects-profitability') {
      reportTitle = 'تقرير تحليل ربحية وكفاءة المشاريع';
      const projRows = document.getElementById('projProfitTableBody')?.innerHTML || '';

      reportMeta = [
        { label: 'تاريخ التحليل', val: todayDate },
        { label: 'نوع التقرير', val: 'تحليل مالي ومردود المشاريع' }
      ];

      reportBodyHtml = `
        <table class="official-report-table">
          <thead>
            <tr>
              <th>المشروع (الكود)</th>
              <th>العميل</th>
              <th>قيمة العقد</th>
              <th>التكلفة الفعلية</th>
              <th>الربح المحقق</th>
              <th>هامش الربح</th>
              <th>نسبة الإنجاز</th>
            </tr>
          </thead>
          <tbody>
            ${projRows || '<tr><td colspan="7" style="text-align: center;">لا توجد مشاريع</td></tr>'}
          </tbody>
        </table>
      `;
    } else if (tab === 'cost-centers-profitability') {
      reportTitle = 'تقرير أداء وربحية مراكز التكلفة والمشاريع';
      const ccRows = document.getElementById('ccProfitTableBody')?.innerHTML || '';
      const totRev = document.getElementById('ccProfitTotalRev')?.textContent || '0';
      const totExp = document.getElementById('ccProfitTotalExp')?.textContent || '0';
      const totNet = document.getElementById('ccProfitTotalNet')?.textContent || '0';
      const totMargin = document.getElementById('ccProfitTotalMargin')?.textContent || '0%';

      reportMeta = [
        { label: 'تاريخ التقرير', val: todayDate },
        { label: 'إجمالي الإيرادات', val: totRev },
        { label: 'إجمالي المصروفات', val: totExp },
        { label: 'صافي الربح الإجمالي', val: totNet }
      ];

      reportBodyHtml = `
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px;">
          <div style="border: 1px solid #86efac; border-radius: 6px; padding: 8px; text-align: center; background: #f0fdf4;">
            <div style="font-size: 0.75rem; color: #15803d;">إجمالي الإيرادات</div>
            <div style="font-weight: 800; font-size: 1rem; color: #15803d;">${totRev}</div>
          </div>
          <div style="border: 1px solid #fca5a5; border-radius: 6px; padding: 8px; text-align: center; background: #fef2f2;">
            <div style="font-size: 0.75rem; color: #b91c1c;">إجمالي المصروفات</div>
            <div style="font-weight: 800; font-size: 1rem; color: #b91c1c;">${totExp}</div>
          </div>
          <div style="border: 1px solid #fef08a; border-radius: 6px; padding: 8px; text-align: center; background: #fefce8;">
            <div style="font-size: 0.75rem; color: #a16207;">صافي الفائض / الربح</div>
            <div style="font-weight: 800; font-size: 1rem; color: #a16207;">${totNet}</div>
          </div>
          <div style="border: 1px solid #bae6fd; border-radius: 6px; padding: 8px; text-align: center; background: #f0f9ff;">
            <div style="font-size: 0.75rem; color: #0369a1;">متوسط هامش الربح</div>
            <div style="font-weight: 800; font-size: 1rem; color: #0369a1;">${totMargin}</div>
          </div>
        </div>
        <table class="official-report-table">
          <thead>
            <tr>
              <th>كود المركز</th>
              <th>اسم المركز</th>
              <th>النوع</th>
              <th>المشروع</th>
              <th>الإيرادات</th>
              <th>المصروفات</th>
              <th>صافي الربح</th>
              <th>هامش الربحية</th>
            </tr>
          </thead>
          <tbody>
            ${ccRows || '<tr><td colspan="8" style="text-align: center;">لا توجد بيانات مراكز تكلفة</td></tr>'}
          </tbody>
        </table>
      `;
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
          <div class="letterhead-sig-col">
            <div class="letterhead-sig-label">${cfg.sig1 || 'المحاسب المالي'}</div>
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
      `;

    const footerHtml = (typeof Settings !== 'undefined' && Settings.renderReportFooter)
      ? Settings.renderReportFooter(cfg)
      : (cfg.footer_notes ? `<div style="margin-top: 12px; padding-top: 6px; border-top: 1px dashed #cbd5e1; font-size: 0.75rem; color: #64748b; text-align: center;">${cfg.footer_notes}</div>` : '');

    printArea.innerHTML = `
      <div class="${docClass}">
        ${headerHtml}
        <div class="report-content-body">
          ${reportBodyHtml}
        </div>
        ${sigHtml}
        ${footerHtml}
      </div>
    `;

    if (typeof Settings !== 'undefined' && Settings.setPrintTitle) {
      Settings.setPrintTitle(reportTitle);
    }
    window.print();
  },

  // تصدير التقرير النشط حالياً إلى ملف Excel بتنسيق رسمي مرتب
  exportActiveReportToExcel() {
    const tab = this.activeReportTab || 'profit-loss';
    if (typeof ExcelExporter !== 'undefined') {
      if (tab === 'profit-loss') {
        ExcelExporter.exportProfitLoss();
      } else if (tab === 'projects-profitability') {
        ExcelExporter.exportProjectsProfitability();
      } else if (tab === 'balance-sheet') {
        ExcelExporter.exportBalanceSheet();
      } else if (tab === 'client-statement') {
        ExcelExporter.exportClientStatement();
      } else if (tab === 'supplier-statement') {
        ExcelExporter.exportSupplierStatement();
      } else {
        ExcelExporter.exportProfitLoss();
      }
    } else {
      this.exportProfitLossToExcel();
    }
  },

  // تصدير جدول الأرباح والخسائر إلى ملف Excel المنسق
  exportProfitLossToExcel() {
    if (typeof ExcelExporter !== 'undefined') {
      ExcelExporter.exportProfitLoss();
    } else {
      // احتياط داخلي لتوليد Excel بتنسيق XLS حقيقي مرتب
      const fromDate = document.getElementById('repPlFromDate')?.value || document.getElementById('plFromDate')?.value || '2024-01-01';
      const toDate = document.getElementById('repPlToDate')?.value || document.getElementById('plToDate')?.value || '2024-05-20';
      const income = document.getElementById('fullPlIncome')?.textContent || document.getElementById('plTotalIncome')?.textContent || '1,250,000';
      const expense = document.getElementById('fullPlExpense')?.textContent || document.getElementById('plTotalExpenses')?.textContent || '850,000';
      const profit = document.getElementById('fullPlProfit')?.textContent || document.getElementById('plNetProfit')?.textContent || '400,000';

      const tableHtml = `
        <table border="1" style="direction: rtl; font-family: Tahoma, Arial; width: 100%;">
          <tr style="background-color: #0f2744; color: #d4af37; font-weight: bold; font-size: 14pt; text-align: center;">
            <td colspan="3">شركة رواسي عدن للهندسة والمقاولات</td>
          </tr>
          <tr style="background-color: #1e3a5f; color: #fff; font-weight: bold; text-align: center;">
            <td colspan="3">تقرير الأرباح والخسائر للفترة من ${fromDate} إلى ${toDate}</td>
          </tr>
          <tr style="background-color: #1e293b; color: #fff; font-weight: bold;">
            <th style="padding: 8px;">م</th>
            <th style="padding: 8px;">البيان المحاسبي</th>
            <th style="padding: 8px;">المبلغ (ريال يمني)</th>
          </tr>
          <tr style="background-color: #ecfdf5; font-weight: bold;">
            <td align="center">1</td>
            <td>إجمالي الإيرادات والدخل</td>
            <td align="left">${income}</td>
          </tr>
          <tr style="background-color: #fef2f2; font-weight: bold;">
            <td align="center">2</td>
            <td>إجمالي المصروفات وتكاليف المشاريع</td>
            <td align="left">${expense}</td>
          </tr>
          <tr style="background-color: #fffbeb; font-weight: bold; font-size: 11pt;">
            <td align="center">★</td>
            <td>صافي الأرباح التشغيلية</td>
            <td align="left" style="color: #b45309;">${profit}</td>
          </tr>
        </table>
      `;

      const excelEnvelope = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
        <head>
          <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
          <!--[if gte mso 9]>
          <xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
          <x:Name>الأرباح والخسائر</x:Name>
          <x:WorksheetOptions><x:DisplayRightToLeft/></x:WorksheetOptions>
          </x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml>
          <![endif]-->
        </head>
        <body style="direction: rtl;">
          ${tableHtml}
        </body>
        </html>
      `;

      const blob = new Blob(["\uFEFF", excelEnvelope], { type: 'application/vnd.ms-excel;charset=utf-8' });
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", `تقرير_الأرباح_والخسائر_${fromDate}_إلى_${toDate}.xls`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      App.showToast('تم تصدير ملف Excel بنجاح', 'success');
    }
  },

  // ================== التقارير المالية المتقدمة والمحاسبية ==================

  // 5. تقرير ميزان المراجعة بالأرصدة والمجاميع
  async loadTrialBalance() {
    const fromDate = document.getElementById('tbFromDate')?.value || '2024-01-01';
    const toDate = document.getElementById('tbToDate')?.value || '';
    const q = toDate ? `?from_date=${fromDate}&to_date=${toDate}` : `?from_date=${fromDate}`;

    try {
      const res = await fetch(`/api/reports/trial-balance${q}`);
      const json = await res.json();
      if (json.success) {
        const { accounts, totals } = json.data;
        const is_balanced = totals?.is_balanced;
        const difference = Math.abs((totals?.total_debit || 0) - (totals?.total_credit || 0));

        // KPI
        const debitEl = document.getElementById('tbTotalDebit');
        const creditEl = document.getElementById('tbTotalCredit');
        const balDebitEl = document.getElementById('tbBalanceDebit');
        const statusEl = document.getElementById('tbBalanceStatus');

        if (debitEl) debitEl.textContent = App.formatNumber(totals.total_debit) + ' ر.ي';
        if (creditEl) creditEl.textContent = App.formatNumber(totals.total_credit) + ' ر.ي';
        if (balDebitEl) balDebitEl.textContent = App.formatNumber(totals.balance_debit) + ' ر.ي';
        if (statusEl) {
          if (is_balanced) {
            statusEl.textContent = 'متزن 100%';
            statusEl.style.color = 'var(--accent-green)';
          } else {
            statusEl.textContent = `فارق: ${App.formatNumber(difference)} ر.ي`;
            statusEl.style.color = 'var(--accent-red)';
          }
        }

        // Table
        const tbody = document.getElementById('trialBalanceTableBody');
        if (tbody) {
          if (!accounts || accounts.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-secondary); padding: 20px;">لا توجد حركات في هذه الفترة</td></tr>`;
          } else {
            tbody.innerHTML = accounts.map(a => `
              <tr>
                <td style="font-family: monospace; font-weight: bold; color: var(--gold-light);">${a.code}</td>
                <td><strong>${a.name}</strong></td>
                <td><span class="badge badge-info">${a.type}</span></td>
                <td style="text-align: left; direction: ltr; font-family: monospace; color: var(--accent-green);">${a.total_debit > 0 ? App.formatNumber(a.total_debit) : '-'}</td>
                <td style="text-align: left; direction: ltr; font-family: monospace; color: #38bdf8;">${a.total_credit > 0 ? App.formatNumber(a.total_credit) : '-'}</td>
                <td style="text-align: left; direction: ltr; font-family: monospace; font-weight: bold; color: var(--accent-green);">${a.balance_debit > 0 ? App.formatNumber(a.balance_debit) : '-'}</td>
                <td style="text-align: left; direction: ltr; font-family: monospace; font-weight: bold; color: #38bdf8;">${a.balance_credit > 0 ? App.formatNumber(a.balance_credit) : '-'}</td>
              </tr>
            `).join('');
          }
        }

        // Foot
        const tfoot = document.getElementById('trialBalanceTableFoot');
        if (tfoot) {
          tfoot.innerHTML = `
            <tr>
              <td colspan="3" style="text-align: center; font-size: 1rem;">الإجمالي الكلي لميزان المراجعة</td>
              <td style="text-align: left; direction: ltr; font-family: monospace; color: var(--accent-green); font-size: 1.05rem;">${App.formatNumber(totals.total_debit)}</td>
              <td style="text-align: left; direction: ltr; font-family: monospace; color: #38bdf8; font-size: 1.05rem;">${App.formatNumber(totals.total_credit)}</td>
              <td style="text-align: left; direction: ltr; font-family: monospace; color: var(--accent-green); font-size: 1.05rem;">${App.formatNumber(totals.balance_debit)}</td>
              <td style="text-align: left; direction: ltr; font-family: monospace; color: #38bdf8; font-size: 1.05rem;">${App.formatNumber(totals.balance_credit)}</td>
            </tr>
          `;
        }
      }
    } catch (e) {
      console.error('Error loading trial balance:', e);
      App.showToast('فشل تحميل ميزان المراجعة', 'error');
    }
  },

  // 6. تقرير قائمة الدخل (3 مصروفات + 4 إيرادات)
  async loadIncomeStatement() {
    const fromDate = document.getElementById('isFromDate')?.value || '2024-01-01';
    const toDate = document.getElementById('isToDate')?.value || '';
    const q = toDate ? `?from_date=${fromDate}&to_date=${toDate}` : `?from_date=${fromDate}`;

    try {
      const res = await fetch(`/api/reports/income-statement${q}`);
      const json = await res.json();
      if (json.success) {
        const d = json.data;

        // KPI
        const revEl = document.getElementById('isTotalRevenues');
        const expEl = document.getElementById('isTotalExpenses');
        const grossEl = document.getElementById('isGrossProfit');
        const netEl = document.getElementById('isNetIncome');

        if (revEl) revEl.textContent = App.formatNumber(d.total_revenues) + ' ر.ي';
        if (expEl) expEl.textContent = App.formatNumber(d.total_expenses) + ' ر.ي';
        if (grossEl) grossEl.textContent = App.formatNumber(d.gross_profit) + ' ر.ي';
        if (netEl) {
          netEl.textContent = App.formatNumber(d.net_profit) + ' ر.ي';
          netEl.style.color = d.net_profit >= 0 ? 'var(--gold-light)' : 'var(--accent-red)';
        }

        // Revenues Table
        const revTbody = document.getElementById('isRevenuesTableBody');
        if (revTbody) {
          if (!d.revenues || d.revenues.length === 0) {
            revTbody.innerHTML = `<tr><td colspan="2" style="text-align: center; color: var(--text-secondary); padding: 14px;">لا توجد إيرادات مسجلة</td></tr>`;
          } else {
            revTbody.innerHTML = d.revenues.map(r => `
              <tr>
                <td><strong>${r.name}</strong></td>
                <td style="font-weight: bold; color: var(--accent-green); text-align: left; direction: ltr; font-family: monospace;">${App.formatNumber(r.amount)} ر.ي</td>
              </tr>
            `).join('') + `
              <tr style="background: rgba(16,185,129,0.08); font-weight: bold;">
                <td>إجمالي الإيرادات (4)</td>
                <td style="color: var(--accent-green); text-align: left; direction: ltr; font-family: monospace; font-size: 1.05rem;">${App.formatNumber(d.total_revenues)} ر.ي</td>
              </tr>
            `;
          }
        }

        // Expenses Table
        const expTbody = document.getElementById('isExpensesTableBody');
        if (expTbody) {
          if (!d.expenses || d.expenses.length === 0) {
            expTbody.innerHTML = `<tr><td colspan="2" style="text-align: center; color: var(--text-secondary); padding: 14px;">لا توجد مصروفات مسجلة</td></tr>`;
          } else {
            expTbody.innerHTML = d.expenses.map(e => `
              <tr>
                <td><strong>${e.name}</strong></td>
                <td style="font-weight: bold; color: var(--accent-red); text-align: left; direction: ltr; font-family: monospace;">${App.formatNumber(e.amount)} ر.ي</td>
              </tr>
            `).join('') + `
              <tr style="background: rgba(239,68,68,0.08); font-weight: bold;">
                <td>إجمالي التكاليف والمصروفات (3)</td>
                <td style="color: var(--accent-red); text-align: left; direction: ltr; font-family: monospace; font-size: 1.05rem;">${App.formatNumber(d.total_expenses)} ر.ي</td>
              </tr>
            `;
          }
        }
      }
    } catch (e) {
      console.error('Error loading income statement:', e);
      App.showToast('فشل تحميل قائمة الدخل', 'error');
    }
  },

  // 7. تقرير التدفقات النقدية
  async loadCashFlow() {
    const fromDate = document.getElementById('cfFromDate')?.value || '2024-01-01';
    const toDate = document.getElementById('cfToDate')?.value || '';
    const q = toDate ? `?from_date=${fromDate}&to_date=${toDate}` : `?from_date=${fromDate}`;

    try {
      const res = await fetch(`/api/reports/cash-flow${q}`);
      const json = await res.json();
      if (json.success) {
        const d = json.data;
        const op = d.operating_activities || { inflows: [], outflows: [], net: 0 };
        const inv = d.investing_activities || { inflows: [], outflows: [], net: 0 };
        const fin = d.financing_activities || { inflows: [], outflows: [], net: 0 };

        // KPI
        const openEl = document.getElementById('cfOpeningCash');
        const netOpEl = document.getElementById('cfNetOperating');
        const changeEl = document.getElementById('cfNetChange');
        const closeEl = document.getElementById('cfClosingCash');

        if (openEl) openEl.textContent = App.formatNumber(d.opening_balance) + ' ر.ي';
        if (netOpEl) netOpEl.textContent = App.formatNumber(op.net) + ' ر.ي';
        if (changeEl) changeEl.textContent = App.formatNumber(d.net_cash_change) + ' ر.ي';
        if (closeEl) closeEl.textContent = App.formatNumber(d.closing_balance) + ' ر.ي';

        // Table
        const tbody = document.getElementById('cashFlowTableBody');
        if (tbody) {
          let html = '';

          // Section 1: Operating
          html += `<tr style="background: rgba(56,189,248,0.12); font-weight: bold;"><td colspan="4">أولاً: التدفقات النقدية من الأنشطة التشغيلية</td></tr>`;
          (op.inflows || []).forEach(it => {
            html += `
              <tr>
                <td>${it.item}</td>
                <td style="text-align: left; direction: ltr; font-family: monospace; color: var(--accent-green);">${App.formatNumber(it.amount)}</td>
                <td style="text-align: left; direction: ltr; font-family: monospace; color: var(--accent-red);">-</td>
                <td style="text-align: left; direction: ltr; font-family: monospace; font-weight: bold; color: var(--accent-green);">+${App.formatNumber(it.amount)} ر.ي</td>
              </tr>
            `;
          });
          (op.outflows || []).forEach(it => {
            html += `
              <tr>
                <td>${it.item}</td>
                <td style="text-align: left; direction: ltr; font-family: monospace; color: var(--accent-green);">-</td>
                <td style="text-align: left; direction: ltr; font-family: monospace; color: var(--accent-red);">${App.formatNumber(it.amount)}</td>
                <td style="text-align: left; direction: ltr; font-family: monospace; font-weight: bold; color: var(--accent-red);">-${App.formatNumber(it.amount)} ر.ي</td>
              </tr>
            `;
          });
          html += `
            <tr style="background: rgba(255,255,255,0.03); font-weight: bold;">
              <td>صافي النقد المتولد من الأنشطة التشغيلية</td>
              <td colspan="2"></td>
              <td style="text-align: left; direction: ltr; font-family: monospace; color: var(--accent-green); font-size: 1.05rem;">${App.formatNumber(op.net)} ر.ي</td>
            </tr>
          `;

          // Section 2: Investing
          html += `<tr style="background: rgba(168,85,247,0.12); font-weight: bold;"><td colspan="4">ثانياً: التدفقات النقدية من الأنشطة الاستثمارية</td></tr>`;
          (inv.outflows || []).forEach(it => {
            html += `
              <tr>
                <td>${it.item}</td>
                <td style="text-align: left; direction: ltr; font-family: monospace; color: var(--accent-green);">-</td>
                <td style="text-align: left; direction: ltr; font-family: monospace; color: var(--accent-red);">${App.formatNumber(it.amount)}</td>
                <td style="text-align: left; direction: ltr; font-family: monospace; font-weight: bold; color: var(--accent-red);">-${App.formatNumber(it.amount)} ر.ي</td>
              </tr>
            `;
          });
          html += `
            <tr style="background: rgba(255,255,255,0.03); font-weight: bold;">
              <td>صافي النقد المستخدم في الأنشطة الاستثمارية</td>
              <td colspan="2"></td>
              <td style="text-align: left; direction: ltr; font-family: monospace; color: ${inv.net >= 0 ? 'var(--accent-green)' : 'var(--accent-red)'}; font-size: 1.05rem;">${App.formatNumber(inv.net)} ر.ي</td>
            </tr>
          `;

          // Section 3: Financing
          html += `<tr style="background: rgba(245,158,11,0.12); font-weight: bold;"><td colspan="4">ثالثاً: التدفقات النقدية من الأنشطة التمويلية</td></tr>`;
          (fin.inflows || []).forEach(it => {
            html += `
              <tr>
                <td>${it.item}</td>
                <td style="text-align: left; direction: ltr; font-family: monospace; color: var(--accent-green);">${App.formatNumber(it.amount)}</td>
                <td style="text-align: left; direction: ltr; font-family: monospace; color: var(--accent-red);">-</td>
                <td style="text-align: left; direction: ltr; font-family: monospace; font-weight: bold; color: var(--accent-green);">+${App.formatNumber(it.amount)} ر.ي</td>
              </tr>
            `;
          });
          html += `
            <tr style="background: rgba(255,255,255,0.03); font-weight: bold;">
              <td>صافي النقد المتولد من الأنشطة التمويلية</td>
              <td colspan="2"></td>
              <td style="text-align: left; direction: ltr; font-family: monospace; color: ${fin.net >= 0 ? 'var(--accent-green)' : 'var(--accent-red)'}; font-size: 1.05rem;">${App.formatNumber(fin.net)} ر.ي</td>
            </tr>
          `;

          // Final Totals
          html += `
            <tr style="background: rgba(212,175,55,0.15); font-weight: bold; font-size: 1.05rem;">
              <td>صافي التغير في النقدية خلال الفترة</td>
              <td colspan="2"></td>
              <td style="text-align: left; direction: ltr; font-family: monospace; color: var(--gold-light);">${App.formatNumber(d.net_cash_change)} ر.ي</td>
            </tr>
            <tr style="background: rgba(255,255,255,0.06); font-weight: bold;">
              <td>رصيد النقدية في نهاية المدة</td>
              <td colspan="2"></td>
              <td style="text-align: left; direction: ltr; font-family: monospace; color: var(--accent-green); font-size: 1.1rem;">${App.formatNumber(d.closing_balance)} ر.ي</td>
            </tr>
          `;

          tbody.innerHTML = html;
        }
      }
    } catch (e) {
      console.error('Error loading cash flow:', e);
      App.showToast('فشل تحميل التدفقات النقدية', 'error');
    }
  }
};
