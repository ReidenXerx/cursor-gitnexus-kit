#!/usr/bin/env bash
# install-gitnexus-mcp.sh — Install and index GitNexus inside a SWE-bench Docker container
#
# This script runs INSIDE each Docker container before the agent starts.
# It installs GitNexus, builds the knowledge graph WITH PDG (Program Dependence
# Graph), and makes the MCP server available.
#
# PDG gives the agent access to:
#   - Control dependence (CDG): what condition gates a statement
#   - Data dependence (REACHING_DEF): where a variable flows
#   - Taint analysis: source→sink data flows for security review
#   - Statement-level impact slicing for precise blast-radius
#
# Called by the GitNexus arm's environment setup:
#   bash install-gitnexus-mcp.sh [--skip-index] [--no-pdg]
#
# Environment:
#   TESTBED        — path to the repo in the container (default: /testbed)
#   GITNEXUS_BIN   — path to gitnexus binary (default: auto-detect)
set -euo pipefail

TESTBED="${TESTBED:-/testbed}"
SKIP_INDEX=false
NO_PDG=false

for arg in "$@"; do
  case "$arg" in
    --skip-index) SKIP_INDEX=true ;;
    --no-pdg) NO_PDG=true ;;
    *) echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

echo "[gitnexus-setup] Installing GitNexus in container..."

# ── 1. Install Node.js (required by gitnexus) ──────────────
if ! command -v node &>/dev/null; then
  echo "[gitnexus-setup] Installing Node.js..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "[gitnexus-setup] Node version: $(node --version)"

# ── 2. Install GitNexus ─────────────────────────────────────
if [[ -n "${GITNEXUS_BIN:-}" && -x "${GITNEXUS_BIN}" ]]; then
  echo "[gitnexus-setup] Using pre-installed gitnexus: $GITNEXUS_BIN"
  GITNEXUS_CMD="$GITNEXUS_BIN"
else
  echo "[gitnexus-setup] Installing gitnexus via npm..."
  npm install -g gitnexus@latest 2>/dev/null || {
    echo "[gitnexus-setup] npm global install failed, trying npx fallback..."
    # npx will be used per-call instead
  }
  GITNEXUS_CMD="gitnexus"
fi

# Verify
if command -v gitnexus &>/dev/null; then
  echo "[gitnexus-setup] GitNexus version: $(gitnexus --version 2>/dev/null || echo 'unknown')"
else
  echo "[gitnexus-setup] WARNING: gitnexus command not found; will use npx"
fi

# ── 3. Build the knowledge graph WITH PDG ───────────────────
if [[ "$SKIP_INDEX" == false ]]; then
  echo "[gitnexus-setup] Building knowledge graph for: $TESTBED"
  cd "$TESTBED"

  REPO_NAME="$(basename "$TESTBED")"

  # Step 3a: Base analysis + embeddings
  # This builds the symbol graph, communities, processes, and embeddings
  echo "[gitnexus-setup] Step 1/2: Building symbol graph + embeddings..."
  if command -v gitnexus &>/dev/null; then
    gitnexus analyze --embeddings --repo "$REPO_NAME" 2>&1 | tail -5
  else
    npx -y gitnexus@latest analyze --embeddings --repo "$REPO_NAME" 2>&1 | tail -5
  fi

  # Step 3b: PDG layer (control + data dependence + taint)
  # This adds CDG edges, REACHING_DEF edges, and taint flows on top of the
  # base graph. PDG is what enables:
  #   - pdg_query: statement-level control/data dependence
  #   - explain: taint analysis (command-injection, path-traversal, etc.)
  #   - impact mode pdg: statement-level affected-code slicing
  #   - Precise "what condition gates this line?" answers
  if [[ "$NO_PDG" == false ]]; then
    echo "[gitnexus-setup] Step 2/2: Building PDG layer (control + data dependence + taint)..."
    if command -v gitnexus &>/dev/null; then
      gitnexus analyze --pdg --repo "$REPO_NAME" 2>&1 | tail -5
    else
      npx -y gitnexus@latest analyze --pdg --repo "$REPO_NAME" 2>&1 | tail -5
    fi
    echo "[gitnexus-setup] PDG layer built. Agent has access to:"
    echo "[gitnexus-setup]   - Control dependence (CDG): what guards each statement"
    echo "[gitnexus-setup]   - Data dependence (REACHING_DEF): where variables flow"
    echo "[gitnexus-setup]   - Taint analysis: source→sink data flows"
    echo "[gitnexus-setup]   - Statement-level impact slicing"
  else
    echo "[gitnexus-setup] Skipping PDG layer (--no-pdg). Graph has embeddings only."
  fi

  echo "[gitnexus-setup] Knowledge graph built at: $TESTBED/.gitnexus/"

  # Verify the graph
  echo "[gitnexus-setup] Verifying graph..."
  if [[ -f "$TESTBED/.gitnexus/meta.json" ]]; then
    NODES=$(python3 -c "import json; d=json.load(open('$TESTBED/.gitnexus/meta.json')); print(d.get('nodeCount', 'unknown'))" 2>/dev/null || echo "unknown")
    echo "[gitnexus-setup] Graph nodes: $NODES"
  fi
  if [[ -d "$TESTBED/.gitnexus/pdg" ]]; then
    echo "[gitnexus-setup] PDG layer: present"
  else
    echo "[gitnexus-setup] PDG layer: absent (agent falls back to graph-only tools)"
  fi
fi

echo "[gitnexus-setup] Done. GitNexus MCP ready with PDG-powered cache."
