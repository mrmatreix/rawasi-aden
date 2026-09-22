/**
 * خدمة مسير الرواتب والاستحقاقات النظامية (Payroll Service)
 * تفصل احتساب قواعد التأمينات (6% موظف / 9% منشأة) والضرائب وبناء القيد المركب المتزن
 */

const PayrollService = {
  /**
   * احتساب الرواتب النظامية لقائمة الموظفين وفق التشريعات وقواعد العمل
   */
  calculateStatutoryPayroll(records) {
    let totalBasic = 0;
    let totalAllowances = 0;
    let totalGross = 0;
    let totalInsuranceEmp = 0;
    let totalInsuranceOrg = 0;
    let totalTax = 0;
    let totalDeductions = 0;
    let totalNet = 0;

    const computedRecords = records.map(p => {
      const basic = Number(p.basic_salary || 0);
      const allowances = Number(p.allowances || p.overtime || 0);
      const gross = basic + allowances;

      // 1. حصة الموظف من التأمينات الاجتماعية: 6% من الراتب الأساسي
      const insuranceEmp = Math.round(basic * 0.06);

      // 2. مساهمة المنشأة في التأمينات: 9% من الراتب الأساسي
      const insuranceOrg = Math.round(basic * 0.09);

      // 3. ضريبة كسب العمل (شرائح تصاعدية نظامية بعد الإعفاء الأساسي 20,000)
      let incomeTax = 0;
      const taxable = Math.max(0, gross - 20000 - insuranceEmp);
      if (taxable > 0) {
        if (taxable <= 50000) {
          incomeTax = Math.round(taxable * 0.10);
        } else {
          incomeTax = Math.round(50000 * 0.10 + (taxable - 50000) * 0.15);
        }
      }

      // 4. استقطاعات أخرى وسلفيات
      const deductions = Number(p.deductions || 0);

      // 5. صافي الراتب المستحق
      const net = Math.max(0, gross - insuranceEmp - incomeTax - deductions);

      totalBasic += basic;
      totalAllowances += allowances;
      totalGross += gross;
      totalInsuranceEmp += insuranceEmp;
      totalInsuranceOrg += insuranceOrg;
      totalTax += incomeTax;
      totalDeductions += deductions;
      totalNet += net;

      return {
        ...p,
        basic_salary: basic,
        allowances,
        gross_salary: gross,
        insurance_employee: insuranceEmp,
        insurance_company: insuranceOrg,
        income_tax: incomeTax,
        deductions,
        net_salary: net
      };
    });

    const summary = {
      totalBasic,
      totalAllowances,
      totalGross,
      totalInsuranceEmp,
      totalInsuranceOrg,
      totalTax,
      totalDeductions,
      totalNet
    };

    return {
      records: computedRecords,
      summary
    };
  },

  /**
   * توليد سطور القيد المحاسبي المركب المتزن لمسير الرواتب
   */
  generateCompoundJournalPreview(summary, accounts = {}) {
    const lines = [];

    // طرف مدين 1: مصروف الرواتب والأجور (إجمالي الاستحقاق)
    if (summary.totalGross > 0) {
      lines.push({
        type: 'debit',
        account_code: accounts.salaries_expense_code || '5101',
        account_name: 'مصروفات الرواتب والأجور',
        description: 'إجمالي استحقاقات رواتب وأجور الموظفين والبدلات',
        amount: summary.totalGross
      });
    }

    // طرف مدين 2: مصروف مساهمة المنشأة في التأمينات الاجتماعية (9%)
    if (summary.totalInsuranceOrg > 0) {
      lines.push({
        type: 'debit',
        account_code: accounts.insurance_expense_code || '5102',
        account_name: 'مصروف مساهمة المنشأة في التأمينات (9%)',
        description: 'مساهمة الشركة القانونية في الهيئة العامة للتأمينات والمعاشات',
        amount: summary.totalInsuranceOrg
      });
    }

    // طرف دائن 1: أمانات مصلحة التأمينات الاجتماعية (15% = 6% موظف + 9% منشأة)
    const totalInsurancePayable = summary.totalInsuranceEmp + summary.totalInsuranceOrg;
    if (totalInsurancePayable > 0) {
      lines.push({
        type: 'credit',
        account_code: accounts.insurance_payable_code || '2105',
        account_name: 'مستحقات وأمانات التأمينات الاجتماعية (15%)',
        description: `حصة الموظفين (6% = ${summary.totalInsuranceEmp}) + مساهمة الشركة (9% = ${summary.totalInsuranceOrg})`,
        amount: totalInsurancePayable
      });
    }

    // طرف دائن 2: أمانات ضريبة كسب العمل المستقطعة
    if (summary.totalTax > 0) {
      lines.push({
        type: 'credit',
        account_code: accounts.tax_payable_code || '2106',
        account_name: 'أمانات مصلحة الضرائب (ضريبة كسب العمل)',
        description: 'ضرائب الدخل المستقطعة من رواتب الموظفين لتوريدها للمصلحة',
        amount: summary.totalTax
      });
    }

    // طرف دائن 3: سلفيات وذمم الموظفين المستردة
    if (summary.totalDeductions > 0) {
      lines.push({
        type: 'credit',
        account_code: accounts.advances_receivable_code || '1106',
        account_name: 'سلف وعهد الموظفين (تسوية أقساط)',
        description: 'أقساط السلف والجزاءات المستقطعة من مسير الرواتب',
        amount: summary.totalDeductions
      });
    }

    // طرف دائن 4: جاري الرواتب والأجور المستحقة (الصافي القابل للصرف)
    if (summary.totalNet > 0) {
      lines.push({
        type: 'credit',
        account_code: accounts.salaries_payable_code || '2104',
        account_name: 'الرواتب والأجور المستحقة (صافي الصرف)',
        description: 'صافي الرواتب المستحقة للتحويل إلى حسابات الموظفين أو الصندوق',
        amount: summary.totalNet
      });
    }

    // التحقق من توازن القيد المركب
    const totalDebit = lines.filter(l => l.type === 'debit').reduce((sum, l) => sum + l.amount, 0);
    const totalCredit = lines.filter(l => l.type === 'credit').reduce((sum, l) => sum + l.amount, 0);
    const isBalanced = Math.abs(totalDebit - totalCredit) < 0.001;

    return {
      lines,
      totalDebit,
      totalCredit,
      isBalanced,
      difference: Math.round(Math.abs(totalDebit - totalCredit) * 100) / 100
    };
  }
};

module.exports = PayrollService;
