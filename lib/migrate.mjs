/**
 * Migrate legacy cursor-gitnexus-kit installs → unified gitnexus-agent-kit layout.
 * Safe to run on every install/update (idempotent).
 */
import fs from "node:fs";
import path from "node:path";
import { BUNDLE_ROOT } from "./kit-shared.mjs";
import {
  MANIFEST_PATH,
  MANIFEST_PATH_LEGACY,
  GITIGNORE_MARKER,
  GITIGNORE_MARKER_LEGACY,
  ZED_PROFILE_KEY,
  SKILLS_STORE,
  parseRuntime,
  wantsCursor,
  wantsZed,
} from "./constants.mjs";
import { listSkillNames } from "./skills.mjs";
/** @typedef {{ actions: string[], legacyManifest: object|null, runtime: import('./constants.mjs').Runtime }} MigrateResult */

/**
 * @param {string} absTarget
 * @param {import('./constants.mjs').Runtime} runtime
 */
export function migrateLegacyInstall(absTarget, runtime) {
  const actions = [];
  const legacyManifest = readAnyManifest(absTarget);
  // Prefer the caller-resolved runtime so update --runtime both can upgrade
  // older cursor-only or zed-only installs instead of being pinned by manifest data.
  const rt = parseRuntime(runtime);

  migrateGitignore(absTarget, actions);
  cleanupLegacySkills(absTarget, rt, actions);
  cleanupLegacyClaudeSkills(absTarget, actions);
  migrateZedProfileKey(absTarget, actions);
  cleanupLegacyManifestFile(absTarget, actions);

  if (legacyManifest?.files?.length) {
    cleanupOrphanKitFiles(absTarget, legacyManifest.files, actions);
  }

  return { actions, legacyManifest, runtime: rt };
}

/** @param {string} absTarget */
function readAnyManifest(absTarget) {
  for (const rel of [MANIFEST_PATH, MANIFEST_PATH_LEGACY]) {
    const p = path.join(absTarget, rel);
    if (!fs.existsSync(p)) continue;
    try {
      return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
      return null;
    }
  }
  return null;
}

/** @param {string} absTarget @param {string[]} actions */
function migrateGitignore(absTarget, actions) {
  const gi = path.join(absTarget, ".gitignore");
  if (!fs.existsSync(gi)) return;
  let text = fs.readFileSync(gi, "utf8");
  if (!text.includes(GITIGNORE_MARKER_LEGACY)) return;
  text = text.split(GITIGNORE_MARKER_LEGACY).join(GITIGNORE_MARKER);
  text = text.replace(
    /\(safe to remove via gn-kit uninstall\)/g,
    "(safe to remove via gn-agent-kit uninstall)",
  );
  fs.writeFileSync(gi, text);
  actions.push("gitignore: migrated legacy kit marker");
}

/**
 * Remove old rsync'd skill trees before symlinking from canonical store.
 * @param {string} absTarget
 * @param {import('./constants.mjs').Runtime} runtime
 * @param {string[]} actions
 */
function cleanupLegacySkills(absTarget, runtime, actions) {
  const canonical = listSkillNames(path.join(BUNDLE_ROOT, "skills"));
  const store = path.join(absTarget, SKILLS_STORE);

  /** @param {string} p */
  function dropSkillPath(p) {
    if (!fs.existsSync(p)) return;
    try {
      if (fs.lstatSync(p).isSymbolicLink()) fs.unlinkSync(p);
      else fs.rmSync(p, { recursive: true, force: true });
      actions.push(
        `skills: removed legacy copy ${path.relative(absTarget, p)}`,
      );
    } catch {
      /* ignore */
    }
  }

  if (wantsCursor(runtime)) {
    const nested = path.join(absTarget, ".cursor/skills/gitnexus");
    if (fs.existsSync(nested)) {
      dropSkillPath(nested);
    }
    for (const name of canonical) {
      dropSkillPath(path.join(absTarget, ".cursor/skills", name));
    }
    dropSkillPath(path.join(absTarget, ".cursor/skills/generated"));
  }

  if (wantsZed(runtime)) {
    for (const name of canonical) {
      dropSkillPath(path.join(absTarget, ".agents/skills", name));
    }
  }

  // If store exists but is an old nested layout, wipe before materialize refreshes it
  const oldNested = path.join(store, "gitnexus");
  if (fs.existsSync(oldNested)) {
    try {
      fs.rmSync(store, { recursive: true, force: true });
      actions.push("skills: cleared legacy nested store layout");
    } catch {
      /* ignore */
    }
  }
}

