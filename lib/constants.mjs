/** @typedef {'cursor' | 'zed' | 'claude' | 'both' | 'all' | string} Runtime */

export const KIT_NAME = 'gitnexus-agent-kit';

/** Primary manifest (IDE-neutral). */
export const MANIFEST_PATH = '.gitnexus/agent-kit-manifest.json';
/** Legacy Cursor-only manifest — read for migration, removed on update. */
export const MANIFEST_PATH_LEGACY = '.cursor/gn-kit-manifest.json';

export const SKILLS_STORE = '.gnkit/skills';
export const AGENTS_MARKER_BEGIN = '<!-- gitnexus-agent-kit:BEGIN -->';
export const AGENTS_MARKER_END = '<!-- gitnexus-agent-kit:END -->';

/** Adapter ids + aliases. A runtime may also be a comma-list (e.g. "cursor,claude"). */
export const VALID_RUNTIMES = ['cursor', 'zed', 'claude', 'both', 'all'];

/** Zed agent profile — settings key + display name shown in Agent panel. */
export const ZED_PROFILE_KEY = 'zed-gitnexus';
export const ZED_PROFILE_NAME = 'Zed + GitNexus';

export const GITIGNORE_MARKER = '# GitNexus + gitnexus-agent-kit generated local state';
export const GITIGNORE_MARKER_LEGACY = '# GitNexus + cursor-gitnexus-kit generated local state';

/** @param {string} v Comma-list of adapter ids and/or aliases (cursor,zed,claude,both,all). */
export function parseRuntime(v) {
  const r = String(v || 'both').toLowerCase();
  const tokens = r.split(',').map((t) => t.trim()).filter(Boolean);
  const bad = tokens.filter((t) => !VALID_RUNTIMES.includes(/** @type {Runtime} */ (t)));
  if (!tokens.length || bad.length) {
    throw new Error(
      `Invalid runtime "${v}". Use any of: ${VALID_RUNTIMES.join(', ')} (comma-separated allowed).`,
    );
  }
  return /** @type {Runtime} */ (tokens.join(','));
}

/** @param {Runtime} runtime */
export function wantsCursor(runtime) {
  return /(^|,)(cursor|both|all)(,|$)/.test(String(runtime));
}

/** @param {Runtime} runtime */
export function wantsZed(runtime) {
  return /(^|,)(zed|both|all)(,|$)/.test(String(runtime));
}
