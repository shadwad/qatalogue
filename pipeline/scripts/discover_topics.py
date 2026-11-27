#!/usr/bin/env python3
"""
Discover a two-level topic structure for the paper collection.

Nothing here is written to staging.db or serve.db. Outputs:
  data/topics/discovery.json        machine-readable: parameters, resolution scans, every cluster's profile, paper assignments
  data/topics/discovery_report.md   the same, readable

Usage
  python pipeline/scripts/discover_topics.py [--db data/staging.db] [--out data/topics] [--quick]
  --quick uses 2 stability runs and a shorter resolution grid (for trying parameter changes).
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from pipeline.core import embedding
from pipeline.db.connection import SERVE_DB_PATH, STAGING_DB_PATH
from pipeline.topics.clustering import build_graph, build_metadata, scan_level
from pipeline.topics.data import CONFIG_PATH, EMBED_CONFIG_PATH, TAXONOMY_PATH, load_papers, probe_hits
from pipeline.topics.reporting import draft_name, no_nan, profile, write_discovery_report


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def _link_nearest(items: list[dict]) -> None:
    C = np.vstack([x["_centroid"] for x in items])
    S = C @ C.T
    np.fill_diagonal(S, -1)
    for i, x in enumerate(items):
        j = int(S[i].argmax()) if len(items) > 1 else i
        x["nearest"] = {"id": items[j]["id"], "similarity": round(float(S[i, j]), 3) if len(items) > 1 else None}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", default=STAGING_DB_PATH)
    ap.add_argument("--serve", default=SERVE_DB_PATH, help="restrict to papers served (paper_facts)")
    ap.add_argument("--out", default=str(CONFIG_PATH.parents[2] / "data/topics"))
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--embeddings", help="robustness runs: alternative vectors (.f32, row-major) with a sibling .json "
                    "holding {ids, dim}; papers without a vector are left out")
    ap.add_argument("--metadata-weight", type=float, help="override graph.metadata_weight (0 = embeddings only)")
    args = ap.parse_args()

    t_start = time.time()
    cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    cfg["platforms"] = {P["id"]: {**P["rules"], "label": P["name"]} for P in json.loads(TAXONOMY_PATH.read_text(encoding="utf-8"))["platforms"]}
    emb = json.loads(EMBED_CONFIG_PATH.read_text(encoding="utf-8"))
    g = cfg["graph"]
    if args.metadata_weight is not None:
        g["metadata_weight"] = args.metadata_weight
    stab = dict(cfg["stability"])
    if args.quick:
        stab["runs"] = 2
        cfg["topics"]["resolutions"] = cfg["topics"]["resolutions"][::2]
        cfg["subtopics"]["resolutions"] = cfg["subtopics"]["resolutions"][::2]
    seed = cfg["seed"]

    log("Loading papers and embeddings…")
    papers, E = load_papers(Path(args.db), Path(args.serve) if args.serve else None,
                            embedding.model_id(embedding.load_config(EMBED_CONFIG_PATH)))
    if args.embeddings:
        meta = json.loads(Path(args.embeddings).with_suffix(".json").read_text(encoding="utf-8"))
        alt = np.fromfile(args.embeddings, dtype=np.float32).reshape(-1, meta["dim"])
        row = {pid: i for i, pid in enumerate(meta["ids"])}
        keep = [i for i, p in enumerate(papers) if p["id"] in row]
        papers = [papers[i] for i in keep]
        E = alt[[row[p["id"]] for p in papers]].astype(np.float32)
        E /= np.linalg.norm(E, axis=1, keepdims=True) + 1e-12
        emb = {**emb, "model": meta.get("model", args.embeddings)}
        log(f"  using {emb['model']} vectors for {len(papers):,} papers")
    n = len(papers)
    if n < 500:
        sys.exit(f"Only {n} embedded papers; run `make embed` first.")
    log(f"  {n:,} papers, dim {E.shape[1]}")

    log("Metadata tokens…")
    toks, df, display, meta_vecs = build_metadata(papers, g)
    log(f"  {len(df):,} distinct tokens; {np.mean([len(v) for v in meta_vecs]):.1f} weighted tokens per paper")

    log("Probes (reference fields, platforms)…")
    ref_hits = probe_hits(papers, cfg["reference_fields"])
    plat_hits = probe_hits(papers, cfg["platforms"])
    field_of = defaultdict(list)
    for f, hs in ref_hits.items():
        for i in hs:
            field_of[i].append(f)
    core_single = defaultdict(list)
    for i, fs in field_of.items():
        if len(fs) == 1:
            core_single[fs[0]].append(i)
    probe_labels = {**{k: v["label"] for k, v in cfg["reference_fields"].items()},
                    **{k: v["label"] for k, v in cfg["platforms"].items()}}
    probes_by_paper = defaultdict(list)
    for hits in (ref_hits, plat_hits):
        for p, hs in hits.items():
            for i in hs:
                probes_by_paper[i].append(p)
    log("  " + ", ".join(f"{cfg['reference_fields'][k]['label']} {len(v)}" for k, v in ref_hits.items()))

    log("Similarity graph…")
    G, _, _, reordered = build_graph(E, meta_vecs, g)
    log(f"  {G.ecount():,} edges; metadata changed {reordered:.1%} of neighbour slots")

    log("Topic level…")
    tcfg = cfg["topics"]
    all_members = np.arange(n)
    top_labels, top_stab, top_scan, top_res = scan_level(
        G, all_members, E, toks, df, n, core_single, tcfg, stab, seed,
        min_size=max(2, int(math.ceil(tcfg["min_share"] * n))), count_range=tcfg["count_range"],
        max_share=tcfg["max_share"], label="topics", log_fn=log)
    K = int(top_labels.max()) + 1
    log(f"  chose resolution {top_res}: {K} topics")

    recent_year = max(p["year"] or 0 for p in papers) - 2
    scfg = cfg["subtopics"]
    topics_out = []
    sub_assign = np.full(n, -1, np.int64)
    for c in range(K):
        mem = np.where(top_labels == c)[0]
        prof = profile(mem, papers, E, toks, df, n, display, probes_by_paper, probe_labels, recent_year)
        tid = f"T{c + 1:02d}"
        log(f"Subtopics for {tid} ({len(mem):,} papers: {draft_name(prof)})…")
        sub_scan, sub_res = [], None
        if len(mem) >= 2 * scfg["min_papers"] + 1:
            H = G.induced_subgraph(mem.tolist())
            sl, sstab, sub_scan, sub_res = scan_level(
                H, mem, E, toks, df, n, {}, scfg, stab, seed + c + 1,
                min_size=scfg["min_papers"], count_range=scfg["count_range"], max_share=None,
                label=f"  {tid}", log_fn=log)
        else:
            sl, sstab = np.zeros(len(mem), np.int64), np.ones(1)
        subs = []
        for s in range(int(sl.max()) + 1):
            smem = mem[sl == s]
            sp = profile(smem, papers, E, toks, df, n, display, probes_by_paper, probe_labels, recent_year)
            sp.update({"id": f"{tid}.{s + 1}", "draft_name": draft_name(sp),
                       "stability": round(float(sstab[s]) if s < len(sstab) and sstab[s] == sstab[s] else 1.0, 3)})
            subs.append(sp)
            sub_assign[smem] = s
        prof.update({"id": tid, "draft_name": draft_name(prof),
                     "stability": round(float(top_stab[c]) if top_stab[c] == top_stab[c] else 0.0, 3),
                     "subtopic_resolution": sub_res, "subtopic_scan": sub_scan, "subtopics": subs})
        topics_out.append(prof)

    _link_nearest(topics_out)
    for t in topics_out:
        if len(t["subtopics"]) > 1:
            _link_nearest(t["subtopics"])

    def topic_dist(members):
        cnt = Counter(int(top_labels[i]) for i in members)
        tot = max(len(members), 1)
        return [{"topic": f"T{k + 1:02d}", "share": round(v / tot, 3)} for k, v in cnt.most_common()]

    platforms = [{"id": k, "label": cfg["platforms"][k]["label"], "papers": len(v), "topics": topic_dist(v)}
                 for k, v in plat_hits.items()]
    ref_fields = []
    for k, v in ref_hits.items():
        d = topic_dist(v)
        ref_fields.append({"id": k, "label": cfg["reference_fields"][k]["label"], "papers": len(v),
                           "main_topic": d[0]["topic"] if d else None, "main_share": d[0]["share"] if d else 0,
                           "topics": d})

    for t in topics_out:
        t.pop("_centroid", None)
        for s in t["subtopics"]:
            s.pop("_centroid", None)

    seconds = time.time() - t_start
    result = {
        "meta": {
            "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
            "papers": n, "model": emb["model"], "edges": G.ecount(), "metadata_reordered": round(reordered, 4),
            "topic_resolution": top_res, "recent_year": recent_year, "seconds": round(seconds, 1),
            "quick": args.quick,
        },
        "params": cfg,
        "scan": {"topics": top_scan},
        "topics": topics_out,
        "platforms": platforms,
        "reference_fields": ref_fields,
        "assignments": {papers[i]["id"]: [f"T{int(top_labels[i]) + 1:02d}", f"T{int(top_labels[i]) + 1:02d}.{int(sub_assign[i]) + 1}"]
                        for i in range(n)},
    }
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "discovery.json").write_text(json.dumps(no_nan(result), ensure_ascii=False, indent=1, default=float) + "\n", encoding="utf-8")
    write_discovery_report(out / "discovery_report.md", result)

    log(f"Done in {seconds:.0f} s: {K} topics, {sum(len(t['subtopics']) for t in topics_out)} subtopics.")
    log(f"  {out / 'discovery_report.md'}")
    log(f"  {out / 'discovery.json'}")


if __name__ == "__main__":
    main()
