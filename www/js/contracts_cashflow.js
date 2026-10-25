/**
 * =========================================================================
 * js/contracts_cashflow.js
 * واجهة المستخدم لنظامي:
 * 1. توقعات التدفق النقدي والسيولة (Cash Flow UI)
 * 2. دورة حياة العقد والتنبيهات الذكية (Contract Lifecycle & Alerts UI)
 * لشركة رواسي عدن للهندسة والمقاولات
 * =========================================================================
 */

const ContractAlertsUI = {
  alerts: [],
  summary: null,
  currentContractId: null,
  eventSource: null,

  async init() {
    await this.loadDashboard();
    await this.loadContractsList();
    this.connectLiveAlerts();
  },

  async connectLiveAlerts() {
    if (this.ws || this.eventSource) return;

    // 1. محاولة الاتصال بخادم الـ WebSocket المباشر
    try {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${location.host}/ws/alerts`;
      const response=await fetch('/api/auth/realtime-ticket',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      const data=await response.json();if(!response.ok||!data.ticket)throw new Error('Session unavailable');
      this.ws = new WebSocket(wsUrl,['rawasi-auth','ticket.'+data.ticket]);

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data && data.type === 'ALERT') {
            App.showToast(`🚨 تنبيه تعاقدي جديد: ${data.alert.description}`, data.alert.severity === 'critical' ? 'error' : 'warning');
            this.loadDashboard();
          }
        } catch {}
      };

      this.ws.onerror = () => {
        this.fallbackToSSE();
      };
      this.ws.onclose = () => {
        this.ws = null;
        if (window.Auth?.token) setTimeout(()=>this.connectLiveAlerts(),1500);
      };
    } catch {
      this.fallbackToSSE();
    }
  },

  async fallbackToSSE() {
    if (this.eventSource) return;
    try {
      const response=await fetch('/api/auth/realtime-ticket',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      const data=await response.json();if(!response.ok||!data.ticket)throw new Error('Session unavailable');
      this.eventSource = new EventSource('/api/contracts/alerts/stream?token='+encodeURIComponent(data.ticket));
      this.eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data && data.type !== 'CONNECTED') {
            App.showToast(`🚨 تنبيه تعاقدي جديد: ${data.description}`, data.severity === 'critical' ? 'error' : 'warning');
            this.loadDashboard();
          }
        } catch {}
      };
      this.eventSource.onerror = () => {
        if (this.eventSource) {
          this.eventSource.close();
          this.eventSource = null;
        }
      };
    } catch (e) {
      console.warn('Live alerts stream not available:', e);
    }
  },

  async loadDashboard() {
    const sev = document.getElementById('caFilterSeverity')?.value || '';
    const type = document.getElementById('caFilterType')?.value || '';
    const status = document.getElementById('caFilterStatus')?.value || '';

    let url = '/api/contracts/alerts/dashboard?';
    if (sev) url += `severity=${sev}&`;
    if (type) url += `alert_type=${type}&`;
    if (status) url += `status=${status}&`;

    try {
      const res = await fetch(url);
      const json = await res.json();
      if (json.success) {
        this.alerts = json.alerts;
        this.summary = json.summary;
        this.renderKPIs();
        this.renderAlertsTable();
      }
    } catch (e) {
      console.error('Error loading contract alerts:', e);
    }
  },

  renderKPIs() {
    if (!this.summary) return;
    const elCrit = document.getElementById('caKpiCritical');
    const elWarn = document.getElementById('caKpiWarning');
    const elInfo = document.getElementById('caKpiInfo');
    const elRisk = document.getElementById('caKpiRisk');

    if (elCrit) elCrit.textContent = this.summary.critical_count || 0;
    if (elWarn) elWarn.textContent = this.summary.warning_count || 0;
    if (elInfo) elInfo.textContent = this.summary.info_count || 0;
    if (elRisk) elRisk.textContent = `${App.formatNumber(this.summary.total_amount_at_risk || 0)} $`;
  },

  renderAlertsTable() {
    const tbody = document.getElementById('contractAlertsTableBody');
    if (!tbody) return;

    if (!this.alerts || this.alerts.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 24px; color: var(--text-secondary);">
        ✅ لا توجد تنبيهات نشطة مطابقة للفلاتر المحددة
      </td></tr>`;
      return;
    }

    const typeLabels = {
      expiry: 'انتهاء العقد',
      ipc_due: 'موعد مستخلص',
      advance_payment: 'استرداد دفعة مقدمة',
      retention_due: 'محتجز ضمان',
      penalty: 'غرامة تأخير'
    };

    const sevBadges = {
      critical: '<span class="badge" style="background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid #ef4444;">حرج (Critical) 🚨</span>',
      warning: '<span class="badge" style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid #f59e0b;">تحذير (Warning) ⚠️</span>',
      info: '<span class="badge" style="background: rgba(56, 189, 248, 0.2); color: #38bdf8; border: 1px solid #0284c7;">معلوماتي (Info) ℹ️</span>'
    };

    tbody.innerHTML = this.alerts.map(a => `
      <tr style="border-bottom: 1px solid rgba(255,255,255,0.06);">
        <td>${sevBadges[a.severity] || a.severity}</td>
        <td><strong>${typeLabels[a.alert_type] || a.alert_type}</strong></td>
        <td>${a.project_name || '-'}</td>
        <td style="font-size: 0.88rem; line-height: 1.4;">${a.description}</td>
        <td style="font-weight: 700; color: #ef4444;">${App.formatNumber(a.amount_at_risk)} $</td>
        <td>
          <span class="badge ${a.status === 'acknowledged' ? 'badge-primary' : 'badge-expense'}">
            ${a.status === 'acknowledged' ? 'تم الإقرار' : 'معلق'}
          </span>
        </td>
        <td>
          <div style="display: flex; gap: 6px;">
            ${a.status !== 'acknowledged' ? `
              <button class="btn btn-sm btn-secondary" onclick="ContractAlertsUI.acknowledgeAlert(${a.id})" title="إقرار بمتابعة التنبيه">
                ✓ إقرار
              </button>
            ` : ''}
            <button class="btn btn-sm btn-primary" onclick="ContractAlertsUI.resolveAlert(${a.id})" title="حل ومعالجة التنبيه">
              حل نهائي
            </button>
          </div>
        </td>
      </tr>
    `).join('');
  },

  async acknowledgeAlert(alertId) {
    try {
      const res = await fetch(`/api/contracts/1/alerts/${alertId}/ack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: 'تم الإقرار من شاشة المتابعة' })
      });
      const json = await res.json();
      if (json.success) {
        App.showToast('تم الإقرار بالتنبيه واعتماد متابعته', 'success');
        this.loadDashboard();
      }
    } catch (e) {
      App.showToast('تعذر الإقرار بالتنبيه', 'error');
    }
  },

  async resolveAlert(alertId) {
    try {
      const res = await fetch(`/api/contracts/1/alerts/${alertId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const json = await res.json();
      if (json.success) {
        App.showToast('تم حل ومعالجة التنبيه بنجاح', 'success');
        this.loadDashboard();
      }
    } catch (e) {
      App.showToast('تعذر حل التنبيه', 'error');
    }
  },

  async loadContractsList() {
    const select = document.getElementById('contractSelectLifecycle');
    if (!select) return;
    try {
      const res = await fetch('/api/projects');
      const json = await res.json();
      if (json.success && json.data) {
        select.innerHTML = '<option value="">اختر المشروع لعرض دورة حياة عقده...</option>' +
          json.data.map(p => `<option value="${p.id}">${p.name} (${p.code})</option>`).join('');
      }
    } catch {}
  },

  async onContractSelectChange(projectId) {
    if (!projectId) return;
    try {
      // جلب معرف العقد للمشروع
      const cRes = await fetch(`/api/project-hub/${projectId}/contract`);
      const cJson = await cRes.json();
      if (cJson.success && cJson.data && cJson.data.id) {
        this.loadContractLifecycle(cJson.data.id);
      } else {
        document.getElementById('lifecycleWizardWrap').innerHTML = `
          <div style="text-align: center; padding: 20px; color: var(--gold-light);">
            لم يتم إنشاء وثيقة عقد رسمية لهذا المشروع بعد. يمكنك إنشاء عقد من مركز المشروع.
          </div>`;
      }
    } catch (e) {
      console.warn('Could not load contract for project:', e);
    }
  },

  async loadContractLifecycle(contractId) {
    this.currentContractId = contractId;
    try {
      const res = await fetch(`/api/contracts/${contractId}/lifecycle`);
      const json = await res.json();
      if (json.success && json.data) {
        this.renderLifecycleWizard(json.data);
      }
    } catch (e) {
      console.error(e);
    }
  },

  renderLifecycleWizard(data) {
    const wrap = document.getElementById('lifecycleWizardWrap');
    if (!wrap) return;

    const stages = [
      { key: 'draft', label: '1. مسودة' },
      { key: 'under_review', label: '2. مراجعة' },
      { key: 'approved_finance', label: '3. اعتماد مالي' },
      { key: 'signed', label: '4. موقّع رسمي' },
      { key: 'active', label: '5. قيد التنفيذ' },
      { key: 'amended', label: '6. أوامر تغيير' },
      { key: 'extended', label: '7. تمديد' },
      { key: 'in_ipc', label: '8. مستخلصات' },
      { key: 'in_settlement', label: '9. تسوية' },
      { key: 'closed', label: '10. مغلق نهائي' }
    ];

    const currentStage = data.contract.current_stage || 'draft';
    const currentIdx = stages.findIndex(s => s.key === currentStage);

    let html = `
      <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(212, 175, 55, 0.3); border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; flex-wrap: wrap; gap: 10px;">
          <div>
            <h4 style="color: var(--gold-light); margin: 0;">عقد رقم [${data.contract.contract_no || data.contract.id}]: ${data.contract.title || ''}</h4>
            <span style="font-size: 0.85rem; color: #94a3b8;">المرحلة الراهنة: <strong>${data.contract.current_stage_label || currentStage}</strong></span>
          </div>
          <div style="display: flex; gap: 8px;">
            <select id="selectNextStage" class="form-control" style="width: auto; padding: 4px 8px;">
              ${stages.map(s => `<option value="${s.key}" ${s.key === currentStage ? 'selected' : ''}>${s.label}</option>`).join('')}
            </select>
            <button class="btn btn-primary btn-sm" onclick="ContractAlertsUI.transitionStage()">
              ⚡ نقل المرحلة
            </button>
          </div>
        </div>

        <!-- مخطط المراحل البصري -->
        <div style="display: flex; overflow-x: auto; gap: 8px; padding-bottom: 10px;">
          ${stages.map((s, idx) => {
            const isDone = idx < currentIdx;
            const isCur = idx === currentIdx;
            const bg = isCur ? 'linear-gradient(135deg, var(--gold-primary), #997825)' : (isDone ? 'rgba(34, 197, 94, 0.2)' : 'rgba(255, 255, 255, 0.05)');
            const color = isCur ? '#000' : (isDone ? '#4ade80' : '#94a3b8');
            const border = isCur ? '2px solid var(--gold-light)' : (isDone ? '1px solid #22c55e' : '1px solid rgba(255,255,255,0.1)');
            return `
              <div style="flex: 1; min-width: 100px; text-align: center; padding: 10px 6px; border-radius: 6px; background: ${bg}; color: ${color}; border: ${border}; font-size: 0.8rem; font-weight: bold;">
                ${isDone ? '✓ ' : ''}${s.label}
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    wrap.innerHTML = html;
  },

  async transitionStage() {
    const nextStage = document.getElementById('selectNextStage')?.value;
    if (!nextStage || !this.currentContractId) return;

    try {
      const res = await fetch(`/api/contracts/${this.currentContractId}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stage: nextStage,
          approval_notes: `الانتقال المباشر من شاشة المتابعة إلى ${nextStage}`
        })
      });
      const json = await res.json();
      if (json.success) {
        App.showToast(json.message, 'success');
        this.loadContractLifecycle(this.currentContractId);
        this.loadDashboard();
      } else {
        App.showToast(json.message || 'فشل نقل المرحلة', 'error');
      }
    } catch (e) {
      App.showToast('تعذر الاتصال بالخادم', 'error');
    }
  }
};

const CashFlowUI = {
  data: null,
  scenarios: null,
  activeScenario: 'realistic',

  async init() {
    const now = new Date();
    const month = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const from = document.getElementById('cfMonthFrom'), to = document.getElementById('cfMonthTo');
    if (from && !from.value) from.value = month(now);
    if (to && !to.value) to.value = month(new Date(now.getFullYear(), now.getMonth() + 5, 1));
    await this.loadProjections();
  },

  async loadProjections() {
    const request = this._request = (this._request || 0) + 1;
    const from = document.getElementById('cfMonthFrom')?.value || '';
    const to = document.getElementById('cfMonthTo')?.value || '';
    let url = '/api/cash-flow/projection?';
    if (from) url += `from=${from}&`;
    if (to) url += `to=${to}&`;

    try {
      const res = await fetch(url, { cache: 'no-store' });
      const json = await res.json();
      if (request !== this._request) return;
      if (!res.ok || !json.success) throw new Error(json.message || 'تعذر تحميل توقعات التدفق النقدي');
      if (json.success) {
        this.data = json;
        this.renderKPIs();
        this.renderMonthsTable();
        const notice = document.getElementById('cfProjectionNotice');
        if (notice) notice.textContent = json.total_collections || json.total_payments ? 'العملة: ريال يمني. التوقعات خطة تقديرية؛ أعد الاحتساب لتحديثها من مستندات النظام.' : 'لا توجد تدفقات متوقعة محفوظة لهذه الفترة. اضغط «إعادة احتساب تلقائي من البيانات الحية» لتوليدها من المستندات المتاحة.';
        await this.loadScenarios(from, to, request);
      }
    } catch (e) {
      console.error('Error loading cash flow projections:', e);
      if (request !== this._request) return;
      this.data = null; this.scenarios = null;
      document.getElementById('cashFlowMonthsTableBody').innerHTML = '<tr><td colspan="6">تعذر تحميل التوقعات. تحقق من الفترة ثم أعد المحاولة.</td></tr>';
      document.getElementById('cfScenariosWrap').textContent = '';
      for (const id of ['cfKpiInitialCash','cfKpiTotalIn','cfKpiTotalOut','cfKpiNetCash']) document.getElementById(id).textContent = '—';
      App.showToast(e.message || 'تعذر تحميل توقعات التدفق النقدي', 'error');
    }
  },

  async loadScenarios(from = '', to = '', request = this._request) {
    try {
      const res = await fetch('/api/cash-flow/scenarios?' + new URLSearchParams({from,to}), { cache: 'no-store' });
      const json = await res.json();
      if (request !== this._request) return;
      if (!res.ok || !json.success) throw new Error(json.message || 'تعذر تحميل السيناريوهات');
      if (json.success) {
        this.scenarios = json.scenarios;
        this.renderScenarioCards();
      }
    } catch (e) { if (request === this._request) document.getElementById('cfScenariosWrap').textContent = 'تعذر تحميل سيناريوهات الفترة المحددة؛ أعد تحديث الفلترة.'; }
  },

  renderKPIs() {
    if (!this.data) return;
    document.getElementById('cfKpiInitialCash').textContent = `${App.formatNumber(this.data.initial_cash || 0)} ر.ي`;
    document.getElementById('cfKpiTotalIn').textContent = `${App.formatNumber(this.data.total_collections || 0)} ر.ي`;
    document.getElementById('cfKpiTotalOut').textContent = `${App.formatNumber(this.data.total_payments || 0)} ر.ي`;
    const netEl = document.getElementById('cfKpiNetCash');
    const netVal = this.data.total_net_cash_flow || 0;
    netEl.textContent = `${App.formatNumber(netVal)} ر.ي`;
    netEl.style.color = netVal >= 0 ? '#4ade80' : '#f87171';
  },

  renderMonthsTable() {
    const tbody = document.getElementById('cashFlowMonthsTableBody');
    if (!tbody || !this.data || !this.data.months) return;

    tbody.innerHTML = this.data.months.map(m => `
      <tr style="border-bottom: 1px solid rgba(255,255,255,0.06);">
        <td><strong>${m.period}</strong></td>
        <td style="color: #4ade80; font-weight: bold;">+${App.formatNumber(m.expected_collections)} ر.ي</td>
        <td style="color: #f87171; font-weight: bold;">-${App.formatNumber(m.expected_payments)} ر.ي</td>
        <td style="font-weight: bold; color: ${m.net_cash_flow >= 0 ? '#4ade80' : '#f87171'};">
          ${m.net_cash_flow >= 0 ? '+' : ''}${App.formatNumber(m.net_cash_flow)} ر.ي
        </td>
        <td style="font-weight: 800; color: var(--gold-light);">
          ${App.formatNumber(m.cumulative_balance)} ر.ي
        </td>
        <td style="font-size: 0.8rem; color: #94a3b8;">
          مستخلصات: ${App.formatNumber(m.breakdown.by_type.ipc_collections)} |
          موردين: ${App.formatNumber(m.breakdown.by_type.vendor_payments)} |
          رواتب: ${App.formatNumber(m.breakdown.by_type.salaries)}
        </td>
      </tr>
    `).join('');
  },

  renderScenarioCards() {
    if (!this.scenarios) return;
    const wrap = document.getElementById('cfScenariosWrap');
    if (!wrap) return;

    wrap.innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; margin-top: 14px;">
        <div style="background: rgba(34, 197, 94, 0.1); border: 1.5px solid #22c55e; border-radius: 8px; padding: 14px;">
          <h4 style="color: #4ade80; margin: 0 0 6px 0;">⚡ ${this.scenarios.optimistic.name}</h4>
          <p style="font-size: 0.78rem; color: #cbd5e1; margin-bottom: 10px;">${this.scenarios.optimistic.description}</p>
          <div style="font-size: 1.25rem; font-weight: 900; color: #4ade80;">
            ${App.formatNumber(this.scenarios.optimistic.final_balance)} ر.ي
          </div>
        </div>

        <div style="background: rgba(212, 175, 55, 0.1); border: 1.5px solid var(--gold-primary); border-radius: 8px; padding: 14px;">
          <h4 style="color: var(--gold-light); margin: 0 0 6px 0;">⚖️ ${this.scenarios.realistic.name}</h4>
          <p style="font-size: 0.78rem; color: #cbd5e1; margin-bottom: 10px;">${this.scenarios.realistic.description}</p>
          <div style="font-size: 1.25rem; font-weight: 900; color: var(--gold-light);">
            ${App.formatNumber(this.scenarios.realistic.final_balance)} ر.ي
          </div>
        </div>

        <div style="background: rgba(239, 68, 68, 0.1); border: 1.5px solid #ef4444; border-radius: 8px; padding: 14px;">
          <h4 style="color: #f87171; margin: 0 0 6px 0;">🛡️ ${this.scenarios.pessimistic.name}</h4>
          <p style="font-size: 0.78rem; color: #cbd5e1; margin-bottom: 10px;">${this.scenarios.pessimistic.description}</p>
          <div style="font-size: 1.25rem; font-weight: 900; color: #f87171;">
            ${App.formatNumber(this.scenarios.pessimistic.final_balance)} ر.ي
          </div>
        </div>
      </div>
    `;
  },

  async regenerate() {
    if (this._regenerating) return;
    this._regenerating = true;
    const button = document.getElementById('cfRegenerateButton');
    if (button) button.disabled = true;
    try {
      const from = document.getElementById('cfMonthFrom')?.value || '';
      const to = document.getElementById('cfMonthTo')?.value || '';
      const res = await fetch('/api/cash-flow/projection/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to })
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || 'فشل إعادة الاحتساب');
      if (json.success) {
        App.showToast('تمت إعادة احتساب توقعات التدفق النقدي بنجاح', 'success');
        await this.loadProjections();
      }
    } catch (e) {
      App.showToast(e.message || 'فشل إعادة الاحتساب', 'error');
    } finally { this._regenerating = false; if (button) button.disabled = false; }
  }
};

window.ContractAlertsUI = ContractAlertsUI;
window.CashFlowUI = CashFlowUI;
