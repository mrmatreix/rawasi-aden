(function(root){
 const clientActions={staff_login:'دخول فريق العمل في التطبيق',view:'عرض حسابات تطبيق العملاء',create:'إنشاء حساب عميل',edit:'تعديل وإيقاف الحسابات',permissions:'تعيين المشاريع والصلاحيات',reset_password:'إعادة تعيين كلمة المرور',sessions:'إلغاء جلسات العملاء',invite:'معاينة وإرسال دعوات الدخول',delete:'حذف حساب عميل',services:'إدارة دليل خدمات التطبيق',messages:'إدارة رسائل العملاء والردود',requests_view:'عرض طلبات الخدمات',requests_edit:'تحديث طلبات الخدمات',requests_review:'اعتماد مراجعة طلبات الخدمات',requests_convert:'تحويل طلب خدمة إلى مشروع',requests_assign_supervisor:'تحديد مشرف الاستقبال وإسناد الطلبات للمشرفين'};
 // قيود تُفعَّل صراحةً ولا تدخل ضمن قالب مسؤول التطبيق: خيار "مشرف" يحصر رؤية طلبات الزوار وردودهم فيما أُسند إليه
 const clientRestrictions={supervisor:'مشرف — يرى طلبات وردود الزوار المسندة إليه فقط'};
 // مصفوفة العمليات والصلاحيات الإجرائية: المصدر الوحيد للوحدات والعمليات (الواجهة والقوالب والاختبارات تقرأ منه).
 // كل وحدة تذكر العمليات التي يفحصها الخادم فعلاً (أو الواجهة للتصدير)؛ العملية غير المذكورة لا تنطبق على الوحدة.
 const actions=[['view','عرض'],['create','إنشاء'],['edit','تعديل'],['approve','اعتماد'],['post','ترحيل'],['cancel','إلغاء'],['export','تصدير']].map(([id,label])=>({id,label}));
 const modules=[
  {key:'dashboard',label:'لوحة التحكم والإحصائيات',actions:['view','export']},
  {key:'projects',label:'المشاريع والعقود',actions:['view','create','edit','approve','cancel','export']},
  {key:'clients',label:'العملاء',actions:['view','create','edit','export']},
  {key:'suppliers',label:'الموردون والمقاولون',actions:['view','create','edit','cancel','export']},
  {key:'accounting',label:'المحاسبة والقيود اليومية',actions:['view','create','edit','approve','post','cancel','export'],extra:{close_period:'إقفال الفترات المحاسبية'}},
  {key:'expenses',label:'المصروفات وسندات الصرف',actions:['view','create','edit','approve','cancel','export']},
  {key:'revenues',label:'الإيرادات وسندات القبض',actions:['view','create','edit','approve','cancel','export']},
  {key:'billing',label:'المستخلصات وفواتير العملاء',actions:['view','create','edit','approve','post','cancel','export']},
  {key:'payments',label:'المدفوعات والتحصيل الإلكتروني',actions:['view','create','edit']},
  {key:'custody',label:'العهد والسلف',actions:['view','create','export']},
  {key:'cash',label:'الصناديق والبنوك',actions:['view','export']},
  {key:'purchases',label:'المشتريات وأوامر الشراء',actions:['view','create','edit','approve','post','cancel','export']},
  {key:'inventory',label:'المخازن والمواد',actions:['view','create','export'],extra:{issue:'صرف مواد من المخزن'}},
  {key:'hr',label:'الموارد البشرية والرواتب',actions:['view','create','edit','approve','export'],extra:{payroll:'إعداد وترحيل مسير الرواتب'}},
  {key:'reports',label:'التقارير المالية والإدارية',actions:['view','export']},
  {key:'settings',label:'إعدادات النظام',actions:['view'],extra:{users:'إدارة المستخدمين والصلاحيات',company:'بيانات الشركة والطباعة',backup:'النسخ الاحتياطي والاستعادة'}}
 ];
 const moduleKeys=m=>[...m.actions.map(a=>m.key+':'+a),...Object.keys(m.extra||{}).map(e=>m.key+':'+e)];
 const permissionKeys=[...modules.flatMap(moduleKeys),...Object.keys(clientActions).map(a=>'client_app:'+a),...Object.keys(clientRestrictions).map(a=>'client_app:'+a)];
 const roles={
  // الأدوار الأساسية (الفصل بين المُنشئ والمعتمِد: المحاسب يُنشئ ولا يعتمد ولا يرحّل)
  admin:{label:'المدير العام',permissions:['*']},
  accountant:{label:'المحاسب المالي',permissions:['dashboard:view','dashboard:export','accounting:view','accounting:create','accounting:edit','accounting:export','expenses:view','expenses:create','expenses:edit','expenses:export','revenues:view','revenues:create','revenues:edit','revenues:export','billing:view','billing:create','billing:edit','billing:export','payments:view','payments:create','custody:view','custody:create','custody:export','clients:view','clients:create','clients:edit','clients:export','suppliers:view','suppliers:create','suppliers:edit','suppliers:export','cash:view','cash:export','projects:view','hr:view','reports:view','reports:export']},
  auditor:{label:'المراجع والمدقق المالي',permissions:['dashboard:view','dashboard:export','accounting:view','accounting:approve','accounting:post','accounting:export','expenses:view','expenses:approve','expenses:export','revenues:view','revenues:approve','revenues:export','billing:view','billing:approve','billing:export','custody:view','custody:export','projects:view','projects:export','inventory:view','inventory:export','purchases:view','purchases:approve','purchases:export','hr:view','hr:approve','hr:export','reports:view','reports:export','cash:view','cash:export']},
  project_manager:{label:'مدير المشاريع',permissions:['dashboard:view','projects:view','projects:create','projects:edit','projects:approve','projects:export','expenses:view','expenses:create','custody:view','inventory:view','inventory:issue','purchases:view','purchases:create','reports:view']},
  storekeeper:{label:'أمين المخزن',permissions:['inventory:view','inventory:create','inventory:issue','inventory:export','purchases:view','projects:view']},
  finance_manager:{label:'مدير الحسابات والمالية',permissions:['dashboard:view','accounting:view','accounting:edit','accounting:approve','accounting:post','accounting:export','expenses:view','expenses:approve','expenses:export','revenues:view','revenues:approve','revenues:export','billing:view','billing:approve','billing:export','cash:view','clients:view','suppliers:view','projects:view','reports:view','reports:export']},
  chief_accountant:{label:'رئيس الحسابات',permissions:['dashboard:view','accounting:view','accounting:create','accounting:edit','accounting:approve','accounting:post','accounting:export','expenses:view','revenues:view','billing:view','cash:view','clients:view','suppliers:view','reports:view','reports:export']},
  cashier:{label:'أمين الصندوق والبنوك',permissions:['cash:view','expenses:view','expenses:create','expenses:edit','expenses:export','revenues:view','revenues:create','revenues:edit','revenues:export','clients:view','suppliers:view','accounting:view']},
  sales_officer:{label:'مسؤول المبيعات وعروض الأسعار',permissions:['clients:view','clients:create','clients:edit','projects:view','projects:create','projects:edit','billing:view','billing:create','billing:edit','billing:export']},
  site_engineer:{label:'مهندس الموقع والتنفيذ',permissions:['projects:view','projects:edit','inventory:view','custody:view']},
  quantity_surveyor:{label:'مهندس الكميات والتكاليف والمقايسات',permissions:['projects:view','projects:edit','projects:export','reports:view','reports:export']},
  procurement_officer:{label:'مسؤول المشتريات والموردين',permissions:['purchases:view','purchases:create','purchases:edit','purchases:export','suppliers:view','suppliers:create','suppliers:edit','suppliers:export','inventory:view','projects:view']},
  hr_manager:{label:'مدير الموارد البشرية',permissions:['hr:view','hr:create','hr:edit','hr:approve','hr:export']},
  payroll_officer:{label:'مسؤول الرواتب والأجور',permissions:['hr:view','hr:create','hr:edit','hr:export','accounting:view']},
  executive_viewer:{label:'الإدارة التنفيذية — اطلاع وتقارير',permissions:['dashboard:view','dashboard:export','projects:view','reports:view','reports:export','clients:view','suppliers:view','cash:view']},
  client_app_admin:{label:'مسؤول تطبيق العملاء وخدماتهم',permissions:['clients:view','projects:view',...Object.keys(clientActions).map(action=>'client_app:'+action)]},
  service_supervisor:{label:'مشرف طلبات الخدمات — التطبيق فقط',permissions:['client_app:staff_login','client_app:requests_view','client_app:requests_edit','client_app:requests_review','client_app:supervisor']},
  users_administrator:{label:'مسؤول إدارة المستخدمين والصلاحيات',permissions:['settings:users']}
 };
 const operations=[
 ['cash_projection','توقعات التدفق النقدي والسيولة'],['work_items','شجرة بنود الأعمال ومرجعية المقايسات'],['receipt','سند القبض'],['expense','سند الصرف'],['receipt_register','سجل سندات القبض'],['expense_register','سجل سندات الصرف'],['custody','سند العهدة والتصفية'],['journal','قيد اليومية'],['journal_register','سجل قيود اليومية'],['cash_movement','حركة الصندوق والبنك'],['account_movement','حركة الحساب'],['client_stmt','كشف حساب عميل'],['supplier_stmt','كشف حساب مورد'],['trial_balance','ميزان المراجعة'],['income_statement','قائمة الدخل'],['profit_loss','الأرباح والخسائر'],['balance_sheet','الميزانية العمومية'],['cash_flow','قائمة التدفقات النقدية'],['project_profitability','ربحية المشاريع'],['center_profitability','ربحية مراكز التكلفة'],['project_budget','موازنة المشروع: التقديري والفعلي'],['project_progress','تقرير المشروعات تحت التنفيذ'],['project','تقرير الحساب المالي للمشروع'],['contract','عقد المشروع'],['boq','جدول الكميات'],['client_boq','جدول كميات العميل'],['audit_boq','تدقيق جدول الكميات الداخلي'],['quotation','عرض السعر'],['integrated_quotation','التسعير المتكامل'],['invoice','فاتورة العميل'],['ipc','المستخلص وشهادة الدفع'],['change_order','أمر التغيير'],['daily_report','تقرير الموقع اليومي'],['weekly_report','تقرير الموقع الأسبوعي'],['handover','محضر الاستلام'],['correspondence','مراسلات المشروع'],['settlement','الحساب الختامي والمخالصة'],['project_package','حزمة مستندات المشروع'],['payroll','مسير الرواتب'],['payslip','قسيمة الراتب'],['inventory','جرد وتقييم المخزون']
 ].map(([id,label])=>({id,label}));
 const catalog={roles,clientActions,clientRestrictions,operations,actions,modules,permissionKeys};if(typeof module!=='undefined'&&module.exports)module.exports=catalog;root.SystemCatalog=catalog;
})(typeof window!=='undefined'?window:globalThis);
