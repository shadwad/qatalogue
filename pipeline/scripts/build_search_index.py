#!/usr/bin/env python3
"""Build the paper search index in serve.db.tmp.

Writes:
  paper_index        row -> paper_id, plus the paper's vector (int8, one scale per vector)
  paper_search       FTS5 over title / abstract / keywords / concepts, contentless (abstract text is
                     indexed for matching but never stored in, or served from, the serve DB)
  paper_index_meta   model settings the vectors were made with; the server refuses a mismatch

Target: serve.db.tmp (run before finalize_build.py).
Reads staging.paper_text and staging.paper_embeddings (make enrich embed).
"""
import html
import json
import os
import re
import struct
from datetime import datetime, timezone

from pipeline.core import embedding
from pipeline.core.logger import setup_pipeline_logger
from pipeline.db.connection import SERVE_TMP_PATH, STAGING_DB_PATH, open_build

logger = setup_pipeline_logger("build_search", "build_search.log")

CONCEPT_MIN_SCORE = 0.3     # minimum OpenAlex concept relevance score to index


def strip(text: str | None) -> str:
    t = text or ""
    for _ in range(3):
        u = html.unescape(t)
        if u == t:
            break
        t = u
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", t)).strip()


def concept_name(name: str) -> str:
    # Strip parenthetical disambiguators from OpenAlex concept names before indexing.
    return re.sub(r"\s*\([^)]*\)", "", name or "").strip()


def quantize(blob: bytes, dim: int) -> tuple[bytes, float]:
    v = struct.unpack(f"<{dim}f", blob)
    scale = max(abs(x) for x in v) / 127 or 1.0
    return bytes(struct.pack(f"<{dim}b", *(max(-127, min(127, round(x / scale))) for x in v))), scale


def main() -> None:
    cfg = embedding.load_config()
    model = embedding.model_id(cfg)
    logger.info(f"Writing paper search index into {SERVE_TMP_PATH}")
    with open_build() as conn:
        conn.execute("ATTACH DATABASE ? AS staging", (os.path.abspath(STAGING_DB_PATH),))
        rows = conn.execute("""
            SELECT f.paper_id, f.title, t.abstract_openalex, t.arxiv_abstract, t.keywords, t.concepts,
                   e.vec, e.dim, e.model
            FROM main.paper_facts f
            LEFT JOIN staging.paper_text t ON t.paper_id = f.paper_id
            LEFT JOIN staging.paper_embeddings e ON e.paper_id = f.paper_id
            ORDER BY f.paper_id""").fetchall()

        conn.execute("DROP TABLE IF EXISTS paper_search")
        conn.execute("DROP TABLE IF EXISTS paper_index")
        conn.execute("DROP TABLE IF EXISTS paper_index_meta")
        conn.execute("CREATE VIRTUAL TABLE paper_search USING fts5(title, abstract, keywords, concepts, content='', tokenize='porter unicode61')")
        conn.execute("""
            CREATE TABLE paper_index (
                row INTEGER PRIMARY KEY,      -- = paper_search rowid
                paper_id TEXT NOT NULL UNIQUE,
                vec BLOB,                     -- int8[dim]; NULL if the paper has no vector
                vec_scale REAL
            )
        """)
        conn.execute("CREATE TABLE paper_index_meta (key TEXT PRIMARY KEY, value TEXT)")

        dim = cfg["dim"]
        no_vec = no_text = wrong_model = 0
        search_batch, index_batch = [], []
        for row, (pid, title, ab_oa, ab_ax, kw, co, vec, vdim, vec_model) in enumerate(rows, start=1):
            abstract = strip(ab_oa) or strip(ab_ax)
            keywords = " ; ".join(k[0] for k in json.loads(kw or "[]") if k and k[0])
            concepts = " ; ".join(concept_name(c[1]) for c in json.loads(co or "[]") if c and c[1] and (c[3] or 0) >= CONCEPT_MIN_SCORE)
            no_text += not abstract
            search_batch.append((row, strip(title), abstract, keywords, concepts))
            q = scale = None
            if vec is None:
                no_vec += 1
            elif vec_model != model or vdim != dim:
                wrong_model += 1
            else:
                q, scale = quantize(vec, dim)
            index_batch.append((row, pid, q, scale))
            if len(search_batch) >= 2000:
                conn.executemany("INSERT INTO paper_search (rowid, title, abstract, keywords, concepts) VALUES (?, ?, ?, ?, ?)", search_batch)
                conn.executemany("INSERT INTO paper_index (row, paper_id, vec, vec_scale) VALUES (?, ?, ?, ?)", index_batch)
                search_batch.clear()
                index_batch.clear()
        if search_batch:
            conn.executemany("INSERT INTO paper_search (rowid, title, abstract, keywords, concepts) VALUES (?, ?, ?, ?, ?)", search_batch)
            conn.executemany("INSERT INTO paper_index (row, paper_id, vec, vec_scale) VALUES (?, ?, ?, ?)", index_batch)

        meta = {
            "model": model, "dtype": cfg["dtype"], "pooling": cfg["pooling"], "dim": str(dim),
            "papers": str(len(rows)), "with_vectors": str(len(rows) - no_vec - wrong_model),
            "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
        conn.executemany("INSERT INTO paper_index_meta VALUES (?, ?)", meta.items())
        conn.execute("INSERT INTO paper_search(paper_search) VALUES ('optimize')")

    logger.info(f"Indexed {len(rows)} papers ({no_text} without abstract); vectors for {meta['with_vectors']}")
    if no_vec or wrong_model:
        logger.warning(f"{no_vec} papers have no vector and {wrong_model} were made with another model: "
                       f"run `make embed` and rebuild for full meaning-based search")


if __name__ == "__main__":
    main()
