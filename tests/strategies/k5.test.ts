// tests/strategies/k5.test.ts — esmb-k5 (§23.7, CI tier): registration,
// node-graph walks with parked-node assertions, adversarial B3 pack,
// trapezoid ± fixtures, status discipline, graph mutations, explanation
// tiers. The seeded drivers live here (300-game CI tier) and in
// tests/slow/k5driver.test.ts (1000-game M5 sign-off tier).
import { describe, expect, it } from "vitest";
import { Rat } from "../../src/geometry/rat.ts";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { signedArea2 } from "../../src/geometry/predicates.ts";
import { commit, startSession } from "../../src/session/commit.ts";
import { Store } from "../../src/session/store.ts";
import { reduceTransaction } from "../../src/engine/orchestrator.ts";
import type { RuntimeCtx } from "../../src/engine/orchestrator.ts";
import {
  classifyFour,
  effectiveStatus,
  registerStrategy,
  strategies,
} from "../../src/strategy/registry.ts";
import { ensureK5 } from "./k5driver.ts";
import { getChecker } from "../../src/verification/invariants.ts";
import { checkPost } from "../../src/verification/pipeline.ts";
import { nodeOf } from "../../src/strategy/runtime.ts";
import { evalPtListIds } from "../../src/strategy/eval.ts";
import { nodeExplanation, statusBadge } from "../../src/engine/describe.ts";
import { lintSources } from "../../src/explain/claimlint.ts";
import type { StrategyDef, StrategyNode } from "../../src/strategy/types.ts";
import { esmbK5 } from "../../src/strategy/strategies/k5/def.ts";
import { classifyB3 } from "../../src/strategy/strategies/k5/classifyB3.ts";
import type { GameState } from "../../src/game/types.ts";
import { P } from "../strategy/scaffolding.ts";
import { mulberry32, testCtx } from "../helpers.ts";
import { playK5Game, refoldK5, runK5Suite } from "./k5driver.ts";

// Idempotent registration lives in the driver module (single source).
ensureK5();

// Node lookup with a test-bug throw (noUncheckedIndexedAccess is on).
function k5node(def: StrategyDef, id: string): StrategyNode {
  const n = def.nodes[id];
  if (n === undefined) {
    throw new Error(`test bug: no node ${id}`);
  }
  return n;
}

function launch(): { store: Store; ctx: RuntimeCtx; state: GameState } {
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
  if (started.status !== "accepted" || started.state === undefined) {
    throw new Error("unreachable");
  }
  return { store, ctx, state: started.state };
}

// One Breaker placement through the full pipeline (commit publishes).
function breaker(
  store: Store,
  ctx: RuntimeCtx,
  at: Pt,
): ReturnType<typeof reduceTransaction> {
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
  return r;
}

const rat = (n: number, d = 1): import("../../src/geometry/rat.ts").Rat =>
  Rat.make(BigInt(n), BigInt(d));

// Exact |area2| (§23.3 item 1 comparison operand).
function area2abs(a: Pt, b: Pt, c: Pt): import("../../src/geometry/rat.ts").Rat {
  return signedArea2(a, b, c).abs();
}

// Vertex centroid (strictly interior for convex position).
function centroidOf(verts: readonly Pt[]): Pt {
  let sx = rat(0);
  let sy = rat(0);
  for (const v of verts) {
    sx = sx.add(v.x);
    sy = sy.add(v.y);
  }
  const n = rat(verts.length);
  return pt(sx.div(n), sy.div(n));
}

// Weighted barycenter (strictly interior for a triangle).
function bary(a: Pt, b: Pt, c: Pt, wa: number, wb: number, wc: number): Pt {
  const w = rat(wa + wb + wc);
  return pt(
    a.x.mul(rat(wa)).add(b.x.mul(rat(wb))).add(c.x.mul(rat(wc))).div(w),
    a.y.mul(rat(wa)).add(b.y.mul(rat(wb))).add(c.y.mul(rat(wc))).div(w),
  );
}

