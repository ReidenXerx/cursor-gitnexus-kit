#!/usr/bin/env node
/**
 * Zed / zed-only verification for gitnexus-agent-kit.
 * Usage: node lib/verify-zed.mjs <repoRoot> [--runtime zed|both]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MANIFEST_PATH, ZED_PROFILE_KEY, ZED_PROFILE_NAME } from './constants.mjs';
import { listSkillNames } from './skills.mjs';
import { SKILLS_STORE } from './constants.mjs';

const root = process.argv[2] ?? process.cwd();
const runtimeArg = process.argv.includes('--runtime')
  ? process.argv[process.argv.indexOf('--runtime') + 1]
  : 'zed';

function check(p, label) {
  const ok = fs.existsSync(path.join(root, p));
  return { ok, label, detail: ok ? 'present' : 'missing' };
}

function isSymlinkTo(p, expectedTarget) {
  try {
    const st = fs.lstatSync(path.join(root, p));
    if (!st.isSymbolicLink()) return false;
    const target = fs.readlinkSync(path.join(root, p));
    return path.resolve(path.dirname(path.join(root, p)), target) === path.resolve(root, expectedTarget);
  } catch {
    return false;
  }
}

export function verifyZedInstall(repoRoot) {
  const checks = [];
  checks.push(check(MANIFEST_PATH, 'agent-kit manifest'));
  checks.push(check('.zed/settings.json', 'Zed project settings'));
  checks.push(check('AGENTS.md', 'AGENTS.md instructions'));

  const store = path.join(repoRoot, SKILLS_STORE);
  const names = listSkillNames(store);
  checks.push({
    ok: names.length >= 10,
    label: 'Canonical skills store',
    detail: names.length ? `${names.length} skills in ${SKILLS_STORE}` : 'empty',
  });

  const linked = isSymlinkTo('.agents/skills/gitnexus-workspace', `${SKILLS_STORE}/gitnexus-workspace`);
  checks.push({
    ok: linked,
    label: 'Zed skills symlinks',
    detail: linked ? 'gitnexus-workspace → store' : 'run kit install --runtime zed',
  });

  let zedCfg = {};
  try {
    zedCfg = JSON.parse(fs.readFileSync(path.join(repoRoot, '.zed/settings.json'), 'utf8'));
  } catch {
    /* noop */
  }
  checks.push({
    ok: Boolean(zedCfg.context_servers?.gitnexus),
    label: 'GitNexus MCP (Zed)',
    detail: zedCfg.context_servers?.gitnexus ? 'context_servers.gitnexus' : 'missing',
  });
  checks.push({
    ok: Boolean(zedCfg.agent?.profiles?.[ZED_PROFILE_KEY]),
    label: 'Zed + GitNexus agent profile',
    detail: zedCfg.agent?.profiles?.[ZED_PROFILE_KEY]
      ? `"${ZED_PROFILE_NAME}" — grep off, gitnexus MCP on`
      : 'missing',
  });

  const failed = checks.filter((c) => !c.ok);
  return {
    root: repoRoot,
    runtime: runtimeArg,
    healthy: failed.length === 0,
    passed: checks.length - failed.length,
    failed: failed.length,
    total: checks.length,
    checks,
  };
}

async function main() {
  const ui = await import(
    new URL('../bundle/scripts/lib/setup-ui.mjs', import.meta.url).href
  );
  const report = verifyZedInstall(root);
  ui.banner('GitNexus Kit — Zed verification', path.basename(root));
  ui.summaryTable({
    title: `Checks: ${report.passed}/${report.total} passed`,
    rows: report.checks.map((c) => ({
      label: c.label,
      value: c.detail,
      status: c.ok ? 'ok' : 'fail',
    })),
  });
  if (report.healthy) {
    ui.ok(`Zed wiring verified — select profile "${ZED_PROFILE_NAME}" in Agent panel`);
  } else {
    ui.fail('Zed kit incomplete');
  }
  process.exit(report.healthy ? 0 : 1);
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) main();
