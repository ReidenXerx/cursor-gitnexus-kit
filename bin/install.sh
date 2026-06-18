#!/usr/bin/env bash
# Install cursor-gitnexus-kit into a target git repo.
# Usage: ./bin/install.sh /path/to/repo [--repo-name NAME] [--quick] [--no-setup] [--skip-verify]
set -euo pipefail

KIT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-}"

if [[ -z "$TARGET" ]] || [[ "$TARGET" == "-h" ]] || [[ "$TARGET" == "--help" ]]; then
  sed -n '2,4p' "$0" | sed 's/^# \?//'
  echo ""
  echo "Examples:"
  echo "  $0 ../crypto-trading-bot"
  echo "  $0 ../my-app --repo-name my-app --quick"
  exit 0
fi

shift
exec node "$KIT_ROOT/lib/kit.mjs" install "$TARGET" "$@"
