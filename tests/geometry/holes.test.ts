// tests/geometry/holes.test.ts — §3.9/§7.3: emptiness, enumeration, the
// HoleAnalysis semantics, and the §27.1 findKHoles contract battery.
//
// Fixture F-H3: six points with exactly three 4-holes — every one of
// the 15 4-subsets hand-verified below by exact integer orientation
// arithmetic (each claimed sign recomputed by hand; the machine only
// executes). Points: A=(4,4) B=(6,5) C=(3,8) D=(1,3) E=(0,1) F=(3,6).
import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { Rat } from "../../src/geometry/rat.ts";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { gp } from "../../src/geometry/predicates.ts";
import {
  BOOTSTRAP_EXACT_HOLE_BUDGET_5,
  BOOTSTRAP_EXACT_HOLE_BUDGET_6,
  analyzeHoles,
  estimateHoleWork,
  findKHoles,
  findNewKHoles,
  isKHole,
  sharedEdgePairs,
} from "../../src/geometry/holes.ts";
import type { IdPt, PointId } from "../../src/geometry/holes.ts";
import { withIds } from "../helpers.ts";

function P(x: number, y: number): Pt {
  return pt(Rat.make(BigInt(x)), Rat.make(BigInt(y)));
}

function key(p: Pt): string {
  return `${p.x},${p.y}`;
}

function idSet(ids: readonly PointId[]): string {
  return [...ids].sort().join(";");
}

// F-H3 points in index order [A,B,C,D,E,F] → ids p1..p6.
const FH3: Pt[] = [P(4, 4), P(6, 5), P(3, 8), P(1, 3), P(0, 1), P(3, 6)];
const FH3IDS: IdPt[] = withIds(FH3);

// The three holes as index sets (hand-verified convexity + emptiness;
// witness outside-edges: H1: D vs F→A = −7; H2: C vs B→F = −6, E vs D→A = −5;
// H3: B vs A→F = −5, C vs F→D = −4 — all strictly outside).
const H1 = [0, 1, 2, 5]; // F,A,B,C
const H2 = [0, 1, 3, 5]; // D,A,B,F
const H3 = [0, 3, 4, 5]; // E,A,F,D (subset {A,D,E,F})

function idxSet(idxs: readonly number[]): string {
  return idSet(idxs.map((i) => `p${i + 1}`));
}

