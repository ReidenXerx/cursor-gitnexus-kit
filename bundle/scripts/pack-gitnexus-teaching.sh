#!/usr/bin/env bash
# Pack portable GitNexus + Cursor teaching bundle for other repos (tar.gz archive).
#
# Usage:
#   npm run gitnexus:pack
#   npm run gitnexus:pack -- --output /tmp/my-bundle.tar.gz
#
# Teammates on another project:
#   tar -xzf gitnexus-cursor-teaching-*.tar.gz -C /path/to/their-repo
#   cd /path/to/their-repo && bash scripts/gitnexus-teaching/install-from-bundle.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUTPUT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output|-o) OUTPUT="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,12p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
VERSION="$(node -e "
  const fs=require('fs');
  const p='.cursor/gitnexus-teaching-bundle.json';
  if(fs.existsSync(p)){console.log(JSON.parse(fs.readFileSync(p,'utf8')).version||2)}else{console.log(2)}
")"
BASENAME="gitnexus-cursor-teaching-v${VERSION}-${STAMP}"
WORKDIR="$(mktemp -d)"
BUNDLE_ROOT="$WORKDIR/$BASENAME"
ARCHIVE="${OUTPUT:-$ROOT/${BASENAME}.tar.gz}"

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m    ✓\033[0m %s\n' "$*"; }

# Paths relative to repo root — keep in sync with scripts/gitnexus-setup.sh TEACHING_SOURCES
BUNDLE_PATHS=(
  .cursor/rules/00-gitnexus-enforcement.mdc
  .cursor/rules/gitnexus.mdc
  .cursor/rules/gitnexus-first.mdc
  .cursor/hooks.json
  .cursor/hooks/gitnexus-session-primer.sh
  .cursor/hooks/gitnexus-session-health.sh
  .cursor/hooks/gitnexus-session-health-user.sh
  .cursor/hooks/gitnexus-prompt-router.sh
  .cursor/hooks/gitnexus-grep-guard.sh
  .cursor/hooks/gitnexus-read-guard.sh
  .cursor/hooks/gitnexus-edit-guard.sh
  .cursor/hooks/gitnexus-shell-staleness-guard.sh
  .cursor/hooks/gitnexus-shell-allowlist.sh
  .cursor/hooks/gitnexus-mcp-allowlist.sh
  .cursor/hooks/gitnexus-after-git-commit.sh
  .cursor/hooks/lib/check-staleness.mjs
  .cursor/hooks/lib/load-staleness.mjs
  .cursor/hooks/lib/graph-session.mjs
  .cursor/hooks/lib/session-primer.mjs
  .cursor/hooks/lib/first-nudge.mjs
  .cursor/hooks/lib/clear-session.mjs
  .cursor/hooks/lib/set-refresh-pending.mjs
  .cursor/hooks/lib/hook-helpers.mjs
  .cursor/hooks/lib/cypher-helpers.mjs
  .cursor/hooks/lib/rename-helpers.mjs
  .cursor/hooks/lib/detect-api-router.mjs
  .cursor/hooks/lib/graph-smoke.mjs
  .cursor/hooks/lib/agent-brief.mjs
  .cursor/hooks/lib/agent-health.mjs
  .cursor/hooks/lib/session-health-audit.mjs
  .cursor/hooks/lib/session-health-context.mjs
  .cursor/gitnexus-hooks.json
  .claude/skills/gitnexus
  .claude/skills/gitnexus-workspace
  .claude/skills/gitnexus-enforcement
  .githooks/pre-commit
  .vscode/settings.json
  scripts/gitnexus-setup.sh
  scripts/sync-cursor-gitnexus-teaching.sh
  scripts/pack-gitnexus-teaching.sh
  scripts/install-git-hooks.sh
  scripts/gitnexus-agent.mjs
  scripts/run-with-project-tmp.sh
  scripts/clean-project-tmp.sh
  scripts/lib/project-tmp.mjs
  scripts/gitnexus-teaching/install-from-bundle.sh
  scripts/gitnexus-teaching/merge-package-scripts.mjs
  docs/GITNEXUS-TEAM-BUNDLE.md
  docs/GITNEXUS-CURSOR-GUIDE.md
  .gitnexusignore
)

info "Packing GitNexus Cursor teaching bundle v${VERSION}"

for rel in "${BUNDLE_PATHS[@]}"; do
  [[ -e "$rel" ]] || { echo "Missing bundle file: $rel" >&2; exit 1; }
  mkdir -p "$BUNDLE_ROOT/$(dirname "$rel")"
  if [[ -d "$rel" ]]; then
    rsync -a "$rel/" "$BUNDLE_ROOT/$rel/"
  else
    cp -a "$rel" "$BUNDLE_ROOT/$rel"
  fi
done

# package.json scripts snippet (generated from canonical merge script)
node scripts/gitnexus-teaching/merge-package-scripts.mjs --snippet > "$BUNDLE_ROOT/package.json.scripts.snippet.json"

# gitignore snippet
cat > "$BUNDLE_ROOT/gitignore.snippet" <<'SNIP'
# GitNexus + cursor-gitnexus-kit generated local state (safe to remove via gn-kit uninstall)
.gitnexus/
.tmp-agent/
.cursor/skills/
.cursor/gitnexus-teaching-bundle.json
.cursor/gn-kit-manifest.json
.cursor/.gitnexus-session-edits.flag
.cursor/.gitnexus-session-primed.flag
.cursor/.gitnexus-prompt-hint.json
.cursor/.gitnexus-refresh-pending.flag
.cursor/.gitnexus-mcp-used.flag
.cursor/.gitnexus-deny-cache.json
.cursor/.gitnexus-session-health.json
.cursor/.gitnexus-session-user-notified.flag
.cursor/gitnexus-api-profile.json
SNIP

node <<NODE > "$BUNDLE_ROOT/MANIFEST.json"
const fs = require('fs');
const manifest = {
  bundle: 'gitnexus-cursor-teaching',
  version: ${VERSION},
  packedAt: new Date().toISOString(),
  sourceRepo: '__GITNEXUS_REPO__',
  files: $(node -e "console.log(JSON.stringify(process.argv.slice(1)))" "${BUNDLE_PATHS[@]}" "package.json.scripts.snippet.json" "gitignore.snippet" "MANIFEST.json"),
  notes: [
    'Project-specific: replace __GITNEXUS_REPO__ with target repo name in rules/hooks/skills',
    'Run scripts/gitnexus-teaching/install-from-bundle.sh after extracting',
    'Area skills (.claude/skills/generated) are NOT bundled — created by gitnexus:refresh on target repo',
  ],
};
console.log(JSON.stringify(manifest, null, 2));
NODE

chmod +x "$BUNDLE_ROOT"/scripts/*.sh "$BUNDLE_ROOT"/.cursor/hooks/*.sh 2>/dev/null || true

tar -czf "$ARCHIVE" -C "$WORKDIR" "$BASENAME"
rm -rf "$WORKDIR"

ok "Created $ARCHIVE"
echo ""
echo "Send to teammates:"
echo "  tar -xzf $(basename "$ARCHIVE") -C /path/to/their-repo --strip-components=1"
echo "  cd /path/to/their-repo && bash scripts/gitnexus-teaching/install-from-bundle.sh"
echo ""
echo "See docs/GITNEXUS-TEAM-BUNDLE.md inside the archive."
