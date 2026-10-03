/**
 * d3-project-charts.js
 * 
 * محرك الرسوم البيانية التفاعلية الذكي لتحليل الأداء المالي للمشاريع - رواسي عدن
 * مبني على مكتبة D3.js v7 لتقديم تصورات بيانية دقيقة وعالية التفاعل (IFRS 15 & Financial Performance)
 */

(function (window) {
  'use strict';

  const D3ProjectCharts = {
    data: [],
    summary: null,
    currentMode: 'contract_vs_cost', // 'contract_vs_cost' | 'revenue_vs_profit' | 'billings_vs_cash' | 'margin_vs_cpi'
    currentStatus: 'active',
    selectedProjectId: null,
    resizeObserver: null,
    tooltipEl: null,

    // لوحة الألوان الخاصة بالمؤشرات المالية في D3
    colors: {
      contract: '#d4af37',      // ذهبي فخم - قيمة العقد
      budget: '#38bdf8',        // أزرق سماوي - الميزانية التقديرية
      cost: '#f43f5e',          // وردي محمر - التكاليف الفعلية المتكبدة
      revenue: '#10b981',       // زمردي - الإيرادات المعترف بها (POC)
      profit: '#34d399',        // أخضر فاتح - صافي الربح
      loss: '#ef4444',          // أحمر قرمزي - خسارة
      billings: '#60a5fa',      // أزرق ملكي - المستخلصات الصادرة
      cash: '#059669',          // أخضر داكن - المقبوضات النقدية المحصلة
      uncollected: '#f59e0b',   // كهرماني - مستخلصات غير محصلة
      cpi: '#a855f7',           // بنفسجي ملكي - مؤشر أداء التكلفة CPI
      neutral: '#64748b',       // رمادي داكن
      palette: ['#d4af37', '#10b981', '#38bdf8', '#f59e0b', '#a855f7', '#ec4899', '#06b6d4', '#14b8a6', '#6366f1']
    },

    /**
     * التهيئة الأولية لمحرك D3
     */
    async init() {
      this.ensureTooltip();
      this.setupResizeObserver();
      await this.loadData();
    },

    /**
     * إنشاء عنصر الـ Tooltip العائم الموحد
     */
    ensureTooltip() {
      let tt = document.getElementById('d3GlobalTooltip');
      if (!tt) {
        tt = document.createElement('div');
        tt.id = 'd3GlobalTooltip';
        tt.className = 'd3-tooltip';
        document.body.appendChild(tt);
      }
      this.tooltipEl = tt;
    },

    /**
     * مراقب التجاوب مع تغيير حجم الشاشة أو الإطار
     */
    setupResizeObserver() {
      if (this.resizeObserver) return;
      const barContainer = document.getElementById('d3BarChartContainer');
      if (barContainer && window.ResizeObserver) {
        let debounceTimer;
        this.resizeObserver = new ResizeObserver(() => {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            if (this.data && this.data.length > 0) {
              this.render();
            }
          }, 150);
        });
        this.resizeObserver.observe(barContainer);
      }
    },

    /**
     * جلب البيانات المالية للمشاريع من السيرفر
     */
    async loadData() {
      try {
        const res = await fetch(`/api/reports/projects-financial-performance?status=all`);
        const json = await res.json();
        if (json.success && json.data) {
          this.data = json.data.projects || [];
          this.summary = json.data.summary || null;
          this.render();
        } else {
          // محاولة جلب من لوحة التحكم العامة كخيار احتياطي
          const dbRes = await fetch('/api/reports/dashboard');
          const dbJson = await dbRes.json();
          if (dbJson.success && dbJson.data && dbJson.data.project_financials) {
            this.mapFromDashboardData(dbJson.data.project_financials, dbJson.data.contracting_summary);
            this.render();
          }
        }
      } catch (err) {
        console.error('⚠️ [D3ProjectCharts] خطأ في تحميل بيانات المشاريع:', err);
      }
    },

    mapFromDashboardData(rawList, summary) {
      this.data = (rawList || []).map(p => {
        const contractVal = Number(p.revised_contract_value || p.base_contract_value) || 0;
        const actualCost = Number(p.cumulative_actual_cost) || 0;
        const budgetCost = Number(p.revised_estimated_cost) || (contractVal * 0.8);
        const recognizedRev = Number(p.recognized_revenue?.cumulative ?? p.cumulative_recognized_revenue) || 0;
        const netProfit = Number(p.financial_analysis?.true_recognized_profit ?? p.recognized_net_profit) || (recognizedRev - actualCost);
        const grossBillings = Number(p.progress_billings?.gross_billings ?? p.gross_billings) || 0;
        const cashReceipts = Number(p.cash_receipts?.total ?? p.total_cash_receipts) || 0;
        const profitMarginPct = Number(p.financial_analysis?.profit_margin_pct ?? p.recognized_profit_margin) || 
          (recognizedRev > 0 ? Math.round((netProfit / recognizedRev) * 100 * 10) / 10 : 0);
        
        const earnedValue = budgetCost * (Number(p.cost_to_cost_poc_pct || p.engineering_progress_pct || 0) / 100);
        const cpi = actualCost > 0 ? Math.round((earnedValue / actualCost) * 100) / 100 : 1.0;
        
        let financialHealth = 'ممتاز';
        if (cpi < 0.9 || profitMarginPct < 5) financialHealth = 'خطر التجاوز';
        else if (cpi < 1.0 || profitMarginPct < 12) financialHealth = 'تحت المراقبة';

        return {
          id: p.project_id || p.id,
          name: p.project_name || p.name,
          code: p.project_code || p.code,
          client_name: p.client_name || 'عميل معتمد',
          status: p.status || 'active',
          contract_value: contractVal,
          estimated_cost: budgetCost,
          actual_cost: actualCost,
          recognized_revenue: recognizedRev,
          net_profit: netProfit,
          profit_margin_pct: profitMarginPct,
          progress_percentage: Number(p.engineering_progress_pct || p.progress_percentage) || 0,
          poc_percentage: Number(p.cost_to_cost_poc_pct) || 0,
          gross_billings: grossBillings,
          cash_receipts: cashReceipts,
          uncollected_billings: Math.max(0, grossBillings - cashReceipts),
          cpi,
          financial_health: financialHealth
        };
      });
      this.summary = summary;
    },

    /**
     * إعادة رسم وتحديث اللوحة بالكامل
     */
    render() {
      if (typeof window.d3 === 'undefined') {
        console.warn('⚠️ [D3ProjectCharts] مكتبة D3.js غير محملة بعد');
        return;
      }

      const filteredProjects = this.getFilteredProjects();
      this.renderSummaryMetrics(filteredProjects);
      this.renderMainBarChart(filteredProjects);
      this.renderDonutChart(filteredProjects);
    },

    /**
     * تصفية المشاريع حسب الحالة المحددة
     */
    getFilteredProjects() {
      let list = [...this.data];
      if (this.currentStatus === 'active') {
        list = list.filter(p => p.status === 'active' || p.status === 'قيد التنفيذ');
      } else if (this.currentStatus === 'completed') {
        list = list.filter(p => p.status === 'completed' || p.status === 'منتهي' || p.status === 'مكتمل');
      }
      return list;
    },

    /**
     * تغيير وضع العرض (Mode)
     */
    switchMode(mode) {
      this.currentMode = mode;
      document.querySelectorAll('.d3-view-btn').forEach(btn => {
        if (btn.getAttribute('data-mode') === mode) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });

      const filteredProjects = this.getFilteredProjects();
      this.renderMainBarChart(filteredProjects);
    },

    /**
     * فلترة المشاريع حسب الحالة
     */
    filterByStatus(status) {
      this.currentStatus = status;
      this.render();
    },

    /**
     * إعادة تحميل البيانات
     */
    async reload() {
      await this.loadData();
    },

    /**
     * رسم شريط الإجماليات السريعة للمشاريع المعروضة
     */
    renderSummaryMetrics(projects) {
      const container = document.getElementById('d3ProjectsMetricsBar');
      if (!container) return;

      const totalContract = projects.reduce((s, p) => s + (p.contract_value || 0), 0);
      const totalCost = projects.reduce((s, p) => s + (p.actual_cost || 0), 0);
      const totalRevenue = projects.reduce((s, p) => s + (p.recognized_revenue || 0), 0);
      const totalProfit = projects.reduce((s, p) => s + (p.net_profit || 0), 0);
      const avgMargin = projects.length > 0
        ? Math.round((projects.reduce((s, p) => s + (p.profit_margin_pct || 0), 0) / projects.length) * 10) / 10
        : 0;

      container.innerHTML = `
        <div style="background: rgba(15, 28, 48, 0.7); padding: 10px 14px; border-radius: 8px; border-right: 3px solid var(--gold-primary);">
          <span style="font-size: 0.72rem; color: var(--text-secondary); display: block;">قيمة محفظة المشاريع المعروضة</span>
          <strong style="font-size: 1.05rem; color: var(--gold-light); font-family: monospace;">${this.formatCurrency(totalContract)}</strong>
          <span style="font-size: 0.7rem; color: var(--text-muted); display: block;">${projects.length} مشاريع</span>
        </div>
        <div style="background: rgba(15, 28, 48, 0.7); padding: 10px 14px; border-radius: 8px; border-right: 3px solid var(--accent-red);">
          <span style="font-size: 0.72rem; color: var(--text-secondary); display: block;">التكاليف المتكبدة الفعلية</span>
          <strong style="font-size: 1.05rem; color: #f87171; font-family: monospace;">${this.formatCurrency(totalCost)}</strong>
          <span style="font-size: 0.7rem; color: var(--text-muted); display: block;">${totalContract > 0 ? Math.round((totalCost/totalContract)*100) : 0}% من إجمالي العقود</span>
        </div>
        <div style="background: rgba(15, 28, 48, 0.7); padding: 10px 14px; border-radius: 8px; border-right: 3px solid var(--accent-green);">
          <span style="font-size: 0.72rem; color: var(--text-secondary); display: block;">الإيرادات المعترف بها (IFRS 15)</span>
          <strong style="font-size: 1.05rem; color: var(--accent-green); font-family: monospace;">${this.formatCurrency(totalRevenue)}</strong>
          <span style="font-size: 0.7rem; color: var(--text-muted); display: block;">وفق نسبة الإنجاز POC</span>
        </div>
        <div style="background: rgba(15, 28, 48, 0.7); padding: 10px 14px; border-radius: 8px; border-right: 3px solid #34d399;">
          <span style="font-size: 0.72rem; color: var(--text-secondary); display: block;">صافي الأرباح المحاسبية المحققة</span>
          <strong style="font-size: 1.05rem; color: #34d399; font-family: monospace;">${this.formatCurrency(totalProfit)}</strong>
          <span style="font-size: 0.7rem; color: ${avgMargin >= 15 ? '#34d399' : '#f59e0b'}; display: block;">متوسط الهامش: ${avgMargin}%</span>
        </div>
      `;
    },

    /**
     * رسم المخطط التفاعلي الرئيسي للأعمدة بواسطة D3.js
     */
    renderMainBarChart(projects) {
      const container = document.getElementById('d3BarChartContainer');
      const titleEl = document.getElementById('d3BarChartTitle');
      const legendEl = document.getElementById('d3BarLegend');
      if (!container || !window.d3) return;

      container.innerHTML = '';

      if (!projects || projects.length === 0) {
        container.innerHTML = `
          <div style="display: flex; height: 100%; align-items: center; justify-content: center; color: var(--text-secondary); font-size: 0.85rem;">
            لا توجد مشاريع مطابقة لمعايير الفلترة الحالية
          </div>
        `;
        return;
      }

      // إعدادات وتكوين وضع العرض
      const modeConfig = this.getModeConfig(this.currentMode);
      if (titleEl) titleEl.textContent = modeConfig.title;
      if (legendEl) {
        legendEl.innerHTML = modeConfig.series.map(s => `
          <span style="display: flex; align-items: center; gap: 5px; color: var(--text-secondary);">
            <span style="display: inline-block; width: 10px; height: 10px; border-radius: 2px; background: ${s.color};"></span>
            <span>${s.label}</span>
          </span>
        `).join('');
      }

      // أبعاد الرسم
      const margin = { top: 25, right: 25, bottom: 45, left: 65 };
      const width = container.clientWidth - margin.left - margin.right;
      const height = container.clientHeight - margin.top - margin.bottom;

      if (width <= 0 || height <= 0) return;

      const d3 = window.d3;

      // إنشاء عنصر SVG الأساسي
      const svg = d3.select(container)
        .append('svg')
        .attr('id', 'd3BarChartSvg')
        .attr('width', width + margin.left + margin.right)
        .attr('height', height + margin.top + margin.bottom)
        .append('g')
        .attr('transform', `translate(${margin.left}, ${margin.top})`);

      // تعريف التدرجات اللونية الفاخرة (Gradients)
      const defs = svg.append('defs');
      modeConfig.series.forEach(s => {
        const grad = defs.append('linearGradient')
          .attr('id', `grad-${s.key}`)
          .attr('x1', '0%').attr('y1', '0%')
          .attr('x2', '0%').attr('y2', '100%');
        grad.append('stop').attr('offset', '0%').attr('stop-color', s.color).attr('stop-opacity', 0.95);
        grad.append('stop').attr('offset', '100%').attr('stop-color', s.color).attr('stop-opacity', 0.65);
      });

      // مقياس المحور السيني (Projects Band Scale)
      const x0 = d3.scaleBand()
        .domain(projects.map(d => d.name))
        .range([0, width])
        .paddingInner(0.25)
        .paddingOuter(0.15);

      // مقياس الأعمدة الفرعية داخل كل مشروع
      const x1 = d3.scaleBand()
        .domain(modeConfig.series.map(s => s.key))
        .range([0, x0.bandwidth()])
        .padding(0.08);

      // مقياس المحور الصادي (Values Linear Scale)
      let yMax = 0;
      projects.forEach(p => {
        modeConfig.series.forEach(s => {
          const val = Number(p[s.key]) || 0;
          if (val > yMax) yMax = val;
        });
      });
      if (yMax <= 0) yMax = 100000;

      const y = d3.scaleLinear()
        .domain([0, yMax * 1.12])
        .range([height, 0]);

      // خطوط الشبكة الأفقية (Grid lines)
      svg.append('g')
        .attr('class', 'd3-grid')
        .call(d3.axisLeft(y)
          .ticks(5)
          .tickSize(-width)
          .tickFormat('')
        )
        .call(g => g.select('.domain').remove());

      // المحور الصادي (Y Axis)
      svg.append('g')
        .attr('class', 'd3-axis d3-axis-y')
        .call(d3.axisLeft(y)
          .ticks(5)
          .tickFormat(d => modeConfig.isPercentage ? `${d}%` : this.formatCompact(d))
        )
        .call(g => g.select('.domain').attr('stroke', 'rgba(255,255,255,0.15)'));

      // المحور السيني (X Axis)
      const xAxis = svg.append('g')
        .attr('class', 'd3-axis d3-axis-x')
        .attr('transform', `translate(0, ${height})`)
        .call(d3.axisBottom(x0));

      xAxis.selectAll('text')
        .style('text-anchor', 'middle')
        .style('font-size', '10.5px')
        .style('fill', 'var(--text-secondary)')
        .text(function(d) {
          // اختصار الاسم الطويل إن وجد
          return d.length > 14 ? d.substring(0, 13) + '…' : d;
        });

      xAxis.select('.domain').attr('stroke', 'rgba(255,255,255,0.15)');

      // مجموعات الأعمدة لكل مشروع
      const projectGroups = svg.selectAll('.project-group')
        .data(projects)
        .enter()
        .append('g')
        .attr('class', 'project-group')
        .attr('transform', d => `translate(${x0(d.name)}, 0)`)
        .style('cursor', 'pointer')
        .on('click', (event, d) => this.selectProject(d));

      // رسم الأعمدة
      modeConfig.series.forEach(s => {
        projectGroups.append('rect')
          .attr('class', 'd3-chart-bar')
          .attr('x', x1(s.key))
          .attr('width', x1.bandwidth())
          .attr('y', height)
          .attr('height', 0)
          .attr('rx', 3)
          .attr('ry', 3)
          .attr('fill', `url(#grad-${s.key})`)
          .on('mouseenter', (event, d) => {
            d3.selectAll('.d3-chart-bar').style('opacity', 0.35);
            d3.select(event.currentTarget).style('opacity', 1);
            this.showTooltip(event, d, s, modeConfig);
          })
          .on('mousemove', (event) => {
            this.moveTooltip(event);
          })
          .on('mouseleave', () => {
            d3.selectAll('.d3-chart-bar').style('opacity', 1);
            this.hideTooltip();
          })
          .transition()
          .duration(750)
          .ease(d3.easeCubicOut)
          .delay((d, i) => i * 40)
          .attr('y', d => y(Math.max(0, Number(d[s.key]) || 0)))
          .attr('height', d => Math.max(0, height - y(Math.max(0, Number(d[s.key]) || 0))));
      });
    },

    /**
     * إعدادات خيارات العرض للأعمدة
     */
    getModeConfig(mode) {
      switch (mode) {
        case 'revenue_vs_profit':
          return {
            title: 'مقارنة الإيرادات المعترف بها (IFRS 15) وصافي الأرباح المحققة',
            isPercentage: false,
            series: [
              { key: 'recognized_revenue', label: 'الإيراد المكتسب (POC)', color: this.colors.revenue },
              { key: 'actual_cost', label: 'التكلفة الفعلية', color: this.colors.neutral },
              { key: 'net_profit', label: 'صافي الربح', color: this.colors.profit }
            ]
          };
        case 'billings_vs_cash':
          return {
            title: 'تحليل مستخلصات الأعمال المعتمدة مقابل المقبوضات النقدية والسيولة',
            isPercentage: false,
            series: [
              { key: 'gross_billings', label: 'المستخلصات المفوترة', color: this.colors.billings },
              { key: 'cash_receipts', label: 'المقبوضات النقدية المحصلة', color: this.colors.cash },
              { key: 'uncollected_billings', label: 'ذمم مستخلصات معلقة', color: this.colors.uncollected }
            ]
          };
        case 'margin_vs_cpi':
          return {
            title: 'مؤشرات الأداء: نسبة الإنجاز % وهامش الربح % ومؤشر كفاءة التكلفة CPI',
            isPercentage: true,
            series: [
              { key: 'progress_percentage', label: 'نسبة الإنجاز %', color: this.colors.budget },
              { key: 'profit_margin_pct', label: 'هامش الربح %', color: this.colors.profit }
            ]
          };
        case 'contract_vs_cost':
        default:
          return {
            title: 'مقارنة القيمة التعاقدية للمشروع، الميزانية، والتكاليف الفعلية المتكبدة',
            isPercentage: false,
            series: [
              { key: 'contract_value', label: 'قيمة العقد المعتمد', color: this.colors.contract },
              { key: 'estimated_cost', label: 'الميزانية التقديرية', color: this.colors.budget },
              { key: 'actual_cost', label: 'التكاليف الفعلية المتكبدة', color: this.colors.cost }
            ]
          };
      }
    },

    /**
     * رسم المخطط الدائري التفاعلي لتوزيع الأرباح ومحفظة المشاريع
     */
    renderDonutChart(projects) {
      const container = document.getElementById('d3DonutContainer');
      const legendList = document.getElementById('d3DonutLegendList');
      if (!container || !window.d3) return;

      container.innerHTML = '';
      if (legendList) legendList.innerHTML = '';

      if (!projects || projects.length === 0) {
        container.innerHTML = `<span style="color: var(--text-muted); font-size: 0.8rem;">لا توجد بيانات</span>`;
        return;
      }

      // تصفية المشاريع التي لديها أرباح موجبة أو قيمة عقد
      const validProjects = projects
        .map((p, idx) => ({
          ...p,
          val: Math.max(0, p.net_profit > 0 ? p.net_profit : p.contract_value),
          color: this.colors.palette[idx % this.colors.palette.length]
        }))
        .filter(p => p.val > 0);

      if (validProjects.length === 0) {
        container.innerHTML = `<span style="color: var(--text-muted); font-size: 0.8rem;">لا توجد أرباح مسجلة لعرضها</span>`;
        return;
      }

      const totalVal = validProjects.reduce((s, p) => s + p.val, 0);

      const d3 = window.d3;
      const width = container.clientWidth || 240;
      const height = container.clientHeight || 240;
      const radius = Math.min(width, height) / 2 - 10;
      const innerRadius = radius * 0.62;

      const svg = d3.select(container)
        .append('svg')
        .attr('id', 'd3DonutSvg')
        .attr('width', width)
        .attr('height', height)
        .append('g')
        .attr('transform', `translate(${width / 2}, ${height / 2})`);

      const pie = d3.pie()
        .value(d => d.val)
        .sort(null);

      const arc = d3.arc()
        .innerRadius(innerRadius)
        .outerRadius(radius)
        .cornerRadius(4)
        .padAngle(0.02);

      const arcHover = d3.arc()
        .innerRadius(innerRadius - 3)
        .outerRadius(radius + 5)
        .cornerRadius(4)
        .padAngle(0.02);

      // رسم الشرائح
      const slices = svg.selectAll('.d3-donut-slice')
        .data(pie(validProjects))
        .enter()
        .append('path')
        .attr('class', 'd3-donut-slice')
        .attr('fill', d => d.data.color)
        .attr('d', arc)
        .on('mouseenter', (event, d) => {
          d3.select(event.currentTarget)
            .transition()
            .duration(200)
            .attr('d', arcHover);

          const pct = totalVal > 0 ? Math.round((d.data.val / totalVal) * 100) : 0;
          this.showSimpleTooltip(event, `
            <div style="font-weight: bold; color: ${d.data.color};">${d.data.name}</div>
            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 2px;">
              الربح / المساهمة: <strong>${this.formatCurrency(d.data.val)}</strong> (${pct}%)
            </div>
          `);
        })
        .on('mousemove', (event) => this.moveTooltip(event))
        .on('mouseleave', (event) => {
          d3.select(event.currentTarget)
            .transition()
            .duration(200)
            .attr('d', arc);
          this.hideTooltip();
        })
        .on('click', (event, d) => this.selectProject(d.data));

      // حركة الظهور بالتدريج
      slices.transition()
        .duration(800)
        .attrTween('d', function(d) {
          const interpolate = d3.interpolate({ startAngle: 0, endAngle: 0 }, d);
          return function(t) {
            return arc(interpolate(t));
          };
        });

      // النص في وسط الدونات
      const centerGroup = svg.append('g').attr('text-anchor', 'middle');
      centerGroup.append('text')
        .attr('dy', '-0.2em')
        .style('font-size', '11px')
        .style('fill', 'var(--text-secondary)')
        .text('إجمالي الربح');

      centerGroup.append('text')
        .attr('dy', '1.1em')
        .style('font-size', '13px')
        .style('font-weight', 'bold')
        .style('font-family', 'monospace')
        .style('fill', '#34d399')
        .text(this.formatCompact(totalVal));

      // قائمة وسيلة الإيضاح أسفل الدونات
      if (legendList) {
        legendList.innerHTML = validProjects.map(p => {
          const pct = totalVal > 0 ? Math.round((p.val / totalVal) * 100) : 0;
          return `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 3px 0; border-bottom: 1px dashed rgba(255,255,255,0.04); cursor: pointer;" onclick="D3ProjectCharts.selectProjectById(${p.id})">
              <span style="display: flex; align-items: center; gap: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 65%;">
                <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${p.color}; flex-shrink: 0;"></span>
                <span style="color: var(--text-primary); font-size: 0.74rem;">${p.name}</span>
              </span>
              <span style="color: var(--gold-light); font-family: monospace; font-size: 0.72rem;">${pct}% (${this.formatCompact(p.val)})</span>
            </div>
          `;
        }).join('');
      }
    },

    /**
     * إظهار تفاصيل المشروع المختار عند النقر
     */
    selectProject(project) {
      if (!project) return;
      this.selectedProjectId = project.id;
      const card = document.getElementById('d3SelectedProjectCard');
      if (!card) return;

      const healthBadge = project.financial_health === 'ممتاز'
        ? `<span style="background: rgba(16,185,129,0.15); color: #34d399; padding: 2px 8px; border-radius: 4px; border: 1px solid rgba(16,185,129,0.3); font-size: 0.72rem;">صحي ومربح 🟢</span>`
        : (project.financial_health === 'تحت المراقبة'
          ? `<span style="background: rgba(245,158,11,0.15); color: #fbbf24; padding: 2px 8px; border-radius: 4px; border: 1px solid rgba(245,158,11,0.3); font-size: 0.72rem;">تحت المراقبة 🟡</span>`
          : `<span style="background: rgba(239,68,68,0.15); color: #f87171; padding: 2px 8px; border-radius: 4px; border: 1px solid rgba(239,68,68,0.3); font-size: 0.72rem;">خطر التجاوز 🔴</span>`);

      card.style.display = 'flex';
      card.innerHTML = `
        <div style="display: flex; align-items: center; gap: 14px; flex-wrap: wrap;">
          <div style="width: 32px; height: 32px; border-radius: 6px; background: rgba(212,175,55,0.15); display: flex; align-items: center; justify-content: center; color: var(--gold-primary); font-weight: bold;">
            #${project.code || project.id}
          </div>
          <div>
            <strong style="font-size: 0.95rem; color: var(--text-primary);">${project.name}</strong>
            <span style="font-size: 0.78rem; color: var(--text-secondary); margin-right: 8px;">العميل: ${project.client_name || 'عام'}</span>
          </div>
          ${healthBadge}
        </div>

        <div style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin-top: 6px;">
          <div style="font-size: 0.78rem;">
            <span style="color: var(--text-secondary);">العقد:</span>
            <strong style="color: var(--gold-light); font-family: monospace;">${this.formatCurrency(project.contract_value)}</strong>
          </div>
          <div style="font-size: 0.78rem;">
            <span style="color: var(--text-secondary);">التكلفة:</span>
            <strong style="color: #f87171; font-family: monospace;">${this.formatCurrency(project.actual_cost)}</strong>
          </div>
          <div style="font-size: 0.78rem;">
            <span style="color: var(--text-secondary);">صافي الربح:</span>
            <strong style="color: #34d399; font-family: monospace;">${this.formatCurrency(project.net_profit)}</strong>
            <span style="color: #34d399; font-size: 0.72rem;">(${project.profit_margin_pct}%)</span>
          </div>
          <div style="font-size: 0.78rem;">
            <span style="color: var(--text-secondary);">مؤشر CPI:</span>
            <strong style="color: var(--accent-blue); font-family: monospace;">${project.cpi || '1.0'}</strong>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="App.showView('projectsView'); if (window.Projects && Projects.openProjectDetailsModal) Projects.openProjectDetailsModal(${project.id});" style="font-size: 0.72rem; padding: 4px 10px;">
            عرض المشروع الكامل ↗
          </button>
          <button type="button" class="btn-icon" onclick="document.getElementById('d3SelectedProjectCard').style.display='none'" title="إغلاق">✕</button>
        </div>
      `;
    },

    selectProjectById(id) {
      const p = this.data.find(it => it.id === id);
      if (p) this.selectProject(p);
    },

    /**
     * إظهار تفاصيل المؤشر في الـ Tooltip
     */
    showTooltip(event, project, currentSeries, modeConfig) {
      if (!this.tooltipEl) return;

      const formatVal = (v) => modeConfig.isPercentage ? `${v}%` : this.formatCurrency(v);
      const val = Number(project[currentSeries.key]) || 0;

      const content = `
        <div style="font-weight: 700; color: var(--gold-primary); font-size: 0.88rem; margin-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 4px;">
          ${project.name} <span style="font-size: 0.72rem; color: var(--text-secondary); font-weight: normal;">(#${project.code || project.id})</span>
        </div>
        <div style="font-size: 0.72rem; color: var(--text-muted); margin-bottom: 8px;">العميل: ${project.client_name || 'عام'}</div>

        <div style="background: rgba(0,0,0,0.25); border-radius: 6px; padding: 6px 8px; margin-bottom: 8px;">
          <div style="display: flex; justify-content: space-between; gap: 12px; margin-bottom: 3px;">
            <span style="color: ${currentSeries.color}; font-weight: 600;">${currentSeries.label}:</span>
            <strong style="font-family: monospace; color: ${currentSeries.color};">${formatVal(val)}</strong>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-size: 0.72rem; border-top: 1px dashed rgba(255,255,255,0.08); padding-top: 6px;">
          <div>العقد: <span style="font-family: monospace; color: var(--gold-light);">${this.formatCompact(project.contract_value)}</span></div>
          <div>التكلفة: <span style="font-family: monospace; color: #f87171;">${this.formatCompact(project.actual_cost)}</span></div>
          <div>الربح: <span style="font-family: monospace; color: #34d399;">${this.formatCompact(project.net_profit)}</span></div>
          <div>الهامش: <span style="font-family: monospace; color: #34d399;">${project.profit_margin_pct}%</span></div>
          <div>الإنجاز: <span style="font-family: monospace; color: var(--accent-blue);">${project.progress_percentage}%</span></div>
          <div>مؤشر CPI: <span style="font-family: monospace; color: ${project.cpi >= 1 ? '#34d399' : '#f87171'};">${project.cpi || '1.0'}</span></div>
        </div>
        <div style="margin-top: 6px; font-size: 0.68rem; color: var(--text-muted); text-align: left;">انقر للتفاصيل 👆</div>
      `;

      this.tooltipEl.innerHTML = content;
      this.tooltipEl.style.opacity = '1';
      this.moveTooltip(event);
    },

    showSimpleTooltip(event, html) {
      if (!this.tooltipEl) return;
      this.tooltipEl.innerHTML = html;
      this.tooltipEl.style.opacity = '1';
      this.moveTooltip(event);
    },

    moveTooltip(event) {
      if (!this.tooltipEl) return;
      const x = event.pageX + 15;
      const y = event.pageY - 25;
      this.tooltipEl.style.transform = `translate(${x}px, ${y}px)`;
    },

    hideTooltip() {
      if (!this.tooltipEl) return;
      this.tooltipEl.style.opacity = '0';
    },

    /**
     * تصدير المخطط البياني بصيغة SVG
     */
    exportSVG() {
      const svg = document.getElementById('d3BarChartSvg');
      if (!svg) {
        alert('المخطط البياني غير متوفر للتصدير حالياً');
        return;
      }
      try {
        const serializer = new XMLSerializer();
        let source = serializer.serializeToString(svg);
        if (!source.match(/^<svg[^>]+xmlns="http\:\/\/www\.w3\.org\/2000\/svg"/)) {
          source = source.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
        }
        if (!source.match(/^<svg[^>]+xmlns\:xlink="http\:\/\/www\.w3\.org\/1999\/xlink"/)) {
          source = source.replace(/^<svg/, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
        }
        const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `rawasi-projects-financial-performance-${Date.now()}.svg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } catch (e) {
        console.error('Error exporting SVG:', e);
      }
    },

    /**
     * دوال التنسيق المالي (Currency & Numbers Formatting)
     */
    formatCurrency(val) {
      const num = Number(val) || 0;
      return num.toLocaleString('en-US') + ' ر.ي';
    },

    formatCompact(val) {
      const num = Math.abs(Number(val) || 0);
      const sign = Number(val) < 0 ? '-' : '';
      if (num >= 1000000000) {
        return sign + (num / 1000000000).toFixed(1) + 'B';
      }
      if (num >= 1000000) {
        return sign + (num / 1000000).toFixed(1) + 'M';
      }
      if (num >= 1000) {
        return sign + (num / 1000).toFixed(0) + 'K';
      }
      return sign + num.toString();
    }
  };

  window.D3ProjectCharts = D3ProjectCharts;
})(window);
