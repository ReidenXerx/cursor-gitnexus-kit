#!/usr/bin/env bash
# Update cursor-gitnexus-kit files in a target repo (re-copy bundle + sync teaching).
# Usage: ./bin/update.sh /path/to/repo [--repo-name NAME] [--full] [--skip-verify]
# Default: quick update (bundle + hooks, no re-index). Use --full to rebuild graph.
set -euo pipefail

KIT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-}"

if [[ -z "$TARGET" ]] || [[ "$TARGET" == "-h" ]] || [[ "$TARGET" == "--help" ]]; then
  sed -n '2,4p' "$0" | sed 's/^# \?//'
  exit 0
fi

shift
exec node "$KIT_ROOT/lib/kit.mjs" update "$TARGET" "$@"
