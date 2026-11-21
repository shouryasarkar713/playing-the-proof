// geometry/holes.ts — k-hole predicates, enumeration, and analysis (§3.9, §7.3).
//
// Identity model (reconciled with §5.1/§5.3): points threaded through
// enumeration carry their game-level identity opaquely as `IdPt`
// {id, pt} — geometry never mints ids, only carries and compares them.
// `PointId` is a string ("p1", … — §5.1; game/types.ts re-exports these
// names so the §5 vocabulary resolves to this single definition).
// Holes are reported as id lists in CCW hull order (`KHole`, §5.3); the
// bare-Pt predicate `isKHole` stays id-free for pre-placement constructions
// (whose new point has no id yet) and sandbox fixtures.
// Canonical order (§7.5) is enumeration index order == placement order;
// no lexicographic string-tuple comparison exists anywhere.
import { eqPt } from "./pt.ts";
import type { Pt } from "./pt.ts";
import { hull } from "./hull.ts";
import { orient } from "./predicates.ts";

export type PointId = string;

export interface IdPt {
  readonly id: PointId;
  readonly pt: Pt;
}

export interface KHole {
  readonly k: number;
  readonly verts: readonly PointId[]; // CCW hull order (§5.3)
}

export type HoleAnalysis =
  | { kind: "exhaustive"; k: number; holes: readonly KHole[] }
  | { kind: "witness-only"; k: number; witness: KHole; stoppedBy: "found" }
  | { kind: "budget-exhausted"; k: number; searched: number };

export interface FindKHolesOpts {
  readonly mode: "exhaustive" | "first-witness";
  readonly budget: number;
}

export interface SharedEdgePair {
  readonly first: KHole;
  readonly second: KHole;
  readonly edge: readonly [PointId, PointId];
}

// Exact binomial coefficient (bigint-exact, then converted — exact for the
// n ≤ 64, k ≤ 8 domain since C(64,8) ≈ 4.4×10^9 < 2^53).
export function binom(n: number, k: number): number {
  if (k < 0 || k > n) {
    return 0;
  }
  const kk = k > n - k ? n - k : k;
  let num = 1n;
  let den = 1n;
  for (let i = 1; i <= kk; i += 1) {
    num *= BigInt(n - kk + i);
    den *= BigInt(i);
  }
  return Number(num / den);
}

// The §7.6/§29 work estimate WITH its built-in 2× safety margin:
// 2·C(n,k)·k·(n−k) as a float. Pure, total, deterministic. Domain
// 3 ≤ k ≤ 8, 0 ≤ n ≤ 64 — out-of-domain is a typed assert throw.
export function estimateHoleWork(n: number, k: number): number {
  if (
    !Number.isInteger(n) ||
    !Number.isInteger(k) ||
    k < 3 ||
    k > 8 ||
    n < 0 ||
    n > 64
  ) {
    throw new Error(
      `estimateHoleWork: out-of-domain (n=${n}, k=${k}) — implementation error`,
    );
  }
  return 2 * binom(n, k) * k * (n - k);
}

// §24.0b named constants (derived once here via estimateHoleWork — the
// implementer never recomputes them; pinned to 66,528 / 55,440 by test).
export const N_BOOTSTRAP_EXACT = 12;
export const BOOTSTRAP_EXACT_HOLE_BUDGET_6: number = estimateHoleWork(12, 6);
export const BOOTSTRAP_EXACT_HOLE_BUDGET_5: number = estimateHoleWork(12, 5);

// Internal: the hole's hull-ordered Pts, or null. Single hull call.
export function holeIfKHolePts(
  subset: readonly Pt[],
  all: readonly Pt[],
): readonly Pt[] | null {
  if (subset.length < 3) {
    return null;
  }
  const h = hull([...subset]);
  if (h.length !== subset.length) {
    return null;
  }
  // Emptiness (§3.9): every non-vertex point must lie strictly outside at
  // least one supporting line. On-boundary points (GP-impossible live)
  // have no strictly-outside edge ⇒ treated as blockers (conservative).
  for (const q of all) {
    if (subset.some((s) => eqPt(s, q))) {
      continue;
    }
    let outside = false;
    for (let i = 0; i < h.length; i += 1) {
      const a = h[i] as Pt;
      const b = h[(i + 1) % h.length] as Pt;
      if (orient(a, b, q) < 0) {
        outside = true;
        break;
      }
    }
    if (!outside) {
      return null;
    }
  }
  return h;
}

