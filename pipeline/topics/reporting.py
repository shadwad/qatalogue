"""Reporting and public taxonomy export for topic discovery and assignment."""
from __future__ import annotations

import json
import math
import os
from collections import Counter
from pathlib import Path

import numpy as np


def profile(ids_local, papers, E, toks, df, n_all, display, probes_by_paper, probe_labels, years_recent):
    """Profile one cluster. ids_local: indexes into the global paper list."""
    idx = np.array(ids_local)
    c = E[idx].mean(0)
    c /= np.linalg.norm(c) + 1e-12
    sims = E[idx] @ c
    reps = idx[np.argsort(-sims)[:6]]
    tcount = Counter(t for i in idx for t in toks[i])
    size = len(idx)

    def top(prefix, k):
        out = []
        for t, m in tcount.items():
            if not t.startswith(prefix) or m < 3:
                continue
            share = m / size
            lift = share / (df[t] / n_all)
            if lift > 1:
                out.append((share * math.log(lift), t, share, lift))
        out.sort(reverse=True)
        return [{"term": display.get(t, t.split(":", 1)[1]), "token": t, "share": round(s, 3), "lift": round(l, 1)}
                for _, t, s, l in out[:k]]

    years = [papers[i]["year"] for i in idx if papers[i]["year"]]
    recent = sum(y >= years_recent for y in years) / max(len(years), 1)
    venues = Counter(papers[i]["venue"] for i in idx if papers[i]["venue"]).most_common(4)
    quant_ph = tcount.get("ax:quant-ph", 0) / size
    pr = Counter(p for i in idx for p in probes_by_paper.get(i, ()))
    return {
        "size": size,
        "share": round(size / n_all, 4),
        "cohesion": round(float(sims.mean()), 3),
        "median_year": int(np.median(years)) if years else None,
        "recent_share": round(recent, 3),
        "keywords": top("kw:", 12),
        "concepts": top("c:", 6),
        "openalex_topics": top("t:", 4),
        "arxiv": top("ax:", 4),
        "quant_ph_share": round(quant_ph, 3),
        "venues": [{"venue": v, "share": round(m / size, 3)} for v, m in venues],
        "probes": {probe_labels[p]: round(m / size, 3) for p, m in pr.most_common() if m / size >= 0.05},
        "examples": [{"id": papers[i]["id"], "title": papers[i]["title"], "year": papers[i]["year"]} for i in reps],
        "_centroid": c,
    }


def draft_name(prof) -> str:
    kws = [k["term"] for k in prof["keywords"][:3]]
    return " · ".join(kws) if kws else (prof["concepts"][0]["term"] if prof["concepts"] else "Unnamed")


