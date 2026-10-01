/**
 * أداة إدارة الإصدارات وكسر الكاش بالبصمة الحتمية (Content-Hash Fingerprinting)
 * تحقن بصمة كل أصل من محتواه (md5 مختصر) في index.html و sw.js و js/app.js.
 *
 * حتمية بالتصميم: إعادة البناء دون تغيير المحتوى تُنتج بايتات مطابقة (لا ضجيج Git
 * ولا انحراف في مرآة www/). كسر الكاش صحيح: أي تغيير محتوى يغير البصمة تلقائياً.
 * تمرير نسخة مخصصة (CLI) يُبقي السلوك القديم العام لإصدارات النشر المرقمة.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');

function fileHash(relPath) {
  try {
    const clean = String(relPath).split('?')[0].replace(/^\.\//, '');
    const abs = path.join(root, clean);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
    return crypto.createHash('md5').update(fs.readFileSync(abs)).digest('hex').slice(0, 8);
  } catch {
    return null;
  }
}

function rewriteVersionedRefs(html, globalVersion) {
  // href="*.css|*.json?v=" + src="*.js?v=" + register('./sw.js?v=')
  const refOf = (attr, quote, file) => {
    if (globalVersion) return `${attr}${quote}${file}?v=${globalVersion}${quote}`;
    const h = fileHash(file);
    return h ? `${attr}${quote}${file}?v=${h}${quote}` : null;
  };
  html = html.replace(/(href=)(["'])([^"']+?\.(?:css|json))(\?v=[^"']*)?\2/gi,
    (m, attr, q, file) => refOf(attr, q, file) || m);
  html = html.replace(/(src=)(["'])([^"']+?\.js)(\?v=[^"']*)?\2/gi,
    (m, attr, q, file) => refOf(attr, q, file) || m);
  html = html.replace(/(register\()(['"])\.\/sw\.js(\?v=[^'"]*)?\2/gi,
    (m, fn, q) => {
      if (globalVersion) return `${fn}${q}./sw.js?v=${globalVersion}${q}`;
      const h = fileHash('sw.js');
      return h ? `${fn}${q}./sw.js?v=${h}${q}` : m;
    });
  return html;
}

function combinedVersion() {
  // بصمة مركبة مستقرة من محتويات الأصول المفهرسة (لـ CACHE_NAME و assetVersion)
  // ملاحظة: تُستبعد الملفات المختومة نفسها (index/sw/app) — بصمتها ذاتية المرجع ولا تتقارب أبداً.
  const files = ['manifest.json', 'css/style.css',
    'js/auth.js', 'js/events.js', 'js/ui-ux.js', 'js/projects.js',
    'js/project_hub.js', 'js/project_control_ui.js', 'js/accounting.js',
    'js/inventory.js', 'js/hr.js', 'js/reports.js', 'js/settings.js',
    'js/tafqeet.js', 'js/excel-export.js'];
  const h = crypto.createHash('md5');
  for (const f of files) {
    const fh = fileHash(f);
    if (fh) h.update(`${f}:${fh};`);
  }
  let baseVersion = '5.3.0';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    baseVersion = pkg.version || baseVersion;
  } catch {}
  return `${baseVersion}.${h.digest('hex').slice(0, 8)}`;
}

function updateAssetVersions(customVersion = null) {
  const version = customVersion || combinedVersion();
  console.log(`⚡ [VersionManager] بصمة الإصدار الحتمية: ${version}`);

  // 1. js/app.js — سجل الوحدات + نسخة الأصول
  const appJsPath = path.join(root, 'js', 'app.js');
  if (fs.existsSync(appJsPath)) {
    let appJs = fs.readFileSync(appJsPath, 'utf8');
    if (appJs.includes('assetVersion:')) {
      appJs = appJs.replace(/assetVersion:\s*['"][^'"]*['"]/, () => `assetVersion: '${version}'`);
    } else {
      appJs = appJs.replace(/const App = \{/, () => `const App = \{\n  assetVersion: '${version}',`);
    }
    // مراجع الوحدات الداخلية: بصمة كل ملف من محتواه
    appJs = appJs.replace(/(['"])(js\/[^'"]+?\.js)(\?v=[^'"]*)?\1/g,
      (m, q, file) => {
        if (customVersion) return `${q}${file}?v=${customVersion}${q}`;
        const h = fileHash(file);
        return h ? `${q}${file}?v=${h}${q}` : m;
      });
    fs.writeFileSync(appJsPath, appJs, 'utf8');
    console.log('✓ تم تحديث سجل الوحدات assetVersion في js/app.js');
  }

  // 2. sw.js — اسم كاش مستقر يتغير فقط عند تغير المحتوى
  const swPath = path.join(root, 'sw.js');
  if (fs.existsSync(swPath)) {
    const swContent = fs.readFileSync(swPath, 'utf8')
      .replace(/const CACHE_NAME = ['"][^'"]+['"];/, () => `const CACHE_NAME = 'rawasi-aden-${version}';`);
    fs.writeFileSync(swPath, swContent, 'utf8');
    console.log(`✓ تم تحديث CACHE_NAME في sw.js -> rawasi-aden-${version}`);
  }

  // 3. index.html — أخيراً: يبصم sw.js بعد ختمه النهائي (تقارب من تشغيل واحد) — بصمة كل أصل من محتواه (أو العامة عند تمرير نسخة مخصصة)
  const indexPath = path.join(root, 'index.html');
  if (fs.existsSync(indexPath)) {
    const before = fs.readFileSync(indexPath, 'utf8');
    fs.writeFileSync(indexPath, rewriteVersionedRefs(before, customVersion), 'utf8');
    console.log('✓ تم تحديث بصمات الكاش في index.html');
  }

  return version;
}

if (require.main === module) {
  const custom = process.argv[2] || null;
  updateAssetVersions(custom);
}

module.exports = { updateAssetVersions };
