// tests/geometry/regions.test.ts — §7.3/§8.1/§22.3: clip, RegionValue,
// canonicalInteriorPoint, forced regions, arrangementCells.
import { describe, expect, it } from "vitest";
import { Rat } from "../../src/geometry/rat.ts";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { gp } from "../../src/geometry/predicates.ts";
import { hull } from "../../src/geometry/hull.ts";
import {
  canonicalInteriorPoint,
  canonicalizePoly,
  canonicalizeRegion,
  clipConvexByHalfPlane,
  insideConvex,
  intersectConvex,
  polygonArea2,
  regionContains,
  regionNonEmpty,
} from "../../src/geometry/poly.ts";
import type { ConvexPoly, RegionValue } from "../../src/geometry/poly.ts";
import { arrangementCells } from "../../src/geometry/arrangement.ts";
import type { ArrLine } from "../../src/geometry/arrangement.ts";

function P(x: number, y: number): Pt {
  return pt(Rat.make(BigInt(x)), Rat.make(BigInt(y)));
}

function setOf(poly: ConvexPoly): Set<string> {
  return new Set(poly.map((p) => `${p.x.toString()},${p.y.toString()}`));
}

function expectPolyEq(got: ConvexPoly, want: Array<[number, number]>): void {
  expect(setOf(got)).toEqual(
    new Set(want.map(([x, y]) => `${P(x, y).x},${P(x, y).y}`)),
  );
}

describe("clipConvexByHalfPlane (§22.3)", () => {
  it("square by 8 half-planes (exact sets at every step)", () => {
    let poly: Pt[] = [P(0, 0), P(6, 0), P(6, 6), P(0, 6)];
    poly = clipConvexByHalfPlane(poly, P(2, 6), P(2, 0), true); // x ≥ 2
    expectPolyEq(poly, [[2, 0], [6, 0], [6, 6], [2, 6]]);
    poly = clipConvexByHalfPlane(poly, P(4, 0), P(4, 6), true); // x ≤ 4
    expectPolyEq(poly, [[2, 0], [4, 0], [4, 6], [2, 6]]);
    poly = clipConvexByHalfPlane(poly, P(0, 2), P(6, 2), true); // y ≥ 2
    expectPolyEq(poly, [[2, 2], [4, 2], [4, 6], [2, 6]]);
    poly = clipConvexByHalfPlane(poly, P(6, 4), P(0, 4), true); // y ≤ 4
    expectPolyEq(poly, [[2, 2], [4, 2], [4, 4], [2, 4]]);
    poly = clipConvexByHalfPlane(poly, P(0, 5), P(5, 0), true); // x+y ≥ 5
    expectPolyEq(poly, [[3, 2], [4, 2], [4, 4], [2, 4], [2, 3]]);
    poly = clipConvexByHalfPlane(poly, P(7, 0), P(0, 7), true); // x+y ≤ 7
    expectPolyEq(poly, [[3, 2], [4, 2], [4, 3], [3, 4], [2, 4], [2, 3]]);
    poly = clipConvexByHalfPlane(poly, P(6, 8), P(0, 2), true); // x−y ≥ −2 (no-op)
    expectPolyEq(poly, [[3, 2], [4, 2], [4, 3], [3, 4], [2, 4], [2, 3]]);
    poly = clipConvexByHalfPlane(poly, P(0, -2), P(6, 4), true); // x−y ≤ 2 (no-op)
    expectPolyEq(poly, [[3, 2], [4, 2], [4, 3], [3, 4], [2, 4], [2, 3]]);
    expect(regionNonEmpty(poly)).toBe(true);
  });

  it("clips to empty", () => {
    const tri: Pt[] = [P(0, -3), P(2, -3), P(1, -1)];
    expect(clipConvexByHalfPlane(tri, P(0, 0), P(1, 0), true)).toEqual([]);
  });

  it("degenerate 1- and 2-vertex results", () => {
    const touch: Pt[] = [P(0, -1), P(2, -1), P(1, 0)];
    expectPolyEq(clipConvexByHalfPlane(touch, P(0, 0), P(1, 0), true), [[1, 0]]);
    const seg: Pt[] = [P(0, -1), P(2, -1), P(2, 0), P(0, 0)];
    expectPolyEq(clipConvexByHalfPlane(seg, P(0, 0), P(1, 0), true), [[2, 0], [0, 0]]);
  });

  it("boundary-transition vectors (§22.3, line y=0 keepLeft)", () => {
    const la = P(0, 0);
    const lb = P(1, 0);
    const clip = (poly: Pt[]): Pt[] =>
      clipConvexByHalfPlane(poly, la, lb, true);
    // outside→boundary→in→in→out: crossing points are exact.
    expectPolyEq(
      clip([P(0, -1), P(2, -1), P(2, 1), P(0, 1)]),
      [[2, 0], [2, 1], [0, 1], [0, 0]],
    );
    // boundary→outside with everything kept: boundary counts as inside.
    expectPolyEq(clip([P(0, 0), P(2, 0), P(1, 1)]), [[0, 0], [2, 0], [1, 1]]);
    // boundary→boundary (edge along the line): kept verbatim.
    expectPolyEq(
      clip([P(0, 0), P(2, 0), P(2, 1), P(0, 1)]),
      [[0, 0], [2, 0], [2, 1], [0, 1]],
    );
    // inside→boundary→in: boundary vertex emitted as next, no intersection.
    expectPolyEq(
      clip([P(0, 1), P(1, 0), P(2, 1)]),
      [[1, 0], [2, 1], [0, 1]],
    );
    // out→boundary→in→boundary→out with consecutive-duplicate collapse.
    expectPolyEq(
      clip([P(0, -1), P(1, 0), P(0, 1), P(-1, 0)]),
      [[1, 0], [0, 1], [-1, 0]],
    );
  });

  it("empty input stays empty", () => {
    expect(clipConvexByHalfPlane([], P(0, 0), P(1, 0), true)).toEqual([]);
  });
});

