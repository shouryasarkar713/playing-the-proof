// exact twin structure (Lemma 7: "two 5-holes intersecting in one
// triangle") + the B1 label consistency regression.
import { describe, expect, it } from "vitest";
import { twinSharedTriangle } from "../../src/geometry/twins.ts";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { Rat } from "../../src/geometry/rat.ts";
import { hull } from "../../src/geometry/hull.ts";
import { insideConvex } from "../../src/geometry/poly.ts";
import { checkPlacement } from "../../src/game/legality.ts";
import { commit, startSession } from "../../src/session/commit.ts";
import { Store } from "../../src/session/store.ts";
import { reduceTransaction } from "../../src/engine/orchestrator.ts";
import { mulberry32, testCtx } from "../helpers.ts";
import { ensureK6, forcedRegion, randomPentagon, centroidOf } from "../strategies/k6driver.ts";

ensureK6();

const P = (x: number, y: number): Pt => pt(Rat.make(BigInt(x)), Rat.make(BigInt(y)));

describe("twinSharedTriangle", () => {
  it("rejects two 5-holes that share 3 vertices but overlap beyond the triangle", () => {
    const pts: Record<string, Pt> = {
      s1: P(0, 0), s2: P(10, 0), s3: P(5, 10),
      a1: P(12, 6), a2: P(-2, 6),
      b1: P(11, 3), b2: P(-1, 3),
    };
    const get = (id: string): Pt | null => pts[id] ?? null;
    // both pentagons bulge over the SAME edges of the shared triangle
    expect(twinSharedTriangle(["s1", "s2", "a1", "s3", "a2"], ["s1", "b1", "s2", "s3", "b2"], get)).toBeNull();
  });

  it("rejects a pair sharing 2 or 4 vertices", () => {
    const pts: Record<string, Pt> = { a: P(0, 0), b: P(10, 0), c: P(12, 6), d: P(5, 10), e: P(-2, 6), f: P(5, -4) };
    const get = (id: string): Pt | null => pts[id] ?? null;
    expect(twinSharedTriangle(["a", "b", "c", "d", "e"], ["a", "b", "c", "d", "f"], get)).toBeNull();
  });
});

describe("k6 twin selection / B1 label consistency", () => {
  it("every bound pair is an exact twin pair and the B1 case label matches its shared triangle", () => {
    const rand = mulberry32(31337);
    const ctx = testCtx();
    let checked = 0;
    for (let g = 0; g < 14; g += 1) {
      const pent = randomPentagon(rand);
      const store = new Store();
      const started = startSession(
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
      expect(started.status).toBe("accepted");
      const fr = forcedRegion(hull([...pent]));
      const b0 = centroidOf(fr);
      if (checkPlacement(store.current(), b0, ctx.config.window) !== null) {
        continue;
      }
      const a0 = { kind: "place" as const, owner: "breaker" as const, at: b0 };
      commit(reduceTransaction(store.current(), a0, ctx), a0, store, ctx);
      const st = store.current();
      const vars = st.strategy?.vars ?? {};
      const twinA = vars["twinA"] as string[];
      const twinB = vars["twinB"] as string[];
      const get = (id: string): Pt | null => st.points.find((p) => p.id === id)?.pt ?? null;
      const shared = twinSharedTriangle(twinA, twinB, get);
      expect(shared).not.toBeNull();
      // B1 strictly inside the ACTUAL shared triangle (centroid of it).
      const b1 = centroidOf(shared!.tri);
      if (checkPlacement(st, b1, ctx.config.window) !== null) {
        continue;
      }
      const a1 = { kind: "place" as const, owner: "breaker" as const, at: b1 };
      commit(reduceTransaction(st, a1, ctx), a1, store, ctx);
      const fin = store.current();
      expect(insideConvex([...shared!.tri], b1, true)).toBe(true);
      if (fin.points.length === 9) {
        // a normal (non-early-win) game classified B1: label must say shared triangle
        expect(fin.strategy?.lastCase).toBe("k6:b1:inside-shared-triangle");
      }
      expect(fin.terminal?.kind).toBe("maker-won");
      checked += 1;
    }
    expect(checked).toBeGreaterThan(5);
  }, 180000);
});
