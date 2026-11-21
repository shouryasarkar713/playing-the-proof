// tests/strategies/k6.test.ts — esmb-k6 (§24.7, CI tier): registration,
// bootstrap ladder, B0 routing pack (Gate D), twin/binding behavior,
// drivers, partition coverage, explanation/status, mutations.
import { describe, expect, it } from "vitest";
import { commit, startSession } from "../../src/session/commit.ts";
import { Store } from "../../src/session/store.ts";
import { reduceTransaction } from "../../src/engine/orchestrator.ts";
import type { RuntimeCtx } from "../../src/engine/orchestrator.ts";
import {
  effectiveStatus,
  registerStrategy,
  strategies,
} from "../../src/strategy/registry.ts";
import { esmbK6 } from "../../src/strategy/strategies/k6/def.ts";
import { esmbK6Wide } from "../../src/strategy/strategies/k6/wide.ts";
import { lintSources } from "../../src/explain/claimlint.ts";
import { statusBadge } from "../../src/engine/describe.ts";
import { stateHash } from "../../src/game/hash.ts";
import type { StrategyDef, StrategyNode } from "../../src/strategy/types.ts";
import type { GameState } from "../../src/game/types.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { centroidOf, ensureK6, P } from "./k6driver.ts";
import { forcedRegion, insideStrict, onHull, randomPentagon, runK6Suite } from "./k6driver.ts";
import { findKHoles } from "../../src/geometry/holes.ts";
import { classifyB1 } from "../../src/strategy/strategies/k6/classifyB1.ts";
import { hull } from "../../src/geometry/hull.ts";
import { pt } from "../../src/geometry/pt.ts";
import { Rat } from "../../src/geometry/rat.ts";
import { mulberry32, testCtx } from "../helpers.ts";

ensureK6();

function bootSupplied(
  pts: Pt[],
  hole: Pt[],
  owners?: GameState["points"][number]["owner"][],
): { store: Store; ctx: RuntimeCtx } {
  const store = new Store();
  const ctx = testCtx();
  const started = startSession(
    {
      kind: "guided",
      config: { mode: "break", window: ctx.config.window },
      strategyId: "esmb-k6",
      mode: "break",
      strategyStart: {
        kind: "supplied",
        points: pts,
        selectedHole: hole,
        ...(owners === undefined ? {} : { owners }),
      },
    },
    ctx,
    store,
  );
  expect(started.status).toBe("accepted");
  return { store, ctx };
}

