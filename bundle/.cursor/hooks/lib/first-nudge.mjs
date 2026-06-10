#!/usr/bin/env node
/** Print first-tool nudge once per session (stdout); empty if already primed. */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = process.argv[2] ?? process.cwd();
const here = path.dirname(fileURLToPath(import.meta.url));

const r = spawnSync(process.execPath, [path.join(here, 'load-staleness.mjs'), root], {
  encoding: 'utf8',
});
let stale = { fresh: false, reason: 'check_failed' };
try {
  stale = JSON.parse(r.stdout.trim() || '{}');
} catch {
  stale = { fresh: false, reason: 'check_failed' };
}

const { firstToolNudge } = await import(pathToFileURL(path.join(here, 'session-primer.mjs')).href);
const nudge = firstToolNudge(root, stale);
process.stdout.write(nudge ?? '');
