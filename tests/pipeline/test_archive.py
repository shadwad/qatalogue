"""make archive: what is moved, what is copied, what is left, and that nothing is lost or overwritten."""
import contextlib
import io
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import _env

_env.init()
from pipeline.scripts import archive_data


def write(root: Path, rel: str, content: str) -> Path:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)
    return path


class Archive(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="archive-"))
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.root = self.dir / "project"
        self.dest = self.dir / "archive" / "run1"
        # built data
        for rel in ("data/staging.db", "data/staging.db-wal", "data/staging.db-shm", "data/serve.db", "data/api_cache.db",
                    "data/staging.db.bak", "data/serve.db.tmp", "public/default-institutions.json.gz",
                    "public/default-researchers.json.gz.tmp", "logs/clean.log", "logs/import.log"):
            write(self.root, rel, f"built {rel}")
        # served settings the next build rewrites, reports, hand-made inputs
        for rel in ("public/config/venues.json", "public/config/corpus.json", "public/config/taxonomy.json",
                    "data/topics/assignment_report.md", "data/taxonomy.json", "data/topics/answer_key.json",
                    "data/article_overrides.json", "pipeline/config/scope.json", "pipeline/config/embedding.json"):
            write(self.root, rel, f"keep {rel}")
        # never touched
        write(self.root, ".env", "SECRET=1")
        write(self.root, "data/models/Xenova/model.onnx", "weights")
        write(self.root, "data/topics/discovery.json", "clusters")
        write(self.root, "public/config/location_mapping.json", "locations")

    def run_main(self, *args, stdin_tty=False, answer="yes"):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err), \
                mock.patch("sys.stdin.isatty", return_value=stdin_tty), mock.patch("builtins.input", return_value=answer):
            code = archive_data.main(["--root", str(self.root), "--to", str(self.dest), *args])
        return code, out.getvalue(), err.getvalue()

    def test_built_data_is_moved_and_the_rest_is_copied_or_left(self):
        code, out, _ = self.run_main("--yes")
        self.assertEqual(code, 0)
        for rel in ("data/staging.db", "data/staging.db-wal", "data/staging.db-shm", "data/serve.db", "data/api_cache.db",
                    "data/staging.db.bak", "data/serve.db.tmp", "public/default-institutions.json.gz",
                    "public/default-researchers.json.gz.tmp", "logs/clean.log", "logs/import.log"):
            self.assertFalse((self.root / rel).exists(), f"{rel} should have left the project")
            self.assertEqual((self.dest / rel).read_text(), f"built {rel}")
        for rel in ("public/config/venues.json", "public/config/corpus.json", "public/config/taxonomy.json",
                    "data/topics/assignment_report.md", "data/taxonomy.json", "data/topics/answer_key.json",
                    "data/article_overrides.json", "pipeline/config/scope.json", "pipeline/config/embedding.json"):
            self.assertEqual((self.root / rel).read_text(), f"keep {rel}", f"{rel} must stay in the project")
            self.assertEqual((self.dest / rel).read_text(), f"keep {rel}", f"{rel} must also be archived")
        for rel in (".env", "data/models/Xenova/model.onnx", "data/topics/discovery.json", "public/config/location_mapping.json"):
            self.assertTrue((self.root / rel).exists(), f"{rel} must be left alone")
            self.assertFalse((self.dest / rel).exists(), f"{rel} is not built data and is not archived")
        self.assertIn("The project now holds no built data", out)

    def test_the_manifest_lists_every_file_with_a_checksum_that_matches(self):
        self.run_main("--yes")
        lines = (self.dest / "MANIFEST.txt").read_text().splitlines()
        rows = [l.split() for l in lines if l.startswith(("moved", "copied"))]
        self.assertEqual(sum(r[0] == "moved" for r in rows), 11)
        self.assertEqual(sum(r[0] == "copied" for r in rows), 9)
        for action, _size, digest, rel in rows:
            self.assertEqual(archive_data.sha256(self.dest / rel), digest, rel)

    def test_keep_cache_leaves_the_api_response_cache_in_place(self):
        write(self.root, "data/api_cache.db-wal", "cache wal")
        code, out, _ = self.run_main("--yes", "--keep-cache")
        self.assertEqual(code, 0)
        for rel in ("data/api_cache.db", "data/api_cache.db-wal"):
            self.assertTrue((self.root / rel).exists(), f"{rel} must stay with --keep-cache")
            self.assertFalse((self.dest / rel).exists())
        self.assertFalse((self.root / "data/serve.db").exists())
        self.assertIn("--keep-cache", out)
        rows = [l.split() for l in (self.dest / "MANIFEST.txt").read_text().splitlines() if l.startswith("moved")]
        self.assertEqual(len(rows), 10)  # the 11 moved normally, plus the extra -wal file, less the two cache files kept

    def test_a_dry_run_changes_nothing(self):
        code, out, _ = self.run_main("--dry-run")
        self.assertEqual(code, 0)
        self.assertIn("data/serve.db", out)
        self.assertTrue((self.root / "data/serve.db").exists())
        self.assertFalse(self.dest.exists())

    def test_it_asks_first_and_does_nothing_unless_told_yes(self):
        code, _, _ = self.run_main(stdin_tty=True, answer="no")
        self.assertEqual(code, 1)
        self.assertTrue((self.root / "data/serve.db").exists())
        self.assertFalse(self.dest.exists())
        code, _, _ = self.run_main(stdin_tty=True, answer="yes")
        self.assertEqual(code, 0)
        self.assertFalse((self.root / "data/serve.db").exists())

    def test_without_a_terminal_it_will_not_proceed_unconfirmed(self):
        code, _, err = self.run_main(stdin_tty=False)
        self.assertEqual(code, 1)
        self.assertIn("pass --yes", err)
        self.assertTrue((self.root / "data/serve.db").exists())

    def test_an_existing_archive_is_never_overwritten(self):
        write(self.dest.parent, "run1/earlier.txt", "an earlier archive")
        code, _, err = self.run_main("--yes")
        self.assertEqual(code, 1)
        self.assertIn("already exists", err)
        self.assertTrue((self.root / "data/serve.db").exists())
        self.assertEqual((self.dest / "earlier.txt").read_text(), "an earlier archive")

    def test_a_damaged_copy_stops_the_run_and_keeps_the_original(self):
        real = archive_data.shutil.copy2

        def damaging_copy(src, dst, *a, **k):
            result = real(src, dst, *a, **k)
            if Path(src).name == "serve.db":
                Path(dst).write_text("corrupted in transit")
            return result

        with mock.patch.object(archive_data.shutil, "copy2", damaging_copy):
            with self.assertRaises(RuntimeError):
                archive_data.archive(self.root, self.dest)
        self.assertEqual((self.root / "data/serve.db").read_text(), "built data/serve.db")

    def test_a_project_with_no_built_data_says_so(self):
        for rel in ("data", "public/default-institutions.json.gz", "logs"):
            target = self.root / rel
            shutil.rmtree(target) if target.is_dir() else target.unlink()
        (self.root / "public/default-researchers.json.gz.tmp").unlink()
        code, out, _ = self.run_main("--yes")
        self.assertEqual(code, 0)
        self.assertIn("Nothing to archive", out)
        self.assertFalse(self.dest.exists())

    def test_staged_config_tmp_files_are_moved(self):
        write(self.root, "public/config/taxonomy.json.tmp", "staged taxonomy")
        code, _, _ = self.run_main("--yes")
        self.assertEqual(code, 0)
        self.assertFalse((self.root / "public/config/taxonomy.json.tmp").exists())
        self.assertEqual((self.dest / "public/config/taxonomy.json.tmp").read_text(), "staged taxonomy")

    def test_container_without_destination_refuses_ephemeral_archive(self):
        out, err = io.StringIO(), io.StringIO()
        env = {k: v for k, v in os.environ.items() if k != "ARCHIVE_DIR"}
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err), \
                mock.patch.object(archive_data, "in_container", return_value=True), \
                mock.patch.dict(os.environ, env, clear=True):
            code = archive_data.main(["--root", str(self.root), "--yes"])
        self.assertEqual(code, 1)
        self.assertIn("--to or ARCHIVE_DIR", err.getvalue())
        self.assertTrue((self.root / "data/serve.db").exists())

        with mock.patch.object(archive_data, "in_container", return_value=True):
            ok_code, _, _ = self.run_main("--yes")
        self.assertEqual(ok_code, 0)
        self.assertFalse((self.root / "data/serve.db").exists())


if __name__ == "__main__":
    unittest.main()
