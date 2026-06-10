---
name: agent-region
description: "Region-bound agent areas — auto-detect from user task, plain-language user guidance, write boundaries."
---

# Agent Region

## AGENT: first reply checklist

When a region is assigned (auto or explicit), **your first reply MUST include**:

1. Tell the user which area they are in (use the `=== TELL THE USER ===` block from hooks).
2. One sentence: what you will and will not edit.
3. If wrong: `region: <id>` or `superchat`.

**If region is unclear** — use the `=== REGION UNCLEAR ===` block verbatim. **Do not edit code** until the user answers.

**If no region yet** — use `=== NO REGION YET ===`. **Do not edit code.**

## User guide

Point confused users to **`docs/AGENT-REGIONS-GUIDE.md`** (plain English, copy-paste commands).

## Rules

| | Region chat | Superchat |
|---|-------------|-----------|
| Read | Entire repo | Entire repo |
| Write | `owns` only (+2 border files) | Unbounded |

## Override phrases (user copies)

- `region: adapters` — switch area
- `superchat` — no limits (warn: strong model)

## Hand-off (say this to user)

```
This touches [OTHER AREA]. Open a new Agent chat and type:
  region: <id>
Example: region: server
Or type superchat for a large cross-repo change (strong model only).
```
