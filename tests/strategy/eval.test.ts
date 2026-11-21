// tests/strategy/eval.test.ts — evalPtListIds contract, evalPt, evalMoveSpec,
// evalRegion (both channels, cache kinds, throw).
import { describe, expect, it } from "vitest";
import { Rat } from "../../src/geometry/rat.ts";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { findKHoles } from "../../src/geometry/holes.ts";
import {
  BudgetExhaustedError,
  clearRegionCache,
  ConstructionIntegrityError,
  evalMoveSpec,
  evalPt,
  evalPtListIds,
  evalRegion,
} from "../../src/strategy/eval.ts";
import { gp } from "../../src/geometry/predicates.ts";
import { orient } from "../../src/geometry/predicates.ts";
import type { GameState } from "../../src/game/types.ts";
import { guidedState, P } from "./scaffolding.ts";
import { sandboxState, testConfig, withIds } from "../helpers.ts";

function stateWithVars(
  pts: Pt[],
  vars: Record<string, string | string[]>,
): GameState {
  return guidedState(pts, 3, "C", vars);
}

describe("evalPtListIds (§5.7 dispatch contract)", () => {
  const st = stateWithVars([P(0, 0), P(4, 0), P(0, 4)], {
    TRI: ["p1", "p2", "p3"],
    A: "p1",
  });

  it("var resolves a list binding exactly", () => {
    expect(evalPtListIds({ kind: "var", v: "TRI" }, st)).toEqual({
      kind: "ok",
      ids: ["p1", "p2", "p3"],
    });
  });

  it("unbound var is a resolution failure (never an empty list)", () => {
    const r = evalPtListIds({ kind: "var", v: "NOPE" }, st);
    expect(r.kind).toBe("resolution-failure");
    if (r.kind === "resolution-failure") {
      expect(r.reason).toBe("unbound-var");
    }
  });

  it("scalar var in list position is binding-kind-mismatch", () => {
    const r = evalPtListIds({ kind: "var", v: "A" }, st);
    expect(r.kind).toBe("resolution-failure");
    if (r.kind === "resolution-failure") {
      expect(r.reason).toBe("binding-kind-mismatch");
    }
  });

  it("points-of-anchor resolves; const leaf is non-anchor-leaf", () => {
    expect(
      evalPtListIds({ kind: "points", of: [{ kind: "anchor", v: "A" }] }, st),
    ).toEqual({ kind: "ok", ids: ["p1"] });
    const r = evalPtListIds(
      {
        kind: "points",
        of: [{ kind: "const", x: Rat.make(0n), y: Rat.make(0n) }],
      },
      st,
    );
    expect(r.kind).toBe("resolution-failure");
    if (r.kind === "resolution-failure") {
      expect(r.reason).toBe("non-anchor-leaf");
    }
  });

  it("anchor naming an unplaced point is unavailable-point", () => {
    const st2 = stateWithVars([P(0, 0)], { GHOST: "p99" });
    const r = evalPtListIds(
      { kind: "points", of: [{ kind: "anchor", v: "GHOST" }] },
      st2,
    );
    expect(r.kind).toBe("resolution-failure");
    if (r.kind === "resolution-failure") {
      expect(r.reason).toBe("unavailable-point");
    }
    const rMissing = evalPtListIds(
      { kind: "points", of: [{ kind: "anchor", v: "ABSENT" }] },
      st2,
    );
    expect(rMissing.kind).toBe("resolution-failure");
    if (rMissing.kind === "resolution-failure") {
      expect(rMissing.reason).toBe("unbound-var");
    }
    const st4 = stateWithVars([P(0, 0)], { LIST: ["p1"] });
    const rList = evalPtListIds(
      { kind: "points", of: [{ kind: "anchor", v: "LIST" }] },
      st4,
    );
    expect(rList.kind).toBe("resolution-failure");
    if (rList.kind === "resolution-failure") {
      expect(rList.reason).toBe("binding-kind-mismatch");
    }
    const st3: GameState = {
      ...stateWithVars([P(0, 0)], {}),
      strategy: {
        strategyId: "test-only",
        version: "0.0.0",
        nodeId: "C",
        vars: { L: ["p1", "p99"] },
        lastCase: null,
      },
    };
    const r2 = evalPtListIds({ kind: "var", v: "L" }, st3);
    expect(r2.kind).toBe("resolution-failure");
    if (r2.kind === "resolution-failure") {
      expect(r2.reason).toBe("unavailable-point");
    }
  });

  it("last-n resolves the placement tail; out-of-domain fails", () => {
    expect(evalPtListIds({ kind: "last-n", n: 2 }, st)).toEqual({
      kind: "ok",
      ids: ["p2", "p3"],
    });
    for (const n of [0, 4, -1]) {
      const r = evalPtListIds({ kind: "last-n", n }, st);
      expect(r.kind).toBe("resolution-failure");
      if (r.kind === "resolution-failure") {
        expect(r.reason).toBe("last-n-domain");
      }
    }
  });
});

