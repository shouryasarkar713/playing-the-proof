// tests/game/gamemode.test.ts — the bichromatic winning-hole rule (a hole is
// a convex k-subset of MAKER's points whose hull holds no point of ANY
// colour; Breaker's points are blockers only). Includes an independent
// brute-force oracle (integer arithmetic, Caratheodory triangle test) and
// property tests over random owner-coloured point sets.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Rat } from "../../src/geometry/rat.ts";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { gp } from "../../src/geometry/predicates.ts";
import {
  estimateHoleWork,
  findKHoles,
  findNewKHoles,
} from "../../src/geometry/holes.ts";
import type { IdPt, KHole } from "../../src/geometry/holes.ts";
import {
  estimateHoleWorkAmong,
  findKHolesAmong,
  findNewKHolesAmong,
  isHoleAmong,
} from "../../src/geometry/ownedholes.ts";
import {
  analyzeWinHoles,
  checkTerminalWitness,
  checkWinningHole,
  eligibleVertex,
  findNewWinHoles,
  findWinHoles,
  gameModeOf,
  isBichromatic,
  isGameMode,
  isWinningHole,
  mayBeHoleVertex,
  vertexEligibleIds,
} from "../../src/game/gamemode.ts";
import { canonicalStateString, stateHash } from "../../src/game/hash.ts";
import { checkStateInvariants } from "../../src/game/place.ts";
import type { GameState, Player } from "../../src/game/types.ts";

function P(x: number, y: number): Pt {
  return pt(Rat.make(BigInt(x)), Rat.make(BigInt(y)));
}

function stateOf(
  pts: ReadonlyArray<readonly [number, number, Player]>,
  k: 3 | 4 | 5 | 6 | 7 | 8,
  gameMode?: "bichromatic",
): GameState {
  return {
    seq: 0,
    k,
    mode: "sandbox",
    ...(gameMode !== undefined ? { gameMode } : {}),
    points: pts.map(([x, y, owner], i) => ({
      id: `p${i + 1}`,
      owner,
      pt: P(x, y),
      move: i + 1,
    })),
    turn: pts.length % 2 === 0 ? "maker" : "breaker",
    terminal: null,
    strategy: null,
  };
}

const BUDGET = 1e12;

function idPts(s: GameState): IdPt[] {
  return s.points.map((p) => ({ id: p.id, pt: p.pt }));
}

function sortedKeys(holes: readonly KHole[]): string[] {
  return holes.map((h) => [...h.verts].sort().join("|")).sort();
}

// ---- independent oracle (integers only; no shared code with src/) ----

type IPt = readonly [number, number];

function cross(a: IPt, b: IPt, c: IPt): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function strictlyInside(q: IPt, a: IPt, b: IPt, c: IPt): boolean {
  const d1 = cross(a, b, q);
  const d2 = cross(b, c, q);
  const d3 = cross(c, a, q);
  return (d1 > 0 && d2 > 0 && d3 > 0) || (d1 < 0 && d2 < 0 && d3 < 0);
}

// In general position: S is a k-hole of `all` iff no point of `all` outside
// a triple lies strictly inside the triangle of any three points of S
// (convex position + emptiness together, by Caratheodory).
function oracleIsHole(sub: readonly number[], all: readonly IPt[]): boolean {
  for (let i = 0; i < sub.length; i += 1) {
    for (let j = i + 1; j < sub.length; j += 1) {
      for (let l = j + 1; l < sub.length; l += 1) {
        const a = all[sub[i] as number] as IPt;
        const b = all[sub[j] as number] as IPt;
        const c = all[sub[l] as number] as IPt;
        for (let q = 0; q < all.length; q += 1) {
          if (q === sub[i] || q === sub[j] || q === sub[l]) {
            continue;
          }
          if (strictlyInside(all[q] as IPt, a, b, c)) {
            return false;
          }
        }
      }
    }
  }
  return true;
}

function subsetsOf(items: readonly number[], k: number): number[][] {
  const out: number[][] = [];
  const rec = (start: number, acc: number[]): void => {
    if (acc.length === k) {
      out.push([...acc]);
      return;
    }
    for (let i = start; i < items.length; i += 1) {
      acc.push(items[i] as number);
      rec(i + 1, acc);
      acc.pop();
    }
  };
  rec(0, []);
  return out;
}

