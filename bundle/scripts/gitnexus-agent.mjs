#!/usr/bin/env node
/**
 * Agent-facing GitNexus maintenance CLI (no MCP required).
 * Usage: node scripts/gitnexus-agent.mjs status|refresh
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const { withProjectTmpEnv, tmpSpaceReport, enospcHelp } = await import(
  pathToFileURL(path.join(ROOT, 'scripts/lib/project-tmp.mjs')).href
);

function loadStaleness() {
  const r = spawnSync(process.execPath, [path.join(ROOT, '.cursor/hooks/lib/check-staleness.mjs'), ROOT], {
    encoding: 'utf8',
    env: withProjectTmpEnv(ROOT),
  });
  try {
    return JSON.parse(r.stdout.trim() || '{}');
  } catch {
    return { fresh: false, reason: 'check_failed', detail: r.stderr || 'staleness check failed' };
  }
}

function run(cmd, args, opts = {}) {
  const env = withProjectTmpEnv(ROOT, opts.env);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', ...opts, env });
  if (r.error?.code === 'ENOSPC') {
    console.error('\n' + enospcHelp(ROOT));
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const cmd = process.argv[2] ?? 'status';

if (cmd === 'status') {
  const stale = loadStaleness();
  const systemTmp = tmpSpaceReport(ROOT);
  if (stale.fresh) {
    console.log('GitNexus index: fresh (matches HEAD)');
    console.log(`  indexed: ${(stale.indexedCommit || '').slice(0, 7)} @ ${stale.indexedAt ?? '?'}`);
    console.log(systemTmp);
    process.exit(0);
  }
  console.log('GitNexus index: STALE — graph tools may be wrong');
  console.log(`  ${stale.detail || stale.reason}`);
  console.log('  Fix: npm run gitnexus:agent-refresh');
  console.log(systemTmp);
  process.exit(1);
}

if (cmd === 'refresh') {
  console.log('==> GitNexus agent refresh (analyze + sync teaching bundle)');
  console.log(tmpSpaceReport(ROOT));
  try {
    run('npm', ['run', 'gitnexus:refresh'], { stdio: 'inherit' });
    if (fs.existsSync(path.join(ROOT, 'scripts/sync-cursor-gitnexus-teaching.sh'))) {
      run('bash', ['scripts/sync-cursor-gitnexus-teaching.sh'], { stdio: 'inherit' });
    }
  } catch (err) {
    console.error('\n' + enospcHelp(ROOT));
    process.exit(1);
  }
  const stale = loadStaleness();
  if (stale.fresh) {
    console.log('==> Index fresh after refresh');
    spawnSync(process.execPath, [path.join(ROOT, '.cursor/hooks/lib/set-refresh-pending.mjs'), ROOT, 'clear'], {
      cwd: ROOT,
      stdio: 'ignore',
      env: withProjectTmpEnv(ROOT),
    });
    process.exit(0);
  }
  console.error('==> Refresh finished but index still not fresh — check git state');
  process.exit(1);
}

console.error(`Unknown command: ${cmd}. Use: status | refresh`);
process.exit(2);
