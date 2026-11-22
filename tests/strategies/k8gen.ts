// tests/strategies/k8gen.ts — convex 7-hole generators for the k=8 gate.
import { hull } from "../../src/geometry/hull.ts";
import { orient } from "../../src/geometry/predicates.ts";
import type { Pt } from "../../src/geometry/pt.ts";
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
