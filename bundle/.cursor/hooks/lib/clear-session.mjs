#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const root = process.argv[2] ?? process.cwd();
const lib = pathToFileURL(
  path.join(root, '.cursor/hooks/lib/session-primer.mjs')
).href;
const { clearSessionState, setRefreshPending } = await import(lib);
const regionLib = pathToFileURL(
  path.join(root, '.cursor/hooks/lib/region-session.mjs')
).href;
const { clearRegionState } = await import(regionLib);
clearSessionState(root);
clearRegionState(root);
setRefreshPending(root, false);
