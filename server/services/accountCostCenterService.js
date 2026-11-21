async function resolveAccountCostCenter(db, parentId, type, value, requiredValue) {
  const parent = parentId ? await db.get('SELECT type FROM accounts WHERE id = ?', [parentId]) : null;
  const effectiveType = String(parent?.type || type || '').trim().toLowerCase();
  const required = ['expense', 'revenue', 'cost', 'مصروفات', 'تكاليف', 'إيرادات', 'ايرادات'].includes(effectiveType);
  const id = value === null || value === undefined || value === '' ? null : Number(value);
  // Older clients still send a default center; new clients configure usage policy.
  const legacy = requiredValue === undefined;
  if (!legacy && ![0, 1, '0', '1', true, false].includes(requiredValue)) throw Object.assign(new Error('استخدام مركز التكلفة يجب أن يكون إلزامي أو غير إلزامي'), { statusCode: 400 });
  if ((required || Number(requiredValue) === 1) && !id) throw Object.assign(new Error('مركز التكلفة الافتراضي إلزامي لهذا الحساب بحسب نوعه وإعداد استخدام مراكز التكلفة'), { statusCode: 400 });
  if (id !== null && (!Number.isInteger(id) || id <= 0 || !await db.get("SELECT id FROM cost_centers WHERE id = ? AND COALESCE(status, 'active') = 'active'", [id]))) {
    throw Object.assign(new Error('يرجى اختيار مركز تكلفة نشط وصالح'), { statusCode: 400 });
  }
  return { type: parent?.type || type, cost_center_id: id, cost_center_required: legacy ? Number(required || !!id) : Number(requiredValue) };
}
module.exports = { resolveAccountCostCenter };
