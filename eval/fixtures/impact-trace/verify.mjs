// Machine check for the "impact-trace" task. Exit 0 = pass.
// Correct answer: the transitive upstream callers of getValue() are
//   compute (mid.js) → report (top.js) → render (app.js).
// `unrelated` must NOT appear. Direct grep of "getValue" only reveals `compute`.
import fs from 'node:fs';

let raw = '';
try {
  raw = fs.readFileSync(new URL('./affected.txt', import.meta.url), 'utf8');
} catch {
  console.error('FAIL: affected.txt was not created');
  process.exit(1);
}

const names = new Set(
  raw
    .split(/[\s,]+/)
    .map((s) => s.replace(/\(\)$/, '').trim())
    .filter(Boolean)
);

const required = ['compute', 'report', 'render'];
const missing = required.filter((n) => !names.has(n));
if (missing.length) {
  console.error(`FAIL: missing transitive callers: ${missing.join(', ')}`);
  process.exit(1);
}
if (names.has('unrelated')) {
  console.error('FAIL: included unrelated() — false positive');
  process.exit(1);
}
console.log('PASS');
