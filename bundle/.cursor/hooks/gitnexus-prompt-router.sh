#!/usr/bin/env bash
# beforeSubmitPrompt: classify user prompt; write side-effect hint for first-tool nudge.
# (Cursor does not inject additional_context from this hook — we persist intent to disk.)
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
  /\b(reason|why does|what breaks|blast radius|depend on|downstream|upstream|side effect|if i change)\b/i.test(
    prompt
  );

const { writePromptHint } = await import(
  pathToFileURL(path.join(root, '.cursor/hooks/lib/session-primer.mjs')).href
);

writePromptHint(root, {
  architecture: architecture || explore,
  explore,
  reasoning,
  codeTask:
    /\b(fix|bug|refactor|implement|add|change|edit|update|review|commit|test|polish|hooks|enforce)\b/i.test(
      prompt
    ),
  snippet: prompt.slice(0, 200),
});

process.stdout.write(JSON.stringify({ continue: true }));
NODE
