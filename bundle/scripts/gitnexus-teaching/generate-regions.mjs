#!/usr/bin/env node
/**
 * Build .cursor/regions.manifest.json from:
 *   1) GitNexus generated area skills (best after gitnexus:refresh)
 *   2) Filesystem layout scan (works on --quick install before index)
 *   3) Optional docs/regions.overlay.json (merge | replace | enrich)
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
const MIN_SYMBOLS_NAMED = 3;
const MIN_SYMBOLS_CLUSTER = 8;
const MAX_REGIONS = 14;

/** @param {string} areaId */
function humanLabel(areaId) {
  if (CLUSTER_RE.test(areaId)) return `Area ${areaId.replace('cluster-', '')}`;
  return areaId
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** @param {string[]} filePaths */
function deepestOwnsPrefix(filePaths) {
  if (!filePaths.length) return null;
  const split = filePaths.map((p) => p.split('/'));
  const minLen = Math.min(...split.map((s) => s.length));
  const common = [];
  for (let i = 0; i < minLen - 1; i++) {
    const seg = split[0][i];
    if (split.every((s) => s[i] === seg)) common.push(seg);
    else break;
  }
  if (common.length >= 2) return `${common.join('/')}/**`;
  if (common.length === 1 && split[0].length >= 2) return `${common[0]}/${split[0][1]}/**`;
  return null;
}

/** @param {string[]} filePaths @param {string} areaId */
function deriveOwnsGlobs(filePaths, areaId) {
  const prefixes = new Set();
  const deep = deepestOwnsPrefix(filePaths);
  if (deep) prefixes.add(deep);

  for (const fp of filePaths) {
    const parts = fp.split('/');
    if (parts[0] === 'src' && parts.length >= 3) prefixes.add(`${parts.slice(0, 3).join('/')}/**`);
    if (parts[0] === 'tests' && parts.length >= 2) prefixes.add(`${parts.slice(0, 2).join('/')}/**`);
    if (parts[0] === 'apps' && parts.length >= 2) prefixes.add(`${parts.slice(0, 2).join('/')}/**`);
    if (parts[0] === 'packages' && parts.length >= 2) prefixes.add(`${parts.slice(0, 2).join('/')}/**`);
  }

  const globs = [...prefixes].sort();
  if (globs.length) return globs;
  return [`**/${areaId}/**`];
}

/** @param {object} region */
function buildInferKeywords(region) {
  const kws = new Set([region.id]);
  for (const g of region.owns ?? []) {
    for (const seg of g.split('/')) {
      if (seg && seg !== '**' && seg !== '*' && seg.length > 2) kws.add(seg);
    }
  }
  for (const w of (region.label ?? '').toLowerCase().split(/\W+/)) {
    if (w.length > 3) kws.add(w);
  }
  return [...kws].slice(0, 12);
}

/** @param {string} skillMd @param {string} areaId */
function parseSkill(skillMd, areaId) {
  const fm = skillMd.match(/^---\n([\s\S]*?)\n---/);
  const body = skillMd.slice(fm?.[0]?.length ?? 0);
  const desc = fm?.[1]?.match(/description:\s*"(.*)"/)?.[1] ?? '';
  const cohesion = Number(body.match(/Cohesion:\s*(\d+)%/)?.[1] ?? 0);

  const filePaths = [];
  for (const m of body.matchAll(/`([^`]+\.(?:js|ts|tsx|mjs|jsx|json|md))`/g)) {
    const p = m[1].replace(/\\/g, '/');
    if (!p.startsWith('..')) filePaths.push(p);
  }

  const owns = deriveOwnsGlobs(filePaths, areaId);
  const mission =
    desc.replace(/^Skill for the \w+ area of [^.]+\.\s*/i, '').trim() ||
    `Work in the ${humanLabel(areaId)} area`;

  const region = {
    id: areaId,
    label: humanLabel(areaId),
    mission,
    owns,
    reads: ['**'],
    anchorSkill: `.cursor/skills/generated/${areaId}/SKILL.md`,
    source: 'generated-skill',
    symbolCount: Number(desc.match(/(\d+)\s+symbols/)?.[1] ?? 0),
    cohesion,
    fileCount: Number(body.match(/\|\s*(\d+)\s+files\s*\|/)?.[1] ?? filePaths.length),
  };
  region.inferKeywords = buildInferKeywords(region);
  return region;
}

/** @param {string} root */
function scanFilesystemRegions(root) {
  const regions = [];
  const add = (id, label, owns, mission) => {
    if (!owns?.length) return;
    regions.push({
      id,
      label,
      mission,
      owns,
      reads: ['**'],
      source: 'filesystem',
      inferKeywords: buildInferKeywords({ id, label, owns }),
    });
  };

  const src = path.join(root, 'src');
  if (fs.existsSync(src)) {
    for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
      if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
      const sub = path.join(src, ent.name);
      const grandchildren = fs.readdirSync(sub, { withFileTypes: true }).filter((e) => e.isDirectory());
      if (grandchildren.length >= 2) {
        for (const gc of grandchildren) {
          const id = gc.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
          add(id, humanLabel(gc.name), [`src/${ent.name}/${gc.name}/**`], `${humanLabel(gc.name)} under src/${ent.name}`);
        }
      } else {
        add(ent.name, humanLabel(ent.name), [`src/${ent.name}/**`], `Source tree src/${ent.name}`);
      }
    }
  }

  const apps = path.join(root, 'apps');
  if (fs.existsSync(apps)) {
    for (const ent of fs.readdirSync(apps, { withFileTypes: true })) {
      if (ent.isDirectory() && !ent.name.startsWith('.')) {
        add(ent.name, `${humanLabel(ent.name)} app`, [`apps/${ent.name}/**`], `Application apps/${ent.name}`);
      }
    }
  }

  const packages = path.join(root, 'packages');
  if (fs.existsSync(packages)) {
    for (const ent of fs.readdirSync(packages, { withFileTypes: true })) {
      if (ent.isDirectory() && !ent.name.startsWith('.')) {
        add(ent.name, `Package ${ent.name}`, [`packages/${ent.name}/**`], `Monorepo package ${ent.name}`);
      }
    }
  }

  if (fs.existsSync(path.join(root, 'scripts'))) {
    add('scripts', 'Scripts & tooling', ['scripts/**', 'bin/**'], 'CLI and automation scripts');
  }
  if (fs.existsSync(path.join(root, 'tests')) || fs.existsSync(path.join(root, 'test'))) {
    add('tests', 'Tests', ['tests/**', 'test/**', '__tests__/**'], 'Test suites');
  }
  if (fs.existsSync(path.join(root, 'docs'))) {
    add('docs', 'Documentation', ['docs/**', 'README.md', 'AGENTS.md', 'CLAUDE.md'], 'Documentation');
  }

  return regions;
}

/** @param {object[]} regions */
function filterSkillRegions(regions) {
  const named = regions.filter((r) => !CLUSTER_RE.test(r.id) && (r.symbolCount ?? 0) >= MIN_SYMBOLS_NAMED);
  const clusters = regions.filter(
    (r) => CLUSTER_RE.test(r.id) && (r.symbolCount ?? 0) >= MIN_SYMBOLS_CLUSTER
  );
  return [...named, ...clusters].sort((a, b) => (b.symbolCount ?? 0) - (a.symbolCount ?? 0));
}

function mergeOverlappingClusters(regions) {
  const named = regions.filter((r) => !CLUSTER_RE.test(r.id));
  const clusters = regions.filter((r) => CLUSTER_RE.test(r.id));
  const drop = new Set();

  for (const c of clusters) {
    for (const n of named) {
      const overlap = c.owns?.some((co) => n.owns?.some((no) => co === no || co.startsWith(no.slice(0, -3))));
      if (overlap && (c.symbolCount ?? 0) < (n.symbolCount ?? 0)) {
        drop.add(c.id);
        break;
      }
    }
  }

  return regions.filter((r) => !drop.has(r.id));
}

function computeNeverTouches(regions) {
  return regions.map((r) => {
    const never = [];
    for (const other of regions) {
      if (other.id === r.id) continue;
      for (const g of other.owns ?? []) never.push(g);
    }
    return { ...r, neverTouches: [...new Set(never)].sort() };
  });
}

function capRegions(regions) {
  const sorted = [...regions].sort((a, b) => {
    const sa = a.symbolCount ?? (a.source === 'filesystem' ? 5 : 0);
    const sb = b.symbolCount ?? (b.source === 'filesystem' ? 5 : 0);
    return sb - sa;
  });
  return sorted.slice(0, MAX_REGIONS);
}

/** @param {string} root */
function regionsFromSkills(root) {
  const skillsDir = path.join(root, '.claude/skills/generated');
  const regions = [];
  if (!fs.existsSync(skillsDir)) return regions;

  for (const ent of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const skillPath = path.join(skillsDir, ent.name, 'SKILL.md');
    if (!fs.existsSync(skillPath)) continue;
    regions.push(parseSkill(fs.readFileSync(skillPath, 'utf8'), ent.name));
  }
  return mergeOverlappingClusters(capRegions(computeNeverTouches(filterSkillRegions(regions))));
}

/** @param {object} base @param {object} overlay */
function applyOverlay(base, overlay) {
  if (!overlay) return base;

  if (overlay.mode === 'replace' && overlay.regions?.length) {
    return {
      ...base,
      regions: overlay.regions.map((r) => ({
        reads: ['**'],
        inferKeywords: buildInferKeywords(r),
        ...r,
      })),
      superchat: overlay.superchat ?? base.superchat,
      partialOverflowWrites: overlay.partialOverflowWrites ?? base.partialOverflowWrites,
      source: 'overlay-replace',
    };
  }

  if (overlay.mode === 'enrich' && overlay.regions?.length) {
    const byId = new Map(base.regions.map((r) => [r.id, r]));
    for (const r of overlay.regions) {
      const prev = byId.get(r.id) ?? {};
      byId.set(r.id, {
        reads: ['**'],
        inferKeywords: buildInferKeywords({ ...prev, ...r }),
        ...prev,
        ...r,
      });
    }
    return {
      ...base,
      regions: [...byId.values()].sort((a, b) => a.label.localeCompare(b.label)),
      source: 'overlay-enrich',
    };
  }

  if (overlay.regions?.length) {
    const byId = new Map(base.regions.map((r) => [r.id, r]));
    for (const r of overlay.regions) {
      byId.set(r.id, { reads: ['**'], inferKeywords: buildInferKeywords(r), ...byId.get(r.id), ...r });
    }
    return {
      ...base,
      regions: [...byId.values()].sort((a, b) => a.label.localeCompare(b.label)),
      source: 'overlay-merge',
    };
  }

  return base;
}

export function generateRegions(root = ROOT) {
  const repoName = process.env.GITNEXUS_REPO_NAME ?? path.basename(root);
  const fromSkills = regionsFromSkills(root);
  const fromFs = scanFilesystemRegions(root);

  let regions;
  let source;
  if (fromSkills.length >= 2) {
    regions = fromSkills;
    source = 'generated-skills';
  } else if (fromFs.length >= 2) {
    regions = capRegions(computeNeverTouches(fromFs));
    source = 'filesystem-scan';
  } else if (fromSkills.length) {
    regions = fromSkills;
    source = 'generated-skills-sparse';
  } else {
    regions = fromFs;
    source = fromFs.length ? 'filesystem-scan-sparse' : 'empty';
  }

  let manifest = {
    version: 2,
    repo: repoName,
    generatedAt: new Date().toISOString(),
    readsPolicy:
      'All regions may READ any path for reasoning. WRITES are bounded by owns. Region auto-inferred from first user prompt (paths + keywords).',
    partialOverflowWrites: 2,
    regionInference: {
      method: 'heuristic',
      note: 'Cursor hooks cannot call the chat LLM; inference uses paths and keywords in the first prompt.',
    },
    regions,
    superchat: {
      id: 'superchat',
      label: 'Superchat (unbounded)',
      warning:
        'No write boundaries — use a capable model. Context drift is likely; prefer region chats for focused work.',
    },
    source,
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
