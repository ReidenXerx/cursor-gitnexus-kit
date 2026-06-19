# Eval harness (internal / WIP)

A developer tool for experimenting with the kit's effect on agent behavior. It runs the same
task twice — **kit ON** vs **kit OFF** — through a pluggable agent runner and reports pass-rate
and token usage.

> Status: exploratory. These are not published benchmarks — they're for finding the
> scenarios where graph-first enforcement clearly helps. Treat any local numbers as
> direction, not claims.

## Quick start

```bash
# 1) Dry run — validate task specs, see the matrix (no model needed)
npm run eval

# 2) Smoke test the runner contract with the bundled stub
npm run eval -- --runner "node eval/runners/example-runner.mjs"

# 3) Real run via the cursor-agent CLI (headless) — budget model
npm run eval -- --runner "node eval/runners/cursor-agent.mjs" --model composer-2.5-fast
```

A report is written to `eval/report.md`.

The bundled `cursor-agent` runner is **real**: it copies each task's fixture into an
isolated temp workspace, installs the kit for the ON condition (rules + hooks + MCP + a
fresh `gitnexus analyze`), drives `cursor-agent -p --output-format stream-json`, then runs
the task's machine `check`. Headless `cursor-agent` honors workspace `.cursor/hooks.json`
and `.cursor/mcp.json`, so the ON condition genuinely exercises the enforcement layer —
verified live: classical edits get blocked and the agent switches to `gitnexus_rename` /
`impact` / `query`.

Only tasks with a machine `check` are scored in real runs; check-less tasks appear in the
`--dry-run` matrix as illustrative specs.

### Runner knobs (env)

| Var | Default | Purpose |
| --- | --- | --- |
| `GITNEXUS_EVAL_TIMEOUT_MS` | `420000` | Per-condition cursor-agent budget. On timeout the run is killed but partial token usage is still captured from the stream. |
| `GITNEXUS_EVAL_KEEP` | unset | Keep temp workspaces for inspection. |
| `GITNEXUS_EVAL_NPX_MCP` | unset | Use `npx -y gitnexus@latest mcp` instead of a locally-installed `gitnexus` binary. The local binary boots much faster; only set this if you have no global install. |

> First-ever run may prompt once for workspace trust / MCP approval; after that it's
> non-interactive. The runner pins the MCP server to your local `gitnexus` to avoid
> per-run `npx` registry resolution (which can cost minutes).

### Reading the numbers

Easy tasks tend to tie (a capable model solves them with or without the kit). The
interesting signal is on tasks where the baseline silently misses call sites, over-includes,
or thrashes. The goal of this harness is to find and characterize those cases.

## How it works

For each task in `eval/tasks/*.json`, the harness spawns your runner twice with env:

| Var | Value |
| --- | --- |
| `GITNEXUS_KIT` | `on` or `off` — your runner enables/disables the kit hooks accordingly |
| `GITNEXUS_TASK_ID` | task id |
| `GITNEXUS_TASK_PROMPT` | the prompt to give the agent |
| `GITNEXUS_TASK_JSON` | full task spec (fixture + check) |
| `GITNEXUS_MODEL` | model slug (from `--model`) |

Your runner must print **one JSON line**:

```json
{ "pass": true, "tokens": 12345 }
```

## Writing a real runner

A real runner should, per invocation:

1. Reset a fixture repo to a known state.
2. If `GITNEXUS_KIT=on`, install/enable the kit (`gn-kit install`); if `off`, disable hooks.
3. Drive an agent on `GITNEXUS_TASK_PROMPT` (e.g. via `@cursor/sdk` or the `cursor-agent` CLI).
4. Run the task's success check (see each task's `rubric`).
5. Print `{"pass": <bool>, "tokens": <int>}`.

See `eval/runners/example-runner.mjs` for the contract (it's a deterministic stub).

## Tasks

Each `tasks/*.json` is a self-contained spec: `id`, `title`, `prompt`, `rubric`, and a `hypothesis`
explaining the expected kit advantage. Add your own — keep them small and objectively checkable.

## Real-repo experiments

Toy fixtures are too easy for capable models. To probe real lift, run against a real codebase:

```bash
node eval/bench-realrepo.mjs \
  --task eval/realrepo-tasks/<task>.json \
  --model <model> --trials 2
```

This is **read-only** — it never mutates your project (the task only writes a small answer file,
deleted after each trial):

- **ON** = your original repo, used in place. It's already kit-installed and indexed, so the
  graph is reused as-is — *no copy, no re-index* (only a one-time refresh if the index is stale).
  GitNexus bakes an absolute `repoPath` into the graph, so the indexed dir must never be moved.
- **OFF** = a quick source-only copy with `.cursor`/`.gitnexus` stripped — a clean grep-only
  baseline. No index needed.

Scoring is recall (name mode) or precision/recall/F1 (`"scoreBy": "path"`) against a
graph-derived ground-truth set baked into the task spec. Write a task spec (see
`eval/realrepo-tasks/`) with: `repo`, `prompt`, `answerFile`, `threshold`, and a `groundTruth`
list (derive it once via `gitnexus_impact` / `gitnexus_cypher`).
