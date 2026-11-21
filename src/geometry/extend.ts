// geometry/extend.ts — the §7.7 exact 2D growth constructions + the k=5/k=6
// placement rules built on them (coShoulder §23.3/§23.6, escapeScan §24.3).
//
// Plain-Pt signatures only — no strategy types (strategy/eval.ts resolves
// vars and calls these; §6.3). Callers pass candidate holes in canonical
// order; the final prefer tie-break (vertex-id tuple) is that array order.
//
// Convention (§7.7, fixed once): holes are CCW (interior strictly LEFT of
// every directed edge); the exterior is the negative side; the exterior
// normal is n = rot90cw(v−u); frame p(s,t) = m + s·d + t·n with t > 0
// strictly beyond the edge line (the §7.7 sign fixture pins this).
import { Rat } from "./rat.ts";
import { eqPt, pt } from "./pt.ts";
import type { Pt } from "./pt.ts";
import { orient, signedArea2 } from "./predicates.ts";
import { isKHole } from "./holes.ts";
import type { IdPt, KHole, PointId } from "./holes.ts";
import {
  clipConvexByHalfPlane,
  polygonArea2,
} from "./poly.ts";

export interface Window {
  readonly minX: Rat;
  readonly minY: Rat;
  readonly maxX: Rat;
  readonly maxY: Rat;
}

// D-WINDOW (§37.2A): the default play window (configurable; constructions
// use its strict interior).
export const DEFAULT_WINDOW: Window = {
  minX: Rat.make(-1000000n),
  minY: Rat.make(-1000000n),
  maxX: Rat.make(1000000n),
  maxY: Rat.make(1000000n),
};

export type Prefer = "largest-interval" | "farthest-clearance";

export interface EdgeScan {
  readonly point: Pt;
  readonly ell: Rat; // selected open sub-interval length (§7.7 item 6)
  readonly t: Rat; // selected point's t (farthest-clearance tie-break)
}

export type ExtendEdgeResult =
  | { ok: true; scan: EdgeScan }
  | { ok: false; reason: "window-exhausted" };

export type ExtendOutcome =
  | { ok: true; point: Pt; hole: KHole; edgeIndex: number; ell: Rat }
  | { ok: false; reason: "window-exhausted" }
  | { ok: false; reason: "post-violation"; detail: string };

export type CoShoulderOutcome =
  | { ok: true; point: Pt; edgeIndex: number; edge: readonly [Pt, Pt] }
  | { ok: false; reason: "convention-failure"; detail: string }
  | { ok: false; reason: "post-violation"; detail: string };

export type EscapeOutcome =
  | { ok: true; point: Pt; ell: Rat; t: Rat }
  | { ok: false; reason: "window-exhausted" }
  | { ok: false; reason: "post-violation"; detail: string };

// Edge frame: p(s,t) = m + s·d + t·n (vectors encoded as Pt).
interface EdgeFrame {
  readonly u: Pt;
  readonly v: Pt;
  readonly d: Pt;
  readonly n: Pt;
  readonly m: Pt;
  readonly l2: Rat;
}

function makeFrame(u: Pt, v: Pt): EdgeFrame {
  const dx = v.x.sub(u.x);
  const dy = v.y.sub(u.y);
  const d = pt(dx, dy);
  const n = pt(dy, dx.neg());
  const two = Rat.make(2n);
  const m = pt(u.x.add(v.x).div(two), u.y.add(v.y).div(two));
  return { u, v, d, n, m, l2: dx.mul(dx).add(dy.mul(dy)) };
}

function fromST(f: EdgeFrame, s: Rat, t: Rat): Pt {
  return pt(
    f.m.x.add(s.mul(f.d.x)).add(t.mul(f.n.x)),
    f.m.y.add(s.mul(f.d.y)).add(t.mul(f.n.y)),
  );
}

function toST(f: EdgeFrame, p: Pt): Pt {
  const rx = p.x.sub(f.m.x);
  const ry = p.y.sub(f.m.y);
  return pt(
    f.d.x.mul(rx).add(f.d.y.mul(ry)).div(f.l2),
    f.d.y.mul(rx).sub(f.d.x.mul(ry)).div(f.l2),
  );
}

// orient(P,Q,p(s,t)) = c0 + s·cs + t·ct (exact Rats, cross bilinearity).
interface AffCond {
  readonly c0: Rat;
  readonly cs: Rat;
  readonly ct: Rat;
}

