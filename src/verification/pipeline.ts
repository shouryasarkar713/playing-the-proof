// verification/pipeline.ts — checkPre/checkPost: the SOLE owners of node
// pre/post evaluation for EVERY node role (v1.2.9). One invocation evaluates
// the spec list exactly once, in order, stopping at the first failure, and
// returns the discriminated VerificationResult — never a boolean.
import { integrityReport } from "../game/integrity.ts";
import type { CheckResult, VerificationResult } from "../game/integrity.ts";
import { findWinHoles } from "../game/gamemode.ts";
import { sharedEdgePairs } from "../geometry/holes.ts";
import type { Pt } from "../geometry/pt.ts";
import { regionContains } from "../geometry/poly.ts";
import type {
  Configuration,
  GameState,
  PointId,
} from "../game/types.ts";
import { evalPtListIds, evalRegion } from "../strategy/eval.ts";
import { getClassifier } from "../strategy/registry.ts";
import type {
  InvariantSpec,
  RegionExpr,
  StrategyNode,
} from "../strategy/types.ts";
import { CheckerIntegrityError, getChecker } from "./invariants.ts";

function lookupId(state: GameState, id: PointId): Pt | null {
  for (const p of state.points) {
    if (p.id === id) {
      return p.pt;
    }
  }
  return null;
}

function exhaustiveHoles(
  state: GameState,
  k: number,
  config: Configuration,
): import("../geometry/holes.ts").HoleAnalysis {
  return findWinHoles(state, k, {
    mode: "exhaustive",
    budget: config.analysis.budgetOps,
  });
}

// exists-k-hole: without `where`, any k-hole of the state; with
// `where`, a k-hole with ALL vertices contained (non-strict) in the
// correctness-channel region. Budget-exhausted ⇒ failed WITH analysis.
function checkExistsKHole(
  state: GameState,
  k: number,
  where: RegionExpr | undefined,
  config: Configuration,
): CheckResult {
  const id = `exists-k-hole:${k}`;
  const found = exhaustiveHoles(state, k, config);
  if (found.kind !== "exhaustive") {
    const searched =
      found.kind === "budget-exhausted" ? found.searched : 0;
    return {
      id,
      kind: "invariant",
      passed: false,
      detail: `k-hole enumeration undecidable (budget-exhausted after ${searched})`,
      analysis: found,
    };
  }
  if (where === undefined) {
    const pass = found.holes.length > 0;
    return {
      id,
      kind: "invariant",
      passed: pass,
      detail: pass
        ? `${found.holes.length} ${k}-hole(s) exist (exhaustive over ${state.points.length} points)`
        : `no ${k}-hole (exhaustive over ${state.points.length} points)`,
    };
  }
  const r = evalRegion(where, { state, config, channel: "correctness" });
  if (r.kind === "incomplete") {
    return {
      id,
      kind: "invariant",
      passed: false,
      detail: "where-region undecidable",
      analysis: r.analysis,
    };
  }
  let count = 0;
  for (const hole of found.holes) {
    const verts = hole.verts.map((vid) => lookupId(state, vid));
    if (
      verts.every(
        (v) => v !== null && regionContains(r.region, v, false),
      )
    ) {
      count += 1;
    }
  }
  return {
    id,
    kind: "invariant",
    passed: count > 0,
    detail:
      count > 0
        ? `${count} ${k}-hole(s) inside the where-region (exhaustive)`
        : `no ${k}-hole inside the where-region (exhaustive)`,
  };
}

function checkSharedEdgePair(
  state: GameState,
  k: number,
  config: Configuration,
): CheckResult {
  const id = `exists-shared-edge-pair:${k}`;
  const found = exhaustiveHoles(state, k, config);
  if (found.kind !== "exhaustive") {
    const searched =
      found.kind === "budget-exhausted" ? found.searched : 0;
    return {
      id,
      kind: "invariant",
      passed: false,
      detail: `k-hole enumeration undecidable (budget-exhausted after ${searched})`,
      analysis: found,
    };
  }
  const pairs = sharedEdgePairs(found.holes);
  return {
    id,
    kind: "invariant",
    passed: pairs.length > 0,
    detail:
      pairs.length > 0
        ? `${pairs.length} shared-edge pair(s) among ${k}-holes (exhaustive)`
        : `no shared-edge pair among ${k}-holes (exhaustive)`,
  };
}

function checkRegionEmptyOf(
  state: GameState,
  spec: Extract<InvariantSpec, { kind: "region-empty-of" }>,
  config: Configuration,
): CheckResult {
  const id = "region-empty-of";
  const r = evalRegion(spec.expr, { state, config, channel: "correctness" });
  if (r.kind === "incomplete") {
    return {
      id,
      kind: "invariant",
      passed: false,
      detail: "region undecidable",
      analysis: r.analysis,
    };
  }
  // violation = a matching point inside-or-on (non-strict).
  for (const p of state.points) {
    if (spec.owner === "breaker" && p.owner !== "breaker") {
      continue;
    }
    if (regionContains(r.region, p.pt, false)) {
      return {
        id,
        kind: "invariant",
        passed: false,
        detail: `region contains ${p.owner} point ${p.id}`,
      };
    }
  }
  return { id, kind: "invariant", passed: true, detail: "region empty of owner points" };
}

