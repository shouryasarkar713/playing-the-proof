// tests/strategy/classifiers18.test.ts — classifyB3/classifyB1 typed
// failure branches (Phase 18): empty states, budget-exhausted
// enumerations, malformed inputs. Pure states only.
import { describe, expect, it } from "vitest";
import { classifyB3 } from "../../src/strategy/strategies/k5/classifyB3.ts";
import { classifyB1 } from "../../src/strategy/strategies/k6/classifyB1.ts";
import { P } from "./scaffolding.ts";
import { sandboxState, testConfig } from "../helpers.ts";

describe("classifyB3 integrity branches", () => {
  it("empty state → invalid-result (never a tag)", () => {
    const r = classifyB3.classify(sandboxState([]), {}, testConfig());
    expect(r.kind).toBe("integrity");
    if (r.kind === "integrity") {
      expect(r.failure.reason).toBe("invalid-result");
    }
    const b = classifyB3.boundaries(sandboxState([]), {}, testConfig());
    expect(b.kind).toBe("integrity");
  });

  it("budget-exhausted pre-B3 enumeration → undecidable (never a fake tag)", () => {
    // 9 points: the 8-point k=4 sweep (cost 1120) cannot complete under
    // budgetOps=1 — the classifier fails closed with its analysis.
    const pts = [
      P(0, 0), P(10, 0), P(13, 8), P(5, 13), P(-3, 8),
      P(100, 101), P(101, 100), P(-50, -50), P(60, 62),
    ];
    const r = classifyB3.classify(sandboxState(pts), {}, testConfig(1));
    expect(r.kind).toBe("integrity");
    if (r.kind === "integrity") {
      expect(r.failure.reason).toBe("undecidable-computation");
      expect(r.failure.analysis?.kind).toBe("budget-exhausted");
    }
    const b = classifyB3.boundaries(sandboxState(pts), {}, testConfig(1));
    expect(b.kind).toBe("integrity");
  });
});

describe("classifyB1 integrity branches", () => {
  const FIVE = [P(0, 0), P(10, 0), P(13, 8), P(5, 13), P(-3, 8)];

  it("short inputs → invalid-result", () => {
    const st = sandboxState([...FIVE, P(30, 30)]);
    const r = classifyB1.classify(st, { twinA: ["p1", "p2"] }, testConfig());
    expect(r.kind).toBe("integrity");
    const b = classifyB1.boundaries(st, { twinA: ["p1"] }, testConfig());
    expect(b.kind).toBe("integrity");
  });

  it("unplaced ids → invalid-result", () => {
    const st = sandboxState([...FIVE, P(30, 30)]);
    const r = classifyB1.classify(
      st,
      {
        twinA: ["p1", "p2", "p3", "p4", "p99"],
        twinB: ["p1", "p2", "p3", "p4", "p5"],
        se: ["p1", "p2"],
        a1: ["p3"],
      },
      testConfig(),
    );
    expect(r.kind).toBe("integrity");
    const b = classifyB1.boundaries(
      st,
      {
        twinA: ["p1", "p2", "p3", "p4", "p5"],
        twinB: ["p1", "p2", "p3", "p4", "p99"],
        se: ["p1", "p2"],
        a1: ["p3"],
      },
      testConfig(),
    );
    expect(b.kind).toBe("integrity");
  });

  it("twins sharing a COLLINEAR triple → invalid-result (the triangle comes from the bound twins)", () => {
    // twinA/twinB share exactly p1,p2,p3, which are collinear on the x-axis.
    const st = sandboxState([P(0, 0), P(2, 0), P(1, 0), P(5, 5), P(6, 6), P(7, 7), P(8, 9)]);
    const r = classifyB1.classify(
      st,
      {
        twinA: ["p1", "p2", "p3", "p4", "p5"],
        twinB: ["p1", "p2", "p3", "p6", "p7"],
        se: ["p1", "p2"],
        a1: ["p3"],
      },
      testConfig(),
    );
    expect(r.kind).toBe("integrity");
    if (r.kind === "integrity") {
      expect(r.failure.detail).toContain("non-collinear");
    }
  });

  it("non-5-hole twin → invalid-result", () => {
    // twinA = four corners + center: hull is 4, not 5.
    const st = sandboxState([P(0, 0), P(4, 0), P(4, 4), P(0, 4), P(2, 2), P(30, 30)]);
    const r = classifyB1.classify(
      st,
      {
        twinA: ["p1", "p2", "p3", "p4", "p5"],
        twinB: ["p1", "p2", "p3", "p4", "p5"],
        se: ["p1", "p2"],
        a1: ["p3"],
      },
      testConfig(),
    );
    expect(r.kind).toBe("integrity");
    if (r.kind === "integrity") {
      // identical twins share 5 vertices, not exactly 3
      expect(r.failure.detail).toContain("share exactly 3");
    }
  });
});
