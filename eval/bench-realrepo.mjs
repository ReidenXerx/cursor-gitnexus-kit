#!/usr/bin/env node
/**
 * Real-repository benchmark: measures the kit's lift on a large, real codebase.
 *
 * Three conditions (3-arm design proves incremental kit value):
 *   - OFF = source-only copy, no graph, no kit. Agent has grep/read/shell only.
 *   - MCP = source + gitnexus graph (in Docker), no kit enforcement.
 *   - KIT = source + gitnexus graph (in Docker) + kit enforcement (.cursor hooks).
 *
 * ARCHITECTURE:
 *   - cursor-agent runs on the HOST (has Cursor auth via keyring)
 *   - gitnexus MCP runs INSIDE a Docker container (isolated, no host pollution)
 *   - Repo copies are mounted at the SAME path inside and outside Docker
 *     so gitnexus_rename edits files at paths that cursor-agent can access
 *   - The ORIGINAL repo is NEVER touched — only rsync copies are used
 *   - Docker containers are destroyed after the benchmark
 *
 * Usage:
 *   node eval/bench-realrepo.mjs --task eval/realrepo-tasks/<task>.json --model composer-2.5-fast --trials 2
 *   node eval/bench-realrepo.mjs --task eval/realrepo-tasks/<task>.json --model composer-2.5-fast --trials 2 --arms 3
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execSync, spawn, spawnSync } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCKER_IMAGE = "gn-bench";

function parseArgs(argv) {
  const a = {
    task: null,
    model: "",
    trials: 2,
    timeoutMs: 420000,
    arms: 2,
    repo: process.env.GITNEXUS_BENCH_REPO || "",
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--task") a.task = argv[++i];
    else if (argv[i] === "--model") a.model = argv[++i];
    else if (argv[i] === "--repo") a.repo = argv[++i];
    else if (argv[i] === "--trials")
      a.trials = Math.max(1, Number(argv[++i]) || 1);
    else if (argv[i] === "--timeout-ms")
      a.timeoutMs = Number(argv[++i]) || a.timeoutMs;
    else if (argv[i] === "--arms") a.arms = Number(argv[++i]) === 3 ? 3 : 2;
  }
  return a;
}

const log = (...m) => process.stderr.write(`[bench] ${m.join(" ")}\n`);

/** Run a command in a Docker container. */
function dockerExec(container, cmd, opts = {}) {
  const args = ["exec"];
  if (opts.cwd) args.push("-w", opts.cwd);
  args.push(container, ...cmd);
  return spawnSync("docker", args, {
    encoding: "utf8",
    stdio: opts.stdio || "pipe",
    timeout: opts.timeout || 60000,
  });
}

/** Check if Docker is available and the image exists. */
function ensureDocker() {
  const r = spawnSync("docker", ["images", "-q", DOCKER_IMAGE], {
    encoding: "utf8",
  });
  if (r.status !== 0 || !(r.stdout || "").trim()) {
    log(`Docker image '${DOCKER_IMAGE}' not found. Building…`);
    execSync(`docker build -t ${DOCKER_IMAGE} ${path.join(HERE, "docker")}/`, {
      stdio: "inherit",
      timeout: 300000,
    });
  }
}

// Common rsync excludes — large/irrelevant dirs stripped from ALL copies.
const RSYNC_EXCLUDES = [
  "node_modules",
  "dist",
  "build",
  ".next",
  "coverage",
  ".turbo",
  ".nx",
  "out",
  "reports",
  "data",
  "*.tar.gz",
  "*.zip",
  "*.db",
  "*.sqlite",
];

/** rsync a copy of the repo with specified extra excludes. */
function rsyncCopy(repo, destDir, extraExcludes = []) {
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  const excludes = [...RSYNC_EXCLUDES, ...extraExcludes];
  const args = [
    "-a",
    ...excludes.flatMap((e) => ["--exclude", e]),
    `${repo}/`,
    `${destDir}/`,
  ];
  const r = spawnSync("rsync", args, { encoding: "utf8" });
  if (r.status !== 0) {
    log(`rsync failed (exit ${r.status}): ${(r.stderr || "").slice(0, 500)}`);
    throw new Error(`rsync failed: ${r.status}`);
  }
}

