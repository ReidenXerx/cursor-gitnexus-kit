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

const regionLib = pathToFileURL(path.join(root, '.cursor/hooks/lib/region-session.mjs')).href;
const guideLib = pathToFileURL(path.join(root, '.cursor/hooks/lib/region-user-guide.mjs')).href;
const {
  loadManifest,
  loadRegionState,
  saveRegionState,
  resolveRegionFromPrompt,
  buildRegionCard,
  buildRegionPickerText,
} = await import(regionLib);
const { buildAmbiguousUserScript } = await import(guideLib);

const manifest = loadManifest(root);
let regionState = loadRegionState(root);
let regionCard;
let regionPicker;
let regionAmbiguous;

if (manifest) {
  if (!regionState) {
    const { region, inferred } = resolveRegionFromPrompt(prompt, manifest);
    if (region) {
      saveRegionState(root, region);
      regionState = loadRegionState(root);
      regionCard = buildRegionCard(root, regionState, manifest);
    } else {
      regionPicker = buildRegionPickerText(manifest);
      regionAmbiguous = buildAmbiguousUserScript(inferred, manifest);
    }
  } else {
    regionCard = buildRegionCard(root, regionState, manifest);
  }
}

writePromptHint(root, {
  architecture: architecture || explore,
  explore,
  reasoning,
  codeTask:
    /\b(fix|bug|refactor|implement|add|change|edit|update|review|commit|test|polish|hooks|enforce)\b/i.test(
      prompt
    ),
  snippet: prompt.slice(0, 200),
  regionCard,
  regionPicker,
  regionAmbiguous,
});

process.stdout.write(JSON.stringify({ continue: true }));
NODE
