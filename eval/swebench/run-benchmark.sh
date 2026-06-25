#!/usr/bin/env bash
# run-benchmark.sh — SWE-bench Verified with and without GitNexus
#
# Runs both arms (baseline + gitnexus), scores with swebench, and produces
# a paired comparison report.
#
# Usage:
#   ./eval/swebench/run-benchmark.sh --model <litellm-model> [options]
#
# Options:
#   --model MODEL          litellm model string (required)
#   --instances N          Run first N instances from SWE-bench Verified (default: all)
#   --instance-ids IDS     Comma-separated instance IDs (overrides --instances)
#   --step-limit N         Max agent steps per instance (default: 250)
#   --cost-limit FLOAT     Max cost per instance in USD (default: 3.0)
#   --timeout N            Per-command timeout in seconds (default: 60)
#   --workers N            Parallel Docker workers (default: 1)
#   --results-dir DIR      Output directory (default: eval/swebench/results)
#   --skip-baseline        Skip baseline arm (use existing results)
#   --skip-gitnexus        Skip gitnexus arm (use existing results)
#   --skip-score           Skip scoring (just run agent trajectories)
#   --skip-index           Skip gitnexus analyze step (use existing index)
#   -h, --help             Show this help
#
# Environment:
#   ANTHROPIC_API_KEY, OPENAI_API_KEY, DEEPSEEK_API_KEY, etc. — set for your model
#   GITNEXUS_REPO          GitNexus MCP server repo name override (default: auto-detect)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
KIT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
RESULTS_DIR="$SCRIPT_DIR/results"

# Defaults
MODEL=""
INSTANCES=""
INSTANCE_IDS=""
STEP_LIMIT=250
COST_LIMIT=3.0
TIMEOUT=60
WORKERS=1
SKIP_BASELINE=false
SKIP_GITNEXUS=false
SKIP_SCORE=false
SKIP_INDEX=false

usage() {
  sed -n '2,/^set -euo pipefail/p' "$0" | head -n -1 | sed 's/^# //' | sed 's/^#//'
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --model) MODEL="$2"; shift 2 ;;
    --instances) INSTANCES="$2"; shift 2 ;;
    --instance-ids) INSTANCE_IDS="$2"; shift 2 ;;
    --step-limit) STEP_LIMIT="$2"; shift 2 ;;
    --cost-limit) COST_LIMIT="$2"; shift 2 ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    --workers) WORKERS="$2"; shift 2 ;;
    --results-dir) RESULTS_DIR="$2"; shift 2 ;;
    --skip-baseline) SKIP_BASELINE=true; shift ;;
    --skip-gitnexus) SKIP_GITNEXUS=true; shift ;;
    --skip-score) SKIP_SCORE=true; shift ;;
    --skip-index) SKIP_INDEX=true; shift ;;
    -h|--help) usage ;;
    *) echo "Unknown option: $1"; usage ;;
  esac
done

if [[ -z "$MODEL" ]]; then
  echo "ERROR: --model is required"
  usage
fi

echo "╔══════════════════════════════════════════════════════════╗"
echo "║   SWE-bench Verified — GitNexus Benchmark Runner         ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "Model:        $MODEL"
echo "Step limit:   $STEP_LIMIT"
echo "Cost limit:   \$$COST_LIMIT"
echo "Workers:      $WORKERS"
echo "Results:      $RESULTS_DIR"
echo ""

# ── Check dependencies ──────────────────────────────────────
command -v python3 >/dev/null 2>&1 || { echo "ERROR: python3 required"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "ERROR: docker required"; exit 1; }
python3 -c "import minisweagent" 2>/dev/null || { echo "ERROR: mini-swe-agent not installed. Run: pip install mini-swe-agent"; exit 1; }
python3 -c "import swebench" 2>/dev/null || { echo "ERROR: swebench not installed. Run: pip install swebench"; exit 1; }

# ── Determine instance IDs ──────────────────────────────────
if [[ -n "$INSTANCE_IDS" ]]; then
  IDS_ARG="--instance_ids $INSTANCE_IDS"
elif [[ -n "$INSTANCES" ]]; then
  IDS_ARG="--instance_ids $(python3 -c "
from datasets import load_dataset
ds = load_dataset('princeton-nlp/SWE-bench_Verified', split='test')
print(','.join(ds['instance_id'][:int('$INSTANCES')]))
")"
else
  IDS_ARG=""
