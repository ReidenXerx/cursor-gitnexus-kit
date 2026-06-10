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
 * @param {string} root
 * @param {{ id: string, mode: 'region'|'superchat', label?: string, method?: string, confidence?: number, reasons?: string[] }} selection
 */
export function saveRegionState(root, selection) {
  const p = regionStatePath(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const prev = loadRegionState(root) ?? {};
  fs.writeFileSync(
    p,
    JSON.stringify(
      {
        ...prev,
        id: selection.id,
        mode: selection.mode,
        label: selection.label,
        method: selection.method ?? prev.method ?? 'explicit',
        confidence: selection.confidence,
        reasons: selection.reasons,
        selectedAt: new Date().toISOString(),
        overflowWriteCount: 0,
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
export function resolveRegionFromPrompt(prompt, manifest) {
  const explicit = parseRegionSelection(prompt, manifest);
  if (explicit) {
    return {
      region: { ...explicit, method: 'explicit', confidence: 1 },
      inferred: null,
    };
  }

  const inferred = inferRegionFromPrompt(prompt, manifest);
  if (inferred.region && inferred.method !== 'ambiguous') {
    return {
      region: {
        ...inferred.region,
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

/**
 * @param {string} prompt
 * @param {object} manifest
 * @returns {{ id: string, mode: 'region'|'superchat', label: string } | null}
 */
export function parseRegionSelection(prompt, manifest) {
  if (!manifest) return null;
  const text = (prompt ?? '').trim();
  if (!text) return null;

  const lower = text.toLowerCase();

  if (/^(s|superchat|super\s*chat|unbounded|no\s*boundaries?)$/i.test(lower)) {
    return {
      id: 'superchat',
      mode: 'superchat',
      label: manifest.superchat?.label ?? 'Superchat',
    };
  }

  const regionColon = lower.match(/^region\s*:\s*([a-z0-9_-]+)$/);
  if (regionColon) {
    const id = regionColon[1];
    const hit = manifest.regions?.find((r) => r.id.toLowerCase() === id);
    if (hit) return { id: hit.id, mode: 'region', label: hit.label };
    if (id === 'superchat') {
      return { id: 'superchat', mode: 'superchat', label: manifest.superchat?.label ?? 'Superchat' };
    }
  }

  const numMatch = lower.match(/^(?:region\s*[:#]?\s*)?(\d{1,2})$/);
  if (numMatch) {
    const idx = Number(numMatch[1]) - 1;
    const regions = manifest.regions ?? [];
    if (idx >= 0 && idx < regions.length) {
      return { id: regions[idx].id, mode: 'region', label: regions[idx].label };
    }
  }

  for (const r of manifest.regions ?? []) {
    const id = r.id.toLowerCase();
    const label = r.label.toLowerCase();
    if (
      lower === id ||
      lower.includes(id) ||
      lower === label ||
      lower.includes(label) ||
      new RegExp(`\\b${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower)
    ) {
      return { id: r.id, mode: 'region', label: r.label };
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

  const r = findRegion(manifest, region.id);
  if (!r) return announce || `REGION: ${region.label ?? region.id}`;

  return [
    announce,
    r.owns?.length ? `Agent writes only: ${r.owns.join(', ')}` : '',
    'Agent reads: entire repo.',
    r.anchorSkill ? `Load skill: ${r.anchorSkill}` : '',
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

  const region = findRegion(manifest, state.id);
  if (!region) return { allowed: true };

  if (region.owns?.length && matchesAnyGlob(norm, region.owns)) {
    return { allowed: true };
  }

  if (region.neverTouches?.length && matchesAnyGlob(norm, region.neverTouches)) {
    return {
      allowed: false,
      reason: `Write blocked: ${norm} is in neverTouches for region "${region.label}". Open a chat for the owning region.`,
    };
  }

  const maxPartial = manifest.partialOverflowWrites ?? DEFAULT_PARTIAL_OVERFLOW_WRITES;
  const count = state.overflowWriteCount ?? 0;
  if (count < maxPartial) {
    return {
      allowed: true,
      partial: true,
      reason: `Partial overflow write (${count + 1}/${maxPartial}): ${norm} is outside owns for "${region.label}". Prefer hand-off if more cross-region edits are needed.`,
    };
  }

  return {
    allowed: false,
    reason: `Write blocked: ${norm} is outside owns for region "${region.label}" (${region.owns?.join(', ') ?? 'none'}). Reads anywhere are fine; open another region chat or Superchat for this edit.`,
  };
}