function orientCoeffs(P: Pt, Q: Pt, f: EdgeFrame): AffCond {
  const qx = Q.x.sub(P.x);
  const qy = Q.y.sub(P.y);
  return {
    c0: signedArea2(P, Q, f.m),
    cs: qx.mul(f.d.y).sub(qy.mul(f.d.x)),
    ct: qx.mul(f.n.y).sub(qy.mul(f.n.x)),
  };
}

function negCond(c: AffCond): AffCond {
  return { c0: c.c0.neg(), cs: c.cs.neg(), ct: c.ct.neg() };
}

// Clip poly (in (s,t)-space) by Cs·s + Ct·t + C0 ≥ 0. Returns null when the
// constraint is constantly false (edge has no room — the window case).
function clipByConstraint(poly: Pt[], c: AffCond): Pt[] | null {
  if (c.cs.isZero() && c.ct.isZero()) {
    return c.c0.sign() >= 0 ? poly : null;
  }
  const a: Pt = !c.cs.isZero()
    ? pt(c.c0.neg().div(c.cs), Rat.ZERO)
    : pt(Rat.ZERO, c.c0.neg().div(c.ct));
  // Direction d_l = (−Ct, Cs); increasing constraint is RIGHT of d_l
  // (cross(d_l, normal) = −(Cs²+Ct²) < 0), so keepLeft = false.
  const b: Pt = pt(a.x.sub(c.ct), a.y.add(c.cs));
  return clipConvexByHalfPlane(poly, a, b, false);
}

function windowConds(f: EdgeFrame, window: Window): AffCond[] {
  const mx = f.m.x;
  const my = f.m.y;
  const dx = f.d.x;
  const dy = f.d.y;
  const nx = f.n.x;
  const ny = f.n.y;
  return [
    { c0: mx.sub(window.minX), cs: dx, ct: nx }, // px ≥ minX
    { c0: window.maxX.sub(mx), cs: dx.neg(), ct: nx.neg() }, // px ≤ maxX
    { c0: my.sub(window.minY), cs: dy, ct: ny }, // py ≥ minY
    { c0: window.maxY.sub(my), cs: dy.neg(), ct: ny.neg() }, // py ≤ maxY
  ];
}

function floorRat(r: Rat): bigint {
  const q = r.n / r.d;
  if (r.n % r.d === 0n || r.n >= 0n) {
    return q;
  }
  return q - 1n;
}

function ceilRat(r: Rat): bigint {
  const q = r.n / r.d;
  if (r.n % r.d === 0n || r.n <= 0n) {
    return q;
  }
  return q + 1n;
}

interface OpenIv {
  readonly lo: Rat;
  readonly hi: Rat;
}

function subtractClosed(
  pieces: OpenIv[],
  lo: Rat | null,
  hi: Rat | null,
): OpenIv[] {
  const out: OpenIv[] = [];
  for (const { lo: a, hi: b } of pieces) {
    const cutLo = lo === null || lo.cmp(a) < 0 ? a : lo;
    const cutHi = hi === null || hi.cmp(b) > 0 ? b : hi;
    if (cutLo.cmp(cutHi) > 0) {
      // Closed slice misses the open interior: keep the piece whole.
      out.push({ lo: a, hi: b });
      continue;
    }
    // Remove [cutLo, cutHi] (a point touch splits too — closed removal).
    if (a.cmp(cutLo) < 0) {
      out.push({ lo: a, hi: cutLo });
    }
    if (cutHi.cmp(b) < 0) {
      out.push({ lo: cutHi, hi: b });
    }
  }
  return out;
}

function splitPoints(pieces: OpenIv[], ts: Rat[]): OpenIv[] {
  let out = pieces;
  for (const t of ts) {
    const next: OpenIv[] = [];
    for (const { lo: a, hi: b } of out) {
      if (a.cmp(t) < 0 && t.cmp(b) < 0) {
        next.push({ lo: a, hi: t }, { lo: t, hi: b });
      } else {
        next.push({ lo: a, hi: b });
      }
    }
    out = next;
  }
  return out;
}

// α·t + β ≤ 0 solved exactly: all | none | (−∞,v] | [v,∞).
type LeSol =
  | { kind: "all" }
  | { kind: "none" }
  | { kind: "le"; v: Rat }
  | { kind: "ge"; v: Rat };

