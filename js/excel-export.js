/**
 * وحدة تصدير التقارير والجداول إلى Microsoft Excel بتنسيق رسمي ومحترف - رواسي عدن
 * تولد ملفات Excel حقيقية (.xls) متوافقة مع جميع إصدارات أوفيس وجداول Google
 * تدعم: الاتجاه من اليمين لليسار (RTL)، الألوان الرسمية، التنسيق المحاسبي للأرقام، والتفقيط
 */

const ExcelExporter = {
  // جلب اسم الشركة وإعدادات الطباعة
  getCompanyInfo() {
    let companyName = 'شركة رواسي عدن للهندسة والمقاولات';
    let phone = '773413937';
    let slogan = 'نبني الحاضر لنستثمر المستقبل';
    try {
      const cached = localStorage.getItem('rawasi_print_config');
      if (cached) {
        const c = JSON.parse(cached);
        if (c.header_title) companyName = c.header_title;
        if (c.header_subtitle) phone = c.header_subtitle;
        if (c.slogan) slogan = c.slogan;
      }
    } catch (e) {}
    return { companyName, phone, slogan };
  },

  formatNum(val) {
    if (val === undefined || val === null || val === '') return '0';
    const num = Number(String(val).replace(/[^\d.-]/g, ''));
    if (isNaN(num)) return '0';
    return num.toLocaleString('en-US');
  },

  // تنزيل ملف Excel بتنسيق XML/HTML Spreadsheet المعتمد من Microsoft
  download(htmlBody, filename, worksheetName = 'التقرير المالي') {
    const cleanFilename = (filename || 'تقرير_رواسي_عدن').replace(/[\\/:*?"<>|]/g, '_') + '.xls';

    const excelTemplate = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" 
            xmlns:x="urn:schemas-microsoft-com:office:excel" 
            xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
        <!--[if gte mso 9]>
        <xml>
          <x:ExcelWorkbook>
            <x:ExcelWorksheets>
              <x:ExcelWorksheet>
                <x:Name>${worksheetName.substring(0, 31)}</x:Name>
                <x:WorksheetOptions>
                  <x:DisplayRightToLeft/>
                  <x:DoNotDisplayGridlines/>
                  <x:Print>
                    <x:ValidPrinterInfo/>
                    <x:PaperSizeIndex>9</x:PaperSizeIndex>
                  </x:Print>
                  <x:Selected/>
                </x:WorksheetOptions>
              </x:ExcelWorksheet>
            </x:ExcelWorksheets>
          </x:ExcelWorkbook>
        </xml>
        <![endif]-->
        <style>
          body {
            font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
            direction: rtl;
            background-color: #ffffff;
            margin: 0;
            padding: 10px;
          }
          table {
            border-collapse: collapse;
            width: 100%;
            direction: rtl;
            margin-bottom: 20px;
          }
          /* ترويسة التقرير */
          .hdr-company {
            background-color: #0f2744;
            color: #d4af37;
            font-size: 16pt;
            font-weight: bold;
            text-align: center;
            vertical-align: middle;
            height: 42px;
            border: 1.5pt solid #0f2744;
          }
          .hdr-title {
            background-color: #1a365d;
            color: #ffffff;
            font-size: 13pt;
            font-weight: bold;
            text-align: center;
            vertical-align: middle;
            height: 32px;
            border: 1pt solid #1a365d;
          }
          .hdr-meta {
            background-color: #f1f5f9;
            color: #334155;
            font-size: 10pt;
            text-align: center;
            vertical-align: middle;
            height: 24px;
            border: 0.5pt solid #cbd5e1;
          }
          .sec-header {
            background-color: #e2e8f0;
            color: #0f2744;
            font-size: 11pt;
            font-weight: bold;
            padding: 8px 12px;
            border: 1pt solid #94a3b8;
            text-align: right;
          }
          /* خلايا الجداول */
          th {
            background-color: #1e293b;
            color: #f8fafc;
            font-size: 10.5pt;
            font-weight: bold;
            text-align: center;
            vertical-align: middle;
            padding: 8px 10px;
            border: 1pt solid #475569;
            white-space: nowrap;
          }
          td {
            font-size: 10pt;
            padding: 6px 10px;
            vertical-align: middle;
            border: 0.5pt solid #cbd5e1;
            color: #1e293b;
            text-align: right;
          }
          /* محاذاة وتنسيق */
          .text-center { text-align: center; }
          .text-left { text-align: left; }
          .text-right { text-align: right; }
          .font-bold { font-weight: bold; }
          .row-alt { background-color: #f8fafc; }
          /* بطاقات ومؤشرات */
          .card-income { background-color: #ecfdf5; color: #047857; font-weight: bold; }
          .card-expense { background-color: #fef2f2; color: #b91c1c; font-weight: bold; }
          .card-profit { background-color: #fffbeb; color: #b45309; font-weight: bold; }
          /* صف الإجمالي */
          .row-total {
            background-color: #f1f5f9;
            font-weight: bold;
            font-size: 11pt;
            border-top: 2pt solid #0f2744;
            border-bottom: 2pt solid #0f2744;
          }
          /* تنسيقات الأرقام في إكسل */
          .num {
            mso-number-format: "\\#\\,\\#\\#0";
            text-align: left;
            font-family: 'Consolas', 'Segoe UI', monospace;
          }
          .currency {
            mso-number-format: "\\#\\,\\#\\#0\\ \\\"ر\\.ي\\\"";
            text-align: left;
            font-family: 'Consolas', 'Segoe UI', monospace;
            font-weight: bold;
          }
          .pct {
            mso-number-format: "0\\.0%";
            text-align: center;
            font-weight: bold;
          }
          .date-cell {
            mso-number-format: "yyyy\\-mm\\-dd";
            text-align: center;
          }
          /* توقيعات في الأسفل */
          .sig-row td {
            border: none;
            padding-top: 25px;
            padding-bottom: 5px;
            font-weight: bold;
            text-align: center;
            color: #475569;
          }
        </style>
      </head>
      <body>
        ${htmlBody}
      </body>
      </html>
    `;

    const blob = new Blob(["\uFEFF", excelTemplate], {
      type: 'application/vnd.ms-excel;charset=utf-8'
    });

    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', cleanFilename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1500);

    // حفظ نسخة تلقائياً في مجلد المشروع إذا كان هناك مشروع مفتوح
    const targetProjId = (window.ProjectHub && window.ProjectHub.currentProjectId) || null;
    if (targetProjId && window.fetch) {
      fetch(`/api/project-files/${targetProjId}/save-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportType: worksheetName || 'تقرير إكسيل',
          reportName: cleanFilename.replace(/\.xls$/i, ''),
          content: excelTemplate,
          format: 'xls',
          targetSubfolder: 'تقارير_المشروع_المصدرة'
        })
      }).then(r => r.json()).then(res => {
        if (res.success && res.data) {
          console.log('✓ تم حفظ نسخة الإكسيل في مجلد المشروع:', res.data.filePath);
          if (window.ProjectHub && typeof window.ProjectHub.syncProjectFolder === 'function') {
            window.ProjectHub.syncProjectFolder(false);
          }
        }
      }).catch(e => console.warn('Excel auto-save warning:', e));
    }

    if (typeof App !== 'undefined' && App.showToast) {
      App.showToast(`تم تصدير ملف Excel بنجاح: ${cleanFilename} 📊✨`, 'success');
    }
  },

  // =========================================================================
  // 1. تصدير قائمة الأرباح والخسائر الرسمية (Profit & Loss)
  // =========================================================================
  exportProfitLoss(options = {}) {
    const { companyName, phone, slogan } = this.getCompanyInfo();
    const fromDate = options.fromDate || document.getElementById('repPlFromDate')?.value || document.getElementById('plFromDate')?.value || '2024-01-01';
    const toDate = options.toDate || document.getElementById('repPlToDate')?.value || document.getElementById('plToDate')?.value || '2024-05-20';

    const parseNum = (str) => {
      if (typeof str === 'number') return str;
      if (!str) return 0;
      return Number(String(str).replace(/[^\d.-]/g, '')) || 0;
    };

    const incomeVal = parseNum(options.income || document.getElementById('fullPlIncome')?.textContent || document.getElementById('plTotalIncome')?.textContent || 1250000);
    const expenseVal = parseNum(options.expense || document.getElementById('fullPlExpense')?.textContent || document.getElementById('plTotalExpenses')?.textContent || 850000);
    const profitVal = parseNum(options.profit || document.getElementById('fullPlProfit')?.textContent || document.getElementById('plNetProfit')?.textContent || (incomeVal - expenseVal));
    const profitMargin = incomeVal > 0 ? ((profitVal / incomeVal) * 100).toFixed(1) : '0';

    // جمع بيانات تفصيل المصروفات من الجدول أو القيم الافتراضية
    let breakdownRows = [];
    const tableBody = document.getElementById('fullPlBreakdownTable');
    if (tableBody && tableBody.children.length > 0) {
      Array.from(tableBody.children).forEach((tr, idx) => {
        const tds = tr.children;
        if (tds.length >= 3) {
          const type = tds[0].innerText.trim();
          const amt = parseNum(tds[1].innerText);
          const pct = tds[2].innerText.trim();
          breakdownRows.push({ idx: idx + 1, type, amt, pct });
        }
      });
    }

    if (breakdownRows.length === 0) {
      // بنود نموذجية في حال كان الجدول لم يُحمّل بعد
      breakdownRows = [
        { idx: 1, type: 'مواد بناء وتوريدات', amt: Math.round(expenseVal * 0.45), pct: '45%' },
        { idx: 2, type: 'أجور عمالة ومصنعيات ميدانية', amt: Math.round(expenseVal * 0.35), pct: '35%' },
        { idx: 3, type: 'إيجار معدات ونقليات', amt: Math.round(expenseVal * 0.12), pct: '12%' },
        { idx: 4, type: 'مصروفات إدارية وموقع', amt: Math.round(expenseVal * 0.08), pct: '8%' }
      ];
    }

    const html = `
      <table>
        <!-- ترويسة الشركة والتقرير -->
        <tr>
          <td colspan="4" class="hdr-company">${companyName}</td>
        </tr>
        <tr>
          <td colspan="4" class="hdr-title">قـائـمـة الأربــاح والـخـسـائـر الشـامـلـة (Profit & Loss Statement)</td>
        </tr>
        <tr>
          <td colspan="4" class="hdr-meta">
            الفترة المحاسبية: من <strong>${fromDate}</strong> إلى <strong>${toDate}</strong> | تاريخ التصدير: <strong>${new Date().toISOString().split('T')[0]}</strong> | ${slogan}
          </td>
        </tr>
        <tr><td colspan="4" style="border:none; height: 12px;"></td></tr>

        <!-- المؤشرات المالية الرئيسية -->
        <tr>
          <td colspan="4" class="sec-header">أولاً: ملخص المؤشرات المالية ونتائج النشاط</td>
        </tr>
        <tr>
          <th style="width: 8%;">م</th>
          <th style="width: 52%;">البيان المحاسبي</th>
          <th style="width: 25%;">المبلغ (ريال يمني)</th>
          <th style="width: 15%;">ملاحظات ونسب</th>
        </tr>
        <tr class="card-income">
          <td class="text-center">1</td>
          <td class="font-bold">إجمالي الإيرادات والمقبوضات التشغيلية</td>
          <td class="currency">${this.formatNum(incomeVal)}</td>
          <td class="text-center font-bold">100% (أساس الدخل)</td>
        </tr>
        <tr class="card-expense">
          <td class="text-center">2</td>
          <td class="font-bold">إجمالي تكاليف ومصروفات المشاريع والتشغيل</td>
          <td class="currency">${this.formatNum(expenseVal)}</td>
          <td class="text-center font-bold">${((expenseVal / (incomeVal || 1)) * 100).toFixed(1)}% من الإيراد</td>
        </tr>
        <tr class="row-total card-profit">
          <td class="text-center font-bold">★</td>
          <td class="font-bold" style="font-size: 11.5pt;">صافي الأرباح التشغيلية المحققة</td>
          <td class="currency" style="font-size: 11.5pt; color: #b45309;">${this.formatNum(profitVal)}</td>
          <td class="text-center font-bold" style="font-size: 11.5pt; color: #b45309;">هامش ربح: ${profitMargin}%</td>
        </tr>
        <tr><td colspan="4" style="border:none; height: 16px;"></td></tr>

        <!-- تفصيل المصروفات وتكاليف المشاريع -->
        <tr>
          <td colspan="4" class="sec-header">ثانياً: تفصيل بنود التكاليف والمصروفات خلال الفترة</td>
        </tr>
        <tr>
          <th style="width: 8%;">م</th>
          <th style="width: 52%;">نوع المصروف / البند</th>
          <th style="width: 25%;">المبلغ (ريال يمني)</th>
          <th style="width: 15%;">النسبة من المصروفات</th>
        </tr>
        ${breakdownRows.map((b, i) => `
          <tr class="${i % 2 === 1 ? 'row-alt' : ''}">
            <td class="text-center">${b.idx}</td>
            <td class="font-bold">${b.type}</td>
            <td class="currency">${this.formatNum(b.amt)}</td>
            <td class="text-center font-bold">${b.pct}</td>
          </tr>
        `).join('')}
        <tr class="row-total">
          <td colspan="2" class="text-center font-bold">إجمالي تكاليف ومصروفات الفترة:</td>
          <td class="currency">${this.formatNum(expenseVal)}</td>
          <td class="text-center font-bold">100.0%</td>
        </tr>

        <!-- توقيعات الاعتماد -->
        <tr><td colspan="4" style="border:none; height: 35px;"></td></tr>
        <tr class="sig-row">
          <td colspan="2">إعداد المحاسب المالي:<br><br>...........................................</td>
          <td colspan="2">اعتماد المدير العام:<br><br>...........................................</td>
        </tr>
      </table>
    `;

    this.download(html, `تقرير_الأرباح_والخسائر_${fromDate}_إلى_${toDate}`, 'الأرباح والخسائر');
  },

  // =========================================================================
  // 2. تصدير تقرير ربحية المشاريع (Projects Profitability)
  // =========================================================================
  exportProjectsProfitability(projectsData = null) {
    const { companyName, slogan } = this.getCompanyInfo();
    const today = new Date().toISOString().split('T')[0];

    let list = projectsData;
    if (!list || !Array.isArray(list) || list.length === 0) {
      // القراءة من جدول الشاشة
      const tbody = document.getElementById('projProfitTableBody');
      if (tbody && tbody.children.length > 0) {
        list = [];
        Array.from(tbody.children).forEach(tr => {
          const tds = tr.children;
          if (tds.length >= 7) {
            list.push({
              name: tds[0].innerText.trim(),
              client: tds[1].innerText.trim(),
              contract_value: tds[2].innerText.trim(),
              actual_cost: tds[3].innerText.trim(),
              profit: tds[4].innerText.trim(),
              margin: tds[5].innerText.trim(),
              progress: tds[6].innerText.trim()
            });
          }
        });
      }
    }

    if (!list || list.length === 0) {
      if (typeof App !== 'undefined' && App.showToast) {
        App.showToast('لا توجد بيانات مشاريع لتصديرها حالياً', 'warning');
      }
      return;
    }

    const parseNum = (v) => {
      if (typeof v === 'number') return v;
      return Number(String(v || '').replace(/[^\d.-]/g, '')) || 0;
    };

    let totalContract = 0;
    let totalCost = 0;
    let totalProfit = 0;

    const rowsHtml = list.map((p, idx) => {
      const cVal = parseNum(p.contract_value);
      const costVal = parseNum(p.actual_cost);
      const pVal = parseNum(p.profit || p.calculated_actual_profit || (cVal - costVal));
      totalContract += cVal;
      totalCost += costVal;
      totalProfit += pVal;

      return `
        <tr class="${idx % 2 === 1 ? 'row-alt' : ''}">
          <td class="text-center">${idx + 1}</td>
          <td class="font-bold">${p.name || '-'}</td>
          <td>${p.client || p.client_name || '-'}</td>
          <td class="currency">${this.formatNum(cVal)}</td>
          <td class="currency">${this.formatNum(costVal)}</td>
          <td class="currency" style="color: #047857; font-weight: bold;">${this.formatNum(pVal)}</td>
          <td class="text-center font-bold">${p.margin || p.profit_margin_percentage || '0'}%</td>
          <td class="text-center">${p.progress || p.progress_percentage || '0'}%</td>
        </tr>
      `;
    }).join('');

    const avgMargin = totalContract > 0 ? ((totalProfit / totalContract) * 100).toFixed(1) : '0';

    const html = `
      <table>
        <tr><td colspan="8" class="hdr-company">${companyName}</td></tr>
        <tr><td colspan="8" class="hdr-title">تقرير تحليل ربحية وكفاءة المشاريع الهندسية</td></tr>
        <tr><td colspan="8" class="hdr-meta">تاريخ التقرير: <strong>${today}</strong> | عدد المشاريع: <strong>${list.length}</strong> | ${slogan}</td></tr>
        <tr><td colspan="8" style="border:none; height: 12px;"></td></tr>

        <tr>
          <th style="width: 5%;">م</th>
          <th style="width: 25%;">اسم المشروع (الكود)</th>
          <th style="width: 18%;">العميل</th>
          <th style="width: 13%;">قيمة العقد (ر.ي)</th>
          <th style="width: 13%;">التكلفة الفعلية (ر.ي)</th>
          <th style="width: 13%;">صافي الربح الفعلي (ر.ي)</th>
          <th style="width: 7%;">هامش الربح</th>
          <th style="width: 6%;">نسبة الإنجاز</th>
        </tr>
        ${rowsHtml}
        <tr class="row-total">
          <td colspan="3" class="text-center font-bold">الإجـمــالـي الـعــام:</td>
          <td class="currency">${this.formatNum(totalContract)}</td>
          <td class="currency">${this.formatNum(totalCost)}</td>
          <td class="currency" style="color: #047857;">${this.formatNum(totalProfit)}</td>
          <td class="text-center font-bold">${avgMargin}%</td>
          <td class="text-center">-</td>
        </tr>
        <tr><td colspan="8" style="border:none; height: 35px;"></td></tr>
        <tr class="sig-row">
          <td colspan="4">المحاسب المالي:<br><br>...........................................</td>
          <td colspan="4">مدير إدارة المشاريع:<br><br>...........................................</td>
        </tr>
      </table>
    `;

    this.download(html, `تقرير_ربحية_المشاريع_${today}`, 'ربحية المشاريع');
  },

  // =========================================================================
  // 3. تصدير الميزانية العمومية (Balance Sheet)
  // =========================================================================
  exportBalanceSheet() {
    const { companyName, slogan } = this.getCompanyInfo();
    const today = new Date().toISOString().split('T')[0];

    const getRows = (tableId) => {
      const tb = document.getElementById(tableId);
      if (!tb) return [];
      return Array.from(tb.children).map(tr => {
        const tds = tr.children;
        return {
          name: tds[0]?.innerText?.trim() || '-',
          val: tds[1]?.innerText?.trim() || '0'
        };
      });
    };

    const assets = getRows('bsAssetsTable');
    const liabs = getRows('bsLiabTable');
    const totalAssets = document.getElementById('bsTotalAssets')?.textContent || '0 ر.ي';
    const totalLiab = document.getElementById('bsTotalLiabEquity')?.textContent || '0 ر.ي';

    const maxRows = Math.max(assets.length, liabs.length, 1);
    let combinedRows = '';

    for (let i = 0; i < maxRows; i++) {
      const a = assets[i] || { name: '', val: '' };
      const l = liabs[i] || { name: '', val: '' };
      combinedRows += `
        <tr class="${i % 2 === 1 ? 'row-alt' : ''}">
          <td class="font-bold">${a.name}</td>
          <td class="currency">${a.val}</td>
          <td class="font-bold" style="border-right: 2pt solid #0f2744;">${l.name}</td>
          <td class="currency">${l.val}</td>
        </tr>
      `;
    }

    const html = `
      <table>
        <tr><td colspan="4" class="hdr-company">${companyName}</td></tr>
        <tr><td colspan="4" class="hdr-title">قائمة الميزانية العمومية والمركز المالي (Balance Sheet)</td></tr>
        <tr><td colspan="4" class="hdr-meta">كما هي في تاريخ: <strong>${today}</strong> | العملة: <strong>ريال يمني (ر.ي)</strong> | ${slogan}</td></tr>
        <tr><td colspan="4" style="border:none; height: 12px;"></td></tr>

        <tr>
          <th colspan="2" style="background-color: #047857; width: 50%;">الأصــول والـمـوجــودات (Assets)</th>
          <th colspan="2" style="background-color: #b91c1c; width: 50%;">الالتـزامـات وحـقـوق المـلـكـيـة (Liabilities & Equity)</th>
        </tr>
        <tr>
          <th style="width: 32%;">اسم الحساب</th>
          <th style="width: 18%;">الرصيد</th>
          <th style="width: 32%;">اسم الحساب</th>
          <th style="width: 18%;">الرصيد</th>
        </tr>
        ${combinedRows}
        <tr class="row-total">
          <td class="text-center font-bold">إجمالي الأصول:</td>
          <td class="currency" style="color: #047857;">${totalAssets}</td>
          <td class="text-center font-bold" style="border-right: 2pt solid #0f2744;">إجمالي الالتزامات والملكية:</td>
          <td class="currency" style="color: #b91c1c;">${totalLiab}</td>
        </tr>
        <tr><td colspan="4" style="border:none; height: 35px;"></td></tr>
        <tr class="sig-row">
          <td colspan="2">إعداد المحاسب المالي:<br><br>...........................................</td>
          <td colspan="2">اعتماد الإدارة العامة:<br><br>...........................................</td>
        </tr>
      </table>
    `;

    this.download(html, `الميزانية_العمومية_${today}`, 'الميزانية العمومية');
  },

  // =========================================================================
  // 4. تصدير كشف حساب عميل مفصل (Client Statement)
  // =========================================================================
  exportClientStatement() {
    const { companyName, slogan } = this.getCompanyInfo();
    const today = new Date().toISOString().split('T')[0];
    const clientSelect = document.getElementById('repClientSelect') || document.getElementById('statementClientSelect');
    const clientName = clientSelect ? clientSelect.options[clientSelect.selectedIndex]?.text : 'عميل';

    const infoEl = document.getElementById('repClientInfo');
    const clientInfoText = infoEl ? infoEl.innerText.replace(/\n+/g, ' | ') : '';

    const tbody = document.getElementById('repClientStatementTable');
    if (!tbody || tbody.children.length === 0) {
      if (typeof App !== 'undefined' && App.showToast) {
        App.showToast('يرجى عرض كشف حساب العميل أولاً قبل التصدير', 'warning');
      }
      return;
    }

    let rowsHtml = '';
    Array.from(tbody.children).forEach((tr, i) => {
      const tds = tr.children;
      if (tds.length >= 6) {
        rowsHtml += `
          <tr class="${i % 2 === 1 ? 'row-alt' : ''}">
            <td class="text-center">${i + 1}</td>
            <td class="date-cell">${tds[0]?.innerText || ''}</td>
            <td>${tds[1]?.innerText || ''}</td>
            <td class="text-center">${tds[2]?.innerText || ''}</td>
            <td class="currency" style="color: #b91c1c;">${tds[3]?.innerText || '0'}</td>
            <td class="currency" style="color: #047857;">${tds[4]?.innerText || '0'}</td>
            <td class="currency font-bold">${tds[5]?.innerText || '0'}</td>
            <td>${tds[6]?.innerText || '-'}</td>
          </tr>
        `;
      }
    });

    const html = `
      <table>
        <tr><td colspan="8" class="hdr-company">${companyName}</td></tr>
        <tr><td colspan="8" class="hdr-title">كـشـف حـسـاب عـمـيـل مـفـصـل</td></tr>
        <tr><td colspan="8" class="hdr-meta">العميل: <strong>${clientName}</strong> | تاريخ التصدير: <strong>${today}</strong> | ${clientInfoText}</td></tr>
        <tr><td colspan="8" style="border:none; height: 12px;"></td></tr>

        <tr>
          <th style="width: 4%;">م</th>
          <th style="width: 11%;">التاريخ</th>
          <th style="width: 12%;">نوع الحركة</th>
          <th style="width: 12%;">المرجع / السند</th>
          <th style="width: 14%;">مدين (عقد/مستخلص)</th>
          <th style="width: 14%;">دائن (سداد/قبض)</th>
          <th style="width: 15%;">الرصيد المستحق</th>
          <th style="width: 18%;">البيان والملاحظات</th>
        </tr>
        ${rowsHtml}
        <tr><td colspan="8" style="border:none; height: 35px;"></td></tr>
        <tr class="sig-row">
          <td colspan="4">المحاسب المسؤول:<br><br>...........................................</td>
          <td colspan="4">مصادقة العميل بالتطابق:<br><br>...........................................</td>
        </tr>
      </table>
    `;

    this.download(html, `كشف_حساب_${clientName.replace(/\s+/g, '_')}_${today}`, 'كشف حساب عميل');
  },

  // =========================================================================
  // 5. تصدير كشف حساب مورد مفصل (Supplier Statement)
  // =========================================================================
  exportSupplierStatement() {
    const { companyName } = this.getCompanyInfo();
    const today = new Date().toISOString().split('T')[0];
    const suppSelect = document.getElementById('repSupplierSelect');
    const suppName = suppSelect ? suppSelect.options[suppSelect.selectedIndex]?.text : 'مورد';

    const tbody = document.getElementById('repSupplierStatementTable');
    if (!tbody || tbody.children.length === 0) {
      if (typeof App !== 'undefined' && App.showToast) {
        App.showToast('يرجى عرض كشف حساب المورد أولاً قبل التصدير', 'warning');
      }
      return;
    }

    let rowsHtml = '';
    Array.from(tbody.children).forEach((tr, i) => {
      const tds = tr.children;
      if (tds.length >= 6) {
        rowsHtml += `
          <tr class="${i % 2 === 1 ? 'row-alt' : ''}">
            <td class="text-center">${i + 1}</td>
            <td class="date-cell">${tds[0]?.innerText || ''}</td>
            <td>${tds[1]?.innerText || ''}</td>
            <td class="text-center">${tds[2]?.innerText || ''}</td>
            <td class="currency" style="color: #047857;">${tds[3]?.innerText || '0'}</td>
            <td class="currency" style="color: #b91c1c;">${tds[4]?.innerText || '0'}</td>
            <td class="currency font-bold">${tds[5]?.innerText || '0'}</td>
            <td>${tds[6]?.innerText || '-'}</td>
          </tr>
        `;
      }
    });

    const html = `
      <table>
        <tr><td colspan="8" class="hdr-company">${companyName}</td></tr>
        <tr><td colspan="8" class="hdr-title">كـشـف حـسـاب مـورد مـفـصـل</td></tr>
        <tr><td colspan="8" class="hdr-meta">المورد: <strong>${suppName}</strong> | تاريخ التصدير: <strong>${today}</strong></td></tr>
        <tr><td colspan="8" style="border:none; height: 12px;"></td></tr>

        <tr>
          <th style="width: 4%;">م</th>
          <th style="width: 11%;">التاريخ</th>
          <th style="width: 12%;">نوع الحركة</th>
          <th style="width: 12%;">رقم الفاتورة/السند</th>
          <th style="width: 14%;">مدين (سداد لنا)</th>
          <th style="width: 14%;">دائن (فاتورة توريد)</th>
          <th style="width: 15%;">رصيد المورد</th>
          <th style="width: 18%;">البيان والتفاصيل</th>
        </tr>
        ${rowsHtml}
        <tr><td colspan="8" style="border:none; height: 35px;"></td></tr>
        <tr class="sig-row">
          <td colspan="4">المحاسب المسؤول:<br><br>...........................................</td>
          <td colspan="4">مطابقة المورد وتوقيعه:<br><br>...........................................</td>
        </tr>
      </table>
    `;

    this.download(html, `كشف_حساب_المورد_${suppName.replace(/\s+/g, '_')}_${today}`, 'كشف حساب مورد');
  },

  // =========================================================================
  // 6. تصدير أي جدول HTML عام في النظام (Universal HTML Table Exporter)
  // =========================================================================
  exportTable(tableSelectorOrEl, title = 'جدول البيانات', filename = 'بيانات_رواسي_عدن') {
    const table = typeof tableSelectorOrEl === 'string' ? document.querySelector(tableSelectorOrEl) : tableSelectorOrEl;
    if (!table) {
      if (typeof App !== 'undefined' && App.showToast) App.showToast('تعذر العثور على الجدول للتصدير', 'error');
      return;
    }

    const { companyName } = this.getCompanyInfo();
    const today = new Date().toISOString().split('T')[0];

    // استخراج الأعمدة والصفوف
    const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.innerText.trim());
    const colCount = Math.max(headers.length, 1);

    const rows = Array.from(table.querySelectorAll('tbody tr')).map((tr, idx) => {
      const cells = Array.from(tr.querySelectorAll('td')).map(td => {
        const txt = td.innerText.trim();
        // فحص إذا كان رقماً
        const isNum = /^[\d,.-]+(\s*(ر\.ي|\$|%))?$/.test(txt);
        const cls = isNum ? 'currency' : '';
        return `<td class="${cls}">${txt}</td>`;
      }).join('');
      return `<tr class="${idx % 2 === 1 ? 'row-alt' : ''}">${cells}</tr>`;
    }).join('');

    const html = `
      <table>
        <tr><td colspan="${colCount}" class="hdr-company">${companyName}</td></tr>
        <tr><td colspan="${colCount}" class="hdr-title">${title}</td></tr>
        <tr><td colspan="${colCount}" class="hdr-meta">تاريخ الاستخراج: <strong>${today}</strong></td></tr>
        <tr><td colspan="${colCount}" style="border:none; height: 10px;"></td></tr>
        <tr>
          ${headers.map(h => `<th>${h}</th>`).join('')}
        </tr>
        ${rows}
      </table>
    `;

    this.download(html, `${filename}_${today}`, title);
  }
};

window.ExcelExporter = ExcelExporter;
