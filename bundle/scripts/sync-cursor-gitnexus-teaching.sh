#!/usr/bin/env bash
# Sync GitNexus teaching bundle into Cursor-native paths (.cursor/skills).
# Source of truth: .claude/skills/ + .cursor/rules/ + .cursor/hooks/
# Run via: npm run gitnexus:setup (or directly)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

info()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m    ✓\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m    !\033[0m %s\n' "$*"; }
fail()  { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

HOOK_SCRIPTS=(
  ".cursor/hooks/gitnexus-session-primer.sh"
  ".cursor/hooks/gitnexus-session-health.sh"
  ".cursor/hooks/gitnexus-session-health-user.sh"
  ".cursor/hooks/gitnexus-prompt-router.sh"
  ".cursor/hooks/gitnexus-grep-guard.sh"
  ".cursor/hooks/gitnexus-read-guard.sh"
  ".cursor/hooks/gitnexus-edit-guard.sh"
  ".cursor/hooks/gitnexus-shell-staleness-guard.sh"
  ".cursor/hooks/gitnexus-shell-allowlist.sh"
  ".cursor/hooks/gitnexus-commit-guard.sh"
  ".cursor/hooks/gitnexus-mcp-allowlist.sh"
  ".cursor/hooks/gitnexus-after-git-commit.sh"
)

HOOK_LIBS=(
  ".cursor/hooks/lib/check-staleness.mjs"
  ".cursor/hooks/lib/load-staleness.mjs"
  ".cursor/hooks/lib/graph-session.mjs"
  ".cursor/hooks/lib/session-primer.mjs"
  ".cursor/hooks/lib/first-nudge.mjs"
  ".cursor/hooks/lib/clear-session.mjs"
  ".cursor/hooks/lib/set-refresh-pending.mjs"
  ".cursor/hooks/lib/hook-helpers.mjs"
  ".cursor/hooks/lib/cypher-helpers.mjs"
  ".cursor/hooks/lib/rename-helpers.mjs"
  ".cursor/hooks/lib/stale-policy.mjs"
  ".cursor/hooks/lib/detect-api-router.mjs"
  ".cursor/hooks/lib/graph-smoke.mjs"
  ".cursor/hooks/lib/agent-brief.mjs"
  ".cursor/hooks/lib/agent-health.mjs"
  ".cursor/hooks/lib/session-health-audit.mjs"
  ".cursor/hooks/lib/session-health-context.mjs"
  ".cursor/hooks/lib/verify-kit.mjs"
  ".cursor/gitnexus-hooks.json"
  "scripts/gitnexus-agent.mjs"
  "scripts/gitnexus-gate-hint.mjs"
  "scripts/gitnexus-teaching/script-gates.mjs"
  "scripts/lib/setup-ui.mjs"
)

sync_dir() {
  local src="$1"
  local dest="$2"
  local label="$3"

  [[ -d "$src" ]] || fail "Missing teaching source: $src"

  mkdir -p "$dest"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete "${src}/" "${dest}/"
  else
    rm -rf "${dest:?}"/*
    cp -a "${src}/." "$dest/"
  fi
  local count
  count="$(find "$dest" -name 'SKILL.md' | wc -l | tr -d ' ')"
  ok "$label → $dest ($count SKILL.md files)"
}

verify_always_apply_rule() {
  local rule="$1"
  [[ -f "$rule" ]] || fail "Missing rule: $rule"
  grep -q 'alwaysApply: true' "$rule" \
    || fail "$rule must have 'alwaysApply: true' in frontmatter"
  ok "Rule active: $rule"
}

verify_hooks_json() {
  node <<'NODE'
import fs from 'node:fs';

const hooksPath = '.cursor/hooks.json';
const hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
const h = hooks.hooks ?? {};

const checks = [
  ['sessionStart', 'gitnexus-session-primer'],
  ['sessionStart', 'gitnexus-session-health'],
  ['beforeSubmitPrompt', 'gitnexus-session-health-user'],
  ['beforeSubmitPrompt', 'gitnexus-prompt-router'],
  ['preToolUse', 'gitnexus-shell-staleness-guard'],
  ['preToolUse', 'gitnexus-grep-guard'],
  ['preToolUse', 'gitnexus-read-guard'],
  ['preToolUse', 'gitnexus-edit-guard'],
  ['beforeShellExecution', 'gitnexus-shell-allowlist'],
  ['beforeShellExecution', 'gitnexus-commit-guard'],
  ['beforeMCPExecution', 'gitnexus-mcp-allowlist'],
  ['afterShellExecution', 'gitnexus-after-git-commit'],
];

for (const [event, needle] of checks) {
  const list = h[event] ?? [];
  if (!list.some(x => (x.command ?? '').includes(needle))) {
    console.error(`    ! hooks.json missing ${event} → ${needle}`);
    process.exit(1);
  }
}
console.log('    ✓ hooks.json: session + prompt router + guards + shell/mcp allowlist');
NODE
}

write_manifest() {
  node <<'NODE'
import fs from 'node:fs';
import path from 'node:path';

function listSkills(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .filter(d => fs.existsSync(path.join(dir, d.name, 'SKILL.md')))
    .map(d => d.name)
    .sort();
}

const manifest = {
  bundle: '__GITNEXUS_REPO__-gitnexus-cursor-teaching',
  version: 2,
  installedAt: new Date().toISOString(),
  repo: '__GITNEXUS_REPO__',
  enforcement: {
    blockedTools: ['Grep(symbols)', 'Grep(fields→cypher)', 'SemanticSearch', 'Glob(broad src)', 'Read(large src, no offset)'],
    gates: ['session status/refresh', 'session health', 'prompt architecture router', 'query/context explore', 'cypher structural', 'staleness pre-edit', 'impact pre-edit', 'detect_changes pre-done'],
    hookScripts: [
      'gitnexus-session-primer.sh',
      'gitnexus-session-health.sh',
      'gitnexus-session-health-user.sh',
      'gitnexus-prompt-router.sh',
      'gitnexus-shell-staleness-guard.sh',
      'gitnexus-grep-guard.sh',
      'gitnexus-read-guard.sh',
      'gitnexus-edit-guard.sh',
      'gitnexus-shell-allowlist.sh',
      'gitnexus-commit-guard.sh',
      'gitnexus-mcp-allowlist.sh',
      'gitnexus-after-git-commit.sh',
    ],
    agentCli: ['npm run gitnexus:agent-status', 'npm run gitnexus:agent-refresh'],
  },
  components: {
    rules: [
      '.cursor/rules/00-gitnexus-enforcement.mdc',
      '.cursor/rules/gitnexus.mdc',
      '.cursor/rules/gitnexus-first.mdc',
    ],
    hooks: '.cursor/hooks.json',
    mcp: '.cursor/mcp.json',
    masterSkill: '.cursor/skills/gitnexus-workspace/SKILL.md',
    enforcementSkill: '.cursor/skills/gitnexus-enforcement/SKILL.md',
    gitnexusSkills: listSkills('.cursor/skills/gitnexus'),
    generatedAreaSkills: listSkills('.cursor/skills/generated'),
  },
  workflowChain: [
    'READ gitnexus://repo/__GITNEXUS_REPO__/context',
    'READ gitnexus://repo/__GITNEXUS_REPO__/schema',
    'query({query, task_context, goal})',
    'context({name|uid})',
    'cypher({query, params})',
    'impact({target, direction: upstream})',
    'detect_changes({scope})',
  ],
};

fs.mkdirSync('.cursor', { recursive: true });
fs.writeFileSync(
  '.cursor/gitnexus-teaching-bundle.json',
  JSON.stringify(manifest, null, 2) + '\n'
);
console.log('    ✓ Wrote .cursor/gitnexus-teaching-bundle.json (v2 enforcement)');
NODE
}

# ── main ─────────────────────────────────────────────────────────────────────

info "Installing Cursor GitNexus teaching bundle (v2 enforcement)"

info "  [1/5] Cursor rules (single always-on contract)"
verify_always_apply_rule ".cursor/rules/00-gitnexus-enforcement.mdc"
for ref_rule in ".cursor/rules/gitnexus.mdc" ".cursor/rules/gitnexus-first.mdc"; do
  [[ -f "$ref_rule" ]] || fail "Missing rule: $ref_rule"
  ok "Reference rule present: $ref_rule (load on demand)"
done

info "  [2/5] Cursor agent hooks (blocking guards)"
verify_hooks_json
for script in "${HOOK_SCRIPTS[@]}"; do
  [[ -f "$script" ]] || fail "Missing hook: $script"
  chmod +x "$script"
done
for lib in "${HOOK_LIBS[@]}"; do
  [[ -f "$lib" ]] || fail "Missing hook lib: $lib"
done
ok "${#HOOK_SCRIPTS[@]} hook scripts + ${#HOOK_LIBS[@]} lib(s) ready"

info "  [3/5] Sync skills to .cursor/skills/"
mkdir -p .cursor/skills
sync_dir ".claude/skills/gitnexus" ".cursor/skills/gitnexus" "GitNexus playbooks"
sync_dir ".claude/skills/gitnexus-workspace" ".cursor/skills/gitnexus-workspace" "Master index"
sync_dir ".claude/skills/gitnexus-enforcement" ".cursor/skills/gitnexus-enforcement" "Enforcement router"
if [[ -d ".claude/skills/generated" ]]; then
  sync_dir ".claude/skills/generated" ".cursor/skills/generated" "Area skills"
else
  warn "No .claude/skills/generated — run gitnexus:refresh"
fi

info "  [4/5] Teaching bundle manifest"
write_manifest

info "  [5/5] Quick hook smoke test"
if printf '%s' '{"tool_name":"SemanticSearch","tool_input":{"query":"test"}}' \
  | bash .cursor/hooks/gitnexus-grep-guard.sh 2>/dev/null \
  | grep -q 'deny'; then
  ok "SemanticSearch block verified"
else
  warn "Hook smoke test inconclusive — restart Cursor and check Hooks panel"
fi

echo ""
ok "Teaching bundle v2 installed (enforcement hooks active)"
echo "    Enforcement:   00-gitnexus-enforcement.mdc + grep/read/edit hooks (staleness block)"
echo "    Graph imaging: gitnexus-imaging skill"
echo "    Master skill:  gitnexus-workspace"
echo "    If blocked:    gitnexus-enforcement skill"