function solveLe(alpha: Rat, beta: Rat): LeSol {
  if (alpha.isZero()) {
    return beta.sign() <= 0 ? { kind: "all" } : { kind: "none" };
  }
  const v = beta.neg().div(alpha);
  return alpha.sign() > 0 ? { kind: "le", v } : { kind: "ge", v };
}

function boundOf(
  sol: LeSol,
): { lo: Rat | null; hi: Rat | null } | null {
  if (sol.kind === "none") {
    return null;
  }
  if (sol.kind === "all") {
    return { lo: null, hi: null };
  }
  return sol.kind === "le" ? { lo: null, hi: sol.v } : { lo: sol.v, hi: null };
}

interface SliceProduct {
  pieces: OpenIv[];
  blocked: boolean;
}

// Admissible t-set at fixed s: open C_e interval minus closed swallow
// slices minus GP-forbidden t. "blocked" = an s-line GP block (skip s).
function slicePieces(
  L: Rat,
  R: Rat,
  swallow: Array<[AffCond, AffCond]>,
  s: Rat,
  gpPairs: Array<{ alpha: Rat; beta: Rat }>,
): SliceProduct {
  let pieces: OpenIv[] = L.cmp(R) < 0 ? [{ lo: L, hi: R }] : [];
  if (pieces.length === 0) {
    return { pieces, blocked: false };
  }
  for (const [c1, c2] of swallow) {
    const b1 = boundOf(
      solveLe(c1.ct, c1.c0.add(s.mul(c1.cs))),
    );
    const b2 = boundOf(
      solveLe(c2.ct, c2.c0.add(s.mul(c2.cs))),
    );
    if (b1 === null || b2 === null) {
      continue;
    }
    const lo =
      b1.lo === null ? b2.lo : b2.lo === null ? b1.lo : b1.lo.cmp(b2.lo) > 0 ? b1.lo : b2.lo;
    const hi =
      b1.hi === null ? b2.hi : b2.hi === null ? b1.hi : b1.hi.cmp(b2.hi) < 0 ? b1.hi : b2.hi;
    pieces = subtractClosed(pieces, lo, hi);
    if (pieces.length === 0) {
      return { pieces, blocked: false };
    }
  }
  const splits: Rat[] = [];
  for (const g of gpPairs) {
    if (g.alpha.isZero()) {
      if (g.beta.isZero()) {
        return { pieces: [], blocked: true };
      }
      continue;
    }
    const tstar = g.beta.neg().div(g.alpha);
    if (L.cmp(tstar) < 0 && tstar.cmp(R) < 0) {
      splits.push(tstar);
    }
  }
  return { pieces: splitPoints(pieces, splits), blocked: false };
}

// Closed C_e t-interval at fixed s (convex ⇒ single interval), or null.
function sliceInterval(poly: Pt[], s: Rat): { L: Rat; R: Rat } | null {
  const ts: Rat[] = [];
  for (let i = 0; i < poly.length; i += 1) {
    const p1 = poly[i] as Pt;
    const p2 = poly[(i + 1) % poly.length] as Pt;
    const d1 = p1.x.sub(s).sign();
    const d2 = p2.x.sub(s).sign();
    if (d1 === 0) {
      ts.push(p1.y);
    }
    if ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) {
      ts.push(
        p1.y.add(
          s.sub(p1.x).mul(p2.y.sub(p1.y)).div(p2.x.sub(p1.x)),
        ),
      );
    }
  }
  if (ts.length === 0) {
    return null;
  }
  let L = ts[0] as Rat;
  let R = ts[0] as Rat;
  for (const t of ts) {
    if (t.cmp(L) < 0) {
      L = t;
    }
    if (t.cmp(R) > 0) {
      R = t;
    }
  }
  return { L, R };
}

interface ScanInputs {
  frame: EdgeFrame;
  feasible: Pt[]; // closed C_e with nonempty interior
  swallow: Array<[AffCond, AffCond]>; // empty for escape
  placed: readonly Pt[];
  window: Window;
}

