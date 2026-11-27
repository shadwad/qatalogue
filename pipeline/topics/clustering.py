"""Similarity graph construction, Leiden clustering, and partition quality evaluation."""
from __future__ import annotations

import math
import re
import sys
import time
from collections import Counter, defaultdict

import numpy as np

from pipeline.topics.data import clean_title, knn

SOURCE_OF = {"kw": "keyword", "c": "concept", "t": "openalex_topic", "ax": "arxiv"}


def _import_graph_libs():
    try:
        import igraph as ig
        import leidenalg as la
        return ig, la
    except ImportError:  # pragma: no cover
        sys.exit("discover_topics.py needs igraph and leidenalg: ./.venv/bin/pip install -r pipeline/requirements.txt")


def norm_word(w: str) -> str:
    if len(w) > 4 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) > 3 and w.endswith("s") and not w.endswith(("ss", "us", "is")):
        return w[:-1]
    return w


def norm_keyword(k: str) -> str:
    k = clean_title(k).lower().replace("–", "-").replace("-", " ")
    k = re.sub(r"[^a-z0-9+ ]+", " ", k)
    return " ".join(norm_word(w) for w in k.split())


def paper_tokens(p, g) -> dict[str, str]:
    """token -> display form. Token prefixes: kw: keyword, c: concept, t: OpenAlex topic, ax: arXiv category."""
    out: dict[str, str] = {}
    for item in p["keywords"]:
        k, s = (item[0], item[1]) if isinstance(item, list) else (item, 1.0)
        if s is not None and s < g["keyword_min_score"]:
            continue
        n = norm_keyword(k)
        if len(n) >= 2:
            out.setdefault("kw:" + n, clean_title(k))
    for c in p["concepts"]:
        cid, name, level, score = (c + [None] * 4)[:4]
        if level is not None and level >= g["concept_min_level"] and (score or 0) >= g["concept_min_score"]:
            out["c:" + cid] = name
    for i, t in enumerate(p["topics"]):
        if i == 0 or (t.get("score") or 0) >= g["openalex_topic_min_score"]:
            out["t:" + t["id"]] = t["name"]
    for a in p["arxiv"]:
        out["ax:" + a] = a
    return out


def build_metadata(papers, g):
    toks = [paper_tokens(p, g) for p in papers]
    n = len(papers)
    df = Counter(t for d in toks for t in d)
    display: dict[str, Counter] = defaultdict(Counter)
    for d in toks:
        for t, disp in d.items():
            display[t][disp] += 1
    display_form = {t: c.most_common(1)[0][0] for t, c in display.items()}
    max_df = g["token_max_df_share"] * n
    vecs = []
    for d in toks:
        v = {}
        for t in d:
            f = df[t]
            if f < g["token_min_df"] or f > max_df:
                continue
            v[t] = math.log(n / f) * g["metadata_sources"][SOURCE_OF[t.split(":", 1)[0]]]
        norm = math.sqrt(sum(x * x for x in v.values())) or 1.0
        vecs.append({t: x / norm for t, x in v.items()})
    return toks, df, display_form, vecs


def sparse_dot(a: dict, b: dict) -> float:
    if len(a) > len(b):
        a, b = b, a
    return sum(x * b[t] for t, x in a.items() if t in b)


