#!/usr/bin/env python3
from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_EXCLUDES = [
    ".git/**", ".hg/**", ".svn/**", ".idea/**", ".vscode/**", "**/target/**", "**/build/**", "**/dist/**",
    "**/out/**", "**/.next/**", "**/.nuxt/**", "**/node_modules/**", "**/.gradle/**", "**/DerivedData/**",
    "**/.build/**", "**/Pods/**", "**/Carthage/**", "*.png", "*.jpg", "*.jpeg", "*.gif", "*.webp", "*.ico",
    "*.pdf", "*.zip", "*.7z", "*.tar", "*.gz", "*.exe", "*.dll", "*.dylib", "*.so", "*.bin",
]

TEST_EXCLUDES = [
    "tests/**", "test/**", "**/tests/**", "**/test/**", "**/tests.rs", "**/*tests.rs", "**/__tests__/**",
    "**/fixtures/**", "**/fixture/**", "**/snapshots/**", "**/*.snap", "**/*_test.go", "**/*_test.py",
    "**/test_*.py", "**/*.test.*", "**/*.spec.*", "**/*Tests/**", "**/*UITests/**", "**/*Test.swift",
]

LANGUAGES = {
    ".c": "c", ".cc": "cpp", ".cpp": "cpp", ".cs": "csharp", ".css": "css", ".fish": "fish", ".go": "go",
    ".h": "c", ".hpp": "cpp", ".html": "html", ".java": "java", ".js": "javascript", ".json": "json",
    ".jsx": "jsx", ".kt": "kotlin", ".md": "markdown", ".proto": "proto", ".py": "python", ".rb": "ruby",
    ".rs": "rust", ".scss": "scss", ".sh": "bash", ".sql": "sql", ".swift": "swift", ".toml": "toml",
    ".ts": "typescript", ".tsx": "tsx", ".vue": "vue", ".xml": "xml", ".yaml": "yaml", ".yml": "yaml",
}

PROMPT = """You are an independent reviewer of the attached pack. Treat its files as current source truth and anything outside it as unavailable: ask for exact files or line ranges rather than guess.

Read the manifest and the file headings first, then the diff if there is one, then the files you need. Read large files in focused line ranges and cite only lines you read. Where tests were left out, say which test context is missing instead of assuming it.

Falsify both local correctness and the macro architecture against the governing documents in the pack and the owner boundaries they set. Report issues that pass locally but weaken the long-lived design, and treat any prior findings you are given as hints, not as the scope.

Report findings first, most severe first, each with severity P0-P3, file:line, the failure path, the rule or contract it breaks, and an owner-clean long-term fix direction rather than the least painful patch. Keep requests for missing context apart from findings. With no findings, say so and name the residual risks.
"""


@dataclass(frozen=True)
class PackFile:
    rel: str
    data: bytes
    stripped_tests: bool

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.data).hexdigest()


def rel_path(path: str | Path) -> str:
    text = Path(path).as_posix()
    while text.startswith("./"):
        text = text[2:]
    return "" if text == "." else text


def git(root: Path, *args: str) -> str:
    try:
        result = subprocess.run(["git", *args], cwd=root, text=True, capture_output=True, check=False)
    except FileNotFoundError:
        return ""
    return result.stdout if result.returncode == 0 else ""


def matches(rel: str, patterns: list[str]) -> bool:
    for pattern in patterns:
        pattern = rel_path(pattern)
        if fnmatch.fnmatch(rel, pattern) or fnmatch.fnmatch(rel, pattern.removeprefix("**/")):
            return True
        if pattern.endswith("/**") and (rel + "/").startswith(pattern[:-2].removeprefix("**/")):
            return True
    return False


def candidates(root: Path) -> list[str]:
    listed = git(root, "ls-files", "-co", "--exclude-standard")
    if listed:
        return sorted({rel_path(line) for line in listed.splitlines() if line.strip()})
    found: list[str] = []
    for current, dirs, names in os.walk(root):
        dirs[:] = [name for name in dirs if not name.startswith(".git")]
        found.extend(rel_path(Path(current, name).relative_to(root)) for name in names)
    return sorted(found)


