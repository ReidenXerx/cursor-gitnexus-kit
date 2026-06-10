#!/usr/bin/env node
/**
 * Load staleness for hooks. Fail closed → stale (classical tools OK, refresh required).
 * stdout: JSON from check-staleness.mjs, or { fresh: false, reason: 'check_failed', detail }
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.argv[2] ?? process.cwd();

const FAIL = {
  fresh: false,
  reason: 'check_failed',
  detail:
    'Staleness check failed — treat index as stale. Classical Grep/Read/SemanticSearch OK for investigation. ' +
    'Agent MUST run npm run gitnexus:agent-refresh autonomously (required_permissions: ["all"]) before trusting graph tools or editing src/future + tests.',
};

const r = spawnSync(process.execPath, [path.join(here, 'check-staleness.mjs'), root], {
  encoding: 'utf8',
});

if (r.status !== 0 || !r.stdout?.trim()) {
  process.stdout.write(JSON.stringify(FAIL));
  process.exit(0);
}

try {
  const parsed = JSON.parse(r.stdout.trim());
  process.stdout.write(JSON.stringify(parsed));
} catch {
  process.stdout.write(JSON.stringify(FAIL));
}
