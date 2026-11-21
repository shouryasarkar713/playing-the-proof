// tests/engine/orchestrator.test.ts — reducer helper battery (Phase 18):
// finish guards, activeDef throws, computed-op dispatch (anchored pairs +
// twins, incl. misbound/budget/empty failures), classifySpecFailure
// mapping, and the committed/terminal outcome split.
import { describe, expect, it } from "vitest";
import { Rat } from "../../src/geometry/rat.ts";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { commit, startSession } from "../../src/session/commit.ts";
import { Store } from "../../src/session/store.ts";
import type { RuntimeCtx } from "../../src/engine/orchestrator.ts";
import {
  activeDef,
  classifySpecFailure,
  finish,
  reduceTransaction,
  runComputedOp,
} from "../../src/engine/orchestrator.ts";
import {
  getClassifier,
  registerClassifier,
  registerStrategy,
  strategies,
} from "../../src/strategy/registry.ts";
import type {
  ClassifierDef,
  ComputedOp,
  StrategyDef,
} from "../../src/strategy/types.ts";
import { ensureK5 } from "../strategies/k5driver.ts";
import {
  P,
  centroidOf,
  ensureK6,
  forcedRegion,
} from "../strategies/k6driver.ts";
import { guidedState, twinPts } from "../strategy/scaffolding.ts";
import { sandboxState, testCtx } from "../helpers.ts";

ensureK5();
ensureK6();

const PENT = [P(0, 0), P(10, 0), P(13, 8), P(5, 13), P(-3, 8)];

describe("finish guards (§10.8)", () => {
  it("unfinalized events throw (never escape the reducer)", () => {
    expect(() =>
      finish(
        sandboxState([P(0, 0)]),
        [{ owner: "maker", at: P(0, 0), appliedPoint: "p1" } as never],
        { kind: "committed" },
        [],
      ),
    ).toThrowError(/unfinalized/);
  });

  it("terminal outcomes must reference the applied terminal", () => {
    const terminal = {
      kind: "uncovered",
      report: {
        origin: "maker-construction",
        reason: "window-exhausted",
        at: { nodeId: "n", move: { kind: "x" } },
        detail: "d",
      },
    } as never;
    expect(() =>
      finish(sandboxState([P(0, 0)]), [], { kind: "terminal", terminal }, []),
    ).toThrowError(/mismatches state/);
  });
});

describe("activeDef throws without a resolvable strategy", () => {
  it("sandbox LookupError; unknown strategy id", () => {
    expect(() => activeDef(sandboxState([]), testCtx())).toThrowError(
      /state has/,
    );
    const ghost = guidedState([P(0, 0)], 3, "C", {}, "test:nope-def");
    expect(() => activeDef(ghost, testCtx())).toThrowError(/unknown/);
  });
});

describe("runComputedOp: anchored pairs", () => {
  function anchoredState(): ReturnType<typeof guidedState> {
    const store = new Store();
    const ctx = testCtx();
    const started = startSession(
      {
        kind: "guided",
        config: { mode: "break", window: ctx.config.window },
        strategyId: "esmb-k6",
        mode: "break",
        strategyStart: { kind: "supplied", points: PENT, selectedHole: PENT },
      },
      ctx,
      store,
    );
    if (started.status !== "accepted") {
      throw new Error("test bug");
    }
    const cur0 = store.current();
    const p5 = (cur0.strategy?.vars["P5"] as string[]).map(
      (id) => cur0.points.find((p) => p.id === id)?.pt as Pt,
    );
    const b0 = centroidOf(forcedRegion(p5));
    const pts = [...PENT, b0];
    const ids = pts.map((_, i) => `p${i + 1}`);
    return guidedState(
      pts,
      6,
      "k6:pairing",
      { B0: "p6", P5: ids.slice(0, 5) },
      "esmb-k6",
    );
  }

  const OP: ComputedOp = {
    kind: "select-anchored-shared-edge-pair",
    k: 4,
    anchorVar: "B0",
    polyVar: "P5",
    binds: { sharedEdge: "SE", quadA: "Q1", quadB: "Q2" },
  };

  it("misbound vars fail with operands", () => {
    const r = runComputedOp(
      guidedState(PENT, 6, "k6:pairing", {}, "esmb-k6"),
      OP,
      testCtx().config,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failed.detail).toContain("misbound");
    }
  });

  it("starved budgets fail with the analysis attached", () => {
    const r = runComputedOp(anchoredState(), OP, testCtx(0).config);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failed.detail).toContain("budget-exhausted");
      expect(r.failed.analysis?.kind).toBe("budget-exhausted");
    }
  });

  it("no anchored pair fails (never an empty selection)", () => {
    const ids = PENT.map((_, i) => `p${i + 1}`);
    const st = guidedState(
      PENT,
      6,
      "k6:pairing",
      { B0: "p1", P5: ids },
      "esmb-k6",
    );
    const r = runComputedOp(st, OP, testCtx().config);
    expect(r.ok).toBe(false);
  });

  it("route-B shape binds SE + quads in order", () => {
    const r = runComputedOp(anchoredState(), OP, testCtx().config);
    expect(r.ok).toBe(true);
    if (!r.ok) {
      throw new Error("unreachable");
    }
    const se = r.bindings["SE"] as string[];
    expect(se[0]).toBe("p6");
    expect(typeof r.bindings["Q1"]).not.toBe("undefined");
    expect(typeof r.bindings["Q2"]).not.toBe("undefined");
  });
});

