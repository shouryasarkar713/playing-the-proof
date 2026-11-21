// tests/geometry/extend.test.ts — §7.7/§6.3/§23.3/§23.6/§24.3: the exact 2D
// constructions (extendHole, coShoulder, escapeScan) with the §7.7 sign
// fixture verbatim, randomized extension batteries, adversarial/GP-repair/
// s=0-blocked fixtures, and the window-exhaustion taxonomy.
import { describe, expect, it } from "vitest";
import { Rat } from "../../src/geometry/rat.ts";
import { eqPt, pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { gp, orient, signedArea2 } from "../../src/geometry/predicates.ts";
import { hull } from "../../src/geometry/hull.ts";
import { isKHole } from "../../src/geometry/holes.ts";
import type { IdPt, KHole } from "../../src/geometry/holes.ts";
import { holeFor, placeId, withIds } from "../helpers.ts";
import { regionContains } from "../../src/geometry/poly.ts";
import {
  DEFAULT_WINDOW,
  coShoulder,
  escapeNearEdge,
  escapeScan,
  extendHole,
  scanExtendEdge,
} from "../../src/geometry/extend.ts";
import type { Window } from "../../src/geometry/extend.ts";

function P(x: number, y: number): Pt {
  return pt(Rat.make(BigInt(x)), Rat.make(BigInt(y)));
}

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

// GP-validity of a fresh point against placed points (machine-checked).
function gpValid(point: Pt, placed: readonly Pt[]): boolean {
  for (const q of placed) {
    if (eqPt(point, q)) {
      return false;
    }
  }
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      if (orient(placed[i] as Pt, placed[j] as Pt, point) === 0) {
        return false;
      }
    }
  }
  return true;
}

function inWindow(point: Pt, window: Window): boolean {
  return (
    window.minX.cmp(point.x) < 0 &&
    point.x.cmp(window.maxX) < 0 &&
    window.minY.cmp(point.y) < 0 &&
    point.y.cmp(window.maxY) < 0
  );
}

describe("§7.7 sign fixture (verbatim)", () => {
  const u = P(0, 0);
  const v = P(1, 0);
  const prev = P(0, 1);
  const next = P(1, 1);
  const p = pt(Rat.make(1n, 2n), Rat.make(-1n, 2n)); // m + (1/2)·n

  it("wedge signs: exterior −1/2, adjacents +1/2", () => {
    expect(signedArea2(u, v, p)).toEqual(Rat.make(-1n, 2n));
    expect(orient(u, v, p)).toBe(-1);
    expect(signedArea2(prev, u, p)).toEqual(Rat.make(1n, 2n));
    expect(orient(prev, u, p)).toBe(1);
    expect(signedArea2(v, next, p)).toEqual(Rat.make(1n, 2n));
    expect(orient(v, next, p)).toBe(1);
  });

  it("swallow signs: outer q below p is not swallowed; q inside tri is", () => {
    const qFar = pt(Rat.make(1n, 2n), Rat.make(-2n, 1n));
    expect(signedArea2(qFar, v, p)).toEqual(Rat.make(3n, 4n));
    const qIn = pt(Rat.make(1n, 2n), Rat.make(-1n, 4n));
    expect(signedArea2(qIn, v, p)).toEqual(Rat.make(-1n, 8n));
    expect(signedArea2(u, qIn, p)).toEqual(Rat.make(-1n, 8n));
  });

  it("scanExtendEdge on the fixture edge succeeds strictly inside the wedge", () => {
    const sq = [P(0, 0), P(1, 0), P(1, 1), P(0, 1)];
    const r = scanExtendEdge(sq, 0, sq, DEFAULT_WINDOW);
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    const { point } = r.scan;
    expect(orient(u, v, point)).toBe(-1);
    expect(orient(prev, u, point)).toBe(1);
    expect(orient(v, next, point)).toBe(1);
    expect(inWindow(point, DEFAULT_WINDOW)).toBe(true);
    expect(gpValid(point, sq)).toBe(true);
  });
});

