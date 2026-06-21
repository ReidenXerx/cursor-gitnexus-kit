# GitNexus agent kit — always-on instructions

## North star

> **GitNexus is the default reasoning layer for every task.** Prefer graph + embeddings when the index is fresh. Use `query` to orient. Use `cypher` for precise structural questions. Refresh autonomously when stale. Classical grep/read only **after refresh fails** — say why in one sentence.

## Tool loop (every task)

| Need | Tool |
| --- | --- |
| Orient / fuzzy flow | `query` (BM25 + embeddings) |
| One symbol, callers | `context` |
| Field access, N-hop, overrides | READ schema → `cypher` |
| Before edits | `impact` upstream |
| Before commit / done | `detect_changes` |
| Symbol rename | `rename` dry_run first |

## Session

1. `npm run gitnexus:agent-brief` or READ `gitnexus://repo/__GITNEXUS_REPO__/context`
2. **Stale graph or missing embeddings → run `npm run gitnexus:agent-refresh` before any graph MCP call** (Shell, `required_permissions: ["all"]`). Do not grep or read source as a workaround while stale.
3. Never ask the user to run analyze — refresh autonomously. If refresh fails, say why and only then use classical tools.

## Zed + local models (Ollama)

- Select the **Zed + GitNexus** agent profile (grep disabled; gitnexus MCP enabled).
- Invoke `/gitnexus-enforcement` or `/gitnexus-workspace` when starting a hard task.
- Local models: keep MCP calls small (`query` limit 5, `impact` summaryOnly when exploring).

## npm gates

Run gated scripts from `package.json` when hooks remind you: `gitnexus.__gate.*` — they document the enforced playbook for this repo.
