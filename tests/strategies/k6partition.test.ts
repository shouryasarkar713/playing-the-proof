// tests/strategies/k6partition.test.ts — §24.7 item 6 + classifyB1 units:
// effective-partition tiling for k6:boot (nested routes, first-match
// agreement per arrangement cell) and cell coverage for k6:r5:classify
// via classifyB1.boundaries(), on the pinned twin fixtures.
import { describe, expect, it } from "vitest";
import { arrangementCells } from "../../src/geometry/arrangement.ts";
import type { ArrLine } from "../../src/geometry/arrangement.ts";
import { canonicalInteriorPoint } from "../../src/geometry/poly.ts";
import { regionContains } from "../../src/geometry/poly.ts";
import { hull } from "../../src/geometry/hull.ts";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { Rat } from "../../src/geometry/rat.ts";
import { placePoint } from "../../src/game/place.ts";
import { placedId } from "../../src/game/place.ts";
import type { GameState } from "../../src/game/types.ts";
import { evalRegion } from "../../src/strategy/eval.ts";
import { classify } from "../../src/strategy/runtime.ts";
import { esmbK6, forcedExpr, p5HullExpr } from "../../src/strategy/strategies/k6/def.ts";
import { classifyB1 } from "../../src/strategy/strategies/k6/classifyB1.ts";
import { startSession } from "../../src/session/commit.ts";
import { Store } from "../../src/session/store.ts";
import type { RuntimeCtx } from "../../src/engine/orchestrator.ts";
import { P, centroidOf, ensureK6, insideStrict } from "./k6driver.ts";
import { twinPts } from "../strategy/scaffolding.ts";
import { testCtx } from "../helpers.ts";

ensureK6();

const rat = (n: number, d = 1): Rat => Rat.make(BigInt(n), BigInt(d));

function windowPoly(ctx: RuntimeCtx) {
  const w = ctx.config.window;
  return [
    pt(w.xMin, w.yMin),
    pt(w.xMax, w.yMin),
    pt(w.xMax, w.yMax),
    pt(w.xMin, w.yMax),
  ];
}

function lookupId(state: GameState, id: string): Pt {
  const p = state.points.find((q) => q.id === id);
  if (p === undefined) {
    throw new Error("test bug: unknown id");
  }
  return p.pt;
}

function presetBoot(): { store: Store; ctx: RuntimeCtx } {
  const store = new Store();
  const ctx = testCtx();
  const pent = [P(0, 0), P(10, 0), P(13, 8), P(5, 13), P(-3, 8)];
  const started = startSession(
    {
      kind: "guided",
      config: { mode: "break", window: ctx.config.window },
      strategyId: "esmb-k6",
      mode: "break",
      strategyStart: { kind: "supplied", points: pent, selectedHole: pent },
    },
    ctx,
    store,
  );
  expect(started.status).toBe("accepted");
  return { store, ctx };
}

describe("k6:boot effective partition (nested routes, first-match tiling)", () => {
  it("every P5-pair-line cell classifies; direct evaluation agrees", () => {
    const { store, ctx } = presetBoot();
    const state = store.current();
    expect(state.strategy?.nodeId).toBe("k6:boot");
    const p5 = (state.strategy?.vars["P5"] as string[]).map((id) => lookupId(state, id));
    // Arrangement over the P5 pair-lines (the route regions' supporting
    // lines are P5 chords — pair-lines of the fixed set).
    const lines: ArrLine[] = [];
    for (let i = 0; i < p5.length; i += 1) {
      for (let j = i + 1; j < p5.length; j += 1) {
        lines.push({ a: p5[i] as Pt, b: p5[j] as Pt });
      }
    }
    expect(lines.length).toBe(10);
    const cells = arrangementCells(lines, windowPoly(ctx));
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.length).toBeLessThanOrEqual(56);
    const seen = new Set<string>();
    let checked = 0;
    for (const cell of cells) {
      const rep = canonicalInteriorPoint(cell);
      if (rep === null) {
        continue;
      }
      // Independent first-match: forced region, then hull, else catch-all.
      const ectx = { state, config: ctx.config, channel: "correctness" as const };
      const fr = evalRegion(forcedExpr, ectx);
      const hu = evalRegion(p5HullExpr, ectx);
      if (fr.kind !== "complete" || hu.kind !== "complete") {
        throw new Error("test bug: route regions not complete");
      }
      const expected = regionContains(fr.region, rep, false)
        ? "k6:b0:inside-forced"
        : regionContains(hu.region, rep, false)
          ? "k6:b0:inside-h5"
          : "k6:b0:outside-h5";
      // Pipeline: hypo-place + real routing.
      const hypo = placePoint(state, "breaker", rep);
      const r = classify(esmbK6, hypo, "k6:boot", placedId(hypo), ctx.config);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.case).toBe(expected);
        seen.add(r.case);
      }
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
    // Nontrivial tiling: all three routes own cells.
    expect(seen).toEqual(
      new Set(["k6:b0:inside-forced", "k6:b0:inside-h5", "k6:b0:outside-h5"]),
    );
  });
});

