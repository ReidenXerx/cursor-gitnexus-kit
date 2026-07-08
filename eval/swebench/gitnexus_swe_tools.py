"""
GitNexus MCP tools for mini-swe-agent (v2.4.2+).

Extends mini-swe-agent with 8 GitNexus tools alongside bash, including
PDG-powered tools (pdg_query, explain, impact --mode pdg).

Architecture (matching mini-swe-agent v2.4.2 API):
  - LitellmModel._query() calls litellm.completion() with tools=[BASH_TOOL]
  - LitellmModel._parse_actions() calls parse_toolcall_actions() which ONLY
    accepts "bash" tool calls — any other tool name raises FormatError
  - DefaultAgent.execute_actions() calls env.execute(action) for each parsed action

  Our integration:
  - GitNexusLitellmModel(LitellmModel): overrides _query() to pass
    tools=ALL_TOOLS (bash + 8 gitnexus), and overrides _parse_actions() to
    accept both "bash" and "gitnexus_*" tool calls, routing gitnexus calls
    through GitNexusClient
  - GitNexusSweBenchAgent(DefaultAgent): overrides execute_actions() to route
    gitnexus actions through GitNexusClient and bash actions through env

  This matches the approach described by d3thshot7777 who ran SWE-bench Verified
  with GitNexus MCP via mini-swe-agent.

Usage:
    # Run SWE-bench Verified with GitNexus:
    python eval/swebench/gitnexus_swe_tools.py run \
        --model deepseek/deepseek-chat-v3-0324 \
        --instance-ids django__django-11149

    # Or via the shell script:
    ./eval/swebench/run-benchmark.sh --model deepseek/deepseek-chat-v3-0324 --instances 50
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
from pathlib import Path
from typing import Any

logger = logging.getLogger("gitnexus_swe_tools")

# ──────────────────────────────────────────────────────────────
# GitNexus MCP tool definitions (OpenAI function-calling schema)
# ──────────────────────────────────────────────────────────────

GITNEXUS_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "gitnexus_query",
            "description": (
                "Search the code knowledge graph using hybrid BM25 + embedding vectors. "
                "Use this FIRST to orient yourself on any task — find relevant code, "
                "processes, or concepts. Returns ranked execution flows with symbol locations."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "search_query": {
                        "type": "string",
                        "description": "Natural language or keyword search query",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max processes to return (default 5)",
                        "default": 5,
                    },
                    "max_symbols": {
                        "type": "integer",
                        "description": "Max symbols per process (default 10)",
                        "default": 10,
                    },
                    "repo": {
                        "type": "string",
                        "description": "Repository name (auto-detected if omitted)",
                    },
                },
                "required": ["search_query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "gitnexus_context",
            "description": (
                "Get a 360-degree view of a code symbol: callers, callees, references, "
                "process participation, and file location. Use after query to drill into "
                "specific symbols."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Symbol name (e.g. 'validate_user', 'UserModel')",
                    },
                    "kind": {
                        "type": "string",
                        "description": "Kind hint: Function, Class, Method, Interface, etc.",
                    },
                    "file_path": {
                        "type": "string",
                        "description": "File path hint to disambiguate common names",
                    },
                    "include_content": {
                        "type": "boolean",
                        "description": "Include full symbol source code (default false)",
                        "default": False,
                    },
                    "repo": {
                        "type": "string",
                        "description": "Repository name (auto-detected if omitted)",
                    },
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "gitnexus_impact",
            "description": (
                "Analyze the blast radius of changing a code symbol. Returns affected symbols "
                "grouped by depth, risk assessment, and affected execution flows. "
                "ALWAYS run this before editing shared/runtime code. "
                "Use mode='pdg' for statement-level impact with control/data dependence."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "target": {
                        "type": "string",
                        "description": "Name of function, class, or file to analyze",
                    },
                    "direction": {
                        "type": "string",
                        "enum": ["upstream", "downstream"],
                        "description": "upstream = what depends on this; downstream = what this depends on",
                        "default": "upstream",
                    },
                    "mode": {
                        "type": "string",
                        "enum": ["callgraph", "pdg"],
                        "description": "callgraph = symbol-level impact (default); pdg = statement-level with control/data dependence",
                        "default": "callgraph",
                    },
                    "summaryOnly": {
                        "type": "boolean",
                        "description": "Return only summary counts (default false)",
                        "default": False,
                    },
                    "repo": {
                        "type": "string",
                        "description": "Repository name (auto-detected if omitted)",
                    },
                },
                "required": ["target"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "gitnexus_cypher",
            "description": (
                "Run a Cypher query on the code knowledge graph. Use for precise structural "
                "questions: field read/write (ACCESSES), N-hop call chains (CALLS), "
                "method overrides (METHOD_OVERRIDES), process steps (STEP_IN_PROCESS). "
                "READ the schema first: gitnexus://repo/{name}/schema"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "statement": {
                        "type": "string",
                        "description": "Cypher query statement",
                    },
                    "repo": {
                        "type": "string",
                        "description": "Repository name (auto-detected if omitted)",
                    },
                },
                "required": ["statement"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "gitnexus_pdg_query",
            "description": (
                "Query the Program Dependence Graph for statement-level control and data dependence. "
                "mode='controls': what condition gates a statement? What runs under true/false branches? "
                "mode='flows': where does a variable's value flow (REACHING_DEF edges)? "
                "Requires the repo to be indexed with --pdg."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "mode": {
                        "type": "string",
                        "enum": ["controls", "flows"],
                        "description": "'controls' = control dependence (CDG); 'flows' = data dependence (REACHING_DEF)",
                    },
                    "target": {
                        "type": "string",
                        "description": "File path or symbol name to anchor the query",
                    },
                    "variable": {
                        "type": "string",
                        "description": "Variable name (for flows mode only): filter REACHING_DEF to this variable",
                    },
                    "repo": {
                        "type": "string",
                        "description": "Repository name (auto-detected if omitted)",
                    },
                },
                "required": ["mode", "target"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "gitnexus_explain",
            "description": (
                "Explain taint findings — source→sink data flows for security review. "
                "Shows intra-procedural taint (statement-level hops) and cross-function flows. "
                "Categories: command-injection, path-traversal, sql-injection, xss. "
                "Requires the repo to be indexed with --pdg."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "target": {
                        "type": "string",
                        "description": "File path or symbol/function name to anchor the query. Omit to list all findings.",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max findings returned (default 50, max 200)",
                        "default": 50,
                    },
                    "repo": {
                        "type": "string",
                        "description": "Repository name (auto-detected if omitted)",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "gitnexus_detect_changes",
            "description": (
                "Analyze uncommitted git changes and find affected execution flows. "
                "Use BEFORE submitting your patch to verify what your changes affect."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "scope": {
                        "type": "string",
                        "enum": ["unstaged", "staged", "all", "compare"],
                        "description": "What to analyze (default: unstaged)",
                        "default": "unstaged",
                    },
                    "repo": {
                        "type": "string",
                        "description": "Repository name (auto-detected if omitted)",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "gitnexus_rename",
            "description": (
                "Coordinated multi-file rename using the code knowledge graph. "
                "Finds all references (direct + indirect) and renames them atomically. "
                "Use dry_run=true first to preview changes."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "symbol_name": {
                        "type": "string",
                        "description": "Current symbol name to rename",
                    },
                    "new_name": {
                        "type": "string",
                        "description": "New name for the symbol",
                    },
                    "file_path": {
                        "type": "string",
                        "description": "File path hint to disambiguate common names",
                    },
                    "dry_run": {
                        "type": "boolean",
                        "description": "Preview changes without applying (default true)",
                        "default": True,
                    },
                    "repo": {
                        "type": "string",
                        "description": "Repository name (auto-detected if omitted)",
                    },
                },
                "required": ["symbol_name", "new_name"],
            },
        },
    },
]

BASH_TOOL = {
    "type": "function",
    "function": {
        "name": "bash",
        "description": "Execute a bash command",
        "parameters": {
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "The bash command to execute",
                },
            },
            "required": ["command"],
        },
    },
}

ALL_TOOLS = [BASH_TOOL] + GITNEXUS_TOOLS
BASELINE_TOOLS = [BASH_TOOL]
GITNEXUS_TOOL_NAMES = {t["function"]["name"] for t in GITNEXUS_TOOLS}


# ──────────────────────────────────────────────────────────────
# GitNexus MCP client — calls gitnexus CLI as subprocess
# ──────────────────────────────────────────────────────────────


class GitNexusClient:
    """Calls GitNexus MCP tools via the CLI (subprocess)."""

    TOOL_TO_CLI = {
        "gitnexus_query": "query",
        "gitnexus_context": "context",
        "gitnexus_impact": "impact",
        "gitnexus_cypher": "cypher",
        "gitnexus_pdg_query": "pdg-query",
        "gitnexus_explain": "explain",
        "gitnexus_detect_changes": "detect-changes",
        "gitnexus_rename": "rename",
    }

    def __init__(self, repo_path: str, repo_name: str | None = None):
        self.repo_path = repo_path
        self.repo_name = repo_name or Path(repo_path).name
        self._gitnexus_bin = self._find_gitnexus()

    def _find_gitnexus(self) -> str:
        for candidate in ["gitnexus", "npx"]:
            try:
                result = subprocess.run(
                    ["which", candidate], capture_output=True, text=True, timeout=5
                )
                if result.returncode == 0:
                    return result.stdout.strip()
            except Exception:
                continue
        return "npx"

    def call(self, tool_name: str, arguments: dict[str, Any]) -> str:
        tool_args = {**arguments}
        if "repo" not in tool_args:
            tool_args["repo"] = self.repo_name
        cmd = self._build_command(tool_name, tool_args)
        try:
            result = subprocess.run(
                cmd, cwd=self.repo_path, capture_output=True, text=True, timeout=120
            )
            output = result.stdout
            if result.returncode != 0:
                stderr = result.stderr[:2000]
                output = f"ERROR: gitnexus {tool_name} failed (exit {result.returncode})\n{stderr}\n{output}"
            return output[:50000]
        except subprocess.TimeoutExpired:
            return "ERROR: gitnexus call timed out after 120s"
        except Exception as e:
            return f"ERROR: gitnexus call failed: {e}"

    def _build_command(self, tool_name: str, args: dict[str, Any]) -> list[str]:
        if self._gitnexus_bin == "npx":
            base = ["npx", "-y", "gitnexus@latest"]
        else:
            base = [self._gitnexus_bin]
        subcmd = self.TOOL_TO_CLI.get(tool_name, tool_name.replace("gitnexus_", ""))
        cmd = base + [subcmd]
        for key, value in args.items():
            if key in ("search_query", "statement"):
                cmd.append(str(value))
            elif isinstance(value, bool):
                if value:
                    cmd.append(f"--{key}")
            elif isinstance(value, (int, float)):
                cmd.extend([f"--{key}", str(value)])
            else:
                cmd.extend([f"--{key}", str(value)])
        return cmd


# ──────────────────────────────────────────────────────────────
# mini-swe-agent integration (v2.4.2+)
# ──────────────────────────────────────────────────────────────


class GitNexusLitellmModel:
    """Wraps LitellmModel to add GitNexus tools to the LLM's tool list.

    Overrides _query() to include ALL_TOOLS (bash + gitnexus_*) and overrides
    _parse_actions() to handle gitnexus tool calls alongside bash.
    """

    def __init__(self, model_name: str, **kwargs):
        from minisweagent.models.litellm_model import LitellmModel

        self._model = LitellmModel(model_name=model_name, **kwargs)
        self.model_name = model_name
        self._gitnexus_tools = ALL_TOOLS

    def query(self, messages, **kwargs):
        """Delegate to the wrapped model's query (which calls _query then _parse_actions)."""
        return self._model.query(messages, **kwargs)

    def _query(self, messages, **kwargs):
        """Override to inject GitNexus tools into the litellm completion call."""
        import litellm

        return litellm.completion(
            model=self._model.config.model_name,
            messages=messages,
            tools=self._gitnexus_tools,
            **(self._model.config.model_kwargs | kwargs),
        )

    def _parse_actions(self, response):
        """Override to handle both bash and gitnexus tool calls.

        The base parse_toolcall_actions() only accepts 'bash' — it raises
        FormatError for any other tool name. We parse gitnexus calls ourselves
        and delegate bash calls to the original parser.
        """
        from minisweagent.models.litellm_model import (
            FormatError,
            parse_toolcall_actions,
        )

        tool_calls = response.choices[0].message.tool_calls or []
        bash_calls = []
        gitnexus_actions = []

        for tc in tool_calls:
            fn = tc.function
            name = fn.name
            try:
                args = json.loads(fn.arguments) if fn.arguments else {}
            except json.JSONDecodeError:
                args = {}

            tool_call_id = tc.id or ""

            if name == "bash":
                bash_calls.append(tc)
            elif name in GITNEXUS_TOOL_NAMES:
                gitnexus_actions.append(
                    {
                        "command": f"gitnexus {self._gitnexus_subcmd(name)} {json.dumps(args)}",
                        "tool_call_id": tool_call_id,
                        "_gitnexus_action": True,
                        "_gitnexus_tool": name,
                        "_gitnexus_args": args,
                    }
                )
            # Unknown tools are ignored (will be caught by bash parser if they slip through)

        # Parse bash calls using the original parser
        try:
            bash_actions = parse_toolcall_actions(
                bash_calls,
                format_error_template=self._model.config.format_error_template,
                template_kwargs={"finish_reason": response.choices[0].finish_reason},
            )
        except FormatError:
            # If there are no bash calls but we have gitnexus calls, that's fine
            if gitnexus_actions:
                bash_actions = []
            else:
                raise

        return bash_actions + gitnexus_actions

    @staticmethod
    def _gitnexus_subcmd(tool_name: str) -> str:
        """Map gitnexus MCP tool names to CLI subcommands."""
        mapping = {
            "gitnexus_query": "query",
            "gitnexus_context": "context",
            "gitnexus_impact": "impact",
            "gitnexus_cypher": "cypher",
            "gitnexus_pdg_query": "pdg-query",
            "gitnexus_explain": "explain",
            "gitnexus_detect_changes": "detect-changes",
            "gitnexus_rename": "rename",
        }
        return mapping.get(tool_name, tool_name.replace("gitnexus_", ""))

    @property
    def config(self):
        return self._model.config

    @property
    def cost(self):
        return self._model.cost

    @property
    def n_calls(self):
        return self._model.n_calls


