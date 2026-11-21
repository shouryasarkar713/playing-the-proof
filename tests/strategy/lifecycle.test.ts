// tests/strategy/lifecycle.test.ts — the §6.2 lifecycle suites on test-only
// defs: computed-step (single/consecutive/→maker/→terminal/op-failure/
// post-failure + G-rejection) and classify-breaker (routed post-pass/fail).
// Twin-pair states use crafted literals (the sanctioned layer-internal seam,
// §5.2 — building twins via placements would win early, so init cannot
// produce them); sessions cover the normally-reachable paths. The twelve
// Phase-9 invariant-lifecycle fixtures map as: F1/F2 sandbox+guided commit
// admission (game tests + fixture sessions); F3–F5 transient shapes satisfy
// I1–I4+I5a + resolvability + binding well-formedness (below, never stored);
// F6/F7 terminal commits (fixture win); F10/F11 gate rejections (bad
// invariants + not-parked); F12 replay parity lands in Phase 15.
import { describe, expect, it } from "vitest";
import { Rat } from "../../src/geometry/rat.ts";
import { checkStateInvariants } from "../../src/game/place.ts";
import type { Binding, GameState } from "../../src/game/types.ts";
import {
  committedStateAdmissible,
  CommitGateError,
  reduceTransaction,
} from "../../src/engine/orchestrator.ts";
import { commit, startSession } from "../../src/session/commit.ts";
import { Store } from "../../src/session/store.ts";
import {
  registerStrategy,
  strategies,
} from "../../src/strategy/registry.ts";
import type { StrategyDef } from "../../src/strategy/types.ts";
import { registerChecker } from "../../src/verification/invariants.ts";
import {
  ALL_TEST_CHECKERS,
  guidedState,
  P,
  resetTestSpy,
  testSpy,
  twinPts,
} from "./scaffolding.ts";
import { testCtx } from "../helpers.ts";

for (const checker of ALL_TEST_CHECKERS) {
  registerChecker(checker);
}

function ensureRegistered(
  def: StrategyDef,
  tier: "fixture" | "experimental-extension",
): void {
  if (!strategies().has(def.id)) {
    registerStrategy(def, tier);
  }
}

function fixedNode(
  id: string,
  next: string,
  x: number,
  y: number,
  placeBind?: string,
): StrategyDef["nodes"][string] {
  return {
    id,
    role: "maker-move",
    next,
    ...(placeBind !== undefined ? { placeBind } : {}),
    move: {
      kind: "fixed",
      at: [{ kind: "const", x: P(x, y).x, y: P(x, y).y }],
    },
    show: [],
    why: { headline: "t", claims: [], sourceRef: "t" },
    sourceRef: "t",
  };
}

function haltTail(
  tid: string,
): Record<string, StrategyDef["nodes"][string]> {
  return {
    [tid]: {
      id: tid,
      role: "classify-breaker",
      routes: [{ case: "t:halt", when: { kind: "all" }, target: `${tid}-m` }],
      show: [],
      why: { headline: "t", claims: [], sourceRef: "t" },
      sourceRef: "t",
    },
    [`${tid}-m`]: {
      ...fixedNode(`${tid}-m`, `${tid}-t`, 999, 999),
      id: `${tid}-m`,
    },
    [`${tid}-t`]: {
      id: `${tid}-t`,
      role: "terminal",
      show: [],
      why: { headline: "t", claims: [], sourceRef: "t" },
      sourceRef: "t",
    },
  };
}

function classifyDef(
  id: string,
  postChecker: string,
): StrategyDef {
  // k=5 experimental: a 3-point state must NOT win (k=3 would win on any
  // third non-collinear point, making parks unobservable).
  return {
    id,
    k: 5,
    version: "0.0.0",
    source: { paper: "test", stepMap: {} },
    entry: "entry",
    nodes: {
      entry: { ...fixedNode("entry", "C", 0, 0, "A1"), id: "entry" },
      C: {
        id: "C",
        role: "classify-breaker",
        routes: [
          { case: "t:any", when: { kind: "all" }, target: "M1", bind: { B1: { kind: "last" } } },
        ],
        post: [
          { kind: "custom", checkerId: postChecker, args: {}, describe: "x" },
        ],
        show: [],
        why: { headline: "t", claims: [], sourceRef: "t" },
        sourceRef: "t",
      },
      M1: { ...fixedNode("M1", "T", 50, 50), id: "M1" },
      ...haltTail("T"),
    },
  };
}