function breaker(store: Store, ctx: RuntimeCtx, at: Pt): void {  const r = reduceTransaction(
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

describe("k6 registration (G1–G11)", () => {
  it("esmb-k6 + wide register with derived statuses", () => {
    const core = strategies().get("esmb-k6");
    const wide = strategies().get("esmb-k6-wide");
    expect(core !== undefined && wide !== undefined).toBe(true);
    if (core === undefined || wide === undefined) {
      throw new Error("unreachable");
    }
    expect(effectiveStatus(core)).toBe("validated-randomized");
    expect(effectiveStatus(wide)).toBe("experimental-extension");
    expect(Object.keys(esmbK6.nodes).sort()).toEqual(
      [
        "k6:boot",
        "k6:immediate",
        "k6:pairing",
        "k6:r5:classify",
        "k6:r5:escape",
        "k6:r5:twins",
        "k6:r6:extend",
        "k6:win",
      ].sort(),
    );
    expect(esmbK6.entry).toBe("k6:boot");
    expect(esmbK6.startVars).toEqual(["P5", "V0", "V1", "V2", "V3", "V4"]);
  });
});

describe("k6 preset bootstrap", () => {
  it("pentagon preset starts parked at k6:boot with P5 bound", () => {
    const pent = [P(0, 0), P(10, 0), P(13, 8), P(5, 13), P(-3, 8)];
    const { store } = bootSupplied(pent, pent);
    const cur = store.current();
    expect(cur.strategy?.nodeId).toBe("k6:boot");
    expect(cur.turn).toBe("breaker");
    expect(cur.points.length).toBe(5);
    const p5 = cur.strategy?.vars["P5"] as string[];
    expect(p5.length).toBe(5);
    for (let i = 0; i < 5; i += 1) {
      expect(cur.strategy?.vars[`V${i}`]).toBe(p5[i]);
    }
  });
});

function presetBoot(): { store: Store; ctx: RuntimeCtx } {
  const pent = [P(0, 0), P(10, 0), P(13, 8), P(5, 13), P(-3, 8)];
  return bootSupplied(pent, pent);
}

function p5Pts(cur: GameState): Pt[] {
  const ids = cur.strategy?.vars["P5"] as string[];
  const byId = new Map(cur.points.map((p) => [p.id, p.pt]));
  return ids.map((id) => byId.get(id) as Pt);
}

const rat = (n: number, d = 1): Rat => Rat.make(BigInt(n), BigInt(d));

describe("k6 B1 cases + twin bindings (§24.3b/§24.4)", () => {
  function routeB(): { store: Store; ctx: RuntimeCtx } {
    const { store, ctx } = presetBoot();
    const fr = forcedRegion(p5Pts(store.current()));
    breaker(store, ctx, centroidOf(fr));
    expect(store.current().strategy?.nodeId).toBe("k6:r5:classify");
    return { store, ctx };
  }

  function varPts(cur: GameState, v: string): Pt[] {
    const ids = cur.strategy?.vars[v] as string[];
    const byId = new Map(cur.points.map((p) => [p.id, p.pt]));
    return ids.map((id) => byId.get(id) as Pt);
  }

  it("twins are the canonical pre-B1 pair sharing 3 vertices incl A1", () => {
    const { store } = routeB();
    const cur = store.current();
    const a1 = cur.strategy?.vars["A1"] as string;
    const twinA = cur.strategy?.vars["twinA"] as string[];
    const twinB = cur.strategy?.vars["twinB"] as string[];
    expect(twinA.length).toBe(5);
    expect(twinB.length).toBe(5);
    const shared = twinA.filter((v) => twinB.includes(v));
    expect(shared.length).toBe(3);
    expect(shared).toContain(a1);
    // Deterministic: the same attacks reproduce the same bindings.
    const { store: store2, ctx: ctx2 } = presetBoot();
    const fr = forcedRegion(p5Pts(store2.current()));
    const b0 = centroidOf(fr);
    breaker(store2, ctx2, b0);
    expect(store2.current().strategy?.vars["twinA"]).toEqual(twinA);
    expect(store2.current().strategy?.vars["twinB"]).toEqual(twinB);
  });

  it("B1 in the shared triangle → replacement case + win", () => {
    const { store, ctx } = routeB();
    const cur = store.current();
    // the shared triangle is the one the BOUND twins share (it need
    // not contain E — the canonical twins may be anchored on E's neighbour).
    const twA = cur.strategy?.vars["twinA"] as string[];
    const twB = cur.strategy?.vars["twinB"] as string[];
    const byId = new Map(cur.points.map((p) => [p.id, p.pt]));
    const tri = twA.filter((v) => twB.includes(v)).map((id) => byId.get(id) as Pt);
    expect(tri.length).toBe(3);
    breaker(store, ctx, centroidOf(tri));
    const after = store.current();
    expect(after.strategy?.lastCase).toBe("k6:b1:inside-shared-triangle");
    expect(after.terminal?.kind).toBe("maker-won");
  });

  it("B1 destroying a pre-B1 twin still classifies inside-twin (label = where, invariant = what)", () => {
    const { store, ctx } = routeB();
    const cur = store.current();
    const twinA = varPts(cur, "twinA");
    const twB = cur.strategy?.vars["twinB"] as string[];
    const twAids = cur.strategy?.vars["twinA"] as string[];
    const byId = new Map(cur.points.map((p) => [p.id, p.pt]));
    const tri = twAids.filter((v) => twB.includes(v)).map((id) => byId.get(id) as Pt);
    // Inside twinA's hull (strict) but outside the shared triangle: walk
    // from the twin centroid toward each twin vertex.
    const center = centroidOf(twinA);
    let target: Pt | null = null;
    for (const v of twinA) {
      const cand = pt(center.x.add(v.x).div(rat(2)), center.y.add(v.y).div(rat(2)));
      if (insideStrict(twinA, cand) && !insideStrict(tri, cand)) {
        target = cand;
        break;
      }
    }
    expect(target !== null).toBe(true);
    // Twin centroid: strictly inside twinA's hull → twinA dies with B1.
    breaker(store, ctx, target as Pt);
    const after = store.current();
    expect(after.strategy?.lastCase).toBe("k6:b1:inside-twin");
    // twinA's exact vertex set is no hole afterwards...
    const fives = findKHoles(
      after.points.map((p) => ({ id: p.id, pt: p.pt })),
      5,
      { mode: "exhaustive", budget: 20000000 },
    );
    expect(fives.kind).toBe("exhaustive");
    if (fives.kind === "exhaustive") {
      const twinAIds = (cur.strategy?.vars["twinA"] as string[]).slice().sort().join("|");
      expect(
        fives.holes.some((h) => [...h.verts].sort().join("|") === twinAIds),
      ).toBe(false);
    }
    // ...yet the survivor invariant held and Maker won regardless.
    expect(after.terminal?.kind).toBe("maker-won");
  });

  it("B1 elsewhere → else + win", () => {
    const { store, ctx } = routeB();
    breaker(store, ctx, P(-30, -30));
    const after = store.current();
    expect(after.strategy?.lastCase).toBe("k6:b1:else");
    expect(after.terminal?.kind).toBe("maker-won");
  });

  it("boundaries are the triangle pair-lines + twin hull support lines", () => {
    const { store, ctx } = routeB();
    void ctx;
    const cur = store.current();
    const twinA = cur.strategy?.vars["twinA"] as string[];
    const twinB = cur.strategy?.vars["twinB"] as string[];
    const se = cur.strategy?.vars["SE"] as string[];
    const a1 = cur.strategy?.vars["A1"] as string;
    const b = classifyB1.boundaries(
      cur,
      { twinA, twinB, se, a1: [a1] },
      testCtx().config,
    );
    expect(b.kind).toBe("ok");
    if (b.kind === "ok") {
      const set = new Set(b.lines.map(([x, y]) => (x < y ? `${x}|${y}` : `${y}|${x}`)));
      // Triangle pair-lines present.
      const sharedIds = twinA.filter((v) => twinB.includes(v));
      expect(sharedIds.length).toBe(3);
      for (const [x, y] of [[sharedIds[0], sharedIds[1]], [sharedIds[0], sharedIds[2]], [sharedIds[1], sharedIds[2]]] as const) {
        const key = (x as string) < (y as string) ? `${x}|${y}` : `${y}|${x}`;
        expect(set.has(key)).toBe(true);
      }
      // Every twin hull edge present (hull vertices mapped to ids).
      const byId = new Map(cur.points.map((p) => [p.id, p.pt]));
      for (const twin of [twinA, twinB]) {
        const pts = twin.map((id) => byId.get(id) as Pt);
        const h = hull(pts);
        expect(h.length).toBe(5);
        const hIds = h.map((q) => {
          const at = pts.findIndex((p) => p.x.toString() === q.x.toString() && p.y.toString() === q.y.toString());
          return twin[at] as string;
        });
        for (let i = 0; i < hIds.length; i += 1) {
          const x = hIds[i] as string;
          const y = hIds[(i + 1) % hIds.length] as string;
          expect(set.has(x < y ? `${x}|${y}` : `${y}|${x}`)).toBe(true);
        }
      }
      expect(set.size).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("k6 B0 routing pack (Gate D)", () => {
  it("B0 outside → k6:immediate, win with 7 points (5-pt bootstrap)", () => {
    const { store, ctx } = presetBoot();
    breaker(store, ctx, P(30, 30));
    const cur = store.current();
    expect(cur.strategy?.lastCase).toBe("k6:b0:outside-h5");
    expect(cur.terminal?.kind).toBe("maker-won");
    if (cur.terminal?.kind === "maker-won") {
      expect(cur.terminal.nodeId).toBe("k6:win");
      expect(cur.points.length).toBe(7);
      expect(cur.terminal.witness.length).toBeGreaterThan(0);
    }
  });

  it("B0 in the forced region → construction, win with 9 points", () => {
    const { store, ctx } = presetBoot();
    const fr = forcedRegion(p5Pts(store.current()));
    expect(fr.length).toBeGreaterThanOrEqual(3);
    breaker(store, ctx, centroidOf(fr));
    const mid = store.current();
    expect(mid.strategy?.lastCase).toBe("k6:b0:inside-forced");
    expect(mid.strategy?.nodeId).toBe("k6:r5:classify");
    expect(mid.points.length).toBe(7);
    // Anchored pair + twins bound along the way.
    expect(mid.strategy?.vars["SE"] !== undefined).toBe(true);
    expect(mid.strategy?.vars["twinA"] !== undefined).toBe(true);
    breaker(store, ctx, P(-30, -30));
    const cur = store.current();
    expect(cur.terminal?.kind).toBe("maker-won");
    if (cur.terminal?.kind === "maker-won") {
      expect(cur.points.length).toBe(9);
    }
  });

  it.each([0, 1, 2, 3, 4])(
    "B0 in ear %i → k6:immediate, win with 7 points",
    (ear) => {
      const { store, ctx } = presetBoot();
      const p5 = p5Pts(store.current());
      const tri = [p5[(ear + 4) % 5] as Pt, p5[ear] as Pt, p5[(ear + 1) % 5] as Pt];
      breaker(store, ctx, centroidOf(tri));
      const cur = store.current();
      expect(cur.strategy?.lastCase).toBe("k6:b0:inside-h5");
      expect(cur.terminal?.kind).toBe("maker-won");
      if (cur.terminal?.kind === "maker-won") {
        expect(cur.points.length).toBe(7);
      }
    },
  );

  it("ear B0 admits a 5-hole with B0 as a vertex (ear-replacement witness)", () => {
    // Pure-geometry counterpart of the immediate route: the §24.1
    // ear-replacement pentagon, verified by enumeration (never trusted).
    const { store, ctx } = presetBoot();
    void ctx;
    const before = store.current();
    const p5 = p5Pts(before);
    for (let ear = 0; ear < 5; ear += 1) {
      const tri = [p5[(ear + 4) % 5] as Pt, p5[ear] as Pt, p5[(ear + 1) % 5] as Pt];
      const b0 = centroidOf(tri);
      const idpts = [...before.points.map((p) => ({ id: p.id, pt: p.pt })), { id: "p6", pt: b0 }];
      const found = findKHoles(idpts, 5, { mode: "exhaustive", budget: 20000000 });
      expect(found.kind).toBe("exhaustive");
      if (found.kind === "exhaustive") {
        expect(found.holes.some((h) => h.verts.includes("p6"))).toBe(true);
      }
    }
  });
});

describe("k6 forced region on 100 pentagons (§24.7 item 1)", () => {  it("nonempty and equals the five chord-quad intersection (seeded)", () => {
    const rand = mulberry32(20260925);
    let checked = 0;
    for (let t = 0; t < 100; t += 1) {
      const pent = randomPentagon(rand);
      const hp = hull([...pent]);
      expect(hp.length).toBe(5);
      const fr = forcedRegion(pent);
      // A pentagon whose forced region computes empty is a curiosity
      // fixture — fail loudly with the points (never silently).
      expect(fr.length >= 3).toBe(true);
      // Cross-check: the centroid lies in all five chord quads...
      const c = centroidOf(fr);
      for (let skip = 0; skip < 5; skip += 1) {
        const quad = hp.filter((_, j) => j !== skip);
        expect(insideStrict(quad, c) || onHull(quad, c)).toBe(true);
      }
      // ...and each chord quad's centroid-side is respected (fr vertices
      // inside-or-on every quad).
      for (const v of fr) {
        for (let skip = 0; skip < 5; skip += 1) {
          const quad = hp.filter((_, j) => j !== skip);
          expect(insideStrict(quad, v) || onHull(quad, v)).toBe(true);
        }
      }
      checked += 1;
    }
    expect(checked).toBe(100);
  });
});

describe("k6 seeded drivers — 300-game CI tier (§24.7 item 3)", () => {
  it("k6-src: 300 forced-B0 games (B1 random/targeted mixed), 100% wins", () => {
    const { wins, games, failures } = runK6Suite(300, 20260925, "forced", "mixed");
    expect(failures).toEqual([]);
    expect(wins).toBe(games);
  }, 600000);

  it("k6-immediate: 300 outside/ear-B0 games, 100% round-5 wins", () => {
    const { wins, games, failures } = runK6Suite(300, 30303, "immediate-mixed", "random");
    expect(failures).toEqual([]);
    expect(wins).toBe(games);
  }, 600000);
});

describe("k6 explanation tiers + ClaimLint (§24.7 item 5)", () => {
  const TIERS = new Set([
    "verified-geometry",
    "strategy-rule",
    "theorem-cited",
    "observed",
    "uncovered",
  ]);

  it.each(["esmb-k6", "esmb-k6-wide"])("%s: every node explains with valid tiers and lint-clean text", (id) => {
    const def = id === "esmb-k6" ? esmbK6 : esmbK6Wide;
    for (const node of Object.values(def.nodes)) {
      expect(node.why.headline.length).toBeGreaterThan(0);
      for (const claim of [
        ...node.why.claims,
        ...(node.why.threats ?? []),
        ...(node.why.invariantNotes ?? []),
      ]) {
        expect(TIERS.has(claim.tier)).toBe(true);
        expect(claim.text.length).toBeGreaterThan(0);
        if (claim.tier === "theorem-cited") {
          expect(claim.ref !== undefined && claim.ref !== "").toBe(true);
        }
      }
    }
    const sources = [];
    for (const node of Object.values(def.nodes)) {
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

  it("k6:immediate carries the forcing sentence + enumeration evidence", () => {
    const immediate = esmbK6.nodes["k6:immediate"];
    if (immediate === undefined) {
      throw new Error("test bug: no k6:immediate");
    }
    const tiers = immediate.why.claims.map((c) => c.tier);
    expect(tiers).toContain("theorem-cited");
    expect(tiers).toContain("verified-geometry");
  });

  it("wide def labels its experimental scope", () => {
    expect(esmbK6Wide.source.paper).toContain("experimental");
    const boot = esmbK6Wide.nodes["k6:boot"];
    if (boot === undefined) {
      throw new Error("test bug: no wide boot");
    }
    expect(boot.why.headline).toContain("experimental");
  });
});

describe("k6 status discipline (§24.7 Gate E)", () => {
  it("core validated-randomized, wide experimental-extension; badge agrees", () => {
    const core = strategies().get("esmb-k6");
    const wide = strategies().get("esmb-k6-wide");
    expect(core !== undefined && wide !== undefined).toBe(true);
    if (core === undefined || wide === undefined) {
      throw new Error("unreachable");
    }
    expect(effectiveStatus(core)).toBe("validated-randomized");
    expect(effectiveStatus(wide)).toBe("experimental-extension");
    const { store, ctx } = presetBoot();
    const badge = statusBadge(store.current(), ctx);
    expect(badge?.text).toBe("Status: validated-randomized");
  });
});

describe("k6 graph mutations rejected (G1–G11)", () => {
  // Node lookup with a test-bug throw (noUncheckedIndexedAccess is on).
  function k6node(def: StrategyDef, id: string): StrategyNode {
    const n = def.nodes[id];
    if (n === undefined) {
      throw new Error(`test bug: no node ${id}`);
    }
    return n;
  }

  function mutate(id: string, f: (def: StrategyDef) => StrategyDef): () => void {
    return () => {
      const nodes: Record<string, StrategyNode> = {};
      for (const [nid, n] of Object.entries(esmbK6.nodes)) {
        nodes[nid] = { ...n };
      }
      const copy: StrategyDef = { ...esmbK6, id, nodes };
      registerStrategy(f(copy), "experimental-extension");
    };
  }

  it("dangling next (G3)", () => {
    expect(
      mutate("test:k6-dangle", (d) => ({
        ...d,
        nodes: {
          ...d.nodes,
          "k6:pairing": { ...k6node(d, "k6:pairing"), next: "nope" },
        },
      })),
    ).toThrow(/G3/);
  });

  it("classify-free self-loop (G6)", () => {
    expect(
      mutate("test:k6-cycle", (d) => ({
        ...d,
        nodes: {
          ...d.nodes,
          "k6:immediate": { ...k6node(d, "k6:immediate"), next: "k6:immediate" },
        },
      })),
    ).toThrow(/G6/);
  });

  it("unbound SE var (G10)", () => {
    expect(
      mutate("test:k6-unbound", (d) => ({
        ...d,
        nodes: {
          ...d.nodes,
          "k6:r5:escape": {
            ...k6node(d, "k6:r5:escape"),
            move: {
              kind: "escape-beyond-edge",
              sharedEdge: { kind: "var", v: "NOPE" },
              poly: { kind: "var", v: "P5" },
            },
          },
        },
      })),
    ).toThrow(/G10/);
  });

  it("missing startVars breaks P5 reads (G10)", () => {
    expect(
      mutate("test:k6-nostart", (d) => ({ ...d, startVars: [] })),
    ).toThrow(/G10/);
  });
});

describe("k6 replay fold (Breaker-only re-drive regenerates twins + terminal)", () => {
  it("route-B game refolds identically", () => {
    const { store, ctx } = presetBoot();
    const fr = forcedRegion(p5Pts(store.current()));
    const b0 = centroidOf(fr);
    breaker(store, ctx, b0);
    breaker(store, ctx, P(-30, -30));
    const cur = store.current();
    expect(cur.terminal?.kind).toBe("maker-won");
    const tree = store.tree();
    const b0pt = tree.transactions[1]?.events.find((e) => e.owner === "breaker")?.at as Pt;
    const b1pt = tree.transactions[2]?.events.find((e) => e.owner === "breaker")?.at as Pt;
    const twinsA = cur.strategy?.vars["twinA"];
    const twinsB = cur.strategy?.vars["twinB"];
    // Fresh session, same bootstrap + same Breaker points.
    const pent = [P(0, 0), P(10, 0), P(13, 8), P(5, 13), P(-3, 8)];
    const store2 = new Store();
    const started = startSession(
      {
        kind: "guided",
        config: { mode: "break", window: ctx.config.window },
        strategyId: "esmb-k6",
        mode: "break",
        strategyStart: { kind: "supplied", points: pent, selectedHole: pent },
      },
      ctx,
      store2,
    );
    expect(started.status).toBe("accepted");
    breaker(store2, ctx, b0pt);
    breaker(store2, ctx, b1pt);
    const cur2 = store2.current();
    expect(cur2.terminal?.kind).toBe("maker-won");
    expect(cur2.strategy?.vars["twinA"]).toEqual(twinsA);
    expect(cur2.strategy?.vars["twinB"]).toEqual(twinsB);
    expect(stateHash(cur2)).toBe(stateHash(cur));
  });
});
