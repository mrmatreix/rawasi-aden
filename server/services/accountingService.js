/**
 * خدمة الحسابات المالية العامة (Accounting Service)
 * تفصل منطق الأعمال والتحقق المالي عن مسارات الـ HTTP/Routes
 */

const { get, query, run, transaction, getActiveEngine } = require('../database/db');
const { checkPeriodOpen } = require('./periodService');
const { logAudit } = require('./auditService');

let custodyLinksEnsured = false;

const AccountingService = {
  /**
   * التحقق المالي الصارم من توازن وصحة سطور القيد اليومي ومراكز التكلفة
   */
  async validateJournalEntryLines(lines) {
    if (!Array.isArray(lines) || lines.length < 2) {
      throw new Error('يجب أن يحتوي القيد على سطرين على الأقل (طرف مدين وطرف دائن)');
    }

    let totalDebit = 0;
    let totalCredit = 0;
    const sanitizedLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const accountId = Number(line.account_id);
      if (!accountId) {
        throw new Error(`السطر رقم ${i + 1}: يرجى تحديد الحساب المالي`);
      }

      const debit = Math.round(Number(line.debit || 0) * 100) / 100;
      const credit = Math.round(Number(line.credit || 0) * 100) / 100;

      if (debit < 0 || credit < 0) {
        throw new Error(`السطر رقم ${i + 1}: لا يمكن إدخال مبالغ سالبة`);
      }
      if (debit === 0 && credit === 0) {
        continue; // تجاهل السطور الفارغة
      }
      if (debit > 0 && credit > 0) {
        throw new Error(`السطر رقم ${i + 1}: لا يمكن تحديد مبلغ مدين ودائن معاً لنفس الحساب في نفس السطر`);
      }

      // التحقق من طبيعة الحساب وإلزامية مركز التكلفة لقائمة الدخل
      const account = await get('SELECT id, code, name, type FROM accounts WHERE id = ?', [accountId]);
      if (!account) {
        throw new Error(`السطر رقم ${i + 1}: الحساب المالي غير موجود في الدليل`);
      }

      const isNominal = account.type === 'مصروفات' || account.type === 'إيرادات' || 
                        account.code.startsWith('4') || account.code.startsWith('5');
      const costCenterId = line.cost_center_id ? Number(line.cost_center_id) : null;

      if (isNominal && !costCenterId) {
        throw new Error(`السطر رقم ${i + 1}: الحساب [${account.code} - ${account.name}] من حسابات قائمة الدخل ويشترط تحديد مركز تكلفة معتمد له`);
      }

      totalDebit += debit;
      totalCredit += credit;

      sanitizedLines.push({
        account_id: accountId,
        cost_center_id: costCenterId,
        debit,
        credit,
        description: (line.description || line.notes || '').trim()
      });
    }

    totalDebit = Math.round(totalDebit * 100) / 100;
    totalCredit = Math.round(totalCredit * 100) / 100;

    if (sanitizedLines.length < 2) {
      throw new Error('يجب إدخال قيمتين ماليتين موجبتين على الأقل لتكوين القيد');
    }
    if (totalDebit <= 0) {
      throw new Error('إجمالي قيمة القيد يجب أن تكون أكبر من الصفر');
    }

    const diff = Math.abs(totalDebit - totalCredit);
    if (diff > 0.001) {
      throw new Error(`⛔ القيد غير متزن محاسبياً! إجمالي المدين (${totalDebit}) لا يساوي إجمالي الدائن (${totalCredit})، يوجد فرق قدره (${diff})`);
    }

    return {
      sanitizedLines,
      totalDebit,
      totalCredit
    };
  },

  /**
   * إنشاء قيد يومية جديد مع فحص الفترة المحاسبية وحفظ سطور القيد داخل Transaction ذرية
   */
  async createJournalEntry(entryData, lines, req = null) {
    const { date, description, reference_type = 'قيد يدوي', reference_id = null } = entryData;

    if (!date || !description) {
      throw new Error('تاريخ القيد والبيان حقول إلزامية');
    }

    // 1. فحص إغلاق الفترة المحاسبية
    const periodCheck = await checkPeriodOpen(date);
    if (!periodCheck.isOpen) {
      throw new Error(periodCheck.message);
    }

    // 2. التحقق المالي الصارم من التوازن ومراكز التكلفة
    const { sanitizedLines, totalDebit, totalCredit } = await this.validateJournalEntryLines(lines);

    // 3. توليد رقم القيد التسلسلي (حلقة فرادة: COUNT+1 وحده يصطدم بعد أي حذف قيد)
    const countRow = await get('SELECT COUNT(*) as count FROM journal_entries');
    let jeSeqAc = (countRow?.count || 0) + 1;
    let entryNo = `JV-${new Date().getFullYear()}-${String(jeSeqAc).padStart(4, '0')}`;
    while (await get('SELECT id FROM journal_entries WHERE entry_no = ?', [entryNo])) {
      jeSeqAc += 1;
      entryNo = `JV-${new Date().getFullYear()}-${String(jeSeqAc).padStart(4, '0')}`;
    }

    // 4. الحفظ الذري مع توثيق المنشئ وحالة الترحيل
    let validCreatorId = null;
    const rawCreatorId = req?.user?.id || null;
    if (rawCreatorId) {
      try {
        const u = await get('SELECT id FROM users WHERE id = ?', [Number(rawCreatorId)]);
        if (u) validCreatorId = u.id;
      } catch {}
    }
    const creatorName = req?.user?.username || req?.user?.full_name || 'المحاسب المالي';
    const status = entryData.status || 'posted';

    let entryId = null;
    await transaction(async (tx) => {
      const res = await tx.run(`
        INSERT INTO journal_entries (
          entry_no, date, description, reference_type, reference_id, 
          total_debit, total_credit, status, 
          created_by, created_by_name, posted_by, posted_by_name, posted_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        entryNo, date, description.trim(), reference_type, reference_id, 
        totalDebit, totalCredit, status,
        validCreatorId, creatorName, 
        status === 'posted' ? validCreatorId : null,
        status === 'posted' ? creatorName : null,
        status === 'posted' ? new Date().toISOString() : null
      ]);

      entryId = res.lastInsertRowid || res.insertId;

      for (const line of sanitizedLines) {
        await tx.run(`
          INSERT INTO journal_entry_lines (entry_id, account_id, cost_center_id, debit, credit, notes)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [entryId, line.account_id, line.cost_center_id, line.debit, line.credit, line.description]);
      }
    });

    // 5. تسجيل التدقيق الرقابي مع بيانات القيمة والحالة
    if (req) {
      await logAudit(req, {
        action: status === 'draft' ? 'CREATE_DRAFT' : 'INSERT',
        entity_type: 'journal_entry',
        entity_id: entryNo,
        details: { entry_no: entryNo, date, total_debit: totalDebit, total_credit: totalCredit, lines_count: sanitizedLines.length, status },
        new_values: { entry_no: entryNo, date, total_debit: totalDebit, total_credit: totalCredit, status, created_by: creatorName }
      });
    }

    return {
      id: entryId,
      entry_no: entryNo,
      total_debit: totalDebit,
      total_credit: totalCredit,
      status
    };
  },

  /**
   * SUGGESTION-4 (§12): ربط العهد والسلف بقيودها (idempotent — خارج المعاملات).
   * - custodies.journal_entry_id + employee_advances.journal_entry_id
   * - custodies.project_id (صندوق الصرف — ترثه التصفية)
   */
  async ensureCustodyJournalLinks() {
    if (custodyLinksEnsured) return true;
    const engine = typeof getActiveEngine === 'function' ? getActiveEngine() : 'sqlite';

    const ensureColumn = async (table, column, sqliteDef, mysqlDef) => {
      if (engine === 'mysql') {
        const cols = await query(`SHOW COLUMNS FROM ${table}`);
        const names = (cols || []).map(c => c.Field || c.field || c.COLUMN_NAME);
        if (!names.includes(column)) {
          await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${mysqlDef}`);
        }
      } else {
        const cols = await query(`PRAGMA table_info(${table})`);
        const names = (cols || []).map(c => c.name);
        if (!names.includes(column)) {
          await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${sqliteDef}`);
        }
      }
    };

    try {
      await ensureColumn('custodies', 'journal_entry_id', 'INTEGER', 'INT NULL');
      await ensureColumn('custodies', 'project_id', 'INTEGER', 'INT NULL');
      await ensureColumn('employee_advances', 'journal_entry_id', 'INTEGER', 'INT NULL');
      custodyLinksEnsured = true;
      return true;
    } catch (err) {
      console.warn('⚠️ [Accounting] تعذر التأكد من ربط العهد بالقيود:', err.message);
      throw err;
    }
  }
};

module.exports = AccountingService;