/** @param {string} absTarget @param {string[]} actions */
function cleanupLegacyClaudeSkills(absTarget, actions) {
  const claudeRoot = path.join(absTarget, ".claude/skills");
  if (!fs.existsSync(claudeRoot)) return;
  const kitNames = new Set([
    "gitnexus",
    "gitnexus-workspace",
    "gitnexus-enforcement",
    ...listSkillNames(path.join(BUNDLE_ROOT, "skills")),
  ]);
  for (const ent of fs.readdirSync(claudeRoot, { withFileTypes: true })) {
    if (!kitNames.has(ent.name)) continue;
    const p = path.join(claudeRoot, ent.name);
    try {
      if (ent.isDirectory()) fs.rmSync(p, { recursive: true, force: true });
      else fs.unlinkSync(p);
      actions.push(`skills: removed legacy .claude/skills/${ent.name}`);
    } catch {
      /* ignore */
    }
  }
  try {
    if (fs.readdirSync(claudeRoot).length === 0) {
      fs.rmdirSync(claudeRoot);
      actions.push("skills: removed empty .claude/skills/");
    }
  } catch {
    /* ignore */
  }
}

/** @param {string} absTarget @param {string[]} actions */
function migrateZedProfileKey(absTarget, actions) {
  const settingsPath = path.join(absTarget, ".zed/settings.json");
  if (!fs.existsSync(settingsPath)) return;
  try {
    const cfg = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    if (
      cfg.agent?.profiles?.gitnexus &&
      !cfg.agent?.profiles?.[ZED_PROFILE_KEY]
    ) {
      cfg.agent.profiles[ZED_PROFILE_KEY] = {
        ...cfg.agent.profiles.gitnexus,
        name: "Zed + GitNexus",
      };
      actions.push("zed: migrated profile gitnexus → zed-gitnexus");
    }
    if (cfg.agent?.profiles?.gitnexus) {
      delete cfg.agent.profiles.gitnexus;
      actions.push('zed: removed legacy profile key "gitnexus"');
    }
    fs.writeFileSync(settingsPath, JSON.stringify(cfg, null, 2) + "\n");
  } catch {
    /* ignore invalid json */
  }
}

/** @param {string} absTarget @param {string[]} actions */
function cleanupLegacyManifestFile(absTarget, actions) {
  const legacy = path.join(absTarget, MANIFEST_PATH_LEGACY);
  const current = path.join(absTarget, MANIFEST_PATH);
  if (fs.existsSync(legacy) && fs.existsSync(current)) {
    try {
      fs.unlinkSync(legacy);
      actions.push("manifest: removed legacy .cursor/gn-kit-manifest.json");
    } catch {
      /* ignore */
    }
  }
}

/**
 * Remove kit files listed in an old manifest that are no longer part of the bundle
 * (e.g. duplicated .claude/skills paths).
 * @param {string} absTarget
 * @param {string[]} legacyFiles
 * @param {string[]} actions
 */
function cleanupOrphanKitFiles(absTarget, legacyFiles, actions) {
  const orphans = [
    ".claude/skills/gitnexus",
    ".claude/skills/gitnexus-workspace",
    ".claude/skills/gitnexus-enforcement",
  ];
  for (const rel of legacyFiles) {
    if (rel.includes(".claude/skills/")) orphans.push(rel);
  }
  for (const rel of [...new Set(orphans)]) {
    const abs = path.join(absTarget, rel);
    if (!fs.existsSync(abs)) continue;
    try {
      fs.rmSync(abs, { recursive: true, force: true });
      actions.push(`orphan: removed ${rel}`);
    } catch {
      /* ignore */
    }
  }
}
