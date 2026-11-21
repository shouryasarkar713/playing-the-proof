// viz/projection.ts — the world↔screen transform (the one-way rule, §17.3).
//
// The ONLY file that sees both coordinate spaces (§8.4, §18.1): world points
// are exact Rats; screen points are display numbers. Screen coordinates
// NEVER enter a geometric predicate — clicks re-enter geometry exclusively
// through screenToWorldQuantized (integer-exact rational math, no floats).
// ratToNumber is display-only (SVG attrs, hit-test thresholds in px).
import { Rat } from "../geometry/rat.ts";
import type { Pt } from "../geometry/pt.ts";
import { pt } from "../geometry/pt.ts";

export interface View {
  readonly cx: Rat; // world center x
  readonly cy: Rat; // world center y
  readonly s: Rat; // px per world unit (rational, > 0)
  readonly w: number; // viewport px (integers)
  readonly h: number;
}

// Display-only Rat → number (SVG attributes, px thresholds). Never geometry.
export function ratToNumber(r: Rat): number {
  return Number(r.n) / Number(r.d);
}

// Exact floor for possibly-negative Rats (bigint math only).
function floorRat(r: Rat): bigint {
  const q = r.n / r.d;
  if (r.n % r.d === 0n || r.n >= 0n) {
    return q;
  }
  return q - 1n;
}

// Round to nearest integer (half away from zero — deterministic).
function ratRound(r: Rat): bigint {
  return floorRat(r.add(Rat.make(1n, 2n)));
}

export function worldToScreen(p: Pt, view: View): { x: number; y: number } {
  const x = p.x.sub(view.cx).mul(view.s).add(Rat.make(BigInt(view.w), 2n));
  const y = view.cy.sub(p.y).mul(view.s).add(Rat.make(BigInt(view.h), 2n));
  return { x: ratToNumber(x), y: ratToNumber(y) };
}

// Click quantization (§17.3): pixels are the input quantum — round the event
// to integer px, then compute the world point with integer-exact rational
// math. The quantum denominator is d = 2·s, so distinct pixels (≥ 1px apart)
// quantize to distinct rationals whenever s ≥ 1/2.
export function screenToWorldQuantized(
  sx: number,
  sy: number,
  view: View,
): Pt {
  const px = Math.round(sx);
  const py = Math.round(sy);
  // X = 2·(px − w/2), Y = 2·(h/2 − py): integers (half-px units ×2).
  const X = BigInt(2 * px - view.w);
  const Y = BigInt(view.h - 2 * py);
  // world = (X/(2s) + cx, Y/(2s) + cy), computed exactly.
  const twoS = view.s.mul(Rat.make(2n));
  const qx = Rat.make(X, 1n).div(twoS).add(view.cx);
  const qy = Rat.make(Y, 1n).div(twoS).add(view.cy);
  // Quantize to denominator d = 2s: q = round(v·d)/d (exact).
  const qxd = ratRound(qx.mul(twoS));
  const qyd = ratRound(qy.mul(twoS));
  return pt(
    Rat.make(qxd * twoS.d, twoS.n),
    Rat.make(qyd * twoS.d, twoS.n),
  );
}

// Client→svg-local px (scroll/offset-correct input plumbing; no geometry).
export function clientToLocal(
  clientX: number,
  clientY: number,
  rectLeft: number,
  rectTop: number,
): { sx: number; sy: number } {
  return { sx: clientX - rectLeft, sy: clientY - rectTop };
}

// Round display coordinates to the 0.5px grid (regions/hull paths, §17.5).
export function roundHalf(v: number): number {
  return Math.round(v * 2) / 2;
}

// Largest "nice" scalar ≤ s: m·10^e with m ∈ {1,2,5} (exact).
export function niceScalar(s: Rat): Rat {
  if (s.sign() <= 0) {
    return Rat.make(1n);
  }
  let v = s;
  let e = 0;
  while (v.cmp(Rat.make(10n)) >= 0) {
    v = v.div(Rat.make(10n));
    e += 1;
  }
  while (v.cmp(Rat.make(1n)) < 0) {
    v = v.mul(Rat.make(10n));
    e -= 1;
  }
  const m = v.cmp(Rat.make(5n)) >= 0 ? 5n : v.cmp(Rat.make(2n)) >= 0 ? 2n : 1n;
  let out = Rat.make(m);
  if (e >= 0) {
    out = out.mul(Rat.make(10n ** BigInt(e)));
  } else {
    out = out.div(Rat.make(10n ** BigInt(-e)));
  }
  return out;
}

// autoFit (§17.3): content bounds + 12% margin, nice rational zoom.
export function autoFit(
  points: readonly Pt[],
  w: number,
  h: number,
): View {
  if (points.length === 0) {
    return { cx: Rat.make(0n), cy: Rat.make(0n), s: Rat.make(50n), w, h };
  }
  let minX = points[0]?.x as Rat;
  let maxX = points[0]?.x as Rat;
  let minY = points[0]?.y as Rat;
  let maxY = points[0]?.y as Rat;
  for (const p of points) {
    if (p.x.cmp(minX) < 0) {
      minX = p.x;
    }
    if (p.x.cmp(maxX) > 0) {
      maxX = p.x;
    }
    if (p.y.cmp(minY) < 0) {
      minY = p.y;
    }
    if (p.y.cmp(maxY) > 0) {
      maxY = p.y;
    }
  }
  const margin = Rat.make(3n, 25n); // 12%
  const spanX = maxX.sub(minX);
  const spanY = maxY.sub(minY);
  const padX = spanX.sign() === 0 ? Rat.make(1n) : spanX.mul(margin);
  const padY = spanY.sign() === 0 ? Rat.make(1n) : spanY.mul(margin);
  const loX = minX.sub(padX);
  const hiX = maxX.add(padX);
  const loY = minY.sub(padY);
  const hiY = maxY.add(padY);
  const bw = hiX.sub(loX);
  const bh = hiY.sub(loY);
  const sx = Rat.make(BigInt(w)).div(bw);
  const sy = Rat.make(BigInt(h)).div(bh);
  const s = niceScalar(sx.cmp(sy) < 0 ? sx : sy);
  return {
    cx: loX.add(hiX).div(Rat.make(2n)),
    cy: loY.add(hiY).div(Rat.make(2n)),
    s,
    w,
    h,
  };
}

// Exact (non-quantized) world point under integer px — the hit-test input.
// Integer-exact rational math (cf. screenToWorldQuantized, §17.3).
export function screenToWorldExact(px: number, py: number, view: View): Pt {
  const X = BigInt(2 * Math.round(px) - view.w);
  const Y = BigInt(view.h - 2 * Math.round(py));
  const twoS = view.s.mul(Rat.make(2n));
  return pt(
    Rat.make(X, 1n).div(twoS).add(view.cx),
    Rat.make(Y, 1n).div(twoS).add(view.cy),
  );
}

// Screen-space separation test (the [UI] too-close affordance, §4.2):
// boolean only — no screen numbers cross into geometry.
export function exceedsSeparation(
  a: Pt,
  b: Pt,
  view: View,
  minPx: number,
): boolean {
  const s = ratToNumber(view.s);
  const dx = (ratToNumber(a.x) - ratToNumber(b.x)) * s;
  const dy = (ratToNumber(a.y) - ratToNumber(b.y)) * s;
  return dx * dx + dy * dy >= minPx * minPx;
}
