const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {spawnSync}=require('node:child_process');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'rawasi-tests-'));const root=path.resolve(__dirname,'..');
const env={...process.env,NODE_ENV:'development',DB_ENGINE:'sqlite',RAWASI_DB_PATH:path.join(temp,'fixture.db'),RAWASI_UPLOAD_DIR:path.join(temp,'uploads'),RAWASI_PROJECTS_DIR:path.join(temp,'projects'),RAWASI_BACKUP_DIR:path.join(temp,'backups'),RAWASI_SCRATCH_DIR:path.join(temp,'scratch'),ENABLE_SCHEDULERS:'false',BANK_ENCRYPTION_KEY:require('node:crypto').randomBytes(48).toString('hex'),JWT_SECRET:require('node:crypto').randomBytes(48).toString('hex'),CLIENT_JWT_SECRET:require('node:crypto').randomBytes(48).toString('hex')};
const files=['project_budget_presentation','financial_presentation','report_filters','voucher_ui','financial_save_ui','account_cost_center','account_numbering','reporting_pending_ledger','pending_cash_movements','supporting_documents','sidebar_navigation'].map(n=>'tests/'+n+'.test.js');
files.push(...['financial_report_filters','journal_reference_posting','party_registry','financial_save_delete'].map(n=>'tests/integration/'+n+'.test.js'));
if(fs.existsSync(path.join(root,'tests/security/hardening.test.js')))files.push('tests/security/hardening.test.js');
try{
 let result=spawnSync(process.execPath,['tests/create_fixture.js'],{cwd:root,env,stdio:'inherit',windowsHide:true});
 if(result.status===0){env.TEST_SOURCE_DB_PATH=env.RAWASI_DB_PATH;result=spawnSync(process.execPath,['--test','--test-concurrency=1',...files],{cwd:root,env,stdio:'inherit',windowsHide:true});}
 process.exitCode=result.status??1;
}finally{fs.rmSync(temp,{recursive:true,force:true});}
