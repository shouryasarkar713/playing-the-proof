#!/usr/bin/env python3
"""Independent check of the Overmars 29-point set (Heule-Scheucher, TACAS
2024, arXiv:2403.00737, Fig. 8, p. 16), using scripts/audit/oracle.py only.

Usage:  python -I scripts/audit/overmars_check.py [--slow]
  --slow additionally recounts convex/empty 5- and 6-gons with the
  hull-based brute force over all C(29,k) subsets (a few minutes).
Writes scripts/audit/out/overmars_result.json
"""
import json
import os
import re
import sys
import time
from itertools import combinations

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import oracle  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
BUNDLE = os.path.abspath(os.path.join(REPO, ".."))
PDF = os.path.join(BUNDLE, "papers",
                   "Heule_Scheucher_EmptyHexagon_TACAS2024_arXiv2403.00737.pdf")
OUT = os.path.join(HERE, "out")
os.makedirs(OUT, exist_ok=True)


def extract_pdf_points():
    import pymupdf
    doc = pymupdf.open(PDF)
    page = doc[15]  # p. 16
    text = page.get_text()
    assert "Fig. 8" in text
    head = text.split("Fig. 8", 1)[0]
    after = head.split("coordinates:", 1)[1]
    nums = [int(t) for t in re.findall(r"-?\d+", after)]
    assert len(nums) % 2 == 0, len(nums)
    return [(nums[i], nums[i + 1]) for i in range(0, len(nums), 2)]


def layers(P):
    rest = list(P)
    out = []
    while rest:
        h = oracle.hull_ccw(rest)
        out.append(h)
        hs = set(h)
        rest = [p for p in rest if p not in hs]
    return out


def counts_by_triangles(P, kmax=8):
    """convex k-subsets and empty k-subsets, k=3..kmax, via triangle masks."""
    n = len(P)
    mask = oracle._triangle_masks(P)
    convex = {k: 0 for k in range(3, kmax + 1)}
    empty = {k: 0 for k in range(3, kmax + 1)}

    def rec_convex(S, Smask):
        k = len(S)
        if k >= 3:
            convex[k] += 1
        if k == kmax:
            return
        last = S[-1] if S else -1
        for v in range(last + 1, n):
            ok = True
            # old triples must not contain v
            for t in combinations(S, 3):
                if (mask[t] >> v) & 1:
                    ok = False
                    break
            if ok:
                nm = Smask | (1 << v)
                for a, b in combinations(S, 2):
                    if mask[(a, b, v)] & nm:
                        ok = False
                        break
            if ok:
                rec_convex(S + [v], Smask | (1 << v))

    def rec_empty(S):
        k = len(S)
        if k >= 3:
            empty[k] += 1
        if k == kmax:
            return
        last = S[-1] if S else -1
        for v in range(last + 1, n):
            if all(mask[(a, b, v)] == 0 for a, b in combinations(S, 2)):
                rec_empty(S + [v])

    rec_convex([], 0)
    rec_empty([])
    return convex, empty


def counts_by_hull(P, k):
    """hull-based brute force over all C(n,k) subsets."""
    n = len(P)
    nconv = nempty = 0
    for S in combinations(range(n), k):
        sub = [P[i] for i in S]
        h = oracle.hull_ccw(sub)
        if len(h) != k:
            continue
        nconv += 1
        inS = set(S)
        ok = True
        for t in range(n):
            if t not in inS and oracle.in_convex_polygon(h, P[t], True):
                ok = False
                break
        if ok:
            nempty += 1
    return nconv, nempty


def main():
    slow = "--slow" in sys.argv
    t0 = time.time()
    res = {}
    pdfpts = extract_pdf_points()
    res["pdf_points"] = pdfpts
    res["pdf_n"] = len(pdfpts)
    repo = json.load(open(os.path.join(REPO, "data", "scenarios", "overmars29.json")))
    proto = json.load(open(os.path.join(BUNDLE, "prototype",
                                        "overmars29_points_and_verification.json")))
    rsch = json.load(open(os.path.join(BUNDLE, "research", "overmars29_results.json")))
    rp = [tuple(p) for p in repo["points"]]
    res["pdf_equals_repo_scenario"] = (pdfpts == rp)
    res["pdf_equals_prototype_json"] = (pdfpts == [tuple(p) for p in proto["points"]])
    res["pdf_equals_research_json"] = (pdfpts == [tuple(p) for p in rsch["points"]])
    res["prototype_json_equals_research_json"] = (proto == rsch)
    P = pdfpts
    res["x_strictly_increasing"] = all(P[i][0] < P[i + 1][0] for i in range(len(P) - 1))
    res["distinct"] = len(set(P)) == len(P)
    res["gp"] = oracle.is_gp(P)
    col = [t for t in combinations(range(len(P)), 3)
           if oracle.det(P[t[0]], P[t[1]], P[t[2]]) == 0]
    res["collinear_triples"] = col
    L = layers(P)
    res["hull_layer_sizes"] = [len(x) for x in L]
    # cross-check layer 1 and 2 with the independent 'extreme point' method
    e1 = oracle.extreme_points(P)
    res["layer1_extreme_method_agrees"] = sorted(L[0]) == sorted(e1)
    rest = [p for p in P if p not in set(L[0])]
    res["layer2_extreme_method_agrees"] = sorted(L[1]) == sorted(oracle.extreme_points(rest))
    convex, empty = counts_by_triangles(P, 8)
    res["convex_k_subsets_by_triangle_method"] = convex
    res["empty_k_subsets_by_triangle_method"] = empty
    res["time_fast_s"] = round(time.time() - t0, 1)
    json.dump(res, open(os.path.join(OUT, "overmars_result.json"), "w"), indent=1)
    if slow:
        for k in (5, 6):
            t1 = time.time()
            c, e = counts_by_hull(P, k)
            res["hull_method_k%d" % k] = {"convex": c, "empty": e,
                                         "seconds": round(time.time() - t1, 1)}
            json.dump(res, open(os.path.join(OUT, "overmars_result.json"), "w"), indent=1)
    res["total_s"] = round(time.time() - t0, 1)
    json.dump(res, open(os.path.join(OUT, "overmars_result.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
