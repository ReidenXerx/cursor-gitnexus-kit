#!/usr/bin/env node
/**
 * gitnexus-agent-kit — install / update / uninstall core
 * Supports Cursor, Zed (+ Ollama), or both via --runtime.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import {
  KIT_ROOT,
  BUNDLE_ROOT,
  PLACEHOLDER,
  isTextCandidate,
  substituteRepoName,
  shouldCopyBundleFile,
} from "./kit-shared.mjs";
import {
  KIT_NAME,
  MANIFEST_PATH,
  MANIFEST_PATH_LEGACY,
  GITIGNORE_MARKER,
  parseRuntime,
  wantsCursor,
  wantsZed,
  ZED_PROFILE_NAME,
  ZED_PROFILE_KEY,
} from "./constants.mjs";
import { migrateLegacyInstall } from "./migrate.mjs";
import {
  materializeSkillsStore,
  linkSkillsForRuntime,
  unlinkSkillLinks,
} from "./skills.mjs";
import {
  mergeZedSettings,
  mergeAgentsMd,
  removeAgentsMdBlock,
  removeZedSettings,
} from "./zed.mjs";
import {
  flatGitnexusScripts,
  allManagedScriptKeys,
  mergeIntoPackageJson,
} from "../bundle/scripts/gitnexus-teaching/script-gates.mjs";
import {
  banner,
  step,
  ok,
  warn,
  nextSteps,
  summaryTable,
} from "../bundle/scripts/lib/setup-ui.mjs";

export {
  KIT_ROOT,
  BUNDLE_ROOT,
  PLACEHOLDER,
  substituteRepoName,
  isTextCandidate,
};

export const GITNEXUS_NPM_SCRIPTS = flatGitnexusScripts();

export { GITIGNORE_MARKER };

const GITIGNORE_SNIPPET = `
${GITIGNORE_MARKER} (safe to remove via gn-agent-kit uninstall)
.gitnexus/
.tmp-agent/
.gitnexus/agent-kit/
.cursor/skills/
.agents/skills/
.cursor/gitnexus-teaching-bundle.json
.cursor/gn-kit-manifest.json
.gitnexus/agent-kit-manifest.json
.cursor/.gitnexus-session-edits.flag
.cursor/.gitnexus-session-primed.flag
.cursor/.gitnexus-prompt-hint.json
.cursor/.gitnexus-refresh-pending.flag
.cursor/.gitnexus-refresh-failed.flag
.cursor/.gitnexus-mcp-used.flag
.cursor/.gitnexus-impact-used.flag
.cursor/.gitnexus-detect-used.flag
.cursor/.gitnexus-staleness-cache.json
.cursor/.gitnexus-scorecard.json
.cursor/.gitnexus-deny-cache.json
.cursor/.gitnexus-session-health.json
.cursor/.gitnexus-session-user-notified.flag
.cursor/gitnexus-api-profile.json
`;

/** @returns {string[]} */
export function listBundleFiles() {
  const files = [];
  function walk(dir, prefix = "") {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(abs, rel);
      else files.push(rel);
    }
  }
  walk(BUNDLE_ROOT);
  return files.sort();
}

/** @param {string} targetRoot */
export function assertGitRepo(targetRoot) {
  const r = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: targetRoot,
    encoding: "utf8",
  });
  if (r.status !== 0 || r.stdout.trim() !== "true") {
    throw new Error(`Not a git repository: ${targetRoot}`);
  }
}

/**
 * @param {string} src
 * @param {string} dest
 * @param {string} repoName
 */
function copyBundleFile(src, dest, repoName) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (isTextCandidate(src)) {
    fs.writeFileSync(
      dest,
      substituteRepoName(fs.readFileSync(src, "utf8"), repoName),
    );
  } else {
    fs.copyFileSync(src, dest);
  }
}

/** @param {string} targetRoot */
function backupIfExists(targetRoot, rel, backupRel) {
  const src = path.join(targetRoot, rel);
  const bak = path.join(targetRoot, backupRel);
  if (!fs.existsSync(src)) return null;
  fs.mkdirSync(path.dirname(bak), { recursive: true });
  fs.copyFileSync(src, bak);
  return backupRel;
}

