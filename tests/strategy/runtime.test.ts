// tests/strategy/runtime.test.ts — nodeOf/isTerminalNode contract +
// region-rule routing battery (first-match, empty-exact false, incomplete
// integrity, ordering, catch-all) on sessions.
import { describe, expect, it } from "vitest";
import { isTerminalNode, nodeOf } from "../../src/strategy/runtime.ts";
import { classify } from "../../src/strategy/runtime.ts";
import {
  getClassifier,
  registerClassifier,
  registerStrategy,
  strategies,
} from "../../src/strategy/registry.ts";
import type { ClassifierDef, RouteRule, StrategyDef } from "../../src/strategy/types.ts";
import { commit, startSession } from "../../src/session/commit.ts";
import { Store } from "../../src/session/store.ts";
import { reduceTransaction } from "../../src/engine/orchestrator.ts";
import type { GameState } from "../../src/game/types.ts";
import { P } from "./scaffolding.ts";
import { sandboxState, testCtx } from "../helpers.ts";

function ensureRegistered(def: StrategyDef): void {
  if (!strategies().has(def.id)) {
    registerStrategy(def, "experimental-extension");
  }
}

function haltTail(tid: string): Record<string, StrategyDef["nodes"][string]> {
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
      id: `${tid}-m`,
      role: "maker-move",
      next: `${tid}-t`,
      move: {
        kind: "fixed",
        at: [{ kind: "const", x: P(999, 999).x, y: P(999, 999).y }],
      },
      show: [],
      why: { headline: "t", claims: [], sourceRef: "t" },
      sourceRef: "t",
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

// Triangle + center fixed (NO 4-hole anywhere): r1 empty-false; r2 hull;
// catch-all reachable with a far B1.
function routeEDef(): StrategyDef {
  return {
    id: "td-routeE",
    k: 5,
    version: "0.0.0",
    source: { paper: "test", stepMap: {} },
    entry: "entry",
    nodes: {
      entry: {
        id: "entry",
        role: "maker-move",
        next: "f1",
        placeBind: "A1",
        move: {
          kind: "fixed",
          at: [{ kind: "const", x: P(0, 0).x, y: P(0, 0).y }],
        },
        show: [],
        why: { headline: "t", claims: [], sourceRef: "t" },
        sourceRef: "t",
      },
      f1: {
        id: "f1",
        role: "maker-move",
        next: "f2",
        placeBind: "A2",
        move: {
          kind: "fixed",
          at: [{ kind: "const", x: P(10, 0).x, y: P(10, 0).y }],
        },
        show: [],
        why: { headline: "t", claims: [], sourceRef: "t" },
        sourceRef: "t",
      },
      f2: {
        id: "f2",
        role: "maker-move",
        next: "f3",
        placeBind: "A3",
        move: {
          kind: "fixed",
          at: [{ kind: "const", x: P(0, 10).x, y: P(0, 10).y }],
        },
        show: [],
        why: { headline: "t", claims: [], sourceRef: "t" },
        sourceRef: "t",
      },
      f3: {
        id: "f3",
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
        routes: [
          {
            case: "t:holes",
            when: { kind: "region", expr: { kind: "holes", k: 5 } },
            target: "T1",
          },
          {
            case: "t:hull",
            when: {
              kind: "region",
              expr: {
                kind: "hull",
                of: {
                  kind: "points",
                  of: [
                    { kind: "anchor", v: "A1" },
                    { kind: "anchor", v: "A2" },
                    { kind: "anchor", v: "A3" },
                  ],
                },
              },
            },
            target: "T2",
          },
          { case: "t:all", when: { kind: "all" }, target: "T3" },
        ],
        show: [],
        why: { headline: "t", claims: [], sourceRef: "t" },
        sourceRef: "t",
      },
      // Route targets must be maker/computed (G3). T1 never fires (r1
      // always empty); T2/T3 place interior (win-clean for k=5), then park.
      T1: {
        id: "T1",
        role: "maker-move",
        next: "P1",
        move: {
          kind: "fixed",
          at: [{ kind: "const", x: P(6, 2).x, y: P(6, 2).y }],
        },
        show: [],
        why: { headline: "t", claims: [], sourceRef: "t" },
        sourceRef: "t",
      },
      T2: {
        id: "T2",
        role: "maker-move",
        next: "P2",
        move: {
          kind: "fixed",
          // First maker after an interior B1: far is clean (the single far
          // point + interiors hull to ≤ 4 for k=5 — machine-verified park).
          at: [{ kind: "const", x: P(501, 503).x, y: P(501, 503).y }],
        },
        show: [],
        why: { headline: "t", claims: [], sourceRef: "t" },
        sourceRef: "t",
      },
      T3: {
        id: "T3",
        role: "maker-move",
        next: "P3",
        move: {
          kind: "fixed",
          // Interior placement (inside the triangle): creates no new
          // 5-hole, so the chain parks instead of winning.
          at: [{ kind: "const", x: P(2, 3).x, y: P(2, 3).y }],
        },
        show: [],
        why: { headline: "t", claims: [], sourceRef: "t" },
        sourceRef: "t",
      },
      ...haltTail("P1"),
      ...haltTail("P2"),
      ...haltTail("P3"),
    },
  };
}

describe("nodeOf / isTerminalNode (§10.9)", () => {
  const def = routeEDef();
  it("resolves existing nodes; terminal test is exact", () => {
    expect(nodeOf(def, "C").role).toBe("classify-breaker");
    expect(isTerminalNode(def, "P1-t")).toBe(true);
    expect(isTerminalNode(def, "C")).toBe(false);
  });
  it("missing ids throw (never false-by-default)", () => {
    expect(() => nodeOf(def, "nope")).toThrow();
    expect(() => isTerminalNode(def, "nope")).toThrow();
  });
});

describe("region routing battery (sessions)", () => {
  function sessionOn(
    def: StrategyDef,
    budgetOps = 20000000,
  ): {
    store: Store;
    ctx: ReturnType<typeof testCtx>;
  } {
    ensureRegistered(def);
    const store = new Store();
    const ctx = testCtx(budgetOps);
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
    expect(started.status).toBe("accepted");
    return { store, ctx };
  }

  function breaker(
    store: Store,
    ctx: ReturnType<typeof testCtx>,
    x: number,
    y: number,
  ): GameState {
    const r = reduceTransaction(
      store.current(),
      { kind: "place", owner: "breaker", at: P(x, y) },
      ctx,
    );
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") {
      throw new Error("unreachable");
    }
    commit(r, { kind: "place", owner: "breaker", at: P(x, y) }, store, ctx);
    return store.current();
  }

  it("empty-exact region is predicate-false; catch-all ends parked", () => {
    // B1 far outside the fixed triangle: r1 (holes-5, always empty) false;
    // r2 false; catch-all → T3 (maker places interior), parked at P3.
    const { store, ctx } = sessionOn(routeEDef());
    expect(store.current().strategy?.nodeId).toBe("C");
    const s = breaker(store, ctx, 200, 201);
    expect(s.strategy?.nodeId).toBe("P3");
    expect(s.strategy?.lastCase).toBe("t:all");
    expect(s.terminal).toBe(null);
  });

  it("interior B1 matches the anchor-hull rule (r1 still empty-false)", () => {
    // B1=(2,3): inside the fixed triangle → r2 true → T2 (maker places),
    // parked at P2. r1 stays empty (no 5-hole can exist here).
    const { store, ctx } = sessionOn(routeEDef());
    const s = breaker(store, ctx, 2, 3);
    expect(s.strategy?.nodeId).toBe("P2");
    expect(s.strategy?.lastCase).toBe("t:hull");
    expect(s.terminal).toBe(null);
  });

  it("incomplete region fails closed via direct classify (catch-all skipped)", () => {
    // holes-4 with budgetOps 0 on 5 points: estimate 40 > 0 → incomplete →
    // integrity with the analysis; the catch-all is NOT evaluated.
    const def: StrategyDef = {
      id: "td-routeI",
      k: 5,
      version: "0.0.0",
      source: { paper: "test", stepMap: {} },
      entry: "C",
      nodes: {
        C: {
          id: "C",
          role: "classify-breaker",
          routes: [
            {
              case: "t:holes",
              when: { kind: "region", expr: { kind: "holes", k: 4 } },
              target: "T1",
            },
            { case: "t:all", when: { kind: "all" }, target: "T3" },
          ],
          show: [],
          why: { headline: "t", claims: [], sourceRef: "t" },
          sourceRef: "t",
        },
        T1: {
          id: "T1",
          role: "maker-move",
          next: "P1",
          move: {
            kind: "fixed",
            at: [{ kind: "const", x: P(6, 2).x, y: P(6, 2).y }],
          },
          show: [],
          why: { headline: "t", claims: [], sourceRef: "t" },
          sourceRef: "t",
        },
        T3: {
          id: "T3",
          role: "maker-move",
          next: "P3",
          move: {
            kind: "fixed",
            at: [{ kind: "const", x: P(3, 2).x, y: P(3, 2).y }],
          },
          show: [],
          why: { headline: "t", claims: [], sourceRef: "t" },
          sourceRef: "t",
        },
        ...haltTail("P1"),
        ...haltTail("P3"),
      },
    };
    const st: GameState = {
      seq: 0,
      k: 5,
      mode: "break",
      points: [P(0, 0), P(10, 0), P(0, 10), P(1, 1), P(200, 201)].map(
        (pt, i) => ({
          id: `p${i + 1}`,
          owner: (i % 2 === 0 ? "maker" : "breaker") as "maker" | "breaker",
          pt,
          move: i + 1,
        }),
      ),
      turn: "breaker",
      terminal: null,
      strategy: {
        strategyId: "td-routeI",
        version: "0.0.0",
        nodeId: "C",
        vars: {},
        lastCase: null,
      },
    };
    const r = classify(def, st, "C", "p5", testCtx(0).config);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.report.failedAt).toBe("C");
      expect(r.report.phase).toBe("route");
      expect(r.report.failed.analysis?.kind).toBe("budget-exhausted");
    }
  });

  it("classify uses only its five arguments (no hidden context)", () => {
    expect(classify.length).toBe(5);
  });

  it("nonempty region matches first (ordering over the hull rule)", () => {
    // Square corners + B1=(5,6): emergent 4-holes contain B1 as a vertex
    // (non-strict boundary counts) → r1 matches even though r2 would too.
    const sq = (x: number, y: number): StrategyDef["nodes"][string] => ({
      id: "",
      role: "maker-move",
      next: "C",
      move: {
        kind: "fixed",
        at: [{ kind: "const", x: P(x, y).x, y: P(x, y).y }],
      },
      show: [],
      why: { headline: "t", claims: [], sourceRef: "t" },
      sourceRef: "t",
    });
    const f1 = sq(0, 0);
    f1.id = "entry";
    f1.next = "f1";
    const def: StrategyDef = {
      id: "td-routeF",
      k: 5,
      version: "0.0.0",
      source: { paper: "test", stepMap: {} },
      entry: "entry",
      nodes: {
        entry: { ...f1 },
        f1: { ...sq(10, 0), id: "f1", next: "f2" },
        f2: { ...sq(10, 10), id: "f2", next: "f3" },
        f3: { ...sq(0, 10), id: "f3", next: "C" },
        C: {
          id: "C",
          role: "classify-breaker",
          routes: [
            {
              case: "t:holes",
              when: { kind: "region", expr: { kind: "holes", k: 4 } },
              target: "T1",
            },
            {
              case: "t:hull",
              when: {
                kind: "region",
                expr: { kind: "hull", of: { kind: "last-n", n: 5 } },
              },
              target: "T2",
            },
            { case: "t:all", when: { kind: "all" }, target: "T3" },
          ],
          show: [],
          why: { headline: "t", claims: [], sourceRef: "t" },
          sourceRef: "t",
        },
        T1: {
          id: "T1",
          role: "maker-move",
          next: "P1",
          move: {
            kind: "fixed",
            // Interior placement: no new 5-hole, chain parks at P1.
            at: [{ kind: "const", x: P(5, 4).x, y: P(5, 4).y }],
          },
          show: [],
          why: { headline: "t", claims: [], sourceRef: "t" },
          sourceRef: "t",
        },
        T2: {
          id: "T2",
          role: "maker-move",
          next: "P2",
          move: {
            kind: "fixed",
            at: [{ kind: "const", x: P(503, 505).x, y: P(503, 505).y }],
          },
          show: [],
          why: { headline: "t", claims: [], sourceRef: "t" },
          sourceRef: "t",
        },
        T3: {
          id: "T3",
          role: "maker-move",
          next: "P3",
          move: {
            kind: "fixed",
            at: [{ kind: "const", x: P(505, 501).x, y: P(505, 501).y }],
          },
          show: [],
          why: { headline: "t", claims: [], sourceRef: "t" },
          sourceRef: "t",
        },
        ...haltTail("P1"),
        ...haltTail("P2"),
        ...haltTail("P3"),
      },
    };
    const { store, ctx } = sessionOn(def);
    const s = breaker(store, ctx, 5, 6);
    expect(s.strategy?.nodeId).toBe("P1");
    expect(s.strategy?.lastCase).toBe("t:holes");
  });
});

