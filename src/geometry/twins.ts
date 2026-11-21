// geometry/twins.ts — the exact structural test for Lemma 7's "two 5-holes
// intersecting in one triangle" (Das–Valla Fig. 1; audit).
//
// Two 5-holes sharing exactly 3 vertices do NOT necessarily meet only in the
// triangle on those vertices — and the B1 survival argument ("B1 lies in at
// most one twin unless it lies in the shared triangle") needs exactly that.
// twinSharedTriangle decides it exactly: the shared vertices must number 3
// and area(hull A ∩ hull B) must equal the area of their triangle.
import { hull } from "./hull.ts";
import type { PointId } from "./holes.ts";
import { intersectConvex, polygonArea2 } from "./poly.ts";
import type { Pt } from "./pt.ts";

// The shared triangle's vertices (CCW hull order) when `a` and `b` (hole
// vertex id lists) form exact twins; null otherwise. Total: never throws on
// well-formed hole records.
export function twinSharedTriangle(
  aIds: readonly PointId[],
  bIds: readonly PointId[],
  ptOf: (id: PointId) => Pt | null,
): { readonly ids: readonly PointId[]; readonly tri: readonly Pt[] } | null {
  const sharedIds = aIds.filter((v) => bIds.includes(v));
  if (sharedIds.length !== 3) {
    return null;
  }
  const resolve = (ids: readonly PointId[]): Pt[] | null => {
    const out: Pt[] = [];
    for (const id of ids) {
      const p = ptOf(id);
      if (p === null) {
        return null;
      }
      out.push(p);
    }
    return out;
  };
  const aPts = resolve(aIds);
  const bPts = resolve(bIds);
  const triPts = resolve(sharedIds);
  if (aPts === null || bPts === null || triPts === null) {
    return null;
  }
  const hA = hull(aPts);
  const hB = hull(bPts);
  const tri = hull(triPts);
  if (hA.length !== aPts.length || hB.length !== bPts.length || tri.length !== 3) {
    return null;
  }
  const inter = intersectConvex(hA, hB);
  const areaI = inter.length >= 3 ? polygonArea2(inter) : null;
  if (areaI === null || areaI.cmp(polygonArea2(tri)) !== 0) {
    return null;
  }
  return { ids: sharedIds, tri };
}

// The three vertices two hole id-lists share (null unless exactly 3) with
// their triangle — NO exactness claim. Used for case LABELS (classifyB1);
// the exactness obligation is carried by twinSharedTriangle (selection
// preference + the k6-inv:twinpair post-condition).
export function sharedTriple(
  aIds: readonly PointId[],
  bIds: readonly PointId[],
  ptOf: (id: PointId) => Pt | null,
): { readonly ids: readonly PointId[]; readonly tri: readonly Pt[] } | null {
  const ids = aIds.filter((v) => bIds.includes(v));
  if (ids.length !== 3) {
    return null;
  }
  const pts: Pt[] = [];
  for (const id of ids) {
    const p = ptOf(id);
    if (p === null) {
      return null;
    }
    pts.push(p);
  }
  const tri = hull(pts);
  return tri.length === 3 ? { ids, tri } : null;
}
