const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'src', 'main', 'ui', 'overlay.html');
const destDir = path.join(__dirname, '..', 'dist', 'main', 'ui');
fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, path.join(destDir, 'overlay.html'));

// SenseVoice STT sidecar (Python) — tsc only emits .js, so copy the .py.
const sttSrc = path.join(__dirname, '..', 'src', 'main', 'core', 'stt', 'sidecar', 'sense_voice_server.py');
const sttDestDir = path.join(__dirname, '..', 'dist', 'main', 'core', 'stt', 'sidecar');
fs.mkdirSync(sttDestDir, { recursive: true });
fs.copyFileSync(sttSrc, path.join(sttDestDir, 'sense_voice_server.py'));
