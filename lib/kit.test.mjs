import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  listBundleFiles,
  substituteRepoName,
  PLACEHOLDER,
  BUNDLE_ROOT,
  GITIGNORE_MARKER,
} from './kit.mjs';

describe('cursor-gitnexus-kit', () => {
  it('bundle contains enforcement rule and hooks', () => {
    const files = listBundleFiles();
    assert.ok(
      files.some((f) => f.endsWith('00-gitnexus-enforcement.mdc')),
      `expected enforcement rule in bundle, got: ${files.filter((f) => f.includes('enforcement')).join(', ')}`
    );
    assert.ok(files.includes('.cursor/hooks.json'));
    assert.ok(files.includes('.cursor/hooks/lib/load-staleness.mjs'));
    assert.ok(fs.existsSync(BUNDLE_ROOT));
  });

  it('substituteRepoName replaces placeholder', () => {
    const out = substituteRepoName(`repo: "${PLACEHOLDER}"`, 'my-app');
    assert.equal(out, 'repo: "my-app"');
    assert.ok(!out.includes(PLACEHOLDER));
  });

  it('enforcement rule uses placeholder not hardcoded repo', () => {
    const bundleFiles = listBundleFiles();
    const rulePath = bundleFiles.find((f) => f.endsWith('00-gitnexus-enforcement.mdc'));
    const rule = fs.readFileSync(path.join(BUNDLE_ROOT, rulePath), 'utf8');
    assert.ok(rule.includes(PLACEHOLDER));
    assert.ok(!rule.includes('crypto-trading-bot'));
  });

  it('bundle includes docs required by gitnexus-setup.sh', () => {
    const files = listBundleFiles();
    assert.ok(files.includes('docs/GITNEXUS-TEAM-BUNDLE.md'));
    assert.ok(files.includes('scripts/gitnexus-teaching/merge-package-scripts.mjs'));
    assert.ok(!files.includes('.claude/skills/agent-region/SKILL.md'));
    assert.ok(!files.includes('scripts/gitnexus-teaching/generate-regions.mjs'));
  });

  it('bundle includes agent reasoning shortcuts', () => {
    const files = listBundleFiles();
    assert.ok(files.includes('.cursor/hooks/lib/hook-helpers.mjs'));
    assert.ok(files.includes('.cursor/hooks/lib/agent-brief.mjs'));
    assert.ok(files.includes('.cursor/gitnexus-hooks.json'));
  });

  it('hook-helpers builds copy-paste MCP calls', async () => {
    const helpers = await import(
      new URL('../bundle/.cursor/hooks/lib/hook-helpers.mjs', import.meta.url).href
    );
    const call = helpers.mcpContext('fooBar', 'my-repo');
    assert.ok(call.includes('gitnexus_context'));
    assert.ok(call.includes('fooBar'));
    assert.ok(call.includes('my-repo'));
    const guided = helpers.applyHookMode({ permission: 'deny', agent_message: 'x' }, 'guide');
    assert.equal(guided.permission, 'allow');
    const q = helpers.mcpQuery({ query: 'auth', taskContext: 't', goal: 'g', repo: 'r' });
    assert.ok(q.includes('limit: 5'));
    assert.ok(q.includes('max_symbols: 12'));
    assert.ok(helpers.mcpContext('Foo', 'r').includes('include_content: false'));
    assert.ok(helpers.mcpImpact('Foo', 'r').includes('summaryOnly: false'));
    const full = helpers.hookAgentMessage('/tmp/gn-test-deny', 'k1', 'FULL', 'SHORT');
    assert.equal(full, 'FULL');
    const again = helpers.hookAgentMessage('/tmp/gn-test-deny', 'k1', 'FULL', 'SHORT');
    assert.equal(again, 'FULL');
    helpers.clearDenyCache('/tmp/gn-test-deny');
  });

  it('gitignore marker matches snippet header', () => {
    assert.ok(GITIGNORE_MARKER.includes('GitNexus + cursor-gitnexus-kit'));
  });

  it('enforcement rule includes graph+embeddings gates', () => {
    const rule = fs.readFileSync(
      path.join(BUNDLE_ROOT, '.cursor/rules/00-gitnexus-enforcement.mdc'),
      'utf8'
    );
    assert.ok(rule.includes('embeddings'));
    assert.ok(rule.includes('limit: 5'));
    assert.ok(rule.includes('detect_changes'));
    assert.ok(rule.includes('impact upstream'));
  });

  it('check-staleness treats missing embeddings as stale', async () => {
    const { spawnSync, execSync } = await import('node:child_process');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-stale-'));
    execSync('git init -q', { cwd: tmp });
    execSync('git config user.email test@test.com', { cwd: tmp });
    execSync('git config user.name test', { cwd: tmp });
    fs.writeFileSync(path.join(tmp, 'f.txt'), 'x');
    execSync('git add f.txt && git commit -q -m init', { cwd: tmp, shell: true });
    const head = execSync('git rev-parse HEAD', { cwd: tmp, encoding: 'utf8' }).trim();
    const gn = path.join(tmp, '.gitnexus');
    fs.mkdirSync(gn, { recursive: true });
    fs.writeFileSync(
      path.join(gn, 'meta.json'),
      JSON.stringify({
        lastCommit: head,
        stats: { nodes: 100, embeddings: 0 },
      })
    );
    const check = path.join(BUNDLE_ROOT, '.cursor/hooks/lib/check-staleness.mjs');
    const r = spawnSync(process.execPath, [check, tmp], { encoding: 'utf8' });
    const out = JSON.parse(r.stdout.trim());
    assert.equal(out.fresh, false);
    assert.equal(out.reason, 'missing_embeddings');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('GITNEXUS_NPM_SCRIPTS includes agent-brief', async () => {
    const { GITNEXUS_NPM_SCRIPTS } = await import('./kit.mjs');
    assert.ok(GITNEXUS_NPM_SCRIPTS['gitnexus:agent-brief']);
  });
});
