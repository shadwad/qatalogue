import importlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

import _env

SCRATCH = _env.init()
from pipeline.topics import classifier, clustering, data, reporting


def make_paper(pid, title, year=2024, venue="PRX Quantum", abstract="", keywords=(), concepts=(), arxiv=()):
    return {
        "id": pid,
        "title": title,
        "year": year,
        "venue": venue,
        "keywords": list(keywords),
        "concepts": list(concepts),
        "topics": [],
        "arxiv": list(arxiv),
        "abstract": abstract,
    }


class TopicDataTests(unittest.TestCase):
    def test_clean_title_and_parse_json(self):
        self.assertEqual(data.clean_title("Shor&amp;apos;s  <i>Algorithm</i> "), "Shor's Algorithm")
        self.assertEqual(data.parse_json('["x"]', []), ["x"])
        self.assertEqual(data.parse_json("{broken", ["fallback"]), ["fallback"])
        self.assertEqual(data.parse_json(None, {}), {})

    def test_load_papers_on_empty_staging_returns_empty_arrays(self):
        _env.fresh_staging()
        papers, E = data.load_papers(SCRATCH / "staging.db", None, "any-model")
        self.assertEqual(papers, [])
        self.assertEqual(E.shape, (0, 0))

    def test_knn_handles_normal_single_and_empty_inputs(self):
        E = np.array([[1.0, 0.0], [0.9, 0.1], [0.0, 1.0], [-1.0, 0.0]], dtype=np.float32)
        E /= np.linalg.norm(E, axis=1, keepdims=True)
        idx, sim = data.knn(E, 2)
        self.assertEqual(idx.shape, (4, 2))
        self.assertEqual(int(idx[0, 0]), 1)
        self.assertGreater(float(sim[0, 0]), float(sim[0, 1]))

        idx1, sim1 = data.knn(E[:1], 5)
        self.assertEqual(idx1.shape, (1, 0))
        self.assertEqual(sim1.shape, (1, 0))

        idx0, sim0 = data.knn(np.zeros((0, 3), dtype=np.float32), 5)
        self.assertEqual(idx0.shape, (0, 0))
        self.assertEqual(sim0.shape, (0, 0))

    def test_probe_hits_and_paper_texts(self):
        papers = [
            make_paper(
                "P1",
                "Fault-Tolerant Error Correction",
                keywords=[["Surface Code", 0.9]],
                concepts=[["C1", "Quantum error correction", 2, 0.8], ["C2", "Physics", 0, 0.9]],
                arxiv=["quant-ph"],
                abstract="We benchmark logical qubits.",
            ),
            make_paper("P2", "Unrelated Study", keywords=[["Laser", 0.9]], abstract="No error correction here."),
        ]
        probes = {"qec": {"keywords": r"surface code", "arxiv": ["quant-ph"], "concepts": ["Quantum error correction"]}}
        self.assertEqual(data.probe_hits(papers, probes), {"qec": [0]})
        main, abst = data.paper_texts(papers)
        self.assertIn("quantum error correction", main[0])
        self.assertNotIn("physics", main[0])
        self.assertEqual(abst[0], "we benchmark logical qubits.")


class ClusteringTests(unittest.TestCase):
    def test_norm_keyword_relabel_ari_jaccard_distinctness_and_rank(self):
        self.assertEqual(clustering.norm_keyword("Quantum-Optics & Cavities!"), "quantum optic cavity")

        rel = clustering.relabel_by_size(np.array([5, 2, 2, 5, 2]))
        self.assertEqual(rel.tolist(), [1, 0, 0, 1, 0])

        self.assertAlmostEqual(clustering.ari(np.array([0, 0, 1, 1]), np.array([2, 2, 5, 5])), 1.0)
        bj = clustering.best_jaccard(np.array([0, 0, 1, 1]), np.array([0, 1, 1, 1]))
        self.assertAlmostEqual(float(bj[0]), 0.5)
        self.assertAlmostEqual(float(bj[1]), 2 / 3)

        mean_d, per_d = clustering.distinctness([
            [(1.0, "kw:a", 0.5, 2.0)],
            [(1.0, "kw:b", 0.5, 2.0)],
        ])
        self.assertAlmostEqual(mean_d, 1.0)
        self.assertEqual(per_d, [1.0, 1.0])

        rows = [
            {"resolution": 0.5, "eligible": True, "stability": 0.6, "distinctness": 0.5},
            {"resolution": 1.0, "eligible": True, "stability": 0.9, "distinctness": 0.9},
            {"resolution": 2.0, "eligible": False, "stability": 1.0, "distinctness": 1.0},
        ]
        winner = clustering.rank_score(rows, {"stability": 0.5, "distinctness": 0.5})
        self.assertIsNotNone(winner)
        self.assertEqual(winner["resolution"], 1.0)
        self.assertIsNone(rows[2]["score"])


