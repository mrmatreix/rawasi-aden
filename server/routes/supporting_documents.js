const router = require('express').Router();
const { get, query } = require('../database/db');
const { requirePermission, checkUserScope } = require('../middleware/security');
const { loadVoucherSources, voucherSource } = require('../services/voucherDisplayService');
const entities = { expense: 'expenses', payment: 'payments', journal: 'journal_entries' };

// Resolve the source voucher as well as the journal so its documents remain available after posting.
router.use('/:kind/:entityId', async (req, res, next) => {
  try {
    const { kind, entityId } = req.params;
    const table = entities[kind];
    if (!table) return res.status(400).json({ success: false, message: 'نوع المستند غير صالح' });
    const record = await get('SELECT * FROM ' + table + ' WHERE id = ?', [entityId]);
    if (!record) return res.status(404).json({ success: false, message: 'المستند غير موجود' });
    let source = null;
    if (kind === 'journal') source = voucherSource(record, await loadVoucherSources({ query }));
    const permission = kind === 'journal' ? 'accounting:view' : kind === 'expense' || record.type !== 'قبض' ? 'expenses:view' : 'revenues:view';
    let projectId = record.project_id;
    if (source) {
      const sourceRecord = await get('SELECT project_id FROM ' + entities[source.entity_kind] + ' WHERE id = ?', [source.id]);
      projectId = sourceRecord?.project_id;
    }
    const scope = checkUserScope(req.user, { projectId });
    if (!scope.allowed) return res.status(403).json({ success: false, message: scope.reason });
    req.documentTargets = [[kind, Number(entityId)]];
    if (source) req.documentTargets.push([source.entity_kind, source.id]);
    return requirePermission(permission)(req, res, next);
  } catch (error) { res.status(500).json({ success: false, message: 'تعذر تحميل المؤيدات' }); }
});
function targetWhere(req) {
  return { sql: req.documentTargets.map(() => '(entity_type = ? AND entity_id = ?)').join(' OR '), params: req.documentTargets.flat() };
}
router.get('/:kind/:entityId', async (req, res) => {
  try {
    const where = targetWhere(req);
    const data = await query('SELECT id, file_name, mime_type, size_bytes, created_at FROM supporting_documents WHERE ' + where.sql + ' ORDER BY id', where.params);
    res.json({ success: true, data });
  } catch (error) { res.status(500).json({ success: false, message: 'تعذر تحميل المؤيدات' }); }
});
router.get('/:kind/:entityId/:documentId', async (req, res) => {
  try {
    const where = targetWhere(req);
    const doc = await get('SELECT * FROM supporting_documents WHERE id = ? AND (' + where.sql + ')', [req.params.documentId, ...where.params]);
    if (!doc) return res.status(404).json({ success: false, message: 'المؤيد غير موجود' });
    res.set('Content-Type', doc.mime_type);
    res.set('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(doc.file_name));
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'no-store');
    res.send(Buffer.from(doc.content_base64, 'base64'));
  } catch (error) { res.status(500).json({ success: false, message: 'تعذر تنزيل المؤيد' }); }
});
module.exports = router;
