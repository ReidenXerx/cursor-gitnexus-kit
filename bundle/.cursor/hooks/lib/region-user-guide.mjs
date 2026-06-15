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
    'REGION: Describe task (file path helps) → area auto-picked.',
    'Wrong? region: <id> | region: <id1>, <id2> | region+: <id> | superchat.',
    'Writes only in picked area(s); reads anywhere. No edits until area set.',
    `Areas: ${list}`,
  ].join(' ');
}

/** @param {object} region @param {object} manifest */
export function buildInferredUserAnnouncement(region, manifest) {
  if (!region) return '';
  if (region.mode === 'superchat') {
    return 'REGION: superchat (unbounded writes). Agent: one-sentence notice + strong-model warning. Do NOT paste block to user.';
  }

  const ids = Array.isArray(region.ids)
    ? region.ids
    : region.id
      ? [region.id]
      : [];
  const regions = ids.map((id) => manifest?.regions?.find((x) => x.id === id)).filter(Boolean);
  const conf = region.confidence ? `${Math.round(region.confidence * 100)}%` : 'auto';
  const names =
    regions.length > 1
      ? regions.map((r) => r.label).join(' + ')
      : region.label;
  return [
    `REGION SET: ${names} (${conf}). Agent: announce in ONE sentence (area + write boundary). Do NOT paste this block to user.`,
    'Override: region: <id> | region: a, b | region+: <id> | superchat.',
  ].join(' ');
}

/** @param {object} inferred @param {object} manifest */
export function buildAmbiguousUserScript(inferred, manifest) {
  const alts = inferred?.alternatives ?? [];
  const options = alts.length
    ? alts.map((a) => `region: ${a.id} (${a.label})`).join('  OR  ')
    : buildRegionListCompact(manifest);

  return [
    'REGION UNCLEAR: Ask which area in one short question.',
    alts.length ? `Top picks: ${alts.map((a) => `region: ${a.id}`).join(' | ')}` : `Options: ${buildRegionListCompact(manifest)}`,
    'No edits until user answers.',
  ].join(' ');
}

/** When no region is set yet and user sent a vague first message. */
export function buildWaitingForTaskGuide(manifest) {
  return [
    'NO REGION: Ask for one-sentence task (path helps) or region: <id>.',
    buildRegionListCompact(manifest),
    'No edits until set.',
  ].join(' ');
}

/** Edit attempted with no region assigned. */
export function buildNoRegionEditWarning(manifest) {
  return `NO REGION: describe task or region: <id>. ${buildRegionListCompact(manifest)}`;
}