// First legal candidate plays (reduce without commit until accepted).
function breakerFirstLegal(store: Store, ctx: RuntimeCtx, cands: Pt[]): Pt {
  for (const at of cands) {
    const r = reduceTransaction(
      store.current(),
      { kind: "place", owner: "breaker", at },
      ctx,
    );
    if (r.status === "accepted") {
      commit(r, { kind: "place", owner: "breaker", at }, store, ctx);
      return at;
    }
  }
  throw new Error("breakerFirstLegal: no candidate legal — test bug");
}

describe("k5 registration (G1–G11)", () => {
  it("esmb-k5 registers as core with all nodes reachable", () => {
    const rs = strategies().get("esmb-k5");
    expect(rs !== undefined).toBe(true);
    expect(Object.keys(esmbK5.nodes).sort()).toEqual(
      [
        "k5:await-b1",
        "k5:blunder",
        "k5:entry",
        "k5:r2:a2",
        "k5:r2:classify",
        "k5:r3:classify",
        "k5:r3:co-shoulder",
        "k5:r4:extend",
        "k5:win",
      ].sort(),
    );
    expect(esmbK5.entry).toBe("k5:entry");
  });
});

describe("k5 init + opening (txn 0)", () => {
  it("A1=(0,0), parks at await-b1", () => {
    const { state } = launch();
    expect(state.points.length).toBe(1);
    expect(state.points[0]?.pt.x.toString()).toBe("0/1");
    expect(state.points[0]?.pt.y.toString()).toBe("0/1");
    expect(state.strategy?.nodeId).toBe("k5:await-b1");
    expect(state.strategy?.vars).toEqual({ A1: "p1" });
  });
});

describe("k5 blunder walk (convex B2 → R3 win)", () => {
  it("B1=(10,0), B2=(30,5): convex → extend → maker-won in round 3, 5 points", () => {
    const { store, ctx } = launch();
    const r1 = breaker(store, ctx, P(10, 0));
    expect(r1.status).toBe("accepted");
    expect(store.current().strategy?.nodeId).toBe("k5:r2:classify");
    const r2 = breaker(store, ctx, P(30, 5));
    expect(store.current().strategy?.lastCase).toBe("k5:b2:convex");
    const cur = store.current();
    expect(cur.terminal?.kind).toBe("maker-won");
    if (cur.terminal?.kind === "maker-won") {
      expect(cur.terminal.nodeId).toBe("k5:win");
      expect(cur.points.length).toBe(5);
      expect(cur.terminal.witness.length).toBeGreaterThan(0);
    }
    expect(r2.events.length).toBe(2);
    expect(r2.events[1]?.owner).toBe("maker");
  });
});

describe("k5 wedge walk (B2 outside, swallows B1)", () => {
  it("B1=(10,0), B2=(10,-10): interior is p2, full win", () => {
    const { store, ctx } = launch();
    breaker(store, ctx, P(10, 0));
    const r = breaker(store, ctx, P(10, -10));
    expect(r.status).toBe("accepted");
    const cur = store.current();
    expect(cur.strategy?.lastCase).toBe("k5:b2:one-interior");
    // The swallowed point is B1 itself (ownership irrelevant).
    expect(cur.strategy?.vars).toMatchObject({ interior: "p2" });
    const outer = cur.strategy?.vars["outer"];
    expect([...(outer as string[])].sort()).toEqual(["p1", "p3", "p4"]);
    expect(cur.strategy?.nodeId).toBe("k5:r3:classify");
    breaker(store, ctx, P(-30, -30));
    expect(store.current().terminal?.kind).toBe("maker-won");
    expect(store.current().points.length).toBe(7);
  });
});