/** @param {string} absTarget @param {import('./constants.mjs').Runtime} runtime */
export function mergeMcpJson(absTarget, runtime) {
  if (!wantsCursor(runtime)) return;
  const mcpPath = path.join(absTarget, ".cursor/mcp.json");
  const entry = { command: "npx", args: ["-y", "gitnexus@latest", "mcp"] };
  let cfg = { mcpServers: {} };
  if (fs.existsSync(mcpPath)) {
    cfg = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
  }
  cfg.mcpServers ??= {};
  cfg.mcpServers.gitnexus = entry;
  fs.mkdirSync(path.dirname(mcpPath), { recursive: true });
  fs.writeFileSync(mcpPath, JSON.stringify(cfg, null, 2) + "\n");
}

/** @param {string} targetRoot @param {string} [repoName] */
export function mergePackageScripts(targetRoot, repoName) {
  const name = repoName ?? path.basename(targetRoot);
  return mergeIntoPackageJson(path.join(targetRoot, "package.json"), {
    createIfMissing: true,
    repoName: name,
  });
}

/** @param {string} targetRoot */
export function appendGitignore(targetRoot) {
  const gi = path.join(targetRoot, ".gitignore");
  const existing = fs.existsSync(gi) ? fs.readFileSync(gi, "utf8") : "";
  if (existing.includes(GITIGNORE_MARKER)) return [];
  fs.appendFileSync(gi, GITIGNORE_SNIPPET);
  return GITIGNORE_SNIPPET.trim().split("\n").filter(Boolean);
}

/** @param {string} targetRoot */
export function removeGitignoreSnippet(targetRoot) {
  const gi = path.join(targetRoot, ".gitignore");
  if (!fs.existsSync(gi)) return;
  const lines = fs.readFileSync(gi, "utf8").split("\n");
  const out = [];
  let skipping = false;
  for (const line of lines) {
    if (line.includes(GITIGNORE_MARKER)) {
      skipping = true;
      continue;
    }
    if (skipping) {
      if (
        line.trim() === "" &&
        out.length > 0 &&
        out[out.length - 1]?.trim() === ""
      ) {
        skipping = false;
      }
      continue;
    }
    out.push(line);
  }
  fs.writeFileSync(gi, out.join("\n").replace(/\n+$/, "\n"));
}

/** @param {string} targetRoot */
export function removePackageScripts(targetRoot) {
  const pkgPath = path.join(targetRoot, "package.json");
  if (!fs.existsSync(pkgPath)) return;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  if (!pkg.scripts) return;
  for (const key of allManagedScriptKeys()) {
    delete pkg.scripts[key];
  }
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
}

/** @param {string} absTarget */
export function readManifest(absTarget) {
  for (const rel of [MANIFEST_PATH, MANIFEST_PATH_LEGACY]) {
    const p = path.join(absTarget, rel);
    if (fs.existsSync(p)) {
      const m = JSON.parse(fs.readFileSync(p, "utf8"));
      if (!m.runtime) m.runtime = "cursor";
      return { path: rel, data: m };
    }
  }
  return null;
}

/**
 * @param {string} targetRoot
 * @param {{ repoName?: string, quick?: boolean, runSetup?: boolean, runtime?: import('./constants.mjs').Runtime, update?: boolean, skipVerify?: boolean }} opts
 */
