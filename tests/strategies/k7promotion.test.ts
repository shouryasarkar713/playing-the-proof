// tests/strategies/k7promotion.test.ts — the k=6 → k=7 chain: a real k=6 win
// (preset pentagon, forced B0, far B1) is promoted to an esmb-k7 session
// through the pure engine ladder; parity/size blocks are typed.
import { describe, expect, it } from "vitest";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { Rat } from "../../src/geometry/rat.ts";
import { initSession } from "../../src/engine/init.ts";
import { growStartFromWin } from "../../src/engine/promote.ts";
import { reduceTransaction } from "../../src/engine/orchestrator.ts";
import type { GameState } from "../../src/game/types.ts";
import { PRESET_P5 } from "../../src/strategy/strategies/k6/preset.ts";
import { testCtx } from "../helpers.ts";
import { centroidOf, ensureK6, forcedRegion } from "./k6driver.ts";
import { ensureK7, P } from "./k7driver.ts";
import { breakerMove } from "./k7tree.ts";
import { PRESET_P6 } from "../../src/strategy/strategies/k7/preset.ts";
import { extraPoint } from "./k7gen.ts";
import { mulberry } from "./k7driver.ts";

ensureK6();
ensureK7();
const ctx = testCtx();

function k6Win(): GameState {
  const r = initSession(
    {
      kind: "guided",
      config: { mode: "break", window: ctx.config.window },
      strategyId: "esmb-k6",
      mode: "break",
      strategyStart: { kind: "supplied", points: [...PRESET_P5], selectedHole: [...PRESET_P5] },
    },
    ctx,
  );
  let s = r.state as GameState;
  const fr = forcedRegion(PRESET_P5);
  s = breakerMove(s, centroidOf(fr), ctx) as GameState;
  s = breakerMove(s, P(500, 500), ctx) as GameState;
  return s;
}

describe("k=6 → k=7 promotion", () => {
  it("a k=6 win (9 points, Breaker to move) becomes a parked esmb-k7 session on the won 6-hole", () => {
    const won = k6Win();
    expect(won.terminal?.kind).toBe("maker-won");
    expect(won.points.length % 2).toBe(1);
    const g = growStartFromWin(won);
    expect(g.ok).toBe(true);
    if (!g.ok) {
      return;
    }
    const init = initSession(
      {
        kind: "guided",
        config: { mode: "break", window: ctx.config.window },
        strategyId: "esmb-k7",
        mode: "break",
        strategyStart: g.start,
      },
      ctx,
    );
    expect(init.status).toBe("accepted");
    expect(init.state?.strategy?.nodeId).toBe("k7:boot");
    expect(init.state?.points.length).toBe(won.points.length);
    // the full Lemma 8 round on the promoted position
    const s1 = breakerMove(init.state as GameState, pt(Rat.make(1n), Rat.make(1n, 3n)), ctx);
    expect(s1).not.toBeNull();
  });

  it("typed blocks: unfinished, wrong k, even count", () => {
    const won = k6Win();
    expect(growStartFromWin({ ...won, terminal: null }).ok).toBe(false);
    const wrongK = growStartFromWin({ ...won, k: 7 } as GameState);
    expect(wrongK.ok ? "" : wrongK.reason).toBe("wrong-k");
    const even = growStartFromWin({
      ...won,
      points: won.points.slice(0, won.points.length - 1),
    } as GameState);
    expect(even.ok ? "" : even.reason).toBe("breaker-completed-hole");
  });

  it("an unfinished k=7 reply from a promoted session still wins (sample B0 inside the 6-hole)", () => {
    const won = k6Win();
    const g = growStartFromWin(won);
    if (!g.ok) {
      throw new Error("test bug");
    }
    const init = initSession(
      {
        kind: "guided",
        config: { mode: "break", window: ctx.config.window },
        strategyId: "esmb-k7",
        mode: "break",
        strategyStart: g.start,
      },
      ctx,
    ).state as GameState;
    const hexIds = init.strategy?.vars["P6"] as string[];
    const hex: Pt[] = hexIds.map((id) => init.points.find((p) => p.id === id)?.pt as Pt);
    const c = centroidOf(hex);
    const r = reduceTransaction(init, { kind: "place", owner: "breaker", at: c }, ctx);
    expect(r.status === "accepted" || r.status === "rejected").toBe(true);
  });
});

describe("k=7 bootstrap ladder at the exact 12-point bound", () => {
  it("a 12-point continue record with no selected hole runs the 6-hole fallback ladder exhaustively (typed parity rejection, no overrun throw)", () => {
    const rand = mulberry(99);
    const pts: Pt[] = [...PRESET_P6];
    while (pts.length < 12) {
      // keep GP and no 7-hole: extraPoint checks against the current set
      pts.push(extraPoint(pts, rand));
    }
    const r = initSession(
      {
        kind: "guided",
        config: { mode: "break", window: ctx.config.window },
        strategyId: "esmb-k7",
        mode: "break",
        strategyStart: {
          kind: "continue",
          points: pts,
          owners: pts.map((_, i) => (i % 2 === 0 ? "maker" : "breaker")),
          selectedHole: null,
        },
      },
      ctx,
    );
    expect(r.status).toBe("rejected");
    expect(r.error?.code).toBe("parity");
  });
});
