// geometry/poly.ts — convex-polygon and RegionValue primitives (§7.3, §8.1).
//
// ConvexPoly = CCW vertex list (canonical start = lex-min for stored values;
// raw clip output preserves edge order — run canonicalizePoly for the
// invariant). RegionValue = one convex poly or a finite union thereof.
// No strategy-layer types live here (§8.5).
import { Rat } from "./rat.ts";
import { cmpPt, eqPt, pt } from "./pt.ts";
import type { Pt } from "./pt.ts";
import { orient, signedArea2 } from "./predicates.ts";

export type ConvexPoly = readonly Pt[];

export type RegionValue =
  | { kind: "poly"; verts: readonly Pt[] }
  | { kind: "union"; parts: readonly RegionValue[] };

// Signed twice-area (shoelace, exact). Positive for CCW.
export function polygonArea2(poly: ConvexPoly): Rat {
  let acc = Rat.ZERO;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i] as Pt;
    const b = poly[(i + 1) % poly.length] as Pt;
    acc = acc.add(a.x.mul(b.y).sub(b.x.mul(a.y)));
  }
  return acc;
}

// regionNonEmpty (§7.3): ≥ 3 vertices and strictly positive area.
export function regionNonEmpty(poly: ConvexPoly): boolean {
  return poly.length >= 3 && polygonArea2(poly).sign() > 0;
}

// Exact Sutherland–Hodgman with the complete four-case rule (§22.3).
// side ≥ 0 (boundary INCLUDED) means inside. Consecutive duplicates removed.
export function clipConvexByHalfPlane(
  poly: ConvexPoly,
  a: Pt,
  b: Pt,
  keepLeft: boolean,
): Pt[] {
  const side = (p: Pt): -1 | 0 | 1 => {
    const s = signedArea2(a, b, p).sign();
    return keepLeft ? s : s === 0 ? 0 : s === 1 ? -1 : 1;
  };
  // Intersection of segment cur→nxt with line(a,b): cur + t·(nxt−cur),
  // t = w(cur)/(w(cur)−w(nxt)) with w the signed area (§22.3). Exact.
  const intersect = (cur: Pt, nxt: Pt): Pt => {
    const wcur = signedArea2(a, b, cur);
    const wnxt = signedArea2(a, b, nxt);
    const denom = wcur.sub(wnxt);
    if (denom.isZero()) {
      throw new Error(
        "clipConvexByHalfPlane: parallel-degenerate crossing — implementation error",
      );
    }
    const t = wcur.div(denom);
    return pt(
      cur.x.add(t.mul(nxt.x.sub(cur.x))),
      cur.y.add(t.mul(nxt.y.sub(cur.y))),
    );
  };
  const out: Pt[] = [];
  if (poly.length === 0) {
    return out;
  }
  for (let i = 0; i < poly.length; i += 1) {
    const cur = poly[i] as Pt;
    const nxt = poly[(i + 1) % poly.length] as Pt;
    const sc = side(cur);
    const sn = side(nxt);
    if (sc >= 0 && sn >= 0) {
      out.push(nxt); // in→in: emit next
    } else if (sc >= 0 && sn < 0) {
      out.push(intersect(cur, nxt)); // in→out: emit the crossing
    } else if (sc < 0 && sn >= 0) {
      out.push(intersect(cur, nxt)); // out→in: crossing, then next
      out.push(nxt);
    }
    // out→out: emit nothing
  }
  // Dedupe consecutive equals (incl. wraparound first==last).
  const clean: Pt[] = [];
  for (const v of out) {
    const last = clean[clean.length - 1];
    if (last === undefined || !eqPt(last, v)) {
      clean.push(v);
    }
  }
  while (clean.length > 1 && eqPt(clean[0] as Pt, clean[clean.length - 1] as Pt)) {
    clean.pop();
  }
  return clean;
}

// Intersection of two convex polys: fold-clip a by each edge of b (§8.1).
// Precondition: both CCW (interior left of every edge).
export function intersectConvex(a: ConvexPoly, b: ConvexPoly): Pt[] {
  let out: Pt[] = [...a];
  for (let i = 0; i < b.length; i += 1) {
    out = clipConvexByHalfPlane(out, b[i] as Pt, b[(i + 1) % b.length] as Pt, true);
    if (out.length === 0) {
      return out;
    }
  }
  return out;
}

// All-edge orientation test (§3.7). The strict flag is mandatory (no default):
// inside-or-on iff every orient ≥ 0; strictly inside iff every orient > 0.
// Total: degenerate inputs (< 3 vertices) return false — use regionContains
// for degenerate semantics (§8.1).
export function insideConvex(
  polyCCW: ConvexPoly,
  q: Pt,
  strict: boolean,
): boolean {
  if (polyCCW.length < 3) {
    return false;
  }
  for (let i = 0; i < polyCCW.length; i += 1) {
    const a = polyCCW[i] as Pt;
    const b = polyCCW[(i + 1) % polyCCW.length] as Pt;
    const s = orient(a, b, q);
    if (strict ? s <= 0 : s < 0) {
      return false;
    }
  }
  return true;
}

