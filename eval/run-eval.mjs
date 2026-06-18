#!/usr/bin/env node
/**
 * Budget-model eval harness — measures the kit's lift on cheaper models.
 *
 * Runs each task twice (kit ON vs kit OFF) through a pluggable agent runner,
 * then reports pass-rate and token deltas. The thesis the kit sells:
 *   "graph-first enforcement lets low-cost models perform like premium ones."
 * This harness is the reproducible proof behind that claim.
 *
 * Usage:
 *   node eval/run-eval.mjs                      # dry run (validates tasks, sample report)
 *   node eval/run-eval.mjs --runner "<cmd>"     # real run with your agent runner
 *
 * Runner contract:
 *   The command is spawned once per (task × condition). It receives:
 *     env GITNEXUS_KIT       = "on" | "off"
 *     env GITNEXUS_TASK_ID   = task id
 *     env GITNEXUS_TASK_PROMPT = the task prompt
 *     env GITNEXUS_MODEL     = model slug (from --model, optional)
 *   It MUST print a single JSON line to stdout:
 *     {"pass": true, "tokens": 12345}
 *   Anything else is treated as a failure with 0 tokens.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TASKS_DIR = path.join(HERE, 'tasks');
const REPORT_PATH = path.join(HERE, 'report.md');

function parseArgs(argv) {
  const args = { runner: null, model: null, dryRun: true };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--runner') {
      args.runner = argv[++i];
      args.dryRun = false;
    } else if (argv[i] === '--model') {
      args.model = argv[++i];
    } else if (argv[i] === '--dry-run') {
      args.dryRun = true;
    }
  }
  return args;
}

export function loadTasks() {
  if (!fs.existsSync(TASKS_DIR)) return [];
  return fs
    .readdirSync(TASKS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const task = JSON.parse(fs.readFileSync(path.join(TASKS_DIR, f), 'utf8'));
      task._file = f;
      return task;
    });
}

export function validateTask(task) {
  const errors = [];
  for (const field of ['id', 'title', 'prompt']) {
    if (!task[field] || typeof task[field] !== 'string') errors.push(`missing "${field}"`);
  }
  if (task.rubric && !Array.isArray(task.rubric)) errors.push('"rubric" must be an array');
  return errors;
}

function runCondition(runner, task, kit, model) {
  const r = spawnSync(runner, {
    shell: true,
    encoding: 'utf8',
    timeout: 600000,
    env: {
      ...process.env,
      GITNEXUS_KIT: kit,
      GITNEXUS_TASK_ID: task.id,
      GITNEXUS_TASK_PROMPT: task.prompt,
      ...(model ? { GITNEXUS_MODEL: model } : {}),
    },
  });
  try {
    const line = (r.stdout || '').trim().split('\n').filter(Boolean).pop() || '{}';
    const out = JSON.parse(line);
    return { pass: out.pass === true, tokens: Number(out.tokens) || 0 };
  } catch {
    return { pass: false, tokens: 0 };
  }
}

function pct(n, d) {
  return d ? Math.round((n / d) * 100) : 0;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const tasks = loadTasks();

  if (!tasks.length) {
    console.error(`No tasks found in ${TASKS_DIR}`);
    process.exit(1);
  }

  let hadError = false;
  for (const t of tasks) {
    const errs = validateTask(t);
    if (errs.length) {
      hadError = true;
      console.error(`✗ ${t._file}: ${errs.join('; ')}`);
    }
  }
  if (hadError) process.exit(1);

  console.log(`Loaded ${tasks.length} task(s) from ${path.relative(process.cwd(), TASKS_DIR)}`);

  if (args.dryRun) {
    console.log('\nDRY RUN — no runner provided. Task matrix:\n');
    for (const t of tasks) {
      console.log(`  • [${t.id}] ${t.title}`);
    }
    console.log(
      '\nPlug in a runner to measure real lift, e.g.:\n' +
        '  node eval/run-eval.mjs --runner "node eval/runners/cursor-agent.mjs" --model gpt-5.5-medium\n' +
        '\nThe runner gets GITNEXUS_KIT=on|off and prints {"pass":bool,"tokens":int}.'
    );
    return;
  }

  const rows = [];
  for (const t of tasks) {
    process.stdout.write(`Running [${t.id}] … `);
    const off = runCondition(args.runner, t, 'off', args.model);
    const on = runCondition(args.runner, t, 'on', args.model);
    rows.push({ id: t.id, title: t.title, off, on });
    console.log(`off=${off.pass ? 'PASS' : 'fail'} on=${on.pass ? 'PASS' : 'fail'}`);
  }

  const offPass = rows.filter((r) => r.off.pass).length;
  const onPass = rows.filter((r) => r.on.pass).length;
  const offTok = rows.reduce((s, r) => s + r.off.tokens, 0);
  const onTok = rows.reduce((s, r) => s + r.on.tokens, 0);

  const md = [];
  md.push('# GitNexus kit eval report');
  md.push('');
  md.push(`Model: ${args.model || '(runner default)'} · Tasks: ${rows.length} · ${new Date().toISOString()}`);
  md.push('');
  md.push('| Task | Kit OFF | Kit ON | OFF tokens | ON tokens |');
  md.push('| --- | --- | --- | --- | --- |');
  for (const r of rows) {
    md.push(
      `| ${r.title} | ${r.off.pass ? '✅' : '❌'} | ${r.on.pass ? '✅' : '❌'} | ${r.off.tokens} | ${r.on.tokens} |`
    );
  }
  md.push('');
  md.push('## Summary');
  md.push('');
  md.push(`- Pass-rate: **${pct(offPass, rows.length)}% → ${pct(onPass, rows.length)}%** (OFF → ON)`);
  md.push(`- Tokens: ${offTok} → ${onTok} (${onTok - offTok >= 0 ? '+' : ''}${onTok - offTok})`);
  md.push('');
  fs.writeFileSync(REPORT_PATH, md.join('\n') + '\n');

  console.log(`\nPass-rate OFF→ON: ${pct(offPass, rows.length)}% → ${pct(onPass, rows.length)}%`);
  console.log(`Report: ${path.relative(process.cwd(), REPORT_PATH)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