function oracleHoles(
  all: readonly IPt[],
  eligible: readonly number[],
  k: number,
): string[] {
  return subsetsOf(eligible, k)
    .filter((s) => oracleIsHole(s, all))
    .map((s) => s.map((i) => `p${i + 1}`).sort().join("|"))
    .sort();
}

describe("game mode flag", () => {
  it("absent means monochromatic; only the literal bichromatic flips it", () => {
    expect(gameModeOf({})).toBe("monochromatic");
    expect(gameModeOf({ gameMode: "bichromatic" })).toBe("bichromatic");
    expect(isBichromatic({})).toBe(false);
    expect(isBichromatic({ gameMode: "bichromatic" })).toBe(true);
    expect(isGameMode("bichromatic")).toBe(true);
    expect(isGameMode("monochromatic")).toBe(true);
    expect(isGameMode("bi")).toBe(false);
    expect(isGameMode(undefined)).toBe(false);
  });

  it("mayBeHoleVertex: Breaker is a vertex only monochromatically", () => {
    expect(mayBeHoleVertex("monochromatic", "maker")).toBe(true);
    expect(mayBeHoleVertex("monochromatic", "breaker")).toBe(true);
    expect(mayBeHoleVertex("bichromatic", "maker")).toBe(true);
    expect(mayBeHoleVertex("bichromatic", "breaker")).toBe(false);
  });
});

