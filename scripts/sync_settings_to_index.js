const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const settingsPath = path.join(root, 'views', 'settings.html');
const settingsHtml = fs.readFileSync(settingsPath, 'utf8').trim();

const targets = [
  path.join(root, 'index.html'),
  path.join(root, 'www', 'index.html')
];

targets.forEach(targetFile => {
  if (fs.existsSync(targetFile)) {
    let content = fs.readFileSync(targetFile, 'utf8');
    const regex = /(<section[^>]*id=["']settingsView["'][\s\S]*?<\/section>)/i;
    if (regex.test(content)) {
      content = content.replace(regex, settingsHtml);
      fs.writeFileSync(targetFile, content, 'utf8');
      console.log(`✓ Synchronized settingsView into ${path.relative(root, targetFile)}`);
    } else {
      console.warn(`⚠️ settingsView not found in ${targetFile}`);
    }
  }
});
