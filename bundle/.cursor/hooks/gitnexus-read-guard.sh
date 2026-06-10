#!/usr/bin/env bash
# preToolUse Read: block full-file reads when GN is fresh; allow when stale or verifying suspicion.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export GITNEXUS_HOOK_INPUT="$(cat)"
export GITNEXUS_STALENESS="$(node "$ROOT/.cursor/hooks/lib/load-staleness.mjs" "$ROOT" 2>/dev/null || echo '{"fresh":false,"reason":"check_failed"}')"
export GITNEXUS_FIRST_NUDGE="$(node "$ROOT/.cursor/hooks/lib/first-nudge.mjs" "$ROOT" 2>/dev/null || true)"

node <<'NODE'
const fs = require('fs');
const path = require('path');

const input = JSON.parse(process.env.GITNEXUS_HOOK_INPUT || '{}');
const stale = JSON.parse(process.env.GITNEXUS_STALENESS || '{"fresh":false}');
const nudge = process.env.GITNEXUS_FIRST_NUDGE || '';
const ti = input.tool_input ?? {};
const filePath = ti.path ?? ti.target_file ?? '';

function out(obj) {
  process.stdout.write(JSON.stringify(obj));
}

function withNudge(msg) {
  if (!msg) return nudge || undefined;
  return nudge ? `${nudge}\n\n${msg}` : msg;
}

function allow(msg) {
  out({ permission: 'allow', agent_message: withNudge(msg) });
}

function deny(agentMsg, userMsg) {
  out({
    permission: 'deny',
    agent_message: withNudge(agentMsg),
    user_message: userMsg ?? 'Use GitNexus before reading entire source files.',
  });
}

if (!stale.fresh) {
  allow(
    'GN FALLBACK (stale/untrusted index): ' +
      (stale.detail || stale.reason || 'Index not fresh.') +
      ' Full Read allowed — graph tools may be wrong. Tell the user you are bypassing GN-first due to staleness. ' +
      'Agent MUST run npm run gitnexus:agent-refresh autonomously before trusting graph tools again.'
  );
  process.exit(0);
}

if (!filePath) {
  allow();
  process.exit(0);
}

const rel = filePath.replace(/.*\/__GITNEXUS_REPO__\//, '');
const hasRange = ti.offset !== undefined || ti.limit !== undefined;
const norm = filePath.replace(/\\/g, '/');
const isCode = /(?:^|\/)src\/future\/.*\.(?:js|ts|tsx)$/.test(norm);
const isTest = /(?:^|\/)tests?\//.test(norm);
const isSmallConfig = /\.(json|md|yaml|yml|mdc|sh)$/.test(filePath) || /package\.json$/.test(filePath);
const isGeneratedSkill = /\.cursor\/skills\//.test(norm);

if (hasRange || isSmallConfig || isGeneratedSkill || isTest || !isCode) {
  allow();
  process.exit(0);
}

let lineCount = 0;
try {
  if (fs.existsSync(filePath)) {
    lineCount = fs.readFileSync(filePath, 'utf8').split('\n').length;
  }
} catch {
  allow();
  process.exit(0);
}

const THRESHOLD = 60;

if (lineCount > THRESHOLD) {
  const base = path.basename(filePath, path.extname(filePath));
  deny(
    `Read(${rel}) blocked — ${lineCount} lines. Do NOT read whole files to understand or reason about code.\n` +
      `Use instead:\n` +
      `  1. gitnexus_query({query: "${base}", task_context: "...", goal: "understand module", repo: "__GITNEXUS_REPO__"})\n` +
      `  2. gitnexus_context({name: "<symbol>", repo: "__GITNEXUS_REPO__"})\n` +
      `  3. Read with offset/limit for exact lines.\n` +
      `If GN returned empty/wrong callers or wrong paths after uid retry, tell the user — full Read is then OK to verify.`,
    `Full read blocked (${lineCount} lines) — use GitNexus query/context first.`
  );
  process.exit(0);
}

allow();
NODE