class GitNexusSweBenchAgent:
    """Agent that handles both bash and GitNexus tool calls.

    Wraps DefaultAgent and overrides execute_actions to route gitnexus_*
    tool calls to GitNexusClient instead of the bash environment.
    """

    def __init__(self, model, gitnexus_client: GitNexusClient, **kwargs):
        from minisweagent.agents.default import DefaultAgent

        self.model = model
        self.gitnexus_client = gitnexus_client
        # We need to patch the model's _query and _parse_actions
        # to handle GitNexus tools
        if isinstance(model, GitNexusLitellmModel):
            # Already patched
            pass
        else:
            # Patch an existing LitellmModel to add GitNexus tools
            model._query = lambda messages, **kw: self._gitnexus_query(messages, **kw)
            model._parse_actions = lambda response: self._gitnexus_parse_actions(
                response
            )

        self.agent = DefaultAgent(model=model, **kwargs)

    def _gitnexus_query(self, messages, **kwargs):
        """Patch for non-GitNexusLitellmModel models to inject GitNexus tools."""
        import litellm

        return litellm.completion(
            model=self.model.config.model_name,
            messages=messages,
            tools=ALL_TOOLS,
            **(self.model.config.model_kwargs | kwargs),
        )

    def _gitnexus_parse_actions(self, response):
        """Patch for non-GitNexusLitellmModel models to handle GitNexus tool calls."""
        from minisweagent.models.litellm_model import (
            FormatError,
            parse_toolcall_actions,
        )

        tool_calls = response.choices[0].message.tool_calls or []
        bash_calls = []
        gitnexus_actions = []

        for tc in tool_calls:
            fn = tc.function
            name = fn.name
            try:
                args = json.loads(fn.arguments) if fn.arguments else {}
            except json.JSONDecodeError:
                args = {}
            tool_call_id = tc.id or ""

            if name == "bash":
                bash_calls.append(tc)
            elif name in GITNEXUS_TOOL_NAMES:
                gitnexus_actions.append(
                    {
                        "command": f"gitnexus {GitNexusLitellmModel._gitnexus_subcmd(name)} {json.dumps(args)}",
                        "tool_call_id": tool_call_id,
                        "_gitnexus_action": True,
                        "_gitnexus_tool": name,
                        "_gitnexus_args": args,
                    }
                )

        try:
            bash_actions = parse_toolcall_actions(
                bash_calls,
                format_error_template=self.model.config.format_error_template,
                template_kwargs={"finish_reason": response.choices[0].finish_reason},
            )
        except FormatError:
            if gitnexus_actions:
                bash_actions = []
            else:
                raise

        return bash_actions + gitnexus_actions

    def run(self, task: str = "", **kwargs) -> dict:
        """Run the agent loop with GitNexus tool routing."""
        # Monkey-patch execute_actions to handle gitnexus actions
        original_execute = self.agent.execute_actions

        def patched_execute(message):
            actions = message.get("extra", {}).get("actions", [])
            outputs = []
            for action in actions:
                if action.get("_gitnexus_action"):
                    result_text = self.gitnexus_client.call(
                        action["_gitnexus_tool"],
                        action["_gitnexus_args"],
                    )
                    outputs.append(
                        {
                            "output": result_text,
                            "returncode": 0
                            if not result_text.startswith("ERROR")
                            else 1,
                            "exception_info": ""
                            if not result_text.startswith("ERROR")
                            else "gitnexus_error",
                        }
                    )
                else:
                    obs = self.agent.env.execute(action)
                    outputs.append(obs)
            return self.agent.model.format_observation_messages(
                message, outputs, self.agent.get_template_vars()
            )

        self.agent.execute_actions = patched_execute
        return self.agent.run(task=task, **kwargs)

    def save(self, path, **kwargs):
        """Save trajectory."""
        return self.agent.save(path, **kwargs)


