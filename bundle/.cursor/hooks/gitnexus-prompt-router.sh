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

const { writePromptHint } = await import(
  pathToFileURL(path.join(root, '.cursor/hooks/lib/session-primer.mjs')).href
);

writePromptHint(root, {
  architecture: architecture || explore,
  explore,
  reasoning,
  codeTask,
  snippet: prompt.slice(0, 200),
  fileHint: pathMatch?.[1],
  symbolHint: symbolMatch?.[1],
});

process.stdout.write(JSON.stringify({ continue: true }));
NODE
