const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'src', 'main', 'ui', 'overlay.html');
const destDir = path.join(__dirname, '..', 'dist', 'main', 'ui');
fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, path.join(destDir, 'overlay.html'));
