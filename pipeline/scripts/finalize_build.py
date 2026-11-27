#!/usr/bin/env python3
"""
Atomically promote serve.db.tmp to serve.db along with updated default summaries and public config JSONs.

Switches serve.db.tmp out of WAL mode before renaming so no stale -wal sidecar remains beside serve.db,
and moves config/summary files first before swapping serve.db (which triggers server/services/db.ts reload).
"""
import gzip
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone

from pipeline.core.logger import setup_pipeline_logger
from pipeline.core.publish import DEFAULT_SUMMARIES, PUBLIC_DIR
from pipeline.core.scope import corpus_catalog, load_scope, venues_catalog
from pipeline.db.connection import SERVE_DB_PATH

logger = setup_pipeline_logger("finalize", "finalize.log")


class FinalizeError(Exception):
    """Something the swap needs is missing; nothing has been moved."""


def prepare(serve_path: str, public_dir: str, scope) -> list[tuple[str, str]]:
    """Checks the files a swap needs and writes the scope's lists as .tmp files. Returns (source, destination) pairs in the
    order to move them; raises FinalizeError, having moved nothing, when anything is missing."""
    tmp_db = serve_path + ".tmp"
    missing = [p for p in [tmp_db] + [os.path.join(public_dir, name + ".tmp") for name in DEFAULT_SUMMARIES]
               if not os.path.exists(p)]
    if missing:
        raise FinalizeError("missing: " + ", ".join(missing) + " (did the build steps fail?)")

    moves = [(os.path.join(public_dir, name + ".tmp"), os.path.join(public_dir, name)) for name in DEFAULT_SUMMARIES]
    # The site's venue list and its description of the corpus follow the scope the build served, so a new venue
    # appears with its papers. The server reads venues.json when the database changes; the methodology reads corpus.json.
    for name, content in (("venues.json", venues_catalog(scope)), ("corpus.json", corpus_catalog(scope))):
        target = os.path.join(public_dir, 'config', name)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target + '.tmp', 'w', encoding='utf-8') as f:
            json.dump(content, f, indent=2, ensure_ascii=False)
            f.write('\n')
        moves.append((target + '.tmp', target))
    for name in ("taxonomy.json", "location_mapping.json"):
        target = os.path.join(public_dir, 'config', name)
        if os.path.exists(target + '.tmp'):
            moves.append((target + '.tmp', target))
    moves.append((tmp_db, serve_path))  # last: the server switches when it sees this one
    return moves


def leave_wal_mode(db_path: str) -> None:
    """Analyses query planner statistics, folds the write-ahead log into the database and switches to default journal."""
    conn = sqlite3.connect(db_path)
    try:
        conn.execute("ANALYZE")
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        mode = conn.execute("PRAGMA journal_mode=DELETE").fetchone()[0]
    finally:
        conn.close()
    if mode != "delete":
        raise FinalizeError(f"could not switch {db_path} out of WAL mode (journal mode is {mode})")
    for suffix in ("-wal", "-shm"):
        if os.path.exists(db_path + suffix):
            os.remove(db_path + suffix)


def sync_default_summary_timestamps(tmp_db: str, public_dir: str) -> None:
    """Align staged default summaries' generated_at with the finalized serve.db mtime (UTC millisecond Z)."""
    st = os.stat(tmp_db)
    ts_ms = st.st_mtime_ns // 1_000_000
    os.utime(tmp_db, ns=(st.st_atime_ns, ts_ms * 1_000_000))
    stamp = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    for name in DEFAULT_SUMMARIES:
        staged = os.path.join(public_dir, name + ".tmp")
        if not os.path.exists(staged):
            continue
        try:
            with gzip.open(staged, "rt", encoding="utf-8") as handle:
                payload = json.load(handle)
        except (OSError, EOFError, ValueError):
            continue
        if not isinstance(payload, dict) or not isinstance(payload.get("metadata"), dict):
            continue
        payload["metadata"]["generated_at"] = stamp
        tmp_out = f"{staged}.{os.getpid()}.tmp"
        try:
            with gzip.GzipFile(tmp_out, mode="wb", mtime=0) as gz:
                gz.write(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
            os.replace(tmp_out, staged)
        except BaseException:
            if os.path.exists(tmp_out):
                os.remove(tmp_out)
            raise


def finalize(serve_path: str = SERVE_DB_PATH, public_dir: str = PUBLIC_DIR, scope=None) -> None:
    scope = scope or load_scope()
    moves = prepare(serve_path, public_dir, scope)
    leave_wal_mode(serve_path + ".tmp")
    sync_default_summary_timestamps(serve_path + ".tmp", public_dir)
    for src, dest in moves:
        os.replace(src, dest)
        logger.info(f"Moved {os.path.basename(src)} to {dest}")
    # A WAL left by the database this one replaces must not sit beside the new file.
    for suffix in ("-wal", "-shm"):
        if os.path.exists(serve_path + suffix):
            os.remove(serve_path + suffix)
            logger.info(f"Removed the old database's {suffix} file")


def main() -> int:
    logger.info("Putting the checked build live...")
    try:
        finalize()
    except FinalizeError as error:
        logger.error(f"Nothing was moved: {error}")
        return 1
    logger.info("Done. A running server switches to the new database within a second.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
