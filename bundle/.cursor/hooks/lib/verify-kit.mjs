#!/usr/bin/env node
/**
 * Full cursor-gitnexus-kit installation verification.
 * Usage: node .cursor/hooks/lib/verify-kit.mjs [repoRoot] [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { auditKitHealth } from './session-health-audit.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = process.argv[2] ?? process.cwd();
const jsonOut = process.argv.includes('--json');

/** Critical teaching files (subset of gitnexus-setup.sh TEACHING_SOURCES). */
const CRITICAL_PATHS = [
  '.cursor/rules/00-gitnexus-enforcement.mdc',
  '.cursor/hooks.json',
  '.cursor/hooks/gitnexus-session-primer.sh',
  '.cursor/hooks/gitnexus-session-health.sh',
  '.cursor/hooks/gitnexus-grep-guard.sh',
  '.cursor/hooks/gitnexus-read-guard.sh',
  '.cursor/hooks/gitnexus-edit-guard.sh',
  '.cursor/hooks/gitnexus-commit-guard.sh',
  '.cursor/hooks/lib/hook-helpers.mjs',
  '.cursor/hooks/lib/cypher-helpers.mjs',
  '.cursor/hooks/lib/rename-helpers.mjs',
  '.cursor/hooks/lib/stale-policy.mjs',
  '.cursor/hooks/lib/verify-kit.mjs',
  '.cursor/hooks/lib/graph-smoke.mjs',
  '.cursor/hooks/lib/detect-api-router.mjs',
  'scripts/gitnexus-agent.mjs',
  'scripts/gitnexus-gate-hint.mjs',
  'scripts/gitnexus-teaching/script-gates.mjs',
  'scripts/lib/setup-ui.mjs',
  'docs/GITNEXUS-CURSOR-GUIDE.md',
  '.cursor/gn-kit-manifest.json',
];

const HOOK_SCRIPTS = [
  'gitnexus-session-primer.sh',
  'gitnexus-session-health.sh',
  'gitnexus-session-health-user.sh',
  'gitnexus-prompt-router.sh',
  'gitnexus-grep-guard.sh',
  'gitnexus-read-guard.sh',
  'gitnexus-edit-guard.sh',
  'gitnexus-commit-guard.sh',
];

function checkFile(rel) {
  const abs = path.join(root, rel);
  const exists = fs.existsSync(abs);
  return { id: rel, ok: exists, label: rel, detail: exists ? 'present' : 'missing' };
}

function checkHooksJson() {
  const p = path.join(root, '.cursor/hooks.json');
  if (!fs.existsSync(p)) {
    return { id: 'hooks_json', ok: false, label: 'hooks.json structure', detail: 'missing' };
  }
  try {
    const h = JSON.parse(fs.readFileSync(p, 'utf8')).hooks ?? {};
    const ok =
      (h.sessionStart?.length ?? 0) >= 2 &&
      (h.beforeSubmitPrompt?.length ?? 0) >= 1 &&
      (h.preToolUse?.length ?? 0) >= 4;
    return {
      id: 'hooks_json',
      ok,
      label: 'hooks.json structure',
      detail: ok ? 'session + prompt + preToolUse guards' : 'incomplete hook chain',
    };
  } catch {
    return { id: 'hooks_json', ok: false, label: 'hooks.json structure', detail: 'invalid JSON' };
  }
}

function checkHookExecutable(name) {
  const p = path.join(root, '.cursor/hooks', name);
  if (!fs.existsSync(p)) {
    return { id: `hook:${name}`, ok: false, label: name, detail: 'missing' };
  }
  try {
    const mode = fs.statSync(p).mode & 0o111;
    return { id: `hook:${name}`, ok: mode !== 0, label: name, detail: mode ? 'executable' : 'not executable' };
  } catch {
    return { id: `hook:${name}`, ok: false, label: name, detail: 'stat failed' };
  }
}

