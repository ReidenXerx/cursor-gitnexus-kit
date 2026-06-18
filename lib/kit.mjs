#!/usr/bin/env node
/**
 * cursor-gitnexus-kit — install / update / uninstall core
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const KIT_ROOT = path.resolve(__dirname, '..');
export const BUNDLE_ROOT = path.join(KIT_ROOT, 'bundle');
export const MANIFEST_NAME = '.cursor/gn-kit-manifest.json';
export const PLACEHOLDER = '__GITNEXUS_REPO__';

import {
  flatGitnexusScripts,
  allManagedScriptKeys,
  mergeIntoPackageJson,
} from '../bundle/scripts/gitnexus-teaching/script-gates.mjs';
import { banner, step, ok, warn, nextSteps, summaryTable } from '../bundle/scripts/lib/setup-ui.mjs';

export const GITNEXUS_NPM_SCRIPTS = flatGitnexusScripts();

export const GITIGNORE_MARKER = '# GitNexus + cursor-gitnexus-kit generated local state';

const GITIGNORE_SNIPPET = `
${GITIGNORE_MARKER} (safe to remove via gn-kit uninstall)
.gitnexus/
.tmp-agent/
.cursor/skills/
.cursor/gitnexus-teaching-bundle.json
.cursor/gn-kit-manifest.json
.cursor/.gitnexus-session-edits.flag
.cursor/.gitnexus-session-primed.flag
.cursor/.gitnexus-prompt-hint.json
.cursor/.gitnexus-refresh-pending.flag
.cursor/.gitnexus-mcp-used.flag
.cursor/.gitnexus-deny-cache.json
.cursor/.gitnexus-session-health.json
.cursor/.gitnexus-session-user-notified.flag
.cursor/gitnexus-api-profile.json
`;

const TEXT_EXTENSIONS = new Set([
  '.mdc', '.sh', '.mjs', '.js', '.md', '.json', '.txt', '.yml', '.yaml', '.gitnexusignore',
]);

/** @returns {string[]} */
export function listBundleFiles() {
  const files = [];
  function walk(dir, prefix = '') {
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
  const r = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: targetRoot,
    encoding: 'utf8',
  });
  if (r.status !== 0 || r.stdout.trim() !== 'true') {
    throw new Error(`Not a git repository: ${targetRoot}`);
  }
}

/** @param {string} filePath */
function isTextCandidate(filePath) {
  const base = path.basename(filePath);
  if (base === '.gitnexusignore' || base === 'hooks.json' || base === 'settings.json') return true;
  return TEXT_EXTENSIONS.has(path.extname(filePath));
}

/**
 * @param {string} content
 * @param {string} repoName
 */
export function substituteRepoName(content, repoName) {
  return content.split(PLACEHOLDER).join(repoName);
}

/**
 * @param {string} src
 * @param {string} dest
 * @param {string} repoName
 */
