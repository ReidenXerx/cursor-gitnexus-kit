#!/usr/bin/env node
/**
 * Cypher copy-paste helpers — raw graph queries when query/context/impact are not enough.
 * READ gitnexus://repo/{name}/schema before ad-hoc Cypher.
 */

/** @param {string} s */
function escCypher(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\s+/g, ' ').trim();
}

/** @param {string} repo */
export function mcpReadSchema(repo) {
  return `READ gitnexus://repo/${repo}/schema`;
}

/**
 * @param {string} query Cypher query (single line ok)
 * @param {string} repo
 * @param {Record<string, string | number> | null} [params]
 */
export function mcpCypher(query, repo, params = null) {
  const q = escCypher(query);
  if (params && Object.keys(params).length > 0) {
    return `gitnexus_cypher({ query: "${q}", params: ${JSON.stringify(params)}, repo: "${repo}" })`;
  }
  return `gitnexus_cypher({ query: "${q}", repo: "${repo}" })`;
}

/** Field read/write via ACCESSES edges. @param {'read'|'write'|'both'} reason */
export function cypherFieldAccess(field, repo, reason = 'both') {
  const name = escCypher(field);
  const rel =
    reason === 'read'
      ? "{type: 'ACCESSES', reason: 'read'}"
      : reason === 'write'
        ? "{type: 'ACCESSES', reason: 'write'}"
        : "{type: 'ACCESSES'}";
  const q = `MATCH (f:Function)-[r:CodeRelation ${rel}]->(p:Property {name: $name}) RETURN f.name, f.filePath, r.reason ORDER BY f.filePath LIMIT 50`;
  return mcpCypher(q, repo, { name: field });
}

/** Multi-hop CALLS chain ending at symbol. */
export function cypherCallChain(symbol, repo, maxDepth = 3) {
  const q = `MATCH path = (a)-[:CodeRelation {type: 'CALLS'}*1..${maxDepth}]->(b:Function {name: $name}) RETURN [n IN nodes(path) | n.name] AS chain, length(path) AS depth ORDER BY depth LIMIT 20`;
  return mcpCypher(q, repo, { name: symbol, maxDepth });
}

/** Direct callers via CALLS (when context incoming is incomplete). */
export function cypherCallers(symbol, repo) {
  const q =
    "MATCH (caller)-[:CodeRelation {type: 'CALLS'}]->(f:Function {name: $name}) RETURN caller.name, caller.filePath, caller.kind ORDER BY caller.filePath LIMIT 50";
  return mcpCypher(q, repo, { name: symbol });
}

/** Method override chain (MRO). */
export function cypherMethodOverrides(method, repo) {
  const q =
    "MATCH (winner:Method)-[r:CodeRelation {type: 'METHOD_OVERRIDES'}]->(loser:Method {name: $name}) RETURN winner.name, winner.filePath, loser.filePath, r.reason LIMIT 30";
  return mcpCypher(q, repo, { name: method });
}

/** Process steps ordered by step index. */
export function cypherProcessSteps(processLabel, repo) {
  const q =
    "MATCH (s)-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p:Process) WHERE p.heuristicLabel CONTAINS $label RETURN s.name, s.filePath, r.step ORDER BY r.step LIMIT 40";
  return mcpCypher(q, repo, { label: processLabel });
}

/** Class methods via HAS_METHOD. */
export function cypherClassMethods(className, repo) {
  const q =
    "MATCH (c:Class {name: $name})-[r:CodeRelation {type: 'HAS_METHOD'}]->(m:Method) RETURN m.name, m.filePath, m.parameterCount ORDER BY m.name LIMIT 50";
  return mcpCypher(q, repo, { name: className });
}

/**
 * Prompt / grep pattern looks like a field/property name (not PascalCase symbol).
 * @param {string} pattern
 */
export function isLikelyFieldName(pattern) {
  if (!pattern || pattern.length < 3 || pattern.length > 40) return false;
  if (!/^[a-z][a-zA-Z0-9]*$/.test(pattern)) return false;
  if (/^(true|false|null|undefined|async|await|const|let|var|function|class|import|export|return|throw|catch|default)$/.test(
    pattern
  )) {
    return false;
  }
  return true;
}

/**
 * Pick a Cypher playbook from prompt-router hint.
 * @param {object} hint
 * @param {string} repo
 */
export function playbookCypherForHint(hint, repo) {
  const schema = mcpReadSchema(repo);

  if (hint.fieldHint) {
    const reason = hint.fieldWrite ? 'write' : hint.fieldRead ? 'read' : 'both';
    return `PLAYBOOK: ${schema} → ${cypherFieldAccess(hint.fieldHint, repo, reason)}`;
  }
  if (hint.callChainHint) {
    return `PLAYBOOK: ${schema} → ${cypherCallChain(hint.callChainHint, repo, hint.hopDepth ?? 3)}`;
  }
  if (hint.overrideHint) {
    return `PLAYBOOK: ${schema} → ${cypherMethodOverrides(hint.overrideHint, repo)}`;
  }
  if (hint.processHint) {
    return `PLAYBOOK: ${schema} → ${cypherProcessSteps(hint.processHint, repo)}`;
  }
  if (hint.structural) {
    return `PLAYBOOK: ${schema} → gitnexus_cypher({ query: "<MATCH …>", repo: "${repo}" })`;
  }
  return '';
}

/** One-line agent reminder for mid-session nudges. */
export function cypherMidSessionNudge() {
  return 'Structural precision (field ACCESSES, N-hop CALLS, overrides, process steps) → READ schema → cypher — not grep.';
}
