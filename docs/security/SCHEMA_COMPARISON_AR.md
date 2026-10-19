# مقارنة المخططين — 2026-10-19

هذه مقارنة بنيوية بين قاعدة SQLite تجريبية أُنشئت من الكود الحالي وملف schema_mysql.sql. ليست نتيجة تشغيل MySQL أو ضمان توافق الاستعلامات. قد تضيف ترحيلات MySQL المضمنة جداول أخرى؛ لذلك يجب اختبار ناتج تشغيلها أيضاً.

- جداول SQLite بعد التهيئة: 108.
- الجداول المعلنة في schema_mysql.sql: 41.
- جداول SQLite غير المعلنة في ملف MySQL: 67.

## جداول تحتاج مراجعة

`branches`, `departments`, `vendor_industry_categories`, `vendor_payment_document_types`, `accounting_periods`, `audit_logs`, `purchase_requisitions`, `purchase_requisition_items`, `rfqs`, `rfq_vendor_quotes`, `purchase_orders`, `purchase_order_items`, `goods_receipt_notes`, `goods_receipt_items`, `warehouses`, `warehouse_stocks`, `inventory_transfers`, `inventory_returns`, `inventory_adjustments`, `inventory_valuation_layers`, `inventory_audits`, `inventory_audit_items`, `material_quarantine_items`, `site_material_returns`, `inter_project_material_transfers`, `material_domain_events`, `bank_accounts`, `bank_statements`, `bank_statement_lines`, `bank_reconciliations`, `cheques`, `tax_configs`, `tax_withholdings`, `bank_guarantees`, `project_wbs_activities`, `project_wbs_dependencies`, `project_wbs_baselines`, `project_engineer_certifications`, `project_evm_snapshots`, `project_risk_register`, `project_claims_register`, `project_non_conformance`, `project_rfi`, `project_wbs_resources`, `project_closeouts`, `project_closeout_client_boq`, `project_closeout_internal_audit_boq`, `cash_flow_account_mappings`, `party_account_mappings`, `party_sequences`, `contract_revenue_recognitions`, `project_variations`, `project_progress_history`, `client_users`, `client_project_access`, `client_notifications`, `client_messages`, `engineering_services`, `service_requests`, `service_request_items`, `payment_methods`, `financial_accounts`, `payment_settlements`, `payment_refunds`, `backup_records`, `restore_operations`, `backup_test_logs`

## أعمدة غير معلنة في ملف MySQL

| الجدول | الأعمدة |
|---|---|
| users | branch_id, branch, department_id, department, allowed_projects, allowed_branches, allowed_departments |
| clients | tax_number |
| suppliers | company_name, industry_category, contact_person, phone_number, bank_name, bank_account_no, bank_iban, bank_details_encrypted, default_currency, supply_lead_time_days, payment_document_type, status, tax_id, commercial_reg_no, credit_limit, updated_at, tax_number, invoice_attachment |
| items | costing_method, reorder_level, safety_stock, has_batch_tracking |
| inventory_transactions | warehouse_id, boq_item_id, batch_number, serial_number |
| purchases | status, created_by, created_by_name, reviewed_by, reviewed_by_name, reviewed_at, review_notes, approved_by, approved_by_name, approved_at, approval_notes, posted_by, posted_by_name, posted_at, reversed_by, reversed_by_name, reversed_at, reversal_reason, reversal_ref_id, journal_entry_id, po_id, grn_id, matching_status, matching_notes |
| expenses | reference_no, status, created_by, created_by_name, reviewed_by, reviewed_by_name, reviewed_at, review_notes, approved_by, approved_by_name, approved_at, approval_notes, posted_by, posted_by_name, posted_at, reversed_by, reversed_by_name, reversed_at, reversal_reason, reversal_ref_id, supplier_name, exchange_rate, local_amount, settlement_account_id, journal_entry_id, bank_account_id |
| bills | contract_id, gross_amount, advance_deduction, retention_deduction, paid_amount, remaining_amount, payment_status, created_by, created_by_name, reviewed_by, reviewed_by_name, reviewed_at, review_notes, approved_by, approved_by_name, approved_at, approval_notes, posted_by, posted_by_name, posted_at, reversed_by, reversed_by_name, reversed_at, reversal_reason, reversal_ref_id, journal_entry_id, tax_wht_rate, tax_wht_amount, client_approval_status, client_approved_at, client_approval_notes, client_approved_by_id |
| payments | settlement_account_id |
| cash_movements | account_id, movement_type, payment_method, reference_no, project_id |
| accounts | level, is_posting, status |
| employees | employee_no, full_name, phone, job_title, department, employment_type, hire_date, currency, status, bank_account, notes, created_at |
| attendance | employee_id, date, status, check_out, overtime_hours, notes |
| employee_leaves | employee_id, leave_type, start_date, end_date, status, notes, created_at |
| employee_advances | employee_id, amount, recovered_amount, date, status, notes, created_at |
| payroll | employee_id, payroll_month, basic_salary, deductions, net_salary, paid_date, created_at, journal_entry_id |
| project_purchases | linked_expense_id |
| project_labor_expenses | linked_expense_id |
| project_invoices | items_json, advance_pct, retention_pct, tax_wht_pct, tax_wht_amount |
| project_daily_reports | manpower_details, equipment_details, materials_details, photos, gps_lat, gps_lng, temperature, status, approved_by, approved_at |
| supporting_documents | entity_type, entity_id, mime_type, size_bytes, created_at |

القرار: إبقاء SQLite مؤقتاً، وعدم ترحيل الإنتاج إلى MySQL قبل نجاح اختبارات مخططه الفعلي والمعاملات والتقارير ونقل البيانات.
