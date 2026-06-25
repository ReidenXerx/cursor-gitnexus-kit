#!/usr/bin/env bash
# preToolUse Grep/Glob/SemanticSearch: route symbol/field/broad searches to GitNexus.
# Thin Cursor-protocol glue — the decision lives in lib/classify.mjs (vendor-neutral).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export GITNEXUS_HOOK_INPUT="$(cat)"
export GITNEXUS_ROOT="$ROOT"
export GITNEXUS_STALENESS="$(node "$ROOT/.cursor/hooks/lib/load-staleness.mjs" "$ROOT" 2>/dev/null || echo '{"fresh":false,"reason":"check_failed"}')"
# first-nudge reuses GITNEXUS_STALENESS (exported above) instead of recomputing it.
export GITNEXUS_FIRST_NUDGE="$(node "$ROOT/.cursor/hooks/lib/first-nudge.mjs" "$ROOT" 2>/dev/null || true)"

node <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.env.GITNEXUS_ROOT || '';
const imp = (rel) => import(pathToFileURL(path.join(root, '.cursor/hooks/lib', rel)).href);
const helpers = await imp('hook-helpers.mjs');
const { appendNudge, bumpScore } = await imp('session-primer.mjs');
const { evaluateStalePolicy, staleRefreshAgentMessage } = await imp('stale-policy.mjs');
const { classifyGrep } = await imp('classify.mjs');

const input = JSON.parse(process.env.GITNEXUS_HOOK_INPUT || '{}');
const stale = JSON.parse(process.env.GITNEXUS_STALENESS || '{"fresh":false}');
const nudge = process.env.GITNEXUS_FIRST_NUDGE || '';

const config = helpers.loadHookConfig(root);
const repo = helpers.repoName(root);
const graphUsed = fs.existsSync(path.join(root, '.cursor/.gitnexus-mcp-used.flag'));
const policy = evaluateStalePolicy(stale, root);

const verdict = classifyGrep(
  { tool: input.tool_name ?? '', toolInput: input.tool_input ?? {} },
  {
    phase: policy.phase,
    graphUsed,
    config,
    repo,
    root,
    staleMustRefreshMsg: staleRefreshAgentMessage(stale, policy),
    staleFallbackMsg: staleRefreshAgentMessage(stale, policy),
  },
);

if (verdict.decision === 'deny' && verdict.score) bumpScore(root, 'grepRedirects');

const result = {
  permission: verdict.decision,
  agent_message: verdict.agentMessage,
  user_message: verdict.userKey
    ? helpers.userMessage(verdict.userKey, verdict.userVars || {})
    : undefined,
};

const applied = helpers.applyHookMode(result, config.mode);
if (applied.agent_message) applied.agent_message = appendNudge(applied.agent_message, nudge);
process.stdout.write(JSON.stringify(applied));
NODE
