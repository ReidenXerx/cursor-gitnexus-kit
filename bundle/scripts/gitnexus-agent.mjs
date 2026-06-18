#!/usr/bin/env node
/**
 * Agent-facing GitNexus maintenance CLI (no MCP required).
 * Usage: node scripts/gitnexus-agent.mjs status|refresh|brief|health|verify|doctor|review [base]|scorecard|graph-smoke|detect-api
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const { withProjectTmpEnv, tmpSpaceReport, enospcHelp } = await import(
  pathToFileURL(path.join(ROOT, 'scripts/lib/project-tmp.mjs')).href
);

function loadStaleness() {
  const r = spawnSync(process.execPath, [path.join(ROOT, '.cursor/hooks/lib/check-staleness.mjs'), ROOT], {
    encoding: 'utf8',
    env: withProjectTmpEnv(ROOT),
  });
  try {
    return JSON.parse(r.stdout.trim() || '{}');
  } catch {
    return { fresh: false, reason: 'check_failed', detail: r.stderr || 'staleness check failed' };
  }
}

function run(cmd, args, opts = {}) {
  const env = withProjectTmpEnv(ROOT, opts.env);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', ...opts, env });
  if (r.error?.code === 'ENOSPC') {
    console.error('\n' + enospcHelp(ROOT));
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const cmd = process.argv[2] ?? 'status';

if (cmd === 'status') {
  const stale = loadStaleness();
  const systemTmp = tmpSpaceReport(ROOT);
  if (stale.fresh) {
    console.log('GitNexus index: fresh (matches HEAD)');
    console.log(`  indexed: ${(stale.indexedCommit || '').slice(0, 7)} @ ${stale.indexedAt ?? '?'}`);
    if ((stale.embeddingCount ?? 0) > 0) {
      console.log(`  embeddings: ${stale.embeddingCount} vectors`);
    }
    console.log(systemTmp);
    process.exit(0);
  }
  console.log('GitNexus index: STALE — graph and/or embeddings may be wrong');
  console.log(`  ${stale.detail || stale.reason}`);
  if (stale.reason === 'missing_embeddings') {
    console.log('  embeddings: missing — agent-refresh runs analyze --embeddings');
  }
  console.log('  Fix: npm run gitnexus:agent-refresh');
  console.log(systemTmp);
  process.exit(1);
}

function markRefreshOutcome(success, detail = '') {
  const setPending = path.join(ROOT, '.cursor/hooks/lib/set-refresh-pending.mjs');
  spawnSync(process.execPath, [setPending, ROOT, success ? 'clear' : 'set-failed', detail], {
    cwd: ROOT,
    stdio: 'ignore',
    env: withProjectTmpEnv(ROOT),
  });
  // Invalidate the short-TTL staleness cache so the next tool call sees fresh state.
  try {
    fs.unlinkSync(path.join(ROOT, '.cursor/.gitnexus-staleness-cache.json'));
  } catch {
    /* ignore */
  }
}

if (cmd === 'refresh') {
  console.log('==> GitNexus agent refresh (analyze + sync teaching bundle)');
  console.log(tmpSpaceReport(ROOT));
  try {
    run('npm', ['run', 'gitnexus:refresh'], { stdio: 'inherit' });
    if (fs.existsSync(path.join(ROOT, 'scripts/sync-cursor-gitnexus-teaching.sh'))) {
      run('bash', ['scripts/sync-cursor-gitnexus-teaching.sh'], { stdio: 'inherit' });
    }
  } catch (err) {
    console.error('\n' + enospcHelp(ROOT));
    markRefreshOutcome(false, 'agent-refresh failed (ENOSPC or command error)');
    process.exit(1);
  }
  const stale = loadStaleness();
  if (stale.fresh) {
    console.log('==> Index fresh after refresh');
    markRefreshOutcome(true);
    process.exit(0);
  }
  console.error('==> Refresh finished but index still not fresh — check git state');
  markRefreshOutcome(false, 'agent-refresh finished but index still stale');
  process.exit(1);
}

