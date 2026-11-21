#!/usr/bin/env python3
"""Deterministic (seeded) fixture generator for tests/audit/oracle.test.ts.

Usage:  python -I scripts/audit/gen_fixtures.py
Writes (compact JSON; every rational is the wire string "n/d"):
  tests/audit/fixtures/rat.json         Rat ops / parse / make
  tests/audit/fixtures/orient.json      orientation triples
  tests/audit/fixtures/pointsets.json   point sets: gp, hull, convex-position, k-holes (GP sets)
  tests/audit/fixtures/polygon.json     point-in-convex-polygon cases
All expected values come from scripts/audit/oracle.py (no TS code involved).
"""
import json
import os
import random
import sys
from fractions import Fraction as F
from itertools import combinations

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import oracle  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(REPO, "tests", "audit", "fixtures")
os.makedirs(OUT, exist_ok=True)
SEED = 20261114
rng = random.Random(SEED)

S = oracle.rat_str


def dump(name, obj):
    with open(os.path.join(OUT, name), "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, separators=(",", ":"), sort_keys=True, ensure_ascii=True)
        f.write("\n")


# ------------------------------------------------------------------ helpers


def rand_int(cls):
    if cls == "zero":
        return 0
    if cls == "small":
        return rng.randint(-20, 20)
    if cls == "mid":
        return rng.randint(-10**6, 10**6)
    if cls == "huge":  # ~10^30
        return rng.randint(-10**30, 10**30) or 10**30
    if cls == "pow":
        return rng.choice([-1, 1]) * 10**rng.randint(15, 30) + rng.randint(-2, 2)
    raise ValueError(cls)


def rand_frac(num_cls=None, den_cls=None):
    nc = num_cls or rng.choice(["zero", "small", "small", "mid", "huge", "pow"])
    dc = den_cls or rng.choice(["small", "small", "mid", "huge", "pow"])
    n = rand_int(nc)
    d = abs(rand_int(dc)) or 1
    return F(n, d)


def noncanon(q):
    """Non-canonical textual form of q: common factor, maybe sign on denominator,
    maybe U+2212 minus, maybe integer without '/1'."""
    q = F(q)
    n, d = q.numerator, q.denominator
    g = rng.choice([1, 1, 2, 3, 7, 10, 10**10, 10**20])
    n, d = n * g, d * g
    if rng.random() < 0.3:
        n, d = -n, -d
    s = "%d/%d" % (n, d)
    if d == 1 and rng.random() < 0.5:
        s = str(n)
    if rng.random() < 0.15:
        s = s.replace("-", "−")
    return s


# ------------------------------------------------------------------ rat.json


def gen_rat():
    parse = []
    fixed = [
        ("-3/7", "-3/7"), ("−3/7", "-3/7"), ("10/-4", "-5/2"),
        ("-10/-4", "5/2"), ("0", "0/1"), ("0/5", "0/1"), ("-0/5", "0/1"),
        ("0/-5", "0/1"), ("5", "5/1"), ("5/1", "5/1"), ("-5", "-5/1"),
        ("−5", "-5/1"), ("−5/−10", "1/2"), ("6/4", "3/2"),
        ("1000000000000000000000000000000/1", "1000000000000000000000000000000/1"),
        ("-1000000000000000000000000000000/3", "-1000000000000000000000000000000/3"),
        ("1000000000000000000000000000000/1000000000000000000000000000000", "1/1"),
        ("2000000000000000000000000000000/-4000000000000000000000000000000", "-1/2"),
        ("007/0014", "1/2"), ("-007", "-7/1"),
    ]
    for s, out in fixed:
        assert S(oracle.rat_parse(s)) == out, (s, out)
        parse.append({"in": s, "out": out})
    for _ in range(120):
        q = rand_frac()
        s = noncanon(q)
        parse.append({"in": s, "out": S(oracle.rat_parse(s))})
    # expected errors (rejected by the reference parser)
    bad = ["", " ", "abc", "1/0", "0/0", "-1/0", "1/2/3", "1.5", "1e3", "/3", "3/",
           "--3", "3/-", "−", "1 / 2", "0x10", "١٢", "NaN", "1/−",
           "5/0000", "1,5", "-", "1//2", "3/7x"]
    for s in bad:
        try:
            oracle.rat_parse(s)
        except ValueError:
            parse.append({"in": s, "out": None})
        else:
            raise AssertionError("oracle accepted %r" % s)

    # make(n,d) with decimal-string bigints
    make = []
    for n, d in [(2, -4), (4, -6), (0, -5), (0, 7), (-3, -9), (10**30, 10**30),
                 (10**30, -10**29), (7, 1), (-7, 1), (1, 3)]:
        make.append({"n": str(n), "d": str(d), "out": S(F(n, d))})
    for _ in range(80):
        n = rand_int(rng.choice(["zero", "small", "mid", "huge"]))
        d = rand_int(rng.choice(["small", "mid", "huge", "pow"])) or 1
        make.append({"n": str(n), "d": str(d), "out": S(F(n, d))})
    for n in (0, 5, -5, 10**30):
        make.append({"n": str(n), "d": "0", "out": None})

    ops = []
    for _ in range(600):
        op = rng.choice(["add", "sub", "mul", "div", "cmp"])
        a = rand_frac()
        mode = rng.random()
        if mode < 0.15:
            b = a  # equal operands
        elif mode < 0.30:
            b = a + F(1, 10**rng.randint(15, 30))  # nearly equal
        elif mode < 0.38:
            b = F(0)
        else:
            b = rand_frac()
        ta, tb = noncanon(a), noncanon(b)
        a, b = oracle.rat_parse(ta), oracle.rat_parse(tb)
        try:
            r = oracle.rat_op(op, a, b)
            out = str(r) if op == "cmp" else S(r)
            ops.append({"op": op, "a": ta, "b": tb, "out": out})
        except ZeroDivisionError:
            ops.append({"op": op, "a": ta, "b": tb, "out": None})
    # guaranteed div-by-zero and zero numerator cases
    for a in ("5", "-3/7", "0", "10000000000000000000000000000/3"):
        for z in ("0", "0/5", "0/-3"):
            ops.append({"op": "div", "a": a, "b": z, "out": None})
    ops.append({"op": "div", "a": "0", "b": "-3/7", "out": "0/1"})
    for _ in range(80):
        op = rng.choice(["neg", "abs", "sign"])
        a = rand_frac()
        ta = noncanon(a)
        r = oracle.rat_op(op, oracle.rat_parse(ta))
        ops.append({"op": op, "a": ta, "b": None,
                    "out": str(r) if op == "sign" else S(r)})
    dump("rat.json", {"seed": SEED, "parse": parse, "make": make, "ops": ops})
    return len(parse), len(make), len(ops)


# -------------------------------------------------------------- orient.json


def P(x, y):
    return (F(x), F(y))


def enc(p):
    return [S(p[0]), S(p[1])]


def gen_orient():
    cases = []

    def add(a, b, c, cat):
        cases.append({"cat": cat, "a": enc(a), "b": enc(b), "c": enc(c),
                      "o": oracle.orient(a, b, c)})

    def rpt(cls="small", dcls="small"):
        return (rand_frac(cls, dcls), rand_frac(cls, dcls))

    for _ in range(80):
        add(P(rng.randint(-9, 9), rng.randint(-9, 9)),
            P(rng.randint(-9, 9), rng.randint(-9, 9)),
            P(rng.randint(-9, 9), rng.randint(-9, 9)), "small-int")
    for _ in range(60):
        add(rpt("small", "small"), rpt("small", "small"), rpt("small", "small"), "rational")
    for _ in range(60):  # exactly collinear (rational parameter)
        a, b = rpt("small", "small"), rpt("small", "small")
        if a == b:
            continue
        t = F(rng.randint(-20, 20), rng.randint(1, 9))
        c = (a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))
        add(a, b, c, "collinear")
        assert cases[-1]["o"] == 0
    for _ in range(50):  # horizontal / vertical / diagonal collinear
        k = rng.randint(-5, 5)
        add(P(0, k), P(1, k), P(rng.randint(-9, 9), k), "collinear-axis")
        add(P(k, 0), P(k, 3), P(k, rng.randint(-9, 9)), "collinear-axis")
    for _ in range(60):  # near collinear: offsets of 1/10^20
        a, b = (F(0), F(0)), (F(rng.randint(1, 9)), F(rng.randint(1, 9)))
        t = F(rng.randint(2, 20), rng.randint(1, 5))
        c = (a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))
        eps = F(rng.choice([-1, 1]), 10**rng.choice([20, 20, 25, 30]))
        if rng.random() < 0.5:
            c = (c[0], c[1] + eps)
        else:
            c = (c[0] + eps, c[1])
        add(a, b, c, "near-collinear")
        assert cases[-1]["o"] != 0
    for _ in range(30):  # near-collinear with the three points almost equal
        base = rpt("mid", "small")
        d = F(1, 10**20)
        add(base, (base[0] + d, base[1] + d), (base[0] + 2 * d, base[1] + 2 * d + d * d), "near-collinear-tiny")
        add(base, (base[0] + d, base[1] + d), (base[0] + 2 * d, base[1] + 2 * d), "collinear-tiny")
    for _ in range(60):  # huge coordinates ~10^25
        h = lambda: F(rng.randint(-10**25, 10**25))
        add((h(), h()), (h(), h()), (h(), h()), "huge-int")
    for _ in range(40):  # huge collinear / near-collinear
        a = (F(rng.randint(-10**25, 10**25)), F(rng.randint(-10**25, 10**25)))
        v = (F(rng.randint(-10**12, 10**12)), F(rng.randint(-10**12, 10**12)))
        t1, t2 = rng.randint(-10**12, 10**12), rng.randint(-10**12, 10**12)
        b = (a[0] + t1 * v[0], a[1] + t1 * v[1])
        c = (a[0] + t2 * v[0], a[1] + t2 * v[1])
        add(a, b, c, "huge-collinear")
        c2 = (c[0], c[1] + 1)
        add(a, b, c2, "huge-near-collinear")
    for _ in range(40):  # huge rationals
        add(rpt("huge", "huge"), rpt("huge", "huge"), rpt("huge", "huge"), "huge-rational")
    for _ in range(20):  # degenerate: repeated points
        a, b = rpt(), rpt()
        add(a, a, b, "repeat")
        add(a, b, a, "repeat")
        add(b, a, a, "repeat")
    dump("orient.json", {"seed": SEED, "cases": cases})
    return len(cases)


