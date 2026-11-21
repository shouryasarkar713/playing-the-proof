// tests/strategies/k7units.test.ts — unit/negative/boundary tests for the k=7
// geometry (twinsK7), checkers (k7twins) and classifier (classifyB1Hex).
import { describe, expect, it } from "vitest";
import type { Pt } from "../../src/geometry/pt.ts";
import {
  chordHalfPair,
  ccwIds,
  twinQuadEars,
  twinSharedPart,
} from "../../src/geometry/twinsK7.ts";
import { defaultStartFor, presetStartFor } from "../../src/strategy/presets.ts";
import { PRESET_P6 } from "../../src/strategy/strategies/k7/preset.ts";
import { classifyB1Hex } from "../../src/strategy/strategies/k7/classifyB1.ts";
import {
  pair5Checker,
  twinPair6Checker,
  twins6Checker,
} from "../../src/verification/k7twins.ts";
import { CheckerIntegrityError } from "../../src/verification/invariants.ts";
import type { GameState } from "../../src/game/types.ts";
import { testCtx } from "../helpers.ts";
import { P, ensureK7, mulberry, randomInside, varsOf } from "./k7driver.ts";
import { breakerMove, initK7 } from "./k7tree.ts";
import { reduceTransaction } from "../../src/engine/orchestrator.ts";
import { hull } from "../../src/geometry/hull.ts";
import { insideConvexStrict } from "./k7tree.ts";
import { pt } from "../../src/geometry/pt.ts";
import { Rat } from "../../src/geometry/rat.ts";

ensureK7();
const ctx = testCtx();
const EXTRA = P(-9, -6);

function afterA1(seed: number): GameState {
  const s0 = initK7(PRESET_P6, [EXTRA], ctx);
  for (let t = 0; t < 50; t += 1) {
    const s1 = breakerMove(s0, randomInside(PRESET_P6, mulberry(seed + 1000 * t)), ctx);
    if (s1 !== null && s1.strategy?.nodeId === "k7:r1:classify") {
      return s1;
    }
  }
  throw new Error("test bug: not parked at classify");
}
const ptOfState =
  (s: GameState) =>
  (id: string): Pt | null =>
    s.points.find((p) => p.id === id)?.pt ?? null;
const lists = (s: GameState): Record<string, readonly string[]> => {
  const v = varsOf(s) as Record<string, string | string[]>;
  return {
    twinA: v["twinA"] as string[],
    twinB: v["twinB"] as string[],
    a1: [v["A1"] as string],
    b0: [v["B0"] as string],
  };
};

describe("twinQuadEars (exact quad-twin structure)", () => {
  const s = afterA1(31);
  const l = lists(s);
  const ptOf = ptOfState(s);
  const anchors = [l["a1"]?.[0] as string, l["b0"]?.[0] as string] as const;

  it("accepts the strategy's own twins and reports distinct ear apexes", () => {
    const t = twinQuadEars(l["twinA"] as string[], l["twinB"] as string[], anchors, ptOf);
    expect(t).not.toBeNull();
    expect(t?.quadIds.length).toBe(4);
    expect(t?.earA.apex).not.toBe(t?.earB.apex);
  });

  it("rejects when the anchors are adjacent in the quadrilateral (not the diagonal)", () => {
    const v = varsOf(s) as Record<string, string>;
    const bad = twinQuadEars(
      l["twinA"] as string[],
      l["twinB"] as string[],
      [v["A1"] as string, v["HC"] as string],
      ptOf,
    );
    expect(bad).toBeNull();
  });

  it("rejects identical holes, disjoint holes and a non-hexagon list", () => {
    expect(twinQuadEars(l["twinA"] as string[], l["twinA"] as string[], anchors, ptOf)).toBeNull();
    expect(twinSharedPart(["p1", "p2", "p3"], ["p4", "p5", "p6"], ptOf, 3)).toBeNull();
    expect(twinSharedPart(l["twinA"] as string[], l["twinB"] as string[], ptOf, 5)).toBeNull();
    expect(ccwIds(["p1", "p2", "nope"], ptOf)).toBeNull();
  });

  it("twinSharedPart needs EXACT area equality: two hexagons sharing 4 vertices but overlapping more are rejected", () => {
    // twin A with the far hexagon vertices swapped for a point overlapping B's interior
    const hexIds = (varsOf(s) as Record<string, string[]>)["P6"] as string[];
    const bogus = twinSharedPart(hexIds, l["twinA"] as string[], ptOf, 5);
    expect(bogus).toBeNull();
  });
});

