#!/usr/bin/env bash
# preToolUse Write|StrReplace: staleness gate + tiered impact reminders.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export GITNEXUS_HOOK_INPUT="$(cat)"
export GITNEXUS_STALENESS="$(node "$ROOT/.cursor/hooks/lib/load-staleness.mjs" "$ROOT" 2>/dev/null || echo '{"fresh":false,"reason":"check_failed"}')"
export GITNEXUS_FIRST_NUDGE="$(node "$ROOT/.cursor/hooks/lib/first-nudge.mjs" "$ROOT" 2>/dev/null || true)"
export GITNEXUS_STALENESS_MODE="${GITNEXUS_STALENESS_MODE:-block}"
export GITNEXUS_ROOT="$ROOT"

node <<'NODE'
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.env.GITNEXUS_ROOT || '';
const helpers = await import(pathToFileURL(path.join(root, '.cursor/hooks/lib/hook-helpers.mjs')).href);
const { appendNudge } = await import(pathToFileURL(path.join(root, '.cursor/hooks/lib/session-primer.mjs')).href);

const input = JSON.parse(process.env.GITNEXUS_HOOK_INPUT || '{}');
const stale = JSON.parse(process.env.GITNEXUS_STALENESS || '{"fresh":false}');
const nudge = process.env.GITNEXUS_FIRST_NUDGE || '';
const mode = process.env.GITNEXUS_STALENESS_MODE || 'block';
const ti = input.tool_input ?? {};
const filePath = (ti.path ?? ti.file_path ?? '').replace(/\\/g, '/');

const config = helpers.loadHookConfig(root);
const repo = helpers.repoName(root);
const sensitivity = helpers.editSensitivity(filePath, config);
const grace = helpers.isGraceStale(stale, config);

function emit(result) {
  const applied = helpers.applyHookMode(result, config.mode);
  if (applied.agent_message) applied.agent_message = appendNudge(applied.agent_message, nudge);
  process.stdout.write(JSON.stringify(applied));
}

function staleDetail() {
  return stale.detail || 'GitNexus index is not fresh.';
}

if (!stale.fresh && sensitivity !== 'none' && sensitivity !== 'light') {
  const msg =
    'STALENESS GATE: ' +
    staleDetail() +
    ' Classical tools OK for investigation.';

  if (grace) {
    emit({
      permission: 'allow',
      agent_message:
        msg +
        ` Grace window (${stale.commitsBehind} commit(s) behind) — edit allowed but run npm run gitnexus:agent-refresh soon.`,
    });
    process.exit(0);
  }

  if (mode === 'block' && config.mode === 'enforce') {
    emit({
      permission: 'deny',
      agent_message:
        msg + ' Edits blocked until refresh — npm run gitnexus:agent-refresh (pre-approved).',
      user_message: helpers.userMessage('block.edit.stale'),
    });
    process.exit(0);
  }

  emit({ permission: 'allow', agent_message: msg + ' (warn mode — edit allowed.)' });
  process.exit(0);
}

let agent_message;
if (sensitivity === 'full') {
  const impact = helpers.mcpImpact('<symbol>', repo);
  const dc = helpers.mcpDetectChanges(repo);
  agent_message = helpers.hookAgentMessage(
    root,
    'edit-full',
    `EDIT: ${impact} first. HIGH/CRITICAL → review full impact output. Done: ${dc}`,
    `EDIT: ${impact}`
  );
} else if (sensitivity === 'medium') {
  agent_message = helpers.hookAgentMessage(
    root,
    'edit-medium',
    `EDIT: ${helpers.mcpImpact('<symbol>', repo)} if shared symbol. Done: ${helpers.mcpDetectChanges(repo)}`,
    'EDIT: impact if shared symbol'
  );
} else if (!stale.fresh) {
  agent_message = helpers.hookAgentMessage(root, 'edit-stale-note', `STALE: ${staleDetail()}`, 'STALE: refresh soon');
}

emit({ permission: 'allow', agent_message });
NODE