// The deterministic dyadic s-scan (§7.7 item 5, order refined by):
// rank j ascending; within a rank, |k| ascending with negative k first
// (0, −1, +1, −3, +3, … — searching outward from m, the lemma's room locus).
// Infinite generator; callers break on success (termination per §7.7 5d).
export function* dyadicSValues(sLo: Rat, sHi: Rat): Generator<Rat> {
  for (let j = 0; ; j += 1) {
    const den = 2n ** BigInt(j);
    const denRat = Rat.make(den);
    const loK = floorRat(sLo.mul(denRat)) + 1n;
    const hiK = ceilRat(sHi.mul(denRat)) - 1n;
    if (loK > hiK) {
      continue;
    }
    // outward from m — |k| ascending, negative first on ties — generated
    // LAZILY: the previous version materialised and sorted every
    // odd k of the rank (≈ width·2^j entries; an out-of-memory hazard at deep
    // ranks). Same sequence: rank j yields k = 0 (j = 0 only) and the odd k
    // with loK ≤ k ≤ hiK, ordered by |k|, −|k| before +|k|.
    const absLo = loK < 0n ? -loK : loK;
    const absHi = hiK < 0n ? -hiK : hiK;
    const maxM = absLo > absHi ? absLo : absHi;
    if (j === 0 && loK <= 0n && 0n <= hiK) {
      yield Rat.make(0n, den);
    }
    for (let m = 1n; m <= maxM; m += 2n) {
      if (-m >= loK && -m <= hiK) {
        yield Rat.make(-m, den);
      }
      if (m >= loK && m <= hiK) {
        yield Rat.make(m, den);
      }
    }
  }
}

// First s with a nonempty admissible t-set wins; within it the midpoint of
// the largest open sub-interval (ties: smallest t).
// Terminates per §7.7 item 5d (nonempty open room ⇒ a dyadic s at finite
// rank); null return = window-exhausted (C_e checked nonempty by caller).
function dyadicScan(inp: ScanInputs): EdgeScan | null {
  const { frame, feasible, swallow, placed } = inp;
  let sLo: Rat | null = null;
  let sHi: Rat | null = null;
  for (const v of feasible) {
    if (sLo === null || v.x.cmp(sLo) < 0) {
      sLo = v.x;
    }
    if (sHi === null || v.x.cmp(sHi) > 0) {
      sHi = v.x;
    }
  }
  if (sLo === null || sHi === null || sLo.cmp(sHi) >= 0) {
    return null;
  }
  // GP pair-line coefficients (α s-independent; β completed per s).
  const gpBase: Array<{ ax: Rat; ay: Rat; bx: Rat; by: Rat }> = [];
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      const qi = placed[i] as Pt;
      const qj = placed[j] as Pt;
      gpBase.push({ ax: qi.x, ay: qi.y, bx: qj.x, by: qj.y });
    }
  }
  for (const s of dyadicSValues(sLo, sHi)) {
    const sl = sliceInterval(feasible, s);
    if (sl === null || sl.L.cmp(sl.R) >= 0) {
      continue;
    }
    const gpPairs = gpBase.map((g) => {
      const qdx = g.bx.sub(g.ax);
      const qdy = g.by.sub(g.ay);
      return {
        alpha: qdx.mul(frame.n.y).sub(qdy.mul(frame.n.x)),
        beta: signedArea2(
          pt(g.ax, g.ay),
          pt(g.bx, g.by),
          frame.m,
        ).add(
          s.mul(qdx.mul(frame.d.y).sub(qdy.mul(frame.d.x))),
        ),
      };
    });
    const { pieces, blocked } = slicePieces(
      sl.L,
      sl.R,
      swallow,
      s,
      gpPairs,
    );
    if (blocked || pieces.length === 0) {
      continue;
    }
    let best = pieces[0] as OpenIv;
    for (const pc of pieces) {
      const len = pc.hi.sub(pc.lo);
      const blen = best.hi.sub(best.lo);
      if (len.cmp(blen) > 0 || (len.cmp(blen) === 0 && pc.lo.cmp(best.lo) < 0)) {
        best = pc;
      }
    }
    const t = best.lo.add(best.hi).div(Rat.make(2n));
    return { point: fromST(frame, s, t), ell: best.hi.sub(best.lo), t };
  }
  // Unreachable: the s-value generator is infinite (termination per §7.7 5d).
  return null;
}

function wedgeConds(
  frame: EdgeFrame,
  prev: Pt,
  next: Pt,
): AffCond[] {
  const { u, v } = frame;
  return [
    orientCoeffs(prev, u, frame), // orient(prev,u,p) > 0
    negCond(orientCoeffs(u, v, frame)), // orient(u,v,p) < 0
    orientCoeffs(v, next, frame), // orient(v,next,p) > 0
  ];
}