describe("evalPt (all five kinds, total)", () => {
  const st = stateWithVars([P(0, 0), P(4, 0)], { A: "p1", B: "p2" });

  it("const / anchor / mid / offset", () => {
    expect(
      evalPt({ kind: "const", x: Rat.make(1n), y: Rat.make(2n) }, st),
    ).toEqual(pt(Rat.make(1n), Rat.make(2n)));
    expect(evalPt({ kind: "anchor", v: "A" }, st)).toEqual(P(0, 0));
    expect(
      evalPt(
        {
          kind: "mid",
          a: { kind: "anchor", v: "A" },
          b: { kind: "anchor", v: "B" },
        },
        st,
      ),
    ).toEqual(P(2, 0));
    expect(
      evalPt(
        {
          kind: "offset",
          from: { kind: "anchor", v: "A" },
          by: [Rat.make(1n), Rat.make(-1n)],
        },
        st,
      ),
    ).toEqual(P(1, -1));
  });

  it("reflect over the x-axis negates y, exactly", () => {
    const st2 = stateWithVars([P(0, 1)], { S: "p1" });
    const r = evalPt(
      {
        kind: "reflect",
        src: { kind: "anchor", v: "S" },
        over: [
          { kind: "const", x: Rat.make(0n), y: Rat.make(0n) },
          { kind: "const", x: Rat.make(1n), y: Rat.make(0n) },
        ],
      },
      st2,
    );
    expect(r).toEqual(P(0, -1));
  });

  it("anchor miss is null (construction failure, never a throw)", () => {
    expect(evalPt({ kind: "anchor", v: "NOPE" }, st)).toBe(null);
    expect(
      evalPt(
        {
          kind: "mid",
          a: { kind: "anchor", v: "A" },
          b: { kind: "anchor", v: "NOPE" },
        },
        st,
      ),
    ).toBe(null);
  });
});