/** OFF: source + .git, no .gitnexus, no .cursor, no .agents. */
function prepOff(repo, offDir) {
  rsyncCopy(repo, offDir, [".gitnexus", ".cursor", ".agents"]);
}

/** MCP: source + .git, no .cursor, no .agents. Graph built in Docker. */
function prepMcp(repo, mcpDir, containerName) {
  rsyncCopy(repo, mcpDir, [".gitnexus", ".cursor", ".agents"]);
  removeKitScripts(mcpDir);
  createDockerMcpConfig(mcpDir, containerName);
  // Container must be started before buildGraphInDocker (see main)
}

/** KIT: source + .git + .cursor + .agents. Graph built in Docker. */
function prepKit(repo, kitDir, containerName) {
  rsyncCopy(repo, kitDir, [".gitnexus"]);
  patchMcpConfigForDocker(kitDir, containerName);
  // Container must be started before buildGraphInDocker (see main)
}

/** Remove kit-related npm scripts so the agent can't discover hooks. */
function removeKitScripts(dir) {
  const pkgPath = path.join(dir, "package.json");
  if (!fs.existsSync(pkgPath)) return;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    let removed = 0;
    if (pkg.scripts) {
      for (const key of Object.keys(pkg.scripts)) {
        if (key.startsWith("gitnexus")) {
          delete pkg.scripts[key];
          removed++;
        }
      }
    }
    if (removed > 0)
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  } catch {
    /* keep package.json as-is */
  }
}

/** Create .cursor/mcp.json that runs gitnexus MCP via docker exec. */
function createDockerMcpConfig(dir, containerName) {
  const mcpDir = path.join(dir, ".cursor");
  fs.mkdirSync(mcpDir, { recursive: true });
  const config = {
    mcpServers: {
      gitnexus: {
        command: "docker",
        args: ["exec", "-i", containerName, "gitnexus", "mcp"],
      },
    },
  };
  fs.writeFileSync(
    path.join(mcpDir, "mcp.json"),
    JSON.stringify(config, null, 2) + "\n",
  );
  log(
    `${path.basename(dir)}: created Docker MCP config (container: ${containerName})`,
  );
}

/** Patch existing .cursor/mcp.json to use docker exec for gitnexus. */
function patchMcpConfigForDocker(dir, containerName) {
  const mcpPath = path.join(dir, ".cursor", "mcp.json");
  if (!fs.existsSync(mcpPath)) {
    createDockerMcpConfig(dir, containerName);
    return;
  }
  try {
    const config = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
    if (config.mcpServers?.gitnexus) {
      config.mcpServers.gitnexus = {
        command: "docker",
        args: ["exec", "-i", containerName, "gitnexus", "mcp"],
      };
      fs.writeFileSync(mcpPath, JSON.stringify(config, null, 2) + "\n");
      log(`${path.basename(dir)}: patched MCP config for Docker`);
    }
  } catch {
    createDockerMcpConfig(dir, containerName);
  }
}

/** Build gitnexus graph inside a Docker container.
 *  The repo dir is mounted at the same path so graph paths match the host.
 *  Adds safe.directory to git config to avoid dubious ownership errors. */
function buildGraphInDocker(containerName, repoDir) {
  log(`${path.basename(repoDir)}: building graph in Docker ...`);
  // Fix git dubious ownership (container runs as root, files owned by host user)
  dockerExec(
    containerName,
    ["git", "config", "--global", "--add", "safe.directory", repoDir],
    { stdio: "ignore" },
  );
  const r = dockerExec(
    containerName,
    [
      "gitnexus",
      "analyze",
      "--embeddings",
      "--pdg",
      "--skip-agents-md",
      "--skip-skills",
    ],
    {
      cwd: repoDir,
      stdio: "inherit",
      timeout: 300000,
    },
  );
  if (r.status !== 0) {
    log(
      `${path.basename(repoDir)}: ERROR — graph build failed (exit ${r.status})`,
    );
    // A silent empty graph makes the MCP/KIT arm score like OFF, corrupting the
    // comparison. Abort the run so a degraded arm can never masquerade as a real
    // result. (Containers are already registered for cleanup in main's finally.)
    throw new Error(
      `graph build failed for ${path.basename(repoDir)} (gitnexus analyze exit ${r.status}); ` +
        `aborting so the arm cannot silently score against an empty graph`,
    );
  }
  log(`${path.basename(repoDir)}: graph built in Docker ✓`);
}

