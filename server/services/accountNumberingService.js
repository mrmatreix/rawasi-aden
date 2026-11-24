const widths = new Map([[0, 1], [1, 1], [2, 1], [3, 2], [5, 3]]);
const levels = new Map([[1, 1], [2, 2], [3, 3], [5, 4], [8, 5]]);

function nextSequentialCode(parentCode, codes) {
  const prefix = parentCode == null ? '' : String(parentCode);
  const width = widths.get(prefix.length);
  if (width === undefined || (prefix && !/^\d+$/.test(prefix))) {
    throw Object.assign(new Error('الحساب المحدد حساب تفصيلي نهائي أو له رقم غير صالح؛ لا يمكن إضافة حساب تحته'), { statusCode: 400 });
  }
  const used = new Set(codes.map(String));
  for (let suffix = 1; suffix < 10 ** width; suffix++) {
    const code = prefix + String(suffix).padStart(width, '0');
    if (!used.has(code)) return { suggested_code: code, level: levels.get(code.length) };
  }
  throw Object.assign(new Error('اكتمل تسلسل أرقام الحسابات تحت هذا الحساب الأب'), { statusCode: 400 });
}

async function suggestAccountNumber(db, parentId = null, excludeId = null) {
  let parent = null;
  if (parentId != null) {
    parent = await db.get('SELECT id, code FROM accounts WHERE id = ?', [parentId]);
    if (!parent) throw Object.assign(new Error('الحساب الأب غير موجود'), { statusCode: 400 });
    if (Number(parent.id) === Number(excludeId)) throw Object.assign(new Error('لا يمكن ربط الحساب بنفسه'), { statusCode: 400 });
  }
  const rows = await db.query('SELECT id, code FROM accounts');
  return nextSequentialCode(parent?.code, rows.filter(row => Number(row.id) !== Number(excludeId)).map(row => row.code));
}

async function assertAccountNumber(db, code, parentId, excludeId = null) {
  const next = await suggestAccountNumber(db, parentId, excludeId);
  if (String(code) !== next.suggested_code) {
    throw Object.assign(new Error(`لا يمكن القفز في ترقيم الحسابات. رقم الحساب التالي المطلوب هو ${next.suggested_code}`),
      { statusCode: 400, suggested_code: next.suggested_code });
  }
  return next;
}

module.exports = { nextSequentialCode, suggestAccountNumber, assertAccountNumber };
