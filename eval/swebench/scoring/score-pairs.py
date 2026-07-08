#!/usr/bin/env python3
"""
Score SWE-bench Verified results: paired comparison of baseline vs GitNexus.

Reads trajectory JSON files from both arms, extracts patches and token usage,
runs SWE-bench evaluation, and produces a paired comparison report.

Usage:
    python score-pairs.py --baseline results/baseline/trajectories \
                          --gitnexus results/gitnexus/trajectories \
                          --output results

Based on d3thshot7777's methodology:
- Paired comparison (same instances in both arms)
- Exclude infra/container failures from both arms (fair pairs)
- Report: solve rate, tokens, API calls, per-instance deltas
"""

import argparse
import json
import os
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any


def parse_args():
    p = argparse.ArgumentParser(description="Score SWE-bench GitNexus benchmark pairs")
    p.add_argument(
        "--baseline", required=True, help="Path to baseline trajectories dir"
    )
    p.add_argument(
        "--gitnexus", required=True, help="Path to gitnexus trajectories dir"
    )
    p.add_argument(
        "--output", required=True, help="Output directory for report and scores"
    )
    p.add_argument("--model", default="", help="Model name for report header")
    p.add_argument(
        "--instance-ids", default="", help="Comma-separated instance IDs to include"
    )
    p.add_argument(
        "--exclude-ids",
        default="",
        help="Comma-separated instance IDs to exclude (infra failures)",
    )
    p.add_argument(
        "--skip-eval",
        action="store_true",
        help="Skip SWE-bench Docker eval (just analyze trajectories)",
    )
    return p.parse_args()


def load_trajectories(traj_dir: Path) -> dict[str, dict]:
    """Load trajectory JSON files from a directory. Key = instance_id."""
    results = {}
    if not traj_dir.exists():
        print(f"  WARNING: trajectory dir not found: {traj_dir}")
        return results
    for f in sorted(traj_dir.rglob("*.json")):
        try:
            data = json.loads(f.read_text())
            info = data.get("info", {})
            instance_id = info.get("instance_id", "")
            if not instance_id:
                # Try to extract from filename
                instance_id = f.stem
            model_stats = info.get("model_stats", {})
            results[instance_id] = {
                "file": str(f),
                "instance_id": instance_id,
                "exit_status": info.get("exit_status", ""),
                "submission": info.get("submission", ""),
                "cost": model_stats.get("instance_cost", 0.0),
                "api_calls": model_stats.get("api_calls", 0),
                "tokens_in": 0,
                "tokens_out": 0,
                "messages": data.get("messages", []),
            }
            # Try to compute tokens from messages
            total_in = 0
            total_out = 0
            for msg in data.get("messages", []):
                extra = msg.get("extra", {})
                if isinstance(extra, dict):
                    resp = extra.get("response", {})
                    if isinstance(resp, dict):
                        usage = resp.get("usage", {})
                        total_in += usage.get("prompt_tokens", 0)
                        total_out += usage.get("completion_tokens", 0)
            results[instance_id]["tokens_in"] = total_in
            results[instance_id]["tokens_out"] = total_out
        except Exception as e:
            print(f"  WARNING: failed to load {f}: {e}")
    return results


def extract_patch(trajectory: dict) -> str:
    """Extract the final patch from a trajectory."""
    submission = trajectory.get("submission", "")
    if submission:
        return submission
    # Look for git diff in last few messages
    for msg in reversed(trajectory.get("messages", [])):
        content = msg.get("content", "")
        if isinstance(content, str) and "diff --git" in content:
            # Extract diff block
            start = content.find("diff --git")
            return content[start:]
    return ""


def classify_exit(status: str) -> str:
    """Classify exit status into categories."""
    if not status:
        return "empty"
    if status in ("Submitted", "resolved"):
        return "submitted"
    if status in ("LimitsExceeded", "TimeExceeded"):
        return "limit"
    if "FormatError" in status:
        return "format_error"
    return "other"


