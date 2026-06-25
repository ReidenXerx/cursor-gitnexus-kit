#!/usr/bin/env node
/**
 * Vendor-neutral search classifier — the portable enforcement-policy core.
 *
 * This module knows NOTHING about Cursor's hook protocol (stdin shape,
 * `permission`/`agent_message` keys). It takes a normalized search request plus
 * a context object and returns a neutral {@link Verdict}. Any adapter — today the
 * Cursor `.sh` glue, tomorrow a Zed/other hook host — maps that Verdict onto its
 * own allow/deny wire format. This is where the grep/glob/semantic policy lives,
 * so effectiveness fixes happen in one tested place instead of inside shell heredocs.
 *
 * @typedef {Object} Verdict
 * @property {'allow'|'deny'} decision
 * @property {string} [agentMessage]   Full message for the agent (already composed).
 * @property {string} [userKey]        Key into hook-helpers.userMessage for the human line.
 * @property {Record<string, string|number>} [userVars]
 * @property {boolean} [score]         When true + deny, glue bumps the grepRedirects scorecard.
 *
 * @typedef {Object} ClassifyCtx
 * @property {'fresh'|'must_refresh'|'classical_fallback'} phase
 * @property {boolean} graphUsed       Has any GitNexus MCP tool been used this session.
 * @property {ReturnType<import('./hook-helpers.mjs').loadHookConfig>} config
 * @property {string} repo
 * @property {string} root
 * @property {string} [staleMustRefreshMsg]  Precomputed agent message for must_refresh.
 * @property {string} [staleFallbackMsg]     Precomputed agent message for classical_fallback.
 */
import * as helpers from "./hook-helpers.mjs";

