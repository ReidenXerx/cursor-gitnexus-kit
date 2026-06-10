#!/usr/bin/env node
/**
 * Session-first-tool nudge + flag management for GitNexus hooks.
 */
import fs from 'node:fs';
import path from 'node:path';

export function sessionPaths(root) {
  const cursorDir = path.join(root, '.cursor');
  return {
    cursorDir,
    primedFlag: path.join(cursorDir, '.gitnexus-session-primed.flag'),
    promptHint: path.join(cursorDir, '.gitnexus-prompt-hint.json'),
    refreshPendingFlag: path.join(cursorDir, '.gitnexus-refresh-pending.flag'),
    mcpUsedFlag: path.join(cursorDir, '.gitnexus-mcp-used.flag'),
  };
}

export function setRefreshPending(root, pending, detail = '') {
  const { cursorDir, refreshPendingFlag } = sessionPaths(root);
  fs.mkdirSync(cursorDir, { recursive: true });
  if (pending) {
    fs.writeFileSync(refreshPendingFlag, JSON.stringify({ at: new Date().toISOString(), detail }, null, 2));
  } else {
    try {
      fs.unlinkSync(refreshPendingFlag);
    } catch {
      /* ignore */
    }
  }
}

export function isRefreshPending(root) {
  const { refreshPendingFlag } = sessionPaths(root);
  return fs.existsSync(refreshPendingFlag);
}

export function clearSessionState(root) {
  const { cursorDir, primedFlag, promptHint, mcpUsedFlag } = sessionPaths(root);
  fs.mkdirSync(cursorDir, { recursive: true });
  for (const f of [primedFlag, promptHint, mcpUsedFlag]) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
}

export function writePromptHint(root, hint) {
  const { cursorDir, promptHint } = sessionPaths(root);
  fs.mkdirSync(cursorDir, { recursive: true });
  fs.writeFileSync(promptHint, JSON.stringify({ ...hint, at: new Date().toISOString() }, null, 2));
}

export function readPromptHint(root) {
  const { promptHint } = sessionPaths(root);
  try {
    return JSON.parse(fs.readFileSync(promptHint, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Returns nudge text once per session (sets primed flag).
 * @param {object} stale from check-staleness.mjs
 */
export function firstToolNudge(root, stale) {
  const { primedFlag } = sessionPaths(root);
  if (fs.existsSync(primedFlag)) return null;

  fs.mkdirSync(path.dirname(primedFlag), { recursive: true });
  fs.writeFileSync(primedFlag, new Date().toISOString());

  const hint = readPromptHint(root);
  const parts = [];

  if (!stale?.fresh) {
    parts.push(
      'GITNEXUS AUTONOMOUS MAINTENANCE (MANDATORY): Index is stale. Your NEXT Shell call MUST be: npm run gitnexus:agent-refresh with required_permissions: ["all"]. ' +
        'Run it yourself — NEVER tell the user to run npx gitnexus analyze or gitnexus:refresh. Gitnexus npm scripts are hook pre-approved. Then retry graph tools.'
    );
  } else {
    parts.push(
      'GITNEXUS SESSION: Before structural work, READ gitnexus://repo/__GITNEXUS_REPO__/context OR run npm run gitnexus:agent-status (autonomous, no user ask).'
    );
  }

  if (hint.architecture || hint.explore) {
    parts.push(
      'Explore/reason prompt detected — read gitnexus-imaging skill; chain: query(+task_context,goal) → READ process/{name} → context(uid) → targeted Read. Keep using graph tools for mid-task reasoning, not only the first lookup.'
    );
  }

  if (hint.reasoning) {
    parts.push(
      'Code-reasoning prompt — prefer gitnexus_query/context/impact throughout the task, not grep. Re-query when the question shifts.'
    );
  }

  return parts.join('\n');
}

export function appendNudge(agentMessage, nudge) {
  if (!nudge) return agentMessage;
  if (!agentMessage) return nudge;
  return `${nudge}\n\n${agentMessage}`;
}
