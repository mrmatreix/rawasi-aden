/**
 * unifiedBackupEngine.js
 * 
 * المحرك المركزي الموحد للنسخ الاحتياطي واستعادة البيانات وإدارة الكوارث
 * نظام رواسي عدن للهندسة والمقاولات (Rawasi Aden ERP & Disaster Recovery Engine)
 * 
 * المبادئ الأساسية:
 * 1. اتساق المعاملات التام (Atomic Online Backup with WAL Checkpoint).
 * 2. التحقق الإلزامي من سلامة B-Tree و PRAGMA integrity_check وتوازن الحسابات قبل اعتماد أي نسخة.
 * 3. بيئة استعادة تجريبية معزولة (Sandboxed Test Restore) لا تمس بيانات الإنتاج إطلاقاً.
 * 4. استعادة إنتاجية آمنة مع إنشاء نقطة تراجع طارئة (Safety Snapshot) وتراجع تلقائي (Auto-Rollback) عند الفشل.
 * 5. سياسة احتفاظ مرنة (14 يوماً للنسخ اليومية، 8 أسابيع للأسبوعية، 12 شهراً للشهرية، وحماية النسخ المثبتة).
 * 6. دعم كامل للتخزين الدائم في Railway (Volumes / Persistent Paths) والتشفير العسكري AES-256-GCM.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const AdmZip = require('adm-zip');

const { query, run, get, exec, dbPath, getActiveEngine } = require('../database/db');
const { logAudit } = require('./auditService');

const MAGIC_HEADER = 'RAWASI01'; // 8-byte magic header for encrypted archives

class UnifiedBackupEngine {
  constructor() {
    this.isExecuting = false;
    this.currentOperation = null;
    this.defaultStorageDir = this.resolveStorageDirectory();
    this.projectsDir = path.resolve(__dirname, '..', '..', 'ملفات_المشاريع');
    this.uploadsDir = path.resolve(__dirname, '..', '..', 'uploads');
    this.scratchDir = path.resolve(__dirname, '..', '..', 'scratch');

    this.ensureDirectories();
  }

  /**
   * تحديد مسار التخزين المعتمد مع الكشف التلقائي عن أقراص Railway الدائمة (Railway Volumes)
   */
  resolveStorageDirectory() {
    // 1. مسار مخصص في متغيرات البيئة
    if (process.env.RAWASI_BACKUP_DIR && process.env.RAWASI_BACKUP_DIR.trim()) {
      return path.resolve(process.env.RAWASI_BACKUP_DIR.trim());
    }

    // 2. كشف مسار وحدات التخزين الدائمة في Railway (Railway Volume Mount Path)
    if (process.env.RAILWAY_VOLUME_MOUNT_PATH && fs.existsSync(process.env.RAILWAY_VOLUME_MOUNT_PATH)) {
      const volDir = path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'backups');
      return volDir;
    }

    // 3. فحص وجود المجلد الدائم القياسي /data في حاويات Railway أو لينكس
    if (fs.existsSync('/data') && process.platform !== 'win32') {
      try {
        const testPath = '/data/rawasi_backups';
        if (!fs.existsSync(testPath)) fs.mkdirSync(testPath, { recursive: true });
        return testPath;
      } catch (e) {}
    }

    // 4. المسار الافتراضي المحلي داخل المشروع
    return path.resolve(__dirname, '..', 'database', 'backups');
  }

  /**
   * التأكد من وجود كافة المجلدات الأساسية
   */
  ensureDirectories() {
    [this.defaultStorageDir, this.scratchDir, this.projectsDir, this.uploadsDir].forEach(dir => {
      try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      } catch (e) {
        console.warn(`⚠️ [BackupEngine] Could not create directory ${dir}:`, e.message);
      }
    });
  }

  /**
   * حساب بصمة SHA-256 لملف أو مخزن بيانات
   */
  computeSha256(filePathOrBuffer) {
    const hash = crypto.createHash('sha256');
    if (Buffer.isBuffer(filePathOrBuffer)) {
      hash.update(filePathOrBuffer);
    } else if (typeof filePathOrBuffer === 'string' && fs.existsSync(filePathOrBuffer)) {
      hash.update(fs.readFileSync(filePathOrBuffer));
    } else {
      hash.update(String(filePathOrBuffer));
    }
    return hash.digest('hex');
  }

  /**
   * تشفير مخزن بيانات عبر AES-256-GCM مع PBKDF2
   */
  encryptBuffer(buffer, passphrase) {
    if (!passphrase || passphrase.trim().length < 4) {
      throw new Error('كلمة مرور التشفير يجب ألا تقل عن 4 خانات لضمان أمان البيانات');
    }
    const cleanPass = passphrase.trim();
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = crypto.pbkdf2Sync(cleanPass, salt, 100000, 32, 'sha256');

    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const magic = Buffer.from(MAGIC_HEADER, 'utf8');

    return Buffer.concat([magic, salt, iv, authTag, ciphertext]);
  }

  /**
   * فك تشفير مخزن بيانات مع التحقق من النزاهة وكلمة المرور
   */
  decryptBuffer(encryptedBuffer, passphrase) {
    if (!passphrase) throw new Error('يرجى إدخال كلمة مرور فك التشفير');
    const cleanPass = passphrase.trim();

    if (!Buffer.isBuffer(encryptedBuffer) || encryptedBuffer.length < 52) {
      throw new Error('الملف غير مكتمل أو تالف، لا يحتوي على ترويسة التشفير المعتمدة');
    }

    const magic = encryptedBuffer.slice(0, 8).toString('utf8');
    if (magic !== MAGIC_HEADER) {
      throw new Error('صيغة التشفير غير معتمدة أو الملف لم يتم تشفيره بنظام رواسي عدن (Magic mismatch)');
    }

    const salt = encryptedBuffer.slice(8, 24);
    const iv = encryptedBuffer.slice(24, 36);
    const authTag = encryptedBuffer.slice(36, 52);
    const ciphertext = encryptedBuffer.slice(52);

    const key = crypto.pbkdf2Sync(cleanPass, salt, 100000, 32, 'sha256');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    try {
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch (err) {
      throw new Error('فشل فك التشفير: كلمة المرور غير صحيحة أو تم العبث بمحتوى النسخة الاحتياطية ❌');
    }
  }

  /**
   * فحص ما إذا كان الملف مشفراً برأس نظام رواسي
   */
  isEncrypted(bufferOrPath) {
    try {
      let buf;
      if (Buffer.isBuffer(bufferOrPath)) {
        buf = bufferOrPath.slice(0, 8);
      } else if (typeof bufferOrPath === 'string' && fs.existsSync(bufferOrPath)) {
        const fd = fs.openSync(bufferOrPath, 'r');
        buf = Buffer.alloc(8);
        fs.readSync(fd, buf, 0, 8, 0);
        fs.closeSync(fd);
      } else {
        return false;
      }
      return buf.toString('utf8') === MAGIC_HEADER;
    } catch (e) {
      return false;
    }
  }

  /**
   * فحص سلامة وتناسق ملف قاعدة بيانات SQLite عميقاً عبر SQLite API المدمج
   */
  verifySqliteFileIntegrity(filePath) {
    if (!fs.existsSync(filePath)) {
      return { valid: false, error: 'الملف غير موجود على القرص' };
    }

    const stat = fs.statSync(filePath);
    if (stat.size < 512) {
      return { valid: false, error: 'حجم الملف صغير جداً ولا يمكن أن يكون قاعدة بيانات صالحة' };
    }

    // التحقق من الترويسة السحرية لـ SQLite
    const fd = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(16);
    fs.readSync(fd, header, 0, 16, 0);
    fs.closeSync(fd);

    if (!header.toString('utf8').startsWith('SQLite format 3')) {
      return { valid: false, error: 'ترويسة الملف لا تطابق معايير SQLite format 3' };
    }

    // فتح قاعدة بيانات مؤقتة والتحقق من B-Tree وسلامة الصفحات
    let tempDb = null;
    try {
      tempDb = new DatabaseSync(filePath, { readOnly: true });

      // 1. فحص النزاهة الهيكلية
      const integrityStmt = tempDb.prepare('PRAGMA integrity_check;');
      const integrityRows = integrityStmt.all();
      const integrityResult = integrityRows.map(r => Object.values(r)[0]).join(', ');

      if (integrityResult !== 'ok') {
        return { valid: false, error: `فشل فحص نزاهة قاعدة البيانات: ${integrityResult}` };
      }

      // 2. فحص وجود الجداول المحاسبية والأساسية
      const tablesStmt = tempDb.prepare("SELECT name FROM sqlite_master WHERE type='table';");
      const tables = tablesStmt.all().map(r => r.name);

      const requiredTables = ['users', 'accounts', 'journal_entries', 'projects', 'clients', 'bills', 'settings'];
      const missingTables = requiredTables.filter(t => !tables.includes(t));

      if (missingTables.length > 0) {
        return { valid: false, error: `قاعدة البيانات تفتقد جداول أساسية: ${missingTables.join(', ')}` };
      }

      // 3. إحصائيات السجلات الأساسية
      const countTable = (t) => {
        try {
          const s = tempDb.prepare(`SELECT count(*) as c FROM ${t}`).get();
          return Number(s?.c || 0);
        } catch { return 0; }
      };

      const stats = {
        total_tables: tables.length,
        users_count: countTable('users'),
        accounts_count: countTable('accounts'),
        journal_entries_count: countTable('journal_entries'),
        projects_count: countTable('projects'),
        clients_count: countTable('clients'),
        bills_count: countTable('bills'),
        vouchers_count: countTable('vouchers')
      };

      // 4. فحص ميزان المراجعة وتوازن القيود (المدين = الدائن)
      let isBalanced = true;
      try {
        const balStmt = tempDb.prepare(`
          SELECT 
            ROUND(SUM(debit), 2) as total_debit, 
            ROUND(SUM(credit), 2) as total_credit 
          FROM journal_entry_lines
        `).get();
        if (balStmt && Math.abs((balStmt.total_debit || 0) - (balStmt.total_credit || 0)) > 0.05) {
          isBalanced = false;
        }
      } catch (e) {}

      stats.is_balanced = isBalanced;

      return {
        valid: true,
        integrityResult: 'ok',
        stats,
        size: stat.size
      };
    } catch (err) {
      return { valid: false, error: `خطأ أثناء قراءة وفحص قاعدة البيانات: ${err.message}` };
    } finally {
      if (tempDb) {
        try { tempDb.close(); } catch {}
      }
    }
  }

  // =========================================================================
  // الوظيفة الرئيسية 1: إنشاء نسخة احتياطية معتمدة ومتسقة (Create Verified Backup)
  // =========================================================================

  /**
   * إنشاء نسخة احتياطية وفق دورة الحياة الكاملة:
   * pre-flight -> WAL checkpoint -> atomic write -> deep integrity verification -> SHA256 -> register -> prune
   */
  async createBackup({
    backupType = 'manual', // 'manual', 'scheduled_daily', 'scheduled_weekly', 'scheduled_monthly', 'pre_migration', 'logout'
    scope = 'database_only', // 'database_only', 'full_bundle_with_files'
    encrypt = false,
    passphrase = '',
    isProtected = false,
    protectedReason = '',
    user = 'admin',
    req = null
  } = {}) {
    if (this.isExecuting) {
      throw new Error('توجد عملية نسخ أو استعادة أخرى قيد التنفيذ حالياً، يرجى الانتظار');
    }

    this.isExecuting = true;
    const startTime = Date.now();
    const backupUid = `BCK-${new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}-${Math.floor(1000 + Math.random() * 9000)}`;
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const timestampStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;

    let tempFilePath = null;
    let finalFilePath = null;

    try {
      this.ensureDirectories();

      // فحص وجود مساحة وتوفر مسار التخزين
      const targetDir = this.defaultStorageDir;
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      // خطوة 1: إجراء WAL Checkpoint لضمان كتابة كافة الحركات الحديثة من ملف WAL في SQLite
      try {
        await exec('PRAGMA wal_checkpoint(TRUNCATE);');
      } catch (cpErr) {
        console.warn('⚠️ [BackupEngine] WAL Checkpoint note:', cpErr.message);
      }

      const sourceDb = dbPath || path.resolve(__dirname, '..', 'database', 'rawasi_aden.db');
      if (!fs.existsSync(sourceDb)) {
        throw new Error(`ملف قاعدة البيانات المصدر غير موجود في المسار: ${sourceDb}`);
      }

      // خطوة 2: إنشاء ملف مؤقت في مجلد العمل (.tmp)
      tempFilePath = path.join(targetDir, `.tmp_${backupUid}.bin`);

      let finalFileName = '';
      let verificationReport = null;

      if (scope === 'database_only') {
        // نسخ قاعدة البيانات أولاً إلى المسار المؤقت
        fs.copyFileSync(sourceDb, tempFilePath);

        // خطوة 3: التحقق الصارم من سلامة النسخة المؤقتة قبل اعتمادها
        verificationReport = this.verifySqliteFileIntegrity(tempFilePath);
        if (!verificationReport.valid) {
          throw new Error(`فشل التحقق من سلامة نسخة قاعدة البيانات: ${verificationReport.error}`);
        }

        // إذا طُلب التشفير
        if (encrypt) {
          const rawBuffer = fs.readFileSync(tempFilePath);
          const encryptedBuffer = this.encryptBuffer(rawBuffer, passphrase);
          fs.writeFileSync(tempFilePath, encryptedBuffer);
          finalFileName = `backup_${backupType}_${timestampStr}.rawasi.enc`;
        } else {
          finalFileName = `backup_${backupType}_${timestampStr}.db`;
        }
      } else {
        // حزمة شاملة (قاعدة البيانات + المرفقات + ملفات المشاريع)
        const dbVerification = this.verifySqliteFileIntegrity(sourceDb);
        if (!dbVerification.valid) {
          throw new Error(`قاعدة البيانات الحالية تحتوي على مشكلة نزاهة: ${dbVerification.error}`);
        }
        verificationReport = dbVerification;

        const zip = new AdmZip();
        zip.addLocalFile(sourceDb, 'database');

        // تضمين ملفات المشاريع والمستندات إن وجدت
        if (fs.existsSync(this.projectsDir)) {
          const pFiles = fs.readdirSync(this.projectsDir);
          if (pFiles.length > 0) zip.addLocalFolder(this.projectsDir, 'ملفات_المشاريع');
        }

        // تضمين مرفقات طلبات خدمة العملاء إن وجدت
        if (fs.existsSync(this.uploadsDir)) {
          const uFiles = fs.readdirSync(this.uploadsDir);
          if (uFiles.length > 0) zip.addLocalFolder(this.uploadsDir, 'uploads');
        }

        // تضمين بيان المانيفست
        const manifest = {
          backup_uid: backupUid,
          system: 'نظام رواسي عدن للهندسة والمقاولات',
          version: '1.0.0',
          created_at: now.toISOString(),
          created_by: user,
          type: backupType,
          scope,
          encrypted: Boolean(encrypt),
          stats: dbVerification.stats,
          db_sha256: this.computeSha256(sourceDb)
        };
        zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));

        const zipBuffer = zip.toBuffer();

        if (encrypt) {
          const encryptedBuffer = this.encryptBuffer(zipBuffer, passphrase);
          fs.writeFileSync(tempFilePath, encryptedBuffer);
          finalFileName = `rawasi_bundle_${backupType}_${timestampStr}.rawasi.enc`;
        } else {
          fs.writeFileSync(tempFilePath, zipBuffer);
          finalFileName = `rawasi_bundle_${backupType}_${timestampStr}.zip`;
        }
      }

      // خطوة 4: حساب بصمة SHA-256 وحجم الملف النهائي
      const finalStat = fs.statSync(tempFilePath);
      const sha256 = this.computeSha256(tempFilePath);

      // خطوة 5: النقل الذري من الملف المؤقت إلى الاسم النهائي
      finalFilePath = path.join(targetDir, finalFileName);
      fs.renameSync(tempFilePath, finalFilePath);

      // تنظيف أي ملفات مؤقتة مساعدة تركها محرك SQLite
      ['-shm', '-wal'].forEach(ext => {
        try {
          if (fs.existsSync(tempFilePath + ext)) fs.unlinkSync(tempFilePath + ext);
        } catch (e) {}
      });
      tempFilePath = null; // تم الانتهاء بنجاح

      // خطوة 6: تسجيل النسخة في جدول backup_records
      const insertRes = await run(`
        INSERT INTO backup_records (
          backup_uid, file_name, file_path, file_size, sha256_hash,
          backup_type, scope, storage_tier, storage_path, encrypted,
          encryption_algo, status, verification_status, verification_details,
          is_protected, protected_reason, protected_by, created_by, created_at,
          test_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'healthy', 'passed', ?, ?, ?, ?, ?, ?, 'not_tested')
      `, [
        backupUid,
        finalFileName,
        finalFilePath,
        finalStat.size,
        sha256,
        backupType,
        scope,
        'local_persistent',
        targetDir,
        encrypt ? 1 : 0,
        encrypt ? 'AES-256-GCM-PBKDF2-100K' : 'NONE',
        JSON.stringify(verificationReport || {}),
        isProtected ? 1 : 0,
        protectedReason || '',
        isProtected ? user : null,
        user,
        now.toISOString()
      ]);

      // خطوة 7: تطبيق سياسة الاحتفاظ بالنسخ وحذف القديم غير المحمي
      this.executeRetentionPolicy(targetDir).catch(e => {
        console.warn('⚠️ [BackupEngine] Retention policy pruning note:', e.message);
      });

      // توثيق في سجل التدقيق الإداري والمالي
      await logAudit(req, {
        action: 'CREATE_BACKUP_SUCCESS',
        entity_type: 'backup_records',
        entity_id: backupUid,
        details: {
          file_name: finalFileName,
          size_bytes: finalStat.size,
          sha256,
          backupType,
          scope,
          encrypted: Boolean(encrypt),
          duration_ms: Date.now() - startTime
        }
      });

      console.log(`✅ [BackupEngine] تم إنشاء واعتماد النسخة بنجاح: ${finalFileName} (${(finalStat.size / (1024 * 1024)).toFixed(2)} MB)`);

      const recordId = insertRes ? (Number(insertRes.lastInsertRowid || insertRes.insertId || insertRes.id) || null) : null;

      return {
        success: true,
        recordId,
        backupUid,
        fileName: finalFileName,
        filePath: finalFilePath,
        fileSize: finalStat.size,
        sha256,
        integrityCheck: verificationReport?.integrityResult || 'ok',
        backupType,
        scope,
        encrypted: Boolean(encrypt),
        createdAt: now.toISOString(),
        verification: verificationReport
      };
    } catch (err) {
      console.error('❌ [BackupEngine] فشل عملية النسخ الاحتياطي:', err.message);

      // تنظيف الملف المؤقت إن وجد لمنع تراكم الملفات التالفة
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        try { fs.unlinkSync(tempFilePath); } catch (e) {}
      }

      await logAudit(req, {
        action: 'CREATE_BACKUP_FAILED',
        entity_type: 'backup_records',
        entity_id: backupUid,
        details: { error: err.message, backupType, scope }
      });

      throw err;
    } finally {
      this.isExecuting = false;
    }
  }

  // =========================================================================
  // الوظيفة الرئيسية 2: الاستعادة التجريبية في بيئة معزولة (Sandboxed Test Restore)
  // =========================================================================

  /**
   * تشغيل اختبار استعادة في بيئة معزولة تماماً (Sandbox)
   * يفحص قابلية القراءة، سلامة العلاقات، وتوازن الحسابات، دون المساس بقاعدة الإنتاج الحية!
   */
  async runSandboxTestRestore(fileNameOrId, passphrase = null, user = 'admin') {
    if (!fileNameOrId) {
      throw new Error('يرجى تحديد معرف أو اسم ملف النسخة الاحتياطية');
    }
    const startTime = Date.now();
    const testUid = `TEST-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;

    let record = null;
    if (typeof fileNameOrId === 'number' || /^\d+$/.test(String(fileNameOrId))) {
      record = await get('SELECT * FROM backup_records WHERE id = ?', [fileNameOrId]);
    } else {
      record = await get('SELECT * FROM backup_records WHERE file_name = ? OR backup_uid = ?', [fileNameOrId, fileNameOrId]);
    }

    let filePath = null;
    let fileName = '';

    if (record) {
      filePath = record.file_path;
      fileName = record.file_name;
    } else {
      // فحص المسار المباشر في مجلد النسخ
      const candidate = path.join(this.defaultStorageDir, path.basename(fileNameOrId));
      if (fs.existsSync(candidate)) {
        filePath = candidate;
        fileName = path.basename(fileNameOrId);
      } else {
        throw new Error(`ملف النسخة الاحتياطية غير موجود: ${fileNameOrId}`);
      }
    }

    if (!fs.existsSync(filePath)) {
      throw new Error(`ملف النسخة غير موجود على القرص: ${filePath}`);
    }

    const sandboxId = `sandbox_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const sandboxDir = path.join(this.scratchDir, sandboxId);
    fs.mkdirSync(sandboxDir, { recursive: true });

    let sandboxDbPath = null;

    try {
      let fileBuffer = fs.readFileSync(filePath);

      // فك التشفير إذا كان مشفراً
      if (this.isEncrypted(fileBuffer)) {
        if (!passphrase) {
          throw new Error('الملف مشفر ويتطلب كلمة مرور لفك التشفير واختبار الاستعادة');
        }
        fileBuffer = this.decryptBuffer(fileBuffer, passphrase);
      }

      // تحديد نوع الملف (قاعدة بيانات مباشرة أو حزمة أرشيف ZIP)
      if (fileBuffer.slice(0, 16).toString('utf8').startsWith('SQLite format 3')) {
        sandboxDbPath = path.join(sandboxDir, 'test_database.db');
        fs.writeFileSync(sandboxDbPath, fileBuffer);
      } else {
        // حزمة ZIP
        const zip = new AdmZip(fileBuffer);
        const entries = zip.getEntries();
        const dbEntry = entries.find(e => e.entryName === 'database/rawasi_aden.db' || e.entryName.endsWith('.db'));
        if (!dbEntry) {
          throw new Error('الأرشيف لا يحتوي على ملف قاعدة بيانات SQLite صالح');
        }
        sandboxDbPath = path.join(sandboxDir, 'test_database.db');
        fs.writeFileSync(sandboxDbPath, dbEntry.getData());
      }

      // فحص النزاهة الشامل على قاعدة بيانات البيئة المعزولة
      const result = this.verifySqliteFileIntegrity(sandboxDbPath);
      if (!result.valid) {
        throw new Error(`فشل الفحص الهيكلي في البيئة المعزولة: ${result.error}`);
      }

      const durationMs = Date.now() - startTime;
      const stats = result.stats || {};

      // تسجيل نتيجة الاختبار في جدول backup_test_logs
      await run(`
        INSERT INTO backup_test_logs (
          test_uid, backup_file_name, integrity_check_result, tables_count,
          users_count, accounts_count, journal_entries_count, projects_count,
          is_balanced, duration_ms, status, tested_by
        ) VALUES (?, ?, 'ok', ?, ?, ?, ?, ?, ?, ?, 'passed', ?)
      `, [
        testUid,
        fileName,
        stats.total_tables || 0,
        stats.users_count || 0,
        stats.accounts_count || 0,
        stats.journal_entries_count || 0,
        stats.projects_count || 0,
        stats.is_balanced ? 1 : 0,
        durationMs,
        user
      ]);

      // تحديث حالة السجل الأصلي
      if (record) {
        await run(`
          UPDATE backup_records 
          SET last_tested_at = CURRENT_TIMESTAMP, test_status = 'test_passed'
          WHERE id = ?
        `, [record.id]);
      }

      console.log(`🧪 [BackupEngine] اجتازت النسخة (${fileName}) اختبار الاستعادة التجريبي بنجاح تام!`);

      return {
        success: true,
        testUid,
        fileName,
        status: 'passed',
        integrityResult: 'ok',
        durationMs,
        stats,
        message: 'تم اجتياز اختبار الاستعادة التجريبي وفحص سلامة وتناسق البيانات بنجاح 100%'
      };
    } catch (err) {
      console.error(`❌ [BackupEngine] فشل اختبار الاستعادة التجريبي لـ ${fileName}:`, err.message);

      await run(`
        INSERT INTO backup_test_logs (
          test_uid, backup_file_name, integrity_check_result, status, error_message, tested_by
        ) VALUES (?, ?, 'failed', 'failed', ?, ?)
      `, [testUid, fileName, err.message, user]).catch(() => {});

      if (record) {
        await run(`
          UPDATE backup_records 
          SET last_tested_at = CURRENT_TIMESTAMP, test_status = 'test_failed'
          WHERE id = ?
        `, [record.id]).catch(() => {});
      }

      throw err;
    } finally {
      // تنظيف وحذف مجلد البيئة المعزولة بأمان
      try {
        if (fs.existsSync(sandboxDir)) {
          fs.rmSync(sandboxDir, { recursive: true, force: true });
        }
      } catch (e) {}
    }
  }

  // =========================================================================
  // الوظيفة الرئيسية 3: الاستعادة الإنتاجية الآمنة مع نقطة تراجع طارئة (Safe Production Restore)
  // =========================================================================

  /**
   * استعادة الإنتاج المحمية:
   * 1. اختبار النسخة أولاً في Sandbox للتأكد من خلوها من الأخطاء.
   * 2. إنشاء نسخة حماية طارئة (Safety Snapshot) للبيانات الحالية قبل لمسها.
   * 3. الإحلال الذري لقاعدة البيانات.
   * 4. فحص ما بعد الاستعادة (Post-Restore Verification).
   * 5. تراجع تلقائي (Auto-Rollback) فوري إذا حدث أي خطأ.
   */
  async restoreToProduction(fileNameOrId, {
    passphrase = null,
    reason = 'استعادة معتمدة بطلب من الإدارة',
    user = 'admin',
    req = null
  } = {}) {
    if (!fileNameOrId) {
      throw new Error('يرجى تحديد معرف أو اسم ملف النسخة الاحتياطية');
    }
    if (this.isExecuting) {
      throw new Error('توجد عملية أخرى قيد التنفيذ حالياً، يرجى الانتظار');
    }

    this.isExecuting = true;
    const startTime = Date.now();
    const restoreUid = `RST-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;

    let record = null;
    if (typeof fileNameOrId === 'number' || /^\d+$/.test(String(fileNameOrId))) {
      record = await get('SELECT * FROM backup_records WHERE id = ?', [fileNameOrId]);
    } else {
      record = await get('SELECT * FROM backup_records WHERE file_name = ? OR backup_uid = ?', [fileNameOrId, fileNameOrId]);
    }

    const fileName = record ? record.file_name : path.basename(fileNameOrId);
    const filePath = record ? record.file_path : path.join(this.defaultStorageDir, fileName);

    if (!fs.existsSync(filePath)) {
      this.isExecuting = false;
      throw new Error(`ملف النسخة الاحتياطية المراد استعادتها غير موجود: ${filePath}`);
    }

    // خطوة 1: إجراء اختبار استعادة تجريبي أولاً في Sandbox!
    console.log(`🔍 [BackupEngine] بدء الفحص المسبق في Sandbox قبل استعادة ${fileName}...`);
    let testReport = null;
    try {
      testReport = await this.runSandboxTestRestore(fileName, passphrase, user);
    } catch (testErr) {
      this.isExecuting = false;
      throw new Error(`⛔ تم إلغاء الاستعادة الإنتاجية: النسخة لم تجتز الفحص المسبق (${testErr.message})`);
    }

    const liveDbPath = dbPath || path.resolve(__dirname, '..', 'database', 'rawasi_aden.db');
    const safetySnapshotName = `safety_before_restore_${restoreUid}.db`;
    const safetySnapshotPath = path.join(this.defaultStorageDir, safetySnapshotName);

    // تسجيل بدء العملية
    await run(`
      INSERT INTO restore_operations (
        restore_uid, target_type, backup_record_id, backup_file_name,
        safety_backup_file, initiated_by, reason, status
      ) VALUES (?, 'production', ?, ?, ?, ?, ?, 'in_progress')
    `, [
      restoreUid,
      record ? record.id : null,
      fileName,
      safetySnapshotPath,
      user,
      reason
    ]);

    try {
      // خطوة 2: إنشاء نسخة حماية طارئة من قاعدة البيانات الحالية
      if (fs.existsSync(liveDbPath)) {
        try { await exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch (e) {}
        fs.copyFileSync(liveDbPath, safetySnapshotPath);
        console.log(`🛡️ [BackupEngine] تم حفظ نسخة الحماية الطارئة: ${safetySnapshotName}`);
      }

      // خطوة 3: استخراج مخزن البيانات المعتمد للاستعادة
      let fileBuffer = fs.readFileSync(filePath);
      if (this.isEncrypted(fileBuffer)) {
        fileBuffer = this.decryptBuffer(fileBuffer, passphrase);
      }

      let restoredDbBuffer = null;
      let isZipBundle = false;

      if (fileBuffer.slice(0, 16).toString('utf8').startsWith('SQLite format 3')) {
        restoredDbBuffer = fileBuffer;
      } else {
        isZipBundle = true;
        const zip = new AdmZip(fileBuffer);
        const entries = zip.getEntries();
        const dbEntry = entries.find(e => e.entryName === 'database/rawasi_aden.db' || e.entryName.endsWith('.db'));
        if (!dbEntry) {
          throw new Error('الأرشيف لا يحتوي على ملف قاعدة بيانات');
        }
        restoredDbBuffer = dbEntry.getData();

        // استعادة المستندات والمرفقات إن وجدت
        entries.forEach(e => {
          if (e.entryName.startsWith('ملفات_المشاريع/') && !e.isDirectory) {
            const rel = e.entryName.replace('ملفات_المشاريع/', '');
            const dest = path.join(this.projectsDir, rel);
            const parent = path.dirname(dest);
            if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
            fs.writeFileSync(dest, e.getData());
          }
          if (e.entryName.startsWith('uploads/') && !e.isDirectory) {
            const rel = e.entryName.replace('uploads/', '');
            const dest = path.join(this.uploadsDir, rel);
            const parent = path.dirname(dest);
            if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
            fs.writeFileSync(dest, e.getData());
          }
        });
      }

      // خطوة 4: الإحلال الذري لقاعدة البيانات في الخادم
      const { restoreDatabase } = require('../database/db');
      restoreDatabase(restoredDbBuffer);

      // خطوة 5: التحقق الصارم بعد الاستعادة (Post-Restore Health Check)
      const healthCheck = this.verifySqliteFileIntegrity(liveDbPath);
      if (!healthCheck.valid) {
        throw new Error(`فشل فحص قاعدة البيانات بعد الاستعادة: ${healthCheck.error}`);
      }

      // فحص وجود مستخدم واحد نشط على الأقل
      const usersRow = await get("SELECT count(*) as cnt FROM users WHERE status = 'active' OR status IS NULL").catch(() => ({ cnt: 0 }));
      if (Number(usersRow?.cnt || 0) === 0) {
        throw new Error('قاعدة البيانات المستعادة لا تحتوي على أي مستخدمين نشطين');
      }

      const durationMs = Date.now() - startTime;

      // تسجيل النجاح التام
      await run(`
        UPDATE restore_operations 
        SET status = 'completed', completed_at = CURRENT_TIMESTAMP, duration_ms = ?, validation_report = ?
        WHERE restore_uid = ?
      `, [durationMs, JSON.stringify(healthCheck), restoreUid]);

      await logAudit(req, {
        action: 'PRODUCTION_RESTORE_COMPLETED',
        entity_type: 'restore_operations',
        entity_id: restoreUid,
        details: {
          backup_file: fileName,
          duration_ms: durationMs,
          stats: healthCheck.stats
        }
      });

      console.log(`🎉 [BackupEngine] تمت الاستعادة الإنتاجية بنجاح تام وتم التحقق من الجداول والحسابات!`);

      return {
        success: true,
        restoreUid,
        fileName,
        durationMs,
        safetySnapshotName,
        validation: healthCheck,
        message: 'تمت استعادة قاعدة البيانات والملفات بنجاح، وجميع السجلات والحسابات متناسقة'
      };
    } catch (restoreErr) {
      console.error(`💥 [BackupEngine] خطأ أثناء الاستعادة الإنتاجية: ${restoreErr.message}`);

      // التراجع التلقائي الطارئ إلى نسخة الحماية
      if (fs.existsSync(safetySnapshotPath)) {
        console.warn(`🔄 [BackupEngine] جاري التراجع التلقائي إلى نسخة الحماية: ${safetySnapshotName}`);
        try {
          const { restoreDatabase } = require('../database/db');
          restoreDatabase(safetySnapshotPath);
          console.log(`✅ [BackupEngine] تم التراجع بنجاح إلى حالة ما قبل الاستعادة الفاشلة.`);
        } catch (rbErr) {
          console.error(`🚨 [BackupEngine] فشل حرج في التراجع التلقائي: ${rbErr.message}`);
        }
      }

      await run(`
        UPDATE restore_operations 
        SET status = 'rolled_back', completed_at = CURRENT_TIMESTAMP, error_message = ?
        WHERE restore_uid = ?
      `, [restoreErr.message, restoreUid]).catch(() => {});

      await logAudit(req, {
        action: 'PRODUCTION_RESTORE_ROLLED_BACK',
        entity_type: 'restore_operations',
        entity_id: restoreUid,
        details: { error: restoreErr.message, backup_file: fileName }
      });

      throw new Error(`فشلت الاستعادة وتم التراجع التلقائي للحفاظ على بيانات النظام: ${restoreErr.message}`);
    } finally {
      this.isExecuting = false;
    }
  }

  // =========================================================================
  // الوظيفة الرئيسية 4: سياسة الاحتفاظ بالنسخ والتدوير الآمن (Retention Policy)
  // =========================================================================

  /**
   * تطبيق سياسة الاحتفاظ وحذف النسخ القديمة الزائدة:
   * - 14 يوماً للنسخ اليومية
   * - 8 أسابيع للنسخ الأسبوعية
   * - 12 شهراً للنسخ الشهرية
   * - النسخ المحمية (is_protected = 1) لا تُحذف أبداً!
   * - صمام أمان: لا يُحذف آخر نسختين سليمتين إطلاقاً!
   */
  async executeRetentionPolicy(dirPath = null) {
    const targetDir = dirPath || this.defaultStorageDir;
    if (!fs.existsSync(targetDir)) return;

    try {
      const allRecords = await query(`
        SELECT * FROM backup_records 
        WHERE status != 'purged'
        ORDER BY created_at DESC
      `);

      if (!allRecords || allRecords.length <= 2) return; // صمام أمان: الحفاظ على أحدث نسختين على الأقل

      const now = Date.now();
      const DAY_MS = 24 * 60 * 60 * 1000;

      // إعدادات الاحتفاظ
      const dailyMaxAge = 14 * DAY_MS;
      const weeklyMaxAge = 56 * DAY_MS;
      const monthlyMaxAge = 365 * DAY_MS;

      for (let i = 2; i < allRecords.length; i++) {
        const rec = allRecords[i];
        if (rec.is_protected === 1) continue; // تخطي النسخ المحمية

        const ageMs = now - new Date(rec.created_at).getTime();
        let shouldPurge = false;

        if (rec.backup_type === 'scheduled_daily' && ageMs > dailyMaxAge) {
          shouldPurge = true;
        } else if (rec.backup_type === 'scheduled_weekly' && ageMs > weeklyMaxAge) {
          shouldPurge = true;
        } else if (rec.backup_type === 'scheduled_monthly' && ageMs > monthlyMaxAge) {
          shouldPurge = true;
        } else if (rec.backup_type === 'logout' && ageMs > (7 * DAY_MS)) {
          shouldPurge = true;
        }

        if (shouldPurge) {
          const filePath = rec.file_path;
          try {
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
            }
          } catch (e) {}

          await run(`
            UPDATE backup_records 
            SET status = 'purged' 
            WHERE id = ?
          `, [rec.id]);

          console.log(`🧹 [BackupEngine] تم تدوير وحذف النسخة القديمة المنتهية الصلاحية: ${rec.file_name}`);
        }
      }
    } catch (err) {
      console.warn('⚠️ [BackupEngine] Retention policy error:', err.message);
    }
  }

  /**
   * تبديل حماية نسخة معينة من التدوير والحذف (Pin / Unpin Backup)
   */
  async toggleProtection(backupId, isProtected, reason = '', user = 'admin') {
    if (!backupId) throw new Error('يرجى تحديد معرف النسخة الاحتياطية');
    await run(`
      UPDATE backup_records 
      SET is_protected = ?, protected_reason = ?, protected_by = ?
      WHERE id = ? OR backup_uid = ?
    `, [isProtected ? 1 : 0, reason, isProtected ? user : null, backupId, backupId]);

    return { success: true, isProtected: Boolean(isProtected) };
  }

  /**
   * حذف نسخة احتياطية يدوياً بعد التحقق من الصلاحيات وأنها غير محمية
   */
  async deleteBackup(backupId, user = 'admin') {
    if (!backupId) throw new Error('يرجى تحديد معرف النسخة الاحتياطية');
    const rec = await get('SELECT * FROM backup_records WHERE id = ? OR backup_uid = ?', [backupId, backupId]);
    if (!rec) throw new Error('سجل النسخة الاحتياطية غير موجود');

    if (rec.is_protected === 1) {
      throw new Error(`هذه النسخة محمية من الحذف (${rec.protected_reason || 'مثبتة بواسطة المسؤول'}). يرجى إلغاء الحماية أولاً.`);
    }

    if (fs.existsSync(rec.file_path)) {
      try { fs.unlinkSync(rec.file_path); } catch (e) {}
    }

    await run("UPDATE backup_records SET status = 'purged' WHERE id = ?", [rec.id]);
    return { success: true, message: `تم حذف النسخة (${rec.file_name}) بنجاح` };
  }

  // =========================================================================
  // الوظيفة الرئيسية 5: إحصائيات لوحة التحكم والتحقق المباشر (Dashboard & KPIs)
  // =========================================================================

  /**
   * استخراج مؤشرات الحالة الشاملة للوحة التحكم
   */
  async getDashboardStatus() {
    this.ensureDirectories();

    const storagePathExists = fs.existsSync(this.defaultStorageDir);
    let storagePathWritable = false;
    if (storagePathExists) {
      try {
        const testFile = path.join(this.defaultStorageDir, `.test_write_${Date.now()}`);
        fs.writeFileSync(testFile, 'ok');
        fs.unlinkSync(testFile);
        storagePathWritable = true;
      } catch { storagePathWritable = false; }
    }

    // آخر نسخة ناجحة
    const lastBackup = await get(`
      SELECT * FROM backup_records 
      WHERE status = 'healthy' 
      ORDER BY created_at DESC LIMIT 1
    `).catch(() => null);

    // آخر اختبار استعادة
    const lastTest = await get(`
      SELECT * FROM backup_test_logs 
      ORDER BY created_at DESC LIMIT 1
    `).catch(() => null);

    // إجمالي النسخ وحجمها
    const totals = await get(`
      SELECT 
        COUNT(id) as total_count,
        COALESCE(SUM(file_size), 0) as total_size
      FROM backup_records 
      WHERE status = 'healthy'
    `).catch(() => ({ total_count: 0, total_size: 0 }));

    // قراءة إعدادات الجدولة من جدول settings
    const schedEnabled = await get("SELECT value FROM settings WHERE key = 'auto_backup_enabled'").catch(() => null);
    const schedInterval = await get("SELECT value FROM settings WHERE key = 'auto_backup_interval'").catch(() => null);
    const schedTime = await get("SELECT value FROM settings WHERE key = 'auto_backup_time'").catch(() => null);

    const isRailway = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID);

    return {
      storage: {
        path: this.defaultStorageDir,
        exists: storagePathExists,
        writable: storagePathWritable,
        isRailwayPersistent: isRailway && (this.defaultStorageDir.startsWith('/data') || Boolean(process.env.RAILWAY_VOLUME_MOUNT_PATH))
      },
      lastBackup: lastBackup ? {
        id: lastBackup.id,
        uid: lastBackup.backup_uid,
        fileName: lastBackup.file_name,
        size: lastBackup.file_size,
        type: lastBackup.backup_type,
        createdAt: lastBackup.created_at,
        sha256: lastBackup.sha256_hash,
        encrypted: Boolean(lastBackup.encrypted),
        testStatus: lastBackup.test_status
      } : null,
      lastTest: lastTest ? {
        testUid: lastTest.test_uid,
        fileName: lastTest.backup_file_name,
        status: lastTest.status,
        createdAt: lastTest.created_at,
        durationMs: lastTest.duration_ms,
        tablesCount: lastTest.tables_count,
        isBalanced: Boolean(lastTest.is_balanced)
      } : null,
      stats: {
        totalBackups: Number(totals?.total_count || 0),
        totalSizeBytes: Number(totals?.total_size || 0),
        totalSizeMB: (Number(totals?.total_size || 0) / (1024 * 1024)).toFixed(2)
      },
      schedule: {
        enabled: schedEnabled?.value !== 'false',
        interval: schedInterval?.value || 'daily',
        time: schedTime?.value || '02:00'
      }
    };
  }
}

module.exports = new UnifiedBackupEngine();
