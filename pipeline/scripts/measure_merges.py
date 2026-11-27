#!/usr/bin/env python3
"""
Evaluate author disambiguation precision and recall by masking a random fraction of ORCIDs in staging.

Reads staging without modifying the live database or merge audit log.

Usage
  python pipeline/scripts/measure_merges.py [--hide 0.5] [--seed 1] [--old] [--extra]
    --old    also score unconstrained connected components on the same evidence graph
    --extra  include plugins configured in EXTRA_EVIDENCE
"""
from __future__ import annotations

import argparse
import logging
import random
from collections import Counter, defaultdict
from itertools import combinations

import networkx as nx

from pipeline.core.scoring_config import MERGE_THRESHOLD
from pipeline.stages.pairwise_scoring import _build_author_records, apply_scored_merges, collect_pairwise_evidence


def connected_components(G) -> dict[str, str]:
    """The earlier rule: every chain of edges above the threshold is one person."""
    H = G.edge_subgraph([(u, v) for u, v, d in G.edges(data=True) if d.get('weight', 0) >= MERGE_THRESHOLD])
    out = {}
    for comp in nx.connected_components(H):
        root = min(comp, key=lambda x: (len(x), x))
        for node in comp:
            out[node] = root
    return out


def score(person_of: dict[str, str], truth: dict[str, str], hidden: set[str]) -> dict:
    """Pair counts over records with a known ORCID where at least one of the two had it hidden."""
    def person(a):
        return person_of.get(a, a)
    by_orcid = defaultdict(list)
    for a, o in truth.items():
        by_orcid[o].append(a)
    same = same_merged = 0
    for recs in by_orcid.values():
        for a, b in combinations(recs, 2):
            if a in hidden or b in hidden:
                same += 1
                same_merged += person(a) == person(b)
    groups = defaultdict(list)
    for a in truth:
        groups[person(a)].append(a)
    merged = merged_same = 0
    for recs in groups.values():
        for a, b in combinations(recs, 2):
            if a in hidden or b in hidden:
                merged += 1
                merged_same += truth[a] == truth[b]
    return {'recall': same_merged / same if same else 0.0, 'precision': merged_same / merged if merged else 1.0,
            'same_pairs': same, 'merged_pairs': merged, 'wrong_pairs': merged - merged_same}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--hide', type=float, default=0.5, help='share of ORCID records whose ORCID is hidden')
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--old', action='store_true')
    ap.add_argument('--extra', action='store_true')
    args = ap.parse_args()
    logging.disable(logging.INFO)

    authors = _build_author_records()
    truth = {a.id: a.orcid for a in authors if a.orcid}
    rng = random.Random(args.seed)
    hidden = {a for a in sorted(truth) if rng.random() < args.hide}
    for a in authors:
        if a.id in hidden:
            a.orcid = None
    G = collect_pairwise_evidence(authors)
    if args.extra:
        from pipeline.core.extra_evidence import add_extra_evidence
        add_extra_evidence(G, authors)

    merges, refused = apply_scored_merges(G, authors, audit=False)
    new = score(merges, truth, hidden)
    shared = sum(1 for n in Counter(truth.values()).values() if n > 1)
    print(f"{len(truth):,} records with an ORCID, {len(hidden):,} hidden; {shared:,} ORCIDs on 2+ records")
    print(f"constrained clustering: recall {new['recall']:.3f} ({new['same_pairs']:,} same-ORCID pairs), "
          f"precision {new['precision']:.3f} ({new['wrong_pairs']:,} wrong of {new['merged_pairs']:,} merged pairs)")
    if args.old:
        old = score(connected_components(G), truth, hidden)
        print(f"connected components:   recall {old['recall']:.3f}, precision {old['precision']:.3f} "
              f"({old['wrong_pairs']:,} wrong of {old['merged_pairs']:,} merged pairs)")


if __name__ == '__main__':
    main()
