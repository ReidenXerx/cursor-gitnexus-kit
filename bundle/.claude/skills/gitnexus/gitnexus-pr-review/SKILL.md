---
name: gitnexus-pr-review
description: "Use when reviewing a pull request, understanding what a PR changes, assessing merge risk, or checking test coverage gaps. Examples: \"Review this PR\", \"What does PR #42 change?\", \"Is this PR safe to merge?\""
---

# PR Review with GitNexus

## When to Use

- Reviewing a branch before merge
- Assessing risk of a teammate's changes
- Preparing PR description / test plan from actual blast radius
- Verifying a PR stayed within intended region

## Workflow

```
1. gitnexus_detect_changes({scope: "compare", base_ref: "main", repo: "__GITNEXUS_REPO__"})
2. Review summary.risk_level, changed_symbols, affected_processes
3. For HIGH/CRITICAL or unexpected processes → impact on changed entry points
4. Cross-check docs/AGENT-PROFILES.md if changes span regions
5. Recommend tests per affected process
```

## Checklist

```
- [ ] detect_changes compare against main (or PR base branch)
- [ ] Risk level acceptable for change intent?
- [ ] affected_processes match PR description?
- [ ] Any surprise cross-community flows (Scanner↔Adapters↔Server↔Dashboard)?
- [ ] Entry-point symbols get individual impact upstream
- [ ] API payload changes paired with researchApi.ts (Server + Dashboard profiles)
- [ ] Preset-only changes → tests/examples green
- [ ] Index was fresh during review (context resource)
```

## Risk interpretation

| detect_changes risk | Action |
| --- | --- |
| LOW | Spot-check affected processes + region tests |
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
→ ScanStablePairFromCandles, RunExperimentMatrix, LoadResearchRunArtifactCatalog
→ Risk: CRITICAL

Follow-up:
→ impact on scanStablePairFromCandles, runExperimentMatrix
→ Recommend: tests/core/scanner, tests/adapters, tests/server
→ Flag: crosses Scanner + Adapters + Server — confirm intentional
```

## Related

- Scenario playbooks: `gitnexus-scenarios/SKILL.md`
- Impact depth: `gitnexus-impact-analysis/SKILL.md`
- Region boundaries: `docs/AGENT-PROFILES.md`
