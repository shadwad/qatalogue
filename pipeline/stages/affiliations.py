"""
Recover institutions for authorships that OpenAlex left unmatched using printed affiliation strings:

  1. exact normalized string matching at >= 90% agreement elsewhere in staging;
  2. normalized organization prefix (before the first comma) with >= 3 matched uses at >= 90% agreement;
  3. ROR affiliation lookup when a chosen organization's non-acronym name appears as a whole phrase.

Results are written to staging.recovered_affiliations after reset_decisions().
"""
from __future__ import annotations

import json
import logging
import re
import unicodedata
from collections import Counter, defaultdict

from pipeline.db.connection import open_staging

logger = logging.getLogger("merge.affiliations")

AGREEMENT = 0.9   # share of a string's matched occurrences that must name the institution


def normalized(text: str | None) -> str:
    text = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode().lower()
    return " ".join(re.findall(r"[a-z0-9]+", text))


MIN_ORGANIZATION_USES = 3


def organization(text: str | None) -> str:
    """The organization part of an affiliation string: the text before the first comma, normalized."""
    return normalized((text or "").split(",")[0])


def known_strings(conn, key=normalized, min_uses: int = 1) -> dict[str, list[str]]:
    """key(string) -> the institutions OpenAlex matched it to in at least AGREEMENT of its uses (min_uses or more)."""
    uses = defaultdict(set)              # key -> (paper, author) occurrences
    by_inst = defaultdict(Counter)       # key -> institution -> occurrences
    for paper_id, author_id, string, inst in conn.execute("""
            SELECT paper_id, author_id, raw_affiliation_string, openalex_institution_id FROM authorships
            WHERE openalex_institution_id IS NOT NULL AND raw_affiliation_string IS NOT NULL"""):
        k = key(string)
        if k:
            uses[k].add((paper_id, author_id))
            by_inst[k][inst] += 1
    return {k: sorted(i for i, n in by_inst[k].items() if n >= AGREEMENT * len(uses[k]))
            for k in uses if len(uses[k]) >= min_uses}


def _ror_choice(string: str) -> str | None:
    """Return the chosen ROR id if a non-acronym name of that organization matches `string` as a whole phrase."""
    from pipeline.clients.ror_client import match_affiliation
    result = match_affiliation(string)
    text = f" {normalized(string)} "
    for item in (result or {}).get("items") or []:
        if not item.get("chosen"):
            continue
        org = item.get("organization") or {}
        names = [n.get("value") for n in org.get("names") or [] if "acronym" not in (n.get("types") or [])]
        names += [org.get("name")] + list(org.get("aliases") or []) + [l.get("label") for l in org.get("labels") or []]
        if any(n and f" {normalized(n)} " in text for n in names):
            return org.get("id", "").replace("https://ror.org/", "") or None
    return None


def _add_institution(conn, entity: dict) -> str:
    """Adds an OpenAlex institution to staging as OpenAlex returns it; returns its id."""
    inst_id = entity["id"].split("/")[-1]
    ror = (entity.get("ror") or "").replace("https://ror.org/", "") or None
    location = entity.get("country_code")
    conn.execute("""
        INSERT OR IGNORE INTO institutions (inst_id, ror, openalex_id, display_name, location_code)
        VALUES (?, ?, ?, ?, ?)
    """, (inst_id, ror, inst_id, entity.get("display_name"), location))
    return inst_id


def _institution_for_ror(conn, ror: str, cache: dict, oa_client=None) -> str | None:
    """Staging's institution with this ROR id, or the OpenAlex institution for it, added to staging."""
    if ror in cache:
        return cache[ror]
    row = conn.execute("SELECT inst_id FROM institutions WHERE ror = ? ORDER BY inst_id LIMIT 1",
                       (ror,)).fetchone()
    inst_id = row[0] if row else None
    if inst_id is None:
        if oa_client is None:
            from pipeline.clients.openalex_client import OpenAlexClient
            oa_client = OpenAlexClient()
        entity = oa_client.get_entity(f"institutions/ror:{ror}")
        if entity and entity.get("id"):
            inst_id = _add_institution(conn, entity)
    cache[ror] = inst_id
    return inst_id


def recover_affiliations(use_apis: bool = True) -> dict[str, int]:
    """Fills staging.recovered_affiliations. Returns counts by method."""
    oa_client = None
    if use_apis:
        from pipeline.clients.openalex_client import OpenAlexClient
        oa_client = OpenAlexClient()
    with open_staging() as conn:
        conn.execute("DELETE FROM recovered_affiliations")
        known = known_strings(conn)
        known_orgs = known_strings(conn, key=organization, min_uses=MIN_ORGANIZATION_USES)
        rows = conn.execute("""
            SELECT paper_id, author_id, raw_affiliation_strings FROM authorships
            WHERE openalex_institution_id IS NULL AND raw_affiliation_strings IS NOT NULL
            ORDER BY paper_id, author_id""").fetchall()
        ror_cache: dict[str, str | None] = {}
        counts = Counter()
        for paper_id, author_id, strings_json in rows:
            found = False
            for string in json.loads(strings_json):
                insts, method = known.get(normalized(string)) or [], "same string"
                if not insts:
                    insts, method = known_orgs.get(organization(string)) or [], "same organization"
                if not insts and use_apis:
                    ror = _ror_choice(string)
                    inst = _institution_for_ror(conn, ror, ror_cache, oa_client) if ror else None
                    insts, method = ([inst] if inst else []), "ROR"
                for inst in insts:
                    conn.execute("INSERT OR IGNORE INTO recovered_affiliations VALUES (?, ?, ?, ?, ?)",
                                 (paper_id, author_id, inst, string, method))
                    found = True
                if insts:
                    counts[method] += 1
            counts["rows recovered" if found else "rows not recovered"] += 1
    logger.info(f"  ✓  Affiliations recovered for {counts['rows recovered']:,} of {len(rows):,} author rows with no "
                f"institution (strings: {counts['same string']:,} same string, {counts['same organization']:,} same "
                f"organization, {counts['ROR']:,} ROR)")
    return dict(counts)
