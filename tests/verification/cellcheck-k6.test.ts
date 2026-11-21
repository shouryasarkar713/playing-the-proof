// tests/verification/cellcheck-k6.test.ts — the §24.7 item 7 k=6 checks
// (Phase 16, Gate C6): B0-space (routing totality + 5-hole existence
// exhaustive over FULL-bootstrap cells; extension representative-
// confirmed), B1-space (5-hole existence exhaustive over FULL after-A1
// cells), and the 7c escape-convention representative check (full
// route-B pipeline per forced-region cell + twin post-condition).
// Every check-owned enumeration carries its explicit
// estimateHoleWork(n,k) budget. On pass the checks are recorded and
// esmb-k6's derived status upgrades to verified-conventions (whose scope
// excludes the escape convention's universality — §24.3 status block).
import { describe, expect, it } from "vitest";
import type { Pt } from "../../src/geometry/pt.ts";
import { commit, startSession } from "../../src/session/commit.ts";
import { Store } from "../../src/session/store.ts";
import { reduceTransaction } from "../../src/engine/orchestrator.ts";
import type { RuntimeCtx } from "../../src/engine/orchestrator.ts";
import type { GameState, PointId } from "../../src/game/types.ts";
import type { IdPt } from "../../src/geometry/holes.ts";
import { evalRegion } from "../../src/strategy/eval.ts";
import {
  esmbK6,
  forcedExpr,
} from "../../src/strategy/strategies/k6/def.ts";
import {
  cellCheckToValidation,
  checkTwinWitnesses,
  forcedCellReps,
  k6B0Check,
  k6B1Check,
} from "../../src/verification/cellchecks.ts";
import type { CellCheckReport } from "../../src/verification/cellchecks.ts";
import {
  effectiveStatus,
  recordValidationCheck,
  strategies,
} from "../../src/strategy/registry.ts";
import type { ValidationCheck } from "../../src/strategy/registry.ts";
import { P, centroidOf, ensureK6, forcedRegion } from "../strategies/k6driver.ts";
import { testCtx } from "../helpers.ts";

ensureK6();

const PENT = [P(0, 0), P(10, 0), P(13, 8), P(5, 13), P(-3, 8)];
const MULTI7 = [...PENT, P(100, 101), P(101, 100)];

function boot(
  points: Pt[],
  selectedHole: Pt[],
  ctx: RuntimeCtx,
): Store {
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
    throw new Error("cellcheck-k6: bootstrap rejected — test bug");
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
    throw new Error("cellcheck-k6: placement rejected — test bug");
  }
  commit(r, { kind: "place", owner: "breaker", at }, store, ctx);
  return store.current();
}

// Route-B to the after-A1 state (parked at k6:r5:classify).
function routeB(points: Pt[], selectedHole: Pt[], ctx: RuntimeCtx): GameState {
  const store = boot(points, selectedHole, ctx);
  const cur0 = store.current();
  const p5 = (cur0.strategy?.vars["P5"] as string[]).map(
    (id) => cur0.points.find((p) => p.id === id)?.pt as Pt,
  );
  const cur = breaker(store, ctx, centroidOf(forcedRegion(p5)));
  if (cur.strategy?.nodeId !== "k6:r5:classify") {
    throw new Error("cellcheck-k6: route-B missed — test bug");
  }
  return cur;
}

describe("k=6 B0-space check (§24.7 item 7b, Gate C6)", () => {
  it("preset5 + multi7 bootstraps: routing total + 5-holes exist + extensions land", () => {
    const ctx = testCtx();
    const runs: Array<{ name: string; boot: Pt[]; report: CellCheckReport }> = [];
    for (const [name, bootPts] of [
      ["preset5", PENT],
      ["multi7", MULTI7],
    ] as const) {
      const store = boot([...bootPts], PENT, ctx);
      const r = k6B0Check(
        esmbK6,
        "k6:boot",
        store.current(),
        ctx.config.window,
        ctx.config,
        `play window ±1000000; supplied bootstrap ${name} (|F|=${bootPts.length}); F = full bootstrap set`,
      );
      expect(r.result).toBe("PASS");
      runs.push({ name, boot: [...bootPts], report: r });
    }
    expect(runs[0]?.report.cells).toBe(40);
    expect(runs[1]?.report.cells).toBe(161);
    const parts = runs.map(
      (w) => `${w.name} (|F|=${w.boot.length}, ${w.report.cells} cells, ${w.report.checked} checked)`,
    );
    const recorded: ValidationCheck = {
      id: "exact:b0-cell",
      scope: `play window ±1000000; boot corpus {${parts.join("; ")}}; F = full bootstrap set per configuration (never the 5-hole subset)`,
      configOrSeed: "preset5+multi7",
      result: "PASS",
    };
    recordValidationCheck("esmb-k6", recorded);
  }, 300000);
});

