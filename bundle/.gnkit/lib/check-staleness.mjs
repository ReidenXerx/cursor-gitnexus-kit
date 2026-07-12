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

const SOURCE_RE =
  /\.(m?[jt]sx?|cjs|py|go|rs|java|rb|php|c|h|cc|cpp|hpp|cs|kt|kts|swift|scala|dart|vue|svelte)$/i;

/**
 * Count git-dirty SOURCE files modified since the index was built (mtime > indexedAt).
 * Commit-equality can't see UNCOMMITTED edits (HEAD unchanged → "fresh" forever), so this
 * is the working-tree drift that lets guards require a fast incremental resync. Only stats
 * the handful of dirty files (fast), and RESETS on refresh because indexedAt advances.
 * @param {string|null} at meta.indexedAt (ISO)
 */
function countDrift(at) {
  const atMs = at ? Date.parse(at) : NaN;
  if (!Number.isFinite(atMs)) return 0;
  let porcelain = '';
  try {
    // NOTE: no .trim() — porcelain status is 2 chars + a space, so a leading-space
    // status (" M path") must keep its column alignment for slice(3) to be correct.
    porcelain = execSync('git status --porcelain', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return 0;
  }
  let n = 0;
  for (const line of porcelain.split('\n')) {
    if (line.length < 4) continue; // "XY path" is ≥4 chars
    let f = line.slice(3).trim();
    if (f.startsWith('"') && f.endsWith('"')) f = f.slice(1, -1);
    if (f.includes(' -> ')) f = f.split(' -> ').pop().trim(); // rename → new path
    if (!SOURCE_RE.test(f)) continue;
    try {
      if (fs.statSync(path.join(root, f)).mtimeMs > atMs) n++;
    } catch {
      /* deleted/renamed source — skip */
    }
  }
  return n;
}

const staleHookNote =
  'Hooks block Grep/Read/MCP/shell until refresh succeeds or fails.';
const agentFix =
  `${staleHookNote} Agent MUST run npm run gitnexus:agent-refresh autonomously (required_permissions: ["all"]).`;

const out = {
  fresh: true,
  reason: null,
  commitsBehind: 0,
  indexedCommit: null,
  headCommit: null,
  indexedAt: null,
  nodeCount: 0,
  embeddingCount: 0,
  embeddingsReady: false,
  driftingFiles: 0,
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
out.nodeCount = meta.stats?.nodes ?? 0;
out.embeddingCount = meta.stats?.embeddings ?? 0;
// Truthful: an index with symbols but no vectors is not embeddings-ready. (An
// empty 0-node index leaves this false but does not flip `fresh` below — the
// missing_embeddings branch requires nodeCount > 0 — so docs-only repos never wedge.)
out.embeddingsReady = out.embeddingCount > 0;

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

// Working-tree drift (uncommitted edits since the index) — orthogonal to commit-staleness.
out.driftingFiles = countDrift(out.indexedAt);

if (out.indexedCommit === out.headCommit) {
  if (out.nodeCount > 0 && !out.embeddingsReady) {
    out.fresh = false;
    out.reason = 'missing_embeddings';
    out.detail = `Graph has ${out.nodeCount} symbol(s) but 0 embeddings — gitnexus_query semantic search is unavailable. ${agentFix}`;
  }
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
  if (out.reason === 'missing') {
    out.detail = `GitNexus index missing — ${agentFix}`;
  } else if (out.reason === 'invalid_meta') {
    out.detail = `GitNexus meta.json invalid — ${agentFix}`;
  } else if (out.reason === 'not_git') {
    out.detail = 'Not a git repo — cannot verify index freshness.';
  } else if (out.reason === 'diverged') {
    out.detail = `Index commit ${(out.indexedCommit || '').slice(0, 7)} diverged from HEAD ${(out.headCommit || '').slice(0, 7)} — ${agentFix}`;
  } else {
    const n = out.commitsBehind ?? '?';
    out.detail = `Index is ${n} commit(s) behind HEAD (indexed ${(out.indexedCommit || '').slice(0, 7)} → HEAD ${(out.headCommit || '').slice(0, 7)}). ${agentFix}`;
  }
}

process.stdout.write(JSON.stringify(out));