describe("route failure taxonomy (Phase 18, pure states)", () => {
  const go: ClassifierDef = {
    id: "test:rt-go",
    resultTags: ["go"],
    classify(_state, _inputs, _config) {
      return { kind: "classified", result: { tag: "go", bindings: {} } };
    },
    boundaries(_state, _inputs, _config) {
      return { kind: "ok", lines: [] };
    },
  };
  if (getClassifier(go.id) === undefined) {
    registerClassifier(go);
  }

  function breakerDef(id: string, routes: RouteRule[]): StrategyDef {
    return {
      id: "test:rt-def",
      k: 3,
      version: "0.0.0",
      source: { paper: "test", stepMap: {} },
      entry: id,
      nodes: {
        [id]: {
          id,
          role: "classify-breaker",
          routes,
          show: [],
          why: { headline: "t", claims: [], sourceRef: "t" },
          sourceRef: "t",
        },
      },
    };
  }

  function state2(): ReturnType<typeof sandboxState> {
    return sandboxState([P(0, 0), P(4, 0)]);
  }

  it("unregistered classifier fails closed with its id", () => {
    const def = breakerDef("n", [
      { case: "c", when: { kind: "classifier", classifierId: "test:rt-nope", on: { tag: "x" } }, target: "n" },
    ]);
    const r = classify(def, state2(), "n", "p2", testCtx().config);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.report.failed.id).toBe("test:rt-nope");
      expect(r.report.phase).toBe("route");
    }
  });

  it("binding miss fails closed (never partial bindings)", () => {
    const def = breakerDef("n", [
      {
        case: "c",
        when: { kind: "classifier", classifierId: "test:rt-go", on: { tag: "go" } },
        target: "n",
        bind: { twin: { kind: "result", field: "missing" } },
      },
    ]);
    const r = classify(def, state2(), "n", "p2", testCtx().config);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.report.failed.detail).toContain("binding references missing");
    }
  });

  it("no route matched is a defect (never uncovered)", () => {
    const def = breakerDef("n", [
      {
        case: "c",
        when: {
          kind: "region",
          expr: {
            kind: "halfplane",
            thru: [
              { kind: "const", x: P(100, 100).x, y: P(100, 100).y },
              { kind: "const", x: P(200, 100).x, y: P(200, 100).y },
            ],
            side: "left",
          },
        },
        target: "n",
      },
    ]);
    const r = classify(def, state2(), "n", "p2", testCtx().config);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.report.failed.detail).toContain("no route matched");
    }
  });

  it("unknown point id fails closed", () => {
    const def = breakerDef("n", [
      { case: "c", when: { kind: "all" }, target: "n" },
    ]);
    const r = classify(def, state2(), "n", "p99", testCtx().config);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.report.failed.detail).toContain("no placed point");
    }
  });

  it("classify on a non-classify node fails closed", () => {
    const def = breakerDef("n", [
      { case: "c", when: { kind: "all" }, target: "n" },
    ]);
    (def.nodes["n"] as { role: string }).role = "terminal";
    const r = classify(def, state2(), "n", "p2", testCtx().config);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.report.failed.detail).toContain("non-classify node");
    }
  });
});
