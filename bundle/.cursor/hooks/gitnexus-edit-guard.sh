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
const { appendNudge, isImpactUsed, bumpScore } = await import(
  pathToFileURL(path.join(root, '.cursor/hooks/lib/session-primer.mjs')).href
);
const { evaluateStalePolicy, staleRefreshAgentMessage } = await import(
  pathToFileURL(path.join(root, '.cursor/hooks/lib/stale-policy.mjs')).href
);

const input = JSON.parse(process.env.GITNEXUS_HOOK_INPUT || '{}');
const stale = JSON.parse(process.env.GITNEXUS_STALENESS || '{"fresh":false}');
const nudge = process.env.GITNEXUS_FIRST_NUDGE || '';
const ti = input.tool_input ?? {};
const tool = input.tool_name ?? '';
const filePath = (ti.path ?? ti.file_path ?? '').replace(/\\/g, '/');

const config = helpers.loadHookConfig(root);
const repo = helpers.repoName(root);
const sensitivity = helpers.editSensitivity(filePath, config);
const stalePolicy = evaluateStalePolicy(stale, root);

function emit(result) {
  const applied = helpers.applyHookMode(result, config.mode);
  if (applied.agent_message) applied.agent_message = appendNudge(applied.agent_message, nudge);
  process.stdout.write(JSON.stringify(applied));
}

function staleDetail() {
  return stale.detail || 'GitNexus index is not fresh.';
}

// Staleness gate — unified with grep/read/shell guards: refresh first, no grace shortcut.
// Docs / config (none|light) stay editable; runtime source/tests/scripts (medium|full) wait for refresh.
if (sensitivity !== 'none' && sensitivity !== 'light' && stalePolicy.phase !== 'fresh') {
  if (stalePolicy.phase === 'classical_fallback') {
    emit({
      permission: 'allow',
      agent_message:
        'STALENESS: refresh failed — editing allowed; graph may be behind, state why in one sentence.',
    });
    process.exit(0);
  }
  bumpScore(root, 'editStaleBlocks');
  emit({
    permission: 'deny',
    agent_message:
      'STALENESS GATE: ' +
      staleDetail() +
      ' Edits blocked until refresh — Shell NOW: npm run gitnexus:agent-refresh (required_permissions: ["all"], pre-approved). Never ask the user to analyze.',
    user_message: helpers.userMessage('block.edit.stale'),
  });
  process.exit(0);
}

// Impact-before-edit (H1) — runtime source edits require one impact/rename call this session.
// Once impact has run, all subsequent edits are allowed (gate is per-session, not per-file).
if (sensitivity === 'full' && !isImpactUsed(root)) {
  const renameAhead =
    tool === 'StrReplace' ? helpers.detectIdentifierRename(ti.old_string, ti.new_string) : null;
  const playbook = renameAhead
    ? `${helpers.mcpImpact(renameAhead.oldName, repo)} → ${helpers.mcpRename(renameAhead.oldName, renameAhead.newName, repo, true)}`
    : helpers.mcpImpact('<symbol-you-are-editing>', repo);
  bumpScore(root, 'impactGate');
  emit({
    permission: 'deny',
    agent_message:
      `IMPACT GATE: run blast-radius analysis before editing runtime source — ${playbook}. ` +
      'Review d=1 (WILL BREAK) + risk; warn on HIGH/CRITICAL. This gate clears for the rest of the session after one impact call.',
    user_message:
      'Before editing source, the agent checks blast radius in GitNexus (what breaks) — graph-first safety, not blind edits.',
  });
  process.exit(0);
}

let agent_message;
const renamePair =
  tool === 'StrReplace' ? helpers.detectIdentifierRename(ti.old_string, ti.new_string) : null;

if (renamePair && sensitivity !== 'none') {
  const impact = helpers.mcpImpact(renamePair.oldName, repo);
  const rn = helpers.mcpRename(renamePair.oldName, renamePair.newName, repo, true);
  agent_message = helpers.hookAgentMessage(
    root,
    `edit-rename:${renamePair.oldName}`,
    `RENAME detected: ${impact} → ${rn} (dry_run) — do NOT StrReplace symbol names across files.`,
    `RENAME: ${rn}`
  );
} else if (sensitivity === 'full') {
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
