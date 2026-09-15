#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.strip().lower())
    slug = re.sub(r"-+", "-", slug).strip("-")
    if not slug:
        raise ValueError("review name slug is empty")
    return slug


def next_round(report_dir: Path, review_name: str) -> tuple[int, list[Path]]:
    pattern = re.compile(rf".*-{re.escape(review_name)}-round-(\d+)\.md$")
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


def read_json(path: str | None, flag: str) -> dict | None:
    if not path:
        return None
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SystemExit(f"{flag}: cannot read {path}: {error}")
    if not isinstance(data, dict):
        raise SystemExit(f"{flag}: {path} is not a JSON object")
    return data


def ledger(preview: dict | None) -> list[dict]:
    if preview is None:
        return []
    if "reviewable_files" in preview:
        rows = [{"path": entry["path"], "reason": None} for entry in preview.get("reviewable_files") or []]
        rows += [
            {"path": entry["path"], "reason": entry.get("exclude_reason") or "excluded"}
            for entry in preview.get("excluded_files") or []
        ]
        return rows
    return [
        {"path": entry["path"], "reason": None if entry.get("will_review") else entry.get("exclude_reason") or "excluded"}
        for entry in preview.get("files") or []
    ]


def units(rows: list[dict], rules: dict | None) -> list[dict]:
    reviewable = [row["path"] for row in rows if row["reason"] is None]
    found: list[dict] = []
    grouped: set[str] = set()
    for group in (rules or {}).get("groups") or []:
        files = [path for path in group.get("files") or [] if not rows or path in reviewable]
        if not files:
            continue
        grouped.update(files)
        found.append({
            "id": f"R{len(found) + 1}",
            "pattern": group.get("pattern") or "default",
            "files": files,
            "rule": (group.get("rule") or "").strip(),
        })
    loose = [path for path in reviewable if path not in grouped]
    if loose:
        found.append({"id": "R0", "pattern": "no rule resolved", "files": loose, "rule": ""})
    excluded = [row["path"] for row in rows if row["reason"] is not None]
    if excluded:
        found.append({"id": "X", "pattern": "excluded by the review tool's file-type filter", "files": excluded, "rule": ""})
    return found


def assign(unit_ids: list[str], directive_ids: list[str], scout_count: int, overlap: int, directive_overlap: int) -> list[dict]:
    scouts = [{"id": f"scout-{index:02d}", "units": [], "directives": []} for index in range(1, scout_count + 1)]
    cursor = 0
    for key, ids, width in (("units", unit_ids, overlap), ("directives", directive_ids, directive_overlap)):
        width = min(width, scout_count)
        for item in ids:
            for offset in range(width):
                scouts[(cursor + offset) % scout_count][key].append(item)
            cursor = (cursor + width) % scout_count
    pool_key, pool = ("units", unit_ids) if unit_ids else ("directives", directive_ids)
    for index, scout in enumerate(scouts):
        if pool and not scout["units"] and not scout["directives"]:
            scout[pool_key].append(pool[index % len(pool)])
    return scouts


def cell(text: str) -> str:
    return text.replace("|", "\\|")