function copyBundleFile(src, dest, repoName) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (isTextCandidate(src)) {
    const text = fs.readFileSync(src, 'utf8');
    fs.writeFileSync(dest, substituteRepoName(text, repoName));
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

/** @param {string} targetRoot */
export function mergeMcpJson(targetRoot) {
  const mcpPath = path.join(targetRoot, '.cursor/mcp.json');
  const entry = { command: 'npx', args: ['-y', 'gitnexus@latest', 'mcp'] };
  let cfg = { mcpServers: {} };
  if (fs.existsSync(mcpPath)) {
    cfg = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
  }
  cfg.mcpServers ??= {};
  cfg.mcpServers.gitnexus = entry;
  fs.mkdirSync(path.dirname(mcpPath), { recursive: true });
  fs.writeFileSync(mcpPath, JSON.stringify(cfg, null, 2) + '\n');
}

/** @param {string} targetRoot @param {string} [repoName] */
export function mergePackageScripts(targetRoot, repoName) {
  const name = repoName ?? path.basename(targetRoot);
  return mergeIntoPackageJson(path.join(targetRoot, 'package.json'), {
    createIfMissing: true,
    repoName: name,
  });
}

/** @param {string} targetRoot */
export function appendGitignore(targetRoot) {
  const gi = path.join(targetRoot, '.gitignore');
  const existing = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
  if (existing.includes(GITIGNORE_MARKER)) return [];
  fs.appendFileSync(gi, GITIGNORE_SNIPPET);
  return GITIGNORE_SNIPPET.trim().split('\n').filter(Boolean);
}

/** @param {string} targetRoot */
export function removeGitignoreSnippet(targetRoot) {
  const gi = path.join(targetRoot, '.gitignore');
  if (!fs.existsSync(gi)) return;
  const lines = fs.readFileSync(gi, 'utf8').split('\n');
  const out = [];
  let skipping = false;
  for (const line of lines) {
    if (line.includes(GITIGNORE_MARKER)) {
      skipping = true;
      continue;
    }
    if (skipping) {
      if (line.trim() === '' && out.length > 0 && out[out.length - 1]?.trim() === '') {
        skipping = false;
      }
      continue;
    }
    out.push(line);
  }
  fs.writeFileSync(gi, out.join('\n').replace(/\n+$/, '\n'));
}

/** @param {string} targetRoot */
export function removePackageScripts(targetRoot) {
  const pkgPath = path.join(targetRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) return;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (!pkg.scripts) return;
  for (const key of allManagedScriptKeys()) {
    delete pkg.scripts[key];
  }
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

/**
 * @param {string} targetRoot
 * @param {{ repoName?: string, quick?: boolean, runSetup?: boolean }} opts
 */
export function installKit(targetRoot, opts = {}) {
  const absTarget = path.resolve(targetRoot);
  const mode = opts.update ? 'update' : 'install';
  banner(
    `cursor-gitnexus-kit ${mode}`,
    absTarget
  );

  step(1, 5, 'Validate target repository');
  assertGitRepo(absTarget);
  ok('Git worktree OK');

  const repoName = opts.repoName ?? path.basename(absTarget);
  const kitPkg = JSON.parse(fs.readFileSync(path.join(KIT_ROOT, 'package.json'), 'utf8'));

  step(2, 5, 'Copy teaching bundle (rules, hooks, skills, scripts)');
  const backups = {};
  const b1 = backupIfExists(absTarget, '.cursor/hooks.json', '.cursor/hooks.json.gn-kit.bak');
  if (b1) backups['hooks.json'] = b1;
  const b2 = backupIfExists(absTarget, '.cursor/mcp.json', '.cursor/mcp.json.gn-kit.bak');
  if (b2) backups['mcp.json'] = b2;

  const files = listBundleFiles();
  for (const rel of files) {
    copyBundleFile(path.join(BUNDLE_ROOT, rel), path.join(absTarget, rel), repoName);
  }
  ok(`${files.length} bundle files → ${repoName}`);

  step(3, 5, 'Merge MCP, gated npm scripts, gitignore');
  mergeMcpJson(absTarget);
  const scriptStats = mergePackageScripts(absTarget, repoName);
  appendGitignore(absTarget);
  ok(`package.json: ${scriptStats.added} added, ${scriptStats.updated} updated (${scriptStats.total} gitnexus entries)`);
  ok('MCP + gitignore');

  step(4, 5, 'Write manifest & chmod hooks');
  const manifest = {
    kit: 'cursor-gitnexus-kit',
    kitVersion: kitPkg.version,
    installedAt: new Date().toISOString(),
    repoName,
    files,
    npmScripts: allManagedScriptKeys(),
    gitignoreMarker: GITIGNORE_MARKER,
    backups,
    mcpManaged: true,
  };

  const manifestPath = path.join(absTarget, MANIFEST_NAME);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  chmodScripts(absTarget);
  ok(`Manifest v${kitPkg.version}`);

  if (opts.runSetup !== false) {
    step(5, 5, 'Run gitnexus-setup.sh (index, sync, hooks)');
    const setupFlags = ['--skip-global-mcp'];
    if (opts.quick) setupFlags.push('--quick');
    const r = spawnSync('bash', ['scripts/gitnexus-setup.sh', ...setupFlags], {
      cwd: absTarget,
      stdio: 'inherit',
      env: { ...process.env, GITNEXUS_REPO_NAME: repoName },
    });
    if (r.status !== 0) {
      throw new Error(`gitnexus-setup.sh failed with exit ${r.status}`);
    }
  } else {
    step(5, 5, 'Skip setup (--no-setup)');
    warn('Run npm run gitnexus:setup in the target repo');
  }

  if (opts.runSetup !== false && !opts.skipVerify) {
    runVerify(absTarget);
  }

  printInstallComplete(absTarget, repoName, mode, opts.quick);
  return manifest;
}

/** @param {string} absTarget */
function runVerify(absTarget) {
  console.log('');
  const r = spawnSync(
    process.execPath,
    [path.join(absTarget, '.cursor/hooks/lib/verify-kit.mjs'), absTarget],
    { cwd: absTarget, stdio: 'inherit' }
  );
  if (r.status !== 0) {
    warn('Verification reported issues — run npm run gitnexus:verify after fixing');
  }
}

/** @param {string} absTarget @param {string} repoName @param {string} mode @param {boolean} [quick] */
function printInstallComplete(absTarget, repoName, mode, quick) {
  summaryTable({
    title: `${mode === 'update' ? 'Update' : 'Install'} complete`,
    rows: [
      { label: 'Repository', value: repoName, status: 'ok' },
      { label: 'Path', value: absTarget, status: 'info' },
      { label: 'Index', value: quick ? 'skipped (--quick)' : 'built', status: quick ? 'warn' : 'ok' },
    ],
  });
  nextSteps([
    'Restart Cursor on this project',
    'npm run gitnexus:verify — full kit check',
    'npm run gitnexus:health — human-friendly status',
    'npm run gitnexus.__gate.1.session — agent gate docs in package.json',
    'Open a new Agent chat',
  ]);
}

/** @param {string} targetRoot */
function chmodScripts(targetRoot) {
  function chmodSh(dir) {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) chmodSh(abs);
      else if (ent.name.endsWith('.sh')) {
        try {
          fs.chmodSync(abs, 0o755);
        } catch {
          /* ignore */
        }
      }
    }
  }
  for (const dir of ['scripts', '.cursor/hooks']) {
    chmodSh(path.join(targetRoot, dir));
  }
  for (const f of ['scripts/gitnexus-gate-hint.mjs']) {
    const abs = path.join(targetRoot, f);
    if (fs.existsSync(abs)) {
      try {
        fs.chmodSync(abs, 0o755);
      } catch {
        /* ignore */
      }
    }
  }
}

