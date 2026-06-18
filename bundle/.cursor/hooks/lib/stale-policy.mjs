/**
 * Stale index policy — refresh first, classical tools only after refresh fails.
 *
 * Phases:
 *   fresh              — graph trusted; hooks enforce graph-first tools
 *   must_refresh       — stale; deny classical + MCP until agent-refresh runs
 *   classical_fallback — refresh attempted and failed; classical OK with reason
 */
import { isRefreshFailed, isRefreshPending } from './session-primer.mjs';

/**
 * @param {object} stale from check-staleness / load-staleness
 * @param {string} root repo root
 */
export function evaluateStalePolicy(stale, root) {
  if (stale?.fresh) {
    return {
      phase: 'fresh',
      forceRefresh: false,
      allowClassical: false,
      allowGraphTools: true,
    };
  }

  if (isRefreshFailed(root)) {
    return {
      phase: 'classical_fallback',
      forceRefresh: false,
      allowClassical: true,
      allowGraphTools: true,
    };
  }

  return {
    phase: 'must_refresh',
    forceRefresh: true,
    allowClassical: false,
    allowGraphTools: false,
    refreshPending: isRefreshPending(root),
  };
}

/**
 * @param {object} stale
 * @param {ReturnType<typeof evaluateStalePolicy>} policy
 */
export function staleRefreshAgentMessage(stale, policy) {
  const detail = stale?.detail || stale?.reason || 'index not fresh';

  if (policy.phase === 'must_refresh') {
    const pending = policy.refreshPending ? ' Session auto-refresh did not complete.' : '';
    return (
      `STALE INDEX (${detail}) — mandatory refresh BEFORE Grep/Read/MCP/shell.${pending} ` +
      'Shell NOW: npm run gitnexus:agent-refresh with required_permissions: ["all"]. ' +
      'Run yourself — never ask the user to run npx gitnexus analyze.'
    );
  }

  if (policy.phase === 'classical_fallback') {
    return (
      `GN FALLBACK (${detail}): agent-refresh failed or graph unavailable. ` +
      'Classical Grep/Read OK — state why refresh failed in one sentence.'
    );
  }

  return '';
}
