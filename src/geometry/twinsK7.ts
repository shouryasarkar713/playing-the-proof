// geometry/twinsK7.ts — exact structure of Lemma 8 (Das–Valla, k = 7):
// "two 5-holes intersecting in one triangle" (before A1) and "two 6-holes
// intersecting in one convex quadrilateral" (after A1), plus the chord-half
// selection that guarantees the first pair exists for EVERY B0 inside the
// starting 6-hole (AUDIT-style derivation in docs/K7_GATE.md).
//
// Everything here is exact (Rat), pure and total. The strategy/engine layers
// call these; they never re-derive the structure.
import { hull } from "./hull.ts";
import { isKHole } from "./holes.ts";
import type { PointId } from "./holes.ts";
import { intersectConvex, polygonArea2 } from "./poly.ts";
import type { Pt } from "./pt.ts";

type PtOf = (id: PointId) => Pt | null;

function resolve(ids: readonly PointId[], ptOf: PtOf): Pt[] | null {
  const out: Pt[] = [];
  for (const id of ids) {
    const p = ptOf(id);
    if (p === null) {
      return null;
    }
    out.push(p);
  }
  return out;
}

// ids in CCW hull order (null if the points are not in convex position).
export function ccwIds(
  ids: readonly PointId[],
  ptOf: PtOf,
): PointId[] | null {
  const pts = resolve(ids, ptOf);
  if (pts === null) {
    return null;
  }
  const h = hull(pts);
  if (h.length !== pts.length) {
    return null;
  }
  const out: PointId[] = [];
  for (const q of h) {
    // hull() returns input points by value, so the match always exists.
    const at = pts.findIndex((p) => p.x.equals(q.x) && p.y.equals(q.y));
    out.push(ids[at] as PointId);
  }
  return out;
}

// twinSharedPart generalizes twinSharedTriangle to m shared vertices: the two
// holes share exactly m vertices and their intersection has exactly the area
// of the convex hull of those m shared vertices (they intersect in that convex
// m-gon and nowhere else).
export function twinSharedPart(
  aIds: readonly PointId[],
  bIds: readonly PointId[],
  ptOf: PtOf,
  m: number,
): { readonly ids: readonly PointId[]; readonly part: readonly Pt[] } | null {
  const sharedIds = aIds.filter((v) => bIds.includes(v));
  if (sharedIds.length !== m || m < 3) {
    return null;
  }
  const aPts = resolve(aIds, ptOf);
  const bPts = resolve(bIds, ptOf);
  const sPts = resolve(sharedIds, ptOf);
  if (aPts === null || bPts === null || sPts === null) {
    return null;
  }
  const hA = hull(aPts);
  const hB = hull(bPts);
  const hS = hull(sPts);
  if (hA.length !== aPts.length || hB.length !== bPts.length || hS.length !== m) {
    return null;
  }
  const inter = intersectConvex(hA, hB);
  const areaI = inter.length >= 3 ? polygonArea2(inter) : null;
  if (areaI === null || areaI.cmp(polygonArea2(hS)) !== 0) {
    return null;
  }
  return { ids: sharedIds, part: hS };
}

export interface TwinEar {
  // The twin's vertex whose two polygon neighbours are exactly the anchors.
  readonly apex: PointId;
  readonly tri: readonly Pt[]; // the ear triangle (anchor, apex, anchor), CCW
}

export interface TwinQuad {
  readonly quadIds: readonly PointId[]; // the 4 shared vertices, CCW hull order
  readonly quad: readonly Pt[];
  readonly earA: TwinEar;
  readonly earB: TwinEar;
}