export function installKit(targetRoot, opts = {}) {
  const absTarget = path.resolve(targetRoot);
  const mode = opts.update ? "update" : "install";

  banner(`${KIT_NAME} ${mode}`, absTarget);

  step(1, 7, "Validate target repository");
  assertGitRepo(absTarget);
  ok("Git worktree OK");

  const inferredRuntime = parseRuntime(
    opts.runtime ?? readManifest(absTarget)?.data.runtime ?? "both",
  );

  step(2, 7, "Migrate legacy install (if any)");
  const migration = migrateLegacyInstall(absTarget, inferredRuntime);
  if (migration.actions.length) {
    for (const a of migration.actions.slice(0, 8)) ok(a);
    if (migration.actions.length > 8) {
      ok(`… and ${migration.actions.length - 8} more cleanup steps`);
    }
  } else {
    ok("No legacy artifacts — clean install path");
  }

  const runtime = migration.runtime;
  const repoName =
    opts.repoName ??
    migration.legacyManifest?.repoName ??
    readManifest(absTarget)?.data.repoName ??
    path.basename(absTarget);
  const kitPkg = JSON.parse(
    fs.readFileSync(path.join(KIT_ROOT, "package.json"), "utf8"),
  );

  step(3, 7, `Copy bundle (runtime: ${runtime})`);
  const backups = {};
  if (wantsCursor(runtime)) {
    const b1 = backupIfExists(
      absTarget,
      ".cursor/hooks.json",
      ".cursor/hooks.json.gn-kit.bak",
    );
    if (b1) backups["hooks.json"] = b1;
    const b2 = backupIfExists(
      absTarget,
      ".cursor/mcp.json",
      ".cursor/mcp.json.gn-kit.bak",
    );
    if (b2) backups["mcp.json"] = b2;
  }

  const files = [];
  for (const rel of listBundleFiles()) {
    if (!shouldCopyBundleFile(rel, runtime)) continue;
    copyBundleFile(
      path.join(BUNDLE_ROOT, rel),
      path.join(absTarget, rel),
      repoName,
    );
    files.push(rel);
  }
  ok(`${files.length} bundle files → ${repoName}`);

  step(4, 7, "Install skills (canonical store + symlinks)");
  const skillNames = materializeSkillsStore(absTarget, repoName);
  linkSkillsForRuntime(absTarget, runtime);
  ok(
    `${skillNames.length} skills → .gitnexus/agent-kit/skills/ (+ IDE symlinks)`,
  );

  step(5, 7, "Wire MCP, npm gates, IDE config");
  mergeMcpJson(absTarget, runtime);
  if (wantsZed(runtime)) {
    mergeZedSettings(absTarget);
    mergeAgentsMd(absTarget, repoName);
    ok("Zed: .zed/settings.json + AGENTS.md");
  }
  const scriptStats = mergePackageScripts(absTarget, repoName);
  appendGitignore(absTarget);
  ok(
    `package.json: ${scriptStats.added} added, ${scriptStats.updated} updated (${scriptStats.total} gitnexus entries)`,
  );
  if (wantsCursor(runtime)) ok("Cursor: MCP + hooks bundle");

  step(6, 7, "Write manifest & chmod hooks");
  const manifest = {
    kit: KIT_NAME,
    kitVersion: kitPkg.version,
    installedAt: new Date().toISOString(),
    repoName,
    runtime,
    files,
    skills: skillNames,
    npmScripts: allManagedScriptKeys(),
    gitignoreMarker: GITIGNORE_MARKER,
    backups,
    mcpManaged: wantsCursor(runtime),
    zedManaged: wantsZed(runtime),
  };

  try {
    fs.unlinkSync(path.join(absTarget, MANIFEST_PATH_LEGACY));
  } catch {
    /* migrate away from legacy path */
  }

  const manifestPath = path.join(absTarget, MANIFEST_PATH);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  chmodScripts(absTarget);
  ok(`Manifest v${kitPkg.version} (${runtime})`);

  if (opts.runSetup !== false) {
    step(7, 7, "Run gitnexus-setup.sh (index + sync)");
    const setupFlags = ["--skip-global-mcp"];
    if (opts.quick) setupFlags.push("--quick");
    if (wantsZed(runtime) && !wantsCursor(runtime))
      setupFlags.push("--runtime", "zed");
    const r = spawnSync("bash", ["scripts/gitnexus-setup.sh", ...setupFlags], {
      cwd: absTarget,
      stdio: "inherit",
      env: {
        ...process.env,
        GITNEXUS_REPO_NAME: repoName,
        GITNEXUS_RUNTIME: runtime,
      },
    });
    if (r.status !== 0) {
      throw new Error(`gitnexus-setup.sh failed with exit ${r.status}`);
    }
  } else {
    step(7, 7, "Skip setup (--no-setup)");
    warn("Run npm run gitnexus:setup in the target repo");
  }

  if (opts.runSetup !== false && !opts.skipVerify) {
    runVerify(absTarget, runtime);
  }

  printInstallComplete(absTarget, repoName, mode, runtime, {
    quick: opts.quick,
    setupSkipped: opts.runSetup === false,
  });
  return manifest;
}

