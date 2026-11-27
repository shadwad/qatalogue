import logging
from collections import defaultdict
import networkx as nx

from pipeline.core.author import AuthorRecord, MergeCandidate
from pipeline.core.disambiguation import names_match, names_match_with_inversion
from pipeline.core.placeholders import is_placeholder_name
from pipeline.core.audit import _audit
from pipeline.core.scoring_config import (MERGE_THRESHOLD, W_COAUTHOR, W_CONCEPT, W_INSTITUTION, W_NAME,
                                          W_NAME_INVERSION)

logger = logging.getLogger(__name__)

def _build_author_records():
    from pipeline.db.author_repo import build_author_records
    return build_author_records()

def _score_pair(a1: AuthorRecord, a2: AuthorRecord):
    score = 0.0
    reasons = []

    if a1.orcid and a2.orcid:
        if a1.orcid == a2.orcid:
            return MergeCandidate(a1.id, a2.id, 999.0, ["orcid_match"])
        else:
            return None

    # Stand-in names ("Anonymous", …) are different unknown people: never merge on name evidence.
    if is_placeholder_name(a1.name) or is_placeholder_name(a2.name):
        return None

    if a1.name_parts and a2.name_parts:
        # Check standard name match
        if names_match(a1.name_parts, a2.name_parts):
            score += W_NAME
            reasons.append("name_match")
        elif names_match_with_inversion(a1.name_parts, a2.name_parts):
            score += W_NAME_INVERSION
            reasons.append("name_inversion")
        else:
            return None # Must have at least some name match
    else:
        return None

    if a1.inst_ids and a2.inst_ids:
        if a1.inst_ids.intersection(a2.inst_ids):
            score += W_INSTITUTION
            reasons.append("shared_inst")

    if a1.coauthors and a2.coauthors:
        if a1.coauthors.intersection(a2.coauthors):
            score += W_COAUTHOR
            reasons.append("shared_coauthors")

    if a1.concepts and a2.concepts:
        if a1.concepts.intersection(a2.concepts):
            score += W_CONCEPT
            reasons.append("shared_concepts")

    keep, merge = (a1.id, a2.id) if (len(a1.id), a1.id) <= (len(a2.id), a2.id) else (a2.id, a1.id)
    return MergeCandidate(keep, merge, score, reasons)

def collect_pairwise_evidence(authors: list[AuthorRecord]) -> nx.Graph:
    """Block authors by normalized family name and build the weighted pairwise evidence graph."""
    blocks: dict[str, list[AuthorRecord]] = defaultdict(list)
    for a in authors:
        if not a.name_parts:
            continue
        family_name = a.name_parts[-1]
        blocks[family_name].append(a)

    G = nx.Graph()
    # Add all authors as nodes so we don't lose anyone (though we only care about merges)
    for a in authors:
        G.add_node(a.id, name=a.name)

    for block in blocks.values():
        if len(block) < 2:
            continue
        for i in range(len(block)):
            for j in range(i + 1, len(block)):
                a1, a2 = block[i], block[j]
                cand = _score_pair(a1, a2)
                if cand is not None:
                    if cand.score >= 1.5:
                        G.add_edge(a1.id, a2.id, weight=cand.score, reasons=cand.reasons)


    return G


# ══════════════════════════════════════════════════════════════════════════════
# PHASE 3 — DECISION & COMMIT
# ══════════════════════════════════════════════════════════════════════════════

def apply_scored_merges(G: nx.Graph, authors: list[AuthorRecord], *, audit: bool = True) -> tuple[dict[str, str], dict[str, int]]:
    """
    Join author records greedily by descending edge weight (tie-broken by ids).

    Refuses joins that merge distinct ORCIDs (unless both groups share an identical full given name,
    institution, and coauthors with <= 2 ORCIDs total), co-occur on the same paper, or have incompatible
    full given names. Selects each group's canonical id by full given name, highest paper count,
    shortest id, then lexicographical id; returns ({merged_id: canonical_id}, refusal_counts).
    """
    from collections import Counter
    from pipeline.core.disambiguation import given_names as _given, is_initials as _is_initials
    from pipeline.core.disambiguation import could_be_one_person as _could_be_one_person

    records = {a.id: a for a in authors}
    edges = sorted(
        ((d['weight'], min(u, v), max(u, v), frozenset(d.get('reasons') or ()))
         for u, v, d in G.edges(data=True) if d.get('weight', 0) >= MERGE_THRESHOLD),
        key=lambda e: (-e[0], e[1], e[2]),
    )
    parent: dict[str, str] = {}
    groups: dict[str, dict] = {}

    def find(x: str) -> str:
        if x not in parent:
            parent[x] = x
            a = records.get(x)
            given = _given(a.name) if a else []
            groups[x] = {
                'members': [x],
                'orcids': {a.orcid} if a and a.orcid else set(),
                'papers': set(a.paper_ids) if a else set(),
                'full_names': {tuple(given)} if given and not _is_initials(given) else set(),
            }
        root = x
        while parent[root] != root:
            root = parent[root]
        while parent[x] != root:
            parent[x], x = root, parent[x]
        return root

    refused = Counter()
    for _, u, v, reasons in edges:
        ru, rv = find(u), find(v)
        if ru == rv:
            continue
        A, B = groups[ru], groups[rv]
        if A['orcids'] and B['orcids'] and A['orcids'] != B['orcids']:
            same_full_name = {''.join(n) for n in A['full_names']} & {''.join(n) for n in B['full_names']}
            strong = {'shared_inst', 'shared_coauthors'} <= reasons
            if not (same_full_name and strong and len(A['orcids'] | B['orcids']) <= 2):
                refused['different ORCIDs'] += 1
                continue
        if A['papers'] & B['papers']:
            refused['both on one paper'] += 1
            continue
        if any(not _could_be_one_person(list(x), list(y)) for x in A['full_names'] for y in B['full_names']):
            refused['different full names'] += 1
            continue
        if len(A['members']) < len(B['members']):
            ru, rv, A, B = rv, ru, B, A
        parent[rv] = ru
        A['members'] += B['members']
        A['orcids'] |= B['orcids']
        A['papers'] |= B['papers']
        A['full_names'] |= B['full_names']
        del groups[rv]

    merged_into: dict[str, str] = {}
    for group in groups.values():
        if len(group['members']) < 2:
            continue
        canonical = min(group['members'], key=lambda x: (
            _is_initials(_given(records[x].name)) if x in records else True,
            -len(records[x].paper_ids) if x in records else 0, len(x), x))
        for node in sorted(group['members']):
            if node != canonical:
                merged_into[node] = canonical
                if audit:
                    _audit({"action": "merge", "id_keep": canonical, "id_merge": node, "reasons": ["scored_cluster"]})
    return merged_into, refused
