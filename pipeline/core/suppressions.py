"""Optional author exclusion list loaded from data/suppressions.json."""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_PATH = Path(__file__).resolve().parents[2] / "data" / "suppressions.json"
ORCID_RE = re.compile(r"(\d{4}-\d{4}-\d{4}-\d{3}[\dXx])")
ENTRY_KEYS = {"orcid", "openalex", "note"}


def suppressions_path() -> Path:
    """data/suppressions.json, or SUPPRESSIONS_PATH in the environment (a trial build, the tests)."""
    return Path(os.environ.get("SUPPRESSIONS_PATH") or DEFAULT_PATH)


def normalise_orcid(value) -> str | None:
    """The 16-character ORCID iD from a bare id or a URL, upper-cased; None if the value holds none."""
    m = ORCID_RE.search(value) if isinstance(value, str) else None
    return m.group(1).upper() if m else None


def normalise_openalex(value) -> str | None:
    """An OpenAlex id from a bare id or URL: its last path segment, upper-cased; None if empty or not one token."""
    if not isinstance(value, str):
        return None
    token = value.strip().rstrip("/").rsplit("/", 1)[-1].upper()
    return token if token and not any(c.isspace() for c in token) else None


@dataclass(frozen=True)
class Entry:
    orcid: str | None
    openalex: str | None


@dataclass
class Suppressions:
    entries: list[Entry] = field(default_factory=list)


def load(path: Path | None = None) -> Suppressions:
    """Parse suppressions JSON, raising ValueError (identifying entries by index) on invalid schema or ids."""
    path = Path(path) if path else suppressions_path()
    if not path.exists():
        return Suppressions()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"{path.name} is not valid JSON ({error.msg}, line {error.lineno})") from None
    authors = data.get("authors", []) if isinstance(data, dict) else None
    if not isinstance(authors, list):
        raise ValueError(f'{path.name} must be an object with an "authors" list')
    entries = []
    for i, raw in enumerate(authors, 1):
        if not isinstance(raw, dict):
            raise ValueError(f"{path.name}: entry {i} must be an object")
        unknown = set(raw) - ENTRY_KEYS
        if unknown:
            raise ValueError(f"{path.name}: entry {i} has unknown field(s) {sorted(unknown)}; allowed: {sorted(ENTRY_KEYS)}")
        orcid = normalise_orcid(raw["orcid"]) if raw.get("orcid") else None
        openalex = normalise_openalex(raw["openalex"]) if raw.get("openalex") else None
        if raw.get("orcid") and not orcid:
            raise ValueError(f"{path.name}: entry {i}: the orcid is not an ORCID iD (0000-0000-0000-0000)")
        if raw.get("openalex") and not openalex:
            raise ValueError(f"{path.name}: entry {i}: the openalex value is not an OpenAlex id")
        if not orcid and not openalex:
            raise ValueError(f'{path.name}: entry {i} needs an "orcid" or an "openalex" id')
        entries.append(Entry(orcid, openalex))
    return Suppressions(entries)


def suppressed_ids(conn, suppressions: Suppressions | None = None, table: str = "authors") -> tuple[set[str], int]:
    """(canonical author ids to hide, number of entries that matched no record) for a staging-shaped `table` of
    authors(author_id, orcid, canonical_author_id). A record matches by its ORCID or its id; the person hidden is the
    one it is merged into, so every record of that person goes with it."""
    sup = suppressions if suppressions is not None else load()
    by_orcid: dict[str, list[int]] = {}
    by_id: dict[str, list[int]] = {}
    for i, e in enumerate(sup.entries):
        if e.orcid:
            by_orcid.setdefault(e.orcid, []).append(i)
        if e.openalex:
            by_id.setdefault(e.openalex, []).append(i)
    hidden: set[str] = set()
    matched: set[int] = set()
    if not sup.entries:
        return hidden, 0
    for author_id, orcid, canonical in conn.execute(f"SELECT author_id, orcid, canonical_author_id FROM {table}"):
        hits = set(by_orcid.get(normalise_orcid(orcid), ())) | set(by_id.get(normalise_openalex(author_id), ()))
        if hits:
            matched |= hits
            hidden.add(canonical or author_id)
    return hidden, len(sup.entries) - len(matched)


def apply_to_served_authors(serve_conn, table: str = "staging.authors") -> int:
    """Blanks and flags the suppressed people in the served `authors` table (and returns how many); call it after the
    shown affiliations are set, which would otherwise fill them in again."""
    ids, _unmatched = suppressed_ids(serve_conn, table=table)
    if not ids:
        return 0
    serve_conn.executemany(
        "UPDATE main.authors SET name = NULL, orcid = NULL, latest_affiliation = NULL, latest_location_code = NULL,"
        " is_placeholder = 1 WHERE author_id = ?", [(i,) for i in sorted(ids)])
    return len(ids)
