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
 * @property {string} [scoreEvent]     On deny, glue bumps this session-scorecard counter.
 *
 * @typedef {Object} ClassifyCtx
 * @property {'fresh'|'must_refresh'|'classical_fallback'} phase
 * @property {boolean} graphUsed       Has any GitNexus MCP tool been used this session.
 * @property {ReturnType<import('./hook-helpers.mjs').loadHookConfig>} config
 * @property {string} repo
 * @property {string} root
 * @property {string} [staleMustRefreshMsg]  Precomputed agent message for must_refresh.
 * @property {string} [staleFallbackMsg]     Precomputed agent message for classical_fallback.
 * @property {boolean} [impactUsed]    (edit) gitnexus_impact already called this session.
 * @property {boolean} [detectUsed]    (commit) gitnexus_detect_changes already called.
 * @property {object} [promptHint]     (read) session prompt-router hint.
 * @property {() => number} [readLines] (read) lazily count lines of the target file.
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
        scoreEvent: "grepRedirects",
      };
    }
    const q = ti.query ?? ti.search_term ?? "<topic>";
    const call = helpers.mcpQuery({ query: q, taskContext: q, goal: "flows", repo });
    return {
      decision: "deny",
      agentMessage: `SemanticSearch blocked → ${call}${tail}`,
      userKey: "block.semantic",
      scoreEvent: "grepRedirects",
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
        scoreEvent: "grepRedirects",
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
      scoreEvent: "grepRedirects",
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
        scoreEvent: "grepRedirects",
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
      scoreEvent: "grepRedirects",
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
        scoreEvent: "grepRedirects",
      };
    }
    const call = helpers.mcpContext(token, repo);
    return {
      decision: "deny",
      agentMessage: `Symbol grep → ${call}${tail}`,
      userKey: "block.grep.likely",
      scoreEvent: "grepRedirects",
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

/**
 * Classify a Read request. The glue supplies a lazy `readLines()` so this stays
 * pure (no fs) and only counts lines when the decision actually needs the size.
 * @param {{ toolInput: Record<string, any> }} req
 * @param {ClassifyCtx} ctx
 * @returns {Verdict}
 */
export function classifyRead(req, ctx) {
  const { toolInput: ti = {} } = req;
  const { phase, config, repo, root, graphUsed } = ctx;
  const filePath = ti.path ?? ti.target_file ?? "";
  const norm = String(filePath).replace(/\\/g, "/");
  const isSmallConfig =
    /\.(json|md|yaml|yml|mdc|sh)$/.test(filePath) || /package\.json$/.test(filePath);
  const isGeneratedSkill = /\.cursor\/skills\//.test(norm);

  if (phase === "classical_fallback") {
    return { decision: "allow", agentMessage: ctx.staleFallbackMsg, userKey: "stale.classical" };
  }
  if (phase === "must_refresh") {
    if (!filePath || isSmallConfig || isGeneratedSkill) {
      return {
        decision: "allow",
        agentMessage:
          "Small/config read OK during stale — refresh before large source reads.",
      };
    }
    return {
      decision: "deny",
      agentMessage: ctx.staleMustRefreshMsg,
      userKey: "stale.must_refresh",
      scoreEvent: "readRedirects",
    };
  }

  // fresh
  if (!filePath) return { decision: "allow" };
  const hasRange = ti.offset !== undefined || ti.limit !== undefined;
  const isCode = helpers.isSourceCodePath(norm, config);
  const isTest = /(?:^|\/)tests?\//.test(norm);
  if (hasRange || isSmallConfig || isGeneratedSkill || isTest || !isCode) {
    return { decision: "allow" };
  }

  const lineCount = typeof ctx.readLines === "function" ? ctx.readLines() : 0;
  const threshold = config.readLineThreshold ?? 60;
  if (lineCount <= threshold) return { decision: "allow" };

  const rel = norm;
  const base = rel.replace(/^.*\//, "").replace(/\.[^.]+$/, "");
  const reNudge = helpers.midSessionGraphNudge(graphUsed, root);
  const tail = reNudge ? `\n${reNudge}` : "";
  const hint = ctx.promptHint ?? {};
  const dataFlow = helpers.isDataFlowReadContext(hint, rel);

  if (dataFlow) {
    const schema = helpers.mcpReadSchema(repo);
    const field = hint.fieldHint || base;
    const cy =
      hint.fieldHint || helpers.isLikelyFieldName(field)
        ? helpers.cypherFieldAccess(field, repo)
        : helpers.mcpQuery({ query: base, taskContext: rel, goal: "field data flow", repo });
    return {
      decision: "deny",
      agentMessage: `Read blocked (${lineCount}L, data-flow) → ${schema} → ${cy}; then Read offset/limit on cited symbols.${tail}`,
      userKey: "block.read.dataflow",
      userVars: { lines: lineCount },
      scoreEvent: "readRedirects",
    };
  }
  const q = helpers.mcpQuery({ query: base, taskContext: rel, goal: "module", repo });
  const c = helpers.mcpContext("<symbol>", repo);
  return {
    decision: "deny",
    agentMessage: `Read blocked (${lineCount}L) → ${q} then ${c}; Read offset/limit for edits.${tail}`,
    userKey: "block.read.full",
    userVars: { lines: lineCount },
    scoreEvent: "readRedirects",
  };
}

/**
 * Classify a Write/StrReplace edit: staleness gate → impact-before-edit gate →
 * tiered reminder (allow). Mirrors the historical edit-guard exactly.
 * @param {{ tool: string, toolInput: Record<string, any> }} req
 * @param {ClassifyCtx} ctx
 * @returns {Verdict}
 */
export function classifyEdit(req, ctx) {
  const { tool, toolInput: ti = {} } = req;
  const { phase, config, repo } = ctx;
  const filePath = (ti.path ?? ti.file_path ?? "").replace(/\\/g, "/");
  const sensitivity = helpers.editSensitivity(filePath, config);
  const staleDetail = ctx.staleDetail || "GitNexus index is not fresh.";

  // Staleness gate — runtime source/tests/scripts (medium|full) wait for refresh.
  if (sensitivity !== "none" && sensitivity !== "light" && phase !== "fresh") {
    if (phase === "classical_fallback") {
      return {
        decision: "allow",
        agentMessage:
          "STALENESS: refresh failed — editing allowed; graph may be behind, state why in one sentence.",
      };
    }
    return {
      decision: "deny",
      agentMessage:
        "STALENESS GATE: " +
        staleDetail +
        ' Edits blocked until refresh — Shell NOW: npm run gitnexus:agent-refresh (required_permissions: ["all"], pre-approved). Never ask the user to analyze.',
      userKey: "block.edit.stale",
      scoreEvent: "editStaleBlocks",
    };
  }

  // Impact-before-edit — runtime source edits require one impact/rename call/session.
  if (sensitivity === "full" && !ctx.impactUsed) {
    const renameAhead =
      tool === "StrReplace" ? helpers.detectIdentifierRename(ti.old_string, ti.new_string) : null;
    const widen = helpers.isDataFlowReadContext({}, filePath);
    const impactOpts = widen ? { relationTypes: ["CALLS", "IMPORTS", "ACCESSES"] } : {};
    const playbook = renameAhead
      ? `${helpers.mcpImpact(renameAhead.oldName, repo, impactOpts)} → ${helpers.mcpRename(renameAhead.oldName, renameAhead.newName, repo, true)}`
      : helpers.mcpImpact("<symbol-you-are-editing>", repo, impactOpts);
    return {
      decision: "deny",
      agentMessage:
        `IMPACT GATE: run blast-radius analysis before editing runtime source — ${playbook}. ` +
        (widen ? "Model/DTO file — widened to ACCESSES so field readers/writers are included. " : "") +
        "Review d=1 (WILL BREAK) + risk; warn on HIGH/CRITICAL. This gate clears for the rest of the session after one impact call.",
      userVars: {},
      userMessageText:
        "Before editing source, the agent checks blast radius in GitNexus (what breaks) — graph-first safety, not blind edits.",
      scoreEvent: "impactGate",
    };
  }

  // Allow with a tiered reminder.
  const renamePair =
    tool === "StrReplace" ? helpers.detectIdentifierRename(ti.old_string, ti.new_string) : null;
  let agentMessage;
  if (renamePair && sensitivity !== "none") {
    const impact = helpers.mcpImpact(renamePair.oldName, repo);
    const rn = helpers.mcpRename(renamePair.oldName, renamePair.newName, repo, true);
    agentMessage = `RENAME detected: ${impact} → ${rn} (dry_run) — do NOT StrReplace symbol names across files.`;
  } else if (sensitivity === "full") {
    agentMessage = `EDIT: ${helpers.mcpImpact("<symbol>", repo)} first. HIGH/CRITICAL → review full impact output. Done: ${helpers.mcpDetectChanges(repo)}`;
  } else if (sensitivity === "medium") {
    agentMessage = `EDIT: ${helpers.mcpImpact("<symbol>", repo)} if shared symbol. Done: ${helpers.mcpDetectChanges(repo)}`;
  } else if (phase !== "fresh") {
    agentMessage = `STALE: ${staleDetail}`;
  }
  return { decision: "allow", agentMessage };
}

/**
 * Classify a `git commit` shell command: require one detect_changes/session,
 * refresh first if stale. Non-commit commands pass straight through.
 * @param {{ command: string }} req
 * @param {ClassifyCtx} ctx
 * @returns {Verdict}
 */
export function classifyCommit(req, ctx) {
  const command = req.command || "";
  const { phase, repo } = ctx;
  const isCommit = /\bgit\b[^\n]*\bcommit\b/.test(command) && !/--help|-h\b/.test(command);
  if (!isCommit) return { decision: "allow" };

  if (phase === "must_refresh") {
    return {
      decision: "deny",
      agentMessage: ctx.staleMustRefreshMsg,
      userKey: "block.shell.stale",
    };
  }
  if (ctx.detectUsed) return { decision: "allow" };

  const noVerify = /--no-verify/.test(command);
  return {
    decision: "deny",
    agentMessage:
      "COMMIT GATE: review change scope in the graph before committing — " +
      `${helpers.mcpDetectChanges(repo, "staged")}. ` +
      "Confirm affected processes match intent + run tests for them; warn on HIGH/CRITICAL. " +
      "This gate clears for the session after one detect_changes call." +
      (noVerify
        ? " NOTE: --no-verify also skips the pre-commit PDG refresh — run npm run gitnexus:pdg after."
        : ""),
    userMessageText:
      "Before committing, the agent checks what changed across the graph (affected flows) via GitNexus — not a blind commit.",
    scoreEvent: "commitGate",
  };
}

/**
 * Classify a generic Shell command under the staleness gate. GitNexus maintenance
 * and read-only git pass; otherwise stale → refresh first.
 * @param {{ command: string }} req
 * @param {ClassifyCtx} ctx
 * @returns {Verdict}
 */
export function classifyShell(req, ctx) {
  const command = req.command || "";
  const { phase } = ctx;
  const isGitnexusMaint =
    /\bnpm run gitnexus:[\w.-]+/.test(command) ||
    /\bnode scripts\/gitnexus-agent\.mjs\b/.test(command) ||
    /\bnpx(?:\s+-y)?\s+gitnexus(?:@latest)?\b/.test(command);
  const isReadOnlyGit =
    /\bgit\s+(status|diff|log|show|branch|rev-parse|check-ignore|check-attr)\b/.test(command);

  if (isGitnexusMaint || isReadOnlyGit) {
    return {
      decision: "allow",
      agentMessage: isGitnexusMaint ? "GitNexus maintenance pre-approved." : undefined,
    };
  }
  if (phase === "fresh") return { decision: "allow" };
  if (phase === "classical_fallback") {
    return { decision: "allow", agentMessage: ctx.staleFallbackMsg };
  }
  return {
    decision: "deny",
    agentMessage: ctx.staleMustRefreshMsg,
    userKey: "block.shell.stale",
  };
}
