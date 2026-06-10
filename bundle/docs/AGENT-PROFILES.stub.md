# Agent Profiles — Region-Bound AI Roles (starter template)

> **Customize this file** for your repository. On first install, the kit copies this stub to `docs/AGENT-PROFILES.md` only if that file does not already exist.

## Why region-bound profiles

- **Bounded context = better focus.** Each chat agent loads one region plus border contracts.
- **Safety.** A profile that only edits its own paths cannot accidentally break distant layers.
- **GitNexus is the shared map.** Every profile uses the same graph tools, anchored to `.cursor/skills/generated/<area>/SKILL.md` after indexing.

## Profile card template

| Field | Meaning |
|-------|---------|
| **Mission** | The one job this profile exists to do. |
| **Owns (editable)** | Paths the profile may create/modify. |
| **Reads (context only)** | Paths it may read but must not edit. |
| **Contracts at the border** | Interfaces it must honor for neighboring regions. |
| **Never touches** | Hard out-of-bounds zones. |
| **GitNexus anchor** | Functional cluster + generated area skill to load first. |
| **Definition of done** | Checks that must pass before work is complete. |

## Example profiles (replace with your layout)

### Example: API / Server profile

- **Mission:** HTTP routes, request handling, API contracts.
- **Owns:** `src/server/**`, `src/api/**` (adjust paths).
- **Reads:** shared types, config, adapter interfaces.
- **Never touches:** UI, database migrations owned by another team.
- **GitNexus anchor:** `query({query: "HTTP request handling", ...})` then area skill from `generated/server/`.

### Example: Frontend profile

- **Mission:** UI components and client-side state.
- **Owns:** `src/components/**`, `src/pages/**`.
- **Reads:** API client types, design tokens.
- **Never touches:** server internals, infra scripts.

## How agents use this doc

1. Open **one chat per profile** — do not mix regions in one session.
2. Seed the chat: *"You are the \<Profile\> agent. Read `docs/AGENT-PROFILES.md` and `.cursor/skills/generated/<area>/SKILL.md`."*
3. Cross-region work = hand-off to another profile, not edits outside **Owns**.

## After indexing

Run `npm run gitnexus:refresh` (or full install without `--quick`) so area skills exist under `.claude/skills/generated/` and sync to `.cursor/skills/generated/`.
