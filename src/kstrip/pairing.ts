// kstrip/pairing.ts — the pairing step of Theorem 3 and the group step of
// Theorem 4 (paper §2.1, §2.2), exact, in a DOWNWARD frame (all points given
// in frame coordinates; v = d).
//
// Theorem 3 pairing (strips S_{2j-1}, S_{2j} of k-1 >= 1 points):
//   l_j  : vertical line strictly between the two strips, missing S
//          (deterministic dyadic choice, see chooseLineX).
//   halfline  l_j ∩ C+_{2j-1} ∩ C-_{2j} = { x = c, y <= top },
//          top = min(top of C+ section, top of C- section)  [exact]
//          (each cone section is a closed downward halfline, so the
//          intersection is a non-empty closed downward halfline).
//   p_j  : deterministic choice rule: y = top - g for the smallest integer
//          g >= 1 such that S ∪ {p_j} stays in general position
//          [implemented convention; the paper says "arbitrary"].
//   R_{2j-1} = conv(S_{2j-1} ∪ {p_j}) + d,  R_{2j} = conv(S_{2j} ∪ {p_j}) + d.
//
// Adoption (monochromatic game only, paper §2.1): a Breaker point on the
// vertical halfline below p_j / below s_{2j-1,1} / below s_{2j,k-1} replaces
// that vertex (the lowest such point, so that no point remains on the
// boundary halfline). Replacement only moves a vertex DOWN on its vertical
// line, which keeps the chain strictly concave and only shrinks the region.
import { eqPt, pt } from "../geometry/pt.ts";
import type { Pt } from "../geometry/pt.ts";
import { Rat } from "../geometry/rat.ts";
import { DOWN, addDir } from "./frame.ts";
import { extensionCone, coneSectionTop } from "./cone.ts";
import type { Cone } from "./cone.ts";
import { StripRegion, isStrip } from "./region.ts";
import type { StripFailure } from "./region.ts";
import { orient } from "../geometry/predicates.ts";

// p may be added to S keeping general position? O(|S|) via slope hashing:
// p must be new and no two points of S may be collinear with p.
export function canAdd(S: readonly Pt[], p: Pt): boolean {
  const seen = new Set<string>();
  for (const q of S) {
    const dx = q.x.sub(p.x);
    const dy = q.y.sub(p.y);
    if (dx.isZero() && dy.isZero()) {
      return false;
    }
    const key = dx.isZero() ? "v" : dy.div(dx).toString();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
  }
  return true;
}

// Deterministic rational strictly between lo and hi whose x is not an x of
// any point of S: tries 1/2, 1/4, 3/4, 1/8, ... (dyadic fractions of the gap).
export function chooseLineX(S: readonly Pt[], lo: Rat, hi: Rat): Rat {
  if (lo.cmp(hi) >= 0) {
    throw new Error("chooseLineX: empty interval");
  }
  const width = hi.sub(lo);
  const used = new Set(S.map((s) => s.x.toString()));
  for (let level = 1; level < 4096; level += 1) {
    const den = 1n << BigInt(level);
    for (let num = 1n; num < den; num += 2n) {
      const x = lo.add(width.mul(Rat.make(num, den)));
      if (!used.has(x.toString())) {
        return x;
      }
    }
  }
  throw new Error("chooseLineX: no free line found (impossible for finite S)");
}

export interface PairPlan {
  readonly index: number;
  readonly left: readonly Pt[];
  readonly right: readonly Pt[];
  readonly xLine: Rat;
  readonly coneLeft: Cone; // C+ of the left strip
  readonly coneRight: Cone; // C- of the right strip
  readonly lo: Rat; // the line must lie strictly between lo and hi
  readonly hi: Rat;
  readonly top: Rat; // closed upper end of the halfline l_j ∩ C+ ∩ C-
}

export type PlanFailure =
  | { readonly code: "invalid-strip"; readonly failure: StripFailure }
  | { readonly code: "projections-not-ordered"; readonly message: string };

export type PairPlanResult =
  | { readonly ok: true; readonly plan: PairPlan }
  | { readonly ok: false; readonly reason: PlanFailure };

function sortedByX(P: readonly Pt[]): Pt[] {
  return [...P].sort((a, b) => a.x.cmp(b.x));
}