def build_graph(E, meta_vecs, g):
    ig, _ = _import_graph_libs()
    n = len(E)
    cand_idx, cand_sim = knn(E, g["candidates"])
    k = min(g["neighbours"], cand_idx.shape[1]) if cand_idx.shape[1] else 0
    gm = g["metadata_weight"]
    edges: dict[tuple[int, int], float] = {}
    meta_bonus_used = 0
    for i in range(n):
        if k == 0:
            continue
        h = np.array([cand_sim[i, j] + gm * sparse_dot(meta_vecs[i], meta_vecs[cand_idx[i, j]])
                      for j in range(cand_idx.shape[1])], dtype=np.float32)
        order = np.argsort(-h)[:k]
        meta_bonus_used += int(np.sum(order >= k))  # neighbours that only made the cut thanks to metadata
        hs = h[order]
        rho = hs[0]
        sigma = max(float(np.mean(rho - hs)), 1e-3)
        w = np.exp(-(rho - hs) / sigma)
        for jj, wij in zip(cand_idx[i, order], w):
            a, b = (i, int(jj)) if i < jj else (int(jj), i)
            prev = edges.get((a, b))
            edges[(a, b)] = float(wij) if prev is None else prev + float(wij) - prev * float(wij)
    pairs = np.array(list(edges.keys()), dtype=np.int64) if edges else np.zeros((0, 2), dtype=np.int64)
    weights = np.array(list(edges.values()), dtype=np.float64) if edges else np.zeros(0, dtype=np.float64)
    G = ig.Graph(n=n, edges=pairs.tolist(), directed=False)
    G.es["weight"] = weights.tolist()
    denom = max(n * k, 1)
    return G, pairs, weights, meta_bonus_used / denom


def leiden(G, gamma: float, seed: int) -> np.ndarray:
    _, la = _import_graph_libs()
    p = la.find_partition(G, la.RBConfigurationVertexPartition, weights="weight",
                          resolution_parameter=gamma, seed=seed, n_iterations=2)
    return np.array(p.membership, dtype=np.int64)


def relabel_by_size(labels: np.ndarray) -> np.ndarray:
    _, inv, counts = np.unique(labels, return_inverse=True, return_counts=True)
    order = np.argsort(-counts, kind="stable")
    rank = np.empty_like(order)
    rank[order] = np.arange(len(order))
    return rank[inv]


def merge_small(labels, pairs, weights, E, min_size: int) -> np.ndarray:
    """Merge clusters smaller than min_size, smallest first, into the cluster they share the most edge weight with."""
    labels = relabel_by_size(labels)
    while True:
        K = labels.max() + 1
        sizes = np.bincount(labels, minlength=K)
        small = [c for c in np.argsort(sizes) if sizes[c] < min_size]
        if not small or K == 1:
            return relabel_by_size(labels)
        c = small[0]
        lu, lv = labels[pairs[:, 0]], labels[pairs[:, 1]]
        mask = (lu == c) ^ (lv == c)
        if mask.any():
            other = np.where(lu[mask] == c, lv[mask], lu[mask])
            tw = np.bincount(other, weights=weights[mask], minlength=K)
            target = int(np.argmax(tw))
        else:  # disconnected: nearest centroid
            cen = E[labels == c].mean(0)
            best, target = -9, None
            for d in range(K):
                if d == c:
                    continue
                s = float(E[labels == d].mean(0) @ cen)
                if s > best:
                    best, target = s, d
        labels = np.where(labels == c, target, labels)
        labels = relabel_by_size(labels)


def contingency(a, b):
    _, ai = np.unique(a, return_inverse=True)
    _, bi = np.unique(b, return_inverse=True)
    M = np.zeros((ai.max() + 1, bi.max() + 1), np.int64)
    np.add.at(M, (ai, bi), 1)
    return M


def ari(a, b) -> float:
    M = contingency(a, b)
    c2 = lambda x: (x * (x - 1) / 2.0).sum()
    idx = c2(M)
    ra, rb = c2(M.sum(1)), c2(M.sum(0))
    tot = c2(np.array([M.sum()]))
    exp = ra * rb / tot if tot else 0
    mx = (ra + rb) / 2
    return float((idx - exp) / (mx - exp)) if mx != exp else 1.0


def best_jaccard(a, b) -> np.ndarray:
    """For each cluster of `a` (labels 0..), the best Jaccard with any cluster of `b`."""
    M = contingency(a, b).astype(float)
    sa, sb = M.sum(1, keepdims=True), M.sum(0, keepdims=True)
    denom = sa + sb - M
    J = np.divide(M, denom, out=np.zeros_like(M), where=denom > 0)
    out = np.zeros(int(a.max()) + 1)
    ua = np.unique(a)
    out[ua] = J.max(1)
    return out


