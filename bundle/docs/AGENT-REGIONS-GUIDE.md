# Agent Regions — User Guide

Plain-language guide for **Cursor Agent chats** in this repo.

## Every new chat (3 steps)

1. **Describe your task** in one sentence. Include a file path if you know it.  
   Example: `fix login in src/api/auth.js`
2. **Area is auto-picked** from your message — the agent tells you which one.
3. **Wrong area?** Reply exactly:
   - `region: <id>` — switch to one area
   - `region: <id1>, <id2>` — own multiple areas in this chat
   - `region+: <id>` — add another area
   - `superchat` — whole repo (big cross-cutting work only; use a strong model)

## Rules

| | What it means |
|---|---------------|
| **Read** | Agent can read any file for context |
| **Write** | Agent edits only inside your picked area(s) |
| **Border fixes** | 2 small writes outside `owns` allowed per chat |
| **Laconic** | Short answers by default — ask "explain in detail" if you want more |

## List areas

```bash
npm run gitnexus:generate-regions   # rebuild manifest after overlay changes
```

Area ids are in `.cursor/regions.manifest.json` (generated). Customize boundaries in `docs/regions.overlay.json` if needed.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Agent won't edit | Describe task or say `region: <id>` |
| Wrong area | `region: <correct-id>` or `region+: <id>` |
| Spans many areas | `region: a, b, c` or `superchat` |
| Graph tools wrong | Agent refreshes index automatically when stale |

## For maintainers

- Region cards: `docs/AGENT-PROFILES.md`
- Machine config: `docs/regions.overlay.json`
- Agent playbook: `.cursor/skills/agent-region`
