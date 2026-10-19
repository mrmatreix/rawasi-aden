async function resolveAccountCostCenter(db, parentId, type, value) {
  const parent = parentId ? await db.get('SELECT type FROM accounts WHERE id = ?', [parentId]) : null;
  const effectiveType = String(parent?.type || type || '').trim().toLowerCase();
  const required = ['expense', 'revenue', 'cost', 'مصروفات', 'تكاليف', 'إيرادات', 'ايرادات'].includes(effectiveType);
  const id = value === null || value === undefined || value === '' ? null : Number(value);
  if (required && !id) throw Object.assign(new Error('مركز التكلفة إلزامي عند إضافة حساب مصروفات أو إيرادات بحسب تصنيف الحساب الأب'), { statusCode: 400 });
  if (id !== null && (!Number.isInteger(id) || id <= 0 || !await db.get("SELECT id FROM cost_centers WHERE id = ? AND COALESCE(status, 'active') = 'active'", [id]))) {
    throw Object.assign(new Error('يرجى اختيار مركز تكلفة نشط وصالح'), { statusCode: 400 });
  }
  return { type: parent?.type || type, cost_center_id: id };
}
module.exports = { resolveAccountCostCenter };