describe("extendHole batteries (200 seeds each)", () => {
  const holes: Pt[][] = [
    [P(0, 0), P(10, 0), P(0, 10)],
    [P(0, 0), P(10, 0), P(10, 10), P(0, 10)],
    [P(0, 0), P(10, 0), P(12, 6), P(5, 12), P(-2, 6)],
  ];

  for (let h = 0; h < holes.length; h += 1) {
    const k = [3, 4, 5][h] as number;
    it(
      `extends a ${k}-hole in 200 random contexts (both prefers)`,
      () => {
        const H = holes[h] as Pt[];
        expect(hull(H).length).toBe(H.length);
        const rand = mulberry32(100 + h);
        for (let seed = 0; seed < 200; seed += 1) {
          // Random context: 3 integer points in −10..20; accept iff GP and
          // H stays a hole (cap 30 attempts — hit rate is ~95%).
          let ctx: Pt[] = [];
          for (let attempt = 0; attempt < 30 && ctx.length === 0; attempt += 1) {
            const cand: Pt[] = [];
            const seen = new Set<string>();
            while (cand.length < 3) {
              const p = P(
                Math.floor(rand() * 31) - 10,
                Math.floor(rand() * 31) - 10,
              );
              const key = `${p.x},${p.y}`;
              if (!seen.has(key)) {
                seen.add(key);
                cand.push(p);
              }
            }
            const S = [...H, ...cand];
            if (gp(S) && isKHole(H, S)) {
              ctx = cand;
            }
          }
          expect(ctx.length, `seed ${seed}: no valid context`).toBe(3);
          const S = withIds([...H, ...ctx]);
          const hole: KHole = holeFor(S, H);
          for (const prefer of [
            "largest-interval",
            "farthest-clearance",
          ] as const) {
            const r = extendHole([hole], S, DEFAULT_WINDOW, prefer);
            expect(r.ok, `seed ${seed} prefer ${prefer}`).toBe(true);
            if (!r.ok) {
              continue;
            }
            expect(r.hole.verts.length).toBe(k);
            expect(gp([...S.map((p) => p.pt), r.point])).toBe(true);
            expect(inWindow(r.point, DEFAULT_WINDOW)).toBe(true);
          }
        }
      },
      120000,
    );
  }
});

