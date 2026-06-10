#!/usr/bin/env node
/** Emit region user guide for sessionStart additional_context (stdout). */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.argv[2] ?? process.cwd();
const here = path.dirname(fileURLToPath(import.meta.url));
const {
  loadManifest,
  loadRegionState,
  buildRegionCard,
  buildSessionStartUserGuide,
} = await import(pathToFileURL(path.join(here, 'region-session.mjs')).href);

const manifest = loadManifest(root);
if (!manifest?.regions?.length) {
  process.stdout.write('');
  process.exit(0);
}

const state = loadRegionState(root);
if (state) {
  const card = buildRegionCard(root, state, manifest);
  process.stdout.write(` ${card.replace(/\n/g, ' ')}`);
  process.exit(0);
}

process.stdout.write(` ${buildSessionStartUserGuide(manifest)}`);
