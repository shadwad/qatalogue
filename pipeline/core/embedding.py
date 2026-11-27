"""
Embedding configuration loader for `pipeline/config/embedding.json` (shared between pipeline indexing
and server query embedding). Enforces a 40-character commit `revision` and formats `model@revision`
for index compatibility checks.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

CONFIG_PATH = Path(__file__).resolve().parents[1] / "config" / "embedding.json"
_COMMIT = re.compile(r"^[0-9a-f]{40}$")


def load_config(path: Path = CONFIG_PATH) -> dict:
    cfg = json.loads(Path(path).read_text(encoding="utf-8"))
    if not _COMMIT.match(str(cfg.get("revision", ""))):
        raise ValueError(f"{path}: revision must be a full 40-character commit hash of the model repository, "
                         f"got {cfg.get('revision')!r}")
    return cfg


def model_id(cfg: dict) -> str:
    return f"{cfg['model']}@{cfg['revision']}"
