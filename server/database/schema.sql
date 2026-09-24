-- ============================================================================
-- مخطط قاعدة بيانات نظام رواسي عدن للهندسة والمقاولات (Rawasi Aden System)
-- متوافق مع SQLite و MySQL
-- ============================================================================

-- 1. جدول الأدوار والصلاحيات
CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    permissions TEXT NOT NULL, -- JSON format or comma-separated
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. جدول المستخدمين
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role_id INTEGER REFERENCES roles(id),
    role TEXT DEFAULT 'admin',
    email TEXT,
    phone TEXT,
    status TEXT DEFAULT 'active', -- active, inactive
    permissions TEXT, -- JSON array or comma-separated permissions
    is_logged_in INTEGER DEFAULT 0,
    session_token TEXT,
    last_heartbeat DATETIME,
    last_login_at DATETIME,
    last_login_ip TEXT,
    last_login_device TEXT,
    active_sessions TEXT,
    security_settings TEXT,
    two_factor_pin TEXT DEFAULT '123456',
    two_factor_enabled INTEGER DEFAULT 1,
    branch_id INTEGER DEFAULT 1,
    branch TEXT DEFAULT 'المركز الرئيسي',
    department_id INTEGER DEFAULT 1,
    department TEXT DEFAULT 'الإدارة العامة',
    allowed_projects TEXT DEFAULT '*', -- '*' or JSON array of project IDs [1, 2]
    allowed_branches TEXT DEFAULT '*', -- '*' or JSON array of branch codes/IDs
    allowed_departments TEXT DEFAULT '*', -- '*' or JSON array of department codes/IDs
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- جداول الفروع والأقسام لنظام الصلاحيات المقيدة (Scoped Access Control)
CREATE TABLE IF NOT EXISTS branches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    address TEXT,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS departments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    manager_name TEXT,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. جدول العملاء
CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    company TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    previous_balance REAL DEFAULT 0,
    total_paid REAL DEFAULT 0,
    total_due REAL DEFAULT 0,
    current_balance REAL DEFAULT 0,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4. جدول الموردين
CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT, -- مواد بناء، حديد، أسمنت، كهرباء، تأجير معدات
    phone TEXT,
    email TEXT,
    address TEXT,
    balance REAL DEFAULT 0,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 5. جدول المشاريع
CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE,
    name TEXT NOT NULL,
    client_id INTEGER REFERENCES clients(id),
    contract_value REAL DEFAULT 0,    -- قيمة العقد
    estimated_cost REAL DEFAULT 0,    -- القيمة التقديرية
    actual_cost REAL DEFAULT 0,       -- التكلفة الفعلية
    progress_percentage REAL DEFAULT 0, -- نسبة الإنجاز %
    expected_profit REAL DEFAULT 0,   -- الربح المتوقع
    actual_profit REAL DEFAULT 0,     -- الربح الفعلي
    status TEXT DEFAULT 'active',     -- active, completed, paused
    start_date DATE,
    end_date DATE,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 6. جدول المواد والأصناف
CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE,
    name TEXT NOT NULL,
    category TEXT, -- حديد، أسمنت، بلوك، خرسانة، أدوات صحية، كهربائية
    unit TEXT,     -- طن، كيس، متر مكعب، حبة
    min_quantity REAL DEFAULT 10,
    current_quantity REAL DEFAULT 0,
    unit_price REAL DEFAULT 0,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 7. حركات المخزون (صرف، توريد، تحويل)
CREATE TABLE IF NOT EXISTS inventory_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER REFERENCES items(id),
    project_id INTEGER REFERENCES projects(id),
    type TEXT NOT NULL, -- in (توريد), out (صرف لمشروع), transfer
    quantity REAL NOT NULL,
    unit_price REAL DEFAULT 0,
    total_amount REAL DEFAULT 0,
    reference_no TEXT,
    recipient TEXT,     -- المستلم أو المهندس المشرف
    date DATE NOT NULL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 8. فواتير المشتريات
CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_no TEXT UNIQUE,
    supplier_id INTEGER REFERENCES suppliers(id),
    project_id INTEGER REFERENCES projects(id),
    total_amount REAL NOT NULL,
    paid_amount REAL DEFAULT 0,
    payment_status TEXT DEFAULT 'pending', -- paid, partial, pending
    payment_method TEXT DEFAULT 'نقدي',    -- نقدي، شيك، تحويل بنكي
    date DATE NOT NULL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 9. جدول المصروفات (سندات الصرف)
CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_no TEXT UNIQUE,
    expense_type TEXT NOT NULL, -- مواد بناء، أجور عمالة، معدات، نقل ومواصلات، مصروفات إدارية، أخرى
    project_id INTEGER REFERENCES projects(id),
    supplier_id INTEGER REFERENCES suppliers(id),
    account_id INTEGER REFERENCES accounts(id),
    cost_center_id INTEGER REFERENCES cost_centers(id),
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'ر.ي',
    payment_method TEXT DEFAULT 'نقدي', -- نقدي، تحويل بنكي، شيك
    check_no TEXT,                      -- رقم الشيك (إلزامي عند الصرف بشيك)
    bank_name TEXT,                     -- اسم البنك
    recipient TEXT,
    date DATE NOT NULL,
    status TEXT DEFAULT 'posted',       -- draft, under_review, approved, posted, closed, reversed, cancelled
    created_by INTEGER REFERENCES users(id),
    created_by_name TEXT,
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_by_name TEXT,
    reviewed_at DATETIME,
    review_notes TEXT,
    approved_by INTEGER REFERENCES users(id),
    approved_by_name TEXT,
    approved_at DATETIME,
    approval_notes TEXT,
    posted_by INTEGER REFERENCES users(id),
    posted_by_name TEXT,
    posted_at DATETIME,
    reversed_by INTEGER REFERENCES users(id),
    reversed_by_name TEXT,
    reversed_at DATETIME,
    reversal_reason TEXT,
    reversal_ref_id INTEGER,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 10. جدول الفواتير والمستخلصات
CREATE TABLE IF NOT EXISTS bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_no TEXT UNIQUE,
    bill_type TEXT DEFAULT 'مستخلص', -- مستخلص جاري، مستخلص ختامي، فاتورة أعمال
    project_id INTEGER REFERENCES projects(id),
    client_id INTEGER REFERENCES clients(id),
    amount REAL NOT NULL,           -- قيمة المستخلص الإجمالية
    deduction REAL DEFAULT 0,       -- استقطاعات (دفعة مقدمة / ضمان)
    net_amount REAL NOT NULL,       -- صافي المستخلص المستحق
    status TEXT DEFAULT 'معتمد',     -- مسودة، معتمد، محصل جزئي، محصل كامل
    date DATE NOT NULL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 11. جدول المدفوعات والتحصيلات (سندات القبض والصرف)
CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_no TEXT UNIQUE,
    type TEXT NOT NULL, -- 'قبض' أو 'صرف'
    client_id INTEGER REFERENCES clients(id),
    supplier_id INTEGER REFERENCES suppliers(id),
    project_id INTEGER REFERENCES projects(id),
    account_id INTEGER REFERENCES accounts(id),
    cost_center_id INTEGER REFERENCES cost_centers(id),
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'ر.ي',
    payment_method TEXT DEFAULT 'نقدي', -- نقدي، تحويل بنكي، شيك
    check_no TEXT,                      -- رقم الشيك (إلزامي عند القبض أو الصرف بشيك)
    bank_name TEXT,                     -- اسم البنك
    date DATE NOT NULL,
    status TEXT DEFAULT 'posted',       -- draft, under_review, approved, posted, closed, reversed, cancelled
    created_by INTEGER REFERENCES users(id),
    created_by_name TEXT,
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_by_name TEXT,
    reviewed_at DATETIME,
    review_notes TEXT,
    approved_by INTEGER REFERENCES users(id),
    approved_by_name TEXT,
    approved_at DATETIME,
    approval_notes TEXT,
    posted_by INTEGER REFERENCES users(id),
    posted_by_name TEXT,
    posted_at DATETIME,
    reversed_by INTEGER REFERENCES users(id),
    reversed_by_name TEXT,
    reversed_at DATETIME,
    reversal_reason TEXT,
    reversal_ref_id INTEGER,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 12. جدول النثريات والعهد