describe("intersectConvex (§8.1 clip folding)", () => {
  it("square ∩ shifted square is the exact overlap rect", () => {
    const a: Pt[] = [P(0, 0), P(4, 0), P(4, 4), P(0, 4)];
    const b: Pt[] = [P(2, 2), P(6, 2), P(6, 6), P(2, 6)];
    expectPolyEq(intersectConvex(a, b), [[2, 2], [4, 2], [4, 4], [2, 4]]);
    expectPolyEq(intersectConvex(b, a), [[2, 2], [4, 2], [4, 4], [2, 4]]);
  });

  it("disjoint polys intersect to empty", () => {
    const a: Pt[] = [P(0, 0), P(1, 0), P(1, 1), P(0, 1)];
    const b: Pt[] = [P(5, 5), P(6, 5), P(6, 6), P(5, 6)];
    expect(intersectConvex(a, b)).toEqual([]);
  });
});

describe("insideConvex + regionContains (§3.7, §8.1)", () => {
  const sq: RegionValue = {
    kind: "poly",
    verts: [P(0, 0), P(4, 0), P(4, 4), P(0, 4)],
  };

  it("center/corner/edge/exterior with both strictness flags", () => {
    expect(insideConvex(sq.verts as Pt[], P(2, 2), false)).toBe(true);
    expect(insideConvex(sq.verts as Pt[], P(2, 2), true)).toBe(true);
    expect(regionContains(sq, P(0, 0), false)).toBe(true);
    expect(regionContains(sq, P(0, 0), true)).toBe(false);
    expect(regionContains(sq, P(2, 0), false)).toBe(true);
    expect(regionContains(sq, P(2, 0), true)).toBe(false);
    expect(regionContains(sq, P(5, 2), false)).toBe(false);
    expect(regionContains(sq, P(5, 2), true)).toBe(false);
  });

  it("union containment is ∃-part", () => {
    const u: RegionValue = {
      kind: "union",
      parts: [
        { kind: "poly", verts: [P(0, 0), P(2, 0), P(2, 2), P(0, 2)] },
        { kind: "poly", verts: [P(1, 1), P(3, 1), P(3, 3), P(1, 3)] },
      ],
    };
    expect(regionContains(u, P(2, 2), true)).toBe(true); // interior of S2
    expect(regionContains(u, P(1, 2), false)).toBe(true); // on both edges
    expect(regionContains(u, P(1, 2), true)).toBe(false);
    expect(regionContains(u, P(0, 0), false)).toBe(true);
    expect(regionContains(u, P(0, 0), true)).toBe(false);
    expect(regionContains(u, P(5, 5), false)).toBe(false);
  });

  it("degenerate polys: empty/point/segment/collinear", () => {
    const empty: RegionValue = { kind: "poly", verts: [] };
    expect(regionContains(empty, P(0, 0), false)).toBe(false);
    const point: RegionValue = { kind: "poly", verts: [P(2, 2)] };
    expect(regionContains(point, P(2, 2), false)).toBe(true);
    expect(regionContains(point, P(2, 2), true)).toBe(false);
    expect(regionContains(point, P(2, 3), false)).toBe(false);
    const seg: RegionValue = { kind: "poly", verts: [P(0, 0), P(4, 0)] };
    expect(regionContains(seg, P(2, 0), false)).toBe(true);
    expect(regionContains(seg, P(2, 0), true)).toBe(false);
    expect(regionContains(seg, P(5, 0), false)).toBe(false);
    expect(regionContains(seg, P(2, 1), false)).toBe(false);
    const flat: RegionValue = {
      kind: "poly",
      verts: [P(0, 0), P(2, 0), P(4, 0)],
    };
    expect(regionContains(flat, P(1, 0), false)).toBe(true);
    expect(regionContains(flat, P(2, 0), false)).toBe(true);
    expect(regionContains(flat, P(5, 0), false)).toBe(false);
    expect(regionContains(flat, P(1, 0), true)).toBe(false);
    const emptyUnion: RegionValue = { kind: "union", parts: [] };
    expect(regionContains(emptyUnion, P(0, 0), false)).toBe(false);
  });

  it("canonicalization: flatten, drop empties, sort, dedupe", () => {
    const s1: RegionValue = {
      kind: "poly",
      verts: [P(0, 0), P(2, 0), P(2, 2), P(0, 2)],
    };
    const s2: RegionValue = {
      kind: "poly",
      verts: [P(1, 1), P(3, 1), P(3, 3), P(1, 3)],
    };
    const nested: RegionValue = {
      kind: "union",
      parts: [
        { kind: "union", parts: [s1, { kind: "poly", verts: [] }] },
        s2,
        s1,
      ],
    };
    const c = canonicalizeRegion(nested);
    expect(c.kind).toBe("union");
    if (c.kind === "union") {
      expect(c.parts.length).toBe(2);
      // Sorted by canonical key: s1 (starts 0/1,0/1) before s2 (1/1,1/1).
      expect(c.parts[0]).toEqual(s1);
      expect(c.parts[1]).toEqual(s2);
    }
  });

  it("canonicalizePoly rotates to lex-min and dedupes", () => {
    expect(
      canonicalizePoly([P(2, 2), P(2, 2), P(4, 2), P(4, 4), P(0, 0)]).map(
        (p) => `${p.x},${p.y}`,
      ),
    ).toEqual(["0/1,0/1", "2/1,2/1", "4/1,2/1", "4/1,4/1"]);
  });
});

