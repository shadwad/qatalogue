import gzip
import json
import os
import shutil
import sqlite3
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

import _env

_env.init()
from pipeline.core.publish import DEFAULT_SUMMARIES
from pipeline.core.scope import load_scope
from pipeline.scripts.check_build import check_default_summaries, check_serve
from pipeline.scripts.finalize_build import FinalizeError, finalize


def database(path, value, wal=False):
    conn = sqlite3.connect(path)
    if wal:
        conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("CREATE TABLE t (v TEXT)")
    conn.execute("INSERT INTO t VALUES (?)", (value,))
    conn.commit()
    conn.close()


def value(path):
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        return conn.execute("SELECT v FROM t").fetchone()[0]
    finally:
        conn.close()


class Finalize(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="finalize-"))
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.public = self.dir / "public"
        self.public.mkdir()
        self.live = str(self.dir / "serve.db")
        database(self.live, "old")
        database(self.live + ".tmp", "new", wal=True)
        for name in DEFAULT_SUMMARIES:
            (self.public / name).write_bytes(b"old")
            (self.public / (name + ".tmp")).write_bytes(b"new")

    def test_the_build_goes_live_without_a_wal_and_without_the_old_ones(self):
        Path(self.live + "-wal").write_bytes(b"x" * 64)   # left by the database being replaced
        Path(self.live + "-shm").write_bytes(b"x" * 64)
        finalize(self.live, str(self.public), load_scope())
        self.assertEqual(value(self.live), "new")
        self.assertFalse(os.path.exists(self.live + "-wal"))
        self.assertFalse(os.path.exists(self.live + "-shm"))
        self.assertFalse(os.path.exists(self.live + ".tmp"))
        conn = sqlite3.connect(self.live)
        self.assertEqual(conn.execute("PRAGMA journal_mode").fetchone()[0], "delete")
        conn.close()
        for name in DEFAULT_SUMMARIES:
            self.assertEqual((self.public / name).read_bytes(), b"new")
        self.assertTrue((self.public / "config" / "venues.json").exists())
        self.assertTrue((self.public / "config" / "corpus.json").exists())

    def test_a_missing_default_summary_stops_everything_before_anything_moves(self):
        (self.public / (DEFAULT_SUMMARIES[1] + ".tmp")).unlink()
        with self.assertRaises(FinalizeError):
            finalize(self.live, str(self.public), load_scope())
        self.assertEqual(value(self.live), "old")
        self.assertTrue(os.path.exists(self.live + ".tmp"))
        self.assertEqual((self.public / DEFAULT_SUMMARIES[0]).read_bytes(), b"old")
        self.assertFalse((self.public / "config").exists())

    def test_a_missing_database_stops_the_run(self):
        os.remove(self.live + ".tmp")
        with self.assertRaises(FinalizeError):
            finalize(self.live, str(self.public), load_scope())
        self.assertEqual((self.public / DEFAULT_SUMMARIES[0]).read_bytes(), b"old")

    def test_staged_config_files_are_promoted(self):
        cfg = self.public / "config"
        cfg.mkdir()
        (cfg / "taxonomy.json.tmp").write_text('{"topics":[]}\n', encoding="utf-8")
        (cfg / "location_mapping.json.tmp").write_text('{"US":{"name":"United States"}}\n', encoding="utf-8")
        finalize(self.live, str(self.public), load_scope())
        self.assertFalse((cfg / "taxonomy.json.tmp").exists())
        self.assertFalse((cfg / "location_mapping.json.tmp").exists())
        self.assertEqual((cfg / "taxonomy.json").read_text(encoding="utf-8"), '{"topics":[]}\n')
        self.assertEqual((cfg / "location_mapping.json").read_text(encoding="utf-8"), '{"US":{"name":"United States"}}\n')

    def test_default_summary_generated_at_matches_finalized_db_mtime(self):
        for name in DEFAULT_SUMMARIES:
            payload = gzip.compress(json.dumps({"entries": [], "metadata": {"generated_at": "1999-01-01T00:00:00.000Z"}}).encode("utf-8"))
            (self.public / (name + ".tmp")).write_bytes(payload)
        finalize(self.live, str(self.public), load_scope())
        mtime_ns = os.stat(self.live).st_mtime_ns
        self.assertEqual(mtime_ns % 1_000_000, 0)
        expected = datetime.fromtimestamp((mtime_ns // 1_000_000) / 1000, tz=timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        for name in DEFAULT_SUMMARIES:
            data = json.loads(gzip.decompress((self.public / name).read_bytes()))
            self.assertEqual(data["metadata"]["generated_at"], expected)


class Check(unittest.TestCase):
    def test_a_build_missing_a_table_the_site_reads_fails_the_check(self):
        tmp = Path(tempfile.mkdtemp(prefix="check-"))
        self.addCleanup(shutil.rmtree, tmp, True)
        database(str(tmp / "serve.db.tmp"), "x")
        failures = []
        check_serve(str(tmp / "serve.db.tmp"), failures)
        self.assertTrue(any("paper_facts" in f for f in failures), failures)

    def test_a_missing_default_summary_fails_the_check(self):
        tmp = Path(tempfile.mkdtemp(prefix="check-"))
        self.addCleanup(shutil.rmtree, tmp, True)
        (tmp / (DEFAULT_SUMMARIES[0] + ".tmp")).write_bytes(gzip.compress(b'{"entries":[]}'))
        failures = []
        check_default_summaries(failures, str(tmp))
        self.assertEqual(len(failures), 1)
        self.assertIn(DEFAULT_SUMMARIES[1], failures[0])

    def test_a_corrupt_default_summary_fails_the_check(self):
        tmp = Path(tempfile.mkdtemp(prefix="check-"))
        self.addCleanup(shutil.rmtree, tmp, True)
        (tmp / (DEFAULT_SUMMARIES[0] + ".tmp")).write_bytes(gzip.compress(b'{"metadata":{}}'))
        (tmp / (DEFAULT_SUMMARIES[1] + ".tmp")).write_bytes(gzip.compress(b'{"entries":[]}'))
        failures = []
        check_default_summaries(failures, str(tmp))
        self.assertEqual(len(failures), 1)
        self.assertIn(DEFAULT_SUMMARIES[0], failures[0])


if __name__ == "__main__":
    unittest.main()
