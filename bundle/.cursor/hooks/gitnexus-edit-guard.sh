#!/usr/bin/env bash
# preToolUse Write|StrReplace: staleness gate + impact reminder before code edits.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export GITNEXUS_HOOK_INPUT="$(cat)"
export GITNEXUS_STALENESS="$(node "$ROOT/.cursor/hooks/lib/load-staleness.mjs" "$ROOT" 2>/dev/null || echo '{"fresh":false,"reason":"check_failed"}')"
export GITNEXUS_FIRST_NUDGE="$(node "$ROOT/.cursor/hooks/lib/first-nudge.mjs" "$ROOT" 2>/dev/null || true)"
export GITNEXUS_STALENESS_MODE="${GITNEXUS_STALENESS_MODE:-block}"
export GITNEXUS_ROOT="$ROOT"

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

let writeCheck;
if (filePath) {
  const { spawnSync } = require('node:child_process');
  const path = require('node:path');
  const regionRoot = process.env.GITNEXUS_ROOT || process.cwd();
  const rc = spawnSync(
    process.execPath,
    [path.join(regionRoot, '.cursor/hooks/lib/region-edit-check.mjs'), filePath],
    { encoding: 'utf8', env: process.env }
  );
  try {
    writeCheck = JSON.parse(rc.stdout.trim() || '{}');
  } catch {
    writeCheck = { skip: true };
  }
  if (writeCheck.permission === 'deny') {
    const userMsg = writeCheck.noRegion
      ? 'Describe your task in one sentence so we can pick your work area (or say region: adapters).'
      : 'Edit outside agent region owns — open the owning region chat or Superchat.';
    out({
      permission: 'deny',
      agent_message: withNudge(
        (writeCheck.noRegion ? 'REGION REQUIRED: ' : 'REGION WRITE GATE: ') +
          writeCheck.reason +
          (writeCheck.noRegion
            ? ' Ask the user using the exact words from region-user-guide. Do NOT edit until region is set.'
            : ' You may READ any path for reasoning. For significant cross-region work, ask the user to open another region chat or Superchat (S).')
      ),
      user_message: userMsg,
    });
    process.exit(0);
  }
}

let agent_message;
if (writeCheck?.noRegion && isGraphSensitive) {
  out({
    permission: 'deny',
    agent_message: withNudge(
      'REGION REQUIRED: ' +
        writeCheck.reason +
        ' Ask the user using the exact words from docs/AGENT-REGIONS-GUIDE.md. Do NOT edit code until region is set.'
    ),
    user_message: 'Describe your task in one sentence so we can pick your work area.',
  });
  process.exit(0);
}

if (isGraphSensitive) {
  agent_message =
    'CODE EDIT GATE: You MUST have run gitnexus_impact({target, direction: "upstream", repo: "__GITNEXUS_REPO__"}) on the symbol you are changing BEFORE this edit. ' +
    'Use graph tools for reasoning about the change, not grep. If not impacted yet, STOP — run impact, report blast radius, then retry. ' +
    'Before commit or saying done: gitnexus_detect_changes (run it yourself).';
  if (writeCheck?.partial) {
    agent_message += ' REGION PARTIAL OVERFLOW: ' + writeCheck.reason;
  }
} else if (!stale.fresh) {
  agent_message = 'STALENESS NOTE: ' + staleDetail();
}

out({ permission: 'allow', agent_message: withNudge(agent_message) });
NODE
