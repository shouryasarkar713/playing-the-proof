// kstrip/region.ts — exact k-strip regions C = conv(P) + v (Definition 2).
//
// Representation (formal): for a halfline direction v with v.y != 0 let T be
// the exact frame map of frame.ts. For a strip P with frame images
// s'_1..s'_k (strictly increasing x', strictly concave: every consecutive
// triple turns right), the closed region is the UNBOUNDED polygon
//
//     C' = { (x,y) : x'_1 <= x <= x'_k,  y <= chain(x) }
//
// i.e. the chain s'_1..s'_k closed by two halflines (rays in direction d)
// from the end vertices. It is never clipped to a finite box. Membership is
// classified exactly with orient:  interior / boundary / exterior.
//
// Definition 2 (paper): P (convex position) is a k-strip w.r.t. S iff
// int(C) ∩ S = ∅ and ∂C ∩ S = P. For k >= 2 and P ⊂ ∂C this forces P to be a
// cap in the frame (a vertex below the chain would lie in int(C)); we require
// the stricter, general-position reading "strictly concave, strictly
// increasing x'" (no collinear triple, no two vertices on one v-line) —
// [implemented convention]. k = 1: C = p + v is a halfline with empty
// interior; every point of it is a boundary point.
import { eqPt } from "../geometry/pt.ts";
import type { Pt } from "../geometry/pt.ts";
import { orient } from "../geometry/predicates.ts";
import { Rat } from "../geometry/rat.ts";
import { DOWN, frameOf, fromFrame, isIdentity, toFrame } from "./frame.ts";
import type { Dir, Frame } from "./frame.ts";

export type Classification = "interior" | "boundary" | "exterior";

export type StripFailureCode =
  | "empty-set"
  | "vertex-not-in-S"
  | "duplicate-vertex"
  | "shared-projection"
  | "not-cap"
  | "interior-point"
  | "boundary-point";

export interface StripFailure {
  readonly code: StripFailureCode;
  readonly message: string;
  readonly witness?: Pt;
}

export type StripResult =
  | { readonly ok: true; readonly region: StripRegion }
  | { readonly ok: false; readonly reason: StripFailure };

export type RegionResult = StripResult;

function fail(code: StripFailureCode, message: string, witness?: Pt): StripResult {
  return witness === undefined
    ? { ok: false, reason: { code, message } }
    : { ok: false, reason: { code, message, witness } };
}

export class StripRegion {
  // Vertices in base coordinates, sorted by increasing frame-x.
  readonly vertices: readonly Pt[];
  readonly frame: Frame;
  // Frame images (same order).
  readonly fv: readonly Pt[];
  private readonly ident: boolean;

  private constructor(vertices: readonly Pt[], frame: Frame, fv: readonly Pt[]) {
    this.vertices = vertices;
    this.frame = frame;
    this.fv = fv;
    this.ident = isIdentity(frame);
  }

  // Build the region of vertex set P for direction v (no S involved).
  static make(P: readonly Pt[], v: Dir = DOWN): StripResult {
    if (P.length === 0) {
      return fail("empty-set", "a strip needs at least one vertex");
    }
    const frame = frameOf(v);
    const tagged = P.map((p) => ({ p, f: toFrame(frame, p) }));
    tagged.sort((a, b) => a.f.x.cmp(b.f.x) || a.f.y.cmp(b.f.y));
    for (let i = 1; i < tagged.length; i += 1) {
      const a = tagged[i - 1];
      const b = tagged[i];
      if (a === undefined || b === undefined) {
        continue;
      }
      if (eqPt(a.p, b.p)) {
        return fail("duplicate-vertex", "two vertices coincide", b.p);
      }
      if (a.f.x.equals(b.f.x)) {
        return fail(
          "shared-projection",
          "two vertices lie on one line parallel to v (equal frame x)",
          b.p,
        );
      }
    }
    for (let i = 2; i < tagged.length; i += 1) {
      const a = tagged[i - 2];
      const b = tagged[i - 1];
      const c = tagged[i];
      if (a === undefined || b === undefined || c === undefined) {
        continue;
      }
      if (orient(a.f, b.f, c.f) >= 0) {
        return fail(
          "not-cap",
          "consecutive vertices do not make a strict right turn in the v-frame",
          b.p,
        );
      }
    }
    return {
      ok: true,
      region: new StripRegion(
        tagged.map((t) => t.p),
        frame,
        tagged.map((t) => t.f),
      ),
    };
  }

