---
name: gitnexus-imaging
description: >-
  Graph-first mental models for pipelines, call chains, and cross-module flows.
  Use when explaining architecture, tracing business flows, mapping regions, or
  answering "how does X connect to Y?" — never reconstruct structure from grep.
---

# GitNexus Imaging (graph-first thinking)

Use this skill when the task needs **structure in your head** — not a single symbol lookup.

**Output contract:** Cite a GitNexus **process** or **cluster** for cross-module flows when the index is fresh. If none found or results look wrong, say so and use classical Read/Grep to verify — tell the user why.

## When to fall back to classical tools

| Situation | Action |
| --- | --- |
| Index stale | Hooks allow Grep/Read/Search; prefer refresh before edits |
| 0 callers on known hub | Retry `context({uid})`, then scoped Grep in the file GN named |
| impact vs detect_changes conflict | Trust detect_changes; verify in source |
| Cannot cite any process after query | Say index may be stale or GN incomplete; verify with Read |

Always tell the user in one sentence when bypassing graph-first imaging.

## When to use (vs other skills)

| Question type | Skill |
| --- | --- |
| "How does scan → experiment work?" | **gitnexus-imaging** (this) |
| "What calls `resolveFilters`?" | `gitnexus-exploring` / `context` |
| "Safe to change X?" | `gitnexus-impact-analysis` |
| "Why is this failing?" | `gitnexus-debugging` |
| Pre-commit / PR checklist | `gitnexus-scenarios` |

## Thinking modes → tools

| Mental model | Tool | Bad habit |
| --- | --- | --- |
| Business flow ("scan → experiment → artifacts") | `query` → **processes** | Read 5 adapter files linearly |
| Call chain ("who calls X?") | `context` (incoming CALLS) | `Grep("X")` |
| Module map ("what lives in Scanner?") | `READ clusters` → `cluster/Scanner` | Broad Glob on `src/` |
| Pipeline step trace | `READ process/{name}` | Follow imports manually |
| Blast radius | `impact` + `detect_changes` | Grep callers |
| Field/data flow | `cypher` with `ACCESSES` | Grep field name |

## Mandatory prep

```
READ gitnexus://repo/__GITNEXUS_REPO__/context   → staleness first
```

If stale → `npm run gitnexus:refresh` (hooks block runtime edits until fresh).

---

## Recipe 1 — Explain a pipeline / business flow

**Trigger:** "How does X work?", "Explain the scan pipeline", "What happens when I run Y?"

```
1. READ context (staleness)
2. query({
     query: "<feature or pipeline name>",
     task_context: "<user question verbatim>",
     goal: "find execution flows and entry symbols",
     repo: "__GITNEXUS_REPO__"
   })
3. Pick top 1–3 processes from results
4. READ gitnexus://repo/__GITNEXUS_REPO__/process/{name} for each
5. context({name}) on entry + hub symbols (2–4 symbols max)
6. Read source ONLY at lines cited by context/process — use offset/limit
```

**Deliverable format:**

```markdown
## Flow: {ProcessName}
Entry: `symbol` → … → exit
Steps: (from process trace)
Hub nodes: symbols with most callers
Regions touched: Scanner | Adapters | Server | …
```

---

## Recipe 2 — Map a functional region

**Trigger:** "What's in Scanner?", "Map the strategies area", region-bound agent work

```
1. READ gitnexus://repo/__GITNEXUS_REPO__/clusters
2. READ gitnexus://repo/__GITNEXUS_REPO__/cluster/{AreaName}
3. query({ query: "{AreaName} entry points", task_context: "region map", goal: "entry symbols" })
4. context on 2–3 entry symbols listed in cluster
```

Use with `docs/AGENT-PROFILES.md` for border contracts between regions.

---

## Recipe 3 — Trace a call chain (depth)

**Trigger:** "What calls X?", "Trace from CLI to core"

```
1. context({ name: "X", repo: "__GITNEXUS_REPO__" })
2. Walk incoming CALLS (d=1) — do not grep
3. For each caller, note which processes include it
4. Optional: READ process/{name} to see step order
```

Stop at process boundary (Adapter → Core → Server), not every leaf.

---

## Recipe 4 — Trace a data field

**Trigger:** "Who reads/writes `scannerOptions`?", "Where is profileId consumed?"

```
1. READ gitnexus://repo/__GITNEXUS_REPO__/schema  (if unfamiliar with cypher)
2. cypher — ACCESSES edges with reason read/write on field name
3. context on writers first, then readers
4. detect_changes if field changed in WIP
```

Widen impact with `relationTypes: ["CALLS","IMPORTS","ACCESSES"]` when editing fields.

---

## Recipe 5 — Cross-module spine (this repo)

**Trigger:** Changes spanning Scanner → Adapters → Server → Dashboard

Known high-value spines to query first:

| Spine | Example query |
| --- | --- |
| Scan pipeline | `stable pair scan workflow filters` |
| Scan → experiment | `scan experiment matrix workflow` |
| Research orchestration | `research run plan orchestrator` |
| HTTP / artifacts | `research API handleRequest artifacts` |
| Strategy registry | `strategy scan profile detection` |

After `query`, run `detect_changes` on WIP — it often shows cross-community blast that `impact` on a single symbol misses.

---

## __GITNEXUS_REPO__ example: scan pipeline

```
1. READ context
2. query({
     query: "stable pair scan workflow",
     task_context: "explain scan pipeline",
     goal: "processes and hub symbols",
     repo: "__GITNEXUS_REPO__"
   })
   → expect processes touching resolveFilters, runStablePairScanWorkflow, …
3. READ process/{top process name}
4. context({ name: "runStablePairScanWorkflow" })
5. Summarize with process name + hub symbols — then cite file:line for details
```

---

## Anti-patterns

- Describing a 3+ module flow from memory when index is fresh and GN was not tried
- Reading entire adapter files before `query`
- Skipping `process/{name}` when user asked "how does the flow work"
- Trusting `impact` alone on WIP — pair with `detect_changes` for cross-region edits
- Bypassing GN without a stated reason when index is fresh

## Related

- Master index: `gitnexus-workspace`
- Structured checklists: `gitnexus-scenarios`
- Research HTTP routes: `gitnexus-api-routes` (not `api_impact`)
