"""Shared paper loading, text normalisation, kNN similarity, and probe helpers for topic workflows."""
from __future__ import annotations

import html
import json
import re
import sqlite3
from pathlib import Path

import numpy as np

from pipeline.db.connection import open_readonly

ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = ROOT / "pipeline/config/topic_discovery.json"
EMBED_CONFIG_PATH = ROOT / "pipeline/config/embedding.json"
TAXONOMY_PATH = ROOT / "data/taxonomy.json"

TAG_RE = re.compile(r"<[^>]+>")


def clean_title(t: str | None) -> str:
    t = t or ""
    for _ in range(3):  # some titles are escaped more than once (Shor&amp;apos;s)
        u = html.unescape(t)
        if u == t:
            break
        t = u
    return re.sub(r"\s+", " ", TAG_RE.sub("", t)).strip()


def parse_json(v, default):
    if not v:
        return default
    try:
        return json.loads(v)
    except (TypeError, ValueError):
        return default


def load_papers(db_path: Path, serve_path: Path | None, model: str):
    """Loads embedded research papers from staging, optionally restricted to papers present in serve_path."""
    with open_readonly(db_path) as con:
        # Research papers only: reviews, news, comments etc. (classify_articles.py) get no topic and train nothing.
        has_classes = con.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='paper_classes'").fetchone()
        research_only = ("WHERE p.paper_id NOT IN (SELECT paper_id FROM paper_classes WHERE is_research = 0)"
                         if has_classes else "")
        rows = con.execute(
            f"""
            SELECT p.paper_id, p.title, p.year, p.venue_name,
                   t.keywords, t.concepts, t.topics_detail, t.arxiv_categories,
                   COALESCE(t.abstract_openalex, t.arxiv_abstract), e.vec, e.dim
            FROM papers p
            JOIN paper_embeddings e ON e.paper_id = p.paper_id AND e.model = ?
            LEFT JOIN paper_text t ON t.paper_id = p.paper_id
            {research_only}
            ORDER BY p.paper_id
            """,
            (model,),
        ).fetchall()

    keep = None
    if serve_path and serve_path.exists():
        try:
            with open_readonly(serve_path) as s:
                keep = {r[0] for r in s.execute("SELECT paper_id FROM paper_facts")}
        except sqlite3.Error:
            keep = None

    papers, vecs = [], []
    for pid, title, year, venue, kw, con_, td, axc, abstract, vec, dim in rows:
        if keep is not None and pid not in keep:
            continue
        papers.append({
            "id": pid,
            "title": clean_title(title),
            "year": year,
            "venue": venue,
            "keywords": parse_json(kw, []),
            "concepts": parse_json(con_, []),
            "topics": parse_json(td, []),
            "arxiv": parse_json(axc, []),
            "abstract": abstract or "",
        })
        vecs.append(np.frombuffer(vec, dtype=np.float32, count=dim))

    if not vecs:
        return [], np.zeros((0, 0), dtype=np.float32)

    E = np.vstack(vecs).astype(np.float32)
    E /= np.linalg.norm(E, axis=1, keepdims=True) + 1e-12
    return papers, E


def knn(E: np.ndarray, k: int, block: int = 1024):
    """Exact cosine nearest-neighbour indices and similarities (excluding self)."""
    n = len(E)
    k_eff = min(k, max(0, n - 1))
    if n == 0 or k_eff == 0:
        return np.zeros((n, 0), np.int32), np.zeros((n, 0), np.float32)
    idx = np.empty((n, k_eff), np.int32)
    sim = np.empty((n, k_eff), np.float32)
    for s in range(0, n, block):
        S = E[s:s + block] @ E.T
        r = np.arange(S.shape[0])
        S[r, s + r] = -2.0
        part = np.argpartition(-S, k_eff, axis=1)[:, :k_eff]
        ps = np.take_along_axis(S, part, 1)
        order = np.argsort(-ps, axis=1)
        idx[s:s + block] = np.take_along_axis(part, order, 1)
        sim[s:s + block] = np.take_along_axis(ps, order, 1)
    return idx, sim


def probe_hits(papers, probes):
    """probe -> list of paper indexes where at least 2 of 4 sources agree."""
    out = {}
    for name, p in probes.items():
        kre = re.compile(p["keywords"], re.I) if p.get("keywords") else None
        tre = re.compile(p["text"], re.I) if p.get("text") else None
        cons = set(p.get("concepts") or [])
        cats = set(p.get("arxiv") or [])
        hits = []
        for i, d in enumerate(papers):
            v = 0
            if cons and any(len(c) >= 4 and c[1] in cons and (c[3] or 0) >= 0.3 for c in d["concepts"]):
                v += 1
            if kre and any(kre.search(k[0] if isinstance(k, list) else k) for k in d["keywords"]):
                v += 1
            if cats and any(a in cats for a in d["arxiv"]):
                v += 1
            if tre and tre.search(d["title"] + " " + d["abstract"]):
                v += 1
            if v >= 2:
                hits.append(i)
        out[name] = hits
    return out


def paper_texts(papers) -> tuple[list[str], list[str]]:
    """(title + keywords + specific concepts, abstract) per paper, lower-cased."""
    main, abst = [], []
    for p in papers:
        kws = " ; ".join((k[0] if isinstance(k, list) else k) for k in p["keywords"])
        cons = " ; ".join(c[1] for c in p["concepts"] if len(c) >= 4 and (c[2] or 0) >= 2 and (c[3] or 0) >= 0.3)
        main.append(f"{p['title']} ; {kws} ; {cons}".lower())
        abst.append((p["abstract"] or "").lower())
    return main, abst