/** @param {string} absTarget @param {import('./constants.mjs').Runtime} runtime */
function runVerify(absTarget, runtime) {
  console.log("");
  const verifyScript = path.join(absTarget, "scripts/gitnexus-verify.mjs");
  const fallback = path.join(absTarget, ".cursor/hooks/lib/verify-kit.mjs");
  const script = fs.existsSync(verifyScript) ? verifyScript : fallback;
  const r = spawnSync(process.execPath, [script, absTarget], {
    cwd: absTarget,
    stdio: "inherit",
  });
  if (r.status !== 0) {
    warn(
      "Verification reported issues — run npm run gitnexus:verify after fixing",
    );
  }
}

/** @param {string} absTarget @param {string} repoName @param {string} mode @param {import('./constants.mjs').Runtime} runtime @param {{ quick?: boolean, setupSkipped?: boolean }} indexState */
function printInstallComplete(
  absTarget,
  repoName,
  mode,
  runtime,
  indexState = {},
) {
  const indexValue = indexState.setupSkipped
    ? "not changed (--no-setup)"
    : indexState.quick
      ? "skipped (--quick)"
      : "built";
  const indexStatus =
    indexState.setupSkipped || indexState.quick ? "warn" : "ok";
  summaryTable({
    title: `${mode === "update" ? "Update" : "Install"} complete`,
    rows: [
      { label: "Repository", value: repoName, status: "ok" },
      { label: "Runtime", value: runtime, status: "ok" },
      { label: "Path", value: absTarget, status: "info" },
      {
        label: "Index",
        value: indexValue,
        status: indexStatus,
      },
    ],
  });

  const steps = [
    "npm run gitnexus:verify — full kit check",
    "npm run gitnexus:health — human-friendly status",
  ];
  if (wantsCursor(runtime)) {
    steps.unshift(
      "Restart Cursor on this project (MCP + hooks load on restart)",
    );
    steps.push("Open a new Agent chat");
  }
  if (wantsZed(runtime)) {
    steps.unshift(
      "Restart Zed / reopen project (trust worktree for .agents/skills/)",
    );
    steps.push(`Agent panel → select profile **${ZED_PROFILE_NAME}**`);
    steps.push(
      "For Ollama: pick a model with supports_tools in .zed/settings.json",
    );
  }
  steps.push(
    "npm run gitnexus.__gate.1.session — agent gate docs in package.json",
  );
  nextSteps(steps);
}

/** @param {string} targetRoot */
function chmodScripts(targetRoot) {
  function chmodSh(dir) {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) chmodSh(abs);
      else if (ent.name.endsWith(".sh")) {
        try {
          fs.chmodSync(abs, 0o755);
        } catch {
          /* ignore */
        }
      }
    }
  }
  for (const dir of ["scripts", ".cursor/hooks", ".githooks"]) {
    chmodSh(path.join(targetRoot, dir));
  }
}

/** @param {string} targetRoot */
export function updateKit(targetRoot, opts = {}) {
  const absTarget = path.resolve(targetRoot);
  const prev = readManifest(absTarget);
  if (!prev) {
    throw new Error(
      `Not installed (missing ${MANIFEST_PATH}). Run install first.`,
    );
  }
  return installKit(absTarget, {
    repoName: opts.repoName ?? prev.data.repoName,
    runtime: opts.runtime ?? prev.data.runtime,
    quick: opts.quick ?? true,
    runSetup: opts.runSetup !== false,
    update: true,
    skipVerify: opts.skipVerify,
  });
}

