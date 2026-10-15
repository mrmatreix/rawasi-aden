const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'js', 'settings.js');
const raw = fs.readFileSync(filePath, 'utf8');
const isCrlf = raw.includes('\r\n');
const lines = raw.split(/\r?\n/);

const startIdx = lines.findIndex(l => l.includes('async downloadBackup()'));
if (startIdx === -1) {
  console.error('Could not find async downloadBackup()');
  process.exit(1);
}

// Find ending comma line
let endIdx = startIdx;
while (endIdx < lines.length && !lines[endIdx].trim().startsWith('},')) {
  endIdx++;
}

console.log(`Replacing lines ${startIdx} to ${endIdx}`);

const newBlock = [
  '  // ================== تنزيل نسخة احتياطية كاملة ==================',
  '  async downloadBackup() {',
  '    const btn = document.querySelector(\'button[onclick="Settings.downloadBackup()"]\');',
  '    const originalText = btn ? btn.innerHTML : \'\';',
  '    try {',
  '      if (btn) {',
  '        btn.disabled = true;',
  '        btn.innerHTML = \'<span>⏳ جاري إعداد وتنزيل النسخة...</span>\';',
  '      }',
  '      App.showToast(\'جاري تحضير وتنزيل النسخة الاحتياطية لكافة بيانات ومشاريع وحسابات النظام...\', \'info\');',
  '',
  '      const token = (window.Auth && window.Auth.token)',
  '        || localStorage.getItem(\'rawasi_token\')',
  '        || sessionStorage.getItem(\'rawasi_token\')',
  '        || \'\';',
  '',
  '      const downloadUrl = `/api/settings/backup${token ? `?token=${encodeURIComponent(token)}` : \'\'}`;',
  '',
  '      // محاولة التنزيل المباشر كـ Blob مع توثيق التوكن لضمان الحفظ الموثوق',
  '      const res = await fetch(downloadUrl, {',
  '        method: \'GET\',',
  '        headers: token ? { \'Authorization\': `Bearer ${token}` } : {}',
  '      });',
  '',
  '      if (!res.ok) {',
  '        let errMsg = `فشل تنزيل النسخة الاحتياطية (رمز: ${res.status})`;',
  '        try {',
  '          const errData = await res.json();',
  '          if (errData && errData.message) errMsg = errData.message;',
  '        } catch (_) {}',
  '        throw new Error(errMsg);',
  '      }',
  '',
  '      const blob = await res.blob();',
  '      const contentDisposition = res.headers.get(\'content-disposition\');',
  '      let fileName = `backup_rawasi_${new Date().toISOString().replace(/[:.]/g, \'-\').slice(0, 19)}.db`;',
  '      if (contentDisposition) {',
  '        const match = contentDisposition.match(/filename[^;=\\n]*=(([\'"]).*?\\2|[^;\\n]*)/);',
  '        if (match && match[1]) {',
  '          fileName = match[1].replace(/[\'"]/g, \'\').trim();',
  '        }',
  '      }',
  '',
  '      // إنشاء رابط التنزيل وتفعيله برمجياً',
  '      const blobUrl = window.URL.createObjectURL(blob);',
  '      const a = document.createElement(\'a\');',
  '      a.style.display = \'none\';',
  '      a.href = blobUrl;',
  '      a.download = fileName;',
  '      document.body.appendChild(a);',
  '      a.click();',
  '',
  '      setTimeout(() => {',
  '        window.URL.revokeObjectURL(blobUrl);',
  '        a.remove();',
  '      }, 2000);',
  '',
  '      App.showToast(\'تم تنزيل النسخة الاحتياطية الكاملة بنجاح والاحتفاظ بها على جهازك بأمان 💾\', \'success\');',
  '      if (typeof this.loadServerBackups === \'function\') {',
  '        this.loadServerBackups();',
  '      }',
  '    } catch (e) {',
  '      console.error(\'Backup download error:\', e);',
  '      // في حالة وجود إشكال مع Blob، نوفر fallback بالرابط المباشر متضمناً التوكن',
  '      const token = (window.Auth && window.Auth.token)',
  '        || localStorage.getItem(\'rawasi_token\')',
  '        || sessionStorage.getItem(\'rawasi_token\')',
  '        || \'\';',
  '      if (token) {',
  '        App.showToast(\'جاري بدء التنزيل المباشر كحل بديل...\', \'info\');',
  '        window.location.href = `/api/settings/backup?token=${encodeURIComponent(token)}`;',
  '      } else {',
  '        App.showToast(e.message || \'خطأ في تنزيل النسخة الاحتياطية\', \'error\');',
  '      }',
  '    } finally {',
  '      if (btn) {',
  '        btn.disabled = false;',
  '        btn.innerHTML = originalText;',
  '      }',
  '    }',
  '  },',
  '',
  '  async downloadServerBackup(fileName) {',
  '    try {',
  '      const token = (window.Auth && window.Auth.token)',
  '        || localStorage.getItem(\'rawasi_token\')',
  '        || sessionStorage.getItem(\'rawasi_token\')',
  '        || \'\';',
  '      const url = `/api/settings/backups/download/${encodeURIComponent(fileName)}${token ? `?token=${encodeURIComponent(token)}` : \'\'}`;',
  '      ',
  '      const res = await fetch(url, {',
  '        method: \'GET\',',
  '        headers: token ? { \'Authorization\': `Bearer ${token}` } : {}',
  '      });',
  '',
  '      if (!res.ok) {',
  '        throw new Error(`تعذر تنزيل الملف (رمز: ${res.status})`);',
  '      }',
  '',
  '      const blob = await res.blob();',
  '      const blobUrl = window.URL.createObjectURL(blob);',
  '      const a = document.createElement(\'a\');',
  '      a.style.display = \'none\';',
  '      a.href = blobUrl;',
  '      a.download = fileName;',
  '      document.body.appendChild(a);',
  '      a.click();',
  '      setTimeout(() => {',
  '        window.URL.revokeObjectURL(blobUrl);',
  '        a.remove();',
  '      }, 2000);',
  '',
  '      App.showToast(`تم تنزيل النسخة الاحتياطية (${fileName}) بنجاح 💾`, \'success\');',
  '    } catch (e) {',
  '      console.error(\'Error downloading server backup:\', e);',
  '      const token = (window.Auth && window.Auth.token)',
  '        || localStorage.getItem(\'rawasi_token\')',
  '        || sessionStorage.getItem(\'rawasi_token\')',
  '        || \'\';',
  '      if (token) {',
  '        window.location.href = `/api/settings/backups/download/${encodeURIComponent(fileName)}?token=${encodeURIComponent(token)}`;',
  '      } else {',
  '        App.showToast(\'تعذر تنزيل النسخة المحددة\', \'error\');',
  '      }',
  '    }',
  '  },'
];

// Check if preceding line is header comment
let replaceStart = startIdx;
if (startIdx > 0 && lines[startIdx - 1].includes('تنزيل نسخة احتياطية')) {
  replaceStart = startIdx - 1;
}

lines.splice(replaceStart, (endIdx - replaceStart + 1), ...newBlock);

const newline = isCrlf ? '\r\n' : '\n';
fs.writeFileSync(filePath, lines.join(newline), 'utf8');
console.log('✓ Successfully updated Settings.downloadBackup in js/settings.js');
