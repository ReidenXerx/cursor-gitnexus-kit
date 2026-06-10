#!/usr/bin/env bash
# Uninstall cursor-gitnexus-kit from a target repo (restores hooks/mcp backups when present).
# Usage: ./bin/uninstall.sh /path/to/repo [--remove-index]
set -euo pipefail

KIT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-}"

if [[ -z "$TARGET" ]] || [[ "$TARGET" == "-h" ]] || [[ "$TARGET" == "--help" ]]; then
  sed -n '2,4p' "$0" | sed 's/^# \?//'
  echo ""
  echo "  --remove-index   Also delete .gitnexus/ and .tmp-agent/"
  exit 0
fi

shift
exec node "$KIT_ROOT/lib/kit.mjs" uninstall "$TARGET" "$@"
