// geometry/twinsK8.ts — exact structure of Das–Valla Lemma 9 (k = 8).
// Reconstruction and proofs: docs/K8_GATE.md. Pure, exact (Rat), total.
//
//   heptagonPair      B0 inside the 7-hole: the rotation whose two chord halves
//                     S_j = (V_j..V_{j+3}), S_{j+3} = (V_{j+3}..V_{j+6}) both
//                     survive B0 as 5-holes meeting only in the segment B0·V_{j+3}.
//   twinTriangleEars  two 6-holes meeting exactly in a triangle whose ear apexes
//                     (one per hole) have the other two triangle vertices as
//                     their polygon neighbours (a point in the triangle is an ear
//                     of BOTH holes: replacing the apex gives a new 6-hole each).
//   interiorsDisjoint two convex polygons share no interior point.
//   earReplacement    the replacement holes after a point inside that triangle.
import { hull } from "./hull.ts";
import { isKHole } from "./holes.ts";
import type { PointId } from "./holes.ts";
import { intersectConvex, polygonArea2 } from "./poly.ts";
import type { Pt } from "./pt.ts";
import { ccwIds, twinSharedPart } from "./twinsK7.ts";

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

// True iff the two convex polygons (CCW hulls of the point lists) have no
// common interior point (zero-area intersection).
export function interiorsDisjoint(a: readonly Pt[], b: readonly Pt[]): boolean {
  const inter = intersectConvex(hull([...a]), hull([...b]));
  return inter.length < 3 || polygonArea2(inter).sign() === 0;
}

export interface HeptagonPair {
  // ring[0..6] = hole ids rotated so that quadA = ring[0..3], quadB = ring[3..6];
  // the shared vertex is ring[3]; the A1 edge is (ring[3], ring[4]).
  readonly ring: readonly PointId[];
  readonly start: number;
}

// heptagonPair: FIRST rotation (ring order) whose halves S_j, S_{j+3} both
// survive B0 as 5-holes that meet only in the segment B0·ring[3]. null if none
// (B0 may lie in too many 4-holes — that class is NOT encoded: classify it
// "no-pair", never guess).
export function heptagonPair(
  hexIds: readonly PointId[],
  b0Id: PointId,
  ptOf: PtOf,
  allPts: readonly Pt[],
): HeptagonPair | null {
  const n = hexIds.length;
  if (n !== 7) {
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
    const pentA = [...ring.slice(0, 4), b0Id];
    const pentB = [...ring.slice(3, 7), b0Id];
    const aPts = resolve(pentA, ptOf);
    const bPts = resolve(pentB, ptOf);
    if (aPts === null || bPts === null) {
      continue;
    }
    if (!isKHole(aPts, allPts) || !isKHole(bPts, allPts)) {
      continue;
    }
    const shared = pentA.filter((v) => pentB.includes(v));
    if (shared.length !== 2 || !interiorsDisjoint(aPts, bPts)) {
      continue;
    }
    return { ring, start };
  }
  return null;
}

export interface TwinEarTri {
  readonly apex: PointId;
}

export interface TwinTriangle {
  readonly triIds: readonly PointId[]; // the 3 shared vertices, CCW
  readonly tri: readonly Pt[];
  readonly earA: TwinEarTri;
  readonly earB: TwinEarTri;
}

// twinTriangleEars: exact twins of Lemma 9's first step. a, b are 6-holes that
// share exactly 3 vertices (anchors among them), meet exactly in the triangle
// on them (twinSharedPart), and each has exactly one triangle vertex whose two
// polygon neighbours are the other two triangle vertices (its ear apex = the
// whole triangle is its ear); the two apexes differ.
export function twinTriangleEars(
  aIds: readonly PointId[],
  bIds: readonly PointId[],
  anchors: readonly [PointId, PointId],
  ptOf: PtOf,
): TwinTriangle | null {
  const part = twinSharedPart(aIds, bIds, ptOf, 3);
  if (part === null) {
    return null;
  }
  const [x, y] = anchors;
  if (x === y || !part.ids.includes(x) || !part.ids.includes(y)) {
    return null;
  }
  const triIds = ccwIds(part.ids, ptOf) as PointId[];
  const earOf = (ids: readonly PointId[]): TwinEarTri | null => {
    const ring = ccwIds(ids, ptOf) as PointId[];
    let found: TwinEarTri | null = null;
    for (let i = 0; i < ring.length; i += 1) {
      const v = ring[i] as PointId;
      if (!triIds.includes(v)) {
        continue;
      }
      const prev = ring[(i + ring.length - 1) % ring.length] as PointId;
      const next = ring[(i + 1) % ring.length] as PointId;
      if (triIds.includes(prev) && triIds.includes(next) && prev !== next) {
        if (found !== null) {
          return null;
        }
        found = { apex: v };
      }
    }
    return found;
  };
  const earA = earOf(aIds);
  const earB = earOf(bIds);
  if (earA === null || earB === null || earA.apex === earB.apex) {
    return null;
  }
  return { triIds, tri: part.part, earA, earB };
}

export interface EarReplacement {
  // The two replacement 6-holes (CCW id lists) after B1 inside the triangle:
  // twinA with its apex replaced by B1, twinB likewise. They share exactly the
  // edge [edgeU, edgeV] = (B1 and the third triangle vertex).
  readonly holeA: readonly PointId[];
  readonly holeB: readonly PointId[];
  readonly thirdVertex: PointId;
}

// earReplacement: apex replacement lists (not verified here — the strategy
// re-asserts them with exact hole checks).
export function earReplacement(
  aIds: readonly PointId[],
  bIds: readonly PointId[],
  t: TwinTriangle,
  b1Id: PointId,
  ptOf: PtOf,
): EarReplacement | null {
  const ra = ccwIds(aIds, ptOf);
  const rb = ccwIds(bIds, ptOf);
  if (ra === null || rb === null) {
    return null;
  }
  const holeA = ra.map((v) => (v === t.earA.apex ? b1Id : v));
  const holeB = rb.map((v) => (v === t.earB.apex ? b1Id : v));
  const third = t.triIds.find((v) => v !== t.earA.apex && v !== t.earB.apex);
  if (third === undefined) {
    return null;
  }
  return { holeA, holeB, thirdVertex: third };
}

// Rotate a CCW id list so that `u` is first and its CCW successor is `v`
// (null if u,v are not consecutive in that order).
export function rotateToEdge(
  ring: readonly PointId[],
  u: PointId,
  v: PointId,
): PointId[] | null {
  const i = ring.indexOf(u);
  if (i < 0 || ring[(i + 1) % ring.length] !== v) {
    return null;
  }
  return ring.map((_, j) => ring[(i + j) % ring.length] as PointId);
}
