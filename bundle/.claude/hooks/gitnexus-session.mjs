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
  import(pathToFileURL(path.join(root, ".cursor/hooks/lib", rel)).href);

const { gnContext, emitContext } = await lib("claude-emit.mjs");
const { clearSessionState } = await lib("session-primer.mjs");

clearSessionState(root); // re-arm impact/detect/grep gates for the new session
const ctx = gnContext(root);

const lines = [
  "GitNexus enforcement active (Claude Code). Graph-first on EVERY task — see CLAUDE.md.",
  "Orient with gitnexus_query; drill with gitnexus_context; structural precision with gitnexus_cypher; gitnexus_impact before edits; gitnexus_detect_changes before commit.",
  ctx.phase !== "fresh"
    ? "Index is STALE — run `npm run gitnexus:agent-refresh` before graph calls (hooks block grep/read/edit/commit until refreshed)."
    : "Index is fresh — hooks will redirect symbol Grep/large Read/blind edits to the graph.",
];
emitContext(lines.join(" "), "SessionStart");
