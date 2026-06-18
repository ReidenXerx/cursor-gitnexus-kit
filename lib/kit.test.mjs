import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync, spawnSync } from 'node:child_process';
import {
  listBundleFiles,
  substituteRepoName,
  PLACEHOLDER,
  BUNDLE_ROOT,
  GITIGNORE_MARKER,
} from './kit.mjs';

/** Create a tmp git repo with hook files copied and a fresh|stale .gitnexus/meta.json. */
function setupKitRepo({ fresh = true } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-kit-'));
  execSync('git init -q', { cwd: tmp });
  execSync('git config user.email test@test.com', { cwd: tmp });
  execSync('git config user.name test', { cwd: tmp });
  fs.writeFileSync(path.join(tmp, 'f.txt'), 'x');
  execSync('git add f.txt && git commit -q -m init', { cwd: tmp, shell: true });
  const head = execSync('git rev-parse HEAD', { cwd: tmp, encoding: 'utf8' }).trim();

  fs.mkdirSync(path.join(tmp, '.gitnexus'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, '.gitnexus/meta.json'),
    JSON.stringify({ lastCommit: fresh ? head : 'deadbeef', stats: { nodes: 50, embeddings: 50 } })
  );

  fs.mkdirSync(path.join(tmp, '.cursor/hooks/lib'), { recursive: true });
  const hooks = [
    'gitnexus-edit-guard.sh',
    'gitnexus-commit-guard.sh',
    'lib/first-nudge.mjs',
    'lib/load-staleness.mjs',
    'lib/check-staleness.mjs',
    'lib/hook-helpers.mjs',
    'lib/cypher-helpers.mjs',
    'lib/rename-helpers.mjs',
    'lib/stale-policy.mjs',
    'lib/session-primer.mjs',
  ];
  for (const rel of hooks) {
    fs.copyFileSync(
      path.join(BUNDLE_ROOT, '.cursor/hooks', rel),
      path.join(tmp, '.cursor/hooks', rel)
    );
  }
  fs.chmodSync(path.join(tmp, '.cursor/hooks/gitnexus-edit-guard.sh'), 0o755);
  fs.chmodSync(path.join(tmp, '.cursor/hooks/gitnexus-commit-guard.sh'), 0o755);
  return tmp;
}

