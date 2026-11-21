// tests/engine/describe.test.ts — describer edge paths (Phase 18):
// null/empty guards, spec labels, case-data availability, overlays
// (dedup/capped/guided), threat preview, wash, effect diffs, attack-log
// nulls. Engine-driven where sessions are needed, hand states elsewhere.
import { describe, expect, it } from "vitest";
import { Rat } from "../../src/geometry/rat.ts";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { commit, startSession } from "../../src/session/commit.ts";
import { Store } from "../../src/session/store.ts";
import { reduceTransaction } from "../../src/engine/orchestrator.ts";
import type { RuntimeCtx } from "../../src/engine/orchestrator.ts";
import {
  attackLog,
  caseData,
  caseWash,
  effectDiff,
  invariantStatuses,
  nodeExplanation,
  statusBadge,
  strategyOverlays,
  threatPreview,
  winCard,
} from "../../src/engine/describe.ts";
import { registerStrategy, strategies } from "../../src/strategy/registry.ts";
import type { StrategyDef } from "../../src/strategy/types.ts";
import { ensureK5 } from "../strategies/k5driver.ts";
import { P, ensureK6 } from "../strategies/k6driver.ts";
import type { GameState } from "../../src/game/types.ts";
import { guidedState } from "../strategy/scaffolding.ts";
import { sandboxState, testCtx } from "../helpers.ts";

ensureK5();
ensureK6();

function driveK5(moves: readonly Pt[], ctx: RuntimeCtx): Store {
  const store = new Store();
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
    throw new Error("describe: k5 start rejected — test bug");
  }
  for (const at of moves) {
    const r = reduceTransaction(store.current(), { kind: "place", owner: "breaker", at }, ctx);
    if (r.status !== "accepted") {
      throw new Error("describe: placement rejected — test bug");
    }
    commit(r, { kind: "place", owner: "breaker", at }, store, ctx);
  }
  return store;
}