function gpSelfCheck(point: Pt, placed: readonly Pt[]): string | null {
  for (const q of placed) {
    if (eqPt(point, q)) {
      return "coincides with a placed point";
    }
  }
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      if (
        orient(placed[i] as Pt, placed[j] as Pt, point) === 0
      ) {
        return "collinear with a placed pair";
      }
    }
  }
  return null;
}

function windowSelfCheck(point: Pt, window: Window): boolean {
  return (
    window.minX.cmp(point.x) < 0 &&
    point.x.cmp(window.maxX) < 0 &&
    window.minY.cmp(point.y) < 0 &&
    point.y.cmp(window.maxY) < 0
  );
}

// Per-edge 2D scan with swallow constraints (the extend move's edge step).
export function scanExtendEdge(
  verts: readonly Pt[],
  edgeIdx: number,
  placed: readonly Pt[],
  window: Window,
): ExtendEdgeResult {
  const n = verts.length;
  if (n < 3 || edgeIdx < 0 || edgeIdx >= n) {
    throw new Error("scanExtendEdge: invalid hole/edge — implementation error");
  }
  const u = verts[edgeIdx] as Pt;
  const v = verts[(edgeIdx + 1) % n] as Pt;
  const prev = verts[(edgeIdx - 1 + n) % n] as Pt;
  const next = verts[(edgeIdx + 2) % n] as Pt;
  const frame = makeFrame(u, v);
  let feasible: Pt[] | null = windowCornersST(frame, window);
  for (const c of [...wedgeConds(frame, prev, next), ...windowConds(frame, window)]) {
    if (feasible === null) {
      return { ok: false, reason: "window-exhausted" };
    }
    feasible = clipByConstraint(feasible, c);
  }
  if (
    feasible === null ||
    feasible.length < 3 ||
    polygonArea2(feasible).sign() === 0
  ) {
    return { ok: false, reason: "window-exhausted" };
  }
  const swallow: Array<[AffCond, AffCond]> = [];
  for (const q of placed) {
    if (signedArea2(u, v, q).sign() < 0) {
      swallow.push([orientCoeffs(q, v, frame), orientCoeffs(u, q, frame)]);
    }
  }
  const scan = dyadicScan({ frame, feasible, swallow, placed, window });
  if (scan === null) {
    return { ok: false, reason: "window-exhausted" };
  }
  return { ok: true, scan };
}

function maxBound(cur: Rat | null, bound: Rat): Rat | null {
  return cur === null || bound.cmp(cur) > 0 ? bound : cur;
}

function minBound(cur: Rat | null, bound: Rat): Rat | null {
  return cur === null || bound.cmp(cur) < 0 ? bound : cur;
}

// ε-bounds from one window component: loW < coord + ε·delta < hiW.
// null = infeasible (empty); {null, null} = no constraint.
function windowEpsBounds(
  coord: Rat,
  delta: Rat,
  loW: Rat,
  hiW: Rat,
): { lo: Rat | null; hi: Rat | null } | null {
  if (delta.sign() === 0) {
    return loW.cmp(coord) < 0 && coord.cmp(hiW) < 0
      ? { lo: null, hi: null }
      : null;
  }
  const b1 = loW.sub(coord).div(delta);
  const b2 = hiW.sub(coord).div(delta);
  return delta.sign() > 0 ? { lo: b1, hi: b2 } : { lo: b2, hi: b1 };
}

function windowCornersST(frame: EdgeFrame, window: Window): Pt[] {
  return [
    pt(window.minX, window.minY),
    pt(window.maxX, window.minY),
    pt(window.maxX, window.maxY),
    pt(window.minX, window.maxY),
  ].map((c) => toST(frame, c));
}