describe("runComputedOp: twin pairs", () => {
  const OP = {
    kind: "select-twin-pair",
    anchorVar: "A",
    binds: { twinA: "T1", twinB: "T2" },
  } as const;

  it("misbound anchor fails", () => {
    const r = runComputedOp(
      guidedState(twinPts(), 5, "C", {}, "test-only"),
      OP,
      testCtx().config,
    );
    expect(r.ok).toBe(false);
  });

  it("starved budgets fail", () => {
    const r = runComputedOp(
      guidedState(twinPts(), 5, "C", { A: "p1" }, "test-only"),
      OP,
      testCtx(0).config,
    );
    expect(r.ok).toBe(false);
  });

  it("twin fixtures bind the anchor-sharing pair", () => {
    const r = runComputedOp(
      guidedState(twinPts(), 5, "C", { A: "p2" }, "test-only"),
      OP,
      testCtx().config,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) {
      throw new Error("unreachable");
    }
    const t1 = r.bindings["T1"] as string[];
    const t2 = r.bindings["T2"] as string[];
    expect(t1).toContain("p2");
    expect(t2).toContain("p2");
    expect(t1.filter((id) => t2.includes(id)).length).toBe(3);
  });
});

describe("classifySpecFailure mapping (§10.5)", () => {
  it("extend/escape constructions → honest uncovered", () => {
    for (const kind of ["extend", "escape-beyond-edge"] as const) {
      const node = {
        id: "M",
        role: "maker-move",
        next: "end",
        move:
          kind === "extend"
            ? { kind: "extend", hole: { kind: "enumerate", k: 4 } }
            : {
                kind: "escape-beyond-edge",
                sharedEdge: { kind: "var", v: "SE" },
                poly: { kind: "var", v: "P5" },
              },
        show: [],
        why: { headline: "t", claims: [], sourceRef: "t" },
        sourceRef: "t",
      } as never;
      const r = classifySpecFailure(
        node as Parameters<typeof classifySpecFailure>[0],
        sandboxState([]),
      );
      expect(r.kind).toBe("uncovered");
      if (r.kind === "uncovered") {
        expect(r.report.origin).toBe("maker-construction");
      }
    }
  });

  it("other constructions → integrity (never uncovered)", () => {
    const node = {
      id: "M",
      role: "maker-move",
      next: "end",
      move: {
        kind: "fixed",
        at: [{ kind: "const", x: Rat.make(0n), y: Rat.make(0n) }],
      },
      show: [],
      why: { headline: "t", claims: [], sourceRef: "t" },
      sourceRef: "t",
    } as never;
    const r = classifySpecFailure(
      node as Parameters<typeof classifySpecFailure>[0],
      sandboxState([]),
    );
    expect(r.kind).toBe("integrity");
  });
});

