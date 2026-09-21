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
      tbody.innerHTML = (json.data || []).length ? json.data.map(p => `
        <tr>
          <td>${this.esc(p.full_name)}</td>
          <td>${p.payroll_month}</td>
          <td>${this.money(p.basic_salary)}</td>
          <td>${this.money(p.overtime_amount)}</td>
          <td>${this.money(p.deductions)}</td>
          <td><b>${this.money(p.net_salary)}</b></td>
          <td><span class="badge ${p.status === 'paid' ? 'badge-active' : 'badge-expense'}">${p.status === 'paid' ? 'مصروف' : 'مسودة'}</span></td>
          <td>${p.journal_entry_id ? `<span class="badge badge-info" title="قيد اليومية">${p.journal_entry_id}</span>` : '<span style="color:var(--text-secondary)">غير مرحل</span>'}</td>
          <td>${p.status !== 'paid' ? `<button class="btn btn-primary btn-sm" onclick="HR.payPayroll(${p.id})">اعتماد الصرف</button>` : '—'}</td>
        </tr>
      `).join('') : '<tr><td colspan="9" style="text-align:center;padding:25px;">اختر الشهر ثم أنشئ مسير الرواتب.</td></tr>';
    } catch (e) {
      console.error(e);
    }
  },

  // 1. ترحيل مسير الرواتب إلى قيد يومية متزن
  async postPayrollToJournal() {
    const month = document.getElementById('hrPayrollMonth')?.value;
    if (!month) {
      App.showToast('يرجى اختيار شهر مسير الرواتب أولاً', 'error');
      return;
    }

    if (!confirm(`هل أنت متأكد من ترحيل مسير رواتب شهر (${month}) إلى قيد يومية متزن آلياً؟\nسيتم إنشاء قيد صرف متزن وقيد استقطاع السلف وتحديث حالة المسير إلى مصروف.`)) {
      return;
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
