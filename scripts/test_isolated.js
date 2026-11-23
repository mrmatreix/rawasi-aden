const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {spawnSync}=require('node:child_process');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'rawasi-tests-'));const root=path.resolve(__dirname,'..');
const envFor=dir=>({...process.env,NODE_ENV:'development',DB_ENGINE:'sqlite',RAWASI_DB_PATH:path.join(dir,'fixture.db'),RAWASI_UPLOAD_DIR:path.join(dir,'uploads'),RAWASI_PROJECTS_DIR:path.join(dir,'projects'),RAWASI_BACKUP_DIR:path.join(dir,'backups'),RAWASI_SCRATCH_DIR:path.join(dir,'scratch'),ENABLE_SCHEDULERS:'false',BANK_ENCRYPTION_KEY:require('node:crypto').randomBytes(48).toString('hex'),JWT_SECRET:require('node:crypto').randomBytes(48).toString('hex'),CLIENT_JWT_SECRET:require('node:crypto').randomBytes(48).toString('hex')});
const env=envFor(temp);
const files=['project_budget_presentation','financial_presentation','report_filters','voucher_ui','financial_save_ui','account_cost_center','account_numbering','reporting_pending_ledger','pending_cash_movements','supporting_documents','sidebar_navigation'].map(n=>'tests/'+n+'.test.js');
files.push(...['financial_report_filters','journal_reference_posting','party_registry','financial_save_delete','journal_posting_periods'].map(n=>'tests/integration/'+n+'.test.js'));
files.push('tests/integration/ledger_integrity.test.js');
files.push('tests/integration/chart_of_accounts_repair.test.js');
files.push('tests/integration/posting_numbering.test.js');
files.push('tests/integration/billing_lifecycle.test.js');
files.push('tests/integration/voucher_rules.test.js');
files.push('tests/integration/reversal_service.test.js');
files.push('tests/integration/payroll_posting.test.js');
files.push('tests/integration/inventory_bank_posting.test.js');
files.push('tests/integration/subledger.test.js');
files.push('tests/integration/platform_errors_migrations.test.js');
files.push('tests/integration/period_closing.test.js');
files.push('tests/journal_posting_ui.test.js');
files.push('tests/integration/cash_flow_projection.test.js');
files.push('tests/cash_flow_ui.test.js');
files.push('tests/dialogs_ui.test.js');
files.push('tests/client_states_ui.test.js');
files.push('tests/design_tokens.test.js');
files.push('tests/integration/sales_creation.test.js');
files.push('tests/integration/project_setup.test.js');
files.push('tests/integration/settings_access.test.js');
files.push('tests/integration/service_request_workflow.test.js');
files.push('tests/integration/service_request_retention.test.js');
files.push('tests/integration/guest_message_journey.test.js');
files.push('tests/integration/supervisor_scope.test.js');
files.push('tests/integration/global_search.test.js');
files.push('tests/security/staff_login_lock.test.js');
files.push('tests/security/staff_cookie_session.test.js');
if(fs.existsSync(path.join(root,'tests/security/hardening.test.js')))files.push('tests/security/hardening.test.js');
// Safety net: suites that used to sit outside npm test. They write to the fixture database directly, so each one
// runs on its own fresh fixture instead of the shared one the suites above copy from.
const ownFixture=[...['accounting_rules','chart_of_accounts_vouchers','date_validation_and_api_errors','payroll_statutory','period_locking','tafqeet'].map(n=>'tests/unit/'+n+'.test.js'),
 'tests/client_portal.test.js','tests/disaster_recovery_engine.test.js',
 ...['client_lifecycle_chain','financial_control_lifecycle','period_closing_auth','project_control','project_cost_unification','supplier_payables','mirror_journals','labor_payables','project_cost_dedup',
  'api','vendor_srm_profile','material_management_ddd','enterprise_procurement_inventory_banking_tax','project_closeout_cqrs','rbac_security','two_factor_auth_pin',
  'sox_financial_control_audit','auto_backup_scheduler','encrypted_cloud_backup',
  'custody_cash_close','financial_reports','contracting_revenue_separation','contracting_matrix_cost'].map(n=>'tests/integration/'+n+'.test.js'),
 'tests/reports/financial_reporting_suite.test.js'];
const runOn=(e,list)=>{let result=spawnSync(process.execPath,['tests/create_fixture.js'],{cwd:root,env:e,stdio:'inherit',windowsHide:true});
 if(result.status===0){e.TEST_SOURCE_DB_PATH=e.RAWASI_DB_PATH;result=spawnSync(process.execPath,['--test','--test-concurrency=1',...list],{cwd:root,env:e,stdio:'inherit',windowsHide:true});}
 return result.status??1;};
try{
 let status=runOn(env,files);const failed=[];
 for(const file of ownFixture){const dir=fs.mkdtempSync(path.join(temp,'own-'));if(runOn(envFor(dir),[file])!==0)failed.push(file);}
 if(failed.length){console.error('\n✖ safety-net suites failed: '+failed.join(', '));status=status||1;}
 else console.log('\n✔ safety-net suites passed: '+ownFixture.length);
 process.exitCode=status;
}finally{fs.rmSync(temp,{recursive:true,force:true});}
