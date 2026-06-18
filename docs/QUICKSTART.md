# Quick start

Install **cursor-gitnexus-kit** into any git repo. The kit copies hooks, rules, skills, and scripts, merges MCP config, builds the graph index, and runs a full verification audit.

**Why teams install it:** enforce graph-first agent work on **every model tier** — biggest lift on fast/budget/local models; flagship models run leaner with the same gates. Structure lives in the graph, not in parameter count.

## Prerequisites

| Requirement | Notes |
|-------------|--------|
| Node.js ≥ 22.9.0 | `node -v` |
| git | Target must be a worktree |
| bash | macOS / Linux / WSL |
| Cursor | Hooks + MCP enabled |

After `--quick` install, run `npm run gitnexus:agent-refresh` in the **target repo** before graph tools work.

## Install (from this repo)

```bash
git clone https://github.com/ReidenXerx/cursor-gitnexus-kit.git
cd cursor-gitnexus-kit

# Full install + index build (few minutes)
./bin/install.sh /path/to/your-repo

# Hooks/skills only — index later
./bin/install.sh /path/to/your-repo --quick

# Copy bundle only — skip gitnexus-setup
./bin/install.sh /path/to/your-repo --no-setup
```

Custom GitNexus registry name (when folder basename ≠ indexed repo name):

```bash
./bin/install.sh /path/to/your-repo --repo-name my-registered-repo-name
```

## After install (target repo)

1. **Restart Cursor** on the target project — MCP + hooks load on restart.
2. `npm run gitnexus:verify` — full kit audit (also runs at end of install).
3. `npm run gitnexus:health` — human-friendly status for your team.
4. Open a **new Agent chat** and describe your task.
5. Share [`docs/GITNEXUS-CURSOR-GUIDE.md`](../bundle/docs/GITNEXUS-CURSOR-GUIDE.md) with the team (copied to target on install).

> Install overwrites `.cursor/hooks.json`. Existing file is backed up to `.cursor/hooks.json.gn-kit.bak`. Global `~/.cursor/mcp.json` is not modified.

## What install does

```
bin/install.sh
  → stepped banner UI (validate → copy → merge → manifest → setup)
  → copy bundle (rules, hooks, skills, scripts, team guide)
  → merge gated package.json gitnexus:* scripts + .cursor/mcp.json
  → gitnexus-setup.sh (--skip-global-mcp)
      → sync .cursor/skills/
      → build .gitnexus/ index (unless --quick)
  → npm run gitnexus:verify
```

## Update

```bash
./bin/update.sh /path/to/your-repo
```

Default: `--quick` (skips full re-index). Restart Cursor after updating.

## Uninstall

```bash
./bin/uninstall.sh /path/to/your-repo
./bin/uninstall.sh /path/to/your-repo --remove-index   # also remove .gitnexus/
```

## Daily commands (target repo)

```bash
npm run gitnexus:verify          # full kit check
npm run gitnexus:health          # team-friendly status
npm run gitnexus:agent-brief     # session orientation (agents)
npm run gitnexus:agent-status    # staleness (agents)
npm run gitnexus:agent-refresh   # re-index when stale
npm run gitnexus:graph-smoke     # Cypher / ACCESSES sanity (CI)
npm run gitnexus:detect-api      # HTTP router profile
npm run gitnexus:sync-teaching   # after pulling kit updates
```

### Gate docs in package.json

```bash
npm run gitnexus.__gate.1.session      # Gate 1 — health, brief, status
npm run gitnexus.__gate.2.orient       # Gate 2–4 — orient + MCP
npm run gitnexus.__gate.5.index        # Gate 5 — refresh / embeddings
npm run gitnexus.__gate.6.verify       # Install / CI verification
npm run gitnexus.__gate.kit.maintainer # setup, sync, pack, hooks
```

Source: `scripts/gitnexus-teaching/script-gates.mjs`

## Advanced capabilities

| Capability | Commands / hooks |
|------------|------------------|
| **Cypher** | Field ACCESSES, N-hop CALLS — `grep-guard`, `read-guard`, `agent-brief` |
| **`rename` MCP** | Graph-coordinated rename — `edit-guard`, prompt-router |
| **API router profile** | `npm run gitnexus:detect-api` → `.cursor/gitnexus-api-profile.json` |
| **Graph smoke test** | `npm run gitnexus:graph-smoke`; pre-commit after refresh |

See [Architecture](./ARCHITECTURE.md) for diagrams and failure-mode mapping.
