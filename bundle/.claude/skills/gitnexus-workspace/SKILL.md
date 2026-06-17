---
name: gitnexus-workspace
description: >-
  Master index for __GITNEXUS_REPO__ GitNexus usage in Cursor. Use at the start
  of any code task — exploration, edits, refactors, PR review, or API changes.
  Teaches workflow chain, anti-patterns, and which skill to load.
---

# GitNexus Workspace (__GITNEXUS_REPO__)

This repo replaces grep-first navigation with a **knowledge graph + embeddings** for **all code reasoning** (not only the first lookup). **`query` uses BM25 + semantic vectors** — use it for fuzzy/explore work, not only `context`/`impact`. **Hooks actively block** lazy patterns when the index is fresh; **autonomous refresh** when stale or embeddings missing; **classical fallback** when GN fails — see `00-gitnexus-enforcement` rule.

## Mandatory workflow chain

Do not skip steps:

```
READ gitnexus://repo/__GITNEXUS_REPO__/context   # or npm run gitnexus:agent-brief (autonomous)
→ query({query, task_context, goal, repo, limit: 5, max_symbols: 12})   # graph + embeddings — orient / explore
→ context({name, include_content: false}) or context({uid, include_content: false})
→ impact({target, direction: "upstream", summaryOnly: false, limit: 100})   # BEFORE edit
→ detect_changes({scope})                                              # BEFORE commit / PR
```

Stale, missing embeddings, or wrong graph? **`npm run gitnexus:agent-refresh`** autonomously (Shell, `required_permissions: ["all"]`) — includes `--embeddings`; hook pre-approves, do not ask user.

## Pick the right skill

| Situation | Read |
| --- | --- |
| Unfamiliar code / architecture | `gitnexus-exploring` |
| Pipelines / cross-module flows / "how does X connect" | `gitnexus-imaging` |
| Before editing / blast radius | `gitnexus-impact-analysis` |
| Bug / failure / wrong behavior | `gitnexus-debugging` |
| Rename / extract / refactor | `gitnexus-refactoring` |
| Structured task (pre-commit, PR, cross-module) | `gitnexus-scenarios` |
| PR or branch review | `gitnexus-pr-review` |
| Research HTTP API change | `gitnexus-api-routes` (**not** api_impact) |
| Tool reference / Cypher / CLI | `gitnexus-guide` / `gitnexus-cli` |
| Area entry points | `.claude/skills/generated/<area>/` |
| Hook blocked Grep/Read | `gitnexus-enforcement` (staleness + suspicion fallback) |
| Full agent contract | `.cursor/rules/gitnexus.mdc` + `00-gitnexus-enforcement.mdc` |

## Smart query habits

Always pass context to rank results better:

```javascript
query({
  query: "stable pair scanner profile",
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
- Understand a module → `query`, not Read whole file
- Change scope → `detect_changes`, not git diff \| grep
- Rename → `rename` dry_run, not find-and-replace
- Research API route → `gitnexus-api-routes`, not `api_impact`

Grep **is** correct for: preset JSON, log strings, comments, exact config keys in YAML.

## Persistence in Cursor

Installed by `npm run gitnexus:setup`:

- **Enforcement rule** — `.cursor/rules/00-gitnexus-enforcement.mdc` (only `alwaysApply: true` contract)
- **Reference rules** — `.cursor/rules/gitnexus.mdc` + `gitnexus-first.mdc` (load on demand)
- **Hooks** — GN-first when fresh; **classical fallback when stale**; scoped Grep after suspicious GN
- **Skills** — synced to `.cursor/skills/` from this repo's `.claude/skills/`
- **MCP** — `gitnexus` in `.cursor/mcp.json`

Restart Cursor after setup so MCP + hooks load.

## Power moves

| Need | Tool / param |
| --- | --- |
| Ambiguous symbol name | `context({uid: "..."})` from prior output |
| Field read/write trace | `cypher` with `ACCESSES` |
| Class member blast radius | `impact` + `relationTypes: ["CALLS","IMPORTS","ACCESSES"]` |
| PR vs main | `detect_changes({scope: "compare", base_ref: "main"})` |
| Architecture doc | MCP prompt `generate_map` |