def no_nan(x):
    """JSON has no NaN: write missing measurements as null."""
    if isinstance(x, float) and x != x:
        return None
    if isinstance(x, dict):
        return {k: no_nan(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [no_nan(v) for v in x]
    return x


def fmt_terms(lst, k=8):
    return ", ".join(f"{x['term']} ({x['share']:.0%}, ×{x['lift']:g})" for x in lst[:k]) or "—"


def scan_table(rows):
    out = ["| resolution | clusters | largest | stability (ARI) | distinctness | silhouette | core agreement | score |",
           "|---|---|---|---|---|---|---|---|"]
    for r in rows:
        f = lambda v: "—" if v is None or v != v else f"{v:.3f}"
        mark = " **← chosen**" if r.get("chosen") else ("" if r["eligible"] else " (out of range)")
        out.append(f"| {r['resolution']} | {r['clusters']} | {r['largest_share']:.0%} | {f(r['stability'])} | "
                   f"{f(r['distinctness'])} | {f(r['coherence'])} | {f(r['core_agreement'])} | "
                   f"{f(r.get('score'))}{mark} |")
    return "\n".join(out)


def write_discovery_report(path: Path, result: dict):
    L = []
    m = result["meta"]
    L += ["# Topic discovery report",
          "",
          f"Generated {m['generated_at']} from {m['papers']:,} papers ({m['model']}). Took {m['seconds']:.0f} s.",
          "",
          "This is a proposal. Names are drafted from each group's most distinctive keywords; nothing here is shown in",
          "the app until it is curated into `data/taxonomy.json`.",
          "",
          "## How the number of topics was chosen",
          "",
          f"Similarity graph: {m['edges']:,} links; {m['metadata_reordered']:.0%} of neighbour slots were changed by the",
          "shared-metadata bonus. Each resolution below was clustered, small clusters merged, and scored. Only rows inside",
          f"the sidebar range ({result['params']['topics']['count_range'][0]}–{result['params']['topics']['count_range'][1]} topics,"
          f" none over {result['params']['topics']['max_share']:.0%} of papers) are eligible; the score is the weighted"
          " mean rank of the four measures.",
          "",
          scan_table(result["scan"]["topics"]),
          "",
          "- **Stability:** adjusted Rand index between the full clustering and re-clusterings of random 80% samples (1 = identical).",
          "- **Distinctness:** 1 − the largest overlap between a cluster's top-15 metadata terms and any other cluster's, averaged.",
          "- **Silhouette:** how much closer papers are to their own cluster than to the next one (cosine, 3,000-paper sample).",
          "- **Core agreement:** for papers that ≥2 sources place in one reference field (QEC, QML, variational, sensing, QKD),",
          "  the share that land in that field's main cluster, averaged over fields.",
          "",
          "## Proposed topics",
          "",
          "⚠ marks clusters that keep less than half their papers together when re-clustered (best-match Jaccard < 0.5):",
          "candidates to merge into a neighbour.",
          ""]
    for t in result["topics"]:
        L += [f"### {t['id']}. {t['draft_name']}" + (" ⚠ unstable" if t["stability"] < 0.5 else ""),
              "",
              f"**{t['size']:,} papers** ({t['share']:.1%}) · median year {t['median_year']} · "
              f"{t['recent_share']:.0%} since {m['recent_year']} · survives re-clustering {t['stability']:.0%} · "
              f"closest topic: {t['nearest']['id']} ({t['nearest']['similarity']:.2f})",
              "",
              f"- **Keywords:** {fmt_terms(t['keywords'], 10)}",
              f"- **Concepts:** {fmt_terms(t['concepts'], 5)}",
              f"- **OpenAlex topics:** {fmt_terms(t['openalex_topics'], 3)}",
              f"- **arXiv:** {fmt_terms(t['arxiv'], 4)} · quant-ph {t['quant_ph_share']:.0%}",
              "- **Venues:** " + ", ".join(f"{v['venue']} {v['share']:.0%}" for v in t["venues"]),
              "- **Reference fields & platforms (≥5%):** " + (", ".join(f"{k} {v:.0%}" for k, v in t["probes"].items()) or "—"),
              "- **Representative papers:**"]
        L += [f"  - {e['title']} ({e['year']})" for e in t["examples"][:4]]
        L += ["", f"**Subtopics** — {len(t['subtopics'])} chosen at resolution {t['subtopic_resolution']}"
              + (" (scan in discovery.json)" if t["subtopic_scan"] else " (topic too small to split)"), ""]
        if t["subtopics"]:
            L += ["| | subtopic (draft) | papers | stable | top keywords | example |", "|---|---|---|---|---|---|"]
            for s in t["subtopics"]:
                flag = " ⚠" if s["stability"] < 0.5 else ""
                L.append(f"| {s['id']} | {s['draft_name']} | {s['size']:,} | {s['stability']:.0%}{flag} | "
                         f"{', '.join(k['term'] for k in s['keywords'][:6])} | {s['examples'][0]['title'][:90]} |")
        L.append("")
    L += ["## Hardware platforms (a separate facet)", "",
          "Platforms cut across topics (a QEC paper can be about superconducting qubits), so they are detected by rules,",
          "not clustering. Counts are papers where ≥2 sources agree.", "",
          "| platform | papers | main topics |", "|---|---|---|"]
    for p in result["platforms"]:
        L.append(f"| {p['label']} | {p['papers']:,} | " + ", ".join(f"{x['topic']} {x['share']:.0%}" for x in p["topics"][:3]) + " |")
    L += ["", "## Reference fields", "", "| field | core papers | main topic | share in it |", "|---|---|---|---|"]
    for f in result["reference_fields"]:
        L.append(f"| {f['label']} | {f['papers']:,} | {f['main_topic']} | {f['main_share']:.0%} |")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(L) + "\n", encoding="utf-8")


def export_public_taxonomy(tax, path: Path):
    """Slim copy of the taxonomy for the frontend sidebar (ids are what the API's topic filter takes)."""
    out = {'topics': [], 'platforms': []}
    for T in tax['topics']:
        out['topics'].append({
            'id': T['id'],
            'name': T['name'],
            'definition': T.get('definition', ''),
            'search_terms': T.get('search_terms', []),
            'subtopics': [
                {
                    'id': f"{T['id']}/{S['id']}",
                    'name': S['name'],
                    'definition': S.get('definition', ''),
                    'search_terms': S.get('search_terms', []),
                }
                for S in T['subtopics']
            ],
        })
    for P in tax.get('platforms', []):
        out['platforms'].append({'id': P['id'], 'name': P['name'], 'definition': P.get('definition', '')})
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    try:
        tmp.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        os.replace(tmp, path)
    except BaseException:
        if tmp.exists():
            tmp.unlink()
        raise


def write_assignment_report(path: Path, mo, subs, counts_sub, n_test):
    te = mo['eval_random']
    pct = lambda x: f'{x:.1%}'
    L = ['# Topic assignment report', '',
         f"Generated {mo['generated_at']}. {mo['stats']['papers']:,} papers.", '',
         f"Every paper gets each subtopic with confidence ≥ {mo['tau']:.3f}, and at least its best one if that is ≥ {mo['tau_min']:.3f}; "
         "below that it gets no topic. Weights were trained on the non-random answer-key papers; the numbers below are on the "
         f"{n_test} held-out random papers.", '',
         '| | Assignment |', '|---|---|',
         f"| Top subtopic among the paper's labels | {pct(te['top1_subtopic'])} |",
         f"| Top topic among the paper's labels | {pct(te['top1_topic'])} |",
         f"| Subtopic precision / recall / F1 | {pct(te['subtopic_prf'][0])} / {pct(te['subtopic_prf'][1])} / {te['subtopic_prf'][2]:.3f} |",
         f"| Topic precision / recall / F1 | {pct(te['topic_prf'][0])} / {pct(te['topic_prf'][1])} / {te['topic_prf'][2]:.3f} |",
         f"| \"No topic\" precision / recall | {pct(te['no_topic_prf'][0])} / {pct(te['no_topic_prf'][1])} |",
         f"| Subtopics per paper | {te['labels_per_paper']:.2f} |", '',
         f"Platforms (rules) on the random papers: precision {pct(mo['platform_prf'][0])}, recall {pct(mo['platform_prf'][1])}.", '',
         f"Whole collection: {mo['stats']['assigned']:,} papers assigned, {mo['stats']['no_topic']:,} with no topic, "
         f"{mo['stats']['labels_per_paper']:.2f} subtopics per paper.", '',
         '## Weights (standardised features)', '',
         '| feature | weight |', '|---|---|'] + [f'| {k} | {v:+.2f} |' for k, v in mo['weights'].items()] + [
         '', '## Per-subtopic accuracy (5-fold cross-validation over the whole key)', '',
         'A subtopic with F1 below 0.6 is flagged: it may be too hard to separate from its neighbours.', '',
         '| subtopic | key examples | precision | recall | F1 | papers assigned | seeds |', '|---|---|---|---|---|---|---|']
    for j, ps in sorted(enumerate(mo['per_subtopic_cv']), key=lambda x: x[1]['f1']):
        flag = ' ⚠' if ps['f1'] < 0.6 else ''
        L.append(f"| {ps['name']}{flag} | {ps['support']} | {ps['precision']:.2f} | {ps['recall']:.2f} | {ps['f1']:.2f} | {int(counts_sub[j]):,} | {ps['seeds']:,} |")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text('\n'.join(L) + '\n', encoding="utf-8")
