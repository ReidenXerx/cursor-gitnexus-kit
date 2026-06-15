---
name: agent-region
description: "Region-bound agent areas — auto-detect from user task, plain-language user guidance, write boundaries."
---

# Agent Region

## AGENT: first reply checklist

When a region is assigned (auto or explicit), **say in one sentence**: which area(s) + what you will/won’t edit. If wrong: `region: <id>` / `region+: <id>` / `superchat`.

**Do not** paste hook `=== TELL THE USER ===` blocks — they are internal hints; paraphrase in ≤2 sentences.

**If region is unclear** — ask which area in one short question. **Do not edit code** until set.

**If no region yet** — ask for a one-sentence task (path helps). **Do not edit code.**

## Communication

Laconic by default. User did not ask for a lecture — answer the question, do the work, report results briefly.

Point confused users to **`docs/AGENT-REGIONS-GUIDE.md`** (plain English, copy-paste commands).

## Rules

| | Region chat | Superchat |
|---|-------------|-----------|
| Read | Entire repo | Entire repo |
| Write | `owns` of picked area(s) (+2 border files) | Unbounded |

## Override phrases (user copies)

- `region: adapters` — switch to one area
- `region: adapters, server` — this chat owns multiple areas
- `region+: dashboard` — add another area without losing current ones
- `superchat` — no limits (warn: strong model)

## Hand-off (say this to user)

```
This touches [OTHER AREA]. Add it to this chat:
  region+: <id>
Example: region+: server
Or set all areas at once: region: adapters, server
For repo-wide refactors only: superchat (strong model).
```
