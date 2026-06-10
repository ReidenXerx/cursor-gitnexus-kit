---
name: gitnexus-api-routes
description: "Use when changing the research HTTP API in this repo. api_impact/route_map do NOT work here — custom hand-rolled router. Examples: \"add API endpoint\", \"change research server route\", \"what does /api/... do?\""
---

# Research API Routes (__GITNEXUS_REPO__)

## Why api_impact doesn't work here

GitNexus indexes Express/Fastify-style `Route` nodes. This project's research server uses a **custom router**:

- `handleRequest` — main dispatcher (`src/future/server/researchApiServer.js`)
- `isKnownApiPath` — path allowlist
- `allowsApiMethod` — method guard
- `sendJson` — response envelope `{ ok, data, error }`

Cypher query for Route nodes returns **empty** in this repo. Use graph tools on these symbols instead.

## Workflow for route / payload changes

```
1. gitnexus_context({name: "handleRequest", repo: "__GITNEXUS_REPO__"})
2. gitnexus_context({name: "isKnownApiPath"})
3. gitnexus_query({
     query: "<path or feature>",
     task_context: "research API change",
     goal: "find handler and consumers"
   })
4. gitnexus_impact upstream on handler function BEFORE editing
5. Update Dashboard mirror: apps/research-dashboard/src/api/researchApi.ts
6. gitnexus_detect_changes before commit
7. tests/server + dashboard tests green
```

## Checklist

```
- [ ] context on handleRequest + the specific handler function
- [ ] impact upstream on handler
- [ ] { ok, data, error } envelope preserved
- [ ] researchApi.ts types match new payload shape
- [ ] No business logic duplicated in server — call adapters/core
- [ ] Artifact paths unchanged OR Adapters profile updated too
```

## Finding consumers

Dashboard fetches via `researchApi.ts`. Trace with:

```
gitnexus_query({query: "researchApi fetch endpoint", goal: "find dashboard consumer"})
gitnexus_context({name: "<handlerFunction>"})
```

Or grep `researchApi.ts` for path strings (appropriate here — URL string literals).

## Cross-profile hand-off

| Change | Profiles involved |
| --- | --- |
| New field in JSON response | Server (define) + Dashboard (mirror types) |
| New artifact filename | Adapters (write) + Server (read) + maybe Dashboard (display) |
| New query param | Server + Dashboard client |

See `docs/AGENT-PROFILES.md` border table.

## Entry symbols

| Symbol | File | Role |
| --- | --- | --- |
| `handleRequest` | researchApiServer.js | HTTP dispatcher |
| `isKnownApiPath` | researchApiServer.js | Path validation |
| `sendJson` | researchApiServer.js | Response envelope |
| `server` | researchApiServer.js | Server bootstrap |

Area skill: `.claude/skills/generated/server/SKILL.md`