def wanted(rel: str, specs: list[str]) -> bool:
    for spec in specs:
        spec = rel_path(spec)
        if rel == spec or (spec and rel.startswith(spec.rstrip("/") + "/")) or fnmatch.fnmatch(rel, spec):
            return True
    return False


def strip_rust_cfg_test(text: str) -> tuple[str, bool]:
    lines = text.splitlines(keepends=True)
    out: list[str] = []
    stripped = False
    index = 0
    while index < len(lines):
        if not lines[index].lstrip().startswith("#[cfg(test)]"):
            out.append(lines[index])
            index += 1
            continue
        start = index
        index += 1
        depth = 0
        opened = False
        while index < len(lines):
            line = lines[index]
            depth += line.count("{") - line.count("}")
            opened = opened or "{" in line
            index += 1
            if (opened and depth <= 0) or (not opened and line.rstrip().endswith(";")):
                break
        out.append(f"// cfg(test) block removed from lines {start + 1}-{index}\n")
        stripped = True
    return "".join(out), stripped


def load_json(path: str, flag: str) -> dict:
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SystemExit(f"{flag}: cannot read {path}: {error}")
    if not isinstance(data, dict):
        raise SystemExit(f"{flag}: {path} is not a JSON object")
    return data


def ocr_inputs(args: argparse.Namespace) -> tuple[list[str], list[str], dict]:
    paths: list[str] = []
    target: dict = {}
    if args.ocr_preview:
        preview = load_json(args.ocr_preview, "--ocr-preview")
        if "reviewable_files" in preview:
            paths = [entry["path"] for entry in preview.get("reviewable_files") or []]
            target = {key: preview.get(key) for key in ("mode", "commit", "from", "to", "merge_base") if preview.get(key)}
        else:
            paths = [entry["path"] for entry in preview.get("files") or [] if entry.get("will_review")]
    questions = list(args.question)
    if args.ocr_rules:
        for group in load_json(args.ocr_rules, "--ocr-rules").get("groups") or []:
            rule = (group.get("rule") or "").strip()
            if rule:
                questions.append(f"Rule for {group.get('pattern') or 'default'} ({', '.join(group.get('files') or [])}): {rule}")
    return paths, questions, target


def select(args: argparse.Namespace, root: Path, specs: list[str]) -> tuple[list[PackFile], list[tuple[str, str]], list[str]]:
    excludes = [*DEFAULT_EXCLUDES, *args.exclude, *(TEST_EXCLUDES if args.exclude_tests else [])]
    listed = candidates(root)
    missing = [spec for spec in specs if not any(wanted(rel, [spec]) for rel in listed)]
    files: list[PackFile] = []
    skipped: list[tuple[str, str]] = []
    total = 0
    for rel in listed:
        path = root / rel
        if not wanted(rel, specs) or not path.is_file():
            continue
        if matches(rel, excludes):
            skipped.append((rel, "excluded"))
            continue
        data = path.read_bytes().removeprefix(b"\xef\xbb\xbf")
        if b"\0" in data[:4096]:
            skipped.append((rel, "binary"))
            continue
        if len(data) > args.max_file_bytes:
            skipped.append((rel, f"over --max-file-bytes ({len(data)})"))
            continue
        stripped = False
        if args.exclude_tests and rel.endswith(".rs"):
            text, stripped = strip_rust_cfg_test(data.decode("utf-8", errors="replace"))
            data = text.encode("utf-8")
        if total + len(data) > args.max_bytes:
            skipped.append((rel, "over --max-bytes"))
            continue
        files.append(PackFile(rel, data, stripped))
        total += len(data)
    return files, skipped, missing


