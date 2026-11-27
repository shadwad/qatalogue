"""Optional EXTRA_EVIDENCE hook for additional author-merge evidence modules."""
from __future__ import annotations

import importlib

from pipeline.core.api_config import get_setting


def add_extra_evidence(G, authors) -> list[tuple[str, int | None, str]]:
    """Runs every module named in EXTRA_EVIDENCE; returns (label, count, detail) per module, count None when skipped."""
    out = []
    for name in (n.strip() for n in get_setting("EXTRA_EVIDENCE").split(",")):
        if not name:
            continue
        result = importlib.import_module(name).add_evidence(G, authors)
        out.append(result if result else (name, None, "no key or nothing to do"))
    return out