describe("evalMoveSpec", () => {
  it("fixed picks the first mathematically legal candidate", () => {
    // B1 blocks the first candidate (collinear); the second is placed.
    const st = guidedState([P(0, 0), P(10, 0)], 3, "C", {});
    const r = evalMoveSpec(
      {
        kind: "fixed",
        at: [
          { kind: "const", x: Rat.make(20n), y: Rat.make(0n) },
          { kind: "const", x: Rat.make(0n), y: Rat.make(10n) },
        ],
      },
      st,
      testConfig(),
    );
    expect(r).toEqual({ pt: P(0, 10) });
  });

  it("fixed with no legal candidate is null", () => {
    const st = guidedState([P(0, 0)], 3, "C", {});
    const r = evalMoveSpec(
      {
        kind: "fixed",
        at: [{ kind: "const", x: Rat.make(0n), y: Rat.make(0n) }],
      },
      st,
      testConfig(),
    );
    expect(r).toBe(null);
  });

  it("extend enumerate succeeds with a verified post-hole", () => {
    const pts = [P(4, 4), P(6, 5), P(3, 8), P(1, 3), P(0, 1), P(3, 6)];
    expect(gp(pts)).toBe(true);
    const st = guidedState(pts, 5, "C", {});
    const r = evalMoveSpec(
      { kind: "extend", hole: { kind: "enumerate", k: 4 } },
      st,
      testConfig(),
    );
    expect(r !== null).toBe(true);
    if (r !== null) {
      // Post-condition: a 5-hole containing the new point exists.
      const seven = withIds([...pts, r.pt]);
      const found = findKHoles(seven, 5, {
        mode: "exhaustive",
        budget: 1000000,
      });
      expect(found.kind).toBe("exhaustive");
      if (found.kind === "exhaustive") {
        expect(found.holes.some((h) => h.verts.includes("p7"))).toBe(true);
      }
    }
  });

  it("extend enumerate under a starved budget throws BudgetExhaustedError", () => {
    const pts = [P(4, 4), P(6, 5), P(3, 8), P(1, 3), P(0, 1), P(3, 6)];
    const st = guidedState(pts, 5, "C", {});
    try {
      evalMoveSpec(
        { kind: "extend", hole: { kind: "enumerate", k: 4 } },
        st,
        testConfig(0),
      );
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(BudgetExhaustedError);
      if (e instanceof BudgetExhaustedError) {
        expect(e.k).toBe(4);
        expect(e.analysis.kind).toBe("budget-exhausted");
      }
    }
  });

  it("extend enumerate over an EMPTY exhaustive result throws ConstructionIntegrityError (§24.1)", () => {
    // k = 4 over 3 points: the exhaustive enumeration is empty. §24.1's
    // k6:immediate rule: an empty enumeration contradicts the forcing
    // sentence — a captured defect on the typed channel (id "extend"),
    // never null (that would misreport window-exhaustion) and never the
    // geometry layer's plain throw.
    const st = guidedState([P(0, 0), P(10, 0), P(0, 10)], 5, "C", {});
    try {
      evalMoveSpec(
        { kind: "extend", hole: { kind: "enumerate", k: 4 } },
        st,
        testConfig(),
      );
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConstructionIntegrityError);
      if (e instanceof ConstructionIntegrityError) {
        expect(e.id).toBe("extend");
        expect(e.detail).toContain("enumeration empty");
        expect(e.detail).toContain("3 points");
      }
    }
  });

  it("co-shoulder resolves vars and constructs ( triangle)", () => {
    const outer = [P(2, 2), P(20, 28), P(-1, 3)];
    const pts = [...outer, P(7, 11)];
    const st = guidedState(pts, 5, "C", {
      outer: ["p1", "p2", "p3"],
      interior: "p4",
    });
    const r = evalMoveSpec(
      {
        kind: "co-shoulder",
        outer: { kind: "var", v: "outer" },
        interior: "interior",
      },
      st,
      testConfig(),
    );
    expect(r !== null).toBe(true);
    if (r !== null) {
      expect(gp([...pts, r.pt])).toBe(true);
      for (let i = 0; i < 3; i += 1) {
        expect(orient(outer[i] as Pt, outer[(i + 1) % 3] as Pt, r.pt)).toBe(1);
      }
    }
  });

  it("co-shoulder with a malformed outer var is null", () => {
    const st = guidedState([P(0, 0), P(4, 0)], 5, "C", {
      outer: ["p1", "p2"],
      interior: "p1",
    });
    const r = evalMoveSpec(
      {
        kind: "co-shoulder",
        outer: { kind: "var", v: "outer" },
        interior: "interior",
      },
      st,
      testConfig(),
    );
    expect(r).toBe(null);
  });

  it("escape-beyond-edge places strictly outside the pentagon wedge", () => {
    const pent = [P(0, 0), P(10, 0), P(12, 6), P(5, 12), P(-2, 6)];
    const pts = [...pent, P(5, 5)];
    expect(gp(pts)).toBe(true);
    const st = guidedState(pts, 6, "C", {
      SE: ["p6", "p3"],
      P5: ["p1", "p2", "p3", "p4", "p5"],
    });
    const r = evalMoveSpec(
      {
        kind: "escape-beyond-edge",
        sharedEdge: { kind: "var", v: "SE" },
        poly: { kind: "var", v: "P5" },
      },
      st,
      testConfig(),
    );
    expect(r !== null).toBe(true);
    if (r !== null) {
      expect(gp([...pts, r.pt])).toBe(true);
    }
  });
});