CREATE TABLE IF NOT EXISTS custodies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    custody_no TEXT UNIQUE,             -- رقم العهدة التسلسلي الفريد
    operation_type TEXT NOT NULL,       -- صرف عهدة، تصفية عهدة، نثريات
    employee_id INTEGER REFERENCES employees(id),
    employee_no TEXT,                   -- الرقم الوظيفي
    employee_name TEXT NOT NULL,
    related_custody_id INTEGER REFERENCES custodies(id), -- رقم العهدة الأصلية عند التصفية
    related_custody_no TEXT,
    total_amount REAL NOT NULL,
    spent_amount REAL DEFAULT 0,
    remaining_amount REAL DEFAULT 0,
    currency TEXT DEFAULT 'ر.ي',
    status TEXT DEFAULT 'مفتوحة',       -- مفتوحة، مصفاة بالكامل، تصفية جزئية
    date DATE NOT NULL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 13. جدول حركة الصندوق والبنك
CREATE TABLE IF NOT EXISTS cash_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    previous_balance REAL DEFAULT 0,
    cash_in REAL DEFAULT 0,
    cash_out REAL DEFAULT 0,
    withdrawals REAL DEFAULT 0,
    current_balance REAL DEFAULT 0,
    date DATE NOT NULL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 14. دليل الحسابات
CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL, -- أصول، خصوم، حقوق ملكية، إيرادات، مصروفات
    parent_id INTEGER REFERENCES accounts(id),
    balance REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 14.ب جدول مراكز التكلفة
CREATE TABLE IF NOT EXISTS cost_centers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,          -- كود مركز التكلفة
    name TEXT NOT NULL,                 -- اسم مركز التكلفة
    type TEXT DEFAULT 'مشروع',          -- نوع المركز: مشروع، إدارة عامة، معدات، فرع
    project_id INTEGER REFERENCES projects(id),
    status TEXT DEFAULT 'active',
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 15. القيود اليومية العامة
CREATE TABLE IF NOT EXISTS journal_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_no TEXT UNIQUE NOT NULL,
    date DATE NOT NULL,
    description TEXT NOT NULL,
    reference_type TEXT, -- سند قبض، سند صرف، فاتورة، مستخلص، قيد يدوي
    reference_id INTEGER,
    total_debit REAL DEFAULT 0,
    total_credit REAL DEFAULT 0,
    status TEXT DEFAULT 'posted',       -- draft, under_review, approved, posted, closed, reversed
    created_by INTEGER REFERENCES users(id),
    created_by_name TEXT,
    approved_by INTEGER REFERENCES users(id),
    approved_by_name TEXT,
    approved_at DATETIME,
    posted_by INTEGER REFERENCES users(id),
    posted_by_name TEXT,
    posted_at DATETIME,
    reversed_by INTEGER REFERENCES users(id),
    reversed_by_name TEXT,
    reversed_at DATETIME,
    reversal_reason TEXT,
    reversal_ref_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_journal_balance CHECK (total_debit > 0 AND abs(total_debit - total_credit) < 0.001)
);

-- مشغلات حماية التوازن المحاسبي الصارم (منع أي إدراج أو تعديل غير متوازن)
CREATE TRIGGER IF NOT EXISTS trg_enforce_journal_balance_insert
BEFORE INSERT ON journal_entries
BEGIN
  SELECT CASE 
    WHEN (NEW.total_debit <= 0 OR abs(NEW.total_debit - NEW.total_credit) > 0.001)
    THEN RAISE(ABORT, '⛔ خطأ محاسبي: لا يمكن حفظ قيد غير متزن! إجمالي المدين يجب أن يساوي إجمالي الدائن.')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_enforce_journal_balance_update
