#!/usr/bin/env bash
# __GITNEXUS_REPO__ — all-in-one GitNexus + Cursor teaching + git hooks team installer.
#
# Installs:
#   • Cursor teaching bundle (rules, hooks, skills sync, manifest)
#   • GitNexus MCP (project + optional global)
#   • Git pre-commit index refresh (no personal tooling)
#   • Knowledge graph index
#
# Run once after cloning:
#   npm run gitnexus:setup
#
# Options:
#   --quick           Hooks + teaching + MCP only; skip index build
#   --full            Force full re-index (--force)
#   --skip-index      Same as --quick for index step
#   --skip-global-mcp Skip global gitnexus setup (~/.cursor/mcp.json)
#   -h, --help        Show usage
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

GITNEXUS_CLI=(npx -y gitnexus@latest)
SKIP_INDEX=false
FULL_INDEX=false
SKIP_GLOBAL_MCP=false

usage() {
  sed -n '2,18p' "$0" | sed 's/^# \?//'
  echo ""
  echo "Examples:"
  echo "  npm run gitnexus:setup              # full team onboarding (recommended)"
  echo "  npm run gitnexus:setup -- --quick   # teaching + hooks/MCP, skip index"
  echo "  npm run gitnexus:setup -- --full    # force full graph rebuild"
  echo ""
  echo "Re-sync teaching only (after pulling rule/skill updates):"
  echo "  npm run gitnexus:pack             # tar.gz for other projects"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --quick|--skip-index) SKIP_INDEX=true ;;
    --full) FULL_INDEX=true ;;
    --skip-global-mcp) SKIP_GLOBAL_MCP=true ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
  shift
done