/** @param {string} searchRoot */
export function findInstalledRepos(searchRoot) {
  const root = path.resolve(searchRoot);
  const found = [];
  function walk(dir, depth = 0) {
    if (depth > 5) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (fs.existsSync(path.join(dir, MANIFEST_PATH))) {
      found.push(dir);
      return;
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (
        ent.name === "node_modules" ||
        ent.name === ".git" ||
        ent.name === ".gitnexus"
      )
        continue;
      if (ent.name.startsWith(".") && ent.name !== ".worktrees") continue;
      walk(path.join(dir, ent.name), depth + 1);
    }
  }
  walk(root);
  return found.sort();
}

export function updateAllInstalled(searchRoot, opts = {}) {
  const repos = findInstalledRepos(searchRoot);
  if (!repos.length) {
    warn(
      `No installed ${KIT_NAME} repos found under ${path.resolve(searchRoot)}`,
    );
    return [];
  }
  const results = [];
  for (const repo of repos) {
    try {
      const manifest = updateKit(repo, opts);
      results.push({ repo, ok: true, runtime: manifest.runtime });
    } catch (err) {
      results.push({ repo, ok: false, error: err.message || String(err) });
      warn(`${repo}: ${err.message || err}`);
    }
  }
  summaryTable({
    title: `Updated ${results.filter((r) => r.ok).length}/${results.length} installed repos`,
    rows: results.map((r) => ({
      label: path.basename(r.repo),
      value: r.ok ? r.runtime : r.error,
      status: r.ok ? "ok" : "fail",
    })),
  });
  return results;
}

/** @param {string} targetRoot */
export function uninstallKit(targetRoot, opts = {}) {
  const absTarget = path.resolve(targetRoot);
  const prev = readManifest(absTarget);
  if (!prev) {
    throw new Error(`Not installed (missing ${MANIFEST_PATH})`);
  }
  const manifest = prev.data;
  const runtime = parseRuntime(manifest.runtime ?? "cursor");

  for (const rel of manifest.files ?? []) {
    const abs = path.join(absTarget, rel);
    try {
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
    } catch {
      /* ignore */
    }
    pruneEmptyDirs(path.dirname(abs), absTarget);
  }

  unlinkSkillLinks(absTarget, runtime);
  try {
    fs.rmSync(path.join(absTarget, ".gitnexus/agent-kit"), {
      recursive: true,
      force: true,
    });
  } catch {
    /* ignore */
  }

  removePackageScripts(absTarget);
  removeGitignoreSnippet(absTarget);

  if (wantsCursor(runtime)) {
    if (manifest.backups?.["hooks.json"]) {
      restoreBackup(
        absTarget,
        manifest.backups["hooks.json"],
        ".cursor/hooks.json",
      );
    } else {
      try {
        fs.unlinkSync(path.join(absTarget, ".cursor/hooks.json"));
      } catch {
        /* ignore */
      }
    }
    if (manifest.mcpManaged) {
      removeGitnexusMcp(absTarget, manifest.backups?.["mcp.json"]);
    }
  }

  if (wantsZed(runtime)) {
    removeZedSettings(absTarget);
    removeAgentsMdBlock(absTarget);
  }

  for (const p of [
    MANIFEST_PATH,
    MANIFEST_PATH_LEGACY,
    ".cursor/gitnexus-teaching-bundle.json",
    ".cursor/hooks.json.gn-kit.bak",
    ".cursor/mcp.json.gn-kit.bak",
  ]) {
    try {
      fs.unlinkSync(path.join(absTarget, p));
    } catch {
      /* ignore */
    }
  }

  if (opts.removeIndex) {
    rmRf(path.join(absTarget, ".gitnexus"));
    rmRf(path.join(absTarget, ".tmp-agent"));
  }

  pruneEmptyDirs(path.join(absTarget, ".cursor"), absTarget);
  pruneEmptyDirs(path.join(absTarget, ".agents"), absTarget);
  pruneEmptyDirs(path.join(absTarget, ".zed"), absTarget);
}

function restoreBackup(targetRoot, backupRel, destRel) {
  const bak = path.join(targetRoot, backupRel);
  const dest = path.join(targetRoot, destRel);
  if (fs.existsSync(bak)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(bak, dest);
    fs.unlinkSync(bak);
  }
}

