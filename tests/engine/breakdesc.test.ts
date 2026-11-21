// tests/engine/breakdesc.test.ts — engine-tier coverage for the Break-mode
// describers (§12): threatPreview (exact hypo-routing), caseWash,
// effectDiff, attackLog (+ JSON round-trip).
import { describe, expect, it } from "vitest";
import { pt } from "../../src/geometry/pt.ts";
import { Rat } from "../../src/geometry/rat.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import {
  attackLog,
  caseWash,
  effectDiff,
  threatPreview,
} from "../../src/engine/describe.ts";
import { commit, startSession } from "../../src/session/commit.ts";
import { Store } from "../../src/session/store.ts";
import { reduceTransaction } from "../../src/engine/orchestrator.ts";
import type { RuntimeCtx } from "../../src/engine/orchestrator.ts";
import type { GameState } from "../../src/game/types.ts";
import { P } from "../strategy/scaffolding.ts";
import { testCtx } from "../helpers.ts";
import { ensureK5 } from "../strategies/k5driver.ts";

ensureK5();

const rat = (n: number, d = 1) => Rat.make(BigInt(n), BigInt(d));

function launch(): { store: Store; ctx: RuntimeCtx } {
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
  return { store, ctx };
}

function breaker(store: Store, ctx: RuntimeCtx, at: Pt): void {
  const r = reduceTransaction(
    store.current(),
    { kind: "place", owner: "breaker", at },
    ctx,
  );
  expect(r.status).toBe("accepted");
  if (r.status !== "accepted") {
    throw new Error("unreachable");
  }
  commit(r, { kind: "place", owner: "breaker", at }, store, ctx);
}

function parkedR2(): { store: Store; ctx: RuntimeCtx; state: GameState } {
  const { store, ctx } = launch();
  breaker(store, ctx, P(10, 0));
  const state = store.current();
  expect(state.strategy?.nodeId).toBe("k5:r2:classify");
  return { store, ctx, state };
}

describe("threatPreview", () => {
  it("names the exact case + target headline for interior and wedge points", () => {
    const { ctx, state } = parkedR2();
    const inside = threatPreview(state, ctx, pt(rat(10), rat(9)));
    expect(inside?.caseId).toBe("k5:b2:one-interior");
    expect(inside?.targetHeadline).toBe("The co-shoulder trapezoid.");
    const wedge = threatPreview(state, ctx, P(10, -10));
    expect(wedge?.caseId).toBe("k5:b2:one-interior");
    const convex = threatPreview(state, ctx, P(30, 5));
    expect(convex?.caseId).toBe("k5:b2:convex");
  });

  it("null outside classify parks, at terminals, and for illegal points", () => {
    const { store, ctx } = launch();
    const init = store.current();
    // await-b1 IS a classify park (catch-all): preview names k5:any.
    expect(threatPreview(init, ctx, P(10, 0))?.caseId).toBe("k5:any");
    // Illegal point (coincides): null, the ghost covers it.
    expect(threatPreview(init, ctx, P(0, 0))).toBe(null);
    // Terminal: null.
    breaker(store, ctx, P(10, 0));
    breaker(store, ctx, pt(rat(10), rat(9)));
    breaker(store, ctx, P(-30, -30));
    expect(store.current().terminal?.kind).toBe("maker-won");
    expect(threatPreview(store.current(), ctx, P(99, 99))).toBe(null);
  });
});

describe("caseWash", () => {
  it("empty where classifier inputs cannot resolve yet; full at r3:classify", () => {
    const { store, ctx } = launch();
    breaker(store, ctx, P(10, 0));
    // r2:classify ( fix): classifyFour's `last-n 4` names the pending B2;
    // the cells are computed in the post-placement frame (stand-in point,
    // lines through it discarded): the 3 pair-lines of A1,B1,A2 ⇒ 7 cells.
    expect(caseWash(store.current(), ctx).length).toBe(7);
    breaker(store, ctx, pt(rat(10), rat(9)));
    // r3:classify: classifyB3 resolves on the current five points.
    const wash = caseWash(store.current(), ctx);
    expect(wash.length).toBeGreaterThan(0);
    for (const cell of wash) {
      expect(typeof cell.caseId).toBe("string");
      expect(cell.poly.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("effectDiff + attackLog", () => {
  it("diffs the B2 txn; log entries carry tiered claims and summaries", () => {
    const { store, ctx } = launch();
    breaker(store, ctx, P(10, 0));
    const before = store.current();
    breaker(store, ctx, pt(rat(10), rat(9)));
    const after = store.current();
    const diff = effectDiff(before, after, 5, "p4", ctx.config.analysis.budgetOps);
    expect(diff.available).toBe(true);
    if (diff.available) {
      // k=5: 4-holes active at the B2 txn; the all-empty 5-hole size is skipped.
      expect(diff.sizes.map((s) => s.size)).toEqual([4]);
      const four = diff.sizes.find((s) => s.size === 4);
      expect(four !== undefined).toBe(true);
    }
    const log = attackLog(store.tree(), (id) => store.stateAtTxn(id), ctx.config.analysis.budgetOps);
    expect(log !== null).toBe(true);
    expect(log?.strategyId).toBe("esmb-k5");
    expect(log?.entries.length).toBe(2);
    expect(log?.entries[0]?.caseId).toBe("k5:any");
    expect(log?.entries[1]?.caseId).toBe("k5:b2:one-interior");
    for (const entry of log?.entries ?? []) {
      expect(entry.claims.length).toBeGreaterThan(0);
      for (const claim of entry.claims) {
        expect(claim.tier).toBe("observed");
      }
    }
    expect(log?.summary.classified).toBe(2);
    expect(log?.summary.byCase).toEqual({ "k5:any": 1, "k5:b2:one-interior": 1 });
    // Export shape: JSON round-trip with parseable rationals.
    const wire = JSON.parse(JSON.stringify(log)) as NonNullable<typeof log>;
    expect(wire.format).toBe("esmb-attack-log");
    expect(wire.version).toBe(1);
    for (const entry of wire.entries) {
      expect(Rat.fromString(entry.point.x) !== null).toBe(true);
    }
  });
});