describe("k6:r5:classify cell coverage (pinned twins)", () => {
  // Pinned twin pair (Phase-9 probes): twinA=H0 [p1,p2,p4,p5,p3],
  // twinB=H3 [p6,p3,p2,p7,p4]; anchor A1=p2; SE=[p3,p4] (B0=p3, E=p4).
  function twinState(): { state: GameState; ctx: RuntimeCtx } {
    const pts = twinPts();
    const ctx = testCtx();
    const state: GameState = {
      seq: 0,
      k: 6,
      mode: "break",
      points: pts.map((p, i) => ({
        id: `p${i + 1}`,
        owner: (i % 2 === 0 ? "maker" : "breaker") as "maker" | "breaker",
        pt: p,
        move: i + 1,
      })),
      turn: "breaker",
      terminal: null,
      strategy: {
        strategyId: "esmb-k6",
        version: "1.0.0",
        nodeId: "k6:r5:classify",
        vars: {
          P5: ["p1", "p2", "p3", "p4", "p5"],
          B0: "p3",
          SE: ["p3", "p4"],
          quad1: ["p1", "p2", "p3", "p4"],
          quad2: ["p1", "p3", "p4", "p5"],
          A1: "p2",
          twinA: ["p1", "p2", "p4", "p5", "p3"],
          twinB: ["p6", "p3", "p2", "p7", "p4"],
        },
        lastCase: null,
      },
    };
    return { state, ctx };
  }

  it("classifyB1 tags on the pinned fixtures", () => {
    const { state, ctx } = twinState();
    const byId = (id: string): Pt => lookupId(state, id);
    const inputs = {
      twinA: ["p1", "p2", "p4", "p5", "p3"],
      twinB: ["p6", "p3", "p2", "p7", "p4"],
      se: ["p3", "p4"],
      a1: ["p2"],
    };
    // Shared triangle T = hull(p3, p4, p2): centroid → inside-shared-triangle.
    const t = [byId("p3"), byId("p4"), byId("p2")];
    const withB1 = (b1: Pt): GameState => ({
      ...state,
      points: [...state.points, { id: "p8", owner: "breaker" as const, pt: b1, move: 8 }],
    });
    const tri = classifyB1.classify(withB1(centroidOf(t)), inputs, ctx.config);
    expect(tri).toEqual({ kind: "classified", result: { tag: "inside-shared-triangle" } });
    // Inside twinA hull but outside T → inside-twin (with the twin binding).
    const h0 = ["p1", "p2", "p4", "p5", "p3"].map(byId);
    expect(hull(h0).length).toBe(5);
    const center = centroidOf(h0);
    let target: Pt | null = null;
    for (const v of h0) {
      const cand = pt(center.x.add(v.x).div(rat(2)), center.y.add(v.y).div(rat(2)));
      if (insideStrict(h0, cand) && !insideStrict(t, cand)) {
        target = cand;
        break;
      }
    }
    expect(target !== null).toBe(true);
    const tw = classifyB1.classify(withB1(target as Pt), inputs, ctx.config);
    expect(tw.kind).toBe("classified");
    if (tw.kind === "classified") {
      expect(tw.result.tag).toBe("inside-twin");
      expect(tw.result.bindings?.["twin"]).toEqual(["p1", "p2", "p4", "p5", "p3"]);
    }
    // Far away → else.
    const els = classifyB1.classify(withB1(P(500, 500)), inputs, ctx.config);
    expect(els).toEqual({ kind: "classified", result: { tag: "else" } });
  });

  it("every boundary cell classifies with first-match agreement", () => {
    const { state, ctx } = twinState();
    const inputs = {
      twinA: ["p1", "p2", "p4", "p5", "p3"],
      twinB: ["p6", "p3", "p2", "p7", "p4"],
      se: ["p3", "p4"],
      a1: ["p2"],
    };
    const b = classifyB1.boundaries(state, inputs, ctx.config);
    expect(b.kind).toBe("ok");
    if (b.kind !== "ok") {
      throw new Error("unreachable");
    }
    const idpts = new Map(state.points.map((p) => [p.id, p.pt] as const));
    const pair = (a: string, bId: string): ArrLine => ({
      a: idpts.get(a) as Pt,
      b: idpts.get(bId) as Pt,
    });
    const lines = b.lines.map(([x, y]) => pair(x, y));
    const cells = arrangementCells(lines, windowPoly(ctx));
    expect(cells.length).toBeGreaterThan(0);
    const seen = new Set<string>();
    let checked = 0;
    const t = [lookupId(state, "p3"), lookupId(state, "p4"), lookupId(state, "p2")];
    const h0 = ["p1", "p2", "p4", "p5", "p3"].map((id) => lookupId(state, id));
    const h3 = ["p6", "p3", "p2", "p7", "p4"].map((id) => lookupId(state, id));
    for (const cell of cells) {
      const rep = canonicalInteriorPoint(cell);
      if (rep === null) {
        continue;
      }
      // Independent containment (same order as the classifier).
      const expected = regionContains({ kind: "poly", verts: hull(t) }, rep, false)
        ? "inside-shared-triangle"
        : regionContains({ kind: "poly", verts: hull(h0) }, rep, false) ||
            regionContains({ kind: "poly", verts: hull(h3) }, rep, false)
          ? "inside-twin"
          : "else";
      const hypo = placePoint(state, "breaker", rep);
      const r = classifyB1.classify(hypo, inputs, ctx.config);
      expect(r.kind).toBe("classified");
      if (r.kind === "classified") {
        expect(r.result.tag).toBe(expected);
        seen.add(r.result.tag);
      }
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
    expect(seen.has("inside-shared-triangle")).toBe(true);
    expect(seen.has("else")).toBe(true);
  });
});
