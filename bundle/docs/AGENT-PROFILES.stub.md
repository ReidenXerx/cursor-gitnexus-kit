# Agent Profiles — Region-Bound AI Roles (starter template)

> **Customize this file** for your repository. On first install, the kit copies this stub to `docs/AGENT-PROFILES.md` only if that file does not already exist.

## Why region-bound profiles

- **Bounded context = better focus.** Each chat agent loads one region plus border contracts.
- **Reads anywhere.** Cross-region Read and GitNexus graph tools are always allowed for reasoning.
- **Writes bounded.** Hooks enforce edits only in `owns` paths (see `docs/regions.overlay.json`).

## After indexing

```bash
npm run gitnexus:agent-refresh      # builds graph + area skills
npm run gitnexus:generate-regions   # rebuilds .cursor/regions.manifest.json
```

Customize `docs/regions.overlay.json` for your layout (`mode: replace` for full control).
