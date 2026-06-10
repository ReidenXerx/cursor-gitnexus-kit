#!/usr/bin/env node
/** CLI helper for refresh-pending flag (session primer + shell guard). */
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const root = process.argv[2] ?? process.cwd();
const action = process.argv[3] ?? 'status';
const detail = process.argv[4] ?? '';

const { setRefreshPending, isRefreshPending } = await import(
  pathToFileURL(path.join(root, '.cursor/hooks/lib/session-primer.mjs')).href
);

if (action === 'set') {
  setRefreshPending(root, true, detail);
  process.exit(0);
}
if (action === 'clear') {
  setRefreshPending(root, false);
  process.exit(0);
}

process.stdout.write(JSON.stringify({ pending: isRefreshPending(root) }));
