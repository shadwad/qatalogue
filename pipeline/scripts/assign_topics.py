#!/usr/bin/env python3
"""
Assign every paper its topics and subtopics (several allowed), each with a confidence, plus hardware platforms.

Inputs
  data/staging.db              papers, paper_text (keywords, concepts, abstracts), paper_embeddings
  data/taxonomy.json           curated topics/subtopics: rules.keywords (regex), platform rules
  data/topics/answer_key.json  labelled papers: the non-random ones train the scorer, the random ones test it
Outputs
  staging.db: paper_subtopics(paper_id, topic_id, subtopic_id, confidence, rank)
              paper_platforms(paper_id, platform_id, evidence)
  data/topics/assignment_model.json   learned weights and thresholds
  data/topics/assignment_report.md    accuracy on the held-out random papers, per-subtopic F1

Usage
  python pipeline/scripts/assign_topics.py [--db data/staging.db] [--no-write]
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from pipeline.core import embedding
from pipeline.core.paper_ids import PaperIds
from pipeline.core.publish import PUBLIC_DIR
from pipeline.db.connection import STAGING_DB_PATH, open_readonly
from pipeline.topics.classifier import (
    FEATURES,
    K_NN,
    SEED_TRIM,
    TAU_MIN_FLOOR,
    Scaler,
    assign,
    build_features,
    detect_platforms,
    evaluate,
    fit_logistic,
    label_matrix,
    predict,
    prf,
    stack,
    subtopic_table,
    tune_thresholds,
)
from pipeline.topics.data import EMBED_CONFIG_PATH, ROOT, load_papers
from pipeline.topics.reporting import export_public_taxonomy, write_assignment_report


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def validate_answer_key_overlap(key: list[dict], train: list[dict], key_path: str = 'data/topics/answer_key.json') -> None:
    """Fail with an actionable error when a custom scope has too little overlap with the labelled answer key."""
    has_positive = any('/' in label for p in train for label in p.get('labels', ()))
    if len(key) < 5 or not train or not has_positive:
        raise ValueError(
            f"Not enough papers from {key_path} match this staging database "
            f"({len(key)} matched, {len(train)} training; need at least 5 matched and 1 labelled training paper). "
            "The default answer key covers the default venues for 2021–2026; widen the scope or pass --key with "
            "labelled papers from this scope."
        )


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--db', default=STAGING_DB_PATH)
    ap.add_argument('--taxonomy', default=str(ROOT / 'data/taxonomy.json'))
    ap.add_argument('--key', default=str(ROOT / 'data/topics/answer_key.json'))
    ap.add_argument('--out', default=str(ROOT / 'data/topics'))
    ap.add_argument('--public-taxonomy', default=str(Path(PUBLIC_DIR) / 'config/taxonomy.json'),
                    help='where the sidebar copy of the taxonomy goes')
    ap.add_argument('--staged', action='store_true',
                    help='write a .tmp sidecar so finalize_build.py promotes it alongside serve.db')
    ap.add_argument('--no-write', action='store_true', help='evaluate only; do not write tables')
    ap.add_argument('--tau-min-floor', type=float, default=TAU_MIN_FLOOR,
                    help='never let the "no topic" cut-off fall below this confidence')
    args = ap.parse_args()
    t0 = time.time()

    tax = json.loads(Path(args.taxonomy).read_text(encoding="utf-8"))
    plat_rules = {P['id']: P['rules'] for P in tax['platforms']}
    key = json.loads(Path(args.key).read_text(encoding="utf-8"))['papers']
    subs = subtopic_table(tax)
    m = len(subs)

    log('Loading papers…')
    model = embedding.model_id(embedding.load_config(EMBED_CONFIG_PATH))
    papers, E = load_papers(Path(args.db), None, model)
    n = len(papers)
    idx = {p['id']: i for i, p in enumerate(papers)}
    log(f'  {n:,} papers, {m} subtopics')

    F, seed_counts, main_texts = build_features(papers, E, subs, log_fn=log)

    # Entries are found by OpenAlex id, or by DOI when OpenAlex has changed the id (pipeline/core/paper_ids.py).
    with open_readonly(Path(args.db)) as con:
        paper_ids = PaperIds(con)
    found = []
    for p in key:
        current = paper_ids.resolve(p['paper_id'], p.get('doi'))
        if current in idx:
            found.append(dict(p, paper_id=current))
    if len(found) < len(key):
        log(f'  {len(key) - len(found)} answer-key paper(s) match no paper in staging')
    key = found
    train = [p for p in key if p['why_sampled'] != 'random']
    test = [p for p in key if p['why_sampled'] == 'random']
    log(f'Answer key: {len(train)} training papers, {len(test)} held-out random papers')
    try:
        validate_answer_key_overlap(key, train, args.key)
    except ValueError as err:
        raise SystemExit(f'Error: {err}') from err

    def xy(ps):
        rows = np.array([idx[p['paper_id']] for p in ps], dtype=np.int64)
        X = stack(F, rows)
        Y, M = label_matrix(ps, subs)
        return rows, X, Y, M

    _, Xtr, Ytr, Mtr = xy(train)
    _, Xte, Yte, Mte = xy(test)

    # Fit: pairs flattened; balance positives (rare) with sample weights.
    d = len(FEATURES)
    flatX = Xtr.reshape(-1, d)
    flatY = Ytr.reshape(-1)
    flatM = Mtr.reshape(-1)
    keep = flatM > 0
    scaler = Scaler().fit(flatX[keep])
    pos = flatY[keep].sum()
    wpos = (keep.sum() - pos) / max(pos, 1)
    sw = np.where(flatY[keep] == 1, wpos ** 0.5, 1.0)
    w = fit_logistic(scaler(flatX[keep]), flatY[keep], sw)
    Ptr = predict(w, scaler(Xtr))
    _, tau, tau_min, ev_tr = tune_thresholds(Ptr, Ytr, Mtr, subs, train, tau_min_floor=args.tau_min_floor)
    log(f'Trained: tau={tau:.3f} tau_min={tau_min:.3f}; training subtopic F1 {ev_tr["subtopic_prf"][2]:.3f}')

    # Held-out evaluation on random papers.
    Pte = predict(w, scaler(Xte))
    Ate = assign(Pte, tau, tau_min)
    ev_te = evaluate(Ate, Pte, Yte, Mte, subs, test)

    # Per-subtopic F1 by 5-fold cross-validation over the whole key (more examples per subtopic).
    log('Cross-validated per-subtopic accuracy…')
    rng = np.random.default_rng(7)
    folds = rng.permutation(len(key)) % 5
    _, Xall, Yall, Mall = xy(key)
    Acv = np.zeros_like(Yall, bool)
    for f in range(5):
        tr, te = folds != f, folds == f
        fx, fy, fm = Xall[tr].reshape(-1, d), Yall[tr].reshape(-1), Mall[tr].reshape(-1)
        kp = fm > 0
        if not kp.any():
            continue
        sc = Scaler().fit(fx[kp])
        pz = fy[kp].sum()
        wf = fit_logistic(sc(fx[kp]), fy[kp], np.where(fy[kp] == 1, ((kp.sum() - pz) / max(pz, 1)) ** 0.5, 1.0))
        P_tr = predict(wf, sc(Xall[tr]))
        _, ta, tm, _ = tune_thresholds(
            P_tr, Yall[tr], Mall[tr], subs, [key[i] for i in np.where(tr)[0]], tau_min_floor=args.tau_min_floor
        )
        Acv[te] = assign(predict(wf, sc(Xall[te])), ta, tm)
    per_sub = []
    for j, s in enumerate(subs):
        tp = int((Acv[:, j] & (Yall[:, j] == 1)).sum())
        fp = int((Acv[:, j] & (Yall[:, j] == 0) & (Mall[:, j] == 1)).sum())
        fn = int((~Acv[:, j] & (Yall[:, j] == 1)).sum())
        p_, r_, f_ = prf(tp, fp, fn)
        per_sub.append({'id': s['id'], 'name': s['name'], 'support': tp + fn, 'precision': p_, 'recall': r_, 'f1': f_,
                        'seeds': int(seed_counts[j])})

    # Assign everything.
    log('Scoring all papers…')
    P_all = np.zeros((n, m), np.float32)
    for s0 in range(0, n, 4096):
        rows = np.arange(s0, min(n, s0 + 4096))
        P_all[rows] = predict(w, scaler(stack(F, rows)))
    A_all = assign(P_all, tau, tau_min)
    plats = detect_platforms(papers, plat_rules, main_texts)

    # Platform accuracy on the held-out random papers.
    ptp = pfp = pfn = 0
    for p in test:
        pred = set(plats.get(idx[p['paper_id']], {}))
        true = set(p['platforms'])
        ptp += len(pred & true)
        pfp += len(pred - true)
        pfn += len(true - pred)
    plat_prf = prf(ptp, pfp, pfn)

    counts_sub = A_all.sum(0)
    stats = {'papers': n, 'assigned': int(A_all.any(1).sum()), 'no_topic': int((~A_all.any(1)).sum()),
             'labels_per_paper': float(A_all.sum(1).mean()) if n else 0.0,
             'platform_papers': {k: sum(k in v for v in plats.values()) for k in plat_rules}}

    model_out = {'generated_at': datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC'), 'embedding_model': model,
                 'features': FEATURES, 'weights': dict(zip(['bias'] + FEATURES, map(float, w))),
                 'scaler': {'mu': scaler.mu.tolist(), 'sd': scaler.sd.tolist()}, 'tau': tau, 'tau_min': tau_min,
                 'k_nn': K_NN, 'seed_trim': SEED_TRIM, 'stats': stats,
                 'eval_random': {k: (list(v) if isinstance(v, tuple) else v) for k, v in ev_te.items()},
                 'platform_prf': list(plat_prf), 'per_subtopic_cv': per_sub}
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / 'assignment_model.json').write_text(json.dumps(model_out, indent=1, default=float) + '\n', encoding='utf-8')
    write_assignment_report(out / 'assignment_report.md', model_out, subs, counts_sub, len(test))

    if not args.no_write:
        log('Writing paper_subtopics and paper_platforms…')
        rows = []
        for i, p in enumerate(papers):
            js = np.where(A_all[i])[0]
            js = js[np.argsort(-P_all[i, js])]
            for r, j in enumerate(js):
                t, s_ = subs[j]['id'].split('/')
                rows.append((p['id'], t, s_, round(float(P_all[i, j]), 4), r))
        con = sqlite3.connect(args.db)
        try:
            with con:
                con.execute('DROP TABLE IF EXISTS paper_subtopics')
                con.execute("""
                    CREATE TABLE paper_subtopics (
                        paper_id TEXT NOT NULL, topic_id TEXT NOT NULL, subtopic_id TEXT NOT NULL,
                        confidence REAL NOT NULL, rank INTEGER NOT NULL,
                        PRIMARY KEY (paper_id, subtopic_id)
                    )
                """)
                con.execute('DROP TABLE IF EXISTS paper_platforms')
                con.execute("""
                    CREATE TABLE paper_platforms (
                        paper_id TEXT NOT NULL, platform_id TEXT NOT NULL, evidence TEXT,
                        PRIMARY KEY (paper_id, platform_id)
                    )
                """)
                con.executemany('INSERT INTO paper_subtopics VALUES (?,?,?,?,?)', rows)
                con.executemany('INSERT INTO paper_platforms VALUES (?,?,?)',
                                [(papers[i]['id'], k, ev) for i, d_ in plats.items() for k, ev in d_.items()])
                con.execute('CREATE INDEX IF NOT EXISTS idx_paper_subtopics_sub ON paper_subtopics(subtopic_id)')
                con.execute('CREATE INDEX IF NOT EXISTS idx_paper_subtopics_topic ON paper_subtopics(topic_id)')
        finally:
            con.close()
        log(f'  {len(rows):,} paper-subtopic rows')
        public_taxonomy = Path(args.public_taxonomy + ('.tmp' if args.staged else ''))
        export_public_taxonomy(tax, public_taxonomy)
        log(f'  {public_taxonomy}')
    log(f'Done in {time.time() - t0:.0f} s. Report: {out / "assignment_report.md"}')


if __name__ == '__main__':
    main()
