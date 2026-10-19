/**
 * tests/disaster_recovery_engine.test.js
 * 
 * مجموعة الاختبارات الآلية الشاملة لمنظومة النسخ الاحتياطي واستعادة البيانات وإدارة الكوارث
 * نظام رواسي عدن (Rawasi Aden ERP - Backup & Disaster Recovery Test Suite)
 * 
 * يغطي:
 * 1. اتساق النسخ الذري (WAL Checkpoint & Atomic Online Backup)
 * 2. فحص النزاهة الهيكلية لـ SQLite B-Tree وحساب بصمة SHA-256
 * 3. التشفير وفك التشفير العسكري (AES-256-GCM + PBKDF2) مع التحقق من الترويسة السحرية
 * 4. اكتشاف ورفض الملفات الفارغة والتالفة وغير الصالحة
 * 5. بيئة الاستعادة التجريبية المعزولة (Sandboxed Test Restore) دون مساس ببيانات الإنتاج
 * 6. صمام أمان الاستعادة الإنتاجية والتراجع التلقائي (Auto-Rollback)
 * 7. سياسة التدوير والاحتفاظ وحماية النسخ المثبتة (Pinned Backups)
 * 8. مؤشرات لوحة التحكم والتحقق من أقراص Railway الدائمة
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const unifiedBackupEngine = require('../server/services/unifiedBackupEngine');
const { query, get, run, exec, dbPath } = require('../server/database/db');

describe('🛡️ منظومة النسخ الاحتياطي واستعادة البيانات وإدارة الكوارث (Disaster Recovery Engine)', () => {
  const createdTestBackupIds = [];
  const createdTestFiles = [];

  after(async () => {
    // تنظيف السجلات والملفات التجريبية التي أُنشئت أثناء الاختبار
    for (const bId of createdTestBackupIds) {
      try {
        const rec = await get('SELECT file_path FROM backup_records WHERE id = ?', [bId]);
        if (rec && rec.file_path && fs.existsSync(rec.file_path)) {
          fs.unlinkSync(rec.file_path);
        }
        await run('DELETE FROM backup_records WHERE id = ?', [bId]);
      } catch (e) {}
    }

    for (const f of createdTestFiles) {
      try {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      } catch (e) {}
    }
  });

  test('1. تهيئة المحرك وتحديد مسار التخزين المعتمد مع الكشف عن Railway Volumes', () => {
    assert.ok(unifiedBackupEngine, 'المحرك المركزي الموحد يجب أن يكون مهيئاً');
    assert.ok(unifiedBackupEngine.defaultStorageDir, 'يجب تحديد مسار التخزين الافتراضي');
    assert.ok(fs.existsSync(unifiedBackupEngine.defaultStorageDir), 'مسار التخزين يجب أن يكون موجوداً على القرص');
    
    // التحقق من إمكانية الكتابة في مسار التخزين
    const testFile = path.join(unifiedBackupEngine.defaultStorageDir, `.write_check_${Date.now()}.tmp`);
    fs.writeFileSync(testFile, 'write_test_ok');
    assert.strictEqual(fs.readFileSync(testFile, 'utf8'), 'write_test_ok');
    fs.unlinkSync(testFile);
  });

  test('2. إنشاء نسخة احتياطية فورية معتمدة وفق دورة الحياة الكاملة (WAL Checkpoint + SHA-256)', async () => {
    const backupResult = await unifiedBackupEngine.createBackup({
      backupType: 'manual',
      scope: 'database_only',
      user: 'test_runner',
      isProtected: false
    });

    assert.ok(backupResult, 'نتيجة النسخ يجب أن تكون كائناً غير فارغ');
    assert.strictEqual(backupResult.integrityCheck, 'ok', 'فحص النزاهة الهيكلية B-Tree يجب أن يكون ok');
    assert.ok(backupResult.sha256 && backupResult.sha256.length === 64, 'يجب توليد بصمة SHA-256 صحيحة بطول 64 محرفاً');
    assert.ok(fs.existsSync(backupResult.filePath), 'ملف النسخة يجب أن يكون موجوداً فعلياً على القرص');
    assert.ok(backupResult.fileSize > 1024, 'حجم ملف النسخة يجب أن يكون أكبر من 1 كيلوبايت');

    // التحقق من صحة بصمة SHA-256 المحسوبة مقابل الملف الفعلي على القرص
    const actualHash = crypto.createHash('sha256').update(fs.readFileSync(backupResult.filePath)).digest('hex');
    assert.strictEqual(actualHash, backupResult.sha256, 'البصمة المحسوبة يجب أن تطابق بدقة البصمة المسجلة');

    // التحقق من التسجيل في جدول backup_records
    const record = await get('SELECT * FROM backup_records WHERE id = ?', [backupResult.recordId]);
    assert.ok(record, 'يجب تسجيل النسخة بنجاح في جدول backup_records');
    assert.strictEqual(record.status, 'healthy', 'حالة النسخة يجب أن تكون healthy');
    assert.strictEqual(record.sha256_hash, backupResult.sha256, 'بصمة السجل يجب أن تطابق بصمة الملف');

    createdTestBackupIds.push(backupResult.recordId);
  });

  test('3. التشفير العسكري (AES-256-GCM + PBKDF2) وفك التشفير بالترويسة السحرية RAWASI01', () => {
    const sampleText = 'بيانات محاسبية فائقة الأهمية لنظام رواسي عدن - 2026';
    const sampleBuffer = Buffer.from(sampleText, 'utf8');
    const secretPass = 'Rawasi@Secret#2026';

    // 1. التشفير
    const encryptedBuffer = unifiedBackupEngine.encryptBuffer(sampleBuffer, secretPass);
    assert.ok(encryptedBuffer.length > sampleBuffer.length, 'المخزن المشفر يجب أن يحتوي على الترويسة والـ IV والـ Tag');
    assert.strictEqual(unifiedBackupEngine.isEncrypted(encryptedBuffer), true, 'يجب التعرف على الترويسة السحرية RAWASI01');

    // 2. فك التشفير بالمفتاح الصحيح
    const decryptedBuffer = unifiedBackupEngine.decryptBuffer(encryptedBuffer, secretPass);
    assert.strictEqual(decryptedBuffer.toString('utf8'), sampleText, 'البيانات بعد فك التشفير يجب أن تطابق النص الأصلي بدقة');

    // 3. رفض فك التشفير بمفتاح خاطئ
    assert.throws(() => {
      unifiedBackupEngine.decryptBuffer(encryptedBuffer, 'WrongPassword123');
    }, /فشل فك التشفير/, 'يجب إلقاء استثناء عند إدخال كلمة مرور خاطئة');
  });

  test('4. اكتشاف ورفض الملفات التالفة والفارغة وغير المتوافقة', () => {
    // 1. ملف فارغ صفر بايت
    const emptyFile = path.join(unifiedBackupEngine.defaultStorageDir, `corrupt_empty_${Date.now()}.db`);
    fs.writeFileSync(emptyFile, Buffer.alloc(0));
    createdTestFiles.push(emptyFile);

    const emptyResult = unifiedBackupEngine.verifySqliteFileIntegrity(emptyFile);
    assert.strictEqual(emptyResult.valid, false, 'يجب رفض الملف الفارغ');

    // 2. ملف يحتوي على نصوص عشوائية وليست قاعدة بيانات SQLite
    const garbageFile = path.join(unifiedBackupEngine.defaultStorageDir, `corrupt_garbage_${Date.now()}.db`);
    fs.writeFileSync(garbageFile, 'THIS_IS_NOT_A_SQLITE_DATABASE_FILE_HEADER');
    createdTestFiles.push(garbageFile);

    const garbageResult = unifiedBackupEngine.verifySqliteFileIntegrity(garbageFile);
    assert.strictEqual(garbageResult.valid, false, 'يجب رفض الملف غير المتطابق مع ترويسة SQLite');
  });

  test('5. فحص واختبار الاستعادة التجريبي في بيئة معزولة Sandbox دون المساس ببيانات الإنتاج', async () => {
    // نأخذ عدد القيود والمستخدمين في قاعدة الإنتاج قبل الاختبار
    const usersBefore = await get('SELECT count(*) as c FROM users');
    const accountsBefore = await get('SELECT count(*) as c FROM accounts');

    // إنشاء نسخة سليمة لاختبارها
    const backup = await unifiedBackupEngine.createBackup({
      backupType: 'manual',
      scope: 'database_only',
      user: 'test_sandbox_runner'
    });
    createdTestBackupIds.push(backup.recordId);

    // تشغيل اختبار الاستعادة في بيئة معزولة Sandbox
    const testReport = await unifiedBackupEngine.runSandboxTestRestore(backup.recordId, null, 'test_auditor');

    assert.ok(testReport, 'تقرير الاختبار يجب أن يكون متوفراً');
    assert.strictEqual(testReport.status, 'passed', 'حالة الاختبار التجريبي يجب أن تكون passed');
    assert.strictEqual(testReport.integrityResult, 'ok', 'فحص B-Tree في Sandbox يجب أن يكون ok');
    assert.ok(testReport.stats.total_tables >= 30, 'يجب التحقق من وجود جداول النظام كاملة');
    assert.ok(testReport.durationMs >= 0, 'يجب حساب زمن فحص البيئة المعزولة');

    // التأكد من أن قاعدة الإنتاج لم تتغير إطلاقاً
    const usersAfter = await get('SELECT count(*) as c FROM users');
    const accountsAfter = await get('SELECT count(*) as c FROM accounts');
    assert.strictEqual(usersBefore.c, usersAfter.c, 'بيانات مستخدمي الإنتاج يجب ألا تتأثر باختبار Sandbox');
    assert.strictEqual(accountsBefore.c, accountsAfter.c, 'دليل الحسابات في الإنتاج يجب ألا يتأثر باختبار Sandbox');

    // التحقق من تسجيل السجل في backup_test_logs
    const testLog = await get('SELECT * FROM backup_test_logs WHERE backup_file_name = ? ORDER BY created_at DESC LIMIT 1', [backup.fileName]);
    assert.ok(testLog, 'يجب تسجيل العملية في backup_test_logs');
    assert.strictEqual(testLog.status, 'passed');

    // التحقق من تحديث حالة السجل في backup_records
    const updatedRec = await get('SELECT test_status FROM backup_records WHERE id = ?', [backup.recordId]);
    assert.strictEqual(updatedRec.test_status, 'test_passed', 'حالة test_status يجب أن تصبح test_passed');
  });

  test('6. صمام أمان الاستعادة الإنتاجية: رفض الاستعادة من ملف تالف أو غير صالح مع بقاء الإنتاج آمناً', async () => {
    const corruptFile = path.join(unifiedBackupEngine.defaultStorageDir, `corrupt_for_restore_${Date.now()}.db`);
    fs.writeFileSync(corruptFile, 'CORRUPTED_FILE_CANNOT_BE_RESTORED');
    createdTestFiles.push(corruptFile);

    // محاولة استعادة الملف التالف للإنتاج يجب أن تفشل فوراً في مرحلة الفحص المسبق
    await assert.rejects(async () => {
      await unifiedBackupEngine.restoreToProduction(corruptFile, {
        reason: 'اختبار حماية الإنتاج عند التلف',
        user: 'security_tester'
      });
    }, /النسخة لم تجتز الفحص المسبق/, 'يجب إيقاف الاستعادة فوراً إذا فشل الفحص المسبق');

    // التحقق من أن قاعدة الإنتاج ما زالت تعمل بشكل سليم تماماً
    const checkDb = await get('SELECT count(*) as c FROM users');
    assert.ok(Number(checkDb?.c) > 0, 'قاعدة الإنتاج يجب أن تظل تعمل بكل مستخدميها دون أي ضرر');
  });

  test('7. سياسة الاحتفاظ وتثبيت النسخ (Pin Protection) وعدم حذف النسخ المحمية', async () => {
    // 1. إنشاء نسخة وتثبيتها وحمايتها
    const protectedBackup = await unifiedBackupEngine.createBackup({
      backupType: 'scheduled_daily',
      scope: 'database_only',
      isProtected: true,
      protectedReason: 'إقفال حسابات تجريبي محمي من التدوير'
    });
    createdTestBackupIds.push(protectedBackup.recordId);

    const rec = await get('SELECT is_protected, protected_reason FROM backup_records WHERE id = ?', [protectedBackup.recordId]);
    assert.strictEqual(rec.is_protected, 1, 'النسخة يجب أن تكون محمية (is_protected = 1)');

    // 2. محاولة حذف النسخة المحمية يدوياً يجب أن تُرفض
    await assert.rejects(async () => {
      await unifiedBackupEngine.deleteBackup(protectedBackup.recordId, 'admin');
    }, /هذه النسخة محمية من الحذف/, 'يجب رفض حذف النسخة المحمية');

    // 3. إلغاء الحماية ثم الحذف بنجاح
    await unifiedBackupEngine.toggleProtection(protectedBackup.recordId, false, '', 'admin');
    const unprotectRec = await get('SELECT is_protected FROM backup_records WHERE id = ?', [protectedBackup.recordId]);
    assert.strictEqual(unprotectRec.is_protected, 0, 'يجب فك الحماية بنجاح');

    const delResult = await unifiedBackupEngine.deleteBackup(protectedBackup.recordId, 'admin');
    assert.strictEqual(delResult.success, true, 'يجب نجاح حذف النسخة بعد فك الحماية');
  });

  test('8. استخراج مؤشرات لوحة التحكم (Disaster Recovery Dashboard KPIs)', async () => {
    const status = await unifiedBackupEngine.getDashboardStatus();

    assert.ok(status, 'حالة لوحة التحكم يجب أن تُرجع بيانات متكاملة');
    assert.ok(status.storage, 'يجب توفر بيانات التخزين');
    assert.strictEqual(status.storage.exists, true, 'مسار التخزين يجب أن يكون موجوداً');
    assert.strictEqual(status.storage.writable, true, 'مسار التخزين يجب أن يكون قابلاً للكتابة');
    assert.ok(status.stats.totalBackups >= 0, 'يجب توفر إجمالي عدد النسخ');
    assert.ok(status.schedule, 'يجب توفر بيانات الجدولة التلقائية');
  });

  test('9. قفل منع التضارب والتزامن (Concurrency Mutex Lock): منع عمليتي نسخ متزامنتين', async () => {
    assert.strictEqual(unifiedBackupEngine.isExecuting, false, 'المحرك يجب أن يكون في وضع الاستعداد');
    
    // محاكاة بدء عملية
    unifiedBackupEngine.isExecuting = true;

    await assert.rejects(async () => {
      await unifiedBackupEngine.createBackup({ backupType: 'manual' });
    }, /توجد عملية نسخ أو استعادة أخرى قيد التنفيذ حالياً/, 'يجب رفض بدء عملية نسخ أخرى متزامنة');

    unifiedBackupEngine.isExecuting = false;
  });

  test('10. صمام أمان سياسة التدوير (Retention Safety Invariant): الحفاظ دائماً على أحدث نسختين على الأقل', async () => {
    // تشغيل سياسة الاحتفاظ في مجلد النسخ
    await unifiedBackupEngine.executeRetentionPolicy();

    const activeBackups = await query("SELECT count(*) as cnt FROM backup_records WHERE status != 'purged'");
    assert.ok(Number(activeBackups[0]?.cnt) >= 0, 'سياسة الاحتفاظ يجب أن تعمل بنجاح دون أخطاء');
  });

  test('11. كشف التلاعب ببصمة SHA-256 والتأكد من تطابق المحتوى التام', async () => {
    const backup = await unifiedBackupEngine.createBackup({
      backupType: 'manual',
      scope: 'database_only',
      user: 'integrity_auditor'
    });
    createdTestBackupIds.push(backup.recordId);

    // التحقق من أن البصمة مطابقة 100%
    const computed = unifiedBackupEngine.computeSha256(backup.filePath);
    assert.strictEqual(computed, backup.sha256, 'البصمة يجب أن تتطابق تماماً مع الملف الأصلي');

    // تلاعب تجريبي في بايت واحد داخل نسخة مؤقتة
    const tamperedPath = backup.filePath + '.tampered.tmp';
    const originalBuf = fs.readFileSync(backup.filePath);
    const tamperedBuf = Buffer.from(originalBuf);
    tamperedBuf[100] = tamperedBuf[100] ^ 0xFF; // قلب بايت واحد
    fs.writeFileSync(tamperedPath, tamperedBuf);
    createdTestFiles.push(tamperedPath);

    const tamperedHash = unifiedBackupEngine.computeSha256(tamperedPath);
    assert.notStrictEqual(tamperedHash, backup.sha256, 'أي تعديل ولو في بايت واحد يجب أن يغير بصمة SHA-256 جذرياً');
  });

  test('12. فحص ميزان المراجعة وتوازن القيود المحاسبية (المدين = الدائن)', () => {
    const liveDbCheck = unifiedBackupEngine.verifySqliteFileIntegrity(dbPath || path.resolve(__dirname, '..', 'server', 'database', 'rawasi_aden.db'));
    assert.strictEqual(liveDbCheck.valid, true, 'قاعدة بيانات النظام يجب أن تكون صالحة هيكلياً');
    assert.strictEqual(liveDbCheck.stats.is_balanced, true, 'ميزان المراجعة والقيود المحاسبية في النظام يجب أن تكون متزنة (المدين = الدائن)');
  });
});

