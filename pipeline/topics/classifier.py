"""Subtopic scoring, threshold tuning, and hardware-platform detection."""
from __future__ import annotations

import re
from collections import defaultdict

import numpy as np

from pipeline.topics.data import knn, paper_texts, probe_hits

FEATURES = ['sim', 'rel', 'top1', 'top3', 'knn', 'rule', 'rule_abs']
K_NN = 15
SEED_TRIM = 0.2
L2 = 1.0

# Lowest "no topic" cut-off the threshold search may pick (measured best floor across held-out splits).
TAU_MIN_FLOOR = 0.5

COLD = re.compile(
    r'ultracold|optical lattice|optical tweezer|rydberg (atom|array)|quantum gas|fermi gas|bose gas|'
    r'bose.einstein condensat|bose.hubbard|atom array|cold atom|magneto.optical trap',
    re.I,
)
COLD_NOT = re.compile(r'polariton|exciton|photon condensate|fluid of light|plasmon', re.I)
QD = re.compile(r'quantum dot', re.I)
QD_PHOTON = re.compile(r'single.photon|photon|emitter|waveguide|fluorescence|spin', re.I)
QD_NOT = re.compile(r'light.emitting|laser', re.I)


def subtopic_table(tax) -> list[dict]:
    subs = []
    for T in tax['topics']:
        for S in T['subtopics']:
            subs.append({
                'id': f"{T['id']}/{S['id']}",
                'topic': T['id'],
                'name': S['name'],
                'rx': re.compile(S['rules']['keywords'], re.I),
            })
    return subs


def build_features(papers, E, subs, log_fn=None) -> tuple[dict, np.ndarray, list[str]]:
    """Builds per-(paper, subtopic) feature arrays and returns (features, seed_counts, main_texts)."""
    n, m = len(papers), len(subs)
    main, abst = paper_texts(papers)
    if log_fn:
        log_fn('Keyword rules…')
    rule = np.zeros((n, m), bool)
    rule_abs = np.zeros((n, m), bool)
    for j, s in enumerate(subs):
        rx = s['rx']
        for i in range(n):
            if rx.search(main[i]):
                rule[i, j] = True
            elif abst[i] and rx.search(abst[i]):
                rule_abs[i, j] = True
    if log_fn:
        log_fn('Seeds and centres…')
    seeds = rule
    dim = E.shape[1] if E.ndim == 2 and E.shape[0] else 0
    C = np.zeros((m, dim), np.float32)
    seed_final = np.zeros((n, m), bool)
    for j in range(m):
        idx = np.where(seeds[:, j])[0]
        if len(idx) == 0:
            idx = np.where(rule_abs[:, j])[0]
        if len(idx) == 0:
            continue
        c = E[idx].mean(0)
        c /= np.linalg.norm(c) + 1e-12
        if len(idx) > 40:
            s_ = E[idx] @ c
            keep = idx[s_ >= np.quantile(s_, SEED_TRIM)]
            c = E[keep].mean(0)
            c /= np.linalg.norm(c) + 1e-12
            idx = keep
        C[j] = c
        seed_final[idx, j] = True
    sim = E @ C.T if m and n else np.zeros((n, m), np.float32)
    best = sim.max(1, keepdims=True) if m and n else np.zeros((n, 1), np.float32)
    order = np.argsort(-sim, 1)
    rank = np.empty_like(order)
    if n and m:
        rank[np.arange(n)[:, None], order] = np.arange(m)[None, :]
    if log_fn:
        log_fn('Nearest neighbours…')
    nb, _ = knn(E, K_NN)
    knn_share = seed_final[nb].mean(1) if nb.shape[1] else np.zeros((n, m), np.float32)
    F = {
        'sim': sim,
        'rel': sim - best,
        'top1': (rank == 0).astype(np.float32),
        'top3': (rank < 3).astype(np.float32),
        'knn': knn_share.astype(np.float32),
        'rule': rule.astype(np.float32),
        'rule_abs': rule_abs.astype(np.float32),
    }
    return F, seed_final.sum(0), main


def stack(F, rows):
    return np.stack([F[f][rows] for f in FEATURES], -1)  # (len(rows), m, d)


class Scaler:
    def fit(self, X):
        self.mu = X.mean(0)
        self.sd = X.std(0) + 1e-6
        return self

    def __call__(self, X):
        return (X - self.mu) / self.sd


def fit_logistic(X, y, w_sample, l2=L2, iters=50):
    """Newton's method for L2-regularised logistic regression (intercept unpenalised)."""
    Xb = np.hstack([np.ones((len(X), 1)), X])
    w = np.zeros(Xb.shape[1])
    R = np.eye(Xb.shape[1]) * l2
    R[0, 0] = 0
    for _ in range(iters):
        p = 1 / (1 + np.exp(-np.clip(Xb @ w, -500, 500)))
        g = Xb.T @ ((p - y) * w_sample) + R @ w
        H = (Xb * (p * (1 - p) * w_sample)[:, None]).T @ Xb + R
        step = np.linalg.solve(H, g)
        w -= step
        if np.abs(step).max() < 1e-6:
            break
    return w