export function planPair(
  S: readonly Pt[],
  leftIn: readonly Pt[],
  rightIn: readonly Pt[],
  index: number,
): PairPlanResult {
  const left = sortedByX(leftIn);
  const right = sortedByX(rightIn);
  const lastL = left[left.length - 1] as Pt;
  const firstR = right[0] as Pt;
  if (lastL.x.cmp(firstR.x) >= 0) {
    return {
      ok: false,
      reason: {
        code: "projections-not-ordered",
        message: "left strip must lie strictly left of the right strip",
      },
    };
  }
  const cl = extensionCone(left, S, DOWN, "plus");
  if (!cl.ok) {
    return {
      ok: false,
      reason:
        cl.reason.code === "not-a-strip"
          ? { code: "invalid-strip", failure: cl.reason.failure }
          : { code: "projections-not-ordered", message: cl.reason.message },
    };
  }
  const cr = extensionCone(right, S, DOWN, "minus");
  if (!cr.ok) {
    return {
      ok: false,
      reason:
        cr.reason.code === "not-a-strip"
          ? { code: "invalid-strip", failure: cr.reason.failure }
          : { code: "projections-not-ordered", message: cr.reason.message },
    };
  }
  const xLine = chooseLineX(S, lastL.x, firstR.x);
  const t1 = coneSectionTop(cl.cone, xLine);
  const t2 = coneSectionTop(cr.cone, xLine);
  return {
    ok: true,
    plan: {
      index,
      left,
      right,
      xLine,
      coneLeft: cl.cone,
      coneRight: cr.cone,
      lo: lastL.x,
      hi: firstR.x,
      top: t1.cmp(t2) <= 0 ? t1 : t2,
    },
  };
}

// Two points on the vertical line make EVERY point of it collinear with them
// (general position), so no apex can be placed on that line any more.
export function lineBlocked(S: readonly Pt[], x: Rat): boolean {
  let n = 0;
  for (const q of S) {
    if (q.x.equals(x)) {
      n += 1;
      if (n >= 2) {
        return true;
      }
    }
  }
  return false;
}

// Re-plan the line after Breaker spoiled it (>= 2 points on l_j before p_j
// was placed): a new free vertical line in the same gap. The top is taken from
// the cones RECOMPUTED against the current board for every strip that is still
// a valid strip, so the new candidate regions contain no point already placed
// (a line-blocking pair of points then does not turn into interior blockers,
// which would LOWER the pair's `need` and break the ledger bound). A strip that
// is no longer valid already has a blocker in its candidate (that candidate is
// dead whatever the apex); if no strip is valid the original cones are used.
export function replanLine(
  S: readonly Pt[],
  lo: Rat,
  hi: Rat,
  members: readonly {
    readonly strip: readonly Pt[];
    readonly side: "minus" | "plus";
    readonly original: Cone;
  }[],
): { readonly xLine: Rat; readonly top: Rat } {
  const xLine = chooseLineX(S, lo, hi);
  const fresh: Cone[] = [];
  for (const m of members) {
    const c = extensionCone(m.strip, S, DOWN, m.side);
    if (c.ok) {
      fresh.push(c.cone);
    }
  }
  const cones = fresh.length > 0 ? fresh : members.map((m) => m.original);
  let top: Rat | null = null;
  for (const c of cones) {
    const t = coneSectionTop(c, xLine);
    if (top === null || t.cmp(top) < 0) {
      top = t;
    }
  }
  return { xLine, top: top as Rat };
}

// Deterministic apex: the point at height top - g for the smallest g >= 1
// accepted by `ok` (general position with everything on the board).
export function chooseApex(
  top: Rat,
  xLine: Rat,
  ok: (p: Pt) => boolean,
  fromGap = 1n,
): Pt | null {
  for (let g = fromGap; g < fromGap + 100000n; g += 1n) {
    const p = pt(xLine, top.sub(Rat.make(g)));
    if (ok(p)) {
      return p;
    }
  }
  return null;
}

export interface AdoptionEvent {
  readonly kind: "apex" | "left-end" | "right-end";
  readonly from: Pt; // vertex before adoption
  readonly to: Pt; // adopted replacement (== from when nothing to adopt)
  // Points that were on the boundary halfline at or below `from` (including
  // `to`); all except the vertex itself are "absorbed" Breaker points.
  readonly absorbed: readonly Pt[];
}

function lowestOnLine(S: readonly Pt[], from: Pt): { to: Pt; line: Pt[] } {
  let to = from;
  const line: Pt[] = [];
  for (const q of S) {
    if (q.x.equals(from.x) && q.y.cmp(from.y) <= 0) {
      line.push(q);
      if (q.y.cmp(to.y) < 0) {
        to = q;
      }
    }
  }
  return { to, line };
}

export interface SettledPair {
  readonly left: readonly Pt[];
  readonly right: readonly Pt[];
  readonly apex: Pt;
  readonly events: readonly AdoptionEvent[];
}

// Apply the paper's replacement rule against the current point set S.
// `apex0`, and the original end vertices of the strips, are the vertices
// BEFORE any adoption; the rule is a pure function of S (idempotent).
export function settlePair(
  S: readonly Pt[],
  left0: readonly Pt[],
  right0: readonly Pt[],
  apex0: Pt,
  adopt: boolean,
): SettledPair {
  if (!adopt) {
    return { left: left0, right: right0, apex: apex0, events: [] };
  }
  const events: AdoptionEvent[] = [];
  const a = lowestOnLine(S, apex0);
  const l0 = left0[0] as Pt;
  const l = lowestOnLine(S, l0);
  const rLast = right0[right0.length - 1] as Pt;
  const r = lowestOnLine(S, rLast);
  const record = (
    kind: AdoptionEvent["kind"],
    from: Pt,
    res: { to: Pt; line: Pt[] },
  ): void => {
    events.push({ kind, from, to: res.to, absorbed: res.line.filter((q) => !eqPt(q, from)) });
  };
  record("apex", apex0, a);
  record("left-end", l0, l);
  record("right-end", rLast, r);
  const left = [l.to, ...left0.slice(1)];
  const right = [...right0.slice(0, right0.length - 1), r.to];
  return { left, right, apex: a.to, events };
}

