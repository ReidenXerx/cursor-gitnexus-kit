#!/usr/bin/env bash
# beforeShellExecution git commit: require gitnexus_detect_changes once before committing.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export GITNEXUS_HOOK_INPUT="$(cat)"
export GITNEXUS_ROOT="$ROOT"
export GITNEXUS_STALENESS="$(node "$ROOT/.cursor/hooks/lib/load-staleness.mjs" "$ROOT" 2>/dev/null || echo '{"fresh":false,"reason":"check_failed"}')"

node <<'NODE'
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.env.GITNEXUS_ROOT || '';
const helpers = await import(pathToFileURL(path.join(root, '.cursor/hooks/lib/hook-helpers.mjs')).href);
const { evaluateStalePolicy, staleRefreshAgentMessage } = await import(
  pathToFileURL(path.join(root, '.cursor/hooks/lib/stale-policy.mjs')).href
);
const { isDetectUsed, bumpScore } = await import(
  pathToFileURL(path.join(root, '.cursor/hooks/lib/session-primer.mjs')).href
);

const input = JSON.parse(process.env.GITNEXUS_HOOK_INPUT || '{}');
const stale = JSON.parse(process.env.GITNEXUS_STALENESS || '{"fresh":false}');
const command = input.command ?? input.tool_input?.command ?? '';
const config = helpers.loadHookConfig(root);
const repo = helpers.repoName(root);

function out(obj) {
  process.stdout.write(JSON.stringify(helpers.applyHookMode(obj, config.mode)));
}

// Only gate real commits (not `git commit --help`, `git log`, etc.).
const isCommit = /\bgit\b[^\n]*\bcommit\b/.test(command) && !/--help|-h\b/.test(command);
if (!isCommit) {
  out({ permission: 'allow' });
  process.exit(0);
}

const policy = evaluateStalePolicy(stale, root);
if (policy.phase === 'must_refresh') {
  out({
    permission: 'deny',
    agent_message: staleRefreshAgentMessage(stale, policy),
    user_message: helpers.userMessage('block.shell.stale'),
  });
  process.exit(0);
}

if (isDetectUsed(root)) {
  out({ permission: 'allow' });
  process.exit(0);
}

const noVerify = /--no-verify/.test(command);
bumpScore(root, 'commitGate');
out({
  permission: 'deny',
  agent_message:
    'COMMIT GATE: review change scope in the graph before committing — ' +
    `${helpers.mcpDetectChanges(repo, 'staged')}. ` +
    'Confirm affected processes match intent + run tests for them; warn on HIGH/CRITICAL. ' +
    'This gate clears for the session after one detect_changes call.' +
    (noVerify ? ' NOTE: --no-verify also skips the pre-commit PDG refresh — run npm run gitnexus:pdg after.' : ''),
  user_message:
    'Before committing, the agent checks what changed across the graph (affected flows) via GitNexus — not a blind commit.',
});
NODE