describe("hand-checked fixtures", () => {
  // Maker triangle (0,0),(10,0),(5,10); Breaker blocker inside.
  const inside: ReadonlyArray<readonly [number, number, Player]> = [
    [0, 0, "maker"],
    [5, 3, "breaker"],
    [10, 0, "maker"],
    [4, 20, "breaker"],
    [5, 10, "maker"],
  ];

  it("Breaker point inside the Maker triangle: monochromatic wins, bichromatic does not", () => {
    // p4 is outside everything relevant; p2 blocks the Maker triangle p1,p3,p5.
    const mono = stateOf(inside, 3);
    const bi = stateOf(inside, 3, "bichromatic");
    const monoHoles = findWinHoles(mono, 3, { mode: "exhaustive", budget: BUDGET });
    const biHoles = findWinHoles(bi, 3, { mode: "exhaustive", budget: BUDGET });
    expect(monoHoles.kind).toBe("exhaustive");
    expect(biHoles.kind).toBe("exhaustive");
    // The only all-Maker triple is {p1,p3,p5}; p2 sits inside it.
    if (biHoles.kind === "exhaustive") {
      expect(biHoles.holes).toEqual([]);
    }
    if (monoHoles.kind === "exhaustive") {
      expect(monoHoles.holes.length).toBeGreaterThan(0);
    }
  });

  it("an empty Maker triangle is a bichromatic hole even with Breaker points outside", () => {
    const s = stateOf(
      [
        [0, 0, "maker"],
        [30, 1, "breaker"],
        [10, 0, "maker"],
        [-20, 7, "breaker"],
        [5, 10, "maker"],
      ],
      3,
      "bichromatic",
    );
    const r = findWinHoles(s, 3, { mode: "exhaustive", budget: BUDGET });
    expect(r.kind).toBe("exhaustive");
    if (r.kind === "exhaustive") {
      expect(sortedKeys(r.holes)).toEqual(["p1|p3|p5"]);
    }
  });

  it("Breaker point as the only way to complete a hole: not a win bichromatically", () => {
    // Monochromatic k=4: Maker p1,p3,p5 plus Breaker p2 form a convex empty
    // quadrilateral; bichromatically only 3 Maker points exist.
    const s = [
      [0, 0, "maker"],
      [12, 1, "breaker"],
      [10, 10, "maker"],
      [-3, 9, "breaker"],
      [1, 11, "maker"],
    ] as const;
    const mono = findWinHoles(stateOf(s, 4), 4, { mode: "exhaustive", budget: BUDGET });
    const bi = findWinHoles(stateOf(s, 4, "bichromatic"), 4, {
      mode: "exhaustive",
      budget: BUDGET,
    });
    expect(mono.kind).toBe("exhaustive");
    expect(bi.kind).toBe("exhaustive");
    if (mono.kind === "exhaustive" && bi.kind === "exhaustive") {
      expect(mono.holes.length).toBeGreaterThan(0);
      expect(bi.holes).toEqual([]);
    }
  });

  it("monochromatic delegation is exactly findKHoles / findNewKHoles", () => {
    const s = stateOf(inside, 3);
    expect(findWinHoles(s, 3, { mode: "exhaustive", budget: BUDGET })).toEqual(
      findKHoles(idPts(s), 3, { mode: "exhaustive", budget: BUDGET }),
    );
    expect(findNewWinHoles(s, 3, "p5")).toEqual(findNewKHoles(idPts(s), 3, "p5"));
  });

  it("eligibleVertex / vertexEligibleIds follow ownership", () => {
    const s = stateOf(inside, 3, "bichromatic");
    expect(vertexEligibleIds(s)).toEqual(["p1", "p3", "p5"]);
    const ok = eligibleVertex(s);
    expect(ok("p1")).toBe(true);
    expect(ok("p2")).toBe(false);
    const mono = stateOf(inside, 3);
    expect(vertexEligibleIds(mono)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
  });

  it("budget exhaustion is never reported as 'no holes'", () => {
    const s = stateOf(inside, 3, "bichromatic");
    const r = findWinHoles(s, 3, { mode: "exhaustive", budget: 0 });
    expect(r.kind).toBe("budget-exhausted");
    const a = analyzeWinHoles(s, 3, { budget: 0 });
    expect(a.kind).toBe("budget-exhausted");
  });

  it("analyzeWinHoles: exhaustive when within budget, first-witness otherwise", () => {
    const s = stateOf(
      [
        [0, 0, "maker"],
        [30, 1, "breaker"],
        [10, 0, "maker"],
        [-20, 7, "breaker"],
        [5, 10, "maker"],
      ],
      3,
      "bichromatic",
    );
    const big = analyzeWinHoles(s, 3, { budget: BUDGET });
    expect(big.kind).toBe("exhaustive");
    // estimate = 2*C(3,3)*3*(5-3) = 12; budget 11 < 12 but >= one candidate (6).
    const small = analyzeWinHoles(s, 3, { budget: 11 });
    expect(small.kind).toBe("witness-only");
  });

  it("analyzeHolesAmong rejects a bad budget", () => {
    const s = stateOf(inside, 3, "bichromatic");
    expect(() => analyzeWinHoles(s, 3, { budget: -1 })).toThrow();
    expect(() =>
      findKHolesAmong(idPts(s), () => true, 3, { mode: "exhaustive", budget: Number.NaN }),
    ).toThrow();
  });

  it("findNewKHolesAmong: ineligible `last` is a vertex of no hole; unknown id throws", () => {
    const s = stateOf(inside, 3, "bichromatic");
    expect(findNewWinHoles(s, 3, "p2")).toEqual({ holes: [] });
    expect(() => findNewWinHoles(s, 3, "nope")).toThrow();
    // not enough eligible partners
    expect(findNewKHolesAmong(idPts(s), eligibleVertex(s), 6, "p1")).toEqual({
      holes: [],
    });
  });

  it("findKHolesAmong: fewer eligible points than k is a complete empty answer", () => {
    const s = stateOf(inside, 3, "bichromatic");
    expect(findWinHoles(s, 4, { mode: "first-witness", budget: BUDGET })).toEqual({
      kind: "exhaustive",
      k: 4,
      holes: [],
    });
  });

  it("first-witness stops at the first hole", () => {
    const s = stateOf(
      [
        [0, 0, "maker"],
        [30, 1, "breaker"],
        [10, 0, "maker"],
        [-20, 7, "breaker"],
        [5, 10, "maker"],
      ],
      3,
      "bichromatic",
    );
    const r = findWinHoles(s, 3, { mode: "first-witness", budget: BUDGET });
    expect(r.kind).toBe("witness-only");
  });
});

describe("estimateHoleWorkAmong", () => {
  it("equals estimateHoleWork when every point is eligible", () => {
    for (const n of [0, 3, 8, 20]) {
      for (const k of [3, 5, 8]) {
        expect(estimateHoleWorkAmong(n, n, k)).toBe(estimateHoleWork(n, k));
      }
    }
  });
  it("is zero when fewer than k points are eligible and monotone in m", () => {
    expect(estimateHoleWorkAmong(10, 2, 3)).toBe(0);
    expect(estimateHoleWorkAmong(10, 6, 4)).toBeLessThan(estimateHoleWorkAmong(10, 7, 4));
  });
  it("out-of-domain is a typed assert throw", () => {
    expect(() => estimateHoleWorkAmong(10, 11, 3)).toThrow();
    expect(() => estimateHoleWorkAmong(65, 3, 3)).toThrow();
    expect(() => estimateHoleWorkAmong(10, 3, 2)).toThrow();
    expect(() => estimateHoleWorkAmong(10, 3, 9)).toThrow();
    expect(() => estimateHoleWorkAmong(10, -1, 4)).toThrow();
    expect(() => estimateHoleWorkAmong(10.5, 3, 4)).toThrow();
  });
});

describe("checkWinningHole (typed)", () => {
  const s = stateOf(
    [
      [0, 0, "maker"],
      [30, 1, "breaker"],
      [10, 0, "maker"],
      [-20, 7, "breaker"],
      [5, 10, "maker"],
    ],
    3,
    "bichromatic",
  );
  const mono = stateOf(
    [
      [0, 0, "maker"],
      [30, 1, "breaker"],
      [10, 0, "maker"],
      [-20, 7, "breaker"],
      [5, 10, "maker"],
    ],
    3,
  );

  it("accepts a Maker-only empty hole", () => {
    expect(checkWinningHole(s, { k: 3, verts: ["p1", "p3", "p5"] })).toEqual({ ok: true });
    expect(isWinningHole(s, { k: 3, verts: ["p1", "p3", "p5"] })).toBe(true);
  });

  it("rejects a Breaker vertex bichromatically, accepts monochromatically", () => {
    const hole = { k: 3, verts: ["p1", "p2", "p3"] };
    const r = checkWinningHole(s, hole);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("breaker-vertex");
    }
    // Monochromatic: p1,p2,p3 is legitimately a hole iff geometry says so.
    const m = checkWinningHole(mono, hole);
    expect(m.ok === true || (m.ok === false && m.reason === "not-a-hole")).toBe(true);
    expect(m.ok === false && m.reason === "breaker-vertex").toBe(false);
  });

  it("rejects wrong size, unknown point, duplicate vertex, non-hole", () => {
    expect(checkWinningHole(s, { k: 4, verts: ["p1", "p3", "p5", "p2"] })).toMatchObject({
      ok: false,
      reason: "wrong-size",
    });
    expect(checkWinningHole(s, { k: 3, verts: ["p1", "p3"] })).toMatchObject({
      ok: false,
      reason: "wrong-size",
    });
    expect(checkWinningHole(s, { k: 3, verts: ["p1", "p3", "p9"] })).toMatchObject({
      ok: false,
      reason: "unknown-point",
    });
    expect(checkWinningHole(s, { k: 3, verts: ["p1", "p3", "p3"] })).toMatchObject({
      ok: false,
      reason: "duplicate-vertex",
    });
    // Maker triangle with a Maker point strictly inside (k=3 over 4 Maker pts)
    const blocked = stateOf(
      [
        [0, 0, "maker"],
        [40, 5, "breaker"],
        [20, 0, "maker"],
        [-30, 9, "breaker"],
        [10, 20, "maker"],
        [41, 41, "breaker"],
        [10, 5, "maker"],
      ],
      3,
      "bichromatic",
    );
    expect(checkWinningHole(blocked, { k: 3, verts: ["p1", "p3", "p5"] })).toMatchObject({
      ok: false,
      reason: "not-a-hole",
    });
  });

  it("isHoleAmong mirrors the typed check on raw id lists", () => {
    const ids = idPts(s);
    expect(isHoleAmong(ids, eligibleVertex(s), ["p1", "p3", "p5"])).toBe(true);
    expect(isHoleAmong(ids, eligibleVertex(s), ["p1", "p2", "p3"])).toBe(false);
    expect(isHoleAmong(ids, eligibleVertex(s), ["p1", "p1", "p3"])).toBe(false);
    expect(isHoleAmong(ids, eligibleVertex(s), ["p1", "zz", "p3"])).toBe(false);
  });
});