describe("null/empty guards", () => {
  it("sandbox and terminal states explain nothing", () => {
    const ctx = testCtx();
    expect(nodeExplanation(sandboxState([]), ctx)).toBe(null);
    expect(invariantStatuses(sandboxState([P(0, 0)]), ctx)).toEqual([]);
    expect(caseData(sandboxState([P(0, 0)]), ctx)).toBe(null);
    expect(winCard(sandboxState([P(0, 0)]))).toBe(null);
    expect(statusBadge(sandboxState([P(0, 0)]), ctx)).toBe(null);
    expect(caseWash(sandboxState([P(0, 0)]), ctx)).toEqual([]);
    expect(threatPreview(sandboxState([P(0, 0)]), ctx, P(1, 1))).toBe(null);
    expect(strategyOverlays("test:nope", sandboxState([]), ctx)).toBe(null);
  });

  it("statusBadge nulls on unknown strategies; winCard nulls off-terminal", () => {
    const ctx = testCtx();
    const ghost = guidedState([P(0, 0)], 3, "C", {}, "test:nope");
    expect(statusBadge(ghost, ctx)).toBe(null);
    const store = driveK5([P(10, 0)], ctx);
    expect(winCard(store.current())).toBe(null);
    // A parked classify node yields a map object, not null. (at
    // k5:r2:classify it is now AVAILABLE — both B2 classes are listed.)
    const cd = caseData(store.current(), ctx);
    expect(cd !== null).toBe(true);
    expect([...(cd?.cases ?? [])].sort()).toEqual(["k5:b2:convex", "k5:b2:one-interior"]);
  });

  it("pre-fail parks return pre lamps only", () => {
    const ctx = testCtx();
    // co-shoulder pre (one-interior) fails: interior p4 lies outside.
    const st = guidedState(
      [P(0, 0), P(10, 0), P(0, 10), P(20, 20)],
      5,
      "k5:r3:co-shoulder",
      { outer: ["p1", "p2", "p3"], interior: "p4" },
      "esmb-k5",
    );
    const lamps = invariantStatuses(st, ctx);
    expect(lamps.length).toBe(1);
    expect(lamps[0]?.phase).toBe("pre");
    expect(lamps[0]?.passed).toBe(false);
  });

  it("spec labels cover every invariant kind", () => {    const ctx = testCtx();
    // shared-edge-pair post on the pairing node.
    const pairing = guidedState(
      [P(0, 0), P(10, 0), P(13, 8), P(5, 13), P(-3, 8), P(5, 5)],
      6,
      "k6:pairing",
      {},
      "esmb-k6",
    );
    const lamps = invariantStatuses(pairing, ctx);
    expect(lamps.map((l) => l.id)).toContain("shared-edge-pair-4");
    // custom post with all args bound.
    const trap2 = guidedState(
      [P(0, 0), P(10, 0), P(0, 10), P(3, 3), P(5, 3)],
      5,
      "k5:r3:co-shoulder",
      { outer: ["p1", "p2", "p3"], interior: "p4", A3: "p5" },
      "esmb-k5",
    );
    const lamps2 = invariantStatuses(trap2, ctx);
    expect(lamps2.map((l) => l.id)).toContain("k5-inv:trapezoid");
  });

  it("nodeExplanation evidence names operands per spec kind", () => {
    const ctx = testCtx();
    // config-class operands from bound vars.
    const co = guidedState(
      [P(0, 0), P(10, 0), P(0, 10), P(3, 3)],
      5,
      "k5:r3:co-shoulder",
      { outer: ["p1", "p2", "p3"], interior: "p4" },
      "esmb-k5",
    );
    const expl = nodeExplanation(co, ctx);
    expect(expl !== null).toBe(true);
    const pre = expl?.evidence.find((e) => e.predicate === "config-one-interior");
    expect(pre?.operands).toBe("outer=p1,p2,p3;interior=p4");
    // custom operands resolve checker args; the failing check still cites.
    const trap = guidedState(
      [P(0, 0), P(10, 0), P(0, 10), P(3, 3), P(5, 3)],
      5,
      "k5:r3:co-shoulder",
      { outer: ["p1", "p2", "p3"], interior: "p4", A3: "p5" },
      "esmb-k5",
    );
    const expl2 = nodeExplanation(trap, ctx);
    const custom = expl2?.evidence.find((e) => e.predicate === "k5-inv:trapezoid");
    expect(custom?.operands).toBe("outer=p1,p2,p3;interior=p4;A3=p5");
    // Unresolvable custom args cite an em dash, never a guess: A3
    // unbound while the pre passes, so the post runs and fails closed.
    const noA3 = guidedState(
      [P(0, 0), P(10, 0), P(0, 10), P(3, 3)],
      5,
      "k5:r3:co-shoulder",
      { outer: ["p1", "p2", "p3"], interior: "p4" },
      "esmb-k5",
    );
    const expl3 = nodeExplanation(noA3, ctx);
    expect(expl3?.evidence.length).toBe(2);
    const customFail = expl3?.evidence.find((e) => e.predicate === "k5-inv:trapezoid");
    expect(customFail?.operands).toBe("—");
    expect(customFail?.result.startsWith("FAIL")).toBe(true);
  });

  it("region-empty specs cite an em dash (no point operands)", () => {
    const ctx = testCtx();
    const def: StrategyDef = {
      id: "test:describe-empty",
      k: 3,
      version: "0.0.0",
      source: { paper: "test", stepMap: {} },
      entry: "entry",
      nodes: {
        entry: {
          id: "entry",
          role: "maker-move",
          next: "end",
          move: { kind: "fixed", at: [{ kind: "const", x: P(0, 0).x, y: P(0, 0).y }] },
          pre: [{ kind: "region-empty-of", expr: { kind: "window" }, owner: "breaker" }],
          show: [],
          why: { headline: "t", claims: [], sourceRef: "t" },
          sourceRef: "t",
        },
        end: {
          id: "end",
          role: "terminal",
          show: [],
          why: { headline: "t", claims: [], sourceRef: "t" },
          sourceRef: "t",
        },
      },
    };
    if (!strategies().has(def.id)) {
      registerStrategy(def, "fixture");
    }
    const st = guidedState([], 3, "entry", {}, "test:describe-empty");
    const expl = nodeExplanation(st, ctx);
    const lamp = expl?.evidence.find((e) => e.predicate === "region-empty");
    expect(lamp?.operands).toBe("—");
    expect(lamp?.result.startsWith("PASS")).toBe(true);
    expect(caseData(st, ctx)).toBe(null);
  });
});

