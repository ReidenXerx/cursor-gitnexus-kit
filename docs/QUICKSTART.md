# Quick start

Install **gitnexus-agent-kit** into any git repo. The kit copies hooks, rules, skills, and scripts, merges MCP config (Cursor), wires Zed agent profiles, builds the graph index, and runs a full verification audit.

**Why teams install it:** enforce graph-first agent work on **every model tier** — biggest lift on fast/budget/local models; flagship models run leaner with the same gates. Structure lives in the graph, not in parameter count.

## Prerequisites

| Requirement | Notes |
|-------------|--------|
| Node.js ≥ 22.9.0 | `node -v` |
| git | Target must be a worktree |
| bash | macOS / Linux / WSL |
| Cursor and/or Zed | Pick runtime at install (default: both) |

After `--quick` install, run `npm run gitnexus:agent-refresh` in the **target repo** before graph tools work.

## Install (from this repo)

```bash
git clone https://github.com/ReidenXerx/gitnexus-agent-kit.git
cd gitnexus-agent-kit

# Interactive — pick repo path + IDE
./bin/install.sh

# Full install + index build (few minutes)
./bin/install.sh /path/to/your-repo --runtime both

# Cursor hooks only
./bin/install.sh /path/to/your-repo --runtime cursor

# Zed + Ollama profile only
./bin/install.sh /path/to/your-repo --runtime zed

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

1. **Restart your IDE** on the target project — MCP + hooks (Cursor) or agent profile (Zed) load on restart.
2. `npm run gitnexus:verify` — runtime-aware kit audit (also runs at end of install).
3. `npm run gitnexus:health` — human-friendly status for your team.
4. Open a **new Agent chat** and describe your task.
5. Share [`docs/GITNEXUS-CURSOR-GUIDE.md`](../bundle/docs/GITNEXUS-CURSOR-GUIDE.md) with the team (copied to target on install).

> Install overwrites `.cursor/hooks.json` when runtime includes Cursor. Existing file is backed up to `.cursor/hooks.json.gn-kit.bak`. Global `~/.cursor/mcp.json` is not modified.

## What install does

```
bin/install.sh
  → stepped banner UI (validate → migrate legacy → copy → merge → manifest → setup)
  → migrate legacy cursor-gitnexus-kit layout (rsync skills, old manifest, zed profile)
  → copy bundle (rules, hooks, skills store, scripts, team guide)
  → materialize .gnkit/skills/ + symlink into .cursor/ and/or .agents/
  → merge gated package.json gitnexus:* scripts + .cursor/mcp.json (Cursor)
  → merge .zed/settings.json + AGENTS.md (Zed)
  → gitnexus-setup.sh (--skip-global-mcp)
      → build .gitnexus/ index (unless --quick)
  → npm run gitnexus:verify
```

Skills live once in `.gnkit/skills/` and are **symlinked** — not copied — into IDE skill paths. Updates replace the store and refresh symlinks.

## Update

```bash
./bin/update.sh /path/to/your-repo
./bin/update.sh /path/to/your-repo --runtime both   # ensure Cursor + Zed after old Cursor-only install
```

Default: `--quick` (skips full re-index). **Migration runs on every update** — old rsync'd `.cursor/skills/*`, `.claude/skills/*`, legacy manifest, and Zed profile key `gitnexus` are cleaned automatically.

Bulk update every installed repo under a workspace root:

```bash
./bin/update.sh --all /path/to/projects --runtime both --no-setup --skip-verify
```

Restart your IDE after updating.

## Uninstall

```bash
./bin/uninstall.sh /path/to/your-repo
./bin/uninstall.sh /path/to/your-repo --remove-index   # also remove .gitnexus/
```

## Daily commands (target repo)

```bash
npm run gitnexus:verify          # full kit check (cursor / zed / both)
npm run gitnexus:health          # team-friendly status
npm run gitnexus:agent-brief     # session orientation (agents)
npm run gitnexus:agent-status    # staleness (agents)
npm run gitnexus:agent-refresh   # re-index when stale
npm run gitnexus:branch-status   # branch/base summary + branch-aware MCP calls
npm run gitnexus:pr-impact       # branch-aware PR review playbook
npm run gitnexus:pdg             # incremental embeddings + skills + PDG (mid-session)
npm run gitnexus:full-pdg        # full --force rebuild + PDG (pre-commit hook uses this)
npm run gitnexus:graph-smoke     # Cypher / ACCESSES sanity (CI)
npm run gitnexus:detect-api      # HTTP router profile
npm run gitnexus:sync-teaching   # after pulling kit updates
```

### Gate docs in package.json

```bash
npm run gitnexus.__gate.1.session      # Gate 1 — health, brief, status
npm run gitnexus.__gate.2.orient         # Gate 2–4 — orient + MCP
npm run gitnexus.__gate.5.index          # Gate 5 — refresh / embeddings
npm run gitnexus.__gate.6.verify         # Install / CI verification
npm run gitnexus.__gate.kit.maintainer   # setup, sync, pack, hooks
```

Source: `scripts/gitnexus-teaching/script-gates.mjs`

## Advanced capabilities

| Capability | Commands / hooks |
|------------|------------------|
| **Cypher** | Field ACCESSES, N-hop CALLS — `grep-guard`, `read-guard`, `agent-brief` |
| **`rename` MCP** | Graph-coordinated rename — `edit-guard`, prompt-router |
| **API router profile** | `npm run gitnexus:detect-api` → `.cursor/gitnexus-api-profile.json` |
| **Branch-aware PR review** | `npm run gitnexus:branch-status -- main`; `npm run gitnexus:pr-impact -- main` |
| **PDG pre-commit refresh** | `.githooks/pre-commit` runs `npm run gitnexus:full-pdg` before `gitnexus:graph-smoke` |
| **Graph smoke test** | `npm run gitnexus:graph-smoke`; pre-commit after PDG refresh |
| **Zed + Ollama** | See [ZED.md](./ZED.md) — **Zed + GitNexus** profile, local model hints |

See [Architecture](./ARCHITECTURE.md) for diagrams and failure-mode mapping. See [Skills](./SKILLS.md) for task-to-skill routing.

## Release / maintainer docs

- [CHANGELOG.md](../CHANGELOG.md) — notable changes and migration notes.
- [RELEASE.md](./RELEASE.md) — release checklist, privacy scan, and install/update matrix.