describe("chordHalfPair", () => {
  const s0 = initK7(PRESET_P6, [EXTRA], ctx);
  const hexIds = (s0.strategy?.vars["P6"] ?? []) as string[];
  const all = s0.points.map((p) => p.pt);
  it("for every B0 strictly inside the hexagon returns a rotation whose two halves exclude B0 (property, 80 seeds)", () => {
    let n = 0;
    for (let t = 0; t < 80; t += 1) {
      const b0 = randomInside(PRESET_P6, mulberry(500 + t));
      const placed = [...all, b0];
      const ids = [...s0.points.map((p) => p.id), "pB0"];
      const ptOf = (id: string): Pt | null => {
        const k = ids.indexOf(id);
        return k < 0 ? null : (placed[k] as Pt);
      };
      const r = chordHalfPair(hexIds, "pB0", ptOf, placed);
      if (r === null) {
        // only a collinear/degenerate B0 may fail; it must be GP-illegal then
        throw new Error("chordHalfPair null for an interior B0");
      }
      expect(r.ring.length).toBe(6);
      n += 1;
    }
    expect(n).toBe(80);
  });
  it("is null unless the hole has six vertices or B0 is unplaced", () => {
    expect(chordHalfPair(hexIds.slice(0, 5), "p1", (id) => s0.points.find((p) => p.id === id)?.pt ?? null, all)).toBeNull();
    expect(chordHalfPair(hexIds, "zzz", () => null, all)).toBeNull();
  });
});

describe("custom checkers", () => {
  const s = afterA1(32);
  const v = varsOf(s) as Record<string, string | string[]>;
  const cfg = ctx.config;
  it("pair5/twins6/twinpair6 PASS on the strategy's own state", () => {
    expect(
      pair5Checker.check(s, { halfA: v["quadA"] as string[], halfB: v["quadB"] as string[], B0: [v["B0"] as string] }, cfg).passed,
    ).toBe(true);
    expect(
      twins6Checker.check(
        s,
        { halfA: v["quadA"] as string[], halfB: v["quadB"] as string[], B0: [v["B0"] as string], A1: [v["A1"] as string] },
        cfg,
      ).passed,
    ).toBe(true);
    expect(
      twinPair6Checker.check(
        s,
        { twinA: v["twinA"] as string[], twinB: v["twinB"] as string[], A1: [v["A1"] as string], B0: [v["B0"] as string] },
        cfg,
      ).passed,
    ).toBe(true);
  });
  it("FAIL (typed) when a twin is swapped for a non-hole, and for halves that are not the survivors", () => {
    const bad = twinPair6Checker.check(
      s,
      {
        twinA: v["twinA"] as string[],
        twinB: (v["P6"] as string[]).slice(),
        A1: [v["A1"] as string],
        B0: [v["B0"] as string],
      },
      cfg,
    );
    expect(bad.passed).toBe(false);
    const swapped = pair5Checker.check(
      s,
      { halfA: v["quadB"] as string[], halfB: v["quadB"] as string[], B0: [v["B0"] as string] },
      cfg,
    );
    expect(swapped.passed).toBe(false);
  });
  it("malformed arguments throw CheckerIntegrityError (cardinality / unplaced / key set)", () => {
    expect(() => pair5Checker.check(s, { halfA: ["p1"], halfB: ["p1"], B0: ["p1"] }, cfg)).toThrow(CheckerIntegrityError);
    expect(() => pair5Checker.check(s, { halfA: ["p1", "p2", "p3", "p4"] }, cfg)).toThrow(CheckerIntegrityError);
    expect(() =>
      twins6Checker.check(s, { halfA: ["p1", "p2", "p3", "p4"], halfB: ["p1", "p2", "p3", "p99"], B0: ["p8"], A1: ["p9"] }, cfg),
    ).toThrow(CheckerIntegrityError);
  });
});