describe("case data, wash, and previews", () => {
  it("live parked nodes yield cells, samples, wash, and previews", () => {
    const ctx = testCtx();
    const store = driveK5([P(10, 0), pt(Rat.make(10n), Rat.make(9n))], ctx);
    expect(store.current().strategy?.nodeId).toBe("k5:r3:classify");
    const cd = caseData(store.current(), ctx);
    expect(cd !== null).toBe(true);
    expect(cd?.cases).toEqual(["k5:b3:blocked-intended", "k5:b3:else"]);
    expect(cd?.samples.length).toBe(cd?.cases.length);
    const wash = caseWash(store.current(), ctx);
    expect(wash.length).toBeGreaterThan(0);
    const prev = threatPreview(store.current(), ctx, P(-30, -30));
    expect(prev !== null).toBe(true);
    expect(prev?.caseId).toBe("k5:b3:else");
  });

  it("illegal preview points and maker nodes preview null", () => {
    const ctx = testCtx();
    const store = driveK5([P(10, 0)], ctx);
    expect(threatPreview(store.current(), ctx, P(0, 0))).toBe(null);
    const maker = guidedState([P(0, 0)], 5, "k5:r2:a2", {}, "esmb-k5");
    expect(threatPreview(maker, ctx, P(5, 5))).toBe(null);
    expect(caseWash(maker, ctx)).toEqual([]);
  });

  it("starved budgets wash to empty (never partial)", () => {
    const ctx = testCtx(1);
    // Rebuild with the starved ctx on the parked state.
    const base = testCtx();
    const store = driveK5([P(10, 0), pt(Rat.make(10n), Rat.make(9n))], base);
    const parked = store.current();
    const pts = [...parked.points.map((p) => p.pt), P(100, 101), P(101, 100), P(-50, -50), P(60, 62)];
    const syn: GameState = {
      ...parked,
      points: pts.map((p, i) => ({
        id: `p${i + 1}`,
        owner: (i % 2 === 0 ? "maker" : "breaker") as "maker" | "breaker",
        pt: p,
        move: i + 1,
      })),
      turn: "breaker" as const,
    };
    const cd = caseData(syn, ctx);
    expect(cd !== null).toBe(true);
    expect(cd?.cases).toEqual([]);
    expect(caseWash(syn, ctx)).toEqual([]);
  });
});

describe("overlays: dedup, capped, and guided-only", () => {
  const DEF_ID = "test:describe-overlays";

  function ensureOverlayDef(): void {
    if (strategies().has(DEF_ID)) {
      return;
    }
    const def: StrategyDef = {
      id: DEF_ID,
      k: 3,
      version: "0.0.0",
      source: { paper: "test", stepMap: {} },
      entry: "entry",
      // V is start-provided (like P5/V0..V4 on k6:boot): overlay reads see
      // a reachable producer, but sandbox states never bind it.
      startVars: ["V"],
      nodes: {
        entry: {
          id: "entry",
          role: "maker-move",
          next: "end",
          placeBind: "V",
          move: { kind: "fixed", at: [{ kind: "const", x: P(0, 0).x, y: P(0, 0).y }] },
          show: [
            { kind: "region", expr: { kind: "window" }, style: "neutral", label: "w" },
            { kind: "region", expr: { kind: "window" }, style: "neutral", label: "w" },
            { kind: "region", expr: { kind: "holes", k: 5 } , style: "neutral", label: "h" },
            {
              kind: "region",
              expr: { kind: "hull", of: { kind: "var", v: "V" } },
              style: "neutral",
              label: "u",
            },
            { kind: "strip", strip: { stripId: "s1" } },
            { kind: "case-map" },
          ],
          why: { headline: "t", claims: [], sourceRef: "t" },
          sourceRef: "t",
        },
        end: {
          id: "end",
          role: "terminal",
          show: [],
          why: { headline: "t", claims: [], sourceRef: "t" },
          sourceRef: "t",
        },
      },
    };
    registerStrategy(def, "fixture", { strips: new Map([["s1", {}]]) });
  }

  it("dedups, caps, and marks guided-only overlays", () => {
    ensureOverlayDef();
    const base = testCtx();
    const capped = {
      ...base,
      config: { ...base.config, analysis: { budgetOps: 10 } },
    };
    const six = sandboxState([P(0, 0), P(10, 0), P(10, 10), P(0, 10), P(5, 5), P(20, 20)]);
    const ovs = strategyOverlays(DEF_ID, six, capped);
    expect(ovs !== null).toBe(true);
    if (ovs === null) {
      throw new Error("unreachable");
    }
    // Two identical window overlays collapse to one; holes-k caps under
    // the starved budget; the unbound-var overlay needs a live session.
    const byLabel = new Map(ovs.map((o) => [o.label, o]));
    expect(byLabel.has("w")).toBe(true);
    expect(ovs.filter((o) => o.label === "w").length).toBe(1);
    expect(byLabel.get("h")?.skipped).toContain("capped");
    expect(byLabel.has("u")).toBe(true);
    expect(byLabel.get("u")?.skipped).toContain("guided");
  });
});

