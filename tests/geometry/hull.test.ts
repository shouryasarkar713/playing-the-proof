// tests/geometry/hull.test.ts — §3.5–3.6 + §22.2 vectors, determinism,
// and the randomized brute-force cross-check (n ≤ 12, 500 seeds).
import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { Rat } from "../../src/geometry/rat.ts";
import { eqPt, pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { gp, insideTriangleStrict, orient } from "../../src/geometry/predicates.ts";
import { convexPosition, hull } from "../../src/geometry/hull.ts";

function P(x: number, y: number): Pt {
  return pt(Rat.make(BigInt(x)), Rat.make(BigInt(y)));
}

function isCcw(poly: readonly Pt[]): boolean {
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i] as Pt;
    const b = poly[(i + 1) % poly.length] as Pt;
    const c = poly[(i + 2) % poly.length] as Pt;
    if (orient(a, b, c) <= 0) {
      return false;
    }
  }
  return true;
}

describe("hull (§3.6, §22.2)", () => {
  it("square + interior + edge-near points", () => {
    const pts = [
      P(0, 0),
      P(4, 0),
      P(4, 4),
      P(0, 4),
      P(2, 2),
      P(2, 0),
    ];
    const h = hull(pts);
    expect(h.length).toBe(4);
    // Canonical start: lexicographically smallest.
    expect(eqPt(h[0] as Pt, P(0, 0))).toBe(true);
    expect(isCcw(h)).toBe(true);
  });

  it("starts at lex-min and runs CCW on the §22.2 vector", () => {
    const pts = [P(0, 0), P(4, 0), P(2, 1), P(2, 3), P(-1, 2)];
    const h = hull(pts);
    expect(eqPt(h[0] as Pt, P(-1, 2))).toBe(true);
    expect(isCcw(h)).toBe(true);
    // Brute-force agreement: hull vertices are exactly the points not
    // strictly inside any triangle of the others.
    const extreme = pts.filter(
      (q) =>
        !pts.some(
          (a, i) =>
            pts.some(
              (b, j) =>
                j > i &&
                pts.some(
                  (c, k) =>
                    k > j && insideTriangleStrict(a, b, c, q),
                ),
            ),
        ),
    );
    expect(h.length).toBe(extreme.length);
  });

  it("all-collinear input returns the 2 endpoints", () => {
    expect(hull([P(0, 0), P(1, 1), P(2, 2)]).length).toBe(2);
  });

  it("n = 0, 1, 2 return sorted points", () => {
    expect(hull([])).toEqual([]);
    expect(hull([P(2, 1)]).length).toBe(1);
    expect(hull([P(2, 1), P(0, 0)]).map((p) => [p.x, p.y])).toEqual([
      [Rat.make(0n), Rat.make(0n)],
      [Rat.make(2n), Rat.make(1n)],
    ]);
  });

  it("duplicate input points are deduplicated", () => {
    expect(hull([P(0, 0), P(1, 0), P(0, 0), P(0, 1)]).length).toBe(3);
  });

  it("deterministic: same input ⇒ same output", () => {
    const pts = [P(3, 1), P(0, 0), P(1, 4), P(4, 0), P(2, 2)];
    const a = hull(pts).map((p) => p.x.toString() + "," + p.y.toString());
    const b = hull([...pts].reverse()).map(
      (p) => p.x.toString() + "," + p.y.toString(),
    );
    expect(a).toEqual(b);
  });
});

describe("convexPosition (§3.5)", () => {
  it("square + center is false; convex 5-set is true", () => {
    expect(
      convexPosition([P(0, 0), P(2, 0), P(2, 2), P(0, 2), P(1, 1)]),
    ).toBe(false);
    expect(
      convexPosition([P(0, 0), P(4, 0), P(5, 3), P(2, 5), P(-1, 3)]),
    ).toBe(true);
  });

  it("k < 3 is false; collinear triple is false (total for sandbox)", () => {
    expect(convexPosition([P(0, 0), P(1, 1)])).toBe(false);
    expect(convexPosition([P(0, 0), P(1, 1), P(2, 2)])).toBe(false);
    expect(convexPosition([P(0, 0), P(1, 0), P(0, 1)])).toBe(true);
  });
});

describe("hull brute-force cross-check (500 seeds, n ≤ 12)", () => {
  const arbPt = fc
    .tuple(
      fc.integer({ min: -20, max: 20 }),
      fc.integer({ min: -20, max: 20 }),
    )
    .map(([x, y]) => P(x, y));

  it("hull == points not strictly inside any triangle of others", () => {
    fc.assert(
      fc.property(
        fc.array(arbPt, { minLength: 3, maxLength: 12 }),
        (raw) => {
          const seen = new Set<string>();
          const pts = raw.filter((p) => {
            const key = p.x.toString() + "," + p.y.toString();
            if (seen.has(key)) {
              return false;
            }
            seen.add(key);
            return true;
          });
          if (pts.length < 3 || !gp(pts)) {
            return;
          }
          const h = hull(pts);
          expect(isCcw(h)).toBe(true);
          const inside = pts.filter((q) =>
            pts.some(
              (a, i) =>
                pts.some(
                  (b, j) =>
                    j > i &&
                    pts.some(
                      (c, k) => k > j && insideTriangleStrict(a, b, c, q),
                    ),
                ),
            ),
          );
          expect(h.length).toBe(pts.length - inside.length);
        },
      ),
      { numRuns: 500 },
    );
  });
});
