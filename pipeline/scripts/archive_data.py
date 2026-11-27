#!/usr/bin/env python3
"""
Move generated pipeline databases, summaries, and logs into an external timestamped archive
with SHA-256 verification and MANIFEST.txt before starting a fresh build.

  MOVED    data/*.db* (including -wal/-shm/.bak/.tmp*), public/default-*.json.gz, logs/*
  COPIED   public/config/{venues,corpus,taxonomy}.json, topic reports/models, inputs & config files
  LEFT     .env, data/models, and source input files (use --keep-cache to also leave data/api_cache.db)

Usage
  python pipeline/scripts/archive_data.py [--to DIR] [--yes] [--dry-run] [--keep-cache]
"""
from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# Patterns are relative to the project root.
MOVE = ["data/*.db", "data/*.db-wal", "data/*.db-shm", "data/*.bak", "data/*.tmp*", "data/*.db.tmp*",
        "public/default-*.json.gz", "public/*.tmp", "public/config/*.tmp", "logs/*"]
COPY = ["public/config/venues.json", "public/config/corpus.json", "public/config/taxonomy.json",
        "data/topics/assignment_model.json", "data/topics/assignment_report.md", "data/topics/article_types_report.md",
        "data/taxonomy.json", "data/topics/answer_key.json", "data/article_overrides.json", "data/merges.json",
        "data/suppressions.json",
        "pipeline/config/scope.json", "pipeline/config/embedding.json", "pipeline/requirements.lock"]


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def find(root: Path, patterns: list[str]) -> list[Path]:
    found = {}
    for pattern in patterns:
        for p in sorted(root.glob(pattern)):
            if p.is_file() and not p.is_symlink():
                found[p] = None
    return sorted(found)


CACHE = ("api_cache.db", "api_cache.db-wal", "api_cache.db-shm")


def plan(root: Path, keep_cache: bool = False) -> tuple[list[Path], list[Path]]:
    moved = [p for p in find(root, MOVE) if not (keep_cache and p.name in CACHE)]
    return moved, [p for p in find(root, COPY) if p not in moved]


def human(n: int) -> str:
    size = float(n)
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024 or unit == "GB":
            return f"{size:,.0f} {unit}" if unit == "B" else f"{size:.1f} {unit}"
        size /= 1024
    return f"{n} B"


def default_destination(root: Path) -> Path:
    base = Path(os.environ["ARCHIVE_DIR"]) if os.environ.get("ARCHIVE_DIR") else root.parent / f"{root.name}-archive"
    return base / datetime.now(timezone.utc).strftime("%Y-%m-%d_%H%M%S")


def archive(root: Path, dest: Path, keep_cache: bool = False) -> list[tuple[str, str, int, str]]:
    """Archives `root`'s built data into `dest`. Returns (action, relative path, size, sha256) for every file.
    Raises FileExistsError if `dest` already holds anything, and RuntimeError (leaving the original in place) if a copy
    does not hash the same as its source."""
    if dest.exists() and any(dest.iterdir()):
        raise FileExistsError(f"{dest} already exists and is not empty; an archive is never overwritten")
    moved, copied = plan(root, keep_cache)
    rows = []
    for action, files in (("copied", copied), ("moved", moved)):
        for src in files:
            rel = src.relative_to(root)
            target = dest / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            before = sha256(src)
            shutil.copy2(src, target)
            if sha256(target) != before:
                raise RuntimeError(f"the copy of {rel} does not match the original; stopped, nothing further was removed")
            if action == "moved":
                src.unlink()
            rows.append((action, str(rel), target.stat().st_size, before))
    return rows


def write_manifest(root: Path, dest: Path, rows: list[tuple[str, str, int, str]]) -> None:
    lines = [f"# Archive of {root}", f"# Made {datetime.now(timezone.utc).isoformat(timespec='seconds')}",
             "#",
             "# moved  = taken out of the project (the databases, what is served from them, the logs);",
             "# copied = still in the project: settings and hand-made inputs as they were at this moment, and files the",
             "#          next build rewrites.",
             "#", f"# {'action':7} {'size':>12}  {'sha256':64}  path"]
    lines += [f"{a:7} {s:>12,}  {h}  {rel}" for a, rel, s, h in rows]
    (dest / "MANIFEST.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")


def in_container() -> bool:
    return Path("/.dockerenv").exists() or Path("/run/.containerenv").exists()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--to", help="where to put the archive (default ../<project>-archive/<timestamp>/)")
    ap.add_argument("--yes", action="store_true", help="do not ask for confirmation")
    ap.add_argument("--dry-run", action="store_true", help="show what would happen and change nothing")
    ap.add_argument("--keep-cache", action="store_true",
                    help="leave data/api_cache.db (API responses already fetched) in the project")
    ap.add_argument("--root", default=str(ROOT), help=argparse.SUPPRESS)
    args = ap.parse_args(argv)
    if not args.to and not os.environ.get("ARCHIVE_DIR") and in_container():
        print(
            "Error: running inside a container without --to or ARCHIVE_DIR would write the archive to the "
            "container's ephemeral filesystem and lose the moved data on exit. Pass ARGS='--to /app/archive' or set ARCHIVE_DIR.",
            file=sys.stderr,
        )
        return 1
    root = Path(args.root).resolve()
    dest = Path(args.to).resolve() if args.to else default_destination(root)
    moved, copied = plan(root, args.keep_cache)
    if not moved:
        print("Nothing to archive: the project holds no built data.")
        return 0
    print(f"Archive to {dest}\n")
    print("MOVED out of the project:")
    for p in moved:
        print(f"  {p.relative_to(root)}  ({human(p.stat().st_size)})")
    print("\nCOPIED (stay in the project):")
    for p in copied:
        print(f"  {p.relative_to(root)}")
    print(f"\nTotal moved: {human(sum(p.stat().st_size for p in moved))}. Left alone: .env, data/models, every input"
          f"{', data/api_cache.db (--keep-cache)' if args.keep_cache else ''}.")
    if args.dry_run:
        print("\nDry run: nothing changed.")
        return 0
    if dest.exists() and any(dest.iterdir()):
        print(f"\nError: {dest} already exists and is not empty.", file=sys.stderr)
        return 1
    if not args.yes:
        if not sys.stdin.isatty():
            print("\nNot confirmed: run in a terminal, or pass --yes.", file=sys.stderr)
            return 1
        if input("\nStop the server and any pipeline run first. Archive these now? Type yes: ").strip().lower() != "yes":
            print("Nothing changed.")
            return 1
    rows = archive(root, dest, args.keep_cache)
    write_manifest(root, dest, rows)
    print(f"\nArchived {sum(r[0] == 'moved' for r in rows)} files and copied {sum(r[0] == 'copied' for r in rows)} "
          f"to {dest} (MANIFEST.txt lists each with its SHA-256).")
    print("The project now holds no built data. Next: make all")
    return 0


if __name__ == "__main__":
    sys.exit(main())
