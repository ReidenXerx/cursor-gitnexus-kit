import fs from 'node:fs';
import path from 'node:path';
import { BUNDLE_ROOT, substituteRepoName } from './kit-shared.mjs';
import { SKILLS_STORE } from './constants.mjs';
import { isTextCandidate } from './kit-shared.mjs';
import { wantsCursor, wantsZed } from './constants.mjs';

/** @param {string} dir */
export function listSkillNames(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'SKILL.md')))
    .map((d) => d.name)
    .sort();
}

/**
 * Copy canonical flat skills into the target store (substitute repo name in SKILL.md).
 * @param {string} absTarget
 * @param {string} repoName
 */
export function materializeSkillsStore(absTarget, repoName) {
  const srcRoot = path.join(BUNDLE_ROOT, 'skills');
  const store = path.join(absTarget, SKILLS_STORE);
  if (!fs.existsSync(srcRoot)) {
    throw new Error('Missing bundle/skills/');
  }
  fs.rmSync(store, { recursive: true, force: true });
  fs.mkdirSync(store, { recursive: true });

  for (const name of listSkillNames(srcRoot)) {
    copySkillTree(path.join(srcRoot, name), path.join(store, name), repoName);
  }
  return listSkillNames(store);
}

/**
 * @param {string} src
 * @param {string} dest
 * @param {string} repoName
 */
function copySkillTree(src, dest, repoName) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) copySkillTree(s, d, repoName);
    else if (isTextCandidate(s)) {
      fs.writeFileSync(d, substituteRepoName(fs.readFileSync(s, 'utf8'), repoName));
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

/**
 * @param {string} linkPath
 * @param {string} targetPath
 */
export function replaceWithSymlink(linkPath, targetPath) {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  try {
    const st = fs.lstatSync(linkPath);
    if (st.isSymbolicLink() || st.isDirectory()) fs.rmSync(linkPath, { recursive: true, force: true });
    else fs.unlinkSync(linkPath);
  } catch {
    /* absent */
  }
  let rel = path.relative(path.dirname(linkPath), targetPath);
  if (!rel.startsWith('.')) rel = `./${rel}`;
  fs.symlinkSync(rel, linkPath, 'dir');
}

/**
 * @param {string} absTarget
 * @param {import('./constants.mjs').Runtime} runtime
 */
export function linkSkillsForRuntime(absTarget, runtime) {
  const store = path.join(absTarget, SKILLS_STORE);
  const names = listSkillNames(store);
  if (!names.length) return [];

  if (wantsCursor(runtime)) {
    const root = path.join(absTarget, '.cursor/skills');
    fs.mkdirSync(root, { recursive: true });
    for (const name of names) {
      replaceWithSymlink(path.join(root, name), path.join(store, name));
    }
  }

  if (wantsZed(runtime)) {
    const root = path.join(absTarget, '.agents/skills');
    fs.mkdirSync(root, { recursive: true });
    for (const name of names) {
      replaceWithSymlink(path.join(root, name), path.join(store, name));
    }
  }

  return names;
}

/** @param {string} absTarget @param {import('./constants.mjs').Runtime} runtime */
export function unlinkSkillLinks(absTarget, runtime) {
  const store = path.join(absTarget, SKILLS_STORE);
  const names = listSkillNames(store);
  for (const name of names) {
    if (wantsCursor(runtime)) {
      try {
        fs.rmSync(path.join(absTarget, '.cursor/skills', name), { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    if (wantsZed(runtime)) {
      try {
        fs.rmSync(path.join(absTarget, '.agents/skills', name), { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}
