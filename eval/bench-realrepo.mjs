#!/usr/bin/env node
/**
 * Real-repository benchmark: measures the kit's lift on a large, real codebase.
 *
 * READ-ONLY task → it only writes a small answer file (deleted after each trial).
 *
 *   - ON  = the ORIGINAL repo itself. It's already kit-installed + indexed, so we
 *           reuse its graph as-is — NO copy, NO re-index (we only refresh once if
 *           the index is stale). GitNexus bakes an absolute repoPath into the graph,
 *           so the indexed dir must never be moved — running in place is the only
 *           correct (and fastest) option.
 *   - OFF = a cheap, source-only copy with the kit + graph stripped, so the agent
 *           has nothing but grep/read. No indexing needed (there's no graph by
 *           design), so this copy takes seconds.
 *
 * Scoring: recall against a graph-derived ground-truth caller set baked into the
 * task spec. pass = recall >= task.threshold.
 *
 * Usage:
 *   node eval/bench-realrepo.mjs --task eval/realrepo-tasks/<task>.json --model composer-2.5-fast --trials 2
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execSync, spawn, spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const a = { task: null, model: '', trials: 2, timeoutMs: 420000 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--task') a.task = argv[++i];
    else if (argv[i] === '--model') a.model = argv[++i];
    else if (argv[i] === '--trials') a.trials = Math.max(1, Number(argv[++i]) || 1);
    else if (argv[i] === '--timeout-ms') a.timeoutMs = Number(argv[++i]) || a.timeoutMs;
  }
  return a;
}

const log = (...m) => process.stderr.write(`[bench] ${m.join(' ')}\n`);

function resolveLocalGitnexus() {
  const r = spawnSync('which', ['gitnexus'], { encoding: 'utf8' });
  return r.status === 0 ? (r.stdout || '').trim() : '';
}

/** Cheap, source-only copy with kit + graph stripped → a clean grep-only baseline. */
function prepOff(repo, offDir) {
  fs.rmSync(offDir, { recursive: true, force: true });
  fs.mkdirSync(offDir, { recursive: true });
  const excludes = [
    'node_modules',
    '.git',
    'dist',
    'build',
    '.next',
    'coverage',
    '.gitnexus',
    '.cursor',
    '.turbo',
    '.nx',
    'out',
  ];
  const args = ['-a', ...excludes.flatMap((e) => ['--exclude', e]), `${repo}/`, `${offDir}/`];
  const r = spawnSync('rsync', args, { stdio: 'ignore' });
  if (r.status !== 0) throw new Error('rsync failed');
}

/** True when the original's graph is up to date with HEAD (no refresh needed). */
function isFresh(repo) {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(repo, '.gitnexus/meta.json'), 'utf8'));
    const head = execSync('git rev-parse HEAD', {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return Boolean(meta.lastCommit) && meta.lastCommit === head;
  } catch {
    return false;
  }
}

/** Ensure the ORIGINAL repo has a fresh graph — index/refresh in place only if needed. */
function ensureIndexed(repo) {
  const hasGraph = fs.existsSync(path.join(repo, '.gitnexus/meta.json'));
  if (hasGraph && isFresh(repo)) {
    log('ON = original repo: graph already fresh — reusing as-is (no copy, no re-index) ✓');
    return;
  }
  log(hasGraph ? 'ON: original graph stale — refreshing once in place …' : 'ON: original not indexed — indexing once in place …');
  const bin = resolveLocalGitnexus();
  const idxCmd = bin || 'npx';
  const idxArgs = bin ? ['analyze', '--embeddings'] : ['-y', 'gitnexus@latest', 'analyze', '--embeddings'];
  const idx = spawnSync(idxCmd, idxArgs, { cwd: repo, stdio: 'ignore', timeout: 900000 });
  if (idx.status !== 0) log('WARNING: indexing failed — ON degraded');
}