describe("canonicalInteriorPoint (§7.3, §22.4)", () => {
  it("triangle centroid is exact and strictly inside", () => {
    const tri: Pt[] = [P(0, 0), P(4, 0), P(0, 4)];
    const c = canonicalInteriorPoint(tri);
    expect(c?.x.toString()).toBe("4/3");
    expect(c?.y.toString()).toBe("4/3");
    expect(regionContains({ kind: "poly", verts: tri }, c as Pt, true)).toBe(
      true,
    );
  });

  it("hexagon interior point is strictly inside", () => {
    const hex: Pt[] = [P(3, 2), P(4, 2), P(4, 3), P(3, 4), P(2, 4), P(2, 3)];
    const c = canonicalInteriorPoint(hex);
    expect(c !== null).toBe(true);
    expect(
      regionContains({ kind: "poly", verts: hex }, c as Pt, true),
    ).toBe(true);
    expect(polygonArea2(hex).sign()).toBe(1);
  });

  it("degenerate polygons return null", () => {
    expect(canonicalInteriorPoint([])).toBe(null);
    expect(canonicalInteriorPoint([P(0, 0), P(1, 1)])).toBe(null);
    expect(
      canonicalInteriorPoint([P(0, 0), P(1, 1), P(2, 2)]),
    ).toBe(null);
  });
});

