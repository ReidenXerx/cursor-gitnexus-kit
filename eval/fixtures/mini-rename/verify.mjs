// Machine check for the "safe-rename" task. Exit 0 = pass.
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const read = (f) => fs.readFileSync(new URL('./' + f, import.meta.url), 'utf8');
const blob = ['src/config.js', 'src/loader.js'].map(read).join('\n');

if (/\bparseConfig\b/.test(blob)) {
  console.error('FAIL: old name "parseConfig" still present');
  process.exit(1);
}
if (!/\bloadConfig\b/.test(blob)) {
  console.error('FAIL: new name "loadConfig" not found');
  process.exit(1);
}

let out = '';
try {
  out = execSync('node src/index.js', { cwd: new URL('.', import.meta.url), encoding: 'utf8' }).trim();
} catch (e) {
  console.error('FAIL: runtime error — ' + e.message);
  process.exit(1);
}
if (out !== 'ok') {
  console.error(`FAIL: expected "ok", got "${out}"`);
  process.exit(1);
}

console.log('PASS');