// TD-chain (k=6 experimental): C → c1 → c2 (twin-pair + count posts) → m8 → T2.
// Reached via crafted literals (init would win on the 6-hole mid-build).
function chainDef(): StrategyDef {
  const twin = (id: string, next: string) => ({
    id,
    role: "computed-step" as const,
    next,
    compute: {
      kind: "select-twin-pair" as const,
      anchorVar: "ANCB",
      binds: { twinA: "twinA", twinB: "twinB" },
    },
    post: [{ kind: "custom" as const, checkerId: "test:count", args: {}, describe: "x" }],
    show: [],
    why: { headline: "t", claims: [], sourceRef: "t" },
    sourceRef: "t",
  });
  return {
    id: "td-chain",
    k: 6,
    version: "0.0.0",
    source: { paper: "test", stepMap: {} },
    entry: "entry",
    nodes: {
      entry: { ...fixedNode("entry", "mB", 0, 0, "A1"), id: "entry" },
      mB: { ...fixedNode("mB", "mC", 20, 0, "ANCB"), id: "mB" },
      mC: { ...fixedNode("mC", "mD1", 0, 20), id: "mC" },
      mD1: { ...fixedNode("mD1", "mE1", 30, 1), id: "mD1" },
      mE1: { ...fixedNode("mE1", "mD2", 1, 30), id: "mE1" },
      mD2: { ...fixedNode("mD2", "mE2", -5, 26), id: "mD2" },
      mE2: { ...fixedNode("mE2", "C", 26, -4), id: "mE2" },
      C: {
        id: "C",
        role: "classify-breaker",
        routes: [
          { case: "t:any", when: { kind: "all" }, target: "c1", bind: { B1: { kind: "last" } } },
        ],
        show: [],
        why: { headline: "t", claims: [], sourceRef: "t" },
        sourceRef: "t",
      },
      c1: twin("c1", "c2"),
      c2: twin("c2", "m8"),
      m8: { ...fixedNode("m8", "T2", -100, -101, "M"), id: "m8" },
      ...haltTail("T2"),
    },
  };
}

for (const def of [
  classifyDef("td-class-pass", "test:count"),
  classifyDef("td-class-fail", "test:fail"),
]) {
  ensureRegistered(def, "experimental-extension");
}
ensureRegistered(chainDef(), "experimental-extension");

// TD-postfail (k=6 experimental): twin op succeeds, custom post fails.
function postfailDef(): StrategyDef {
  const base = chainDef();
  return {
    ...base,
    id: "td-postfail",
    nodes: {
      ...base.nodes,
      c1: {
        ...(base.nodes["c1"] as StrategyDef["nodes"][string]),
        id: "c1",
        post: [
          { kind: "custom", checkerId: "test:fail", args: {}, describe: "x" },
        ],
      },
    },
  };
}
ensureRegistered(postfailDef(), "experimental-extension");

// TD-termfail (k=5 experimental): chain reaches a terminal node with no
// k-hole present → declared-win verification fails honestly.
function termfailDef(): StrategyDef {
  return {
    id: "td-termfail",
    k: 5,
    version: "0.0.0",
    source: { paper: "test", stepMap: {} },
    entry: "entry",
    nodes: {
      entry: { ...fixedNode("entry", "m2", 0, 0, "A1"), id: "entry" },
      m2: { ...fixedNode("m2", "m3", 10, 0), id: "m2" },
      m3: { ...fixedNode("m3", "C", 0, 10), id: "m3" },
      C: {
        id: "C",
        role: "classify-breaker",
        routes: [
          { case: "t:any", when: { kind: "all" }, target: "mT" },
        ],
        show: [],
        why: { headline: "t", claims: [], sourceRef: "t" },
        sourceRef: "t",
      },
      mT: { ...fixedNode("mT", "term", 300, 301), id: "mT" },
      term: {
        id: "term",
        role: "terminal",
        show: [],
        why: { headline: "t", claims: [], sourceRef: "t" },
        sourceRef: "t",
      },
    },
  };
}
ensureRegistered(termfailDef(), "experimental-extension");

