#!/usr/bin/env python3
"""Create a deterministic review report scaffold.

This script owns the report path, round increment, and markdown skeleton so
agents do not improvise artifact names or section layout.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path


ROUND_RE_TEMPLATE = r"^\d{{4}}-\d{{2}}-\d{{2}}-{name}-round-(\d+)\.md$"
REPORT_DIR = Path("docs") / "reviews"


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.strip().lower())
    slug = re.sub(r"-+", "-", slug).strip("-")
    if not slug:
        raise ValueError("review name slug is empty")
    return slug


def next_round(report_dir: Path, review_name: str) -> tuple[int, list[Path]]:
    pattern = re.compile(ROUND_RE_TEMPLATE.format(name=re.escape(review_name)))
    prior: list[tuple[int, Path]] = []
    if report_dir.exists():
        for path in report_dir.glob(f"*-{review_name}-round-*.md"):
            match = pattern.match(path.name)
            if match:
                prior.append((int(match.group(1)), path))
    prior.sort(key=lambda item: item[0])
    if not prior:
        return 1, []
    return prior[-1][0] + 1, [path for _, path in prior]


def markdown_template(
    *,
    date_slug: str,
    review_name: str,
    round_number: int,
    scope: str,
    brief_sha256: str,
    report_path: Path,
    prior_reports: list[Path],
) -> str:
    prior_lines = "\n".join(f"- {path.as_posix()}" for path in prior_reports) or "- none"
    return f"""# Review: {review_name} round {round_number}

Date: {date_slug}
Review name: {review_name}
Round: {round_number}
Scope: {scope}
Brief SHA-256: {brief_sha256}
Report path: {report_path.as_posix()}

## Prior round guard

Previous reports read:
{prior_lines}

## Findings

### F001 [P?] TODO short title

Severity: P? | Confidence: high/medium/low
Found by: TODO scout IDs
Source pointer: TODO file:line
Evidence:
- TODO file:line and observed behavior, or unknown
Contract violated:
- TODO expected behavior vs observed pattern
Plausible failure mode:
- TODO how it breaks, under what condition/input/timing
Durable solution hypothesis:
- TODO owner-clean long-term fix
Disconfirming check:
- TODO read-only check that would prove this false

## Verification queue

- F001: TODO read-only check

## Strongest reason not to merge yet

TODO

## Adjudication

| Finding | Claim restated | Check run and result | Verdict | Route |
|---|---|---|---|---|
| F001 | TODO | TODO | TODO true positive / false positive / unresolved | TODO |

Chains among rejected findings: TODO none found, or the combination and why it matters
"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", default=".", help="Repository/workspace root.")
    parser.add_argument("--review-name", required=True, help="Short review name, reused across rounds.")
    parser.add_argument("--scope", required=True, help="Brief review scope text.")
    parser.add_argument(
        "--review-brief-sha256",
        required=True,
        help="SHA256 of the review brief file, so later rounds can tell whether the brief changed.",
    )
    parser.add_argument("--scout-count", required=True, type=int)
    parser.add_argument("--directive-count", required=True, type=int)
    parser.add_argument(
        "--date",
        default=None,
        help="Override date in YYYY-MM-DD format. Defaults to local today.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print JSON metadata and template without writing the file.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    workspace = Path(args.workspace).resolve()
    if not workspace.exists():
        print(f"workspace does not exist: {workspace}", file=sys.stderr)
        return 2

    review_name = slugify(args.review_name)
    if not re.fullmatch(r"[0-9a-f]{64}", args.review_brief_sha256):
        print("--review-brief-sha256 must be 64 lowercase hexadecimal characters", file=sys.stderr)
        return 2
    if args.scout_count <= 0 or args.directive_count < 0:
        print("--scout-count must be positive and --directive-count non-negative", file=sys.stderr)
        return 2
    date_slug = args.date or dt.datetime.now().strftime("%Y-%m-%d")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date_slug):
        print("--date must use YYYY-MM-DD format", file=sys.stderr)
        return 2

    report_dir = workspace / REPORT_DIR
    round_number, prior_reports = next_round(report_dir, review_name)
    relative_report_path = REPORT_DIR / f"{date_slug}-{review_name}-round-{round_number}.md"
    report_path = workspace / relative_report_path

    if report_path.exists():
        print(f"refusing to overwrite existing report: {report_path}", file=sys.stderr)
        return 3

    relative_prior = [
        path.relative_to(workspace) if path.is_relative_to(workspace) else path
        for path in prior_reports
    ]
    content = markdown_template(
        date_slug=date_slug,
        review_name=review_name,
        round_number=round_number,
        scope=args.scope.strip(),
        brief_sha256=args.review_brief_sha256,
        report_path=relative_report_path,
        prior_reports=relative_prior,
    )

    metadata = {
        "review_name": review_name,
        "round": round_number,
        "report_path": relative_report_path.as_posix(),
        "prior_reports": [path.as_posix() for path in relative_prior],
        "review_brief_sha256": args.review_brief_sha256,
        "scout_count": args.scout_count,
        "directive_count": args.directive_count,
        "dry_run": bool(args.dry_run),
    }

    if not args.dry_run:
        report_dir.mkdir(parents=True, exist_ok=True)
        report_path.write_text(content, encoding="utf-8", newline="\n")

    print(json.dumps(metadata, indent=2))
    print("---BEGIN REVIEW REPORT TEMPLATE---")
    print(content, end="")
    print("---END REVIEW REPORT TEMPLATE---")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
