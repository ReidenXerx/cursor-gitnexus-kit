---
name: gitnexus-enforcement
description: >-
  North-star tool router when GitNexus hooks block Grep/Read/SemanticSearch.
  Graph-first reasoning, autonomous refresh when stale, classical fallback when GN fails.
disable-model-invocation: false
---

# GitNexus Enforcement & Tool Router

## North star

> **Prefer the knowledge graph for all code reasoning when the index is fresh. Refresh autonomously when it is not. Fall back to grep/read/search only when GitNexus is stale, failing, or demonstrably wrong — and say why in one sentence.**

Graph tools are for **reasoning throughout the task**, not only the first lookup.

## Response style (token economy)

Default **laconic**: essential answer only — no preamble, no process narration, no post-task essays, no optional follow-up menus.

Expand only when the user asks (explain, detail, walk me through, deep dive, verbose, ELI5).

After code edits: 1–3 bullets (what / why / verify). Region notice: one sentence — never paste hook `===` blocks to the user.

## Decision tree (follow in order)

```
START
  │
  ├─ New session / new task?
  │    └─ npm run gitnexus:agent-status  OR  READ context (autonomous — no user ask)
  │         stale? → npm run gitnexus:agent-refresh (Shell, required_permissions: ["all"])
  │
  ├─ Reasoning about code (any point in task)?
  │    └─ query({query, task_context, goal, repo: "__GITNEXUS_REPO__"})
  │         └─ context({name}) or context({uid})
  │              └─ READ process trace if cross-module
  │                   └─ impact when considering edits
  │                        └─ Read with offset/limit ONLY for exact edit lines
  │
  ├─ About to EDIT src/, tests/, apps/, scripts/?
  │    └─ impact({target, direction: "upstream"}) FIRST
  │         report d=1 + risk → then edit
  │
  ├─ About to COMMIT or say "done"?
  │    └─ detect_changes({scope: "unstaged"})
  │
  └─ Hook blocked Grep/Read?
       ├─ Index stale / check failed? → classical tools auto-allowed; tell user why; refresh
       ├─ GN suspicious after uid retry + graph used this session? → scoped Grep or Read; tell user why
       └─ Otherwise → use GitNexus command from agent_message
            NEVER retry the same blocked call without a reason
```

## Classical fallback (when NOT to trust GitNexus)

| Signal | What to do |
| --- | --- |
| **Stale index** | Classical OK for investigation; `agent-refresh` autonomously; edits blocked until fresh |
| **Refresh failed** (ENOSPC, MCP down) | Classical OK; warn user; retry refresh once if feasible |
| **0 upstream** on a known hub | `context({uid})` retry once → scoped Grep in GN-named file (after ≥1 MCP call this session) |
| **impact vs detect_changes** disagree | Trust `detect_changes`; verify with Read/Grep |
| **Wrong/missing file** from graph | Classical Read/Grep; mention GN drift |
| **MCP unreachable** | Warn user; classical OK |

**Always:** one sentence to the user explaining the bypass.

## Hook block → replacement (fresh index)

| Blocked | Replacement |
| --- | --- |
| `Grep("resolveSelectionFilters")` | `context({name: "resolveSelectionFilters"})` |
| `SemanticSearch("auth flow")` | `query({query: "auth flow", task_context, goal})` |
| `Glob("src/future/**/*.js")` | `query({query: "module area", goal: "entry points"})` |
| `Read(entire stablePairScanner.js)` | `query` → `context` → Read offset/limit |
| Scoped Grep before any GN MCP call | `context` first — scoped Grep only after graph use + suspicion |

When index is **stale**, hooks allow blocked patterns automatically.

## Autonomous agent CLI

```bash
npm run gitnexus:agent-status    # exit 1 if stale
npm run gitnexus:agent-refresh   # analyze + sync teaching — agent runs when stale
```

**NEVER** tell the user to run `npx gitnexus analyze` — that is agent work.

## When hooks can't help (Grep is correct)

- `research/presets/**/*.json` — preset literals
- Exact string in logs/comments
- `strategyId` in matrix files
- Validating docs paths exist

## Before saying "done"

If you edited code: `detect_changes` + summarize affected processes and risk.
