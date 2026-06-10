#!/usr/bin/env bash
# Maintainer: re-copy bundle from a source repo (default: ../crypto-trading-bot).
# Usage: ./scripts/refresh-bundle-from-source.sh [source-repo-path]
set -euo pipefail

KIT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:-$(dirname "$KIT_ROOT")/crypto-trading-bot}"

[[ -d "$SRC/.cursor/hooks" ]] || { echo "Missing source hooks: $SRC" >&2; exit 1; }

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }

info "Refreshing bundle from $SRC"

rm -rf "$KIT_ROOT/bundle"
mkdir -p "$KIT_ROOT/bundle/.cursor/rules" "$KIT_ROOT/bundle/.claude/skills"

cp -a "$SRC/.cursor/rules/"* "$KIT_ROOT/bundle/.cursor/rules/"
cp "$SRC/.cursor/hooks.json" "$KIT_ROOT/bundle/.cursor/"
cp -a "$SRC/.cursor/hooks" "$KIT_ROOT/bundle/.cursor/"
cp -a "$SRC/.claude/skills/gitnexus" "$KIT_ROOT/bundle/.claude/skills/"
cp -a "$SRC/.claude/skills/gitnexus-workspace" "$KIT_ROOT/bundle/.claude/skills/"
cp -a "$SRC/.claude/skills/gitnexus-enforcement" "$KIT_ROOT/bundle/.claude/skills/"
mkdir -p "$KIT_ROOT/bundle/.githooks" "$KIT_ROOT/bundle/.vscode" "$KIT_ROOT/bundle/scripts/lib" "$KIT_ROOT/bundle/scripts/gitnexus-teaching" "$KIT_ROOT/bundle/docs"
cp "$SRC/.githooks/pre-commit" "$KIT_ROOT/bundle/.githooks/"
cp "$SRC/.vscode/settings.json" "$KIT_ROOT/bundle/.vscode/"
cp "$SRC/.gitnexusignore" "$KIT_ROOT/bundle/"
for f in gitnexus-setup.sh sync-cursor-gitnexus-teaching.sh pack-gitnexus-teaching.sh install-git-hooks.sh gitnexus-agent.mjs run-with-project-tmp.sh clean-project-tmp.sh; do
  cp "$SRC/scripts/$f" "$KIT_ROOT/bundle/scripts/"
done
cp "$SRC/scripts/lib/project-tmp.mjs" "$KIT_ROOT/bundle/scripts/lib/"
cp "$SRC/scripts/gitnexus-teaching/"* "$KIT_ROOT/bundle/scripts/gitnexus-teaching/"
if [[ -f "$KIT_ROOT/bundle/docs/GITNEXUS-TEAM-BUNDLE.md" ]]; then
  cp "$KIT_ROOT/bundle/docs/GITNEXUS-TEAM-BUNDLE.md" "$KIT_ROOT/docs/TEAM-BUNDLE.md"
elif [[ -f "$SRC/docs/GITNEXUS-TEAM-BUNDLE.md" ]]; then
  cp "$SRC/docs/GITNEXUS-TEAM-BUNDLE.md" "$KIT_ROOT/bundle/docs/GITNEXUS-TEAM-BUNDLE.md"
  cp "$SRC/docs/GITNEXUS-TEAM-BUNDLE.md" "$KIT_ROOT/docs/TEAM-BUNDLE.md"
fi
# AGENT-PROFILES.stub.md is kit-owned (not overwritten from source — projects customize AGENT-PROFILES.md)

find "$KIT_ROOT/bundle" -type f \( -name '*.mdc' -o -name '*.sh' -o -name '*.mjs' -o -name 'SKILL.md' -o -name '*.md' \) -print0 \
  | xargs -0 sed -i '' 's/crypto-trading-bot/__GITNEXUS_REPO__/g'

chmod +x "$KIT_ROOT/bundle/scripts/"*.sh "$KIT_ROOT/bundle/.cursor/hooks/"*.sh 2>/dev/null || true

info "Done — run npm test && ./bin/update.sh <target-repo>"