/** Disable git push on a workspace (safety guard). */
function disableGitPush(dir) {
  try {
    execSync(
      "git remote set-url --push origin no-push://benchmark-safety-guard",
      {
        cwd: dir,
        stdio: "ignore",
      },
    );
  } catch {
    /* no origin remote — push already impossible */
  }
}

/** Start a Docker container with the repo dir mounted at the same path. */
function startContainer(containerName, mountDir) {
  const r = spawnSync(
    "docker",
    [
      "run",
      "-d",
      "--name",
      containerName,
      "-v",
      `${mountDir}:${mountDir}`,
      "-e",
      "HOME=/tmp", // Isolated HOME — no host registry pollution
      DOCKER_IMAGE,
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) {
    log(`Failed to start container ${containerName}: ${r.stderr}`);
    throw new Error(`docker run failed: ${r.status}`);
  }
  log(`started Docker container: ${containerName}`);
}

/** Stop and remove a Docker container. */
function removeContainer(containerName) {
  spawnSync("docker", ["rm", "-f", containerName], {
    encoding: "utf8",
    stdio: "ignore",
    timeout: 30000,
  });
  log(`removed Docker container: ${containerName}`);
}

/** Best-effort prune of stale gn-bench-* copies left by crashed prior runs.
 *  Skips the current run's dir. Never throws. */
function pruneStaleTempDirs(benchTmpBase, currentDir) {
  try {
    if (!fs.existsSync(benchTmpBase)) return;
    for (const name of fs.readdirSync(benchTmpBase)) {
      if (!name.startsWith("gn-bench-")) continue;
      const full = path.join(benchTmpBase, name);
      if (full === currentDir) continue;
      try {
        fs.rmSync(full, { recursive: true, force: true });
        log(`pruned stale temp dir: ${full}`);
      } catch (e) {
        log(`could not prune ${full}: ${e.message}`);
      }
    }
  } catch (e) {
    log(`temp-dir prune skipped: ${e.message}`);
  }
}

/** Best-effort sweep of leftover gn-bench-* containers from crashed runs.
 *  Guarded so it never throws on a machine without docker. */
function pruneStaleContainers() {
  try {
    const r = spawnSync(
      "docker",
      ["ps", "-aq", "--filter", "name=gn-bench-"],
      { encoding: "utf8", timeout: 30000 },
    );
    if (r.status !== 0) return;
    const ids = (r.stdout || "").split("\n").map((s) => s.trim()).filter(Boolean);
    if (!ids.length) return;
    spawnSync("docker", ["rm", "-f", ...ids], {
      encoding: "utf8",
      stdio: "ignore",
      timeout: 60000,
    });
    log(`swept ${ids.length} leftover gn-bench container(s)`);
  } catch (e) {
    log(`container sweep skipped: ${e.message}`);
  }
}

function runAgent(ws, prompt, model, timeoutMs) {
  return new Promise((resolve) => {
    const streamFile = path.join(
      os.tmpdir(),
      `gn-bench-stream-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`,
    );
    const fd = fs.openSync(streamFile, "w");
    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--force",
      "--trust",
      "--approve-mcps",
      "--workspace",
      ws,
    ];
    if (model) args.push("--model", model);
    args.push(prompt);
    const child = spawn("cursor-agent", args, {
      cwd: ws,
      stdio: ["ignore", fd, "inherit"],
    });
    let killed = false;
    const killer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("exit", () => {
      clearTimeout(killer);
      try {
        fs.closeSync(fd);
      } catch {
        /* noop */
      }
      let tokens = 0;
      try {
        const lines = fs
          .readFileSync(streamFile, "utf8")
          .split("\n")
          .filter(Boolean);
        for (let i = lines.length - 1; i >= 0; i--) {
          if (!lines[i].includes("usage")) continue;
          const o = JSON.parse(lines[i]);
          const u = o.usage || o.message?.usage || {};
          const t = (u.inputTokens || 0) + (u.outputTokens || 0);
          if (t > 0 || o.type === "result") {
            tokens = t;
            break;
          }
        }
        if (tokens === 0 && lines.length > 0) {
          let assistantEvents = 0,
            toolCalls = 0;
          for (const line of lines) {
            try {
              const ev = JSON.parse(line);
              if (ev.type === "assistant") assistantEvents++;
              if (ev.type === "tool_call" && ev.subtype === "completed")
                toolCalls++;
            } catch {
              /* skip */
            }
          }
          if (assistantEvents > 0)
            tokens = assistantEvents * 300 + toolCalls * 200;
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
    return fs.readFileSync(path.join(ws, task.answerFile), "utf8");
  } catch {
    return "";
  }
}

/** Path-mode scoring — normalizes ./ prefixes and leading slashes. */
function scorePath(raw, task) {
  const truth = new Set(task.groundTruth.map((s) => s.toLowerCase()));
  const srcRe =
    /\.?\/?(?:src|lib|apps|packages|test|tests)\/[\w./-]+\.(?:tsx?|jsx?|js|py|rb|go|rs|java|kt|swift|php|cs|cpp|c|scala|mjs|cjs)/gi;
  const answered = new Set();
  for (const m of raw.matchAll(srcRe)) {
    answered.add(m[0].replace(/^\.?\/+/, "").toLowerCase());
  }
  for (const line of raw.split(/[\n\r]+/)) {
    const trimmed = line
      .replace(/^[\s`"'-]+/, "")
      .replace(/[\s`"',;]+$/, "")
      .trim();
    const normalized = trimmed.replace(/^\.?\/+/, "");
    if (
      normalized.includes("/") &&
      /\.(?:tsx?|jsx?|js|py|rb|go|rs|java|kt|swift|php|cs|cpp|c|scala|mjs|cjs)$/.test(
        normalized,
      )
    ) {
      answered.add(normalized.toLowerCase());
    }
  }
  let tp = 0;
  for (const a of answered) if (truth.has(a)) tp++;
  const precision = answered.size ? tp / answered.size : 0;
  const recall = truth.size ? tp / truth.size : 0;
  const f1 =
    precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return {
    precision,
    recall,
    f1,
    tp,
    answered: answered.size,
    total: truth.size,
  };
}

/** Name-mode scoring (recall only). */
function scoreName(raw, task) {
  const truth = task.groundTruth.map((s) => s.toLowerCase());
  const names = new Set(
    raw
      .split(/[\s,]+/)
      .map((s) =>
        s
          .replace(/[`'"()]/g, "")
          .trim()
          .toLowerCase(),
      )
      .filter(Boolean),
  );
  const found = truth.filter((t) => names.has(t)).length;
  const recall = found / truth.length;
  return {
    precision: recall,
    recall,
    f1: recall,
    tp: found,
    answered: names.size,
    total: truth.length,
  };
}

function scoreAnswer(ws, task) {
  const raw = readAnswer(ws, task);
  if (!raw || !raw.trim()) {
    log(`scoreAnswer: empty answer file in ${ws}`);
    return {
      precision: 0,
      recall: 0,
      f1: 0,
      tp: 0,
      answered: 0,
      total: task.groundTruth.length,
    };
  }
  log(
    `scoreAnswer: ${raw.split(/\n/).length} lines, first 100 chars: ${raw.slice(0, 100)}`,
  );
  return task.scoreBy === "path" ? scorePath(raw, task) : scoreName(raw, task);
}

async function trials(ws, task, model, n, timeoutMs, label) {
  const metric =
    task.scoreMetric || (task.scoreBy === "path" ? "f1" : "recall");
  let passes = 0,
    pSum = 0,
    rSum = 0,
    fSum = 0,
    tokenSum = 0,
    tokenRuns = 0;
  for (let i = 0; i < n; i++) {
    fs.rmSync(path.join(ws, task.answerFile), { force: true });
    try {
      execSync("git checkout -- .", { cwd: ws, stdio: "ignore" });
      execSync("git clean -fd", { cwd: ws, stdio: "ignore" });
    } catch {
      /* no git repo or no changes — fine */
    }
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
        `(P=${(s.precision * 100).toFixed(0)}% R=${(s.recall * 100).toFixed(0)}% ` +
        `tp=${s.tp}/${s.total} answered=${s.answered}) tokens=${tokens}`,
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
    console.error(
      "Usage: node eval/bench-realrepo.mjs --task <task.json> [--model M] [--trials N] [--arms 2|3]",
    );
    process.exit(1);
  }
  const task = JSON.parse(fs.readFileSync(path.resolve(args.task), "utf8"));
  // The task JSON's `repo` is only a documented default/example. Allow override
  // via --repo <path> or GITNEXUS_BENCH_REPO so the suite is runnable anywhere.
  if (args.repo) task.repo = path.resolve(args.repo);
  if (!task.repo || !fs.existsSync(task.repo)) {
    console.error(
      `Repo not found: ${task.repo || "(unset)"}\n` +
        `Set it with --repo <path> or GITNEXUS_BENCH_REPO, or edit the task JSON's "repo" field.`,
    );
    process.exit(1);
  }

  ensureDocker();

  // Temp directory for all copies — on host, mounted into Docker at same path.
  const benchTmpBase = path.join(os.homedir(), ".cache", "gn-bench");
  fs.mkdirSync(benchTmpBase, { recursive: true });
  // Sweep crashed-run leftovers before we start (both guarded against no-docker).
  pruneStaleContainers();
  const tmp = fs.mkdtempSync(path.join(benchTmpBase, "gn-bench-"));
  pruneStaleTempDirs(benchTmpBase, tmp);
  const offDir = path.join(tmp, "off");
  const mcpDir = path.join(tmp, "mcp");
  const kitDir = path.join(tmp, "kit");
  const threeArm = args.arms === 3;
  const containers = [];

  try {
    // ── OFF arm (no Docker needed — no graph) ──
    log("preparing OFF baseline (source-only copy, no kit/graph) …");
    prepOff(task.repo, offDir);
    disableGitPush(offDir);

    // ── MCP arm (needs Docker for gitnexus) ──
    let mcpContainer = null;
    if (threeArm) {
      log("preparing MCP-only copy (graph in Docker, no kit hooks) …");
      mcpContainer = `gn-bench-mcp-${Date.now()}`;
      prepMcp(task.repo, mcpDir, mcpContainer);
      disableGitPush(mcpDir);
      startContainer(mcpContainer, mcpDir);
      containers.push(mcpContainer);
      buildGraphInDocker(mcpContainer, mcpDir);
    }

    // ── KIT arm (needs Docker for gitnexus) ──
    log("preparing KIT copy (graph in Docker + kit enforcement) …");
    const kitContainer = `gn-bench-kit-${Date.now()}`;
    prepKit(task.repo, kitDir, kitContainer);
    disableGitPush(kitDir);
    startContainer(kitContainer, kitDir);
    containers.push(kitContainer);
    buildGraphInDocker(kitContainer, kitDir);

    // ── Run trials ──
    log(`running OFF (${args.trials}×) …`);
    const off = await trials(
      offDir,
      task,
      args.model,
      args.trials,
      args.timeoutMs,
      "OFF",
    );

    let mcp = null;
    if (threeArm) {
      log(`running MCP (${args.trials}×) …`);
      mcp = await trials(
        mcpDir,
        task,
        args.model,
        args.trials,
        args.timeoutMs,
        "MCP",
      );
    }

    log(`running KIT (${args.trials}×) …`);
    const on = await trials(
      kitDir,
      task,
      args.model,
      args.trials,
      args.timeoutMs,
      "KIT",
    );

    // ── Report ──
    const metric = on.metric;
    const md = [];
    md.push("# GitNexus kit — real-repo benchmark");
    md.push("");
    md.push(`Task: ${task.title}`);
    md.push(
      `Repo: \`${path.basename(task.repo)}\` · Model: ${args.model || "(default)"} · ` +
        `Trials: ${args.trials} · Arms: ${threeArm ? "3 (OFF/MCP/KIT)" : "2 (OFF/KIT)"} · ` +
        `${new Date().toISOString()}`,
    );
    md.push("");
    md.push(
      `| Condition | Pass (${metric} ≥ ${Math.round(task.threshold * 100)}%) | Avg precision | Avg recall | Avg ${metric} | Avg tokens |`,
    );
    md.push("| --- | --- | --- | --- | --- | --- |");
    md.push(
      `| OFF (grep only) | ${off.passes}/${off.n} | ${(off.avgPrecision * 100).toFixed(0)}% | ` +
        `${(off.avgRecall * 100).toFixed(0)}% | ${(off.avgF1 * 100).toFixed(0)}% | ${off.avgTokens || "—"} |`,
    );
    if (mcp) {
      md.push(
        `| MCP (graph, no hooks) | ${mcp.passes}/${mcp.n} | ${(mcp.avgPrecision * 100).toFixed(0)}% | ` +
          `${(mcp.avgRecall * 100).toFixed(0)}% | ${(mcp.avgF1 * 100).toFixed(0)}% | ${mcp.avgTokens || "—"} |`,
      );
    }
    md.push(
      `| KIT (graph + hooks) | ${on.passes}/${on.n} | ${(on.avgPrecision * 100).toFixed(0)}% | ` +
        `${(on.avgRecall * 100).toFixed(0)}% | ${(on.avgF1 * 100).toFixed(0)}% | ${on.avgTokens || "—"} |`,
    );
    md.push("");
    md.push(`Ground truth: ${task.groundTruth.length} items (graph-derived).`);
    if (task.grepInvisible?.length) {
      md.push(
        `Grep-invisible items: ${task.grepInvisible.length} (${((1 - task.grepInvisible.length / task.groundTruth.length) * 100).toFixed(0)}% grep ceiling on recall).`,
      );
    }
    md.push("");
    const outPath = path.join(HERE, "BENCHMARK-realrepo.md");
    fs.writeFileSync(outPath, md.join("\n") + "\n");
    console.log("\n" + md.join("\n"));
    console.log(`\nReport: ${path.relative(process.cwd(), outPath)}`);
  } finally {
    // Docker creates files as root inside the container, so the host user can't
    // delete them afterward. Chown the mounted dirs back to the ACTUAL host
    // uid/gid (not a hard-coded 1000:1000 — that fails on hosts where the user
    // isn't uid 1000 and leaves root-owned GB-scale copies behind).
    const uid = typeof process.getuid === "function" ? process.getuid() : null;
    const gid = typeof process.getgid === "function" ? process.getgid() : null;
    if (uid !== null && gid !== null) {
      const owner = `${uid}:${gid}`;
      for (const c of containers) {
        // Each container only mounts its own dir; chown that one back to host.
        for (const dir of [mcpDir, kitDir]) {
          if (fs.existsSync(dir)) {
            dockerExec(c, ["chown", "-R", owner, dir], {
              stdio: "ignore",
              timeout: 30000,
            });
          }
        }
      }
    }
    // Stop and remove all Docker containers
    for (const c of containers) removeContainer(c);
    // Delete all temp copies (now chowned to host user)
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch (e) {
      log(`cleanup warning — could not delete temp dir: ${e.message}`);
      log(`run: sudo rm -rf ${tmp}`);
    }
    log("cleanup complete — containers removed, copies deleted");
  }
}

main().catch((e) => {
  log(`fatal: ${e.message}`);
  process.exit(1);
});
