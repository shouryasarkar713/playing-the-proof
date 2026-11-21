// tests/verification/pipeline.test.ts — the §5.8/§10.6 node-verification
// battery: passed/failed at both phases, the four custom-checker outcomes,
// analysis survival, exactly-once, no hidden storage, plus built-in kinds.
import { describe, expect, it } from "vitest";
import type { Rat as RatType } from "../../src/geometry/rat.ts";
import { checkPost, checkPre } from "../../src/verification/pipeline.ts";
import {
  ALL_TEST_CHECKERS,
  guidedState,
  P,
  resetTestSpy,
  testSpy,
} from "../strategy/scaffolding.ts";
import { registerChecker } from "../../src/verification/invariants.ts";
import {
  classifyFour,
  registerClassifier,
} from "../../src/strategy/registry.ts";
import type {
  InvariantSpec,
  StrategyNode,
} from "../../src/strategy/types.ts";
import { sandboxState, testConfig } from "../helpers.ts";

registerClassifier(classifyFour);
for (const checker of ALL_TEST_CHECKERS) {
  registerChecker(checker);
}

function nodeWith(
  id: string,
  phase: "pre" | "post",
  specs: readonly InvariantSpec[],
): StrategyNode {
  return {
    id,
    role: "maker-move",
    next: "end",
    move: {
      kind: "fixed",
      at: [{ kind: "const", x: P(0, 0).x, y: P(0, 0).y }],
    },
    ...(phase === "pre" ? { pre: specs } : { post: specs }),
    show: [],
    why: { headline: "t", claims: [], sourceRef: "t" },
    sourceRef: "t",
  };
}

const CFG = testConfig();

