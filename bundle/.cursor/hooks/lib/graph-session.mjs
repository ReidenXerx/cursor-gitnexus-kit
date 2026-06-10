#!/usr/bin/env node
/**
 * Session graph-tool usage flags (written by MCP allowlist, read by grep guard).
 */
import fs from 'node:fs';
import path from 'node:path';

export function sessionGraphPaths(root) {
  const cursorDir = path.join(root, '.cursor');
  return {
    mcpUsedFlag: path.join(cursorDir, '.gitnexus-mcp-used.flag'),
  };
}

/** @returns {boolean} */
export function hasUsedGraphTools(root) {
  const { mcpUsedFlag } = sessionGraphPaths(root);
  return fs.existsSync(mcpUsedFlag);
}