export interface PairRegions {
  readonly left: StripRegion; // R_{2j-1}
  readonly right: StripRegion; // R_{2j}
}

export function pairRegions(
  left: readonly Pt[],
  right: readonly Pt[],
  apex: Pt,
): PairRegions | null {
  const a = StripRegion.make([...left, apex], DOWN);
  const b = StripRegion.make([apex, ...right], DOWN);
  if (!a.ok || !b.ok) {
    return null;
  }
  return { left: a.region, right: b.region };
}

// ---------------------------------------------------------------------------
// Theorem 4: groups of 2s strips, cones C- only.

export interface GroupPlan {
  readonly index: number;
  readonly strips: readonly (readonly Pt[])[];
  readonly xLine: Rat;
  readonly cones: readonly Cone[]; // C- of every strip of the group
  readonly lo: Rat;
  readonly hi: Rat;
  readonly top: Rat; // min over the group's C- sections at x = xLine
}

export type GroupPlanResult =
  | { readonly ok: true; readonly plan: GroupPlan }
  | { readonly ok: false; readonly reason: PlanFailure };

export function planGroup(
  S: readonly Pt[],
  stripsIn: readonly (readonly Pt[])[],
  prevMaxX: Rat | null,
  index: number,
): GroupPlanResult {
  const strips = stripsIn.map(sortedByX);
  const firstX = ((strips[0] as Pt[])[0] as Pt).x;
  const lo = prevMaxX ?? firstX.sub(Rat.ONE);
  if (lo.cmp(firstX) >= 0) {
    return {
      ok: false,
      reason: {
        code: "projections-not-ordered",
        message: "group must lie right of the previous group",
      },
    };
  }
  const cones: Cone[] = [];
  for (const st of strips) {
    const c = extensionCone(st, S, DOWN, "minus");
    if (!c.ok) {
      return {
        ok: false,
        reason:
          c.reason.code === "not-a-strip"
            ? { code: "invalid-strip", failure: c.reason.failure }
            : { code: "projections-not-ordered", message: c.reason.message },
      };
    }
    cones.push(c.cone);
  }
  const xLine = chooseLineX(S, lo, firstX);
  let top: Rat | null = null;
  for (const c of cones) {
    const t = coneSectionTop(c, xLine);
    if (top === null || t.cmp(top) < 0) {
      top = t;
    }
  }
  return {
    ok: true,
    plan: { index, strips, xLine, cones, lo, hi: firstX, top: top as Rat },
  };
}

export type GroupExtensionResult =
  | {
      readonly ok: true;
      readonly q: Pt;
      readonly vertices: readonly Pt[];
      readonly region: StripRegion;
    }
  | { readonly ok: false; readonly code: string; readonly message: string };

// Paper §2.2 harvest step, in its slab-restricted form: rotate L(s_{i,1})
// clockwise about s_{i,1} over ALL points of S with x in [xLine, s_{i,1}.x)
// (Maker's p_j included, Breaker's points included); the first point q met
// extends S_i to the strip S_i ∪ {q}. The slab restriction (x >= xLine)
// keeps the strips of different groups parallel; the paper's text rotates
// over Breaker points only and does not restrict the slab. See docs/KSTRIP.md.
export function groupExtension(
  S: readonly Pt[],
  strip: readonly Pt[],
  xLine: Rat,
): GroupExtensionResult {
  const st = sortedByX(strip);
  const a = st[0] as Pt;
  let ray: { x: Rat; y: Rat } | null = null;
  let best: Pt | null = null;
  // Limit: the edge-line direction L- (k-1 >= 2) or horizontal (k-1 = 1).
  if (st.length >= 2) {
    const b = st[1] as Pt;
    ray = { x: a.x.sub(b.x), y: a.y.sub(b.y) };
  } else {
    ray = { x: Rat.make(-1n), y: Rat.ZERO };
  }
  for (const q of S) {
    if (q.x.cmp(xLine) < 0 || q.x.cmp(a.x) >= 0) {
      continue;
    }
    const w = { x: q.x.sub(a.x), y: q.y.sub(a.y) };
    // clockwise-earlier than the current ray?
    if (orient(a, addDir(a, w), addDir(a, ray)) < 0) {
      ray = w;
      best = q;
    }
  }
  if (best === null) {
    return {
      ok: false,
      code: "no-extension-point",
      message: "no point of S in the slab lies inside the cone C-",
    };
  }
  const ver = isStrip([best, ...st], S, DOWN);
  if (!ver.ok) {
    return { ok: false, code: ver.reason.code, message: ver.reason.message };
  }
  return { ok: true, q: best, vertices: ver.region.vertices, region: ver.region };
}
