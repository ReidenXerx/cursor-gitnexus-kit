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
const { appendNudge, bumpScore } = await import(pathToFileURL(path.join(root, '.cursor/hooks/lib/session-primer.mjs')).href);
const { evaluateStalePolicy, staleRefreshAgentMessage } = await import(
  pathToFileURL(path.join(root, '.cursor/hooks/lib/stale-policy.mjs')).href
);

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
  if (result.permission === 'deny') bumpScore(root, 'grepRedirects');
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
    staleRefreshAgentMessage(stale, evaluateStalePolicy(stale, root)),
    'GN FALLBACK (stale): refresh failed — classical OK; say why.'
  );
}

const stalePolicy = evaluateStalePolicy(stale, root);

if (stalePolicy.phase === 'must_refresh') {
  const pattern = ti.pattern ?? '';
  const pathArg = ti.path ?? ti.glob ?? '';
  const allowPath =
    /\.json|\.jsonl|\.yaml|\.yml|\.toml|\.ini|\.cfg|\.lock|\.md|\.mdc|\.csv|fixtures?\/|__snapshots__|docs\/|\.env|README|package\.json|AGENTS\.md|CLAUDE\.md/i.test(
      pathArg
    );
  const allowPattern =
    /["'`]|console\.|TODO|FIXME|eslint|@type|@param|gitnexus|npm run|import\s+['"]|require\s*\(|\/api\/|https?:/i.test(
      pattern
    ) || (/[\\/:*?[\]{}()]/.test(pattern) && pattern.length > 40);

  if (allowPath || allowPattern) {
    emit({
      permission: 'allow',
      agent_message:
        'Literal/config grep OK during stale — run npm run gitnexus:agent-refresh before symbol exploration.',
    });
    process.exit(0);
  }

  emit({
    permission: 'deny',
    agent_message: staleRefreshAgentMessage(stale, stalePolicy),
    user_message: helpers.userMessage('stale.must_refresh'),
  });
  process.exit(0);
}

if (stalePolicy.phase === 'classical_fallback') {
  emit({
    permission: 'allow',
    agent_message: staleFallbackMsg(),
    user_message: helpers.userMessage('stale.classical'),
  });
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
      user_message: helpers.userMessage('block.glob'),
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
    user_message: helpers.userMessage('block.semantic'),
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
  /\.json|\.jsonl|\.yaml|\.yml|\.toml|\.ini|\.cfg|\.lock|\.md|\.mdc|\.csv|fixtures?\/|__snapshots__|docs\/|\.env|README|package\.json|AGENTS\.md|CLAUDE\.md/i.test(
    pathArg
  );
const allowPattern =
  /["'`]|console\.|TODO|FIXME|eslint|@type|@param|gitnexus|npm run|import\s+['"]|require\s*\(|\/api\/|https?:/i.test(
    pattern
  ) || (/[\\/:*?[\]{}()]/.test(pattern) && pattern.length > 40);

if (allowPath || allowPattern) {
  emit({ permission: 'allow', agent_message: 'Grep OK — literal/config/doc search.' });
  process.exit(0);
}

const exportDecl = /^(export\s+)?(async\s+)?function\s+[A-Za-z_$]/.test(pattern);
const classDecl = /^(export\s+)?class\s+[A-Za-z_$]/.test(pattern);

let fieldName = pattern;
const dotField = pattern.match(/(?:^|\.)((?:[a-z][a-zA-Z0-9]*))$/);
if (dotField) fieldName = dotField[1];

if (helpers.isLikelyFieldName(fieldName) && !exportDecl && !classDecl) {
  const schema = helpers.mcpReadSchema(repo);
  const call = helpers.cypherFieldAccess(fieldName, repo);
  emit({
    permission: 'deny',
    agent_message:
      helpers.hookAgentMessage(
        root,
        `grep:field:${fieldName}`,
        `Field grep blocked → ${schema} → ${call}`,
        `→ ${call}`
      ) +
      (reNudge ? `\n${reNudge}` : '') +
      `\n${helpers.cypherMidSessionNudge()}`,
    user_message: helpers.userMessage('block.grep.field', { symbol: fieldName }),
  });
  process.exit(0);
}

const bareId = /^[A-Za-z_$][\w$]*$/.test(pattern) && pattern.length >= 3;
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
      user_message: helpers.userMessage('block.grep.noGraph'),
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
    user_message: helpers.userMessage('block.grep.symbol', { symbol: sym }),
  });
  process.exit(0);
}

if (/^[a-z][a-zA-Z0-9]*$/.test(pattern) && pattern.length >= 6 && !pathArg) {
  if (helpers.isLikelyFieldName(pattern)) {
    const schema = helpers.mcpReadSchema(repo);
    const call = helpers.cypherFieldAccess(pattern, repo);
    emit({
      permission: 'deny',
      agent_message:
        helpers.hookAgentMessage(root, `grep:field:${pattern}`, `Field grep → ${schema} → ${call}`, `→ ${call}`) +
        (reNudge ? `\n${reNudge}` : ''),
      user_message: helpers.userMessage('block.grep.field', { symbol: pattern }),
    });
    process.exit(0);
  }
  const call = helpers.mcpContext(pattern, repo);
  emit({
    permission: 'deny',
    agent_message:
      helpers.hookAgentMessage(root, `grep:${pattern}`, `Symbol grep → ${call}`, `→ ${call}`) +
      (reNudge ? `\n${reNudge}` : ''),
    user_message: helpers.userMessage('block.grep.likely'),
  });
  process.exit(0);
}

emit({
  permission: 'allow',
  agent_message:
    'Grep allowed — if structural lookup, prefer:\n' +
    `  ${helpers.mcpContext('<symbol>', repo)}\n` +
    `  Field/property: ${helpers.mcpReadSchema(repo)} → ${helpers.cypherFieldAccess('<field>', repo)}` +
    (reNudge ? `\n${reNudge}` : ''),
});
NODE
