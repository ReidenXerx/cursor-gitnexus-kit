// Machine check for the "scoped-rename" task. Exit 0 = pass.
// Correct outcome: cache.js's `load` (+ its caller) renamed to `loadFromCache`,
// while the UNRELATED `load` in db.js (+ its caller) is left untouched.
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const read = (f) => fs.readFileSync(new URL('./' + f, import.meta.url), 'utf8');
const fail = (m) => {
  console.error('FAIL: ' + m);
  process.exit(1);
};

const cache = read('src/cache.js');
const cacheUser = read('src/cacheUser.js');
const db = read('src/db.js');
const dbUser = read('src/dbUser.js');

if (!/function loadFromCache\(/.test(cache)) fail('cache.js was not renamed to loadFromCache');
if (/function load\(/.test(cache)) fail('cache.js still defines load');
if (/\bload\(/.test(cacheUser)) fail('cacheUser.js still calls load — caller not updated');
if (!/loadFromCache\(/.test(cacheUser)) fail('cacheUser.js does not call loadFromCache');

// Decoy must be untouched.
if (!/function load\(/.test(db)) fail('db.js load() was wrongly renamed (unrelated symbol touched)');
if (!/\bload\(/.test(dbUser)) fail('dbUser.js load() call was wrongly changed');

let out = '';
try {
  out = execSync('node src/index.js', { cwd: new URL('.', import.meta.url), encoding: 'utf8' }).trim();
} catch (e) {
  fail('runtime error — ' + e.message);
}
if (out !== 'cache:k|db:i') fail(`expected "cache:k|db:i", got "${out}"`);

console.log('PASS');
