#!/usr/bin/env node
/**
 * Session-first-tool nudge + flag management for GitNexus hooks.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { playbookForHint, mcpReadContext, repoName, clearDenyCache } from './hook-helpers.mjs';

export function sessionPaths(root) {
  const stateDir = path.join(root, '.gnkit');
  return {
    stateDir,
    primedFlag: path.join(stateDir, '.gitnexus-session-primed.flag'),
    promptHint: path.join(stateDir, '.gitnexus-prompt-hint.json'),
    refreshPendingFlag: path.join(stateDir, '.gitnexus-refresh-pending.flag'),
    refreshFailedFlag: path.join(stateDir, '.gitnexus-refresh-failed.flag'),
    mcpUsedFlag: path.join(stateDir, '.gitnexus-mcp-used.flag'),
    impactUsedFlag: path.join(stateDir, '.gitnexus-impact-used.flag'),
    detectUsedFlag: path.join(stateDir, '.gitnexus-detect-used.flag'),
    stalenessCacheFile: path.join(stateDir, '.gitnexus-staleness-cache.json'),
    scorecardFile: path.join(stateDir, '.gitnexus-scorecard.json'),
  };
}

/**
 * Record which GitNexus MCP tool the agent used, so edit/commit guards can enforce
 * "impact before edit" and "detect_changes before commit" once per session.
 * @param {string} root
 * @param {string} toolName e.g. "gitnexus_impact" / "mcp_gitnexus_detect_changes"
 */
export function setMcpToolUsed(root, toolName) {
  const { stateDir, mcpUsedFlag, impactUsedFlag, detectUsedFlag } = sessionPaths(root);
  fs.mkdirSync(stateDir, { recursive: true });
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
  const { stateDir, scorecardFile } = sessionPaths(root);
  try {
    fs.mkdirSync(stateDir, { recursive: true });
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

// ── Persistent telemetry ─────────────────────────────────────────────────────
// The scorecard is per-session (cleared on session start). Before clearing, we
// archive each finished session's tally to an append-only .jsonl so aggregate
// trends survive across sessions. Read/aggregate via `npm run gitnexus:stats`.

const TELEMETRY_FILE = '.gitnexus-telemetry.jsonl';

/** @param {string} root — append-only telemetry log (gitignored, never cleared). */
export function telemetryPath(root) {
  return path.join(root, '.gnkit', TELEMETRY_FILE);
}

/** Best-effort index stats snapshot for context on a telemetry record. */
function indexSnapshot(root) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(root, '.gitnexus/meta.json'), 'utf8')).stats || {};
    return {
      files: s.files ?? null,
      nodes: s.nodes ?? null,
      embeddings: s.embeddings ?? null,
      processes: s.processes ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Archive the finished session's scorecard to the persistent telemetry log.
 * No-op when the session recorded nothing. Never throws (telemetry must not
 * block session start).
 * @param {string} root
 * @returns {boolean} whether a record was written
 */
export function flushScorecardToTelemetry(root) {
  const card = readScorecard(root);
  if (!card?.counts || Object.keys(card.counts).length === 0) return false;
  const startedAt = card.startedAt ?? null;
  const endedAt = card.updatedAt ?? null;
  const durationMs =
    startedAt && endedAt ? Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)) : null;
  const rec = { startedAt, endedAt, durationMs, counts: card.counts, index: indexSnapshot(root) };
  try {
    fs.mkdirSync(path.join(root, '.gnkit'), { recursive: true });
    fs.appendFileSync(telemetryPath(root), JSON.stringify(rec) + '\n');
    return true;
  } catch {
    return false;
  }
}

/** Parse the telemetry log into records (skips blank/malformed lines). */
export function readTelemetry(root) {
  let text = '';
  try {
    text = fs.readFileSync(telemetryPath(root), 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      /* skip malformed line */
    }
  }
  return out;
}

