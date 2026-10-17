-- ============================================================================
-- هجرة قاعدة البيانات: إصلاح الأعمدة الناقصة وتوافق المخطط مع الاستعلامات
-- Rawasi Aden Contracting System - Critical Schema Alignment Migration
-- متوافق مع SQLite و MySQL
-- ============================================================================

-- 1. جدول عقود المشاريع: توحيد عمود تاريخ التوقيع
-- SQLite يضيف العمود إن لم يكن موجوداً
-- ALTER TABLE project_contracts ADD COLUMN signing_date TEXT;
-- UPDATE project_contracts SET signing_date = contract_date WHERE signing_date IS NULL;

-- 2. جدول المشاريع: إضافة موقع المشروع والوصف
-- ALTER TABLE projects ADD COLUMN location TEXT;
-- ALTER TABLE projects ADD COLUMN description TEXT;

-- 3. جدول أنواع الإجازات: مواءمة أسماء الأعمدة المستخدمة في الـ API
-- ALTER TABLE leave_types ADD COLUMN days_per_year INTEGER DEFAULT 30;
-- ALTER TABLE leave_types ADD COLUMN description TEXT;
-- UPDATE leave_types SET days_per_year = days_allowed WHERE days_per_year IS NULL;
-- UPDATE leave_types SET description = notes WHERE description IS NULL;

-- 4. جدول سلف الموظفين: مواءمة تاريخ الطلب وسبب السلفة
-- ALTER TABLE employee_advances ADD COLUMN request_date DATE;
-- ALTER TABLE employee_advances ADD COLUMN reason TEXT;
-- UPDATE employee_advances SET request_date = date WHERE request_date IS NULL;
-- UPDATE employee_advances SET reason = notes WHERE reason IS NULL;

-- 5. جدول تقييمات الموظفين: مواءمة أعمدة المكافآت والخصومات واسم المقيّم
-- ALTER TABLE employee_evaluations ADD COLUMN bonuses REAL DEFAULT 0;
-- ALTER TABLE employee_evaluations ADD COLUMN deductions REAL DEFAULT 0;
-- ALTER TABLE employee_evaluations ADD COLUMN evaluator TEXT;
-- ALTER TABLE employee_evaluations ADD COLUMN comments TEXT;
-- UPDATE employee_evaluations SET evaluator = evaluator_name WHERE evaluator IS NULL;
-- UPDATE employee_evaluations SET comments = notes WHERE comments IS NULL;

-- 6. جدول أجور عمال المشاريع: عمود المسدد الفعلي
-- ALTER TABLE project_labor_expenses ADD COLUMN paid_amount REAL DEFAULT 0;
-- UPDATE project_labor_expenses SET paid_amount = total_amount WHERE paid_amount IS NULL AND payment_status = 'مدفوع';

-- 7. فهارس الأداء وتفادي القفل
CREATE INDEX IF NOT EXISTS idx_contracts_project_signing ON project_contracts (project_id, signing_date);
CREATE INDEX IF NOT EXISTS idx_projects_client_status ON projects (client_id, status);
CREATE INDEX IF NOT EXISTS idx_journal_entries_date_status ON journal_entries (date, status);
CREATE INDEX IF NOT EXISTS idx_payments_project_date_type ON payments (project_id, date, type, status);
