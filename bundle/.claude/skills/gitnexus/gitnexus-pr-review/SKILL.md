---
name: gitnexus-pr-review
description: "Use when reviewing a pull request, understanding what a PR changes, assessing merge risk, or checking test coverage gaps. Examples: \"Review this PR\", \"What does PR #42 change?\", \"Is this PR safe to merge?\""
---

# PR Review with GitNexus

## When to Use

- Reviewing a branch before merge
- Assessing risk of a teammate's changes
- Preparing PR description / test plan from actual blast radius

## Workflow

```
1. `npm run gitnexus:branch-status -- <base>` to confirm current branch/base and suggested MCP calls
2. gitnexus_detect_changes({ scope: "compare", base_ref: "main", repo: "__GITNEXUS_REPO__", branch: "<current-branch>" })
3. Review summary.risk_level, changed_symbols, affected_processes
4. For HIGH/CRITICAL or unexpected processes → impact on changed entry points with the same `branch`
5. For security/input/file/db/exec changes → `gitnexus-security-review` (`explain`, `pdg_query`, `trace`)
6. Recommend tests per affected process
```

## Checklist

```
- [ ] detect_changes compare against main (or PR base branch)
- [ ] Risk level acceptable for change intent?
- [ ] affected_processes match PR description?
- [ ] Any surprise cross-community flows (changes spanning unrelated clusters)?
- [ ] Entry-point symbols get individual impact upstream
- [ ] API payload changes paired with their client/consumer (shape_check)
- [ ] Config/fixture-only changes → relevant tests green
- [ ] Index was fresh during review (context resource)
```

## Risk interpretation

| detect_changes risk | Action |
| --- | --- |
| LOW | Spot-check affected processes + related tests |
| MEDIUM | Run all affected process test dirs |
| HIGH | Full integration tests; require explicit reviewer sign-off |
| CRITICAL | Treat as architectural change — verify every affected_process |

## What GitNexus adds over git diff

- Maps hunks to **symbols**, not just files
- Traces **execution flows** (processes) impacted
- Surfaces **cross-module** effects grep misses
- Gives **risk level** heuristic for prioritization

## Example

```
detect_changes({scope: "compare", base_ref: "main"})
→ 12 changed symbols, 8 affected processes
→ <entry symbols the diff touches, from the result>
→ Risk: CRITICAL

Follow-up:
→ impact upstream on each changed entry symbol
→ Recommend: tests covering the affected processes
→ Flag: change crosses multiple unrelated clusters — confirm intentional
```

## Related

- Scenario playbooks: `gitnexus-scenarios/SKILL.md`
- Impact depth: `gitnexus-impact-analysis/SKILL.md`
