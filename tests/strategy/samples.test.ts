// tests/strategy/samples.test.ts — effectiveCells/sampleForCase branch
// battery (Phase 18): honest maps on live defs plus every typed
// unavailable path (undecidable predicates, boundaries-integrity, lookup
// misses, unregistered classifiers, non-classify nodes, missing cases).
// Pure states only (no engine/session imports — strategy-layer tests).
import { describe, expect, it } from "vitest";
import {
  effectiveCells,
  sampleForCase,
} from "../../src/strategy/samples.ts";
import {
  getClassifier,
  registerClassifier,
} from "../../src/strategy/registry.ts";
import type {
  ClassifierDef,
  RouteRule,
  StrategyDef,
} from "../../src/strategy/types.ts";
import { esmbK5 } from "../../src/strategy/strategies/k5/def.ts";
import { esmbK6 } from "../../src/strategy/strategies/k6/def.ts";
import { guidedState, P } from "./scaffolding.ts";
import { sandboxState, testConfig } from "../helpers.ts";

function ensureStub(def: ClassifierDef): void {
  if (getClassifier(def.id) === undefined) {
    registerClassifier(def);
  }
}

const linesOk: ClassifierDef = {
  id: "test:samples-lines",
  resultTags: ["go"],
  classify(state, _inputs, _config) {
    return state.points.length > 0
      ? { kind: "classified", result: { tag: "go" } }
      : {
          kind: "integrity",
          failure: { reason: "invalid-result", detail: "empty state" },
        };
  },
  boundaries(_state, inputs, _config) {
    const ids = inputs["pts"];
    if (ids === undefined || ids.length < 2) {
      return {
        kind: "integrity",
        failure: { reason: "invalid-result", detail: "need 2 ids" },
      };
    }
    return { kind: "ok", lines: [[ids[0] as never, ids[1] as never]] };
  },
};

const linesDown: ClassifierDef = {
  id: "test:samples-down",
  resultTags: ["go"],
  classify(_state, _inputs, _config) {
    return {
      kind: "integrity",
      failure: { reason: "undecidable-computation", detail: "always down" },
    };
  },
  boundaries(_state, _inputs, _config) {
    return {
      kind: "integrity",
      failure: { reason: "undecidable-computation", detail: "always down" },
    };
  },
};

ensureStub(linesOk);
ensureStub(linesDown);