function checkConfigClass(
  state: GameState,
  cls: "one-interior" | "convex",
  config: Configuration,
): CheckResult {
  const id = `config-class:${cls}`;
  // the current four-point configuration = the last 4 placed points,
  // classified by the registered classifyFour (no duplicated hull logic).
  if (state.points.length < 4) {
    return {
      id,
      kind: "invariant",
      passed: false,
      detail: "fewer than 4 placed points",
    };
  }
  const classifier = getClassifier("classifyFour");
  if (classifier === undefined) {
    return {
      id,
      kind: "invariant",
      passed: false,
      detail: "classifier classifyFour not registered — implementation error",
    };
  }
  const ids = state.points.slice(-4).map((p) => p.id);
  const execution = classifier.classify(state, { pts: ids }, config);
  if (execution.kind === "integrity") {
    return {
      id,
      kind: "invariant",
      passed: false,
      detail: `classification undecidable (${execution.failure.detail})`,
      ...(execution.failure.analysis !== undefined
        ? { analysis: execution.failure.analysis }
        : {}),
    };
  }
  const pass = execution.result.tag === cls;
  return {
    id,
    kind: "invariant",
    passed: pass,
    detail: pass
      ? `four-point class is ${cls} (classified)`
      : `four-point class is ${execution.result.tag}, expected ${cls}`,
  };
}

function checkCustom(
  state: GameState,
  spec: Extract<InvariantSpec, { kind: "custom" }>,
  config: Configuration,
): CheckResult {
  const checker = getChecker(spec.checkerId);
  if (checker === undefined) {
    return {
      id: spec.checkerId,
      kind: "invariant",
      passed: false,
      detail: `unregistered checker ${spec.checkerId} — implementation error`,
    };
  }
  const resolved: Record<string, readonly PointId[]> = {};
  for (const [name, expr] of Object.entries(spec.args)) {
    const ids = evalPtListIds(expr, state);
    if (ids.kind === "resolution-failure") {
      return {
        id: spec.checkerId,
        kind: "invariant",
        passed: false,
        detail: `arg ${name}: ${ids.reason} (${ids.detail})`,
      };
    }
    resolved[name] = ids.ids;
  }
  let result: CheckResult;
  try {
    result = checker.check(state, resolved, config);
  } catch (e) {
    if (e instanceof CheckerIntegrityError) {
      const failed: CheckResult = {
        id: e.checkerId,
        kind: "invariant",
        passed: false,
        detail: `${e.reason}: ${e.detail}`,
      };
      if (e.analysis !== undefined) {
        failed.analysis = e.analysis;
      }
      return failed;
    }
    throw e;
  }
  if (
    typeof result !== "object" ||
    result === null ||
    result.id !== spec.checkerId ||
    (result.kind !== "geometry" &&
      result.kind !== "invariant" &&
      result.kind !== "strategy" &&
      result.kind !== "replay") ||
    typeof result.passed !== "boolean"
  ) {
    return {
      id: spec.checkerId,
      kind: "invariant",
      passed: false,
      detail: "malformed checker result — implementation error",
    };
  }
  return result;
}

function evaluateSpec(
  state: GameState,
  spec: InvariantSpec,
  config: Configuration,
): CheckResult {
  switch (spec.kind) {
    case "exists-k-hole":
      return checkExistsKHole(state, spec.k, spec.where, config);
    case "exists-shared-edge-pair":
      return checkSharedEdgePair(state, spec.k, config);
    case "region-empty-of":
      return checkRegionEmptyOf(state, spec, config);
    case "config-class":
      return checkConfigClass(state, spec.cls, config);
    case "custom":
      return checkCustom(state, spec, config);
  }
}

function verify(
  state: GameState,
  node: StrategyNode,
  phase: "pre" | "post",
  config: Configuration,
): VerificationResult {
  const specs = (phase === "pre" ? node.pre : node.post) ?? [];
  const checks: CheckResult[] = [];
  for (const spec of specs) {
    const check = evaluateSpec(state, spec, config);
    checks.push(check);
    if (!check.passed) {
      return {
        kind: "failed",
        checks,
        report: integrityReport(state, node.id, phase, check),
      };
    }
  }
  return { kind: "passed", checks };
}

export function checkPre(
  state: GameState,
  node: StrategyNode,
  config: Configuration,
): VerificationResult {
  return verify(state, node, "pre", config);
}

export function checkPost(
  state: GameState,
  node: StrategyNode,
  config: Configuration,
): VerificationResult {
  return verify(state, node, "post", config);
}