function onSegment(a: Pt, b: Pt, q: Pt): boolean {
  if (orient(a, b, q) !== 0) {
    return false;
  }
  const minX = a.x.cmp(b.x) <= 0 ? a.x : b.x;
  const maxX = a.x.cmp(b.x) >= 0 ? a.x : b.x;
  const minY = a.y.cmp(b.y) <= 0 ? a.y : b.y;
  const maxY = a.y.cmp(b.y) >= 0 ? a.y : b.y;
  return (
    q.x.cmp(minX) >= 0 &&
    q.x.cmp(maxX) <= 0 &&
    q.y.cmp(minY) >= 0 &&
    q.y.cmp(maxY) <= 0
  );
}

// Containment over RegionValue (§8.1): poly via the §3.7 test with the
// degenerate semantics (0 verts: never; 1 vert: equality; 2 verts:
// on-segment; zero-area ≥3: boundary points only); union via ∃ part.
export function regionContains(
  rv: RegionValue,
  q: Pt,
  strict: boolean,
): boolean {
  if (rv.kind === "union") {
    return rv.parts.some((part) => regionContains(part, q, strict));
  }
  const v = rv.verts;
  if (v.length === 0) {
    return false;
  }
  if (strict) {
    if (v.length < 3 || polygonArea2(v).sign() === 0) {
      return false;
    }
    return insideConvex(v, q, true);
  }
  if (v.length === 1) {
    return eqPt(v[0] as Pt, q);
  }
  if (v.length === 2) {
    return onSegment(v[0] as Pt, v[1] as Pt, q);
  }
  if (polygonArea2(v).sign() === 0) {
    for (let i = 0; i < v.length; i += 1) {
      if (onSegment(v[i] as Pt, v[(i + 1) % v.length] as Pt, q)) {
        return true;
      }
    }
    return false;
  }
  return insideConvex(v, q, false);
}

// Canonical serialization (lexicographic part order for unions).
export function regionKey(rv: RegionValue): string {
  if (rv.kind === "poly") {
    return `P(${rv.verts.map((p) => `${p.x.toString()},${p.y.toString()}`).join(";")})`;
  }
  return `U(${rv.parts.map(regionKey).join("|")})`;
}

// Rotate to lex-min start + drop consecutive duplicates (incl. wraparound).
// Preserves winding; CCW stays CCW.
export function canonicalizePoly(verts: readonly Pt[]): Pt[] {
  const dedup: Pt[] = [];
  for (const v of verts) {
    const last = dedup[dedup.length - 1];
    if (last === undefined || !eqPt(last, v)) {
      dedup.push(v);
    }
  }
  while (
    dedup.length > 1 &&
    eqPt(dedup[0] as Pt, dedup[dedup.length - 1] as Pt)
  ) {
    dedup.pop();
  }
  if (dedup.length === 0) {
    return dedup;
  }
  let m = 0;
  for (let i = 1; i < dedup.length; i += 1) {
    if (cmpPt(dedup[i] as Pt, dedup[m] as Pt) < 0) {
      m = i;
    }
  }
  return [...dedup.slice(m), ...dedup.slice(0, m)];
}

// Union canonicalization (§8.1): flatten nested unions; drop empty parts;
// sort parts by canonical key; remove duplicates. Parts are NOT merged.
export function canonicalizeRegion(rv: RegionValue): RegionValue {
  if (rv.kind === "poly") {
    return { kind: "poly", verts: canonicalizePoly(rv.verts) };
  }
  const flat: RegionValue[] = [];
  for (const part of rv.parts) {
    const c = canonicalizeRegion(part);
    if (c.kind === "union") {
      flat.push(...c.parts);
    } else if (c.verts.length > 0) {
      flat.push(c);
    }
  }
  const keyed = flat.map((p) => ({ p, k: regionKey(p) }));
  keyed.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
  const out: RegionValue[] = [];
  let prev = "";
  for (const { p, k } of keyed) {
    if (out.length === 0 || k !== prev) {
      out.push(p);
      prev = k;
    }
  }
  return { kind: "union", parts: out };
}

// Deterministic strictly-interior point (§7.3, §22.4): centroid of the first
// non-collinear vertex triple in canonical order. Null only for degenerate
// polygons. The centroid is strictly inside the triangle, hence strictly
// inside the convex polygon.
export function canonicalInteriorPoint(poly: ConvexPoly): Pt | null {
  for (let i = 0; i < poly.length; i += 1) {
    for (let j = i + 1; j < poly.length; j += 1) {
      for (let k = j + 1; k < poly.length; k += 1) {
        const a = poly[i];
        const b = poly[j];
        const c = poly[k];
        if (a === undefined || b === undefined || c === undefined) {
          continue;
        }
        if (orient(a, b, c) !== 0) {
          const three = Rat.make(3n);
          return pt(
            a.x.add(b.x).add(c.x).div(three),
            a.y.add(b.y).add(c.y).div(three),
          );
        }
      }
    }
  }
  return null;
}
