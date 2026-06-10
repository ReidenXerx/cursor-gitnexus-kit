#!/usr/bin/env bash
# Clear project-local agent/npm temp (safe — regenerated on next gitnexus run).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="${GITNEXUS_TMPDIR:-$ROOT/.tmp-agent}"

if [[ -d "$TMP" ]]; then
  rm -rf "${TMP:?}"/*
  echo "Cleared project temp: $TMP"
else
  echo "Nothing to clear: $TMP"
fi
