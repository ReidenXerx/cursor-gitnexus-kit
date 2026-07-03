#!/usr/bin/env node
// Claude Code PreCompact → checkpoint durable state to memory + steer "lose nothing".
// Note: there is no agent turn between this hook and the compaction, so the agent
// can't write memory in response here — the durable record is maintained continuously
// (see the contract) and reconciled on the SessionStart(source:compact) recovery.
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

const { gnContext, emitContext } = await lib("claude-emit.mjs");
const { appendMemoryCheckpoint, isImpactUsed, isDetectUsed, bumpScore, memoryPath } =
  await lib("session-primer.mjs");

const ctx = gnContext(root);
bumpScore(root, "compactions"); // surfaced in gitnexus:stats
appendMemoryCheckpoint(
  root,
  `- trigger: ${input.trigger || "auto"} | index: ${ctx.phase} | gates: impact ${isImpactUsed(root) ? "done" : "pending"}, detect_changes ${isDetectUsed(root) ? "done" : "pending"}\n` +
    `- (transcript about to be summarized — the task/decisions/open-items/file:line above must already be current)`,
);
emitContext(
  `Context is about to be compacted. Preserve EVERYTHING important — decisions, requirements, open bugs, user intent, file:line. Durable record: your project memory (${memoryPath(root)}); nothing critical should exist only in the transcript being summarized.`,
  "PreCompact",
);
