#!/usr/bin/env node
/**
 * Agent region session: manifest load, picker, write-boundary checks.
 * Reads anywhere for reasoning; writes restricted to region owns (superchat exempt).
 */
import fs from 'node:fs';
import path from 'node:path';
import { inferRegionFromPrompt } from './region-infer.mjs';
import {
  buildSessionStartUserGuide,
  buildInferredUserAnnouncement,
  buildAmbiguousUserScript,
  buildWaitingForTaskGuide,
  buildRegionListCompact,
  buildNoRegionEditWarning,
} from './region-user-guide.mjs';

export {
  buildSessionStartUserGuide,
  buildInferredUserAnnouncement,
  buildAmbiguousUserScript,
  buildNoRegionEditWarning,
};

export const REGION_STATE_FILE = '.cursor/.agent-region.json';
export const MANIFEST_FILE = '.cursor/regions.manifest.json';
export const OVERLAY_FILE = 'docs/regions.overlay.json';

/** Paths any region may write (session/meta tooling). */
export const META_WRITE_GLOBS = [
  '.cursor/.agent-region.json',
  '.cursor/.gitnexus-*.flag',
  '.cursor/.gitnexus-prompt-hint.json',
  '.cursor/.gitnexus-refresh-pending.flag',
  '.cursor/.gitnexus-mcp-used.flag',
  '.cursor/.gitnexus-session-*.flag',
];

const DEFAULT_PARTIAL_OVERFLOW_WRITES = 2;

/**
 * @param {string} pattern glob with * and **
 * @param {string} filePath
 */