describe("integrity invariant I6 (bichromatic witnesses)", () => {
  const base = stateOf(
    [
      [0, 0, "maker"],
      [30, 1, "breaker"],
      [10, 0, "maker"],
      [-20, 7, "breaker"],
      [5, 10, "maker"],
      [41, 41, "breaker"],
    ],
    3,
    "bichromatic",
  );
  const won = (verts: string[]): GameState => ({
    ...base,
    turn: "over",
    terminal: {
      kind: "maker-won",
      k: 3,
      witness: [{ k: 3, verts }],
      nodeId: "n",
    },
  });

  it("accepts a genuine Maker-only witness", () => {
    expect(checkTerminalWitness(won(["p1", "p3", "p5"]))).toEqual({ ok: true });
    expect(checkStateInvariants(won(["p1", "p3", "p5"])).ok).toBe(true);
  });

  it("rejects a witness with a Breaker vertex (state invariant i6)", () => {
    const st = won(["p1", "p2", "p3"]);
    const c = checkStateInvariants(st);
    expect(c.ok).toBe(false);
    if (!c.ok) {
      expect(c.violated).toBe("i6");
      expect(c.detail).toContain("breaker-vertex");
    }
  });

  it("rejects an empty witness list and a non-hole witness", () => {
    const empty: GameState = {
      ...base,
      turn: "over",
      terminal: { kind: "maker-won", k: 3, witness: [], nodeId: "n" },
    };
    expect(checkStateInvariants(empty).ok).toBe(false);
    const notHole = stateOf(
      [
        [0, 0, "maker"],
        [30, 1, "breaker"],
        [10, 0, "maker"],
        [-20, 7, "breaker"],
        [5, 10, "maker"],
        [5, 3, "breaker"],
      ],
      3,
      "bichromatic",
    );
    const st: GameState = {
      ...notHole,
      turn: "over",
      terminal: {
        kind: "maker-won",
        k: 3,
        witness: [{ k: 3, verts: ["p1", "p3", "p5"] }],
        nodeId: "n",
      },
    };
    const c = checkStateInvariants(st);
    expect(c.ok).toBe(false);
    if (!c.ok) {
      expect(c.violated).toBe("i6");
    }
  });

  it("is vacuous for monochromatic states (witness with a Breaker vertex passes i6)", () => {
    const mono: GameState = {
      ...base,
      terminal: {
        kind: "maker-won",
        k: 3,
        witness: [{ k: 3, verts: ["p1", "p2", "p3"] }],
        nodeId: "n",
      },
      turn: "over",
    };
    const { gameMode: _drop, ...rest } = mono;
    void _drop;
    expect(checkStateInvariants(rest as GameState).ok).toBe(true);
  });

  it("non-terminal and non-maker-won terminals are unaffected", () => {
    expect(checkTerminalWitness(base)).toEqual({ ok: true });
  });
});

