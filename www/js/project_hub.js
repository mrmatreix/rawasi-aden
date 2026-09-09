/**
 * مساحة عمل إدارة المشاريع الهندسية والمقاولات (14 متطلب شامل) - شركة رواسي عدن
 */

const ProjectHub = {
  currentProjectId: null,
  activeTab: 'contract',
  data: null,

  async init() {
    console.log('🏗️ تهيئة مساحة عمل المشروع الشاملة (Project Hub)...');
    await this.populateProjectSelect();
  },

  calcQuotationTotal() {
    const sub = Number(document.getElementById('quoModalSubtotal')?.value || 0);
    const disc = Number(document.getElementById('quoModalDiscount')?.value || 0);
    const totalEl = document.getElementById('quoModalTotal');
    if (totalEl) totalEl.value = Math.max(0, sub - disc);
  },

  calcPurchaseTotal() {
    const qty = Number(document.getElementById('projPurQty')?.value || 1);
    const price = Number(document.getElementById('projPurPrice')?.value || 0);
    const totalEl = document.getElementById('projPurTotal');
    if (totalEl) totalEl.value = qty * price;
  },

  calcLaborTotal() {
    const count = Number(document.getElementById('projLaborCount')?.value || 1);
    const rate = Number(document.getElementById('projLaborRate')?.value || 0);
    const days = Number(document.getElementById('projLaborDays')?.value || 1);
    const totalEl = document.getElementById('projLaborTotal');
    if (totalEl) totalEl.value = count * rate * days;
  },

  calcIpcNet() {
    const cum = Number(document.getElementById('ipcModalCumWork')?.value || 0);
    const prev = Number(document.getElementById('ipcModalPrevBills')?.value || 0);
    const gross = Math.max(0, cum - prev);
    const grossEl = document.getElementById('ipcModalGross');
    if (grossEl) grossEl.value = gross;
    const adv = Number(document.getElementById('ipcModalAdvDed')?.value || 0);
    const ret = Number(document.getElementById('ipcModalRetDed')?.value || 0);
    const oth = Number(document.getElementById('ipcModalOtherDed')?.value || 0);
    const netEl = document.getElementById('ipcModalNet');
    if (netEl) netEl.value = Math.max(0, gross - adv - ret - oth);
  },

  calcSettlementDue() {
    const exec = Number(document.getElementById('settleModalExec')?.value || 0);
    const paid = Number(document.getElementById('settleModalPaid')?.value || 0);
    const ret = Number(document.getElementById('settleModalRet')?.value || 0);
    const pen = Number(document.getElementById('settleModalPenalties')?.value || 0);
    const dueEl = document.getElementById('settleModalDue');
    if (dueEl) dueEl.value = Math.max(0, exec - paid + ret - pen);
  },

  async populateProjectSelect() {
    const select = document.getElementById('hubProjectSelect');
    if (!select) return;

    try {
      const res = await fetch('/api/projects');
      const json = await res.json();
      if (json.success && json.data && json.data.length > 0) {
        select.innerHTML = json.data.map(p => `
          <option value="${p.id}" ${this.currentProjectId == p.id ? 'selected' : ''}>
            ${p.code || 'PRJ'} - ${p.name} (${p.client_name || 'عميل مباشر'})
          </option>
        `).join('');

        if (!this.currentProjectId) {
          this.currentProjectId = json.data[0].id;
        }
      } else {
        select.innerHTML = `<option value="">لا توجد مشاريع مسجلة</option>`;
      }
    } catch (e) {
      console.error('Error populating project select:', e);
    }
  },

  async openProject(projectId, tab = 'contract') {
    this.currentProjectId = Number(projectId);
    this.activeTab = tab;

    // التنقل إلى شاشة مساحة عمل المشروع
    App.navigate('projectHub');

    // تحديث القائمة المنسدلة
    const select = document.getElementById('hubProjectSelect');
    if (select) select.value = this.currentProjectId;

    await this.loadProjectData();
  },

  async onProjectSelectChange(e) {
    const newId = e.target.value;
    if (newId) {
      this.currentProjectId = Number(newId);
      await this.loadProjectData();
    }
  },

  async loadProjectData() {
    if (!this.currentProjectId) return;

    try {
      App.showToast('جاري تحميل بيانات ومستندات المشروع...', 'info');
      const res = await fetch(`/api/project-hub/${this.currentProjectId}/overview`);
      const json = await res.json();

      if (json.success && json.data) {
        this.data = json.data;
        this.renderHeaderAndKPIs();
        this.updateTabCounters();
        this.switchTab(this.activeTab);
      } else {
        App.showToast(json.message || 'تعذر جلب تفاصيل المشروع', 'error');
      }
    } catch (e) {
      console.error('Error loading project hub data:', e);
      App.showToast('فشل في الاتصال بالخادم لجلب بيانات مساحة العمل', 'error');
    }
  },

  renderHeaderAndKPIs() {
    if (!this.data) return;
    const { project, stats } = this.data;
    const curr = project.currency || 'ر.ي';

    // الرأس العلوي
    const titleEl = document.getElementById('hubProjectTitle');
    const codeEl = document.getElementById('hubProjectCode');
    const clientEl = document.getElementById('hubProjectClient');
    const statusBadgeEl = document.getElementById('hubProjectStatusBadge');

    if (titleEl) titleEl.innerText = project.name;
    if (codeEl) codeEl.innerText = project.code || 'PRJ';
    if (clientEl) clientEl.innerText = `العميل / المالك: ${project.client_name || 'عميل مباشر'} | الهاتف: ${project.client_phone || 'غير مسجل'}`;
    
    if (statusBadgeEl) {
      const isComp = project.status === 'completed';
      statusBadgeEl.className = `drawing-badge-status ${isComp ? 'approved' : 'pending'}`;
      statusBadgeEl.innerText = isComp ? 'مكتمل ومسلّم ✅' : 'قيد التنفيذ ⚙️';
    }

    // شريط الـ KPIs
    const kpiContract = document.getElementById('hubKpiContractVal');
    const kpiChangeOrders = document.getElementById('hubKpiChangeOrders');
    const kpiRevisedVal = document.getElementById('hubKpiRevisedVal');
    const kpiActualCost = document.getElementById('hubKpiActualCost');
    const kpiInvoicesNet = document.getElementById('hubKpiInvoicesNet');
    const kpiProgress = document.getElementById('hubKpiProgress');

    if (kpiContract) kpiContract.innerHTML = `${App.formatNumber(stats.originalContractValue)} <small>${curr}</small>`;
    if (kpiChangeOrders) kpiChangeOrders.innerHTML = `${stats.totalApprovedChangeOrders >= 0 ? '+' : ''}${App.formatNumber(stats.totalApprovedChangeOrders)} <small>${curr}</small>`;
    if (kpiRevisedVal) kpiRevisedVal.innerHTML = `${App.formatNumber(stats.revisedContractValue)} <small>${curr}</small>`;
    if (kpiActualCost) kpiActualCost.innerHTML = `${App.formatNumber(project.actual_cost || (stats.totalPurchasesAmount + stats.totalLaborAmount))} <small>${curr}</small>`;
    if (kpiInvoicesNet) kpiInvoicesNet.innerHTML = `${App.formatNumber(stats.totalInvoicesNet)} <small>${curr}</small>`;
    if (kpiProgress) kpiProgress.innerHTML = `${project.progress_percentage || 0}%`;
  },

  updateTabCounters() {
    if (!this.data) return;
    const { drawings, boq, quotations, changeOrders, purchases, labor, invoices, dailyReports, weeklyReports, handovers, correspondence, settlement } = this.data;

    this.setCountBadge('cnt_drawings', drawings?.length || 0);
    this.setCountBadge('cnt_boq', boq?.length || 0);
    this.setCountBadge('cnt_quotations', quotations?.length || 0);
    this.setCountBadge('cnt_change_orders', changeOrders?.length || 0);
    this.setCountBadge('cnt_purchases', purchases?.length || 0);
    this.setCountBadge('cnt_labor', labor?.length || 0);
    this.setCountBadge('cnt_invoices', invoices?.length || 0);
    this.setCountBadge('cnt_daily', dailyReports?.length || 0);
    this.setCountBadge('cnt_weekly', weeklyReports?.length || 0);
    this.setCountBadge('cnt_handovers', handovers?.length || 0);
    this.setCountBadge('cnt_correspondence', correspondence?.length || 0);
    this.setCountBadge('cnt_settlement', settlement ? '1' : '0');
  },

  setCountBadge(elementId, count) {
    const el = document.getElementById(elementId);
    if (el) el.innerText = count;
  },

  switchTab(tabId) {
    this.activeTab = tabId;

    // تحديث أزرار التبويبات
    document.querySelectorAll('.hub-tab-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(`hubTabBtn_${tabId}`);
    if (activeBtn) activeBtn.classList.add('active');

    // إخفاء كافة لوحات المحتوى وإظهار اللوحة المحددة
    document.querySelectorAll('.hub-pane-view').forEach(p => p.style.display = 'none');
    const activePane = document.getElementById(`hubPane_${tabId}`);
    if (activePane) activePane.style.display = 'block';

    if (!this.data) return;

    // استدعاء دالة العرض المناسبة
    switch (tabId) {
      case 'contract': this.renderContract(); break;
      case 'drawings': this.renderDrawings(); break;
      case 'boq': this.renderBOQ(); break;
      case 'quotations': this.renderQuotations(); break;
      case 'budgets': this.renderBudgets(); break;
      case 'change-orders': this.renderChangeOrders(); break;
      case 'purchases': this.renderPurchases(); break;
      case 'labor': this.renderLabor(); break;
      case 'invoices': this.renderInvoices(); break;
      case 'daily-reports': this.renderDailyReports(); break;
      case 'weekly-reports': this.renderWeeklyReports(); break;
      case 'handovers': this.renderHandovers(); break;
      case 'correspondence': this.renderCorrespondence(); break;
      case 'settlement': this.renderSettlement(); break;
    }
  },

  // =========================================================================
  // 1. عقد المشروع (Project Contract)
  // =========================================================================
  renderContract() {
    const container = document.getElementById('hubContractContent');
    if (!container || !this.data) return;

    const { contract, project } = this.data;
    const curr = project.currency || 'ر.ي';

    if (!contract) {
      container.innerHTML = `
        <div style="text-align: center; padding: 40px 20px; background: rgba(255,255,255,0.02); border-radius: var(--radius-md); border: 1px dashed var(--border-light);">
          <div style="font-size: 2.5rem; margin-bottom: 12px;">📑</div>
          <h4 style="color: #fff; margin-bottom: 8px;">لم يتم توثيق عقد رسمي لهذا المشروع بعد</h4>
          <p style="color: var(--text-secondary); font-size: 0.86rem; margin-bottom: 18px;">يمكنك إنشاء وتوثيق عقد المشروع وشروط السداد ونطاق العمل وطباعته رسمياً.</p>
          <button class="btn btn-primary" onclick="ProjectHub.openEditContractModal()">+ إنشاء وتوثيق عقد المشروع</button>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 18px; margin-bottom: 20px;">
        <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-light); border-radius: var(--radius-md); padding: 18px;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px;">
            <div>
              <span style="font-size: 0.74rem; color: var(--gold-light); font-weight: 700;">رقم العقد: ${contract.contract_no || 'CNT'}</span>
              <h3 style="color: #fff; margin: 4px 0 0 0; font-size: 1.15rem;">${contract.title || 'عقد تنفيذ أعمال مقاولات'}</h3>
            </div>
            <span class="drawing-badge-status approved">${contract.status || 'ساري'}</span>
          </div>

          <table class="custom-table" style="margin-bottom: 16px;">
            <tbody>
              <tr>
                <td style="width: 25%; font-weight: 700; color: var(--text-secondary);">الطرف الأول (المالك):</td>
                <td style="font-weight: 800; color: #fff;">${contract.first_party || project.client_name || '-'}</td>
              </tr>
              <tr>
                <td style="font-weight: 700; color: var(--text-secondary);">الطرف الثاني (المقاول):</td>
                <td style="font-weight: 800; color: var(--gold-light);">${contract.second_party || 'شركة رواسي عدن للهندسة والمقاولات'}</td>
              </tr>
              <tr>
                <td style="font-weight: 700; color: var(--text-secondary);">تاريخ توقيع العقد:</td>
                <td>${contract.contract_date || '-'} | مدة التنفيذ: <strong>${contract.duration_days || '-'} يوماً</strong></td>
              </tr>
              <tr>
                <td style="font-weight: 700; color: var(--text-secondary);">تاريخ البدء والانتهاء:</td>
                <td>من: <strong>${contract.start_date || project.start_date || '-'}</strong> إلى: <strong>${contract.end_date || project.end_date || '-'}</strong></td>
              </tr>
            </tbody>
          </table>

          <div style="margin-bottom: 14px;">
            <h5 style="color: var(--gold-light); margin-bottom: 6px;">نطاق العمل ومسؤوليات المقاول:</h5>
            <div style="background: rgba(0,0,0,0.25); padding: 12px; border-radius: var(--radius-sm); font-size: 0.86rem; line-height: 1.6; color: #e2e8f0;">
              ${contract.scope_of_work || 'لم يتم إدخال نطاق العمل التفصيلي.'}
            </div>
          </div>

          <div>
            <h5 style="color: var(--gold-light); margin-bottom: 6px;">شروط الدفع وصرف المستحقات:</h5>
            <div style="background: rgba(0,0,0,0.25); padding: 12px; border-radius: var(--radius-sm); font-size: 0.86rem; line-height: 1.6; color: #e2e8f0;">
              ${contract.payment_terms || 'دفعات شهرية منتظمة وفق المستخلصات المعتمدة.'}
            </div>
          </div>
        </div>

        <!-- العمود المالي والشروط الجزائية -->
        <div style="display: flex; flex-direction: column; gap: 14px;">
          <div style="background: linear-gradient(135deg, rgba(212,175,55,0.12) 0%, rgba(14,28,50,0.6) 100%); border: 1px solid rgba(212,175,55,0.35); border-radius: var(--radius-md); padding: 16px;">
            <span style="font-size: 0.76rem; color: var(--gold-light);">القيمة الإجمالية للعقد</span>
            <h2 style="color: #fff; font-size: 1.45rem; margin: 4px 0 10px 0;">${App.formatNumber(contract.contract_value)} <small style="font-size:0.8rem; color:var(--gold-light)">${curr}</small></h2>
            
            <div style="display: flex; flex-direction: column; gap: 8px; font-size: 0.82rem; border-top: 1px dashed rgba(212,175,55,0.3); padding-top: 10px;">
              <div style="display: flex; justify-content: space-between;">
                <span style="color: var(--text-secondary);">الدفعة المقدمة (${contract.advance_payment_pct || 0}%):</span>
                <strong>${App.formatNumber(contract.advance_payment_amount || (contract.contract_value * (contract.advance_payment_pct || 0) / 100))} ${curr}</strong>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span style="color: var(--text-secondary);">استقطاع ضمان الأعمال:</span>
                <strong>${contract.retention_pct || 10}% من كل مستخلص</strong>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span style="color: var(--text-secondary);">غرامة التأخير اليومية:</span>
                <strong style="color: var(--accent-red);">${App.formatNumber(contract.penalty_per_day)} ${curr}/يوم</strong>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span style="color: var(--text-secondary);">الحد الأقصى للغرامة:</span>
                <strong>${contract.max_penalty_pct || 10}% من قيمة العقد</strong>
              </div>
            </div>
          </div>

          <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-light); border-radius: var(--radius-md); padding: 14px;">
            <h5 style="color: #fff; margin-bottom: 8px;">ملاحظات إضافية:</h5>
            <p style="font-size: 0.82rem; color: var(--text-secondary); margin: 0; line-height: 1.5;">${contract.notes || 'لا توجد ملاحظات تعاقدية إضافية مسجلة.'}</p>
          </div>

          <div style="display: flex; gap: 8px; margin-top: auto;">
            <button class="btn btn-primary btn-sm" style="flex: 1;" onclick="ProjectHub.printOfficialContract()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/></svg>
              <span>طباعة العقد الرسمي</span>
            </button>
            <button class="btn btn-secondary btn-sm" onclick="ProjectHub.openEditContractModal()">تعديل العقد ✏️</button>
          </div>
        </div>
      </div>
    `;
  },

  openEditContractModal() {
    if (!this.data) return;
    const { contract, project } = this.data;

    document.getElementById('cntModalProjId').value = this.currentProjectId;
    document.getElementById('cntModalNo').value = contract ? (contract.contract_no || '') : `CNT-${new Date().getFullYear()}-${String(this.currentProjectId).padStart(3, '0')}`;
    document.getElementById('cntModalTitle').value = contract ? (contract.title || '') : `عقد تنفيذ ${project.name}`;
    document.getElementById('cntModalFirstParty').value = contract ? (contract.first_party || '') : (project.client_name || '');
    document.getElementById('cntModalSecondParty').value = contract ? (contract.second_party || '') : 'شركة رواسي عدن للهندسة والمقاولات';
    document.getElementById('cntModalDate').value = contract ? (contract.contract_date || '') : (project.start_date || new Date().toISOString().split('T')[0]);
    document.getElementById('cntModalStartDate').value = contract ? (contract.start_date || '') : (project.start_date || '');
    document.getElementById('cntModalEndDate').value = contract ? (contract.end_date || '') : (project.end_date || '');
    document.getElementById('cntModalDuration').value = contract ? (contract.duration_days || 365) : 365;
    document.getElementById('cntModalValue').value = contract ? contract.contract_value : project.contract_value;
    document.getElementById('cntModalCurrency').value = (contract && contract.currency) ? contract.currency : (project.currency || 'ر.ي');
    document.getElementById('cntModalAdvPct').value = contract ? (contract.advance_payment_pct || 10) : 10;
    document.getElementById('cntModalAdvAmount').value = contract ? (contract.advance_payment_amount || 0) : ((project.contract_value || 0) * 0.1);
    document.getElementById('cntModalRetentionPct').value = contract ? (contract.retention_pct || 10) : 10;
    document.getElementById('cntModalPenaltyDay').value = contract ? (contract.penalty_per_day || 0) : 0;
    document.getElementById('cntModalScope').value = contract ? (contract.scope_of_work || '') : '';
    document.getElementById('cntModalPaymentTerms').value = contract ? (contract.payment_terms || '') : 'دفعات شهرية منتظمة وفق المستخلصات المعتمدة.';
    document.getElementById('cntModalStatus').value = contract ? (contract.status || 'ساري') : 'ساري';
    document.getElementById('cntModalNotes').value = contract ? (contract.notes || '') : '';

    App.openModal('editContractModal');
  },

  async submitContractForm(e) {
    if (e) e.preventDefault();
    try {
      const payload = {
        contract_no: document.getElementById('cntModalNo').value,
        title: document.getElementById('cntModalTitle').value,
        first_party: document.getElementById('cntModalFirstParty').value,
        second_party: document.getElementById('cntModalSecondParty').value,
        contract_date: document.getElementById('cntModalDate').value,
        start_date: document.getElementById('cntModalStartDate').value,
        end_date: document.getElementById('cntModalEndDate').value,
        duration_days: document.getElementById('cntModalDuration').value,
        contract_value: document.getElementById('cntModalValue').value,
        currency: document.getElementById('cntModalCurrency').value,
        advance_payment_pct: document.getElementById('cntModalAdvPct').value,
        advance_payment_amount: document.getElementById('cntModalAdvAmount').value,
        retention_pct: document.getElementById('cntModalRetentionPct').value,
        penalty_per_day: document.getElementById('cntModalPenaltyDay').value,
        scope_of_work: document.getElementById('cntModalScope').value,
        payment_terms: document.getElementById('cntModalPaymentTerms').value,
        status: document.getElementById('cntModalStatus').value,
        notes: document.getElementById('cntModalNotes').value
      };

      const res = await fetch(`/api/project-hub/${this.currentProjectId}/contract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();

      if (json.success) {
        App.showToast('تم حفظ وتوثيق عقد المشروع بنجاح', 'success');
        App.closeModal('editContractModal');
        await this.loadProjectData();
      } else {
        App.showToast(json.message || 'فشل في حفظ العقد', 'error');
      }
    } catch (err) {
      App.showToast('خطأ في الاتصال بالخادم أثناء حفظ العقد', 'error');
    }
  },

  // =========================================================================
  // 2. المخططات الهندسية (Engineering Drawings)
  // =========================================================================
  renderDrawings() {
    const tbody = document.getElementById('hubDrawingsTableBody');
    if (!tbody || !this.data) return;

    const drawings = this.data.drawings || [];
    if (drawings.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 30px; color: var(--text-secondary);">لا توجد مخططات هندسية مسجلة لهذا المشروع بعد.</td></tr>`;
      return;
    }

    tbody.innerHTML = drawings.map(d => {
      let statusClass = 'approved';
      if (d.status === 'معتمد بملاحظات') statusClass = 'with-notes';
      else if (d.status === 'قيد المراجعة') statusClass = 'pending';
      else if (d.status === 'مرفوض') statusClass = 'rejected';

      return `
        <tr>
          <td><strong>${d.drawing_no}</strong></td>
          <td>
            <strong>${d.title}</strong>
            ${d.file_name ? `<div style="font-size: 0.72rem; color: var(--accent-blue);">📁 ${d.file_name}</div>` : ''}
          </td>
          <td><span class="badge badge-income" style="background: rgba(56,189,248,0.15); color: var(--accent-blue);">${d.category}</span></td>
          <td>${d.scale || '1:100'} | <strong style="color:var(--gold-light)">${d.revision || 'Rev 0'}</strong></td>
          <td>
            <div>تقديم: ${d.submission_date || '-'}</div>
            <div style="font-size: 0.75rem; color: var(--text-secondary);">اعتماد: ${d.approval_date || '-'}</div>
          </td>
          <td><span class="drawing-badge-status ${statusClass}">${d.status}</span></td>
          <td>
            <div style="display: flex; gap: 4px;">
              <button class="btn btn-secondary btn-sm" onclick="ProjectHub.editDrawing(${d.id})" title="تعديل">✏️</button>
              <button class="btn btn-danger btn-sm" onclick="ProjectHub.deleteDrawing(${d.id})" title="حذف">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  },

  openNewDrawingModal() {
    document.getElementById('dwgModalForm').reset();
    document.getElementById('dwgModalId').value = '';
    document.getElementById('dwgModalDate').value = new Date().toISOString().split('T')[0];
    App.openModal('drawingModal');
  },

  editDrawing(id) {
    const d = (this.data.drawings || []).find(item => item.id == id);
    if (!d) return;

    document.getElementById('dwgModalId').value = d.id;
    document.getElementById('dwgModalNo').value = d.drawing_no;
    document.getElementById('dwgModalTitle').value = d.title;
    document.getElementById('dwgModalCategory').value = d.category;
    document.getElementById('dwgModalScale').value = d.scale || '1:100';
    document.getElementById('dwgModalRevision').value = d.revision || 'Rev 0';
    document.getElementById('dwgModalDate').value = d.submission_date || '';
    document.getElementById('dwgModalAppDate').value = d.approval_date || '';
    document.getElementById('dwgModalStatus').value = d.status || 'معتمد';
    document.getElementById('dwgModalEngineer').value = d.engineer_name || '';
    document.getElementById('dwgModalFileName').value = d.file_name || '';
    document.getElementById('dwgModalNotes').value = d.notes || '';

    App.openModal('drawingModal');
  },

  async submitDrawingForm(e) {
    if (e) e.preventDefault();
    const id = document.getElementById('dwgModalId').value;
    const payload = {
      drawing_no: document.getElementById('dwgModalNo').value,
      title: document.getElementById('dwgModalTitle').value,
      category: document.getElementById('dwgModalCategory').value,
      scale: document.getElementById('dwgModalScale').value,
      revision: document.getElementById('dwgModalRevision').value,
      submission_date: document.getElementById('dwgModalDate').value,
      approval_date: document.getElementById('dwgModalAppDate').value,
      status: document.getElementById('dwgModalStatus').value,
      engineer_name: document.getElementById('dwgModalEngineer').value,
      file_name: document.getElementById('dwgModalFileName').value,
      notes: document.getElementById('dwgModalNotes').value
    };

    const url = id 
      ? `/api/project-hub/${this.currentProjectId}/drawings/${id}`
      : `/api/project-hub/${this.currentProjectId}/drawings`;
    const method = id ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();

    if (json.success) {
      App.showToast('تم حفظ المخطط الهندسي بنجاح', 'success');
      App.closeModal('drawingModal');
      await this.loadProjectData();
    } else {
      App.showToast(json.message || 'فشل في حفظ المخطط', 'error');
    }
  },

  async deleteDrawing(id) {
    if (!confirm('هل أنت متأكد من حذف هذا المخطط؟')) return;
    const res = await fetch(`/api/project-hub/${this.currentProjectId}/drawings/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      App.showToast('تم حذف المخطط', 'info');
      await this.loadProjectData();
    }
  },

  // =========================================================================
  // 3. جدول الكميات BOQ (Bill of Quantities)
  // =========================================================================
  renderBOQ() {
    const tbody = document.getElementById('hubBoqTableBody');
    if (!tbody || !this.data) return;

    const boq = this.data.boq || [];
    const curr = this.data.project.currency || 'ر.ي';

    if (boq.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 30px; color: var(--text-secondary);">لا توجد بنود في جدول الكميات حالياً.</td></tr>`;
      return;
    }

    let totalContractVal = 0;
    tbody.innerHTML = boq.map(b => {
      totalContractVal += Number(b.total_amount) || 0;
      const progress = b.contract_qty > 0 ? Math.min(100, Math.round((b.executed_qty / b.contract_qty) * 100)) : 0;
      return `
        <tr>
          <td><strong>${b.item_no}</strong></td>
          <td>
            <strong>${b.description}</strong>
            <div style="font-size: 0.74rem; color: var(--text-secondary);">${b.category}</div>
          </td>
          <td>${b.unit}</td>
          <td><strong>${App.formatNumber(b.contract_qty)}</strong></td>
          <td style="color: var(--accent-green); font-weight: 700;">${App.formatNumber(b.executed_qty)}</td>
          <td>${App.formatNumber(b.unit_rate)} <small>${curr}</small></td>
          <td style="color: var(--gold-light); font-weight: 800;">${App.formatNumber(b.total_amount)} <small>${curr}</small></td>
          <td>
            <div style="display: flex; align-items: center; gap: 6px;">
              <div class="progress-wrap" style="flex: 1;">
                <div class="progress-bar-fill" style="width: ${progress}%;"></div>
              </div>
              <span style="font-size: 0.72rem; font-weight: 700;">${progress}%</span>
            </div>
          </td>
          <td>
            <div style="display: flex; gap: 4px;">
              <button class="btn btn-secondary btn-sm" onclick="ProjectHub.editBoqItem(${b.id})" title="تعديل">✏️</button>
              <button class="btn btn-danger btn-sm" onclick="ProjectHub.deleteBoqItem(${b.id})" title="حذف">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    }).join('') + `
      <tr style="background: rgba(212,175,55,0.08); font-weight: 800;">
        <td colspan="6" style="text-align: right; color: var(--gold-light);">إجمالي قيمة جدول الكميات BOQ:</td>
        <td colspan="3" style="color: var(--gold-light); font-size: 1.05rem;">${App.formatNumber(totalContractVal)} ${curr}</td>
      </tr>
    `;
  },

  openNewBoqModal() {
    document.getElementById('boqModalForm').reset();
    document.getElementById('boqModalId').value = '';
    App.openModal('boqItemModal');
  },

  editBoqItem(id) {
    const b = (this.data.boq || []).find(item => item.id == id);
    if (!b) return;

    document.getElementById('boqModalId').value = b.id;
    document.getElementById('boqModalNo').value = b.item_no;
    document.getElementById('boqModalDesc').value = b.description;
    document.getElementById('boqModalCategory').value = b.category;
    document.getElementById('boqModalUnit').value = b.unit;
    document.getElementById('boqModalContractQty').value = b.contract_qty;
    document.getElementById('boqModalExecutedQty').value = b.executed_qty;
    document.getElementById('boqModalRate').value = b.unit_rate;
    document.getElementById('boqModalStatus').value = b.status || 'جاري التنفيذ';
    document.getElementById('boqModalNotes').value = b.notes || '';

    App.openModal('boqItemModal');
  },

  async submitBoqForm(e) {
    if (e) e.preventDefault();
    const id = document.getElementById('boqModalId').value;
    const payload = {
      item_no: document.getElementById('boqModalNo').value,
      description: document.getElementById('boqModalDesc').value,
      category: document.getElementById('boqModalCategory').value,
      unit: document.getElementById('boqModalUnit').value,
      contract_qty: document.getElementById('boqModalContractQty').value,
      executed_qty: document.getElementById('boqModalExecutedQty').value,
      unit_rate: document.getElementById('boqModalRate').value,
      status: document.getElementById('boqModalStatus').value,
      notes: document.getElementById('boqModalNotes').value
    };

    const url = id
      ? `/api/project-hub/${this.currentProjectId}/boq/${id}`
      : `/api/project-hub/${this.currentProjectId}/boq`;
    const method = id ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();

    if (json.success) {
      App.showToast('تم حفظ بند جدول الكميات بنجاح', 'success');
      App.closeModal('boqItemModal');
      await this.loadProjectData();
    } else {
      App.showToast(json.message || 'فشل في حفظ البند', 'error');
    }
  },

  async deleteBoqItem(id) {
    if (!confirm('هل أنت متأكد من حذف هذا البند من جدول الكميات؟')) return;
    const res = await fetch(`/api/project-hub/${this.currentProjectId}/boq/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      App.showToast('تم حذف البند', 'info');
      await this.loadProjectData();
    }
  },

  // =========================================================================
  // 4. عروض الأسعار (Quotations & Price Offers)
  // =========================================================================
  renderQuotations() {
    const tbody = document.getElementById('hubQuotationsTableBody');
    if (!tbody || !this.data) return;

    const quotations = this.data.quotations || [];
    const curr = this.data.project.currency || 'ر.ي';

    if (quotations.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 30px; color: var(--text-secondary);">لا توجد عروض أسعار مسجلة لهذا المشروع.</td></tr>`;
      return;
    }

    tbody.innerHTML = quotations.map(q => {
      return `
        <tr>
          <td><strong>${q.quotation_no}</strong></td>
          <td><strong>${q.title}</strong></td>
          <td>${q.date}</td>
          <td>${q.valid_until || '-'}</td>
          <td style="color: var(--gold-light); font-weight: 800;">${App.formatNumber(q.total_amount)} <small>${curr}</small></td>
          <td><span class="drawing-badge-status ${q.status === 'معتمد' ? 'approved' : 'pending'}">${q.status}</span></td>
          <td>
            <div style="display: flex; gap: 4px;">
              <button class="btn btn-secondary btn-sm" onclick="ProjectHub.printQuotationDoc(${q.id})" title="طباعة عرض السعر">🖨️</button>
              <button class="btn btn-danger btn-sm" onclick="ProjectHub.deleteQuotation(${q.id})" title="حذف">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  },

  openNewQuotationModal() {
    document.getElementById('quoModalForm').reset();
    document.getElementById('quoModalNo').value = `QUO-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 900) + 100)}`;
    document.getElementById('quoModalDate').value = new Date().toISOString().split('T')[0];
    App.openModal('newQuotationModal');
  },

  async submitQuotationForm(e) {
    if (e) e.preventDefault();
    const payload = {
      quotation_no: document.getElementById('quoModalNo').value,
      title: document.getElementById('quoModalTitle').value,
      date: document.getElementById('quoModalDate').value,
      valid_until: document.getElementById('quoModalValidUntil').value,
      subtotal: document.getElementById('quoModalSubtotal').value,
      discount: document.getElementById('quoModalDiscount').value || 0,
      total_amount: document.getElementById('quoModalTotal').value,
      delivery_period: document.getElementById('quoModalPeriod').value,
      payment_terms: document.getElementById('quoModalPaymentTerms').value,
      status: document.getElementById('quoModalStatus').value,
      notes: document.getElementById('quoModalNotes').value
    };

    const res = await fetch(`/api/project-hub/${this.currentProjectId}/quotations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();

    if (json.success) {
      App.showToast('تم إنشاء عرض السعر بنجاح', 'success');
      App.closeModal('newQuotationModal');
      await this.loadProjectData();
    } else {
      App.showToast(json.message || 'فشل في حفظ عرض السعر', 'error');
    }
  },

  async deleteQuotation(id) {
    if (!confirm('هل تريد حذف عرض السعر؟')) return;
    const res = await fetch(`/api/project-hub/${this.currentProjectId}/quotations/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      App.showToast('تم حذف عرض السعر', 'info');
      await this.loadProjectData();
    }
  },

  // =========================================================================
  // 5. الميزانية والتكلفة المستهدفة (Budget & Target Cost)
  // =========================================================================
  renderBudgets() {
    const tbody = document.getElementById('hubBudgetsTableBody');
    if (!tbody || !this.data) return;

    const budgets = this.data.budgets || [];
    const curr = this.data.project.currency || 'ر.ي';

    if (budgets.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 30px; color: var(--text-secondary);">لا توجد مراكز ميزانية مسجلة.</td></tr>`;
      return;
    }

    let totalPlanned = 0;
    let totalActual = 0;

    tbody.innerHTML = budgets.map(b => {
      const planned = Number(b.planned_cost) || 0;
      const actual = Number(b.actual_cost) || 0;
      const variance = planned - actual;
      const isSaving = variance >= 0;
      const burnPct = planned > 0 ? Math.min(100, Math.round((actual / planned) * 100)) : 0;

      totalPlanned += planned;
      totalActual += actual;

      return `
        <tr>
          <td><strong>${b.category}</strong></td>
          <td>${App.formatNumber(planned)} <small>${curr}</small></td>
          <td style="color: ${actual > planned ? 'var(--accent-red)' : 'var(--text-primary)'}; font-weight: 700;">
            ${App.formatNumber(actual)} <small>${curr}</small>
          </td>
          <td>
            <span class="budget-variance-pill ${isSaving ? 'saving' : 'overrun'}">
              ${isSaving ? 'توفير +' : 'تجاوز -'}${App.formatNumber(Math.abs(variance))} ${curr}
            </span>
          </td>
          <td>
            <div style="display: flex; align-items: center; gap: 8px;">
              <div class="budget-progress-bar-wrap" style="flex: 1;">
                <div class="budget-progress-fill" style="width: ${burnPct}%; background: ${burnPct > 90 ? 'var(--accent-red)' : (burnPct > 60 ? 'var(--gold-primary)' : 'var(--accent-green)')};"></div>
              </div>
              <span style="font-size: 0.72rem; font-weight: 700;">${burnPct}%</span>
            </div>
          </td>
          <td>
            <div style="display: flex; gap: 4px;">
              <button class="btn btn-secondary btn-sm" onclick="ProjectHub.editBudget(${b.id})" title="تعديل">✏️</button>
              <button class="btn btn-danger btn-sm" onclick="ProjectHub.deleteBudget(${b.id})" title="حذف">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    }).join('') + `
      <tr style="background: rgba(212,175,55,0.08); font-weight: 800;">
        <td style="color: var(--gold-light);">الإجمالي العام:</td>
        <td style="color: #fff;">${App.formatNumber(totalPlanned)} ${curr}</td>
        <td style="color: ${totalActual > totalPlanned ? 'var(--accent-red)' : 'var(--accent-green)'};">${App.formatNumber(totalActual)} ${curr}</td>
        <td colspan="3" style="color: var(--gold-light);">
          ${totalPlanned >= totalActual ? `صافي الوفر المالي: +${App.formatNumber(totalPlanned - totalActual)} ${curr}` : `إجمالي العجز والتجاوز: -${App.formatNumber(totalActual - totalPlanned)} ${curr}`}
        </td>
      </tr>
    `;
  },

  openNewBudgetModal() {
    document.getElementById('budgetModalForm').reset();
    document.getElementById('budgetModalId').value = '';
    App.openModal('budgetCenterModal');
  },

  editBudget(id) {
    const b = (this.data.budgets || []).find(item => item.id == id);
    if (!b) return;

    document.getElementById('budgetModalId').value = b.id;
    document.getElementById('budgetModalCategory').value = b.category;
    document.getElementById('budgetModalPlanned').value = b.planned_cost;
    document.getElementById('budgetModalActual').value = b.actual_cost;
    document.getElementById('budgetModalNotes').value = b.notes || '';

    App.openModal('budgetCenterModal');
  },

  async submitBudgetForm(e) {
    if (e) e.preventDefault();
    const id = document.getElementById('budgetModalId').value;
    const payload = {
      category: document.getElementById('budgetModalCategory').value,
      planned_cost: document.getElementById('budgetModalPlanned').value,
      actual_cost: document.getElementById('budgetModalActual').value,
      notes: document.getElementById('budgetModalNotes').value
    };

    const url = id
      ? `/api/project-hub/${this.currentProjectId}/budgets/${id}`
      : `/api/project-hub/${this.currentProjectId}/budgets`;
    const method = id ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();

    if (json.success) {
      App.showToast('تم حفظ مركز الميزانية بنجاح', 'success');
      App.closeModal('budgetCenterModal');
      await this.loadProjectData();
    } else {
      App.showToast(json.message || 'فشل في حفظ الميزانية', 'error');
    }
  },

  async deleteBudget(id) {
    if (!confirm('هل تريد حذف مركز الميزانية هذا؟')) return;
    const res = await fetch(`/api/project-hub/${this.currentProjectId}/budgets/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      App.showToast('تم حذف البند', 'info');
      await this.loadProjectData();
    }
  },

  // =========================================================================
  // 6. أوامر التغيير والإضافيات (Change Orders)
  // =========================================================================
  renderChangeOrders() {
    const tbody = document.getElementById('hubChangeOrdersTableBody');
    if (!tbody || !this.data) return;

    const changeOrders = this.data.changeOrders || [];
    const curr = this.data.project.currency || 'ر.ي';

    if (changeOrders.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 30px; color: var(--text-secondary);">لا توجد أوامر تغيير مسجلة لهذا المشروع.</td></tr>`;
      return;
    }

    let totalAmount = 0;
    tbody.innerHTML = changeOrders.map(c => {
      totalAmount += Number(c.amount) || 0;
      return `
        <tr>
          <td><strong>${c.change_no}</strong></td>
          <td><strong>${c.title}</strong></td>
          <td><span class="badge badge-income" style="background:rgba(212,175,55,0.15); color:var(--gold-light);">${c.type}</span></td>
          <td style="color: var(--gold-light); font-weight: 800;">+${App.formatNumber(c.amount)} <small>${curr}</small></td>
          <td>+${c.time_extension_days || 0} يوم</td>
          <td>${c.reason}</td>
          <td><span class="drawing-badge-status approved">${c.status}</span></td>
          <td>
            <div style="display: flex; gap: 4px;">
              <button class="btn btn-secondary btn-sm" onclick="ProjectHub.printChangeOrderSlip(${c.id})" title="طباعة أمر التغيير">🖨️</button>
              <button class="btn btn-danger btn-sm" onclick="ProjectHub.deleteChangeOrder(${c.id})" title="حذف">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    }).join('') + `
      <tr style="background: rgba(212,175,55,0.08); font-weight: 800;">
        <td colspan="3" style="text-align: right; color: var(--gold-light);">إجمالي الأثر المالي لأوامر التغيير:</td>
        <td colspan="5" style="color: var(--gold-light); font-size: 1.05rem;">+${App.formatNumber(totalAmount)} ${curr}</td>
      </tr>
    `;
  },

  openNewChangeOrderModal() {
    document.getElementById('coModalForm').reset();
    document.getElementById('coModalNo').value = `CO-${String((this.data?.changeOrders?.length || 0) + 1).padStart(3, '0')}`;
    document.getElementById('coModalDate').value = new Date().toISOString().split('T')[0];
    App.openModal('changeOrderModal');
  },

  async submitChangeOrderForm(e) {
    if (e) e.preventDefault();
    const payload = {
      change_no: document.getElementById('coModalNo').value,
      title: document.getElementById('coModalTitle').value,
      type: document.getElementById('coModalType').value,
      request_date: document.getElementById('coModalDate').value,
      approval_date: document.getElementById('coModalAppDate').value,
      amount: document.getElementById('coModalAmount').value,
      time_extension_days: document.getElementById('coModalDays').value || 0,
      reason: document.getElementById('coModalReason').value,
      status: document.getElementById('coModalStatus').value,
      requested_by: document.getElementById('coModalRequestedBy').value,
      approved_by: document.getElementById('coModalApprovedBy').value,
      notes: document.getElementById('coModalNotes').value
    };

    const res = await fetch(`/api/project-hub/${this.currentProjectId}/change-orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();

    if (json.success) {
      App.showToast('تم توثيق أمر التغيير وتحديث قيمة العقد', 'success');
      App.closeModal('changeOrderModal');
      await this.loadProjectData();
    } else {
      App.showToast(json.message || 'فشل في حفظ أمر التغيير', 'error');
    }
  },

  async deleteChangeOrder(id) {
    if (!confirm('هل تريد حذف أمر التغيير هذا؟')) return;
    const res = await fetch(`/api/project-hub/${this.currentProjectId}/change-orders/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      App.showToast('تم حذف أمر التغيير', 'info');
      await this.loadProjectData();
    }
  },

  // =========================================================================
  // 7. مشتريات وفواتير المشروع (Project Purchases)
  // =========================================================================
  renderPurchases() {
    const tbody = document.getElementById('hubPurchasesTableBody');
    if (!tbody || !this.data) return;

    const purchases = this.data.purchases || [];
    const curr = this.data.project.currency || 'ر.ي';

    if (purchases.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 30px; color: var(--text-secondary);">لا توجد فواتير مشتريات مسجلة للمشروع.</td></tr>`;
      return;
    }

    let totalVal = 0;
    let totalPaid = 0;

    tbody.innerHTML = purchases.map(p => {
      totalVal += Number(p.total_amount) || 0;
      totalPaid += Number(p.paid_amount) || 0;
      return `
        <tr>
          <td><strong>${p.invoice_no || '-'}</strong></td>
          <td>${p.date}</td>
          <td><strong>${p.supplier_full_name || p.supplier_name || 'مورد عام'}</strong></td>
          <td>${p.item_description} (${p.quantity} ${p.unit || ''})</td>
          <td style="font-weight: 700;">${App.formatNumber(p.total_amount)} <small>${curr}</small></td>
          <td style="color: var(--accent-green); font-weight: 700;">${App.formatNumber(p.paid_amount)} <small>${curr}</small></td>
          <td><span class="drawing-badge-status ${p.payment_status === 'مدفوع' ? 'approved' : 'pending'}">${p.payment_status}</span></td>
          <td>
            <button class="btn btn-danger btn-sm" onclick="ProjectHub.deletePurchase(${p.id})" title="حذف">🗑️</button>
          </td>
        </tr>
      `;
    }).join('') + `
      <tr style="background: rgba(212,175,55,0.08); font-weight: 800;">
        <td colspan="4" style="text-align: right; color: var(--gold-light);">إجمالي فواتير المشتريات:</td>
        <td style="color: #fff;">${App.formatNumber(totalVal)} ${curr}</td>
        <td colspan="3" style="color: var(--accent-green);">المسدد: ${App.formatNumber(totalPaid)} ${curr} (المتبقي: ${App.formatNumber(totalVal - totalPaid)} ${curr})</td>
      </tr>
    `;
  },

  openNewPurchaseModal() {
    document.getElementById('projPurModalForm').reset();
    document.getElementById('projPurDate').value = new Date().toISOString().split('T')[0];

    // ملء الموردين
    const select = document.getElementById('projPurSupplier');
    if (select) {
      fetch('/api/suppliers').then(r => r.json()).then(res => {
        if (res.success) {
          select.innerHTML = `<option value="">اختر المورد...</option>` +
            res.data.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
        }
      });
    }
    App.openModal('projectPurchaseModal');
  },

  async submitProjectPurchaseForm(e) {
    if (e) e.preventDefault();
    const payload = {
      invoice_no: document.getElementById('projPurInvoiceNo').value,
      supplier_id: document.getElementById('projPurSupplier').value,
      item_description: document.getElementById('projPurDesc').value,
      quantity: document.getElementById('projPurQty').value,
      unit: document.getElementById('projPurUnit').value,
      unit_price: document.getElementById('projPurPrice').value,
      total_amount: document.getElementById('projPurTotal').value,
      paid_amount: document.getElementById('projPurPaid').value,
      payment_status: document.getElementById('projPurStatus').value,
      payment_method: document.getElementById('projPurMethod').value,
      date: document.getElementById('projPurDate').value,
      notes: document.getElementById('projPurNotes').value
    };

    const res = await fetch(`/api/project-hub/${this.currentProjectId}/purchases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();

    if (json.success) {
      App.showToast('تم تسجيل فاتورة المشتريات وتحديث تكلفة المشروع', 'success');
      App.closeModal('projectPurchaseModal');
      await this.loadProjectData();
    } else {
      App.showToast(json.message || 'فشل في حفظ الفاتورة', 'error');
    }
  },

  async deletePurchase(id) {
    if (!confirm('هل تريد حذف فاتورة المشتريات هذه؟')) return;
    const res = await fetch(`/api/project-hub/${this.currentProjectId}/purchases/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      App.showToast('تم حذف الفاتورة', 'info');
      await this.loadProjectData();
    }
  },

  // =========================================================================
  // 8. العمالة والمصروفات الميدانية (Labor & Site Expenses)
  // =========================================================================
  renderLabor() {
    const tbody = document.getElementById('hubLaborTableBody');
    if (!tbody || !this.data) return;

    const labor = this.data.labor || [];
    const curr = this.data.project.currency || 'ر.ي';

    if (labor.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 30px; color: var(--text-secondary);">لا توجد مصاريف عمالة مسجلة للمشروع.</td></tr>`;
      return;
    }

    let totalLaborVal = 0;
    tbody.innerHTML = labor.map(l => {
      totalLaborVal += Number(l.total_amount) || 0;
      return `
        <tr>
          <td>${l.date}</td>
          <td><strong>${l.worker_name_or_team}</strong></td>
          <td><span class="badge badge-income" style="background:rgba(56,189,248,0.15); color:var(--accent-blue);">${l.trade}</span></td>
          <td>${l.workers_count} عمال</td>
          <td>${App.formatNumber(l.daily_rate)} <small>${curr}</small></td>
          <td style="color: var(--accent-red); font-weight: 700;">${App.formatNumber(l.total_amount)} <small>${curr}</small></td>
          <td>${l.supervisor_name || '-'}</td>
          <td>
            <button class="btn btn-danger btn-sm" onclick="ProjectHub.deleteLabor(${l.id})" title="حذف">🗑️</button>
          </td>
        </tr>
      `;
    }).join('') + `
      <tr style="background: rgba(239,68,68,0.08); font-weight: 800;">
        <td colspan="5" style="text-align: right; color: var(--accent-red);">إجمالي أجور العمالة والمصروفات الميدانية:</td>
        <td colspan="3" style="color: var(--accent-red); font-size: 1.05rem;">${App.formatNumber(totalLaborVal)} ${curr}</td>
      </tr>
    `;
  },

  openNewLaborModal() {
    document.getElementById('projLaborModalForm').reset();
    document.getElementById('projLaborDate').value = new Date().toISOString().split('T')[0];
    App.openModal('projectLaborModal');
  },

  async submitProjectLaborForm(e) {
    if (e) e.preventDefault();
    const payload = {
      date: document.getElementById('projLaborDate').value,
      worker_name_or_team: document.getElementById('projLaborName').value,
      trade: document.getElementById('projLaborTrade').value,
      workers_count: document.getElementById('projLaborCount').value,
      daily_rate: document.getElementById('projLaborRate').value,
      days_or_hours: document.getElementById('projLaborDays').value || 1,
      total_amount: document.getElementById('projLaborTotal').value,
      expense_category: document.getElementById('projLaborCat').value,
      supervisor_name: document.getElementById('projLaborSupervisor').value,
      notes: document.getElementById('projLaborNotes').value
    };

    const res = await fetch(`/api/project-hub/${this.currentProjectId}/labor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();

    if (json.success) {
      App.showToast('تم تسجيل أجور العمالة والمصروف بنجاح', 'success');
      App.closeModal('projectLaborModal');
      await this.loadProjectData();
    } else {
      App.showToast(json.message || 'فشل في حفظ السجل', 'error');
    }
  },

  async deleteLabor(id) {
    if (!confirm('هل تريد حذف هذا السجل؟')) return;
    const res = await fetch(`/api/project-hub/${this.currentProjectId}/labor/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      App.showToast('تم حذف السجل', 'info');
      await this.loadProjectData();
    }
  },

  // =========================================================================
  // 9. المستخلصات وشهادات الدفع (Invoices & IPCs)
  // =========================================================================
  renderInvoices() {
    const tbody = document.getElementById('hubInvoicesTableBody');
    if (!tbody || !this.data) return;

    const invoices = this.data.invoices || [];
    const curr = this.data.project.currency || 'ر.ي';

    if (invoices.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 30px; color: var(--text-secondary);">لا توجد مستخلصات مسجلة للمشروع.</td></tr>`;
      return;
    }

    let totalGross = 0;
    let totalNet = 0;

    tbody.innerHTML = invoices.map(i => {
      totalGross += Number(i.current_gross_amount) || 0;
      totalNet += Number(i.net_amount) || 0;
      const totalDed = (Number(i.advance_deduction) || 0) + (Number(i.retention_deduction) || 0) + (Number(i.other_deductions) || 0);

      return `
        <tr>
          <td><strong>${i.invoice_no}</strong></td>
          <td>${i.invoice_type}</td>
          <td>${i.date}</td>
          <td>${App.formatNumber(i.cumulative_work_done)} <small>${curr}</small></td>
          <td style="font-weight: 700;">${App.formatNumber(i.current_gross_amount)} <small>${curr}</small></td>
          <td style="color: var(--accent-red);">${App.formatNumber(totalDed)} <small>${curr}</small></td>
          <td style="color: var(--accent-green); font-weight: 800; font-size: 1rem;">${App.formatNumber(i.net_amount)} <small>${curr}</small></td>
          <td><span class="drawing-badge-status approved">${i.status}</span></td>
          <td>
            <div style="display: flex; gap: 4px;">
              <button class="btn btn-secondary btn-sm" onclick="ProjectHub.printOfficialIPC(${i.id})" title="طباعة شهادة المستخلص">🖨️</button>
              <button class="btn btn-danger btn-sm" onclick="ProjectHub.deleteInvoice(${i.id})" title="حذف">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    }).join('') + `
      <tr style="background: rgba(16,185,129,0.08); font-weight: 800;">
        <td colspan="4" style="text-align: right; color: var(--accent-green);">إجمالي المستخلصات المعتمدة:</td>
        <td style="color: #fff;">${App.formatNumber(totalGross)} ${curr}</td>
        <td></td>
        <td colspan="3" style="color: var(--accent-green); font-size: 1.05rem;">صافي المستحق: ${App.formatNumber(totalNet)} ${curr}</td>
      </tr>
    `;
  },

  openNewInvoiceModal() {
    document.getElementById('ipcModalForm').reset();
    document.getElementById('ipcModalNo').value = `IPC-${String((this.data?.invoices?.length || 0) + 1).padStart(2, '0')}`;
    document.getElementById('ipcModalDate').value = new Date().toISOString().split('T')[0];
    App.openModal('newIpcModal');
  },

  async submitInvoiceForm(e) {
    if (e) e.preventDefault();
    const payload = {
      invoice_no: document.getElementById('ipcModalNo').value,
      invoice_type: document.getElementById('ipcModalType').value,
      period_from: document.getElementById('ipcModalFromDate').value,
      period_to: document.getElementById('ipcModalToDate').value,
      cumulative_work_done: document.getElementById('ipcModalCumWork').value,
      previous_bills_amount: document.getElementById('ipcModalPrevBills').value || 0,
      current_gross_amount: document.getElementById('ipcModalGross').value,
      advance_deduction: document.getElementById('ipcModalAdvDed').value || 0,
      retention_deduction: document.getElementById('ipcModalRetDed').value || 0,
      other_deductions: document.getElementById('ipcModalOtherDed').value || 0,
      net_amount: document.getElementById('ipcModalNet').value,
      status: document.getElementById('ipcModalStatus').value,
      date: document.getElementById('ipcModalDate').value,
      notes: document.getElementById('ipcModalNotes').value
    };

    const res = await fetch(`/api/project-hub/${this.currentProjectId}/invoices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();

    if (json.success) {
      App.showToast('تم إصدار واعتماد المستخلص بنجاح', 'success');
      App.closeModal('newIpcModal');
      await this.loadProjectData();
    } else {
      App.showToast(json.message || 'فشل في حفظ المستخلص', 'error');
    }
  },

  async deleteInvoice(id) {
    if (!confirm('هل تريد حذف هذا المستخلص؟')) return;
    const res = await fetch(`/api/project-hub/${this.currentProjectId}/invoices/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      App.showToast('تم حذف المستخلص', 'info');
      await this.loadProjectData();
    }
  },

  // =========================================================================
  // 10. التقارير اليومية للموقع (Daily Site Reports)
  // =========================================================================
  renderDailyReports() {
    const container = document.getElementById('hubDailyReportsList');
    if (!container || !this.data) return;

    const reports = this.data.dailyReports || [];
    if (reports.length === 0) {
      container.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--text-secondary);">لا توجد تقارير يومية مسجلة لهذا المشروع بعد.</div>`;
      return;
    }

    container.innerHTML = reports.map(r => `
      <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-light); border-radius: var(--radius-md); padding: 18px; margin-bottom: 14px;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed var(--border-light); padding-bottom: 10px; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
          <div>
            <span style="font-weight: 800; color: var(--gold-light); font-size: 1.02rem;">${r.report_no}</span>
            <span style="color: var(--text-secondary); font-size: 0.82rem; margin-right: 10px;">📅 التاريخ: <strong>${r.date}</strong></span>
          </div>
          <div style="display: flex; gap: 6px; align-items: center;">
            <span class="badge badge-income" style="background:rgba(56,189,248,0.15); color:var(--accent-blue);">👷 العمالة: ${r.manpower_count}</span>
            <span class="badge badge-income" style="background:rgba(212,175,55,0.15); color:var(--gold-light);">☀️ الطقس: ${r.weather}</span>
            <button class="btn btn-secondary btn-sm" onclick="ProjectHub.printDailyReportDoc(${r.id})" title="طباعة">🖨️</button>
            <button class="btn btn-danger btn-sm" onclick="ProjectHub.deleteDailyReport(${r.id})" title="حذف">🗑️</button>
          </div>
        </div>

        <div style="margin-bottom: 10px;">
          <h5 style="color: #fff; margin-bottom: 4px; font-size: 0.88rem;">🔨 الأعمال المنفذة خلال اليوم:</h5>
          <div style="background: rgba(0,0,0,0.25); padding: 10px; border-radius: var(--radius-sm); font-size: 0.85rem; line-height: 1.6; color: #e2e8f0;">
            ${r.work_performed}
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 0.82rem; color: var(--text-secondary);">
          <div><strong>المعدات العاملة:</strong> ${r.equipment_summary || 'معدات يدوية واعتيادية'}</div>
          <div><strong>المواد الموردة:</strong> ${r.materials_received || 'لا توجد توريدات اليوم'}</div>
          <div><strong>السلامة والجودة:</strong> ${r.safety_notes || 'مطابق لمعايير السلامة'}</div>
          <div><strong>المهندس المشرف:</strong> <strong style="color:var(--gold-light)">${r.site_engineer || 'م. الموقع'}</strong></div>
        </div>
      </div>
    `).join('');
  },

  openNewDailyReportModal() {
    document.getElementById('dailyReportModalForm').reset();
    document.getElementById('dailyModalNo').value = `DR-${new Date().getFullYear()}-${String((this.data?.dailyReports?.length || 0) + 1).padStart(3, '0')}`;
    document.getElementById('dailyModalDate').value = new Date().toISOString().split('T')[0];
    App.openModal('dailyReportModal');
  },

  async submitDailyReportForm(e) {
    if (e) e.preventDefault();
    const payload = {
      report_no: document.getElementById('dailyModalNo').value,
      date: document.getElementById('dailyModalDate').value,
      weather: document.getElementById('dailyModalWeather').value,
      manpower_count: document.getElementById('dailyModalManpower').value,
      equipment_summary: document.getElementById('dailyModalEquipment').value,
      work_performed: document.getElementById('dailyModalWork').value,
      materials_received: document.getElementById('dailyModalMaterials').value,
      safety_notes: document.getElementById('dailyModalSafety').value,
      delays_obstacles: document.getElementById('dailyModalDelays').value,
      site_engineer: document.getElementById('dailyModalEngineer').value,
      notes: document.getElementById('dailyModalNotes').value
    };

    const res = await fetch(`/api/project-hub/${this.currentProjectId}/daily-reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();

    if (json.success) {
      App.showToast('تم توثيق التقرير اليومي بنجاح', 'success');
      App.closeModal('dailyReportModal');
      await this.loadProjectData();
    } else {
      App.showToast(json.message || 'فشل في حفظ التقرير', 'error');
    }
  },

  async deleteDailyReport(id) {
    if (!confirm('هل تريد حذف هذا التقرير اليومي؟')) return;
    const res = await fetch(`/api/project-hub/${this.currentProjectId}/daily-reports/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      App.showToast('تم حذف التقرير', 'info');
      await this.loadProjectData();
    }
  },

  // =========================================================================
  // 11. التقارير الأسبوعية للموقع (Weekly Site Reports)
  // =========================================================================
  renderWeeklyReports() {
    const container = document.getElementById('hubWeeklyReportsList');
    if (!container || !this.data) return;

    const reports = this.data.weeklyReports || [];
    if (reports.length === 0) {
      container.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--text-secondary);">لا توجد تقارير أسبوعية مسجلة.</div>`;
      return;
    }

    container.innerHTML = reports.map(w => `
      <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-light); border-radius: var(--radius-md); padding: 18px; margin-bottom: 14px;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed var(--border-light); padding-bottom: 10px; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
          <div>
            <span style="font-weight: 800; color: var(--gold-light); font-size: 1.05rem;">${w.report_no} (الأسبوع ${w.week_no || '1'})</span>
            <span style="color: var(--text-secondary); font-size: 0.82rem; margin-right: 10px;">الفترة من <strong>${w.date_from}</strong> إلى <strong>${w.date_to}</strong></span>
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <span class="badge badge-income" style="background:rgba(16,185,129,0.15); color:var(--accent-green);">الإنجاز الفعلي: ${w.actual_progress_pct}%</span>
            <span class="badge badge-income" style="background:rgba(56,189,248,0.15); color:var(--accent-blue);">المخطط: ${w.planned_progress_pct}%</span>
            <button class="btn btn-secondary btn-sm" onclick="ProjectHub.printWeeklyReportDoc(${w.id})" title="طباعة">🖨️</button>
            <button class="btn btn-danger btn-sm" onclick="ProjectHub.deleteWeeklyReport(${w.id})" title="حذف">🗑️</button>
          </div>
        </div>

        <div style="margin-bottom: 10px;">
          <h5 style="color: #fff; margin-bottom: 4px; font-size: 0.88rem;">📊 ملخص إنجازات وأعمال الأسبوع:</h5>
          <div style="background: rgba(0,0,0,0.25); padding: 10px; border-radius: var(--radius-sm); font-size: 0.85rem; line-height: 1.6; color: #e2e8f0;">
            ${w.achievements_summary}
          </div>
        </div>

        <div style="margin-bottom: 10px;">
          <h5 style="color: var(--gold-light); margin-bottom: 4px; font-size: 0.88rem;">🎯 خطة العمل المستهدفة للأسبوع القادم:</h5>
          <div style="background: rgba(0,0,0,0.25); padding: 10px; border-radius: var(--radius-sm); font-size: 0.85rem; line-height: 1.6; color: #e2e8f0;">
            ${w.next_week_plan || 'متابعة الأعمال المجدولة.'}
          </div>
        </div>

        <div style="display: flex; justify-content: space-between; font-size: 0.8rem; color: var(--text-secondary); border-top: 1px dashed var(--border-light); padding-top: 8px;">
          <div>إعداد المهندس: <strong>${w.prepared_by || 'م. المشروع'}</strong></div>
          <div>اعتماد الإدارة: <strong>${w.approved_by || 'المدير العام'}</strong></div>
        </div>
      </div>
    `).join('');
  },

  openNewWeeklyReportModal() {
    document.getElementById('weeklyReportModalForm').reset();
    document.getElementById('weeklyModalNo').value = `WR-${new Date().getFullYear()}-${String((this.data?.weeklyReports?.length || 0) + 1).padStart(3, '0')}`;
    App.openModal('weeklyReportModal');
  },

  async submitWeeklyReportForm(e) {
    if (e) e.preventDefault();
    const payload = {
      report_no: document.getElementById('weeklyModalNo').value,
      week_no: document.getElementById('weeklyModalWeekNo').value,
      date_from: document.getElementById('weeklyModalFromDate').value,
      date_to: document.getElementById('weeklyModalToDate').value,
      planned_progress_pct: document.getElementById('weeklyModalPlanned').value,
      actual_progress_pct: document.getElementById('weeklyModalActual').value,
      achievements_summary: document.getElementById('weeklyModalAchievements').value,
      next_week_plan: document.getElementById('weeklyModalNextPlan').value,
      critical_issues: document.getElementById('weeklyModalIssues').value,
      prepared_by: document.getElementById('weeklyModalPreparedBy').value,
      approved_by: document.getElementById('weeklyModalApprovedBy').value,
      notes: document.getElementById('weeklyModalNotes').value
    };

    const res = await fetch(`/api/project-hub/${this.currentProjectId}/weekly-reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();

    if (json.success) {
      App.showToast('تم حفظ التقرير الأسبوعي بنجاح', 'success');
      App.closeModal('weeklyReportModal');
      await this.loadProjectData();
    } else {
      App.showToast(json.message || 'فشل في حفظ التقرير', 'error');
    }
  },

  async deleteWeeklyReport(id) {
    if (!confirm('هل تريد حذف التقرير الأسبوعي؟')) return;
    const res = await fetch(`/api/project-hub/${this.currentProjectId}/weekly-reports/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      App.showToast('تم حذف التقرير', 'info');
      await this.loadProjectData();
    }
  },

  // =========================================================================
  // 12. محاضر الاستلام والفحص الهندسي (Handover Minutes)
  // =========================================================================
  renderHandovers() {
    const tbody = document.getElementById('hubHandoversTableBody');
    if (!tbody || !this.data) return;

    const handovers = this.data.handovers || [];
    if (handovers.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 30px; color: var(--text-secondary);">لا توجد محاضر استلام مسجلة.</td></tr>`;
      return;
    }

    tbody.innerHTML = handovers.map(h => {
      let badgeClass = 'approved';
      if (h.status === 'مقبول بملاحظات') badgeClass = 'with-notes';
      else if (h.status === 'مرفوض ويعاد الفحص') badgeClass = 'rejected';

      return `
        <tr>
          <td><strong>${h.minute_no}</strong></td>
          <td><strong>${h.type}</strong></td>
          <td>${h.location_axis || '-'}</td>
          <td>${h.inspection_date}</td>
          <td><strong>${h.inspector_name}</strong></td>
          <td><span class="drawing-badge-status ${badgeClass}">${h.status}</span></td>
          <td>
            <div style="display: flex; gap: 4px;">
              <button class="btn btn-secondary btn-sm" onclick="ProjectHub.printHandoverDoc(${h.id})" title="طباعة المحضر">🖨️</button>
              <button class="btn btn-danger btn-sm" onclick="ProjectHub.deleteHandover(${h.id})" title="حذف">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  },

  openNewHandoverModal() {
    document.getElementById('handoverModalForm').reset();
    document.getElementById('handoverModalNo').value = `IR-${new Date().getFullYear()}-${String((this.data?.handovers?.length || 0) + 1).padStart(3, '0')}`;
    document.getElementById('handoverModalDate').value = new Date().toISOString().split('T')[0];
    App.openModal('handoverMinuteModal');
  },

  async submitHandoverForm(e) {
    if (e) e.preventDefault();
    const payload = {
      minute_no: document.getElementById('handoverModalNo').value,
      type: document.getElementById('handoverModalType').value,
      location_axis: document.getElementById('handoverModalLoc').value,
      inspection_date: document.getElementById('handoverModalDate').value,
      inspector_name: document.getElementById('handoverModalInspector').value,
      contractor_rep: document.getElementById('handoverModalContractor').value,
      status: document.getElementById('handoverModalStatus').value,
      punch_list: document.getElementById('handoverModalPunch').value,
      recommendations: document.getElementById('handoverModalRec').value,
      notes: document.getElementById('handoverModalNotes').value
    };

    const res = await fetch(`/api/project-hub/${this.currentProjectId}/handovers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();

    if (json.success) {
      App.showToast('تم توثيق محضر الاستلام والفحص بنجاح', 'success');
      App.closeModal('handoverMinuteModal');
      await this.loadProjectData();
    } else {
      App.showToast(json.message || 'فشل في حفظ المحضر', 'error');
    }
  },

  async deleteHandover(id) {
    if (!confirm('هل تريد حذف محضر الاستلام؟')) return;
    const res = await fetch(`/api/project-hub/${this.currentProjectId}/handovers/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      App.showToast('تم حذف المحضر', 'info');
      await this.loadProjectData();
    }
  },

  // =========================================================================
  // 13. المراسلات مع المالك والاستشاري (Correspondence)
  // =========================================================================
  renderCorrespondence() {
    const tbody = document.getElementById('hubCorrespondenceTableBody');
    if (!tbody || !this.data) return;

    const corr = this.data.correspondence || [];
    if (corr.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 30px; color: var(--text-secondary);">لا توجد مراسلات أو خطابات مسجلة.</td></tr>`;
      return;
    }

    tbody.innerHTML = corr.map(c => {
      const isOut = c.direction.includes('صادر');
      return `
        <tr>
          <td><strong>${c.ref_no}</strong></td>
          <td><span class="corr-direction-badge ${isOut ? 'outgoing' : 'incoming'}">${c.direction}</span></td>
          <td>${c.date}</td>
          <td><strong>${c.subject}</strong></td>
          <td>${c.priority || 'عادي'}</td>
          <td>${c.sender} &rarr; ${c.recipient}</td>
          <td><span class="drawing-badge-status approved">${c.response_status}</span></td>
          <td>
            <div style="display: flex; gap: 4px;">
              <button class="btn btn-secondary btn-sm" onclick="ProjectHub.printCorrespondenceDoc(${c.id})" title="طباعة الخطاب">🖨️</button>
              <button class="btn btn-danger btn-sm" onclick="ProjectHub.deleteCorrespondence(${c.id})" title="حذف">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  },

  openNewCorrespondenceModal() {
    document.getElementById('corrModalForm').reset();
    document.getElementById('corrModalDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('corrModalNo').value = `COR-OUT-${new Date().getFullYear()}-${String((this.data?.correspondence?.length || 0) + 1).padStart(3, '0')}`;
    App.openModal('correspondenceModal');
  },

  async submitCorrespondenceForm(e) {
    if (e) e.preventDefault();
    const payload = {
      ref_no: document.getElementById('corrModalNo').value,
      direction: document.getElementById('corrModalDirection').value,
      subject: document.getElementById('corrModalSubject').value,
      date: document.getElementById('corrModalDate').value,
      priority: document.getElementById('corrModalPriority').value,
      summary_body: document.getElementById('corrModalBody').value,
      required_action: document.getElementById('corrModalAction').value,
      response_status: document.getElementById('corrModalStatus').value,
      sender: document.getElementById('corrModalSender').value,
      recipient: document.getElementById('corrModalRecipient').value,
      attachment_name: document.getElementById('corrModalAttachment').value,
      notes: document.getElementById('corrModalNotes').value
    };

    const res = await fetch(`/api/project-hub/${this.currentProjectId}/correspondence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();

    if (json.success) {
      App.showToast('تم أرشفة المراسلة والخطاب بنجاح', 'success');
      App.closeModal('correspondenceModal');
      await this.loadProjectData();
    } else {
      App.showToast(json.message || 'فشل في حفظ المراسلة', 'error');
    }
  },

  async deleteCorrespondence(id) {
    if (!confirm('هل تريد حذف هذا الخطاب من الأرشيف؟')) return;
    const res = await fetch(`/api/project-hub/${this.currentProjectId}/correspondence/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      App.showToast('تم حذف الخطاب', 'info');
      await this.loadProjectData();
    }
  },

  // =========================================================================
  // 14. الحساب الختامي وتصفية المشروع (Final Settlement)
  // =========================================================================
  renderSettlement() {
    const container = document.getElementById('hubSettlementContent');
    if (!container || !this.data) return;

    const { project, stats, settlement } = this.data;
    const curr = project.currency || 'ر.ي';

    const origVal = stats.originalContractValue || 0;
    const changeOrdersVal = stats.totalApprovedChangeOrders || 0;
    const revisedVal = stats.revisedContractValue || (origVal + changeOrdersVal);
    const executedVal = (settlement && settlement.total_executed_work_val) ? settlement.total_executed_work_val : revisedVal;
    const paymentsReceived = (settlement && settlement.total_client_payments_received) ? settlement.total_client_payments_received : (stats.totalInvoicesNet || 0);
    const releasedRetention = (settlement && settlement.released_retention_val) ? settlement.released_retention_val : (origVal * 0.1);
    const penalties = (settlement && settlement.penalties_deductions_val) ? settlement.penalties_deductions_val : 0;
    const finalBalance = (settlement && settlement.final_balance_due !== undefined) ? settlement.final_balance_due : Math.max(0, (executedVal - paymentsReceived + releasedRetention - penalties));

    container.innerHTML = `
      <div class="settlement-summary-card">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(212,175,55,0.3); padding-bottom: 12px; margin-bottom: 16px;">
          <div>
            <span style="font-size: 0.76rem; color: var(--gold-light);">سند التصفية الختامية: ${settlement ? settlement.settlement_no : `SET-PRJ-${this.currentProjectId}`}</span>
            <h3 style="color: #fff; margin: 4px 0 0 0;">شهادة الحساب الختامي والمخالصة المالية والتشغيلية</h3>
          </div>
          <span class="drawing-badge-status approved">${settlement ? settlement.status : 'جاهز للاعتماد'}</span>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 20px;">
          <div>
            <h5 style="color: var(--gold-light); margin-bottom: 10px;">1. ملخص القيمة التعاقدية والتنفيذية:</h5>
            <div class="settlement-metric-row">
              <span style="color: var(--text-secondary);">قيمة العقد الأصلية:</span>
              <strong>${App.formatNumber(origVal)} ${curr}</strong>
            </div>
            <div class="settlement-metric-row">
              <span style="color: var(--text-secondary);">إجمالي أوامر التغيير المعتمدة (+):</span>
              <strong style="color: var(--gold-light);">+${App.formatNumber(changeOrdersVal)} ${curr}</strong>
            </div>
            <div class="settlement-metric-row">
              <span style="color: #fff; font-weight: 700;">القيمة التعاقدية المعدلة النهائية:</span>
              <strong style="color: var(--gold-light); font-size: 1.05rem;">${App.formatNumber(revisedVal)} ${curr}</strong>
            </div>
            <div class="settlement-metric-row">
              <span style="color: var(--text-secondary);">إجمالي قيمة الأعمال المنفذة فعلياً:</span>
              <strong style="color: var(--accent-green); font-weight: 800;">${App.formatNumber(executedVal)} ${curr}</strong>
            </div>
          </div>

          <div>
            <h5 style="color: var(--gold-light); margin-bottom: 10px;">2. المقبوضات والاستقطاعات والضمان:</h5>
            <div class="settlement-metric-row">
              <span style="color: var(--text-secondary);">إجمالي ما تم سداده من المالك (-):</span>
              <strong style="color: var(--accent-blue);">${App.formatNumber(paymentsReceived)} ${curr}</strong>
            </div>
            <div class="settlement-metric-row">
              <span style="color: var(--text-secondary);">الإفراج عن محجوز ضمان الأعمال (+):</span>
              <strong style="color: var(--accent-green);">+${App.formatNumber(releasedRetention)} ${curr}</strong>
            </div>
            <div class="settlement-metric-row">
              <span style="color: var(--text-secondary);">الغرامات والاستقطاعات الجزائية (-):</span>
              <strong style="color: var(--accent-red);">${App.formatNumber(penalties)} ${curr}</strong>
            </div>
            <div class="settlement-metric-row highlight">
              <span>صافي المستحق الختامي النهائي:</span>
              <span style="font-size: 1.25rem;">${App.formatNumber(finalBalance)} ${curr}</span>
            </div>
          </div>
        </div>

        <div style="background: rgba(0,0,0,0.3); padding: 14px; border-radius: var(--radius-sm); font-size: 0.86rem; color: #cbd5e1; line-height: 1.6; margin-bottom: 18px;">
          <strong>إقرار ومخالصة:</strong> بموجب هذه الشهادة الختامية، يقر الطرفان بانتهاء كافة الأعمال المنفذة ومطابقتها للمواصفات الهندسية المعتمدة، وتصفية كافة الالتزامات المالية والتعاقدية المتبادلة دون أي مطالبات لاحقة.
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
          <button class="btn btn-primary" onclick="ProjectHub.printFinalSettlementDoc()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/></svg>
            <span>طباعة شهادة الحساب الختامي الرسمية (PDF)</span>
          </button>
          <button class="btn btn-secondary" onclick="ProjectHub.openEditSettlementModal()">
            <span>تعديل واعتماد المخالصة ⚖️</span>
          </button>
        </div>
      </div>
    `;
  },

  openEditSettlementModal() {
    if (!this.data) return;
    const { project, stats, settlement } = this.data;
    const origVal = stats.originalContractValue || 0;
    const changeVal = stats.totalApprovedChangeOrders || 0;
    const revVal = origVal + changeVal;

    document.getElementById('settleModalNo').value = settlement ? settlement.settlement_no : `SET-PRJ-${String(this.currentProjectId).padStart(3, '0')}`;
    document.getElementById('settleModalDate').value = settlement ? settlement.date : new Date().toISOString().split('T')[0];
    document.getElementById('settleModalOrig').value = settlement ? settlement.original_contract_val : origVal;
    document.getElementById('settleModalChange').value = settlement ? settlement.approved_change_orders_val : changeVal;
    document.getElementById('settleModalRev').value = settlement ? settlement.revised_contract_val : revVal;
    document.getElementById('settleModalExec').value = settlement ? settlement.total_executed_work_val : revVal;
    document.getElementById('settleModalPaid').value = settlement ? settlement.total_client_payments_received : (stats.totalInvoicesNet || 0);
    document.getElementById('settleModalRet').value = settlement ? settlement.released_retention_val : (origVal * 0.1);
    document.getElementById('settleModalPenalties').value = settlement ? settlement.penalties_deductions_val : 0;
    document.getElementById('settleModalDue').value = settlement ? settlement.final_balance_due : (revVal - (stats.totalInvoicesNet || 0) + (origVal * 0.1));
    document.getElementById('settleModalStatus').value = settlement ? settlement.status : 'معتمد وموقع';
    document.getElementById('settleModalNotes').value = settlement ? (settlement.notes || '') : 'تمت المخالصة والتسليم النهائي للمشروع.';

    App.openModal('settlementModal');
  },

  async submitSettlementForm(e) {
    if (e) e.preventDefault();
    const payload = {
      settlement_no: document.getElementById('settleModalNo').value,
      date: document.getElementById('settleModalDate').value,
      original_contract_val: document.getElementById('settleModalOrig').value,
      approved_change_orders_val: document.getElementById('settleModalChange').value,
      revised_contract_val: document.getElementById('settleModalRev').value,
      total_executed_work_val: document.getElementById('settleModalExec').value,
      total_client_payments_received: document.getElementById('settleModalPaid').value,
      released_retention_val: document.getElementById('settleModalRet').value,
      penalties_deductions_val: document.getElementById('settleModalPenalties').value,
      final_balance_due: document.getElementById('settleModalDue').value,
      status: document.getElementById('settleModalStatus').value,
      notes: document.getElementById('settleModalNotes').value
    };

    const res = await fetch(`/api/project-hub/${this.currentProjectId}/settlement`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();

    if (json.success) {
      App.showToast('تم اعتماد المخالصة والحساب الختامي بنجاح', 'success');
      App.closeModal('settlementModal');
      await this.loadProjectData();
    } else {
      App.showToast(json.message || 'فشل في حفظ الحساب الختامي', 'error');
    }
  },

  // =========================================================================
  // دوال الطباعة الرسمية لكافة مستندات المشروع (Official Printable Documents)
  // =========================================================================
  getPrintBaseConfig(title, docRef) {
    const cfg = (typeof Settings !== 'undefined' && Settings.getPrintConfig) ? Settings.getPrintConfig() : {
      header_title: 'شركة رواسي عدن للهندسة والمقاولات',
      header_subtitle: 'عدن - الجمهورية اليمنية | هاتف: 773413937',
      header_en: 'Rawasi Aden for Engineering & Contracting',
      tax_no: 'س.ت: 102948 - ر.ض: 3004918',
      sig1: 'مهندس المشروع',
      sig2: 'الإدارة المالية',
      sig3: 'المدير العام',
      footer_notes: 'تعتبر هذه الوثيقة معتمدة ورسمية ومحمية بحقوق شركة رواسي عدن للهندسة والمقاولات'
    };

    const todayDate = new Date().toISOString().split('T')[0];
    const timeStr = new Date().toLocaleTimeString('ar-YE', { hour: '2-digit', minute: '2-digit' });
    const userName = (typeof Settings !== 'undefined' && Settings.getCurrentUserName)
      ? Settings.getCurrentUserName()
      : ((typeof Auth !== 'undefined' && Auth.currentUser) ? (Auth.currentUser.full_name || Auth.currentUser.username) : 'علوي محمد باعبيد');

    if (typeof Settings !== 'undefined' && Settings.setPrintTitle) {
      Settings.setPrintTitle(`${title} - ${docRef || ''}`);
    }

    const headerHtml = (typeof Settings !== 'undefined' && Settings.renderReportHeader)
      ? Settings.renderReportHeader(title, [
          { label: 'رقم المستند', val: docRef || 'DOC' },
          { label: 'تاريخ ووقت الطباعة', val: `${todayDate} - ${timeStr}` },
          { label: 'المستخدم المسجل بالمشروع', val: userName }
        ], cfg)
      : `<div style="text-align:center; margin-bottom:15px;"><h2 style="color:#0f2744">${cfg.header_title}</h2><h4>${title} - ${docRef}</h4><div>تاريخ ووقت الطباعة: ${todayDate} - ${timeStr} | المستخدم المسجل: ${userName}</div></div>`;

    const sigHtml = (typeof Settings !== 'undefined' && Settings.renderReportSignatures)
      ? Settings.renderReportSignatures(cfg)
      : `<div style="display:flex; justify-content:space-between; margin-top:25px;"><div>مهندس المشروع</div><div>المحاسب المالي</div><div>المدير العام</div></div>`;

    const footerHtml = (typeof Settings !== 'undefined' && Settings.renderReportFooter)
      ? Settings.renderReportFooter(cfg)
      : `<div style="text-align:center; font-size:0.75rem; color:#64748b; margin-top:15px;">${cfg.footer_notes} | المستخدم: ${userName}</div>`;

    return { cfg, headerHtml, sigHtml, footerHtml, todayDate };
  },

  printOfficialContract() {
    const printArea = document.getElementById('printArea');
    if (!printArea || !this.data || !this.data.contract) return;
    const { contract, project } = this.data;
    const { headerHtml, sigHtml, footerHtml } = this.getPrintBaseConfig('عقد تنفيذ أعمال مقاولات هندسية', contract.contract_no);
    const curr = project.currency || 'ر.ي';

    printArea.innerHTML = `
      <div class="multi-page-report-document border-classic density-medium margins-normal">
        ${headerHtml}
        <div class="report-content-body">
          <table class="official-report-table" style="margin-bottom: 16px;">
            <tr>
              <td style="font-weight: 800; width: 22%; background: #f1f5f9;">اسم المشروع:</td>
              <td style="font-weight: 800; color: #0f2744; width: 28%;">${project.name} (${project.code})</td>
              <td style="font-weight: 800; width: 22%; background: #f1f5f9;">القيمة التعاقدية:</td>
              <td style="font-weight: 800; color: #b8911c; width: 28%;">${App.formatNumber(contract.contract_value)} ${curr}</td>
            </tr>
            <tr>
              <td style="font-weight: 800; background: #f1f5f9;">الطرف الأول (المالك):</td>
              <td>${contract.first_party || project.client_name}</td>
              <td style="font-weight: 800; background: #f1f5f9;">الطرف الثاني (المقاول):</td>
              <td>${contract.second_party}</td>
            </tr>
            <tr>
              <td style="font-weight: 800; background: #f1f5f9;">مدة العقد:</td>
              <td>${contract.duration_days} يوماً (من ${contract.start_date} إلى ${contract.end_date})</td>
              <td style="font-weight: 800; background: #f1f5f9;">الدفعة المقدمة:</td>
              <td>${contract.advance_payment_pct}% (${App.formatNumber(contract.advance_payment_amount)} ${curr})</td>
            </tr>
          </table>

          <div style="font-weight: 800; color: #0f2744; font-size: 0.95rem; margin: 12px 0 6px 0; border-right: 3px solid #d4af37; padding-right: 8px;">
            البند الأول: نطاق الأعمال والتنفيذ
          </div>
          <p style="font-size: 0.88rem; line-height: 1.7; color: #334155; margin-bottom: 12px; background: #f8fafc; padding: 10px; border-radius: 4px;">
            ${contract.scope_of_work || 'تنفيذ كافة بنود الأعمال الإنشائية والمعمارية وفق المخططات المعتمدة وجدول الكميات.'}
          </p>

          <div style="font-weight: 800; color: #0f2744; font-size: 0.95rem; margin: 12px 0 6px 0; border-right: 3px solid #d4af37; padding-right: 8px;">
            البند الثاني: الشروط المالية وصرف المستخلصات
          </div>
          <p style="font-size: 0.88rem; line-height: 1.7; color: #334155; margin-bottom: 12px; background: #f8fafc; padding: 10px; border-radius: 4px;">
            ${contract.payment_terms || 'دفعات شهرية مع استقطاع 10% ضمان أعمال وغرامة تأخير يومية عند تجاوز مدة العقد.'}
          </p>
        </div>
        ${sigHtml}
        ${footerHtml}
      </div>
    `;
    window.print();
  },

  printOfficialIPC(id) {
    const printArea = document.getElementById('printArea');
    if (!printArea || !this.data) return;
    const inv = (this.data.invoices || []).find(i => i.id == id);
    if (!inv) return;

    const { project } = this.data;
    const { headerHtml, sigHtml, footerHtml } = this.getPrintBaseConfig(`شهادة مستخلص جاري للأعمال (${inv.invoice_no})`, inv.invoice_no);
    const curr = project.currency || 'ر.ي';
    const totalDed = (Number(inv.advance_deduction) || 0) + (Number(inv.retention_deduction) || 0) + (Number(inv.other_deductions) || 0);

    printArea.innerHTML = `
      <div class="multi-page-report-document border-classic density-medium margins-normal">
        ${headerHtml}
        <div class="report-content-body">
          <table class="official-report-table" style="margin-bottom: 16px;">
            <tr>
              <td style="font-weight: 800; width: 22%; background: #f1f5f9;">المشروع:</td>
              <td style="font-weight: 800; color: #0f2744;">${project.name}</td>
              <td style="font-weight: 800; width: 22%; background: #f1f5f9;">العميل / المالك:</td>
              <td>${inv.client_name || project.client_name}</td>
            </tr>
            <tr>
              <td style="font-weight: 800; background: #f1f5f9;">الفترة المحاسبية:</td>
              <td>من ${inv.period_from || '-'} إلى ${inv.period_to || '-'}</td>
              <td style="font-weight: 800; background: #f1f5f9;">تاريخ الاعتماد:</td>
              <td>${inv.date}</td>
            </tr>
          </table>

          <table class="official-report-table" style="margin-bottom: 16px;">
            <thead>
              <tr>
                <th>البيان المحاسبي والهندسي للمستخلص</th>
                <th style="text-align: left;">المبلغ (${curr})</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>إجمالي قيمة الأعمال المنفذة التراكمية حتى تاريخه:</td>
                <td style="text-align: left; font-weight: bold;">${App.formatNumber(inv.cumulative_work_done)}</td>
              </tr>
              <tr>
                <td>يخصم: إجمالي المستخلصات السابقة المصروفة:</td>
                <td style="text-align: left; color: #dc2626;">-${App.formatNumber(inv.previous_bills_amount)}</td>
              </tr>
              <tr style="background: #f8fafc; font-weight: bold;">
                <td>قيمة الأعمال المنجزة خلال هذا المستخلص (Gross Amount):</td>
                <td style="text-align: left; color: #0f2744;">${App.formatNumber(inv.current_gross_amount)}</td>
              </tr>
              <tr>
                <td>يخصم: استقطاع الدفعة المقدمة:</td>
                <td style="text-align: left; color: #dc2626;">-${App.formatNumber(inv.advance_deduction)}</td>
              </tr>
              <tr>
                <td>يخصم: استقطاع ضمان الأعمال (Retention):</td>
                <td style="text-align: left; color: #dc2626;">-${App.formatNumber(inv.retention_deduction)}</td>
              </tr>
              <tr style="background: #ecfdf5; font-weight: 900; font-size: 1.05rem;">
                <td style="color: #065f46;">صافي المبلغ المعتمد والمستحق للصرف للمقاول (Net Amount):</td>
                <td style="text-align: left; color: #059669;">${App.formatNumber(inv.net_amount)} ${curr}</td>
              </tr>
            </tbody>
          </table>
        </div>
        ${sigHtml}
        ${footerHtml}
      </div>
    `;
    window.print();
  },

  printFinalSettlementDoc() {
    const printArea = document.getElementById('printArea');
    if (!printArea || !this.data) return;

    const { project, stats, settlement } = this.data;
    const { headerHtml, sigHtml, footerHtml } = this.getPrintBaseConfig('شهادة الحساب الختامي والمخالصة النهائية للمشروع', settlement?.settlement_no || 'SET-FINAL');
    const curr = project.currency || 'ر.ي';

    const origVal = stats.originalContractValue || 0;
    const changeVal = stats.totalApprovedChangeOrders || 0;
    const revVal = origVal + changeVal;
    const executedVal = settlement?.total_executed_work_val || revVal;
    const payments = settlement?.total_client_payments_received || (stats.totalInvoicesNet || 0);
    const retention = settlement?.released_retention_val || (origVal * 0.1);
    const penalties = settlement?.penalties_deductions_val || 0;
    const finalBalance = settlement?.final_balance_due !== undefined ? settlement.final_balance_due : Math.max(0, (executedVal - payments + retention - penalties));

    printArea.innerHTML = `
      <div class="multi-page-report-document border-classic density-medium margins-normal">
        ${headerHtml}
        <div class="report-content-body">
          <div style="background: #fdfaf2; border: 1px solid #d4af37; border-radius: 6px; padding: 12px; text-align: center; margin-bottom: 16px;">
            <h3 style="color: #b8911c; margin: 0 0 4px 0;">مخالصة وتصفية ختامية نهائية للمشروع</h3>
            <p style="color: #64748b; font-size: 0.84rem; margin: 0;">كشف تصفية المستحقات المالية والأعمال المنفذة لمشروع (${project.name})</p>
          </div>

          <table class="official-report-table" style="margin-bottom: 16px;">
            <thead>
              <tr>
                <th>بيان الحساب الختامي والتصفية</th>
                <th style="text-align: left;">المبلغ (${curr})</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>قيمة العقد الأصلية المعتمدة:</td>
                <td style="text-align: left; font-weight: bold;">${App.formatNumber(origVal)}</td>
              </tr>
              <tr>
                <td>إجمالي أوامر التغيير والإضافيات المعتمدة (+):</td>
                <td style="text-align: left; color: #16a34a;">+${App.formatNumber(changeVal)}</td>
              </tr>
              <tr style="background: #f8fafc; font-weight: bold;">
                <td>القيمة التعاقدية المعدلة النهائية:</td>
                <td style="text-align: left; color: #0f2744;">${App.formatNumber(revVal)}</td>
              </tr>
              <tr>
                <td>إجمالي قيمة الأعمال المنفذة فعلياً والمسلمة:</td>
                <td style="text-align: left; font-weight: bold; color: #059669;">${App.formatNumber(executedVal)}</td>
              </tr>
              <tr>
                <td>يخصم: إجمالي الدفعات والمستخلصات المسددة من العميل (-):</td>
                <td style="text-align: left; color: #dc2626;">-${App.formatNumber(payments)}</td>
              </tr>
              <tr>
                <td>يضاف: الإفراج عن محجوز ضمان الأعمال المتبقي (+):</td>
                <td style="text-align: left; color: #16a34a;">+${App.formatNumber(retention)}</td>
              </tr>
              <tr>
                <td>يخصم: الغرامات والاستقطاعات الجزائية (-):</td>
                <td style="text-align: left; color: #dc2626;">-${App.formatNumber(penalties)}</td>
              </tr>
              <tr style="background: #fdfaf2; font-weight: 900; font-size: 1.15rem; border-top: 2px solid #d4af37;">
                <td style="color: #b8911c;">صافي الرصيد الختامي المستحق للمقاول:</td>
                <td style="text-align: left; color: #b8911c;">${App.formatNumber(finalBalance)} ${curr}</td>
              </tr>
            </tbody>
          </table>

          <div style="font-size: 0.84rem; line-height: 1.7; color: #475569; background: #f8fafc; padding: 12px; border-radius: 6px;">
            <strong>إبراء ذمة:</strong> يقر الطرفان بموجب هذا السند باستلام كافة الأعمال والمستحقات المذكورة وتعتبر هذه المخالصة نهائية ونافذة ومبرئة لذمة المقاول والمالك تماماً.
          </div>
        </div>
        ${sigHtml}
        ${footerHtml}
      </div>
    `;
    window.print();
  },

  printQuotationDoc(id) {
    const printArea = document.getElementById('printArea');
    if (!printArea || !this.data) return;
    const q = (this.data.quotations || []).find(item => item.id == id);
    if (!q) return;

    const { project } = this.data;
    const { headerHtml, sigHtml, footerHtml } = this.getPrintBaseConfig(`عرض سعر رسمي (${q.quotation_no})`, q.quotation_no);
    const curr = q.currency || 'ر.ي';

    printArea.innerHTML = `
      <div class="multi-page-report-document border-classic density-medium margins-normal">
        ${headerHtml}
        <div class="report-content-body">
          <table class="official-report-table" style="margin-bottom: 16px;">
            <tr>
              <td style="font-weight: 800; width: 20%; background: #f1f5f9;">الموضوع / المشروع:</td>
              <td style="font-weight: 800; color: #0f2744;">${q.title}</td>
              <td style="font-weight: 800; width: 20%; background: #f1f5f9;">العميل المقدم إليه:</td>
              <td>${q.client_name || project.client_name}</td>
            </tr>
            <tr>
              <td style="font-weight: 800; background: #f1f5f9;">تاريخ العرض:</td>
              <td>${q.date}</td>
              <td style="font-weight: 800; background: #f1f5f9;">مدة الصلاحية:</td>
              <td>${q.valid_until || '30 يوماً من تاريخه'}</td>
            </tr>
          </table>

          <table class="official-report-table" style="margin-bottom: 16px;">
            <thead>
              <tr>
                <th>م</th>
                <th>بيان الأعمال والمواصفات</th>
                <th>الوحدة</th>
                <th>الكمية</th>
                <th>سعر الوحدة</th>
                <th style="text-align: left;">الإجمالي (${curr})</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>1</td>
                <td>تنفيذ أعمال المقاولات والتشطيبات طبقاً للمواصفات المعمارية والهندسية</td>
                <td>مقطوع</td>
                <td>1</td>
                <td>${App.formatNumber(q.total_amount)}</td>
                <td style="text-align: left; font-weight: bold;">${App.formatNumber(q.total_amount)}</td>
              </tr>
              <tr style="background: #f8fafc; font-weight: 900;">
                <td colspan="5" style="text-align: right; color: #0f2744;">إجمالي القيمة المقترحة:</td>
                <td style="text-align: left; color: #b8911c;">${App.formatNumber(q.total_amount)} ${curr}</td>
              </tr>
            </tbody>
          </table>

          <div style="background: #f8fafc; padding: 10px; border-radius: 4px; font-size: 0.84rem; color: #475569;">
            <div><strong>شروط الدفع:</strong> ${q.payment_terms || 'دفعات مرحلية حسب التقدم'}</div>
            <div><strong>مدة التنفيذ:</strong> ${q.delivery_period || 'حسب الاتفاق التعاقدي'}</div>
          </div>
        </div>
        ${sigHtml}
        ${footerHtml}
      </div>
    `;
    window.print();
  },

  printChangeOrderSlip(id) {
    const printArea = document.getElementById('printArea');
    if (!printArea || !this.data) return;
    const c = (this.data.changeOrders || []).find(item => item.id == id);
    if (!c) return;

    const { project } = this.data;
    const { headerHtml, sigHtml, footerHtml } = this.getPrintBaseConfig(`أمر تغيير وإضافيات (${c.change_no})`, c.change_no);
    const curr = project.currency || 'ر.ي';

    printArea.innerHTML = `
      <div class="multi-page-report-document border-classic density-medium margins-normal">
        ${headerHtml}
        <div class="report-content-body">
          <table class="official-report-table" style="margin-bottom: 16px;">
            <tr>
              <td style="font-weight: 800; width: 22%; background: #f1f5f9;">المشروع:</td>
              <td style="font-weight: 800; color: #0f2744;">${project.name}</td>
              <td style="font-weight: 800; width: 22%; background: #f1f5f9;">النوع:</td>
              <td>${c.type}</td>
            </tr>
            <tr>
              <td style="font-weight: 800; background: #f1f5f9;">عنوان أمر التغيير:</td>
              <td colspan="3" style="font-weight: bold; color: #0f2744;">${c.title}</td>
            </tr>
            <tr>
              <td style="font-weight: 800; background: #f1f5f9;">الأثر المالي (+/-):</td>
              <td style="font-weight: 900; color: #b8911c;">+${App.formatNumber(c.amount)} ${curr}</td>
              <td style="font-weight: 800; background: #f1f5f9;">الأثر الزمني:</td>
              <td style="font-weight: bold;">+${c.time_extension_days || 0} يوماً تمديد</td>
            </tr>
            <tr>
              <td style="font-weight: 800; background: #f1f5f9;">السبب والمبرر الهندسي:</td>
              <td colspan="3">${c.reason} - ${c.notes || ''}</td>
            </tr>
          </table>
        </div>
        ${sigHtml}
        ${footerHtml}
      </div>
    `;
    window.print();
  },

  printDailyReportDoc(id) {
    const printArea = document.getElementById('printArea');
    if (!printArea || !this.data) return;
    const r = (this.data.dailyReports || []).find(item => item.id == id);
    if (!r) return;

    const { project } = this.data;
    const { headerHtml, sigHtml, footerHtml } = this.getPrintBaseConfig(`تقرير الموقع اليومي (${r.report_no})`, r.report_no);

    printArea.innerHTML = `
      <div class="multi-page-report-document border-classic density-medium margins-normal">
        ${headerHtml}
        <div class="report-content-body">
          <table class="official-report-table" style="margin-bottom: 16px;">
            <tr>
              <td style="font-weight: 800; width: 20%; background: #f1f5f9;">المشروع:</td>
              <td style="font-weight: 800;">${project.name}</td>
              <td style="font-weight: 800; width: 20%; background: #f1f5f9;">تاريخ التقرير:</td>
              <td>${r.date}</td>
            </tr>
            <tr>
              <td style="font-weight: 800; background: #f1f5f9;">حالة الطقس:</td>
              <td>${r.weather}</td>
              <td style="font-weight: 800; background: #f1f5f9;">عدد العمالة:</td>
              <td>${r.manpower_count} عامل</td>
            </tr>
          </table>

          <div style="font-weight: 800; color: #0f2744; font-size: 0.95rem; margin: 10px 0 4px 0; border-right: 3px solid #d4af37; padding-right: 6px;">
            تفاصيل الأعمال المنفذة في الموقع اليوم:
          </div>
          <div style="background: #f8fafc; padding: 12px; border-radius: 4px; font-size: 0.88rem; line-height: 1.7; margin-bottom: 14px;">
            ${r.work_performed}
          </div>

          <table class="official-report-table" style="margin-bottom: 14px;">
            <tr>
              <td style="font-weight: 800; width: 25%; background: #f1f5f9;">المعدات في الموقع:</td>
              <td>${r.equipment_summary || 'معدات اعتيادية'}</td>
            </tr>
            <tr>
              <td style="font-weight: 800; background: #f1f5f9;">المواد الموردة:</td>
              <td>${r.materials_received || 'لا توجد توريدات اليوم'}</td>
            </tr>
            <tr>
              <td style="font-weight: 800; background: #f1f5f9;">الأمن والسلامة:</td>
              <td>${r.safety_notes || 'التزام تام بإجراءات السلامة'}</td>
            </tr>
          </table>
        </div>
        ${sigHtml}
        ${footerHtml}
      </div>
    `;
    window.print();
  },

  printWeeklyReportDoc(id) {
    const printArea = document.getElementById('printArea');
    if (!printArea || !this.data) return;
    const w = (this.data.weeklyReports || []).find(item => item.id == id);
    if (!w) return;

    const { project } = this.data;
    const { headerHtml, sigHtml, footerHtml } = this.getPrintBaseConfig(`تقرير الإنجاز الأسبوعي (${w.report_no})`, w.report_no);

    printArea.innerHTML = `
      <div class="multi-page-report-document border-classic density-medium margins-normal">
        ${headerHtml}
        <div class="report-content-body">
          <table class="official-report-table" style="margin-bottom: 16px;">
            <tr>
              <td style="font-weight: 800; width: 20%; background: #f1f5f9;">المشروع:</td>
              <td style="font-weight: 800;">${project.name}</td>
              <td style="font-weight: 800; width: 20%; background: #f1f5f9;">الأسبوع:</td>
              <td>الأسبوع ${w.week_no} (من ${w.date_from} إلى ${w.date_to})</td>
            </tr>
            <tr>
              <td style="font-weight: 800; background: #f1f5f9;">نسبة الإنجاز المخطط:</td>
              <td><strong>${w.planned_progress_pct}%</strong></td>
              <td style="font-weight: 800; background: #f1f5f9;">نسبة الإنجاز الفعلي:</td>
              <td style="font-weight: bold; color: #059669;">${w.actual_progress_pct}%</td>
            </tr>
          </table>

          <div style="font-weight: 800; color: #0f2744; font-size: 0.95rem; margin: 10px 0 4px 0; border-right: 3px solid #d4af37; padding-right: 6px;">
            ملخص الأعمال المنجزة خلال الأسبوع:
          </div>
          <div style="background: #f8fafc; padding: 12px; border-radius: 4px; font-size: 0.88rem; line-height: 1.7; margin-bottom: 14px;">
            ${w.achievements_summary}
          </div>

          <div style="font-weight: 800; color: #0f2744; font-size: 0.95rem; margin: 10px 0 4px 0; border-right: 3px solid #2563eb; padding-right: 6px;">
            خطة العمل للأسبوع القادم:
          </div>
          <div style="background: #f8fafc; padding: 12px; border-radius: 4px; font-size: 0.88rem; line-height: 1.7; margin-bottom: 14px;">
            ${w.next_week_plan || 'متابعة الأعمال حسب الجدول الزمني.'}
          </div>
        </div>
        ${sigHtml}
        ${footerHtml}
      </div>
    `;
    window.print();
  },

  printHandoverDoc(id) {
    const printArea = document.getElementById('printArea');
    if (!printArea || !this.data) return;
    const h = (this.data.handovers || []).find(item => item.id == id);
    if (!h) return;

    const { project } = this.data;
    const { headerHtml, sigHtml, footerHtml } = this.getPrintBaseConfig(`محضر استلام وفحص أعمال (${h.minute_no})`, h.minute_no);

    printArea.innerHTML = `
      <div class="multi-page-report-document border-classic density-medium margins-normal">
        ${headerHtml}
        <div class="report-content-body">
          <table class="official-report-table" style="margin-bottom: 16px;">
            <tr>
              <td style="font-weight: 800; width: 22%; background: #f1f5f9;">المشروع:</td>
              <td style="font-weight: 800;">${project.name}</td>
              <td style="font-weight: 800; width: 22%; background: #f1f5f9;">نوع الاستلام:</td>
              <td style="font-weight: bold; color: #0f2744;">${h.type}</td>
            </tr>
            <tr>
              <td style="font-weight: 800; background: #f1f5f9;">الموقع / المحور:</td>
              <td>${h.location_axis || 'كامل الموقع'}</td>
              <td style="font-weight: 800; background: #f1f5f9;">تاريخ الفحص:</td>
              <td>${h.inspection_date}</td>
            </tr>
            <tr>
              <td style="font-weight: 800; background: #f1f5f9;">المهندس الاستشاري:</td>
              <td>${h.inspector_name}</td>
              <td style="font-weight: 800; background: #f1f5f9;">ممثل المقاول:</td>
              <td>${h.contractor_rep || 'م. المشروع'}</td>
            </tr>
            <tr>
              <td style="font-weight: 800; background: #f1f5f9;">نتيجة الفحص:</td>
              <td colspan="3" style="font-weight: 900; color: #059669;">${h.status}</td>
            </tr>
          </table>

          <div style="font-weight: 800; color: #0f2744; font-size: 0.95rem; margin: 10px 0 4px 0; border-right: 3px solid #d4af37; padding-right: 6px;">
            قائمة الملاحظات والنواقص (Punch List):
          </div>
          <div style="background: #f8fafc; padding: 12px; border-radius: 4px; font-size: 0.88rem; line-height: 1.7; margin-bottom: 14px;">
            ${h.punch_list || 'لا توجد ملاحظات، تم الاستلام بنجاح.'}
          </div>

          <div style="font-weight: 800; color: #0f2744; font-size: 0.95rem; margin: 10px 0 4px 0; border-right: 3px solid #059669; padding-right: 6px;">
            التوصيات الفنية:
          </div>
          <div style="background: #f8fafc; padding: 12px; border-radius: 4px; font-size: 0.88rem; line-height: 1.7;">
            ${h.recommendations || 'التصريح بالمتابعة واستكمال المرحلة التالية.'}
          </div>
        </div>
        ${sigHtml}
        ${footerHtml}
      </div>
    `;
    window.print();
  },

  printCorrespondenceDoc(id) {
    const printArea = document.getElementById('printArea');
    if (!printArea || !this.data) return;
    const c = (this.data.correspondence || []).find(item => item.id == id);
    if (!c) return;

    const { project } = this.data;
    const { headerHtml, sigHtml, footerHtml } = this.getPrintBaseConfig(`خطاب مراسلة رسمي (${c.ref_no})`, c.ref_no);

    printArea.innerHTML = `
      <div class="multi-page-report-document border-classic density-medium margins-normal">
        ${headerHtml}
        <div class="report-content-body">
          <table class="official-report-table" style="margin-bottom: 16px;">
            <tr>
              <td style="font-weight: 800; width: 18%; background: #f1f5f9;">المشروع:</td>
              <td>${project.name}</td>
              <td style="font-weight: 800; width: 18%; background: #f1f5f9;">التاريخ:</td>
              <td>${c.date}</td>
            </tr>
            <tr>
              <td style="font-weight: 800; background: #f1f5f9;">من (المرسل):</td>
              <td>${c.sender}</td>
              <td style="font-weight: 800; background: #f1f5f9;">إلى (المستلم):</td>
              <td>${c.recipient}</td>
            </tr>
            <tr>
              <td style="font-weight: 800; background: #f1f5f9;">الموضوع:</td>
              <td colspan="3" style="font-weight: bold; color: #0f2744;">${c.subject}</td>
            </tr>
          </table>

          <div style="font-size: 0.9rem; line-height: 1.8; color: #334155; background: #f8fafc; padding: 18px; border-radius: 6px; margin-bottom: 14px; min-height: 140px;">
            ${c.summary_body}
          </div>

          <div style="font-size: 0.82rem; color: #64748b;">
            <div><strong>الإجراء المطلوب:</strong> ${c.required_action || 'للعلم والإحاطة'}</div>
            ${c.attachment_name ? `<div><strong>المرفقات:</strong> ${c.attachment_name}</div>` : ''}
          </div>
        </div>
        ${sigHtml}
        ${footerHtml}
      </div>
    `;
    window.print();
  }
};
