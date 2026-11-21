// tests/integration/immutability.test.ts — frozen probes across the
// scenario corpus (Phase 18): every committed state reached by the k5
// safe/blunder walks, a full k6 route-B game, and sandbox placements is
// deep-frozen (the §5.4 discipline holds end to end, not just in unit
// probes). Any mutation attempt would throw in dev/test.
import { describe, expect, it } from "vitest";
import { Rat } from "../../src/geometry/rat.ts";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { commit, startSession } from "../../src/session/commit.ts";
import { Store } from "../../src/session/store.ts";
import { reduceTransaction } from "../../src/engine/orchestrator.ts";
import type { RuntimeCtx } from "../../src/engine/orchestrator.ts";
import type { GameState } from "../../src/game/types.ts";
import { ensureK5 } from "../strategies/k5driver.ts";
import { P, centroidOf, ensureK6, forcedRegion } from "../strategies/k6driver.ts";
import { testCtx } from "../helpers.ts";

ensureK5();
ensureK6();

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== "object") {
    return;
  }
  if (seen.has(value)) {
    return;
  }
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  if (Array.isArray(value)) {
    for (const item of value) {
      assertDeepFrozen(item, seen);
    }
  } else {
    for (const key of Object.keys(value)) {
      assertDeepFrozen((value as Record<string, unknown>)[key], seen);
    }
  }
}

function checkFrozen(store: Store, label: string): void {
  for (const t of store.tree().transactions) {
    assertDeepFrozen(store.stateAtTxn(t.txnId));
  }
  assertDeepFrozen(store.current());
  void label;
}

function place(store: Store, ctx: RuntimeCtx, owner: "maker" | "breaker", at: Pt): void {
  const r = reduceTransaction(store.current(), { kind: "place", owner, at }, ctx);
  if (r.status !== "accepted") {
    throw new Error(`immutability: placement rejected at ${labelOf(at)} — test bug`);
  }
  commit(r, { kind: "place", owner, at }, store, ctx);
  checkFrozen(store, labelOf(at));
}

function labelOf(at: Pt): string {
  return `${at.x.toString()},${at.y.toString()}`;
}

describe("corpus immutability (§5.4, Phase 18)", () => {
  it("k5 safe walk: every committed state deep-frozen", () => {
    const store = new Store();
    const ctx = testCtx();
    const started = startSession(
      {
        kind: "guided",
        config: { mode: "break", window: ctx.config.window },
        strategyId: "esmb-k5",
        mode: "break",
      },
      ctx,
      store,
    );
    expect(started.status).toBe("accepted");
    checkFrozen(store, "txn0");
    place(store, ctx, "breaker", P(10, 0));
    place(store, ctx, "breaker", pt(Rat.make(10n), Rat.make(9n)));
    place(store, ctx, "breaker", P(-30, -30));
    expect(store.current().terminal?.kind).toBe("maker-won");
  });

  it("k5 blunder walk: every committed state deep-frozen", () => {
    const store = new Store();
    const ctx = testCtx();
    const started = startSession(
      {
        kind: "guided",
        config: { mode: "break", window: ctx.config.window },
        strategyId: "esmb-k5",
        mode: "break",
      },
      ctx,
      store,
    );
    expect(started.status).toBe("accepted");
    place(store, ctx, "breaker", P(10, 0));
    place(store, ctx, "breaker", P(30, 5));
    expect(store.current().terminal?.kind).toBe("maker-won");
  });

  it("k6 route-B game: every committed state deep-frozen", () => {
    const pent = [P(0, 0), P(10, 0), P(13, 8), P(5, 13), P(-3, 8)];
    const store = new Store();
    const ctx = testCtx();
    const started = startSession(
      {
        kind: "guided",
        config: { mode: "break", window: ctx.config.window },
        strategyId: "esmb-k6",
        mode: "break",
        strategyStart: { kind: "supplied", points: pent, selectedHole: pent },
      },
      ctx,
      store,
    );
    expect(started.status).toBe("accepted");
    checkFrozen(store, "txn0");
    const cur0 = store.current();
    const p5 = (cur0.strategy?.vars["P5"] as string[]).map(
      (id) => cur0.points.find((p) => p.id === id)?.pt as Pt,
    );
    place(store, ctx, "breaker", centroidOf(forcedRegion(p5)));
    expect(store.current().strategy?.nodeId).toBe("k6:r5:classify");
    place(store, ctx, "breaker", P(200, 200));
    const cur: GameState = store.current();
    expect(cur.terminal?.kind).toBe("maker-won");
  });

  it("sandbox placements: every committed state deep-frozen", () => {
    const store = new Store();
    const ctx = testCtx();
    const started = startSession(
      { kind: "sandbox", config: { mode: "sandbox", window: ctx.config.window }, k: 5 },
      ctx,
      store,
    );
    expect(started.status).toBe("accepted");
    checkFrozen(store, "txn0");
    place(store, ctx, "maker", P(0, 0));
    place(store, ctx, "breaker", P(10, 0));
    place(store, ctx, "maker", P(5, 8));
  });
});