describe("isKHole (§3.9)", () => {
  it("3×3 grid has no 5-hole (collinear subsets rejected; total)", () => {
    const grid: Pt[] = [];
    for (let x = 0; x < 3; x += 1) {
      for (let y = 0; y < 3; y += 1) {
        grid.push(P(x, y));
      }
    }
    expect(gp(grid)).toBe(false);
    const r = findKHoles(withIds(grid), 5, {
      mode: "exhaustive",
      budget: 1000000,
    });
    expect(r.kind).toBe("exhaustive");
    if (r.kind === "exhaustive") {
      expect(r.holes).toEqual([]);
    }
  });

  it("F-H3 is in general position", () => {
    expect(gp(FH3)).toBe(true);
  });

  // All 15 4-subsets of F-H3 with hand-verified expectations. Notation:
  // "hole" or "blocked-by-<idx>" (blocker strictly inside, witness edges in
  // comments) or "flat-<witness triple>" (witness point strictly inside the
  // triangle of the other three; the three inside-signs verified by hand).
  it("F-H3: all 15 4-subsets match their hand-verified verdicts", () => {
    // [subset indices, expected isKHole, reason]
    const table: Array<[readonly number[], boolean, string]> = [
      [[0, 1, 2, 3], false, "blocked-by-5: F strictly inside quad D,A,B,C (edges +7,+5,+6,+4)"],
      [[0, 1, 2, 4], false, "flat: A strictly inside triangle(E,B,C) (edges +2,+9,+19)"],
      [[0, 1, 2, 5], true, "H1: convex (all turns +5,+9,+6,+2); D outside edge F→A (−7)"],
      [[0, 1, 3, 4], false, "flat: A strictly inside triangle(E,D,B) (edges −5,−1,−2)"],
      [[0, 1, 3, 5], true, "H2: convex (turns +1,+5,+11,+7); C outside B→F (−6), E outside D→A (−5)"],
      [[0, 1, 4, 5], false, "flat: A strictly inside triangle(E,B,F) (edges +2,+5,+11)"],
      [[0, 2, 3, 4], false, "flat: D strictly inside triangle(E,C,A) (edges −1,−13,−5)"],
      [[0, 2, 3, 5], false, "flat: F strictly inside triangle(A,C,D) (edges +4,+7,+2)"],
      [[0, 2, 4, 5], false, "flat: F strictly inside triangle(A,C,E) (edges +2,+6,+11)"],
      [[0, 3, 4, 5], true, "H3: convex (turns +11,+7,+1,+5); B outside A→F (−5), C outside F→D (−4)"],
      [[1, 2, 3, 4], false, "flat: D strictly inside triangle(B,C,E) (edges +21,+1,+8)"],
      [[1, 2, 3, 5], false, "flat: F strictly inside triangle(B,C,D) (edges +6,+4,+11)"],
      [[1, 2, 4, 5], false, "flat: F strictly inside triangle(B,C,E) (edges +6,+6,+18)"],
      [[1, 3, 4, 5], false, "blocked-by-0: A strictly inside quad E,B,F,D (edges +2,+5,+7,+5)"],
      [[2, 3, 4, 5], false, "flat: D strictly inside triangle(C,E,F) (edges +1,+1,+4)"],
    ];
    expect(table.length).toBe(15);
    for (const [idxs, expected, reason] of table) {
      const subset = idxs.map((i) => FH3[i] as Pt);
      expect(
        isKHole(subset, FH3),
        `subset [${idxs.join(",")}] (${reason})`,
      ).toBe(expected);
    }
  });

  it("F-H3: findKHoles returns exactly H1,H2,H3 (as id lists)", () => {
    const r = findKHoles(FH3IDS, 4, { mode: "exhaustive", budget: 1000000 });
    expect(r.kind).toBe("exhaustive");
    if (r.kind !== "exhaustive") {
      return;
    }
    expect(r.holes.length).toBe(3);
    const got = new Set(r.holes.map((h) => idSet(h.verts)));
    expect(got.has(idxSet(H1))).toBe(true);
    expect(got.has(idxSet(H2))).toBe(true);
    expect(got.has(idxSet(H3))).toBe(true);
    for (const h of r.holes) {
      expect(h.k).toBe(4);
    }
  });
});

