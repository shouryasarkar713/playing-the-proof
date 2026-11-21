// kstrip/cone.ts — the extension cones C- and C+ of a strip (paper §2).
//
// Paper (k >= 2, downward strip P = {s_1..s_k}, sorted by x):
//   C- : rotate L(s_1) = s_1 + d CLOCKWISE about s_1 until it reaches
//        L- = line(s_1,s_2) or passes through a point of S.
//   C+ : rotate L(s_k) COUNTER-CLOCKWISE about s_k until it reaches
//        L+ = line(s_{k-1},s_k) or passes through a point of S.
// (The paper's text names the second cone "C-" a second time; it is C+.)
// Aperture < pi, so a cone is the intersection of two closed half-planes:
//     C+ = { x' >= a.x' } ∩ { on or below the stopping ray's line }
// and its section by a v-parallel line is a v-halfline (never empty).
//
// Exact stopping point: the first S point met by the sweep is the point
// q (strictly on the cone's side of the vertical through the apex) whose
// direction q - a has the smallest angle from d; the sweep also stops at
// the edge-line direction. Angles are compared with orient only.
//
// k = 1 is NOT defined by the paper. We use the horizontal direction as the
// limiting ray [implemented convention, conservative: it only discards
// extension points that are above the apex].
import { eqPt } from "../geometry/pt.ts";
import type { Pt } from "../geometry/pt.ts";
import { orient } from "../geometry/predicates.ts";
import { Rat } from "../geometry/rat.ts";
import { DOWN, addDir, fromFrame, toFrame } from "./frame.ts";
import type { Dir, Frame } from "./frame.ts";
import { isStrip } from "./region.ts";
import type { StripRegion } from "./region.ts";
import type { StripFailure } from "./region.ts";

export type ConeSide = "minus" | "plus";

export type ConeStop =
  | { readonly kind: "edge-line" }
  | { readonly kind: "horizontal-convention" }
  | { readonly kind: "blocked"; readonly blocker: Pt };

export interface Cone {
  readonly side: ConeSide;
  readonly frame: Frame;
  readonly apex: Pt; // base coordinates (s_1 for minus, s_k for plus)
  readonly apexF: Pt; // frame coordinates
  readonly rayF: Dir; // direction of the stopping ray (frame coordinates)
  readonly stop: ConeStop;
  // Other points exactly on the stopping ray (empty in general position).
  readonly tied: readonly Pt[];
}

export type ConeFailure =
  | { readonly code: "not-a-strip"; readonly failure: StripFailure }
  | { readonly code: "empty"; readonly message: string };

export type ConeResult =
  | { readonly ok: true; readonly cone: Cone }
  | { readonly ok: false; readonly reason: ConeFailure };

// Is direction w1 strictly EARLIER than w2 in the sweep from d (ccw for the
// plus side, cw for the minus side)?
function earlier(apexF: Pt, w1: Dir, w2: Dir, side: ConeSide): boolean {
  const o = orient(apexF, addDir(apexF, w1), addDir(apexF, w2));
  return side === "plus" ? o > 0 : o < 0;
}

function dirBetween(a: Pt, b: Pt): Dir {
  return { x: b.x.sub(a.x), y: b.y.sub(a.y) };
}

export function extensionCone(
  P: readonly Pt[],
  S: readonly Pt[],
  v: Dir,
  side: ConeSide,
): ConeResult {
  const chk = isStrip(P, S, v);
  if (!chk.ok) {
    return { ok: false, reason: { code: "not-a-strip", failure: chk.reason } };
  }
  const region = chk.region;
  const frame = region.frame;
  const fv = region.fv;
  const k = fv.length;
  const apexF = (side === "plus" ? fv[k - 1] : fv[0]) as Pt;
  const apex = (side === "plus" ? region.vertices[k - 1] : region.vertices[0]) as Pt;

  let ray: Dir;
  let stop: ConeStop;
  if (k >= 2) {
    // L+ : continue the last edge forward; L- : continue the first edge back.
    ray =
      side === "plus"
        ? dirBetween(fv[k - 2] as Pt, fv[k - 1] as Pt)
        : dirBetween(fv[1] as Pt, fv[0] as Pt);
    stop = { kind: "edge-line" };
  } else {
    ray =
      side === "plus"
        ? { x: Rat.ONE, y: Rat.ZERO }
        : { x: Rat.make(-1n), y: Rat.ZERO };
    stop = { kind: "horizontal-convention" };
  }
  let tied: Pt[] = [];
  for (const q of S) {
    if (region.vertices.some((p) => eqPt(p, q))) {
      continue;
    }
    const qF = toFrame(frame, q);
    const cx = qF.x.cmp(apexF.x);
    if (side === "plus" ? cx <= 0 : cx >= 0) {
      continue; // not strictly on this side of the vertical through the apex
    }
    const w = dirBetween(apexF, qF);
    if (earlier(apexF, w, ray, side)) {
      ray = w;
      stop = { kind: "blocked", blocker: q };
      tied = [];
    } else if (
      stop.kind === "blocked" &&
      orient(apexF, addDir(apexF, w), addDir(apexF, ray)) === 0
    ) {
      tied.push(q);
    }
  }
  return {
    ok: true,
    cone: { side, frame, apex, apexF, rayF: ray, stop, tied },
  };
}

// Closed (default) or open membership of a base-coordinate point.
export function coneContains(
  cone: Cone,
  p: Pt,
  mode: "closed" | "open" = "closed",
): boolean {
  const q = toFrame(cone.frame, p);
  const a = cone.apexF;
  const cx = q.x.cmp(a.x);
  const o = orient(a, addDir(a, cone.rayF), q);
  if (cone.side === "plus") {
    return mode === "closed" ? cx >= 0 && o <= 0 : cx > 0 && o < 0;
  }
  return mode === "closed" ? cx <= 0 && o >= 0 : cx < 0 && o > 0;
}