# ----------------------------------------------------------- pointsets.json


def random_set(n, kind):
    pts = []
    while len(pts) < n:
        if kind == "int":
            p = P(rng.randint(-30, 30), rng.randint(-30, 30))
        elif kind == "rat":
            p = (F(rng.randint(-60, 60), rng.randint(1, 12)),
                 F(rng.randint(-60, 60), rng.randint(1, 12)))
        elif kind == "mixed":
            p = (F(rng.randint(-30, 30)),
                 F(rng.randint(-60, 60), rng.randint(1, 7)))
            if rng.random() < 0.5:
                p = (p[1], p[0])
        elif kind == "huge":
            p = (F(rng.randint(-10**25, 10**25)), F(rng.randint(-10**25, 10**25), rng.randint(1, 10**5)))
        elif kind == "grid":  # tiny grid -> many collinear triples
            p = P(rng.randint(0, 4), rng.randint(0, 4))
        else:
            raise ValueError(kind)
        pts.append(p)
    return pts


def convex_set(n):
    """strictly convex position: points on the parabola y = x^2 with rational x."""
    xs = set()
    while len(xs) < n:
        xs.add(F(rng.randint(-40, 40), rng.randint(1, 5)))
    xs = sorted(xs)
    sc = F(rng.randint(1, 5), rng.randint(1, 5))
    pts = [(x, sc * x * x + F(rng.randint(-1, 1), 1000) * 0) for x in xs]
    rng.shuffle(pts)
    return pts


