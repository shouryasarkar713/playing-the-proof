// tests/geometry/predicates.test.ts — §3.3–3.4 vectors.
import { describe, expect, it } from "vitest";
import { Rat } from "../../src/geometry/rat.ts";
import { cmpPt, eqPt, pt } from "../../src/geometry/pt.ts";
import {
  gp,
  insideTriangleStrict,
  orient,
} from "../../src/geometry/predicates.ts";

function P(x: bigint, y: bigint): { x: Rat; y: Rat } {
  return pt(Rat.make(x), Rat.make(y));
}

describe("orient (§3.3)", () => {
  it("ccw / cw / collinear", () => {
    expect(orient(P(0n, 0n), P(1n, 0n), P(0n, 1n))).toBe(1);
    expect(orient(P(0n, 0n), P(1n, 0n), P(0n, -1n))).toBe(-1);
    expect(orient(P(0n, 0n), P(1n, 1n), P(2n, 2n))).toBe(0);
  });

  it("collinear is exactly zero (the classic float-failure triple)", () => {
    expect(orient(P(0n, 0n), P(1n, 1n), P(2n, 2n))).toBe(0);
  });

  it("near-collinear rationals resolve exactly", () => {
    // Near-miss of the §7.3 triple: (0,0), (10^18, 10^18−1),
    // (−10^18, −10^18+2). Signed area = +10^18 exactly (see // the plan's as-printed triple is exactly collinear, orient 0).
    const a = P(0n, 0n);
    const b = pt(
      Rat.make(10n ** 18n),
      Rat.make(10n ** 18n - 1n),
    );
    const c = pt(
      Rat.make(-(10n ** 18n)),
      Rat.make(-(10n ** 18n) + 2n),
    );
    expect(orient(a, b, c)).toBe(1);
    expect(orient(a, c, b)).toBe(-1);
  });

  it(" evidence: the §7.3 as-printed triple is exactly collinear", () => {
    // c = −b componentwise, so a=(0,0), b, c are collinear and orient = 0
    // is the correct answer (the plan text expects ±1 — recorded in).
    const a = P(0n, 0n);
    const b = pt(
      Rat.make(10n ** 18n),
      Rat.make(10n ** 18n - 1n),
    );
    const c = pt(
      Rat.make(-(10n ** 18n)),
      Rat.make(-(10n ** 18n) + 1n),
    );
    expect(orient(a, b, c)).toBe(0);
  });

  it("huge coordinates (|n| ≈ 10^25) where float64 fails", () => {
    const a = pt(Rat.make(10n ** 25n), Rat.make(10n ** 25n));
    const b = pt(Rat.make(10n ** 25n + 1n), Rat.make(10n ** 25n));
    const c = pt(Rat.make(10n ** 25n), Rat.make(10n ** 25n + 1n));
    expect(orient(a, b, c)).toBe(1);
  });

  it("negative quadrants and 1/denominator differences", () => {
    const a = pt(Rat.make(-3n, 1n), Rat.make(-2n, 1n));
    const b = pt(Rat.make(-1n, 1n), Rat.make(-2n, 1n));
    const c = pt(Rat.make(-1n, 1n), Rat.make(-2n, 1n).add(Rat.make(1n, 1000000n)));
    expect(orient(a, b, c)).toBe(1);
  });
});

describe("cmpPt / eqPt (§3.2)", () => {
  it("lexicographic order, exact tuple equality", () => {
    const a = P(1n, 2n);
    const b = pt(Rat.make(1n, 1n), Rat.make(3n, 1n));
    expect(cmpPt(a, b)).toBe(-1);
    expect(cmpPt(b, a)).toBe(1);
    expect(cmpPt(a, a)).toBe(0);
    expect(eqPt(a, P(1n, 2n))).toBe(true);
    expect(eqPt(a, b)).toBe(false);
  });
});

describe("gp (§3.4)", () => {
  it("3×3 grid is NOT in general position", () => {
    const grid = [];
    for (let x = 0n; x < 3n; x += 1n) {
      for (let y = 0n; y < 3n; y += 1n) {
        grid.push(P(x, y));
      }
    }
    expect(gp(grid)).toBe(false);
  });

  it("grid rows are detected (collinear row)", () => {
    expect(gp([P(0n, 0n), P(1n, 1n), P(2n, 2n)])).toBe(false);
  });

  it("non-collinear triple is GP", () => {
    expect(gp([P(0n, 0n), P(1n, 1n), P(2n, 3n)])).toBe(true);
  });

  it("duplicate points violate GP", () => {
    expect(gp([P(0n, 0n), P(1n, 0n), P(0n, 0n)])).toBe(false);
  });

  it("convex pentagon vertices are GP", () => {
    const pent = [
      P(0n, 0n),
      P(4n, 0n),
      P(5n, 3n),
      P(2n, 5n),
      P(-1n, 3n),
    ];
    expect(gp(pent)).toBe(true);
  });
});

describe("insideTriangleStrict", () => {
  it("center strictly inside; vertex/edge/exterior outside", () => {
    const a = P(0n, 0n);
    const b = P(4n, 0n);
    const c = P(0n, 4n);
    expect(insideTriangleStrict(a, b, c, P(1n, 1n))).toBe(true);
    expect(insideTriangleStrict(a, b, c, P(0n, 0n))).toBe(false);
    expect(insideTriangleStrict(a, b, c, P(2n, 0n))).toBe(false);
    expect(insideTriangleStrict(a, b, c, P(4n, 4n))).toBe(false);
    // Winding-independent.
    expect(insideTriangleStrict(a, c, b, P(1n, 1n))).toBe(true);
  });
});
