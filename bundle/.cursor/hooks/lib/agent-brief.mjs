#!/usr/bin/env node
/**
 * Session orientation for agents — staleness, index stats, local changes, suggested MCP calls.
 * Usage: node .cursor/hooks/lib/agent-brief.mjs [repoRoot]
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  loadHookConfig,
  mcpContext,
  mcpDetectChanges,
  mcpImpact,
  mcpQuery,
  mcpReadContext,
  mcpReadSchema,
  cypherFieldAccess,
  cypherCallChain,
  repoName,
} from './hook-helpers.mjs';
import { readScorecard } from './session-primer.mjs';

const root = process.argv[2] ?? process.cwd();

function git(cmd) {
  return execSync(cmd, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function changedFiles() {
  const out = [];
  for (const scope of [
    'git diff --name-only',
    'git diff --name-only --cached',
  ]) {
    try {
      const lines = git(scope).split('\n').filter(Boolean);
      out.push(...lines);
    } catch {
      /* ignore */
    }
  }
  return [...new Set(out)];
}

function symbolFromPath(filePath) {
  const base = path.basename(filePath, path.extname(filePath));
  if (/^[A-Z]/.test(base) || base.includes('.')) return base;
  return null;
}

async function main() {
  const checkPath = path.join(root, '.cursor/hooks/lib/check-staleness.mjs');
  let stale = { fresh: false, reason: 'check_failed' };
  try {
    const r = execSync(`node "${checkPath}" "${root}"`, { encoding: 'utf8' });
    stale = JSON.parse(r.trim() || '{}');
  } catch {
    /* ignore */
  }

  const repo = repoName(root);
  const config = loadHookConfig(root);
  const lines = ['GitNexus agent brief', ''];

  if (stale.fresh) {
    lines.push(`Index: FRESH (${(stale.indexedCommit || '').slice(0, 7)})`);
    if (stale.embeddingCount > 0) {
      lines.push(`Embeddings: ${stale.embeddingCount} vectors (query uses BM25 + semantic)`);
    } else if ((stale.nodeCount ?? 0) === 0) {
      lines.push('Embeddings: none (empty graph — refresh after first index)');
    }
  } else {
    lines.push(`Index: STALE — ${stale.detail || stale.reason}`);
    if (stale.reason === 'missing_embeddings') {
      lines.push('Embeddings: MISSING — run refresh to enable semantic query (not graph-only context/impact)');
    }
    lines.push('Next: npm run gitnexus:agent-refresh (required_permissions: ["all"]) — includes --embeddings');
  }

  const metaPath = path.join(root, '.gitnexus/meta.json');
  if (fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      const s = meta.stats ?? {};
      lines.push(
        `Graph: ${s.nodes ?? '?'} symbols, ${s.processes ?? '?'} processes, ${s.communities ?? '?'} clusters, ${s.embeddings ?? 0} embeddings`
      );
    } catch {
      /* ignore */
    }
  }

  lines.push(`Hook mode: ${config.mode} (set GITNEXUS_MODE=guide to nudge-only)`);
  lines.push('');
  lines.push('Reasoning stack: query → context → cypher (structural) → impact → detect_changes');
  lines.push('Fuzzy / how-does / explore → query FIRST — not context/impact/cypher alone.');
  lines.push('Field read/write, N-hop chains, overrides → READ schema → cypher (ACCESSES, CALLS, …).');
  lines.push('');
  lines.push('Session start (copy-paste):');
  lines.push(`  ${mcpReadContext(repo)}`);
  lines.push(`  ${mcpReadSchema(repo)}`);
  lines.push('  npm run gitnexus:agent-brief');
  lines.push('');
  lines.push('Cypher recipes (copy-paste):');
  lines.push(`  ${cypherFieldAccess('<field>', repo)}`);
  lines.push(`  ${cypherCallChain('<Symbol>', repo, 3)}`);

  const apiProfilePath = path.join(root, '.cursor/gitnexus-api-profile.json');
  if (fs.existsSync(apiProfilePath)) {
    try {
      const api = JSON.parse(fs.readFileSync(apiProfilePath, 'utf8'));
      lines.push('');
      lines.push(`HTTP API profile: ${api.profile} (Route nodes: ${api.routeNodes ?? 'n/a'})`);
      lines.push(`  → ${api.recommendation}`);
      if (api.sourceSignals?.customSymbols?.length) {
        lines.push(`  custom entry symbols: ${api.sourceSignals.customSymbols.join(', ')}`);
      }
    } catch {
      /* ignore */
    }
  }

  const changes = changedFiles().filter((f) => /\.(js|mjs|ts|tsx|jsx)$/.test(f));
  if (changes.length) {
    lines.push('');
    lines.push(`Local changes (${changes.length} code file(s)):`);
    for (const f of changes.slice(0, 8)) {
      lines.push(`  - ${f}`);
    }
    if (changes.length > 8) lines.push(`  … +${changes.length - 8} more`);

    const sym = symbolFromPath(changes[0]);
    lines.push('');
    lines.push('Suggested graph calls:');
    lines.push(`  ${mcpDetectChanges(repo, 'all')}`);
    if (sym) {
      lines.push(`  ${mcpImpact(sym, repo)}`);
      lines.push(`  ${mcpContext(sym, repo)}`);
    } else {
      const topic = path.basename(changes[0], path.extname(changes[0]));
      lines.push(
        `  ${mcpQuery({ query: topic, taskContext: 'local changes', goal: 'affected symbols', repo })}`
      );
    }
  } else {
    lines.push('');
    lines.push('No unstaged/staged code changes detected.');
  }

  const card = readScorecard(root);
  const counts = card.counts ?? {};
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total > 0) {
    lines.push('');
    lines.push('Enforcement scorecard (this session):');
    const label = {
      graphCalls: 'graph calls',
      grepRedirects: 'grep→graph',
      readRedirects: 'read→graph',
      impactGate: 'impact gates',
      commitGate: 'commit gates',
      editStaleBlocks: 'stale-edit blocks',
    };
    lines.push(
      '  ' +
        Object.entries(counts)
          .filter(([, v]) => v)
          .map(([k, v]) => `${label[k] ?? k}: ${v}`)
          .join(', ')
    );
  }

  console.log(lines.join('\n'));
  process.exit(stale.fresh ? 0 : 1);
}

main();