describe("evalRegion (RegionEvalResult + §8.3 cache)", () => {
  it("window/all/halfplane/hull evaluate complete", () => {
    const st = sandboxState([P(0, 0), P(4, 0), P(0, 4)]);
    const ctx = {
      state: st,
      config: testConfig(),
      channel: "correctness" as const,
    };
    const w = evalRegion({ kind: "window" }, ctx);
    expect(w.kind).toBe("complete");
    const h = evalRegion({ kind: "hull", of: { kind: "last-n", n: 3 } }, ctx);
    expect(h.kind).toBe("complete");
    if (h.kind === "complete" && h.region.kind === "poly") {
      expect(h.region.verts.length).toBe(3);
    }
    // Cache hit deep-equals the miss, kind included.
    const h2 = evalRegion({ kind: "hull", of: { kind: "last-n", n: 3 } }, ctx);
    expect(h2).toEqual(h);
  });

  it("holes-k: correctness bound fail-closed; analysis channel labeled", () => {
    const st = sandboxState([P(0, 0), P(4, 0), P(0, 4), P(1, 1), P(5, 5)]);
    const tight = {
      state: st,
      config: testConfig(0),
      channel: "correctness" as const,
    };
    const r = evalRegion({ kind: "holes", k: 4 }, tight);
    expect(r.kind).toBe("incomplete");
    if (r.kind === "incomplete") {
      expect(r.analysis.kind).toBe("budget-exhausted");
      expect("region" in r).toBe(false);
    }
    const wide = {
      state: st,
      config: testConfig(),
      channel: "correctness" as const,
    };
    const r2 = evalRegion({ kind: "holes", k: 4 }, wide);
    expect(r2.kind).toBe("complete");
  });

  it("intersect propagates the FIRST incomplete operand", () => {
    const st = sandboxState([P(0, 0), P(4, 0), P(0, 4), P(1, 1), P(5, 5)]);
    const ctx = {
      state: st,
      config: testConfig(0),
      channel: "correctness" as const,
    };
    const r = evalRegion(
      {
        kind: "intersect",
        of: [{ kind: "window" }, { kind: "holes", k: 4 }],
      },
      ctx,
    );
    expect(r.kind).toBe("incomplete");
  });

  it("unresolvable hull operands throw loudly, never guess", () => {
    const st = guidedState([P(0, 0)], 3, "C", {});
    const ctx = {
      state: st,
      config: testConfig(),
      channel: "correctness" as const,
    };
    expect(() =>
      evalRegion({ kind: "hull", of: { kind: "var", v: "NOPE" } }, ctx),
    ).toThrowError(/implementation error/);
  });

  it("clearRegionCache re-evaluates identically", () => {
    const st = sandboxState([P(0, 0), P(4, 0)]);
    const ctx = {
      state: st,
      config: testConfig(),
      channel: "analysis" as const,
    };
    const a = evalRegion({ kind: "window" }, ctx);
    clearRegionCache();
    const b = evalRegion({ kind: "window" }, ctx);
    expect(b).toEqual(a);
  });

  it("cache separates states: no stale triangle leaks across point sets", () => {
    const a = sandboxState([P(0, 0), P(4, 0), P(0, 4)]);
    const b = sandboxState([P(0, 0), P(8, 0), P(0, 2)]);
    const expr = { kind: "hull", of: { kind: "last-n", n: 3 } } as const;
    const ra = evalRegion(expr, {
      state: a,
      config: testConfig(),
      channel: "correctness",
    });
    const rb = evalRegion(expr, {
      state: b,
      config: testConfig(),
      channel: "correctness",
    });
    if (ra.kind !== "complete" || rb.kind !== "complete") {
      throw new Error("cache: hull must be complete — test bug");
    }
    // Different point sets ⇒ different regions (a stale hit would equate them).
    expect(rb.region).not.toEqual(ra.region);
    const ra2 = evalRegion(expr, {
      state: a,
      config: testConfig(),
      channel: "correctness",
    });
    expect(ra2).toEqual(ra);
  });

  it("cache separates exprs: window vs hull on one state", () => {
    const st = sandboxState([P(0, 0), P(4, 0), P(0, 4)]);
    const ctx = {
      state: st,
      config: testConfig(),
      channel: "correctness" as const,
    };
    const w = evalRegion({ kind: "window" }, ctx);
    const h = evalRegion({ kind: "hull", of: { kind: "last-n", n: 3 } }, ctx);
    if (w.kind !== "complete" || h.kind !== "complete") {
      throw new Error("cache: regions must be complete — test bug");
    }
    expect(h.region).not.toEqual(w.region);
  });

  it("cache separates budgets: tight stays incomplete after a wide complete", () => {
    const st = sandboxState([P(0, 0), P(4, 0), P(0, 4), P(1, 1), P(5, 5)]);
    const expr = { kind: "holes", k: 4 } as const;
    const tight = {
      state: st,
      config: testConfig(0),
      channel: "correctness" as const,
    };
    const wide = {
      state: st,
      config: testConfig(),
      channel: "correctness" as const,
    };
    const incomplete = evalRegion(expr, tight);
    expect(incomplete.kind).toBe("incomplete");
    const complete = evalRegion(expr, wide);
    expect(complete.kind).toBe("complete");
    // Re-evaluation under the tight budget must not serve the wide hit.
    const incomplete2 = evalRegion(expr, tight);
    expect(incomplete2.kind).toBe("incomplete");
    expect(incomplete2).toEqual(incomplete);
  });

  it("cache separates channels: correctness vs analysis payloads differ", () => {
    // Square + center (5 pts, k=4 estimate 40): budget 10 sits strictly
    // between 0 and the estimate. Correctness short-circuits without
    // running (budget-exhausted, searched: 0); analysis runs the capped
    // first-witness sweep — a shared entry would equate the payloads.
    const st = sandboxState([P(0, 0), P(4, 0), P(4, 4), P(0, 4), P(2, 2)]);
    const expr = { kind: "holes", k: 4 } as const;
    const onCorrectness = evalRegion(expr, {
      state: st,
      config: testConfig(10),
      channel: "correctness",
    });
    const onAnalysis = evalRegion(expr, {
      state: st,
      config: testConfig(10),
      channel: "analysis",
    });
    expect(onCorrectness.kind).toBe("incomplete");
    expect(onAnalysis.kind).toBe("incomplete");
    if (
      onCorrectness.kind !== "incomplete" ||
      onAnalysis.kind !== "incomplete"
    ) {
      throw new Error("unreachable");
    }
    expect(onAnalysis.analysis).not.toEqual(onCorrectness.analysis);
    // And neither entry leaks into a re-evaluation of the other.
    const again = evalRegion(expr, {
      state: st,
      config: testConfig(10),
      channel: "correctness",
    });
    expect(again).toEqual(onCorrectness);
  });
});