describe("node-verification battery (§5.8/§10.6)", () => {
  it("passed at both phases carries the evaluated checks", () => {
    const st = guidedState([P(0, 0), P(4, 0), P(0, 4)], 3, "n", {});
    const pre = checkPre(
      st,
      nodeWith("n", "pre", [{ kind: "exists-k-hole", k: 3 }]),
      CFG,
    );
    expect(pre.kind).toBe("passed");
    if (pre.kind === "passed") {
      expect(pre.checks.length).toBe(1);
      expect(pre.checks[0]?.passed).toBe(true);
    }
    const post = checkPost(
      st,
      nodeWith("n", "post", [{ kind: "exists-k-hole", k: 3 }]),
      CFG,
    );
    expect(post.kind).toBe("passed");
  });

  it("failed carries the exact report (failedAt/phase/failed)", () => {
    const st = guidedState([P(0, 0), P(4, 0)], 3, "n", {});
    const post = checkPost(
      st,
      nodeWith("n", "post", [{ kind: "exists-k-hole", k: 5 }]),
      CFG,
    );
    expect(post.kind).toBe("failed");
    if (post.kind === "failed") {
      expect(post.report.failedAt).toBe("n");
      expect(post.report.phase).toBe("post");
      expect(post.report.failed.id).toBe("exists-k-hole:5");
      expect(post.checks.length).toBe(1);
    }
    const pre = checkPre(
      st,
      nodeWith("m", "pre", [{ kind: "exists-k-hole", k: 5 }]),
      CFG,
    );
    expect(pre.kind).toBe("failed");
    if (pre.kind === "failed") {
      expect(pre.report.phase).toBe("pre");
      expect(pre.report.failedAt).toBe("m");
    }
  });

  it("custom decided-false takes the ordinary invariant path (no analysis)", () => {
    const st = guidedState([P(0, 0)], 3, "n", {});
    const r = checkPost(
      st,
      nodeWith("n", "post", [
        { kind: "custom", checkerId: "test:fail", args: {}, describe: "x" },
      ]),
      CFG,
    );
    expect(r.kind).toBe("failed");
    if (r.kind === "failed") {
      expect(r.report.failed.id).toBe("test:fail");
      expect(r.report.failed.passed).toBe(false);
      expect("analysis" in r.report.failed).toBe(false);
    }
  });

  it("custom cardinality error converts with its reason", () => {
    const st = guidedState([P(0, 0)], 3, "n", {});
    const r = checkPost(
      st,
      nodeWith("n", "post", [
        { kind: "custom", checkerId: "test:cardinality", args: {}, describe: "x" },
      ]),
      CFG,
    );
    expect(r.kind).toBe("failed");
    if (r.kind === "failed") {
      expect(r.report.failed.detail).toContain("argument-cardinality");
      expect("analysis" in r.report.failed).toBe(false);
    }
  });

  it("custom undecidable failure preserves the analysis payload", () => {
    const st = guidedState([P(0, 0)], 3, "n", {});
    const r = checkPost(
      st,
      nodeWith("n", "post", [
        { kind: "custom", checkerId: "test:undecidable", args: {}, describe: "x" },
      ]),
      CFG,
    );
    expect(r.kind).toBe("failed");
    if (r.kind === "failed") {
      expect(r.report.failed.analysis).toEqual({
        kind: "budget-exhausted",
        k: 3,
        searched: 0,
      });
    }
  });

  it("unregistered checker id is an implementation-error failure", () => {
    const st = guidedState([P(0, 0)], 3, "n", {});
    const r = checkPost(
      st,
      nodeWith("n", "post", [
        { kind: "custom", checkerId: "test:nope", args: {}, describe: "x" },
      ]),
      CFG,
    );
    expect(r.kind).toBe("failed");
    if (r.kind === "failed") {
      expect(r.report.failed.detail).toContain("unregistered checker");
    }
  });

  it("exactly-once: stops at the first failure; reruns are independent", () => {
    resetTestSpy();
    const st = guidedState([P(0, 0)], 3, "n", {});
    // [fail, count]: count never runs (fail-closed order).
    const r1 = checkPost(
      st,
      nodeWith("n", "post", [
        { kind: "custom", checkerId: "test:fail", args: {}, describe: "x" },
        { kind: "custom", checkerId: "test:count", args: {}, describe: "y" },
      ]),
      CFG,
    );
    expect(r1.kind).toBe("failed");
    expect(testSpy.count).toBe(0);
    // [count, fail]: count runs exactly once, then stop.
    const r2 = checkPost(
      st,
      nodeWith("n", "post", [
        { kind: "custom", checkerId: "test:count", args: {}, describe: "y" },
        { kind: "custom", checkerId: "test:fail", args: {}, describe: "x" },
      ]),
      CFG,
    );
    expect(r2.kind).toBe("failed");
    expect(testSpy.count).toBe(1);
    // No hidden storage: an identical second call reruns (counter 2).
    checkPost(
      st,
      nodeWith("n", "post", [
        { kind: "custom", checkerId: "test:count", args: {}, describe: "y" },
      ]),
      CFG,
    );
    expect(testSpy.count).toBe(2);
  });

  it("custom args resolve and reach the checker verbatim", () => {
    resetTestSpy();
    const st = guidedState([P(0, 0), P(4, 0), P(0, 4)], 3, "n", {
      TRI: ["p1", "p2", "p3"],
      A: "p1",
    });
    const r = checkPost(
      st,
      nodeWith("n", "post", [
        {
          kind: "custom",
          checkerId: "test:spy-args",
          args: {
            outer: { kind: "var", v: "TRI" },
            interior: { kind: "points", of: [{ kind: "anchor", v: "A" }] },
          },
          describe: "x",
        },
      ]),
      CFG,
    );
    expect(r.kind).toBe("passed");
    expect(testSpy.lastArgs).toEqual({
      outer: ["p1", "p2", "p3"],
      interior: ["p1"],
    });
  });
});

