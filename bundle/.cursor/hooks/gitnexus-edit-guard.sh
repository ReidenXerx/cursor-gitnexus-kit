#!/usr/bin/env bash
# preToolUse Write|StrReplace: staleness gate + impact reminder before code edits.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export GITNEXUS_HOOK_INPUT="$(cat)"
export GITNEXUS_STALENESS="$(node "$ROOT/.cursor/hooks/lib/load-staleness.mjs" "$ROOT" 2>/dev/null || echo '{"fresh":false,"reason":"check_failed"}')"
export GITNEXUS_FIRST_NUDGE="$(node "$ROOT/.cursor/hooks/lib/first-nudge.mjs" "$ROOT" 2>/dev/null || true)"
export GITNEXUS_STALENESS_MODE="${GITNEXUS_STALENESS_MODE:-block}"

node <<'NODE'
const input = JSON.parse(process.env.GITNEXUS_HOOK_INPUT || '{}');
const stale = JSON.parse(process.env.GITNEXUS_STALENESS || '{"fresh":false}');
const nudge = process.env.GITNEXUS_FIRST_NUDGE || '';
const mode = process.env.GITNEXUS_STALENESS_MODE || 'block';
const ti = input.tool_input ?? {};
const filePath = (ti.path ?? ti.file_path ?? '').replace(/\\/g, '/');

const norm = filePath.replace(/\\/g, '/');
const isRuntimeCode = /(?:^|\/)src\/future\/.*\.(?:js|ts|tsx)$/.test(norm);
const isTest = /(?:^|\/)tests?\//.test(norm);
const isDashboard = /(?:^|\/)apps\/research-dashboard\/.*\.(?:js|ts|tsx)$/.test(norm);
const isScript = /(?:^|\/)scripts\/.*\.(?:js|mjs|sh)$/.test(norm);
const isGraphSensitive = isRuntimeCode || isTest || isDashboard || isScript;

function out(obj) {
  process.stdout.write(JSON.stringify(obj));
}

function withNudge(msg) {
  if (!msg) return nudge || undefined;
  return nudge ? `${nudge}\n\n${msg}` : msg;
}

function staleDetail() {
  return stale.detail || 'GitNexus index is not fresh.';
}

if (!stale.fresh && isGraphSensitive) {
  const msg =
    'STALENESS GATE: ' +
    staleDetail() +
    ' Graph tools on a stale index return wrong callers/processes. ' +
    'Classical Grep/Read/SemanticSearch are allowed for investigation (hooks auto-allow).';

  if (mode === 'block') {
    out({
      permission: 'deny',
      agent_message: withNudge(
        msg +
          ' Edits blocked until refresh — run npm run gitnexus:agent-refresh autonomously (pre-approved). Use classical tools meanwhile.'
      ),
      user_message:
        'GitNexus index is stale — agent should refresh autonomously; classical tools OK for investigation.',
    });
    process.exit(0);
  }

  out({
    permission: 'allow',
    agent_message: withNudge(msg + ' (warn mode — edit allowed but graph may be wrong.)'),
  });
  process.exit(0);
}

let agent_message;
if (isGraphSensitive) {
  agent_message =
    'CODE EDIT GATE: You MUST have run gitnexus_impact({target, direction: "upstream", repo: "__GITNEXUS_REPO__"}) on the symbol you are changing BEFORE this edit. ' +
    'Use graph tools for reasoning about the change, not grep. If not impacted yet, STOP — run impact, report blast radius, then retry. ' +
    'Before commit or saying done: gitnexus_detect_changes (run it yourself).';
} else if (!stale.fresh) {
  agent_message = 'STALENESS NOTE: ' + staleDetail();
}

out({ permission: 'allow', agent_message: withNudge(agent_message) });
NODE
