# GitNexus Cursor teaching bundle — team install

Portable **rules + hooks + skills + scripts** for graph-first Cursor agents. Installed via [`cursor-gitnexus-kit`](https://github.com/ReidenXerx/cursor-gitnexus-kit).

## What's in the bundle

| Included | Purpose |
| --- | --- |
| `.cursor/rules/00-gitnexus-enforcement.mdc` | North-star agent contract (only always-on rule) |
| `.cursor/hooks.json` + hooks | Grep/read guards, staleness gate, **agent region picker** |
| `.claude/skills/gitnexus*` + `agent-region` | Playbooks + region responsibility skill |
| `scripts/gitnexus-setup.sh` | One-shot team installer |
| `docs/regions.overlay.stub.json` | Generic region boundaries (seeded on first install) |

## New user flow (end-to-end)

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. INSTALL (once per repo)                                      │
│    git clone cursor-gitnexus-kit                                │
│    ./bin/install.sh /path/to/repo        # full (+ index)       │
│    ./bin/install.sh /path/to/repo --quick  # hooks only         │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. KIT COPIES bundle → target repo                              │
│    • rules, hooks, skills, scripts                              │
│    • seeds docs/regions.overlay.json from stub (if missing)     │
│    • seeds docs/AGENT-PROFILES.md from stub (if missing)        │
│    • merges package.json gitnexus:* scripts + .cursor/mcp.json  │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. gitnexus-setup.sh (unless --no-setup)                        │
│    • verify teaching files                                      │
│    • sync .cursor/skills/                                       │
│    • npm run gitnexus:generate-regions → regions.manifest.json  │
│    • optional: full index (skip with --quick)                   │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. RESTART CURSOR (required)                                    │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. NEW AGENT CHAT — region picker                               │
│    Session shows numbered regions + Superchat (S)               │
│    User replies: 2 | adapters | superchat                       │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 6. WORK IN CHAT                                                 │
│    READ:  anywhere (cross-region reasoning OK)                  │
│    WRITE: region owns only (+ 2 partial border writes)          │
│    Superchat: unbounded writes, warn about capable model        │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 7. AFTER --quick OR PULL                                        │
│    npm run gitnexus:agent-refresh   # index + area skills       │
│    npm run gitnexus:generate-regions  # refresh region manifest │
│    Customize docs/regions.overlay.json for your architecture    │
└─────────────────────────────────────────────────────────────────┘
```

## Agent regions policy

| | Region chat | Superchat |
|---|-------------|-----------|
| **Reads** | Entire repo | Entire repo |
| **Writes** | `owns` paths only | Unbounded |
| **Best for** | Cheaper models, focused tasks | Cross-cutting refactors |

Manifest: `.cursor/regions.manifest.json` (generated, gitignored).  
Overlay: `docs/regions.overlay.json` (project-specific; stub seeded on install).

## First install checklist

1. **Prerequisites:** Node.js ≥ 22.9.0, git, bash, Cursor with Hooks + MCP enabled.
2. **Install:** `./bin/install.sh /path/to/repo` (or `--quick`).
3. **Restart Cursor** on the target project.
4. **If `--quick`:** `npm run gitnexus:agent-refresh` before graph tools work.
5. **First Agent chat:** pick a region when prompted.
6. **Customize:** `docs/regions.overlay.json` for your codebase layout.

## Daily commands

```bash
npm run gitnexus:agent-status
npm run gitnexus:agent-refresh
npm run gitnexus:generate-regions
npm run gitnexus:sync-teaching
```

## Prerequisites

- Node.js >= 22.9.0
- git
- bash (macOS/Linux; WSL on Windows)
- Cursor with Hooks + MCP enabled