describe("hashing", () => {
  const pts: ReadonlyArray<readonly [number, number, Player]> = [
    [0, 0, "maker"],
    [30, 1, "breaker"],
    [10, 0, "maker"],
  ];
  it("monochromatic canonical strings carry no game-mode line (hash stability)", () => {
    const s = stateOf(pts, 3);
    expect(canonicalStateString(s)).not.toContain("gamemode");
    expect(canonicalStateString(s).split("\n")[2]).toBe("mode:sandbox");
  });
  it("bichromatic differs from monochromatic for identical points", () => {
    const m = stateOf(pts, 3);
    const b = stateOf(pts, 3, "bichromatic");
    expect(canonicalStateString(b)).toContain("gamemode:bichromatic");
    expect(stateHash(b)).not.toBe(stateHash(m));
  });
});

// ---- properties: random owner-coloured point sets vs. the oracle ----

const coord = fc.integer({ min: -12, max: 12 });
const arbSet = fc
  .tuple(
    fc.array(fc.tuple(coord, coord), { minLength: 5, maxLength: 9 }),
    fc.array(fc.boolean(), { minLength: 9, maxLength: 9 }),
    fc.integer({ min: 3, max: 5 }),
  )
  .filter(([ps]) => {
    const keys = new Set(ps.map(([x, y]) => `${x},${y}`));
    return keys.size === ps.length && gp(ps.map(([x, y]) => P(x, y)));
  });

