import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { BUNDLE_ROOT, substituteRepoName } from './kit-shared.mjs';
import { AGENTS_MARKER_BEGIN, AGENTS_MARKER_END, ZED_PROFILE_KEY, ZED_PROFILE_NAME } from './constants.mjs';

function resolveGitnexusCommand() {
  const r = spawnSync('which', ['gitnexus'], { encoding: 'utf8' });
  if (r.status === 0 && (r.stdout || '').trim()) {
    return { command: (r.stdout || '').trim(), args: ['mcp'] };
  }
  return { command: 'npx', args: ['-y', 'gitnexus@latest', 'mcp'] };
}

/** @returns {Record<string, unknown>} */
function zedGitnexusFragment() {
  const mcp = resolveGitnexusCommand();
  return {
    context_servers: {
      gitnexus: {
        command: mcp.command,
        args: mcp.args,
        env: {},
      },
    },
    agent: {
      profiles: {
        [ZED_PROFILE_KEY]: {
          name: ZED_PROFILE_NAME,
          tools: {
            grep: false,
            fetch: false,
          },
          enable_all_context_servers: false,
          context_servers: {
            gitnexus: {
              tools: { '*': true },
            },
          },
        },
      },
    },
    language_models: {
      ollama: {
        available_models: [
          {
            name: 'qwen2.5-coder:14b',
            display_name: 'Qwen 2.5 Coder 14B (tools)',
            supports_tools: true,
          },
          {
            name: 'deepseek-r1:14b',
            display_name: 'DeepSeek R1 14B (tools)',
            supports_tools: true,
          },
        ],
      },
    },
  };
}

/** Deep-merge plain objects (arrays replaced). */
function deepMerge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') {
      out[k] = deepMerge(/** @type {Record<string, unknown>} */ (base[k]), /** @type {Record<string, unknown>} */ (v));
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Merge GitNexus MCP + agent profile into `.zed/settings.json`.
 * @param {string} absTarget
 */
export function mergeZedSettings(absTarget) {
  const settingsPath = path.join(absTarget, '.zed/settings.json');
  let cfg = {};
  if (fs.existsSync(settingsPath)) {
    cfg = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  }
  const merged = deepMerge(cfg, zedGitnexusFragment());
  // Drop legacy profile key (was misleadingly named "GitNexus" only)
  if (merged.agent?.profiles?.gitnexus) {
    delete merged.agent.profiles.gitnexus;
  }
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + '\n');
}

/**
 * Merge always-on enforcement block into project `AGENTS.md`.
 * @param {string} absTarget
 * @param {string} repoName
 */
export function mergeAgentsMd(absTarget, repoName) {
  const fragmentPath = path.join(BUNDLE_ROOT, 'templates/AGENTS.gitnexus.md');
  const agentsPath = path.join(absTarget, 'AGENTS.md');
  const fragment = substituteRepoName(fs.readFileSync(fragmentPath, 'utf8'), repoName);
  const block = `${AGENTS_MARKER_BEGIN}\n${fragment.trim()}\n${AGENTS_MARKER_END}`;

  let existing = '';
  if (fs.existsSync(agentsPath)) {
    existing = fs.readFileSync(agentsPath, 'utf8');
  }

  const re = new RegExp(
    `${escapeRe(AGENTS_MARKER_BEGIN)}[\\s\\S]*?${escapeRe(AGENTS_MARKER_END)}\\n?`,
    'm'
  );
  const next = existing.match(re)
    ? existing.replace(re, `${block}\n`)
    : existing.trim()
      ? `${existing.trimEnd()}\n\n${block}\n`
      : `${block}\n`;

  fs.writeFileSync(agentsPath, next);
}

/** @param {string} s */
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Remove kit block from AGENTS.md if present. */
export function removeAgentsMdBlock(absTarget) {
  const agentsPath = path.join(absTarget, 'AGENTS.md');
  if (!fs.existsSync(agentsPath)) return;
  const re = new RegExp(
    `\n?${escapeRe(AGENTS_MARKER_BEGIN)}[\\s\\S]*?${escapeRe(AGENTS_MARKER_END)}\\n?`,
    'm'
  );
  const next = fs.readFileSync(agentsPath, 'utf8').replace(re, '\n').trimEnd();
  if (next) fs.writeFileSync(agentsPath, `${next}\n`);
  else fs.unlinkSync(agentsPath);
}

/** Strip gitnexus keys from .zed/settings.json (best-effort). */
export function removeZedSettings(absTarget) {
  const settingsPath = path.join(absTarget, '.zed/settings.json');
  if (!fs.existsSync(settingsPath)) return;
  const cfg = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  if (cfg.context_servers?.gitnexus) delete cfg.context_servers.gitnexus;
  if (cfg.agent?.profiles?.gitnexus) delete cfg.agent.profiles.gitnexus;
  if (cfg.agent?.profiles?.[ZED_PROFILE_KEY]) delete cfg.agent.profiles[ZED_PROFILE_KEY];
  fs.writeFileSync(settingsPath, JSON.stringify(cfg, null, 2) + '\n');
}
