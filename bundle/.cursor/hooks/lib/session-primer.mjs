#!/usr/bin/env node
/**
 * Session-first-tool nudge + flag management for GitNexus hooks.
 */
import fs from 'node:fs';
import path from 'node:path';
import { playbookForHint, mcpReadContext, repoName, clearDenyCache } from './hook-helpers.mjs';

export function sessionPaths(root) {
  const cursorDir = path.join(root, '.cursor');
  return {
    cursorDir,
    primedFlag: path.join(cursorDir, '.gitnexus-session-primed.flag'),
    promptHint: path.join(cursorDir, '.gitnexus-prompt-hint.json'),
    refreshPendingFlag: path.join(cursorDir, '.gitnexus-refresh-pending.flag'),
    refreshFailedFlag: path.join(cursorDir, '.gitnexus-refresh-failed.flag'),
    mcpUsedFlag: path.join(cursorDir, '.gitnexus-mcp-used.flag'),
    impactUsedFlag: path.join(cursorDir, '.gitnexus-impact-used.flag'),
    detectUsedFlag: path.join(cursorDir, '.gitnexus-detect-used.flag'),
    stalenessCacheFile: path.join(cursorDir, '.gitnexus-staleness-cache.json'),
    scorecardFile: path.join(cursorDir, '.gitnexus-scorecard.json'),
  };
}

/**
 * Record which GitNexus MCP tool the agent used, so edit/commit guards can enforce
 * "impact before edit" and "detect_changes before commit" once per session.
 * @param {string} root
 * @param {string} toolName e.g. "gitnexus_impact" / "mcp_gitnexus_detect_changes"
 */
export function setMcpToolUsed(root, toolName) {
  const { cursorDir, mcpUsedFlag, impactUsedFlag, detectUsedFlag } = sessionPaths(root);
  fs.mkdirSync(cursorDir, { recursive: true });
  const stamp = new Date().toISOString();
  try {
    fs.writeFileSync(mcpUsedFlag, stamp);
    if (/impact|rename/i.test(toolName)) fs.writeFileSync(impactUsedFlag, stamp);
    if (/detect_changes|detect-changes/i.test(toolName)) fs.writeFileSync(detectUsedFlag, stamp);
  } catch {
    /* best effort */
  }
}

/** @param {string} root */
export function isImpactUsed(root) {
  return fs.existsSync(sessionPaths(root).impactUsedFlag);
}

/** @param {string} root */
export function isDetectUsed(root) {
  return fs.existsSync(sessionPaths(root).detectUsedFlag);
}

/** Invalidate the short-TTL staleness cache (after refresh / on session start). */
export function clearStalenessCache(root) {
  try {
    fs.unlinkSync(sessionPaths(root).stalenessCacheFile);
  } catch {
    /* ignore */
  }
}

/**
 * Lightweight enforcement scorecard — counts how often the kit redirected the agent
 * from a lazy pattern to the graph. Surfaced in agent-brief / `gitnexus:scorecard`.
 * @param {string} root
 * @param {string} key
 */
export function bumpScore(root, key) {
  const { cursorDir, scorecardFile } = sessionPaths(root);
  try {
    fs.mkdirSync(cursorDir, { recursive: true });
    let card = {};
    try {
      card = JSON.parse(fs.readFileSync(scorecardFile, 'utf8'));
    } catch {
      card = {};
    }
    card.counts ??= {};
    card.counts[key] = (card.counts[key] ?? 0) + 1;
    card.startedAt ??= new Date().toISOString();
    card.updatedAt = new Date().toISOString();
    fs.writeFileSync(scorecardFile, JSON.stringify(card, null, 2));
  } catch {
    /* best effort — never block a tool on telemetry */
  }
}

/** @param {string} root */
export function readScorecard(root) {
  try {
    return JSON.parse(fs.readFileSync(sessionPaths(root).scorecardFile, 'utf8'));
  } catch {
    return { counts: {} };
  }
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

export function setRefreshFailed(root, failed, detail = '') {
  const { cursorDir, refreshFailedFlag } = sessionPaths(root);
  fs.mkdirSync(cursorDir, { recursive: true });
  if (failed) {
    fs.writeFileSync(refreshFailedFlag, JSON.stringify({ at: new Date().toISOString(), detail }, null, 2));
  } else {
    try {
      fs.unlinkSync(refreshFailedFlag);
    } catch {
      /* ignore */
    }
  }
}

export function isRefreshFailed(root) {
  const { refreshFailedFlag } = sessionPaths(root);
  return fs.existsSync(refreshFailedFlag);
}

export function clearSessionState(root) {
  const {
    cursorDir,
    primedFlag,
    promptHint,
    mcpUsedFlag,
    impactUsedFlag,
    detectUsedFlag,
    refreshFailedFlag,
    stalenessCacheFile,
    scorecardFile,
  } = sessionPaths(root);
  fs.mkdirSync(cursorDir, { recursive: true });
  for (const f of [
    primedFlag,
    promptHint,
    mcpUsedFlag,
    impactUsedFlag,
    detectUsedFlag,
    refreshFailedFlag,
    stalenessCacheFile,
    scorecardFile,
  ]) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
  for (const rel of ['.gitnexus-session-user-notified.flag']) {
    try {
      fs.unlinkSync(path.join(cursorDir, rel));
    } catch {
      /* ignore */
    }
  }
  clearDenyCache(root);
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
  const repo = repoName(root);
  const parts = [];

  if (!stale?.fresh) {
    const reason =
      stale?.reason === 'missing_embeddings'
        ? 'MISSING EMBEDDINGS: semantic query unavailable — '
        : 'STALE INDEX: ';
    parts.push(
      `${reason}next Shell MUST be npm run gitnexus:agent-refresh (required_permissions: ["all"]). Includes --embeddings. Run yourself — never ask user to analyze.`
    );
  } else {
    parts.push(`SESSION: ${mcpReadContext(repo)} OR npm run gitnexus:agent-brief`);
  }

  const playbook = playbookForHint(hint, repo);
  if (playbook) parts.push(playbook);

  return parts.join('\n');
}

export function appendNudge(agentMessage, nudge) {
  if (!nudge) return agentMessage;
  if (!agentMessage) return nudge;
  return `${nudge}\n\n${agentMessage}`;
}
