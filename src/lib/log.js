'use strict';
// Registro errori locale (%LOCALAPPDATA%\OfficinaONE\logs\ducatone.log), con rotazione a 1 MB
const fs = require('fs');
const path = require('path');
let file = null;
function init(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    file = path.join(dir, 'ducatone.log');
    if (fs.existsSync(file) && fs.statSync(file).size > 1024 * 1024) fs.renameSync(file, file + '.1');
  } catch (_) { file = null; }
}
function write(level, ...msg) {
  const line = `${new Date().toISOString()} [${level}] ${msg.map((m) => (m && m.stack) || (typeof m === 'string' ? m : JSON.stringify(m))).join(' ')}\n`;
  if (process.env.ELEARN_DEBUG) process.stdout.write(line);
  if (!file) return;
  try { fs.appendFileSync(file, line); } catch (_) {}
}
function tail(n = 40) {
  try { return fs.readFileSync(file, 'utf8').trim().split('\n').slice(-n).join('\n'); } catch (_) { return ''; }
}
module.exports = { init, info: (...m) => write('INFO', ...m), warn: (...m) => write('WARN', ...m), error: (...m) => write('ERRORE', ...m), tail, get file() { return file; } };
