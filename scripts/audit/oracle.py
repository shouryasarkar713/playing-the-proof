#!/usr/bin/env python3
"""Independent exact-arithmetic reference ("oracle") for the audit.

stdlib only. Shares NO code with src/geometry. Deliberately does NOT use
Andrew's monotone chain. Everything works on points given as 2-tuples of
`fractions.Fraction` (or plain `int`; the formulas only use + - *).

Provided:
  rational ops        rat_parse / rat_str / rat_op
  orient(a,b,c)       sign of (b-a)x(c-a)
  is_gp(P)            distinct + no collinear triple
  extreme_points(P)   points that are NOT in the convex hull of the others
                      ("vertex iff not in a closed triangle / on a segment
                      of other points")  -- method 1
  hull_ccw(P)         gift wrapping (Jarvis march), strict vertices, CCW,
                      starting at the lexicographic minimum  -- method 2
  convex_position(P)  n>=3, distinct, every point extreme
  in_triangle_strict, in_convex_polygon(poly_ccw, q, strict)
  k_holes_triangles(P,k)   brute force: S is a k-hole iff every one of its
                           C(k,3) triangles contains no other point of P
                           strictly inside (Subercaseaux et al., ITP 2024,
                           iff_triangles)
  k_holes_hull(P,k)        brute force: S in convex position and no point of
                           P \\ S strictly inside hull(S)
  k_holes(P,k)             runs both and asserts they agree
"""
from fractions import Fraction
from itertools import combinations
import re

# ---------------------------------------------------------------- rationals

_RAT_RE = re.compile(r"^(-?[0-9]+)(?:/(-?[0-9]+))?$")


def rat_parse(s):
    """Parse "n" or "n/d" (ASCII '-' or U+2212). Returns Fraction.
    Raises ValueError on malformed input or zero denominator.
    Leading/trailing whitespace is NOT accepted here (see probes)."""
    t = s.replace("−", "-")
    m = _RAT_RE.match(t)
    if not m:
        raise ValueError("malformed rational: %r" % (s,))
    n = int(m.group(1))
    d = int(m.group(2)) if m.group(2) is not None else 1
    if d == 0:
        raise ValueError("zero denominator: %r" % (s,))
    return Fraction(n, d)


def rat_str(q):
    """Canonical wire form "n/d": d>0, gcd=1, ASCII minus, zero is 0/1."""
    q = Fraction(q)
    return "%d/%d" % (q.numerator, q.denominator)


def rat_op(op, a, b=None):
    """Reference binary/unary ops on Fractions. Raises ZeroDivisionError."""
    if op == "add":
        return a + b
    if op == "sub":
        return a - b
    if op == "mul":
        return a * b
    if op == "div":
        if b == 0:
            raise ZeroDivisionError
        return a / b
    if op == "cmp":
        return (a > b) - (a < b)
    if op == "neg":
        return -a
    if op == "abs":
        return abs(a)
    if op == "sign":
        return (a > 0) - (a < 0)
    raise ValueError(op)


# -------------------------------------------------------------- orientation


def det(a, b, c):
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def orient(a, b, c):
    d = det(a, b, c)
    return (d > 0) - (d < 0)


def is_gp(P):
    n = len(P)
    if len(set(map(tuple, P))) != n:
        return False
    for i in range(n):
        for j in range(i + 1, n):
            for k in range(j + 1, n):
                if det(P[i], P[j], P[k]) == 0:
                    return False
    return True


# --------------------------------------------------------------- containment


def in_triangle_strict(a, b, c, q):
    s1, s2, s3 = orient(a, b, q), orient(b, c, q), orient(c, a, q)
    return (s1 > 0 and s2 > 0 and s3 > 0) or (s1 < 0 and s2 < 0 and s3 < 0)


def _on_segment_open(a, b, q):
    """q strictly between a and b on segment (q != a, b)."""
    if det(a, b, q) != 0:
        return False
    if q == a or q == b:
        return False
    return (min(a[0], b[0]) <= q[0] <= max(a[0], b[0])
            and min(a[1], b[1]) <= q[1] <= max(a[1], b[1]))


def in_triangle_closed(a, b, c, q):
    s = [orient(a, b, q), orient(b, c, q), orient(c, a, q)]
    return all(x >= 0 for x in s) or all(x <= 0 for x in s)


