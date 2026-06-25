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