describe("built-in invariant kinds", () => {
  it("exists-shared-edge-pair on the F-H3 state", () => {
    const f3 = [
      P(4, 4),
      P(6, 5),
      P(3, 8),
      P(1, 3),
      P(0, 1),
      P(3, 6),
    ];
    const st = guidedState(f3, 5, "n", {});
    const pass = checkPost(
      st,
      nodeWith("n", "post", [{ kind: "exists-shared-edge-pair", k: 4 }]),
      CFG,
    );
    expect(pass.kind).toBe("passed");
    const fail = checkPost(
      st,
      nodeWith("n", "post", [{ kind: "exists-shared-edge-pair", k: 5 }]),
      CFG,
    );
    expect(fail.kind).toBe("failed");
  });

  it("region-empty-of (breaker filter + undecidable analysis)", () => {
    const st = guidedState([P(0, 0), P(4, 0), P(0, 4)], 3, "C", {});
    const expr = {
      kind: "halfplane" as const,
      thru: [
        { kind: "const" as const, x: P(2, -1).x, y: P(2, -1).y },
        { kind: "const" as const, x: P(2, 9).x, y: P(2, 9).y },
      ] as [
        { kind: "const"; x: RatType; y: RatType },
        { kind: "const"; x: RatType; y: RatType },
      ],
      side: "right" as const,
    };
    // x > 2 halfplane: breaker p2=(4,0) inside → violation naming p2.
    const fail = checkPost(
      st,
      nodeWith("n", "post", [
        { kind: "region-empty-of", expr, owner: "breaker" },
      ]),
      CFG,
    );
    expect(fail.kind).toBe("failed");
    if (fail.kind === "failed") {
      expect(fail.report.failed.detail).toContain("p2");
    }
    // Empty-side region (x > 10, nothing there) passes for owner any.
    const exprR = {
      kind: "halfplane" as const,
      thru: [
        { kind: "const" as const, x: P(10, -1).x, y: P(10, -1).y },
        { kind: "const" as const, x: P(10, 9).x, y: P(10, 9).y },
      ] as [
        { kind: "const"; x: RatType; y: RatType },
        { kind: "const"; x: RatType; y: RatType },
      ],
      side: "right" as const,
    };
    const pass = checkPost(
      st,
      nodeWith("n", "post", [
        { kind: "region-empty-of", expr: exprR, owner: "any" },
      ]),
      CFG,
    );
    expect(pass.kind).toBe("passed");
  });

  it("config-class via classifyFour on last-4 (both classes)", () => {
    const oneInt = guidedState([P(0, 0), P(4, 0), P(4, 4), P(1, 1)], 3, "C", {});
    const pass = checkPost(
      oneInt,
      nodeWith("n", "post", [{ kind: "config-class", cls: "one-interior" }]),
      CFG,
    );
    expect(pass.kind).toBe("passed");
    const fail = checkPost(
      oneInt,
      nodeWith("n", "post", [{ kind: "config-class", cls: "convex" }]),
      CFG,
    );
    expect(fail.kind).toBe("failed");
    const convex = guidedState([P(0, 0), P(4, 0), P(4, 4), P(0, 4)], 3, "C", {});
    const pass2 = checkPost(
      convex,
      nodeWith("n", "post", [{ kind: "config-class", cls: "convex" }]),
      CFG,
    );
    expect(pass2.kind).toBe("passed");
  });

  it("exists-k-hole where: all-vertices-contained reading", () => {
    const f3 = [
      P(4, 4),
      P(6, 5),
      P(3, 8),
      P(1, 3),
      P(0, 1),
      P(3, 6),
    ];
    const st = guidedState(f3, 5, "n", {});
    const pass = checkPost(
      st,
      nodeWith("n", "post", [
        { kind: "exists-k-hole", k: 4, where: { kind: "window" } },
      ]),
      CFG,
    );
    expect(pass.kind).toBe("passed");
  });

  it("tight budgets fail with the analysis payload (never silent)", () => {
    const f3 = [
      P(4, 4),
      P(6, 5),
      P(3, 8),
      P(1, 3),
      P(0, 1),
      P(3, 6),
    ];
    const st = guidedState(f3, 5, "n", {});
    const tight = testConfig(10);
    const r = checkPost(
      st,
      nodeWith("n", "post", [{ kind: "exists-k-hole", k: 4 }]),
      tight,
    );
    expect(r.kind).toBe("failed");
    if (r.kind === "failed") {
      expect(r.report.failed.analysis?.kind).toBe("budget-exhausted");
    }
  });

  it("sandbox states work (strategy runtime optional for pure specs)", () => {
    const st = sandboxState([P(0, 0), P(4, 0), P(0, 4)]);
    const r = checkPost(
      st,
      nodeWith("n", "post", [{ kind: "exists-k-hole", k: 3 }]),
      CFG,
    );
    expect(r.kind).toBe("passed");
  });
});
