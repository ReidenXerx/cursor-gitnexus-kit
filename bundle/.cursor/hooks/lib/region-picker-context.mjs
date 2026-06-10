#!/usr/bin/env node
/** Emit region picker text for sessionStart additional_context (stdout). */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.argv[2] ?? process.cwd();
const here = path.dirname(fileURLToPath(import.meta.url));
const {
  loadManifest,
  loadRegionState,
  buildRegionPickerText,
  buildRegionCard,
} = await import(pathToFileURL(path.join(here, 'region-session.mjs')).href);

const manifest = loadManifest(root);
if (!manifest?.regions?.length) {
  process.stdout.write('');
  process.exit(0);
}

const state = loadRegionState(root);
if (state) {
  const card = buildRegionCard(root, state, manifest);
  process.stdout.write(` Agent region: ${state.label ?? state.id}. ${card.replace(/\n/g, ' ')}`);
  process.exit(0);
}

const picker = buildRegionPickerText(manifest);
process.stdout.write(` ${picker.replace(/\n/g, ' | ')}`);