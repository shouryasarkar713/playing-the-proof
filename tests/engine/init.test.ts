// tests/engine/init.test.ts — initSession guided rules: StrategyStart
// required/forbidden by entry role, classify-entry Phase-13 gate, and
// entry-chain failure → accepted-terminal integrity.
import { describe, expect, it } from "vitest";
import { Store } from "../../src/session/store.ts";
import { startSession } from "../../src/session/commit.ts";
import { registerStrategy, strategies } from "../../src/strategy/registry.ts";
import type { StrategyDef } from "../../src/strategy/types.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import {
  hasFixtureStart,
  holeToPointList,
  registerFixtureStart,
} from "../../src/engine/init.ts";
import { P } from "../strategy/scaffolding.ts";
import { ALL_TEST_CHECKERS } from "../strategy/scaffolding.ts";
import { registerChecker } from "../../src/verification/invariants.ts";
import { ensureK5 } from "../strategies/k5driver.ts";
import { testCtx } from "../helpers.ts";

ensureK5();

for (const checker of ALL_TEST_CHECKERS) {
  registerChecker(checker);
}

function makerNode(
  id: string,
  next: string,
  x: number,
  y: number,
): StrategyDef["nodes"][string] {
  return {
    id,
    role: "maker-move",
    next,
    move: {
      kind: "fixed",
      at: [{ kind: "const", x: P(x, y).x, y: P(x, y).y }],
    },
    show: [],
    why: { headline: "t", claims: [], sourceRef: "t" },
    sourceRef: "t",
  };
}

function classifyNode(
  id: string,
  target: string,
): StrategyDef["nodes"][string] {
  return {
    id: "C0",
    role: "classify-breaker",
    routes: [{ case: "t:any", when: { kind: "all" }, target }],
    show: [],
    why: { headline: id, claims: [], sourceRef: "t" },
    sourceRef: "t",
  };
}

// Minimal classify-entry def (k=3 fixture): entry C0 → M0 → T0.
const bootDef: StrategyDef = {
  id: "td-boot",
  k: 3,
  version: "0.0.0",
  source: { paper: "test", stepMap: {} },
  entry: "C0",
  nodes: {
    C0: { ...classifyNode("C0", "M0"), id: "C0" },
    M0: { ...makerNode("M0", "T0", 5, 5), id: "M0" },
    T0: {
      id: "T0",
      role: "terminal",
      show: [],
      why: { headline: "t", claims: [], sourceRef: "t" },
      sourceRef: "t",
    },
  },
};
registerStrategy(bootDef, "fixture");

// Entry chain that fails immediately (pre fails on the entry node).
const initFailDef: StrategyDef = {
  id: "td-initfail",
  k: 3,
  version: "0.0.0",
  source: { paper: "test", stepMap: {} },
  entry: "entry",
  nodes: {
    entry: {
      id: "entry",
      role: "maker-move",
      next: "T0",
      move: {
        kind: "fixed",
        at: [{ kind: "const", x: P(0, 0).x, y: P(0, 0).y }],
      },
      pre: [{ kind: "custom", checkerId: "test:fail", args: {}, describe: "x" }],
      show: [],
      why: { headline: "t", claims: [], sourceRef: "t" },
      sourceRef: "t",
    },
    T0: {
      id: "T0",
      role: "terminal",
      show: [],
      why: { headline: "t", claims: [], sourceRef: "t" },
      sourceRef: "t",
    },
  },
};
registerStrategy(initFailDef, "fixture");

