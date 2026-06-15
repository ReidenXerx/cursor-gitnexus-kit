#!/usr/bin/env node
/**
 * Session-first-tool nudge + flag management for GitNexus hooks.
 */
import fs from 'node:fs';
import path from 'node:path';
import { repoName } from './region-session.mjs';

export function sessionPaths(root) {
  const cursorDir = path.join(root, '.cursor');
  return {
    cursorDir,
    primedFlag: path.join(cursorDir, '.gitnexus-session-primed.flag'),
    promptHint: path.join(cursorDir, '.gitnexus-prompt-hint.json'),
    refreshPendingFlag: path.join(cursorDir, '.gitnexus-refresh-pending.flag'),
    mcpUsedFlag: path.join(cursorDir, '.gitnexus-mcp-used.flag'),
    regionState: path.join(cursorDir, '.agent-region.json'),
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
      'STALE INDEX: next Shell MUST be npm run gitnexus:agent-refresh (required_permissions: ["all"]). Run yourself — never ask user to analyze.'
    );
  } else {
    const repo = repoName(root);
    parts.push(`SESSION: READ gitnexus://repo/${repo}/context or npm run gitnexus:agent-status before structural work.`);
  }

  if (hint.architecture || hint.explore) {
    parts.push('Explore prompt: gitnexus-imaging → query → process → context → targeted Read.');
  }

  if (hint.reasoning) {
    parts.push('Reasoning prompt: query/context/impact — not grep.');
  }

  if (hint.regionAmbiguous) parts.push(hint.regionAmbiguous);
  if (hint.regionCard) {
    parts.push(hint.regionCard);
  } else if (hint.regionPicker) {
    parts.push(hint.regionPicker);
    parts.push('Block edits until region set.');
  }

  return parts.join('\n');
}

export function appendNudge(agentMessage, nudge) {
  if (!nudge) return agentMessage;
  if (!agentMessage) return nudge;
  return `${nudge}\n\n${agentMessage}`;
}