describe("adversarial fixtures", () => {
  it("thin admissible region: parabola blockers inside the wedge", () => {
    const H = [P(0, 0), P(10, 0), P(0, 10)];
    // Parabola candidates filtered incrementally: a candidate joins only if
    // GP is preserved (lines through two parabola points can hit H vertices,
    // e.g. B_1B_10 passes through (0,0) — hence the filter, not blind trust).
    const accepted: Pt[] = [];
    for (let i = 1; i <= 20 && accepted.length < 8; i += 1) {
      const cand = pt(
        Rat.make(BigInt(i)),
        Rat.make(-10n - BigInt(i * i), 10n),
      );
      if (gp([...H, ...accepted, cand])) {
        accepted.push(cand);
      }
    }
    expect(accepted.length).toBe(8);
    const S: IdPt[] = withIds([...H, ...accepted]);
    expect(isKHole(H, S.map((p) => p.pt))).toBe(true);
    const r = extendHole(
      [holeFor(S, H)],
      S,
      DEFAULT_WINDOW,
      "largest-interval",
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(gpValid(r.point, S.map((p) => p.pt))).toBe(true);
    }
  });

  it("GP repair: blocking the first-choice point still succeeds elsewhere", () => {
    const H = [P(0, 0), P(10, 0), P(0, 10)];
    const S0 = withIds(H);
    const hole: KHole = holeFor(S0, H);
    const r0 = extendHole([hole], S0, DEFAULT_WINDOW, "largest-interval");
    expect(r0.ok).toBe(true);
    if (!r0.ok) {
      return;
    }
    const S1 = placeId(S0, r0.point);
    expect(gp(S1.map((p) => p.pt))).toBe(true);
    expect(isKHole(H, S1.map((p) => p.pt))).toBe(true);
    const r1 = extendHole([hole], S1, DEFAULT_WINDOW, "largest-interval");
    expect(r1.ok).toBe(true);
    if (r1.ok) {
      expect(eqPt(r1.point, r0.point)).toBe(false);
      expect(gpValid(r1.point, S1.map((p) => p.pt))).toBe(true);
    }
  });

  it("s=0-fully-blocked: a pair line parallel to n through m is skipped", () => {
    // Edge ((0,0),(4,0)): m=(2,0), n=(0,−4). Pair line x=2 through
    // q1=(2,5), q2=(2,−3) blocks the whole s=0 line; the scan must go off-line.
    const H = [P(0, 0), P(4, 0), P(0, 4)];
    const S = [...H, P(2, 5), P(2, -3)];
    expect(gp(S)).toBe(true);
    expect(isKHole(H, S)).toBe(true);
    const r = scanExtendEdge(hull(H), 0, S, DEFAULT_WINDOW);
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.scan.point.x.cmp(Rat.make(2n)) !== 0).toBe(true);
    expect(gpValid(r.scan.point, S)).toBe(true);
  });

  it("window-exhausted: box strictly inside the hole starves every edge", () => {
    const H = [P(-100, -100), P(100, -100), P(100, 100), P(-100, 100)];
    const window: Window = {
      minX: Rat.make(-1n),
      minY: Rat.make(-1n),
      maxX: Rat.make(1n),
      maxY: Rat.make(1n),
    };
    const r = extendHole(
      [{ k: 4, verts: ["p1", "p2", "p3", "p4"] }],
      withIds(H),
      window,
      "largest-interval",
    );
    expect(r).toEqual({ ok: false, reason: "window-exhausted" });
  });

  it("extendHole with no holes throws (caller contract)", () => {
    expect(() =>
      extendHole([], withIds([P(0, 0)]), DEFAULT_WINDOW, "largest-interval"),
    ).toThrow();
  });
});

describe("coShoulder (§23.3, §23.6)", () => {
  it("one-interior config: centroid interior; farthest edge selected", () => {
    // the §23.2 example coordinates are actually convex (blunder), not
    // one-interior. Corrected fixture: the same outer triple with the
    // centroid (7,11) strictly inside (positive barycentric weights).
    // |orient| vs the centroid is Area/3 = 32 on all three edges (the full
    // triangle orients +96) → tie → smallest CCW index 0 = ((−1,3),(2,2)).
    const outer = hull([P(2, 2), P(20, 28), P(-1, 3)]);
    expect(outer.length).toBe(3);
    const interior = pt(Rat.make(7n), Rat.make(11n));
    const placed = [...outer, interior];
    expect(gp(placed)).toBe(true);
    const r = coShoulder(outer, interior, placed, DEFAULT_WINDOW);
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.edgeIndex).toBe(0);
    expect(eqPt(r.edge[0], P(-1, 3))).toBe(true);
    expect(eqPt(r.edge[1], P(2, 2))).toBe(true);
    // A3 strictly inside outer (three strict signs).
    for (let i = 0; i < 3; i += 1) {
      expect(
        orient(outer[i] as Pt, outer[(i + 1) % 3] as Pt, r.point),
      ).toBe(1);
    }
    expect(gpValid(r.point, placed)).toBe(true);
  });

  it("thin interval (B2 near edge): A3 == (5,3) exactly", () => {
    // outer=(0,0),(10,0),(0,10) CCW; I=(5,1); farthest edge e2 (left, |o|=50).
    // ε-interval (−0.4,0.1) split at 0 (coincidence exclusion) → (−0.4,0)
    // wins (length 0.4 > 0.1); midpoint −0.2 → A3=(5,3).
    const outer = [P(0, 0), P(10, 0), P(0, 10)];
    const placed = [...outer, P(5, 1)];
    const r = coShoulder(outer, P(5, 1), placed, DEFAULT_WINDOW);
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.edgeIndex).toBe(2);
    expect(eqPt(r.point, P(5, 3))).toBe(true);
  });

  it("rejects a non-interior interior point as convention-failure", () => {
    const outer = [P(0, 0), P(10, 0), P(0, 10)];
    const r = coShoulder(outer, P(20, 20), outer, DEFAULT_WINDOW);
    expect(r.ok).toBe(false);
    if (!r.ok && r.reason === "convention-failure") {
      expect(r.detail).toContain("interior");
    }
  });
});