describe("initSession start rules (§5.10, §6.2)", () => {
  it("strategyStart is forbidden for maker-move entries", () => {
    const store = new Store();
    const ctx = testCtx();
    const r = startSession(
      {
        kind: "guided",
        config: { mode: "break", window: ctx.config.window },
        strategyId: "td-initfail",
        mode: "break",
        strategyStart: { kind: "continue", points: [], owners: [], selectedHole: null },
      },
      ctx,
      store,
    );
    expect(r.status).toBe("rejected");
    if (r.status === "rejected" && r.error?.code === "malformed-input") {
      expect(r.error.detail).toContain("forbidden");
    } else {
      throw new Error("expected malformed-input rejection");
    }
    expect(store.tree().transactions.length).toBe(0);
  });

  it("strategyStart is required for classify-breaker entries", () => {
    const store = new Store();
    const ctx = testCtx();
    const r = startSession(
      {
        kind: "guided",
        config: { mode: "break", window: ctx.config.window },
        strategyId: "td-boot",
        mode: "break",
      },
      ctx,
      store,
    );
    expect(r.status).toBe("rejected");
    if (r.status === "rejected" && r.error?.code === "malformed-input") {
      expect(r.error.detail).toContain("required");
    } else {
      throw new Error("expected malformed-input rejection");
    }
  });

  it("classify-breaker bootstrap runs the ladder (missing-witness on hole-less records)", () => {
    // td-boot is k=3 (hole size k−1 = 2): no 2-hole can exist, so a
    // 5-point continue record with null selectedHole falls through the
    // fallback ladder to the reachable missing-witness rung.
    const store = new Store();
    const ctx = testCtx();
    const r = startSession(
      {
        kind: "guided",
        config: { mode: "break", window: ctx.config.window },
        strategyId: "td-boot",
        mode: "break",
        strategyStart: {
          kind: "continue",
          points: [P(0, 0), P(10, 0), P(10, 10), P(0, 10), P(5, 20)],
          owners: ["maker", "breaker", "maker", "breaker", "maker"],
          selectedHole: null,
        },
      },
      ctx,
      store,
    );
    expect(r.status).toBe("rejected");
    if (r.status === "rejected") {
      expect(r.error?.code).toBe("missing-witness");
    }
    expect(store.tree().transactions.length).toBe(0);
  });

  it("entry-chain failure is accepted-terminal integrity", () => {
    const store = new Store();
    const ctx = testCtx();
    const r = startSession(
      {
        kind: "guided",
        config: { mode: "break", window: ctx.config.window },
        strategyId: "td-initfail",
        mode: "break",
      },
      ctx,
      store,
    );
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted" || r.state === undefined || r.txn === undefined) {
      throw new Error("unreachable");
    }
    expect(r.state.terminal?.kind).toBe("strategy-integrity-failure");
    if (r.state.terminal?.kind === "strategy-integrity-failure") {
      expect(r.state.terminal.report.failedAt).toBe("entry");
      expect(r.state.terminal.report.phase).toBe("pre");
    }
    // txn 0 commits the terminal initial state (zero events).
    expect(r.txn.events).toEqual([]);
    expect(r.txn.result.kind).toBe("terminal");
    expect(store.current().terminal?.kind).toBe("strategy-integrity-failure");
  });
});