  get k(): number {
    return this.vertices.length;
  }

  // Frame-x interval [lo, hi] of the closed region (its projection).
  xRange(): { lo: Rat; hi: Rat } {
    const first = this.fv[0] as Pt;
    const last = this.fv[this.fv.length - 1] as Pt;
    return { lo: first.x, hi: last.x };
  }

  // Exact classification of a base-coordinate point.
  classify(p: Pt): Classification {
    return this.classifyFrame(this.ident ? p : toFrame(this.frame, p));
  }

  classifyFrame(q: Pt): Classification {
    const fv = this.fv;
    const first = fv[0] as Pt;
    const last = fv[fv.length - 1] as Pt;
    if (fv.length === 1) {
      return q.x.equals(first.x) && q.y.cmp(first.y) <= 0
        ? "boundary"
        : "exterior";
    }
    const cl = q.x.cmp(first.x);
    const cr = q.x.cmp(last.x);
    if (cl < 0 || cr > 0) {
      return "exterior";
    }
    if (cl === 0) {
      return q.y.cmp(first.y) <= 0 ? "boundary" : "exterior";
    }
    if (cr === 0) {
      return q.y.cmp(last.y) <= 0 ? "boundary" : "exterior";
    }
    // first.x < q.x < last.x: locate edge i with fv[i].x <= q.x < fv[i+1].x.
    let lo = 0;
    let hi = fv.length - 1; // fv[lo].x <= q.x < fv[hi].x
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((fv[mid] as Pt).x.cmp(q.x) <= 0) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    const o = orient(fv[lo] as Pt, fv[lo + 1] as Pt, q);
    if (o > 0) {
      return "exterior";
    }
    return o === 0 ? "boundary" : "interior";
  }

  // Height (frame y) of the chain at frame x in [lo,hi].
  chainHeight(xf: Rat): Rat {
    const fv = this.fv;
    if (fv.length === 1) {
      return (fv[0] as Pt).y;
    }
    for (let i = 0; i + 1 < fv.length; i += 1) {
      const a = fv[i] as Pt;
      const b = fv[i + 1] as Pt;
      if (xf.cmp(a.x) >= 0 && xf.cmp(b.x) <= 0) {
        return a.y.add(b.y.sub(a.y).mul(xf.sub(a.x)).div(b.x.sub(a.x)));
      }
    }
    throw new Error("chainHeight: x outside the region's projection");
  }

  // Exact description of the unbounded polygon (for display layers; any
  // clipping to a screen is a separate, one-way, illustrative rendering step).
  describe(): {
    readonly kind: "polygon-with-rays";
    readonly chain: readonly Pt[];
    readonly dir: Dir;
    readonly rayFrom: readonly [Pt, Pt];
  } {
    const first = this.vertices[0] as Pt;
    const last = this.vertices[this.vertices.length - 1] as Pt;
    return {
      kind: "polygon-with-rays",
      chain: this.vertices,
      dir: this.frame.dir,
      rayFrom: [first, last],
    };
  }

  // A deterministic point strictly inside the region (k >= 2): midpoint of
  // the widest chain edge, `drop` below the chain (in the frame), returned in
  // base coordinates. Callers vary `drop` / `shift` to dodge collinearity.
  interiorPoint(drop: Rat, shift: Rat = Rat.ZERO): Pt | null {
    const fv = this.fv;
    if (fv.length < 2) {
      return null;
    }
    let best = 0;
    let bestW = (fv[1] as Pt).x.sub((fv[0] as Pt).x);
    for (let i = 1; i + 1 < fv.length; i += 1) {
      const w = (fv[i + 1] as Pt).x.sub((fv[i] as Pt).x);
      if (w.cmp(bestW) > 0) {
        best = i;
        bestW = w;
      }
    }
    const a = fv[best] as Pt;
    const b = fv[best + 1] as Pt;
    // x strictly inside (a.x,b.x): midpoint plus shift*width (|shift| < 1/2).
    const xf = a.x.add(bestW.div(Rat.make(2n))).add(bestW.mul(shift));
    if (xf.cmp(a.x) <= 0 || xf.cmp(b.x) >= 0) {
      return null;
    }
    const y = this.chainHeight(xf).sub(drop);
    const q = { x: xf, y };
    return fromFrame(this.frame, q);
  }
}