def diff_text(root: Path, target: dict, paths: list[str]) -> str:
    if not paths:
        return ""
    if target.get("mode") == "commit" and target.get("commit"):
        return git(root, "show", "--format=", target["commit"], "--", *paths)
    if target.get("mode") == "range" and target.get("to"):
        return git(root, "diff", target.get("merge_base") or target.get("from") or "", target["to"], "--", *paths)
    if target.get("mode") == "workspace":
        return git(root, "diff", "HEAD", "--", *paths)
    return ""


def fence(text: str) -> str:
    longest = current = 0
    for char in text:
        current = current + 1 if char == "`" else 0
        longest = max(longest, current)
    return "`" * max(3, longest + 1)


def prompt_text(args: argparse.Namespace, questions: list[str]) -> str:
    text = PROMPT
    if args.task:
        text += f"\nTask:\n{args.task}\n"
    if questions:
        text += "\nQuestions to answer, one by one:\n" + "".join(f"{index}. {item}\n" for index, item in enumerate(questions, 1))
    return text


def manifest_text(root: Path, args: argparse.Namespace, files: list[PackFile], skipped: list[tuple[str, str]], missing: list[str], target: dict) -> str:
    size = sum(len(item.data) for item in files)
    lines = [
        "# Manifest",
        "",
        f"- Generated UTC: `{datetime.now(timezone.utc).isoformat(timespec='seconds')}`",
        f"- Repository: `{root.name}`",
        f"- Git HEAD: `{git(root, 'rev-parse', 'HEAD').strip() or 'unknown'}`",
        f"- Git branch: `{git(root, 'branch', '--show-current').strip() or 'detached'}`",
        f"- Review target: `{json.dumps(target) if target else 'files as they are in the working tree'}`",
        f"- Tests left out: `{args.exclude_tests}`",
        f"- Files: `{len(files)}`, source bytes `{size}`, token estimate `{size // 4}`",
        "",
        "## Included files",
        "",
        *[f"- `{item.rel}` `{item.sha256[:12]}` {len(item.data)} bytes{' cfg(test) removed' if item.stripped_tests else ''}" for item in files],
    ]
    if missing:
        lines += ["", "## Requested but not found", "", *[f"- `{spec}`" for spec in missing]]
    if skipped:
        lines += ["", "## Skipped files", "", *[f"- `{rel}`: {reason}" for rel, reason in skipped[:500]]]
        if len(skipped) > 500:
            lines.append(f"- {len(skipped) - 500} more")
    status = git(root, "status", "--short").strip()
    return "\n".join([*lines, "", "## Git status", "", "```text", status or "clean", "```", ""])


def markdown_pack(root: Path, args: argparse.Namespace, files: list[PackFile], skipped, missing, target: dict, questions: list[str], diff: str) -> str:
    parts = ["# Review Pack", "", manifest_text(root, args, files, skipped, missing, target), "## Reviewer Prompt", "", prompt_text(args, questions), ""]
    if diff:
        mark = fence(diff)
        parts += ["## Diff", "", f"{mark}diff", diff.rstrip(), mark, ""]
    parts += ["## Source Files", ""]
    for item in files:
        text = item.data.decode("utf-8", errors="replace")
        mark = fence(text)
        parts += [f"### File: `{item.rel}`", "", f"{mark}{LANGUAGES.get(Path(item.rel).suffix.lower(), '')}", text.rstrip(), mark, ""]
    return "\n".join(parts)


def write_snapshot(root: Path, args: argparse.Namespace, files: list[PackFile], skipped, missing, target: dict, out: Path) -> None:
    stage_parent = Path(tempfile.mkdtemp(prefix="review-snapshot-"))
    stage = stage_parent / "pack"
    try:
        for item in files:
            destination = stage / "repo" / item.rel
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(item.data)
        stage.mkdir(parents=True, exist_ok=True)
        (stage / "MANIFEST.md").write_text(manifest_text(root, args, files, skipped, missing, target), encoding="utf-8")
        (stage / "SOURCE_TREE.txt").write_text("".join(f"{item.rel}\t{len(item.data)}\t{item.sha256}\n" for item in files), encoding="utf-8")
        if args.format == "dir":
            if out.exists():
                raise SystemExit(f"output directory already exists: {out}")
            shutil.copytree(stage, out)
            return
        out.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(stage.rglob("*")):
                if path.is_file():
                    archive.write(path, path.relative_to(stage).as_posix())
    finally:
        shutil.rmtree(stage_parent, ignore_errors=True)


