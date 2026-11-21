// tests/verification/partition.test.ts — §22.6 effective-partition checks
// (Phase 16, task 1): every arrangement piece — 2D cell, 1D segment, 0D
// point — is assigned a case, and direct first-match evaluation agrees
// with classify() at each representative. Classifier-routed nodes go
// through their registered boundaries(); k5:r2:classify's partition
// evidence is the §23.2 totality check (its last-n-4 inputs resolve only
// on 4-point states, so no parked-state arrangement exists for it).
import { describe, expect, it } from "vitest";
import { Rat } from "../../src/geometry/rat.ts";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { gp } from "../../src/geometry/predicates.ts";
import { commit, startSession } from "../../src/session/commit.ts";
import { Store } from "../../src/session/store.ts";
import { reduceTransaction } from "../../src/engine/orchestrator.ts";
import type { GameState } from "../../src/game/types.ts";
import {
  checkClassifyFourTotality,
  checkNodePartition,
  checkToValidation,
  totalityToValidation,
} from "../../src/verification/partition.ts";
import type { FourConfig } from "../../src/verification/partition.ts";
import {
  recordValidationCheck,
  strategies,
} from "../../src/strategy/registry.ts";
import { esmbK5 } from "../../src/strategy/strategies/k5/def.ts";
import { esmbK6 } from "../../src/strategy/strategies/k6/def.ts";
import { ensureK5 } from "../strategies/k5driver.ts";
import { P, centroidOf, ensureK6, forcedRegion } from "../strategies/k6driver.ts";
import { mulberry32, testCtx } from "../helpers.ts";

ensureK5();
ensureK6();

const PENT = [P(0, 0), P(10, 0), P(13, 8), P(5, 13), P(-3, 8)];

function place(store: Store, ctx: ReturnType<typeof testCtx>, at: Pt): void {
  const r = reduceTransaction(
    store.current(),
    { kind: "place", owner: "breaker", at },
    ctx,
  );
  if (r.status !== "accepted") {
    throw new Error("partition: placement rejected — test bug");
  }
  commit(r, { kind: "place", owner: "breaker", at }, store, ctx);
}

function bootK6(points: Pt[], selectedHole: Pt[]): { store: Store; ctx: ReturnType<typeof testCtx> } {
  const store = new Store();
  const ctx = testCtx();
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
    throw new Error("partition: k6 bootstrap rejected — test bug");
  }
  return { store, ctx };
}

// Parked at k5:r3:classify over the safe-integer playbook (5 points).
function parkK5R3(): { store: Store; ctx: ReturnType<typeof testCtx> } {
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
  if (started.status !== "accepted") {
    throw new Error("partition: k5 start rejected — test bug");
  }
  place(store, ctx, P(10, 0));
  place(store, ctx, pt(Rat.make(10n), Rat.make(9n)));
  const cur = store.current();
  if (cur.strategy?.nodeId !== "k5:r3:classify") {
    throw new Error("partition: not parked at k5:r3:classify — test bug");
  }
  return { store, ctx };
}

// Route-B to the after-A1 state (parked at k6:r5:classify, twins bound).
function routeB(): { store: Store; ctx: ReturnType<typeof testCtx> } {
  const { store, ctx } = bootK6(PENT, PENT);
  const cur0 = store.current();
  const p5 = (cur0.strategy?.vars["P5"] as string[]).map(
    (id) => cur0.points.find((p) => p.id === id)?.pt as Pt,
  );
  place(store, ctx, centroidOf(forcedRegion(p5)));
  const cur = store.current();
  if (cur.strategy?.nodeId !== "k6:r5:classify") {
    throw new Error("partition: route-B did not park at k6:r5:classify — test bug");
  }
  return { store, ctx };
}

describe("effective partition: k6:boot (region-routed, nested by design)", () => {
  it("every piece assigned; direct agrees with classify(); all three routes hit", () => {
    const { store, ctx } = bootK6(PENT, PENT);
    const scope =
      "play window ±1000000; supplied preset pentagon PENT (5 pts); 10 P5 pair-lines";
    const r = checkNodePartition(esmbK6, "k6:boot", store.current(), ctx.config, scope);
    expect(r.result).toBe("PASS");
    expect(r.cells).toBe(40);
    expect(r.cases).toEqual([
      "k6:b0:inside-forced",
      "k6:b0:inside-h5",
      "k6:b0:outside-h5",
    ]);
    recordValidationCheck("esmb-k6", checkToValidation(r));
  });
});

describe("effective partition: k5:await-b1 (catch-all only)", () => {
  it("the whole window is one effective cell", () => {
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
    if (started.status !== "accepted") {
      throw new Error("partition: k5 start rejected — test bug");
    }
    const scope = "play window ±1000000; init state (A1 only); no boundary lines";
    const r = checkNodePartition(esmbK5, "k5:await-b1", store.current(), ctx.config, scope);
    expect(r.result).toBe("PASS");
    expect(r.cells).toBe(1);
    expect(r.cases).toEqual(["k5:any"]);
    recordValidationCheck("esmb-k5", checkToValidation(r));
  });
});

