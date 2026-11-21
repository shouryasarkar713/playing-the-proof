// geometry/ownedholes.ts — vertex-restricted ("ownership-aware") k-hole
// search, the geometric kernel of the bichromatic game.
//
// A hole here is a k-subset of the ELIGIBLE points that is in convex
// position and whose hull contains NO point of the full set in its
// interior. Ineligible points never become vertices but still block: they
// are part of the emptiness universe `points`. Geometry stays colour-blind;
// the caller supplies the eligibility predicate (game/gamemode.ts maps
// point ownership onto it). The unrestricted functions in holes.ts are
// untouched, so monochromatic behaviour is byte-identical.
import type { Pt } from "./pt.ts";
import {
  binom,
  combinations,
  holeIfKHolePts,
} from "./holes.ts";
import type {
  FindKHolesOpts,
  HoleAnalysis,
  IdPt,
  KHole,
  PointId,
} from "./holes.ts";

// Work estimate with the same 2x safety margin as estimateHoleWork, counting
// only subsets of the m eligible points: 2*C(m,k)*k*(n-k). Domain
// 3 <= k <= 8, 0 <= m <= n <= 64; out-of-domain is a typed assert throw.
export function estimateHoleWorkAmong(n: number, m: number, k: number): number {
  if (
    !Number.isInteger(n) ||
    !Number.isInteger(m) ||
    !Number.isInteger(k) ||
    k < 3 ||
    k > 8 ||
    n < 0 ||
    n > 64 ||
    m < 0 ||
    m > n
  ) {
    throw new Error(
      `estimateHoleWorkAmong: out-of-domain (n=${n}, m=${m}, k=${k}) — implementation error`,
    );
  }
  return 2 * binom(m, k) * k * (n - k);
}

function hullVerts(
  points: readonly IdPt[],
  idx: readonly number[],
  subset: readonly Pt[],
  hullPts: readonly Pt[],
  who: string,
): PointId[] {
  return hullPts.map((h) => {
    const at = subset.indexOf(h);
    if (at < 0) {
      throw new Error(`${who}: hull vertex not in subset — implementation error`);
    }
    return (points[idx[at] as number] as IdPt).id;
  });
}

// findKHolesAmong: exhaustive / first-witness enumeration of holes whose
// VERTICES are eligible points. Same candidate-granular budget accounting as
// findKHoles (each candidate costs k*(n-k), n = ALL points). Canonical order
// is index order restricted to the eligible indices. Budget exhaustion never
// reports "no holes".
export function findKHolesAmong(
  points: readonly IdPt[],
  eligible: (id: PointId) => boolean,
  k: number,
  opts: FindKHolesOpts,
): HoleAnalysis {
  const { mode, budget } = opts;
  if (!Number.isFinite(budget) || budget < 0) {
    throw new Error(
      `findKHolesAmong: budget must be a finite number >= 0 (got ${budget}) — implementation error`,
    );
  }
  const n = points.length;
  const elig: number[] = [];
  for (let i = 0; i < n; i += 1) {
    if (eligible((points[i] as IdPt).id)) {
      elig.push(i);
    }
  }
  if (k > elig.length) {
    return { kind: "exhaustive", k, holes: [] };
  }
  const pts = points.map((p) => p.pt);
  const unit = k * (n - k);
  const holes: KHole[] = [];
  let accumulated = 0;
  let searched = 0;
  for (const combo of combinations(elig.length, k)) {
    if (accumulated + unit > budget) {
      return { kind: "budget-exhausted", k, searched };
    }
    accumulated += unit;
    searched += 1;
    const idx = combo.map((c) => elig[c] as number);
    const subset = idx.map((i) => pts[i] as Pt);
    const hullPts = holeIfKHolePts(subset, pts);
    if (hullPts !== null) {
      const hole: KHole = {
        k,
        verts: hullVerts(points, idx, subset, hullPts, "findKHolesAmong"),
      };
      if (mode === "first-witness") {
        return { kind: "witness-only", k, witness: hole, stoppedBy: "found" };
      }
      holes.push(hole);
    }
  }
  return { kind: "exhaustive", k, holes };
}

// analyzeHolesAmong: budget-guarded policy wrapper (exhaustive when the
// restricted estimate fits the budget, else first-witness) — the restricted
// analogue of analyzeHoles.
export function analyzeHolesAmong(
  points: readonly IdPt[],
  eligible: (id: PointId) => boolean,
  k: number,
  opts: { readonly budget: number },
): HoleAnalysis {
  const { budget } = opts;
  if (!Number.isFinite(budget) || budget < 0) {
    throw new Error(
      `analyzeHolesAmong: budget must be a finite number >= 0 (got ${budget}) — implementation error`,
    );
  }
  const n = points.length;
  let m = 0;
  for (const p of points) {
    if (eligible(p.id)) {
      m += 1;
    }
  }
  const inDomain = Number.isInteger(k) && k >= 3 && k <= 8 && n >= 0 && n <= 64;
  const estimate = inDomain ? estimateHoleWorkAmong(n, m, k) : 0;
  if (estimate <= budget) {
    return findKHolesAmong(points, eligible, k, { mode: "exhaustive", budget });
  }
  return findKHolesAmong(points, eligible, k, { mode: "first-witness", budget });
}

// findNewKHolesAmong: the incremental detector — exactly the holes with
// eligible vertices that contain `last`. When `last` itself is ineligible it
// is a vertex of no hole, so the result is empty by definition (a new
// blocker can only destroy holes). Same preconditions as findNewKHoles.
export function findNewKHolesAmong(
  points: readonly IdPt[],
  eligible: (id: PointId) => boolean,
  k: number,
  last: PointId,
): { holes: readonly KHole[] } {
  const n = points.length;
  const lastIdx = points.findIndex((p) => p.id === last);
  if (lastIdx < 0) {
    throw new Error(
      `findNewKHolesAmong: last ${last} names no point — implementation error`,
    );
  }
  if (!eligible(last) || k < 3 || k > n) {
    return { holes: [] };
  }
  const rest: number[] = [];
  for (let i = 0; i < n; i += 1) {
    if (i !== lastIdx && eligible((points[i] as IdPt).id)) {
      rest.push(i);
    }
  }
  if (k - 1 > rest.length) {
    return { holes: [] };
  }
  const pts = points.map((p) => p.pt);
  const holes: KHole[] = [];
  for (const combo of combinations(rest.length, k - 1)) {
    const idx = combo.map((j) => rest[j] as number);
    idx.push(lastIdx);
    const subset = idx.map((i) => pts[i] as Pt);
    const hullPts = holeIfKHolePts(subset, pts);
    if (hullPts !== null) {
      holes.push({
        k,
        verts: hullVerts(points, idx, subset, hullPts, "findNewKHolesAmong"),
      });
    }
  }
  return { holes };
}

// isHoleAmong: typed membership check for a candidate vertex-id list: every
// id names a point, is eligible, vertices are distinct, in convex position,
// and the hull is empty of every other point (any colour).
export function isHoleAmong(
  points: readonly IdPt[],
  eligible: (id: PointId) => boolean,
  verts: readonly PointId[],
): boolean {
  const byId = new Map(points.map((p) => [p.id, p.pt] as const));
  if (new Set(verts).size !== verts.length) {
    return false;
  }
  const subset: Pt[] = [];
  for (const id of verts) {
    const pt = byId.get(id);
    if (pt === undefined || !eligible(id)) {
      return false;
    }
    subset.push(pt);
  }
  return holeIfKHolePts(subset, points.map((p) => p.pt)) !== null;
}