function runAgent(ws, prompt, model, timeoutMs) {
  return new Promise((resolve) => {
    const streamFile = path.join(os.tmpdir(), `gn-bench-stream-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
    const fd = fs.openSync(streamFile, 'w');
    const args = ['-p', '--output-format', 'stream-json', '--force', '--trust', '--approve-mcps', '--workspace', ws];
    if (model) args.push('--model', model);
    args.push(prompt);
    const child = spawn('cursor-agent', args, { cwd: ws, stdio: ['ignore', fd, 'inherit'] });
    let killed = false;
    const killer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.on('exit', () => {
      clearTimeout(killer);
      try {
        fs.closeSync(fd);
      } catch {
        /* noop */
      }
      let tokens = 0;
      try {
        const lines = fs.readFileSync(streamFile, 'utf8').split('\n').filter(Boolean);
        for (let i = lines.length - 1; i >= 0; i--) {
          if (!lines[i].includes('usage')) continue;
          const o = JSON.parse(lines[i]);
          const u = o.usage || {};
          const t = (u.inputTokens || 0) + (u.outputTokens || 0);
          if (t > 0 || o.type === 'result') {
            tokens = t;
            break;
          }
        }
      } catch {
        /* noop */
      }
      fs.rmSync(streamFile, { force: true });
      resolve({ tokens, killed });
    });
  });
}

function readAnswer(ws, task) {
  try {
    return fs.readFileSync(path.join(ws, task.answerFile), 'utf8');
  } catch {
    return '';
  }
}

/**
 * Path-mode scoring (precision/recall/F1). Robustly extracts repo-relative paths
 * from the answer (even from prose) and compares as a set against ground truth.
 * Paths keep their clients/web vs clients/desktop prefix, so a vague basename
 * (which can't disambiguate the mirror packages) never scores a true positive.
 */
function scorePath(raw, task) {
  const truth = new Set(task.groundTruth.map((s) => s.toLowerCase()));
  const re = /[\w./@-]*clients\/(?:web|desktop)\/[\w./-]+\.(?:tsx?|jsx?)/gi;
  const answered = new Set();
  for (const m of raw.matchAll(re)) {
    const norm = m[0].slice(m[0].indexOf('clients/')).toLowerCase();
    answered.add(norm);
  }
  let tp = 0;
  for (const a of answered) if (truth.has(a)) tp++;
  const precision = answered.size ? tp / answered.size : 0;
  const recall = truth.size ? tp / truth.size : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1, tp, answered: answered.size, total: truth.size };
}

/** Name-mode scoring (recall only) — kept for simpler tasks. */
function scoreName(raw, task) {
  const truth = task.groundTruth.map((s) => s.toLowerCase());
  const names = new Set(
    raw
      .split(/[\s,]+/)
      .map((s) => s.replace(/[`'"()]/g, '').trim().toLowerCase())
      .filter(Boolean)
  );
  const found = truth.filter((t) => names.has(t)).length;
  const recall = found / truth.length;
  return { precision: recall, recall, f1: recall, tp: found, answered: names.size, total: truth.length };
}

function scoreAnswer(ws, task) {
  const raw = readAnswer(ws, task);
  if (!raw) return { precision: 0, recall: 0, f1: 0, tp: 0, answered: 0, total: task.groundTruth.length };
  return task.scoreBy === 'path' ? scorePath(raw, task) : scoreName(raw, task);
}

async function trials(ws, task, model, n, timeoutMs, label) {
  const metric = task.scoreMetric || (task.scoreBy === 'path' ? 'f1' : 'recall');
  let passes = 0;
  let pSum = 0;
  let rSum = 0;
  let fSum = 0;
  let tokenSum = 0;
  let tokenRuns = 0;
  for (let i = 0; i < n; i++) {
    fs.rmSync(path.join(ws, task.answerFile), { force: true });
    const { tokens } = await runAgent(ws, task.prompt, model, timeoutMs);
    const s = scoreAnswer(ws, task);
    const score = s[metric];
    const pass = score >= task.threshold;
    if (pass) passes++;
    pSum += s.precision;
    rSum += s.recall;
    fSum += s.f1;
    if (tokens > 0) {
      tokenSum += tokens;
      tokenRuns++;
    }
    log(
      `${label} trial ${i + 1}/${n}: ${metric}=${(score * 100).toFixed(0)}% ` +
        `(P=${(s.precision * 100).toFixed(0)}% R=${(s.recall * 100).toFixed(0)}% tp=${s.tp}/${s.total} answered=${s.answered}) tokens=${tokens}`
    );
  }
  return {
    passes,
    n,
    metric,
    avgPrecision: pSum / n,
    avgRecall: rSum / n,
    avgF1: fSum / n,
    avgTokens: tokenRuns ? Math.round(tokenSum / tokenRuns) : 0,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.task) {
    console.error('Usage: node eval/bench-realrepo.mjs --task <task.json> [--model M] [--trials N]');
    process.exit(1);
  }
  const task = JSON.parse(fs.readFileSync(path.resolve(args.task), 'utf8'));
  if (!fs.existsSync(task.repo)) {
    console.error(`Repo not found: ${task.repo}`);
    process.exit(1);
  }

  const onDir = path.resolve(task.repo);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-bench-off-'));
  const offDir = path.join(tmp, 'off');

  try {
    log('preparing OFF baseline (source-only copy, no kit/graph) …');
    prepOff(task.repo, offDir);
    ensureIndexed(onDir);

    log(`running OFF (${args.trials}×) …`);
    const off = await trials(offDir, task, args.model, args.trials, args.timeoutMs, 'OFF');
    log(`running ON (${args.trials}×) …`);
    const on = await trials(onDir, task, args.model, args.trials, args.timeoutMs, 'ON');

    const md = [];
    md.push('# GitNexus kit — real-repo benchmark');
    md.push('');
    md.push(`Task: ${task.title}`);
    md.push(`Repo: \`${path.basename(task.repo)}\` · Model: ${args.model || '(default)'} · Trials: ${args.trials} · ${new Date().toISOString()}`);
    md.push('');
    const metric = on.metric;
    md.push(`| Condition | Pass (${metric} ≥ ${Math.round(task.threshold * 100)}%) | Avg precision | Avg recall | Avg ${metric} | Avg tokens |`);
    md.push('| --- | --- | --- | --- | --- | --- |');
    md.push(
      `| Kit OFF (grep) | ${off.passes}/${off.n} | ${(off.avgPrecision * 100).toFixed(0)}% | ${(off.avgRecall * 100).toFixed(0)}% | ${(off.avgF1 * 100).toFixed(0)}% | ${off.avgTokens || '—'} |`
    );
    md.push(
      `| Kit ON (graph) | ${on.passes}/${on.n} | ${(on.avgPrecision * 100).toFixed(0)}% | ${(on.avgRecall * 100).toFixed(0)}% | ${(on.avgF1 * 100).toFixed(0)}% | ${on.avgTokens || '—'} |`
    );
    md.push('');
    md.push(`Ground truth: ${task.groundTruth.length} files (graph-derived closure, depth ≤ 2).`);
    md.push('');
    const outPath = path.join(HERE, 'BENCHMARK-realrepo.md');
    fs.writeFileSync(outPath, md.join('\n') + '\n');

    console.log('\n' + md.join('\n'));
    console.log(`\nReport: ${path.relative(process.cwd(), outPath)}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(path.join(onDir, task.answerFile), { force: true });
  }
}

main().catch((e) => {
  log(`fatal: ${e.message}`);
  process.exit(1);
});
