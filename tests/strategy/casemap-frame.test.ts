// regression: the effective-cell (case-map) machinery must (a) be
// available at k5:r2:classify (the classifier's `last-n 4` input names the
// not-yet-placed B2) and (b) give cells on which the case label is CONSTANT
// (classifyB3.boundaries was asked of the pre-placement state and silently
// dropped A3's lines, leaving one label-mixed cell per game).
import { describe, expect, it } from "vitest";
import { commit, startSession } from "../../src/session/commit.ts";
import { Store } from "../../src/session/store.ts";
import { reduceTransaction } from "../../src/engine/orchestrator.ts";
import { checkPlacement } from "../../src/game/legality.ts";
import { placePoint } from "../../src/game/place.ts";
import type { GameState } from "../../src/game/types.ts";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { Rat } from "../../src/geometry/rat.ts";
import { convexPosition, hull } from "../../src/geometry/hull.ts";
import { effectiveCells } from "../../src/strategy/samples.ts";
import { classify } from "../../src/strategy/runtime.ts";
import { strategies } from "../../src/strategy/registry.ts";
import { mulberry32, testCtx } from "../helpers.ts";
import { ensureK5 } from "../strategies/k5driver.ts";
import { ensureK6, forcedRegion, randomPentagon, centroidOf } from "../strategies/k6driver.ts";

ensureK5();
ensureK6();

function bary(poly: readonly Pt[], rand: () => number): Pt {
  const ws = poly.map(() => BigInt(Math.floor(rand() * 1000) + 1));
  const tot = ws.reduce((a, b) => a + b, 0n);
  let x = Rat.ZERO;
  let y = Rat.ZERO;
  poly.forEach((p, i) => {
    const w = Rat.make(ws[i] as bigint, tot);
    x = x.add(p.x.mul(w));
    y = y.add(p.y.mul(w));
  });
  return pt(x, y);
}

function labelsInEveryCell(
  st: GameState,
  strategyId: string,
  nodeId: string,
  rand: () => number,
): { cells: number; mixed: number } {
  const ctx = testCtx();
  const def = strategies().get(strategyId)!.def;
  const cells = effectiveCells(st, def, nodeId, ctx.config);
  if (!cells.available) {
    throw new Error(`cells unavailable: ${cells.reason} ${cells.detail}`);
  }
  let n = 0;
  let mixed = 0;
  for (const grp of cells.groups) {
    for (const cell of grp.cells) {
      const labels = new Set<string>();
      for (let t = 0; t < 10; t += 1) {
        const q = bary(cell.poly, rand);
        if (checkPlacement(st, q, ctx.config.window) !== null) {
          continue;
        }
        const r = classify(def, placePoint(st, "breaker", q), nodeId, `p${st.points.length + 1}`, ctx.config);
        labels.add(r.ok ? r.case : "FAIL");
      }
      n += 1;
      if (labels.size > 1) {
        mixed += 1;
      }
    }
  }
  return { cells: n, mixed };
}

describe("case-map frame", () => {
  it("k5:r2:classify has an effective case map (convex vs one-interior)", () => {
    const ctx = testCtx();
    const def = strategies().get("esmb-k5")!.def;
    for (const [bx, by] of [[333, 333], [10, 0], [-30, -30]] as const) {
      const store = new Store();
      startSession({ kind: "guided", config: { mode: "proof", window: ctx.config.window }, strategyId: "esmb-k5", mode: "proof" }, ctx, store);
      const act = { kind: "place" as const, owner: "breaker" as const, at: pt(Rat.make(BigInt(bx)), Rat.make(BigInt(by))) };
      commit(reduceTransaction(store.current(), act, ctx), act, store, ctx);
      const st = store.current();
      expect(st.strategy?.nodeId).toBe("k5:r2:classify");
      const cells = effectiveCells(st, def, "k5:r2:classify", ctx.config);
      expect(cells.available).toBe(true);
      if (cells.available) {
        expect(cells.groups.map((g) => g.caseId).sort()).toEqual(["k5:b2:convex", "k5:b2:one-interior"]);
      }
      // 3 existing points ⇒ 3 pair-lines ⇒ exactly 7 cells in the plane
      // (the triangle, 3 edge regions, 3 vertex wedges), clipped to the window.
      const total = cells.available ? cells.groups.reduce((s, g) => s + g.cells.length, 0) : 0;
      expect(total).toBe(7);
    }
  });

  it("k5:r3:classify cells are label-constant", () => {
    const ctx = testCtx();
    const rand = mulberry32(5);
    let mixed = 0;
    let cells = 0;
    for (let g = 0; g < 6; g += 1) {
      const store = new Store();
      startSession({ kind: "guided", config: { mode: "break", window: ctx.config.window }, strategyId: "esmb-k5", mode: "break" }, ctx, store);
      const rp = (): Pt => pt(Rat.make(BigInt(Math.floor(rand() * 81) - 40)), Rat.make(BigInt(Math.floor(rand() * 81) - 40)));
      const play = (c: Pt): void => {
        const a = { kind: "place" as const, owner: "breaker" as const, at: c };
        commit(reduceTransaction(store.current(), a, ctx), a, store, ctx);
      };
      let c = rp();
      while (checkPlacement(store.current(), c, ctx.config.window) !== null) {
        c = rp();
      }
      play(c);
      const four = store.current().points.map((p) => p.pt);
      c = rp();
      while (checkPlacement(store.current(), c, ctx.config.window) !== null || convexPosition([...four, c])) {
        c = rp();
      }
      play(c);
      const r = labelsInEveryCell(store.current(), "esmb-k5", "k5:r3:classify", rand);
      mixed += r.mixed;
      cells += r.cells;
    }
    expect(cells).toBeGreaterThan(50);
    expect(mixed).toBe(0);
  }, 120000);

  it("k6:r5:classify cells are label-constant", () => {
    const ctx = testCtx();
    const rand = mulberry32(6);
    let mixed = 0;
    let cells = 0;
    for (let g = 0; g < 4; g += 1) {
      const pent = randomPentagon(rand);
      const store = new Store();
      startSession(
        {
          kind: "guided",
          config: { mode: "break", window: ctx.config.window },
          strategyId: "esmb-k6",
          mode: "break",
          strategyStart: { kind: "supplied", points: pent, selectedHole: [...pent] },
        },
        ctx,
        store,
      );
      const b0 = centroidOf(forcedRegion(hull([...pent])));
      if (checkPlacement(store.current(), b0, ctx.config.window) !== null) {
        continue;
      }
      const a = { kind: "place" as const, owner: "breaker" as const, at: b0 };
      commit(reduceTransaction(store.current(), a, ctx), a, store, ctx);
      expect(store.current().strategy?.nodeId).toBe("k6:r5:classify");
      const r = labelsInEveryCell(store.current(), "esmb-k6", "k6:r5:classify", rand);
      mixed += r.mixed;
      cells += r.cells;
    }
    expect(cells).toBeGreaterThan(10);
    expect(mixed).toBe(0);
  }, 180000);
});