// Upper bound (frame y) of the section of the cone by the v-parallel line at
// frame-x = xf (xf strictly on the cone's side). The section is the
// halfline { y <= U }, closed.
export function coneSectionTop(cone: Cone, xf: Rat): Rat {
  const a = cone.apexF;
  const w = cone.rayF;
  const dx = xf.sub(a.x);
  if (cone.side === "plus" ? dx.cmp(Rat.ZERO) <= 0 : dx.cmp(Rat.ZERO) >= 0) {
    throw new Error("coneSectionTop: line is not strictly on the cone's side");
  }
  return a.y.add(w.y.mul(dx).div(w.x));
}

export type ExtendCode =
  | "not-a-strip"
  | "p-in-P"
  | "p-wrong-side"
  | "above-edge-line"
  | "cone-blocked"
  | "degenerate"
  | "verifier-disagrees";

export interface ExtendReason {
  readonly code: ExtendCode;
  readonly message: string;
  readonly side?: ConeSide;
  readonly blocker?: Pt;
  readonly stripFailure?: StripFailure;
  // For cone failures: is P + {p} nevertheless a strip (exact check)? The
  // paper's cone condition is SUFFICIENT, not necessary (a blocker beyond p in
  // x does not obstruct p).
  readonly stillStrip?: boolean;
}

export type ExtendResult =
  | {
      readonly ok: true;
      readonly side: ConeSide;
      readonly vertices: readonly Pt[];
      readonly region: StripRegion;
      readonly cone: Cone;
    }
  | { readonly ok: false; readonly reason: ExtendReason };

// extends(P, S, p): may the strip P be extended by p (p in cl(C-) ∪ cl(C+))?
// S may or may not already contain p. Typed answer with the failing
// predicate; a positive answer is ALWAYS re-verified with the exact strip
// predicate (Definition 2) on P ∪ {p} and S ∪ {p}.
export function extendStrip(
  P: readonly Pt[],
  S: readonly Pt[],
  p: Pt,
  v: Dir = DOWN,
): ExtendResult {
  if (P.some((q) => eqPt(q, p))) {
    return { ok: false, reason: { code: "p-in-P", message: "p already in P" } };
  }
  const S0 = S.filter((s) => !eqPt(s, p));
  const chk = isStrip(P, S0, v);
  if (!chk.ok) {
    return {
      ok: false,
      reason: {
        code: "not-a-strip",
        message: "P is not a strip with respect to S",
        stripFailure: chk.reason,
      },
    };
  }
  const region = chk.region;
  if (region.vertices.some((q) => eqPt(q, p))) {
    return { ok: false, reason: { code: "p-in-P", message: "p already in P" } };
  }
  const pF = toFrame(region.frame, p);
  const { lo, hi } = region.xRange();
  let side: ConeSide;
  if (pF.x.cmp(lo) < 0) {
    side = "minus";
  } else if (pF.x.cmp(hi) > 0) {
    side = "plus";
  } else {
    return {
      ok: false,
      reason: {
        code: "p-wrong-side",
        message:
          "p lies in the closed x-projection of P: extension is only possible beyond an end vertex",
      },
    };
  }
  const cr = extensionCone(P, S0, v, side);
  if (!cr.ok) {
    return {
      ok: false,
      reason: { code: "not-a-strip", message: "cone undefined", side },
    };
  }
  const cone = cr.cone;
  if (!coneContains(cone, p, "closed")) {
    const k = region.k;
    const edgeRay =
      k >= 2
        ? side === "plus"
          ? dirBetween(region.fv[k - 2] as Pt, region.fv[k - 1] as Pt)
          : dirBetween(region.fv[1] as Pt, region.fv[0] as Pt)
        : side === "plus"
          ? { x: Rat.ONE, y: Rat.ZERO }
          : { x: Rat.make(-1n), y: Rat.ZERO };
    const still = isStrip([...region.vertices, p], [...S0, p], v).ok;
    const o = orient(cone.apexF, addDir(cone.apexF, edgeRay), pF);
    const beyondEdge = side === "plus" ? o > 0 : o < 0;
    if (beyondEdge) {
      return {
        ok: false,
        reason: {
          code: "above-edge-line",
          message:
            "p is above the line of the end edge (L- / L+): not in the cone",
          side,
          stillStrip: still,
        },
      };
    }
    if (cone.stop.kind === "blocked") {
      return {
        ok: false,
        reason: {
          code: "cone-blocked",
          message:
            "the sweep stopped earlier at a point of S: p lies beyond the blocking ray",
          side,
          blocker: cone.stop.blocker,
          stillStrip: still,
        },
      };
    }
    return {
      ok: false,
      reason: {
        code: "above-edge-line",
        message: "p outside the cone",
        side,
        stillStrip: still,
      },
    };
  }
  const newP = [...region.vertices, p];
  const ver = isStrip(newP, [...S0, p], v);
  if (!ver.ok) {
    return {
      ok: false,
      reason: {
        code: "degenerate",
        message:
          "p is in the closed cone but P ∪ {p} is not a strict strip (p on a boundary line: general position violated)",
        side,
        stripFailure: ver.reason,
      },
    };
  }
  return {
    ok: true,
    side,
    vertices: ver.region.vertices,
    region: ver.region,
    cone,
  };
}

// Convenience for tests/oracles: base-coordinate point on the cone's
// stopping ray at parameter t >= 0 from the apex.
export function coneRayPoint(cone: Cone, t: Rat): Pt {
  const q = addDir(cone.apexF, {
    x: cone.rayF.x.mul(t),
    y: cone.rayF.y.mul(t),
  });
  return fromFrame(cone.frame, q);
}

