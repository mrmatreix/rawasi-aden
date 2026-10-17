const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dashPath = path.join(root, 'views', 'dashboard.html');
const dashHtml = fs.readFileSync(dashPath, 'utf8').trim();

const targets = [
  path.join(root, 'index.html'),
  path.join(root, 'www', 'index.html')
];

targets.forEach(targetFile => {
  if (fs.existsSync(targetFile)) {
    let content = fs.readFileSync(targetFile, 'utf8');
    const regex = /(<section[^>]*id=["']dashboardView["'][\s\S]*?<\/section>)/i;
    if (regex.test(content)) {
      content = content.replace(regex, dashHtml);
      fs.writeFileSync(targetFile, content, 'utf8');
      console.log(`✓ Synchronized dashboardView into ${path.relative(root, targetFile)}`);
    } else {
      console.warn(`⚠️ dashboardView not found in ${targetFile}`);
    }
  }
});
