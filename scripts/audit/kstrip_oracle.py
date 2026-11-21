#!/usr/bin/env python3
"""Independent exact oracle for k-strips (shares NO code with src/kstrip).

stdlib only. Definition 2 of Dzuklevski et al. is evaluated LITERALLY and in a
different way than src/kstrip: the region C = conv(P) + v is replaced by the
finite convex polygon conv(P u (P + M v)) with M astronomically large (so that
every test point lies far inside the truncation), classified with signed edge
tests of a Graham-scan hull. No shear/frame, no cones.

  python -I scripts/audit/kstrip_oracle.py          # regenerates the fixture

Fixture: tests/kstrip/fixtures/strips.json, consumed by tests/kstrip/oracle.test.ts.
Each instance: direction v, point set S, and for chosen vertex subsets P:
  expectStrip      -- P is a strict k-strip w.r.t. S (Def. 2 + our strictness:
                      distinct v-projections, int(C)&S empty, bdry(C)&S == P)
  extensions[q]    -- for q in S\\P strictly beyond an end of P (in the
                      v-projection): P u {q} is a strict strip w.r.t. S
                      (ground truth for "q in cl(C-) u cl(C+)").
"""
import json
import random
from fractions import Fraction as F
from itertools import combinations
from pathlib import Path

M = F(10) ** 40


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1])


def det(a, b):
    return a[0] * b[1] - a[1] * b[0]


def orient(a, b, c):
    d = det(sub(b, a), sub(c, a))
    return (d > 0) - (d < 0)


def hull(points):
    pts = sorted(set(points))
    if len(pts) <= 2:
        return pts
    lo = []
    for p in pts:
        while len(lo) >= 2 and orient(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    up = []
    for p in reversed(pts):
        while len(up) >= 2 and orient(up[-2], up[-1], p) <= 0:
            up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]


def on_segment(a, b, q):
    return orient(a, b, q) == 0 and min(a[0], b[0]) <= q[0] <= max(a[0], b[0]) and min(a[1], b[1]) <= q[1] <= max(a[1], b[1])


def classify(poly, q):
    """'interior' | 'boundary' | 'exterior' of a convex polygon (ccw) / segment."""
    if len(poly) == 1:
        return "boundary" if poly[0] == q else "exterior"
    if len(poly) == 2:
        return "boundary" if on_segment(poly[0], poly[1], q) else "exterior"
    signs = [orient(poly[i], poly[(i + 1) % len(poly)], q) for i in range(len(poly))]
    if any(s < 0 for s in signs):
        return "exterior"
    if any(s == 0 for s in signs):
        return "boundary"
    return "interior"


def region_poly(P, v):
    ext = [(p[0] + M * v[0], p[1] + M * v[1]) for p in P]
    return hull(list(P) + ext)


def is_strip(P, S, v):
    # strictness conventions of the implementation: distinct projections along v
    for a, b in combinations(P, 2):
        if det(v, sub(a, b)) == 0:
            return False
    poly = region_poly(P, v)
    bd = set()
    for q in S:
        c = classify(poly, q)
        if c == "interior":
            return False
        if c == "boundary":
            bd.add(q)
    if bd != set(P):
        return False
    # P in strictly convex position along the front: every vertex must be a
    # vertex of the hull polygon of the region (no vertex under the chain).
    verts = set(poly)
    return all(p in verts for p in P)


def proj(v, p):
    # coordinate along the direction perpendicular to v (monotone along the front)
    return det(v, p)


def s(q):
    return f"{q.numerator}/{q.denominator}"


def gen_points(rng, n):
    while True:
        pts = set()
        while len(pts) < n:
            pts.add((F(rng.randint(-12, 12), rng.choice([1, 1, 2, 3])), F(rng.randint(-12, 12), rng.choice([1, 1, 2, 3]))))
        pts = list(pts)
        if all(orient(a, b, c) != 0 for a, b, c in combinations(pts, 3)):
            return pts


DIRS = [(F(0), F(-1)), (F(1, 3), F(-1)), (F(-2), F(-1)), (F(1, 2), F(-2)), (F(0), F(1)), (F(1), F(1))]


def main():
    rng = random.Random(20261121)
    out = []
    pos_by_k = {1: 0, 2: 0, 3: 0, 4: 0}
    for _ in range(110):
        n = rng.choice([5, 6, 7, 8])
        S = gen_points(rng, n)
        v = rng.choice(DIRS)
        inst = {"v": [s(v[0]), s(v[1])], "S": [[s(p[0]), s(p[1])] for p in S], "cases": []}
        for k in (1, 2, 3, 4):
            subs = list(combinations(range(n), k))
            rng.shuffle(subs)
            for sub_idx in subs[:12]:
                P = [S[i] for i in sub_idx]
                ok = is_strip(P, S, v)
                case = {"P": list(sub_idx), "expectStrip": ok, "extensions": []}
                if ok:
                    pos_by_k[k] += 1
                    keys = sorted(proj(v, p) for p in P)
                    lo, hi = keys[0], keys[-1]
                    for qi in range(n):
                        if qi in sub_idx:
                            continue
                        pk = proj(v, S[qi])
                        if lo < pk < hi:
                            continue
                        if pk == lo or pk == hi:
                            continue
                        S2 = S
                        ext = is_strip(P + [S[qi]], S2, v)
                        case["extensions"].append({"q": qi, "expects": ext})
                inst["cases"].append(case)
        out.append(inst)
    path = Path(__file__).resolve().parents[2] / "tests" / "kstrip" / "fixtures" / "strips.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"positives": pos_by_k, "instances": out}))
    print("wrote", path, pos_by_k)


if __name__ == "__main__":
    main()
