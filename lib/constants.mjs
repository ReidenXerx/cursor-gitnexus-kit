/** @typedef {'cursor' | 'zed' | 'both'} Runtime */

export const KIT_NAME = 'gitnexus-agent-kit';

/** Primary manifest (IDE-neutral). */
export const MANIFEST_PATH = '.gitnexus/agent-kit-manifest.json';
/** Legacy Cursor-only manifest — read for migration, removed on update. */
export const MANIFEST_PATH_LEGACY = '.cursor/gn-kit-manifest.json';

export const SKILLS_STORE = '.gitnexus/agent-kit/skills';
export const AGENTS_MARKER_BEGIN = '<!-- gitnexus-agent-kit:BEGIN -->';
export const AGENTS_MARKER_END = '<!-- gitnexus-agent-kit:END -->';

/** @type {Runtime[]} */
export const VALID_RUNTIMES = ['cursor', 'zed', 'both'];

/** Zed agent profile — settings key + display name shown in Agent panel. */
export const ZED_PROFILE_KEY = 'zed-gitnexus';
export const ZED_PROFILE_NAME = 'Zed + GitNexus';

export const GITIGNORE_MARKER = '# GitNexus + gitnexus-agent-kit generated local state';
export const GITIGNORE_MARKER_LEGACY = '# GitNexus + cursor-gitnexus-kit generated local state';

/** @param {string} v */
export function parseRuntime(v) {
  const r = String(v || 'both').toLowerCase();
  if (!VALID_RUNTIMES.includes(/** @type {Runtime} */ (r))) {
    throw new Error(`Invalid runtime "${v}". Use: cursor, zed, or both`);
  }
  return /** @type {Runtime} */ (r);
}

/** @param {Runtime} runtime */
export function wantsCursor(runtime) {
  return runtime === 'cursor' || runtime === 'both';
}

/** @param {Runtime} runtime */
export function wantsZed(runtime) {
  return runtime === 'zed' || runtime === 'both';
}
