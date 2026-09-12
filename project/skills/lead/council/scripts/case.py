#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

FIELDS = [
    "CASE_ID",
    "ORIGINAL REQUEST",
    "DECISION QUESTION",
    "OBSERVABLE OUTCOME",
    "AUTHORITATIVE FACTS",
    "DIRECT OBSERVATIONS",
    "UNVERIFIED CLAIMS",
    "UNKNOWNS",
    "HARD CONSTRAINTS",
    "PREFERENCES / PRIORITY ORDER",
    "AUTHORIZED SCOPE AND SOURCES",
    "SNAPSHOT",
    "REQUESTED OUTPUT",
    "CASE OUTPUT CONTRACT",
]


def state_dir() -> Path:
    return Path(os.environ.get("TMPDIR", "/tmp"))


def state_file(case_id: str) -> Path:
    return state_dir() / f"council-{case_id}.json"


def git(args: list[str], root: str) -> str:
    result = subprocess.run(
        ["git", "-C", root] + args,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        sys.exit(f"git {' '.join(args)} failed: {result.stderr.strip()}")
    return result.stdout


def cmd_brief(args: argparse.Namespace) -> None:
    for field in FIELDS:
        if field == "CASE_ID":
            print(f"{field}: {args.case_id}")
        else:
            print(f"{field}:")


def cmd_snapshot(args: argparse.Namespace) -> None:
    head = git(["rev-parse", "HEAD"], args.root).strip()
    record = {"case_id": args.case_id, "head": head, "paths": args.path}
    if args.path:
        diff = git(["diff", "--"] + args.path, args.root)
        if diff.strip():
            patch = state_dir() / f"council-{args.case_id}.patch"
            patch.write_text(diff, encoding="utf-8")
            record["patch"] = str(patch)
            record["stat"] = git(["diff", "--stat", "--"] + args.path, args.root)
    state_file(args.case_id).write_text(json.dumps(record, indent=2), encoding="utf-8")
    print(f"SNAPSHOT: {head}")
    if record.get("patch"):
        print(f"uncommitted changes preserved at {record['patch']}")
    print(f"state: {state_file(args.case_id)}")


def cmd_verify(args: argparse.Namespace) -> None:
    path = state_file(args.case_id)
    if not path.exists():
        sys.exit(f"no snapshot recorded for {args.case_id}; run snapshot first")
    record = json.loads(path.read_text(encoding="utf-8"))
    head = git(["rev-parse", "HEAD"], args.root).strip()
    problems = []
    if head != record["head"]:
        problems.append(f"HEAD moved: {record['head']} -> {head}")
    if record.get("paths"):
        stat = git(["diff", "--stat", "--"] + record["paths"], args.root)
        if stat != record.get("stat", ""):
            problems.append("authorized paths changed since the snapshot:")
            problems.append(f"  recorded: {record.get('stat', '').strip() or 'clean'}")
            problems.append(f"  current:  {stat.strip() or 'clean'}")
    if problems:
        print("SNAPSHOT MISMATCH")
        for line in problems:
            print(line)
        sys.exit(1)
    print(f"SNAPSHOT OK: {head}")


def cmd_position(args: argparse.Namespace) -> None:
    target = state_dir() / f"council-{args.case_id}-lead.md"
    target.write_text(sys.stdin.read(), encoding="utf-8")
    print(target)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Council case scaffolding: brief skeleton, snapshot, drift check, position file."
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("brief", help="print the neutral-brief field skeleton")
    p.add_argument("case_id")
    p.set_defaults(func=cmd_brief)

    p = sub.add_parser("snapshot", help="record HEAD and preserve uncommitted authorized paths")
    p.add_argument("case_id")
    p.add_argument("--root", default=".", help="repository root")
    p.add_argument("--path", action="append", default=[], help="authorized path; repeat per path")
    p.set_defaults(func=cmd_snapshot)

    p = sub.add_parser("verify", help="compare the working tree against the recorded snapshot")
    p.add_argument("case_id")
    p.add_argument("--root", default=".", help="repository root")
    p.set_defaults(func=cmd_verify)

    p = sub.add_parser("position", help="write the Lead position file from stdin, outside the repository")
    p.add_argument("case_id")
    p.set_defaults(func=cmd_position)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