// isKHole(subset, all) (§3.9): convex position + emptiness over bare Pts.
// Total even for collinear sandbox inputs.
export function isKHole(
  subset: readonly Pt[],
  all: readonly Pt[],
): boolean {
  return holeIfKHolePts(subset, all) !== null;
}

// Lexicographic k-combinations of {0..n−1} in canonical index order (§7.5).
export function* combinations(n: number, k: number): Generator<readonly number[]> {
  if (k > n || k < 0) {
    return;
  }
  const idx: number[] = [];
  for (let i = 0; i < k; i += 1) {
    idx.push(i);
  }
  for (;;) {
    yield [...idx];
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) {
      i -= 1;
    }
    if (i < 0) {
      return;
    }
    const v = (idx[i] as number) + 1;
    for (let j = i; j < k; j += 1) {
      idx[j] = v + (j - i);
    }
  }
}

// findKHoles(points, k, opts) (§7.3, §22.5): full enumeration in canonical
// index order with candidate-granular inclusive budget accounting — each
// candidate costs exactly k·(n−k); a candidate may start iff
// accumulated + k·(n−k) ≤ budget. Exhaustion NEVER reports "no holes".
// Vertices are reported as PointIds in hull order (resolved by reference
// against the input array — hull preserves element references).
export function findKHoles(
  points: readonly IdPt[],
  k: number,
  opts: FindKHolesOpts,
): HoleAnalysis {
  const { mode, budget } = opts;
  if (!Number.isFinite(budget) || budget < 0) {
    throw new Error(
      `findKHoles: budget must be a finite number ≥ 0 (got ${budget}) — implementation error`,
    );
  }
  const n = points.length;
  if (k > n) {
    return { kind: "exhaustive", k, holes: [] };
  }
  const pts = points.map((p) => p.pt);
  const unit = k * (n - k);
  const holes: KHole[] = [];
  let accumulated = 0;
  let searched = 0;
  for (const combo of combinations(n, k)) {
    if (accumulated + unit > budget) {
      return { kind: "budget-exhausted", k, searched };
    }
    accumulated += unit;
    searched += 1;
    const subset = combo.map((i) => pts[i] as Pt);
    const hullPts = holeIfKHolePts(subset, pts);
    if (hullPts !== null) {
      // Hull preserves element references: map each hull vertex back to its
      // input index (SameValueZero), then to its PointId.
      const verts = hullPts.map((h) => {
        const at = subset.indexOf(h);
        if (at < 0) {
          throw new Error(
            "findKHoles: hull vertex not in subset — implementation error",
          );
        }
        return (points[combo[at] as number] as IdPt).id;
      });
      const hole: KHole = { k, verts };
      if (mode === "first-witness") {
        return { kind: "witness-only", k, witness: hole, stoppedBy: "found" };
      }
      holes.push(hole);
    }
  }
  return { kind: "exhaustive", k, holes };
}

// analyzeHoles(points, k, { budget }) (§7.3): the budget-guarded policy
// wrapper for sandbox/diagnostics. Estimate within budget ⇒ exhaustive run
// with the SAME budget value threaded through; otherwise first-witness.
// Guided win detection NEVER uses this path.
export function analyzeHoles(
  points: readonly IdPt[],
  k: number,
  opts: { readonly budget: number },
): HoleAnalysis {
  const { budget } = opts;
  if (!Number.isFinite(budget) || budget < 0) {
    throw new Error(
      `analyzeHoles: budget must be a finite number ≥ 0 (got ${budget}) — implementation error`,
    );
  }
  const n = points.length;
  const inDomain =
    Number.isInteger(k) && k >= 3 && k <= 8 && n >= 0 && n <= 64;
  const estimate = inDomain ? estimateHoleWork(n, k) : 0;
  if (estimate <= budget) {
    return findKHoles(points, k, { mode: "exhaustive", budget });
  }
  return findKHoles(points, k, { mode: "first-witness", budget });
}

