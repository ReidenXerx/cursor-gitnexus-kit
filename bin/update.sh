#!/usr/bin/env bash
# Update gitnexus-agent-kit in a target repo.
# Usage: ./bin/update.sh /path/to/repo [--runtime cursor|zed|both] [--full] [--no-setup] [--skip-verify]
#        ./bin/update.sh --all [search-root] [--runtime cursor|zed|both] [--no-setup] [--skip-verify]
set -euo pipefail

KIT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-}"

if [[ -z "$TARGET" ]] || [[ "$TARGET" == "-h" ]] || [[ "$TARGET" == "--help" ]]; then
  sed -n '2,4p' "$0" | sed 's/^# *//'
  exit 0
fi

shift
if [[ "$TARGET" == "--all" ]] || [[ "$TARGET" == "--all-installed" ]]; then
  SEARCH_ROOT="${1:-$HOME/Projects}"
  if [[ $# -gt 0 ]]; then shift; fi
  exec node "$KIT_ROOT/lib/kit.mjs" update-all "$SEARCH_ROOT" "$@"
fi

exec node "$KIT_ROOT/lib/kit.mjs" update "$TARGET" "$@"