// extendHole (§6.3/§7.7): candidate holes in caller-canonical order, edges in
// CCW index order; prefer ranks (ℓ_e, then policy tie-breaks, then edge
// index, then hole order); post-condition verified exactly. Hole vertex ids
// resolve through `placed` (missing id = caller bug, typed throw); the
// returned point is pre-placement (id-less — ids are assigned at placement).
export function extendHole(
  holes: readonly KHole[],
  placed: readonly IdPt[],
  window: Window,
  prefer: Prefer,
): ExtendOutcome {
  if (holes.length === 0) {
    throw new Error("extendHole: no candidate holes — implementation error");
  }
  const byId = new Map<PointId, Pt>();
  for (const p of placed) {
    byId.set(p.id, p.pt);
  }
  const pts = placed.map((p) => p.pt);
  const resolveHole = (hole: KHole): Pt[] =>
    hole.verts.map((id) => {
      const p = byId.get(id);
      if (p === undefined) {
        throw new Error(
          `extendHole: hole vertex ${id} names no placed point — implementation error`,
        );
      }
      return p;
    });
  const cands: Array<{ holeIdx: number; edgeIdx: number; scan: EdgeScan }> = [];
  for (let hi = 0; hi < holes.length; hi += 1) {
    const hole = holes[hi] as KHole;
    const verts = resolveHole(hole);
    for (let ei = 0; ei < verts.length; ei += 1) {
      const r = scanExtendEdge(verts, ei, pts, window);
      if (r.ok) {
        cands.push({ holeIdx: hi, edgeIdx: ei, scan: r.scan });
      }
    }
  }
  if (cands.length === 0) {
    return { ok: false, reason: "window-exhausted" };
  }
  let best = cands[0] as (typeof cands)[number];
  for (const c of cands) {
    const e = c.scan.ell.cmp(best.scan.ell);
    if (e > 0) {
      best = c;
      continue;
    }
    if (e < 0) {
      continue;
    }
    if (prefer === "farthest-clearance") {
      const t = c.scan.t.cmp(best.scan.t);
      if (t !== 0) {
        if (t > 0) {
          best = c;
        }
        continue;
      }
    }
    if (c.edgeIdx !== best.edgeIdx) {
      if (c.edgeIdx < best.edgeIdx) {
        best = c;
      }
      continue;
    }
    if (c.holeIdx < best.holeIdx) {
      best = c;
    }
  }
  const hole = holes[best.holeIdx] as KHole;
  const holePts = resolveHole(hole);
  const { point } = best.scan;
  if (!isKHole([...holePts, point], [...pts, point])) {
    return {
      ok: false,
      reason: "post-violation",
      detail: `extendHole: isKHole failed for hole ${best.holeIdx} edge ${best.edgeIdx}`,
    };
  }
  return { ok: true, point, hole, edgeIndex: best.edgeIdx, ell: best.scan.ell };
}