/** Aggregate telemetry records into totals / per-session averages / recent. */
export function summarizeTelemetry(records) {
  const sessions = records.length;
  const totals = {};
  let totalDurationMs = 0;
  let durCount = 0;
  let firstAt = null;
  let lastAt = null;
  for (const r of records) {
    for (const [k, v] of Object.entries(r.counts || {})) {
      totals[k] = (totals[k] ?? 0) + (Number(v) || 0);
    }
    if (typeof r.durationMs === 'number') {
      totalDurationMs += r.durationMs;
      durCount++;
    }
    if (r.startedAt && (!firstAt || r.startedAt < firstAt)) firstAt = r.startedAt;
    if (r.endedAt && (!lastAt || r.endedAt > lastAt)) lastAt = r.endedAt;
  }
  const avgPerSession = {};
  for (const [k, v] of Object.entries(totals)) {
    avgPerSession[k] = sessions ? Math.round((v / sessions) * 100) / 100 : 0;
  }
  return {
    sessions,
    firstAt,
    lastAt,
    totals,
    avgPerSession,
    avgDurationMs: durCount ? Math.round(totalDurationMs / durCount) : null,
    recent: records.slice(-5),
  };
}

export function setRefreshPending(root, pending, detail = '') {
  const { stateDir, refreshPendingFlag } = sessionPaths(root);
  fs.mkdirSync(stateDir, { recursive: true });
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
  const { stateDir, refreshFailedFlag } = sessionPaths(root);
  fs.mkdirSync(stateDir, { recursive: true });
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

// ── Durable memory + compaction recovery ────────────────────────────────────
// Context compaction (auto or manual) drops the middle of a conversation. The
// per-session gate flags + a running memory file must survive it, so the agent
// doesn't re-run cleared gates or lose task state after a compaction.

const MEMORY_FILE = 'MEMORY.md';

/**
 * Claude Code's NATIVE per-project memory file — `~/.claude/projects/<slug>/memory/MEMORY.md`,
 * where <slug> is the project's absolute path with "/" → "-". We reuse it (not a kit-specific
 * file) so Claude Code refers to its own memory and every other agent mirrors the same file.
 * Lives outside the repo, so it is never committed/gitignored.
 * @param {string} root project root (absolute)
 */
export function memoryPath(root) {
  const home = process.env.HOME || os.homedir();
  const slug = path.resolve(root).replace(/\//g, '-');
  return path.join(home, '.claude', 'projects', slug, 'memory', MEMORY_FILE);
}

/**
 * Clear per-session state ONLY on a genuinely new session. A compaction/resume
 * is the SAME task continuing — clearing there would wipe satisfied gates and
 * re-block the agent mid-task.
 * @param {string} [source] Claude SessionStart source: startup|clear|compact|resume
 */
export function shouldClearOnSource(source) {
  return source !== 'compact' && source !== 'resume';
}

/** Append a lightweight state breadcrumb to the memory file (best-effort). */
export function appendMemoryCheckpoint(root, note = '') {
  const p = memoryPath(root);
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    if (!fs.existsSync(p)) {
      fs.writeFileSync(
        p,
        `# Project working memory (GitNexus kit)\n\n` +
          `> Durable across compaction + sessions. Keep this current: task, decisions, ` +
          `findings, open items, key file:line. Nothing important should live only in the volatile transcript.\n`,
      );
    }
    fs.appendFileSync(p, `\n<!-- checkpoint ${new Date().toISOString()} -->\n${note}\n`);
    return true;
  } catch {
    return false;
  }
}

export function clearSessionState(root) {
  const {
    stateDir,
    primedFlag,
    promptHint,
    mcpUsedFlag,
    impactUsedFlag,
    detectUsedFlag,
    refreshFailedFlag,
    stalenessCacheFile,
    scorecardFile,
  } = sessionPaths(root);
  fs.mkdirSync(stateDir, { recursive: true });
  // Archive the finishing session's tally BEFORE wiping the scorecard.
  flushScorecardToTelemetry(root);
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
      fs.unlinkSync(path.join(stateDir, rel));
    } catch {
      /* ignore */
    }
  }
  clearDenyCache(root);
}

export function writePromptHint(root, hint) {
  const { stateDir, promptHint } = sessionPaths(root);
  fs.mkdirSync(stateDir, { recursive: true });
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
