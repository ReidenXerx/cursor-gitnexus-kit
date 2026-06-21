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
  // Zed-only installs still need shared helper modules because scripts/gitnexus-agent.mjs
  // imports health/brief/verification utilities from .cursor/hooks/lib.
  if (rel.startsWith(".cursor/hooks/lib/")) return true;
  if (rel === ".cursor/gitnexus-hooks.json") return true;
  if (rel.startsWith(".cursor/")) {
    return runtime === "cursor" || runtime === "both";
  }
  return true;
}
