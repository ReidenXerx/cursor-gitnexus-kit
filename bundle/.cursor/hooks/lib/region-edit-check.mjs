#!/usr/bin/env node
/** Region write gate for edit guard. argv[2]=filePath, GITNEXUS_ROOT=repo root. stdout: JSON */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const root = process.env.GITNEXUS_ROOT || process.cwd();
const filePath = process.argv[2] ?? '';

if (!filePath) {
  process.stdout.write(JSON.stringify({ skip: true }));
  process.exit(0);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const { checkWriteAllowed, bumpOverflowWrite } = await import(
  pathToFileURL(path.join(here, 'region-session.mjs')).href
);

const writeCheck = checkWriteAllowed(root, filePath);
if (!writeCheck.allowed) {
  process.stdout.write(
    JSON.stringify({
      permission: 'deny',
      reason: writeCheck.reason,
      noRegion: !!writeCheck.noRegion,
    })
  );
  process.exit(0);
}

if (writeCheck.noRegion) {
  process.stdout.write(
    JSON.stringify({
      permission: 'allow',
      noRegion: true,
      reason: writeCheck.reason,
    })
  );
  process.exit(0);
}

if (writeCheck.partial) {
  bumpOverflowWrite(root);
}

process.stdout.write(
  JSON.stringify({
    permission: 'allow',
    partial: !!writeCheck.partial,
    reason: writeCheck.reason,
  })
);