// findNewKHoles(points, k, last) (§7.3): the incremental guided-mode win
// detector. Enumerates exactly the k-subsets containing `last`.
// Preconditions (engine-maintained): points in GP; points ∖ {last} has no
// k-hole; last names the just-placed point. The internal guard cannot trip
// at guided sizes — tripping throws IMPLEMENTATION-ERROR.
export function findNewKHoles(
  points: readonly IdPt[],
  k: number,
  last: PointId,
): { holes: readonly KHole[] } {
  const n = points.length;
  const lastIdx = points.findIndex((p) => p.id === last);
  if (lastIdx < 0) {
    throw new Error(
      `findNewKHoles: last ${last} names no point — implementation error`,
    );
  }
  if (k < 3 || k > n) {
    return { holes: [] };
  }
  const rest: number[] = [];
  for (let i = 0; i < n; i += 1) {
    if (i !== lastIdx) {
      rest.push(i);
    }
  }
  const pts = points.map((p) => p.pt);
  const holes: KHole[] = [];
  const unit = k * (n - k);
  // Internal guard: the incremental domain is smaller than the full sweep,
  // so estimateHoleWork(n, k) always covers it — tripping means a bug.
  const guard =
    n <= 64 && k >= 3 && k <= 8 ? estimateHoleWork(n, k) : Number.POSITIVE_INFINITY;
  let accumulated = 0;
  for (const combo of combinations(n - 1, k - 1)) {
    if (accumulated + unit > guard) {
      throw new Error(
        "findNewKHoles: IMPLEMENTATION-ERROR — incremental guard tripped",
      );
    }
    accumulated += unit;
    const idx = combo.map((j) => rest[j] as number);
    idx.push(lastIdx);
    const subset = idx.map((i) => pts[i] as Pt);
    const hullPts = holeIfKHolePts(subset, pts);
    if (hullPts !== null) {
      const verts = hullPts.map((h) => {
        const at = subset.indexOf(h);
        if (at < 0) {
          throw new Error(
            "findNewKHoles: hull vertex not in subset — implementation error",
          );
        }
        return (points[idx[at] as number] as IdPt).id;
      });
      holes.push({ k, verts });
    }
  }
  return { holes };
}

// witnessOf (§10.9): witness-only → its witness; else null. Pure.
export function witnessOf(analysis: HoleAnalysis): KHole | null {
  return analysis.kind === "witness-only" ? analysis.witness : null;
}

// sharedEdgePairs(holes) (§22.5): pairs sharing exactly 2 vertex ids that
// are hull-adjacent in BOTH holes (ported from the §2.6 prototype matcher).
export function sharedEdgePairs(
  holes: readonly KHole[],
): SharedEdgePair[] {
  const edgesOf = (hole: KHole): Array<readonly [PointId, PointId]> => {
    const vs = hole.verts;
    const out: Array<readonly [PointId, PointId]> = [];
    for (let i = 0; i < vs.length; i += 1) {
      out.push([vs[i] as PointId, vs[(i + 1) % vs.length] as PointId]);
    }
    return out;
  };
  const sameEdge = (
    e1: readonly [PointId, PointId],
    e2: readonly [PointId, PointId],
  ): boolean =>
    (e1[0] === e2[0] && e1[1] === e2[1]) ||
    (e1[0] === e2[1] && e1[1] === e2[0]);
  const pairs: SharedEdgePair[] = [];
  for (let i = 0; i < holes.length; i += 1) {
    for (let j = i + 1; j < holes.length; j += 1) {
      const a = holes[i] as KHole;
      const b = holes[j] as KHole;
      for (const e1 of edgesOf(a)) {
        for (const e2 of edgesOf(b)) {
          if (sameEdge(e1, e2)) {
            pairs.push({ first: a, second: b, edge: e1 });
          }
        }
      }
    }
  }
  return pairs;
}