def describe(name, pts, with_holes):
    pts = [tuple(p) for p in pts]
    ent = {"name": name, "n": len(pts), "pts": [enc(p) for p in pts]}
    ent["distinct"] = len(set(pts)) == len(pts)
    ent["gp"] = oracle.is_gp(pts)
    h = oracle.hull_checked(pts)
    ent["hull"] = [enc(p) for p in h]
    ent["convex"] = oracle.convex_position(pts)
    if with_holes:
        assert ent["gp"]
        holes = {}
        nonholes = {}
        for k in range(3, 7):
            hs = oracle.k_holes(pts, k)  # asserts triangle-method == hull-method
            hs_set = set(hs)
            holes[str(k)] = [oracle.hole_ccw(pts, s) for s in hs]
            if len(pts) >= k:
                allk = [c for c in combinations(range(len(pts)), k) if c not in hs_set]
                rng.shuffle(allk)
                nonholes[str(k)] = [list(c) for c in sorted(allk[:25])]
        ent["holes"] = holes
        ent["nonholes"] = nonholes
    return ent


def gen_pointsets():
    sets = []
    idx = 0

    def addset(pts, tag, with_holes=None):
        nonlocal idx
        pts = [tuple(p) for p in pts]
        wh = oracle.is_gp(pts) if with_holes is None else with_holes
        sets.append(describe("%s-%03d" % (tag, idx), pts, wh))
        idx += 1

    # GP sets, n = 3..12, several kinds
    for n in range(3, 13):
        for kind in ("int", "rat", "mixed"):
            for _ in range(2 if n <= 9 else 1):
                while True:
                    pts = random_set(n, kind)
                    if oracle.is_gp(pts):
                        break
                addset(pts, "gp-%s-n%d" % (kind, n))
    for n in (3, 5, 8, 12):  # huge coordinates
        while True:
            pts = random_set(n, "huge")
            if oracle.is_gp(pts):
                break
        addset(pts, "gp-huge-n%d" % n)
    for n in range(3, 13):  # convex position (all holes present)
        addset(convex_set(n), "convex-n%d" % n)
    # nearly-degenerate GP: a point at distance 1e-20 from a segment
    for n in (4, 6, 9):
        base = [P(0, 0), P(10, 0), P(5, 8)]
        pts = base + [P(5, F(1, 10**20)), P(2, F(1, 10**20) * 7)]
        while len(pts) < n:
            pts.append(P(rng.randint(-5, 15), rng.randint(-5, 12)))
        if oracle.is_gp(pts):
            addset(pts, "gp-nearcollinear-n%d" % len(pts))
    # NON-GP sets (hull / convex-position / gp only)
    for n in range(3, 13):
        for _ in range(2):
            pts = random_set(n, "grid")
            addset(pts, "nongp-grid-n%d" % n, with_holes=False)
    for n in (5, 8, 11):  # duplicates
        pts = random_set(n - 2, "int")
        pts += [pts[rng.randrange(len(pts))] for _ in range(2)]
        rng.shuffle(pts)
        addset(pts, "dup-n%d" % n, with_holes=False)
    dupcv = convex_set(6)
    addset(dupcv + [dupcv[0]], "dup-convex-n7", with_holes=False)
    # hand-crafted degenerate sets
    hand = {
        "all-collinear-n3": [P(0, 0), P(1, 1), P(2, 2)],
        "all-collinear-n7": [P(i * 3, i * 3 + 1) for i in (4, 0, 5, 2, 1, 3, 6)],
        "all-collinear-vertical-n5": [P(2, i) for i in (3, 1, 0, 4, 2)],
        "two-points": [P(0, 0), P(3, 4)],
        "one-point": [P(1, 1)],
        "same-point-x3": [P(1, 1), P(1, 1), P(1, 1)],
        "two-distinct-one-dup": [P(0, 0), P(1, 2), P(0, 0)],
        "square+center": [P(0, 0), P(4, 0), P(4, 4), P(0, 4), P(2, 2)],
        "square+edge-mid": [P(0, 0), P(4, 0), P(4, 4), P(0, 4), P(2, 0)],
        "square+all-mids": [P(0, 0), P(4, 0), P(4, 4), P(0, 4), P(2, 0), P(4, 2), P(2, 4), P(0, 2)],
        "triangle+edge-mid": [P(0, 0), P(6, 0), P(0, 6), P(3, 3)],
        "triangle+vertex-on-edge-line-outside": [P(0, 0), P(6, 0), P(0, 6), P(9, 0)],
        "collinear-3-plus-off": [P(0, 0), P(1, 0), P(2, 0), P(1, 5)],
        "pentagon-convex-rational": [P(0, 0), (F(7, 2), F(-1, 3)), (F(9, 2), F(5, 2)), (F(2, 1), F(13, 3)), (F(-1, 2), F(5, 2))],
        "4-with-one-inside-rational": [P(0, 0), P(9, 0), P(0, 9), (F(7, 3), F(11, 5))],
    }
    for name, pts in hand.items():
        addset(pts, "hand-" + name)
    dump("pointsets.json", {"seed": SEED, "sets": sets})
    return len(sets), sum(1 for s in sets if "holes" in s), sum(1 for s in sets if not s["gp"])


