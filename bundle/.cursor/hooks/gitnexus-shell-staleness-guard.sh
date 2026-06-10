#!/usr/bin/env bash
# preToolUse Shell: when index stale (or session auto-refresh failed), force agent-refresh first.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export GITNEXUS_HOOK_INPUT="$(cat)"
export GITNEXUS_ROOT="$ROOT"
export GITNEXUS_STALENESS="$(node "$ROOT/.cursor/hooks/lib/load-staleness.mjs" "$ROOT" 2>/dev/null || echo '{"fresh":false,"reason":"check_failed"}')"
export GITNEXUS_REFRESH_PENDING="$(node "$ROOT/.cursor/hooks/lib/set-refresh-pending.mjs" "$ROOT" status 2>/dev/null || echo '{"pending":false}')"
export GITNEXUS_FIRST_NUDGE="$(node "$ROOT/.cursor/hooks/lib/first-nudge.mjs" "$ROOT" 2>/dev/null || true)"

node <<'NODE'
const input = JSON.parse(process.env.GITNEXUS_HOOK_INPUT || '{}');
const stale = JSON.parse(process.env.GITNEXUS_STALENESS || '{"fresh":false}');
const pending = JSON.parse(process.env.GITNEXUS_REFRESH_PENDING || '{"pending":false}');
const nudge = process.env.GITNEXUS_FIRST_NUDGE || '';
const command = input.command ?? input.tool_input?.command ?? '';

function out(obj) {
  process.stdout.write(JSON.stringify(obj));
}

function withNudge(msg) {
  if (!msg) return nudge || undefined;
  return nudge ? `${nudge}\n\n${msg}` : msg;
}

const isGitnexusMaint =
  /\bnpm run gitnexus:[\w-]+/.test(command) ||
  /\bnode scripts\/gitnexus-agent\.mjs\b/.test(command) ||
  /\bnpx(?:\s+-y)?\s+gitnexus@latest\b/.test(command) ||
  /\bnpx(?:\s+-y)?\s+gitnexus\b/.test(command);

const isReadOnlyGit =
  /\bgit\s+(status|diff|log|show|branch|rev-parse|check-ignore|check-attr)\b/.test(command);

if (isGitnexusMaint || isReadOnlyGit) {
  out({ permission: 'allow', agent_message: withNudge(isGitnexusMaint ? 'GitNexus maintenance pre-approved.' : undefined) });
  process.exit(0);
}

const mustRefresh = !stale.fresh || pending.pending;

if (mustRefresh) {
  out({
    permission: 'deny',
    agent_message: withNudge(
      'STALE INDEX — run Shell NOW: npm run gitnexus:agent-refresh with required_permissions: ["all"]. ' +
        'This is your job — NEVER tell the user to run npx gitnexus analyze or gitnexus:refresh. ' +
        (stale.detail || 'Index not fresh.') +
        (pending.pending ? ' Session auto-refresh did not complete.' : '')
    ),
    user_message: 'GitNexus index stale — agent must refresh autonomously before other shell commands.',
  });
  process.exit(0);
}

out({ permission: 'allow' });
NODE
