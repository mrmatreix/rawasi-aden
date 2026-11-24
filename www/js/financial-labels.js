(function (root) {
  const labels = {
    asset: 'الأصول', assets: 'الأصول', 'أصول': 'الأصول', 'اصول': 'الأصول',
    liability: 'الالتزامات', liabilities: 'الالتزامات', 'خصوم': 'الالتزامات', 'التزامات': 'الالتزامات',
    equity: 'حقوق الملكية', 'حقوق ملكية': 'حقوق الملكية',
    expense: 'المصروفات', expenses: 'المصروفات', 'مصروفات': 'المصروفات',
    revenue: 'الإيرادات', revenues: 'الإيرادات', income: 'الإيرادات', 'إيرادات': 'الإيرادات', 'ايرادات': 'الإيرادات',
    cost: 'التكاليف', costs: 'التكاليف', 'تكاليف': 'التكاليف',
    cash: 'صندوق', bank: 'بنك', general: 'عام', employee_receivables: 'ذمم موظفين', customers: 'عملاء', suppliers: 'موردين',
    operating: 'تشغيلي', investing: 'استثماري', financing: 'تمويلي', project: 'مشروع', department: 'قسم', branch: 'فرع', administrative: 'إداري'
  };
  const api = { type: value => labels[String(value || '').trim().toLowerCase()] || String(value || 'غير محدد') };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') root.FinancialLabels = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