describe("k5 blocked-intended walk (B3 inside the intended hole)", () => {
  // B3 = centroid of the intended 4-hole vertices (strictly interior for a
  // convex quadrilateral) from the live vars — the emergent-hole case.
  // (u,v) recomputed by §23.3 item 1 (same deterministic rule as the move
  // and the checker: farthest edge by exact |area2|, ties smallest index).
  function intendedCentroid(cur: GameState): Pt {
    const vars = cur.strategy?.vars ?? {};
    const outer = vars["outer"] as string[];
    const interior = vars["interior"] as string;
    const a3 = vars["A3"] as string;
    const byId = new Map(cur.points.map((p) => [p.id, p.pt]));
    const o = outer.map((id) => byId.get(id) as Pt);
    const inp = byId.get(interior) as Pt;
    let best = 0;
    let bestAbs = area2abs(o[0] as Pt, o[1] as Pt, inp);
    for (let i = 1; i < 3; i += 1) {
      const m = area2abs(o[i] as Pt, o[(i + 1) % 3] as Pt, inp);
      if (m.cmp(bestAbs) > 0) {
        best = i;
        bestAbs = m;
      }
    }
    return centroidOf([
      o[best] as Pt,
      o[(best + 1) % 3] as Pt,
      inp,
      byId.get(a3) as Pt,
    ]);
  }

  it("B3 inside intended hole → k5:b3:blocked-intended → win", () => {
    const { store, ctx } = launch();
    breaker(store, ctx, P(10, 0));
    breaker(store, ctx, pt(rat(10), rat(9)));
    const mid = store.current();
    expect(mid.strategy?.nodeId).toBe("k5:r3:classify");
    breaker(store, ctx, intendedCentroid(mid));
    const cur = store.current();
    expect(cur.strategy?.lastCase).toBe("k5:b3:blocked-intended");
    expect(cur.terminal?.kind).toBe("maker-won");
  });
});

describe("k5 thin-epsilon (B2 near an outer edge)", () => {
  it("B2=(5,1/100): construction still succeeds, full win", () => {
    const { store, ctx } = launch();
    breaker(store, ctx, P(10, 0));
    breaker(store, ctx, pt(rat(5), rat(1, 100)));
    const cur = store.current();
    expect(cur.strategy?.lastCase).toBe("k5:b2:one-interior");
    expect(cur.strategy?.nodeId).toBe("k5:r3:classify");
    expect(cur.points.length).toBe(5);
    breaker(store, ctx, P(-30, -30));
    expect(store.current().terminal?.kind).toBe("maker-won");
  });
});

describe("k5 adversarial B3 pack (window corners + triangle interior)", () => {
  function openSafe(): { store: Store; ctx: RuntimeCtx } {
    const { store, ctx } = launch();
    breaker(store, ctx, P(10, 0));
    breaker(store, ctx, pt(rat(10), rat(9)));
    expect(store.current().strategy?.nodeId).toBe("k5:r3:classify");
    return { store, ctx };
  }

  it.each([
    [999999, 999999],
    [-999999, 999999],
    [999999, -999999],
    [-999999, -999999],
  ])("B3 far corner (%i,%i) → maker-won", (x, y) => {
    const { store, ctx } = openSafe();
    breaker(store, ctx, P(x, y));
    expect(store.current().terminal?.kind).toBe("maker-won");
  });

  it("B3 inside the outer triangle → maker-won", () => {
    const { store, ctx } = openSafe();
    const mid = store.current();
    const outer = mid.strategy?.vars["outer"] as string[];
    const byId = new Map(mid.points.map((p) => [p.id, p.pt]));
    const tri = outer.map((id) => byId.get(id) as Pt);
    const [a, b, c] = tri as [Pt, Pt, Pt];
    // Several strictly-interior candidates (barycenters); the first legal
    // one plays (a fixed rational can land on a placed-pair line).
    const cands = [
      centroidOf(tri),
      bary(a, b, c, 2, 1, 1),
      bary(a, b, c, 1, 2, 1),
      bary(a, b, c, 1, 1, 2),
    ];
    breakerFirstLegal(store, ctx, cands);
    expect(store.current().terminal?.kind).toBe("maker-won");
  });
});