info()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m    ✓\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m    !\033[0m %s\n' "$*"; }
fail()  { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

require_cmd() { command -v "$1" >/dev/null 2>&1 || fail "Missing: $1"; }
require_file() { [[ -f "$1" ]] || fail "Missing: $1"; }

semver_ge() {
  node -e "
    const p = v => v.replace(/^v/, '').split('.').map(n => +n || 0);
    const a = p(process.argv[1]), b = p(process.argv[2]);
    for (let i = 0; i < 3; i++) { if (a[i] > b[i]) process.exit(0); if (a[i] < b[i]) process.exit(1); }
    process.exit(0);
  " "$1" "$2"
}

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  __GITNEXUS_REPO__ — GitNexus team setup                    ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ── 1. prerequisites ─────────────────────────────────────────────────────────

info "Checking prerequisites"
require_cmd git
require_cmd node
require_cmd npm
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "Not a git repo"
NODE_VERSION="$(node -p "process.versions.node")"
semver_ge "$NODE_VERSION" "22.9.0" || fail "Node >= 22.9.0 required (found $NODE_VERSION)"
ok "Node.js $NODE_VERSION"

# ── 2. npm scripts (auto-inject / update gitnexus:* commands) ─────────────────

info "Ensuring GitNexus npm scripts in package.json"
node scripts/gitnexus-teaching/merge-package-scripts.mjs --write
ok "package.json gitnexus:* scripts injected"

# ── 3. verify teaching sources (committed in repo) ───────────────────────────

info "Verifying GitNexus teaching sources"

TEACHING_SOURCES=(
  ".cursor/rules/00-gitnexus-enforcement.mdc"
  ".cursor/rules/gitnexus.mdc"
  ".cursor/rules/gitnexus-first.mdc"
  ".cursor/hooks.json"
  ".cursor/hooks/gitnexus-session-primer.sh"
  ".cursor/hooks/gitnexus-session-health.sh"
  ".cursor/hooks/gitnexus-session-health-user.sh"
  ".cursor/hooks/gitnexus-prompt-router.sh"
  ".cursor/hooks/gitnexus-grep-guard.sh"
  ".cursor/hooks/gitnexus-read-guard.sh"
  ".cursor/hooks/gitnexus-edit-guard.sh"
  ".cursor/hooks/gitnexus-shell-staleness-guard.sh"
  ".cursor/hooks/gitnexus-shell-allowlist.sh"
  ".cursor/hooks/gitnexus-mcp-allowlist.sh"
  ".cursor/hooks/gitnexus-after-git-commit.sh"
  ".cursor/hooks/lib/check-staleness.mjs"
  ".cursor/hooks/lib/load-staleness.mjs"
  ".cursor/hooks/lib/graph-session.mjs"
  ".cursor/hooks/lib/session-primer.mjs"
  ".cursor/hooks/lib/first-nudge.mjs"
  ".cursor/hooks/lib/clear-session.mjs"
  ".cursor/hooks/lib/set-refresh-pending.mjs"
  ".cursor/hooks/lib/hook-helpers.mjs"
  ".cursor/hooks/lib/cypher-helpers.mjs"
  ".cursor/hooks/lib/rename-helpers.mjs"
  ".cursor/hooks/lib/detect-api-router.mjs"
  ".cursor/hooks/lib/graph-smoke.mjs"
  ".cursor/hooks/lib/agent-brief.mjs"
  ".cursor/hooks/lib/agent-health.mjs"
  ".cursor/hooks/lib/session-health-audit.mjs"
  ".cursor/hooks/lib/session-health-context.mjs"
  ".cursor/hooks/lib/verify-kit.mjs"
  ".cursor/gitnexus-hooks.json"
  ".vscode/settings.json"
  ".githooks/pre-commit"
  "scripts/gitnexus-setup.sh"
  "scripts/sync-cursor-gitnexus-teaching.sh"
  "scripts/install-git-hooks.sh"
  "scripts/pack-gitnexus-teaching.sh"
  "scripts/gitnexus-agent.mjs"
  "scripts/gitnexus-gate-hint.mjs"
  "scripts/run-with-project-tmp.sh"
  "scripts/clean-project-tmp.sh"
  "scripts/lib/project-tmp.mjs"
  "scripts/lib/setup-ui.mjs"
  "scripts/gitnexus-teaching/install-from-bundle.sh"
  "scripts/gitnexus-teaching/merge-package-scripts.mjs"
  "scripts/gitnexus-teaching/script-gates.mjs"
  "docs/GITNEXUS-TEAM-BUNDLE.md"
  "docs/GITNEXUS-CURSOR-GUIDE.md"
  ".gitnexusignore"
  ".claude/skills/gitnexus-workspace/SKILL.md"
  ".claude/skills/gitnexus-enforcement/SKILL.md"
  ".claude/skills/gitnexus/gitnexus-guide/SKILL.md"
  ".claude/skills/gitnexus/gitnexus-scenarios/SKILL.md"
  ".claude/skills/gitnexus/gitnexus-pr-review/SKILL.md"
  ".claude/skills/gitnexus/gitnexus-api-routes/SKILL.md"
  ".claude/skills/gitnexus/gitnexus-exploring/SKILL.md"
  ".claude/skills/gitnexus/gitnexus-imaging/SKILL.md"
  ".claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md"
  ".claude/skills/gitnexus/gitnexus-debugging/SKILL.md"
  ".claude/skills/gitnexus/gitnexus-refactoring/SKILL.md"
  ".claude/skills/gitnexus/gitnexus-cli/SKILL.md"
)

for f in "${TEACHING_SOURCES[@]}"; do require_file "$f"; done
ok "${#TEACHING_SOURCES[@]} teaching source files present"

# ── 4. install Cursor teaching bundle (rules + hooks + skills sync) ──────────

info "Installing Cursor GitNexus teaching bundle"
chmod +x scripts/sync-cursor-gitnexus-teaching.sh scripts/gitnexus-setup.sh
bash scripts/sync-cursor-gitnexus-teaching.sh

# ── 4. project MCP ───────────────────────────────────────────────────────────

info "Ensuring GitNexus MCP in .cursor/mcp.json"

node <<'NODE'
import fs from 'node:fs';
const p = '.cursor/mcp.json';
const entry = { command: 'npx', args: ['-y', 'gitnexus@latest', 'mcp'] };
let c = { mcpServers: {} };
if (fs.existsSync(p)) c = JSON.parse(fs.readFileSync(p, 'utf8'));
c.mcpServers ??= {};
c.mcpServers.gitnexus = entry;
fs.writeFileSync(p, JSON.stringify(c, null, 2) + '\n');
console.log('    ✓ gitnexus MCP entry in .cursor/mcp.json');
NODE

# ── 5. global MCP (optional) ─────────────────────────────────────────────────

if [[ "$SKIP_GLOBAL_MCP" == false ]]; then
  info "Global GitNexus MCP (optional — all Cursor projects)"
  "${GITNEXUS_CLI[@]}" setup 2>/dev/null && ok "Global MCP configured" \
    || warn "Global setup skipped — project .cursor/mcp.json is sufficient"
else
  ok "Skipped global MCP (--skip-global-mcp)"
fi

# ── 6. git hooks (GitNexus refresh only — no personal tooling) ─────────────────

info "Installing git hooks"
bash scripts/install-git-hooks.sh

# ── 7. knowledge graph index ─────────────────────────────────────────────────

if [[ "$SKIP_INDEX" == true ]]; then
  warn "Skipping index (--quick) — run npm run gitnexus:refresh before using graph tools"
else
  if [[ "$FULL_INDEX" == true ]]; then
    info "Full index rebuild (may take several minutes)"
    npm run gitnexus:full
  else
    info "Incremental index (embeddings + area skills)"
    npm run gitnexus:refresh
  fi
  ok "Knowledge graph indexed"

  info "Detecting HTTP router profile (Express vs custom)"
  npm run gitnexus:detect-api 2>/dev/null && ok "API router profile written" || warn "API profile detection skipped"

  info "Graph smoke test (Cypher / ACCESSES)"
  npm run gitnexus:graph-smoke 2>/dev/null && ok "Graph smoke passed" || warn "Graph smoke failed — check index"

  # Re-sync generated area skills produced by analyze --skills
  info "Re-syncing area skills after index"
  bash scripts/sync-cursor-gitnexus-teaching.sh
fi

# ── 8. verify ─────────────────────────────────────────────────────────────────

info "Full kit verification"
if npm run gitnexus:verify 2>/dev/null; then
  ok "Kit verification passed"
else
  warn "Verification reported issues — run npm run gitnexus:verify after fixing"
fi

# ── 9. onboarding ─────────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Setup complete                                              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
cat <<'ONBOARD'

  GitNexus is now your Cursor agent's code brain — with enforcement.

  ✓ Graph + embeddings indexed (or run gitnexus:agent-refresh after --quick)
  ✓ Hooks block grep-first habits when the graph is fresh
  ✓ Agent refreshes the index autonomously when stale

  NEXT STEPS
  ──────────
  1. RESTART CURSOR on this project (MCP + hooks load on restart)
  2. Open a new Agent chat and describe your task
  3. Share docs/GITNEXUS-CURSOR-GUIDE.md with your team

  Quick check:  npm run gitnexus:health
  Full audit:   npm run gitnexus:verify
  Gate docs:    npm run gitnexus.__gate.1.session

  When hooks redirect the agent (grep/read blocked), that is expected —
  GitNexus is enforcing graph-first reasoning.

  ── Maintainer details ────────────────────────────────────────

  Agent workflow (enforced):
    query → context → cypher (structural) → impact → detect_changes

  Daily commands:
    npm run gitnexus:health          human-friendly status
    npm run gitnexus:agent-brief     session orientation (agents)
    npm run gitnexus:agent-status    staleness (agents)
    npm run gitnexus:agent-refresh   re-index when stale
    npm run gitnexus:sync-teaching   after pulling kit updates

  Hooks DENY (when fresh): symbol Grep, SemanticSearch, broad Glob, large Read
  Hooks ALLOW: gitnexus npm scripts (agent refresh pre-approved)
  MCP: gitnexus in .cursor/mcp.json · pre-commit → gitnexus:refresh

ONBOARD
echo ""
