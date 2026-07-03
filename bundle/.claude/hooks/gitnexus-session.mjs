#!/usr/bin/env node
// Claude Code SessionStart → reset per-session gate flags and inject the GitNexus brief.
import path from "node:path";
import { pathToFileURL } from "node:url";

let raw = "";
for await (const c of process.stdin) raw += c;
let input = {};
try {
  input = JSON.parse(raw || "{}");
} catch {
  /* empty */
}
const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const lib = (rel) =>
  import(pathToFileURL(path.join(root, ".gnkit/lib", rel)).href);

const { existsSync } = await import("node:fs");
const { gnContext, emitContext } = await lib("claude-emit.mjs");
const {
  clearSessionState,
  shouldClearOnSource,
  isImpactUsed,
  isDetectUsed,
  memoryPath,
} = await lib("session-primer.mjs");

const source = input.source || "startup";
// compact | resume = the SAME task continuing → preserve gates + memory; don't re-arm.
const recovering = !shouldClearOnSource(source);
if (!recovering) clearSessionState(root);

const ctx = gnContext(root);
const mp = memoryPath(root); // Claude Code's native project memory
const staleLine =
  ctx.phase !== "fresh"
    ? "Index is STALE — run `npm run gitnexus:agent-refresh` before graph calls (hooks block until refreshed)."
    : "Index is fresh — hooks redirect symbol Grep / large Read / blind edits to the graph.";

let lines;
if (recovering) {
  const hasMem = existsSync(memoryPath(root));
  lines = [
    `GitNexus: context was ${source === "compact" ? "COMPACTED" : "resumed"} — the task CONTINUES; enforcement and this session's satisfied gates are PRESERVED.`,
    `Gates so far: impact ${isImpactUsed(root) ? "✓ done" : "pending"}, detect_changes ${isDetectUsed(root) ? "✓ done" : "pending"} — do NOT re-run the ✓ ones.`,
    hasMem
      ? `RECOVER from your project memory (${mp}): reconcile it with reality NOW and fill gaps — decisions, requirements, open bugs, user intent, key file:line.`
      : `Record the task state you still hold in your project memory (${mp}) — decisions, requirements, open items, key file:line — before continuing.`,
    "NOTHING important from before the compaction may be lost — if the summary dropped a requirement/decision/finding, reconstruct it from your memory or the code before acting.",
    staleLine,
  ];
} else {
  lines = [
    "GitNexus enforcement active (Claude Code). Graph-first on EVERY task — see CLAUDE.md.",
    "Orient with gitnexus_query; drill with gitnexus_context; cypher for structure; impact before edits; detect_changes before commit.",
    `Keep your project memory current as you work (${mp}) — it survives compaction + sessions; the transcript does not.`,
    staleLine,
  ];
}
emitContext(lines.join(" "), "SessionStart");
