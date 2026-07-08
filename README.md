<div align="center">

# gitnexus-agent-kit

**The enforcement layer for GitNexus — Cursor, Zed, Claude Code, and Ollama**

Hooks (Cursor) · Agent profiles (Zed) · MCP · Skills · Cypher · Autonomous refresh — graph-first reasoning on **every task**, not only when code is unfamiliar.

**Stronger agent work at every model tier** — biggest lift on fast, budget, and local models; flagship models run leaner and more consistently too.

The graph + hooks replace ad hoc grep-and-guess with enforced structure — so you pay less for weights *or* get more from the weights you already pay for.

<br />

[![CI](https://github.com/ReidenXerx/cursor-gitnexus-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/ReidenXerx/cursor-gitnexus-kit/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%3E%3D22.9.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)
[![GitNexus](https://img.shields.io/badge/GitNexus-MCP-6366f1)](https://github.com/abhigyanpatwari/GitNexus)

[Quick start](#quick-start) · [Zed + Ollama](docs/ZED.md) · [Skills](docs/SKILLS.md) · [Architecture](docs/ARCHITECTURE.md) · [Full install guide](docs/QUICKSTART.md)

</div>

---

GitNexus builds the knowledge graph. This kit wires it into **all agent reasoning** — explore, debug, edit, refactor, review, commit — with **hard enforcement** when the index is fresh: deny grep-first habits, inject MCP playbooks, auto-refresh stale graphs, verify the stack on every install.

Battle-tested across real production repositories; examples below use neutral placeholder paths.


```bash
git clone https://github.com/ReidenXerx/gitnexus-agent-kit.git
cd gitnexus-agent-kit
./bin/install.sh                    # interactive — pick Cursor, Zed, or both
./bin/install.sh /path/to/repo --runtime zed   # Zed + Ollama profile
./bin/install.sh /path/to/repo --runtime both  # Cursor hooks + Zed profile
# → restart your IDE → npm run gitnexus:health → new Agent chat
```

## Why this exists

Most teams treat GitNexus as optional onboarding docs. Agents grep familiar files, skip `impact` on “small” edits, and only open the graph when lost. **Wrong model.** The graph should be the default substrate for every task.

This kit closes that gap with **IDE-specific enforcement** — Cursor hooks, Zed agent profiles, shared symlinked skills, session health rituals, and a polished install that ends in `gitnexus:verify`.

## IDE runtimes

| Runtime | What gets installed | Enforcement style |
| --- | --- | --- |
| **Cursor** (`--runtime cursor`) | Hooks, rules, `.cursor/mcp.json`, skills | Hard — hooks deny grep/read when graph is fresh |
| **Zed** (`--runtime zed`) | `.zed/settings.json`, **Zed + GitNexus** agent profile, `.agents/skills/`, `AGENTS.md` | Profile — grep disabled; Zed model + gitnexus MCP |
| **Claude Code** (`--runtime claude`) | `.mcp.json`, `.claude/settings.json` hooks, `.claude/skills/`, `CLAUDE.md` | Hard — PreToolUse hooks deny symbol grep / large read / blind edits; commit gated on `detect_changes` |
| **Both** (`--runtime both`, default) | Cursor + Zed | Cursor hard gates + Zed profile for the same repo |
| **All** (`--runtime all`) | Cursor + Zed + Claude Code | Every adapter (also any comma list, e.g. `--runtime cursor,claude`) |

Claude Code shares the **same enforcement core** as Cursor — the `classify.mjs` policy decides allow/deny, and a small `claude-emit` adapter maps the verdict to Claude Code's `PreToolUse` hook protocol. Same gates, same graph-first loop.

Skills live once in `.gitnexus/agent-kit/skills/` and are **symlinked** into `.cursor/skills/` and/or `.agents/skills/` — one source of truth, both IDEs stay in sync on update.

→ Deep dive with diagrams: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**

## Model tiers — who gains what

Frontier models hide weak repo habits (grep-first, skip `impact`, full-file reads). **This kit fixes the workflow for every tier** — not only “dumb” models.

| | Without kit | With kit + fresh graph |
|---|-------------|------------------------|
| **Budget / local / fast** | Often fails on large repos; grep loops, shallow refactors | Same enforced loop as everyone else — **graph carries what the model can't hold in context** |
| **Flagship / expensive** | Still wastes tokens on blind reads and retries; inconsistent tool choice | **Less token burn**, fewer missed callers, same playbook every session — model spends capacity on *thinking*, not repo spelunking |

**Honest positioning:**

- **Unique wedge:** makes serious repo work viable on **lower-cost models** — structure lives in GitNexus, not in parameter count.
- **Also true:** teams on **Opus / Sonnet / GPT-4 class** models still win — faster runs, fewer “smart but sloppy” edits, enforced `impact` / `cypher` / `detect_changes` even when the model *could* have guessed.
- **Not either/or:** downgrade tier *or* keep flagship and ship with less waste. The kit is **model-agnostic enforcement**, not a budget-model patch.

You pay for graph index + embeddings once; every agent turn — cheap or expensive — gets the same scaffold.

→ Deep dive: **[docs/ARCHITECTURE.md#model-tiers-who-gains-what](docs/ARCHITECTURE.md#model-tiers-who-gains-what)**

## What you get

| Outcome | Mechanism |
|---------|-----------|
| **Budget-model lift** | Enforced playbook — biggest relative gain on fast/local tiers |
| **Flagship efficiency** | Same gates — less token waste, fewer grep retries, consistent impact checks |
| Graph in every task loop | Hooks on explore, edit, commit — not a sidecar |
| Fewer missed callers | Symbol grep blocked → `context` / `impact` |
| Better fuzzy grounding | SemanticSearch blocked → `query` (BM25 + embeddings) |
| Structural precision | Field data flow, N-hop chains → **`cypher`**, not field grep |
| Safer edits | Pre-edit `impact`; `rename` MCP instead of blind StrReplace |
| Fresh index | Agent runs `gitnexus:agent-refresh` when stale |
| Proof it works | Session health + `gitnexus:verify` audit table |

## Quick start

**Prerequisites:** Node ≥ 22.9.0 · git · bash · **Cursor** (hooks) and/or **Zed** (agent profile) · GitNexus MCP

```bash
# Full install + index (recommended)
./bin/install.sh /path/to/your-repo

# Hooks/skills only — index later
./bin/install.sh /path/to/your-repo --quick

# Custom GitNexus registry name
./bin/install.sh /path/to/your-repo --repo-name my-app
```

**After install (in the target repo):**

1. Restart Cursor on that project  
2. `npm run gitnexus:verify`  
3. `npm run gitnexus:health`  
4. New Agent chat  

Details, flags, update/uninstall: **[docs/QUICKSTART.md](docs/QUICKSTART.md)**

## Commands (target repo)

| Command | Who | Purpose |
|---------|-----|---------|
| `npm run gitnexus:verify` | CI / leads | Full kit audit after install or update |
| `npm run gitnexus:health` | Humans | Friendly status line |
| `npm run gitnexus:agent-brief` | Agents | Session orientation |
| `npm run gitnexus:agent-status` | Agents | Staleness check |
| `npm run gitnexus:agent-refresh` | Agents | Re-index when stale |
| `npm run gitnexus:branch-status` | PR review | Show current/base branch and branch-aware MCP calls |
| `npm run gitnexus:pr-impact` | PR review | Branch-aware review playbook vs base |
| `npm run gitnexus:pdg` | Git hook / humans | Re-index with PDG before commit |
| `npm run gitnexus:graph-smoke` | CI | Cypher / ACCESSES sanity |
| `npm run gitnexus:detect-api` | Setup | Express vs custom router profile |
| `npm run gitnexus.__gate.*` | Docs | Gate explanations in `package.json` |

Gate map: `scripts/gitnexus-teaching/script-gates.mjs` · `npm run gitnexus.__gate.1.session`

## Repo layout

```
gitnexus-agent-kit/
├── bin/              install · update · uninstall
├── bundle/           teaching bundle → copied into target repos
├── lib/              kit core + tests (migrate, skills, zed)
├── docs/             architecture, quickstart, skills, ZED guide, release checklist
└── .github/          CI, issue/PR templates
```

## North star (agent contract)

> GitNexus is the **default reasoning layer for every task** — not a fallback when code is unfamiliar. Prefer **graph + embeddings + cypher** when the index is fresh. Refresh autonomously when stale. Fall back to grep/read only when GitNexus is stale, failing, or wrong — and say why.

Enforced in `bundle/.cursor/rules/00-gitnexus-enforcement.mdc`.

## For GitNexus upstream

> GitNexus gives teams a code knowledge graph. **gitnexus-agent-kit** is the agent layer for Cursor, Zed, and Ollama: install once, wire the graph into every task, enforce graph-first reasoning (hooks on Cursor; profile + skills on Zed), autonomous refresh, human-readable status — **model-agnostic uplift; highest ROI on budget/local tiers; flagship models run leaner too.**  
> **Proposed:** `gitnexus init --agent-kit`

## Contributing

```bash
npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md)

Maintainer bundle reference: [docs/TEAM-BUNDLE.md](docs/TEAM-BUNDLE.md). Release checklist: [docs/RELEASE.md](docs/RELEASE.md). Changelog: [CHANGELOG.md](CHANGELOG.md).

## License

[ISC](LICENSE)