# ──────────────────────────────────────────────────────────────
# Convenience factory
# ──────────────────────────────────────────────────────────────


def create_gitnexus_agent(
    model_name: str,
    config_path: str,
    gitnexus: bool = False,
    repo_path: str = "/testbed",
    step_limit: int = 250,
    cost_limit: float = 3.0,
):
    """Create a mini-swe-agent with optional GitNexus tool support."""
    import yaml
    from minisweagent.agents.default import DefaultAgent
    from minisweagent.models.litellm_model import LitellmModel

    with open(config_path) as f:
        config = yaml.safe_load(f)

    model_config = config.get("model", {})
    model_config["model_name"] = model_name
    agent_config = config.get("agent", {})
    env_config = config.get("environment", {})

    if gitnexus:
        model = GitNexusLitellmModel(**model_config)
        gitnexus_client = GitNexusClient(repo_path)
        agent = GitNexusSweBenchAgent(
            model=model,
            gitnexus_client=gitnexus_client,
            step_limit=step_limit,
            cost_limit=cost_limit,
            **{
                k: v
                for k, v in agent_config.items()
                if k not in ("step_limit", "cost_limit")
            },
        )
    else:
        model = LitellmModel(**model_config)
        agent = DefaultAgent(
            model=model,
            step_limit=step_limit,
            cost_limit=cost_limit,
            **{
                k: v
                for k, v in agent_config.items()
                if k not in ("step_limit", "cost_limit")
            },
        )

    return agent


