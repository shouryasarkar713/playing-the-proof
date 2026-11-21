// viz/aniso.ts — display-only anisotropic view and clipped drawing of
// UNBOUNDED regions (k-strip explorer).
//
// The k-strip constructions live on a parabola-like point set whose x- and
// y-extents differ by orders of magnitude, so one uniform zoom would draw them
// as a hairline. An independent scale per axis is an affine map: it preserves
// incidence, convexity and every "strip" relation (a direction (D,-1) maps to a
// direction), so the picture stays faithful in its combinatorics while the
// metric is only illustrative. Screen numbers NEVER re-enter geometry except
// through `fromScreenAniso`, which returns an exact rational on a fixed grid.
//
// Unbounded regions (conv(chain) + halfline, extension cones) cannot be drawn
// exactly; they are extended far past the viewport and clipped by the SVG
// viewport. Callers must label such drawings "clipped for display
// (illustrative); the exact region is unbounded".
import { Rat } from "../geometry/rat.ts";
import { pt } from "../geometry/pt.ts";
import type { Pt } from "../geometry/pt.ts";
import { ratToNumber } from "./projection.ts";

export interface AnisoView {
  readonly x0: Rat; // world x at the left padding edge
  readonly y0: Rat; // world y at the bottom padding edge
  readonly sx: number; // px per world unit, x
  readonly sy: number; // px per world unit, y
  readonly w: number;
  readonly h: number;
  readonly pad: number;
}

export interface Screen {
  readonly x: number;
  readonly y: number;
}

export function fitAniso(
  points: readonly Pt[],
  w: number,
  h: number,
  pad = 28,
): AnisoView {
  if (points.length === 0) {
    return { x0: Rat.ZERO, y0: Rat.ZERO, sx: 10, sy: 10, w, h, pad };
  }
  let minX = (points[0] as Pt).x;
  let maxX = minX;
  let minY = (points[0] as Pt).y;
  let maxY = minY;
  for (const p of points) {
    if (p.x.cmp(minX) < 0) minX = p.x;
    if (p.x.cmp(maxX) > 0) maxX = p.x;
    if (p.y.cmp(minY) < 0) minY = p.y;
    if (p.y.cmp(maxY) > 0) maxY = p.y;
  }
  const spanX = ratToNumber(maxX.sub(minX));
  const spanY = ratToNumber(maxY.sub(minY));
  const iw = w - 2 * pad > 10 ? w - 2 * pad : 10;
  const ih = h - 2 * pad > 10 ? h - 2 * pad : 10;
  const sx = Number.isFinite(spanX) && spanX > 0 ? iw / spanX : 10;
  const sy = Number.isFinite(spanY) && spanY > 0 ? ih / spanY : 10;
  return { x0: minX, y0: minY, sx, sy, w, h, pad };
}

export function toScreenAniso(p: Pt, v: AnisoView): Screen {
  return {
    x: v.pad + ratToNumber(p.x.sub(v.x0)) * v.sx,
    y: v.h - v.pad - ratToNumber(p.y.sub(v.y0)) * v.sy,
  };
}

function roundNearest(x: number): bigint {
  if (!Number.isFinite(x)) {
    return 0n;
  }
  const t = x - (x % 1);
  const frac = x - t;
  let r = t;
  if (frac >= 0.5) {
    r += 1;
  } else if (frac <= -0.5) {
    r -= 1;
  }
  return BigInt(r);
}

// Screen px -> exact world point on the grid 1/denom (display input only).
export function fromScreenAniso(
  sxPx: number,
  syPx: number,
  v: AnisoView,
  denom: bigint,
): Pt {
  const wx = (sxPx - v.pad) / v.sx;
  const wy = (v.h - v.pad - syPx) / v.sy;
  const d = Number(denom);
  const qx = roundNearest(wx * d);
  const qy = roundNearest(wy * d);
  return pt(
    v.x0.add(Rat.make(qx, denom)),
    v.y0.add(Rat.make(qy, denom)),
  );
}

// The screen direction of a world direction (D, -1) etc.: image of the
// vector under the linear part of the view (y flips).
export function dirToScreen(d: { x: Rat; y: Rat }, v: AnisoView): Screen {
  return { x: ratToNumber(d.x) * v.sx, y: -ratToNumber(d.y) * v.sy };
}

function sub(a: Screen, b: Screen): Screen {
  return { x: a.x - b.x, y: a.y - b.y };
}
function add(a: Screen, b: Screen): Screen {
  return { x: a.x + b.x, y: a.y + b.y };
}
function scale(a: Screen, k: number): Screen {
  return { x: a.x * k, y: a.y * k };
}
function absn(x: number): number {
  return x < 0 ? -x : x;
}

// Factor that carries a vector of the given size far outside the viewport.
function farFactor(d: Screen, box: { w: number; h: number }): number {
  const m = absn(d.x) > absn(d.y) ? absn(d.x) : absn(d.y);
  return m === 0 ? 0 : (6 * (box.w + box.h)) / m;
}

// conv(chain) + halfline(dir), extended past the viewport. `chain` must be
// sorted by increasing frame x (StripRegion.vertices already is).
export function regionPolygon(
  chain: readonly Screen[],
  dir: Screen,
  box: { w: number; h: number },
): Screen[] {
  const f = farFactor(dir, box);
  if (chain.length === 0 || f === 0) {
    return [...chain];
  }
  const far = scale(dir, f);
  const first = chain[0] as Screen;
  const last = chain[chain.length - 1] as Screen;
  return [...chain, add(last, far), add(first, far)];
}

// The cone {apex + a*ray + b*dir : a, b >= 0}, extended past the viewport.
export function conePolygon(
  apex: Screen,
  rayPoint: Screen,
  dir: Screen,
  box: { w: number; h: number },
): Screen[] {
  const w = sub(rayPoint, apex);
  const fw = farFactor(w, box);
  const fd = farFactor(dir, box);
  if (fw === 0 || fd === 0) {
    return [apex];
  }
  const a = add(apex, scale(w, fw));
  const b = add(a, scale(dir, fd));
  return [apex, a, b, add(apex, scale(dir, fd))];
}

// A halfline from `from` along `dir`, extended past the viewport.
export function halflineEnd(
  from: Screen,
  dir: Screen,
  box: { w: number; h: number },
): Screen {
  const f = farFactor(dir, box);
  return add(from, scale(dir, f));
}

export function pointsAttr(poly: readonly Screen[]): string {
  return poly.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}