describe("forced regions on 100 random pentagons (prototype port)", () => {
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it("the common intersection of the five chord-4-holes is nonempty", () => {
    // Proof note: ∩(P ∖ ear_i) = P ∖ ∪ear_i ⊇ the pentagram's inner
    // pentagon (each ear is cut off by one diagonal; the inner pentagon
    // lies strictly on the interior side of all five) — hence nonempty
    // for EVERY convex pentagon, so rejection sampling is safe.
    const rand = mulberry32(11);
    let done = 0;
    let guard = 0;
    while (done < 100 && guard < 100000) {
      guard += 1;
      const raw: Pt[] = [];
      const seen = new Set<string>();
      while (raw.length < 12) {
        const p = P(Math.floor(rand() * 21), Math.floor(rand() * 21));
        const k = `${p.x},${p.y}`;
        if (!seen.has(k)) {
          seen.add(k);
          raw.push(p);
        }
      }
      const h = hull(raw);
      if (h.length !== 5 || !gp(h)) {
        continue;
      }
      // Five chord-4-holes: pentagon minus each vertex (convex quads).
      let region: Pt[] = h.filter((_, i) => i !== 0);
      for (let i = 1; i < 5; i += 1) {
        region = intersectConvex(
          region,
          h.filter((_, j) => j !== i),
        );
        if (region.length === 0) {
          break;
        }
      }
      expect(regionNonEmpty(region)).toBe(true);
      const c = canonicalInteriorPoint(region);
      expect(c !== null).toBe(true);
      expect(
        regionContains({ kind: "poly", verts: region }, c as Pt, true),
      ).toBe(true);
      done += 1;
    }
    expect(done).toBe(100);
  });
});

describe("arrangementCells (§7.3)", () => {
  // Lines i·x + y = i² through A=(i,0), B=(0,i²): slopes −i are distinct
  // (never parallel); lines i,j meet at x = i+j, so no three are concurrent.
  function lines(count: number): ArrLine[] {
    const out: ArrLine[] = [];
    for (let i = 1; i <= count; i += 1) {
      out.push({ a: P(i, 0), b: P(0, i * i) });
    }
    return out;
  }

  it("10 lines yield exactly 56 cells with exact coverage", () => {
    // Intersections: x = i+j ∈ [3,19], y = −ij ∈ [−90,−2] — all strictly
    // inside the window, so the clipped count equals the full maximum
    // 10·11/2+1 = 56. Coverage is tripwired inside arrangementCells.
    const window: Pt[] = [P(0, 0), P(0, -95), P(22, -95), P(22, 0)];
    const cells = arrangementCells(lines(10), window);
    expect(cells.length).toBe(56);
    for (const c of cells) {
      expect(regionNonEmpty(c)).toBe(true);
    }
  });

  it("21 lines yield ≤ 232 cells with exact coverage", () => {
    // Intersections: x = i+j ∈ [3,41], y = −ij ∈ [−420,−2] — strictly
    // inside; the count is the maximum 21·22/2+1 = 232.
    const window: Pt[] = [P(0, 0), P(0, -430), P(44, -430), P(44, 0)];
    const cells = arrangementCells(lines(21), window);
    expect(cells.length).toBeLessThanOrEqual(232);
    expect(cells.length).toBe(232);
  });

  it("a line missing the window adds no cells", () => {
    const window: Pt[] = [P(0, 0), P(4, 0), P(4, 4), P(0, 4)];
    const far: ArrLine[] = [{ a: P(10, 10), b: P(11, 12) }];
    expect(arrangementCells(far, window).length).toBe(1);
    const cut: ArrLine[] = [{ a: P(2, -1), b: P(2, 5) }];
    expect(arrangementCells(cut, window).length).toBe(2);
  });
});