describe("properties", () => {
  it("bichromatic holes == independent oracle; never a Breaker vertex", () => {
    fc.assert(
      fc.property(arbSet, ([ps, flags, k]) => {
        const owners: Player[] = ps.map((_, i) => (flags[i] ? "maker" : "breaker"));
        const triples = ps.map(([x, y], i) => [x, y, owners[i] as Player] as const);
        const st = stateOf(triples, k as 3 | 4 | 5, "bichromatic");
        const r = findWinHoles(st, k, { mode: "exhaustive", budget: BUDGET });
        expect(r.kind).toBe("exhaustive");
        if (r.kind !== "exhaustive") {
          return;
        }
        const all: IPt[] = ps.map(([x, y]) => [x, y] as const);
        const makerIdx = owners.flatMap((o, i) => (o === "maker" ? [i] : []));
        expect(sortedKeys(r.holes)).toEqual(oracleHoles(all, makerIdx, k));
        const byId = new Map(st.points.map((p) => [p.id, p.owner] as const));
        for (const h of r.holes) {
          for (const v of h.verts) {
            expect(byId.get(v)).toBe("maker");
          }
          expect(checkWinningHole(st, h).ok).toBe(true);
        }
      }),
      { numRuns: 150 },
    );
  });

  it("monochromatic holes == oracle over all points (flag-free path unchanged)", () => {
    fc.assert(
      fc.property(arbSet, ([ps, flags, k]) => {
        const owners: Player[] = ps.map((_, i) => (flags[i] ? "maker" : "breaker"));
        const triples = ps.map(([x, y], i) => [x, y, owners[i] as Player] as const);
        const st = stateOf(triples, k as 3 | 4 | 5);
        const r = findWinHoles(st, k, { mode: "exhaustive", budget: BUDGET });
        expect(r.kind).toBe("exhaustive");
        if (r.kind !== "exhaustive") {
          return;
        }
        const all: IPt[] = ps.map(([x, y]) => [x, y] as const);
        expect(sortedKeys(r.holes)).toEqual(
          oracleHoles(
            all,
            ps.map((_, i) => i),
            k,
          ),
        );
      }),
      { numRuns: 100 },
    );
  });

  it("bichromatic holes are exactly the monochromatic holes with all-Maker vertices", () => {
    fc.assert(
      fc.property(arbSet, ([ps, flags, k]) => {
        const owners: Player[] = ps.map((_, i) => (flags[i] ? "maker" : "breaker"));
        const triples = ps.map(([x, y], i) => [x, y, owners[i] as Player] as const);
        const mono = findWinHoles(stateOf(triples, k as 3 | 4 | 5), k, {
          mode: "exhaustive",
          budget: BUDGET,
        });
        const bi = findWinHoles(stateOf(triples, k as 3 | 4 | 5, "bichromatic"), k, {
          mode: "exhaustive",
          budget: BUDGET,
        });
        if (mono.kind !== "exhaustive" || bi.kind !== "exhaustive") {
          throw new Error("unreachable");
        }
        const ownerOf = (id: string): Player => owners[Number(id.slice(1)) - 1] as Player;
        const filtered = mono.holes.filter((h) => h.verts.every((v) => ownerOf(v) === "maker"));
        expect(sortedKeys(bi.holes)).toEqual(sortedKeys(filtered));
      }),
      { numRuns: 100 },
    );
  });

  it("incremental detector == full holes containing the last point", () => {
    fc.assert(
      fc.property(arbSet, ([ps, flags, k]) => {
        const owners: Player[] = ps.map((_, i) => (flags[i] ? "maker" : "breaker"));
        const triples = ps.map(([x, y], i) => [x, y, owners[i] as Player] as const);
        const st = stateOf(triples, k as 3 | 4 | 5, "bichromatic");
        const full = findWinHoles(st, k, { mode: "exhaustive", budget: BUDGET });
        if (full.kind !== "exhaustive") {
          throw new Error("unreachable");
        }
        const last = `p${ps.length}`;
        const inc = findNewWinHoles(st, k, last);
        expect(sortedKeys(inc.holes)).toEqual(
          sortedKeys(full.holes.filter((h) => h.verts.includes(last))),
        );
        if (owners[ps.length - 1] === "breaker") {
          expect(inc.holes).toEqual([]);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("adding a Breaker point never creates a bichromatic hole", () => {
    fc.assert(
      fc.property(arbSet, ([ps, flags, k]) => {
        const owners: Player[] = ps.slice(0, -1).map((_, i) => (flags[i] ? "maker" : "breaker"));
        const before = ps.slice(0, -1).map(([x, y], i) => [x, y, owners[i] as Player] as const);
        const lastPt = ps[ps.length - 1] as readonly [number, number];
        const after = [...before, [lastPt[0], lastPt[1], "breaker" as Player] as const];
        const a = findWinHoles(stateOf(before, k as 3 | 4 | 5, "bichromatic"), k, {
          mode: "exhaustive",
          budget: BUDGET,
        });
        const b = findWinHoles(stateOf(after, k as 3 | 4 | 5, "bichromatic"), k, {
          mode: "exhaustive",
          budget: BUDGET,
        });
        if (a.kind !== "exhaustive" || b.kind !== "exhaustive") {
          throw new Error("unreachable");
        }
        const keysA = new Set(sortedKeys(a.holes));
        for (const key of sortedKeys(b.holes)) {
          expect(keysA.has(key)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});