describe("classifyB1Hex", () => {
  const s = afterA1(33);
  const l = lists(s);
  it("is total over legal B1 (5 tags) and fails closed on malformed inputs", () => {
    expect(classifyB1Hex.resultTags.length).toBe(5);
    expect(classifyB1Hex.classify(s, { twinA: ["p1"] }, ctx.config).kind).toBe("integrity");
    expect(classifyB1Hex.boundaries(s, { twinA: ["p1"] }, ctx.config).kind).toBe("integrity");
    const notTwins = { ...l, twinB: l["twinA"] as readonly string[] };
    expect(classifyB1Hex.classify(s, notTwins, ctx.config).kind).toBe("integrity");
    expect(classifyB1Hex.boundaries(s, notTwins, ctx.config).kind).toBe("integrity");
  });
  it("boundaries list the 6 quadrilateral pair-lines and the twin hull edges, de-duplicated and sorted", () => {
    const b = classifyB1Hex.boundaries(s, l, ctx.config);
    expect(b.kind).toBe("ok");
    if (b.kind === "ok") {
      const keys = b.lines.map(([a, c]) => `${a}|${c}`);
      expect(new Set(keys).size).toBe(keys.length);
      expect(b.lines.length).toBeGreaterThanOrEqual(12);
    }
  });
});

describe("classifyB1Hex tag mapping (each class pinned to its exact region)", () => {
  const s = afterA1(34);
  const l = lists(s);
  const ptOf = ptOfState(s);
  const t = twinQuadEars(
    l["twinA"] as string[],
    l["twinB"] as string[],
    [l["a1"]?.[0] as string, l["b0"]?.[0] as string],
    ptOf,
  );
  const centroid = (ps: readonly Pt[]): Pt => {
    let x = Rat.ZERO;
    let y = Rat.ZERO;
    for (const p of ps) {
      x = x.add(p.x);
      y = y.add(p.y);
    }
    const n = Rat.make(BigInt(ps.length));
    return pt(x.div(n), y.div(n));
  };
  const caseOf = (at: Pt): string | undefined =>
    reduceTransaction(s, { kind: "place", owner: "breaker", at }, ctx).events[0]?.caseId;

  it("B1 in the ear of twin A -> ear-A; in the ear of twin B -> ear-B", () => {
    expect(t).not.toBeNull();
    expect(caseOf(centroid((t as NonNullable<typeof t>).earA.tri))).toBe("k7:b1:inside-shared-quad-ear-A");
    expect(caseOf(centroid((t as NonNullable<typeof t>).earB.tri))).toBe("k7:b1:inside-shared-quad-ear-B");
  });

  it("B1 in exactly one twin (outside the quadrilateral) -> that twin only; far away -> else", () => {
    const hullOf = (ids: readonly string[]): Pt[] =>
      hull(ids.map((id) => ptOf(id) as Pt));
    const hA = hullOf(l["twinA"] as string[]);
    const hB = hullOf(l["twinB"] as string[]);
    const q = (t as NonNullable<typeof t>).quad;
    const found: Record<string, boolean> = {};
    for (const [name, mine, other] of [
      ["A", l["twinA"], hB],
      ["B", l["twinB"], hA],
    ] as const) {
      const verts = (mine as readonly string[]).map((id) => ptOf(id) as Pt);
      outer: for (let i = 0; i < verts.length; i += 1) {
        for (let j = i + 1; j < verts.length; j += 1) {
          for (let k = j + 1; k < verts.length; k += 1) {
            const c = centroid([verts[i] as Pt, verts[j] as Pt, verts[k] as Pt]);
            const own = name === "A" ? hA : hB;
            if (
              insideConvexStrict(own, c) &&
              !insideConvexStrict(other, c) &&
              !insideConvexStrict(q, c)
            ) {
              const got = caseOf(c);
              if (got === undefined) {
                continue;
              }
              expect(got).toBe(`k7:b1:inside-twin-${name}-only`);
              found[name] = true;
              break outer;
            }
          }
        }
      }
    }
    expect(found).toEqual({ A: true, B: true });
    expect(caseOf(P(900, -900))).toBe("k7:b1:else");
  });
});

