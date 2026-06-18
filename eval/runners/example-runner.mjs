#!/usr/bin/env node
/**
 * Example eval runner — replace with a real agent invocation.
 *
 * The harness spawns this once per (task × condition) with:
 *   GITNEXUS_KIT        = "on" | "off"
 *   GITNEXUS_TASK_ID    = task id
 *   GITNEXUS_TASK_PROMPT= prompt text
 *   GITNEXUS_MODEL      = model slug (optional)
 *
 * It MUST print one JSON line: {"pass": <bool>, "tokens": <int>}
 *
 * To make this real, drive an agent here (e.g. the Cursor SDK `@cursor/sdk`,
 * or the `cursor-agent` CLI) against a fixture repo, apply the task prompt,
 * then run the task's success check and report pass + token usage.
 *
 * This stub just demonstrates the contract with a deterministic placeholder so
 * `npm run eval -- --runner "node eval/runners/example-runner.mjs"` works offline.
 */
const kit = process.env.GITNEXUS_KIT === 'on';

// Placeholder: pretend the kit improves pass-rate and reduces wasted tokens.
const pass = kit;
const tokens = kit ? 4200 : 9800;

process.stdout.write(JSON.stringify({ pass, tokens }) + '\n');