# ------------------------------------------------------------- polygon.json


def gen_polygon():
    cases = []
    for t in range(60):
        n = rng.randint(3, 9)
        kind = rng.choice(["int", "rat", "mixed"])
        while True:
            pts = random_set(n + 3, kind)
            hl = oracle.hull_ccw(pts)
            if len(hl) >= 3:
                break
        poly = hl
        m = len(poly)
        cx = sum(p[0] for p in poly) / m
        cy = sum(p[1] for p in poly) / m
        qs = []
        qs.append((cx, cy, "centroid"))
        for p in poly:
            qs.append((p[0], p[1], "vertex"))
        for i in range(m):
            a, b = poly[i], poly[(i + 1) % m]
            mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
            qs.append((mx, my, "edge-mid"))
            qs.append((a[0] + 3 * (b[0] - a[0]), a[1] + 3 * (b[1] - a[1]), "edge-line-out"))
            qs.append((a[0] - (b[0] - a[0]) / 2, a[1] - (b[1] - a[1]) / 2, "edge-line-out"))
            nx, ny = -(b[1] - a[1]), (b[0] - a[0])  # inward normal for CCW
            e = F(1, 10**20)
            qs.append((mx + e * nx, my + e * ny, "edge-inward-1e-20"))
            qs.append((mx - e * nx, my - e * ny, "edge-outward-1e-20"))
            # between centroid and vertex
            qs.append(((cx + a[0]) / 2, (cy + a[1]) / 2, "interior-half"))
        for _ in range(6):
            qs.append((F(rng.randint(-80, 80), rng.randint(1, 9)), F(rng.randint(-80, 80), rng.randint(1, 9)), "random"))
        queries = []
        for x, y, cat in qs:
            q = (F(x), F(y))
            queries.append({
                "cat": cat,
                "q": enc(q),
                "strict": oracle.in_convex_polygon(poly, q, True),
                "closed": oracle.in_convex_polygon(poly, q, False),
            })
        cases.append({"poly": [enc(p) for p in poly], "queries": queries})
    dump("polygon.json", {"seed": SEED, "cases": cases})
    return len(cases), sum(len(c["queries"]) for c in cases)


if __name__ == "__main__":
    print("rat", gen_rat())
    print("orient", gen_orient())
    print("pointsets", gen_pointsets())
    print("polygon", gen_polygon())