function checkPackageGates() {
  const p = path.join(root, 'package.json');
  if (!fs.existsSync(p)) {
    return { id: 'pkg_gates', ok: false, label: 'package.json gates', detail: 'no package.json' };
  }
  try {
    const scripts = JSON.parse(fs.readFileSync(p, 'utf8')).scripts ?? {};
    const hasGate = Object.keys(scripts).some((k) => k.startsWith('gitnexus.__gate.'));
    const hasVerify = scripts['gitnexus:verify'];
    const hasBrief = scripts['gitnexus:agent-brief'];
    const ok = hasGate && hasVerify && hasBrief;
    return {
      id: 'pkg_gates',
      ok,
      label: 'package.json gates',
      detail: ok ? 'gated gitnexus:* scripts injected' : 'run merge-package-scripts --write',
    };
  } catch {
    return { id: 'pkg_gates', ok: false, label: 'package.json gates', detail: 'invalid JSON' };
  }
}

function checkSkillsSync() {
  const p = path.join(root, '.cursor/skills/gitnexus-workspace/SKILL.md');
  const ok = fs.existsSync(p);
  return {
    id: 'skills_sync',
    ok,
    label: 'Cursor skills sync',
    detail: ok ? 'gitnexus-workspace in .cursor/skills/' : 'run gitnexus:sync-teaching',
  };
}

function checkTeachingManifest() {
  const p = path.join(root, '.cursor/gitnexus-teaching-bundle.json');
  const ok = fs.existsSync(p);
  return {
    id: 'teaching_manifest',
    ok,
    label: 'Teaching manifest',
    detail: ok ? '.cursor/gitnexus-teaching-bundle.json' : 'missing',
  };
}

/**
 * @param {string} repoRoot
 */
export function verifyKitInstall(repoRoot) {
  const checks = [];
  for (const rel of CRITICAL_PATHS) checks.push(checkFile(rel));
  checks.push(checkHooksJson());
  for (const h of HOOK_SCRIPTS) checks.push(checkHookExecutable(h));
  checks.push(checkPackageGates());
  checks.push(checkSkillsSync());
  checks.push(checkTeachingManifest());

  const health = auditKitHealth(repoRoot);
  for (const c of health.checks) {
    checks.push({
      id: `health:${c.id}`,
      ok: c.ok,
      label: c.label,
      detail: c.detail ?? '',
    });
  }

  const failed = checks.filter((c) => !c.ok);
  const passed = checks.filter((c) => c.ok);

  return {
    root: repoRoot,
    healthy: failed.length === 0,
    passed: passed.length,
    failed: failed.length,
    total: checks.length,
    checks,
    health,
    verifiedAt: new Date().toISOString(),
  };
}

async function printHuman(report) {
  const ui = await import(pathToFileURL(path.join(root, 'scripts/lib/setup-ui.mjs')).href);

  ui.banner('GitNexus Kit Verification', path.basename(report.root));

  const rows = report.checks.map((c) => ({
    label: c.label,
    value: c.detail,
    status: c.ok ? 'ok' : 'fail',
  }));

  for (const row of rows) {
    if ((row.label === 'Graph index' || row.label === 'Embeddings') && row.status === 'fail') {
      row.status = 'warn';
    }
  }

  ui.summaryTable({
    title: `Checks: ${report.passed}/${report.total} passed`,
    rows,
  });

  const hardFail = report.checks.some(
    (c) =>
      !c.ok &&
      !['health:graph_fresh', 'health:embeddings'].includes(c.id)
  );

  if (hardFail) {
    ui.fail('Kit incomplete — fix failed checks above, then npm run gitnexus:verify');
    return 1;
  }

  if (!report.health.healthy) {
    ui.warn('Graph stale or missing embeddings — run npm run gitnexus:agent-refresh after restart');
  } else {
    ui.ok('Kit fully verified — ready for Cursor Agent');
  }

  ui.nextSteps([
    'Restart Cursor on this project (MCP + hooks load on restart)',
    'npm run gitnexus:health — share status with your team',
    'Open a new Agent chat — agent confirms kit on first reply',
    'npm run gitnexus.__gate.1.session — read Gate 1 script docs',
  ]);

  return 0;
}

async function main() {
  const report = verifyKitInstall(root);

  if (jsonOut) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.healthy ? 0 : 1);
  }

  const code = await printHuman(report);
  process.exit(code);
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main();
}
