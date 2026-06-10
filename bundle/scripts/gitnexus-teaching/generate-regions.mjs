#!/usr/bin/env node
/**
 * Build .cursor/regions.manifest.json from generated area skills + optional overlay.
 *
 * Usage: node scripts/gitnexus-teaching/generate-regions.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const OUT_PATH = path.join(ROOT, '.cursor/regions.manifest.json');

const CLUSTER_RE = /^cluster-\d+$/i;

/** @param {string} skillMd */
function parseSkill(skillMd, areaId) {
  const fm = skillMd.match(/^---\n([\s\S]*?)\n---/);
  const body = skillMd.slice(fm?.[0]?.length ?? 0);
  const desc = fm?.[1]?.match(/description:\s*"(.*)"/)?.[1] ?? '';

  const filePaths = [];
  for (const m of body.matchAll(/`([^`]+\.(?:js|ts|tsx|mjs|jsx|json|md))`/g)) {
    const p = m[1].replace(/\\/g, '/');
    if (!p.startsWith('..')) filePaths.push(p);
  }

  const owns = deriveOwnsGlobs(filePaths, areaId);
  const mission =
    desc.replace(/^Skill for the \w+ area of [^.]+\.\s*/i, '').trim() ||
    `Work in the ${areaId} functional area`;

  return {
    id: areaId,
    label: humanLabel(areaId),
    mission,
    owns,
    reads: ['**'],
    anchorSkill: `.cursor/skills/generated/${areaId}/SKILL.md`,
    source: 'generated-skill',
    symbolCount: Number(desc.match(/(\d+)\s+symbols/)?.[1] ?? 0),
  };
}

/** @param {string} areaId */
function humanLabel(areaId) {
  if (CLUSTER_RE.test(areaId)) return `Area ${areaId.replace('cluster-', '')}`;
  return areaId.charAt(0).toUpperCase() + areaId.slice(1);
}

/**
 * @param {string[]} filePaths
 * @param {string} areaId
 */
function deriveOwnsGlobs(filePaths, areaId) {
  const prefixes = new Set();
  for (const fp of filePaths) {
    const parts = fp.split('/');
    if (parts.length >= 2) {
      prefixes.add(`${parts.slice(0, 2).join('/')}/**`);
    }
    if (parts.length >= 3 && parts[0] === 'src') {
      prefixes.add(`${parts.slice(0, 3).join('/')}/**`);
    }
    if (parts[0] === 'tests' && parts.length >= 2) {
      prefixes.add(`${parts.slice(0, 2).join('/')}/**`);
    }
    if (parts[0] === 'apps' && parts.length >= 2) {
      prefixes.add(`${parts.slice(0, 2).join('/')}/**`);
    }
  }

  const globs = [...prefixes].sort();
  if (globs.length) return globs;

  return [`**/${areaId}/**`];
}

/** @param {object[]} regions */
function filterAndSortRegions(regions) {
  const named = regions.filter((r) => !CLUSTER_RE.test(r.id));
  const clusters = regions.filter((r) => CLUSTER_RE.test(r.id) && (r.symbolCount ?? 0) >= 8);
  const merged = [...named, ...clusters].sort((a, b) => a.label.localeCompare(b.label));
  return merged.slice(0, 14);
}

/** @param {object} base @param {object} overlay */
function applyOverlay(base, overlay) {
  if (!overlay) return base;

  if (overlay.mode === 'replace' && overlay.regions?.length) {
    return {
      ...base,
      regions: overlay.regions,
      superchat: overlay.superchat ?? base.superchat,
      partialOverflowWrites: overlay.partialOverflowWrites ?? base.partialOverflowWrites,
      source: 'overlay-replace',
    };
  }

  if (overlay.regions?.length) {
    const byId = new Map(base.regions.map((r) => [r.id, r]));
    for (const r of overlay.regions) {
      byId.set(r.id, { ...byId.get(r.id), ...r });
    }
    return { ...base, regions: [...byId.values()].sort((a, b) => a.label.localeCompare(b.label)) };
  }

  return base;
}

export function generateRegions(root = ROOT) {
  const repoName = path.basename(root);
  const skillsDir = path.join(root, '.claude/skills/generated');
  const regions = [];

  if (fs.existsSync(skillsDir)) {
    for (const ent of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const skillPath = path.join(skillsDir, ent.name, 'SKILL.md');
      if (!fs.existsSync(skillPath)) continue;
      regions.push(parseSkill(fs.readFileSync(skillPath, 'utf8'), ent.name));
    }
  }

  let manifest = {
    version: 1,
    repo: process.env.GITNEXUS_REPO_NAME ?? repoName,
    generatedAt: new Date().toISOString(),
    readsPolicy:
      'All regions may READ any path in the repository for reasoning (graph tools, Read, cross-region context). Only WRITES are bounded by owns.',
    partialOverflowWrites: 2,
    regions: filterAndSortRegions(regions),
    superchat: {
      id: 'superchat',
      label: 'Superchat (unbounded)',
      warning:
        'No write boundaries — use a capable model. Context drift is likely; prefer region chats for focused work.',
    },
    source: regions.length ? 'generated-skills' : 'empty',
  };

  const overlayPath = path.join(root, 'docs/regions.overlay.json');
  if (fs.existsSync(overlayPath)) {
    try {
      manifest = applyOverlay(manifest, JSON.parse(fs.readFileSync(overlayPath, 'utf8')));
    } catch (e) {
      console.warn('regions.overlay.json parse failed:', e.message);
    }
  }

  return manifest;
}

function main() {
  const write = process.argv.includes('--write');
  const manifest = generateRegions();

  if (write) {
    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(OUT_PATH, JSON.stringify(manifest, null, 2) + '\n');
    console.log(
      `regions.manifest.json: ${manifest.regions.length} regions (${manifest.source}) → ${OUT_PATH}`
    );
  } else {
    process.stdout.write(JSON.stringify(manifest, null, 2));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
