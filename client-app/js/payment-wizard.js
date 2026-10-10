/**
 * منطق الواجهة الأمامية للوالمكون التفاعلي لنظام تصنيف المدفوعات الخماسي
 * رواسي عدن للهندسة والمقاولات
 */

const PaymentWizard = {
  currentStep: 1,
  data: {
    contexts: [],
    instruments: [],
    channels: [],
    timings: [],
    documents: [],
    clients: [],
    suppliers: [],
    projects: []
  },
  selected: {
    context_code: 'ADVANCE',
    instrument_code: 'CASH',
    channel_id: 1,
    timing_code: 'IMMEDIATE',
    document_code: 'MANUAL',
    direction: 'IN',
    amount: 0,
    currency: 'USD',
    exchange_rate: 1.0000
  },

  async init() {
    document.getElementById('inputDate').value = new Date().toISOString().split('T')[0];
    await this.loadReferenceData();
    this.renderStep1();
    this.renderStep2();
    this.renderStep3();
    this.renderStep4();
    this.renderStep5();
    await this.loadParties();
    this.recalculate();
  },

  async loadReferenceData() {
    try {
      const [resCtx, resIns, resChn, resTmg, resDoc] = await Promise.all([
        fetch('/api/payments/contexts').then(r => r.json()),
        fetch('/api/payments/instruments').then(r => r.json()),
        fetch('/api/payments/channels').then(r => r.json()),
        fetch('/api/payments/timings').then(r => r.json()),
        fetch('/api/payments/documents').then(r => r.json())
      ]);

      if (resCtx.success) this.data.contexts = resCtx.data;
      if (resIns.success) this.data.instruments = resIns.data;
      if (resChn.success) this.data.channels = resChn.data;
      if (resTmg.success) this.data.timings = resTmg.data;
      if (resDoc.success) this.data.documents = resDoc.data;
    } catch (e) {
      this.showAlert('فشل جلب البيانات المرجعية للطبقات: ' + e.message, 'danger');
    }
  },

  async loadParties() {
    try {
      const [resC, resS, resP] = await Promise.all([
        fetch('/api/clients').then(r => r.json()).catch(() => ({ data: [] })),
        fetch('/api/suppliers').then(r => r.json()).catch(() => ({ data: [] })),
        fetch('/api/projects').then(r => r.json()).catch(() => ({ data: [] }))
      ]);

      const clientSel = document.getElementById('inputClientId');
      const suppSel = document.getElementById('inputSupplierId');
      const prjSel = document.getElementById('inputProjectId');

      (resC.data || resC || []).forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = `${c.name} ${c.company ? '(' + c.company + ')' : ''}`;
        clientSel.appendChild(opt);
      });

      (resS.data || resS || []).forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = `${s.name} ${s.company_name ? '(' + s.company_name + ')' : ''}`;
        suppSel.appendChild(opt);
      });

      (resP.data || resP || []).forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `[${p.code || p.id}] ${p.name}`;
        prjSel.appendChild(opt);
      });
    } catch (e) {
      console.warn('Error loading parties:', e);
    }
  },

  renderStep1() {
    const grid = document.getElementById('contextGrid');
    grid.innerHTML = '';
    this.data.contexts.forEach(ctx => {
      const card = document.createElement('div');
      card.className = `option-card ${this.selected.context_code === ctx.code ? 'selected' : ''}`;
      card.onclick = () => {
        this.selected.context_code = ctx.code;
        this.renderStep1();
      };
      card.innerHTML = `
        <div class="option-icon"><i class="fas ${ctx.icon}"></i></div>
        <div class="option-title">${ctx.name_ar}</div>
        <div class="option-subtitle">${ctx.name_en}</div>
      `;
      grid.appendChild(card);
    });
  },

  renderStep2() {
    const grid = document.getElementById('instrumentGrid');
    grid.innerHTML = '';
    this.data.instruments.forEach(ins => {
      const card = document.createElement('div');
      card.className = `option-card ${this.selected.instrument_code === ins.code ? 'selected' : ''}`;
      card.onclick = () => {
        this.selected.instrument_code = ins.code;
        this.renderStep2();
        this.toggleConditionalFields();
      };

      let badgeHtml = '';
      if (ins.max_amount) {
        badgeHtml = `<div class="limit-badge"><i class="fas fa-exclamation-triangle"></i> حد أقصى: ${ins.max_amount}$</div>`;
      }

      card.innerHTML = `
        <div class="option-icon"><i class="fas ${ins.icon}"></i></div>
        <div class="option-title">${ins.name_ar}</div>
        <div class="option-subtitle">${ins.name_en}</div>
        ${badgeHtml}
      `;
      grid.appendChild(card);
    });
  },

  renderStep3() {
    const grid = document.getElementById('channelGrid');
    grid.innerHTML = '';
    this.data.channels.forEach(chn => {
      const card = document.createElement('div');
      card.className = `option-card ${this.selected.channel_id === chn.id ? 'selected' : ''}`;
      card.onclick = () => {
        this.selected.channel_id = chn.id;
        this.renderStep3();
      };
      card.innerHTML = `
        <div class="option-icon"><i class="fas ${chn.icon}"></i></div>
        <div class="option-title">${chn.name_ar}</div>
        <div class="option-subtitle">${chn.bank_name || chn.type} (${chn.currency})</div>
      `;
      grid.appendChild(card);
    });
  },

  renderStep4() {
    const grid = document.getElementById('timingGrid');
    grid.innerHTML = '';
    this.data.timings.forEach(tmg => {
      const card = document.createElement('div');
      card.className = `option-card ${this.selected.timing_code === tmg.code ? 'selected' : ''}`;
      card.onclick = () => {
        this.selected.timing_code = tmg.code;
        this.renderStep4();
      };
      card.innerHTML = `
        <div class="option-icon"><i class="fas ${tmg.icon}"></i></div>
        <div class="option-title">${tmg.name_ar}</div>
        <div class="option-subtitle">${tmg.default_days > 0 ? 'استحقاق خلال ' + tmg.default_days + ' يوم' : 'تسوية فورية'}</div>
      `;
      grid.appendChild(card);
    });
  },

  renderStep5() {
    const grid = document.getElementById('documentGrid');
    grid.innerHTML = '';
    this.data.documents.forEach(doc => {
      const card = document.createElement('div');
      card.className = `option-card ${this.selected.document_code === doc.code ? 'selected' : ''}`;
      card.onclick = () => {
        this.selected.document_code = doc.code;
        this.renderStep5();
      };
      card.innerHTML = `
        <div class="option-icon"><i class="fas ${doc.icon}"></i></div>
        <div class="option-title">${doc.name_ar}</div>
        <div class="option-subtitle">${doc.name_en}</div>
      `;
      grid.appendChild(card);
    });
  },

  toggleConditionalFields() {
    const code = this.selected.instrument_code;
    const ins = this.data.instruments.find(i => i.code === code) || {};

    document.getElementById('fieldChequeNo').style.display = (ins.requires_cheque === 1 || code === 'CHEQUE') ? 'block' : 'none';
    document.getElementById('fieldBankName').style.display = (ins.requires_cheque === 1 || code === 'CHEQUE') ? 'block' : 'none';
    document.getElementById('fieldIban').style.display = (ins.requires_iban === 1 || ['BANK_TRF', 'LC'].includes(code)) ? 'block' : 'none';
    document.getElementById('fieldWalletPhone').style.display = (ins.requires_wallet_phone === 1 || code === 'WALLET') ? 'block' : 'none';
  },

  recalculate() {
    const amt = Number(document.getElementById('inputAmount').value) || 0;
    const curr = document.getElementById('inputCurrency').value;
    const rate = Number(document.getElementById('inputExchangeRate').value) || 1.0;
    const dir = document.getElementById('inputDirection').value;

    this.selected.amount = amt;
    this.selected.currency = curr;
    this.selected.exchange_rate = rate;
    this.selected.direction = dir;

    // Check Max limit
    const ins = this.data.instruments.find(i => i.code === this.selected.instrument_code);
    if (ins && ins.max_amount !== null && ins.max_amount !== undefined) {
      let amtUsd = amt;
      if (curr === 'YER') amtUsd = amt / (rate || 530);
      else if (curr === 'SAR') amtUsd = amt / (rate || 3.75);

      if (amtUsd > Number(ins.max_amount)) {
        this.showAlert(`⚠️ تنبيه: المبلغ الحالي المعادل (${amtUsd.toFixed(2)}$) يتجاوز الحد الأقصى المسموح لوسيلة [${ins.name_ar}] وهو (${ins.max_amount}$)`, 'danger');
      } else {
        this.hideAlert();
      }
    } else {
      this.hideAlert();
    }
  },

  goToStep(step) {
    if (step < 1 || step > 7) return;

    // Hide all steps
    for (let i = 1; i <= 7; i++) {
      document.getElementById(`step${i}`).style.display = 'none';
      const indicator = document.querySelector(`.step-item[data-step="${i}"]`);
      if (indicator) {
        indicator.classList.remove('active');
        if (i < step) indicator.classList.add('completed');
        else indicator.classList.remove('completed');
      }
    }

    this.currentStep = step;
    document.getElementById(`step${step}`).style.display = 'block';
    const activeInd = document.querySelector(`.step-item[data-step="${step}"]`);
    if (activeInd) activeInd.classList.add('active');

    // Controls
    document.getElementById('btnPrev').style.visibility = step === 1 ? 'hidden' : 'visible';
    const btnNext = document.getElementById('btnNext');
    if (step === 7) {
      btnNext.innerHTML = '<i class="fas fa-check-circle"></i> تأكيد وإصدار المعاملة والقيد';
      btnNext.className = 'btn btn-primary';
      this.renderReviewStep();
    } else {
      btnNext.innerHTML = 'التالي <i class="fas fa-arrow-left"></i>';
      btnNext.className = 'btn btn-primary';
    }
  },

  nextStep() {
    if (this.currentStep === 7) {
      this.submitTransaction();
    } else {
      this.goToStep(this.currentStep + 1);
    }
  },

  prevStep() {
    this.goToStep(this.currentStep - 1);
  },

  renderReviewStep() {
    const ctx = this.data.contexts.find(c => c.code === this.selected.context_code) || {};
    const ins = this.data.instruments.find(i => i.code === this.selected.instrument_code) || {};
    const chn = this.data.channels.find(c => c.id === this.selected.channel_id) || {};
    const tmg = this.data.timings.find(t => t.code === this.selected.timing_code) || {};
    const doc = this.data.documents.find(d => d.code === this.selected.document_code) || {};

    const amt = Number(this.selected.amount) || 0;
    const feePct = Number(ins.fee_percentage || 0);
    const feeAmt = (amt * (feePct / 100));
    const netAmt = this.selected.direction === 'IN' ? (amt - feeAmt) : (amt + feeAmt);

    document.getElementById('revContext').textContent = ctx.name_ar || this.selected.context_code;
    document.getElementById('revInstrument').textContent = ins.name_ar || this.selected.instrument_code;
    document.getElementById('revChannel').textContent = chn.name_ar || 'القناة الأولى';
    document.getElementById('revTiming').textContent = tmg.name_ar || this.selected.timing_code;
    document.getElementById('revDocument').textContent = doc.name_ar || this.selected.document_code;
    document.getElementById('revNet').textContent = `${netAmt.toFixed(2)} ${this.selected.currency}`;

    // Expected Journal Lines
    const tbody = document.getElementById('journalTableBody');
    tbody.innerHTML = '';

    const isIn = this.selected.direction === 'IN';
    const localAmt = (amt * Number(this.selected.exchange_rate || 1.0)).toFixed(2);

    const line1 = document.createElement('tr');
    line1.innerHTML = `
      <td><code>${isIn ? (chn.account_number || '12101001') : (ctx.default_debit_account_code || '51101001')}</code></td>
      <td><strong>${isIn ? (chn.name_ar + ' (حساب القناة)') : (ctx.name_ar + ' (حساب المدينة)')}</strong></td>
      <td style="color: var(--success); font-weight: bold;">${isIn ? localAmt : '0.00'}</td>
      <td style="color: var(--danger); font-weight: bold;">${isIn ? '0.00' : localAmt}</td>
      <td>${isIn ? 'قبض وتحصيل في القناة' : 'صرف وسداد المستحق'}</td>
    `;

    const line2 = document.createElement('tr');
    line2.innerHTML = `
      <td><code>${isIn ? (ctx.default_credit_account_code || '41101001') : (chn.account_number || '12101001')}</code></td>
      <td><strong>${isIn ? (ctx.name_ar + ' (حساب الدائنة)') : (chn.name_ar + ' (حساب القناة)')}</strong></td>
      <td style="color: var(--success); font-weight: bold;">${isIn ? '0.00' : localAmt}</td>
      <td style="color: var(--danger); font-weight: bold;">${isIn ? localAmt : '0.00'}</td>
      <td>${isIn ? 'إثبات الإيراد/العميل' : 'خصم من القندوق/البنك'}</td>
    `;

    tbody.appendChild(line1);
    tbody.appendChild(line2);
  },

  async submitTransaction() {
    const payload = {
      direction: this.selected.direction,
      transaction_date: document.getElementById('inputDate').value,
      context_code: this.selected.context_code,
      instrument_code: this.selected.instrument_code,
      channel_id: this.selected.channel_id,
      timing_code: this.selected.timing_code,
      document_code: this.selected.document_code,
      document_number: document.getElementById('inputDocNumber').value,
      document_file_url: document.getElementById('inputDocFileUrl').value,
      amount: Number(document.getElementById('inputAmount').value),
      currency: document.getElementById('inputCurrency').value,
      exchange_rate: Number(document.getElementById('inputExchangeRate').value) || 1.0,
      client_id: document.getElementById('inputClientId').value || null,
      supplier_id: document.getElementById('inputSupplierId').value || null,
      project_id: document.getElementById('inputProjectId').value || null,
      notes: document.getElementById('inputNotes').value,
      instrument_details: {
        cheque_no: document.getElementById('inputChequeNo').value,
        bank_name: document.getElementById('inputBankName').value,
        iban: document.getElementById('inputIban').value,
        wallet_phone: document.getElementById('inputWalletPhone').value
      },
      status: 'posted'
    };

    try {
      const res = await fetch('/api/payments/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (data.success) {
        this.showAlert(`✅ تم حفظ ترحيل المعاملة بنجاح برقم المعاملة: [${data.transaction_no}] والقيد: [${data.journal_entry_no || 'تم التوليد'}]`, 'success');
        setTimeout(() => {
          this.switchView('transactions');
          this.loadTransactionsList();
        }, 1500);
      } else {
        this.showAlert('❌ خطأ في المعالجة: ' + data.message, 'danger');
      }
    } catch (e) {
      this.showAlert('❌ خطأ في الاتصال بالخادم: ' + e.message, 'danger');
    }
  },

  async loadTransactionsList() {
    try {
      const res = await fetch('/api/payments/transactions?limit=20');
      const json = await res.json();
      if (!json.success) return;

      const tbody = document.getElementById('txTableBody');
      tbody.innerHTML = '';

      (json.data || []).forEach(t => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${t.transaction_no}</strong></td>
          <td>${t.transaction_date}</td>
          <td><span style="color: ${t.direction === 'IN' ? '#10b981' : '#ef4444'}; font-weight: bold;">${t.direction === 'IN' ? 'قبض (IN)' : 'صرف (OUT)'}</span></td>
          <td>${t.context_name_ar || t.context_code}</td>
          <td>${t.instrument_name_ar || t.instrument_code}</td>
          <td>${t.channel_name_ar || t.channel_id}</td>
          <td><strong>${t.amount} ${t.currency}</strong></td>
          <td><span class="limit-badge" style="background: rgba(16, 185, 129, 0.2); color: #34d399;">${t.clearing_status}</span></td>
          <td><code>${t.journal_entry_no || '-'}</code></td>
          <td>
            <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 11px;" onclick="PaymentWizard.reverseTx(${t.id})">عكس القيد</button>
          </td>
        `;
        tbody.appendChild(tr);
      });
    } catch (e) {
      console.warn('Error loading transactions:', e);
    }
  },

  async reverseTx(id) {
    const reason = prompt('يرجى كتابة سبب عكس المعاملة:');
    if (!reason) return;
    try {
      const res = await fetch(`/api/payments/transactions/${id}/reverse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
      });
      const data = await res.json();
      alert(data.message);
      this.loadTransactionsList();
    } catch (e) {
      alert('خطأ: ' + e.message);
    }
  },

  switchView(view) {
    document.getElementById('wizardView').style.display = view === 'wizard' ? 'block' : 'none';
    document.getElementById('transactionsView').style.display = view === 'transactions' ? 'block' : 'none';
    if (view === 'transactions') this.loadTransactionsList();
  },

  showAlert(msg, type) {
    const box = document.getElementById('alertBox');
    box.style.display = 'block';
    box.style.backgroundColor = type === 'danger' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)';
    box.style.color = type === 'danger' ? '#f87171' : '#34d399';
    box.style.border = type === 'danger' ? '1px solid #ef4444' : '1px solid #10b981';
    box.innerHTML = msg;
  },

  hideAlert() {
    document.getElementById('alertBox').style.display = 'none';
  }
};

window.addEventListener('DOMContentLoaded', () => PaymentWizard.init());
