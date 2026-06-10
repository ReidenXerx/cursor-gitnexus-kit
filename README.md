# cursor-gitnexus-kit

Portable **Cursor + GitNexus enforcement** for any repository: graph-first agent reasoning, autonomous index refresh, classical fallback when the graph is stale or broken.

Extracted from production use in [crypto-trading-bot](https://github.com/ReidenXerx/crypto-trading-bot).

## What it installs

| Component | Purpose |
|-----------|---------|
| `.cursor/rules/00-gitnexus-enforcement.mdc` | North-star agent contract (only always-on rule) |
| `.cursor/hooks.json` + hooks | Block lazy grep/read; staleness gate; session auto-refresh |
| `.claude/skills/gitnexus*` | Playbooks (imaging, enforcement, scenarios, PR review, …) |
| `scripts/gitnexus-*.sh` | Setup, sync, agent CLI, pack, git hooks |
| `.githooks/pre-commit` | Optional index refresh on commit |
| `.cursor/mcp.json` | Merges `gitnexus` MCP server |
| `package.json` scripts | `gitnexus:setup`, `gitnexus:agent-refresh`, … |

Per-target repo (not bundled): `.gitnexus/` index, `.cursor/skills/generated/` area skills — built by `gitnexus analyze` on that codebase.

## Prerequisites

- **Node.js** ≥ 22.9.0
- **git**
- **bash** (macOS/Linux; WSL on Windows)
- **Cursor** with Hooks + MCP enabled
- Target repo should eventually run `npm run gitnexus:refresh` (or install without `--quick`)

## First install checklist

1. Clone this kit repo (or download a release).
2. Ensure the **target repo is a git worktree** (`git init` if needed).
3. Run `./bin/install.sh /path/to/repo` (full) or `--quick` (hooks/skills only).
4. **Restart Cursor** on the target — MCP + hooks do not load until restart.
5. If you used `--quick`, run `npm run gitnexus:agent-refresh` before graph tools work.
6. Optional: customize `docs/AGENT-PROFILES.md` (seeded from stub on first install only).
7. Kit install skips global `~/.cursor/mcp.json` changes — project `.cursor/mcp.json` is sufficient.

**Note:** Install overwrites `.cursor/hooks.json` (backup at `.cursor/hooks.json.gn-kit.bak` if one existed). Existing custom hooks are not merged.

## Install into any repo

```bash
git clone https://github.com/ReidenXerx/cursor-gitnexus-kit.git
cd cursor-gitnexus-kit

# Full install + index build (can take a few minutes)
./bin/install.sh /path/to/your-repo

# Or hooks/skills only — index later
./bin/install.sh /path/to/your-repo --quick

# Copy files only — skip gitnexus-setup
./bin/install.sh /path/to/your-repo --no-setup
```

Custom repo name (if folder basename ≠ GitNexus registry name):

```bash
./bin/install.sh /path/to/your-repo --repo-name my-registered-repo-name
```

Then **restart Cursor** on the target project.

## Update

Re-copy the latest bundle and re-sync teaching (default: `--quick`, skips full re-index):

```bash
./bin/update.sh /path/to/your-repo
```

After updating kit rules/hooks, restart Cursor on the target.

## Uninstall

Removes all kit-managed files, `gitnexus:*` npm scripts, gitignore snippet, and restores `.cursor/hooks.json` / `.cursor/mcp.json` backups if they existed before install.

```bash
./bin/uninstall.sh /path/to/your-repo

# Also remove local graph index + temp dir
./bin/uninstall.sh /path/to/your-repo --remove-index
```

## North star (agent contract)

> Prefer the knowledge graph for **all code reasoning** when the index is fresh. Refresh autonomously when stale. Fall back to grep/read/search only when GitNexus is stale, failing, or wrong — say why.

## Target repo daily commands

```bash
npm run gitnexus:agent-status     # staleness check
npm run gitnexus:agent-refresh    # agent-autonomous re-index
npm run gitnexus:sync-teaching    # after pulling kit updates into repo
npm run gitnexus:setup -- --quick # hooks/skills only
```

## Manifest

Install writes `.cursor/gn-kit-manifest.json` in the target repo (gitignored). Update/uninstall use it to track managed files.

## Development

```bash
npm test                    # kit unit tests
# Edit bundle/ then test on a scratch repo:
./bin/update.sh ../some-repo --quick
```

## Bundle layout

```
bundle/
├── .cursor/rules hooks.json hooks/
├── .claude/skills/
├── docs/                    # GITNEXUS-TEAM-BUNDLE.md + AGENT-PROFILES.stub.md
├── scripts/
├── .githooks/
├── .vscode/
└── .gitnexusignore
```

Templates use `__GITNEXUS_REPO__` — substituted with the target repo name at install time.

## License

ISC
