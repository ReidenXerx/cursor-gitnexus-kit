---
name: agent-region
description: "Region-bound agent responsibility — session picker, read-anywhere reasoning, write boundaries, Superchat mode."
---

# Agent Region (responsibility areas)

One chat = one functional region. Keeps cheaper models focused and reduces context drift.

## Session start

1. If no region is set, the user must pick from the numbered list (or reply `superchat`).
2. After selection, load `.cursor/regions.manifest.json` and the region's **anchor skill**.
3. **Reads:** entire repository — cross-region Read, `query`, `context`, and `impact` are always allowed for reasoning.
4. **Writes:** only paths in this region's `owns` (hooks enforce; 2 partial overflow writes allowed).

## Modes

| Mode | Writes | When |
|------|--------|------|
| **Region** | `owns` only (+ 2 partial border writes) | Default — focused work |
| **Superchat** | Unbounded | Large cross-cutting tasks; warn: use capable model |

## Overflow policy

| Situation | Action |
|-----------|--------|
| Small border fix (import, mirror test) | Stay in chat; partial overflow counter increments |
| Significant cross-region feature | Tell user: *"Open a new chat for region X (or Superchat)"* |
| Read-only investigation elsewhere | Always OK |

## Commands

```bash
npm run gitnexus:generate-regions   # rebuild manifest from skills + docs/regions.overlay.json
```

## Files

| File | Role |
|------|------|
| `.cursor/regions.manifest.json` | Generated region cards |
| `docs/regions.overlay.json` | Project-specific overrides (`mode: replace` for crypto) |
| `.cursor/.agent-region.json` | This session's selection (gitignored) |
| `docs/AGENT-PROFILES.md` | Human narrative + border contracts (crypto) |

## Hand-off template

```
This change spans [other region]. Please open a new Agent chat and pick:
  N. [Region label] — [mission]
Or use Superchat (S) with a capable model.
```
