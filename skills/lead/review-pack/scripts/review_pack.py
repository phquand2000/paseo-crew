#!/usr/bin/env python3
"""Create focused source-review artifacts for external agent or human review."""

from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import textwrap
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


DEFAULT_EXCLUDES = [
    ".git/**",
    ".hg/**",
    ".svn/**",
    ".idea/**",
    ".vscode/**",
    "target/**",
    "build/**",
    "dist/**",
    "out/**",
    ".next/**",
    ".nuxt/**",
    "node_modules/**",
    ".gradle/**",
    "DerivedData/**",
    ".build/**",
    "Pods/**",
    "Carthage/**",
    "reports/review-packs/**",
    "reports/runs/**",
    "*.png",
    "*.jpg",
    "*.jpeg",
    "*.gif",
    "*.webp",
    "*.ico",
    "*.pdf",
    "*.zip",
    "*.7z",
    "*.tar",
    "*.gz",
    "*.exe",
    "*.dll",
    "*.dylib",
    "*.so",
    "*.bin",
]

TEST_EXCLUDES = [
    "tests/**",
    "test/**",
    "**/tests/**",
    "**/test/**",
    "**/tests.rs",
    "**/*tests.rs",
    "**/__tests__/**",
    "**/fixtures/**",
    "**/fixture/**",
    "**/snapshots/**",
    "**/*.snap",
    "**/*_test.go",
    "**/*.test.ts",
    "**/*.test.tsx",
    "**/*.spec.ts",
    "**/*.spec.tsx",
    "**/*.test.js",
    "**/*.spec.js",
    "**/*.test.vue",
    "**/*.spec.vue",
    "**/*Tests/**",
    "**/*UITests/**",
    "**/*Test.swift",
]

PROFILE_INCLUDES = {
    "rust": [
        "Cargo.toml",
        "Cargo.lock",
        "rust-toolchain",
        "rust-toolchain.toml",
        ".cargo/config.toml",
        ".cargo/config",
        "**/*.rs",
        "**/*.toml",
        "**/*.md",
    ],
    "go": [
        "go.mod",
        "go.sum",
        "go.work",
        "go.work.sum",
        "**/*.go",
        "**/*.mod",
        "**/*.sum",
        "**/*.md",
    ],
    "vue": [
        "package.json",
        "package-lock.json",
        "pnpm-lock.yaml",
        "yarn.lock",
        "vite.config.*",
        "vue.config.*",
        "tsconfig*.json",
        "**/*.vue",
        "**/*.ts",
        "**/*.tsx",
        "**/*.js",
        "**/*.jsx",
        "**/*.json",
        "**/*.css",
        "**/*.scss",
        "**/*.md",
    ],
    "swift-ios": [
        "Package.swift",
        "*.xcodeproj/**",
        "*.xcworkspace/**",
        "**/*.swift",
        "**/*.h",
        "**/*.m",
        "**/*.mm",
        "**/*.plist",
        "**/*.storyboard",
        "**/*.xib",
        "**/*.xcconfig",
        "**/*.md",
    ],
    "changed-files": ["**/*"],
    "generic": ["**/*"],
}

PROFILE_EXCLUDES = {
    "rust": ["**/target/**"],
    "go": ["**/vendor/**", "**/bin/**"],
    "vue": ["**/node_modules/**", "**/coverage/**", "**/.vite/**"],
    "swift-ios": ["**/DerivedData/**", "**/.build/**", "**/Pods/**", "**/Carthage/**"],
    "changed-files": [],
    "generic": [],
}

TEXT_EXTENSIONS = {
    ".c",
    ".cc",
    ".cfg",
    ".conf",
    ".cpp",
    ".css",
    ".go",
    ".h",
    ".hpp",
    ".html",
    ".js",
    ".json",
    ".jsx",
    ".kt",
    ".lock",
    ".m",
    ".md",
    ".mm",
    ".plist",
    ".proto",
    ".py",
    ".rs",
    ".scss",
    ".sh",
    ".swift",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".vue",
    ".xib",
    ".xml",
    ".yaml",
    ".yml",
}

REVIEW_KIND_GUIDANCE = {
    "general": [
        "Correctness bugs and behavioral regressions.",
        "Architecture or ownership drift.",
        "Performance risks in hot paths.",
        "Missing contract tests and unclear failure modes.",
    ],
    "bughunt": [
        "Edge cases, state-machine mistakes, off-by-one errors, null or empty inputs, and rollback paths.",
        "Concurrency, ordering, timeout, cancellation, retry, and resource lifetime bugs.",
        "Error handling that hides failures or makes recovery ambiguous.",
    ],
    "safety": [
        "Secret, token, cookie, credential, local-path, prompt, response, or account-identifier leakage.",
        "Permission boundary regressions, especially public, destructive, paid, account-level, or externally visible actions.",
        "Use of private APIs, hidden endpoints, background scraping, or bypasses of explicit user control.",
        "Reports or artifacts that should redact sensitive content by default.",
    ],
    "parity": [
        "Cross-language API drift, especially defaults, parameter names, return shapes, exceptions, and error codes.",
        "Protocol, contract fixture, schema, documentation, and example mismatches.",
        "Behavior that changed in one surface but not the others.",
    ],
    "rust-impact": [
        "Public Rust API changes, trait invariants, feature flags, cargo metadata, and workspace impact.",
        "Changed symbols, likely callers, tests, unsafe boundaries, async behavior, lifetimes, and ownership assumptions.",
        "Whether Rust Impact Summary evidence contradicts or misses anything in the diff.",
    ],
    "release": [
        "Packaging contents, versioning, generated artifacts, docs drift, changelog readiness, and install surfaces.",
        "Backward compatibility, migration notes, release gates, and missing verification evidence.",
    ],
    "architecture": [
        "Module boundaries, ownership, coupling, data flow, abstractions, and long-term maintainability.",
        "Places where a simpler local pattern would reduce risk without a broad rewrite.",
    ],
    "debug": [
        "Whether the included evidence establishes root cause instead of only symptoms.",
        "Missing repro steps, diagnostics, instrumentation, flaky-test risks, and environment assumptions.",
    ],
}


@dataclass(frozen=True)
class PackFile:
    rel: str
    source: Path
    size: int
    sha256: str
    stripped_tests: bool = False


@dataclass(frozen=True)
class PackRange:
    rel: str
    source: Path
    start: int
    end: int
    actual_end: int
    size: int
    sha256: str
    text: str


@dataclass(frozen=True)
class RangeRequest:
    rel: str
    source: Path
    start: int
    end: int


def normalize_rel(path: str | Path) -> str:
    return Path(path).as_posix().lstrip("./")