describe("effective partition: k5:r3:classify (classifier-routed via boundaries())", () => {
  it("every piece assigned; both cases hit", () => {
    const { store, ctx } = parkK5R3();
    const scope =
      "play window ±1000000; safe-integer playbook at B3-time (5 pts); classifyB3 boundaries()";
    const r = checkNodePartition(
      esmbK5,
      "k5:r3:classify",
      store.current(),
      ctx.config,
      scope,
    );
    expect(r.result).toBe("PASS");
    expect(r.cases).toEqual(["k5:b3:blocked-intended", "k5:b3:else"]);
    recordValidationCheck("esmb-k5", checkToValidation(r));
  });

  it("FAILS closed under a deliberately insufficient budget (never a pass on partial data)", () => {
    const { store } = parkK5R3();
    // A synthetic 9-point state at the same node: the pre-B3 8-point
    // k=4 sweep (accounted cost 1120) cannot complete under budgetOps=1,
    // so boundaries() returns integrity — the check must fail with the
    // typed report, never pass, never omit lines.
    const parked = store.current();
    const extra = [P(100, 101), P(101, 100), P(-50, -50), P(60, 62)];
    const pts = [...parked.points.map((p) => p.pt), ...extra];
    const syn: GameState = {
      ...parked,
      points: pts.map((p, i) => ({
        id: `p${i + 1}`,
        owner: i % 2 === 0 ? "maker" : "breaker",
        pt: p,
        move: i + 1,
      })),
      turn: "breaker",
    };
    const tiny = testCtx(1);
    const r = checkNodePartition(
      esmbK5,
      "k5:r3:classify",
      syn,
      tiny.config,
      "synthetic 9-point state (fail-closed probe); budgetOps=1",
    );
    expect(r.result).toBe("BUDGET_EXCEEDED");
    expect(r.detail).toContain("budget-exhausted");
    expect(r.witness?.fixture).toContain("k5:r3:classify");
  });
});

describe("effective partition: k6:r5:classify (classifier-routed via boundaries())", () => {
  it("every piece assigned; direct agrees with classify()", () => {
    const { store, ctx } = routeB();
    const scope =
      "play window ±1000000; route-B after-A1 state (preset pentagon, 7 pts); classifyB1 boundaries()";
    const r = checkNodePartition(
      esmbK6,
      "k6:r5:classify",
      store.current(),
      ctx.config,
      scope,
    );
    expect(r.result).toBe("PASS");
    expect(r.cases).toEqual([
      "k6:b1:inside-shared-triangle",
      "k6:b1:inside-twin",
      "k6:b1:else",
    ]);
    recordValidationCheck("esmb-k6", checkToValidation(r));
  });
});

describe("k5:r2:classify totality (§23.2 theorem form)", () => {
  // Hand fixtures: inside-triangle, convex, and the true swallow wedge
  // (B1=(10,0), B2=(10,-10): B1 swallowed — the Phase-11 wedge walk).
  const fixtures: FourConfig[] = [
    {
      pts: [P(0, 0), P(20, 0), P(0, 20), P(2, 2)],
      note: "inside-triangle (B2 strictly inside)",
    },
    {
      pts: [P(0, 0), P(10, 0), P(13, 8), P(5, 13)],
      note: "convex (pentagon prefix)",
    },
    {
      pts: [P(0, 0), P(10, 0), P(20, 28), P(10, -10)],
      note: "swallow wedge (B1 swallowed by B2 outside)",
    },
    {
      pts: [P(0, 0), P(10, 0), P(10, 9), P(30, 5)],
      note: "convex control (blunder shape)",
    },
  ];

  function randomQuads(seed: number, n: number): FourConfig[] {
    const rand = mulberry32(seed);
    const out: FourConfig[] = [];
    let guard = 0;
    while (out.length < n && guard < 50 * n) {
      guard += 1;
      const q: Pt[] = [];
      for (let i = 0; i < 4; i += 1) {
        q.push(P(Math.floor(rand() * 61) - 30, Math.floor(rand() * 61) - 30));
      }
      if (!gp(q)) {
        continue;
      }
      out.push({ pts: q as [Pt, Pt, Pt, Pt], note: `seeded quad ${seed}:${out.length}` });
    }
    if (out.length < n) {
      throw new Error("partition: quad sampling failed — test bug");
    }
    return out;
  }

  it("fixtures + 300 seeded GP quads all decide with the independent tag", () => {
    const configs = [...fixtures, ...randomQuads(20260927, 300)];
    const r = checkClassifyFourTotality(
      configs,
      "4 hand fixtures + 300 seeded GP quads (seed 20260927, box ±30)",
    );
    expect(r.result).toBe("PASS");
    expect(r.configs).toBe(304);
    recordValidationCheck("esmb-k5", totalityToValidation(r));
  });

  it("records are visible in the registry report", () => {
    const rs = strategies().get("esmb-k5");
    expect(rs !== undefined).toBe(true);
    const ids = rs?.validation.checks.map((c) => c.id) ?? [];
    expect(ids).toContain("route-partition:k5:await-b1");
    expect(ids).toContain("route-partition:k5:r3:classify");
    expect(ids).toContain("route-partition:k5:r2:classify");
  });
});