def markdown(meta: dict, found: list[dict], rows: list[dict], scouts: list[dict]) -> str:
    holders: dict[str, list[str]] = {}
    for scout in scouts:
        for unit_id in scout["units"]:
            holders.setdefault(unit_id, []).append(scout["id"])
    reasons = {row["path"]: row["reason"] for row in rows}
    lines = [
        f"# Ultra Review: {meta['review_name']} Round {meta['round']}",
        "",
        f"Date: {meta['date']}",
        f"Review name: {meta['review_name']}",
        f"Round: {meta['round']}",
        f"Scope: {meta['scope']}",
        f"Review brief sha256: {meta['review_brief_sha256']}",
        f"Report path: {meta['report_path']}",
        "",
        "## Prior Round Guard",
        "",
        "Previous reports read:",
        "\n".join(f"- {path}" for path in meta["prior_reports"]) or "- none",
        "",
        "Warnings given to scouts: TODO, or none",
        "",
        "## Coverage",
        "",
    ]
    if found:
        lines += ["| File | Unit | Scouts | Status |", "|---|---|---|---|"]
        for unit in found:
            for path in unit["files"]:
                label = unit["id"] if reasons.get(path) is None else f"{unit['id']} ({reasons[path]})"
                scouts_text = ", ".join(holders.get(unit["id"], []))
                lines.append(f"| `{cell(path)}` | {label} | {scouts_text} | TODO reviewed, or skipped: reason |")
    else:
        lines.append("TODO every file in scope and its status: reviewed, or skipped with a reason.")
    lines += [
        "",
        "## Findings",
        "",
        "### F001 [P?] TODO short title",
        "",
        "Severity: P? | Confidence: TODO high, medium or low",
        "Where: TODO file:line",
        "Evidence: TODO",
        "Contract violated: TODO",
        "Plausible failure: TODO",
        "Durable fix hypothesis: TODO",
        "Disconfirming check: TODO read-only check",
        "",
        "## Verification Queue",
        "",
        "- F001: TODO read-only check",
        "",
        "## Strongest Reason Not To Merge Yet",
        "",
        "TODO",
        "",
        "## Rulings",
        "",
        "| Finding | Ruling | Brief or reason |",
        "|---|---|---|",
        "| F001 | TODO confirmed or rejected | TODO |",
    ]
    return "\n".join(lines) + "\n"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create an ultra-review round report with its coverage ledger and scout assignment."
    )
    parser.add_argument("--workspace", default=".", help="repository root")
    parser.add_argument("--report-dir", required=True, help="directory for round reports, outside the repository")
    parser.add_argument("--review-name", required=True, help="review name shared by every round")
    parser.add_argument("--scope", required=True, help="the scope, as the review brief states it")
    parser.add_argument("--review-brief-sha256", required=True, help="sha256 of the review brief")
    parser.add_argument("--scout-count", type=int, default=10)
    parser.add_argument("--directive-count", type=int, default=0, help="numbered directives D01.. in the brief")
    parser.add_argument("--overlap", type=int, default=2, help="scouts per unit")
    parser.add_argument("--directive-overlap", type=int, default=3, help="scouts per directive")
    parser.add_argument("--ocr-preview", help="JSON from ocr delegate preview or ocr scan --preview")
    parser.add_argument("--ocr-rules", help="JSON from ocr delegate rule")
    parser.add_argument("--date", default=None, help="yy-mm-dd; defaults to today")
    parser.add_argument("--dry-run", action="store_true", help="print the plan without writing the report")
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
    if args.scout_count <= 0 or args.directive_count < 0 or args.overlap <= 0 or args.directive_overlap <= 0:
        print("--scout-count, --overlap and --directive-overlap must be positive, --directive-count non-negative", file=sys.stderr)
        return 2
    date_slug = args.date or dt.datetime.now().strftime("%y-%m-%d")
    if not re.fullmatch(r"\d{2}-\d{2}-\d{2}", date_slug):
        print("--date must use yy-mm-dd format", file=sys.stderr)
        return 2

    report_dir = Path(args.report_dir).expanduser().resolve()
    round_number, prior_reports = next_round(report_dir, review_name)
    report_path = report_dir / f"{date_slug}-{review_name}-round-{round_number}.md"
    if report_path.exists():
        print(f"refusing to overwrite existing report: {report_path}", file=sys.stderr)
        return 3

    rows = ledger(read_json(args.ocr_preview, "--ocr-preview"))
    found = units(rows, read_json(args.ocr_rules, "--ocr-rules"))
    directives = [f"D{index:02d}" for index in range(1, args.directive_count + 1)]
    scouts = assign([unit["id"] for unit in found], directives, args.scout_count, args.overlap, args.directive_overlap)
    meta = {
        "review_name": review_name,
        "round": round_number,
        "date": date_slug,
        "scope": args.scope.strip(),
        "review_brief_sha256": args.review_brief_sha256,
        "report_path": report_path.as_posix(),
        "prior_reports": [
            (path.relative_to(workspace) if path.is_relative_to(workspace) else path).as_posix()
            for path in prior_reports
        ],
    }
    if not args.dry_run:
        report_dir.mkdir(parents=True, exist_ok=True)
        with report_path.open("w", encoding="utf-8", newline="\n") as handle:
            handle.write(markdown(meta, found, rows, scouts))
    print(json.dumps({**meta, "dry_run": bool(args.dry_run), "units": found, "scouts": scouts}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