/** Strip ONE layer of matching surrounding quotes or /regex/ delimiters. */
export function coreToken(pattern) {
  const t = String(pattern || "").trim();
  const m = t.match(/^(['"`/])([\s\S]*)\1[gimsuy]*$/);
  return (m ? m[2] : t).trim();
}

function isPlainIdentifier(t) {
  return /^[A-Za-z_$][\w$]*$/.test(t) && t.length >= 3;
}
function isDottedAccess(t) {
  return /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(t);
}
function isDeclSearch(t) {
  return /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|enum)\s+[A-Za-z_$]/.test(
    t,
  );
}

/**
 * True when the search is scoped to a clearly NON-source file/dir (config, docs,
 * fixtures, assets). Searching *inside* such a file is legitimate grep work even
 * if the term looks like an identifier — so this takes precedence over symbol shape.
 * @param {string} pathArg
 * @param {ClassifyCtx['config']} config
 */
export function isNonSourcePath(pathArg, config) {
  const pa = String(pathArg || "").replace(/\\/g, "/");
  if (!pa || helpers.isSourceCodePath(pa, config)) return false;
  return (
    /\.(json|jsonl|ya?ml|toml|ini|cfg|conf|lock|csv|tsv|env|md|mdc|txt|rst|html?|css|scss|less|svg)$/i.test(
      pa,
    ) ||
    /(?:^|\/)(docs|fixtures?|__snapshots__|test-?data|testdata|public|assets|locales?|i18n)(?:\/|$)/i.test(
      pa,
    )
  );
}

/**
 * True when the pattern itself is a literal string / phrase / URL / regex rather
 * than a code symbol. Quotes are stripped first, so a quoted identifier is NOT a
 * literal (that was the historical bypass — `grep "validateUser"` sailed through).
 * @param {string} pattern
 */
export function isLiteralPattern(pattern) {
  const p = String(pattern || "");
  const t = coreToken(p);
  if (!t) return true;
  if (/\s/.test(t)) return true; // multi-word phrase / literal sentence
  if (/https?:\/\//i.test(p)) return true; // URL
  if (/\/[\w.-]+\/[\w.-]+/.test(p)) return true; // a/b/c path-ish
  if (/^\/[\s\S]*\/[gimsuy]*$/.test(p.trim())) return true; // /regex/
  if (/(TODO|FIXME|HACK|XXX|eslint-|@ts-|@type\b|@param\b|@returns?\b)/.test(p))
    return true;
  if (/\b(?:import|require|from|export\s+\*)\b/.test(t)) return true;
  if (/(?:console\.|process\.env|window\.|document\.|localStorage\.)/.test(p))
    return true;
  return false;
}

/** Reduce a token to the symbol an agent should look up (last dotted segment). */
function symbolOf(token) {
  return token.split(".").pop() || token;
}

/**
 * Classify a Grep/Glob/SemanticSearch request into an allow/deny Verdict.
 * @param {{ tool: string, toolInput: Record<string, any> }} req
 * @param {ClassifyCtx} ctx
 * @returns {Verdict}
 */
export function classifyGrep(req, ctx) {
  const { tool, toolInput: ti = {} } = req;
  const { phase, config, repo, root, graphUsed } = ctx;
  const reNudge = helpers.midSessionGraphNudge(graphUsed, root);
  const tail = reNudge ? `\n${reNudge}` : "";

  // ── Stale phases: refresh-first, regardless of tool ──────────────────────
  if (phase === "classical_fallback") {
    return {
      decision: "allow",
      agentMessage: ctx.staleFallbackMsg,
      userKey: "stale.classical",
    };
  }

  // ── SemanticSearch: always route to hybrid query when not in fallback ────
  if (tool === "SemanticSearch") {
    if (phase === "must_refresh") {
      return {
        decision: "deny",
        agentMessage: ctx.staleMustRefreshMsg,
        userKey: "stale.must_refresh",
        score: true,
      };
    }
    const q = ti.query ?? ti.search_term ?? "<topic>";
    const call = helpers.mcpQuery({ query: q, taskContext: q, goal: "flows", repo });
    return {
      decision: "deny",
      agentMessage: `SemanticSearch blocked → ${call}${tail}`,
      userKey: "block.semantic",
      score: true,
    };
  }

  // ── Glob: block broad source sweeps, allow targeted/non-source globs ─────
  if (tool === "Glob") {
    const pattern = ti.glob_pattern ?? ti.pattern ?? "";
    if (phase === "fresh" && helpers.isBroadSourceGlob(pattern, config)) {
      const call = helpers.mcpQuery({
        query: "<concept>",
        taskContext: "find modules",
        goal: "entry points",
        repo,
      });
      return {
        decision: "deny",
        agentMessage: `Glob blocked → ${call}${tail}`,
        userKey: "block.glob",
        score: true,
      };
    }
    return { decision: "allow", agentMessage: "Glob OK for non-source patterns." };
  }

  // ── Grep ─────────────────────────────────────────────────────────────────
  const pattern = ti.pattern ?? "";
  const pathArg = ti.path ?? ti.glob ?? "";
  if (!pattern) return { decision: "allow" };

  const nonSource = isNonSourcePath(pathArg, config);
  const literal = nonSource || isLiteralPattern(pattern);

  if (phase === "must_refresh") {
    if (literal) {
      return {
        decision: "allow",
        agentMessage:
          "Literal/config grep OK during stale — run npm run gitnexus:agent-refresh before symbol exploration.",
      };
    }
    return {
      decision: "deny",
      agentMessage: ctx.staleMustRefreshMsg,
      userKey: "stale.must_refresh",
      score: true,
    };
  }

  // fresh — searching inside a non-source config/doc file is always fine, even
  // when the term is identifier-shaped.
  if (nonSource) {
    return { decision: "allow", agentMessage: "Grep OK — non-source config/doc search." };
  }

  const token = coreToken(pattern);
  const symbolish =
    isDeclSearch(token) || isPlainIdentifier(token) || isDottedAccess(token);

  if (symbolish) {
    const seg = symbolOf(token);
    const fieldLike = !isDeclSearch(token) && helpers.isLikelyFieldName(seg);
    if (fieldLike) {
      const schema = helpers.mcpReadSchema(repo);
      const call = helpers.cypherFieldAccess(seg, repo);
      return {
        decision: "deny",
        agentMessage: `Field grep blocked → ${schema} → ${call}${tail}\n${helpers.cypherMidSessionNudge()}`,
        userKey: "block.grep.field",
        userVars: { symbol: seg },
        score: true,
      };
    }
    const sym = isDeclSearch(token)
      ? token.replace(/^.*?\b((?:function|class|interface|type|enum)\s+)?([A-Za-z_$][\w$]*).*$/, "$2")
      : seg;
    const call = helpers.mcpContext(sym, repo);
    return {
      decision: "deny",
      agentMessage: `Grep blocked (symbol) → ${call}${tail}`,
      userKey: "block.grep.symbol",
      userVars: { symbol: sym },
      score: true,
    };
  }

  if (literal) {
    return { decision: "allow", agentMessage: "Grep OK — literal/config/doc search." };
  }

  // Lowercase word, no path scope — likely a field or loosely-typed symbol.
  if (/^[a-z][a-zA-Z0-9]*$/.test(token) && token.length >= 6 && !pathArg) {
    if (helpers.isLikelyFieldName(token)) {
      const schema = helpers.mcpReadSchema(repo);
      const call = helpers.cypherFieldAccess(token, repo);
      return {
        decision: "deny",
        agentMessage: `Field grep → ${schema} → ${call}${tail}`,
        userKey: "block.grep.field",
        userVars: { symbol: token },
        score: true,
      };
    }
    const call = helpers.mcpContext(token, repo);
    return {
      decision: "deny",
      agentMessage: `Symbol grep → ${call}${tail}`,
      userKey: "block.grep.likely",
      score: true,
    };
  }

  return {
    decision: "allow",
    agentMessage:
      "Grep allowed — if this is a structural lookup, prefer:\n" +
      `  ${helpers.mcpContext("<symbol>", repo)}\n` +
      `  Field/property: ${helpers.mcpReadSchema(repo)} → ${helpers.cypherFieldAccess("<field>", repo)}${tail}`,
  };
}