describe("effectDiff + attackLog", () => {
  it("k=3 states skip the sub-hole size; capped budgets fail closed", () => {
    const before = sandboxState([P(0, 0)]);
    const after = sandboxState([P(0, 0), P(10, 0), P(5, 8)]);
    const r = effectDiff(before, after, 3, "p3", testCtx().config.analysis.budgetOps);
    expect(r.available).toBe(true);
    const six = sandboxState([P(0, 0), P(10, 0), P(10, 10), P(0, 10), P(5, 5), P(20, 20)]);
    const capped = effectDiff(six, six, 5, "p6", 0);
    expect(capped.available).toBe(false);
    if (!capped.available) {
      expect(capped.reason).toContain("capped");
    }
  });

  it("blunder game diffs carry the win; attackLog counts it", () => {
    const ctx = testCtx();
    const store = driveK5([P(10, 0), P(30, 5)], ctx);
    const cur = store.current();
    expect(cur.terminal?.kind).toBe("maker-won");
    const before = store.stateAtTxn(1);
    const diff = effectDiff(before, cur, 5, "p5", ctx.config.analysis.budgetOps);
    expect(diff.available).toBe(true);
    if (diff.available) {
      expect(diff.movedId).toBe("p5");
      expect(diff.sizes.length).toBeGreaterThan(0);
    }
    const log = attackLog(store.tree(), (id) => store.stateAtTxn(id), ctx.config.analysis.budgetOps);
    expect(log !== null).toBe(true);
    expect(log?.summary.wins).toBe(1);
    expect(log?.entries.length).toBe(2);
  });

  it("sandbox trees log null", () => {    const store = new Store();
    const ctx = testCtx();
    const started = startSession(
      { kind: "sandbox", config: { mode: "sandbox", window: ctx.config.window }, k: 5 },
      ctx,
      store,
    );
    expect(started.status).toBe("accepted");
    expect(
      attackLog(store.tree(), (id) => store.stateAtTxn(id), ctx.config.analysis.budgetOps),
    ).toBe(null);
  });

  it("uncovered terminals count; starved diffs disclaim", () => {
    const ctx = testCtx();
    const corner = {
      ...ctx.config,
      window: {
        xMin: Rat.make(0n),
        yMin: Rat.make(0n),
        xMax: Rat.make(20n),
        yMax: Rat.make(28n),
      },
    };
    const cctx: RuntimeCtx = { ...ctx, config: corner };
    const store = new Store();
    const started = startSession(
      {
        kind: "guided",
        config: { mode: "break", window: corner.window },
        strategyId: "esmb-k5",
        mode: "break",
      },
      cctx,
      store,
    );
    expect(started.status).toBe("accepted");
    for (const at of [P(0, 28), P(20, 0)]) {
      const r = reduceTransaction(store.current(), { kind: "place", owner: "breaker", at }, cctx);
      if (r.status !== "accepted") {
        throw new Error("test bug");
      }
      commit(r, { kind: "place", owner: "breaker", at }, store, cctx);
    }
    expect(store.current().terminal?.kind).toBe("uncovered");
    const log = attackLog(
      store.tree(),
      (id) => store.stateAtTxn(id),
      cctx.config.analysis.budgetOps,
    );
    expect(log?.summary.uncovered).toBe(1);
    expect(log?.summary.wins).toBe(0);
    // Starved budgets disclaim the diff instead of counting holes: the
    // safe game's final transaction spans 5→7 points (estimate > 0).
    const safe = driveK5([P(10, 0), pt(Rat.make(10n), Rat.make(9n)), P(-30, -30)], ctx);
    const thin = attackLog(
      safe.tree(),
      (id) => safe.stateAtTxn(id),
      0,
    );
    expect(thin !== null).toBe(true);
    expect(
      (thin?.entries[2]?.claims ?? []).some((c) => c.text.includes("capped")),
    ).toBe(true);
  });
});