class ClassifierAndReportingTests(unittest.TestCase):
    def test_build_features_handles_unseeded_subtopic_without_nan(self):
        tax = {
            "topics": [{
                "id": "T1",
                "name": "Computing",
                "subtopics": [
                    {"id": "S1", "name": "Circuits", "rules": {"keywords": r"qubit circuit"}},
                    {"id": "S2", "name": "Unmatched", "rules": {"keywords": r"nevermatchesanywhere"}},
                ],
            }],
            "platforms": [],
        }
        subs = classifier.subtopic_table(tax)
        papers = [
            make_paper("P1", "Superconducting Qubit Circuit Design", abstract="Low noise gates."),
            make_paper("P2", "Another Qubit Circuit Study", abstract="Two-qubit entangling gate."),
            make_paper("P3", "Photonic Interferometry", abstract="Linear optical elements."),
            make_paper("P4", "Quantum Sensing with NV Centres", abstract="Magnetic field sensitivity."),
        ]
        E = np.array([
            [1.0, 0.0, 0.0],
            [0.95, 0.3, 0.0],
            [0.1, 1.0, 0.0],
            [0.0, 0.1, 1.0],
        ], dtype=np.float32)
        E /= np.linalg.norm(E, axis=1, keepdims=True)
        F, seed_counts, main_texts = classifier.build_features(papers, E, subs)
        self.assertEqual(len(main_texts), 4)
        self.assertEqual(seed_counts.tolist(), [2, 0])
        for feat in classifier.FEATURES:
            self.assertFalse(np.isnan(F[feat]).any(), f"NaN in feature {feat}")

    def test_tune_thresholds_honors_explicit_floor_without_mutating_global(self):
        tax = {
            "topics": [{
                "id": "T1",
                "name": "Computing",
                "subtopics": [{"id": "S1", "name": "Circuits", "rules": {"keywords": r"qubit"}}],
            }],
            "platforms": [],
        }
        subs = classifier.subtopic_table(tax)
        key_papers = [
            {"paper_id": "P1", "labels": ["T1/S1"]},
            {"paper_id": "P2", "labels": []},
        ]
        Y, M = classifier.label_matrix(key_papers, subs)
        P = np.array([[0.85], [0.20]], dtype=np.float32)
        _, tau, tau_min, _ = classifier.tune_thresholds(P, Y, M, subs, key_papers, tau_min_floor=0.6)
        self.assertGreaterEqual(tau_min, 0.6)
        self.assertGreaterEqual(tau, 0.3)
        self.assertEqual(classifier.TAU_MIN_FLOOR, 0.5)

    def test_detect_platforms_and_reporting_helpers(self):
        papers = [
            make_paper("P1", "Rydberg atom array simulator"),
            make_paper("P2", "Exciton polariton condensate in atom array"),
            make_paper("P3", "Quantum dot single-photon emitter"),
            make_paper("P4", "Quantum dot laser threshold"),
        ]
        main, _ = data.paper_texts(papers)
        plats = classifier.detect_platforms(papers, {}, main)
        self.assertEqual(plats[0].get("neutral_atom"), "cold-atom keywords")
        self.assertNotIn("neutral_atom", plats.get(1, {}))
        self.assertEqual(plats[2].get("spin_semiconductor"), "quantum-dot keywords")
        self.assertNotIn("spin_semiconductor", plats.get(3, {}))

        self.assertEqual(reporting.no_nan({"x": float("nan"), "y": [1.5, float("nan")]}), {"x": None, "y": [1.5, None]})
        with tempfile.TemporaryDirectory(prefix="qatalogue-tax-") as td:
            out_path = Path(td) / "nested" / "taxonomy.json"
            reporting.export_public_taxonomy({"topics": [], "platforms": []}, out_path)
            self.assertEqual(json.loads(out_path.read_text()), {"topics": [], "platforms": []})

    def test_assign_topics_does_not_require_igraph_or_leidenalg(self):
        with mock.patch.dict(sys.modules, {"igraph": None, "leidenalg": None}):
            importlib.reload(data)
            importlib.reload(classifier)
            importlib.reload(reporting)
            import pipeline.scripts.assign_topics as assign_topics
            importlib.reload(assign_topics)
            self.assertTrue(callable(assign_topics.main))

    def test_validate_answer_key_overlap_rejects_empty_or_unlabelled_scope(self):
        import pipeline.scripts.assign_topics as assign_topics

        with self.assertRaisesRegex(ValueError, "Not enough papers"):
            assign_topics.validate_answer_key_overlap([], [])

        # Enough matched papers, but none with a subtopic-level training label
        random_only = [{"paper_id": f"W{i}", "why_sampled": "random", "labels": ["T1/S1"]} for i in range(6)]
        with self.assertRaisesRegex(ValueError, "Not enough papers"):
            assign_topics.validate_answer_key_overlap(random_only, [])

        unlabelled_train = [{"paper_id": f"W{i}", "why_sampled": "seed", "labels": []} for i in range(5)]
        with self.assertRaisesRegex(ValueError, "Not enough papers"):
            assign_topics.validate_answer_key_overlap(unlabelled_train, unlabelled_train)

        valid_train = [{"paper_id": f"W{i}", "why_sampled": "seed", "labels": ["T1/S1"]} for i in range(5)]
        assign_topics.validate_answer_key_overlap(valid_train, valid_train)


if __name__ == "__main__":
    unittest.main()
