#!/usr/bin/env node
/**
 * Context-pressure estimation for the TASK-CORE compaction-migration routine.
 *
 * Claude Code auto-compacts (summarizes + drops the transcript) when the context window
 * fills. The PreCompact hook CANNOT make the agent act or inject context, so we can't wait
 * for it. Instead a PostToolUse hook estimates how full the window is and, past a threshold,
 * nudges the agent to write/refresh its TASK-CORE *before* the summary lands — the only thing
 * guaranteed to survive compaction with full detail.
 *
 * This module is the estimator: it reads the CURRENT context size from the transcript cheaply
 * (tail-read, no full-file parse) and accurately (the last assistant message's usage = the
 * exact prompt size the model saw), with a byte-size fallback.
 */
import fs from "node:fs";

const TAIL_BYTES = 131072; // 128 KB tail — enough to hold the last usage record

/**
 * Estimate the current context size in tokens from a Claude Code transcript (JSONL).
 * @param {string} transcriptPath
 * @returns {number} estimated context tokens (0 if unknown/unreadable)
 */
export function estimateContextTokens(transcriptPath) {
  let size = 0;
  try {
    size = fs.statSync(transcriptPath).size;
  } catch {
    return 0;
  }
  if (!size) return 0;

  let text = "";
  try {
    const readBytes = Math.min(size, TAIL_BYTES);
    const fd = fs.openSync(transcriptPath, "r");
    try {
      const buf = Buffer.alloc(readBytes);
      fs.readSync(fd, buf, 0, readBytes, size - readBytes);
      text = buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return Math.round(size / 3.5); // couldn't read tail → byte estimate
  }

  // Accurate: the LAST assistant message's usage is the prompt size in the window
  // (non-cached input + cache read + cache creation = everything sent to the model).
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line || line[0] !== "{") continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue; // partial line (tail cut mid-record) or non-JSON — skip
    }
    const u = obj?.message?.usage || obj?.usage;
    if (u && typeof u.input_tokens === "number") {
      return (
        (u.input_tokens || 0) +
        (u.cache_read_input_tokens || 0) +
        (u.cache_creation_input_tokens || 0)
      );
    }
  }
  // No usage record in the tail → rough byte estimate (JSONL overhead ~3.5 bytes/token).
  return Math.round(size / 3.5);
}

/**
 * @param {string} transcriptPath
 * @param {{ contextWindowTokens?: number, contextPressureThreshold?: number }} config
 * @returns {{ tokens: number, window: number, threshold: number, ratio: number, over: boolean }}
 */
export function contextPressure(transcriptPath, config = {}) {
  const window = Number(config.contextWindowTokens) > 0 ? Number(config.contextWindowTokens) : 200000;
  const threshold =
    Number(config.contextPressureThreshold) > 0 ? Number(config.contextPressureThreshold) : 0.9;
  const tokens = estimateContextTokens(transcriptPath);
  const ratio = window > 0 ? tokens / window : 0;
  return { tokens, window, threshold, ratio, over: ratio >= threshold };
}