describe("classifyFour fixtures (§23.2)", () => {
  const cfg = (): import("../../src/game/types.ts").Configuration =>
    testCtx().config;

  function fourState(pts: Pt[]): GameState {
    return {
      seq: 0,
      k: 5,
      mode: "break",
      points: pts.map((p, i) => ({
        id: `p${i + 1}`,
        owner: (i % 2 === 0 ? "maker" : "breaker") as "maker" | "breaker",
        pt: p,
        move: i + 1,
      })),
      turn: "breaker",
      terminal: null,
      strategy: null,
    };
  }

  it("inside-triangle B2 → one-interior, interior is the last point", () => {
    const r = classifyFour.classify(
      fourState([P(0, 0), P(10, 0), P(20, 28), P(10, 9)]),
      { pts: ["p1", "p2", "p3", "p4"] },
      cfg(),
    );
    expect(r.kind).toBe("classified");
    if (r.kind === "classified") {
      expect(r.result.tag).toBe("one-interior");
      expect(r.result.bindings?.["interior"]).toBe("p4");
    }
  });

  it("swallow wedge: B2=(10,-10) swallows B1 → interior p2, CCW outer", () => {
    const r = classifyFour.classify(
      fourState([P(0, 0), P(10, 0), P(20, 28), P(10, -10)]),
      { pts: ["p1", "p2", "p3", "p4"] },
      cfg(),
    );
    expect(r.kind).toBe("classified");
    if (r.kind === "classified") {
      expect(r.result.tag).toBe("one-interior");
      expect(r.result.bindings?.["interior"]).toBe("p2");
      // CCW hull order of {(0,0),(20,28),(10,-10)} from (0,0): (0,0)→(10,-10)→(20,28)?
      // orient((0,0),(10,-10),(20,28)) = 10·28+10·20 = 480 > 0 ✓ CCW.
      expect(r.result.bindings?.["outer"]).toEqual(["p1", "p4", "p3"]);
    }
  });

  it("convex four → convex, no bindings", () => {
    const r = classifyFour.classify(
      fourState([P(0, 0), P(10, 0), P(20, 28), P(30, 5)]),
      { pts: ["p1", "p2", "p3", "p4"] },
      cfg(),
    );
    expect(r).toEqual({ kind: "classified", result: { tag: "convex" } });
  });

  it("|pts| ≠ 4 → integrity failure", () => {
    const r = classifyFour.classify(
      fourState([P(0, 0), P(10, 0), P(20, 28)]),
      { pts: ["p1", "p2", "p3"] },
      cfg(),
    );
    expect(r.kind).toBe("integrity");
  });
});