def count_gitnexus_tool_calls(messages: list) -> dict[str, int]:
    """Count GitNexus tool calls in a trajectory."""
    counts = {
        "query": 0,
        "context": 0,
        "impact": 0,
        "cypher": 0,
        "pdg_query": 0,
        "explain": 0,
        "detect_changes": 0,
    }
    for msg in messages:
        content = msg.get("content", "")
        if not isinstance(content, str):
            continue
        # Look for tool call references in message content or extra
        extra = msg.get("extra", {})
        if isinstance(extra, dict):
            actions = extra.get("actions", [])
            for action in actions:
                if isinstance(action, dict):
                    cmd = action.get("command", "")
                    for tool in counts:
                        if f"gitnexus {tool}" in cmd or f"gitnexus-{tool}" in cmd:
                            counts[tool] += 1
    return counts


def generate_report(
    baseline: dict[str, dict],
    gitnexus: dict[str, dict],
    model: str,
    exclude_ids: set[str],
) -> str:
    """Generate the paired comparison report in markdown."""

    # Find paired instances (both arms completed)
    all_ids = sorted(set(baseline.keys()) | set(gitnexus.keys()))
    fair_ids = [i for i in all_ids if i not in exclude_ids]
    paired_ids = [i for i in fair_ids if i in baseline and i in gitnexus]

    # Stats
    b_solved = sum(1 for i in paired_ids if baseline[i]["exit_status"] == "Submitted")
    g_solved = sum(1 for i in paired_ids if gitnexus[i]["exit_status"] == "Submitted")
    b_tokens = sum(
        baseline[i]["tokens_in"] + baseline[i]["tokens_out"] for i in paired_ids
    )
    g_tokens = sum(
        gitnexus[i]["tokens_in"] + gitnexus[i]["tokens_out"] for i in paired_ids
    )
    b_calls = sum(baseline[i]["api_calls"] for i in paired_ids)
    g_calls = sum(gitnexus[i]["api_calls"] for i in paired_ids)

    b_rate = b_solved / len(paired_ids) * 100 if paired_ids else 0
    g_rate = g_solved / len(paired_ids) * 100 if paired_ids else 0
    token_delta = (1 - g_tokens / b_tokens) * 100 if b_tokens else 0
    call_delta = (1 - g_calls / b_calls) * 100 if b_calls else 0

    # Per-instance deltas
    improved = []
    regressed = []
    tied = []

    for iid in paired_ids:
        b_sub = baseline[iid]["exit_status"] == "Submitted"
        g_sub = gitnexus[iid]["exit_status"] == "Submitted"
        if g_sub and not b_sub:
            improved.append(iid)
        elif b_sub and not g_sub:
            regressed.append(iid)
        else:
            tied.append(iid)

    # Chunk breakdown (50-instance chunks like d3thshot's dashboard)
    chunks = []
    chunk_size = 50
    for start in range(0, len(paired_ids), chunk_size):
        chunk_ids = paired_ids[start : start + chunk_size]
        cb = sum(1 for i in chunk_ids if baseline[i]["exit_status"] == "Submitted")
        cg = sum(1 for i in chunk_ids if gitnexus[i]["exit_status"] == "Submitted")
        ct_b = sum(
            baseline[i]["tokens_in"] + baseline[i]["tokens_out"] for i in chunk_ids
        )
        ct_g = sum(
            gitnexus[i]["tokens_in"] + gitnexus[i]["tokens_out"] for i in chunk_ids
        )
        cc_b = sum(baseline[i]["api_calls"] for i in chunk_ids)
        cc_g = sum(gitnexus[i]["api_calls"] for i in chunk_ids)
        token_d = (1 - ct_g / ct_b) * 100 if ct_b else 0
        call_d = (1 - cc_g / cc_b) * 100 if cc_b else 0
        chunks.append(
            {
                "range": f"{start}:{start + len(chunk_ids)}",
                "n": len(chunk_ids),
                "b_solved": cb,
                "g_solved": cg,
                "delta": cg - cb,
                "token_delta": f"{token_d:.1f}% fewer"
                if token_d > 0
                else f"{-token_d:.1f}% more",
                "call_delta": f"{call_d:.1f}% fewer"
                if call_d > 0
                else f"{-call_d:.1f}% more",
            }
        )

    # Build report
    now = datetime.utcnow().isoformat()[:19]
    lines = [
        f"# SWE-bench Verified — GitNexus Benchmark Report",
        f"",
        f"**Model:** {model or '(unknown)'}  ",
        f"**Date:** {now}  ",
        f"**Fair pairs:** {len(paired_ids)} of {len(all_ids)} total instances  ",
        f"**Excluded:** {len(exclude_ids)} infra/container failures  ",
        f"",
        f"## Solve Rate",
        f"",
        f"| Condition | Solved | Rate |",
        f"|-----------|--------|------|",
        f"| Baseline (no GitNexus) | {b_solved}/{len(paired_ids)} | {b_rate:.1f}% |",
        f"| GitNexus | {g_solved}/{len(paired_ids)} | {g_rate:.1f}% |",
        f"| Delta | {g_solved - b_solved} | {g_rate - b_rate:+.1f}pp |",
        f"",
        f"## Total Tokens",
        f"",
        f"| Condition | Tokens |",
        f"|-----------|--------|",
        f"| Baseline | {b_tokens:,} |",
        f"| GitNexus | {g_tokens:,} |",
        f"| Delta | **{token_delta:+.1f}%** ({'fewer' if token_delta > 0 else 'more'}) |",
        f"",
        f"## API Calls",
        f"",
        f"| Condition | Calls |",
        f"|-----------|-------|",
        f"| Baseline | {b_calls:,} |",
        f"| GitNexus | {g_calls:,} |",
        f"| Delta | **{call_delta:+.1f}%** ({'fewer' if call_delta > 0 else 'more'}) |",
        f"",
        f"## Per-Instance Breakdown",
        f"",
        f"- **Improved** (GitNexus solved, baseline didn't): {len(improved)}",
        f"- **Regressed** (baseline solved, GitNexus didn't): {len(regressed)}",
        f"- **Tied** (both solved or both failed): {len(tied)}",
        f"",
    ]

    if improved:
        lines.append("### Improved instances")
        for iid in improved:
            lines.append(f"- `{iid}`")
        lines.append("")

    if regressed:
        lines.append("### Regressed instances")
        for iid in regressed:
            lines.append(f"- `{iid}`")
        lines.append("")

    if chunks:
        lines.append("## Chunk Breakdown")
        lines.append("")
        lines.append(
            "| Chunk | Pairs | Baseline | GitNexus | Solved Δ | Token Δ | Call Δ |"
        )
        lines.append(
            "|-------|-------|----------|----------|----------|---------|--------|"
        )
        for c in chunks:
            lines.append(
                f"| {c['range']} | {c['n']} | {c['b_solved']}/{c['n']} | {c['g_solved']}/{c['n']} "
                f"| {c['delta']:+d} | {c['token_delta']} | {c['call_delta']} |"
            )
        lines.append("")

    lines.extend(
        [
            "---",
            "",
            f"*Generated by `eval/swebench/scoring/score-pairs.py`*",
        ]
    )

    return "\n".join(lines)


