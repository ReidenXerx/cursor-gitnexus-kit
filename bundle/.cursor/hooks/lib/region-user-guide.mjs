#!/usr/bin/env node
/**
 * Plain-language user guidance for agent regions (centralized copy).
 */

/** @param {object} manifest */
export function buildRegionListCompact(manifest) {
  if (!manifest?.regions?.length) return '(no regions — run npm run gitnexus:generate-regions)';
  return manifest.regions
    .map((r, i) => `${i + 1}=${r.label} [say: region: ${r.id}]`)
    .concat(['S=Superchat [say: superchat]'])
    .join(' | ');
}

/** Shown at session start before user sends anything. */
export function buildSessionStartUserGuide(manifest) {
  const list = buildRegionListCompact(manifest);
  return [
    '=== AGENT REGION (read first) ===',
    'STEP 1 — Type your task in plain English. Include a file path if you know it.',
    '  Example: "fix the scanner profile loader in src/future/core/scanner"',
    'STEP 2 — We auto-pick your work area from your message. No number required.',
    'STEP 3 — Wrong area? Reply with EXACTLY one of:',
    '  region: <id>   (example: region: adapters)',
    '  superchat      (whole repo — only for big cross-cutting work; use a strong model)',
    'RULES:',
    '  • You (human) can ask to read anything.',
    '  • Agent WRITES only inside the picked area (2 small border fixes allowed).',
    '  • Big change spans multiple areas → new chat in that area, or superchat.',
    `AREAS: ${list}`,
    '=== END AGENT REGION ===',
  ].join(' ');
}

/** @param {object} region @param {object} manifest */
export function buildInferredUserAnnouncement(region, manifest) {
  if (!region) return '';
  if (region.mode === 'superchat') {
    return [
      '=== TELL THE USER (copy this) ===',
      'You are in SUPERCHAT mode — no area limits.',
      'Warning: use a capable model; context may drift on large tasks.',
      'For one feature in one part of the codebase, a focused area chat works better.',
      'To switch: open a new chat and name an area (example: region: adapters).',
      '=== END ===',
    ].join(' ');
  }

  const r = manifest?.regions?.find((x) => x.id === region.id);
  const conf = region.confidence ? `${Math.round(region.confidence * 100)}%` : 'auto';
  return [
    '=== TELL THE USER (say this once at the start of your reply) ===',
    `"You're in the **${region.label}** area (${conf} match). I'll only edit files in this area."`,
    `"You can still ask me to read any file for context."`,
    `Wrong area? Reply exactly: region: <id> — options: ${buildRegionListCompact(manifest)}`,
    r?.mission ? `This area does: ${r.mission}` : '',
    '=== END ===',
  ]
    .filter(Boolean)
    .join(' ');
}

/** @param {object} inferred @param {object} manifest */
export function buildAmbiguousUserScript(inferred, manifest) {
  const alts = inferred?.alternatives ?? [];
  const options = alts.length
    ? alts.map((a) => `region: ${a.id} (${a.label})`).join('  OR  ')
    : buildRegionListCompact(manifest);

  return [
    '=== REGION UNCLEAR — ASK THE USER (use these exact words) ===',
    '"I\'m not sure which part of the codebase this belongs to."',
    `"Reply with ONE of: ${options}  OR  superchat"`,
    'Do NOT edit code until the user answers.',
    '=== END ===',
  ].join(' ');
}

/** When no region is set yet and user sent a vague first message. */
export function buildWaitingForTaskGuide(manifest) {
  return [
    '=== NO REGION YET ===',
    'Ask the user to describe their task in one sentence (file path helps).',
    'Or they can pick: ' + buildRegionListCompact(manifest),
    'Do NOT edit code until region is set.',
    '=== END ===',
  ].join(' ');
}

/** Edit attempted with no region assigned. */
export function buildNoRegionEditWarning(manifest) {
  return [
    'NO REGION SET: Before editing, user must describe their task (auto-detect) OR say region: <id>.',
    'Options: ' + buildRegionListCompact(manifest),
  ].join(' ');
}