// coShoulder (§23.3/§23.6): the 1D trapezoid construction. outer must be CCW
// with interior strictly inside; placed = all placed points (GP splits).
export function coShoulder(
  outer: readonly Pt[],
  interior: Pt,
  placed: readonly Pt[],
  window: Window,
): CoShoulderOutcome {
  if (outer.length !== 3) {
    throw new Error("coShoulder: outer must be a 3-triangle — implementation error");
  }
  const o0 = outer[0] as Pt;
  const o1 = outer[1] as Pt;
  const o2 = outer[2] as Pt;
  const edges: Array<readonly [Pt, Pt]> = [
    [o0, o1],
    [o1, o2],
    [o2, o0],
  ];
  let best = 0;
  let bestAbs = signedArea2(o0, o1, interior).abs();
  for (let i = 1; i < 3; i += 1) {
    const [a, b] = edges[i] as [Pt, Pt];
    const m = signedArea2(a, b, interior).abs();
    if (m.cmp(bestAbs) > 0) {
      best = i;
      bestAbs = m;
    }
  }
  const [u, v] = edges[best] as [Pt, Pt];
  const dx = v.x.sub(u.x);
  const dy = v.y.sub(u.y);
  let lo: Rat | null = null;
  let hi: Rat | null = null;
  for (const [x, y] of edges) {
    const base = signedArea2(x, y, interior);
    if (base.sign() <= 0) {
      return {
        ok: false,
        reason: "convention-failure",
        detail: "interior not strictly inside outer",
      };
    }
    const slope = y.x.sub(x.x).mul(dy).sub(y.y.sub(x.y).mul(dx));
    if (slope.sign() === 0) {
      continue;
    }
    const bound = base.neg().div(slope);
    if (slope.sign() > 0) {
      lo = maxBound(lo, bound);
    } else {
      hi = minBound(hi, bound);
    }
  }
  // Window: A3(ε) = interior + ε·d strictly inside.
  const ix = interior.x;
  const iy = interior.y;
  const wx = windowEpsBounds(ix, dx, window.minX, window.maxX);
  const wy = windowEpsBounds(iy, dy, window.minY, window.maxY);
  if (wx === null || wy === null) {
    return {
      ok: false,
      reason: "convention-failure",
      detail: "empty ε-interval inside window",
    };
  }
  for (const wb of [wx, wy]) {
    if (wb.lo !== null) {
      lo = maxBound(lo, wb.lo);
    }
    if (wb.hi !== null) {
      hi = minBound(hi, wb.hi);
    }
  }
  if (lo !== null && hi !== null && lo.cmp(hi) >= 0) {
    return {
      ok: false,
      reason: "convention-failure",
      detail: "empty ε-interval",
    };
  }
  if (lo === null || hi === null) {
    throw new Error("coShoulder: unbounded ε-interval — implementation error");
  }
  const splits: Rat[] = [];
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      const qi = placed[i] as Pt;
      const qj = placed[j] as Pt;
      const alpha = qj.x.sub(qi.x).mul(dy).sub(qj.y.sub(qi.y).mul(dx));
      const beta = signedArea2(qi, qj, interior);
      if (alpha.isZero()) {
        if (beta.isZero()) {
          return {
            ok: false,
            reason: "convention-failure",
            detail: "ε-line GP-blocked",
          };
        }
        continue;
      }
      const es = beta.neg().div(alpha);
      if (lo.cmp(es) < 0 && es.cmp(hi) < 0) {
        splits.push(es);
      }
    }
  }
  splits.sort((a, b) => (a.cmp(b) < 0 ? -1 : a.cmp(b) > 0 ? 1 : 0));
  const bounds: Rat[] = [lo];
  for (const s of splits) {
    const last = bounds[bounds.length - 1] as Rat;
    if (last.cmp(s) < 0) {
      bounds.push(s);
    }
  }
  bounds.push(hi);
  // Consecutive pairs are the open sub-intervals; largest wins, ties leftmost.
  let bLo: Rat | null = null;
  let bHi: Rat | null = null;
  for (let i = 0; i + 1 < bounds.length; i += 1) {
    const a = bounds[i] as Rat;
    const b = bounds[i + 1] as Rat;
    if (a.cmp(b) >= 0) {
      continue;
    }
    if (
      bLo === null ||
      bHi === null ||
      b.sub(a).cmp(bHi.sub(bLo)) > 0 ||
      (b.sub(a).cmp(bHi.sub(bLo)) === 0 && a.cmp(bLo) < 0)
    ) {
      bLo = a;
      bHi = b;
    }
  }
  if (bLo === null || bHi === null) {
    return {
      ok: false,
      reason: "convention-failure",
      detail: "no open ε sub-interval",
    };
  }
  const eps = bLo.add(bHi).div(Rat.make(2n));
  const point = pt(ix.add(eps.mul(dx)), iy.add(eps.mul(dy)));
  const gpBad = gpSelfCheck(point, placed);
  if (gpBad !== null) {
    return { ok: false, reason: "post-violation", detail: `coShoulder: ${gpBad}` };
  }
  for (const [x, y] of edges) {
    if (signedArea2(x, y, point).sign() <= 0) {
      return {
        ok: false,
        reason: "post-violation",
        detail: "coShoulder: A3 not strictly inside outer",
      };
    }
  }
  if (!isKHole([u, v, interior, point], [...placed, point])) {
    return {
      ok: false,
      reason: "post-violation",
      detail: "coShoulder: trapezoid {u,v,interior,A3} is not a 4-hole",
    };
  }
  return { ok: true, point, edgeIndex: best, edge: [u, v] };
}

// escapeNearEdge (§24.3 item 3,): near-first point selection for the
// escape move. Twin formation needs A1 CLOSE to the pentagon edge (the
// Figure-1 zone): the shared largest-interval-midpoint machinery
// systematically lands ~10⁶ units out, where the twin pentagons swallow
// placed points. So at each s ( order), t halves toward the edge
// (t_k = 2^−k/l2 — exact rational, distance ≈ 2^−k/|d| world units,
// prototype-parity scale); the first point strictly satisfying the wedge,
// the strict window, and GP is placed. Edge RANKING still uses ℓ_e (§7.5
// escape row) via escapeScan; only the point choice is near-first.
// halvings per s-value. Twin conditions hold on an open neighbourhood of
// the edge midpoint of width ≥ (orientation margin)/|d|; 64 halvings only
// reached margins ≳ 5e-20 — 256 reach 1e-77 (exact rationals; the cost is only
// paid when candidates are rejected).
const ESCAPE_HALVINGS = 256;

