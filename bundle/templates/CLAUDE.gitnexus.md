<!-- GENERATED from scripts/contract/enforcement-contract.md by scripts/gen-contract.mjs — edit there, run `npm run gen:contract`. -->

# GitNexus agent kit — always-on instructions

## North star

> **GitNexus is the default reasoning layer for every task — not a fallback when code is unfamiliar.** Prefer graph + embeddings when the index is fresh. Use `query` to orient (BM25 + vectors). Use `cypher` for precise structural graph questions. Refresh autonomously when stale or embeddings are missing. Classical tools only **after refresh fails** or GN is wrong — say why.

**Model tiers:** the graph + gates improve **every** agent — budget/local models gain the most *relative* lift; flagship models waste fewer tokens and follow the same enforced loop. Local LLM / zero API cost: rebuild context freely; do not skip gates for speed.

## Every task (not “unfamiliar code only”)

Use the graph for **all** agent work — explore, debug, fix, refactor, review, rename, commit — not only architecture questions.

| Task type | Graph role |
| --- | --- |
| Answer / explain / debug | `query` → `context` → `cypher` if structural → Read offset/limit |
| Field / property data flow | READ schema → `cypher` (`ACCESSES` read/write) |
| N-hop call chains, overrides, process steps | READ schema → `cypher` |
| Statement-level data/control flow, taint | `pdg_query` / `explain` / `trace` (see deep precision) |
| Edit runtime source (any size) | `impact` upstream before Write/StrReplace |
| Refactor / rename / shared code | `impact` + `rename` dry_run OR `context` on hub symbols |
| Review / “what did I change?” | `detect_changes`; `query` to orient |
| Session start | `agent-brief` or repo context; confirm kit health |

**Anti-patterns:** reserving GitNexus for big exploratory prompts; grep/read from memory on “familiar” files; grepping field names instead of `cypher`; **StrReplace/find-and-replace for symbol renames** instead of `rename` dry_run; skipping `impact` on “small” edits; jumping to `context`/`impact`/`grep` without `query` first (skips embeddings). `SemanticSearch` is blocked — use `query`.

## Graph + embeddings + cypher (layered)

| Need | Tool | Why |
| --- | --- | --- |
| Orient — any fuzzy or grounding step | `query` | Hybrid BM25 + **embedding** vectors (RRF) |
| One symbol, callers, 360° | `context` | Structural graph (canned API) |
| **Precise structural graph questions** | **`cypher`** | Raw traversals the canned tools don't express |
| Pre-edit blast radius | `impact` | Graph traversal |
| Pre-commit / done | `detect_changes` | Diff → processes |

### When to escalate to `cypher` (after `query` / `context`)

READ `gitnexus://repo/__GITNEXUS_REPO__/schema` before ad-hoc Cypher.

| Question | Cypher edge / pattern |
| --- | --- |
| Who reads/writes field/property X? | `ACCESSES` with `reason: read` / `write` |
| Custom N-hop call chain | `CALLS` variable-length path |
| Method override chain | `METHOD_OVERRIDES` |
| Ordered steps in a process | `STEP_IN_PROCESS` + `r.step` |
| All methods on a class | `HAS_METHOD` |
| Diamond / multi-inheritance | `EXTENDS` multi-path MATCH |

**Order:** `query` (orient) → `context` (symbol) → **`cypher`** (structural precision) → `impact` (before edits). Do not start with `cypher` for fuzzy questions — that's what `query` + embeddings are for.

Refresh always includes `--embeddings` (`gitnexus:refresh` / `agent-refresh`). Missing embeddings = stale (same as commit behind).

## Deep precision — PDG, taint, trace

When `cypher` isn't enough, escalate to statement-level tools (require a PDG index — `gitnexus:pdg`):

| Need | Tool |
| --- | --- |
| Statement-level blast radius (control + data) | `impact` with `mode: "pdg"` |
| What predicate controls a line / why does it run? | `pdg_query` (`mode: "controls"`) |
| Where does a variable's value flow / reach? | `pdg_query` (`mode: "flows"`) |
| Source → sink path between two symbols | `trace` |
| Taint review — injection, path traversal, XSS | `explain` |

## Full tool surface — reach for the right one

Know every tool and *when* it wins (single-repo; cross-repo `group_*` is out of scope for this kit). Don't stop at `query`/`context` — the advanced tools answer in one call what takes many manual hops.

| Tool | Reach for it when |
| --- | --- |
| `query` | Orient — "how does X work?", find the execution flow for a concept (BM25 + vectors). Always first for fuzzy work. |
| `context` | 360° on ONE symbol — callers, callees, categorized refs, the processes it's in. After `query`, or when the symbol is known. |
| `cypher` | Precise structural questions the canned tools don't express — field `ACCESSES`, N-hop `CALLS`, `METHOD_OVERRIDES`, `STEP_IN_PROCESS`. READ schema first. |
| `impact` | BEFORE editing a symbol — upstream blast radius + risk + affected processes. `mode: "pdg"` for statement-level (control+data) precision. |
| `trace` | "How does A reach B?" — shortest call/member path between two symbols in ONE call (replaces 3–8 manual `context` hops). |
| `pdg_query` | "What condition gates this line?" (`mode: "controls"`) / "where does this variable flow?" (`mode: "flows"`). Intra-function; needs PDG. |
| `explain` | Security review — taint source→sink (command/code/sql injection, path-traversal, XSS), intra- AND inter-procedural. Needs PDG. |
| `detect_changes` | BEFORE commit / "what did my edits affect?" — diff → affected symbols/processes/risk. `scope`: unstaged \| staged \| all \| compare. |
| `rename` | Coordinated multi-file symbol rename — `dry_run: true` first. Never find-and-replace identifiers. |
| `api_impact` | BEFORE changing an HTTP route handler (framework router) — consumers, response-shape mismatches, middleware chain, risk. |
| `route_map` | Map routes → consumers + handler + middleware; find orphaned routes. (Custom router → `context` on the dispatcher instead.) |
| `shape_check` | Detect API response-shape drift — keys a route returns vs keys consumers access (flags MISMATCH). |
| `tool_map` | Map MCP/RPC tool definitions → handler files + descriptions (tool-API work, impact of a tool-contract change). |
| `check` | Structural integrity — detect circular File `IMPORTS` cycles (health / CI gate). |
| `list_repos` | Only when multiple repos are indexed — discover/disambiguate before passing `repo:` to other tools. |