describe("classifyB3 fixtures (§23.4)", () => {
  // Five pre-B3 points + B3 last: the safe-walk opening with A3 placed.
  function b3State(b3: Pt): GameState {
    const { store, ctx } = launch();
    breaker(store, ctx, P(10, 0));
    breaker(store, ctx, pt(rat(10), rat(9)));
    const mid = store.current();
    void ctx;
    const pts = [...mid.points.map((p) => p.pt), b3];
    return {
      seq: 0,
      k: 5,
      mode: "break",
      points: pts.map((p, i) => ({
        id: `p${i + 1}`,
        owner: (i % 2 === 0 ? "maker" : "breaker") as "maker" | "breaker",
        pt: p,
        move: i + 1,
      })),
      turn: "breaker",
      terminal: null,
      strategy: null,
    };
  }

  it("B3 far away → else", () => {
    const r = classifyB3.classify(b3State(P(-30, -30)), {}, testCtx().config);
    expect(r).toEqual({ kind: "classified", result: { tag: "else" } });
  });

  it("B3 inside a pre-B3 4-hole → blocked-intended", () => {
    // B3 at the outer-triangle centroid: inside the outer triangle, hence
    // inside-or-on some pre-B3 4-hole (the outer triangle is covered by the
    // pre-B3 4-hole family... verified by the tag itself).
    const { store, ctx } = launch();
    breaker(store, ctx, P(10, 0));
    breaker(store, ctx, pt(rat(10), rat(9)));
    const mid = store.current();
    const outer = mid.strategy?.vars["outer"] as string[];
    const byId = new Map(mid.points.map((p) => [p.id, p.pt]));
    const centroid = centroidOf(outer.map((id) => byId.get(id) as Pt));
    void ctx;
    const r = classifyB3.classify(b3State(centroid), {}, testCtx().config);
    expect(r.kind).toBe("classified");
    if (r.kind === "classified") {
      expect(r.result.tag).toBe("blocked-intended");
    }
  });

  it("budget-exhausted enumeration → integrity (never a fake tag)", () => {
    const r = classifyB3.classify(
      b3State(P(-30, -30)),
      {},
      testCtx(1).config,
    );
    expect(r.kind).toBe("integrity");
    if (r.kind === "integrity") {
      expect(r.failure.reason).toBe("undecidable-computation");
    }
  });

  it("boundaries: pair-lines ∪ hole lines; exhausted → integrity", () => {
    const ok = classifyB3.boundaries(
      b3State(P(-30, -30)),
      {},
      testCtx().config,
    );
    expect(ok.kind).toBe("ok");
    if (ok.kind === "ok") {
      // C(5,2) = 10 pair-lines, plus hole supporting lines.
      expect(ok.lines.length).toBeGreaterThanOrEqual(10);
    }
    const bad = classifyB3.boundaries(b3State(P(-30, -30)), {}, testCtx(1).config);
    expect(bad.kind).toBe("integrity");
  });
});

describe("k5-inv:trapezoid fixtures (§23.3a)", () => {
  it("positive: driven A3 resolves exact args, post passes, hole verified", () => {
    const { store, ctx } = launch();
    breaker(store, ctx, P(10, 0));
    breaker(store, ctx, pt(rat(10), rat(9)));
    const cur = store.current();
    expect(cur.strategy?.nodeId).toBe("k5:r3:classify");
    // The co-shoulder node that just ran (A3 placed in the same txn).
    const node = nodeOf(esmbK5, "k5:r3:co-shoulder");
    const spec = (node.post ?? []).find((s) => s.kind === "custom");
    expect(spec !== undefined).toBe(true);
    if (spec === undefined || spec.kind !== "custom") {
      throw new Error("unreachable");
    }
    // Arg resolution (the same evalPtListIds path checkCustom uses).
    const resolved: Record<string, readonly string[]> = {};
    for (const [name, expr] of Object.entries(spec.args)) {
      const ids = evalPtListIds(expr, cur);
      expect(ids.kind).toBe("ok");
      if (ids.kind === "ok") {
        resolved[name] = ids.ids;
      }
    }
    expect(Object.keys(resolved).sort()).toEqual(["A3", "interior", "outer"]);
    expect(resolved["outer"]?.length).toBe(3);
    expect(resolved["interior"]).toEqual(["p4"]);
    expect(resolved["A3"]).toEqual(["p5"]);
    // The checker recomputes (u,v) and verifies the hole on this state.
    const checker = getChecker("k5-inv:trapezoid");
    expect(checker !== undefined).toBe(true);
    const verdict = checker?.check(
      cur,
      resolved as Record<string, readonly string[]>,
      ctx.config,
    );
    expect(verdict?.passed).toBe(true);
    expect(verdict?.id).toBe("k5-inv:trapezoid");
  });

  it("negative: mis-placed A3 fails the invariant (never uncovered/skipped)", () => {
    // Test-only def: identical graph, co-shoulder replaced by a fixed
    // placement strictly inside the outer triangle AND inside the
    // u,v,interior triangle (so {u,v,interior,A3} is not convex — no
    // 4-hole), GP-legal. (11,10) does NOT work: it accidentally completes
    // a genuine 4-hole on another edge — the checker says so, correctly.
    const misNodes: Record<string, StrategyNode> = {};
    for (const [nid, n] of Object.entries(esmbK5.nodes)) {
      misNodes[nid] = { ...n };
    }
    misNodes["k5:r3:co-shoulder"] = {
      ...k5node(esmbK5, "k5:r3:co-shoulder"),
      move: {
        kind: "fixed",
        at: [{ kind: "const", x: rat(11), y: rat(14) }],
      },
    };
    const misplaced: StrategyDef = {
      ...esmbK5,
      id: "test:k5-misplace",
      nodes: misNodes,
    };
    registerStrategy(misplaced, "experimental-extension");
    const store = new Store();
    const ctx = testCtx();
    const started = startSession(
      {
        kind: "guided",
        config: { mode: "break", window: ctx.config.window },
        strategyId: "test:k5-misplace",
        mode: "break",
      },
      ctx,
      store,
    );
    expect(started.status).toBe("accepted");
    const step = (at: Pt): ReturnType<typeof reduceTransaction> => {
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
      return r;
    };
    step(P(10, 0));
    const r = step(pt(rat(10), rat(9)));
    const cur = store.current();
    expect(cur.terminal?.kind).toBe("strategy-integrity-failure");
    if (cur.terminal?.kind === "strategy-integrity-failure") {
      expect(cur.terminal.report.failedAt).toBe("k5:r3:co-shoulder");
      expect(cur.terminal.report.phase).toBe("post");
      expect(cur.terminal.report.failed.id).toBe("k5-inv:trapezoid");
    }
    expect(r.outcome?.kind).toBe("terminal");
  });

  it("cardinality violation throws CheckerIntegrityError (not a verdict)", () => {
    const checker = getChecker("k5-inv:trapezoid");
    const { ctx } = launch();
    expect(() =>
      checker?.check(store_of(ctx).current(), { outer: ["p1"] }, ctx.config),
    ).toThrow();
  });
});

