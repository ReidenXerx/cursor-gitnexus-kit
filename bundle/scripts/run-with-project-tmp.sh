#!/usr/bin/env bash
# Run a command with TMPDIR on project disk (not tmpfs /tmp).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="${GITNEXUS_TMPDIR:-$ROOT/.tmp-agent}"
export TMPDIR="$TMP"
export TEMP="$TMP"
export TMP="$TMP"
mkdir -p "$TMPDIR"
exec "$@"
