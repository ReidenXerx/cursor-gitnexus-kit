---
name: gitnexus-workspace
description: >-
  Master index for __GITNEXUS_REPO__ GitNexus usage in Cursor. Use at the start
  of any code task — exploration, edits, refactors, PR review, API changes, or
  region-bound agent work. Teaches workflow chain, anti-patterns, and which skill to load.
---

# GitNexus Workspace (__GITNEXUS_REPO__)

This repo replaces grep-first navigation with a **knowledge graph** for **all code reasoning** (not only the first lookup). **Hooks actively block** lazy patterns when the index is fresh; **autonomous refresh** when stale; **classical fallback** when GN fails — see `00-gitnexus-enforcement` rule.

## Mandatory workflow chain

Do not skip steps:

```
READ gitnexus://repo/__GITNEXUS_REPO__/context   # or npm run gitnexus:agent-status (autonomous)
→ query({query, task_context, goal})              # orient
→ context({name}) or context({uid})               # one symbol deep-dive
→ impact({target, direction: "upstream"})         # BEFORE any edit
→ detect_changes({scope})                         # BEFORE commit / PR
```

Stale or wrong graph? **`npm run gitnexus:agent-refresh`** autonomously (Shell, `required_permissions: ["all"]`) — hook pre-approves, do not ask user.

## Pick the right skill

| Situation | Read |
| --- | --- |
| Unfamiliar code / architecture | `gitnexus-exploring` |
| Pipelines / cross-module flows / "how does X connect" | `gitnexus-imaging` |
| Before editing / blast radius | `gitnexus-impact-analysis` |
| Bug / failure / wrong behavior | `gitnexus-debugging` |
| Rename / extract / refactor | `gitnexus-refactoring` |
| Structured task (pre-commit, PR, cross-region) | `gitnexus-scenarios` |
| PR or branch review | `gitnexus-pr-review` |
| Research HTTP API change | `gitnexus-api-routes` (**not** api_impact) |
| Tool reference / Cypher / CLI | `gitnexus-guide` / `gitnexus-cli` |
| Region-bound agent (one area only) | `docs/AGENT-PROFILES.md` + `.claude/skills/generated/<area>/` |
| Hook blocked Grep/Read | `gitnexus-enforcement` (staleness + suspicion fallback) |
| Full agent contract | `.cursor/rules/gitnexus.mdc` + `00-gitnexus-enforcement.mdc` |

## Smart query habits

Always pass context to rank results better:

```javascript
query({
  query: "stable pair scanner profile",
  task_context: "what you are doing in this chat",
  goal: "what you need to find",
  repo: "__GITNEXUS_REPO__"
})
```

## Anti-patterns (grep is wrong tool)

- Symbol lookup → `context`, not Grep
- Understand a module → `query`, not Read whole file
- Change scope → `detect_changes`, not git diff \| grep
- Rename → `rename` dry_run, not find-and-replace
- Research API route → `gitnexus-api-routes`, not `api_impact`

Grep **is** correct for: preset JSON, log strings, comments, exact config keys in YAML.

## Persistence in Cursor

Installed by `npm run gitnexus:setup`:

- **Enforcement rule** — `.cursor/rules/00-gitnexus-enforcement.mdc` (hook-backed gates)
- **Rules** — `.cursor/rules/gitnexus.mdc` + `gitnexus-first.mdc` (`alwaysApply: true`)
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
