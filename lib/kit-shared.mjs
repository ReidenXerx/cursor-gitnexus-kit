import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const KIT_ROOT = path.resolve(__dirname, "..");
export const BUNDLE_ROOT = path.join(KIT_ROOT, "bundle");
export const PLACEHOLDER = "__GITNEXUS_REPO__";

const TEXT_EXTENSIONS = new Set([
  ".mdc",
  ".sh",
  ".mjs",
  ".js",
  ".md",
  ".json",
  ".txt",
  ".yml",
  ".yaml",
  ".gitnexusignore",
]);

/** @param {string} filePath */
export function isTextCandidate(filePath) {
  const base = path.basename(filePath);
  if (
    base === ".gitnexusignore" ||
    base === "hooks.json" ||
    base === "settings.json"
  )
    return true;
  return TEXT_EXTENSIONS.has(path.extname(filePath));
}

/**
 * @param {string} content
 * @param {string} repoName
 */
export function substituteRepoName(content, repoName) {
  return content.split(PLACEHOLDER).join(repoName);
}

/** Paths never copied verbatim — handled by dedicated installers. */
const BUNDLE_SKIP_PREFIXES = ["skills/", ".claude/skills/"];

/**
 * Runtime aliases. A runtime string is a comma-list of adapter ids and/or these
 * aliases; `runtimeIds` expands it to a Set of concrete adapter ids. Keeping this
 * in the (dependency-free) shared module lets both the copy filter and the adapter
 * registry agree on membership without an import cycle.
 */
const RUNTIME_ALIASES = {
  both: ["cursor", "zed"],
  all: ["cursor", "zed", "claude"],
};

/** @param {string} runtime @returns {Set<string>} */
export function runtimeIds(runtime) {
  const ids = new Set();
  for (const tok of String(runtime || "")
    .toLowerCase()
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)) {
    for (const id of RUNTIME_ALIASES[tok] ?? [tok]) ids.add(id);
  }
  return ids;
}

/** @param {string} rel */
export function isBundleSkipped(rel) {
  return BUNDLE_SKIP_PREFIXES.some((p) => rel.startsWith(p));
}

/**
 * @param {string} rel
 * @param {import('./constants.mjs').Runtime} runtime
 */
export function shouldCopyBundleFile(rel, runtime) {
  if (isBundleSkipped(rel)) return false;
  if (rel.startsWith("templates/")) return false;
  // Shared helper modules + policy config ship for every runtime — zed/claude
  // CLIs and hook glue import health/brief/classify utilities from .gnkit/lib.
  if (rel.startsWith(".gnkit/lib/")) return true;
  if (rel === ".gnkit/gitnexus-hooks.json") return true;
  const ids = runtimeIds(runtime);
  if (rel.startsWith(".cursor/")) return ids.has("cursor");
  if (rel.startsWith(".claude/")) return ids.has("claude");
  return true;
}
