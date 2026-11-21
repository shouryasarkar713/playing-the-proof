// Slow tier: seeded full-pipeline k=7 games. (a) random hexagons (all five
// families) with random/targeted/near-vertex B0 and B1; (b) the real chain
// k=6 preset win -> promotion -> k=7 win. Every game must end maker-won with a
// 7-hole that the independent oracle confirms.
import { describe, expect, it } from "vitest";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { Rat } from "../../src/geometry/rat.ts";
import { hull } from "../../src/geometry/hull.ts";
import { initSession } from "../../src/engine/init.ts";
import { growStartFromWin } from "../../src/engine/promote.ts";
import type { GameState } from "../../src/game/types.ts";
import { PRESET_P5 } from "../../src/strategy/strategies/k6/preset.ts";
import { testCtx } from "../helpers.ts";
import { centroidOf, ensureK6, forcedRegion, baryInside } from "../strategies/k6driver.ts";
import { ensureK7, mulberry, randomInside } from "../strategies/k7driver.ts";
import { extraPoint } from "../strategies/k7gen.ts";
import { makeHex } from "../strategies/k7gate.ts";
import type { Family } from "../strategies/k7gate.ts";
import { breakerMove, initK7, verifyWin } from "../strategies/k7tree.ts";

ensureK6();
ensureK7();
const ctx = testCtx();

function rr(rand: () => number, mag: number, den: number): Rat {
  return Rat.make(BigInt(Math.floor((rand() * 2 - 1) * mag * den)), BigInt(den));
}

// B-move pickers: wide random, near a placed point, inside a placed hull.
function pick(state: GameState, rand: () => number): Pt {
  const m = Math.floor(rand() * 3);
  if (m === 0) {
    return pt(rr(rand, 200, 7), rr(rand, 200, 7));
  }
  if (m === 1) {
    const q = state.points[Math.floor(rand() * state.points.length)] as GameState["points"][number];
    return pt(q.pt.x.add(rr(rand, 3, 97)), q.pt.y.add(rr(rand, 3, 97)));
  }
  const some = state.points.slice(0, state.points.length).map((p) => p.pt);
  const h = hull(some);
  return baryInside(h, rand);
}

describe("k7 slow: seeded games from random hexagons", () => {
  const families: Family[] = ["integer", "rational", "concurrent", "flat", "needle"];
  for (const family of families) {
    it(`${family}: 40 games`, { timeout: 3_600_000 }, () => {
      const rand = mulberry(9100 + family.length);
      let wins = 0;
      let played = 0;
      for (let g = 0; g < 40; g += 1) {
        const hex = makeHex(family, rand);
        const s0 = initK7(hex, [extraPoint(hex, rand)], ctx);
        let s: GameState | null = null;
        for (let t = 0; t < 30 && s === null; t += 1) {
          const b0 = t % 3 === 0 ? randomInside(hex, rand) : pick(s0, rand);
          s = breakerMove(s0, b0, ctx);
        }
        if (s === null) {
          continue;
        }
        if (s.terminal === null) {
          let s2: GameState | null = null;
          for (let t = 0; t < 30 && s2 === null; t += 1) {
            s2 = breakerMove(s, pick(s, rand), ctx);
          }
          if (s2 === null) {
            continue;
          }
          s = s2;
        }
        played += 1;
        expect(verifyWin(s)).toBeNull();
        wins += 1;
      }
      expect(played).toBeGreaterThan(30);
      expect(wins).toBe(played);
    });
  }
});

describe("k7 slow: chain k=6 win -> promotion -> k=7 win", () => {
  it("60 seeded chains", { timeout: 3_600_000 }, () => {
    const rand = mulberry(777);
    let chains = 0;
    for (let g = 0; g < 60; g += 1) {
      const r6 = initSession(
        {
          kind: "guided",
          config: { mode: "break", window: ctx.config.window },
          strategyId: "esmb-k6",
          mode: "break",
          strategyStart: { kind: "supplied", points: [...PRESET_P5], selectedHole: [...PRESET_P5] },
        },
        ctx,
      );
      let s = r6.state as GameState;
      const fr = forcedRegion(PRESET_P5);
      let s1: GameState | null = null;
      for (let t = 0; t < 30 && s1 === null; t += 1) {
        s1 = breakerMove(s, t === 0 ? centroidOf(fr) : baryInside(fr, rand), ctx);
      }
      if (s1 === null) {
        continue;
      }
      s = s1;
      if (s.terminal === null) {
        let s2: GameState | null = null;
        for (let t = 0; t < 30 && s2 === null; t += 1) {
          s2 = breakerMove(s, pick(s, rand), ctx);
        }
        if (s2 === null) {
          continue;
        }
        s = s2;
      }
      const grow = growStartFromWin(s);
      if (!grow.ok) {
        continue; // Breaker-completed hole: the typed refusal
      }
      const init = initSession(
        {
          kind: "guided",
          config: { mode: "break", window: ctx.config.window },
          strategyId: "esmb-k7",
          mode: "break",
          strategyStart: grow.start,
        },
        ctx,
      );
      expect(init.status).toBe("accepted");
      let k7: GameState = init.state as GameState;
      if (k7.terminal !== null) {
        continue;
      }
      const hexIds = k7.strategy?.vars["P6"] as string[];
      const hex = hexIds.map((id) => k7.points.find((p) => p.id === id)?.pt as Pt);
      let n1: GameState | null = null;
      for (let t = 0; t < 30 && n1 === null; t += 1) {
        n1 = breakerMove(k7, t % 2 === 0 ? baryInside(hex, rand) : pick(k7, rand), ctx);
      }
      if (n1 === null) {
        continue;
      }
      k7 = n1;
      if (k7.terminal === null) {
        let n2: GameState | null = null;
        for (let t = 0; t < 30 && n2 === null; t += 1) {
          n2 = breakerMove(k7, pick(k7, rand), ctx);
        }
        if (n2 === null) {
          continue;
        }
        k7 = n2;
      }
      expect(verifyWin(k7)).toBeNull();
      chains += 1;
    }
    expect(chains).toBeGreaterThanOrEqual(30); // the rest: Breaker-completed holes (typed refusal) or immediate wins
  });
});
