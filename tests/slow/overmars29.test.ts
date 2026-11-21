// tests/slow/overmars29.test.ts — SLOW TIER (excluded from `verify`).
// The Overmars-29 sandbox preset (data/scenarios/overmars29.json, transcribed
// from the bundle's prototype verification JSON): exhaustive 6-hole analysis
// reports exactly 0 holes, hull layers are [3,4,7,7,7,1] — parity with the
// Python verification (V3/V4), which found 5335 convex 6-subsets and 0 holes.
import { describe, expect, it } from "vitest";
import { Rat } from "../../src/geometry/rat.ts";
import { eqPt, pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { gp } from "../../src/geometry/predicates.ts";
import { convexPosition, hull } from "../../src/geometry/hull.ts";
import {
  estimateHoleWork,
  findKHoles,
} from "../../src/geometry/holes.ts";
import { withIds } from "../helpers.ts";
import data from "../../data/scenarios/overmars29.json";

const pts: Pt[] = (data.points as Array<[number, number]>).map(([x, y]) =>
  pt(Rat.make(BigInt(x)), Rat.make(BigInt(y))),
);

function* combos(n: number, k: number): Generator<number[]> {
  const idx: number[] = [];
  for (let i = 0; i < k; i += 1) {
    idx.push(i);
  }
  for (;;) {
    yield [...idx];
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) {
      i -= 1;
    }
    if (i < 0) {
      return;
    }
    const v = (idx[i] as number) + 1;
    for (let j = i; j < k; j += 1) {
      idx[j] = v + (j - i);
    }
  }
}

describe("Overmars-29 (slow)", () => {
  it("has 29 points in general position", () => {
    expect(pts.length).toBe(29);
    expect(gp(pts)).toBe(true);
  });

  it("hull layers are [3,4,7,7,7,1]", () => {
    let rest = [...pts];
    const layers: number[] = [];
    while (rest.length > 0) {
      const h = hull(rest);
      layers.push(h.length);
      rest = rest.filter((p) => !h.some((q) => eqPt(p, q)));
    }
    expect(layers).toEqual([3, 4, 7, 7, 7, 1]);
  });

  it("exactly 5335 convex 6-subsets and 0 empty hexagons", () => {
    let convex = 0;
    for (const combo of combos(pts.length, 6)) {
      if (convexPosition(combo.map((i) => pts[i] as Pt))) {
        convex += 1;
      }
    }
    expect(convex).toBe(5335);
    const r = findKHoles(withIds(pts), 6, {
      mode: "exhaustive",
      budget: estimateHoleWork(29, 6),
    });
    expect(r.kind).toBe("exhaustive");
    if (r.kind === "exhaustive") {
      expect(r.holes).toEqual([]);
    }
  }, 600000);

  it("exactly 151 empty convex pentagons (V7 parity)", () => {
    const r = findKHoles(withIds(pts), 5, {
      mode: "exhaustive",
      budget: estimateHoleWork(29, 5),
    });
    expect(r.kind).toBe("exhaustive");
    if (r.kind === "exhaustive") {
      expect(r.holes.length).toBe(151);
    }
  }, 600000);
});
