#!/usr/bin/env python3
"""Weighted scoring for the approaches. Reads calc_raw_scores.csv and calc_weights.csv,
writes calc_weighted_scores.csv and calc_sensitivity.csv. Run: python3 score.py"""
import csv, itertools
raw = list(csv.DictReader(open('calc_raw_scores.csv')))
wts = list(csv.DictReader(open('calc_weights.csv')))
crit = [c for c in raw[0].keys() if c.startswith('C')]
def tot(row, w): return sum(float(row[c]) * float(w[c]) for c in crit)
for w in wts: assert abs(sum(float(w[c]) for c in crit) - 1) < 1e-9, w['set']
out = []
for w in wts:
    ranked = sorted(raw, key=lambda r: -tot(r, w))
    for i, r in enumerate(ranked, 1):
        out.append({'weight_set': w['set'], 'rank': i, 'approach': r['approach'], 'score_0_5': round(tot(r, w), 3)})
with open('calc_weighted_scores.csv', 'w', newline='') as f:
    wr = csv.DictWriter(f, fieldnames=out[0].keys()); wr.writeheader(); wr.writerows(out)
# sensitivity: shift any single raw score by +-1 (clamped 0..5); does the rank-1 approach change?
sens = []
for w in wts:
    base = max(raw, key=lambda r: tot(r, w))['approach']
    flips = total = 0
    for r in raw:
        for c in crit:
            for d in (-1, 1):
                v = float(r[c]) + d
                if not 0 <= v <= 5: continue
                mod = [dict(x) for x in raw]
                for m in mod:
                    if m['approach'] == r['approach']: m[c] = str(v)
                total += 1
                if max(mod, key=lambda x: tot(x, w))['approach'] != base: flips += 1
    sens.append({'weight_set': w['set'], 'rank1_baseline': base, 'single_score_perturbations': total, 'perturbations_that_change_rank1': flips})
with open('calc_sensitivity.csv', 'w', newline='') as f:
    wr = csv.DictWriter(f, fieldnames=sens[0].keys()); wr.writeheader(); wr.writerows(sens)
for o in out: print(o)
for s in sens: print(s)