function store_of(ctx: RuntimeCtx): Store {
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
  expect(started.status).toBe("accepted");
  return store;
}

describe("k5 explanation tiers + ClaimLint (§23.7 item 7)", () => {
  const TIERS = new Set([
    "verified-geometry",
    "strategy-rule",
    "theorem-cited",
    "observed",
    "uncovered",
  ]);

  it("every node explains with valid tiers and lint-clean text", () => {
    for (const node of Object.values(esmbK5.nodes)) {
      expect(node.why.headline.length).toBeGreaterThan(0);
      for (const claim of [
        ...node.why.claims,
        ...(node.why.threats ?? []),
        ...(node.why.invariantNotes ?? []),
      ]) {
        expect(TIERS.has(claim.tier)).toBe(true);
        expect(claim.text.length).toBeGreaterThan(0);
      }
    }
    const sources = [];
    for (const node of Object.values(esmbK5.nodes)) {
      sources.push({ text: node.why.headline });
      for (const claim of [
        ...node.why.claims,
        ...(node.why.threats ?? []),
        ...(node.why.invariantNotes ?? []),
      ]) {
        sources.push({ text: claim.text });
      }
    }
    expect(lintSources(sources)).toEqual([]);
  });

  it("live explanations track the parked node (strategy + why + invariants)", () => {
    const { store, ctx } = launch();
    breaker(store, ctx, P(10, 0));
    const cur = store.current();
    const expl = nodeExplanation(cur, ctx);
    expect(expl?.nodeId).toBe("k5:r2:classify");
    expect(expl?.headline).toBe(
      k5node(esmbK5, "k5:r2:classify").why.headline,
    );
    const post = checkPost(cur, nodeOf(esmbK5, "k5:r2:classify"), ctx.config);
    expect(post.checks).toEqual([]);
  });
});