fi

# ── Create results directory ─────────────────────────────────
mkdir -p "$RESULTS_DIR/baseline" "$RESULTS_DIR/gitnexus"

# ── Helper: update config with model name ───────────────────
patch_config_model() {
  local config="$1"
  local model="$2"
  # Update model_name in the yaml config
  if command -v yq >/dev/null 2>&1; then
    yq -i ".model.model_name = \"$model\"" "$config"
  else
    # Fallback: sed-based replacement
    sed -i "s/model_name: .*/model_name: \"$model\"/" "$config"
  fi
}

# ── Helper: run mini-swe-agent on SWE-bench ──────────────────
run_arm() {
  local arm="$1"  # "baseline" or "gitnexus"
  local config="$2"
  local output_dir="$RESULTS_DIR/$arm"
  local run_id="${arm}-$(date +%Y%m%d-%H%M%S)"

  echo ""
  echo "═══════════════════════════════════════════════════════════"
  echo "  Running $arm arm"
  echo "═══════════════════════════════════════════════════════════"
  echo ""

  # Create a per-run copy of the config with the right model
  local run_config="$output_dir/config.yaml"
  cp "$config" "$run_config"
  patch_config_model "$run_config" "$MODEL"

  # Update step/cost limits
  if command -v yq >/dev/null 2>&1; then
    yq -i ".agent.step_limit = $STEP_LIMIT" "$run_config"
    yq -i ".agent.cost_limit = $COST_LIMIT" "$run_config"
    yq -i ".environment.timeout = $TIMEOUT" "$run_config"
  else
    sed -i "s/step_limit: .*/step_limit: $STEP_LIMIT/" "$run_config"
    sed -i "s/cost_limit: .*/cost_limit: $COST_LIMIT/" "$run_config"
  fi

  # Run mini-swe-agent batch inference
  # mini-swe-agent handles Docker container setup and SWE-bench instance management
  python3 -m minisweagent.run.from_swe_bench \
    --config "$run_config" \
    --output_dir "$output_dir/trajectories" \
    $IDS_ARG \
    --max_workers "$WORKERS" \
    --run_id "$run_id" \
    ${EXTRA_MINI_ARGS:-}

  echo ""
  echo "  $arm arm complete. Trajectories in: $output_dir/trajectories"
}

# ══════════════════════════════════════════════════════════════
# ARM 1: BASELINE (no GitNexus)
# ══════════════════════════════════════════════════════════════
if [[ "$SKIP_BASELINE" == false ]]; then
  run_arm "baseline" "$SCRIPT_DIR/configs/baseline.yaml"
fi

# ══════════════════════════════════════════════════════════════
# ARM 2: GITNEXUS (with GitNexus MCP)
# ══════════════════════════════════════════════════════════════
if [[ "$SKIP_GITNEXUS" == false ]]; then
  echo ""
  echo "═══════════════════════════════════════════════════════════"
  echo "  Preparing GitNexus arm: installing MCP into agent config"
  echo "═══════════════════════════════════════════════════════════"

  # The GitNexus arm uses the gitnexus.yaml config which includes
  # GitNexus tool definitions in the system prompt.
  #
  # At the MCP level, we need to make gitnexus available as a tool
  # server. mini-swe-agent supports this via environment setup scripts
  # that run inside the Docker container before each instance.
  #
  # The setup script installs gitnexus in the container and runs
  # `gitnexus analyze --embeddings` on the repo.

  run_arm "gitnexus" "$SCRIPT_DIR/configs/gitnexus.yaml"
fi

# ══════════════════════════════════════════════════════════════
# SCORING
# ══════════════════════════════════════════════════════════════
if [[ "$SKIP_SCORE" == false ]]; then
  echo ""
  echo "═══════════════════════════════════════════════════════════"
  echo "  Scoring patches with SWE-bench evaluation harness"
  echo "═══════════════════════════════════════════════════════════"
  echo ""

  # Extract patches from trajectories and score them
  python3 "$SCRIPT_DIR/scoring/score-pairs.py" \
    --baseline "$RESULTS_DIR/baseline/trajectories" \
    --gitnexus "$RESULTS_DIR/gitnexus/trajectories" \
    --output "$RESULTS_DIR" \
    --model "$MODEL" \
    $IDS_ARG
fi

echo ""
echo "Done! Results in: $RESULTS_DIR"
echo "Report: $RESULTS_DIR/report.md"
