#!/usr/bin/env bash
# preToolUse Read: block full-file reads when GN is fresh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export GITNEXUS_HOOK_INPUT="$(cat)"
export GITNEXUS_ROOT="$ROOT"
export GITNEXUS_STALENESS="$(node "$ROOT/.cursor/hooks/lib/load-staleness.mjs" "$ROOT" 2>/dev/null || echo '{"fresh":false,"reason":"check_failed"}')"
export GITNEXUS_FIRST_NUDGE="$(node "$ROOT/.cursor/hooks/lib/first-nudge.mjs" "$ROOT" 2>/dev/null || true)"

node <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.env.GITNEXUS_ROOT || '';
const helpers = await import(pathToFileURL(path.join(root, '.cursor/hooks/lib/hook-helpers.mjs')).href);
const { appendNudge } = await import(pathToFileURL(path.join(root, '.cursor/hooks/lib/session-primer.mjs')).href);

const input = JSON.parse(process.env.GITNEXUS_HOOK_INPUT || '{}');
const stale = JSON.parse(process.env.GITNEXUS_STALENESS || '{"fresh":false}');
const nudge = process.env.GITNEXUS_FIRST_NUDGE || '';
const ti = input.tool_input ?? {};
const filePath = ti.path ?? ti.target_file ?? '';
const config = helpers.loadHookConfig(root);
const repo = helpers.repoName(root);
const mcpFlag = path.join(root, '.cursor/.gitnexus-mcp-used.flag');
const graphUsed = fs.existsSync(mcpFlag);

function emit(result) {
  const applied = helpers.applyHookMode(result, config.mode);
  if (applied.agent_message) applied.agent_message = appendNudge(applied.agent_message, nudge);
  process.stdout.write(JSON.stringify(applied));
}

if (!stale.fresh) {
  emit({
    permission: 'allow',
    agent_message:
      'GN FALLBACK (stale): full Read allowed. NEXT: npm run gitnexus:agent-refresh before trusting graph tools.',
    user_message: helpers.userMessage('stale.classical'),
  });
  process.exit(0);
}

if (!filePath) {
  emit({ permission: 'allow' });
  process.exit(0);
}

const rel = filePath.replace(/.*\/__GITNEXUS_REPO__\//, '');
const hasRange = ti.offset !== undefined || ti.limit !== undefined;
const norm = filePath.replace(/\\/g, '/');
const isCode = helpers.isSourceCodePath(norm, config);
const isTest = /(?:^|\/)tests?\//.test(norm);
const isSmallConfig = /\.(json|md|yaml|yml|mdc|sh)$/.test(filePath) || /package\.json$/.test(filePath);
const isGeneratedSkill = /\.cursor\/skills\//.test(norm);

if (hasRange || isSmallConfig || isGeneratedSkill || isTest || !isCode) {
  emit({ permission: 'allow' });
  process.exit(0);
}

let lineCount = 0;
try {
  if (fs.existsSync(filePath)) {
    lineCount = fs.readFileSync(filePath, 'utf8').split('\n').length;
  }
} catch {
  emit({ permission: 'allow' });
  process.exit(0);
}

const threshold = config.readLineThreshold ?? 60;
const base = path.basename(filePath, path.extname(filePath));
const reNudge = helpers.midSessionGraphNudge(graphUsed, root);

if (lineCount > threshold) {
  const q = helpers.mcpQuery({ query: base, taskContext: rel, goal: 'module', repo });
  const ctx = helpers.mcpContext('<symbol>', repo);
  emit({
    permission: 'deny',
    agent_message:
      helpers.hookAgentMessage(
        root,
        `read:${rel}`,
        `Read blocked (${lineCount}L) → ${q} then ${ctx}; Read offset/limit for edits.`,
        `Read blocked → ${ctx}`
      ) + (reNudge ? `\n${reNudge}` : ''),
    user_message: helpers.userMessage('block.read.full', { lines: lineCount }),
  });
  process.exit(0);
}

emit({ permission: 'allow' });
NODE