describe("k5 status discipline (§23.7 item 9, Gate E)", () => {
  it("effectiveStatus is validated-randomized; badge agrees on live states", () => {
    const rs = strategies().get("esmb-k5");
    expect(rs !== undefined).toBe(true);
    if (rs === undefined) {
      throw new Error("unreachable");
    }
    expect(effectiveStatus(rs)).toBe("validated-randomized");
    const { store, ctx } = launch();
    breaker(store, ctx, P(10, 0));
    const badge = statusBadge(store.current(), ctx);
    expect(badge?.text).toBe("Status: validated-randomized");
  });
});

describe("k5 graph mutations rejected (G1–G11, §23.7 item 10)", () => {
  function mutate(
    id: string,
    f: (def: StrategyDef) => StrategyDef,
  ): () => void {
    return () => {
      const nodes: Record<string, StrategyNode> = {};
      for (const [nid, n] of Object.entries(esmbK5.nodes)) {
        nodes[nid] = { ...n };
      }
      const copy: StrategyDef = { ...esmbK5, id, nodes };
      registerStrategy(f(copy), "experimental-extension");
    };
  }

  it("dangling next (G3)", () => {
    expect(
      mutate("test:k5-dangle", (d) => ({
        ...d,
        nodes: {
          ...d.nodes,
          "k5:entry": { ...k5node(d, "k5:entry"), next: "nope" },
        },
      })),
    ).toThrow(/G3/);
  });

  it("classify-free cycle (G6)", () => {
    // Self-loop on a maker-move: every node stays reachable (win via the
    // r4:extend branch), so G5 passes and the classify-free cycle [blunder]
    // trips G6.
    expect(
      mutate("test:k5-cycle", (d) => ({
        ...d,
        nodes: {
          ...d.nodes,
          "k5:blunder": { ...k5node(d, "k5:blunder"), next: "k5:blunder" },
        },
      })),
    ).toThrow(/G6/);
  });

  it("unbound var (G10)", () => {
    expect(
      mutate("test:k5-unbound", (d) => ({
        ...d,
        nodes: {
          ...d.nodes,
          "k5:r3:co-shoulder": {
            ...k5node(d, "k5:r3:co-shoulder"),
            move: {
              kind: "co-shoulder",
              outer: { kind: "var", v: "outer" },
              interior: "NOPE",
            },
          },
        },
      })),
    ).toThrow(/G10/);
  });

  it("k=4 def rejected (G11)", () => {
    expect(() =>
      registerStrategy(
        { ...esmbK5, id: "test:k5-k4", k: 4 as unknown as 5 },
        "core",
      ),
    ).toThrow(/G11/);
  });

  it("non-fixture k=3 def rejected (G11)", () => {
    expect(() =>
      registerStrategy({ ...esmbK5, id: "test:k5-k3", k: 3 }, "core"),
    ).toThrow(/G11/);
  });
});

describe("k5 safe walk (B2 one-interior → R4 win)", () => {
  it("B1=(10,0), B2=centroid, B3 far: maker-won in round 4 with 7 points", () => {
    const { store, ctx } = launch();
    breaker(store, ctx, P(10, 0));
    let cur = store.current();
    // B1 routed + A2 chained: first legal fixed candidate (20,28).
    expect(cur.strategy?.nodeId).toBe("k5:r2:classify");
    expect(cur.points.length).toBe(3);
    expect(cur.points[2]?.pt.x.toString()).toBe("20/1");
    expect(cur.points[2]?.pt.y.toString()).toBe("28/1");
    expect(cur.strategy?.lastCase).toBe("k5:any");
    // B2 = centroid of the opening triangle (strictly interior).
    breaker(store, ctx, pt(rat(10), rat(28, 3)));
    cur = store.current();
    expect(cur.strategy?.nodeId).toBe("k5:r3:classify");
    expect(cur.strategy?.lastCase).toBe("k5:b2:one-interior");
    expect(cur.points.length).toBe(5);
    // B3 far away.
    breaker(store, ctx, P(-30, -30));
    cur = store.current();
    expect(cur.terminal?.kind).toBe("maker-won");
    if (cur.terminal?.kind === "maker-won") {
      expect(cur.points.length).toBe(7);
      expect(cur.terminal.witness.length).toBeGreaterThan(0);
    }
  });
});