// twinQuadEars: the exact structure Lemma 8's B1-survival argument consumes.
// Hole id lists a, b are EXACT quad-twins for the anchors (A1, B0) iff
//  (1) they share exactly 4 vertices, the anchors among them, and meet exactly
//      in the convex hull of those 4 (twinSharedPart);
//  (2) the anchors are OPPOSITE vertices of that quadrilateral;
//  (3) each hole has exactly one non-anchor shared vertex whose two polygon
//      neighbours in that hole are the two anchors (its ear apex), and the two
//      apexes differ.
// Then the diagonal anchor–anchor splits the quadrilateral into the two ear
// triangles, one per hole: a point inside the quadrilateral is inside the ear
// of one of the holes, and replacing that ear's apex by the point yields a
// hole again. null otherwise.
export function twinQuadEars(
  aIds: readonly PointId[],
  bIds: readonly PointId[],
  anchors: readonly [PointId, PointId],
  ptOf: PtOf,
): TwinQuad | null {
  const part = twinSharedPart(aIds, bIds, ptOf, 4);
  if (part === null) {
    return null;
  }
  const [x, y] = anchors;
  if (x === y || !part.ids.includes(x) || !part.ids.includes(y)) {
    return null;
  }
  // twinSharedPart verified the shared vertices are in convex position.
  const quadIds = ccwIds(part.ids, ptOf) as PointId[];
  const gap = quadIds.indexOf(x) - quadIds.indexOf(y);
  if (gap !== 2 && gap !== -2) {
    return null; // anchors adjacent in the quadrilateral: not its diagonal
  }
  const earOf = (ids: readonly PointId[]): TwinEar | null => {
    // twinSharedPart verified both holes are in convex position.
    const ring = ccwIds(ids, ptOf) as PointId[];
    let found: TwinEar | null = null;
    for (let i = 0; i < ring.length; i += 1) {
      const v = ring[i] as PointId;
      if (v === x || v === y || !part.ids.includes(v)) {
        continue;
      }
      const prev = ring[(i + ring.length - 1) % ring.length] as PointId;
      const next = ring[(i + 1) % ring.length] as PointId;
      if (!((prev === x && next === y) || (prev === y && next === x))) {
        continue;
      }
      if (found !== null) {
        return null;
      }
      // every id of a verified hole resolves (twinSharedPart).
      found = {
        apex: v,
        tri: [ptOf(prev) as Pt, ptOf(v) as Pt, ptOf(next) as Pt],
      };
    }
    return found;
  };
  const earA = earOf(aIds);
  const earB = earOf(bIds);
  if (earA === null || earB === null || earA.apex === earB.apex) {
    return null;
  }
  return { quadIds, quad: part.part, earA, earB };
}

export interface ChordHalfPair {
  // Ring rotation: ring[0..5] = hexagon ids rotated so that the shared edge is
  // (ring[2], ring[3]); halfA = ring[0..3], halfB = ring[2..5].
  readonly ring: readonly PointId[];
  readonly start: number; // index in the input ring of ring[0]
}

// chordHalfPair (Lemma 8, first step): the hexagon `hexIds` (CCW) has six
// 4-holes "halves" Q_i = (V_i..V_{i+3}); Q_i ∪ {B0} is a 5-hole exactly when B0
// is not in Q_i (B0 is strictly inside the hexagon, so it lies in exactly one
// of Q_i, Q_{i+3} for each chord — three survivors, always containing two Q_i,
// Q_{i+2} sharing an edge). Returns the FIRST rotation i (ring order) whose
// halves Q_i and Q_{i+2} both survive as 5-holes with B0 and whose two
// 5-holes meet exactly in the triangle (V_{i+2}, V_{i+3}, B0). null if none
// (cannot happen for B0 strictly inside an empty convex hexagon — then the
// caller's post-condition fails closed).
export function chordHalfPair(
  hexIds: readonly PointId[],
  b0Id: PointId,
  ptOf: PtOf,
  allPts: readonly Pt[],
): ChordHalfPair | null {
  const n = hexIds.length;
  if (n !== 6) {
    return null;
  }
  const b0 = ptOf(b0Id);
  if (b0 === null) {
    return null;
  }
  for (let start = 0; start < n; start += 1) {
    const ring = Array.from(
      { length: n },
      (_, j) => hexIds[(start + j) % n] as PointId,
    );
    const quadA = ring.slice(0, 4);
    const quadB = ring.slice(2, 6);
    const pentA = [...quadA, b0Id];
    const pentB = [...quadB, b0Id];
    const aPts = resolve(pentA, ptOf);
    const bPts = resolve(pentB, ptOf);
    if (aPts === null || bPts === null) {
      continue;
    }
    if (!isKHole(aPts, allPts) || !isKHole(bPts, allPts)) {
      continue;
    }
    if (twinSharedPartTriangleOk(pentA, pentB, ptOf)) {
      return { ring, start };
    }
  }
  return null;
}

function twinSharedPartTriangleOk(
  a: readonly PointId[],
  b: readonly PointId[],
  ptOf: PtOf,
): boolean {
  return twinSharedPart(a, b, ptOf, 3) !== null;
}
