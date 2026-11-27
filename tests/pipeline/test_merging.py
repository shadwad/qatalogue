import random
import unittest

import networkx as nx

import _env

_env.init()
from pipeline.core.author import AuthorRecord
from pipeline.core.scoring_config import MERGE_THRESHOLD
from pipeline.stages.pairwise_scoring import apply_scored_merges


def person(id, name, papers, orcid=None):
    return AuthorRecord(id=id, name=name, orcid=orcid, paper_ids=set(papers))


def graph(*edges):
    G = nx.Graph()
    for u, v, weight, *reasons in edges:
        G.add_edge(u, v, weight=weight, reasons=list(reasons))
    return G


class ScoredMerges(unittest.TestCase):
    def test_records_joined_by_strong_evidence_become_one_person_with_the_fuller_name(self):
        authors = [person("A2", "W. Wang", ["p2"]), person("A1", "Wei Wang", ["p1"])]
        merges, refused = apply_scored_merges(graph(("A1", "A2", 2.5, "name_match")), authors)
        self.assertEqual(merges, {"A2": "A1"})
        self.assertEqual(sum(refused.values()), 0)

    def test_evidence_below_the_threshold_joins_nothing(self):
        authors = [person("A1", "Wei Wang", ["p1"]), person("A2", "Wei Wang", ["p2"])]
        merges, _ = apply_scored_merges(graph(("A1", "A2", MERGE_THRESHOLD - 0.1, "name_match")), authors)
        self.assertEqual(merges, {})

    def test_two_different_orcids_are_never_one_person_on_weak_evidence(self):
        authors = [person("A1", "Wei Wang", ["p1"], "0000-0001"), person("A2", "Wei Wang", ["p2"], "0000-0002")]
        merges, refused = apply_scored_merges(graph(("A1", "A2", 5.0, "name_match")), authors)
        self.assertEqual(merges, {})
        self.assertEqual(refused["different ORCIDs"], 1)

    def test_a_person_never_appears_twice_on_one_paper(self):
        authors = [person("A1", "Wei Wang", ["p1"]), person("A2", "Wei Wang", ["p1", "p2"])]
        merges, refused = apply_scored_merges(graph(("A1", "A2", 5.0, "name_match")), authors)
        self.assertEqual(merges, {})
        self.assertEqual(refused["both on one paper"], 1)

    def test_full_given_names_that_cannot_be_one_person_are_refused(self):
        authors = [person("A1", "Wei Wang", ["p1"]), person("A2", "Wen Wang", ["p2"])]
        merges, refused = apply_scored_merges(graph(("A1", "A2", 5.0, "name_match")), authors)
        self.assertEqual(merges, {})
        self.assertEqual(refused["different full names"], 1)

    def test_a_record_without_an_orcid_cannot_chain_two_orcids_together(self):
        authors = [person("A1", "Wei Wang", ["p1"], "0000-0001"), person("A3", "W. Wang", ["p3"]),
                   person("A2", "Wei Wang", ["p2"], "0000-0002")]
        merges, refused = apply_scored_merges(graph(("A1", "A3", 3.0, "name_match"), ("A3", "A2", 2.5, "name_match")), authors)
        self.assertEqual(merges, {"A3": "A1"})
        self.assertEqual(refused["different ORCIDs"], 1)

    def test_the_result_does_not_depend_on_the_order_the_evidence_arrived_in(self):
        authors = [person(f"A{i}", "Wei Wang" if i % 2 else "W. Wang", [f"p{i}"]) for i in range(8)]
        edges = [(f"A{i}", f"A{j}", 2.0 + ((i * 7 + j * 3) % 5) / 10, "name_match") for i in range(8) for j in range(i + 1, 8)]
        results = []
        for seed in range(6):
            rng = random.Random(seed)
            shuffled, order = list(edges), list(authors)
            rng.shuffle(shuffled)
            rng.shuffle(order)
            results.append(apply_scored_merges(graph(*shuffled), order)[0])
        self.assertTrue(all(r == results[0] for r in results))


if __name__ == "__main__":
    unittest.main()