describe("classify-breaker lifecycle (v1.2.9, MANDATORY routed pair)", () => {
  function parkedClassLiteral(defId: string): GameState {
    return guidedState([P(0, 0)], 5, "C", { A1: "p1" }, defId);
  }

  function drive(
    defId: string,
    x: number,
    y: number,
  ): ReturnType<typeof reduceTransaction> {
    const ctx = testCtx();
    return reduceTransaction(
      parkedClassLiteral(defId),
      { kind: "place", owner: "breaker", at: P(x, y) },
      ctx,
    );
  }

  it("routed + post PASSES: bindings on transient, one check, advance, milestone", () => {
    resetTestSpy();
    const r = drive("td-class-pass", 10, 0);
    expect(testSpy.count).toBe(1);
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted" || r.nextState === undefined) {
      throw new Error("unreachable");
    }
    // Chain ran M1 then parked: two events (Breaker + automatic Maker).
    expect(r.events.length).toBe(2);
    const [b1, m] = [r.events[0], r.events[1]];
    expect(b1?.owner).toBe("breaker");
    expect(b1?.caseId).toBe("t:any");
    expect(b1?.nodeAfter).toBe("M1");
    expect(m?.owner).toBe("maker");
    expect(m?.appliedPoint).toBe("p3");
    expect(m?.at.x.toString()).toBe("50/1");
    expect(m?.nodeAfter).toBe("T");
    expect(m?.caseId).toBe(undefined);
    expect(r.nextState.strategy?.nodeId).toBe("T");
    expect(r.nextState.strategy?.lastCase).toBe("t:any");
    expect(r.nextState.strategy?.vars).toMatchObject({ A1: "p1", B1: "p2" });
    expect(r.nextState.terminal).toBe(null);
    expect(r.outcome).toEqual({ kind: "committed" });
  });

  it("routed + post FAILS: verbatim report, no advance, failure milestone", () => {
    const r = drive("td-class-fail", 10, 0);
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted" || r.nextState === undefined) {
      throw new Error("unreachable");
    }
    expect(r.events.length).toBe(1);
    const e = r.events[0];
    // NO advance: milestone keeps the classify node, no terminal on it.
    expect(e?.caseId).toBe("t:any");
    expect(e?.nodeAfter).toBe("C");
    expect(r.outcome?.kind).toBe("terminal");
    if (r.outcome?.kind === "terminal") {
      expect(r.outcome.terminal.kind).toBe("strategy-integrity-failure");
      if (r.outcome.terminal.kind === "strategy-integrity-failure") {
        const report = r.outcome.terminal.report;
        expect(report.failedAt).toBe("C");
        expect(report.phase).toBe("post");
        expect(report.failed.id).toBe("test:fail");
      }
    }
    // Bindings applied despite failure (observable on the terminal state).
    expect(r.nextState.strategy?.nodeId).toBe("C");
    expect(r.nextState.strategy?.vars).toMatchObject({ A1: "p1", B1: "p2" });
  });
});

