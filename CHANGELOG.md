# Changelog

All notable changes to `gitnexus-agent-kit` are documented here.

## 1.2.0 — GitNexus v1.6.8 alignment

### Added

- First-class Cursor + Zed runtime support via `--runtime cursor|zed|both`.
- Zed project profile: **Zed + GitNexus**, `.agents/skills` symlinks, and `AGENTS.md` guidance.
- PDG-aware pre-commit refresh: `.githooks/pre-commit` runs `npm run gitnexus:pdg` before graph smoke checks.
- GitNexus v1.6.8 tool routing for `trace`, `pdg_query`, PDG `impact`, and taint `explain`.
- Security review skill covering taint, PDG flows/controls, trace, and impact.
- CUDA source detection (`.cu`, `.cuh`) in hooks and review helpers.
- Branch-aware review commands:
  - `npm run gitnexus:branch-status`
  - `npm run gitnexus:pr-impact`
- Persistence/database health checks in `health` and `doctor`.
- Bulk update command for installed repos:
  - `./bin/update.sh --all [search-root] --runtime both`
- Skill index docs for routing tasks to the right playbook.

### Changed

- Mid-session agent refresh stays lightweight (`gitnexus:agent-refresh`), while commit-time refresh uses PDG.
- Update can upgrade an existing cursor-only or zed-only install to `both`.
- Zed-only installs now include shared helper modules required by target repo CLI commands without enabling Cursor hooks.
- Generated MCP snippets now use current v1.6.8 parameter names (`search_query`, Cypher `statement`).
- Help examples now use neutral placeholder repo names.

### Fixed

- Zed-only `gitnexus-agent.mjs health/brief/verify` compatibility.
- Incorrect “Index built” status when install/update used `--no-setup`.
- Private/source repo name leakage in public docs and maintainer scripts.
- Legacy mirrored skills using outdated MCP argument names.

### Migration notes

- To upgrade an installed repo to Cursor + Zed support:

  ```bash
  ./bin/update.sh /path/to/repo --runtime both --no-setup --skip-verify
  ```

- To upgrade every installed repo under a workspace root:

  ```bash
  ./bin/update.sh --all /path/to/projects --runtime both --no-setup --skip-verify
  ```

- After update, restart Cursor/Zed and run in target repos:

  ```bash
  npm run gitnexus:health
  npm run gitnexus:verify
  ```
