"""Imported first by every pipeline test: points the pipeline at a scratch folder before any of its modules read their
paths, so a test run touches no database, audit file or log of the real project."""
import atexit
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRATCH = Path(tempfile.mkdtemp(prefix="qatalogue-pipeline-tests-"))
atexit.register(shutil.rmtree, SCRATCH, ignore_errors=True)
for name, value in {
    "STAGING_DB_PATH": SCRATCH / "staging.db",
    "SERVE_DB_PATH": SCRATCH / "serve.db",
    "CACHE_DB_PATH": SCRATCH / "api_cache.db",
    "MERGE_AUDIT_PATH": SCRATCH / "merge_audit",
    "PIPELINE_LOG_DIR": SCRATCH / "logs",
    "PUBLIC_DIR": SCRATCH / "public",
    "SUPPRESSIONS_PATH": SCRATCH / "suppressions.json",  # none here, whatever the project has
    "PIPELINE_CONSOLE_LEVEL": "WARNING",
}.items():
    os.environ[name] = str(value)
sys.path.insert(0, str(ROOT))

# The location mapping is generated from the data (`make locations`), so tests bring their own: the few codes they use.
_MAPPING = SCRATCH / "location_mapping.json"
_MAPPING.write_text(json.dumps({
    code: {"name": name, "region": region} for code, name, region in (
        ("US", "United States", "North America"), ("CN", "China", "Asia"), ("DE", "Germany", "Europe"), ("GB", "United Kingdom", "Europe"),
        ("FR", "France", "Europe"), ("JP", "Japan", "Asia"), ("AU", "Australia", "Oceania"), ("CA", "Canada", "North America"),
    )
}), encoding="utf-8")
os.environ["LOCATION_MAPPING_PATH"] = str(_MAPPING)

# Isolate tests from local edits to pipeline/config/scope.json (e.g., narrowed trial year ranges).
_SCOPE = SCRATCH / "scope.json"
_SCOPE.write_text(json.dumps({
    "years": {"start": 2017, "end": 2026},
    "corpus_topics": [{"openalex_id": "T10020", "name": "Quantum Information and Cryptography"}],
    "venues": [{"openalex_id": "S4210195673", "name": "PRX Quantum", "requires_topic_filter": True}],
}), encoding="utf-8")
os.environ["SCOPE_PATH"] = str(_SCOPE)


def init() -> Path:
    """Ensures scratch environment paths are initialized; returns SCRATCH."""
    return SCRATCH


def fresh_staging():
    """An empty staging database with the pipeline's tables."""
    for suffix in ("", "-wal", "-shm"):
        (SCRATCH / f"staging.db{suffix}").unlink(missing_ok=True)
    from pipeline.db.connection import init_db
    init_db()