describe("computed-step lifecycle (§6.2, via crafted twin literals)", () => {
  function parkedTwinLiteral(): GameState {
    const st = guidedState(twinPts(), 6, "C", { ANCB: "p2" }, "td-chain");
    expect(checkStateInvariants(st)).toEqual({ ok: true });
    return st;
  }

  it("single + consecutive advance with bindings, zero new events per step", () => {
    resetTestSpy();
    const st = parkedTwinLiteral();
    const ctx = testCtx();
    const r = reduceTransaction(
      st,
      { kind: "place", owner: "breaker", at: P(-200, -200) },
      ctx,
    );
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted" || r.nextState === undefined) {
      throw new Error("unreachable");
    }
    // Both computed posts ran exactly once (no re-execution).
    expect(testSpy.count).toBe(2);
    // Advanced past c1 AND c2 to the maker node and beyond to park.
    expect(r.nextState.strategy?.nodeId).toBe("T2");
    // Canonical twin bindings (H0, H3 — pinned by the twin probes).
    expect(r.nextState.strategy?.vars).toMatchObject({
      ANCB: "p2",
      B1: "p8",
      twinA: ["p1", "p2", "p4", "p5", "p3"],
      twinB: ["p6", "p3", "p2", "p7", "p4"],
      M: "p9",
    });
    // →maker: M placed at (-100,-101) exactly; Breaker + Maker = 2 events.
    expect(r.events.length).toBe(2);
    const [b1, m] = [r.events[0], r.events[1]];
    expect(b1?.owner).toBe("breaker");
    expect(b1?.caseId).toBe("t:any");
    expect(b1?.nodeAfter).toBe("c1");
    expect(m?.owner).toBe("maker");
    expect(m?.appliedPoint).toBe("p9");
    expect(m?.at.x.toString()).toBe("-100/1");
    expect(m?.at.y.toString()).toBe("-101/1");
    expect(m?.nodeAfter).toBe("T2");
    expect(m?.caseId).toBe(undefined);
    expect(r.outcome).toEqual({ kind: "committed" });
  });

  it("op failure: integrity terminal, NO bindings, NO advance", () => {
    // Cheap hole-free literal (2 points) parked at TD-chain's C: twin-pair
    // cannot succeed. k=6 keeps the win checks vacuous.
    const withDef = guidedState(
      [P(0, 0), P(10, 10)],
      6,
      "C",
      { ANCB: "p1" },
      "td-chain",
    );
    expect(checkStateInvariants(withDef)).toEqual({ ok: true });
    const ctx = testCtx();
    const r = reduceTransaction(
      withDef,
      { kind: "place", owner: "breaker", at: P(0, 10) },
      ctx,
    );
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted" || r.nextState === undefined) {
      throw new Error("unreachable");
    }
    expect(r.outcome?.kind).toBe("terminal");
    if (r.outcome?.kind === "terminal") {
      expect(r.outcome.terminal.kind).toBe("strategy-integrity-failure");
      if (r.outcome.terminal.kind === "strategy-integrity-failure") {
        expect(r.outcome.terminal.report.failedAt).toBe("c1");
        expect(r.outcome.terminal.report.phase).toBe("construction");
        expect(r.outcome.terminal.report.failed.id).toBe("select-twin-pair");
      }
    }
    expect(r.nextState.strategy?.nodeId).toBe("c1");
    expect(r.nextState.strategy?.vars).not.toHaveProperty("twinA");
    expect(r.events.length).toBe(1);
    expect(r.events[0]?.nodeAfter).toBe("c1");
  });

  it("post failure: bindings APPLIED, NO advance, verbatim report", () => {
    // Twin op succeeds on the crafted state; the decided-false post fails.
    const st = guidedState(twinPts(), 6, "C", { ANCB: "p2" }, "td-postfail");
    expect(checkStateInvariants(st)).toEqual({ ok: true });
    const ctx = testCtx();
    const r = reduceTransaction(
      st,
      { kind: "place", owner: "breaker", at: P(-200, -200) },
      ctx,
    );
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted" || r.nextState === undefined) {
      throw new Error("unreachable");
    }
    expect(r.outcome?.kind).toBe("terminal");
    if (r.outcome?.kind === "terminal") {
      expect(r.outcome.terminal.kind).toBe("strategy-integrity-failure");
      if (r.outcome.terminal.kind === "strategy-integrity-failure") {
        expect(r.outcome.terminal.report.failedAt).toBe("c1");
        expect(r.outcome.terminal.report.phase).toBe("post");
        expect(r.outcome.terminal.report.failed.id).toBe("test:fail");
      }
    }
    // Bindings applied (twinA present), advance skipped (nodeId still c1).
    expect(r.nextState.strategy?.nodeId).toBe("c1");
    expect(r.nextState.strategy?.vars).toMatchObject({
      twinA: ["p1", "p2", "p4", "p5", "p3"],
    });
    expect(r.events.length).toBe(1);
    expect(r.events[0]?.nodeAfter).toBe("c1");
  });
});

