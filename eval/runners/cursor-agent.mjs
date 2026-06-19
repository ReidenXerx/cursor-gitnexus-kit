#!/usr/bin/env node
/**
 * Real eval runner backed by the `cursor-agent` CLI (headless).
 *
 * For each (task × condition) the harness invokes this with env:
 *   GITNEXUS_KIT        = "on" | "off"
 *   GITNEXUS_TASK_JSON  = full task spec (includes fixture + check)
 *   GITNEXUS_TASK_PROMPT= prompt text
 *   GITNEXUS_MODEL      = cursor-agent model slug (e.g. composer-2.5-fast)
 *
 * It copies the task's fixture into an isolated temp workspace, optionally
 * installs the kit (ON), drives cursor-agent headless, runs the task's machine
 * check, and prints one JSON line: {"pass":bool,"tokens":int}.
 *
 * Notes:
 *  - Headless cursor-agent honors workspace .cursor/hooks.json + .cursor/mcp.json,
 *    so kit ON genuinely exercises the enforcement layer.
 *  - Set GITNEXUS_EVAL_KEEP=1 to keep workspaces for inspection.
 *  - tokens = inputTokens + outputTokens from the cursor-agent result envelope.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execSync, spawnSync, spawn } from 'node:child_process';
import { installKit } from '../../lib/kit.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, '..', 'fixtures');

const kit = process.env.GITNEXUS_KIT === 'on';
const model = process.env.GITNEXUS_MODEL || '';
let task = {};
try {
  task = JSON.parse(process.env.GITNEXUS_TASK_JSON || '{}');
} catch {
  /* ignore */
}
const prompt = process.env.GITNEXUS_TASK_PROMPT || task.prompt || '';

const log = (...a) => process.stderr.write(`[runner] ${a.join(' ')}\n`);
const emit = (pass, tokens, extra = {}) =>
  process.stdout.write(JSON.stringify({ pass: !!pass, tokens: tokens || 0, ...extra }) + '\n');

function resolveLocalGitnexus() {
  const r = spawnSync('which', ['gitnexus'], { encoding: 'utf8' });
  return r.status === 0 ? (r.stdout || '').trim() : '';
}

function setupWorkspace() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), `gn-eval-${task.id || 'task'}-${kit ? 'on' : 'off'}-`));
  const fx = path.join(FIXTURES, task.fixture || '');
  if (task.fixture && fs.existsSync(fx)) {
    fs.cpSync(fx, ws, { recursive: true });
  }
  execSync('git init -q && git add -A && git commit -q -m fixture --allow-empty', {
    cwd: ws,
    shell: true,
    stdio: 'ignore',
  });
  return ws;
}

function runCheck(ws) {
  const cmd = task.check?.cmd;
  if (!cmd) return false;
  const r = spawnSync(cmd, { cwd: ws, shell: true, encoding: 'utf8' });
  if (r.status !== 0) log(`check failed: ${(r.stdout || '') + (r.stderr || '')}`.trim());
  return r.status === 0;
}

function runCursorAgent(args, ws, streamFile, timeoutMs) {
  return new Promise((resolve) => {
    const fd = fs.openSync(streamFile, 'w');
    const child = spawn('cursor-agent', args, { cwd: ws, stdio: ['ignore', fd, 'inherit'] });
    let killed = false;
    const killer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.on('error', (e) => {
      log(`cursor-agent spawn error: ${e.message}`);
    });
    child.on('exit', () => {
      clearTimeout(killer);
      try {
        fs.closeSync(fd);
      } catch {
        /* already closed */
      }
      resolve(killed);
    });
  });
}

function parseTokens(stdout) {
  // Scan lines from the end for the first JSON object carrying a usage envelope.
  // MCP servers can interleave output, so the result line isn't always last.
  const lines = (stdout || '').split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith('{') || !line.includes('usage')) continue;
    try {
      const out = JSON.parse(line);
      const u = out.usage || {};
      const total = (u.inputTokens || 0) + (u.outputTokens || 0);
      if (total > 0 || out.type === 'result') return total;
    } catch {
      /* keep scanning */
    }
  }
  return 0;
}

async function main() {
  if (!prompt) return emit(false, 0, { error: 'no prompt' });
  if (!task.check?.cmd) return emit(false, 0, { error: 'task has no machine check' });

  const ws = setupWorkspace();
  log(`${task.id} kit=${kit ? 'on' : 'off'} model=${model || 'default'} ws=${ws}`);

  try {
    if (kit) {
      installKit(ws, { runSetup: false, repoName: path.basename(ws) });
      // Prefer a locally-installed gitnexus binary over `npx -y gitnexus@latest`,
      // which re-resolves from the registry on every trial (slow / can hang).
      const localBin = process.env.GITNEXUS_EVAL_NPX_MCP ? '' : resolveLocalGitnexus();

      if (localBin) {
        const mcpPath = path.join(ws, '.cursor/mcp.json');
        try {
          const cfg = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
          if (cfg.mcpServers?.gitnexus) {
            cfg.mcpServers.gitnexus.command = localBin;
            cfg.mcpServers.gitnexus.args = ['mcp'];
            fs.writeFileSync(mcpPath, JSON.stringify(cfg, null, 2));
            log(`MCP → local gitnexus (${localBin})`);
          }
        } catch {
          /* leave default npx config */
        }
      }

      log('indexing fixture with gitnexus …');
      const idxCmd = localBin || 'npx';
      const idxArgs = localBin
        ? ['analyze', '--embeddings']
        : ['-y', 'gitnexus@latest', 'analyze', '--embeddings'];
      const idx = spawnSync(idxCmd, idxArgs, { cwd: ws, stdio: 'ignore', timeout: 180000 });
      if (idx.status !== 0) log('warning: gitnexus analyze failed — ON condition degraded');
    }

    // stream-json + stream to a file so usage survives even if we kill on timeout.
    const args = ['-p', '--output-format', 'stream-json', '--force', '--trust', '--approve-mcps', '--workspace', ws];
    if (model) args.push('--model', model);
    args.push(prompt);

    const timeoutMs = Number(process.env.GITNEXUS_EVAL_TIMEOUT_MS || 420000);
    log(`running cursor-agent (timeout ${Math.round(timeoutMs / 1000)}s) …`);
    const streamFile = path.join(ws, 'agent-stream.jsonl');
    const timedOut = await runCursorAgent(args, ws, streamFile, timeoutMs);
    if (timedOut) log('cursor-agent killed — timeout (partial usage captured if any)');
    const streamText = fs.existsSync(streamFile) ? fs.readFileSync(streamFile, 'utf8') : '';
    const tokens = parseTokens(streamText);
    const pass = runCheck(ws);
    emit(pass, tokens, timedOut ? { timedOut: true } : {});
  } finally {
    if (!process.env.GITNEXUS_EVAL_KEEP) fs.rmSync(ws, { recursive: true, force: true });
    else log(`kept workspace: ${ws}`);
  }
}

main().catch((e) => {
  log(`fatal: ${e.message}`);
  emit(false, 0, { error: e.message });
});
