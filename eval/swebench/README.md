# SWE-bench Verified benchmark with GitNexus

> **⚠️ Important caveat**: This harness measures **GitNexus MCP** (the graph engine),
> not **gitnexus-agent-kit** (the enforcement layer). See [What this tests](#what-this-tests-vs-what-proves-your-kit) below.

Industry-standard benchmark comparing agents with and without GitNexus MCP access.
Based on d3thshot7777's approach (mini-swe-agent + GitNexus MCP).

## What this tests vs what proves your kit

| Comparison | What it measures | What it proves |
|------------|-------------------|----------------|
| Agent + MCP vs Agent alone | GitNexus graph helps agents explore code | GitNexus MCP adds value (d3thshot proved: 30% fewer tokens) |
| Agent + MCP + **Kit** vs Agent + MCP alone | Hooks, skills, enforcement add value **on top of** MCP | **This is your kit's unique contribution** — NOT tested here |

This harness proves the first row (MCP value). To prove the second row (kit value on top of MCP),
you need your `bench-realrepo.mjs` with `cursor-agent`, which can actually exercise hooks and skills.

**Recommendation**: Use this SWE-bench harness for the MCP comparison (matching d3thshot's numbers),
and use `bench-realrepo.mjs` with the task specs in `realrepo-tasks/` for the kit-specific value.

## What it measures

| Metric | Meaning |
|--------|---------|
| **Solve rate** | % of instances where the generated patch passes the test suite |
| **Total tokens** | Cumulative input+output tokens across all instances |
| **API calls** | Number of model completions |
| **Avg tokens/instance** | Efficiency per task |

## Architecture

```
swebench/
├── README.md               ← you are here
├── run-benchmark.sh         Main entry point: run both arms, produce report
├── install-gitnexus-mcp.sh Per-instance GitNexus setup inside Docker (with PDG)
├── gitnexus_swe_tools.py    Tool schemas + CLI client + agent integration
├── configs/
│   ├── baseline.yaml        mini-swe-agent config (bash only)
│   └── gitnexus.yaml        mini-swe-agent config (bash + 8 GitNexus tools + PDG)
├── scoring/
│   └── score-pairs.py       Pair instances, compute deltas, produce report
└── results/                 Created at runtime; trajectories + patches + scores
```

## Quick start

```bash
# Install dependencies
pip install mini-swe-agent swebench

# Run 50 instances with DeepSeek V4 (or any litellm model)
./eval/swebench/run-benchmark.sh \
  --model deepseek/deepseek-chat-v3-0324 \
  --instances 50

# Full SWE-bench Verified (500 instances)
./eval/swebench/run-benchmark.sh \
  --model deepseek/deepseek-chat-v3-0324
```

## How it works

### 1. Baseline arm (no GitNexus)

Standard mini-swe-agent with bash-only tool. Each instance:
- Spins up a Docker container with the repo at the right commit
- Agent explores via grep/find/cat + edits + test
- Produces a patch

### 2. GitNexus arm (with MCP + PDG)

Same Docker setup, **plus**:
- `gitnexus analyze --embeddings --pdg` runs inside the container after setup
  - **Embeddings layer**: BM25 + vector search for `query`
  - **PDG layer**: Control dependence (CDG), data dependence (REACHING_DEF), taint flows
- mini-swe-agent gets 8 additional GitNexus MCP tools alongside bash:
  - `gitnexus_query` — hybrid BM25 + embedding search
  - `gitnexus_context` — symbol-level callers/callees/references
  - `gitnexus_impact` — blast radius (with `mode=pdg` for statement-level)
  - `gitnexus_cypher` — raw graph queries (ACCESSES, CALLS, METHOD_OVERRIDES)
  - `gitnexus_pdg_query` — control/data dependence at statement level
  - `gitnexus_explain` — taint analysis (command-injection, path-traversal, etc.)
  - `gitnexus_detect_changes` — affected processes from uncommitted changes
- The PDG layer gives the agent precision that the base graph alone cannot:
  - **What condition gates this line?** → `pdg_query mode=controls`
  - **Where does this variable's value flow?** → `pdg_query mode=flows`
  - **Is there a taint path from user input to this sink?** → `explain`
  - **Statement-level impact of this change** → `impact mode=pdg`

### 3. Scoring

SWE-bench's standard Docker-based test evaluation checks if each patch passes the gold test suite. The scoring script pairs instances and computes:

- Solve rate delta (GitNexus − baseline)
- Token savings percentage
- API call savings percentage
- Per-instance diff (regressed / improved / tied)

## Proving your kit's value (the real goal)

This SWE-bench harness proves MCP value. To prove **kit enforcement** value, use `bench-realrepo.mjs`:

```bash
# 3-arm comparison on your real repo:
#   OFF = bare agent (no MCP, no hooks)
#   MCP = agent + gitnexus MCP (no hooks)
#   KIT = agent + gitnexus MCP + hooks + rules + skills + PDG

node eval/bench-realrepo.mjs \
  --task eval/realrepo-tasks/enter-control-useauth-impact.json \
  --model composer-2.5-fast --trials 3
```

The task specs in `realrepo-tasks/` are designed to show where each layer adds value:

| Task | What it tests | grep ceiling | graph ceiling | kit ceiling |
|------|--------------|-------------|---------------|-------------|
| `enter-control-useauth-impact` | Transitive callers | 0.87 (3 invisible) | 1.0 | Same as graph — this is MCP-only |
| `transitive-callers-impact` | Multi-level call chains | Misses transitive | 1.0 | Same — MCP-only |
| `field-write-access` | ACCESSES write edges | Can't distinguish read/write | 1.0 | Same — MCP-only |
| `safe-rename-kit-enforced` | Coordinated rename | Misses indirect refs | 1.0 via `rename` | **Kit forces `rename` MCP instead of StrReplace** |
| `detect-changes-before-commit` | Pre-commit blast radius | No enforcement | Agent *can* run it | **Kit blocks commit until `detect_changes` runs** |
| `pdg-control-dependence` | PDG control flow | Can't determine control | 1.0 via `pdg_query` | Same — PDG-only |

The last two rows are where your **kit** (enforcement) adds value on top of MCP:

1. **`safe-rename-kit-enforced`**: Without the kit, an agent can use StrReplace (find-and-replace) and miss indirect references. With the kit, the edit-guard hook blocks the edit until `impact` is run, and the prompt-router steers renames to the `rename` MCP tool.

2. **`detect-changes-before-commit`**: Without the kit, an agent can commit without checking blast radius. With the kit, the commit-guard hook blocks `git commit` until `detect_changes` has been called.

## Methodology notes

- **Fair comparison**: Both arms use the same model, same prompt structure, same step/cost limits. The only difference is GitNexus MCP availability.
- **Instance filtering**: Exclude instances that fail due to infra/container issues (not agent-related) from both arms, matching d3thshot's fair-pair methodology.
- **Paired analysis**: Every instance appears in both arms, so we compare within-instance deltas rather than aggregate percentages alone.

## PDG cache generation

The Docker setup script (`install-gitnexus-mcp.sh`) runs two passes:

1. `gitnexus analyze --embeddings` — builds the symbol graph + BM25/vector index
2. `gitnexus analyze --pdg` — builds the PDG layer on top (CDG + REACHING_DEF + taint)

This gives the agent PDG-powered tools that d3thshot's original run didn't have:
- **Control dependence** — what predicate controls each statement
- **Data dependence** — where each variable's definition reaches
- **Taint flows** — source→sink paths for security-sensitive data

## Agent wiring status

`gitnexus_swe_tools.py` contains the full integration:

- **`GitNexusClient`** — Routes `gitnexus_*` tool calls to the `gitnexus` CLI subprocess
- **`GitNexusLitellmModel`** — Wraps `LitellmModel` to inject all 8 GitNexus tools into the LLM's tool list
- **`GitNexusSweBenchAgent`** — Owns the agent loop: parses tool calls from LLM responses, routes `bash` calls to the Docker environment and `gitnexus_*` calls to `GitNexusClient`, feeds observations back
- **`create_gitnexus_agent()`** — Factory that creates the right agent (baseline or gitnexus) based on the `--gitnexus` flag

The agent loop:
1. Send messages + tools to LLM
2. Parse tool calls from response (bash or gitnexus_*)
3. Execute: bash → Docker env, gitnexus_* → `GitNexusClient.call()`
4. Feed observation back as tool result messages
5. Repeat until no more tool calls or step/cost limit

### Running

```bash
# Install dependencies
pip install mini-swe-agent swebench litellm

# Run a single instance with GitNexus (treatment arm)
python eval/swebench/gitnexus_swe_tools.py \
    --model deepseek/deepseek-chat-v3-0324 \
    --gitnexus \
    --instances 1

# Run baseline (no GitNexus)
python eval/swebench/gitnexus_swe_tools.py \
    --model deepseek/deepseek-chat-v3-0324 \
    --instances 1
```

## Credit

Benchmark approach inspired by d3thshot7777's initial SWE-bench Verified run with DeepSeek V4 + GitNexus MCP via mini-swe-agent.

SWE-bench: [Jimenez et al., ICLR 2024](https://arxiv.org/abs/2310.06781)
mini-swe-agent: [Yang et al., NeurIPS 2024](https://arxiv.org/abs/2405.15793)