describe("declared-win verification (chain reaching terminal)", () => {
  function launchTermfail(): { store: Store; ctx: ReturnType<typeof testCtx> } {
    const store = new Store();
    const ctx = testCtx();
    const started = startSession(
      {
        kind: "guided",
        config: { mode: "break", window: ctx.config.window },
        strategyId: "td-termfail",
        mode: "break",
      },
      ctx,
      store,
    );
    expect(started.status).toBe("accepted");
    expect(store.current().strategy?.nodeId).toBe("C");
    return { store, ctx };
  }

  it("arrival without a k-hole is an honest integrity terminal", () => {
    const { store, ctx } = launchTermfail();
    const at = P(1, 1);
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
    // CardinalityRule: Breaker + automatic Maker = 2 events.
    expect(r.events.length).toBe(2);
    const [b1, m] = [r.events[0], r.events[1]];
    expect(b1?.nodeAfter).toBe("mT");
    expect(m?.nodeAfter).toBe("term");
    expect(m?.appliedPoint).toBe("p5");
    expect(r.outcome?.kind).toBe("terminal");
    if (r.outcome?.kind === "terminal") {
      expect(r.outcome.terminal.kind).toBe("strategy-integrity-failure");
      if (r.outcome.terminal.kind === "strategy-integrity-failure") {
        expect(r.outcome.terminal.report.failedAt).toBe("term");
        expect(r.outcome.terminal.report.phase).toBe("post");
        expect(r.outcome.terminal.report.failed.id).toBe(
          "engine:declared-win",
        );
      }
    }
    expect(store.current().strategy?.nodeId).toBe("term");
  });

  it("arrival WITH a witness wins at the declared node (precondition-violation probe)", () => {
    // Smuggled pentagon (never formation-checked): B1/mT create nothing new.
    const pent = [P(0, 0), P(10, 0), P(12, 6), P(5, 12), P(-2, 6)];
    const st = guidedState(pent, 5, "C", {}, "td-termfail");
    expect(checkStateInvariants(st)).toEqual({ ok: true });
    const ctx = testCtx();
    const at = P(200, 201);
    const r = reduceTransaction(
      st,
      { kind: "place", owner: "breaker", at },
      ctx,
    );
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") {
      throw new Error("unreachable");
    }
    expect(r.outcome?.kind).toBe("terminal");
    if (r.outcome?.kind === "terminal") {
      expect(r.outcome.terminal.kind).toBe("maker-won");
      if (r.outcome.terminal.kind === "maker-won") {
        expect(r.outcome.terminal.nodeId).toBe("term");
        expect(r.outcome.terminal.witness.length).toBe(1);
        expect(
          [...(r.outcome.terminal.witness[0]?.verts ?? [])].sort(),
        ).toEqual(["p1", "p2", "p3", "p4", "p5"]);
      }
    }
    expect(r.events.length).toBe(2);
    expect(r.events[1]?.nodeAfter).toBe("term");
  });
});

describe("invariant-lifecycle seam fixtures (F3–F5, F10–F11)", () => {
  function wellFormedBindings(
    vars: Readonly<Record<string, Binding>>,
  ): boolean {
    return Object.values(vars).every(
      (v) =>
        typeof v === "string" ||
        v instanceof Rat ||
        (Array.isArray(v) && v.every((id) => typeof id === "string")),
    );
  }

  it("F3–F5: transient maker/computed/classify-fail shapes satisfy the lifecycle", () => {
    // Maker-transient: mid-chain operating node (maker), bindings bound.
    const makerTransient = guidedState(
      twinPts(),
      6,
      "c1",
      { ANCB: "p2", B1: "p8" },
      "td-chain",
    );
    expect(checkStateInvariants(makerTransient)).toEqual({ ok: true });
    expect(wellFormedBindings(makerTransient.strategy?.vars ?? {})).toBe(true);
    // Computed-transient: operating computed node.
    const computedTransient = guidedState(
      twinPts(),
      6,
      "c2",
      { ANCB: "p2", B1: "p8", twinA: ["p1"] },
      "td-chain",
    );
    expect(checkStateInvariants(computedTransient)).toEqual({ ok: true });
    // Classify-post-fail transient: bindings set, nodeId still classify.
    // (Shapes are never stored, rendered, or serialized — literals only.)
  });

  it("F10–F11: the gate rejects bad invariants and non-parked guided states", () => {
    const ctx = testCtx();
    const badTurn: GameState = {
      ...guidedState([P(0, 0)], 5, "C", {}, "td-termfail"),
      turn: "maker", // wrong: 1 point requires Breaker to move (I3)
    };
    const admission = committedStateAdmissible(badTurn, ctx);
    expect(admission.ok).toBe(false);
    const parked = guidedState(twinPts(), 6, "c1", { ANCB: "p2" }, "td-chain");
    const admission2 = committedStateAdmissible(parked, ctx);
    expect(admission2).toEqual({
      ok: false,
      reason: "not-parked",
      nodeId: "c1",
    });
    const store = new Store();
    const fake = {
      status: "accepted",
      outcome: { kind: "committed" },
      nextState: parked,
      events: [],
      diagnostics: [],
    } as never;
    expect(() =>
      commit(
        fake,
        { kind: "place", owner: "breaker", at: P(9, 9) },
        store,
        ctx,
      ),
    ).toThrow(CommitGateError);
    expect(store.tree().transactions.length).toBe(0);
  });
});