if (cmd === 'brief') {
  const r = spawnSync(process.execPath, [path.join(ROOT, '.cursor/hooks/lib/agent-brief.mjs'), ROOT], {
    encoding: 'utf8',
    env: withProjectTmpEnv(ROOT),
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  process.exit(r.status ?? 1);
}

if (cmd === 'health') {
  const r = spawnSync(process.execPath, [path.join(ROOT, '.cursor/hooks/lib/agent-health.mjs'), ROOT], {
    encoding: 'utf8',
    env: withProjectTmpEnv(ROOT),
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  process.exit(r.status ?? 0);
}

if (cmd === 'graph-smoke') {
  const r = spawnSync(process.execPath, [path.join(ROOT, '.cursor/hooks/lib/graph-smoke.mjs'), ROOT], {
    encoding: 'utf8',
    env: withProjectTmpEnv(ROOT),
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  process.exit(r.status ?? 1);
}

if (cmd === 'detect-api') {
  const { writeApiRouterProfile } = await import(
    pathToFileURL(path.join(ROOT, '.cursor/hooks/lib/detect-api-router.mjs')).href
  );
  const profile = writeApiRouterProfile(ROOT);
  console.log(`API router profile: ${profile.profile} (Route nodes: ${profile.routeNodes ?? 'n/a'})`);
  console.log(`  → ${profile.recommendation}`);
  if (profile.sourceSignals.customSymbols.length) {
    console.log(`  custom symbols: ${profile.sourceSignals.customSymbols.join(', ')}`);
  }
  process.exit(0);
}

if (cmd === 'verify') {
  const verifyPath = path.join(ROOT, '.cursor/hooks/lib/verify-kit.mjs');
  const r = spawnSync(process.execPath, [verifyPath, ROOT, ...process.argv.slice(3)], {
    cwd: ROOT,
    stdio: 'inherit',
    env: withProjectTmpEnv(ROOT),
  });
  process.exit(r.status ?? 1);
}

function git(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
}

function repoName() {
  return process.env.GITNEXUS_REPO || path.basename(ROOT);
}

function symbolFromFile(filePath) {
  const base = path.basename(filePath, path.extname(filePath));
  if (/^[A-Z]/.test(base) || base.includes('.')) return base;
  return base || null;
}

if (cmd === 'review') {
  const base = process.argv[3] || 'main';
  const repo = repoName();
  const range = `${base}...HEAD`;
  const names = git(['diff', '--name-only', range]).split('\n').filter(Boolean);
  const codeFiles = names.filter((f) => /\.(js|mjs|cjs|jsx|ts|tsx|py|rb|go|rs|java|kt|swift|php|cs|cpp|c|scala)$/i.test(f));

  const lines = [`GitNexus PR review playbook (${range})`, ''];
  if (!git(['rev-parse', '--verify', base])) {
    lines.push(`Base ref "${base}" not found — pass an existing branch: npm run gitnexus:agent-review -- <base>`);
    console.log(lines.join('\n'));
    process.exit(1);
  }
  if (!codeFiles.length) {
    lines.push(`No changed code files vs ${base}. (${names.length} non-code file(s) changed.)`);
    console.log(lines.join('\n'));
    process.exit(0);
  }

  lines.push(`Changed code files (${codeFiles.length}):`);
  for (const f of codeFiles.slice(0, 12)) lines.push(`  - ${f}`);
  if (codeFiles.length > 12) lines.push(`  … +${codeFiles.length - 12} more`);
  lines.push('');
  lines.push('1) Change scope + affected flows:');
  lines.push(`   gitnexus_detect_changes({ scope: "compare", base_ref: "${base}", repo: "${repo}" })`);
  lines.push('');
  lines.push('2) Blast radius per changed entry symbol:');
  const seen = new Set();
  for (const f of codeFiles) {
    const sym = symbolFromFile(f);
    if (!sym || seen.has(sym)) continue;
    seen.add(sym);
    lines.push(`   gitnexus_impact({ target: "${sym}", direction: "upstream", repo: "${repo}", summaryOnly: true })`);
    if (seen.size >= 12) break;
  }
  lines.push('');
  lines.push('3) Confirm affected_processes match PR intent; warn on HIGH/CRITICAL; verify tests cover them.');
  console.log(lines.join('\n'));
  process.exit(0);
}

if (cmd === 'doctor') {
  const lines = ['GitNexus doctor — backend + kit reachability', ''];
  let problems = 0;

  const mcpPath = path.join(ROOT, '.cursor/mcp.json');
  let mcpOk = false;
  try {
    mcpOk = Boolean(JSON.parse(fs.readFileSync(mcpPath, 'utf8')).mcpServers?.gitnexus);
  } catch {
    /* missing */
  }
  lines.push(`${mcpOk ? '✓' : '✗'} .cursor/mcp.json gitnexus entry`);
  if (!mcpOk) problems++;

  // Live probe of the GitNexus CLI backend (proxy for MCP server health).
  const probe = spawnSync('npx', ['-y', 'gitnexus@latest', '--version'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 60000,
    env: withProjectTmpEnv(ROOT),
  });
  const cliOk = probe.status === 0;
  lines.push(`${cliOk ? '✓' : '✗'} gitnexus CLI reachable${cliOk ? ` (${(probe.stdout || '').trim().split('\n')[0]})` : ' — npx gitnexus failed (offline? install?)'}`);
  if (!cliOk) problems++;

  const stale = loadStaleness();
  lines.push(`${stale.fresh ? '✓' : '!'} Index ${stale.fresh ? 'fresh' : `stale — ${stale.reason}`}`);

  const listProbe = cliOk
    ? spawnSync('npx', ['-y', 'gitnexus@latest', 'list'], { cwd: ROOT, encoding: 'utf8', timeout: 60000, env: withProjectTmpEnv(ROOT) })
    : { status: 1, stdout: '' };
  const listOk = listProbe.status === 0;
  lines.push(`${listOk ? '✓' : '!'} Repo registry query ${listOk ? 'ok' : 'unavailable'}`);

  lines.push('');
  lines.push(problems === 0
    ? 'Doctor: backend reachable. If MCP tools still fail in Cursor, restart Cursor to reload the MCP server.'
    : `Doctor: ${problems} problem(s) — fix the ✗ items above, then restart Cursor.`);
  console.log(lines.join('\n'));
  process.exit(problems === 0 ? 0 : 1);
}

if (cmd === 'scorecard') {
  const { readScorecard } = await import(
    pathToFileURL(path.join(ROOT, '.cursor/hooks/lib/session-primer.mjs')).href
  );
  const card = readScorecard(ROOT);
  const counts = card.counts ?? {};
  const labels = {
    graphCalls: 'GitNexus MCP calls',
    grepRedirects: 'Grep → graph redirects',
    readRedirects: 'Large Read → graph redirects',
    impactGate: 'Impact-before-edit gates',
    commitGate: 'detect_changes-before-commit gates',
    editStaleBlocks: 'Stale-edit blocks',
  };
  console.log('GitNexus enforcement scorecard (this session)');
  console.log(card.startedAt ? `  since ${card.startedAt}` : '  (no activity yet)');
  const keys = Object.keys(labels).filter((k) => counts[k]);
  if (!keys.length) {
    console.log('  No enforcement events yet — run some tools in a chat first.');
  } else {
    for (const k of keys) console.log(`  ${labels[k]}: ${counts[k]}`);
  }
  process.exit(0);
}

console.error(
  `Unknown command: ${cmd}. Use: status | refresh | brief | health | verify | doctor | review [base] | scorecard | graph-smoke | detect-api`
);
process.exit(2);
