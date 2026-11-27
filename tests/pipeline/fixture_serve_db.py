"""Builds the hand-worked dataset of test_credit.py into a served database at argv[1], for tests/server/serverLists.test.ts.
Run from the project root: .venv/bin/python3 tests/pipeline/fixture_serve_db.py <path>."""
import shutil
import sys

import _env

_env.init()  # scratch paths first
from pipeline.db.connection import SERVE_TMP_PATH
from test_credit import build, stage

stage()
build().close()
shutil.copy(SERVE_TMP_PATH, sys.argv[1])
