// regression: the k=5 -> k=6 promotion must not offer a Grow-to-6 that
// the §24.0b P4 parity rung rejects. A k=5 win completed by BREAKER's own
// placement (6 points, Maker to move) is not a Lemma 7 start.
import { describe, expect, it } from "vitest";
import { growToSixBlock } from "../../src/ui/modes/promote.ts";
import { holeToPointList } from "../../src/engine/init.ts";
import { commit, startSession } from "../../src/session/commit.ts";
import { Store } from "../../src/session/store.ts";
import { reduceTransaction } from "../../src/engine/orchestrator.ts";
import { checkPlacement } from "../../src/game/legality.ts";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { Rat } from "../../src/geometry/rat.ts";
import { convexPosition } from "../../src/geometry/hull.ts";
import { mulberry32, testCtx } from "../helpers.ts";
import { ensureK5, playK5Game } from "../strategies/k5driver.ts";
import { ensureK6 } from "../strategies/k6driver.ts";

ensureK5();
ensureK6();

describe("growToSixBlock", () => {
  it("blocks non-k5 / non-win states and even-count wins, allows odd-count k=5 wins", () => {
    const won = { kind: "maker-won" };
    expect(growToSixBlock({ k: 5, points: new Array(7), terminal: won })).toBeNull();
    expect(growToSixBlock({ k: 5, points: new Array(5), terminal: won })).toBeNull();
    expect(growToSixBlock({ k: 5, points: new Array(6), terminal: won })).toMatch(/Maker's turn/);
    expect(growToSixBlock({ k: 6, points: new Array(7), terminal: won })).not.toBeNull();
    expect(growToSixBlock({ k: 5, points: new Array(7), terminal: null })).not.toBeNull();
  });

  it("agrees with the real bootstrap ladder on genuine k=5 games", () => {
    const rand = mulberry32(1);
    const ctx = testCtx();
    let evenSeen = 0;
    let oddSeen = 0;
    for (let g = 0; g < 80 && (evenSeen < 2 || oddSeen < 2); g += 1) {
      // replay a seeded k=5 game keeping the store
      const store = new Store();
      startSession(
        { kind: "guided", config: { mode: "break", window: ctx.config.window }, strategyId: "esmb-k5", mode: "break" },
        ctx,
        store,
      );
      const pick = (accept?: (c: Pt) => boolean): Pt => {
        for (let t = 0; t < 500; t += 1) {
          const c = pt(
            Rat.make(BigInt(Math.floor(rand() * 81) - 40)),
            Rat.make(BigInt(Math.floor(rand() * 81) - 40)),
          );
          if (accept !== undefined && !accept(c)) {
            continue;
          }
          if (checkPlacement(store.current(), c, ctx.config.window) === null) {
            return c;
          }
        }
        throw new Error("no point");
      };
      const play = (c: Pt): void => {
        const act = { kind: "place" as const, owner: "breaker" as const, at: c };
        const r = reduceTransaction(store.current(), act, ctx);
        commit(r, act, store, ctx);
      };
      play(pick());
      const four = store.current().points.map((p) => p.pt);
      play(pick((c) => !convexPosition([...four, c])));
      play(pick());
      const st = store.current();
      expect(st.terminal?.kind).toBe("maker-won");
      const blocked = growToSixBlock(st);
      const witness = st.terminal?.kind === "maker-won" ? st.terminal.witness[0] : undefined;
      const conv = witness === undefined ? null : holeToPointList(witness, st.points);
      const s6 = new Store();
      const res = startSession(
        {
          kind: "guided",
          config: { mode: "break", window: ctx.config.window },
          strategyId: "esmb-k6",
          mode: "break",
          strategyStart: {
            kind: "continue",
            points: st.points.map((p) => p.pt),
            owners: st.points.map((p) => p.owner),
            selectedHole: conv !== null && conv.ok ? [...conv.pts] : null,
          },
        },
        ctx,
        s6,
      );
      if (st.points.length % 2 === 0) {
        evenSeen += 1;
        expect(blocked).not.toBeNull();
        expect(res.status).toBe("rejected");
        expect(res.error?.code).toBe("parity");
      } else {
        oddSeen += 1;
        expect(blocked).toBeNull();
        expect(res.status).toBe("accepted");
      }
    }
    expect(evenSeen).toBeGreaterThan(0);
    expect(oddSeen).toBeGreaterThan(0);
    void playK5Game;
  });
});

import { growToSevenBlock } from "../../src/ui/modes/promote.ts";
import type { GameState } from "../../src/game/types.ts";

describe("growToSevenBlock", () => {
  it("refuses a non-k=6 state with the honest reason", () => {
    const st = { k: 5, terminal: null, points: [] } as unknown as GameState;
    expect(growToSevenBlock(st)).toBe("Grow to 7 needs a finished k=6 Maker win.");
  });
  it("refuses an unfinished k=6 state via the engine ladder", () => {
    const st = { k: 6, terminal: null, points: [] } as unknown as GameState;
    expect(growToSevenBlock(st)).toBe("Growing needs a finished Maker win.");
  });
});