def in_convex_polygon(poly_ccw, q, strict):
    """poly_ccw: >=3 vertices in CCW order (strictly convex).
    strict -> q strictly inside; else inside-or-on-boundary."""
    n = len(poly_ccw)
    if n < 3:
        return False
    for i in range(n):
        s = orient(poly_ccw[i], poly_ccw[(i + 1) % n], q)
        if (s <= 0) if strict else (s < 0):
            return False
    return True


# --------------------------------------------------------------------- hull


def _distinct(P):
    return sorted(set(map(tuple, P)))


def extreme_points(P):
    """Method 1. Distinct points that are not in conv(others).
    By Caratheodory (d=2) q is in conv(S) iff q is in a closed triangle of
    three points of S or on a segment between two points of S.
    Returns a sorted list of tuples."""
    D = _distinct(P)
    if len(D) <= 2:
        return D
    res = []
    for q in D:
        others = [p for p in D if p != q]
        inside = False
        for a, b in combinations(others, 2):
            if _on_segment_open(a, b, q):
                inside = True
                break
        if not inside:
            for a, b, c in combinations(others, 3):
                if det(a, b, c) != 0 and in_triangle_closed(a, b, c, q):
                    inside = True
                    break
        if not inside:
            res.append(q)
    return res


def hull_ccw(P):
    """Method 2. Gift wrapping. Strict vertices only (collinear boundary
    points dropped), duplicates removed, CCW, starting at lexicographic min.
    <=2 distinct points: returned as-is (sorted)."""
    D = _distinct(P)
    if len(D) <= 2:
        return D
    start = D[0]
    out = [start]
    p = start
    while True:
        q = D[1] if D[0] == p else D[0]
        for r in D:
            if r == p or r == q:
                continue
            o = orient(p, q, r)
            if o < 0:
                q = r
            elif o == 0:
                # collinear with p: keep the farther one
                if (abs(r[0] - p[0]) + abs(r[1] - p[1])
                        > abs(q[0] - p[0]) + abs(q[1] - p[1])):
                    q = r
        if q == start:
            break
        out.append(q)
        p = q
        if len(out) > len(D):
            raise RuntimeError("gift wrapping failed to terminate")
    return out


def hull_checked(P):
    """hull_ccw, asserting agreement with extreme_points as sets."""
    h = hull_ccw(P)
    e = extreme_points(P)
    assert sorted(h) == sorted(e), (h, e)
    return h


def convex_position(P):
    P = [tuple(p) for p in P]
    if len(P) < 3:
        return False
    if len(set(P)) != len(P):
        return False
    return len(extreme_points(P)) == len(P)


# -------------------------------------------------------------------- holes


def _triangle_masks(P):
    """mask[(i,j,l)] (i<j<l) = bitmask of indices m (m not in {i,j,l})
    with P[m] strictly inside triangle P[i]P[j]P[l]."""
    n = len(P)
    mask = {}
    for i, j, l in combinations(range(n), 3):
        m = 0
        for t in range(n):
            if t in (i, j, l):
                continue
            if in_triangle_strict(P[i], P[j], P[l], P[t]):
                m |= 1 << t
        mask[(i, j, l)] = m
    return mask


def k_holes_triangles(P, k):
    """Brute force via 'all C(k,3) triangles empty'. P must be in GP.
    Returns sorted list of index tuples (ascending)."""
    n = len(P)
    mask = _triangle_masks(P)
    res = []
    for S in combinations(range(n), k):
        if all(mask[t] == 0 for t in combinations(S, 3)):
            res.append(S)
    return res


def k_holes_hull(P, k):
    """Brute force via convex position + no outside point strictly inside
    hull(S). P must be in GP. Returns sorted list of index tuples."""
    n = len(P)
    res = []
    for S in combinations(range(n), k):
        sub = [P[i] for i in S]
        h = hull_ccw(sub)
        if len(h) != k:
            continue
        ok = True
        for t in range(n):
            if t in S:
                continue
            if in_convex_polygon(h, P[t], strict=True):
                ok = False
                break
        if ok:
            res.append(S)
    return res


def k_holes(P, k):
    """Both methods must agree (asserted)."""
    a = k_holes_triangles(P, k)
    b = k_holes_hull(P, k)
    assert a == b, ("k-hole methods disagree", k, a, b)
    return a


def hole_ccw(P, S):
    """The hole's vertices (indices) in CCW order starting at the
    lexicographically smallest point."""
    h = hull_ccw([P[i] for i in S])
    pos = {tuple(P[i]): i for i in S}
    return [pos[p] for p in h]