export function globMatch(filePath, pattern) {
  const norm = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
  const pat = pattern.replace(/\\/g, '/').replace(/^\.\//, '');
  const re = new RegExp(
    `^${pat
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '\0')
      .replace(/\*/g, '[^/]*')
      .replace(/\0/g, '.*')}$`
  );
  return re.test(norm);
}

/** @param {string} filePath @param {string[]} globs */
export function matchesAnyGlob(filePath, globs) {
  if (!globs?.length) return false;
  return globs.some((g) => globMatch(filePath, g));
}

/** @param {string} root */
export function manifestPath(root) {
  return path.join(root, MANIFEST_FILE);
}

/** @param {string} root */
export function regionStatePath(root) {
  return path.join(root, REGION_STATE_FILE);
}

/** @param {string} root */
export function loadManifest(root) {
  const p = manifestPath(root);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/** @param {string} root */
export function loadRegionState(root) {
  const p = regionStatePath(root);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/** @param {string} root */
export function clearRegionState(root) {
  try {
    fs.unlinkSync(regionStatePath(root));
  } catch {
    /* ignore */
  }
}

/**
 * @param {object | null} state
 * @returns {string[]}
 */
export function getRegionIds(state) {
  if (!state) return [];
  if (state.mode === 'superchat') return ['superchat'];
  if (Array.isArray(state.ids) && state.ids.length) return state.ids;
  if (state.id) return [state.id];
  return [];
}

/**
 * @param {object} manifest
 * @param {string[]} ids
 */
export function findRegions(manifest, ids) {
  if (!manifest || !ids?.length) return [];
  return ids.map((id) => findRegion(manifest, id)).filter(Boolean);
}

/**
 * @param {object} manifest
 * @param {string[]} ids
 */
export function regionLabelFromIds(manifest, ids) {
  const regions = findRegions(manifest, ids);
  if (!regions.length) return ids.join(' + ');
  return regions.map((r) => r.label).join(' + ');
}

/**
 * @param {string} root
 * @param {{ id?: string, ids?: string[], mode: 'region'|'superchat', label?: string, method?: string, confidence?: number, reasons?: string[], append?: boolean }} selection
 */
export function saveRegionState(root, selection) {
  const p = regionStatePath(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const prev = loadRegionState(root) ?? {};
  const manifest = loadManifest(root);

  let ids;
  if (selection.mode === 'superchat') {
    ids = ['superchat'];
  } else if (selection.append && prev.mode === 'region') {
    const base = getRegionIds(prev).filter((id) => id !== 'superchat');
    const add = selection.ids ?? (selection.id ? [selection.id] : []);
    ids = [...new Set([...base, ...add])];
  } else {
    ids = selection.ids ?? (selection.id ? [selection.id] : []);
  }

  const label =
    selection.label ??
    (selection.mode === 'superchat'
      ? manifest?.superchat?.label ?? 'Superchat'
      : regionLabelFromIds(manifest, ids));

  const resetOverflow = selection.append ? prev.overflowWriteCount ?? 0 : 0;

  fs.writeFileSync(
    p,
    JSON.stringify(
      {
        ...prev,
        id: ids[0] ?? selection.id,
        ids,
        mode: selection.mode,
        label,
        method: selection.method ?? (selection.append ? 'append' : prev.method ?? 'explicit'),
        confidence: selection.confidence,
        reasons: selection.reasons,
        selectedAt: new Date().toISOString(),
        overflowWriteCount: resetOverflow,
      },
      null,
      2
    ) + '\n'
  );
}

/** @param {string} root */
export function repoName(root) {
  if (process.env.GITNEXUS_REPO) return process.env.GITNEXUS_REPO;
  const m = loadManifest(root);
  if (m?.repo) return m.repo;
  return path.basename(root);
}

/**
 * Explicit pick (number/id) or heuristic inference from task text.
 * @param {string} prompt
 * @param {object} manifest
 */
export function resolveRegionFromPrompt(prompt, manifest, existingState = null) {
  const explicit = parseRegionSelection(prompt, manifest, existingState);
  if (explicit) {
    return {
      region: { ...explicit, method: explicit.append ? 'append' : 'explicit', confidence: 1 },
      inferred: null,
    };
  }

  const inferred = inferRegionFromPrompt(prompt, manifest);
  if (inferred.regions?.length && inferred.method === 'inferred-multi') {
    const ids = inferred.regions.map((r) => r.id);
    return {
      region: {
        ids,
        id: ids[0],
        mode: 'region',
        label: regionLabelFromIds(manifest, ids),
        method: 'inferred-multi',
        confidence: inferred.confidence,
        reasons: inferred.reasons,
      },
      inferred,
    };
  }

  if (inferred.region && inferred.method !== 'ambiguous') {
    return {
      region: {
        ...inferred.region,
        ids: [inferred.region.id],
        method: inferred.method,
        confidence: inferred.confidence,
        reasons: inferred.reasons,
      },
      inferred,
    };
  }

  return { region: null, inferred };
}

/** @param {string} root */
export function bumpOverflowWrite(root) {
  const state = loadRegionState(root);
  if (!state) return 0;
  state.overflowWriteCount = (state.overflowWriteCount ?? 0) + 1;
  fs.writeFileSync(regionStatePath(root), JSON.stringify(state, null, 2) + '\n');
  return state.overflowWriteCount;
}

/** @param {object} manifest @param {string} id */
export function findRegion(manifest, id) {
  if (!manifest || !id) return null;
  if (id === 'superchat' && manifest.superchat) return { ...manifest.superchat, mode: 'superchat' };
  return manifest.regions?.find((r) => r.id === id) ?? null;
}

/** @param {string} token @param {object} manifest */
function resolveRegionToken(token, manifest) {
  const t = (token ?? '').trim().toLowerCase();
  if (!t) return null;
  if (t === 'superchat' || t === 's') {
    return { id: 'superchat', mode: 'superchat', label: manifest.superchat?.label ?? 'Superchat' };
  }
  const hit = manifest.regions?.find((r) => r.id.toLowerCase() === t);
  if (hit) return { id: hit.id, mode: 'region', label: hit.label };
  return null;
}

/** @param {string} raw @param {object} manifest */
function parseRegionIdList(raw, manifest) {
  const tokens = raw
    .split(/[,;+]|(?:\band\b)/i)
    .map((s) => s.trim())
    .filter(Boolean);
  const hits = [];
  for (const tok of tokens) {
    const hit = resolveRegionToken(tok, manifest);
    if (hit && hit.mode === 'region') hits.push(hit);
    if (hit?.mode === 'superchat' && tokens.length === 1) return { superchat: hit };
  }
  return { regions: hits };
}

/**
 * @param {string} prompt
 * @param {object} manifest
 * @param {object | null} [existingState]
 * @returns {{ id?: string, ids?: string[], mode: 'region'|'superchat', label: string, append?: boolean } | null}
 */
export function parseRegionSelection(prompt, manifest, existingState = null) {
  if (!manifest) return null;
  const text = (prompt ?? '').trim();
  if (!text) return null;

  const lower = text.toLowerCase();

  if (/^(s|superchat|super\s*chat|unbounded|no\s*boundaries?)$/i.test(lower)) {
    return {
      id: 'superchat',
      ids: ['superchat'],
      mode: 'superchat',
      label: manifest.superchat?.label ?? 'Superchat',
    };
  }

  const addMatch = lower.match(/^(?:add\s+)?regions?\s*\+\s*:\s*(.+)$/);
  if (addMatch) {
    const { regions, superchat } = parseRegionIdList(addMatch[1], manifest);
    if (superchat) return { ...superchat, ids: ['superchat'] };
    if (regions.length) {
      const ids = regions.map((r) => r.id);
      return {
        ids,
        id: ids[0],
        mode: 'region',
        label: regionLabelFromIds(manifest, ids),
        append: true,
      };
    }
  }

  const regionColon = lower.match(/^regions?\s*:\s*(.+)$/);
  if (regionColon) {
    const { regions, superchat } = parseRegionIdList(regionColon[1], manifest);
    if (superchat) return { ...superchat, ids: ['superchat'] };
    if (regions.length === 1) {
      const r = regions[0];
      return { id: r.id, ids: [r.id], mode: 'region', label: r.label };
    }
    if (regions.length > 1) {
      const ids = regions.map((r) => r.id);
      return {
        ids,
        id: ids[0],
        mode: 'region',
        label: regionLabelFromIds(manifest, ids),
      };
    }
  }

  const numMatch = lower.match(/^(?:region\s*[:#]?\s*)?(\d{1,2})$/);
  if (numMatch) {
    const idx = Number(numMatch[1]) - 1;
    const regions = manifest.regions ?? [];
    if (idx >= 0 && idx < regions.length) {
      return {
        id: regions[idx].id,
        ids: [regions[idx].id],
        mode: 'region',
        label: regions[idx].label,
      };
    }
  }

  if (!existingState) {
    for (const r of manifest.regions ?? []) {
      const id = r.id.toLowerCase();
      const label = r.label.toLowerCase();
      if (
        lower === id ||
        lower === label ||
        new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`).test(lower)
      ) {
        return { id: r.id, ids: [r.id], mode: 'region', label: r.label };
      }
    }
  }

  return null;
}

/** @param {object} manifest */
export function buildRegionPickerText(manifest) {
  if (!manifest?.regions?.length) return '';

  return buildWaitingForTaskGuide(manifest) + '\n' + buildRegionListCompact(manifest);
}

/** @param {string} root @param {object} region @param {object} manifest */
export function buildRegionCard(root, region, manifest) {
  const announce = buildInferredUserAnnouncement(region, manifest);
  if (!region || region.mode === 'superchat') {
    return announce;
  }

  const ids = getRegionIds(region);
  const regions = findRegions(manifest, ids);
  if (!regions.length) return announce || `REGION: ${region.label ?? region.id}`;

  const owns = [...new Set(regions.flatMap((r) => r.owns ?? []))];
  const skills = regions.map((r) => r.anchorSkill).filter(Boolean);

  return [
    announce,
    owns.length ? `Agent writes only: ${owns.join(', ')}` : '',
    'Agent reads: entire repo.',
    skills.length ? `Load skills: ${skills.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * @param {string} root
 * @param {string} filePath
 * @returns {{ allowed: boolean, reason?: string, partial?: boolean }}
 */
export function checkWriteAllowed(root, filePath) {
  const norm = filePath.replace(/\\/g, '/');
  const state = loadRegionState(root);
  const manifest = loadManifest(root);

  if (!manifest) return { allowed: true };

  if (!state && manifest.regions?.length) {
    return {
      allowed: true,
      noRegion: true,
      reason: buildNoRegionEditWarning(manifest),
    };
  }

  if (!state) return { allowed: true };

  if (state.mode === 'superchat') return { allowed: true };

  if (matchesAnyGlob(norm, META_WRITE_GLOBS)) return { allowed: true };

  const ids = getRegionIds(state);
  const regions = findRegions(manifest, ids);
  if (!regions.length) return { allowed: true };

  const label = state.label ?? regionLabelFromIds(manifest, ids);
  const allOwns = [...new Set(regions.flatMap((r) => r.owns ?? []))];

  if (allOwns.length && matchesAnyGlob(norm, allOwns)) {
    return { allowed: true };
  }

  const neverHit = regions.find(
    (r) => r.neverTouches?.length && matchesAnyGlob(norm, r.neverTouches)
  );
  if (neverHit) {
    return {
      allowed: false,
      reason: `Write blocked: ${norm} is in neverTouches for region "${neverHit.label}". Add the owning region (region: ${neverHit.id}) or use Superchat.`,
    };
  }

  const maxPartial = manifest.partialOverflowWrites ?? DEFAULT_PARTIAL_OVERFLOW_WRITES;
  const count = state.overflowWriteCount ?? 0;
  if (count < maxPartial) {
    return {
      allowed: true,
      partial: true,
      reason: `Partial overflow write (${count + 1}/${maxPartial}): ${norm} is outside owns for "${label}". Add another region with region+: <id> or use Superchat if many cross-area edits are needed.`,
    };
  }

  return {
    allowed: false,
    reason: `Write blocked: ${norm} is outside owns for "${label}" (${allOwns.join(', ') || 'none'}). Reads anywhere are fine; add region: <id1>, <id2> or Superchat for this edit.`,
  };
}
