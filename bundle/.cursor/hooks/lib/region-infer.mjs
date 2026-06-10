#!/usr/bin/env node
/**
 * Infer agent region from user prompt (heuristic — no external LLM).
 * Cursor hooks cannot call the chat model; this runs synchronously in beforeSubmitPrompt.
 */
import { globMatch } from './region-session.mjs';

const PATH_RE =
  /(?:`([^`]+)`|(?:^|\s)((?:src|apps|tests?|scripts|docs|packages|lib|server|api|components|pages)\/[\w./-]+))/gi;

const SUPERCHAT_RE =
  /\b(superchat|super\s*chat|whole\s+codebase|entire\s+repo|cross[- ]cutting|all\s+regions|multiple\s+areas|end[- ]to[- ]end\s+refactor)\b/i;

const EXPLICIT_ONLY_RE = /^(?:\d{1,2}|s|superchat)$/i;

/**
 * @param {string} prompt
 */
export function extractPromptPaths(prompt) {
  const paths = new Set();
  let m;
  const re = new RegExp(PATH_RE.source, PATH_RE.flags);
  while ((m = re.exec(prompt)) !== null) {
    const p = (m[1] ?? m[2] ?? '').replace(/\\/g, '/').replace(/[.:,;]+$/, '');
    if (p.length > 2) paths.add(p);
  }
  return [...paths];
}

/** @param {string} text */
function tokenize(text) {
  return (text ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
}

/**
 * @param {string} prompt
 * @param {object} manifest
 * @returns {{
 *   region: { id: string, mode: 'region'|'superchat', label: string } | null,
 *   confidence: number,
 *   method: 'explicit'|'inferred'|'ambiguous'|'superchat',
 *   reasons: string[],
 *   alternatives?: { id: string, label: string, score: number }[]
 * }}
 */
export function inferRegionFromPrompt(prompt, manifest) {
  const regions = manifest?.regions ?? [];
  if (!regions.length) {
    return { region: null, confidence: 0, method: 'ambiguous', reasons: ['no regions in manifest'] };
  }

  const text = (prompt ?? '').trim();
  if (!text || EXPLICIT_ONLY_RE.test(text)) {
    return { region: null, confidence: 0, method: 'ambiguous', reasons: ['too short or numeric-only'] };
  }

  if (SUPERCHAT_RE.test(text)) {
    return {
      region: {
        id: 'superchat',
        mode: 'superchat',
        label: manifest.superchat?.label ?? 'Superchat',
      },
      confidence: 0.95,
      method: 'superchat',
      reasons: ['cross-cutting / superchat language detected'],
    };
  }

  const paths = extractPromptPaths(text);
  const promptTokens = new Set(tokenize(text));
  const scores = [];

  for (const r of regions) {
    let score = 0;
    const reasons = [];

    for (const p of paths) {
      if (r.owns?.some((g) => globMatch(p, g))) {
        score += 5;
        reasons.push(`path ${p} ∈ owns`);
      } else if (r.owns?.some((g) => globMatch(p, g.replace(/\/[^/]+$/, '/**')))) {
        score += 3;
        reasons.push(`path ${p} near owns`);
      }
      const idInPath = r.id.toLowerCase().replace(/-/g, '/');
      if (p.toLowerCase().includes(r.id.toLowerCase()) || p.toLowerCase().includes(idInPath)) {
        score += 4;
        reasons.push(`path contains region id ${r.id}`);
      }
      if (r.neverTouches?.some((g) => globMatch(p, g))) {
        score -= 3;
        reasons.push(`path in neverTouches`);
      }
    }

    const idTok = r.id.toLowerCase();
    if (promptTokens.has(idTok) || text.toLowerCase().includes(idTok)) {
      score += 4;
      reasons.push(`keyword id:${r.id}`);
    }

    for (const kw of r.inferKeywords ?? []) {
      if (promptTokens.has(kw.toLowerCase()) || text.toLowerCase().includes(kw.toLowerCase())) {
        score += 3;
        reasons.push(`inferKeyword:${kw}`);
      }
    }

    for (const word of tokenize(r.label)) {
      if (word.length > 3 && promptTokens.has(word)) {
        score += 2;
        reasons.push(`label:${word}`);
      }
    }

    for (const word of tokenize(r.mission)) {
      if (word.length > 4 && promptTokens.has(word)) {
        score += 1;
        reasons.push(`mission:${word}`);
      }
    }

    scores.push({ region: r, score, reasons });
  }

  scores.sort((a, b) => b.score - a.score);
  const top = scores[0];
  const second = scores[1];
  const margin = top && second ? top.score - second.score : top?.score ?? 0;

  const alternatives = scores
    .filter((s) => s.score > 0)
    .slice(0, 3)
    .map((s) => ({ id: s.region.id, label: s.region.label, score: s.score }));

  const MIN_SCORE = 4;
  const MIN_MARGIN = 2;

  if (!top || top.score < MIN_SCORE) {
    return {
      region: null,
      confidence: 0,
      method: 'ambiguous',
      reasons: ['no region scored above threshold'],
      alternatives,
    };
  }

  if (second && margin < MIN_MARGIN) {
    return {
      region: null,
      confidence: top.score / (top.score + second.score),
      method: 'ambiguous',
      reasons: [`close call: ${top.region.id}(${top.score}) vs ${second.region.id}(${second.score})`],
      alternatives,
    };
  }

  const confidence = Math.min(0.98, 0.45 + top.score * 0.05 + margin * 0.03);
  return {
    region: { id: top.region.id, mode: 'region', label: top.region.label },
    confidence,
    method: 'inferred',
    reasons: top.reasons.slice(0, 6),
    alternatives,
  };
}
