#!/usr/bin/env node
/**
 * Compare .gitnexus/meta.json lastCommit vs git HEAD.
 * stdout: JSON { fresh, reason, commitsBehind, indexedCommit, headCommit, indexedAt }
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

const root = process.argv[2] ?? process.cwd();

function git(cmd) {
  return execSync(cmd, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

const out = {
  fresh: true,
  reason: null,
  commitsBehind: 0,
  indexedCommit: null,
  headCommit: null,
  indexedAt: null,
};

const metaPath = path.join(root, '.gitnexus/meta.json');
if (!fs.existsSync(metaPath)) {
  out.fresh = false;
  out.reason = 'missing';
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

let meta;
try {
  meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
} catch {
  out.fresh = false;
  out.reason = 'invalid_meta';
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

out.indexedCommit = meta.lastCommit ?? null;
out.indexedAt = meta.indexedAt ?? null;

if (!out.indexedCommit) {
  out.fresh = false;
  out.reason = 'invalid_meta';
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

try {
  out.headCommit = git('git rev-parse HEAD');
} catch {
  out.fresh = false;
  out.reason = 'not_git';
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

if (out.indexedCommit === out.headCommit) {
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

try {
  git(`git merge-base --is-ancestor ${out.indexedCommit} ${out.headCommit}`);
  out.commitsBehind =
    parseInt(git(`git rev-list --count ${out.indexedCommit}..${out.headCommit}`), 10) || 0;
  if (out.commitsBehind > 0) {
    out.fresh = false;
    out.reason = 'behind';
  }
} catch {
  out.fresh = false;
  out.reason = 'diverged';
}

if (!out.fresh) {
  const agentFix = 'Agent MUST run npm run gitnexus:agent-refresh autonomously (required_permissions: ["all"]).';
  if (out.reason === 'missing') {
    out.detail = `GitNexus index missing — classical tools OK for investigation. ${agentFix}`;
  } else if (out.reason === 'invalid_meta') {
    out.detail = `GitNexus meta.json invalid — classical tools OK for investigation. ${agentFix}`;
  } else if (out.reason === 'not_git') {
    out.detail = 'Not a git repo — cannot verify index freshness.';
  } else if (out.reason === 'diverged') {
    out.detail = `Index commit ${(out.indexedCommit || '').slice(0, 7)} diverged from HEAD ${(out.headCommit || '').slice(0, 7)} — classical tools OK. ${agentFix}`;
  } else {
    const n = out.commitsBehind ?? '?';
    out.detail = `Index is ${n} commit(s) behind HEAD (indexed ${(out.indexedCommit || '').slice(0, 7)} → HEAD ${(out.headCommit || '').slice(0, 7)}). Classical tools OK. ${agentFix}`;
  }
}

process.stdout.write(JSON.stringify(out));
