/**
 * Adapter registry — the single place that knows which IDE adapters exist.
 *
 * The install/uninstall core (lib/kit.mjs) is vendor-agnostic: it resolves the
 * active adapters for a runtime and drives them through the Adapter contract
 * (see ./cursor.mjs). Adding an IDE = add a module + one line here.
 */
import { cursorAdapter } from "./cursor.mjs";
import { zedAdapter } from "./zed.mjs";

/** @type {import('./cursor.mjs').Adapter[]} */
export const ADAPTERS = [cursorAdapter, zedAdapter];

/** @param {import('../constants.mjs').Runtime} runtime */
export function activeAdapters(runtime) {
  return ADAPTERS.filter((a) => a.wants(runtime));
}

/**
 * Skill-store symlink targets for the active runtime (e.g. .cursor/skills, .agents/skills).
 * @param {import('../constants.mjs').Runtime} runtime
 */
export function skillLinkDirs(runtime) {
  return activeAdapters(runtime)
    .map((a) => a.skillLinkDir)
    .filter(Boolean);
}
