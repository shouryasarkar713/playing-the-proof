// strategy/runtime.ts — routing: nodeOf, isTerminalNode, and the ROUTE-ONLY
// classify() (§10.4/§10.9, v1.2.9). classify() performs NO invariant
// verification of any kind — the classify node's post belongs to the ENGINE
// (sole owner: verification/, invoked once per §10.8). This module imports
// nothing from verification/ or engine/ (§18.1).
import { integrityReport } from "../game/integrity.ts";
import type { CheckResult, IntegrityReport } from "../game/integrity.ts";
import type { HoleAnalysis } from "../geometry/holes.ts";
import type { Pt } from "../geometry/pt.ts";
import { regionContains } from "../geometry/poly.ts";
import type {
  Binding,
  Configuration,
  GameState,
  NodeId,
  PointId,
} from "../game/types.ts";
import { getClassifier } from "./registry.ts";
import { evalPtListIds, evalRegion } from "./eval.ts";
import type { EvalCtx } from "./eval.ts";
import type {
  RegionPredicate,
  RouteRule,
  StrategyDef,
  StrategyNode,
} from "./types.ts";

export function nodeOf(def: StrategyDef, nodeId: NodeId): StrategyNode {
  const node = def.nodes[nodeId];
  if (node === undefined) {
    throw new Error(
      `nodeOf: unknown node ${nodeId} in def ${def.id} — implementation error`,
    );
  }
  return node;
}

export function isTerminalNode(def: StrategyDef, nodeId: NodeId): boolean {
  const node = def.nodes[nodeId];
  if (node === undefined) {
    throw new Error(
      `isTerminalNode: unknown node ${nodeId} in def ${def.id} — implementation error`,
    );
  }
  return node.role === "terminal";
}

export type ClassifyOut =
  | {
      ok: true;
      case: string;
      target: NodeId;
      bindings: Readonly<Record<string, Binding>>;
    }
  | { ok: false; report: IntegrityReport };

function failRoute(
  state: GameState,
  nodeId: NodeId,
  id: string,
  detail: string,
  analysis?: HoleAnalysis,
): ClassifyOut {
  const failed: CheckResult = {
    id,
    kind: "strategy",
    passed: false,
    detail,
    ...(analysis !== undefined ? { analysis } : {}),
  };
  return { ok: false, report: integrityReport(state, nodeId, "route", failed) };
}

function ruleBindings(
  rule: RouteRule,
  classifierBindings:
    | Readonly<Record<string, PointId | readonly PointId[]>>
    | undefined,
  pointId: PointId,
): Readonly<Record<string, Binding>> | null {
  if (rule.bind === undefined) {
    return {};
  }
  const out: Record<string, Binding> = {};
  for (const [name, expr] of Object.entries(rule.bind)) {
    if (expr.kind === "last") {
      out[name] = pointId;
    } else {
      const v = classifierBindings?.[expr.field];
      if (v === undefined) {
        return null;
      }
      out[name] = v;
    }
  }
  return out;
}

type RuleOut = ClassifyOut | null;

function matchRule(
  rule: RouteRule,
  state: GameState,
  point: Pt,
  pointId: PointId,
  ctx: EvalCtx,
  nodeId: NodeId,
): RuleOut {
  const when: RegionPredicate = rule.when;
  if (when.kind === "all") {
    return {
      ok: true,
      case: rule.case,
      target: rule.target,
      bindings: ruleBindings(rule, undefined, pointId) ?? {},
    };
  }
  if (when.kind === "region") {
    const r = evalRegion(when.expr, ctx);
    if (r.kind === "incomplete") {
      return failRoute(
        state,
        nodeId,
        "classify",
        "route predicate undecidable",
        r.analysis,
      );
    }
    // Non-strict containment (§6.5/§10.4: boundary belongs to the region).
    if (!regionContains(r.region, point, false)) {
      return null;
    }
    return {
      ok: true,
      case: rule.case,
      target: rule.target,
      bindings: ruleBindings(rule, undefined, pointId) ?? {},
    };
  }
  // Classifier rule.
  const classifier = getClassifier(when.classifierId);
  if (classifier === undefined) {
    return failRoute(
      state,
      nodeId,
      when.classifierId,
      `unregistered classifier ${when.classifierId}`,
    );
  }
  const resolved: Record<string, readonly PointId[]> = {};
  if (when.inputs !== undefined) {
    for (const [name, expr] of Object.entries(when.inputs)) {
      const ids = evalPtListIds(expr, state);
      if (ids.kind === "resolution-failure") {
        return failRoute(
          state,
          nodeId,
          classifier.id,
          `input ${name}: ${ids.reason} (${ids.detail})`,
        );
      }
      resolved[name] = ids.ids;
    }
  }
  const execution = classifier.classify(state, resolved, ctx.config);
  if (execution.kind === "integrity") {
    const failed: CheckResult = {
      id: classifier.id,
      kind: "strategy",
      passed: false,
      detail: execution.failure.detail,
      ...(execution.failure.analysis !== undefined
        ? { analysis: execution.failure.analysis }
        : {}),
    };
    return {
      ok: false,
      report: integrityReport(state, nodeId, "route", failed),
    };
  }
  if (!classifier.resultTags.includes(execution.result.tag)) {
    return failRoute(
      state,
      nodeId,
      classifier.id,
      `undeclared tag ${execution.result.tag}`,
    );
  }
  if (execution.result.tag !== when.on.tag) {
    return null;
  }
  const bindings = ruleBindings(rule, execution.result.bindings, pointId);
  if (bindings === null) {
    return failRoute(
      state,
      nodeId,
      classifier.id,
      "binding references missing classifier field",
    );
  }
  return { ok: true, case: rule.case, target: rule.target, bindings };
}

function lookupPoint(state: GameState, id: PointId): Pt | null {
  for (const p of state.points) {
    if (p.id === id) {
      return p.pt;
    }
  }
  return null;
}

// classify (§10.9) — first-match routing at the placed point. Region rules
// run on the correctness channel (complete ⇒ containment test,
// EMPTY-complete ⇒ false; incomplete ⇒ integrity). Classifier rules resolve
// inputs via evalPtListIds, run the §5.7 three-argument contract, and
// pattern-match ClassifierExecution. Returns the match or a route-integrity
// report; never verifies invariants; never advances nodeId.
export function classify(
  def: StrategyDef,
  state: GameState,
  nodeId: NodeId,
  pointId: PointId,
  config: Configuration,
): ClassifyOut {
  const node = nodeOf(def, nodeId);
  if (node.role !== "classify-breaker" || node.routes === undefined) {
    return failRoute(
      state,
      nodeId,
      "classify",
      `classify called on non-classify node ${nodeId}`,
    );
  }
  const point = lookupPoint(state, pointId);
  if (point === null) {
    return failRoute(
      state,
      nodeId,
      "classify",
      `classify point ${pointId} names no placed point`,
    );
  }
  const ctx: EvalCtx = { state, config, channel: "correctness" };
  for (const rule of node.routes) {
    const matched = matchRule(rule, state, point, pointId, ctx, nodeId);
    if (matched !== null) {
      return matched;
    }
  }
  return failRoute(state, nodeId, "classify", "no route matched");
}