# ──────────────────────────────────────────────────────────────
# CLI entry point
# ──────────────────────────────────────────────────────────────


def main():
    """CLI entry point for running SWE-bench with GitNexus."""
    import argparse

    parser = argparse.ArgumentParser(description="SWE-bench Verified with GitNexus")
    parser.add_argument("--model", required=True, help="litellm model name")
    parser.add_argument("--instance-ids", help="Comma-separated instance IDs")
    parser.add_argument("--instances", type=int, help="Run first N instances")
    parser.add_argument("--config", default=None, help="Path to YAML config")
    parser.add_argument("--output-dir", default="results", help="Output directory")
    parser.add_argument(
        "--gitnexus",
        action="store_true",
        default=False,
        help="Enable GitNexus tools (treatment arm)",
    )
    parser.add_argument(
        "--repo-path", default="/testbed", help="Repo path in container"
    )
    parser.add_argument("--setup-script", default=None, help="Path to setup script")
    parser.add_argument("--step-limit", type=int, default=250, help="Max agent steps")
    parser.add_argument(
        "--cost-limit", type=float, default=3.0, help="Max cost per instance (USD)"
    )
    args = parser.parse_args()

    # Determine instance IDs
    if args.instance_ids:
        instance_ids = [x.strip() for x in args.instance_ids.split(",")]
    elif args.instances:
        from datasets import load_dataset

        ds = load_dataset("princeton-nlp/SWE-bench_Verified", split="test")
        instance_ids = [item["instance_id"] for item in ds][: args.instances]
    else:
        from datasets import load_dataset

        ds = load_dataset("princeton-nlp/SWE-bench_Verified", split="test")
        instance_ids = [item["instance_id"] for item in ds]

    # Determine config
    script_dir = Path(__file__).parent
    if args.config is None:
        args.config = str(
            script_dir
            / "configs"
            / ("gitnexus.yaml" if args.gitnexus else "baseline.yaml")
        )

    print(
        f"Running {len(instance_ids)} instances (gitnexus={'ON' if args.gitnexus else 'OFF'})"
    )

    # Run each instance
    results = []
    for iid in instance_ids:
        print(f"\n{'=' * 60}")
        print(f"Instance: {iid}")
        print(f"{'=' * 60}")
        try:
            agent = create_gitnexus_agent(
                model_name=args.model,
                config_path=args.config,
                gitnexus=args.gitnexus,
                repo_path=args.repo_path,
                step_limit=args.step_limit,
                cost_limit=args.cost_limit,
            )

            from datasets import load_dataset

            ds = load_dataset("princeton-nlp/SWE-bench_Verified", split="test")
            instance = None
            for item in ds:
                if item["instance_id"] == iid:
                    instance = item
                    break

            if instance is None:
                raise ValueError(f"Instance {iid} not found in SWE-bench Verified")

            task = instance.get("problem_statement", "")
            result = agent.run(task=task)

            # Normalize result to a dict
            if not isinstance(result, dict):
                result = {"raw_result": str(result)}
            result["instance_id"] = iid
            results.append(result)

            # Save trajectory
            output_path = Path(args.output_dir) / f"{iid}.json"
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_text(json.dumps(result, indent=2, default=str))

        except Exception as e:
            logger.exception(f"Error running instance {iid}")
            results.append({"instance_id": iid, "status": "error", "error": str(e)})

    # Summary
    print(f"\n{'=' * 60}")
    print(f"Results: {len(results)} instances")
    print(f"  OK: {sum(1 for r in results if r.get('status') != 'error')}")
    print(f"  Error: {sum(1 for r in results if r.get('status') == 'error')}")


if __name__ == "__main__":
    main()