describe("eval gaps (Phase 18: ctors, PtExpr kinds, move shapes)", () => {
  it("ConstructionIntegrityError carries its detail", () => {
    const e = new ConstructionIntegrityError("zero dirs");
    expect(e.name).toBe("ConstructionIntegrityError");
    expect(e.detail).toBe("zero dirs");
  });

  it("evalPt reflect: mirror, missing var, degenerate axis", () => {
    const st = stateWithVars([P(0, 0), P(4, 0), P(0, 4)], {
      A: "p1",
      B: "p2",
      C: "p3",
    });
    const mirror = evalPt(
      {
        kind: "reflect",
        src: { kind: "anchor", v: "A" },
        over: [
          { kind: "anchor", v: "B" },
          { kind: "anchor", v: "C" },
        ],
      },
      st,
    );
    expect(mirror !== null).toBe(true);
    if (mirror !== null) {
      // Mirror of (0,0) over x + y = 4 is (4,4).
      expect(mirror.x.toString()).toBe("4/1");
      expect(mirror.y.toString()).toBe("4/1");
    }
    expect(
      evalPt(
        {
          kind: "reflect",
          src: { kind: "anchor", v: "NOPE" },
          over: [
            { kind: "anchor", v: "B" },
            { kind: "anchor", v: "C" },
          ],
        },
        st,
      ),
    ).toBe(null);
    // Degenerate axis (same point twice) refuses.
    expect(
      evalPt(
        {
          kind: "reflect",
          src: { kind: "anchor", v: "A" },
          over: [
            { kind: "anchor", v: "B" },
            { kind: "anchor", v: "B" },
          ],
        },
        st,
      ),
    ).toBe(null);
  });

  it("evalPt offset: translation, unresolvable base", () => {
    const st = stateWithVars([P(0, 0)], { A: "p1" });
    const moved = evalPt(
      {
        kind: "offset",
        from: { kind: "anchor", v: "A" },
        by: [Rat.make(1n), Rat.make(2n)],
      },
      st,
    );
    expect(moved !== null).toBe(true);
    if (moved !== null) {
      expect(moved.x.toString()).toBe("1/1");
      expect(moved.y.toString()).toBe("2/1");
    }
    expect(
      evalPt(
        {
          kind: "offset",
          from: { kind: "anchor", v: "NOPE" },
          by: [Rat.make(1n), Rat.make(2n)],
        },
        st,
      ),
    ).toBe(null);
  });

  it("halfplane over unbound anchors throws loudly", () => {
    const st = sandboxState([P(0, 0), P(4, 0)]);
    expect(() =>
      evalRegion(
        {
          kind: "halfplane",
          thru: [
            { kind: "anchor", v: "NOPE" },
            { kind: "anchor", v: "ALSO_NOPE" },
          ],
          side: "left",
        },
        { state: st, config: testConfig(), channel: "correctness" },
      ),
    ).toThrowError(/implementation error/);
  });

  it("holes-k completes on both channels with budget to spare", () => {
    const pent = [P(0, 0), P(10, 0), P(13, 8), P(5, 13), P(-3, 8)];
    const st = sandboxState(pent);
    for (const channel of ["correctness", "analysis"] as const) {
      const r = evalRegion(
        { kind: "holes", k: 5 },
        { state: st, config: testConfig(), channel },
      );
      expect(r.kind).toBe("complete");
    }
    const capped = evalRegion(
      { kind: "holes", k: 4 },
      { state: st, config: testConfig(0), channel: "analysis" },
    );
    expect(capped.kind).toBe("incomplete");
  });

  it("opposite halfplanes intersect to the empty region (complete)", () => {
    const thru = [
      { kind: "const", x: P(0, 0).x, y: P(0, 0).y },
      { kind: "const", x: P(10, 0).x, y: P(10, 0).y },
    ] as const;
    const r = evalRegion(
      {
        kind: "intersect",
        of: [
          { kind: "halfplane", thru: [thru[0], thru[1]], side: "left" },
          { kind: "halfplane", thru: [thru[0], thru[1]], side: "right" },
        ],
      },
      {
        state: sandboxState([P(0, 0)]),
        config: testConfig(),
        channel: "correctness",
      },
    );
    expect(r.kind).toBe("complete");
  });

  it("fixed skips unresolvable candidates; all-blocked is null", () => {
    const st = stateWithVars([P(0, 0)], { A: "p1" });
    const skip = evalMoveSpec(
      {
        kind: "fixed",
        at: [
          { kind: "anchor", v: "NOPE" },
          { kind: "const", x: P(5, 5).x, y: P(5, 5).y },
        ],
      },
      st,
      testConfig(),
    );
    expect(skip !== null).toBe(true);
    if (skip !== null) {
      expect(skip.pt.x.toString()).toBe("5/1");
    }
    expect(
      evalMoveSpec(
        { kind: "fixed", at: [{ kind: "anchor", v: "NOPE" }] },
        st,
        testConfig(),
      ),
    ).toBe(null);
  });

  it("extend over a var hole: shapes null, convex succeeds, capped throws", () => {
    const quad = [P(0, 0), P(10, 0), P(10, 10), P(0, 10)];
    const good = guidedState(quad, 5, "C", { H: ["p1", "p2", "p3", "p4"] });
    const vars = (extra: Record<string, string | string[]>) =>
      guidedState(quad, 5, "C", extra);
    // Unbound / short / unplaced holes refuse.
    expect(
      evalMoveSpec(
        { kind: "extend", hole: { kind: "var", v: "NOPE" } },
        good,
        testConfig(),
      ),
    ).toBe(null);
    expect(
      evalMoveSpec(
        { kind: "extend", hole: { kind: "var", v: "H" } },
        vars({ H: ["p1", "p2"] }),
        testConfig(),
      ),
    ).toBe(null);
    expect(
      evalMoveSpec(
        { kind: "extend", hole: { kind: "var", v: "H" } },
        vars({ H: ["p1", "p2", "p3", "p99"] }),
        testConfig(),
      ),
    ).toBe(null);
    // Non-convex membership refuses (hull mismatch).
    expect(
      evalMoveSpec(
        { kind: "extend", hole: { kind: "var", v: "H" } },
        guidedState([...quad, P(5, 5)], 5, "C", {
          H: ["p1", "p2", "p3", "p5"],
        }),
        testConfig(),
      ),
    ).toBe(null);
    // Convex bound hole extends.
    const r = evalMoveSpec(
      { kind: "extend", hole: { kind: "var", v: "H" } },
      good,
      testConfig(),
    );
    expect(r !== null).toBe(true);
    // Enumerated holes under a starved budget throw BudgetExhaustedError.
    const six = guidedState([...quad, P(20, 20), P(20, 0)], 5, "C", {});
    expect(() =>
      evalMoveSpec(
        { kind: "extend", hole: { kind: "enumerate", k: 5 } },
        six,
        testConfig(0),
      ),
    ).toThrowError(BudgetExhaustedError);
  });

  it("co-shoulder shape failures are null (never throws)", () => {
    const outer = [P(0, 0), P(10, 0), P(0, 10)];
    const st = guidedState(outer, 5, "C", {
      outer: ["p1", "p2", "p3"],
      interior: "p1",
    });
    const move = (o: unknown, i: unknown) =>
      ({
        kind: "co-shoulder",
        outer: { kind: "var", v: o as string },
        interior: i as string,
      }) as never;
    expect(evalMoveSpec(move("NOPE", "interior"), st, testConfig())).toBe(null);
    expect(
      evalMoveSpec(
        move("outer", "interior"),
        guidedState([P(0, 0)], 5, "C", {}),
        testConfig(),
      ),
    ).toBe(null);
    const badInterior = guidedState(outer, 5, "C", {
      outer: ["p1", "p2", "p3"],
    });
    expect(
      evalMoveSpec(move("outer", "interior"), badInterior, testConfig()),
    ).toBe(null);
    const unplaced = guidedState(outer, 5, "C", {
      outer: ["p1", "p2", "p99"],
      interior: "p1",
    });
    expect(
      evalMoveSpec(move("outer", "interior"), unplaced, testConfig()),
    ).toBe(null);
    // Exterior "interior" is a convention miss, not a throw.
    expect(evalMoveSpec(move("outer", "interior"), st, testConfig())).toBe(
      null,
    );
  });

  it("escape-beyond-edge shapes: nulls and typed throws", () => {
    const pent = [P(0, 0), P(10, 0), P(13, 8), P(5, 13), P(-3, 8)];
    const ids = ["p1", "p2", "p3", "p4", "p5"];
    // the escape now only accepts a point after which exact twins exist,
    // which needs a real B0 (p6, inside the forced region) — SE = [B0, E].
    const base = guidedState([...pent, P(5, 6)], 6, "C", { P5: ids, SE: ["p6", "p1"] });
    const move = (extra?: Record<string, unknown>) =>
      ({
        kind: "escape-beyond-edge",
        sharedEdge: { kind: "var", v: "SE" },
        poly: { kind: "var", v: "P5" },
        ...(extra ?? {}),
      }) as never;
    // Live-shaped call succeeds.
    expect(evalMoveSpec(move(), base, testConfig()) !== null).toBe(true);
    // Malformed bindings refuse.
    const short = guidedState(pent, 6, "C", { P5: ids, SE: ["p1"] });
    expect(evalMoveSpec(move(), short, testConfig())).toBe(null);
    const thin = guidedState(pent, 6, "C", {
      P5: ["p1", "p2"],
      SE: ["p1", "p2"],
    });
    expect(evalMoveSpec(move(), thin, testConfig())).toBe(null);
    const missing = guidedState(pent, 6, "C", {
      P5: ["p1", "p2", "p3", "p4", "p99"],
      SE: ["p1", "p2"],
    });
    expect(evalMoveSpec(move(), missing, testConfig())).toBe(null);
    const outside2 = guidedState(pent, 6, "C", {
      P5: ["p1", "p2", "p3", "p4"],
      SE: ["p4", "p5"],
    });
    expect(evalMoveSpec(move(), outside2, testConfig())).toBe(null);
    // Non-var quad refs refuse; scalar quad vars throw integrity.
    expect(
      evalMoveSpec(
        move({ quads: [{ kind: "last-n", n: 1 }] }),
        base,
        testConfig(),
      ),
    ).toBe(null);
    const scalar = guidedState(pent, 6, "C", {
      P5: ids,
      SE: ["p1", "p2"],
      Q1: "p3",
      Q2: ["p3", "p4", "p5", "p1"],
    });
    expect(() =>
      evalMoveSpec(
        move({
          quads: [
            { kind: "var", v: "Q1" },
            { kind: "var", v: "Q2" },
          ],
        }),
        scalar,
        testConfig(),
      ),
    ).toThrowError(ConstructionIntegrityError);
    // Quads avoiding both neighbors throw the neither-neighbor integrity.
    const avoid = guidedState(pent, 6, "C", {
      P5: ids,
      SE: ["p1", "p2"],
      Q1: ["p4", "p5"],
      Q2: ["p4", "p5"],
    });
    expect(() =>
      evalMoveSpec(
        move({
          quads: [
            { kind: "var", v: "Q1" },
            { kind: "var", v: "Q2" },
          ],
        }),
        avoid,
        testConfig(),
      ),
    ).toThrowError(/neither pentagon neighbor/);
    // A zero-area window starves every direction (best stays null).
    const zeroW = {
      ...testConfig(),
      window: {
        xMin: Rat.make(0n),
        yMin: Rat.make(0n),
        xMax: Rat.make(0n),
        yMax: Rat.make(0n),
      },
    };
    expect(evalMoveSpec(move(), base, zeroW)).toBe(null);
  });
});
