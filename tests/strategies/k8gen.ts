// tests/strategies/k8gen.ts — convex 7-hole generators for the k=8 gate.
import { hull } from "../../src/geometry/hull.ts";
import { orient } from "../../src/geometry/predicates.ts";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { Rat } from "../../src/geometry/rat.ts";
import { P } from "./k8driver.ts";

function gpAll(pts: readonly Pt[]): boolean {
  for (let i = 0; i < pts.length; i += 1) {
    for (let j = i + 1; j < pts.length; j += 1) {
      for (let k = j + 1; k < pts.length; k += 1) {
        if (orient(pts[i] as Pt, pts[j] as Pt, pts[k] as Pt) === 0) {
          return false;
        }
      }
    }
  }
  return true;
}

// Random convex heptagon with integer coordinates in [-scale, scale]^2
// (rejection sampled from random 7-sets; aspect ratio varied by xs/ys).
export function randomHeptagon(rand: () => number, scale = 40, xs = 1, ys = 1): Pt[] {
  for (let t = 0; t < 20000; t += 1) {
    const cand: Pt[] = [];
    for (let i = 0; i < 9; i += 1) {
      cand.push(
        P(
          Math.floor((rand() * 2 - 1) * scale * xs),
          Math.floor((rand() * 2 - 1) * scale * ys),
        ),
      );
    }
    const h = hull(cand);
    if (h.length === 7 && gpAll(h)) {
      return h;
    }
  }
  throw new Error("randomHeptagon: none found");
}

// Rational-coordinate convex heptagon (denominator `den`).
export function rationalHeptagon(rand: () => number, scale = 30, den = 7): Pt[] {
  for (let t = 0; t < 20000; t += 1) {
    const cand: Pt[] = [];
    for (let i = 0; i < 9; i += 1) {
      cand.push(
        pt(
          Rat.make(BigInt(Math.floor((rand() * 2 - 1) * scale * den)), BigInt(den)),
          Rat.make(BigInt(Math.floor((rand() * 2 - 1) * scale * den)), BigInt(den)),
        ),
      );
    }
    const h = hull(cand);
    if (h.length === 7 && gpAll(h)) {
      return h;
    }
  }
  throw new Error("rationalHeptagon: none found");
}

// Near-degenerate heptagon: seven points close to a flat arc (nearly collinear
// triples), still strictly convex and in general position.
export function flatHeptagon(rand: () => number, span = 700): Pt[] {
  for (let t = 0; t < 20000; t += 1) {
    const xs = [0, 1, 2, 3, 4, 5, 6].map((i) =>
      Math.floor(i * (span / 6) + (rand() - 0.5) * (span / 20)),
    );
    const k = 6 + Math.floor(rand() * 30);
    const cand = xs.map((x) =>
      P(x, Math.floor((x * (span - x)) / (span * k)) + Math.floor(rand() * 3)),
    );
    const h = hull(cand);
    if (h.length === 7 && gpAll(h)) {
      return h;
    }
  }
  throw new Error("flatHeptagon: none found");
}