describe("k=6 B1-space check (§24.7 item 7a, Gate C6)", () => {
  it("route-B after-A1 state: every cell keeps a 5-hole", () => {
    const ctx = testCtx();
    const cur = routeB(PENT, PENT, ctx);
    const afterA1 = cur.points.map((p) => p.pt);
    expect(afterA1.length).toBe(7);
    const r = k6B1Check(
      afterA1,
      ctx.config.window,
      "play window ±1000000; route-B after-A1 state from PENT (|F|=7); F = bootstrap ∪ {B0, A1}",
    );
    expect(r.result).toBe("PASS");
    expect(r.cells).toBe(159);
    expect(r.checked).toBe(r.cells);
    recordValidationCheck("esmb-k6", cellCheckToValidation(r));
  }, 300000);
});

describe("k=6 escape-convention representatives (§24.7 item 7c, Gate C6)", () => {
  it("per forced-region cell: full route-B pipeline + twin post-condition", () => {
    const ctx = testCtx();
    const bootStore = boot(PENT, PENT, ctx);
    const evaled = evalRegion(forcedExpr, {
      state: bootStore.current(),
      config: ctx.config,
      channel: "correctness",
    });
    if (evaled.kind !== "complete") {
      throw new Error("cellcheck-k6: forced region evaluates incomplete — test bug");
    }
    // Intersect-of-hulls canonicalizes to a union; the forced zone is the
    // single convex part (asserted — never silently picked).
    const parts =
      evaled.region.kind === "poly"
        ? [evaled.region]
        : evaled.region.parts.filter((p) => p.kind === "poly");
    if (parts.length !== 1 || parts[0]?.kind !== "poly") {
      throw new Error(
        `cellcheck-k6: forced region is not a single poly (${parts.length} parts) — test bug`,
      );
    }
    const { cells, inside, reps } = forcedCellReps(
      PENT,
      (parts[0] as { kind: "poly"; verts: readonly import("../../src/geometry/pt.ts").Pt[] }).verts,
      ctx.config.window,
    );
    expect(cells).toBe(40);
    expect(inside).toBeGreaterThan(0);
    let checked = 0;
    for (const rep of reps) {
      const store = boot(PENT, PENT, ctx);
      const cur = breaker(store, ctx, rep);
      if (cur.strategy?.nodeId !== "k6:r5:classify") {
        throw new Error(
          `cellcheck-k6: forced-region representative routed to ${cur.strategy?.nodeId} — corpus defect`,
        );
      }
      const a1 = cur.strategy?.vars["A1"] as PointId | undefined;
      if (typeof a1 !== "string") {
        throw new Error("cellcheck-k6: A1 unbound after route-B — test bug");
      }
      const all: IdPt[] = cur.points.map((p) => ({ id: p.id, pt: p.pt }));
      const twin = checkTwinWitnesses(all, a1);
      if (!twin.ok) {
        throw new Error(`cellcheck-k6: twin post-condition failed — ${twin.detail}`);
      }
      checked += 1;
    }
    expect(checked).toBe(inside);
    recordValidationCheck("esmb-k6", {
      id: "rep:escape",
      scope:
        `play window ±1000000; forced-region cells of PENT (${cells} arrangement cells, ` +
        `${inside} strictly inside, ${checked} pipelines run); full deterministic route-B ` +
        `pipeline per representative + twin post-condition (two 5-holes sharing exactly 3 ` +
        `vertices incl A1); representative-confirmed — universality over the forced region ` +
        `is NOT established (§24.3 status block)`,
      configOrSeed: "preset5-centroid-B0-route",
      result: "PASS",
    });
  }, 300000);
});

describe("Gate C6 promotion", () => {
  it("recorded passes derive verified-conventions", () => {
    const rs = strategies().get("esmb-k6");
    expect(rs !== undefined).toBe(true);
    if (rs === undefined) {
      throw new Error("unreachable");
    }
    const ids = rs.validation.checks.map((c) => c.id);
    expect(ids).toContain("exact:b0-cell");
    expect(ids).toContain("exact:b1-cell");
    expect(ids).toContain("rep:escape");
    expect(effectiveStatus(rs)).toBe("verified-conventions");
  });
});