def stability(G, labels, gamma, pairs_local_fn, runs, share, seed, min_size_fn):
    """Re-cluster random samples; returns mean ARI and per-cluster mean best-Jaccard."""
    rng = np.random.default_rng(seed)
    n = G.vcount()
    aris, per = [], []
    for r in range(runs):
        sel = np.sort(rng.choice(n, size=int(n * share), replace=False))
        H = G.induced_subgraph(sel.tolist())
        sub = leiden(H, gamma, seed + 1 + r)
        hp, hw, hE = pairs_local_fn(H, sel)
        sub = merge_small(sub, hp, hw, hE, min_size_fn(len(sel)))
        aris.append(ari(labels[sel], sub))
        jac = np.full(labels.max() + 1, np.nan)
        bj = best_jaccard(labels[sel], sub)
        present = np.unique(labels[sel])
        jac[present] = bj[present]
        per.append(jac)
    return float(np.mean(aris)), np.nanmean(np.vstack(per), axis=0)


def silhouette(E, labels, sample_idx) -> float:
    X = E[sample_idx]
    L = labels[sample_idx]
    D = 1.0 - X @ X.T
    ks = np.unique(L)
    if len(ks) < 2:
        return 0.0
    means = np.stack([D[:, L == k].mean(1) for k in ks], 1)  # n × K mean distance to each cluster
    pos = np.searchsorted(ks, L)
    counts = np.array([(L == k).sum() for k in ks])
    own_n = counts[pos]
    a = means[np.arange(len(L)), pos] * own_n / np.maximum(own_n - 1, 1)  # exclude self (distance 0)
    means[np.arange(len(L)), pos] = np.inf
    b = means.min(1)
    denom = np.maximum(a, b)
    s = np.divide(b - a, denom, out=np.zeros_like(a), where=denom > 0)
    s[own_n <= 1] = 0
    return float(s.mean())


def cluster_terms(labels, toks, df, n, members=None, top=15, prefix=None):
    """Distinctive tokens per cluster: score = share_in_cluster × log(lift), lift = share_in_cluster / share_overall."""
    K = labels.max() + 1
    counts = [Counter() for _ in range(K)]
    sizes = np.bincount(labels, minlength=K)
    idx = range(len(labels)) if members is None else members
    for li, i in enumerate(idx):
        c = labels[li]
        for t in toks[i]:
            if prefix is None or t.startswith(prefix):
                counts[c][t] += 1
    out = []
    for c in range(K):
        scored = []
        for t, m in counts[c].items():
            if m < 3:
                continue
            share = m / sizes[c]
            lift = share / (df[t] / n)
            if lift > 1:
                scored.append((share * math.log(lift), t, share, lift))
        scored.sort(reverse=True)
        out.append(scored[:top])
    return out


def distinctness(terms) -> tuple[float, list[float]]:
    sets = [set(t for _, t, _, _ in tl) for tl in terms]
    per = []
    for i, s in enumerate(sets):
        worst = 0.0
        for j, o in enumerate(sets):
            if i != j and (s or o):
                worst = max(worst, len(s & o) / len(s | o))
        per.append(1 - worst)
    return float(np.mean(per)) if per else 0.0, per


def core_agreement(labels, core_single: dict[str, list[int]], pos_of: dict[int, int] | None = None) -> float:
    """Mean over reference fields of the share of its single-field core papers that fall in its modal cluster."""
    vals = []
    for members in core_single.values():
        ls = [labels[pos_of[i]] if pos_of else labels[i] for i in members if pos_of is None or i in pos_of]
        if len(ls) >= 20:
            vals.append(Counter(ls).most_common(1)[0][1] / len(ls))
    return float(np.mean(vals)) if vals else float("nan")