def run_git(root: Path, args: list[str]) -> subprocess.CompletedProcess[str] | None:
    try:
        return subprocess.run(
            ["git", *args],
            cwd=root,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
    except FileNotFoundError:
        return None


def git_output(root: Path, args: list[str]) -> str:
    result = run_git(root, args)
    if result is None or result.returncode != 0:
        return ""
    return result.stdout


def is_git_repo(root: Path) -> bool:
    result = run_git(root, ["rev-parse", "--show-toplevel"])
    return result is not None and result.returncode == 0


def tracked_files(root: Path) -> list[str]:
    output = git_output(root, ["ls-files", "-co", "--exclude-standard"])
    if output:
        return sorted({normalize_rel(line) for line in output.splitlines() if line.strip()})
    files: list[str] = []
    for current, dirs, names in os.walk(root):
        current_path = Path(current)
        rel_dir = normalize_rel(current_path.relative_to(root)) if current_path != root else ""
        dirs[:] = [
            name
            for name in dirs
            if not path_matches(normalize_rel(Path(rel_dir) / name) + "/", DEFAULT_EXCLUDES)
        ]
        for name in names:
            files.append(normalize_rel(current_path.joinpath(name).relative_to(root)))
    return sorted(files)


def changed_files(root: Path) -> list[str]:
    status = git_output(root, ["status", "--porcelain=v1"])
    changed: list[str] = []
    for line in status.splitlines():
        if not line.strip():
            continue
        path = line[3:]
        if " -> " in path:
            path = path.split(" -> ", 1)[1]
        changed.append(normalize_rel(path.strip()))
    return sorted(set(changed))


def path_matches(rel: str, patterns: Iterable[str]) -> bool:
    rel = normalize_rel(rel)
    for pattern in patterns:
        pattern = normalize_rel(pattern)
        if fnmatch.fnmatch(rel, pattern) or fnmatch.fnmatch("/" + rel, pattern):
            return True
        if pattern.endswith("/**") and rel.startswith(pattern[:-3].rstrip("/") + "/"):
            return True
        if pattern.endswith("/") and rel.startswith(pattern):
            return True
    return False


def focused(rel: str, focus: list[str], include: list[str]) -> bool:
    if not focus and not include:
        return True
    for item in [*focus, *include]:
        item = normalize_rel(item)
        if rel == item or rel.startswith(item.rstrip("/") + "/"):
            return True
        if fnmatch.fnmatch(rel, item):
            return True
    return False


def profile_allows(rel: str, profiles: list[str]) -> bool:
    if not profiles:
        return True
    patterns: list[str] = []
    for profile in profiles:
        patterns.extend(PROFILE_INCLUDES[profile])
    return path_matches(rel, patterns)


def is_probably_binary(path: Path) -> bool:
    if path.suffix.lower() in TEXT_EXTENSIONS:
        return False
    try:
        chunk = path.read_bytes()[:4096]
    except OSError:
        return True
    return b"\0" in chunk


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_text_bytes(path: Path) -> bytes:
    data = path.read_bytes()
    if data.startswith(b"\xef\xbb\xbf"):
        data = data[3:]
    return data


def resolve_repo_path(root: Path, path_text: str) -> tuple[str, Path]:
    raw = Path(path_text)
    abs_path = raw.resolve() if raw.is_absolute() else (root / path_text).resolve()
    try:
        rel = abs_path.relative_to(root)
    except ValueError as exc:
        raise ValueError(f"path is outside repository root: {path_text}") from exc
    return normalize_rel(rel), abs_path


def parse_range_spec(root: Path, spec: str) -> RangeRequest:
    try:
        path_part, span_part = spec.rsplit(":", 1)
    except ValueError as exc:
        raise ValueError(f"range must be '<path>:<start>-<end>': {spec}") from exc
    match = re.fullmatch(r"\s*(\d+)\s*-\s*(\d+)\s*", span_part)
    if not match:
        raise ValueError(f"range span must be '<start>-<end>': {spec}")
    start = int(match.group(1))
    end = int(match.group(2))
    if start < 1 or end < 1 or end < start:
        raise ValueError(f"invalid line range in {spec}")
    rel, source = resolve_repo_path(root, path_part)
    return RangeRequest(rel=rel, source=source, start=start, end=end)


def merge_range_requests(requests: list[RangeRequest]) -> list[RangeRequest]:
    merged: list[RangeRequest] = []
    for request in sorted(requests, key=lambda item: (item.rel, item.start, item.end)):
        if not merged or merged[-1].rel != request.rel or request.start > merged[-1].end + 1:
            merged.append(request)
            continue
        previous = merged[-1]
        merged[-1] = RangeRequest(
            rel=previous.rel,
            source=previous.source,
            start=previous.start,
            end=max(previous.end, request.end),
        )
    return merged


def numbered_range_text(path: Path, start: int, end: int) -> tuple[str, int]:
    text = path.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()
    if start > len(lines):
        return "", len(lines)
    actual_end = min(end, len(lines))
    width = len(str(actual_end))
    selected = [
        f"{idx:>{width}} | {lines[idx - 1]}"
        for idx in range(start, actual_end + 1)
    ]
    return "\n".join(selected), actual_end


def strip_rust_cfg_test(data: bytes) -> tuple[bytes, bool]:
    text = data.decode("utf-8", errors="replace")
    lines = text.splitlines(keepends=True)
    out: list[str] = []
    i = 0
    stripped = False
    while i < len(lines):
        if lines[i].lstrip().startswith("#[cfg(test)]"):
            start = i
            i += 1
            while i < len(lines) and lines[i].strip() == "":
                i += 1
            brace_depth = 0
            saw_open = False
            while i < len(lines):
                line = lines[i]
                brace_depth += line.count("{")
                brace_depth -= line.count("}")
                saw_open = saw_open or "{" in line
                i += 1
                if saw_open and brace_depth <= 0:
                    break
                if not saw_open and line.rstrip().endswith(";"):
                    break
            out.append(
                f"// review-pack stripped Rust cfg(test) block from source lines {start + 1}-{i}\n"
            )
            stripped = True
            continue
        out.append(lines[i])
        i += 1
    return "".join(out).encode("utf-8"), stripped


def transformed_bytes(path: Path, rel: str, exclude_tests: bool) -> tuple[bytes, bool]:
    data = read_text_bytes(path)
    if exclude_tests and rel.endswith(".rs"):
        return strip_rust_cfg_test(data)
    return data, False


def all_source_snapshot_candidates(root: Path, args: argparse.Namespace) -> list[str]:
    if not args.source_root and not args.doc and not args.include:
        roots = args.focus or ["."]
    else:
        roots = [*args.source_root, *args.doc, *args.include]
    tracked = tracked_files(root)
    selected: set[str] = set()
    missing: list[str] = []
    for spec in roots:
        try:
            rel, source = resolve_repo_path(root, spec)
        except ValueError:
            missing.append(spec)
            continue
        if source.is_file():
            selected.add(rel)
            continue
        if source.is_dir():
            prefix = rel.rstrip("/")
            if prefix in {"", "."}:
                selected.update(tracked)
            else:
                selected.update(
                    item for item in tracked if item == prefix or item.startswith(prefix + "/")
                )
            continue
        matches = [item for item in tracked if path_matches(item, [spec])]
        if matches:
            selected.update(matches)
        else:
            missing.append(spec)
    for spec in missing:
        # Keep this as an attribute-like side channel on args so dry-run and
        # manifest can report it without widening return types everywhere.
        args._source_snapshot_missing.append(spec)
    return sorted(selected)


def test_mode(args: argparse.Namespace) -> str:
    if args.tests:
        return args.tests
    if args.exclude_tests:
        return "none"
    return "all"


def include_test_patterns(args: argparse.Namespace) -> list[str]:
    return [normalize_rel(item) for item in args.include_test]


def source_snapshot_keeps_test(rel: str, args: argparse.Namespace) -> bool:
    mode = test_mode(args)
    if mode == "all":
        return True
    is_test = path_matches(rel, TEST_EXCLUDES)
    if mode == "none":
        return not is_test
    if not is_test:
        return True
    patterns = include_test_patterns(args)
    return bool(patterns and path_matches(rel, patterns))


def source_snapshot_strip_inline_tests(rel: str, args: argparse.Namespace) -> bool:
    mode = test_mode(args)
    if mode == "all":
        return False
    if mode == "none":
        return True
    patterns = include_test_patterns(args)
    return not (patterns and path_matches(rel, patterns))


def select_source_snapshot_files(
    args: argparse.Namespace,
    root: Path,
) -> tuple[list[PackFile], list[dict[str, str]]]:
    excludes = [*DEFAULT_EXCLUDES, *args.exclude]
    selected: list[PackFile] = []
    skipped: list[dict[str, str]] = []
    total_bytes = 0
    for rel in all_source_snapshot_candidates(root, args):
        abs_path = root / rel
        if not abs_path.is_file():
            continue
        if path_matches(rel, excludes):
            skipped.append({"path": rel, "reason": "excluded"})
            continue
        if not source_snapshot_keeps_test(rel, args):
            skipped.append({"path": rel, "reason": f"tests={test_mode(args)}"})
            continue
        try:
            size = abs_path.stat().st_size
        except OSError:
            skipped.append({"path": rel, "reason": "stat-failed"})
            continue
        if size > args.max_file_bytes:
            skipped.append({"path": rel, "reason": f"over max-file-bytes ({size})"})
            continue
        if is_probably_binary(abs_path):
            skipped.append({"path": rel, "reason": "binary"})
            continue
        strip_inline_tests = source_snapshot_strip_inline_tests(rel, args)
        data, stripped = transformed_bytes(abs_path, rel, strip_inline_tests)
        data_len = len(data)
        if total_bytes + data_len > args.max_bytes:
            skipped.append({"path": rel, "reason": "over max-bytes budget"})
            continue
        selected.append(
            PackFile(
                rel=rel,
                source=abs_path,
                size=data_len,
                sha256=sha256_bytes(data),
                stripped_tests=stripped,
            )
        )
        total_bytes += data_len
    return selected, skipped


def select_files(args: argparse.Namespace, root: Path) -> tuple[list[PackFile], list[dict[str, str]]]:
    if args.only_ranges:
        return [], []
    profiles = args.profile or ["generic"]
    excludes = [*DEFAULT_EXCLUDES, *args.exclude]
    for profile in profiles:
        excludes.extend(PROFILE_EXCLUDES[profile])
    if args.exclude_tests:
        excludes.extend(TEST_EXCLUDES)
    candidates = changed_files(root) if "changed-files" in profiles else tracked_files(root)
    selected: list[PackFile] = []
    skipped: list[dict[str, str]] = []
    total_bytes = 0
    for rel in candidates:
        abs_path = root / rel
        if not abs_path.is_file():
            continue
        if not focused(rel, args.focus, args.include):
            continue
        if path_matches(rel, excludes):
            skipped.append({"path": rel, "reason": "excluded"})
            continue
        if not profile_allows(rel, profiles):
            skipped.append({"path": rel, "reason": "profile-filter"})
            continue
        try:
            size = abs_path.stat().st_size
        except OSError:
            skipped.append({"path": rel, "reason": "stat-failed"})
            continue
        if size > args.max_file_bytes:
            skipped.append({"path": rel, "reason": f"over max-file-bytes ({size})"})
            continue
        if is_probably_binary(abs_path):
            skipped.append({"path": rel, "reason": "binary"})
            continue
        data, stripped = transformed_bytes(abs_path, rel, args.exclude_tests)
        data_len = len(data)
        if total_bytes + data_len > args.max_bytes:
            skipped.append({"path": rel, "reason": "over max-bytes budget"})
            continue
        selected.append(
            PackFile(
                rel=rel,
                source=abs_path,
                size=data_len,
                sha256=sha256_bytes(data),
                stripped_tests=stripped,
            )
        )
        total_bytes += data_len
    return selected, skipped


def select_ranges(
    args: argparse.Namespace,
    root: Path,
    selected_file_bytes: int,
) -> tuple[list[PackRange], list[dict[str, str]]]:
    skipped: list[dict[str, str]] = []
    requests: list[RangeRequest] = []
    for spec in args.range:
        try:
            requests.append(parse_range_spec(root, spec))
        except ValueError as exc:
            skipped.append({"path": spec, "reason": str(exc)})
    ranges: list[PackRange] = []
    total_bytes = selected_file_bytes
    excludes = [*DEFAULT_EXCLUDES, *args.exclude]
    for request in merge_range_requests(requests):
        if path_matches(request.rel, excludes):
            skipped.append({"path": f"{request.rel}:{request.start}-{request.end}", "reason": "excluded"})
            continue
        if not request.source.is_file():
            skipped.append({"path": f"{request.rel}:{request.start}-{request.end}", "reason": "not a file"})
            continue
        if is_probably_binary(request.source):
            skipped.append({"path": f"{request.rel}:{request.start}-{request.end}", "reason": "binary"})
            continue
        try:
            text, actual_end = numbered_range_text(request.source, request.start, request.end)
        except OSError:
            skipped.append({"path": f"{request.rel}:{request.start}-{request.end}", "reason": "read-failed"})
            continue
        if not text:
            skipped.append({
                "path": f"{request.rel}:{request.start}-{request.end}",
                "reason": "range starts after end-of-file",
            })
            continue
        data = text.encode("utf-8")
        size = len(data)
        if size > args.max_file_bytes:
            skipped.append({
                "path": f"{request.rel}:{request.start}-{request.end}",
                "reason": f"range over max-file-bytes ({size})",
            })
            continue
        if total_bytes + size > args.max_bytes:
            skipped.append({
                "path": f"{request.rel}:{request.start}-{request.end}",
                "reason": "range over max-bytes budget",
            })
            continue
        ranges.append(
            PackRange(
                rel=request.rel,
                source=request.source,
                start=request.start,
                end=request.end,
                actual_end=actual_end,
                size=size,
                sha256=sha256_bytes(data),
                text=text,
            )
        )
        total_bytes += size
    return ranges, skipped


def write_pack_file(stage: Path, root: Path, item: PackFile, exclude_tests: bool) -> None:
    target = stage / "source" / item.rel
    target.parent.mkdir(parents=True, exist_ok=True)
    data, _ = transformed_bytes(item.source, item.rel, exclude_tests)
    target.write_bytes(data)


def write_snapshot_file(stage: Path, item: PackFile, args: argparse.Namespace) -> None:
    target = stage / "repo" / item.rel
    target.parent.mkdir(parents=True, exist_ok=True)
    data, _ = transformed_bytes(
        item.source,
        item.rel,
        source_snapshot_strip_inline_tests(item.rel, args),
    )
    target.write_bytes(data)


def source_tree(files: list[PackFile], ranges: list[PackRange]) -> str:
    lines = ["# Source Tree", ""]
    for item in files:
        marker = " stripped-cfg-test" if item.stripped_tests else ""
        lines.append(f"- `{item.rel}` ({item.size} bytes{marker})")
    for item in ranges:
        lines.append(
            f"- `{item.rel}:{item.start}-{item.end}` excerpt "
            f"({item.size} bytes, actual end {item.actual_end})"
        )
    lines.append("")
    return "\n".join(lines)


def source_tree_text(files: list[PackFile]) -> str:
    lines: list[str] = []
    for item in files:
        marker = " stripped-cfg-test" if item.stripped_tests else ""
        lines.append(f"- `{item.rel}` `{item.sha256[:12]}` {item.size} bytes{marker}")
    return "\n".join(lines) + ("\n" if lines else "")


def review_kinds(args: argparse.Namespace) -> list[str]:
    kinds = args.review_kind or ["general"]
    return list(dict.fromkeys(kinds))


def manifest(
    args: argparse.Namespace,
    root: Path,
    files: list[PackFile],
    ranges: list[PackRange],
    skipped: list[dict[str, str]],
) -> str:
    sha = git_output(root, ["rev-parse", "HEAD"]).strip() if is_git_repo(root) else ""
    status = git_output(root, ["status", "--short"]) if is_git_repo(root) else ""
    source_bytes = sum(item.size for item in files) + sum(item.size for item in ranges)
    lines = [
        "# Review Pack Manifest",
        "",
        f"- Generated UTC: `{datetime.now(timezone.utc).isoformat(timespec='seconds')}`",
        f"- Root: `{root}`",
        f"- Profiles: `{', '.join(args.profile or ['generic'])}`",
        f"- Review kinds: `{', '.join(review_kinds(args))}`",
        f"- Focus: `{', '.join(args.focus) if args.focus else '<all>'}`",
        f"- Task: `{args.task or '<unspecified>'}`",
        f"- Include tests: `{not args.exclude_tests}`",
        f"- File count: `{len(files)}`",
        f"- Range excerpt count: `{len(ranges)}`",
        f"- Source bytes: `{source_bytes}`",
        f"- Token estimate: `{source_bytes // 4}`",
    ]
    if sha:
        lines.append(f"- Git HEAD: `{sha}`")
    if args.question:
        lines.extend(["", "## Review Questions", ""])
        for question in args.question:
            lines.append(f"- {question}")
    lines.extend(["", "## Included Files", ""])
    for item in files:
        marker = " stripped-cfg-test" if item.stripped_tests else ""
        lines.append(f"- `{item.rel}` `{item.sha256[:12]}` {item.size} bytes{marker}")
    if ranges:
        lines.extend(["", "## Included Range Excerpts", ""])
        for item in ranges:
            lines.append(
                f"- `{item.rel}:{item.start}-{item.end}` `{item.sha256[:12]}` "
                f"{item.size} bytes actual-end `{item.actual_end}`"
            )
    lines.extend(["", "## Skipped Files", ""])
    for item in skipped[:500]:
        lines.append(f"- `{item['path']}`: {item['reason']}")
    if len(skipped) > 500:
        lines.append(f"- ... {len(skipped) - 500} more skipped files")
    lines.extend(["", "## Git Status", "", "```text", status.strip() or "clean", "```", ""])
    return "\n".join(lines)


def prompt_template(args: argparse.Namespace) -> str:
    profiles = ", ".join(args.profile or ["generic"])
    focus = ", ".join(args.focus) if args.focus else "the included source"
    kinds = review_kinds(args)
    guidance_lines: list[str] = []
    for kind in kinds:
        guidance_lines.append(f"{kind}:")
        guidance_lines.extend(f"- {item}" for item in REVIEW_KIND_GUIDANCE[kind])
    guidance = "\n".join(guidance_lines)
    base = textwrap.dedent(
        f"""\
        You are reviewing an attached source review pack.

        Focus: {focus}
        Profiles: {profiles}
        Review kinds: {", ".join(kinds)}

        Read in this order:
        1. Review Pack Manifest / MANIFEST.md.
        2. Reviewer Prompt / PROMPT.md.
        3. Git Diff / DIFF.patch, if present.
        4. Rust Impact Summary and Source Excerpts, if present.
        5. Source Files.

        Review priorities:
        {textwrap.indent(guidance, "        ").lstrip()}

        Response format:
        - Start with findings, ordered by severity.
        - For each finding include severity (P0, P1, P2, or P3), file:line, issue, why it matters, and a concrete fix or test.
        - Ground every finding in paths and line references from the pack.
        - Separate missing-context requests from findings, and ask for exact files or ranges.
        - If there are no findings, say that clearly and list residual risks or test gaps.

        Constraints:
        - Do not suggest broad rewrites unless a concrete issue requires one.
        - Do not assume repository context outside this pack.
        - Treat omitted files as unavailable unless you request them explicitly.
        """
    )
    if args.task:
        base += f"\nTask:\n{args.task}\n"
    if args.question:
        base += "\nSpecific review questions:\n"
        for index, question in enumerate(args.question, start=1):
            base += f"{index}. {question}\n"
    return base


def fence_for(text: str) -> str:
    longest = 0
    current = 0
    for char in text:
        if char == "`":
            current += 1
            longest = max(longest, current)
        else:
            current = 0
    return "`" * max(3, longest + 1)


def language_for(rel: str) -> str:
    suffix = Path(rel).suffix.lower()
    return {
        ".c": "c",
        ".cc": "cpp",
        ".cpp": "cpp",
        ".css": "css",
        ".go": "go",
        ".h": "c",
        ".hpp": "cpp",
        ".html": "html",
        ".js": "javascript",
        ".json": "json",
        ".jsx": "jsx",
        ".m": "objective-c",
        ".md": "markdown",
        ".mm": "objective-c++",
        ".plist": "xml",
        ".proto": "proto",
        ".py": "python",
        ".rs": "rust",
        ".scss": "scss",
        ".sh": "bash",
        ".swift": "swift",
        ".toml": "toml",
        ".ts": "typescript",
        ".tsx": "tsx",
        ".vue": "vue",
        ".xml": "xml",
        ".yaml": "yaml",
        ".yml": "yaml",
    }.get(suffix, "")


def git_diff_text(root: Path) -> str:
    if not is_git_repo(root):
        return ""
    diff = git_output(root, ["diff", "--binary"])
    staged = git_output(root, ["diff", "--cached", "--binary"])
    content = ""
    if diff:
        content += "# Unstaged diff\n\n" + diff
    if staged:
        content += "\n# Staged diff\n\n" + staged
    return content


def git_rust_hunks(root: Path) -> dict[str, list[tuple[int, int, str]]]:
    hunks: dict[str, list[tuple[int, int, str]]] = {}
    if not is_git_repo(root):
        return hunks
    sources = [
        ("unstaged", git_output(root, ["diff", "--unified=0", "--", "*.rs"])),
        ("staged", git_output(root, ["diff", "--cached", "--unified=0", "--", "*.rs"])),
    ]
    for label, diff in sources:
        current: str | None = None
        for line in diff.splitlines():
            if line.startswith("+++ "):
                path = line[4:].strip()
                if path == "/dev/null":
                    current = None
                elif path.startswith("b/"):
                    current = normalize_rel(path[2:])
                else:
                    current = normalize_rel(path)
                continue
            if current is None or not line.startswith("@@"):
                continue
            match = re.search(r"\+(\d+)(?:,(\d+))?", line)
            if not match:
                continue
            start = int(match.group(1))
            length = int(match.group(2) or "1")
            end = start if length == 0 else start + length - 1
            hunks.setdefault(current, []).append((start, end, label))
    return hunks


RUST_SYMBOL_RE = re.compile(
    r"^\s*(?P<vis>pub(?:\([^)]*\))?\s+)?"
    r"(?:(?:async|const|unsafe|extern(?:\s+\"[^\"]+\")?)\s+)*"
    r"(?P<kind>fn|struct|enum|trait|impl|mod|type|const|static)\s+"
    r"(?P<name>[A-Za-z_][A-Za-z0-9_]*|[^{;]+)"
)


def rust_symbols(path: Path) -> list[dict[str, object]]:
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []
    starts: list[dict[str, object]] = []
    for index, line in enumerate(lines, start=1):
        stripped = line.strip()
        if not stripped or stripped.startswith("//") or stripped.startswith("#"):
            continue
        match = RUST_SYMBOL_RE.match(line)
        if not match:
            continue
        kind = match.group("kind")
        raw_name = " ".join(match.group("name").strip().split())
        if kind == "impl":
            raw_name = raw_name.split("{", 1)[0].strip()
        else:
            raw_name = raw_name.split("(", 1)[0].split("<", 1)[0].split(":", 1)[0].strip()
        starts.append({
            "kind": kind,
            "name": raw_name[:120],
            "line": index,
            "signature": stripped[:220],
            "public": bool(match.group("vis")),
        })
    for index, item in enumerate(starts):
        next_line = starts[index + 1]["line"] if index + 1 < len(starts) else len(lines) + 1
        item["end_line"] = int(next_line) - 1
    return starts


def changed_rust_symbols(root: Path) -> list[dict[str, object]]:
    impacted: list[dict[str, object]] = []
    for rel, hunks in git_rust_hunks(root).items():
        path = root / rel
        if not path.is_file():
            continue
        symbols = rust_symbols(path)
        for start, end, label in hunks:
            matches = [
                symbol
                for symbol in symbols
                if int(symbol["line"]) <= end and int(symbol["end_line"]) >= start
            ]
            if not matches:
                before = [
                    symbol for symbol in symbols
                    if int(symbol["line"]) <= start
                ]
                matches = before[-1:] if before else []
            for symbol in matches:
                impacted.append({
                    "file": rel,
                    "hunk": f"{start}-{end}",
                    "change": label,
                    **symbol,
                })
    deduped: list[dict[str, object]] = []
    seen: set[tuple[str, int, str]] = set()
    for item in impacted:
        key = (str(item["file"]), int(item["line"]), str(item["hunk"]))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped


def cargo_metadata_summary(root: Path) -> list[str]:
    if not (root / "Cargo.toml").exists():
        return ["- Cargo metadata: no `Cargo.toml` at repository root."]
    try:
        result = subprocess.run(
            ["cargo", "metadata", "--no-deps", "--format-version", "1"],
            cwd=root,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=30,
            check=False,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return ["- Cargo metadata: unavailable (`cargo metadata` could not run)."]
    if result.returncode != 0:
        stderr = result.stderr.strip().splitlines()[:6]
        lines = ["- Cargo metadata: failed."]
        lines.extend(f"  - {line}" for line in stderr)
        return lines
    try:
        metadata = json.loads(result.stdout)
    except json.JSONDecodeError:
        return ["- Cargo metadata: invalid JSON output."]
    packages = metadata.get("packages", [])
    workspace_members = set(metadata.get("workspace_members", []))
    lines = [f"- Workspace packages: `{len(workspace_members) or len(packages)}`"]
    for package in packages[:20]:
        if workspace_members and package.get("id") not in workspace_members:
            continue
        targets = ", ".join(target.get("name", "") for target in package.get("targets", [])[:6])
        lines.append(f"  - `{package.get('name', '<unknown>')}` targets: {targets or '<none>'}")
    if len(packages) > 20:
        lines.append(f"  - ... {len(packages) - 20} more packages omitted")
    return lines


def likely_rust_tests(root: Path, changed_symbols: list[dict[str, object]]) -> list[str]:
    if not changed_symbols:
        return []
    try:
        files = tracked_files(root)
    except OSError:
        return []
    tokens: set[str] = set()
    for item in changed_symbols:
        tokens.add(Path(str(item["file"])).stem.lower())
        for part in re.split(r"[^A-Za-z0-9_]+", str(item["name"]).lower()):
            if len(part) >= 4:
                tokens.add(part)
    tests: list[str] = []
    for rel in files:
        normalized = normalize_rel(rel)
        lower = normalized.lower()
        if not normalized.endswith(".rs"):
            continue
        is_test = (
            lower.startswith("tests/")
            or "/tests/" in lower
            or "/test/" in lower
            or "test" in Path(lower).stem
        )
        if not is_test:
            continue
        if any(token in lower for token in tokens):
            tests.append(normalized)
    return sorted(set(tests))[:40]


def rust_analyzer_section(root: Path) -> list[str]:
    try:
        version = subprocess.run(
            ["rust-analyzer", "--version"],
            cwd=root,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=10,
            check=False,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return ["- rust-analyzer: unavailable."]
    lines = [f"- rust-analyzer version: `{(version.stdout or version.stderr).strip() or '<unknown>'}`"]
    try:
        diagnostics = subprocess.run(
            ["rust-analyzer", "diagnostics", "."],
            cwd=root,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=60,
            check=False,
        )
    except subprocess.TimeoutExpired:
        lines.append("- rust-analyzer diagnostics: timed out after 60s.")
        return lines
    output = (diagnostics.stdout or diagnostics.stderr).strip()
    if diagnostics.returncode != 0:
        lines.append("- rust-analyzer diagnostics: failed or unsupported by this installed binary.")
    elif output:
        lines.append("- rust-analyzer diagnostics output:")
        lines.extend(f"  {line}" for line in output.splitlines()[:80])
    else:
        lines.append("- rust-analyzer diagnostics: no output.")
    return lines


def render_rust_impact(args: argparse.Namespace, root: Path) -> str:
    if not args.rust_impact and not args.rust_analyzer:
        return ""
    sections = ["## Rust Impact Summary", ""]
    if args.rust_impact:
        changed_symbols = changed_rust_symbols(root)
        sections.extend(["### Cargo Metadata", ""])
        sections.extend(cargo_metadata_summary(root))
        sections.extend(["", "### Changed Rust Symbols", ""])
        if changed_symbols:
            for item in changed_symbols[:80]:
                public = " public" if item.get("public") else ""
                sections.append(
                    f"- `{item['file']}:{item['line']}-{item['end_line']}` "
                    f"{item['kind']} `{item['name']}` hunk `{item['hunk']}` "
                    f"({item['change']}{public})"
                )
                sections.append(f"  - `{item['signature']}`")
            if len(changed_symbols) > 80:
                sections.append(f"- ... {len(changed_symbols) - 80} more changed symbols omitted")
        else:
            sections.append("- No changed Rust symbols found from git diff hunks.")
        public_symbols = [item for item in changed_symbols if item.get("public")]
        sections.extend(["", "### Public API Candidates", ""])
        if public_symbols:
            for item in public_symbols[:40]:
                sections.append(f"- `{item['file']}:{item['line']}` `{item['signature']}`")
            if len(public_symbols) > 40:
                sections.append(f"- ... {len(public_symbols) - 40} more public candidates omitted")
        else:
            sections.append("- No public Rust symbol candidates found in changed hunks.")
        tests = likely_rust_tests(root, changed_symbols)
        sections.extend(["", "### Likely Impacted Rust Tests", ""])
        if tests:
            sections.extend(f"- `{rel}`" for rel in tests)
        else:
            sections.append("- No likely impacted Rust test files found by filename/symbol heuristic.")
    if args.rust_analyzer:
        sections.extend(["", "### Rust Analyzer", ""])
        sections.extend(rust_analyzer_section(root))
    sections.append("")
    return "\n".join(sections)


def render_markdown_pack(
    args: argparse.Namespace,
    root: Path,
    files: list[PackFile],
    ranges: list[PackRange],
    skipped: list[dict[str, str]],
) -> str:
    sections = [
        "# Review Pack",
        "",
        "This is a single-file source review artifact. File paths are preserved in headings.",
        "",
        manifest(args, root, files, ranges, skipped),
        "",
        source_tree(files, ranges),
        "",
        "## Reviewer Prompt",
        "",
        prompt_template(args),
        "",
    ]
    if should_include_diff(args):
        diff = git_diff_text(root)
        if diff:
            fence = fence_for(diff)
            sections.extend(["## Git Diff", "", f"{fence}diff", diff.rstrip(), fence, ""])
    rust_impact = render_rust_impact(args, root)
    if rust_impact:
        sections.extend([rust_impact])
    if ranges:
        sections.extend(["## Source Excerpts", ""])
        for item in ranges:
            fence = fence_for(item.text)
            sections.extend(
                [
                    f"### Range: `{item.rel}:{item.start}-{item.end}`",
                    "",
                    f"- Bytes: `{item.size}`",
                    f"- Actual end line: `{item.actual_end}`",
                    f"- SHA-256: `{item.sha256}`",
                    "",
                    fence,
                    item.text.rstrip(),
                    fence,
                    "",
                ]
            )
    sections.extend(["## Source Files", ""])
    for item in files:
        data, _ = transformed_bytes(item.source, item.rel, args.exclude_tests)
        text = data.decode("utf-8", errors="replace")
        fence = fence_for(text)
        lang = language_for(item.rel)
        info = f"{fence}{lang}" if lang else fence
        stripped = " stripped-cfg-test" if item.stripped_tests else ""
        sections.extend(
            [
                f"### File: `{item.rel}`",
                "",
                f"- Bytes: `{item.size}`",
                f"- SHA-256: `{item.sha256}`",
                f"- Notes: `{stripped.strip() or 'none'}`",
                "",
                info,
                text.rstrip(),
                fence,
                "",
            ]
        )
    return "\n".join(sections)


def write_summary(
    stage: Path,
    args: argparse.Namespace,
    root: Path,
    files: list[PackFile],
    ranges: list[PackRange],
    skipped: list[dict[str, str]],
) -> None:
    source_bytes = sum(item.size for item in files) + sum(item.size for item in ranges)
    summary = {
        "root": str(root),
        "profiles": args.profile or ["generic"],
        "review_kinds": review_kinds(args),
        "focus": args.focus,
        "include": args.include,
        "task": args.task,
        "questions": args.question,
        "exclude_tests": args.exclude_tests,
        "file_count": len(files),
        "range_count": len(ranges),
        "source_bytes": source_bytes,
        "estimated_tokens": source_bytes // 4,
        "files": [item.__dict__ | {"source": str(item.source)} for item in files],
        "ranges": [
            {
                "path": item.rel,
                "source": str(item.source),
                "start": item.start,
                "end": item.end,
                "actual_end": item.actual_end,
                "size": item.size,
                "sha256": item.sha256,
            }
            for item in ranges
        ],
        "skipped": skipped,
    }
    (stage / "PACK_SUMMARY.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")


def write_diff(stage: Path, root: Path) -> None:
    content = git_diff_text(root)
    if content:
        (stage / "DIFF.patch").write_text(content, encoding="utf-8", errors="replace")


def write_git_context(stage: Path, root: Path) -> None:
    if not is_git_repo(root):
        return
    (stage / "GIT_STATUS.txt").write_text(
        git_output(root, ["status", "--short"]),
        encoding="utf-8",
        errors="replace",
    )
    (stage / "GIT_HEAD.txt").write_text(
        git_output(root, ["rev-parse", "HEAD"]),
        encoding="utf-8",
        errors="replace",
    )
    (stage / "GIT_BRANCH.txt").write_text(
        git_output(root, ["branch", "--show-current"]),
        encoding="utf-8",
        errors="replace",
    )


def source_snapshot_manifest(
    args: argparse.Namespace,
    root: Path,
    files: list[PackFile],
    skipped: list[dict[str, str]],
) -> str:
    sha = git_output(root, ["rev-parse", "HEAD"]).strip() if is_git_repo(root) else ""
    branch = git_output(root, ["branch", "--show-current"]).strip() if is_git_repo(root) else ""
    source_bytes = sum(item.size for item in files)
    include_diff = should_include_diff(args)
    include_prompt = should_include_prompt(args)
    lines = [
        "# MANIFEST",
        "",
        f"- Generated UTC: `{datetime.now(timezone.utc).isoformat(timespec='seconds')}`",
        f"- Root: `{root}`",
        f"- Artifact shape: `source-snapshot`",
        f"- Format: `{args.format}`",
        f"- Tests: `{test_mode(args)}`",
        f"- Include diff: `{include_diff}`",
        f"- Include prompt: `{include_prompt}`",
        f"- Source roots: `{', '.join(args.source_root) if args.source_root else '<focus/include/default>'}`",
        f"- Docs: `{', '.join(args.doc) if args.doc else '<none>'}`",
        f"- File count: `{len(files)}`",
        f"- Source bytes: `{source_bytes}`",
        f"- Token estimate: `{source_bytes // 4}`",
    ]
    if sha:
        lines.append(f"- Git HEAD: `{sha}`")
    if branch:
        lines.append(f"- Git branch: `{branch}`")
    if args._source_snapshot_missing:
        lines.extend(["", "## Missing Requested Paths", ""])
        lines.extend(f"- `{item}`" for item in args._source_snapshot_missing)
    lines.extend(
        [
            "",
            "## Contents",
            "",
            "- `repo/`: repository-relative source and docs snapshot.",
            "- `SOURCE_TREE.txt`: file list with sizes and content hashes.",
            "- `GIT_STATUS.txt`, `GIT_HEAD.txt`, `GIT_BRANCH.txt`: git orientation when available.",
        ]
    )
    if include_diff:
        lines.append("- `DIFF.patch`: git diff, explicitly requested.")
    if include_prompt:
        lines.append("- `PROMPT.md`: reviewer prompt, explicitly requested.")
    lines.extend(["", "## Included Files", ""])
    lines.extend(source_tree_text(files).splitlines())
    lines.extend(["", "## Skipped Files", ""])
    for item in skipped[:500]:
        lines.append(f"- `{item['path']}`: {item['reason']}")
    if len(skipped) > 500:
        lines.append(f"- ... {len(skipped) - 500} more skipped files")
    lines.append("")
    return "\n".join(lines)


def should_include_diff(args: argparse.Namespace) -> bool:
    if args.include_diff is not None:
        return bool(args.include_diff)
    return args.shape != "source-snapshot"


def should_include_prompt(args: argparse.Namespace) -> bool:
    if args.include_prompt is not None:
        return bool(args.include_prompt)
    return args.shape != "source-snapshot"


def render_excerpts(ranges: list[PackRange]) -> str:
    if not ranges:
        return ""
    sections = ["# Source Excerpts", ""]
    for item in ranges:
        fence = fence_for(item.text)
        sections.extend(
            [
                f"## Range: `{item.rel}:{item.start}-{item.end}`",
                "",
                f"- Bytes: `{item.size}`",
                f"- Actual end line: `{item.actual_end}`",
                f"- SHA-256: `{item.sha256}`",
                "",
                fence,
                item.text.rstrip(),
                fence,
                "",
            ]
        )
    return "\n".join(sections)


def write_excerpts(stage: Path, ranges: list[PackRange]) -> None:
    content = render_excerpts(ranges)
    if content:
        (stage / "EXCERPTS.md").write_text(content, encoding="utf-8", errors="replace")


def write_rust_impact(stage: Path, args: argparse.Namespace, root: Path) -> None:
    content = render_rust_impact(args, root)
    if content:
        (stage / "RUST_IMPACT.md").write_text(content, encoding="utf-8", errors="replace")


def zip_stage(stage: Path, out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(stage.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(stage).as_posix())


def default_out(root: Path, args: argparse.Namespace) -> Path:
    focus_name = "repo"
    if args.focus:
        focus_name = Path(args.focus[0]).name or "focus"
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    suffix = ".md" if args.format == "md" else ".zip"
    if args.format == "dir":
        suffix = ""
    return root / "reports" / "review-packs" / f"{focus_name}-{stamp}{suffix}"


def create(args: argparse.Namespace) -> int:
    root = Path(args.root).resolve()
    if not root.exists():
        raise SystemExit(f"root does not exist: {root}")
    args._source_snapshot_missing = []
    if args.shape == "source-snapshot":
        return create_source_snapshot(args, root)
    files, skipped = select_files(args, root)
    ranges, range_skipped = select_ranges(args, root, sum(item.size for item in files))
    skipped.extend(range_skipped)
    source_bytes = sum(item.size for item in files) + sum(item.size for item in ranges)
    if args.dry_run:
        print(json.dumps({
            "root": str(root),
            "profiles": args.profile or ["generic"],
            "review_kinds": review_kinds(args),
            "task": args.task,
            "file_count": len(files),
            "range_count": len(ranges),
            "source_bytes": source_bytes,
            "estimated_tokens": source_bytes // 4,
            "sample_files": [item.rel for item in files[:50]],
            "sample_ranges": [f"{item.rel}:{item.start}-{item.end}" for item in ranges[:50]],
            "skipped_count": len(skipped),
        }, indent=2))
        return 0
    out = Path(args.out).resolve() if args.out else default_out(root, args)
    if args.format == "md":
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(render_markdown_pack(args, root, files, ranges, skipped), encoding="utf-8")
        print(json.dumps({
            "ok": True,
            "out": str(out),
            "format": args.format,
            "file_count": len(files),
            "range_count": len(ranges),
            "review_kinds": review_kinds(args),
            "source_bytes": source_bytes,
            "estimated_tokens": source_bytes // 4,
        }, indent=2))
        return 0
    stage_parent = Path(tempfile.mkdtemp(prefix="review-pack-"))
    stage = stage_parent / "pack"
    stage.mkdir()
    try:
        for item in files:
            write_pack_file(stage, root, item, args.exclude_tests)
        (stage / "MANIFEST.md").write_text(manifest(args, root, files, ranges, skipped), encoding="utf-8")
        (stage / "SOURCE_TREE.md").write_text(source_tree(files, ranges), encoding="utf-8")
        if should_include_prompt(args):
            (stage / "PROMPT.md").write_text(prompt_template(args), encoding="utf-8")
        write_summary(stage, args, root, files, ranges, skipped)
        write_excerpts(stage, ranges)
        write_rust_impact(stage, args, root)
        if should_include_diff(args):
            write_diff(stage, root)
        if args.format == "dir":
            if out.exists():
                raise SystemExit(f"output directory already exists: {out}")
            shutil.copytree(stage, out)
        else:
            zip_stage(stage, out)
        print(json.dumps({
            "ok": True,
            "out": str(out),
            "format": args.format,
            "file_count": len(files),
            "range_count": len(ranges),
            "review_kinds": review_kinds(args),
            "source_bytes": source_bytes,
            "estimated_tokens": source_bytes // 4,
        }, indent=2))
    finally:
        shutil.rmtree(stage_parent, ignore_errors=True)
    return 0


def create_source_snapshot(args: argparse.Namespace, root: Path) -> int:
    if args.format == "md":
        raise SystemExit("source-snapshot requires --format zip or --format dir")
    files, skipped = select_source_snapshot_files(args, root)
    source_bytes = sum(item.size for item in files)
    if args.dry_run:
        print(json.dumps({
            "root": str(root),
            "shape": args.shape,
            "format": args.format,
            "tests": test_mode(args),
            "source_roots": args.source_root,
            "docs": args.doc,
            "include_tests": args.include_test,
            "include_diff": should_include_diff(args),
            "include_prompt": should_include_prompt(args),
            "file_count": len(files),
            "source_bytes": source_bytes,
            "estimated_tokens": source_bytes // 4,
            "sample_files": [item.rel for item in files[:80]],
            "missing": args._source_snapshot_missing,
            "skipped_count": len(skipped),
        }, indent=2))
        return 0
    out = Path(args.out).resolve() if args.out else default_out(root, args)
    stage_parent = Path(tempfile.mkdtemp(prefix="review-source-snapshot-"))
    stage = stage_parent / "pack"
    stage.mkdir()
    try:
        for item in files:
            write_snapshot_file(stage, item, args)
        (stage / "MANIFEST.md").write_text(
            source_snapshot_manifest(args, root, files, skipped),
            encoding="utf-8",
        )
        (stage / "SOURCE_TREE.txt").write_text(
            source_tree_text(files),
            encoding="utf-8",
        )
        write_git_context(stage, root)
        if should_include_prompt(args):
            (stage / "PROMPT.md").write_text(prompt_template(args), encoding="utf-8")
        if should_include_diff(args):
            write_diff(stage, root)
        if args.format == "dir":
            if out.exists():
                raise SystemExit(f"output directory already exists: {out}")
            shutil.copytree(stage, out)
        else:
            zip_stage(stage, out)
        print(json.dumps({
            "ok": True,
            "out": str(out),
            "shape": args.shape,
            "format": args.format,
            "tests": test_mode(args),
            "file_count": len(files),
            "source_bytes": source_bytes,
            "estimated_tokens": source_bytes // 4,
            "include_diff": should_include_diff(args),
            "include_prompt": should_include_prompt(args),
            "missing": args._source_snapshot_missing,
            "skipped_count": len(skipped),
        }, indent=2))
    finally:
        shutil.rmtree(stage_parent, ignore_errors=True)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="review-pack")
    sub = parser.add_subparsers(dest="command")
    create_parser = sub.add_parser("create", help="create a source review pack")
    create_parser.add_argument("--root", default=".", help="repository root, default: cwd")
    create_parser.add_argument("--shape", choices=["review-pack", "source-snapshot"], default="review-pack", help="artifact shape; source-snapshot writes repo-relative files and keeps prompt/diff out unless requested")
    create_parser.add_argument("--profile", action="append", choices=sorted(PROFILE_INCLUDES), help="language/profile preset; can repeat")
    create_parser.add_argument("--focus", action="append", default=[], help="path or glob to focus; can repeat")
    create_parser.add_argument("--include", action="append", default=[], help="extra path or glob to include; can repeat")
    create_parser.add_argument("--exclude", action="append", default=[], help="extra path or glob to exclude; can repeat")
    create_parser.add_argument("--source-root", action="append", default=[], help="source-snapshot path root to copy under repo/; can repeat")
    create_parser.add_argument("--doc", action="append", default=[], help="source-snapshot doc or governance file/path to copy under repo/; can repeat")
    create_parser.add_argument("--tests", choices=["all", "none", "targeted"], help="source-snapshot test inclusion mode; defaults to all unless --exclude-tests is set")
    create_parser.add_argument("--include-test", action="append", default=[], help="test path/glob to keep when --tests targeted; can repeat")
    create_parser.add_argument("--range", action="append", default=[], help="include a numbered source excerpt '<path>:<start>-<end>'; can repeat")
    create_parser.add_argument("--only-ranges", action="store_true", help="skip normal file selection and include only explicit --range excerpts")
    create_parser.add_argument("--task", help="review task or brief to include in the manifest and reviewer prompt")
    create_parser.add_argument("--question", action="append", default=[], help="specific reviewer question; can repeat")
    create_parser.add_argument(
        "--review-kind",
        action="append",
        choices=sorted(REVIEW_KIND_GUIDANCE),
        help="standard prompt profile for the reviewer; can repeat",
    )
    create_parser.add_argument("--rust-impact", action="store_true", help="include Rust git-diff symbol impact and cargo metadata summary")
    create_parser.add_argument("--rust-analyzer", action="store_true", help="try to include rust-analyzer version and diagnostics output")
    create_parser.add_argument("--exclude-tests", action="store_true", help="exclude test files and strip Rust cfg(test) blocks")
    create_parser.add_argument("--include-diff", action=argparse.BooleanOptionalAction, default=None, help="include git diff when present; default on for review-pack and off for source-snapshot")
    create_parser.add_argument("--include-prompt", action=argparse.BooleanOptionalAction, default=None, help="include generated PROMPT.md in non-md artifacts; default on for review-pack and off for source-snapshot")
    create_parser.add_argument("--max-bytes", type=int, default=5_000_000, help="source byte budget")
    create_parser.add_argument("--max-file-bytes", type=int, default=300_000, help="per-file byte budget")
    create_parser.add_argument("--format", choices=["md", "zip", "dir"], default="md")
    create_parser.add_argument("--out", help="output markdown, zip, or directory path")
    create_parser.add_argument("--dry-run", action="store_true", help="print selected summary without writing artifact")
    create_parser.set_defaults(func=create)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] not in {"create", "-h", "--help"}:
        argv.insert(0, "create")
    args = parser.parse_args(argv)
    if not hasattr(args, "func"):
        parser.print_help()
        return 2
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