function classifyNode(
  id: string,
  routes: RouteRule[],
): StrategyDef {
  return {
    id: "test:samples-def",
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

const PENT = [P(0, 0), P(10, 0), P(13, 8), P(5, 13), P(-3, 8)];

function bootState(): ReturnType<typeof guidedState> {
  const ids = ["p1", "p2", "p3", "p4", "p5"];
  return guidedState(PENT, 6, "k6:boot", {
    P5: ids,
    V0: "p1",
    V1: "p2",
    V2: "p3",
    V3: "p4",
    V4: "p5",
  });
}

describe("effectiveCells on live defs", () => {
  it("k6:boot maps three effective cases over the window", () => {
    const cells = effectiveCells(bootState(), esmbK6, "k6:boot", testConfig());
    expect(cells.available).toBe(true);
    if (!cells.available) {
      throw new Error("unreachable");
    }
    expect(cells.groups.map((g) => g.caseId)).toEqual([
      "k6:b0:inside-forced",
      "k6:b0:inside-h5",
      "k6:b0:outside-h5",
    ]);
    for (const g of cells.groups) {
      expect(g.cells.length).toBeGreaterThan(0);
    }
  });

  it("sampleForCase returns a reply per case, null for unknown cases", () => {
    const st = bootState();
    const cfg = testConfig();
    const reply = sampleForCase(st, esmbK6, "k6:boot", "k6:b0:outside-h5", cfg);
    expect(reply !== null).toBe(true);
    expect(reply?.caseId).toBe("k6:b0:outside-h5");
    expect(
      sampleForCase(st, esmbK6, "k6:boot", "no-such-case", cfg),
    ).toBe(null);
    expect(sampleForCase(st, esmbK5, "k5:r4:extend", "k5:any", cfg)).toBe(null);
  });
});

describe("effectiveCells unavailable paths (typed, never blank)", () => {
  it("non-classify node → not-a-classify-node", () => {
    const r = effectiveCells(
      sandboxState([P(0, 0)]),
      esmbK5,
      "k5:r4:extend",
      testConfig(),
    );
    expect(r).toEqual({
      available: false,
      reason: "not-a-classify-node",
      detail: "k5:r4:extend is not a classify-breaker node",
    });
  });

  it("unregistered classifier → unregistered-classifier", () => {
    const def = classifyNode("n", [
      {
        case: "c",
        when: {
          kind: "classifier",
          classifierId: "test:samples-nope",
          on: { tag: "x" },
        },
        target: "n",
      },
    ]);
    const r = effectiveCells(sandboxState([P(0, 0)]), def, "n", testConfig());
    expect(r).toEqual({
      available: false,
      reason: "unregistered-classifier",
      detail: "test:samples-nope",
    });
  });

  it("incomplete region predicate → undecidable-predicate", () => {
    const def = classifyNode("n", [
      {
        case: "c",
        when: { kind: "region", expr: { kind: "holes", k: 4 } },
        target: "n",
      },
    ]);
    const st = sandboxState([P(0, 0), P(4, 0), P(4, 4), P(0, 4), P(2, 2)]);
    const r = effectiveCells(st, def, "n", testConfig(0));
    expect(r.available).toBe(false);
    if (!r.available) {
      expect(r.reason).toBe("undecidable-predicate");
    }
  });

  it("unresolvable classifier inputs → undecidable-predicate", () => {
    const def = classifyNode("n", [
      {
        case: "c",
        when: {
          kind: "classifier",
          classifierId: "test:samples-lines",
          inputs: { pts: { kind: "var", v: "NOPE" } },
          on: { tag: "go" },
        },
        target: "n",
      },
    ]);
    const r = effectiveCells(
      guidedState([P(0, 0)], 3, "n", {}),
      def,
      "n",
      testConfig(),
    );
    expect(r.available).toBe(false);
    if (!r.available) {
      expect(r.reason).toBe("undecidable-predicate");
      expect(r.detail).toContain("unbound-var");
    }
  });

  it("boundaries integrity → boundaries-unavailable (no partial map)", () => {
    const def = classifyNode("n", [
      {
        case: "c",
        when: {
          kind: "classifier",
          classifierId: "test:samples-down",
          on: { tag: "go" },
        },
        target: "n",
      },
    ]);
    const r = effectiveCells(sandboxState([P(0, 0)]), def, "n", testConfig());
    expect(r).toEqual({
      available: false,
      reason: "boundaries-unavailable",
      detail: "undecidable-computation: always down",
    });
  });

  it("boundary lines naming unplaced points → undecidable-predicate", () => {
    const badLines: ClassifierDef = {
      ...linesOk,
      id: "test:samples-badlines",
      boundaries: () => ({ kind: "ok", lines: [["p99", "p1"]] }),
    };
    ensureStub(badLines);
    const def = classifyNode("n", [
      {
        case: "c",
        when: {
          kind: "classifier",
          classifierId: "test:samples-badlines",
          inputs: { pts: { kind: "last-n", n: 1 } },
          on: { tag: "go" },
        },
        target: "n",
      },
    ]);
    const r = effectiveCells(sandboxState([P(0, 0)]), def, "n", testConfig());
    expect(r.available).toBe(false);
    if (!r.available) {
      expect(r.reason).toBe("undecidable-predicate");
      expect(r.detail).toContain("unplaced points");
    }
  });

  it("undecidable per-cell classification → undecidable-predicate", () => {
    // linesDown.boundaries also fails — mix linesOk boundaries (which
    // resolve) with a classify that always fails integrity.
    const mixed: ClassifierDef = {
      ...linesDown,
      id: "test:samples-mixed",
      boundaries: linesOk.boundaries,
    };
    ensureStub(mixed);
    const def = classifyNode("n", [
      {
        case: "c",
        when: {
          kind: "classifier",
          classifierId: "test:samples-mixed",
          inputs: { pts: { kind: "last-n", n: 2 } },
          on: { tag: "go" },
        },
        target: "n",
      },
    ]);
    const r = effectiveCells(sandboxState([P(0, 0), P(4, 0)]), def, "n", testConfig());
    expect(r).toEqual({
      available: false,
      reason: "undecidable-predicate",
      detail: "a cell representative cannot be classified exactly",
    });
  });
});