// P is a k-strip w.r.t. S and direction v (Definition 2), exactly:
//   P ⊂ S, P strictly cap-like in the v-frame, no point of S \ P in the closed
//   region C (int(C) ∩ S = ∅ and ∂C ∩ S = P).
export function isStrip(
  P: readonly Pt[],
  S: readonly Pt[],
  v: Dir = DOWN,
): StripResult {
  for (const p of P) {
    if (!S.some((s) => eqPt(s, p))) {
      return fail("vertex-not-in-S", "a vertex of P is not in S", p);
    }
  }
  const built = StripRegion.make(P, v);
  if (!built.ok) {
    return built;
  }
  const region = built.region;
  for (const q of S) {
    if (region.vertices.some((p) => eqPt(p, q))) {
      continue;
    }
    const c = region.classify(q);
    if (c === "interior") {
      return fail("interior-point", "a point of S lies in int(C)", q);
    }
    if (c === "boundary") {
      return fail(
        "boundary-point",
        "a point of S \\ P lies on ∂C (violates ∂C ∩ S = P)",
        q,
      );
    }
  }
  return { ok: true, region };
}

export type ParallelResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

// Definition 2: parallel = same halfline direction and DISJOINT (closed)
// regions. In the v-frame the regions are {x in [lo,hi], y <= chain}, so two
// closed regions are disjoint iff their closed x-projections are disjoint.
export function parallel(a: StripRegion, b: StripRegion): ParallelResult {
  // (c, flip) determine the halfline direction up to positive scaling.
  if (!a.frame.c.equals(b.frame.c) || a.frame.flip !== b.frame.flip) {
    return { ok: false, reason: "different halfline directions" };
  }
  const ra = a.xRange();
  const rb = b.xRange();
  if (ra.hi.cmp(rb.lo) < 0 || rb.hi.cmp(ra.lo) < 0) {
    return { ok: true };
  }
  return { ok: false, reason: "closed regions intersect" };
}

// Interiors are disjoint iff the open x-projections are disjoint (touching
// at one end x is allowed): regions of one pair (R_{2j-1}, R_{2j}).
export function interiorsDisjoint(a: StripRegion, b: StripRegion): boolean {
  const ra = a.xRange();
  const rb = b.xRange();
  return ra.hi.cmp(rb.lo) <= 0 || rb.hi.cmp(ra.lo) <= 0;
}

// Observation 6 (third bullet) form: the closed regions intersect exactly in
// a common v-halfline starting at a shared vertex s: conv(P)∩conv(Q) = {s}
// and C_P ∩ C_Q = s + v. Returns the shared vertex or null.
export function sharedHalfline(a: StripRegion, b: StripRegion): Pt | null {
  const ra = a.xRange();
  const rb = b.xRange();
  let left = a;
  let right = b;
  if (rb.hi.cmp(ra.lo) === 0) {
    left = b;
    right = a;
  } else if (ra.hi.cmp(rb.lo) !== 0) {
    return null;
  }
  const lv = left.vertices[left.vertices.length - 1] as Pt;
  const rv = right.vertices[0] as Pt;
  return eqPt(lv, rv) ? lv : null;
}

// Definition 1 (Erdős–Szekeres): caps and cups, by increasing x.
export function isCap(P: readonly Pt[]): boolean {
  return chainTurns(P, -1);
}
export function isCup(P: readonly Pt[]): boolean {
  return chainTurns(P, 1);
}
function chainTurns(P: readonly Pt[], sign: -1 | 1): boolean {
  const s = [...P].sort((a, b) => a.x.cmp(b.x));
  for (let i = 1; i < s.length; i += 1) {
    if ((s[i - 1] as Pt).x.equals((s[i] as Pt).x)) {
      return false;
    }
  }
  for (let i = 2; i < s.length; i += 1) {
    if (orient(s[i - 2] as Pt, s[i - 1] as Pt, s[i] as Pt) !== sign) {
      return false;
    }
  }
  return true;
}
