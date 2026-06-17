#!/usr/bin/env node
/**
 * Single source of truth for GitNexus npm scripts.
 * Usage:
 *   node scripts/gitnexus-teaching/merge-package-scripts.mjs --write
 *   node scripts/gitnexus-teaching/merge-package-scripts.mjs --snippet
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const WRAP = 'bash scripts/run-with-project-tmp.sh';

/** @type {Record<string, string>} */
export const GITNEXUS_NPM_SCRIPTS = {
  'gitnexus:setup': 'bash scripts/gitnexus-setup.sh',
  'gitnexus:sync-teaching': 'bash scripts/sync-cursor-gitnexus-teaching.sh',
  'gitnexus:pack': 'bash scripts/pack-gitnexus-teaching.sh',
  'gitnexus:refresh': `${WRAP} npx gitnexus@latest analyze --embeddings --skills`,
  'gitnexus:full': `${WRAP} npx gitnexus@latest analyze --force --embeddings --skills`,
  'gitnexus:wiki': `${WRAP} npx gitnexus@latest wiki --provider openai --model gpt-4o-mini --base-url https://api.openai.com/v1`,
  'gitnexus:wiki-force':
    `${WRAP} npx gitnexus@latest wiki --force --provider openai --model gpt-4o-mini --base-url https://api.openai.com/v1`,
  'gitnexus:status': `${WRAP} npx gitnexus@latest status`,
  'gitnexus:agent-status': 'node scripts/gitnexus-agent.mjs status',
  'gitnexus:agent-brief': 'node scripts/gitnexus-agent.mjs brief',
  'gitnexus:agent-refresh': 'node scripts/gitnexus-agent.mjs refresh',
  'gitnexus:clean-tmp': 'bash scripts/clean-project-tmp.sh',
  'gitnexus:list': `${WRAP} npx gitnexus@latest list`,
  'hooks:install': 'bash scripts/install-git-hooks.sh',
};

/**
 * @param {object} pkg
 * @returns {{ added: number, updated: number, unchanged: number }}
 */
export function mergeGitnexusScripts(pkg) {
  pkg.scripts ??= {};
  let added = 0;
  let updated = 0;
  let unchanged = 0;

  for (const [key, value] of Object.entries(GITNEXUS_NPM_SCRIPTS)) {
    if (pkg.scripts[key] === undefined) {
      added++;
    } else if (pkg.scripts[key] !== value) {
      updated++;
    } else {
      unchanged++;
    }
    pkg.scripts[key] = value;
  }

  return { added, updated, unchanged };
}

/**
 * @param {string} pkgPath
 * @param {{ createIfMissing?: boolean, repoName?: string }} opts
 */
export function mergeIntoPackageJson(pkgPath, opts = {}) {
  const abs = path.resolve(pkgPath);
  let pkg;

  if (fs.existsSync(abs)) {
    pkg = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } else if (opts.createIfMissing) {
    const repoName = opts.repoName ?? path.basename(path.dirname(abs));
    pkg = {
      name: repoName,
      version: '1.0.0',
      private: true,
      scripts: {},
    };
  } else {
    throw new Error(`package.json not found: ${abs}`);
  }

  const stats = mergeGitnexusScripts(pkg);

  if (!pkg.engines?.node) {
    pkg.engines ??= {};
    pkg.engines.node = '>=22.9.0';
  }

  fs.writeFileSync(abs, JSON.stringify(pkg, null, 2) + '\n');
  return stats;
}

function main() {
  const args = new Set(process.argv.slice(2));
  const pkgPath = path.join(ROOT, 'package.json');

  if (args.has('--snippet')) {
    process.stdout.write(JSON.stringify({ scripts: GITNEXUS_NPM_SCRIPTS }, null, 2) + '\n');
    return;
  }

  if (args.has('--write')) {
    const repoNameIdx = process.argv.indexOf('--repo-name');
    const repoName =
      process.env.GITNEXUS_REPO_NAME ||
      (repoNameIdx >= 0 ? process.argv[repoNameIdx + 1] : undefined);
    const stats = mergeIntoPackageJson(pkgPath, {
      createIfMissing: true,
      repoName: repoName || undefined,
    });
    console.log(
      `GitNexus npm scripts: ${stats.added} added, ${stats.updated} updated, ${stats.unchanged} unchanged`
    );
    return;
  }

  console.error('Usage: merge-package-scripts.mjs --write | --snippet');
  process.exit(2);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  main();
}
