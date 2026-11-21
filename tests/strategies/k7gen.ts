// tests/strategies/k7gen.ts — hexagon families for the Week-7 gate:
// random integer/rational, nearly-concurrent main chords, near-collinear
// ("flat") and needle-shaped hexagons, plus a legal extra point (odd count).
import { hull } from "../../src/geometry/hull.ts";
import { orient } from "../../src/geometry/predicates.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { P, PQ, nearlyConcurrentHexagon, randomHexagon } from "./k7driver.ts";
import { oracleHasHole } from "./k7oracle.ts";
import { insideConvexStrict } from "./k7tree.ts";

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

// Near-collinear convex hexagon: vertices near a flat parabola arc.
export function flatHexagon(rand: () => number, span = 600): Pt[] {
  for (let t = 0; t < 4000; t += 1) {
    const xs = [0, 1, 2, 3, 4, 5].map(
      (i) => Math.floor(i * (span / 5) + (rand() - 0.5) * (span / 12)),
    );
    const k = 4 + Math.floor(rand() * 40);
    const cand = xs.map((x) =>
      P(x, Math.floor((x * (span - x)) / (span * k)) + Math.floor(rand() * 3)),
    );
    const h = hull(cand);
    if (h.length === 6 && gpAll(h)) {
      return h;
    }
  }
  throw new Error("flatHexagon: none found");
}

// Needle: long thin hexagon.
export function needleHexagon(rand: () => number): Pt[] {
  for (let t = 0; t < 4000; t += 1) {
    const cand: Pt[] = [];
    for (let i = 0; i < 6; i += 1) {
      cand.push(
        P(
          Math.floor((rand() * 2 - 1) * 900),
          Math.floor((rand() * 2 - 1) * 12),
        ),
      );
    }
    const h = hull(cand);
    if (h.length === 6 && gpAll(h)) {
      return h;
    }
  }
  throw new Error("needleHexagon: none found");
}

// Rational-coordinate hexagon (denominators up to 13).
export function rationalHexagon(rand: () => number): Pt[] {
  return randomHexagon(rand, 30, 2 + Math.floor(rand() * 12));
}

export function nearConcurrent(rand: () => number): Pt[] {
  return nearlyConcurrentHexagon(rand, 400 + Math.floor(rand() * 600), 1 + Math.floor(rand() * 3));
}

// One extra point outside the hexagon keeping GP and creating NO 7-hole
// (so the start is a legal odd-count session with the hexagon still a hole).
export function extraPoint(hex: readonly Pt[], rand: () => number): Pt {
  const h = hull([...hex]);
  for (let t = 0; t < 4000; t += 1) {
    const s = 3000;
    const cand = PQ(
      Math.floor((rand() * 2 - 1) * s),
      1 + Math.floor(rand() * 5),
      Math.floor((rand() * 2 - 1) * s),
      1 + Math.floor(rand() * 5),
    );
    if (insideConvexStrict(h, cand)) {
      continue;
    }
    const all = [...hex, cand];
    if (!gpAll(all)) {
      continue;
    }
    if (oracleHasHole(all, 7)) {
      continue;
    }
    return cand;
  }
  throw new Error("extraPoint: none found");
}
