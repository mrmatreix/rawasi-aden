-- ============================================================================
-- هجرة قاعدة البيانات: نظام تصنيف المدفوعات الخماسي الطبقات (5-Layer Payment System)
-- مشروع: رواسي عدن للهندسة والمقاولات
-- متوافق مع SQLite و MySQL
-- ============================================================================

-- 1. جدول سياق الدفع (Payment Contexts) — الطبقة 1
CREATE TABLE IF NOT EXISTS payment_contexts (
    code VARCHAR(30) PRIMARY KEY,
    name_ar VARCHAR(100) NOT NULL,
    name_en VARCHAR(100) NOT NULL,
    icon VARCHAR(50) DEFAULT 'fa-coins',
    default_debit_account_code VARCHAR(50),
    default_credit_account_code VARCHAR(50),
    requires_ipc INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. جدول وسائل الدفع (Payment Instruments) — الطبقة 2
CREATE TABLE IF NOT EXISTS payment_instruments (
    code VARCHAR(30) PRIMARY KEY,
    name_ar VARCHAR(100) NOT NULL,
    name_en VARCHAR(100) NOT NULL,
    icon VARCHAR(50) DEFAULT 'fa-money-bill',
    category VARCHAR(50) NOT NULL DEFAULT 'bank', -- cash, bank, electronic
    requires_bank INTEGER DEFAULT 0,
    requires_cheque INTEGER DEFAULT 0,
    requires_iban INTEGER DEFAULT 0,
    requires_wallet_phone INTEGER DEFAULT 0,
    max_amount DECIMAL(15, 2) DEFAULT NULL,
    fee_percentage DECIMAL(5, 2) DEFAULT 0.00,
    clearance_days INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. جدول قنوات الدفع (Payment Channels) — الطبقة 3
CREATE TABLE IF NOT EXISTS payment_channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code VARCHAR(30) NOT NULL UNIQUE,
    name_ar VARCHAR(100) NOT NULL,
    name_en VARCHAR(100) NOT NULL,
    icon VARCHAR(50) DEFAULT 'fa-building',
    type VARCHAR(50) NOT NULL DEFAULT 'bank', -- cash_box, local_bank, intl_bank, psp, ips_network
    bank_name VARCHAR(100),
    account_number VARCHAR(50),
    iban VARCHAR(50),
    swift_code VARCHAR(20),
    account_id INTEGER REFERENCES accounts(id),
    currency VARCHAR(10) DEFAULT 'YER',
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4. جدول توقيتات الدفع (Payment Timings) — الطبقة 4
CREATE TABLE IF NOT EXISTS payment_timings (
    code VARCHAR(30) PRIMARY KEY,
    name_ar VARCHAR(100) NOT NULL,
    name_en VARCHAR(100) NOT NULL,
    icon VARCHAR(50) DEFAULT 'fa-clock',
    default_days INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 5. جدول مستندات الدفع (Payment Documents) — الطبقة 5
CREATE TABLE IF NOT EXISTS payment_documents (
    code VARCHAR(30) PRIMARY KEY,
    name_ar VARCHAR(100) NOT NULL,
    name_en VARCHAR(100) NOT NULL,
    icon VARCHAR(50) DEFAULT 'fa-file-alt',
    requires_file INTEGER DEFAULT 0,
    requires_number INTEGER DEFAULT 1,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 6. جدول المعاملات المالية الموحد الرئيسي (Payment Transactions)
CREATE TABLE IF NOT EXISTS payment_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_no VARCHAR(50) NOT NULL UNIQUE,
    transaction_date DATE NOT NULL,
    direction VARCHAR(5) NOT NULL CHECK (direction IN ('IN', 'OUT')),
    context_code VARCHAR(30) NOT NULL REFERENCES payment_contexts(code),
    context_ref_id INTEGER,
    instrument_code VARCHAR(30) NOT NULL REFERENCES payment_instruments(code),
    instrument_details TEXT, -- JSON structure for cheque_no, bank_name, iban, wallet_phone
    channel_id INTEGER NOT NULL REFERENCES payment_channels(id),
    timing_code VARCHAR(30) NOT NULL DEFAULT 'IMMEDIATE' REFERENCES payment_timings(code),
    scheduled_date DATE,
    actual_date DATE,
    clearing_status VARCHAR(20) DEFAULT 'cleared' CHECK (clearing_status IN ('pending', 'cleared', 'bounced')),
    document_code VARCHAR(30) NOT NULL DEFAULT 'MANUAL' REFERENCES payment_documents(code),
    document_number VARCHAR(100),
    document_file_url TEXT,
    client_id INTEGER REFERENCES clients(id),
    supplier_id INTEGER REFERENCES suppliers(id),
    project_id INTEGER REFERENCES projects(id),
    contract_id INTEGER REFERENCES project_contracts(id),
    cost_center_id INTEGER REFERENCES cost_centers(id),
    debit_account_id INTEGER NOT NULL REFERENCES accounts(id),
    credit_account_id INTEGER NOT NULL REFERENCES accounts(id),
    amount DECIMAL(15, 2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'USD',
    exchange_rate DECIMAL(10, 4) DEFAULT 1.0000,
    local_amount DECIMAL(15, 2) NOT NULL,
    fee_amount DECIMAL(15, 2) DEFAULT 0.00,
    net_amount DECIMAL(15, 2) NOT NULL,
    journal_entry_id INTEGER REFERENCES journal_entries(id),
    status VARCHAR(20) DEFAULT 'posted' CHECK (status IN ('draft', 'pending', 'approved', 'posted', 'bounced', 'reversed', 'cancelled')),
    notes TEXT,
    created_by INTEGER REFERENCES users(id),
    approved_by INTEGER REFERENCES users(id),
    posted_by INTEGER REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- الفهارس العالية الأداء على الأعمدة الحرجة
CREATE INDEX IF NOT EXISTS idx_pay_tx_no ON payment_transactions(transaction_no);
CREATE INDEX IF NOT EXISTS idx_pay_tx_date ON payment_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_pay_tx_direction ON payment_transactions(direction);
CREATE INDEX IF NOT EXISTS idx_pay_tx_context ON payment_transactions(context_code);
CREATE INDEX IF NOT EXISTS idx_pay_tx_instrument ON payment_transactions(instrument_code);
CREATE INDEX IF NOT EXISTS idx_pay_tx_channel ON payment_transactions(channel_id);
CREATE INDEX IF NOT EXISTS idx_pay_tx_timing ON payment_transactions(timing_code);
CREATE INDEX IF NOT EXISTS idx_pay_tx_status ON payment_transactions(status);
CREATE INDEX IF NOT EXISTS idx_pay_tx_clearing ON payment_transactions(clearing_status);
CREATE INDEX IF NOT EXISTS idx_pay_tx_project ON payment_transactions(project_id);
CREATE INDEX IF NOT EXISTS idx_pay_tx_client ON payment_transactions(client_id);
CREATE INDEX IF NOT EXISTS idx_pay_tx_supplier ON payment_transactions(supplier_id);
CREATE INDEX IF NOT EXISTS idx_pay_tx_je ON payment_transactions(journal_entry_id);

-- ============================================================================
-- البذور الأساسية المرجعية (Seed Data)
-- ============================================================================

-- الطبقة 1: سياق الدفع (Contexts)
INSERT OR REPLACE INTO payment_contexts (code, name_ar, name_en, icon, default_debit_account_code, default_credit_account_code, requires_ipc, is_active, sort_order) VALUES
('ADVANCE',   'دفعة مقدمة (Advance Payment)',           'Advance Payment',           'fa-hand-holding-usd',      '12401001', '21101001', 0, 1, 1),
('IPC',       'دفعة مرحلية / مستخلص (Progress / IPC)',   'Progress Payment (IPC)',     'fa-file-invoice-dollar',   '12401001', '41101001', 1, 1, 2),
('FINAL',     'دفعة نهائية (Final Payment)',             'Final Payment',             'fa-check-circle',          '12401001', '41101001', 1, 1, 3),
('RETENTION', 'إفراج ضمان (Retention Release)',          'Retention Release',         'fa-shield-alt',            '12501001', '21201001', 0, 1, 4),
('SERVICE',   'إيراد خدمات واستشارات (Services)',       'Services / Consulting',     'fa-concierge-bell',        '12101001', '41201001', 0, 1, 5),
('MISC',      'تحصيل / صرف متنوع (Miscellaneous)',      'Miscellaneous Payment',     'fa-receipt',               '12101001', '42101001', 0, 1, 6);

-- الطبقة 2: وسائل الدفع (Instruments)
INSERT OR REPLACE INTO payment_instruments (code, name_ar, name_en, icon, category, requires_bank, requires_cheque, requires_iban, requires_wallet_phone, max_amount, fee_percentage, clearance_days, is_active) VALUES
('CASH',     'نقدي (Cash)',                     'Cash',                    'fa-money-bill-wave', 'cash',       0, 0, 0, 0, 500.00,  0.00, 0, 1),
('BANK_TRF', 'تحويل بنكي (Bank Transfer)',       'Bank Transfer',           'fa-university',      'bank',       1, 0, 1, 0, NULL,    0.00, 1, 1),
('CHEQUE',   'شيك مصرفي (Cheque)',               'Cheque',                  'fa-money-check-alt', 'bank',       1, 1, 0, 0, NULL,    0.00, 3, 1),
('LC',       'اعتماد مستندي (Letter of Credit)', 'Letter of Credit (LC)',   'fa-file-contract',   'bank',       1, 0, 1, 0, NULL,    0.50, 5, 1),
('WALLET',   'محفظة رقمية (Digital Wallet)',    'Digital Wallet',          'fa-wallet',          'electronic', 0, 0, 0, 1, 2000.00, 1.00, 0, 1),
('IPS',      'تحويل فوري (Instant Payment)',    'Instant Payment (IPS)',   'fa-bolt',            'electronic', 1, 0, 0, 0, NULL,    0.25, 0, 1);

-- الطبقة 3: قنوات الدفع (Channels)
INSERT OR REPLACE INTO payment_channels (id, code, name_ar, name_en, icon, type, bank_name, account_number, iban, swift_code, account_id, currency, is_active) VALUES
(1, 'CASH_BOX',    'صندوق الصراف الرئيسي',           'Main Cash Box',         'fa-cash-register', 'cash_box',   'الصندوق المباشر',      '12101001', '',                    '',         1, 'YER', 1),
(2, 'LOCAL_BANK',  'بنك التضامن الإسلامي (محلي)',     'Tadhamon Bank',         'fa-building',      'local_bank', 'بنك التضامن الإسلامي', '12201001', 'YE93TADHB00012201001', 'TADHYESA', 2, 'USD', 1),
(3, 'INTL_BANK',   'البنك المركزي اليمن - SWIFT',    'Central Bank (SWIFT)',  'fa-globe',         'intl_bank',  'البنك المركزي اليمني',  '12201002', 'YE93CBYM00012201002', 'CBYMYESA', 2, 'USD', 1),
(4, 'PSP',         'منصة الكريمي باي / PSP',          'Kuraimi PSP',           'fa-mobile-alt',    'psp',        'بنك الكريمي للتمويل',  '12201003', 'YE93KRM00012201003', 'KRMYESA',  3, 'YER', 1),
(5, 'IPS_NETWORK', 'شبكة التحويل الفوري الموحدة',    'IPS Instant Network',   'fa-network-wired', 'ips_network','شبكة IPS الوطنية',     '12201004', 'YE93IPS00012201004', 'IPSYESA',  3, 'YER', 1);

-- الطبقة 4: توقيت الدفع (Timings)
INSERT OR REPLACE INTO payment_timings (code, name_ar, name_en, icon, default_days, is_active) VALUES
('IMMEDIATE',   'فوري (Immediate 0 Days)',   'Immediate (0 Days)',   'fa-clock',            0, 1),
('DEFERRED',    'آجل (Deferred 30 Days)',    'Deferred (30 Days)',   'fa-calendar-alt',    30, 1),
('SCHEDULED',   'مجدول (Scheduled 15 Days)', 'Scheduled (15 Days)',  'fa-calendar-check',  15, 1),
('ON_DELIVERY', 'عند التسليم (On Delivery)', 'On Delivery',          'fa-truck-loading',    0, 1);

-- الطبقة 5: مستندات الدفع (Documents)
INSERT OR REPLACE INTO payment_documents (code, name_ar, name_en, icon, requires_file, requires_number, is_active) VALUES
('MANUAL',      'سند يدوي (Manual Receipt)',              'Manual Receipt',              'fa-file-signature', 0, 1, 1),
('IPC_DOC',     'مستخلص معتمد (Progress Certificate)',   'Progress Certificate (IPC)',  'fa-file-invoice',   1, 1, 1),
('TAX_INV',     'فاتورة ضريبية (Tax Invoice)',            'Tax Invoice',                 'fa-receipt',        1, 1, 1),
('CERTIFICATE', 'شهادة دفع رسمية (Payment Certificate)',  'Official Payment Certificate','fa-certificate',    1, 1, 1);
