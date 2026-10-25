/* Period journal review, posting and voucher register exports. */
Object.assign(Accounting, {
  analyticalAccountNumber(edit = false) {
    const prefix = edit ? 'editAcc' : 'modalAcc';
    const target = document.getElementById(prefix + 'AnalyticalCode');
    if (target) target.value = document.getElementById(prefix + 'Code')?.value || '';
  },

  async initJournalPosting() {
    try {
      const response = await fetch('/api/accounting/periods');
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || 'تعذر تحميل الفترات');
      this.postingPeriods = result.data || [];
      const select = document.getElementById('postingPeriod');
      const previous = select.value;
      select.replaceChildren(new Option('اختر فترة محاسبية...', ''));
      for (const period of this.postingPeriods) select.add(new Option(`${period.period_name} (${period.start_date} — ${period.end_date})${period.status === 'closed' ? ' — مغلقة' : ''}`, period.id));
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Aden', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      const selected = this.postingPeriods.find(period => String(period.id) === previous) || this.postingPeriods.find(period => period.status === 'open' && period.start_date <= today && period.end_date >= today) || this.postingPeriods.find(period => period.status === 'open') || this.postingPeriods[0];
      select.value = selected ? String(selected.id) : '';
      await this.loadPostingJournals();
    } catch (error) { App.showToast(error.message, 'error'); }
  },

  async loadPostingJournals() {
    const body = document.getElementById('postingJournalsBody');
    const period = (this.postingPeriods || []).find(item => String(item.id) === document.getElementById('postingPeriod').value);
    const sequence = (this._postingLoadSequence || 0) + 1;
    this._postingLoadSequence = sequence;
    this.postingJournals = [];
    document.getElementById('postingSelectAll').checked = false;
    if (!period) {
      body.innerHTML = '<tr><td colspan="9">اختر فترة لعرض قيودها.</td></tr>';
      document.getElementById('postingSummary').textContent = 'لا توجد فترة محددة';
      return;
    }
    body.innerHTML = '<tr><td colspan="9">جاري تحميل قيود الفترة...</td></tr>';
    try {
      const params = new URLSearchParams({ from_date: period.start_date, to_date: period.end_date, include_closed: 'true', all: 'true' });
      const response = await fetch('/api/accounting/journal-entries?' + params);
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || 'تعذر تحميل القيود');
      if (this._postingLoadSequence !== sequence) return;
      this.postingJournals = result.data || [];
      this.renderPostingJournals();
    } catch (error) {
      if (this._postingLoadSequence !== sequence) return;
      body.innerHTML = '<tr><td colspan="9">تعذر تحميل قيود الفترة.</td></tr>';
      App.showToast(error.message, 'error');
    }
  },

  renderPostingJournals() {
    const period = (this.postingPeriods || []).find(item => String(item.id) === document.getElementById('postingPeriod').value);
    const state = document.getElementById('postingStatusFilter').value;
    const entries = (this.postingJournals || []).filter(entry => !state || entry.status === state);
    const escape = value => this.escapeJournalDescription(String(value ?? ''));
    const label = value => ({ draft: 'مسودة', under_review: 'قيد المراجعة', approved: 'معتمد', posted: 'مرحل', reversed: 'معكوس', cancelled: 'ملغى' })[value] || value;
    const can = permission => typeof Auth !== 'undefined' && Auth.hasPermission(permission);
    document.getElementById('postingSelectAll').checked = false;
    document.getElementById('postingSummary').textContent = `عدد قيود الفترة: ${(this.postingJournals || []).length} — المعروض: ${entries.length}${period?.status === 'closed' ? ' — الفترة مغلقة، العرض فقط' : ''}`;
    document.getElementById('postingJournalsBody').innerHTML = entries.length ? entries.map(entry => {
      const eligible = period?.status === 'open' && ['draft', 'under_review', 'approved'].includes(entry.status);
      const checkbox = eligible && can('accounting:post') ? `<input type="checkbox" class="posting-choice" value="${Number(entry.id)}" aria-label="اختيار القيد ${escape(entry.entry_no)}">` : '';
      const approve = eligible && entry.status !== 'approved' && can('accounting:approve') ? `<button type="button" class="btn btn-secondary btn-sm" onclick="Accounting.journalPostingAction('approve', ${Number(entry.id)})">اعتماد</button>` : '';
      const post = eligible && can('accounting:post') ? `<button type="button" class="btn btn-primary btn-sm" onclick="Accounting.journalPostingAction('post', ${Number(entry.id)})">ترحيل</button>` : '';
      return `<tr><td>${checkbox}</td><td>${escape(entry.display_no || entry.entry_no)}</td><td>${escape(entry.date)}</td><td style="white-space:pre-wrap">${escape(entry.description)}</td><td>${escape(entry.reference_no || '')}</td><td>${App.formatNumber(entry.total_debit)}</td><td>${App.formatNumber(entry.total_credit)}</td><td>${escape(label(entry.status))}</td><td><button type="button" class="btn btn-secondary btn-sm" onclick="Accounting.viewJournalDetails(${Number(entry.id)})">تفاصيل</button> ${approve} ${post}</td></tr>`;
    }).join('') : '<tr><td colspan="9">لا توجد قيود مطابقة للفترة والحالة المحددتين.</td></tr>';
    document.getElementById('postSelectedJournals').disabled = !can('accounting:post') || period?.status !== 'open' || !entries.some(entry => ['draft', 'under_review', 'approved'].includes(entry.status));
  },

  selectPostingJournals(checked) {
    document.querySelectorAll('#postingJournalsBody .posting-choice').forEach(input => { input.checked = checked; });
  },

  async journalPostingAction(action, id) {
    if (!['approve', 'post'].includes(action) || this._postingBusy) return;
    const label = action === 'post' ? 'ترحيل' : 'اعتماد';
    if (!confirm(`هل تريد ${label} هذا القيد؟`)) return;
    await this.executeJournalPosting(action, [Number(id)]);
  },

  async postSelectedJournals() {
    if (this._postingBusy) return;
    const ids = [...document.querySelectorAll('#postingJournalsBody .posting-choice:checked')].map(input => Number(input.value));
    if (!ids.length) return App.showToast('اختر قيودًا للترحيل', 'warning');
    if (!confirm(`هل تريد ترحيل القيود المحددة وعددها ${ids.length}؟`)) return;
    await this.executeJournalPosting('post', ids);
  },

  async executeJournalPosting(action, ids) {
    if (this._postingBusy) return;
    this._postingBusy = true;
    const controls = [...document.querySelectorAll('#journalPostingView button, #journalPostingView select, #journalPostingView input')];
    const original = controls.map(control => [control, control.disabled]);
    controls.forEach(control => { control.disabled = true; });
    const failures = []; let succeeded = 0;
    try {
      for (const id of ids) {
        try {
          const response = await fetch(`/api/accounting/journal-entries/${id}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
          const result = await response.json();
          if (!response.ok || !result.success) throw new Error(result.message || 'تعذر تنفيذ العملية');
          succeeded++;
        } catch (error) { failures.push(`#${id}: ${error.message}`); }
      }
      document.getElementById('postingActionResult').textContent = `نجحت ${succeeded} عملية${failures.length ? '؛ تعذر: ' + failures.join(' | ') : ''}`;
      App.showToast(`نجحت ${succeeded} من ${ids.length}`, failures.length ? 'warning' : 'success');
    } finally {
      this._postingBusy = false;
      for (const [control, disabled] of original) control.disabled = disabled;
      await this.loadPostingJournals();
      if (action === 'post' && succeeded) await Promise.allSettled([this.loadCashMovement(), App.loadCashTable()]);
    }
  },

  async voucherRegister(kind) {
    if (!['expense', 'receipt'].includes(kind)) throw new Error('نوع السجل غير صالح');
    const route = kind === 'expense' ? '/api/expenses' : '/api/payments?type=' + encodeURIComponent('قبض');
    const response = await fetch(route);
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.message || 'تعذر تحميل السجل');
    const title = kind === 'expense' ? 'سجل سندات الصرف' : 'سجل سندات القبض';
    const statuses = { draft: 'مسودة', under_review: 'قيد المراجعة', approved: 'معتمد', posted: 'مرحل', reversed: 'معكوس', cancelled: 'ملغى' };
    const rows = (result.data || []).map(voucher => ({
      'رقم السند': String(voucher.receipt_no || ''), 'التاريخ': voucher.date || '',
      'الطرف': (kind === 'expense' ? voucher.supplier_name || voucher.recipient : voucher.client_name) || '',
      'رقم الحساب': String(voucher.account_code || ''), 'اسم الحساب': voucher.account_name || '',
      'مركز التكلفة': voucher.cost_center_name || '', 'المشروع': voucher.project_name || '',
      'المبلغ': Number(voucher.amount) || 0, 'العملة': voucher.currency || 'ر.ي',
      'طريقة الدفع': voucher.payment_method || '', 'الحالة': statuses[voucher.status] || voucher.status || '',
      'المرجع': voucher.reference_no || '', 'البيان': voucher.notes || ''
    }));
    const totals = new Map();
    for (const row of rows) totals.set(row['العملة'], Math.round(((totals.get(row['العملة']) || 0) + row['المبلغ']) * 100) / 100);
    return { title, rows, totals };
  },

  async exportVoucherRegister(kind, format) {
    this._voucherExportBusy ||= new Set();
    const key = kind + ':' + format;
    if (this._voucherExportBusy.has(key)) return;
    this._voucherExportBusy.add(key);
    try {
      const register = await this.voucherRegister(kind);
      const { rows, totals }=register;
      const title=typeof Settings!=='undefined'&&Settings.getOperationTitle?Settings.getOperationTitle(kind==='expense'?'expense_register':'receipt_register',register.title):register.title;
      if (!rows.length) return App.showToast('لا توجد سندات للتصدير', 'warning');
      if (format === 'excel') {
        const book = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), 'السندات');
        XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([...totals].map(([currency, amount]) => ({ 'العملة': currency, 'إجمالي مبالغ السجل': amount }))), 'الإجماليات');
        XLSX.writeFile(book, `${title}.xlsx`);
      } else if (format === 'pdf') {
        const escape = value => this.escapeJournalDescription(String(value ?? ''));
        const columns = Object.keys(rows[0]);
        document.getElementById('printArea').innerHTML = `<div class="multi-page-report-document font-cairo voucher-register" dir="rtl" style="padding:10mm;background:white;color:#111"><style>@media print{@page{size:A4 landscape}.voucher-register table{font-size:9pt}.voucher-register thead{display:table-header-group}.voucher-register tr{break-inside:avoid}}</style><div class="letterhead-content-wrap"><h2>${escape(title)}</h2><p>عدد السندات: ${rows.length} — يشمل جميع صفحات السجل وحالات السندات.</p><table border="1" cellpadding="5" style="width:100%;table-layout:fixed;overflow-wrap:anywhere;border-collapse:collapse"><thead><tr>${columns.map(column => `<th>${escape(column)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${columns.map(column => `<td style="white-space:pre-wrap;overflow-wrap:anywhere;vertical-align:top">${escape(row[column])}</td>`).join('')}</tr>`).join('')}</tbody></table><p>إجمالي مبالغ السجل حسب العملة: ${[...totals].map(([currency, amount]) => `<span dir="ltr" style="display:inline-block">${App.formatNumber(amount)} ${escape(currency)}</span>`).join(' | ')}</p></div></div>`;
        window.print();
      }
    } catch (error) { App.showToast(error.message || 'تعذر التصدير', 'error'); }
    finally { this._voucherExportBusy.delete(key); }
  },

  openPeriodToClose(id) {
    const period = (this.accountingPeriods || []).find(item => Number(item.id) === Number(id));
    if (period) this.openClosePeriodModal(period.id, period.period_name, period.start_date, period.end_date);
  },

  reopenAccountingPeriod(id) {
    const period = (this.accountingPeriods || []).find(item => Number(item.id) === Number(id));
    if (period) return this.promptReopenPeriod(period.id, period.period_name);
  }
});

const createAccountingPeriod = Accounting.submitNewPeriod;
Accounting.submitNewPeriod = async function() {
  if (this._creatingAccountingPeriod) return;
  this._creatingAccountingPeriod = true;
  try { return await createAccountingPeriod.call(this); }
  finally { this._creatingAccountingPeriod = false; }
};
