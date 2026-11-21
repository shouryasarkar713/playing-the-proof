// geometry/predicates.ts — the exact predicate layer (§3.3–3.4).
//
// orient is the ONLY truly primitive predicate; everything downstream
// (hull, emptiness, clipping) reduces to orientation signs. Exact over
// rationals: products of rationals are rationals; the sign is exact.
// NOTE (lint rule, Phase 2 Done): only this file may contain the word
// "cross" — no downstream reimplementation of the orient formula.
import { eqPt } from "./pt.ts";
import type { Pt } from "./pt.ts";
import { Rat } from "./rat.ts";

// signedArea2(a,b,c) = (b.x−a.x)(c.y−a.y) − (b.y−a.y)(c.x−a.x) — the exact
// rational twice-signed-area. orient is its sign (§3.3); the magnitude is
// needed by clip intersection parameters (§22.3) and area (§7.3).
export function signedArea2(a: Pt, b: Pt, c: Pt): Rat {
  return b.x
    .sub(a.x)
    .mul(c.y.sub(a.y))
    .sub(b.y.sub(a.y).mul(c.x.sub(a.x)));
}

// orient(a,b,c) = sign((b.x−a.x)(c.y−a.y) − (b.y−a.y)(c.x−a.x)) ∈ {−1,0,+1}
// (§3.3). +1 = counter-clockwise (c left of ray a→b), −1 = clockwise,
// 0 = collinear. Four Rat-sub, two Rat-mul, one Rat-sub, one sign.
export function orient(a: Pt, b: Pt, c: Pt): -1 | 0 | 1 {
  // Exact sign WITHOUT intermediate gcd normalization (audit, perf):
  // with every denominator positive,
  //   sign((bx−ax)(cy−ay) − (by−ay)(cx−ax))
  // = sign(n1·n2·d3·d4 − n3·n4·d1·d2) for the unnormalized differences
  // (n/d). Pure bigint multiply/add — no gcd — and exactly the sign of
  // signedArea2 (cross-checked by tests/audit/oracle.test.ts and a dedicated
  // fuzz equivalence test). signedArea2 itself is unchanged.
  const dnx = b.x.n * a.x.d - a.x.n * b.x.d; // (bx−ax) numerator
  const ddx = b.x.d * a.x.d;
  const dny = c.y.n * a.y.d - a.y.n * c.y.d; // (cy−ay)
  const ddy = c.y.d * a.y.d;
  const eny = b.y.n * a.y.d - a.y.n * b.y.d; // (by−ay)
  const edy = b.y.d * a.y.d;
  const enx = c.x.n * a.x.d - a.x.n * c.x.d; // (cx−ax)
  const edx = c.x.d * a.x.d;
  const v = dnx * dny * edy * edx - eny * enx * ddx * ddy;
  return v > 0n ? 1 : v < 0n ? -1 : 0;
}

// A set is in general position iff all points are distinct and no triple
// is collinear (§3.4). O(n³) orientation calls; n ≤ 64.
export function gp(points: readonly Pt[]): boolean {
  for (let i = 0; i < points.length; i += 1) {
    const pi = points[i];
    if (pi === undefined) {
      continue;
    }
    for (let j = 0; j < i; j += 1) {
      const pj = points[j];
      if (pj === undefined) {
        continue;
      }
      if (eqPt(pi, pj)) {
        return false;
      }
    }
  }
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      for (let k = j + 1; k < points.length; k += 1) {
        const a = points[i];
        const b = points[j];
        const c = points[k];
        if (a === undefined || b === undefined || c === undefined) {
          continue;
        }
        if (orient(a, b, c) === 0) {
          return false;
        }
      }
    }
  }
  return true;
}

// Strict interior test for a single triangle (a,b,c), any winding:
// q is strictly inside iff it lies strictly to the same side of all
// three directed edges. Used by the hull cross-check and hole analysis.
export function insideTriangleStrict(
  a: Pt,
  b: Pt,
  c: Pt,
  q: Pt,
): boolean {
  const s1 = orient(a, b, q);
  const s2 = orient(b, c, q);
  const s3 = orient(c, a, q);
  return (
    (s1 > 0 && s2 > 0 && s3 > 0) || (s1 < 0 && s2 < 0 && s3 < 0)
  );
}
