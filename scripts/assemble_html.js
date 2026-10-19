/**
 * مجمع ومطور مكونات HTML - رواسي عدن (HTML Component Assembler)
 * يجمع النوافذ والمكونات المعيارية من views/ إلى index.html ويحقن البصمات التلقائية
 */

const fs = require('fs');
const path = require('path');
const { updateAssetVersions } = require('./version_manager');

function assembleHtml() {
  const root = path.resolve(__dirname, '..');
  const indexPath = path.join(root, 'index.html');
  const modalsDir = path.join(root, 'views', 'modals');

  if (!fs.existsSync(indexPath)) {
    console.error('index.html not found!');
    return;
  }

  let html = fs.readFileSync(indexPath, 'utf8');
  const { renderNavigation } = require('./navigation_config');
  html = html.replace(/(<nav aria-label="القائمة الرئيسية"><ul class="sidebar-nav" id="sidebarNavList">)[\s\S]*?(<\/ul><\/nav>)/, (_match, start, end) => start + renderNavigation() + end);

  // 1. حقن events.js قبل app.js إذا لم يكن موجوداً
  if (!html.includes('js/events.js')) {
    html = html.replace(
      /(<script src="js\/auth\.js[^"]*"><\/script>)/i,
      `$1\n  <script src="js/events.js"></script>`
    );
    console.log('✓ تم ربط محرك تفويض الأحداث js/events.js');
  }

  // 3. حقن النوافذ المنبثقة من views/modals/ قبل نهاية body
  const modalFiles = ['period_close_modal.html', 'accounting_periods_modal.html', 'audit_log_modal.html'];
  modalFiles.forEach(file => {
    const mPath = path.join(modalsDir, file);
    if (fs.existsSync(mPath)) {
      const modalContent = fs.readFileSync(mPath, 'utf8').trim();
      const modalIdMatch = modalContent.match(/id=["']([^"']+)["']/);
      const modalId = modalIdMatch ? modalIdMatch[1] : null;

      if (modalId && !html.includes(`id="${modalId}"`)) {
        html = html.replace('</body>', `\n  ${modalContent}\n</body>`);
        console.log(`✓ تم حقن المكون المعياري: views/modals/${file}`);
      }
    }
  });

  fs.writeFileSync(indexPath, html, 'utf8');

  // 4. تشغيل مدير الإصدارات لحقن البصمة التلقائية
  const version = updateAssetVersions();
  console.log(`🚀 اكتمل تجميع وبناء المكونات بنجاح بالإصدار: ${version}`);
}

if (require.main === module) {
  assembleHtml();
}

module.exports = { assembleHtml };