describe("k5 seeded driver — 300-game CI tier (§23.7 item 5)", () => {
  it("300 safe games, 100% maker-won (seed 20260925)", () => {
    const { wins, games, failures } = runK5Suite(300, 20260925, "safe");
    expect(failures).toEqual([]);
    expect(wins).toBe(games);
  }, 300000);

  it("20-game blunder sample, 100% round-3 wins (seed 60606)", () => {
    const { wins, games, failures } = runK5Suite(20, 60606, "blunder");
    expect(failures).toEqual([]);
    expect(wins).toBe(games);
  }, 120000);

  it("same seed re-runs identically (determinism for the fold)", () => {
    const a = runK5Suite(20, 777, "safe");
    const b = runK5Suite(20, 777, "safe");
    expect(a).toEqual(b);
  }, 120000);
});

describe("k5 reduction fold (§23.7 item 8 — file round-trip awaits Phase 15)", () => {
  it("Breaker-only refold reaches the same terminal + hash", () => {
    // The replay file format/validator land in Phase 15 (§15); the semantic
    // core — deterministic reduction from the Breaker inputs — is asserted
    // here: Maker moves are computed consequences, so re-driving the
    // recorded Breaker placements must reproduce the session exactly.
    const rand = mulberry32(4242);
    for (let i = 0; i < 5; i += 1) {
      const g = playK5Game(rand, "safe");
      expect(g.won).toBe(true);
      const re = refoldK5(g.breaker);
      expect(re.won).toBe(true);
      expect(re.terminalKind).toBe(g.terminalKind);
      expect(re.points).toBe(g.points);
      expect(re.nodeId).toBe(g.nodeId);
      expect(re.cases).toEqual(g.cases);
    }
  }, 120000);
});

describe("k5 golden playbooks (data/scenarios/k5)", () => {
  interface Playbook {
    id: string;
    strategyId: string;
    moves: { b1: [number | string, number | string]; b2?: [number | string, number | string]; b3?: [number | string, number | string] };
    expect: { terminal: string; points: number; nodeId: string; cases: string[] };
  }

  function coord(v: number | string): import("../../src/geometry/rat.ts").Rat {
    if (typeof v === "number") {
      return rat(v);
    }
    return Rat.fromString(v);
  }

  function runBook(book: Playbook): void {
    const { store, ctx } = launch();
    expect(store.current().strategy?.strategyId).toBe(book.strategyId);
    const cases: (string | null)[] = [];
    for (const key of ["b1", "b2", "b3"] as const) {
      const mv = book.moves[key];
      if (mv === undefined) {
        continue;
      }
      if (store.current().terminal !== null) {
        break;
      }
      const at = pt(coord(mv[0]), coord(mv[1]));
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
      // The routed case travels on the Breaker event; a win-at-placement
      // finalizes without one (null) — routing never ran.
      const ev = r.events[0];
      cases.push(ev?.caseId ?? null);
    }
    const cur = store.current();
    expect(cur.terminal?.kind).toBe(book.expect.terminal);
    expect(cur.points.length).toBe(book.expect.points);
    if (cur.terminal?.kind === "maker-won") {
      expect(cur.terminal.nodeId).toBe(book.expect.nodeId);
    }
    expect(cases).toEqual(book.expect.cases);
  }

  const dir = new URL("../../data/scenarios/k5/", import.meta.url);
  const files = ["safe-integer.json", "safe-centroid.json", "wedge.json", "blunder.json", "blunder-2.json", "blocked.json"];
  for (const file of files) {
    it(`playbook ${file}`, async () => {
      const { readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const { fileURLToPath } = await import("node:url");
      const book = JSON.parse(
        await readFile(join(fileURLToPath(dir), file), "utf8"),
      ) as Playbook;
      runBook(book);
    });
  }
});