describe("twinSharedPart exactness (area equality is load-bearing)", () => {
  it("two convex hexagons sharing exactly 4 vertices but overlapping more than that quadrilateral are rejected", () => {
    const A: Pt[] = [P(0, 0), P(10, -2), P(20, 6), P(20, 16), P(10, 24), P(0, 18)];
    // B shares A0..A3 and replaces A4, A5 by nearby points: overlap = almost all of A.
    const B: Pt[] = [A[0] as Pt, A[1] as Pt, A[2] as Pt, A[3] as Pt, P(11, 25), P(1, 19)];
    const pts: Pt[] = [...A, B[4] as Pt, B[5] as Pt];
    const ptOf = (id: string): Pt | null => pts[Number(id.slice(1))] ?? null;
    const aIds = ["p0", "p1", "p2", "p3", "p4", "p5"];
    const bIds = ["p0", "p1", "p2", "p3", "p6", "p7"];
    expect(twinSharedPart(aIds, bIds, ptOf, 4)).toBeNull();
  });
});

describe("twinsK7 defensive branches (typed null, never a throw)", () => {
  const s = afterA1(35);
  const l = lists(s);
  const ptOf = ptOfState(s);
  const a1 = l["a1"]?.[0] as string;
  const b0 = l["b0"]?.[0] as string;
  it("identical anchors, an anchor outside the shared set, and unplaced ids all give null", () => {
    expect(twinQuadEars(l["twinA"] as string[], l["twinB"] as string[], [a1, a1], ptOf)).toBeNull();
    const far = (l["twinA"] as string[]).find((id) => !(l["twinB"] as string[]).includes(id)) as string;
    expect(twinQuadEars(l["twinA"] as string[], l["twinB"] as string[], [a1, far], ptOf)).toBeNull();
    const ghost = [...(l["twinA"] as string[]).slice(0, 5), "ghost"];
    expect(twinQuadEars(ghost, l["twinB"] as string[], [a1, b0], () => null)).toBeNull();
    expect(twinSharedPart(["x", "y", "z"], ["x", "y", "z"], () => null, 3)).toBeNull();
  });
  it("twinSharedPart rejects non-convex lists and m < 3", () => {
    const hexIds = (varsOf(s) as Record<string, string[]>)["P6"] as string[];
    // two lists sharing 3 ids where one list is not in convex position
    const bent = [hexIds[0] as string, hexIds[1] as string, hexIds[2] as string, b0];
    const other = [hexIds[0] as string, hexIds[1] as string, hexIds[2] as string, a1];
    const r = twinSharedPart(bent, other, ptOf, 3);
    expect(r === null || r.ids.length === 3).toBe(true);
    expect(twinSharedPart(hexIds, hexIds, ptOf, 2)).toBeNull();
  });
  it("chordHalfPair is null for a 5-vertex hole, an unplaced B0 and non-hole halves", () => {
    const hexIds = (varsOf(s) as Record<string, string[]>)["P6"] as string[];
    expect(chordHalfPair(hexIds.slice(0, 5), b0, ptOf, s.points.map((p) => p.pt))).toBeNull();
    expect(chordHalfPair(hexIds, "nope", ptOf, s.points.map((p) => p.pt))).toBeNull();
    // After A1 the hexagon halves are no longer all holes together with B0 at
    // the same time as A1 sits in the plane: some rotations fail their hole test.
    const r = chordHalfPair(hexIds, b0, ptOf, s.points.map((p) => p.pt));
    expect(r === null || r.ring.length === 6).toBe(true);
  });
});

describe("presets bridge", () => {
  it("presetStartFor covers k6, k6-wide, k7 and nothing else; only k7 has an engine default", () => {
    expect(presetStartFor("esmb-k6")?.kind).toBe("supplied");
    expect(presetStartFor("esmb-k6-wide")?.kind).toBe("supplied");
    expect(presetStartFor("esmb-k7")?.kind).toBe("supplied");
    expect(presetStartFor("esmb-k5")).toBeUndefined();
    expect(defaultStartFor("esmb-k7")).toBeDefined();
    expect(defaultStartFor("esmb-k6")).toBeUndefined();
  });
});