function runHook(tmp, script, input) {
  const r = spawnSync('bash', [path.join(tmp, '.cursor/hooks', script)], {
    cwd: tmp,
    input: JSON.stringify(input),
    encoding: 'utf8',
  });
  return JSON.parse((r.stdout || '{}').trim() || '{}');
}

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
    assert.ok(files.includes('docs/GITNEXUS-CURSOR-GUIDE.md'));
    assert.ok(files.includes('scripts/gitnexus-teaching/merge-package-scripts.mjs'));
    assert.ok(!files.includes('.claude/skills/agent-region/SKILL.md'));
    assert.ok(!files.includes('scripts/gitnexus-teaching/generate-regions.mjs'));
  });

  it('bundle includes agent reasoning shortcuts', () => {
    const files = listBundleFiles();
    assert.ok(files.includes('.cursor/hooks/lib/hook-helpers.mjs'));
    assert.ok(files.includes('.cursor/hooks/lib/cypher-helpers.mjs'));
    assert.ok(files.includes('.cursor/hooks/lib/rename-helpers.mjs'));
    assert.ok(files.includes('.cursor/hooks/lib/detect-api-router.mjs'));
    assert.ok(files.includes('.cursor/hooks/lib/graph-smoke.mjs'));
    assert.ok(files.includes('.cursor/hooks/lib/agent-brief.mjs'));
    assert.ok(files.includes('.cursor/hooks/lib/agent-health.mjs'));
    assert.ok(files.includes('.cursor/hooks/lib/session-health-audit.mjs'));
    assert.ok(files.includes('.cursor/hooks/gitnexus-session-health.sh'));
    assert.ok(files.includes('.cursor/hooks/gitnexus-session-health-user.sh'));
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
    const widened = helpers.mcpImpact('Foo', 'r', { relationTypes: ['CALLS', 'ACCESSES'] });
    assert.ok(widened.includes('relationTypes: ["CALLS", "ACCESSES"]'));
    const full = helpers.hookAgentMessage('/tmp/gn-test-deny', 'k1', 'FULL', 'SHORT');
    assert.equal(full, 'FULL');
    const again = helpers.hookAgentMessage('/tmp/gn-test-deny', 'k1', 'FULL', 'SHORT');
    assert.equal(again, 'FULL');
    helpers.clearDenyCache('/tmp/gn-test-deny');
    const msg = helpers.userMessage('block.grep.symbol', { symbol: 'fooBar' });
    assert.ok(msg.includes('fooBar'));
    assert.ok(msg.includes('GitNexus'));
  });

  it('cypher-helpers builds field access and call chain queries', async () => {
    const cypher = await import(
      new URL('../bundle/.cursor/hooks/lib/cypher-helpers.mjs', import.meta.url).href
    );
    assert.ok(cypher.isLikelyFieldName('address'));
    assert.ok(!cypher.isLikelyFieldName('UserService'));
    assert.ok(!cypher.isLikelyFieldName('const'));
    const field = cypher.cypherFieldAccess('address', 'my-repo');
    assert.ok(field.includes('gitnexus_cypher'));
    assert.ok(field.includes('ACCESSES'));
    assert.ok(field.includes('address'));
    const chain = cypher.cypherCallChain('validatePayment', 'my-repo', 3);
    assert.ok(chain.includes('CALLS'));
    assert.ok(chain.includes('validatePayment'));
    assert.ok(cypher.mcpReadSchema('r').includes('/schema'));
    const pb = cypher.playbookCypherForHint({ fieldHint: 'token', fieldRead: true }, 'r');
    assert.ok(pb.includes('PLAYBOOK'));
    assert.ok(pb.includes('ACCESSES'));
  });

  it('rename-helpers and data-flow detection', async () => {
    const rename = await import(
      new URL('../bundle/.cursor/hooks/lib/rename-helpers.mjs', import.meta.url).href
    );
    const cypher = await import(
      new URL('../bundle/.cursor/hooks/lib/cypher-helpers.mjs', import.meta.url).href
    );
    const parsed = rename.parseRenameFromPrompt('rename validateUser to authenticateUser');
    assert.equal(parsed?.oldName, 'validateUser');
    assert.equal(parsed?.newName, 'authenticateUser');
    const pair = rename.detectIdentifierRename('fooBar', 'bazQux');
    assert.equal(pair?.oldName, 'fooBar');
    assert.ok(rename.mcpRename('A', 'B', 'r').includes('dry_run: true'));
    assert.ok(cypher.isDataFlowReadContext({ dataFlow: true }, 'src/foo.js'));
    assert.ok(cypher.isDataFlowReadContext({}, 'src/models/User.ts'));
  });

  it('detect-api-router writes profile from heuristics', async () => {
    const { detectApiRouterProfile, writeApiRouterProfile, API_PROFILE_FILE } = await import(
      new URL('../bundle/.cursor/hooks/lib/detect-api-router.mjs', import.meta.url).href
    );
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-api-'));
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'src', 'server.js'),
      "import express from 'express';\nconst app = express();\napp.get('/api', handler);\n"
    );
    const p = detectApiRouterProfile(tmp, 'test-repo');
    assert.ok(['framework-likely', 'framework', 'unknown'].includes(p.profile));
    writeApiRouterProfile(tmp, 'test-repo');
    assert.ok(fs.existsSync(path.join(tmp, API_PROFILE_FILE)));
    fs.rmSync(tmp, { recursive: true, force: true });
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
    assert.ok(rule.includes('every task'));
    assert.ok(rule.includes('not a fallback when code is unfamiliar'));
    assert.ok(rule.includes('cypher'));
    assert.ok(rule.includes('ACCESSES'));
    assert.ok(rule.includes('rename dry_run'));
    assert.ok(rule.includes('Stale loop'));
    assert.ok(rule.includes('refresh failed'));
  });

  it('stale policy requires refresh before classical fallback', async () => {
    const { evaluateStalePolicy } = await import(
      new URL('../bundle/.cursor/hooks/lib/stale-policy.mjs', import.meta.url).href
    );
    const session = await import(
      new URL('../bundle/.cursor/hooks/lib/session-primer.mjs', import.meta.url).href
    );
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-stale-policy-'));
    const stale = { fresh: false, reason: 'behind', detail: 'test' };

    assert.equal(evaluateStalePolicy(stale, tmp).phase, 'must_refresh');
    assert.equal(evaluateStalePolicy(stale, tmp).allowClassical, false);

    session.setRefreshFailed(tmp, true, 'refresh failed');
    assert.equal(evaluateStalePolicy(stale, tmp).phase, 'classical_fallback');
    assert.equal(evaluateStalePolicy(stale, tmp).allowClassical, true);

    session.setRefreshFailed(tmp, false);
    assert.equal(evaluateStalePolicy({ fresh: true }, tmp).phase, 'fresh');

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('shell staleness guard denies non-git shell when stale', async () => {
    const { spawnSync, execSync } = await import('node:child_process');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-shell-guard-'));
    execSync('git init -q', { cwd: tmp });
    execSync('git config user.email test@test.com', { cwd: tmp });
    execSync('git config user.name test', { cwd: tmp });
    fs.writeFileSync(path.join(tmp, 'f.txt'), 'x');
    execSync('git add f.txt && git commit -q -m init', { cwd: tmp, shell: true });
    const head = execSync('git rev-parse HEAD', { cwd: tmp, encoding: 'utf8' }).trim();
    fs.mkdirSync(path.join(tmp, '.gitnexus'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.gitnexus/meta.json'),
      JSON.stringify({ lastCommit: 'deadbeef', stats: { nodes: 10, embeddings: 10 } })
    );
    fs.mkdirSync(path.join(tmp, '.cursor/hooks'), { recursive: true });
    fs.mkdirSync(path.join(tmp, '.cursor/hooks/lib'), { recursive: true });
    for (const f of [
      'gitnexus-shell-staleness-guard.sh',
      'lib/hook-helpers.mjs',
      'lib/stale-policy.mjs',
      'lib/session-primer.mjs',
      'lib/load-staleness.mjs',
      'lib/check-staleness.mjs',
      'lib/cypher-helpers.mjs',
      'lib/rename-helpers.mjs',
      'lib/graph-session.mjs',
    ]) {
      const src = f.startsWith('lib/')
        ? path.join(BUNDLE_ROOT, '.cursor/hooks', f)
        : path.join(BUNDLE_ROOT, '.cursor/hooks', f);
      fs.copyFileSync(src, path.join(tmp, '.cursor/hooks', f.replace(/^lib\//, 'lib/')));
    }
    fs.chmodSync(path.join(tmp, '.cursor/hooks/gitnexus-shell-staleness-guard.sh'), 0o755);
    const r = spawnSync(
      'bash',
      [path.join(tmp, '.cursor/hooks/gitnexus-shell-staleness-guard.sh')],
      {
        cwd: tmp,
        input: JSON.stringify({ command: 'pnpm test' }),
        encoding: 'utf8',
      }
    );
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout.trim());
    assert.equal(out.permission, 'deny');
    assert.ok(out.user_message);
    assert.ok(out.agent_message.includes('agent-refresh'));
    fs.rmSync(tmp, { recursive: true, force: true });
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
    assert.ok(out.detail.includes('Hooks block'));
    assert.ok(!out.detail.includes('Classical tools OK'));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('check-staleness behind message matches refresh-first hooks', async () => {
    const { spawnSync, execSync } = await import('node:child_process');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-stale-msg-'));
    execSync('git init -q', { cwd: tmp });
    execSync('git config user.email test@test.com', { cwd: tmp });
    execSync('git config user.name test', { cwd: tmp });
    fs.writeFileSync(path.join(tmp, 'f.txt'), 'v1');
    execSync('git add f.txt && git commit -q -m v1', { cwd: tmp, shell: true });
    const old = execSync('git rev-parse HEAD', { cwd: tmp, encoding: 'utf8' }).trim();
    fs.writeFileSync(path.join(tmp, 'f.txt'), 'v2');
    execSync('git add f.txt && git commit -q -m v2', { cwd: tmp, shell: true });
    fs.mkdirSync(path.join(tmp, '.gitnexus'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.gitnexus/meta.json'),
      JSON.stringify({ lastCommit: old, stats: { nodes: 10, embeddings: 10 } })
    );
    const check = path.join(BUNDLE_ROOT, '.cursor/hooks/lib/check-staleness.mjs');
    const r = spawnSync(process.execPath, [check, tmp], { encoding: 'utf8' });
    const out = JSON.parse(r.stdout.trim());
    assert.equal(out.fresh, false);
    assert.equal(out.reason, 'behind');
    assert.ok(out.detail.includes('Hooks block'));
    assert.ok(!/Classical tools OK/i.test(out.detail));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('GITNEXUS_NPM_SCRIPTS includes agent-brief and health', async () => {
    const { GITNEXUS_NPM_SCRIPTS } = await import('./kit.mjs');
    assert.ok(GITNEXUS_NPM_SCRIPTS['gitnexus:agent-brief']);
    assert.ok(GITNEXUS_NPM_SCRIPTS['gitnexus:health']);
    assert.ok(GITNEXUS_NPM_SCRIPTS['gitnexus:graph-smoke']);
    assert.ok(GITNEXUS_NPM_SCRIPTS['gitnexus:detect-api']);
    assert.ok(GITNEXUS_NPM_SCRIPTS['gitnexus:verify']);
  });

  it('script-gates injects gate comment entries for package.json', async () => {
    const { buildGatedScripts, allManagedScriptKeys, gateCommentKey, GITNEXUS_SCRIPT_GATES } =
      await import('../bundle/scripts/gitnexus-teaching/script-gates.mjs');
    const gated = buildGatedScripts();
    assert.ok(gated['gitnexus.__gate.1.session']);
    assert.ok(gated['gitnexus:verify']);
    assert.ok(allManagedScriptKeys().length > Object.keys(gated).filter((k) => !k.includes('__gate')).length);
    for (const g of GITNEXUS_SCRIPT_GATES) {
      assert.ok(gated[gateCommentKey(g)]);
    }
  });

  it('bundle includes install polish and verification helpers', () => {
    const files = listBundleFiles();
    assert.ok(files.includes('scripts/gitnexus-teaching/script-gates.mjs'));
    assert.ok(files.includes('scripts/gitnexus-gate-hint.mjs'));
    assert.ok(files.includes('scripts/lib/setup-ui.mjs'));
    assert.ok(files.includes('.cursor/hooks/lib/verify-kit.mjs'));
  });

  it('verify-kit reports missing files on empty repo', async () => {
    const { verifyKitInstall } = await import(
      new URL('../bundle/.cursor/hooks/lib/verify-kit.mjs', import.meta.url).href
    );
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-verify-'));
    const report = verifyKitInstall(tmp);
    assert.equal(report.healthy, false);
    assert.ok(report.failed > 0);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('agent-health prints human summary', async () => {
    const { spawnSync, execSync } = await import('node:child_process');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-health-'));
    execSync('git init -q', { cwd: tmp });
    execSync('git config user.email test@test.com', { cwd: tmp });
    execSync('git config user.name test', { cwd: tmp });
    fs.writeFileSync(path.join(tmp, 'f.txt'), 'x');
    execSync('git add f.txt && git commit -q -m init', { cwd: tmp, shell: true });
    const head = execSync('git rev-parse HEAD', { cwd: tmp, encoding: 'utf8' }).trim();
    fs.mkdirSync(path.join(tmp, '.gitnexus'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.gitnexus/meta.json'),
      JSON.stringify({ lastCommit: head, stats: { nodes: 10, embeddings: 10, processes: 2, communities: 1 } })
    );
    fs.mkdirSync(path.join(tmp, '.cursor/hooks/lib'), { recursive: true });
    for (const f of ['check-staleness.mjs', 'cypher-helpers.mjs', 'rename-helpers.mjs', 'hook-helpers.mjs', 'session-health-audit.mjs', 'agent-health.mjs']) {
      fs.copyFileSync(
        path.join(BUNDLE_ROOT, '.cursor/hooks/lib', f),
        path.join(tmp, '.cursor/hooks/lib', f)
      );
    }
    fs.mkdirSync(path.join(tmp, '.cursor'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.cursor/hooks.json'), JSON.stringify({ hooks: { sessionStart: [{}], preToolUse: [{}] } }));
    fs.writeFileSync(path.join(tmp, '.cursor/mcp.json'), JSON.stringify({ mcpServers: { gitnexus: {} } }));
    const health = path.join(tmp, '.cursor/hooks/lib/agent-health.mjs');
    const r = spawnSync(process.execPath, [health, tmp], { encoding: 'utf8' });
    assert.ok(r.stdout.includes('GitNexus Cursor Kit'));
    assert.ok(r.stdout.includes('Cypher'));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('bundle has no source-repo domain leakage', () => {
    const denylist = [
      'handleRequest',
      'isKnownApiPath',
      'researchApi',
      'research-dashboard',
      'research/presets',
      'research/profiles',
      'stablePairScanner',
      'runStablePairScanWorkflow',
      'resolveFilters',
      'resolveSelectionFilters',
      'scannerOptions',
      'strategyId',
      'crypto-trading-bot',
      'OHLCV',
      'stable pair',
    ];
    const textExt = /\.(md|mdc|sh|mjs|js|json|txt|yml|yaml|gitnexusignore)$/;
    const offenders = [];
    for (const rel of listBundleFiles()) {
      if (!textExt.test(rel)) continue;
      const content = fs.readFileSync(path.join(BUNDLE_ROOT, rel), 'utf8');
      for (const token of denylist) {
        if (content.includes(token)) offenders.push(`${rel} → ${token}`);
      }
    }
    assert.deepEqual(offenders, [], `domain leakage found:\n${offenders.join('\n')}`);
  });

  it('hook config enforces polyglot source extensions', async () => {
    const helpers = await import(
      new URL('../bundle/.cursor/hooks/lib/hook-helpers.mjs', import.meta.url).href
    );
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-poly-'));
    const config = helpers.loadHookConfig(tmp);
    assert.ok(helpers.isSourceCodePath('src/app.py', config), 'python should count as source');
    assert.ok(helpers.isSourceCodePath('src/main.rs', config), 'rust should count as source');
    assert.ok(helpers.isSourceCodePath('lib/Foo.go', config), 'go should count as source');
    assert.equal(helpers.editSensitivity('src/app.py', config), 'full');
    assert.equal(helpers.editSensitivity('src/main.rs', config), 'full');
    // Custom override narrows the set.
    fs.mkdirSync(path.join(tmp, '.cursor'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.cursor/gitnexus-hooks.json'),
      JSON.stringify({ sourceExts: ['js'] })
    );
    const narrowed = helpers.loadHookConfig(tmp);
    assert.ok(!helpers.isSourceCodePath('src/app.py', narrowed), 'override should exclude python');
    assert.ok(helpers.isSourceCodePath('src/app.js', narrowed));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('cypher field access matches Methods (untyped source node)', async () => {
    const cypher = await import(
      new URL('../bundle/.cursor/hooks/lib/cypher-helpers.mjs', import.meta.url).href
    );
    const q = cypher.cypherFieldAccess('balance', 'r');
    assert.ok(!q.includes('(f:Function)'), 'source node should be untyped for polyglot');
    assert.ok(q.includes('ACCESSES'));
    assert.ok(q.includes('f.kind'));
  });

  it('staleness load caches result within TTL', async () => {
    const tmp = setupKitRepo({ fresh: true });
    const load = path.join(tmp, '.cursor/hooks/lib/load-staleness.mjs');
    const first = spawnSync(process.execPath, [load, tmp], { encoding: 'utf8' });
    assert.equal(JSON.parse(first.stdout.trim()).fresh, true);
    const cacheFile = path.join(tmp, '.cursor/.gitnexus-staleness-cache.json');
    assert.ok(fs.existsSync(cacheFile), 'cache file written after first load');
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    assert.equal(cached.data.fresh, true);
    assert.ok(typeof cached.at === 'number');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('edit-guard enforces impact-before-edit when fresh', async () => {
    const tmp = setupKitRepo({ fresh: true });
    const session = await import(
      new URL('../bundle/.cursor/hooks/lib/session-primer.mjs', import.meta.url).href
    );

    const denied = runHook(tmp, 'gitnexus-edit-guard.sh', {
      tool_name: 'StrReplace',
      tool_input: { path: 'src/foo.js', old_string: 'a()', new_string: 'b()' },
    });
    assert.equal(denied.permission, 'deny');
    assert.ok(/IMPACT GATE/.test(denied.agent_message));

    session.setMcpToolUsed(tmp, 'gitnexus_impact');
    assert.ok(session.isImpactUsed(tmp));
    const allowed = runHook(tmp, 'gitnexus-edit-guard.sh', {
      tool_name: 'StrReplace',
      tool_input: { path: 'src/foo.js', old_string: 'a()', new_string: 'b()' },
    });
    assert.equal(allowed.permission, 'allow');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('commit-guard requires detect_changes before commit when fresh', async () => {
    const tmp = setupKitRepo({ fresh: true });
    const session = await import(
      new URL('../bundle/.cursor/hooks/lib/session-primer.mjs', import.meta.url).href
    );

    const denied = runHook(tmp, 'gitnexus-commit-guard.sh', { command: 'git commit -m wip' });
    assert.equal(denied.permission, 'deny');
    assert.ok(/COMMIT GATE/.test(denied.agent_message));

    // --help is never gated.
    const help = runHook(tmp, 'gitnexus-commit-guard.sh', { command: 'git commit --help' });
    assert.equal(help.permission, 'allow');

    session.setMcpToolUsed(tmp, 'gitnexus_detect_changes');
    assert.ok(session.isDetectUsed(tmp));
    const allowed = runHook(tmp, 'gitnexus-commit-guard.sh', { command: 'git commit -m wip' });
    assert.equal(allowed.permission, 'allow');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('edit-guard blocks source edits when stale (unified, no grace shortcut)', async () => {
    const tmp = setupKitRepo({ fresh: false });
    const denied = runHook(tmp, 'gitnexus-edit-guard.sh', {
      tool_name: 'Write',
      tool_input: { path: 'src/foo.js', file_path: 'src/foo.js' },
    });
    assert.equal(denied.permission, 'deny');
    assert.ok(/STALENESS GATE/.test(denied.agent_message));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('session scorecard counts enforcement events', async () => {
    const session = await import(
      new URL('../bundle/.cursor/hooks/lib/session-primer.mjs', import.meta.url).href
    );
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-score-'));
    session.bumpScore(tmp, 'grepRedirects');
    session.bumpScore(tmp, 'grepRedirects');
    session.bumpScore(tmp, 'impactGate');
    const card = session.readScorecard(tmp);
    assert.equal(card.counts.grepRedirects, 2);
    assert.equal(card.counts.impactGate, 1);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('script-gates include review, doctor, scorecard commands', async () => {
    const { flatGitnexusScripts } = await import(
      '../bundle/scripts/gitnexus-teaching/script-gates.mjs'
    );
    const s = flatGitnexusScripts();
    assert.ok(s['gitnexus:doctor']);
    assert.ok(s['gitnexus:scorecard']);
    assert.ok(s['gitnexus:agent-review']);
    assert.ok(s['gitnexus:map']);
    assert.ok(s['gitnexus:commit-msg']);
    assert.ok(s['gitnexus:ci']);
  });

  it('cypher-cli parses tables, counts, and JSON', async () => {
    const { parseRows, parseCount, firstColumn } = await import(
      new URL('../bundle/.cursor/hooks/lib/cypher-cli.mjs', import.meta.url).href
    );
    const rows = parseRows('| label | n |\n| --- | --- |\n| Auth | 12 |\n| Store | 7 |');
    assert.deepEqual(rows, [['Auth', '12'], ['Store', '7']]);
    assert.deepEqual(firstColumn(rows), ['Auth', 'Store']);
    assert.equal(parseCount('count(caller)\n9'), 9);
    assert.deepEqual(parseRows('[{"a":"X","b":2}]'), [['X', '2']]);
    assert.deepEqual(parseRows(''), []);
  });

  it('commit-message drafts a template offline (no staged code)', async () => {
    const { draftCommitMessage } = await import(
      new URL('../bundle/.cursor/hooks/lib/commit-message.mjs', import.meta.url).href
    );
    const tmp = setupKitRepo({ fresh: true });
    const { message } = draftCommitMessage(tmp, 'x');
    assert.ok(message.includes('<type>'));
    assert.ok(message.includes('No staged code files'));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('generate-arch-doc writes stats doc from meta.json', async () => {
    const { generateArchDoc, ARCH_DOC_PATH } = await import(
      new URL('../bundle/.cursor/hooks/lib/generate-arch-doc.mjs', import.meta.url).href
    );
    const tmp = setupKitRepo({ fresh: true });
    const res = generateArchDoc(tmp, 'demo-repo', { ...process.env, PATH: '' });
    assert.ok(res.written, `expected doc written, got ${JSON.stringify(res)}`);
    const doc = fs.readFileSync(path.join(tmp, ARCH_DOC_PATH), 'utf8');
    assert.ok(doc.includes('# Architecture — demo-repo'));
    assert.ok(doc.includes('Graph at a glance'));
    assert.ok(doc.includes('| Symbols | 50 |'));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('arch-doc reports reason when no index present', async () => {
    const { generateArchDoc } = await import(
      new URL('../bundle/.cursor/hooks/lib/generate-arch-doc.mjs', import.meta.url).href
    );
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-noidx-'));
    const res = generateArchDoc(tmp, 'x');
    assert.equal(res.written, false);
    assert.ok(/meta\.json/.test(res.reason));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('eval harness loads and validates task specs', async () => {
    const { loadTasks, validateTask } = await import(
      new URL('../eval/run-eval.mjs', import.meta.url).href
    );
    const tasks = loadTasks();
    assert.ok(tasks.length >= 3, `expected eval tasks, got ${tasks.length}`);
    for (const t of tasks) assert.deepEqual(validateTask(t), []);
    assert.deepEqual(validateTask({ id: 'x' }), ['missing "title"', 'missing "prompt"']);
  });

  it('session-health-audit builds agent context and user message', async () => {
    const auditMod = await import(
      new URL('../bundle/.cursor/hooks/lib/session-health-audit.mjs', import.meta.url).href
    );
    const ctx = auditMod.agentContextForSession({
      repo: 'demo',
      healthy: true,
      checks: [{ id: 'hooks', ok: true }],
    });
    assert.ok(ctx.includes('SESSION HEALTH'));
    assert.ok(ctx.includes('agent-status'));
    const msg = auditMod.userMessageForSession({ healthy: true, stale: {} });
    assert.ok(msg.includes('GitNexus kit'));
  });
});
