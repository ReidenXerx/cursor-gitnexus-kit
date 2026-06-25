#!/usr/bin/env bash
# preToolUse Shell: when index stale, force agent-refresh before other shell commands.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export GITNEXUS_HOOK_INPUT="$(cat)"
export GITNEXUS_ROOT="$ROOT"
export GITNEXUS_STALENESS="$(node "$ROOT/.cursor/hooks/lib/load-staleness.mjs" "$ROOT" 2>/dev/null || echo '{"fresh":false,"reason":"check_failed"}')"
export GITNEXUS_REFRESH_STATE="$(node "$ROOT/.cursor/hooks/lib/set-refresh-pending.mjs" "$ROOT" status 2>/dev/null || echo '{"pending":false,"failed":false}')"
export GITNEXUS_FIRST_NUDGE="$(node "$ROOT/.cursor/hooks/lib/first-nudge.mjs" "$ROOT" 2>/dev/null || true)"

node <<'NODE'
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.env.GITNEXUS_ROOT || '';
const helpers = await import(pathToFileURL(path.join(root, '.cursor/hooks/lib/hook-helpers.mjs')).href);
const { evaluateStalePolicy, staleRefreshAgentMessage } = await import(
  pathToFileURL(path.join(root, '.cursor/hooks/lib/stale-policy.mjs')).href
);
const { appendNudge } = await import(pathToFileURL(path.join(root, '.cursor/hooks/lib/session-primer.mjs')).href);

const input = JSON.parse(process.env.GITNEXUS_HOOK_INPUT || '{}');
const stale = JSON.parse(process.env.GITNEXUS_STALENESS || '{"fresh":false}');
const nudge = process.env.GITNEXUS_FIRST_NUDGE || '';
const command = input.command ?? input.tool_input?.command ?? '';
const config = helpers.loadHookConfig(root);
const policy = evaluateStalePolicy(stale, root);

function out(obj) {
  // Route through guide mode so `mode: "guide"` nudges instead of hard-blocking.
  const applied = helpers.applyHookMode(obj, config.mode);
  if (applied.agent_message) applied.agent_message = appendNudge(applied.agent_message, nudge);
  process.stdout.write(JSON.stringify(applied));
}

const isGitnexusMaint =
  /\bnpm run gitnexus:[\w.-]+/.test(command) ||
  /\bnode scripts\/gitnexus-agent\.mjs\b/.test(command) ||
  /\bnpx(?:\s+-y)?\s+gitnexus@latest\b/.test(command) ||
  /\bnpx(?:\s+-y)?\s+gitnexus\b/.test(command);

const isReadOnlyGit =
  /\bgit\s+(status|diff|log|show|branch|rev-parse|check-ignore|check-attr)\b/.test(command);

if (isGitnexusMaint || isReadOnlyGit) {
  out({
    permission: 'allow',
    agent_message: isGitnexusMaint ? 'GitNexus maintenance pre-approved.' : undefined,
  });
  process.exit(0);
}

if (policy.phase === 'fresh') {
  out({ permission: 'allow' });
  process.exit(0);
}

if (policy.phase === 'classical_fallback') {
  out({
    permission: 'allow',
    agent_message: staleRefreshAgentMessage(stale, policy),
  });
  process.exit(0);
}

out({
  permission: 'deny',
  agent_message: staleRefreshAgentMessage(stale, policy),
  user_message: helpers.userMessage('block.shell.stale'),
});
NODE