describe("escapeScan (§24.3 item 3)", () => {
  it("places A1 strictly inside the pentagon edge's outer wedge", () => {
    const pent = [P(0, 0), P(10, 0), P(12, 6), P(5, 12), P(-2, 6)];
    expect(hull(pent).length).toBe(5);
    const E = P(12, 6);
    const nb = P(5, 12);
    const r = escapeScan(E, nb, P(10, 0), P(-2, 6), pent, DEFAULT_WINDOW);
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(orient(P(10, 0), E, r.point)).toBe(1);
    expect(orient(E, nb, r.point)).toBe(-1);
    expect(orient(nb, P(-2, 6), r.point)).toBe(1);
    expect(gpValid(r.point, pent)).toBe(true);
    expect(
      regionContains({ kind: "poly", verts: pent }, r.point, false),
    ).toBe(false);
  });
});

describe("construction failure taxonomy (Phase 18)", () => {
  const ZERO: Window = {
    minX: Rat.make(0n),
    minY: Rat.make(0n),
    maxX: Rat.make(0n),
    maxY: Rat.make(0n),
  };

  it("extendHole: a hole vertex naming no placed point throws loudly", () => {
    expect(() =>
      extendHole(
        [{ k: 4, verts: ["p1", "p9"] }],
        withIds([P(0, 0)]),
        DEFAULT_WINDOW,
        "largest-interval",
      ),
    ).toThrowError(/names no placed point/);
  });

  it("coShoulder: outer must be a 3-triangle", () => {
    expect(() =>
      coShoulder([P(0, 0), P(1, 0)], P(0, 0), [P(0, 0), P(1, 0)], DEFAULT_WINDOW),
    ).toThrowError(/outer must be a 3-triangle/);
  });

  it("escapeNearEdge: a degenerate window exhausts (typed)", () => {
    const r = escapeNearEdge(P(12, 6), P(5, 12), P(10, 0), P(-2, 6), [P(0, 0)], ZERO);
    expect(r).toEqual({ ok: false, reason: "window-exhausted" });
  });

  it("escapeScan: a degenerate window exhausts (typed)", () => {
    const pent = [P(0, 0), P(10, 0), P(12, 6), P(5, 12), P(-2, 6)];
    const r = escapeScan(P(12, 6), P(5, 12), P(10, 0), P(-2, 6), pent, ZERO);
    expect(r).toEqual({ ok: false, reason: "window-exhausted" });
  });

  it("hostile windows: ok-valid or window-exhausted, never a throw", () => {
    const quad = [P(0, 0), P(10, 0), P(10, 10), P(0, 10)];
    const placed = withIds(quad);
    const holes: KHole[] = [{ k: 4, verts: ["p1", "p2", "p3", "p4"] }];
    const box = (x0: number, y0: number, x1: number, y1: number): Window => ({
      minX: Rat.make(BigInt(x0)),
      minY: Rat.make(BigInt(y0)),
      maxX: Rat.make(BigInt(x1)),
      maxY: Rat.make(BigInt(y1)),
    });
    const windows: Window[] = [
      ZERO,
      box(4, 4, 6, 6),
      box(-20, -20, -10, -10),
      box(10, 4, 12, 6),
      box(-5, -5, 15, 15),
    ];
    for (const window of windows) {
      const r = extendHole(holes, placed, window, "largest-interval");
      if (r.ok) {
        expect(
          isKHole(
            [...quad, r.point],
            [...quad, r.point],
          ),
        ).toBe(true);
      } else {
        expect(r.reason).toBe("window-exhausted");
      }
    }
  });
});
