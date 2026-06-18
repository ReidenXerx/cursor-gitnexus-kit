# GitNexus Cursor Guide — for your team

Plain-language guide for anyone using **Cursor Agent** on a repo with GitNexus + this kit installed.

## What you get

GitNexus builds a **knowledge graph** of your codebase (symbols, callers, execution flows, embeddings).

This kit makes Cursor agents **use that graph by default** — with hooks that **block** grep-first habits when the graph is fresh.

| You get | Why it matters |
|--------|----------------|
| Graph-first reasoning | Fewer missed callers and “grep-only” blind spots |
| Semantic search via `query` | Better answers to “how does X work?” |
| Pre-edit impact checks | Agent sees blast radius before changing shared code |
| Autonomous index refresh | Graph stays aligned with your latest commits |
| Enforced workflow | Not optional — hooks block lazy patterns when fresh |

## What you will notice in Agent chats

**New chat:** GitNexus runs a health check when the session starts. On your first message you may see a short notice that the kit is active. The agent’s first reply should confirm health in one sentence (graph fresh, enforcement on).

When the graph is **fresh**, the agent may say it was redirected from grep, SemanticSearch, or a full-file read. **That is expected.**

Examples of what you might see:

- “GitNexus has this codebase indexed — the agent will use graph search…”
- “Symbol search is routed through GitNexus…”
- “Full-file read is blocked — the agent will pull symbols from the graph first…”

These are **not errors**. Enforcement is the product.

When the graph is **stale** (behind recent commits or missing embeddings), the agent may use classic tools briefly, then refresh the graph automatically.

## Quick check after install

```bash
npm run gitnexus:health
```

Green = graph fresh + embeddings ready + hooks active.

## Good prompts (showcase the graph)

```
How does authentication work in this repo?
```

```
What calls UserService.updateProfile? Is it safe to change the signature?
```

```
I'm about to edit the payment webhook handler — what depends on it?
```

```
What did my local changes affect? Am I done?
```

## For team leads / maintainers

| Task | Command |
|------|---------|
| Install kit into a repo | `cursor-gitnexus-kit/bin/install.sh /path/to/repo` |
| Update after kit release | `cursor-gitnexus-kit/bin/update.sh /path/to/repo` |
| Human status | `npm run gitnexus:health` |
| Re-index (humans / CI) | `npm run gitnexus:refresh` |
| Agent re-index | `npm run gitnexus:agent-refresh` (agents run this autonomously) |

After install or update: **restart Cursor** on the project.

## Troubleshooting

| Situation | What to do |
|-----------|------------|
| Agent seems “blocked” on grep | Expected when graph is fresh — agent should use GitNexus MCP tools |
| Graph tools return stale/wrong data | Agent should run `gitnexus:agent-refresh`; or you run `gitnexus:refresh` |
| Hooks not firing | Restart Cursor; check Hooks enabled in settings |
| `gitnexus:health` shows missing embeddings | Run `npm run gitnexus:agent-refresh` or full `gitnexus:refresh` |

## Pitch line (for GitNexus + Cursor)

> **GitNexus gives the graph. This kit makes Cursor agents actually use it — every session, with enforcement.**
