#!/usr/bin/env bash
# beforeMCPExecution: allow GitNexus MCP; mark session as graph-ready after first GN call.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export GITNEXUS_HOOK_INPUT="$(cat)"
export GITNEXUS_ROOT="$ROOT"

node <<'NODE'
import fs from 'node:fs';
import path from 'node:path';

const input = JSON.parse(process.env.GITNEXUS_HOOK_INPUT || '{}');
const root = process.env.GITNEXUS_ROOT;
const tool = input.tool_name ?? '';
const url = input.url ?? '';
const cmd = input.command ?? '';

const isGitnexus =
  /gitnexus/i.test(tool) ||
  /gitnexus/i.test(url) ||
  /gitnexus/i.test(cmd);

function out(obj) {
  process.stdout.write(JSON.stringify(obj));
}

if (isGitnexus) {
  const flag = path.join(root, '.cursor/.gitnexus-mcp-used.flag');
  fs.mkdirSync(path.dirname(flag), { recursive: true });
  fs.writeFileSync(flag, new Date().toISOString());
  out({
    permission: 'allow',
    agent_message:
      'GitNexus MCP call approved — keep using graph tools for mid-task code reasoning. If results look empty/wrong: retry with uid once; if still wrong or index stale, classical fallback OK (say why) and run npm run gitnexus:agent-refresh autonomously.',
  });
  process.exit(0);
}

out({ permission: 'allow' });
NODE
