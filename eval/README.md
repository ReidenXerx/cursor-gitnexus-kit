# Budget-model eval harness

Reproducible proof for the kit's core thesis:

> **Graph-first enforcement lets low-cost/local models perform like premium ones** — and saves tokens for premium ones too.

The harness runs the same coding tasks twice — **kit ON** vs **kit OFF** — through a pluggable
agent runner, then reports pass-rate and token deltas.

## Quick start

```bash
# 1) Dry run — validate task specs, see the matrix (no model needed)
npm run eval

# 2) Smoke test the runner contract with the bundled stub
npm run eval -- --runner "node eval/runners/example-runner.mjs"

# 3) Real run with your own runner + model
npm run eval -- --runner "node eval/runners/cursor-agent.mjs" --model gpt-5.5-medium
```

A report is written to `eval/report.md`.

## How it works

For each task in `eval/tasks/*.json`, the harness spawns your runner twice with env:

| Var | Value |
| --- | --- |
| `GITNEXUS_KIT` | `on` or `off` — your runner enables/disables the kit hooks accordingly |
| `GITNEXUS_TASK_ID` | task id |
| `GITNEXUS_TASK_PROMPT` | the prompt to give the agent |
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