describe("init gaps (Phase 18: ladder rungs, conversions, guards)", () => {
  const PENT = [P(0, 0), P(10, 0), P(13, 8), P(5, 13), P(-3, 8)];
  // Square + three blockers: zero 5-holes (the 0-fives bootstrap shape).
  const QUAD7 = [P(0, 0), P(10, 0), P(10, 10), P(0, 10), P(4, 3), P(6, 3), P(5, 6)];
  const PAR6 = [...PENT, P(100, 101)];
  const TWELVE = [
    ...PENT, P(100, 101), P(101, 100), P(100, 99), P(99, 100),
    P(-50, -50), P(-51, -49), P(60, 62),
  ];

  function k6def(id: string, entry: StrategyDef["nodes"][string]): StrategyDef {
    return {
      id,
      k: 6,
      version: "0.0.0",
      source: { paper: "test", stepMap: {} },
      entry: "C0",
      nodes: {
        C0: entry,
        M0: {
          id: "M0",
          role: "maker-move",
          next: "end",
          move: { kind: "fixed", at: [{ kind: "const", x: P(50, 50).x, y: P(50, 50).y }] },
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

  function bootEntry(): StrategyDef["nodes"][string] {
    return {
      id: "C0",
      role: "classify-breaker",
      routes: [{ case: "t:any", when: { kind: "all" }, target: "M0" }],
      show: [],
      why: { headline: "t", claims: [], sourceRef: "t" },
      sourceRef: "t",
    };
  }

  function ensureDef(def: StrategyDef): void {
    if (!strategies().has(def.id)) {
      registerStrategy(def, "core");
    }
  }

  function supplied(points: Pt[], selectedHole: Pt[]): { store: Store; ctx: ReturnType<typeof testCtx> } & { started: ReturnType<typeof startSession> } {
    const store = new Store();
    const ctx = testCtx();
    ensureDef(k6def("td-k6boot", bootEntry()));
    const started = startSession(
      {
        kind: "guided",
        config: { mode: "break", window: ctx.config.window },
        strategyId: "td-k6boot",
        mode: "break",
        strategyStart: { kind: "supplied", points, selectedHole },
      },
      ctx,
      store,
    );
    return { store, ctx, started };
  }

  it("P1 rejects collinear and out-of-window bootstraps", () => {
    const line = [P(0, 0), P(5, 0), P(10, 0), P(0, 10), P(10, 10)];
    const r = supplied(line, line.slice(0, 5)).started;
    expect(r.status).toBe("rejected");
    if (r.status !== "rejected" || r.error === undefined) {
      throw new Error("unreachable");
    }
    expect(r.error.code).toBe("not-gp-or-window");
    const far = [...PENT, P(2000000, 0), P(2000001, 0)];
    const r2 = supplied(far.slice(0, 7), far.slice(0, 5)).started;
    expect(r2.status).toBe("rejected");
    if (r2.status !== "rejected" || r2.error === undefined) {
      throw new Error("unreachable");
    }
    expect(r2.error.code).toBe("not-gp-or-window");
  });

  it("P2 rejects selected holes outside the set or off-convex", () => {
    const outside = supplied(PENT, [...PENT.slice(0, 4), P(500, 500)]).started;
    expect(outside.status).toBe("rejected");
    if (outside.status !== "rejected" || outside.error === undefined) {
      throw new Error("unreachable");
    }
    expect(outside.error.code).toBe("invalid-hole");
    const flat = supplied(PENT, [P(0, 0), P(10, 0), P(13, 8), P(5, 13), P(5, 5)]).started;
    expect(flat.status).toBe("rejected");
    if (flat.status !== "rejected" || flat.error === undefined) {
      throw new Error("unreachable");
    }
    expect(flat.error.code).toBe("invalid-hole");
  });

  it("missing-witness: continue record over a 5-hole-free set", () => {
    const store = new Store();
    const ctx = testCtx();
    ensureDef(k6def("td-k6boot", bootEntry()));
    const owners = QUAD7.map((_, i) => (i % 2 === 0 ? "maker" : "breaker") as "maker" | "breaker");
    const started = startSession(
      {
        kind: "guided",
        config: { mode: "break", window: ctx.config.window },
        strategyId: "td-k6boot",
        mode: "break",
        strategyStart: { kind: "continue", points: QUAD7, owners, selectedHole: null },
      },
      ctx,
      store,
    );
    expect(started.status).toBe("rejected");
    if (started.status !== "rejected" || started.error === undefined) {
      throw new Error("unreachable");
    }
    expect(started.error.code).toBe("missing-witness");
  });

  it("P3 with a 6-hole starts already terminal (maker-won)", () => {
    const { started, store } = supplied(TWELVE, PENT);
    expect(started.status).toBe("accepted");
    if (started.status !== "accepted") {
      throw new Error("unreachable");
    }
    expect(store.current().terminal?.kind).toBe("maker-won");
  });

  it("P4 rejects even-count bootstraps (parity)", () => {
    const r = supplied(PAR6, PENT).started;
    expect(r.status).toBe("rejected");
    if (r.status !== "rejected" || r.error === undefined) {
      throw new Error("unreachable");
    }
    expect(r.error.code).toBe("parity");
  });

  it("park pre-fail yields an accepted-terminal integrity", () => {
    const store = new Store();
    const ctx = testCtx();
    ensureDef(
      k6def("td-k6prefail", {
        id: "C0",
        role: "classify-breaker",
        routes: [{ case: "t:any", when: { kind: "all" }, target: "M0" }],
        pre: [{ kind: "exists-k-hole", k: 8 }],
        show: [],
        why: { headline: "t", claims: [], sourceRef: "t" },
        sourceRef: "t",
      }),
    );
    const started = startSession(
      {
        kind: "guided",
        config: { mode: "break", window: ctx.config.window },
        strategyId: "td-k6prefail",
        mode: "break",
        strategyStart: { kind: "supplied", points: PENT, selectedHole: PENT },
      },
      ctx,
      store,
    );
    expect(started.status).toBe("accepted");
    if (started.status !== "accepted") {
      throw new Error("unreachable");
    }
    expect(store.current().terminal?.kind).toBe("strategy-integrity-failure");
  });

  it("maker entry chain: terminal win with a witness, integrity without", () => {
    function chainDef(id: string, pts: Pt[]): StrategyDef {
      const nodes: StrategyDef["nodes"] = {};
      const ids = ["entry", "M1", "M2", "M3", "M4"];
      ids.forEach((nid, i) => {
        const at = pts[i] as Pt;
        nodes[nid] = {
          id: nid,
          role: "maker-move",
          next: i + 1 < ids.length ? (ids[i + 1] as string) : "end",
          move: { kind: "fixed", at: [{ kind: "const", x: at.x, y: at.y }] },
          show: [],
          why: { headline: "t", claims: [], sourceRef: "t" },
          sourceRef: "t",
        };
      });
      nodes["end"] = {
        id: "end",
        role: "terminal",
        show: [],
        why: { headline: "t", claims: [], sourceRef: "t" },
        sourceRef: "t",
      };
      return {
        id,
        k: 5,
        version: "0.0.0",
        source: { paper: "test", stepMap: {} },
        entry: "entry",
        nodes,
      };
    }
    const launch = (def: StrategyDef): Store => {
      ensureDef(def);
      const store = new Store();
      const ctx = testCtx();
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
      return store;
    };
    const won = launch(chainDef("td-chain-win", PENT));
    expect(won.current().terminal?.kind).toBe("maker-won");
    // Fifth point GP-legal but hole-free: the chain reaches the terminal
    // node, whose win verification fails closed (no witness).
    const quadFar = [P(0, 0), P(10, 0), P(10, 10), P(0, 10), P(30, 31)];
    const bare = launch(chainDef("td-chain-bare", quadFar));
    expect(bare.current().terminal?.kind).toBe("strategy-integrity-failure");
  });

  it("computed failure at init yields accepted-terminal integrity", () => {
    const twinFail: StrategyDef = {
      id: "td-initcomp",
      k: 5,
      version: "0.0.0",
      source: { paper: "test", stepMap: {} },
      entry: "entry",
      // A is start-provided (a reachable producer for G10) but never
      // bound in a plain guided start — the op fails closed at runtime.
      startVars: ["A"],
      nodes: {
        entry: {
          id: "entry",
          role: "computed-step",
          next: "end",
          compute: {
            kind: "select-twin-pair",
            anchorVar: "A",
            binds: { twinA: "T1", twinB: "T2" },
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
    ensureDef(twinFail);
    const store = new Store();
    const ctx = testCtx();
    const started = startSession(
      {
        kind: "guided",
        config: { mode: "break", window: ctx.config.window },
        strategyId: "td-initcomp",
        mode: "break",
      },
      ctx,
      store,
    );
    expect(started.status).toBe("accepted");
    expect(store.current().terminal?.kind).toBe("strategy-integrity-failure");
  });

  it("construction failure and post failure at init", () => {
    function makerDef(id: string, at: Pt, post: StrategyDef["nodes"][string]["post"]): StrategyDef {
      return {
        id,
        k: 5,
        version: "0.0.0",
        source: { paper: "test", stepMap: {} },
        entry: "entry",
        nodes: {
          entry: {
            id: "entry",
            role: "maker-move",
            next: "end",
            move: { kind: "fixed", at: [{ kind: "const", x: at.x, y: at.y }] },
            ...(post !== undefined ? { post } : {}),
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
    const launch = (def: StrategyDef): string | null => {
      ensureDef(def);
      const store = new Store();
      const ctx = testCtx();
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
      return store.current().terminal?.kind ?? null;
    };
    // Fixed placement outside the window cannot construct.
    expect(launch(makerDef("td-initconstr", P(2000000, 0), undefined))).toBe(
      "strategy-integrity-failure",
    );
    // A 5-hole post on one point cannot pass.
    expect(
      launch(makerDef("td-initpost", P(0, 0), [{ kind: "exists-k-hole", k: 5 }])),
    ).toBe("strategy-integrity-failure");
  });

  it("holeToPointList conversions (typed, never casts)", () => {
    const pts = PENT.map((p, i) => ({
      id: `p${i + 1}`,
      owner: "maker" as const,
      pt: p,
      move: i + 1,
    }));
    expect(holeToPointList({ k: 5, verts: ["p1", "p2", "p3"] }, pts)).toEqual({
      ok: false,
      reason: "bad-cardinality",
    });
    expect(
      holeToPointList({ k: 5, verts: ["p1", "p2", "p3", "p4", "p99"] }, pts),
    ).toEqual({ ok: false, reason: "missing-point" });
    const shuffled = holeToPointList(
      { k: 5, verts: ["p5", "p1", "p2", "p3", "p4"] },
      pts,
    );
    expect(shuffled.ok).toBe(true);
    if (!shuffled.ok) {
      throw new Error("unreachable");
    }
    // Canonical CCW order (lex-min start, same direction); rotation to any
    // other start is non-canonical.
    expect(shuffled.pts.length).toBe(5);
    const reversed = holeToPointList(
      { k: 5, verts: ["p5", "p4", "p3", "p2", "p1"] },
      pts,
    );
    expect(reversed).toEqual({ ok: false, reason: "non-canonical" });
  });

  it("sandbox guards + unknown strategies reject", () => {
    const store = new Store();
    const ctx = testCtx();
    const badMode = startSession(
      {
        kind: "sandbox",
        config: { mode: "break", window: ctx.config.window },
        k: 5,
      },
      ctx,
      store,
    );
    expect(badMode.status).toBe("rejected");
    const badK = startSession(
      {
        kind: "sandbox",
        config: { mode: "sandbox", window: ctx.config.window },
        k: 9 as never,
      },
      ctx,
      store,
    );
    expect(badK.status).toBe("rejected");
    const unknown = startSession(
      {
        kind: "guided",
        config: { mode: "break", window: ctx.config.window },
        strategyId: "test:nope-strategy",
        mode: "break",
      },
      ctx,
      store,
    );
    expect(unknown.status).toBe("rejected");
    if (unknown.status !== "rejected" || unknown.error === undefined) {
      throw new Error("unreachable");
    }
    expect(unknown.error.code).toBe("malformed-input");
  });

  it("fixture starts register, reject dups and empty refs", () => {
    expect(hasFixtureStart("test:missing-ref")).toBe(false);
    expect(() => registerFixtureStart("", { points: [], selectedHole: [] })).toThrowError(
      /empty scenarioRef/,
    );
    registerFixtureStart("test:ref-a", { points: PENT, selectedHole: PENT });
    expect(hasFixtureStart("test:ref-a")).toBe(true);
    expect(() =>
      registerFixtureStart("test:ref-a", { points: PENT, selectedHole: PENT }),
    ).toThrowError(/already registered/);
  });

  it("guided boot rejects a forbidden StrategyStart (maker-move entry)", () => {
    const store = new Store();
    const ctx = testCtx();
    const started = startSession(
      {
        kind: "guided",
        config: { mode: "break", window: ctx.config.window },
        strategyId: "esmb-k5",
        mode: "break",
        strategyStart: { kind: "supplied", points: PENT, selectedHole: PENT },
      },
      ctx,
      store,
    );
    expect(started.status).toBe("rejected");
  });
});
