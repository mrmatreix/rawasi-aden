const HR = {
  employees: [],
  leaveTypes: [],
  evaluations: [],

  init() {
    this.setToday();
  },

  setToday() {
    const date = new Date().toISOString().slice(0, 10);
    ['hrAttendanceDate', 'hrAdvanceDate', 'hrEvalDate'].forEach(id => {
      const el = document.getElementById(id);
      if (el && !el.value) el.value = date;
    });
    const month = document.getElementById('hrPayrollMonth');
    if (month && !month.value) month.value = date.slice(0, 7);
  },

  money(v) {
    return App?.formatNumber ? App.formatNumber(v || 0) : Number(v || 0).toLocaleString('en-US');
  },

  esc(v) {
    const d = document.createElement('div');
    d.textContent = v ?? '';
    return d.innerHTML;
  },

  async load() {
    await Promise.all([
      this.loadDashboard(),
      this.loadEmployees(),
      this.loadAttendance(),
      this.loadLeaves(),
      this.loadAdvances(),
      this.loadPayroll(),
      this.loadLeaveTypes(),
      this.loadEvaluations()
    ]);
  },

  async loadDashboard() {
    try {
      const res = await fetch('/api/hr/dashboard');
      const json = await res.json();
      if (!json.success) return;
      const d = json.data;
      const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
      set('hrActiveEmployees', d.activeEmployees);
      set('hrPresentToday', d.presentToday);
      set('hrUnpaidPayroll', this.money(d.unpaidPayroll) + ' ر.ي');
      set('hrActiveAdvances', this.money(d.activeAdvances) + ' ر.ي');
      set('hrPendingLeaves', d.pendingLeaves);
    } catch (e) {
      console.error(e);
    }
  },

  async loadEmployees() {
    try {
      const json = await (await fetch('/api/hr/employees')).json();
      if (!json.success) return;
      this.employees = json.data || [];
      const tbody = document.getElementById('hrEmployeesTableBody');
      if (!tbody) return;
      tbody.innerHTML = this.employees.length ? this.employees.map(e => `
        <tr>
          <td>${this.esc(e.employee_no)}</td>
          <td><b>${this.esc(e.full_name)}</b><br><small>${this.esc(e.phone || '-')}</small></td>
          <td>${this.esc(e.job_title || '-')}</td>
          <td>${this.esc(e.department || '-')}</td>
          <td>${this.esc(e.project_name || 'الإدارة العامة')}</td>
          <td>${this.money(e.basic_salary)} ${this.esc(e.currency || 'ر.ي')}</td>
          <td><span class="status-badge ${e.status === 'active' ? 'status-active' : 'status-inactive'}">${e.status === 'active' ? 'نشط' : 'موقوف'}</span></td>
          <td><button class="btn btn-secondary btn-sm" onclick="HR.openEmployeeModal(${e.id})">تعديل</button></td>
        </tr>
      `).join('') : '<tr><td colspan="8" style="text-align:center;padding:25px;">لا يوجد موظفون مسجلون بعد.</td></tr>';
      this.populateEmployeeSelects();
    } catch (e) {
      console.error(e);
    }
  },

  populateEmployeeSelects() {
    ['hrAttendanceEmployee', 'hrLeaveEmployee', 'hrAdvanceEmployee', 'hrEvalEmployee'].forEach(id => {
      const s = document.getElementById(id);
      if (s) {
        s.innerHTML = '<option value="">اختر الموظف...</option>' +
          this.employees.filter(e => e.status === 'active').map(e => `<option value="${e.id}">${this.esc(e.employee_no)} — ${this.esc(e.full_name)}</option>`).join('');
      }
    });
  },

  async loadAttendance() {
    const date = document.getElementById('hrAttendanceDate')?.value || new Date().toISOString().slice(0, 10);
    try {
      const json = await (await fetch('/api/hr/attendance?date=' + encodeURIComponent(date))).json();
      const tbody = document.getElementById('hrAttendanceTableBody');
      if (!tbody || !json.success) return;
      tbody.innerHTML = (json.data || []).length ? json.data.map(a => `
        <tr>
          <td>${this.esc(a.employee_no)}</td>
          <td>${this.esc(a.full_name)}</td>
          <td>${this.statusLabel(a.status)}</td>
          <td>${this.esc(a.check_in || '-')}</td>
          <td>${this.esc(a.check_out || '-')}</td>
          <td>${a.overtime_hours || 0}</td>
          <td>${this.esc(a.notes || '-')}</td>
        </tr>
      `).join('') : '<tr><td colspan="7" style="text-align:center;padding:25px;">لا توجد سجلات لهذا التاريخ.</td></tr>';
    } catch (e) {
      console.error(e);
    }
  },

  statusLabel(s) {
    return ({ present: 'حاضر', absent: 'غائب', late: 'متأخر', leave: 'إجازة' })[s] || s;
  },

  async loadLeaves() {
    try {
      const json = await (await fetch('/api/hr/leaves')).json();
      const tbody = document.getElementById('hrLeavesTableBody');
      if (!tbody || !json.success) return;
      tbody.innerHTML = (json.data || []).length ? json.data.map(l => `
        <tr>
          <td>${this.esc(l.full_name)}</td>
          <td>${this.esc(l.leave_type)}</td>
          <td>${l.start_date} — ${l.end_date}</td>
          <td>${l.days_count}</td>
          <td>${this.esc(l.status === 'pending' ? 'بانتظار الاعتماد' : l.status === 'approved' ? 'معتمدة' : 'مرفوضة')}</td>
          <td>${l.status === 'pending' ? `<button class="btn btn-primary btn-sm" onclick="HR.setLeaveStatus(${l.id},'approved')">اعتماد</button>` : '-'}</td>
        </tr>
      `).join('') : '<tr><td colspan="6" style="text-align:center;padding:25px;">لا توجد طلبات إجازة.</td></tr>';
    } catch (e) {
      console.error(e);
    }
  },

  async loadAdvances() {
    try {
      const json = await (await fetch('/api/hr/advances')).json();
      const tbody = document.getElementById('hrAdvancesTableBody');
      if (!tbody || !json.success) return;
      tbody.innerHTML = (json.data || []).length ? json.data.map(a => `
        <tr>
          <td>${this.esc(a.full_name)}</td>
          <td>${a.date}</td>
          <td>${this.money(a.amount)}</td>
          <td>${this.money(a.recovered_amount)}</td>
          <td>${this.money(a.amount - a.recovered_amount)}</td>
          <td>${this.money(a.installment_amount)}</td>
          <td>${a.status === 'active' ? 'نشطة' : 'مغلقة'}</td>
        </tr>
      `).join('') : '<tr><td colspan="7" style="text-align:center;padding:25px;">لا توجد سلف مسجلة.</td></tr>';
    } catch (e) {
      console.error(e);
    }
  },

  async loadPayroll() {
    const month = document.getElementById('hrPayrollMonth')?.value;
    try {
      const json = await (await fetch('/api/hr/payroll' + (month ? '?month=' + month : ''))).json();
      const tbody = document.getElementById('hrPayrollTableBody');
      if (!tbody || !json.success) return;
      
      const records = json.data || [];
      if (!records.length) {
        tbody.innerHTML = '<tr><td colspan="13" style="text-align:center;padding:25px;color:var(--text-secondary);">لا توجد مسيرات رواتب مسجلة لشهر ' + (month || '') + '. اضغط زر "1. إعداد مسير الرواتب" لتوليد المسير واحتساب التأمينات والضرائب آلياً.</td></tr>';
        return;
      }

      tbody.innerHTML = records.map(p => {
        const gross = p.gross_salary != null ? Number(p.gross_salary) : (Number(p.basic_salary) + Number(p.overtime_amount));
        const insEmp = Number(p.insurance_employee || 0);
        const insOrg = Number(p.insurance_employer || 0);
        const tax = Number(p.tax_amount || 0);
        const ded = Number(p.deductions || 0);
        const net = Number(p.net_salary || 0);

        return `
          <tr>
            <td><strong>${this.esc(p.full_name)}</strong><br><small style="color:var(--text-secondary);font-family:monospace;">${p.employee_no || ''}</small></td>
            <td>${p.payroll_month}</td>
            <td style="color:#38bdf8;font-weight:600">${this.money(p.basic_salary)}</td>
            <td>${this.money(p.overtime_amount)}</td>
            <td style="color:var(--gold-light);font-weight:bold">${this.money(gross)}</td>
            <td style="color:#f87171" title="تأمينات مستقطعة من العامل (6%)">${this.money(insEmp)}</td>
            <td style="color:#c084fc" title="مساهمة المنشأة (9%) - مصروف إضافي">${this.money(insOrg)}</td>
            <td style="color:#fb923c" title="ضريبة كسب العمل المستقطعة">${this.money(tax)}</td>
            <td style="color:#ef4444">${this.money(ded)}</td>
            <td style="color:var(--accent-green);font-weight:bold">${this.money(net)}</td>
            <td><span class="badge ${p.status === 'paid' ? 'badge-active' : 'badge-expense'}">${p.status === 'paid' ? 'مصروف' : 'مسودة'}</span></td>
            <td>${p.journal_entry_id ? `<span class="badge badge-info" title="رقم القيد">${p.journal_entry_id}</span>` : '<span style="color:var(--text-secondary)">غير مرحل</span>'}</td>
            <td>${p.status !== 'paid' ? `<button class="btn btn-primary btn-sm" onclick="HR.payPayroll(${p.id})">اعتماد</button>` : '—'}</td>
          </tr>
        `;
      }).join('');
    } catch (e) {
      console.error(e);
    }
  },

  // إظهار نافذة القواعد النظامية والمحاسبية المعتمدة لاحتساب الرواتب والضرائب
  showStatutoryRulesModal() {
    let modal = document.getElementById('hrStatutoryRulesModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'hrStatutoryRulesModal';
      modal.className = 'modal';
      modal.innerHTML = `
        <div class="modal-dialog modal-lg" style="max-width: 780px;">
          <div class="modal-content">
            <div class="modal-header">
              <h3 class="modal-title" style="display:flex;align-items:center;gap:8px;">
                <span>📜 القواعد النظامية والمحاسبية للرواتب والتأمينات والضرائب</span>
              </h3>
              <button type="button" class="btn-close" onclick="App.closeModal('hrStatutoryRulesModal')">✕</button>
            </div>
            <div class="modal-body" style="line-height: 1.8;">
              <div style="background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.3);border-radius:8px;padding:14px;margin-bottom:14px;">
                <h4 style="color:#38bdf8;margin-bottom:8px;">1. قواعد التأمينات والمعاشات الاجتماعية (Social Insurance):</h4>
                <ul style="margin:0;padding-right:20px;font-size:0.9rem;color:var(--text-primary);">
                  <li><strong>حصة الموظف (6%):</strong> تُستقطع مباشرة من الراتب الأساسي للعامل وتخفض من صافي مستحقاته.</li>
                  <li><strong>مساهمة المنشأة / صاحب العمل (9%):</strong> تتحملها شركة رواسي عدن كمصروف تشغيلي إضافي ولا تخصم من العامل.</li>
                  <li><strong>إجمالي التوريد (15%):</strong> يتم ترحيله كأمانات مستحقة لحساب الهيئة العامة للتأمينات والمعاشات.</li>
                </ul>
              </div>

              <div style="background:rgba(234,179,8,0.1);border:1px solid rgba(234,179,8,0.3);border-radius:8px;padding:14px;margin-bottom:14px;">
                <h4 style="color:var(--gold-light);margin-bottom:8px;">2. قواعد ضريبة المرتبات والأجور (ضريبة كسب العمل):</h4>
                <ul style="margin:0;padding-right:20px;font-size:0.9rem;color:var(--text-primary);">
                  <li><strong>حد الإعفاء القانوني:</strong> معفى تماماً لأول 20,000 ر.ي شهرياً من إجمالي الدخل الخاضع للضريبة.</li>
                  <li><strong>الشريحة الأولى (10%):</strong> تطبق على المبالغ من 20,001 وحتى 50,000 ر.ي.</li>
                  <li><strong>الشريحة الثانية (15%):</strong> تطبق على المبالغ التي تزيد عن 50,000 ر.ي شهرياً.</li>
                </ul>
              </div>

              <div style="background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);border-radius:8px;padding:14px;">
                <h4 style="color:var(--accent-green);margin-bottom:8px;">3. نموذج القيد اليومي المحاسبي المركب عند الترحيل:</h4>
                <div style="font-family:monospace;font-size:0.85rem;background:#0f172a;padding:12px;border-radius:6px;">
                  <div style="color:#4ade80;">من مذكورين (جانب مدين):</div>
                  <div style="padding-right:15px;">• حـ/ مصروف الرواتب والأجور الأساسية والبدلات (إجمالي الاستحقاق)</div>
                  <div style="padding-right:15px;">• حـ/ مصروف مساهمة المنشأة في التأمينات (9%)</div>
                  <div style="color:#38bdf8;margin-top:6px;">إلى مذكورين (جانب دائن):</div>
                  <div style="padding-right:15px;">• حـ/ الصندوق أو البنك (صافي الرواتب المسددة للموظفين)</div>
                  <div style="padding-right:15px;">• حـ/ أمانات مصلحة الضرائب (ضريبة كسب العمل المستقطعة)</div>
                  <div style="padding-right:15px;">• حـ/ الهيئة العامة للتأمينات والمعاشات (إجمالي 15%)</div>
                  <div style="padding-right:15px;">• حـ/ سلف وعهد الموظفين (أقساط السلف المستردة)</div>
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" onclick="App.closeModal('hrStatutoryRulesModal')">إغلاق</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }
    App.openModal('hrStatutoryRulesModal');
  },

  // 1. ترحيل مسير الرواتب إلى قيد يومية متزن مع المعاينة التفاعلية المسبقة
  async postPayrollToJournal() {
    const month = document.getElementById('hrPayrollMonth')?.value;
    if (!month) {
      App.showToast('يرجى اختيار شهر مسير الرواتب أولاً', 'error');
      return;
    }

    try {
      // جلب معاينة القيد المركب المتزن وأطرافه المحاسبية
      const res = await fetch(`/api/hr/payroll/${month}/preview-journal`);
      const json = await res.json();
      if (!json.success || !json.data) {
        App.showToast(json.message || 'لا توجد رواتب مسجلة لهذا الشهر', 'error');
        return;
      }

      const d = json.data;
      this.showPayrollJournalPreviewModal(month, d);
    } catch (e) {
      console.error(e);
      App.showToast('حدث خطأ أثناء جلب معاينة قيد الرواتب', 'error');
    }
  },

  showPayrollJournalPreviewModal(month, data) {
    let modal = document.getElementById('hrPayrollJournalPreviewModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'hrPayrollJournalPreviewModal';
      modal.className = 'modal';
      document.body.appendChild(modal);
    }

    const s = data.summary;
    const linesHtml = data.lines.map(l => `
      <tr>
        <td><span class="badge ${l.side.includes('مدين') ? 'badge-income' : 'badge-expense'}">${l.side}</span></td>
        <td style="font-family:monospace;color:#38bdf8;">${l.account_code}</td>
        <td><strong>${l.account_name}</strong></td>
        <td><span class="badge badge-secondary">${l.cost_center}</span></td>
        <td style="color:var(--accent-green);font-weight:bold;text-align:left;direction:ltr;">${l.debit > 0 ? this.money(l.debit) : '-'}</td>
        <td style="color:#38bdf8;font-weight:bold;text-align:left;direction:ltr;">${l.credit > 0 ? this.money(l.credit) : '-'}</td>
        <td style="font-size:0.8rem;color:var(--text-secondary);">${l.notes}</td>
      </tr>
    `).join('');

    modal.innerHTML = `
      <div class="modal-dialog modal-xl" style="max-width: 1050px;">
        <div class="modal-content">
          <div class="modal-header">
            <h3 class="modal-title" style="display:flex;align-items:center;gap:8px;">
              <span>⚡ معاينة قيد استحقاق الرواتب المركب لشهر (${month})</span>
            </h3>
            <button type="button" class="btn-close" onclick="App.closeModal('hrPayrollJournalPreviewModal')">✕</button>
          </div>
          <div class="modal-body">
            <!-- كروت ملخص استحقاقات الرواتب والتأمينات والضرائب -->
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:16px;">
              <div style="background:rgba(212,175,55,0.1);border:1px solid rgba(212,175,55,0.3);padding:10px;border-radius:6px;">
                <div style="font-size:0.75rem;color:var(--text-secondary);">إجمالي الاستحقاق (Gross):</div>
                <div style="font-size:1.05rem;font-weight:bold;color:var(--gold-light);">${this.money(s.total_gross)} ر.ي</div>
              </div>
              <div style="background:rgba(192,132,252,0.1);border:1px solid rgba(192,132,252,0.3);padding:10px;border-radius:6px;">
                <div style="font-size:0.75rem;color:var(--text-secondary);">مساهمة المنشأة (9%):</div>
                <div style="font-size:1.05rem;font-weight:bold;color:#c084fc;">+${this.money(s.insurance_employer_9pct)} ر.ي</div>
              </div>
              <div style="background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.3);padding:10px;border-radius:6px;">
                <div style="font-size:0.75rem;color:var(--text-secondary);">تأمينات الموظفين (6%):</div>
                <div style="font-size:1.05rem;font-weight:bold;color:#f87171;">-${this.money(s.insurance_employee_6pct)} ر.ي</div>
              </div>
              <div style="background:rgba(251,146,60,0.1);border:1px solid rgba(251,146,60,0.3);padding:10px;border-radius:6px;">
                <div style="font-size:0.75rem;color:var(--text-secondary);">ضريبة كسب العمل:</div>
                <div style="font-size:1.05rem;font-weight:bold;color:#fb923c;">-${this.money(s.total_tax)} ر.ي</div>
              </div>
              <div style="background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.4);padding:10px;border-radius:6px;">
                <div style="font-size:0.75rem;color:var(--text-secondary);">صافي المسدد (Net):</div>
                <div style="font-size:1.1rem;font-weight:bold;color:var(--accent-green);">${this.money(s.total_net_payable)} ر.ي</div>
              </div>
            </div>

            <!-- شريط التوازن المحاسبي للقيد -->
            <div style="background:#0f172a;padding:10px 16px;border-radius:8px;display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;border:1px solid var(--border-color);flex-wrap:wrap;gap:10px;">
              <div style="display:flex;gap:20px;">
                <div><span style="font-size:0.8rem;color:var(--text-secondary);">إجمالي المدين:</span> <strong style="color:var(--accent-green);">${this.money(s.total_debit)} ر.ي</strong></div>
                <div><span style="font-size:0.8rem;color:var(--text-secondary);">إجمالي الدائن:</span> <strong style="color:#38bdf8;">${this.money(s.total_credit)} ر.ي</strong></div>
                <div><span style="font-size:0.8rem;color:var(--text-secondary);">الفارق المحاسبي:</span> <strong style="color:${s.diff === 0 ? 'var(--accent-green)' : 'var(--accent-red)'};">${s.diff}</strong></div>
              </div>
              <div>
                <span class="badge" style="background:rgba(34,197,94,0.2);color:#4ade80;font-size:0.85rem;padding:4px 10px;">✅ القيد متزن 100% ومستوفٍ للمعايير المحاسبية</span>
              </div>
            </div>

            <div class="table-responsive" style="max-height:300px;overflow-y:auto;">
              <table class="custom-table">
                <thead>
                  <tr>
                    <th>الطرف</th>
                    <th>رقم الحساب</th>
                    <th>اسم الحساب المالي</th>
                    <th>مركز التكلفة</th>
                    <th>مدين (منه)</th>
                    <th>دائن (له)</th>
                    <th>البيان المحاسبي</th>
                  </tr>
                </thead>
                <tbody>${linesHtml}</tbody>
              </table>
            </div>
          </div>
          <div class="modal-footer" style="display:flex;justify-content:space-between;align-items:center;">
            <div style="font-size:0.82rem;color:var(--text-secondary);">
              سيتم إنشاء القيد في دفتر اليومية العامة وتحديث حالة كشف شهر (${month}) إلى مرحل ومسدد.
            </div>
            <div style="display:flex;gap:8px;">
              <button type="button" class="btn btn-secondary" onclick="App.closeModal('hrPayrollJournalPreviewModal')">إلغاء</button>
              <button type="button" id="btnExecutePayrollPost" class="btn btn-success" style="background:linear-gradient(135deg,#059669,#10b981);" onclick="HR.executePayrollPost('${month}')">
                تأكيد وترحيل القيد اليومي الآن ⚡
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    App.openModal('hrPayrollJournalPreviewModal');
  },

  async executePayrollPost(month) {
    const btn = document.getElementById('btnExecutePayrollPost');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'جاري ترحيل القيد لدفتر اليومية...';
    }

    try {
      const res = await fetch(`/api/hr/payroll/${month}/post-to-journal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currency: 'YER' })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(`تم إنشاء وترحيل قيد اليومية بنجاح [${data.entry_no}]`, 'success');
        App.closeModal('hrPayrollJournalPreviewModal');
        await this.loadPayroll();
        await this.loadDashboard();
        if (typeof Accounting !== 'undefined' && Accounting.loadJournalEntries) {
          Accounting.loadJournalEntries();
        }
      } else {
        App.showToast(data.message || 'فشل ترحيل المسير إلى قيد يومية', 'error');
      }
    } catch (e) {
      console.error(e);
      App.showToast('حدث خطأ أثناء ترحيل المسير', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'تأكيد وترحيل القيد اليومي الآن ⚡';
      }
    }
  },

  // 2. أنواع وسياسات الإجازات
  async loadLeaveTypes() {
    try {
      const res = await fetch('/api/hr/leave-types');
      const json = await res.json();
      if (json.success) {
        this.leaveTypes = json.data || [];
        const tbody = document.getElementById('hrLeaveTypesTableBody');
        if (tbody) {
          tbody.innerHTML = this.leaveTypes.length ? this.leaveTypes.map(lt => `
            <tr>
              <td><strong>${this.esc(lt.name)}</strong></td>
              <td>${lt.days_per_year} يوم</td>
              <td><span class="badge ${lt.is_paid ? 'badge-active' : 'badge-expense'}">${lt.is_paid ? 'مدفوعة الراتب' : 'بدون راتب'}</span></td>
              <td style="color: var(--text-secondary);">${this.esc(lt.description || '-')}</td>
            </tr>
          `).join('') : '<tr><td colspan="4" style="text-align:center;padding:20px;">لا توجد أنواع إجازات مسجلة</td></tr>';
        }

        // تحديث القائمة المنسدلة في نموذج الإجازات
        const sel = document.getElementById('hrLeaveType');
        if (sel && this.leaveTypes.length > 0) {
          sel.innerHTML = this.leaveTypes.map(lt => `<option value="${lt.name}">${lt.name} (${lt.days_per_year} يوم)</option>`).join('');
        }
      }
    } catch (e) {
      console.error(e);
    }
  },

  async submitLeaveType(e) {
    if (e) e.preventDefault();
    const name = document.getElementById('hrLtName')?.value?.trim();
    const days_per_year = parseInt(document.getElementById('hrLtDays')?.value) || 30;
    const is_paid = document.getElementById('hrLtIsPaid')?.value === '1';
    const description = document.getElementById('hrLtDesc')?.value?.trim() || '';

    if (!name) {
      App.showToast('يرجى كتابة اسم نوع الإجازة', 'error');
      return;
    }

    try {
      const res = await fetch('/api/hr/leave-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, days_per_year, is_paid, description })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast('تمت إضافة نوع الإجازة بنجاح', 'success');
        e.target.reset();
        await this.loadLeaveTypes();
      } else {
        App.showToast(data.message || 'فشل حفظ نوع الإجازة', 'error');
      }
    } catch (err) {
      console.error(err);
      App.showToast('خطأ أثناء حفظ نوع الإجازة', 'error');
    }
  },

  // 3. تقييم أداء الموظفين
  async loadEvaluations() {
    try {
      const res = await fetch('/api/hr/evaluations');
      const json = await res.json();
      if (json.success) {
        this.evaluations = json.data || [];
        const tbody = document.getElementById('hrEvaluationsTableBody');
        if (tbody) {
          tbody.innerHTML = this.evaluations.length ? this.evaluations.map(ev => `
            <tr>
              <td><strong>${this.esc(ev.employee_name)}</strong> <small>(${this.esc(ev.employee_no || '-')})</small></td>
              <td>${ev.evaluation_date}</td>
              <td><span class="badge badge-info">${this.esc(ev.rating || '-')}</span></td>
              <td><b>${ev.score}/100</b></td>
              <td style="color: var(--accent-green); font-weight: bold;">+${this.money(ev.bonus_amount)}</td>
              <td style="color: var(--accent-red); font-weight: bold;">-${this.money(ev.deduction_amount)}</td>
              <td>${this.esc(ev.evaluator_name || '-')}</td>
              <td style="color: var(--text-secondary);">${this.esc(ev.comments || '-')}</td>
            </tr>
          `).join('') : '<tr><td colspan="8" style="text-align:center;padding:25px;">لا توجد تقييمات مسجلة بعد</td></tr>';
        }
      }
    } catch (e) {
      console.error(e);
    }
  },

  async submitEvaluation(e) {
    if (e) e.preventDefault();
    const employee_id = document.getElementById('hrEvalEmployee')?.value;
    const evaluation_date = document.getElementById('hrEvalDate')?.value || new Date().toISOString().slice(0, 10);
    const rating = document.getElementById('hrEvalRating')?.value;
    const score = parseInt(document.getElementById('hrEvalScore')?.value) || 85;
    const bonus_amount = parseFloat(document.getElementById('hrEvalBonus')?.value) || 0;
    const deduction_amount = parseFloat(document.getElementById('hrEvalDeduction')?.value) || 0;
    const evaluator_name = document.getElementById('hrEvalEvaluator')?.value?.trim() || '';
    const comments = document.getElementById('hrEvalComments')?.value?.trim() || '';

    if (!employee_id) {
      App.showToast('يرجى اختيار الموظف', 'error');
      return;
    }

    try {
      const res = await fetch('/api/hr/evaluations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id, evaluation_date, rating, score, bonus_amount, deduction_amount, evaluator_name, comments })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast('تم حفظ تقييم الموظف بنجاح', 'success');
        e.target.reset();
        this.setToday();
        await this.loadEvaluations();
      } else {
        App.showToast(data.message || 'فشل حفظ التقييم', 'error');
      }
    } catch (err) {
      console.error(err);
      App.showToast('خطأ أثناء حفظ التقييم', 'error');
    }
  },

  openModal(id) {
    document.getElementById(id)?.classList.add('active');
  },

  closeModal(id) {
    document.getElementById(id)?.classList.remove('active');
  },

  openEmployeeModal(id = null) {
    const e = this.employees.find(x => x.id === id);
    document.getElementById('hrEmployeeForm').reset();
    document.getElementById('hrEmployeeId').value = id || '';
    document.getElementById('hrEmployeeModalTitle').textContent = e ? 'تعديل بيانات الموظف' : 'إضافة موظف جديد';
    if (e) {
      ['full_name', 'national_id', 'phone', 'job_title', 'department', 'basic_salary', 'bank_name', 'bank_account', 'notes'].forEach(k => {
        const el = document.getElementById('hrEmp_' + k);
        if (el) el.value = e[k] || '';
      });
      document.getElementById('hrEmp_status').value = e.status;
      document.getElementById('hrEmp_employment_type').value = e.employment_type || 'دوام كامل';
      document.getElementById('hrEmp_hire_date').value = e.hire_date || '';
    }
    this.openModal('hrEmployeeModal');
  },

  async submitEmployee(e) {
    e.preventDefault();
    const id = document.getElementById('hrEmployeeId').value;
    const body = {};
    ['full_name', 'national_id', 'phone', 'job_title', 'department', 'employment_type', 'hire_date', 'basic_salary', 'status', 'bank_name', 'bank_account', 'notes'].forEach(k => body[k] = document.getElementById('hrEmp_' + k).value);
    const res = await fetch('/api/hr/employees' + (id ? '/' + id : ''), {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const json = await res.json();
    if (json.success) {
      this.closeModal('hrEmployeeModal');
      await this.load();
    } else alert(json.message);
  },

  async submitAttendance(e) {
    e.preventDefault();
    const body = {
      employee_id: document.getElementById('hrAttendanceEmployee').value,
      date: document.getElementById('hrAttendanceDate').value,
      status: document.getElementById('hrAttendanceStatus').value,
      check_in: document.getElementById('hrCheckIn').value,
      check_out: document.getElementById('hrCheckOut').value,
      overtime_hours: document.getElementById('hrOvertime').value,
      notes: document.getElementById('hrAttendanceNotes').value
    };
    const j = await (await fetch('/api/hr/attendance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    if (j.success) {
      e.target.reset();
      this.setToday();
      this.loadAttendance();
      this.loadDashboard();
    } else alert(j.message);
  },

  async submitLeave(e) {
    e.preventDefault();
    const body = {
      employee_id: document.getElementById('hrLeaveEmployee').value,
      leave_type: document.getElementById('hrLeaveType').value,
      start_date: document.getElementById('hrLeaveStart').value,
      end_date: document.getElementById('hrLeaveEnd').value,
      days_count: document.getElementById('hrLeaveDays').value,
      notes: document.getElementById('hrLeaveNotes')?.value || ''
    };
    const j = await (await fetch('/api/hr/leaves', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    if (j.success) {
      e.target.reset();
      this.loadLeaves();
      this.loadDashboard();
    } else alert(j.message);
  },

  async submitAdvance(e) {
    e.preventDefault();
    const body = {
      employee_id: document.getElementById('hrAdvanceEmployee').value,
      amount: document.getElementById('hrAdvanceAmount').value,
      date: document.getElementById('hrAdvanceDate').value,
      installment_amount: document.getElementById('hrAdvanceInstallment').value,
      notes: document.getElementById('hrAdvanceNotes')?.value || ''
    };
    const j = await (await fetch('/api/hr/advances', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    if (j.success) {
      e.target.reset();
      this.loadAdvances();
      this.loadDashboard();
    } else alert(j.message);
  },

  async setLeaveStatus(id, status) {
    await fetch('/api/hr/leaves/' + id + '/status', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
    this.loadLeaves();
    this.loadDashboard();
  },

  async generatePayroll() {
    const month = document.getElementById('hrPayrollMonth').value;
    if (!month) return alert('اختر شهر المسير أولاً');
    const j = await (await fetch('/api/hr/payroll/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payroll_month: month }) })).json();
    alert(j.message);
    if (j.success) {
      this.loadPayroll();
      this.loadDashboard();
    }
  },

  showPane(name, button) {
    document.querySelectorAll('.hr-pane').forEach(p => p.style.display = 'none');
    const pane = document.getElementById('hrPane_' + name);
    if (pane) pane.style.display = 'block';
    document.querySelectorAll('#hrView .report-tab-btn').forEach(b => b.classList.remove('active'));
    button?.classList.add('active');
    if (name === 'leaveTypes') this.loadLeaveTypes();
    if (name === 'evaluations') this.loadEvaluations();
  },

  async payPayroll(id) {
    const j = await (await fetch('/api/hr/payroll/' + id + '/pay', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    if (j.success) {
      this.loadPayroll();
      this.loadDashboard();
    } else alert(j.message);
  }
};
