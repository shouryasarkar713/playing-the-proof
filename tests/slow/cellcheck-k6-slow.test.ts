// tests/slow/cellcheck-k6-slow.test.ts — SLOW TIER (excluded from `verify`).
// M7 sign-off: the larger-corpus exact checks — B1-space over the 9-point
// route-B state (36 lines → 475 cells) and the escape-convention
// representatives over the 7-point bootstrap's forced cells. Same
// budgets, same assertions as the CI tier; recorded nowhere (the CI
// tier owns the promotion records).
import { describe, expect, it } from "vitest";
import type { Pt } from "../../src/geometry/pt.ts";
import { commit, startSession } from "../../src/session/commit.ts";
import { Store } from "../../src/session/store.ts";
import { reduceTransaction } from "../../src/engine/orchestrator.ts";
import type { RuntimeCtx } from "../../src/engine/orchestrator.ts";
import type { GameState, PointId } from "../../src/game/types.ts";
import type { IdPt } from "../../src/geometry/holes.ts";
import { evalRegion } from "../../src/strategy/eval.ts";
import { forcedExpr } from "../../src/strategy/strategies/k6/def.ts";
import {
  checkTwinWitnesses,
  forcedCellReps,
  k6B1Check,
} from "../../src/verification/cellchecks.ts";
import { P, centroidOf, ensureK6, forcedRegion } from "../strategies/k6driver.ts";
import { testCtx } from "../helpers.ts";

ensureK6();

const PENT = [P(0, 0), P(10, 0), P(13, 8), P(5, 13), P(-3, 8)];
const MULTI7 = [...PENT, P(100, 101), P(101, 100)];

function boot(points: Pt[], selectedHole: Pt[], ctx: RuntimeCtx): Store {
  const store = new Store();
  const started = startSession(
    {
      kind: "guided",
      config: { mode: "break", window: ctx.config.window },
      strategyId: "esmb-k6",
      mode: "break",
      strategyStart: { kind: "supplied", points, selectedHole },
    },
    ctx,
    store,
  );
  if (started.status !== "accepted") {
    throw new Error("slow-cellcheck: bootstrap rejected — test bug");
  }
  return store;
}

function breaker(store: Store, ctx: RuntimeCtx, at: Pt): GameState {
  const r = reduceTransaction(
    store.current(),
    { kind: "place", owner: "breaker", at },
    ctx,
  );
  if (r.status !== "accepted" || r.nextState === undefined) {
    throw new Error("slow-cellcheck: placement rejected — test bug");
  }
  commit(r, { kind: "place", owner: "breaker", at }, store, ctx);
  return store.current();
}

describe("k=6 B1-space, 9-point corpus (slow, M7 sign-off)", () => {
  it("route-B from MULTI7: every cell keeps a 5-hole", () => {
    const ctx = testCtx();
    const store = boot(MULTI7, PENT, ctx);
    const cur0 = store.current();
    const p5 = (cur0.strategy?.vars["P5"] as string[]).map(
      (id) => cur0.points.find((p) => p.id === id)?.pt as Pt,
    );
    const cur = breaker(store, ctx, centroidOf(forcedRegion(p5)));
    expect(cur.strategy?.nodeId).toBe("k6:r5:classify");
    const afterA1 = cur.points.map((p) => p.pt);
    expect(afterA1.length).toBe(9);
    const r = k6B1Check(
      afterA1,
      ctx.config.window,
      "play window ±1000000; route-B after-A1 state from MULTI7 (|F|=9); F = bootstrap ∪ {B0, A1}",
    );
    expect(r.result).toBe("PASS");
    expect(r.cells).toBe(475);
    expect(r.checked).toBe(r.cells);
  }, 600000);
});

describe("k=6 escape representatives, 7-point corpus (slow, M7 sign-off)", () => {
  it("per forced-region cell of MULTI7: route-B pipeline + twins", () => {
    const ctx = testCtx();
    const bootStore = boot(MULTI7, PENT, ctx);
    const evaled = evalRegion(forcedExpr, {
      state: bootStore.current(),
      config: ctx.config,
      channel: "correctness",
    });
    if (evaled.kind !== "complete") {
      throw new Error("slow-cellcheck: forced region incomplete — test bug");
    }
    const parts =
      evaled.region.kind === "poly"
        ? [evaled.region]
        : evaled.region.parts.filter((p) => p.kind === "poly");
    if (parts.length !== 1 || parts[0]?.kind !== "poly") {
      throw new Error("slow-cellcheck: forced region not a single poly — test bug");
    }
    const { cells, inside, reps } = forcedCellReps(
      MULTI7,
      (parts[0] as { kind: "poly"; verts: readonly Pt[] }).verts,
      ctx.config.window,
    );
    expect(cells).toBe(161);
    expect(inside).toBeGreaterThan(0);
    let checked = 0;
    for (const rep of reps) {
      const store = boot(MULTI7, PENT, ctx);
      const cur = breaker(store, ctx, rep);
      if (cur.strategy?.nodeId !== "k6:r5:classify") {
        throw new Error(
          `slow-cellcheck: forced-region representative routed to ${cur.strategy?.nodeId} — corpus defect`,
        );
      }
      const a1 = cur.strategy?.vars["A1"] as PointId | undefined;
      if (typeof a1 !== "string") {
        throw new Error("slow-cellcheck: A1 unbound — test bug");
      }
      const all: IdPt[] = cur.points.map((p) => ({ id: p.id, pt: p.pt }));
      const twin = checkTwinWitnesses(all, a1);
      if (!twin.ok) {
        throw new Error(`slow-cellcheck: twin post-condition failed — ${twin.detail}`);
      }
      checked += 1;
    }
    expect(checked).toBe(inside);
  }, 900000);
});
