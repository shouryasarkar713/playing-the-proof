// tests/strategy/classifiers.test.ts — ClassifierExecution failure battery
// (v1.2.7: the ClassifierFailure value, outer conversion parity, catch-all
// non-execution, undeclared tags) + BoundariesExecution battery.
import { describe, expect, it } from "vitest";
import { classify } from "../../src/strategy/runtime.ts";
import {
  classifyFour,
  registerClassifier,
} from "../../src/strategy/registry.ts";
import type { RouteRule, StrategyDef } from "../../src/strategy/types.ts";
import { sandboxState } from "../helpers.ts";
import { testConfig } from "../helpers.ts";
import { P } from "./scaffolding.ts";
import {
  clfAlwaysGo,
  clfBadTag,
  clfUndecidable,
} from "./scaffolding.ts";

registerClassifier(clfAlwaysGo);
registerClassifier(clfUndecidable);
registerClassifier(clfBadTag);

function clfDef(
  id: string,
  rules: RouteRule[],
): StrategyDef {
  return {
    id,
    k: 3,
    version: "0.0.0",
    source: { paper: "test", stepMap: {} },
    entry: "C",
    nodes: {
      C: {
        id: "C",
        role: "classify-breaker",
        routes: rules,
        show: [],
        why: { headline: "t", claims: [], sourceRef: "t" },
        sourceRef: "t",
      },
      T1: {
        id: "T1",
        role: "classify-breaker",
        routes: [{ case: "t:halt", when: { kind: "all" }, target: "M" }],
        show: [],
        why: { headline: "t", claims: [], sourceRef: "t" },
        sourceRef: "t",
      },
      M: {
        id: "M",
        role: "maker-move",
        next: "T",
        move: {
          kind: "fixed",
          at: [{ kind: "const", x: P(99, 99).x, y: P(99, 99).y }],
        },
        show: [],
        why: { headline: "t", claims: [], sourceRef: "t" },
        sourceRef: "t",
      },
      T: {
        id: "T",
        role: "classify-breaker",
        routes: [{ case: "t:halt", when: { kind: "all" }, target: "M" }],
        show: [],
        why: { headline: "t", claims: [], sourceRef: "t" },
        sourceRef: "t",
      },
    },
  };
}

const goRules = [
  {
    case: "t:go",
    when: {
      kind: "classifier" as const,
      classifierId: "test:always-go",
      on: { tag: "go" },
    },
    target: "T1",
  },
  { case: "t:all", when: { kind: "all" as const }, target: "T" },
];

describe("ClassifierExecution battery", () => {
  it("classified tag routes first-match with bindings", () => {
    const def = clfDef("td-clf-go", goRules);
    const state = {
      ...sandboxState([P(0, 0), P(4, 0)]),
      mode: "break" as const,
      strategy: {
        strategyId: "td-clf-go",
        version: "0.0.0",
        nodeId: "C",
        vars: {},
        lastCase: null,
      },
    };
    const r = classify(def, state, "C", "p2", testConfig());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.case).toBe("t:go");
      expect(r.target).toBe("T1");
    }
    expect(classify.length).toBe(5); // canonical five-argument form
  });

  it("integrity converts with failedAt/phase/analysis parity; catch-all skipped", () => {
    const def = clfDef("td-clf-undec", [
      {
        case: "t:u",
        when: {
          kind: "classifier" as const,
          classifierId: "test:undecidable",
          on: { tag: "x" },
        },
        target: "T1",
      },
      { case: "t:all", when: { kind: "all" as const }, target: "T" },
    ]);
    const state = {
      ...sandboxState([P(0, 0), P(4, 0)]),
      mode: "break" as const,
      strategy: {
        strategyId: "td-clf-undec",
        version: "0.0.0",
        nodeId: "C",
        vars: {},
        lastCase: null,
      },
    };
    const r = classify(def, state, "C", "p2", testConfig());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.report.failedAt).toBe("C");
      expect(r.report.phase).toBe("route");
      expect(r.report.failed.id).toBe("test:undecidable");
      expect(r.report.failed.analysis).toEqual({
        kind: "budget-exhausted",
        k: 4,
        searched: 3,
      });
    }
  });

  it("undeclared tag is an integrity failure (never a route)", () => {
    const def = clfDef("td-clf-badtag", [
      {
        case: "t:b",
        when: {
          kind: "classifier" as const,
          classifierId: "test:bad-tag",
          on: { tag: "ok" },
        },
        target: "T1",
      },
      { case: "t:all", when: { kind: "all" as const }, target: "T" },
    ]);
    const state = {
      ...sandboxState([P(0, 0), P(4, 0)]),
      mode: "break" as const,
      strategy: {
        strategyId: "td-clf-badtag",
        version: "0.0.0",
        nodeId: "C",
        vars: {},
        lastCase: null,
      },
    };
    const r = classify(def, state, "C", "p2", testConfig());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.report.failed.detail).toContain("undeclared tag");
    }
  });

  it("resolution failure is integrity (never an empty input)", () => {
    const def = clfDef("td-clf-res", [
      {
        case: "t:r",
        when: {
          kind: "classifier" as const,
          classifierId: "test:always-go",
          inputs: { pts: { kind: "var" as const, v: "NOPE" } },
          on: { tag: "go" },
        },
        target: "T1",
      },
      { case: "t:all", when: { kind: "all" as const }, target: "T" },
    ]);
    const state = {
      ...sandboxState([P(0, 0), P(4, 0)]),
      mode: "break" as const,
      strategy: {
        strategyId: "td-clf-res",
        version: "0.0.0",
        nodeId: "C",
        vars: {},
        lastCase: null,
      },
    };
    const r = classify(def, state, "C", "p2", testConfig());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.report.failed.detail).toContain("unbound-var");
    }
  });
});

describe("BoundariesExecution battery", () => {
  it("ok carries lines; integrity carries failure without lines or NodeId", () => {
    const state = sandboxState([P(0, 0), P(4, 0), P(4, 4), P(0, 4)]);
    const cfg = testConfig();
    const ok = clfAlwaysGo.boundaries(
      state,
      {},
      cfg,
    );
    expect(ok).toEqual({ kind: "ok", lines: [] });
    const bad = clfUndecidable.boundaries(state, {}, cfg);
    expect(bad.kind).toBe("integrity");
    if (bad.kind === "integrity") {
      expect(bad.failure.reason).toBe("undecidable-computation");
      expect("lines" in bad).toBe(false);
      expect("nodeId" in bad.failure).toBe(false);
      expect(JSON.stringify(bad)).not.toContain("nodeId");
      expect(bad.failure.analysis).toEqual({
        kind: "budget-exhausted",
        k: 4,
        searched: 3,
      });
    }
  });

  it("classifyFour boundaries are the 6 pair-lines", () => {
    const state = sandboxState([P(0, 0), P(4, 0), P(4, 4), P(0, 4)]);
    const cfg = testConfig();
    const b = classifyFour.boundaries(
      state,
      { pts: ["p1", "p2", "p3", "p4"] },
      cfg,
    );
    expect(b.kind).toBe("ok");
    if (b.kind === "ok") {
      expect(b.lines.length).toBe(6);
    }
  });
});
