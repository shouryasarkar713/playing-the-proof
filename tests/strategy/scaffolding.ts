// tests/strategy/scaffolding.ts — shared Phase-9 test scaffolding (PURE
// builders only — no registration side effects; each test file registers
// what it needs). Twin-5-hole construction + test checkers/classifiers.
import { Rat } from "../../src/geometry/rat.ts";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import type { GameState } from "../../src/game/types.ts";
import type { CheckResult } from "../../src/game/integrity.ts";
import type { IdPt } from "../../src/geometry/holes.ts";
import type { CustomChecker } from "../../src/verification/invariants.ts";
import type { ClassifierDef } from "../../src/strategy/types.ts";
import { CheckerIntegrityError } from "../../src/verification/invariants.ts";
import { withIds } from "../helpers.ts";

export function P(x: number, y: number): Pt {
  return pt(Rat.make(BigInt(x)), Rat.make(BigInt(y)));
}

// Twin-5-hole point set: ABC shared triangle; D1E1 / D2E2 far wings.
// Order: A,B,C,D1,E1,D2,E2 (T1 = indices 0–4).
// GP verified by hand (D2=(−5,26) and E2=(26,−4) dodge the B–C diagonal
// x+y=20 and the C–E2–B line through (20,0)).
export function twinPts(): Pt[] {
  return [
    P(0, 0), // A
    P(20, 0), // B
    P(0, 20), // C
    P(30, 1), // D1
    P(1, 30), // E1
    P(-5, 26), // D2
    P(26, -4), // E2
  ];
}

export function twinIds(): IdPt[] {
  return withIds(twinPts());
}

// Guided-shaped state literal (test-only construction seam): strategy
// runtime supplied explicitly; invariants hold by construction below.
export function guidedState(
  pts: Pt[],
  k: 3 | 5 | 6,
  nodeId: string,
  vars: Record<string, string | string[]>,
  strategyId = "test-only",
): GameState {
  return {
    seq: 0,
    k,
    mode: "break",
    points: pts.map((p, i) => ({
      id: `p${i + 1}`,
      owner: (i % 2 === 0 ? "maker" : "breaker") as "maker" | "breaker",
      pt: p,
      move: i + 1,
    })),
    turn: (pts.length % 2 === 0 ? "maker" : "breaker") as
      | "maker"
      | "breaker",
    terminal: null,
    strategy: {
      strategyId,
      version: "0.0.0",
      nodeId,
      vars: vars as Record<string, string | readonly string[]>,
      lastCase: null,
    },
  };
}

// ---- test-only checkers (registered per test file; spy pattern §23.3a) ----

export const testSpy: {
  count: number;
  lastArgs: Record<string, readonly string[]> | null;
} = { count: 0, lastArgs: null };

export function resetTestSpy(): void {
  testSpy.count = 0;
  testSpy.lastArgs = null;
}

function verdict(id: string, passed: boolean, detail: string): CheckResult {
  return { id, kind: "invariant", passed, detail };
}

export const checkerPass: CustomChecker = {
  id: "test:pass",
  describe: "always passes",
  check: () => verdict("test:pass", true, "pass"),
};

export const checkerFail: CustomChecker = {
  id: "test:fail",
  describe: "decided failure",
  check: () => verdict("test:fail", false, "decided false"),
};

export const checkerCardinality: CustomChecker = {
  id: "test:cardinality",
  describe: "throws argument-cardinality",
  check: () => {
    throw new CheckerIntegrityError(
      "test:cardinality",
      "argument-cardinality",
      "bad arity",
    );
  },
};

export const checkerUndecidable: CustomChecker = {
  id: "test:undecidable",
  describe: "throws undecidable-computation with analysis",
  check: () => {
    throw new CheckerIntegrityError(
      "test:undecidable",
      "undecidable-computation",
      "capped",
      { kind: "budget-exhausted", k: 3, searched: 0 },
    );
  },
};

export const checkerCount: CustomChecker = {
  id: "test:count",
  describe: "counts invocations, passes",
  check: () => {
    testSpy.count += 1;
    return verdict("test:count", true, `run ${testSpy.count}`);
  },
};

export const checkerSpyArgs: CustomChecker = {
  id: "test:spy-args",
  describe: "records resolved args, passes",
  check: (_state, args) => {
    testSpy.lastArgs = { ...args };
    return verdict("test:spy-args", true, "recorded");
  },
};

export const ALL_TEST_CHECKERS: readonly CustomChecker[] = [
  checkerPass,
  checkerFail,
  checkerCardinality,
  checkerUndecidable,
  checkerCount,
  checkerSpyArgs,
];

// ---- test-only classifiers ----

export const clfAlwaysGo: ClassifierDef = {
  id: "test:always-go",
  resultTags: ["go", "stop"],
  classify: () => ({ kind: "classified", result: { tag: "go" } }),
  boundaries: () => ({ kind: "ok", lines: [] }),
};

export const clfUndecidable: ClassifierDef = {
  id: "test:undecidable",
  resultTags: ["x"],
  classify: () => ({
    kind: "integrity",
    failure: {
      reason: "undecidable-computation",
      detail: "capped",
      analysis: { kind: "budget-exhausted", k: 4, searched: 3 },
    },
  }),
  boundaries: () => ({
    kind: "integrity",
    failure: {
      reason: "undecidable-computation",
      detail: "capped",
      analysis: { kind: "budget-exhausted", k: 4, searched: 3 },
    },
  }),
};

export const clfBadTag: ClassifierDef = {
  id: "test:bad-tag",
  resultTags: ["ok"],
  classify: () => ({ kind: "classified", result: { tag: "nope" } }),
  boundaries: () => ({ kind: "ok", lines: [] }),
};

export const ALL_TEST_CLASSIFIERS: readonly ClassifierDef[] = [
  clfAlwaysGo,
  clfUndecidable,
  clfBadTag,
];
