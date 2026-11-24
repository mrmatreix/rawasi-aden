const fs=require('node:fs');const path=require('node:path');
function validateUpload(name,bytes){
 const ext=path.extname(name||'').toLowerCase();
 if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>25*1024*1024)throw Object.assign(new Error('حجم الملف غير مسموح'),{statusCode:400});
 const start=bytes.subarray(0,16);const ascii=start.toString('latin1');
 const valid=ext==='.pdf'?ascii.startsWith('%PDF-'):['.jpg','.jpeg'].includes(ext)?start[0]===255&&start[1]===216&&start[2]===255:ext==='.png'?start.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):ext==='.webp'?ascii.startsWith('RIFF')&&ascii.slice(8,12)==='WEBP':['.zip','.docx','.xlsx'].includes(ext)?ascii.startsWith('PK\x03\x04'):['.doc','.xls'].includes(ext)?start.subarray(0,8).equals(Buffer.from('d0cf11e0a1b11ae1','hex')):ext==='.rar'?ascii.startsWith('Rar!'):ext==='.dwg'?/^AC\d{4}/.test(ascii):ext==='.dxf'?/SECTION/.test(bytes.subarray(0,4096).toString('ascii')):false;
 if(!valid)throw Object.assign(new Error('محتوى الملف لا يطابق نوعه أو النوع غير مسموح'),{statusCode:400});
 return bytes;
}
module.exports={validateUpload};