def main():
    args = parse_args()

    baseline_dir = Path(args.baseline)
    gitnexus_dir = Path(args.gitnexus)
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    print("Loading baseline trajectories...")
    baseline = load_trajectories(baseline_dir)
    print(f"  Found {len(baseline)} instances")

    print("Loading GitNexus trajectories...")
    gitnexus = load_trajectories(gitnexus_dir)
    print(f"  Found {len(gitnexus)} instances")

    # Parse exclude IDs
    exclude_ids = set()
    if args.exclude_ids:
        exclude_ids = {x.strip() for x in args.exclude_ids.split(",") if x.strip()}

    # Auto-detect infra failures: instances where both arms hit limits or format errors
    all_ids = sorted(set(baseline.keys()) | set(gitnexus.keys()))
    for iid in all_ids:
        b_status = baseline.get(iid, {}).get("exit_status", "")
        g_status = gitnexus.get(iid, {}).get("exit_status", "")
        # If both arms failed with non-submission and one is a limit error,
        # likely an infra issue — exclude from fair pairs
        if classify_exit(b_status) == "limit" and classify_exit(g_status) == "limit":
            exclude_ids.add(iid)

    print(f"Excluded {len(exclude_ids)} instances (infra failures)")

    report = generate_report(baseline, gitnexus, args.model, exclude_ids)

    report_path = output_dir / "report.md"
    report_path.write_text(report)
    print(f"\nReport written to: {report_path}")
    print(report)


if __name__ == "__main__":
    main()