describe("committed vs terminal outcomes", () => {
  function tinyParkFail(): StrategyDef {
    return {
      id: "td-orch-parkfail",
      k: 5,
      version: "0.0.0",
      source: { paper: "test", stepMap: {} },
      entry: "M0",
      nodes: {
        M0: {
          id: "M0",
          role: "maker-move",
          next: "C",
          move: {
            kind: "fixed",
            at: [{ kind: "const", x: P(1, 1).x, y: P(1, 1).y }],
          },
          show: [],
          why: { headline: "t", claims: [], sourceRef: "t" },
          sourceRef: "t",
        },
        C: {
          id: "C",
          role: "classify-breaker",
          routes: [{ case: "t:any", when: { kind: "all" }, target: "M" }],
          show: [],
          why: { headline: "t", claims: [], sourceRef: "t" },
          sourceRef: "t",
        },
        M: {
          id: "M",
          role: "maker-move",
          next: "C2",
          move: {
            kind: "fixed",
            at: [{ kind: "const", x: P(100, 101).x, y: P(100, 101).y }],
          },
          show: [],
          why: { headline: "t", claims: [], sourceRef: "t" },
          sourceRef: "t",
        },
        C2: {
          id: "C2",
          role: "classify-breaker",
          routes: [{ case: "t:any", when: { kind: "all" }, target: "M2" }],
          pre: [{ kind: "exists-k-hole", k: 8 }],
          show: [],
          why: { headline: "t", claims: [], sourceRef: "t" },
          sourceRef: "t",
        },
        M2: {
          id: "M2",
          role: "maker-move",
          next: "end",
          move: {
            kind: "fixed",
            at: [{ kind: "const", x: P(200, 201).x, y: P(200, 201).y }],
          },
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
  }

  it("normal placements commit; failing park pres end terminal", () => {
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
    const at = P(10, 0);
    const r = reduceTransaction(
      store.current(),
      { kind: "place", owner: "breaker", at },
      ctx,
    );
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted" || r.nextState === undefined) {
      throw new Error("unreachable");
    }
    commit(r, { kind: "place", owner: "breaker", at }, store, ctx);
    const failing = tinyParkFail();
    if (!strategies().has(failing.id)) {
      registerStrategy(failing, "experimental-extension");
    }
    const store2 = new Store();
    const started2 = startSession(
      {
        kind: "guided",
        config: { mode: "break", window: ctx.config.window },
        strategyId: failing.id,
        mode: "break",
      },
      ctx,
      store2,
    );
    // Maker-move entries boot bare and park at the classify node.
    expect(started2.status).toBe("accepted");
    expect(store2.current().strategy?.nodeId).toBe("C");
    const at2 = pt(Rat.make(7n), Rat.make(4n));
    const r2 = reduceTransaction(
      store2.current(),
      { kind: "place", owner: "breaker", at: at2 },
      ctx,
    );
    expect(r2.status).toBe("accepted");
    if (r2.status !== "accepted" || r2.nextState === undefined) {
      throw new Error("unreachable");
    }
    expect(r2.nextState.terminal?.kind).toBe("strategy-integrity-failure");
    if (r2.nextState.terminal?.kind === "strategy-integrity-failure") {
      expect(r2.nextState.terminal.report.failedAt).toBe("C2");
      expect(r2.nextState.terminal.report.phase).toBe("pre");
    }
    // Terminal outcomes commit through the same gate.
    const at2b = pt(Rat.make(7n), Rat.make(4n));
    commit(r2, { kind: "place", owner: "breaker", at: at2b }, store2, ctx);
    expect(store2.current().terminal?.kind).toBe("strategy-integrity-failure");
  });
});

function ensureStub(def: ClassifierDef): void {
  if (getClassifier(def.id) === undefined) {
    registerClassifier(def);
  }
}

describe("typed budget/construction channels (Phase 18)", () => {
  const goStub: ClassifierDef = {
    id: "test:orch-go",
    resultTags: ["go"],
    classify(_state, _inputs, _config) {
      return { kind: "classified", result: { tag: "go", bindings: {} } };
    },
    boundaries(_state, _inputs, _config) {
      return { kind: "ok", lines: [] };
    },
  };
  ensureStub(goStub);

  function chainDef(
    id: string,
    mMove: StrategyDef["nodes"][string],
    classifierId = "test:orch-go",
    bind?: Record<string, { kind: "result"; field: string }>,
  ): StrategyDef {
    return {
      id,
      k: 5,
      version: "0.0.0",
      source: { paper: "test", stepMap: {} },
      entry: "M0",
      nodes: {
        M0: {
          id: "M0",
          role: "maker-move",
          next: "M1",
          move: {
            kind: "fixed",
            at: [{ kind: "const", x: P(0, 0).x, y: P(0, 0).y }],
          },
          show: [],
          why: { headline: "t", claims: [], sourceRef: "t" },
          sourceRef: "t",
        },
        M1: {
          id: "M1",
          role: "maker-move",
          next: "M2",
          move: {
            kind: "fixed",
            at: [{ kind: "const", x: P(10, 0).x, y: P(10, 0).y }],
          },
          show: [],
          why: { headline: "t", claims: [], sourceRef: "t" },
          sourceRef: "t",
        },
        M2: {
          id: "M2",
          role: "maker-move",
          next: "M3",
          move: {
            kind: "fixed",
            at: [{ kind: "const", x: P(0, 10).x, y: P(0, 10).y }],
          },
          show: [],
          why: { headline: "t", claims: [], sourceRef: "t" },
          sourceRef: "t",
        },
        M3: {
          id: "M3",
          role: "maker-move",
          next: "C",
          move: {
            kind: "fixed",
            at: [{ kind: "const", x: P(10, 10).x, y: P(10, 10).y }],
          },
          show: [],
          why: { headline: "t", claims: [], sourceRef: "t" },
          sourceRef: "t",
        },
        C: {
          id: "C",
          role: "classify-breaker",
          routes: [
            {
              case: "t:go",
              when: { kind: "classifier", classifierId, on: { tag: "go" } },
              target: "M",
              ...(bind !== undefined ? { bind } : {}),
            },
            { case: "t:any", when: { kind: "all" }, target: "M" },
          ],
          show: [],
          why: { headline: "t", claims: [], sourceRef: "t" },
          sourceRef: "t",
        },
        M: mMove,
        end: {
          id: "end",
          role: "terminal",
          show: [],
          why: { headline: "t", claims: [], sourceRef: "t" },
          sourceRef: "t",
        },
      },
    };
  }

  function launchChain(
    def: StrategyDef,
    budgetOps = 20000000,
  ): { store: Store; ctx: RuntimeCtx } {
    if (!strategies().has(def.id)) {
      registerStrategy(def, "experimental-extension");
    }
    const store = new Store();
    const base = testCtx();
    const ctx: RuntimeCtx =
      budgetOps === 20000000
        ? base
        : { ...base, config: { ...base.config, analysis: { budgetOps } } };
    const started = startSession(
      {
        kind: "guided",
        config: { mode: "break", window: ctx.config.window },
        strategyId: def.id,
        mode: "break",
      },
      ctx,
      store,
    );
    if (started.status !== "accepted") {
      throw new Error("test bug: chain def failed to boot");
    }
    return { store, ctx };
  }

  function extendNode(): StrategyDef["nodes"][string] {
    return {
      id: "M",
      role: "maker-move",
      next: "end",
      move: { kind: "extend", hole: { kind: "enumerate", k: 4 } },
      show: [],
      why: { headline: "t", claims: [], sourceRef: "t" },
      sourceRef: "t",
    };
  }

  it("starved extension budgets end terminal carrying the analysis", () => {
    const { store, ctx } = launchChain(
      chainDef("td-orch-budget", extendNode()),
      0,
    );
    expect(store.current().strategy?.nodeId).toBe("C");
    // Interior point: GP-legal, completes no hole (routes the chain).
    const at = P(5, 6);
    const r = reduceTransaction(
      store.current(),
      { kind: "place", owner: "breaker", at },
      ctx,
    );
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted" || r.nextState === undefined) {
      throw new Error("unreachable");
    }
    expect(r.nextState.terminal?.kind).toBe("strategy-integrity-failure");
    if (r.nextState.terminal?.kind === "strategy-integrity-failure") {
      expect(r.nextState.terminal.report.failed.id).toBe("extend");
      expect(r.nextState.terminal.report.phase).toBe("construction");
    }
  });

  it("an EMPTY exhaustive extend enumeration is a captured integrity terminal (§24.1)", () => {
    // 4 corner makers + an interior breaker point: the five points are NOT
    // in convex position, so the exhaustive k=5 enumeration is EMPTY. §24.1's
    // k6:immediate rule: that contradicts the forcing sentence — a
    // strategy-integrity-failure terminal carrying the fixture (stateHash),
    // never a plain crash and never an uncovered (window-exhausted) misreport.
    const emptyEnumNode: StrategyDef["nodes"][string] = {
      id: "M",
      role: "maker-move",
      next: "end",
      move: { kind: "extend", hole: { kind: "enumerate", k: 5 } },
      show: [],
      why: { headline: "t", claims: [], sourceRef: "t" },
      sourceRef: "t",
    };
    const { store, ctx } = launchChain(
      chainDef("td-orch-empty-enum", emptyEnumNode),
    );
    expect(store.current().strategy?.nodeId).toBe("C");
    const at = P(5, 6);
    const r = reduceTransaction(
      store.current(),
      { kind: "place", owner: "breaker", at },
      ctx,
    );
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted" || r.nextState === undefined) {
      throw new Error("unreachable");
    }
    expect(r.nextState.terminal?.kind).toBe("strategy-integrity-failure");
    if (r.nextState.terminal?.kind === "strategy-integrity-failure") {
      expect(r.nextState.terminal.report.failed.id).toBe("extend");
      expect(r.nextState.terminal.report.phase).toBe("construction");
      expect(r.nextState.terminal.report.failed.detail).toContain(
        "enumeration empty",
      );
      expect(typeof r.nextState.terminal.report.stateHash).toBe("string");
      expect(r.nextState.terminal.report.stateHash.length).toBe(16);
    }
  });

  it("scalar quad vars throw ConstructionIntegrityError at the one boundary", () => {
    const quad: ClassifierDef = {
      id: "test:orch-quad",
      resultTags: ["go"],
      classify(_state, _inputs, _config) {
        return {
          kind: "classified",
          result: {
            tag: "go",
            bindings: { Q: "p1", SE: ["p1", "p2"], P5: ["p1", "p2", "p5"] },
          },
        };
      },
      boundaries(_state, _inputs, _config) {
        return { kind: "ok", lines: [] };
      },
    };
    ensureStub(quad);
    const escapeNode: StrategyDef["nodes"][string] = {
      id: "M",
      role: "maker-move",
      next: "end",
      move: {
        kind: "escape-beyond-edge",
        sharedEdge: { kind: "var", v: "SE" },
        poly: { kind: "var", v: "P5" },
        quads: [
          { kind: "var", v: "Q" },
          { kind: "var", v: "Q" },
        ],
      },
      show: [],
      why: { headline: "t", claims: [], sourceRef: "t" },
      sourceRef: "t",
    };
    const { store, ctx } = launchChain(
      chainDef("td-orch-escape", escapeNode, "test:orch-quad", {
        Q: { kind: "result", field: "Q" },
        SE: { kind: "result", field: "SE" },
        P5: { kind: "result", field: "P5" },
      }),
    );
    expect(store.current().strategy?.nodeId).toBe("C");
    // p5 = the breaker point below; SE/P5 resolve, Q stays scalar.
    // Interior point: GP-legal, completes no hole (routes the chain).
    const at = P(5, 6);
    const r = reduceTransaction(
      store.current(),
      { kind: "place", owner: "breaker", at },
      ctx,
    );
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted" || r.nextState === undefined) {
      throw new Error("unreachable");
    }
    expect(r.nextState.terminal?.kind).toBe("strategy-integrity-failure");
    if (r.nextState.terminal?.kind === "strategy-integrity-failure") {
      expect(r.nextState.terminal.report.failed.id).toBe("escape");
    }
  });

  it("classifier integrity fails closed with the catch-all skipped", () => {
    const down: ClassifierDef = {
      id: "test:orch-down",
      resultTags: ["go"],
      classify(_state, _inputs, _config) {
        return {
          kind: "integrity",
          failure: {
            reason: "undecidable-computation",
            detail: "down for maintenance",
          },
        };
      },
      boundaries(_state, _inputs, _config) {
        return { kind: "ok", lines: [] };
      },
    };
    ensureStub(down);
    const mNode: StrategyDef["nodes"][string] = {
      id: "M",
      role: "maker-move",
      next: "end",
      move: {
        kind: "fixed",
        at: [{ kind: "const", x: P(10, 0).x, y: P(10, 0).y }],
      },
      show: [],
      why: { headline: "t", claims: [], sourceRef: "t" },
      sourceRef: "t",
    };
    const { store, ctx } = launchChain(
      chainDef("td-orch-clfdown", mNode, "test:orch-down"),
    );
    expect(store.current().strategy?.nodeId).toBe("C");
    const at = P(5, 6);
    const r = reduceTransaction(
      store.current(),
      { kind: "place", owner: "breaker", at },
      ctx,
    );
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted" || r.nextState === undefined) {
      throw new Error("unreachable");
    }
    // Integrity, not the catch-all's end node.
    expect(r.nextState.terminal?.kind).toBe("strategy-integrity-failure");
    if (r.nextState.terminal?.kind === "strategy-integrity-failure") {
      expect(r.nextState.terminal.report.failed.id).toBe("test:orch-down");
    }
    expect(r.nextState.strategy?.nodeId).not.toBe("end");
  });
});