Cheap resource reads (prefer before heavy tools): `READ gitnexus://repo/__GITNEXUS_REPO__/{context|schema|clusters|processes|process/<name>}`.

## MCP defaults (generous — local LLM)

Run hook copy-paste calls verbatim; expand freely when needed:

| Tool | Default | Notes |
| --- | --- | --- |
| `context` | `include_content: false` | Need body → Read offset/limit |
| `query` | `limit: 5`, `max_symbols: 12` | Primary semantic+graph orient tool |
| `cypher` | READ schema first | Use `$params` for symbol/field names |
| `impact` | `summaryOnly: false`, `limit: 100` | Full blast radius before edits; `mode: "pdg"` for statement-level |
| `pdg_query` | `mode: "controls"` / `"flows"` | Statement-level control/data dependence |
| `trace` / `explain` | source → sink | Path between symbols; taint analysis |
| `rename` | `dry_run: true` first | Coordinated multi-file symbol rename |
| `detect_changes` | `scope: unstaged` | Pre-commit → `staged`; PR → `compare` |

## Session (autonomous Shell)

New chat: run session health ritual if injected — `npm run gitnexus:agent-status`, one-sentence confirm to user.

`npm run gitnexus:agent-brief` or READ `gitnexus://repo/__GITNEXUS_REPO__/context`. Stale or missing embeddings → **`npm run gitnexus:agent-refresh` first** (`required_permissions: ["all"]`). Hooks **block** Grep/Read/MCP/shell until refresh succeeds; classical tools only if refresh **fails** (say why). Never ask user to analyze.

## Stale loop (mandatory)

```
stale → agent-refresh (Shell, pre-approved)
  → fresh → query / context / cypher / impact
  → still stale after refresh → agent-refresh retry once if plausible
  → refresh failed → classical fallback OK (one sentence why)
```

Session start runs auto-refresh when stale. Do **not** grep/read “while refreshing” — refresh is the next tool, not a background hint.

## Gates (do not skip — every task)

```
1. brief OR context — session start
2. query — orient / ground (graph + embeddings) before reasoning or edits
3. context → process — drill into symbols
4. cypher — structural precision (field ACCESSES, N-hop CALLS, overrides, process steps)
5. impact upstream — before runtime source edits
6. rename dry_run — before coordinated symbol renames (not StrReplace across files)
7. detect_changes — before commit / done
```

HIGH/CRITICAL impact → warn before proceeding.

## When fresh — hooks block (enforced, not advisory)

Symbol grep → `context`. **Field/property grep → READ schema → `cypher` (`ACCESSES`).** SemanticSearch/broad Glob → `query`. Large source Read → `query` → `context` → Read offset/limit; **data-flow / model reads → `cypher` first.** Symbol **StrReplace rename** → `rename` dry_run.

**Hard gates (deny until satisfied, once per session):**
- **Edit runtime source** → blocked until one `impact` (or `rename`) call this session. Run blast radius first; warn on HIGH/CRITICAL.
- **`git commit`** → blocked until one `detect_changes` call this session. Confirm affected processes match intent.

Enforcement is **polyglot** — JS/TS, Python, Rust, Go, Java, and more count as source (configure `sourceExts` in `.gnkit/gitnexus-hooks.json`).

## Fallback

**Only after refresh fails** (or MCP down / GN wrong after `uid` retry): classical Grep/Read OK — one-sentence why. While stale and refresh not yet attempted/failed: **deny classical** — run `agent-refresh` first.

Optional: `GITNEXUS_MODE=guide` (nudge-only). Paths: `.gnkit/gitnexus-hooks.json`. Playbooks: `gitnexus-enforcement` skill.

## Claude Code

- The `gitnexus` MCP server is configured in `.mcp.json` — approve it on first run.
- Hooks in `.claude/settings.json` enforce the loop: symbol Grep → `gitnexus_context`, large source Read → `gitnexus_query`, edits gated on `gitnexus_impact`, `git commit` gated on `gitnexus_detect_changes`, and stale shell commands blocked until refresh.
- Skills live in `.claude/skills/` — invoke `/gitnexus-enforcement` or `/gitnexus-workspace` on hard tasks.
- Stale index or missing embeddings → run `npm run gitnexus:agent-refresh` (Bash, pre-approved); never ask the user to analyze.

## npm gates

Run gated scripts from `package.json` when hooks remind you: `gitnexus.__gate.*` — they document the enforced playbook for this repo.
