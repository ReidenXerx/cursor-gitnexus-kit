---
name: gitnexus-enforcement
description: >-
  North-star tool router when GitNexus hooks block Grep/Read/SemanticSearch.
  Graph + embeddings + cypher reasoning, autonomous refresh when stale, classical fallback when GN fails.
disable-model-invocation: false
---

# GitNexus Enforcement & Tool Router

## North star

> **GitNexus is the default reasoning layer for every task.** Prefer graph + embeddings when fresh. Use `query` to orient. Use `cypher` for precise structural questions (field ACCESSES, N-hop CALLS, overrides). Refresh autonomously when stale or embeddings missing. Fall back to grep/read/search only when GN is stale, failing, or wrong — say why in one sentence.

GitNexus tools are for **reasoning throughout the task**, not only the first lookup or unfamiliar code. Local LLM: rebuild context freely; do not skip gates.

## Graph + embeddings + cypher (layered)

| Task | Tool |
| --- | --- |
| Fuzzy concept, flow trace, "how does X work?" | `query` (BM25 + embedding vectors) |
| Known symbol, callers, 360° | `context` |
| Field read/write, N-hop chains, overrides, process steps | READ schema → `cypher` |
| Pre-edit safety | `impact` |
| Pre-commit / done | `detect_changes` |

`SemanticSearch` is blocked → always `query`. Field/property grep → `cypher` (`ACCESSES`). Missing embeddings = **stale** → `agent-refresh` (includes `--embeddings`).

## MCP defaults (generous)

| Tool | Default |
| --- | --- |
| `context` | `include_content: false` |
| `query` | `limit: 5`, `max_symbols: 12` |
| `cypher` | READ `gitnexus://repo/__GITNEXUS_REPO__/schema` first; use `$params` |
| `impact` | `summaryOnly: false`, `limit: 100` |

Hooks inject calls with these defaults — run verbatim; expand when needed.

## Decision tree (follow in order)

```
START
  │
  ├─ New session / new task?
  │    └─ npm run gitnexus:agent-brief  OR  READ context + schema (autonomous)
  │         stale or missing embeddings? → npm run gitnexus:agent-refresh (Shell, required_permissions: ["all"])
  │
  ├─ Reasoning about code (any point in task)?
  │    └─ query({query, task_context, goal, repo})   # graph + embeddings
  │         └─ context({name}) or context({uid})
  │              └─ Structural precision needed?
  │                   ├─ field read/write → cypher ACCESSES
  │                   ├─ N-hop call chain → cypher CALLS path
  │                   ├─ overrides / process steps → cypher (see schema)
  │                   └─ READ process trace if cross-module
  │                        └─ impact when considering edits
  │                             └─ Read offset/limit ONLY for exact edit lines
  │
  ├─ About to EDIT src/, tests/, apps/, scripts/?
  │    └─ impact({target, direction: "upstream"}) FIRST
  │         report d=1 + risk → then edit
  │
  ├─ About to COMMIT or say "done"?
  │    └─ detect_changes({scope: "unstaged"})
  │
  └─ Hook blocked Grep/Read?
       ├─ Index stale / embeddings missing / check failed? → classical tools auto-allowed; tell user why; refresh
       ├─ GN suspicious after uid retry + graph used this session? → scoped Grep or Read; tell user why
       └─ Otherwise → run the **exact** MCP call from hook agent_message (copy-paste)
            NEVER retry the same blocked call without a reason
```

## Hook block → copy-paste replacements

When blocked, hooks return ready-to-run calls like:

```javascript
gitnexus_query({ query: "auth flow", task_context: "...", goal: "...", repo: "__GITNEXUS_REPO__", limit: 5, max_symbols: 12 })
gitnexus_context({ name: "resolveFilters", repo: "__GITNEXUS_REPO__" })
READ gitnexus://repo/__GITNEXUS_REPO__/schema
gitnexus_cypher({ query: "MATCH (f:Function)-[r:CodeRelation {type: 'ACCESSES'}]->(p:Property {name: $name}) RETURN f.name, f.filePath, r.reason", params: { name: "address" }, repo: "__GITNEXUS_REPO__" })
gitnexus_impact({ target: "handleRequest", direction: "upstream", repo: "__GITNEXUS_REPO__", summaryOnly: false, limit: 100 })
```

## Classical fallback (when NOT to trust GitNexus)

| Signal | What to do |
| --- | --- |
| **Stale index** or **missing embeddings** | Classical OK for investigation; `agent-refresh` autonomously; edits blocked until fresh |
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
| `Grep("address")` (field/property) | READ schema → `cypher` ACCESSES on `$name: "address"` |
| `SemanticSearch("auth flow")` | `query({query: "auth flow", task_context, goal})` — uses embeddings |
| `Glob("src/**/*.js")` | `query({query: "module area", goal: "entry points"})` |
| `Read(entire stablePairScanner.js)` | `query` → `context` → Read offset/limit |
| Scoped Grep before any GN MCP call | `context` first — scoped Grep only after graph use + suspicion |

When index is **stale**, hooks allow blocked patterns automatically.

## Autonomous agent CLI

```bash
npm run gitnexus:agent-brief    # session orientation + suggested calls
npm run gitnexus:agent-status   # exit 1 if stale or embeddings missing
npm run gitnexus:agent-refresh  # analyze --embeddings + sync — when stale
```

**NEVER** tell the user to run `npx gitnexus analyze` — that is agent work.

## When hooks can't help (Grep is correct)

- `research/presets/**/*.json` — preset literals
- Exact string in logs/comments
- `strategyId` in matrix files
- Validating docs paths exist

## Before saying "done"

If you edited code: `detect_changes` + summarize affected processes and risk.
