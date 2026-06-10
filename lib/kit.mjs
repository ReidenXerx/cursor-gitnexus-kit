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

export const GITNEXUS_NPM_SCRIPTS = {
  'gitnexus:setup': 'bash scripts/gitnexus-setup.sh',
  'gitnexus:sync-teaching': 'bash scripts/sync-cursor-gitnexus-teaching.sh',
  'gitnexus:pack': 'bash scripts/pack-gitnexus-teaching.sh',
  'gitnexus:refresh': 'bash scripts/run-with-project-tmp.sh npx gitnexus@latest analyze --embeddings --skills',
  'gitnexus:full':
    'bash scripts/run-with-project-tmp.sh npx gitnexus@latest analyze --force --embeddings --skills',
  'gitnexus:wiki':
    'bash scripts/run-with-project-tmp.sh npx gitnexus@latest wiki --provider openai --model gpt-4o-mini --base-url https://api.openai.com/v1',
  'gitnexus:wiki-force':
    'bash scripts/run-with-project-tmp.sh npx gitnexus@latest wiki --force --provider openai --model gpt-4o-mini --base-url https://api.openai.com/v1',
  'gitnexus:status': 'bash scripts/run-with-project-tmp.sh npx gitnexus@latest status',
  'gitnexus:agent-status': 'node scripts/gitnexus-agent.mjs status',
  'gitnexus:agent-refresh': 'node scripts/gitnexus-agent.mjs refresh',
  'gitnexus:clean-tmp': 'bash scripts/clean-project-tmp.sh',
  'gitnexus:list': 'bash scripts/run-with-project-tmp.sh npx gitnexus@latest list',
  'hooks:install': 'bash scripts/install-git-hooks.sh',
};

const GITIGNORE_SNIPPET = `
# cursor-gitnexus-kit (generated — safe to remove via gn-kit uninstall)
.cursor/skills/
.cursor/gitnexus-teaching-bundle.json
.cursor/gn-kit-manifest.json
.cursor/.gitnexus-session-primed.flag
.cursor/.gitnexus-prompt-hint.json
.cursor/.gitnexus-refresh-pending.flag
.cursor/.gitnexus-mcp-used.flag
.gitnexus/
.tmp-agent/
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

/** @param {string} targetRoot */
export function mergePackageScripts(targetRoot) {
  const pkgPath = path.join(targetRoot, 'package.json');
  let pkg;
  if (fs.existsSync(pkgPath)) {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } else {
    pkg = {
      name: path.basename(targetRoot),
      version: '1.0.0',
      private: true,
      scripts: {},
    };
  }
  pkg.scripts ??= {};
  for (const [k, v] of Object.entries(GITNEXUS_NPM_SCRIPTS)) {
    pkg.scripts[k] = v;
  }
  if (!pkg.engines?.node) {
    pkg.engines ??= {};
    pkg.engines.node = '>=22.9.0';
  }
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

/** @param {string} targetRoot */
export function appendGitignore(targetRoot) {
  const marker = '# cursor-gitnexus-kit (generated';
  const gi = path.join(targetRoot, '.gitignore');
  const existing = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
  if (existing.includes(marker)) return [];
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
    if (line.includes('# cursor-gitnexus-kit (generated')) {
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
  for (const key of Object.keys(GITNEXUS_NPM_SCRIPTS)) {
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
  assertGitRepo(absTarget);
  const repoName = opts.repoName ?? path.basename(absTarget);
  const kitPkg = JSON.parse(fs.readFileSync(path.join(KIT_ROOT, 'package.json'), 'utf8'));

  const backups = {};
  const b1 = backupIfExists(absTarget, '.cursor/hooks.json', '.cursor/hooks.json.gn-kit.bak');
  if (b1) backups['hooks.json'] = b1;
  const b2 = backupIfExists(absTarget, '.cursor/mcp.json', '.cursor/mcp.json.gn-kit.bak');
  if (b2) backups['mcp.json'] = b2;

  const files = listBundleFiles();
  for (const rel of files) {
    copyBundleFile(path.join(BUNDLE_ROOT, rel), path.join(absTarget, rel), repoName);
  }

  mergeMcpJson(absTarget);
  mergePackageScripts(absTarget);
  const gitignoreLines = appendGitignore(absTarget);

  const manifest = {
    kit: 'cursor-gitnexus-kit',
    kitVersion: kitPkg.version,
    installedAt: new Date().toISOString(),
    repoName,
    files,
    npmScripts: Object.keys(GITNEXUS_NPM_SCRIPTS),
    gitignoreMarker: '# cursor-gitnexus-kit (generated',
    backups,
    mcpManaged: true,
  };

  const manifestPath = path.join(absTarget, MANIFEST_NAME);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  chmodScripts(absTarget);

  if (opts.runSetup !== false) {
    const setupFlags = opts.quick ? ['--quick'] : [];
    const r = spawnSync('bash', ['scripts/gitnexus-setup.sh', ...setupFlags], {
      cwd: absTarget,
      stdio: 'inherit',
      env: { ...process.env, GITNEXUS_REPO_NAME: repoName },
    });
    if (r.status !== 0) {
      throw new Error(`gitnexus-setup.sh failed with exit ${r.status}`);
    }
  }

  return manifest;
}

/** @param {string} targetRoot */
function chmodScripts(targetRoot) {
  for (const dir of ['scripts', '.cursor/hooks']) {
    const abs = path.join(targetRoot, dir);
    if (!fs.existsSync(abs)) continue;
    for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
      if (ent.isFile() && (ent.name.endsWith('.sh') || !ent.name.includes('.'))) {
        try {
          fs.chmodSync(path.join(abs, ent.name), 0o755);
        } catch {
          /* ignore */
        }
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
  const quick = flags.has('--quick');
  const noSetup = flags.has('--no-setup');
  const removeIndex = flags.has('--remove-index');

  if (!cmd || !target || cmd === '--help' || cmd === '-h') {
    console.log(`Usage:
  node lib/kit.mjs install <target-repo> [--repo-name NAME] [--quick] [--no-setup]
  node lib/kit.mjs update <target-repo> [--repo-name NAME] [--quick]
  node lib/kit.mjs uninstall <target-repo> [--remove-index]`);
    process.exit(cmd ? 0 : 2);
  }

  const opts = { repoName, quick, runSetup: !noSetup, removeIndex };

  if (cmd === 'install') {
    const m = installKit(target, opts);
    console.log(`Installed cursor-gitnexus-kit v${m.kitVersion} → ${path.resolve(target)} (${m.repoName})`);
    return;
  }
  if (cmd === 'update') {
    const m = updateKit(target, opts);
    console.log(`Updated cursor-gitnexus-kit v${m.kitVersion} → ${path.resolve(target)}`);
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