def create(args: argparse.Namespace) -> int:
    root = Path(args.root).resolve()
    if not root.is_dir():
        raise SystemExit(f"root does not exist: {root}")
    ocr_paths, questions, target = ocr_inputs(args)
    specs = list(dict.fromkeys([*ocr_paths, *args.focus, *args.include]))
    if not specs:
        raise SystemExit("name what to pack: --ocr-preview, --focus or --include")
    files, skipped, missing = select(args, root, specs)
    packed = {item.rel for item in files}
    out = Path(args.out).resolve()
    prompt_path = None if args.format == "md" else out.parent / f"{out.stem if args.format == 'zip' else out.name}.prompt.md"
    summary = {
        "dry_run": args.dry_run,
        "out": str(out),
        "prompt": str(prompt_path) if prompt_path else None,
        "format": args.format,
        "file_count": len(files),
        "source_bytes": sum(len(item.data) for item in files),
        "estimated_tokens": sum(len(item.data) for item in files) // 4,
        "files": [item.rel for item in files[:80]],
        "questions": len(questions),
        "skipped": len(skipped),
        "missing": missing,
    }
    if not args.dry_run:
        if args.format == "md":
            diff = diff_text(root, target, [path for path in ocr_paths if path in packed])
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(markdown_pack(root, args, files, skipped, missing, target, questions, diff), encoding="utf-8")
        else:
            write_snapshot(root, args, files, skipped, missing, target, out)
            prompt_path.write_text(prompt_text(args, questions), encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="review_pack.py", description="Pack source files for a reviewer outside the project.")
    commands = parser.add_subparsers(dest="command")
    command = commands.add_parser("create", help="build a Markdown pack, or a zip or directory source snapshot")
    command.add_argument("--root", default=".", help="repository root")
    command.add_argument("--ocr-preview", help="JSON from ocr delegate preview or ocr scan --preview; its reviewable files are packed, with the change's diff in a Markdown pack")
    command.add_argument("--ocr-rules", help="JSON from ocr delegate rule; each rule group becomes a reviewer question")
    command.add_argument("--focus", action="append", default=[], help="file, directory or glob to pack; can repeat")
    command.add_argument("--include", action="append", default=[], help="governing document to pack; can repeat")
    command.add_argument("--exclude", action="append", default=[], help="glob to leave out; can repeat")
    command.add_argument("--exclude-tests", action="store_true", help="leave out test files and Rust cfg(test) blocks")
    command.add_argument("--task", help="the review brief, placed in the reviewer prompt")
    command.add_argument("--question", action="append", default=[], help="a reviewer question; can repeat")
    command.add_argument("--format", choices=["md", "zip", "dir"], default="md", help="md is one file with prompt and diff; zip and dir are a source snapshot with the prompt written beside it")
    command.add_argument("--out", required=True, help="output path, outside the repository")
    command.add_argument("--max-bytes", type=int, default=5_000_000, help="total source byte budget")
    command.add_argument("--max-file-bytes", type=int, default=300_000, help="per-file byte budget")
    command.add_argument("--dry-run", action="store_true", help="print the selection without writing")
    command.set_defaults(func=create)
    return parser


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] not in {"create", "-h", "--help"}:
        argv.insert(0, "create")
    parser = build_parser()
    args = parser.parse_args(argv)
    if not hasattr(args, "func"):
        parser.print_help()
        return 2
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
