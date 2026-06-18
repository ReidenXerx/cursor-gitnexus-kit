#!/usr/bin/env bash
# beforeSubmitPrompt: classify user prompt; write playbook hints for first-tool nudge.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export GITNEXUS_HOOK_INPUT="$(cat)"
export GITNEXUS_ROOT="$ROOT"

node <<'NODE'
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const input = JSON.parse(process.env.GITNEXUS_HOOK_INPUT || '{}');
const prompt = input.prompt ?? '';
const root = process.env.GITNEXUS_ROOT;

const architecture =
  /\b(how does|how do|architecture|pipeline|data flow|call chain|what calls|walk me through|end.to.end|cross.module|execution flow|business flow|trace|who calls|where does .+ flow|deep dive|gather context|full context|map the|audit)\b/i.test(
    prompt
  );

const structural =
  /\b(readers?|writers?|who (reads|writes)|field access|property access|getter|setter|mutat|ACCESSES|data flow through|override chain|method override|diamond inherit|\d+.hop|multi.hop|call chain|process step|STEP_IN_PROCESS|HAS_METHOD|class methods)\b/i.test(
    prompt
  );

const explore =
  /\b(explore|investigate|understand the|navigate|orient|get context on)\b/i.test(prompt);

const reasoning =
  /\b(reason|why does|what breaks|blast radius|depend on|downstream|upstream|side effect|if i change|safe to change)\b/i.test(
    prompt
  );

const codeTask =
  /\b(fix|bug|refactor|implement|add|change|edit|update|review|commit|test|polish|hooks|enforce)\b/i.test(
    prompt
  );

const pathMatch = prompt.match(/(?:^|[\s(])([\w./-]+\.(?:js|mjs|ts|tsx|jsx))/);
const symbolMatch = prompt.match(/\b([A-Z][A-Za-z0-9]+)\b/);
const fieldMatch =
  prompt.match(/\b(?:field|property)\s+[`'"]?([a-z][a-zA-Z0-9]*)[`'"]?/i) ||
  prompt.match(/\b(readers?|writers?)\s+(?:of|for)\s+[`'"]?([a-z][a-zA-Z0-9]*)[`'"]?/i);
const callChainMatch = prompt.match(/\b(?:call chain|callers?)\s+(?:of|for|to)\s+[`'"]?([A-Za-z_$][\w$]*)[`'"]?/i);
const overrideMatch = prompt.match(/\b(?:override|overrides)\s+(?:of|for|on)\s+[`'"]?([A-Za-z_$][\w$]*)[`'"]?/i);
const processMatch = prompt.match(/\b(?:process|flow)\s+[`'"]?([^"'`]+)[`'"]?/i);

const { writePromptHint } = await import(
  pathToFileURL(path.join(root, '.cursor/hooks/lib/session-primer.mjs')).href
);

writePromptHint(root, {
  architecture: architecture || explore,
  explore,
  reasoning,
  codeTask,
  structural: structural || Boolean(fieldMatch || callChainMatch),
  fieldHint: fieldMatch?.[2] || fieldMatch?.[1] || null,
  fieldRead: /\b(readers?|reads|read access|getter)\b/i.test(prompt),
  fieldWrite: /\b(writers?|writes|write access|mutat|setter)\b/i.test(prompt),
  callChainHint: callChainMatch?.[1] || null,
  overrideHint: overrideMatch?.[1] || null,
  processHint: structural && processMatch ? processMatch[1].trim().slice(0, 80) : null,
  hopDepth: /\b(\d+)[- ]hop/i.test(prompt) ? Number(prompt.match(/\b(\d+)[- ]hop/i)[1]) : 3,
  snippet: prompt.slice(0, 200),
  fileHint: pathMatch?.[1],
  symbolHint: symbolMatch?.[1],
});

process.stdout.write(JSON.stringify({ continue: true }));
NODE
