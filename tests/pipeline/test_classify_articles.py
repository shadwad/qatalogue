import json
import sqlite3
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import _env

_env.init()
from pipeline.scripts import classify_articles, fetch_article_types


def paper_row(**overrides):
    row = {
        "paper_id": "W1",
        "title": "Fault-tolerant surface code threshold",
        "venue": "Physical Review X",
        "doi": "10.1103/physrevx.14.011001",
        "authors": 3,
        "work_type": "article",
        "abstract": "We measure logical error suppression across distance-5 surface codes.",
        "arxiv": None,
        "psource": None,
        "ptype": None,
        "pstatus": None,
    }
    row.update(overrides)
    return row


class ClassifyArticlesTests(unittest.TestCase):
    def test_publisher_kind_nature_and_aps(self):
        self.assertEqual(classify_articles.publisher_kind("nature", "Article"), "research")
        self.assertEqual(classify_articles.publisher_kind("nature", "OriginalPaper"), "research")
        self.assertEqual(classify_articles.publisher_kind("nature", "BriefCommunication"), "research")
        self.assertEqual(classify_articles.publisher_kind("nature", "News & Views"), "news")
        self.assertEqual(classify_articles.publisher_kind("nature", "Review Article"), "review")
        self.assertEqual(classify_articles.publisher_kind("nature", "ReviewPaper"), "review")
        self.assertEqual(classify_articles.publisher_kind("nature", "EditorialNotes"), "editorial")
        self.assertEqual(classify_articles.publisher_kind("aps", "letter"), "research")
        self.assertEqual(classify_articles.publisher_kind("aps", "Comment"), "comment")
        self.assertEqual(classify_articles.publisher_kind("aps", "Erratum"), "erratum")

    def test_text_kind_and_priority_order(self):
        self.assertEqual(classify_articles.text_kind("Tutorial: Quantum Error Correction", ""), ("tutorial", "title"))
        self.assertEqual(classify_articles.text_kind("Quantum Sensing: A Review", ""), ("review", "title"))
        self.assertEqual(classify_articles.text_kind("Some Title", "In this Perspective, we examine trends."), ("perspective", "abstract"))

        # Override beats publisher type; publisher type beats OpenAlex/DOI; OpenAlex beats text heuristics.
        r = paper_row(psource="nature", ptype="Review Article", pstatus="ok", work_type="article")
        self.assertEqual(classify_articles.classify(r, {"kind": "research", "note": "verified"}), ("research", "override: verified"))
        self.assertEqual(classify_articles.classify(r, None)[0], "review")

        self.assertEqual(classify_articles.classify(paper_row(work_type="editorial"), None)[0], "editorial")
        self.assertEqual(classify_articles.classify(paper_row(doi="10.1038/d41586-024-00001-1"), None)[0], "news")
        self.assertEqual(
            classify_articles.classify(paper_row(venue="Science", abstract="Short news teaser."), None)[0],
            "news",
        )
        self.assertEqual(
            classify_articles.classify(paper_row(doi="10.1038/s41567-024-00001-1", abstract="", authors=1), None)[0],
            "perspective",
        )
        self.assertEqual(classify_articles.classify(paper_row(), None), ("research", ""))

    def test_write_report_handles_empty_rows_without_zero_division(self):
        with tempfile.TemporaryDirectory(prefix="qatalogue-classify-") as td:
            orig = classify_articles.REPORT
            classify_articles.REPORT = Path(td) / "report.md"
            try:
                classify_articles.write_report([], {}, [])
                text = classify_articles.REPORT.read_text()
                self.assertIn("0 papers in staging", text)
            finally:
                classify_articles.REPORT = orig

    def test_extract_nature_type(self):
        self.assertEqual(
            fetch_article_types.extract_nature_type({"genre": ["OriginalPaper", "Article"], "contentType": "Article"}),
            ("OriginalPaper", "OriginalPaper ; Article"),
        )
        self.assertEqual(
            fetch_article_types.extract_nature_type({"genre": ["ReviewPaper", "Article"], "contentType": "Article"}),
            ("ReviewPaper", "ReviewPaper ; Article"),
        )
        self.assertEqual(
            fetch_article_types.extract_nature_type({"genre": ["News", "News & Views"], "contentType": "Article"}),
            ("News & Views", "News ; News & Views"),
        )
        self.assertEqual(
            fetch_article_types.extract_nature_type({"genre": ["Article"], "contentType": "Article"}),
            ("Article", "Article"),
        )
        self.assertEqual(
            fetch_article_types.extract_nature_type({"genre": "ReviewPaper", "contentType": "Article"}),
            ("ReviewPaper", "Article"),
        )
        self.assertEqual(
            fetch_article_types.extract_nature_type({"contentType": "Article"}),
            ("Article", "Article"),
        )
        self.assertEqual(fetch_article_types.extract_nature_type({}), (None, None))

    def test_run_nature_skips_without_key_and_saves_meta_api_batches(self):
        conn = sqlite3.connect(":memory:")
        self.addCleanup(conn.close)
        conn.execute("CREATE TABLE papers (paper_id TEXT PRIMARY KEY, doi TEXT)")
        conn.execute("CREATE TABLE paper_text (paper_id TEXT PRIMARY KEY, abstract_openalex TEXT, arxiv_abstract TEXT)")
        conn.executemany(
            "INSERT INTO papers VALUES (?, ?)",
            [
                ("W1", "10.1038/s41567-024-00001-1"),
                ("W2", "10.1038/s41534-024-00002-2"),
                ("W3", "10.1038/s41467-024-00003-3"),
            ],
        )
        fetch_article_types.ensure_table(conn)

        fetch_article_types.run_nature(conn, refresh=False, limit=None, api_key="")
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM paper_publisher_types").fetchone()[0], 0)

        responses = [
            (
                200,
                json.dumps({
                    "records": [
                        {"doi": "10.1038/s41567-024-00001-1", "genre": ["OriginalPaper", "Article"], "contentType": "Article"},
                        {"doi": "10.1038/s41534-024-00002-2", "genre": ["News", "News & Views"], "contentType": "Article"},
                    ],
                }).encode("utf-8"),
            ),
            (429, b""),
        ]
        seen = []

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                seen.append(self.path)
                status, body = responses[min(len(seen) - 1, len(responses) - 1)]
                self.send_response(status)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.addCleanup(lambda: (httpd.shutdown(), httpd.server_close()))
        threading.Thread(target=httpd.serve_forever, daemon=True).start()

        orig_url = fetch_article_types.SPRINGER_API_URL
        orig_batch = fetch_article_types.NATURE_BATCH
        orig_delay = fetch_article_types.NATURE_DELAY
        orig_req = fetch_article_types.request
        fetch_article_types.SPRINGER_API_URL = f"http://127.0.0.1:{httpd.server_port}/meta/v2/json"
        fetch_article_types.NATURE_BATCH = 2
        fetch_article_types.NATURE_DELAY = 0
        fetch_article_types.request = lambda *a, **k: orig_req(*a, **{**k, "backoff": lambda _: 0})
        try:
            fetch_article_types.run_nature(conn, refresh=False, limit=None, api_key="test-key")
        finally:
            fetch_article_types.SPRINGER_API_URL = orig_url
            fetch_article_types.NATURE_BATCH = orig_batch
            fetch_article_types.NATURE_DELAY = orig_delay
            fetch_article_types.request = orig_req

        rows = {
            r[0]: r[1:]
            for r in conn.execute("SELECT paper_id, source, publisher_type, detail, status FROM paper_publisher_types")
        }
        self.assertEqual(rows["W1"], ("nature", "OriginalPaper", "OriginalPaper ; Article", "ok"))
        self.assertEqual(rows["W2"], ("nature", "News & Views", "News ; News & Views", "ok"))
        # HTTP 429 stops cleanly instead of marking W3 unavailable.
        self.assertNotIn("W3", rows)
        self.assertGreaterEqual(len(seen), 2)
        self.assertIn("api_key=test-key", seen[0])


if __name__ == "__main__":
    unittest.main()
