#!/usr/bin/env bash
# sessionStart: inject GitNexus workflow + auto-refresh stale index + reset session flags.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export GITNEXUS_HOOK_INPUT="$(cat)"
node "$ROOT/.cursor/hooks/lib/clear-session.mjs" "$ROOT" 2>/dev/null || true

composer_mode="$(echo "$GITNEXUS_HOOK_INPUT" | node -e "
  let j='{}'; try { j=JSON.parse(require('fs').readFileSync(0,'utf8')); } catch {}
  process.stdout.write(j.composer_mode ?? '');
" 2>/dev/null || true)"

if [[ "$composer_mode" == "ask" ]]; then
  echo '{}'
  exit 0
fi

STALENESS_JSON="$(node "$ROOT/.cursor/hooks/lib/check-staleness.mjs" "$ROOT" 2>/dev/null || echo '{"fresh":false,"reason":"check_failed"}')"
IS_FRESH="$(echo "$STALENESS_JSON" | node -e "
  let j={}; try { j=JSON.parse(require('fs').readFileSync(0,'utf8')); } catch {}
  process.stdout.write(j.fresh === true ? 'true' : 'false');
" <<< "$STALENESS_JSON")"

REFRESH_CONTEXT=""
if [[ "$IS_FRESH" != "true" ]] && [[ "${GITNEXUS_SKIP_SESSION_REFRESH:-}" != "1" ]]; then
  node "$ROOT/.cursor/hooks/lib/set-refresh-pending.mjs" "$ROOT" set "$STALENESS_JSON" 2>/dev/null || true
  if node "$ROOT/scripts/gitnexus-agent.mjs" refresh; then
    REFRESH_CONTEXT="GitNexus index was stale at session start — auto-refresh completed successfully. Use graph tools normally."
    node "$ROOT/.cursor/hooks/lib/set-refresh-pending.mjs" "$ROOT" clear 2>/dev/null || true
  else
    REFRESH_CONTEXT="GitNexus index is STALE and auto-refresh failed at session start. Agent MUST run Shell: npm run gitnexus:agent-refresh with required_permissions [\"all\"] as the very next tool call. NEVER tell the user to run npx gitnexus analyze."
  fi
elif [[ "$IS_FRESH" != "true" ]]; then
  REFRESH_CONTEXT="GitNexus index is stale (GITNEXUS_SKIP_SESSION_REFRESH=1). Agent MUST run npm run gitnexus:agent-refresh autonomously before structural edits — never ask the user."
fi

cat <<JSON
{
  "env": {
    "GITNEXUS_REPO": "__GITNEXUS_REPO__",
    "GITNEXUS_WORKFLOW": "context→query→context→impact→detect_changes",
    "GITNEXUS_AGENT_REFRESH": "npm run gitnexus:agent-refresh"
  },
  "additional_context": "__GITNEXUS_REPO__ GitNexus north star: prefer graph tools for ALL code reasoning when index is fresh (not only first lookup); refresh autonomously when stale; classical Grep/Read/Search only when GN is stale/failing/wrong — say why. (1) agent-status OR READ context — autonomous. (2) stale → agent-refresh (required_permissions all) — never ask user to run analyze. (3) query/context/impact/detect_changes throughout tasks. (4) Classical fallback when stale or GN broken. ${REFRESH_CONTEXT}"
}
JSON