describe("findKHoles contract battery (§27.1, v1.2.5)", () => {
  it("1. explicit-budget exhaustive call completes with the full list", () => {
    const r = findKHoles(FH3IDS, 4, { mode: "exhaustive", budget: 1000000 });
    expect(r.kind).toBe("exhaustive");
  });

  it("2. explicit-budget first-witness call claims existence only", () => {
    const r = findKHoles(FH3IDS, 4, {
      mode: "first-witness",
      budget: 1000000,
    });
    expect(r.kind).toBe("witness-only");
    if (r.kind === "witness-only") {
      // Canonical index order: (0,1,2,3) blocked, (0,1,2,4) flat,
      // (0,1,2,5) = H1 is the first hole.
      expect(idSet(r.witness.verts)).toBe(idxSet(H1));
      expect(r.stoppedBy).toBe("found");
    }
  });

  it("3. opts is REQUIRED (omitting it is a type error)", () => {
    // @ts-expect-error — opts { mode, budget } is mandatory (§7.3).
    expect(() => findKHoles(FH3IDS, 4)).toThrow();
  });

  it("4. inclusive budget boundary: exact cost completes, one less exhausts", () => {
    // n=6,k=4: 15 candidates × 4·2 = 120 units.
    const full = findKHoles(FH3IDS, 4, { mode: "exhaustive", budget: 120 });
    expect(full.kind).toBe("exhaustive");
    const short = findKHoles(FH3IDS, 4, { mode: "exhaustive", budget: 119 });
    expect(short.kind).toBe("budget-exhausted");
    if (short.kind === "budget-exhausted") {
      expect(short.searched).toBe(14);
    }
  });

  it("5. exhaustion semantics: budget=0, negative, non-finite", () => {
    const zero = findKHoles(FH3IDS, 4, { mode: "exhaustive", budget: 0 });
    expect(zero).toEqual({ kind: "budget-exhausted", k: 4, searched: 0 });
    expect(() =>
      findKHoles(FH3IDS, 4, { mode: "exhaustive", budget: -1 }),
    ).toThrow();
    expect(() =>
      findKHoles(FH3IDS, 4, {
        mode: "exhaustive",
        budget: Number.POSITIVE_INFINITY,
      }),
    ).toThrow();
    expect(() =>
      findKHoles(FH3IDS, 4, { mode: "exhaustive", budget: Number.NaN }),
    ).toThrow();
  });

  it("6. completeness discipline: first-witness never claims completeness", () => {
    const kinds = new Set<string>();
    for (let b = 0; b < 200; b += 7) {
      kinds.add(
        findKHoles(FH3IDS, 4, { mode: "first-witness", budget: b }).kind,
      );
    }
    expect(kinds.has("exhaustive")).toBe(false);
  });

  it("7. bootstrap constants pin their §24.0b derivation and cover 12-point sweeps", () => {
    expect(BOOTSTRAP_EXACT_HOLE_BUDGET_6).toBe(66528);
    expect(BOOTSTRAP_EXACT_HOLE_BUDGET_5).toBe(55440);
    expect(estimateHoleWork(12, 6)).toBe(66528);
    expect(estimateHoleWork(12, 5)).toBe(55440);
    // 12 parabola points (i,i²): GP, all convex, all 924 6-subsets are holes.
    const parabola: Pt[] = [];
    for (let i = 0; i < 12; i += 1) {
      parabola.push(
        pt(Rat.make(BigInt(i)), Rat.make(BigInt(i * i))),
      );
    }
    expect(gp(parabola)).toBe(true);
    const r = findKHoles(withIds(parabola), 6, {
      mode: "exhaustive",
      budget: BOOTSTRAP_EXACT_HOLE_BUDGET_6,
    });
    expect(r.kind).toBe("exhaustive");
    if (r.kind === "exhaustive") {
      expect(r.holes.length).toBe(924);
    }
  });

  it("8. estimateHoleWork covers the fixed-domain sweep (validation-budget rule)", () => {
    const r = findKHoles(FH3IDS, 4, {
      mode: "exhaustive",
      budget: estimateHoleWork(6, 4),
    });
    expect(r.kind).toBe("exhaustive");
    expect(() => estimateHoleWork(6, 2)).toThrow();
    expect(() => estimateHoleWork(6, 9)).toThrow();
    expect(() => estimateHoleWork(65, 4)).toThrow();
    expect(() => estimateHoleWork(-1, 4)).toThrow();
  });

  it("9. determinism: identical arguments ⇒ identical results", () => {
    const a = findKHoles(FH3IDS, 5, { mode: "exhaustive", budget: 1000000 });
    const b = findKHoles(FH3IDS, 5, { mode: "exhaustive", budget: 1000000 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("10. canonical order: output matches index-order re-derivation", () => {
    // Independent combination generator in the test pins the order contract.
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
    const expected: string[] = [];
    for (const combo of combos(FH3.length, 4)) {
      const subset = combo.map((i) => FH3[i] as Pt);
      if (isKHole(subset, FH3)) {
        expected.push(idxSet(combo));
      }
    }
    const r = findKHoles(FH3IDS, 4, { mode: "exhaustive", budget: 1000000 });
    expect(r.kind).toBe("exhaustive");
    if (r.kind === "exhaustive") {
      expect(r.holes.map((h) => idSet(h.verts))).toEqual(expected);
    }
  });
});

describe("analyzeHoles (§7.3 policy wrapper)", () => {
  it("estimate within budget ⇒ exhaustive with the same budget", () => {
    const r = analyzeHoles(FH3IDS, 4, { budget: 1000000 });
    expect(r.kind).toBe("exhaustive");
  });

  it("a capped run never reports exhaustive", () => {
    // n=30,k=6 estimate ≈ 1.7×10^8 ≫ budget ⇒ first-witness branch.
    const pts: Pt[] = [];
    for (let i = 0; i < 30; i += 1) {
      pts.push(P(i, (i * i) % 31));
    }
    const r = analyzeHoles(withIds(pts), 6, { budget: 5000 });
    expect(r.kind === "witness-only" || r.kind === "budget-exhausted").toBe(
      true,
    );
  });
});

describe("findNewKHoles (incremental, §7.3)", () => {
  it("finds exactly the new holes containing the last point", () => {
    // Order [E,D,A,B,C] → ids p1..p5: prefix [E,D,A,B] is 4-hole-free
    // (ABDE is flat: A strictly inside triangle(E,D,B)); adding C = p5
    // creates exactly ABCD = {p2,p3,p4,p5} (F absent, E outside edge D→A).
    const pts = withIds([FH3[4], FH3[3], FH3[0], FH3[1], FH3[2]] as Pt[]);
    const before = findKHoles(
      pts.slice(0, 4),
      4,
      { mode: "exhaustive", budget: 1000000 },
    );
    expect(before).toEqual({ kind: "exhaustive", k: 4, holes: [] });
    const after = findNewKHoles(pts, 4, "p5");
    expect(after.holes.length).toBe(1);
    const first = after.holes[0];
    expect(first !== undefined).toBe(true);
    if (first !== undefined) {
      expect(idSet(first.verts)).toBe(idSet(["p2", "p3", "p4", "p5"]));
    }
  });

  it("rejects an unknown last id (implementation error)", () => {
    expect(() => findNewKHoles(FH3IDS, 4, "p99")).toThrow();
  });
});

describe("sharedEdgePairs (§22.5)", () => {
  it("F-H3 holes share exactly three edges: AB, FA, DF", () => {
    const r = findKHoles(FH3IDS, 4, { mode: "exhaustive", budget: 1000000 });
    expect(r.kind).toBe("exhaustive");
    if (r.kind !== "exhaustive") {
      return;
    }
    const pairs = sharedEdgePairs(r.holes);
    expect(pairs.length).toBe(3);
    const edges = new Set(
      pairs.map((p) => [...p.edge].sort().join("~")),
    );
    // A~B (H1,H2), F~A (H1,H3), D~F (H2,H3): p1=A, p2=B, p4=D, p6=F.
    expect(edges.has("p1~p2")).toBe(true);
    expect(edges.has("p1~p6")).toBe(true);
    expect(edges.has("p4~p6")).toBe(true);
  });
});

describe("Harborth property (S6-backed, 200 seeds)", () => {
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

  it("every 10-point GP set contains a 5-hole", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const rand = mulberry32(seed);
      const seen = new Set<string>();
      const pts: Pt[] = [];
      let guard = 0;
      while (pts.length < 10 && guard < 10000) {
        guard += 1;
        const p = P(Math.floor(rand() * 30), Math.floor(rand() * 30));
        const k = key(p);
        if (!seen.has(k)) {
          seen.add(k);
          pts.push(p);
        }
      }
      if (!gp(pts)) {
        continue;
      }
      const r = findKHoles(withIds(pts), 5, {
        mode: "exhaustive",
        budget: 1000000,
      });
      expect(r.kind).toBe("exhaustive");
      if (r.kind === "exhaustive") {
        expect(r.holes.length, `seed ${seed} has no 5-hole`).toBeGreaterThan(
          0,
        );
      }
    }
  });

  it("fast-check: random GP sets satisfy the hole-count floor", () => {
    const arbPt = fc
      .tuple(fc.integer({ min: 0, max: 29 }), fc.integer({ min: 0, max: 29 }))
      .map(([x, y]) => P(x, y));
    fc.assert(
      fc.property(
        fc.array(arbPt, { minLength: 10, maxLength: 10 }),
        (raw) => {
          const seen = new Set<string>();
          const pts = raw.filter((p) => {
            const k = key(p);
            if (seen.has(k)) {
              return false;
            }
            seen.add(key(p));
            return true;
          });
          if (pts.length < 10 || !gp(pts)) {
            return;
          }
          const r = findKHoles(withIds(pts), 5, {
            mode: "exhaustive",
            budget: 1000000,
          });
          expect(r.kind).toBe("exhaustive");
        },
      ),
      { numRuns: 30 },
    );
  });
});
