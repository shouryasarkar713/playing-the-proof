// kstrip/frame.ts — exact "downward frame" of a halfline direction.
//
// Every strip predicate in this module family is implemented for the
// DOWNWARD halfline d = (0,-1) in a frame in which the strips are
// downward. A general direction v (v.y != 0) is reduced to d by an exact
// rational affine map T (a shear, composed with the reflection y -> -y
// when v points up):
//
//   v.y < 0 :  T(x,y) = (x - c*y,  y),   c = v.x / v.y     T(v) = (0, v.y)
//   v.y > 0 :  T(x,y) = (x - c*y, -y),                     T(v) = (0,-v.y)
//
// T is invertible and affine, so it maps convex position, convex hulls,
// Minkowski sums with a halfline, interiors and boundaries to the same
// objects. Therefore "P is a k-strip w.r.t. v in S" iff "T(P) is a k-strip
// w.r.t. d in T(S)". [implemented convention, exact; cross-checked by the
// independent oracle in scripts/audit/kstrip_oracle.py]
import { pt } from "../geometry/pt.ts";
import type { Pt } from "../geometry/pt.ts";
import { Rat } from "../geometry/rat.ts";

export interface Dir {
  readonly x: Rat;
  readonly y: Rat;
}

export interface Frame {
  readonly dir: Dir;
  readonly c: Rat;
  readonly flip: boolean;
}

export const DOWN: Dir = { x: Rat.ZERO, y: Rat.make(-1n) };

export function frameOf(v: Dir): Frame {
  if (v.y.isZero()) {
    throw new Error("frameOf: direction has v.y = 0 (horizontal); unsupported");
  }
  return { dir: v, c: v.x.div(v.y), flip: !v.y.isNeg() };
}

export const IDENTITY: Frame = frameOf(DOWN);

export function isIdentity(f: Frame): boolean {
  return f.c.isZero() && !f.flip;
}

export function toFrame(f: Frame, p: Pt): Pt {
  const x = p.x.sub(f.c.mul(p.y));
  return pt(x, f.flip ? p.y.neg() : p.y);
}

export function fromFrame(f: Frame, q: Pt): Pt {
  const y = f.flip ? q.y.neg() : q.y;
  return pt(q.x.add(f.c.mul(y)), y);
}

// The direction (delta,-1) read in the coordinates of frame f, i.e. the
// base-coordinate direction (D + delta, -1) when f's direction is (D,-1).
// Only defined for downward (non-flipped) frames.
export function tilt(f: Frame, delta: Rat): Frame {
  if (f.flip) {
    throw new Error("tilt: only downward frames can be tilted");
  }
  const d = f.dir.x.div(f.dir.y.neg()).add(delta);
  return frameOf({ x: d, y: Rat.make(-1n) });
}

// Coordinates of frame f -> coordinates of tilt(f, delta):
// (x,y) -> (x + delta*y, y).
export function shearPt(delta: Rat, p: Pt): Pt {
  return pt(p.x.add(delta.mul(p.y)), p.y);
}

export function addDir(a: Pt, w: Dir): Pt {
  return pt(a.x.add(w.x), a.y.add(w.y));
}