def predict(w, X):
    Xb = np.concatenate([np.ones(X.shape[:-1] + (1,)), X], -1)
    return 1 / (1 + np.exp(-np.clip(Xb @ w, -500, 500)))


def label_matrix(key_papers, subs):
    """y (len, m) in {0,1}; mask (len, m): 0 where a pair is ambiguous (paper labelled with the topic only)."""
    sid = {s['id']: j for j, s in enumerate(subs)}
    m = len(subs)
    Y = np.zeros((len(key_papers), m), np.float32)
    M = np.ones((len(key_papers), m), np.float32)
    for r, p in enumerate(key_papers):
        for l in p['labels']:
            if '/' in l:
                Y[r, sid[l]] = 1
            else:  # topic-only label: subtopics of that topic are unknown, not negative
                for j, s in enumerate(subs):
                    if s['topic'] == l:
                        M[r, j] = 0
    return Y, M


def assign(P, tau, tau_min):
    """Boolean (n, m): every subtopic with P >= tau; the best one if it clears tau_min; nothing below tau_min."""
    if len(P) == 0 or P.shape[1] == 0:
        return np.zeros(P.shape, bool)
    A = P >= tau
    best = P.argmax(1)
    ok = P[np.arange(len(P)), best] >= tau_min
    A[np.arange(len(P))[ok], best[ok]] = True
    A[~ok] = False
    return A


def prf(tp, fp, fn):
    p = tp / (tp + fp) if tp + fp else 0.0
    r = tp / (tp + fn) if tp + fn else 0.0
    return p, r, (2 * p * r / (p + r) if p + r else 0.0)


def evaluate(A, P, Y, M, subs, key_papers):
    tp = ((A == 1) & (Y == 1) & (M == 1)).sum()
    fp = ((A == 1) & (Y == 0) & (M == 1)).sum()
    fn = ((A == 0) & (Y == 1)).sum()
    sub_prf = prf(tp, fp, fn)
    ttp = tfp = tfn = 0
    top1_sub = top1_topic = 0
    none_tp = none_fp = none_fn = 0
    for r, p in enumerate(key_papers):
        true_t = {l.split('/')[0] for l in p['labels']}
        pred_t = {subs[j]['topic'] for j in np.where(A[r])[0]}
        ttp += len(true_t & pred_t)
        tfp += len(pred_t - true_t)
        tfn += len(true_t - pred_t)
        if A[r].any():
            b = int(np.argmax(np.where(A[r], P[r], -1)))
            top1_sub += subs[b]['id'] in p['labels']
            top1_topic += subs[b]['topic'] in true_t
        none_true, none_pred = not p['labels'], not A[r].any()
        none_tp += none_true and none_pred
        none_fp += none_pred and not none_true
        none_fn += none_true and not none_pred
    n = max(len(key_papers), 1)
    labels_per = float(A.sum(1).mean()) if len(A) else 0.0
    return {
        'subtopic_prf': sub_prf,
        'topic_prf': prf(ttp, tfp, tfn),
        'top1_subtopic': top1_sub / n,
        'top1_topic': top1_topic / n,
        'no_topic_prf': prf(none_tp, none_fp, none_fn),
        'labels_per_paper': labels_per,
    }


def tune_thresholds(P, Y, M, subs, key_papers, tau_min_floor: float = TAU_MIN_FLOOR):
    best = None
    for tau in np.arange(0.3, 0.981, 0.02):
        grid = np.concatenate([np.arange(0.01, 0.1, 0.01), np.arange(0.1, min(tau, 0.6) + 1e-9, 0.05)])
        for tau_min in grid[grid >= tau_min_floor - 1e-9]:
            A = assign(P, tau, tau_min)
            ev = evaluate(A, P, Y, M, subs, key_papers)
            # Subtopic F1 matters most; topic F1 and getting out-of-scope papers right count too.
            score = ev['subtopic_prf'][2] + 0.5 * ev['topic_prf'][2] + 0.1 * ev['no_topic_prf'][2]
            if best is None or score > best[0]:
                best = (score, float(tau), float(tau_min), ev)
    if best is None:
        ev = evaluate(assign(P, 0.5, tau_min_floor), P, Y, M, subs, key_papers)
        return (0.0, 0.5, float(tau_min_floor), ev)
    return best


def detect_platforms(papers, rules, main_texts):
    """Multi-source rule hits (>= 2 of concepts, keywords, arXiv, text) plus the two key-labelling rules."""
    hits = probe_hits(papers, rules)
    out = defaultdict(dict)
    for k, v in hits.items():
        for i in v:
            out[i][k] = 'rules'
    for i, t in enumerate(main_texts):
        if COLD.search(t) and not COLD_NOT.search(t):
            out[i].setdefault('neutral_atom', 'cold-atom keywords')
        if QD.search(t) and QD_PHOTON.search(t) and not QD_NOT.search(t):
            out[i].setdefault('spin_semiconductor', 'quantum-dot keywords')
    return out
