# cursor-gitnexus-kit

Portable **Cursor + GitNexus enforcement** for any repository: graph-first agent reasoning, autonomous index refresh, and **region-bound agent chats** so AI stays in one area per session.

Extracted from production use in [crypto-trading-bot](https://github.com/ReidenXerx/crypto-trading-bot).

## What it installs

| Component | Purpose |
|-----------|---------|
| `.cursor/rules/00-gitnexus-enforcement.mdc` | North-star agent contract (only always-on rule) |
| `.cursor/hooks.json` + hooks | Block lazy grep/read; staleness gate; session auto-refresh; **auto region detection** |
| `.claude/skills/gitnexus*` + `agent-region` | Playbooks + region responsibility areas |
| `scripts/gitnexus-*.sh` | Setup, sync, agent CLI, pack, git hooks |
| `docs/AGENT-REGIONS-GUIDE.md` | Plain-language user guide (give this to your team) |
| `.githooks/pre-commit` | Optional index refresh on commit |
| `.cursor/mcp.json` | Merges `gitnexus` MCP server |
| `package.json` scripts | `gitnexus:setup`, `gitnexus:agent-refresh`, `gitnexus:generate-regions`, … |

Per-target repo (built locally): `.gitnexus/` index, `.cursor/skills/generated/` area skills, `.cursor/regions.manifest.json`.

## Prerequisites

- **Node.js** ≥ 22.9.0
- **git**
- **bash** (macOS/Linux; WSL on Windows)
- **Cursor** with **Hooks** and **MCP** enabled
- After `--quick` install: run `npm run gitnexus:agent-refresh` before graph tools work

## First install (checklist)

1. Clone this repo (or download a release).
2. Target repo must be a **git worktree** (`git init` if needed).
3. Run `./bin/install.sh /path/to/repo` (full) or `--quick` (hooks only).
4. **Restart Cursor** on the target project — MCP + hooks do not load until restart.
5. Open a **new Agent chat** and follow the 3-step flow below.

**Note:** Install overwrites `.cursor/hooks.json` (backup at `.cursor/hooks.json.gn-kit.bak` if one existed). Kit skips global `~/.cursor/mcp.json` changes.

## Every new Agent chat (for your team)

Share **`docs/AGENT-REGIONS-GUIDE.md`** with anyone using Cursor on the repo.

| Step | What the user does |
|------|-------------------|
| **1** | Describe the task in plain English. Include a file path if possible. Example: `fix login in src/api/auth.js` |
| **2** | Area is **auto-picked** from the message — agent announces it |
| **3** | Wrong area? Reply exactly: `region: <id>` or `superchat` |

| Rule | Detail |
|------|--------|
| **Read** | Entire repo — always OK |
| **Write** | Only the picked area (2 small border fixes allowed) |
| **Superchat** | `superchat` — whole repo, no limits; strong model only |

Code edits are **blocked** until the user describes a task (or picks `region: …`).

## Install into any repo

```bash
git clone https://github.com/ReidenXerx/cursor-gitnexus-kit.git
cd cursor-gitnexus-kit

# Full install + index build (can take a few minutes)
./bin/install.sh /path/to/your-repo

# Hooks/skills only — index later
./bin/install.sh /path/to/your-repo --quick

# Copy files only — skip gitnexus-setup
./bin/install.sh /path/to/your-repo --no-setup
```

Custom repo name (folder basename ≠ GitNexus registry name):

```bash
./bin/install.sh /path/to/your-repo --repo-name my-registered-repo-name
```

Then **restart Cursor** on the target project.

## What happens during install

```
install.sh
  → copy bundle (rules, hooks, skills, scripts)
  → merge package.json gitnexus:* scripts + .cursor/mcp.json
  → gitnexus-setup.sh (--skip-global-mcp)
      → sync .cursor/skills/
      → generate-regions → .cursor/regions.manifest.json
         (from GitNexus skills after refresh, OR filesystem scan on --quick)
  → restart Cursor → new Agent chat → auto region from first message
```

Regions are **not** generic placeholders — `generate-regions` scans `src/`, `apps/`, `packages/`, `scripts/`, `tests/`, `docs/`. Customize later with `docs/regions.overlay.json` (`mode: enrich` or `replace`).

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

## North star (agent contract)

> Prefer the knowledge graph for **all code reasoning** when the index is fresh. Refresh autonomously when stale. Fall back to grep/read/search only when GitNexus is stale, failing, or wrong — say why.

## Target repo daily commands

```bash
npm run gitnexus:agent-status      # staleness (agents run this autonomously)
npm run gitnexus:agent-refresh     # re-index when stale
npm run gitnexus:generate-regions  # rebuild region manifest
npm run gitnexus:sync-teaching     # after pulling kit/rule updates
npm run gitnexus:setup -- --quick  # hooks/skills only
```

## Customize regions (optional)

| File | When |
|------|------|
| `docs/regions.overlay.stub.json` | Reference template (`mode: enrich`) |
| `docs/regions.overlay.json` | Your boundaries — copy stub and edit, or hand-author |
| `docs/AGENT-PROFILES.md` | Narrative + border contracts (seeded from stub on first install) |

After editing overlay: `npm run gitnexus:generate-regions`

## Manifest

Install writes `.cursor/gn-kit-manifest.json` in the target repo (gitignored). Update/uninstall use it to track managed files.

## Development

```bash
npm test                              # kit unit tests
./scripts/refresh-bundle-from-source.sh ../crypto-trading-bot
./bin/update.sh ../some-repo --quick
```

## Bundle layout

```
bundle/
├── .cursor/rules hooks.json hooks/
├── .claude/skills/          # gitnexus*, agent-region
├── docs/                    # AGENT-REGIONS-GUIDE, TEAM-BUNDLE, stubs
├── scripts/
├── .githooks/
├── .vscode/
└── .gitnexusignore
```

Templates use `__GITNEXUS_REPO__` — substituted with the target repo name at install time.

## License

ISC
