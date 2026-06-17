#!/usr/bin/env bash
# preToolUse Grep/Glob/SemanticSearch: block symbol-style searches when GN is fresh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export GITNEXUS_HOOK_INPUT="$(cat)"
export GITNEXUS_ROOT="$ROOT"
export GITNEXUS_STALENESS="$(node "$ROOT/.cursor/hooks/lib/load-staleness.mjs" "$ROOT" 2>/dev/null || echo '{"fresh":false,"reason":"check_failed"}')"
export GITNEXUS_FIRST_NUDGE="$(node "$ROOT/.cursor/hooks/lib/first-nudge.mjs" "$ROOT" 2>/dev/null || true)"

node <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.env.GITNEXUS_ROOT || '';
const helpers = await import(pathToFileURL(path.join(root, '.cursor/hooks/lib/hook-helpers.mjs')).href);
const { appendNudge } = await import(pathToFileURL(path.join(root, '.cursor/hooks/lib/session-primer.mjs')).href);

const input = JSON.parse(process.env.GITNEXUS_HOOK_INPUT || '{}');
const stale = JSON.parse(process.env.GITNEXUS_STALENESS || '{"fresh":false}');
const nudge = process.env.GITNEXUS_FIRST_NUDGE || '';
const tool = input.tool_name ?? '';
const ti = input.tool_input ?? {};

const config = helpers.loadHookConfig(root);
const repo = helpers.repoName(root);
const mcpFlag = path.join(root, '.cursor/.gitnexus-mcp-used.flag');
const graphUsedThisSession = fs.existsSync(mcpFlag);

function emit(result) {
  const applied = helpers.applyHookMode(result, config.mode);
  if (applied.agent_message) {
    applied.agent_message = appendNudge(applied.agent_message, nudge);
  }
  process.stdout.write(JSON.stringify(applied));
}

function staleFallbackMsg() {
  return helpers.hookAgentMessage(
    root,
    'stale-fallback',
    'GN FALLBACK (stale): classical Grep/Read OK. NEXT: npm run gitnexus:agent-refresh (required_permissions: ["all"]).',
    'GN FALLBACK (stale): refresh autonomously.'
  );
}

if (!stale.fresh) {
  emit({ permission: 'allow', agent_message: staleFallbackMsg() });
  process.exit(0);
}

const reNudge = helpers.midSessionGraphNudge(graphUsedThisSession, root);

if (tool === 'Glob') {
  const pattern = ti.glob_pattern ?? ti.pattern ?? '';
  if (helpers.isBroadSourceGlob(pattern, config)) {
    const call = helpers.mcpQuery({ query: '<concept>', taskContext: 'find modules', goal: 'entry points', repo });
    emit({
      permission: 'deny',
      agent_message: helpers.hookAgentMessage(
        root,
        `glob:${pattern}`,
        `Glob blocked → ${call}`,
        `Glob blocked → ${call}`
      ) + (reNudge ? `\n${reNudge}` : ''),
      user_message: 'Broad source Glob blocked — use GitNexus query.',
    });
    process.exit(0);
  }
  emit({ permission: 'allow', agent_message: 'Glob OK for non-source patterns.' });
  process.exit(0);
}

if (tool === 'SemanticSearch') {
  const q = ti.query ?? ti.search_term ?? '<topic>';
  const call = helpers.mcpQuery({ query: q, taskContext: q, goal: 'flows', repo });
  emit({
    permission: 'deny',
    agent_message:
      helpers.hookAgentMessage(root, 'semantic-search', `SemanticSearch blocked → ${call}`, `→ ${call}`) +
      (reNudge ? `\n${reNudge}` : ''),
    user_message: 'SemanticSearch disabled — use gitnexus_query (graph + embeddings).',
  });
  process.exit(0);
}

const pattern = ti.pattern ?? '';
const pathArg = ti.path ?? ti.glob ?? '';

if (!pattern) {
  emit({ permission: 'allow' });
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
  emit({ permission: 'allow', agent_message: 'Grep OK — literal/config/doc search.' });
  process.exit(0);
}

const bareId = /^[A-Za-z_$][\w$]*$/.test(pattern) && pattern.length >= 3;
const exportDecl = /^(export\s+)?(async\s+)?function\s+[A-Za-z_$]/.test(pattern);
const classDecl = /^(export\s+)?class\s+[A-Za-z_$]/.test(pattern);
const sym = bareId ? pattern : pattern.replace(/^.*?\b([A-Za-z_$][\w$]*).*$/, '$1');
const scopedSource = pathArg && helpers.isSourceCodePath(pathArg, config);

if ((bareId || exportDecl || classDecl) && scopedSource) {
  if (!graphUsedThisSession) {
    const call = helpers.mcpContext(sym, repo);
    emit({
      permission: 'deny',
      agent_message: helpers.hookAgentMessage(
        root,
        `grep-scoped:${sym}`,
        `Grep blocked (no GN yet) → ${call}`,
        `→ ${call}`
      ),
      user_message: 'Use GitNexus context before scoped symbol grep.',
    });
    process.exit(0);
  }
  emit({
    permission: 'allow',
    agent_message:
      'Scoped verification Grep OK after GitNexus use — tell user why GN was not trusted.' +
      (reNudge ? ` ${reNudge}` : ''),
  });
  process.exit(0);
}

if (bareId || exportDecl || classDecl) {
  const ctx = helpers.mcpContext(sym, repo);
  emit({
    permission: 'deny',
    agent_message:
      helpers.hookAgentMessage(root, `grep:${sym}`, `Grep blocked → ${ctx}`, `→ ${ctx}`) +
      (reNudge ? `\n${reNudge}` : ''),
    user_message: `Symbol grep blocked — use gitnexus_context on "${sym}"`,
  });
  process.exit(0);
}

if (/^[a-z][a-zA-Z0-9]*$/.test(pattern) && pattern.length >= 6 && !pathArg) {
  const call = helpers.mcpContext(pattern, repo);
  emit({
    permission: 'deny',
    agent_message:
      helpers.hookAgentMessage(root, `grep:${pattern}`, `Symbol grep → ${call}`, `→ ${call}`) +
      (reNudge ? `\n${reNudge}` : ''),
    user_message: 'Likely symbol grep blocked.',
  });
  process.exit(0);
}

emit({
  permission: 'allow',
  agent_message:
    'Grep allowed — if structural lookup, prefer:\n' +
    `  ${helpers.mcpContext('<symbol>', repo)}` +
    (reNudge ? `\n${reNudge}` : ''),
});
NODE