/** @param {string} targetRoot */
export function updateKit(targetRoot, opts = {}) {
  const absTarget = path.resolve(targetRoot);
  const manifestPath = path.join(absTarget, MANIFEST_NAME);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Not installed (missing ${MANIFEST_NAME}). Run install first.`);
  }
  const prev = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return installKit(absTarget, {
    repoName: opts.repoName ?? prev.repoName,
    quick: opts.quick ?? true,
    runSetup: opts.runSetup !== false,
    update: true,
    skipVerify: opts.skipVerify,
  });
}

/** @param {string} targetRoot */
export function uninstallKit(targetRoot, opts = {}) {
  const absTarget = path.resolve(targetRoot);
  const manifestPath = path.join(absTarget, MANIFEST_NAME);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Not installed (missing ${MANIFEST_NAME})`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  for (const rel of manifest.files ?? []) {
    const abs = path.join(absTarget, rel);
    try {
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
    } catch {
      /* ignore */
    }
    pruneEmptyDirs(path.dirname(abs), absTarget);
  }

  removePackageScripts(absTarget);
  removeGitignoreSnippet(absTarget);

  if (manifest.backups?.['hooks.json']) {
    restoreBackup(absTarget, manifest.backups['hooks.json'], '.cursor/hooks.json');
  } else {
    try {
      fs.unlinkSync(path.join(absTarget, '.cursor/hooks.json'));
    } catch {
      /* ignore */
    }
  }

  if (manifest.mcpManaged) {
    removeGitnexusMcp(absTarget, manifest.backups?.['mcp.json']);
  }

  for (const p of [
    MANIFEST_NAME,
    '.cursor/gitnexus-teaching-bundle.json',
    '.cursor/hooks.json.gn-kit.bak',
    '.cursor/mcp.json.gn-kit.bak',
  ]) {
    try {
      fs.unlinkSync(path.join(absTarget, p));
    } catch {
      /* ignore */
    }
  }

  if (opts.removeIndex) {
    rmRf(path.join(absTarget, '.gitnexus'));
    rmRf(path.join(absTarget, '.tmp-agent'));
  }

  pruneEmptyDirs(path.join(absTarget, '.cursor'), absTarget);
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
  const mcpPath = path.join(targetRoot, '.cursor/mcp.json');
  if (mcpBackupRel) {
    restoreBackup(targetRoot, mcpBackupRel, '.cursor/mcp.json');
    return;
  }
  if (!fs.existsSync(mcpPath)) return;
  const cfg = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
  if (cfg.mcpServers?.gitnexus) {
    delete cfg.mcpServers.gitnexus;
    if (Object.keys(cfg.mcpServers).length === 0) {
      try {
        fs.unlinkSync(mcpPath);
      } catch {
        /* ignore */
      }
    } else {
      fs.writeFileSync(mcpPath, JSON.stringify(cfg, null, 2) + '\n');
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
  const flags = new Set(rest);
  const repoIdx = rest.indexOf('--repo-name');
  const repoName = repoIdx >= 0 ? rest[repoIdx + 1] : process.env.GITNEXUS_REPO_NAME;
  const fullIndex = flags.has('--full');
  const quick = cmd === 'update' ? !fullIndex : flags.has('--quick');
  const noSetup = flags.has('--no-setup');
  const skipVerify = flags.has('--skip-verify');
  const removeIndex = flags.has('--remove-index');

  if (!cmd || !target || cmd === '--help' || cmd === '-h') {
    console.log(`Usage:
  node lib/kit.mjs install <target-repo> [--repo-name NAME] [--quick] [--no-setup] [--skip-verify]
  node lib/kit.mjs update <target-repo> [--repo-name NAME] [--full] [--skip-verify]
  node lib/kit.mjs uninstall <target-repo> [--remove-index]

  update defaults to --quick (hooks + bundle, skip index). Pass --full to rebuild .gitnexus/`);
    process.exit(cmd ? 0 : 2);
  }

  const opts = { repoName, quick, runSetup: !noSetup, removeIndex, skipVerify };

  if (cmd === 'install') {
    installKit(target, opts);
    return;
  }
  if (cmd === 'update') {
    updateKit(target, opts);
    return;
  }
  if (cmd === 'uninstall') {
    uninstallKit(target, opts);
    console.log(`Uninstalled cursor-gitnexus-kit from ${path.resolve(target)}`);
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  process.exit(2);
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  cliMain(process.argv.slice(2));
}
