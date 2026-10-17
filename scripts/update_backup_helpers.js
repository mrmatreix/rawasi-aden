const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'js', 'settings.js');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Update loadServerBackups
const oldServerBtn = `<button type="button" class="btn btn-secondary btn-sm" onclick="Settings.selectServerBackup('\${b.fileName}')">
                  اختيار هذه النسخة
                </button>`;

const newServerBtn = `<div style="display: flex; gap: 8px;">
                  <button type="button" class="btn btn-secondary btn-sm" onclick="Settings.downloadServerBackup('\${b.fileName}')" title="تنزيل النسخة إلى جهازك">
                    📥 تنزيل
                  </button>
                  <button type="button" class="btn btn-primary btn-sm" onclick="Settings.selectServerBackup('\${b.fileName}')">
                    اختيار هذه النسخة
                  </button>
                </div>`;

if (content.includes('Settings.selectServerBackup(\'${b.fileName}\')')) {
  content = content.replace(oldServerBtn, newServerBtn);
  console.log('✓ Updated loadServerBackups buttons');
}

// 2. Update loadLogoutBackups to add download button
const oldLogoutTd = `<td style="text-align: center;">
                <button type="button" class="btn btn-secondary btn-sm" onclick="Settings.confirmRestoreLogoutBackup('\${b.fileName}')" title="استعادة هذه النقطة الزمنية">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="vertical-align: middle;"><path d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/></svg>
                  <span>استعادة</span>
                </button>
              </td>`;

const newLogoutTd = `<td style="text-align: center;">
                <div style="display: inline-flex; gap: 6px;">
                  <button type="button" class="btn btn-secondary btn-sm" onclick="Settings.downloadServerBackup('\${b.fileName}')" title="تنزيل النسخة إلى جهازك">
                    <span>📥 تنزيل</span>
                  </button>
                  <button type="button" class="btn btn-secondary btn-sm" onclick="Settings.confirmRestoreLogoutBackup('\${b.fileName}')" title="استعادة هذه النقطة الزمنية">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="vertical-align: middle;"><path d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/></svg>
                    <span>استعادة</span>
                  </button>
                </div>
              </td>`;

if (content.includes('Settings.confirmRestoreLogoutBackup(\'${b.fileName}\')')) {
  content = content.replace(oldLogoutTd, newLogoutTd);
  console.log('✓ Updated loadLogoutBackups buttons');
}

// 3. Update cloud backup download link
const oldCloudLink = `<a href="/api/settings/cloud-backup/download/\${encodeURIComponent(item.fileName)}" class="btn btn-secondary btn-sm" title="تنزيل الأرشيف إلى جهازك" style="padding: 4px 8px;">`;
const newCloudLink = `<a href="javascript:void(0)" onclick="Settings.downloadCloudArchive('\${item.fileName}')" class="btn btn-secondary btn-sm" title="تنزيل الأرشيف إلى جهازك" style="padding: 4px 8px;">`;

if (content.includes(oldCloudLink)) {
  content = content.replace(oldCloudLink, newCloudLink);
  console.log('✓ Updated cloud backup download link in table');
}

// Add downloadCloudArchive helper
if (!content.includes('downloadCloudArchive(')) {
  const marker = '  openEncryptedRestoreModal(';
  const helperCode = `  async downloadCloudArchive(fileName) {
    try {
      const token = (window.Auth && window.Auth.token)
        || localStorage.getItem('rawasi_token')
        || sessionStorage.getItem('rawasi_token')
        || '';
      const url = \`/api/settings/cloud-backup/download/\${encodeURIComponent(fileName)}\${token ? \`?token=\${encodeURIComponent(token)}\` : ''}\`;
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => a.remove(), 1000);
      App.showToast(\`جاري تنزيل الأرشيف: \${fileName}\`, 'info');
    } catch (e) {
      App.showToast('تعذر تنزيل ملف الأرشيف', 'error');
    }
  },

  openEncryptedRestoreModal(`;

  content = content.replace(marker, helperCode);
  console.log('✓ Added downloadCloudArchive method');
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('✓ All settings.js download updates applied!');