/** @param {string} targetRoot */
function removeGitnexusMcp(targetRoot, mcpBackupRel) {
  const mcpPath = path.join(targetRoot, ".cursor/mcp.json");
  if (mcpBackupRel) {
    restoreBackup(targetRoot, mcpBackupRel, ".cursor/mcp.json");
    return;
  }
  if (!fs.existsSync(mcpPath)) return;
  const cfg = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
  if (cfg.mcpServers?.gitnexus) {
    delete cfg.mcpServers.gitnexus;
    if (Object.keys(cfg.mcpServers).length === 0) {
      try {
        fs.unlinkSync(mcpPath);
      } catch {
        /* ignore */
      }
    } else {
      fs.writeFileSync(mcpPath, JSON.stringify(cfg, null, 2) + "\n");
    }
  }
}

function pruneEmptyDirs(dir, stopAt) {
  let cur = dir;
  while (cur.startsWith(stopAt) && cur !== stopAt) {
    try {
      if (fs.readdirSync(cur).length === 0) fs.rmdirSync(cur);
      else break;
    } catch {
      break;
    }
    cur = path.dirname(cur);
  }
}

function rmRf(p) {
  if (!fs.existsSync(p)) return;
  fs.rmSync(p, { recursive: true, force: true });
}

export function cliMain(argv) {
  const [cmd, target, ...rest] = argv;
  const flags = new Set(rest.filter((a) => a.startsWith("--")));
  const repoIdx = rest.indexOf("--repo-name");
  const runtimeIdx = rest.indexOf("--runtime");
  const repoName =
    repoIdx >= 0 ? rest[repoIdx + 1] : process.env.GITNEXUS_REPO_NAME;
  const runtime =
    runtimeIdx >= 0 ? rest[runtimeIdx + 1] : process.env.GITNEXUS_RUNTIME;
  const fullIndex = flags.has("--full");
  const quick = cmd === "update" ? !fullIndex : flags.has("--quick");
  const noSetup = flags.has("--no-setup");
  const skipVerify = flags.has("--skip-verify");
  const removeIndex = flags.has("--remove-index");
  const interactive =
    flags.has("--interactive") || (!target && cmd === "install");

  if (!cmd || cmd === "--help" || cmd === "-h") {
    console.log(`Usage:
  node lib/kit.mjs install <target-repo> [--runtime cursor|zed|both] [--repo-name NAME] [--quick] [--no-setup] [--skip-verify]
  node lib/kit.mjs install --interactive
  node lib/kit.mjs update <target-repo> [--runtime cursor|zed|both] [--full] [--no-setup] [--skip-verify]
  node lib/kit.mjs update-all <search-root> [--runtime cursor|zed|both] [--no-setup] [--skip-verify]
  node lib/kit.mjs uninstall <target-repo> [--remove-index]

  Runtime: cursor (hooks), zed (MCP + skills + profile), both (default)
  update defaults to --quick (bundle + skills, skip index). Pass --full to rebuild .gitnexus/
  update-all scans for .gitnexus/agent-kit-manifest.json under the search root.`);
    process.exit(cmd ? 0 : 2);
  }

  if (interactive && cmd === "install") {
    spawnSync(process.execPath, [path.join(KIT_ROOT, "lib/interactive.mjs")], {
      stdio: "inherit",
    });
    return;
  }

  if (!target) {
    console.error(
      "Missing target repo path. Use: install <path> or install --interactive",
    );
    process.exit(2);
  }

  const opts = {
    repoName,
    runtime: runtime ? parseRuntime(runtime) : undefined,
    quick,
    runSetup: !noSetup,
    removeIndex,
    skipVerify,
  };

  if (cmd === "install") {
    installKit(target, opts);
    return;
  }
  if (cmd === "update") {
    updateKit(target, opts);
    return;
  }
  if (cmd === "update-all") {
    updateAllInstalled(target, opts);
    return;
  }
  if (cmd === "uninstall") {
    uninstallKit(target, opts);
    console.log(`Uninstalled ${KIT_NAME} from ${path.resolve(target)}`);
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  process.exit(2);
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  cliMain(process.argv.slice(2));
}