BEFORE UPDATE ON journal_entries
BEGIN
  SELECT CASE 
    WHEN (NEW.total_debit <= 0 OR abs(NEW.total_debit - NEW.total_credit) > 0.001)
    THEN RAISE(ABORT, '⛔ خطأ محاسبي: لا يمكن تحديث قيد ليصبح غير متزن! إجمالي المدين يجب أن يساوي إجمالي الدائن.')
  END;
END;

-- 16. سطور القيود اليومية (طرفين مدين ودائن)
CREATE TABLE IF NOT EXISTS journal_entry_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER REFERENCES journal_entries(id) ON DELETE CASCADE,
    account_id INTEGER REFERENCES accounts(id),
    project_id INTEGER REFERENCES projects(id),
    cost_center_id INTEGER REFERENCES cost_centers(id),
    debit REAL DEFAULT 0,
    credit REAL DEFAULT 0,
    notes TEXT
);

-- 17. إعدادات النظام ومعلومات الشركة
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT
);

-- الموارد البشرية: الموظفون، الحضور، الإجازات، السلف ومسيرات الرواتب
CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT, employee_no TEXT UNIQUE NOT NULL, full_name TEXT NOT NULL,
    national_id TEXT, phone TEXT, job_title TEXT, department TEXT, project_id INTEGER REFERENCES projects(id),
    employment_type TEXT DEFAULT 'دوام كامل', hire_date DATE, basic_salary REAL DEFAULT 0, currency TEXT DEFAULT 'ر.ي',
    status TEXT DEFAULT 'active', bank_name TEXT, bank_account TEXT, notes TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    date DATE NOT NULL, status TEXT DEFAULT 'present', check_in TEXT, check_out TEXT, overtime_hours REAL DEFAULT 0, notes TEXT,
    UNIQUE(employee_id, date)
);
CREATE TABLE IF NOT EXISTS employee_leaves (
    id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    leave_type TEXT DEFAULT 'سنوية', start_date DATE NOT NULL, end_date DATE NOT NULL, days_count REAL DEFAULT 1, status TEXT DEFAULT 'pending', notes TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS employee_advances (
    id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    amount REAL NOT NULL, recovered_amount REAL DEFAULT 0, installment_amount REAL DEFAULT 0, date DATE NOT NULL, status TEXT DEFAULT 'active', notes TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS payroll (
    id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    payroll_month TEXT NOT NULL, basic_salary REAL DEFAULT 0, overtime_amount REAL DEFAULT 0, deductions REAL DEFAULT 0,
    net_salary REAL DEFAULT 0, status TEXT DEFAULT 'draft', paid_date DATE, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(employee_id, payroll_month)
);

-- ============================================================================
-- جداول إدارة المشاريع الهندسية والمقاولات الـ 14 (Project Management Suite)
-- ============================================================================

-- 1. عقد المشروع (Project Contract)
CREATE TABLE IF NOT EXISTS project_contracts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    contract_no TEXT,
    title TEXT,
    first_party TEXT,       -- المالك / العميل
    second_party TEXT,      -- المقاول: شركة رواسي عدن
    contract_date DATE,
    start_date DATE,
    end_date DATE,
    duration_days INTEGER,
    contract_value REAL DEFAULT 0,
    currency TEXT DEFAULT 'ر.ي',
    advance_payment_pct REAL DEFAULT 0,
    advance_payment_amount REAL DEFAULT 0,
    retention_pct REAL DEFAULT 10,
    penalty_per_day REAL DEFAULT 0,
    max_penalty_pct REAL DEFAULT 10,
    payment_terms TEXT,
    scope_of_work TEXT,
    status TEXT DEFAULT 'ساري', -- مسودة، ساري، مكتمل، ملغي
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. المخططات الهندسية (Engineering Drawings & Schematics)
CREATE TABLE IF NOT EXISTS project_drawings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    drawing_no TEXT NOT NULL,
    title TEXT NOT NULL,
    category TEXT DEFAULT 'معماري', -- معماري، إنشائي، كهروميكانيكي MEP، تنفيذي Shop Drawing، كما نفذ As-Built، أخرى
    scale TEXT DEFAULT '1:100',
    revision TEXT DEFAULT 'Rev 0',
    submission_date DATE,
    approval_date DATE,
    status TEXT DEFAULT 'معتمد', -- معتمد، معتمد بملاحظات، قيد المراجعة، مرفوض
    engineer_name TEXT,
    file_name TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. جدول الكميات BOQ (Bill of Quantities)
CREATE TABLE IF NOT EXISTS project_boq (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    item_no TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT DEFAULT 'أعمال خرسانية', -- أعمال ترابية وحفر، أعمال خرسانية، أعمال مباني وعزل، أعمال تشطيبات، أعمال كهروميكانيكية، أعمال خارجية
    unit TEXT NOT NULL, -- م3، م2، م.ط، طن، كجم، حبة، مقطوع، نقطة
    contract_qty REAL DEFAULT 0,
    executed_qty REAL DEFAULT 0,
    unit_rate REAL DEFAULT 0,
    total_amount REAL DEFAULT 0,
    status TEXT DEFAULT 'جاري التنفيذ', -- لم يبدأ، جاري التنفيذ، مكتمل
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4. عروض الأسعار (Quotations & Price Offers)
CREATE TABLE IF NOT EXISTS project_quotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    client_id INTEGER REFERENCES clients(id),
    quotation_no TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    date DATE NOT NULL,
    valid_until DATE,
    items_json TEXT,
    subtotal REAL DEFAULT 0,
    discount REAL DEFAULT 0,
    tax_vat REAL DEFAULT 0,
    total_amount REAL DEFAULT 0,
    currency TEXT DEFAULT 'ر.ي',
    payment_terms TEXT,
    delivery_period TEXT,
    status TEXT DEFAULT 'مسودة', -- مسودة، مُرسل، معتمد، مرفوض
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 5. الميزانية والتكلفة المستهدفة (Budget & Target Cost)
CREATE TABLE IF NOT EXISTS project_budgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    category TEXT NOT NULL, -- مواد بناء، أجور عمالة ومقاولين، معدات وآليات، نقل ومحروقات، مصاريف موقع وإشراف، نثريات وطوارئ
    planned_cost REAL DEFAULT 0,
    actual_cost REAL DEFAULT 0,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 6. أوامر التغيير والإضافيات (Change Orders & Variations)
CREATE TABLE IF NOT EXISTS project_change_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    change_no TEXT NOT NULL,
    title TEXT NOT NULL,
    type TEXT DEFAULT 'إضافة بند جديد', -- إضافة بند جديد، تعديل كميات ومواصفات، حذف واستبعاد
    request_date DATE NOT NULL,
    approval_date DATE,
    amount REAL DEFAULT 0,
    time_extension_days INTEGER DEFAULT 0,
    reason TEXT DEFAULT 'طلب المالك', -- طلب المالك، تعديل تصميمي، ظروف الموقع، أخرى
    status TEXT DEFAULT 'معتمد', -- مسودة، قيد المراجعة، معتمد، مرفوض
    requested_by TEXT,
    approved_by TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 7. فواتير ومشتريات المشروع المباشرة (Project Purchases & Invoices)
CREATE TABLE IF NOT EXISTS project_purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    invoice_no TEXT,
    supplier_id INTEGER REFERENCES suppliers(id),
    supplier_name TEXT,
    item_description TEXT NOT NULL,
    quantity REAL DEFAULT 1,
    unit TEXT,
    unit_price REAL DEFAULT 0,
    total_amount REAL NOT NULL,
    paid_amount REAL DEFAULT 0,
    payment_status TEXT DEFAULT 'مدفوع', -- مدفوع، مدفوع جزئي، غير مدفوع
    payment_method TEXT DEFAULT 'نقدي',
    date DATE NOT NULL,
    receipt_no TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 8. العمالة والمصروفات الميدانية (Labor & Site Expenses)
CREATE TABLE IF NOT EXISTS project_labor_expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    worker_name_or_team TEXT NOT NULL,
    trade TEXT NOT NULL, -- نجار مسلح، حداد تسليح، بناء، معلم لياسة، كهربائي، سباك، عمالة عادية، مقاول باطن
    workers_count INTEGER DEFAULT 1,
    daily_rate REAL DEFAULT 0,
    days_or_hours REAL DEFAULT 1,
    total_amount REAL NOT NULL,
    expense_category TEXT DEFAULT 'أجور عمالة', -- أجور عمالة، مقطوعية مقاول باطن، محروقات معدات، نثريات وضيافة موقع
    payment_status TEXT DEFAULT 'مدفوع', -- مدفوع، مستحق
    supervisor_name TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 9. مستخلصات وشهادات دفع المشروع (Project Invoices & Interim Payment Certificates)
CREATE TABLE IF NOT EXISTS project_invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    client_id INTEGER REFERENCES clients(id),
    invoice_no TEXT NOT NULL,
    invoice_type TEXT DEFAULT 'مستخلص جاري', -- مستخلص جاري، مستخلص ختامي، دفعة مقدمة
    period_from DATE,
    period_to DATE,
    cumulative_work_done REAL DEFAULT 0,
    previous_bills_amount REAL DEFAULT 0,
    current_gross_amount REAL DEFAULT 0,
    advance_deduction REAL DEFAULT 0,
    retention_deduction REAL DEFAULT 0,
    other_deductions REAL DEFAULT 0,
    net_amount REAL NOT NULL,
    status TEXT DEFAULT 'معتمد للصرف', -- مسودة، مقدم للاستشاري، معتمد للصرف، محصل جزئي، محصل كامل
    date DATE NOT NULL,
    approval_date DATE,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 10. التقارير اليومية للموقع (Daily Site Reports)
CREATE TABLE IF NOT EXISTS project_daily_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    report_no TEXT NOT NULL,
    date DATE NOT NULL,
    weather TEXT DEFAULT 'مشمس ومناسب للعمل',
    manpower_count INTEGER DEFAULT 0,
    equipment_summary TEXT,
    work_performed TEXT NOT NULL,
    materials_received TEXT,
    safety_notes TEXT,
    delays_obstacles TEXT,
    site_engineer TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 11. التقارير الأسبوعية للموقع (Weekly Site Reports)
CREATE TABLE IF NOT EXISTS project_weekly_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    report_no TEXT NOT NULL,
    week_no INTEGER DEFAULT 1,
    date_from DATE NOT NULL,
    date_to DATE NOT NULL,
    planned_progress_pct REAL DEFAULT 0,
    actual_progress_pct REAL DEFAULT 0,
    achievements_summary TEXT NOT NULL,
    next_week_plan TEXT,
    critical_issues TEXT,
    prepared_by TEXT,
    approved_by TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 12. محاضر الاستلام والفحص الهندسي (Handover & Inspection Minutes)
CREATE TABLE IF NOT EXISTS project_handover_minutes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    minute_no TEXT NOT NULL,
    type TEXT NOT NULL, -- استلام نجارة مسلحة، استلام حدادة مسلحة، استلام صب خرسانة، استلام أعمال مباني ولياسة، استلام كهروميكانيكي، محضر استلام ابتدائي، محضر استلام نهائي
    location_axis TEXT,
    inspection_date DATE NOT NULL,
    inspector_name TEXT NOT NULL,
    contractor_rep TEXT,
    status TEXT DEFAULT 'معتمد ومقبول', -- معتمد ومقبول، مقبول بملاحظات، مرفوض ويعاد الفحص
    punch_list TEXT,
    recommendations TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 13. المراسلات والخطابات مع المالك والاستشاري (Correspondence & Transmittals)
CREATE TABLE IF NOT EXISTS project_correspondence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    ref_no TEXT NOT NULL,
    direction TEXT NOT NULL, -- صادر إلى المالك، صادر إلى الاستشاري، وارد من المالك، وارد من الاستشاري
    subject TEXT NOT NULL,
    date DATE NOT NULL,
    priority TEXT DEFAULT 'عادي', -- عادي، هام، عاجل جداً
    summary_body TEXT NOT NULL,
    required_action TEXT,
    response_status TEXT DEFAULT 'قيد الإجراء', -- قيد الإجراء، تم الرد، منتهي ومغلق
    sender TEXT,
    recipient TEXT,
    attachment_name TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 14. الحساب الختامي وتصفية المشروع (Final Account & Project Settlement)
CREATE TABLE IF NOT EXISTS project_final_settlements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    settlement_no TEXT NOT NULL UNIQUE,
    date DATE NOT NULL,
    original_contract_val REAL DEFAULT 0,
    approved_change_orders_val REAL DEFAULT 0,
    revised_contract_val REAL DEFAULT 0,
    total_executed_work_val REAL DEFAULT 0,
    total_client_payments_received REAL DEFAULT 0,
    released_retention_val REAL DEFAULT 0,
    penalties_deductions_val REAL DEFAULT 0,
    final_balance_due REAL DEFAULT 0,
    due_to TEXT DEFAULT 'لصالح المقاول', -- لصالح المقاول، لصالح المالك
    status TEXT DEFAULT 'معتمد وموقع', -- مسودة، معتمد وموقع، مغلق ومصفى
    prepared_by TEXT,
    approved_by TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ========================================================
-- جداول الإدارات المؤسسية الجديدة (ERP Modules Support)
-- ========================================================

-- جدول تهيئة العملات وأسعار الصرف
CREATE TABLE IF NOT EXISTS currencies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,          -- YER, SAR, USD
    name TEXT NOT NULL,                 -- ريال يمني، ريال سعودي، دولار أمريكي
    symbol TEXT NOT NULL,               -- ر.ي، ر.س، $
    rate_to_base REAL DEFAULT 1.0,      -- سعر الصرف مقابل العملة الأساسية (الريال اليمني)
    is_base INTEGER DEFAULT 0,          -- 1 إذا كانت العملة الأساسية
    status TEXT DEFAULT 'active',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- جدول تهيئة أنواع الإجازات
CREATE TABLE IF NOT EXISTS leave_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,          -- سنوية، مرضية، طارئة، بدون راتب، حج/عمرة
    days_allowed INTEGER DEFAULT 30,    -- رصيد الأيام المسموح بها سنوياً
    is_paid INTEGER DEFAULT 1,          -- 1 مدفوعة، 0 غير مدفوعة
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- جدول تقييم أداء الموظفين
CREATE TABLE IF NOT EXISTS employee_evaluations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    evaluator_name TEXT,
    period TEXT NOT NULL,               -- شهري، ربع سنوي، سنوي
    evaluation_date DATE NOT NULL,
    score REAL DEFAULT 100,             -- الدرجة من 100
    rating TEXT DEFAULT 'ممتاز',        -- ممتاز، جيد جداً، جيد، مقبول، ضعيف
    strengths TEXT,                     -- نقاط القوة
    improvements TEXT,                  -- مجالات التطوير
    recommendations TEXT,               -- توصيات الحوافز والترقيات
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- جدول الفترات المحاسبية وإغلاق الحسابات
CREATE TABLE IF NOT EXISTS accounting_periods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period_name TEXT NOT NULL,
    fiscal_year INTEGER NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status TEXT DEFAULT 'open',          -- open, closed
    closed_at DATETIME NULL,
    closed_by TEXT NULL,
    reopened_at DATETIME NULL,
    reopened_by TEXT NULL,
    reopen_reason TEXT NULL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- جدول سجل التدقيق والرقابة المالية (Audit Log)
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NULL,
    username TEXT NOT NULL,
    action TEXT NOT NULL,                -- INSERT, UPDATE, DELETE, CLOSE_PERIOD, REOPEN_PERIOD, POST_PAYROLL
    entity_type TEXT NOT NULL,           -- journal_entry, payment, expense, custody, payroll, project, period
    entity_id TEXT NULL,
    details TEXT NULL,
    old_values TEXT NULL,                -- JSON state before modification
    new_values TEXT NULL,                -- JSON state after modification
    reason TEXT NULL,                    -- سبب التغيير أو العكس الإلزامي
    ip_address TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);


