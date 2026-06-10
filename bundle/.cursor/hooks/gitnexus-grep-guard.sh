#!/usr/bin/env bash
# preToolUse Grep/Glob/SemanticSearch: block symbol-style searches when GN is fresh;
# allow classical tools when index is stale or for scoped verification after GN use/suspicion.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export GITNEXUS_HOOK_INPUT="$(cat)"
export GITNEXUS_ROOT="$ROOT"
export GITNEXUS_STALENESS="$(node "$ROOT/.cursor/hooks/lib/load-staleness.mjs" "$ROOT" 2>/dev/null || echo '{"fresh":false,"reason":"check_failed"}')"
export GITNEXUS_FIRST_NUDGE="$(node "$ROOT/.cursor/hooks/lib/first-nudge.mjs" "$ROOT" 2>/dev/null || true)"

node <<'NODE'
const fs = require('fs');
const path = require('path');

const input = JSON.parse(process.env.GITNEXUS_HOOK_INPUT || '{}');
const stale = JSON.parse(process.env.GITNEXUS_STALENESS || '{"fresh":false}');
const nudge = process.env.GITNEXUS_FIRST_NUDGE || '';
const root = process.env.GITNEXUS_ROOT || '';
const tool = input.tool_name ?? '';
const ti = input.tool_input ?? {};

const mcpUsedFlag = path.join(root, '.cursor', '.gitnexus-mcp-used.flag');
const graphUsedThisSession = root && fs.existsSync(mcpUsedFlag);

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
    user_message: userMsg ?? 'GitNexus-first: use graph tools for code reasoning.',
  });
}

function staleFallbackMsg() {
  return (
    'GN FALLBACK (stale/untrusted index): ' +
    (stale.detail || stale.reason || 'Index not fresh.') +
    ' Classical Grep/Glob/SemanticSearch allowed for investigation. ' +
    'Your NEXT Shell call MUST be npm run gitnexus:agent-refresh (required_permissions: ["all"]) — run it yourself.'
  );
}

function isScopedSourceFile(p) {
  const norm = (p ?? '').replace(/\\/g, '/');
  return /(?:^|\/)src\/future\/.*\.(?:js|ts|tsx)$/.test(norm);
}

function isBroadSrcGlob(pattern) {
  const norm = (pattern ?? '').replace(/\\/g, '/');
  return (
    /^\*\*\/\*\.(js|ts|tsx)$/.test(norm) ||
    /^\*\*\/src\//.test(norm) ||
    /^src\//.test(norm) ||
    /^src\/future\//.test(norm)
  );
}

if (!stale.fresh) {
  allow(staleFallbackMsg());
  process.exit(0);
}

if (tool === 'Glob') {
  const pattern = ti.glob_pattern ?? ti.pattern ?? '';
  if (isBroadSrcGlob(pattern)) {
    deny(
      `Glob("${pattern}") blocked — use gitnexus_query({query: "<concept>", task_context: "...", goal: "...", repo: "__GITNEXUS_REPO__"}) to find execution flows, then gitnexus_context on symbols.\n` +
        'If GitNexus results look wrong after uid retry, scoped Grep in a known file is OK — tell the user why GN was not trusted.',
      'Broad source Glob blocked — GitNexus query finds flows faster.'
    );
    process.exit(0);
  }
  allow('Glob OK for non-source patterns (config/assets).');
  process.exit(0);
}

if (tool === 'SemanticSearch') {
  deny(
    'SemanticSearch blocked when index is fresh — use gitnexus_query({query, task_context, goal, repo: "__GITNEXUS_REPO__"}) for reasoning about code.\n' +
      'If query/context returned clearly wrong data after uid retry, tell the user why — hooks allow scoped Grep in a known file for verification.',
    'SemanticSearch disabled — GitNexus query required.'
  );
  process.exit(0);
}

const pattern = ti.pattern ?? '';
const pathArg = ti.path ?? ti.glob ?? '';

if (!pattern) {
  allow();
  process.exit(0);
}

const allowPath =
  /research\/presets|research\/examples|research\/sweeps|\.json|\.yaml|\.yml|\.md|\.matrix|docs\/|\.env|README|package\.json|AGENTS\.md|CLAUDE\.md/i.test(
    pathArg
  );
const allowPattern =
  /["'`]|console\.|TODO|FIXME|eslint|@type|strategyId|scannerOptions|profile|\.matrix|gitnexus|npm run|import\s+['"]|require\s*\(|\/api\/|http/i.test(
    pattern
  ) || (/[\\/:*?[\]{}()]/.test(pattern) && pattern.length > 40);

if (allowPath || allowPattern) {
  allow('Grep OK — literal/config/doc search.');
  process.exit(0);
}

const bareId = /^[A-Za-z_$][\w$]*$/.test(pattern) && pattern.length >= 3;
const exportDecl = /^(export\s+)?(async\s+)?function\s+[A-Za-z_$]/.test(pattern);
const classDecl = /^(export\s+)?class\s+[A-Za-z_$]/.test(pattern);

if ((bareId || exportDecl || classDecl) && isScopedSourceFile(pathArg)) {
  if (!graphUsedThisSession) {
    const sym = bareId ? pattern : pattern.replace(/^.*?\b([A-Za-z_$][\w$]*).*$/, '$1');
    deny(
      `Scoped Grep("${pattern}") blocked — no GitNexus MCP call yet this session. Use graph tools first:\n` +
        `  gitnexus_context({name: "${sym}", repo: "__GITNEXUS_REPO__"})\n` +
        `After at least one GitNexus MCP call, scoped Grep in a known file is OK if GN results were suspicious (tell user why).`,
      'Use GitNexus context before scoped symbol grep.'
    );
    process.exit(0);
  }
  allow(
    'Scoped verification Grep in a known file — OK after GitNexus use this session. Tell the user why GN was not trusted for this lookup.'
  );
  process.exit(0);
}

if (bareId || exportDecl || classDecl) {
  const sym = bareId ? pattern : pattern.replace(/^.*?\b([A-Za-z_$][\w$]*).*$/, '$1');
  deny(
    `Grep("${pattern}") blocked — symbol lookup must use GitNexus:\n` +
      `  gitnexus_context({name: "${sym}", repo: "__GITNEXUS_REPO__"})\n` +
      `  → callers, callees, processes. If ambiguous, re-call with uid from results.\n` +
      `For fuzzy concepts / reasoning: gitnexus_query({query: "...", task_context: "...", goal: "..."})\n` +
      `If GN returns 0 callers on a known hub, wrong file paths, or contradicts detect_changes: retry with uid once, then scoped Grep in the file GN pointed to OR tell user GN looks wrong.`,
    `Symbol grep blocked — use gitnexus_context on "${sym}"`
  );
  process.exit(0);
}

if (/^[a-z][a-zA-Z0-9]*$/.test(pattern) && pattern.length >= 6 && !pathArg) {
  deny(
    `Grep("${pattern}") looks like a symbol name — use gitnexus_context({name: "${pattern}", repo: "__GITNEXUS_REPO__"}) instead.\n` +
      'If context is empty/suspicious after uid retry, scoped Grep in a known file is allowed.',
    'Likely symbol grep blocked.'
  );
  process.exit(0);
}

allow('Grep allowed — if this is structural code lookup or reasoning, prefer gitnexus_context/query instead.');
NODE