def rank_score(rows, weights):
    """Weighted mean of per-metric ranks (0 = worst, 1 = best) across eligible candidates."""
    elig = [r for r in rows if r["eligible"]]
    if not elig:
        return None
    for r in rows:
        r["score"] = None
    if len(elig) == 1:
        elig[0]["score"] = 1.0
        return elig[0]
    for r in elig:
        r["score"] = 0.0
    for m, w in weights.items():
        vals = np.array([r[m] if r[m] == r[m] else -1 for r in elig])  # NaN -> worst
        order = vals.argsort().argsort()
        ranks = order / (len(elig) - 1)
        for r, rk in zip(elig, ranks):
            r["score"] += w * float(rk)
    return max(elig, key=lambda r: (r["score"], r["stability"]))


def scan_level(G, members, E_all, toks, df, n_all, core_single, cfg_level, stab_cfg, seed,
               min_size, count_range, max_share, label, log_fn=None):
    """Cluster the graph G (whose vertex i is paper members[i]) over the resolution grid; return chosen labels + scan."""
    E = E_all[members]
    n = len(members)
    rng = np.random.default_rng(seed)
    sample = np.sort(rng.choice(n, size=min(n, 3000), replace=False))
    pos_of = {int(m): i for i, m in enumerate(members)}
    edge_list = np.array(G.get_edgelist(), dtype=np.int64) if G.ecount() else np.zeros((0, 2), np.int64)
    edge_w = np.array(G.es["weight"], dtype=np.float64) if G.ecount() else np.zeros(0)

    def local(H, sel):
        el = np.array(H.get_edgelist(), dtype=np.int64) if H.ecount() else np.zeros((0, 2), np.int64)
        return el, np.array(H.es["weight"], dtype=np.float64) if H.ecount() else np.zeros(0), E[sel]

    rows, partitions = [], {}
    for gamma in cfg_level["resolutions"]:
        t0 = time.time()
        lab = merge_small(leiden(G, gamma, seed), edge_list, edge_w, E, min_size)
        K = int(lab.max()) + 1
        sizes = np.bincount(lab)
        row = {"resolution": gamma, "clusters": K, "largest_share": float(sizes.max() / n),
               "smallest": int(sizes.min())}
        lo, hi = count_range
        row["eligible"] = lo <= K <= hi and (max_share is None or row["largest_share"] <= max_share)
        if K >= 2 and (row["eligible"] or K <= hi * 1.5):
            st, per = stability(G, lab, gamma, local, stab_cfg["runs"], stab_cfg["sample_share"], seed + 100,
                                lambda m: max(2, int(min_size * m / n)))
            terms = cluster_terms(lab, toks, df, n_all, members=members)
            dist, _ = distinctness(terms)
            row.update({
                "stability": st,
                "distinctness": dist,
                "coherence": silhouette(E, lab, sample),
                "core_agreement": core_agreement(lab, core_single, pos_of) if core_single else float("nan"),
            })
            partitions[gamma] = (lab, per)
        else:
            row.update({"stability": float("nan"), "distinctness": float("nan"), "coherence": float("nan"),
                        "core_agreement": float("nan")})
            row["eligible"] = False
        row["seconds"] = round(time.time() - t0, 1)
        rows.append(row)
        if log_fn:
            log_fn(
                f"  {label} γ={gamma:<5} → {K:>3} clusters, largest {row['largest_share']:.0%}, "
                f"stability {row['stability']:.3f}, distinct {row['distinctness']:.3f}, "
                f"silhouette {row['coherence']:.3f}, core {row['core_agreement']:.3f}"
                f"{'' if row['eligible'] else '  (out of range)'}  [{row['seconds']}s]"
            )
    best = rank_score(rows, cfg_level["weights"])
    if best is None:
        lo, hi = count_range
        cands = [r for r in rows if r["resolution"] in partitions]
        if not cands:
            return np.zeros(n, np.int64), np.ones(1), rows, None
        best = min(cands, key=lambda r: (max(lo - r["clusters"], r["clusters"] - hi, 0), -r["stability"]))
    for r in rows:
        r["chosen"] = r is best
    lab, per = partitions[best["resolution"]]
    return lab, per, rows, best["resolution"]
