function invalid(message) { return Object.assign(new Error(message), { statusCode: 400 }); }
const formats = {
  pdf: ['application/pdf', b => b.subarray(0, 5).toString() === '%PDF-'],
  png: ['image/png', b => b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))],
  jpg: ['image/jpeg', b => b[0] === 255 && b[1] === 216 && b[2] === 255],
  jpeg: ['image/jpeg', b => b[0] === 255 && b[1] === 216 && b[2] === 255],
  webp: ['image/webp', b => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', b => b[0] === 80 && b[1] === 75],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', b => b[0] === 80 && b[1] === 75]
};

function validateDocuments(files) {
  if (files === undefined || files === null) return [];
  if (!Array.isArray(files) || files.length > 10) throw invalid('الحد الأقصى 10 مؤيدات لكل عملية');
  let total = 0;
  return files.map(file => {
    const name = String(file?.name || '').replace(/[\\/\r\n\x00-\x1f]/g, '_').slice(0, 200);
    const extension = name.split('.').pop().toLowerCase();
    const format = Object.hasOwn(formats, extension) ? formats[extension] : null;
    const base64 = String(file?.content_base64 || '');
    if (!format || !base64 || base64.length > 14 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw invalid('المؤيدات المسموحة: PDF، صور، Word وExcel');
    const bytes = Buffer.from(base64, 'base64');
    total += bytes.length;
    if (!bytes.length || bytes.length > 10 * 1024 * 1024 || total > 20 * 1024 * 1024) throw invalid('حد الملف 10 ميجابايت ومجموع المرفقات 20 ميجابايت');
    if (['docx', 'xlsx'].includes(extension)) {
      try {
        const zip = new (require('adm-zip'))(bytes);
        if (!zip.getEntry('[Content_Types].xml') || !zip.getEntry(extension === 'docx' ? 'word/document.xml' : 'xl/workbook.xml')) throw new Error();
      } catch { throw invalid('ملف Word أو Excel غير صالح: ' + name); }
    }
    if (!format[1](bytes)) throw invalid('محتوى الملف لا يطابق نوعه: ' + name);
    return { name, mime: format[0], size: bytes.length, content_base64: bytes.toString('base64') };
  });
}

async function saveDocuments(db, kind, id, files) {
  if (!['expense', 'payment', 'journal'].includes(kind)) throw invalid('نوع المستند غير صالح');
  const docs = validateDocuments(files);
  if (!docs.length) return;
  const count = await db.get('SELECT COUNT(*) AS count, COALESCE(SUM(size_bytes), 0) AS size FROM supporting_documents WHERE entity_type = ? AND entity_id = ?', [kind, id]);
  if (Number(count.count) + docs.length > 10) throw invalid('الحد الأقصى 10 مؤيدات لكل عملية');
  if (Number(count.size) + docs.reduce((sum, doc) => sum + doc.size, 0) > 20 * 1024 * 1024) throw invalid('مجموع المؤيدات للعملية لا يتجاوز 20 ميجابايت');
  for (const doc of docs) await db.run(`INSERT INTO supporting_documents
    (entity_type, entity_id, file_name, mime_type, size_bytes, content_base64) VALUES (?, ?, ?, ?, ?, ?)`,
  [kind, id, doc.name, doc.mime, doc.size, doc.content_base64]);
}

module.exports = { validateDocuments, saveDocuments };