export function escapeNearEdge(
  e: Pt,
  nb: Pt,
  prevE: Pt,
  nextNb: Pt,
  placed: readonly Pt[],
  window: Window,
  // strategy-level acceptance (the twin post-condition evaluated on the
  // hypothetical state). A wedge-valid point is NOT automatically a twin
  // point: the strict twin inequalities hold on an open neighbourhood of the
  // edge midpoint, so the halving search must continue until they hold.
  accept?: (p: Pt) => boolean,
): { ok: true; point: Pt } | { ok: false; reason: "window-exhausted" } {
  const frame = makeFrame(e, nb);
  const corners = windowCornersST(frame, window);
  let sLo: Rat | null = null;
  let sHi: Rat | null = null;
  for (const v of corners) {
    if (sLo === null || v.x.cmp(sLo) < 0) {
      sLo = v.x;
    }
    if (sHi === null || v.x.cmp(sHi) > 0) {
      sHi = v.x;
    }
  }
  if (sLo === null || sHi === null || sLo.cmp(sHi) >= 0) {
    return { ok: false, reason: "window-exhausted" };
  }
  let tried = 0;
  let evals = 0; // acceptance-predicate budget: bounds a never-accepting predicate
  for (const s of dyadicSValues(sLo, sHi)) {
    // Boundedness cap: s=0 (the edge midpoint) succeeds in practice on the
    // first pass; the cap only bounds pathological inputs.
    tried += 1;
    if (tried > 4096 || evals > 60000) {
      return { ok: false, reason: "window-exhausted" };
    }
    let t = Rat.make(1n, 2n).div(frame.l2);
    for (let k = 1; k <= ESCAPE_HALVINGS; k += 1) {
      const point = fromST(frame, s, t);
      evals += 1;
      if (
        signedArea2(prevE, e, point).sign() > 0 &&
        signedArea2(e, nb, point).sign() < 0 &&
        signedArea2(nb, nextNb, point).sign() > 0 &&
        windowSelfCheck(point, window) &&
        gpSelfCheck(point, placed) === null &&
        (accept === undefined || accept(point))
      ) {
        return { ok: true, point };
      }
      t = t.div(Rat.make(2n));
    }
  }
  // Unreachable: the s-value generator is infinite (the tried-cap above is
  // the only exit besides success).
  return { ok: false, reason: "window-exhausted" };
}

// escapeScan (§24.3 item 3): per-edge 2D scan WITHOUT swallow constraints
// (twin obligations are strategy-level post-conditions). prevE/nextNb are
// the pentagon neighbors framing the wedge over (E, nb).
export function escapeScan(
  e: Pt,
  nb: Pt,
  prevE: Pt,
  nextNb: Pt,
  placed: readonly Pt[],
  window: Window,
): EscapeOutcome {
  const frame = makeFrame(e, nb);
  let feasible: Pt[] | null = windowCornersST(frame, window);
  for (const c of [...wedgeConds(frame, prevE, nextNb), ...windowConds(frame, window)]) {
    if (feasible === null) {
      return { ok: false, reason: "window-exhausted" };
    }
    feasible = clipByConstraint(feasible, c);
  }
  if (
    feasible === null ||
    feasible.length < 3 ||
    polygonArea2(feasible).sign() === 0
  ) {
    return { ok: false, reason: "window-exhausted" };
  }
  const scan = dyadicScan({ frame, feasible, swallow: [], placed, window });
  if (scan === null) {
    return { ok: false, reason: "window-exhausted" };
  }
  const { point } = scan;
  if (
    signedArea2(prevE, e, point).sign() <= 0 ||
    signedArea2(e, nb, point).sign() >= 0 ||
    signedArea2(nb, nextNb, point).sign() <= 0 ||
    !windowSelfCheck(point, window)
  ) {
    return {
      ok: false,
      reason: "post-violation",
      detail: "escapeScan: self-check failed",
    };
  }
  const gpBad = gpSelfCheck(point, placed);
  if (gpBad !== null) {
    return { ok: false, reason: "post-violation", detail: `escapeScan: ${gpBad}` };
  }
  return { ok: true, point, ell: scan.ell, t: scan.t };
}
