---
name: gitnexus-workspace
description: >-
  Master index for __GITNEXUS_REPO__ GitNexus usage in Cursor. Use at the start
  of any code task — exploration, edits, refactors, PR review, or API changes.
  Teaches workflow chain, anti-patterns, and which skill to load.
---

# GitNexus Workspace (__GITNEXUS_REPO__)

This repo replaces grep-first navigation with a **knowledge graph + embeddings + Cypher** for **all code reasoning** (not only the first lookup). **`query`** uses BM25 + semantic vectors for orient/explore. **`cypher`** answers precise structural questions (field ACCESSES, N-hop CALLS, overrides). **`rename`** coordinates multi-file symbol renames (dry_run first). **Hooks actively block** lazy patterns when the index is fresh; **autonomous refresh** when stale or embeddings missing; **classical fallback** when GN fails — see `00-gitnexus-enforcement` rule.

## Mandatory workflow chain

Do not skip steps:

```
READ gitnexus://repo/__GITNEXUS_REPO__/context   # or npm run gitnexus:agent-brief (autonomous)
READ gitnexus://repo/__GITNEXUS_REPO__/schema    # before ad-hoc Cypher
→ query({query, task_context, goal, repo, limit: 5, max_symbols: 12})   # graph + embeddings — orient
→ context({name, include_content: false}) or context({uid, include_content: false})
→ cypher({query, params})   # structural: field ACCESSES, N-hop CALLS, overrides, process steps
→ impact({target, direction: "upstream", summaryOnly: false, limit: 100})   # BEFORE edit
→ detect_changes({scope})                                              # BEFORE commit / PR
```

**Renames:** `impact` → `rename({symbol_name, new_name, dry_run: true})` — never find-and-replace symbols.

Stale, missing embeddings, or wrong graph? **`npm run gitnexus:agent-refresh`** autonomously (Shell, `required_permissions: ["all"]`) — includes `--embeddings`; hook pre-approves, do not ask user.

## HTTP API routing (auto-detected at install)

After index build, the kit writes `.cursor/gitnexus-api-profile.json`:

| Profile | Use |
| --- | --- |
| `framework` | `api_impact` / `route_map` / `shape_check` — indexed Route nodes |
| `custom` | **`gitnexus-api-routes`** skill — context on the dispatcher symbol (e.g. `dispatchRequest`) |
| `framework-likely` | Try `api_impact`; if empty, fall back to custom playbook |
| `none` | No HTTP layer detected |

Run `npm run gitnexus:detect-api` to refresh the profile after major server changes.

## Pick the right skill

| Situation | Read |
| --- | --- |
| Unfamiliar code / architecture | `gitnexus-exploring` |
| Pipelines / cross-module flows / "how does X connect" | `gitnexus-imaging` |
| Field read/write / data flow | `cypher` ACCESSES (READ schema) — hooks block field grep |
| Before editing / blast radius | `gitnexus-impact-analysis` |
| Bug / failure / wrong behavior | `gitnexus-debugging` |
| Rename / extract / refactor | `gitnexus-refactoring` + **`rename` MCP** |
| Structured task (pre-commit, PR, cross-module) | `gitnexus-scenarios` |
| PR or branch review | `gitnexus-pr-review` |
| Research HTTP API change | See **HTTP API routing** above |
| Tool reference / Cypher / CLI | `gitnexus-guide` / `gitnexus-cli` |
| Area entry points | `.claude/skills/generated/<area>/` |
| Hook blocked Grep/Read | `gitnexus-enforcement` (staleness + suspicion fallback) |
| Full agent contract | `.cursor/rules/gitnexus.mdc` + `00-gitnexus-enforcement.mdc` |

## Smart query habits

Always pass context to rank results better:

```javascript
query({
  query: "<concept or feature you are working on>",
  task_context: "what you are doing in this chat",
  goal: "what you need to find",
  repo: "__GITNEXUS_REPO__",
  limit: 5,
  max_symbols: 12
})
```

Pass `task_context` + `goal` — they improve **embedding** ranking, not just keyword match.

## Anti-patterns (grep is wrong tool)

- Symbol lookup → `context`, not Grep
- Field/property data flow → `cypher` ACCESSES, not Grep field name
- Understand a module → `query`, not Read whole file (data-flow reads → Cypher first)
- Change scope → `detect_changes`, not git diff \| grep
- Rename symbol → **`rename` dry_run**, not StrReplace across files
- Research API route → profile-driven (`api_impact` vs `gitnexus-api-routes`)

Grep **is** correct for: preset JSON, log strings, comments, exact config keys in YAML.

## Persistence in Cursor

Installed by `npm run gitnexus:setup`:

- **Enforcement rule** — `.cursor/rules/00-gitnexus-enforcement.mdc` (only `alwaysApply: true` contract)
- **Reference rules** — `.cursor/rules/gitnexus.mdc` + `gitnexus-first.mdc` (load on demand)
- **Hooks** — GN-first when fresh; **refresh-first when stale** (classical only after refresh fails); field grep → Cypher; large data-flow Read → Cypher
- **Skills** — synced to `.cursor/skills/` from this repo's `.claude/skills/`
- **MCP** — `gitnexus` in `.cursor/mcp.json`

Restart Cursor after setup so MCP + hooks load.

## Power moves

| Need | Tool / param |
| --- | --- |
| Ambiguous symbol name | `context({uid: "..."})` from prior output |
| Field read/write trace | `cypher` with `ACCESSES` |
| N-hop call chain | `cypher` CALLS variable-length path |
| Coordinated rename | `rename({symbol_name, new_name, dry_run: true})` |
| Class member blast radius | `impact` + `relationTypes: ["CALLS","IMPORTS","ACCESSES"]` |
| PR vs main | `detect_changes({scope: "compare", base_ref: "main"})` |
| Graph integrity check | `npm run gitnexus:graph-smoke` |
| Architecture doc | MCP prompt `generate_map` |
