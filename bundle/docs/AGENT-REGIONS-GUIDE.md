# Agent Regions — User Guide

## 3 steps (every new Agent chat)

**Step 1** — Describe your task in plain English. Include a file path if you know it.

Example: `fix the login handler in src/api/auth.js`

**Step 2** — We auto-pick your work area. The AI will say: *"You're in the **API** area…"*

**Step 3** — Wrong area? Reply exactly: `region: <id>` or `superchat`

## Copy-paste commands

| Goal | Type exactly |
|------|----------------|
| Switch area | `region: adapters` (use your repo's id) |
| Whole-repo work | `superchat` (strong model only) |

## Rules

- You can ask the AI to **read any file**.
- The AI **writes only** in your picked area.
- Big cross-area change → new chat per area, or `superchat`.

## Troubleshooting

**"REGION REQUIRED"** → Send your task in one sentence (not just "hi").

**Blocked edit** → Open a new chat with `region: <owning-area>`.

**No areas** → `npm run gitnexus:agent-refresh` then `npm run gitnexus:generate-regions`.

Customize areas: `docs/regions.overlay.json`
