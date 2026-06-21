#!/usr/bin/env node
/**
 * Maintainer script: flatten .claude/skills → bundle/skills (canonical store).
 * Run from kit repo root after editing skills under .claude/skills/.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(KIT_ROOT, 'bundle/.claude/skills');
const DEST = path.join(KIT_ROOT, 'bundle/skills');

function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) copyTree(s, d);
    else fs.copyFileSync(s, d);
  }
}

fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(DEST, { recursive: true });

for (const name of ['gitnexus-enforcement', 'gitnexus-workspace']) {
  copyTree(path.join(SRC, name), path.join(DEST, name));
}
const nested = path.join(SRC, 'gitnexus');
if (fs.existsSync(nested)) {
  for (const ent of fs.readdirSync(nested, { withFileTypes: true })) {
    if (ent.isDirectory()) copyTree(path.join(nested, ent.name), path.join(DEST, ent.name));
  }
}
if (fs.existsSync(path.join(DEST, 'gitnexus-local'))) {
  console.log('kept existing gitnexus-local');
} else {
  console.log('note: gitnexus-local lives only in bundle/skills/ — edit there directly');
}

const count = fs.readdirSync(DEST).filter((n) => fs.existsSync(path.join(DEST, n, 'SKILL.md'))).length;
console.log(`Synced ${count} skills → bundle/skills/`);
