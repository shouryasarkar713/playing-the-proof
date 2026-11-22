// strategy/registry.ts — strategy + classifier registries, G1–G11
// structural validation, the StrategyDefRuntime/JSON codec, and the derived
// strategy status (Gate E). All validation here is state-INDEPENDENT.
import { Rat } from "../geometry/rat.ts";
import { convexPosition, hull } from "../geometry/hull.ts";
import type { Pt } from "../geometry/pt.ts";
import type {
  ClassifierDef,
  InvariantSpec,
  MoveSpec,
  OverlaySpec,
  PtExpr,
  PtListExpr,
  RegionExpr,
  RegionPredicate,
  StrategyDef,
  StrategyNode,
} from "./types.ts";
import type {
  InvariantSpecJSON,
  MoveSpecJSON,
  OverlaySpecJSON,
  PtExprJSON,
  PtListExprJSON,
  RegionExprJSON,
  RegionPredicateJSON,
  StrategyDefJSON,
  StrategyNodeJSON,
} from "./types.ts";
import type {
  GameState,
  NodeId,
  PointId,
  VarName,
} from "../game/types.ts";

export type StrategyTier = "core" | "fixture" | "experimental-extension";
export type StrategyStatus =
  | "fixture"
  | "experimental-extension"
  | "validated-randomized"
  | "verified-conventions";

export type ValidationStatus =
  | "PASS"
  | "COUNTEREXAMPLE"
  | "NOT_RUN"
  | "BUDGET_EXCEEDED"
  | "IMPLEMENTATION_ERROR";

export interface ValidationCheck {
  id: string;
  scope: string;
  configOrSeed?: string;
  result: ValidationStatus;
  witness?: { fixture: string };
}

export interface ValidationReport {
  strategyId: string;
  defVersion: string;
  checks: readonly ValidationCheck[];
}

export interface RegisteredStrategy {
  def: StrategyDef;
  tier: StrategyTier;
  validation: ValidationReport;
}

// Required exact checks per strategy id (promotion gates C/C6; §24.7/§23.8).
function requiredChecks(strategyId: string, k: number): readonly string[] {
  if (k === 5 && strategyId === "esmb-k5") {
    return ["exact:b3-cell"];
  }
  if (k === 6 && strategyId === "esmb-k6") {
    return ["exact:b1-cell", "exact:b0-cell", "rep:escape"];
  }
  return [];
}

export function effectiveStatus(rs: RegisteredStrategy): StrategyStatus {
  if (rs.tier === "fixture") {
    return "fixture";
  }
  if (rs.tier === "experimental-extension") {
    return "experimental-extension";
  }
  // Promotion requires RECORDED passes for mapped checks — an empty mapping
  // (unknown core def) never promotes (no vacuous verification).
  const required = requiredChecks(rs.def.id, rs.def.k);
  if (required.length === 0) {
    return "validated-randomized";
  }
  // (test-gap audit): a report recorded against another def version
  // proves nothing about THIS def — a stale report never promotes.
  if (rs.validation.defVersion !== rs.def.version) {
    return "validated-randomized";
  }
  const pass = new Set(
    rs.validation.checks
      .filter((c) => c.result === "PASS")
      .map((c) => c.id),
  );
  return required.every((id) => pass.has(id))
    ? "verified-conventions"
    : "validated-randomized";
}

export class RegistrationError extends Error {
  readonly code: string;
  constructor(code: string, detail: string) {
    super(`registration ${code}: ${detail}`);
    this.name = "RegistrationError";
    this.code = code;
  }
}

// ---- live maps (single source; ctx mirrors these same objects) ----

const strategyMap = new Map<string, RegisteredStrategy>();
const classifierMap = new Map<string, ClassifierDef>();

export function strategies(): ReadonlyMap<string, RegisteredStrategy> {
  return strategyMap;
}

export function getClassifier(id: string): ClassifierDef | undefined {
  return classifierMap.get(id);
}

// recordValidationCheck (§26Q promotion writes): append a check to the
// strategy's ValidationReport, replacing any previous entry with the same
// id. The ONLY way checks enter the report — never hand-edited. Throws on
// unknown strategy ids (fail-loud, never a silent no-op).
export function recordValidationCheck(
  strategyId: string,
  check: ValidationCheck,
): void {
  const rs = strategyMap.get(strategyId);
  if (rs === undefined) {
    throw new Error(
      `recordValidationCheck: unknown strategy ${strategyId} — implementation error`,
    );
  }
  const rest = rs.validation.checks.filter((c) => c.id !== check.id);
  strategyMap.set(strategyId, {
    ...rs,
    validation: { ...rs.validation, checks: [...rest, check] },
  });
}

export function classifiers(): ReadonlyMap<string, ClassifierDef> {
  return classifierMap;
}

export function registerClassifier(def: ClassifierDef): void {
  if (def.id === "") {
    throw new RegistrationError("classifier-id", "empty classifier id");
  }
  if (def.resultTags.length === 0) {
    throw new RegistrationError(
      "classifier-tags",
      `${def.id} declares no result tags`,
    );
  }
  if (classifierMap.has(def.id)) {
    throw new RegistrationError(
      "classifier-dup",
      `classifier ${def.id} already registered`,
    );
  }
  classifierMap.set(def.id, def);
}

// ---- classifyFour: the generic four-point classifier (§23.2) ----

function lookupFour(
  state: GameState,
  ids: readonly PointId[],
): Pt[] | null {
  const pts: Pt[] = [];
  for (const id of ids) {
    let found: Pt | null = null;
    for (const p of state.points) {
      if (p.id === id) {
        found = p.pt;
        break;
      }
    }
    if (found === null) {
      return null;
    }
    pts.push(found);
  }
  return pts;
}

// classifyFour (§23.2): convex (a 4-hole exists) vs one-interior (the outer
// triangle + the swallowed point, whichever point that is — the unified
// reading). Pure hull arithmetic; ignores config; integrity unreachable by
// construction (|pts| ≠ 4 is the typed failure — unreachable on valid defs).
export const classifyFour: ClassifierDef = {
  id: "classifyFour",
  resultTags: ["convex", "one-interior"],
  classify(state, inputs, _config) {
    const ids = inputs["pts"];
    if (ids === undefined || ids.length !== 4) {
      return {
        kind: "integrity",
        failure: {
          reason: "invalid-result",
          detail: `classifyFour requires exactly 4 resolved points (got ${ids?.length ?? 0})`,
        },
      };
    }
    const pts = lookupFour(state, ids);
    if (pts === null) {
      return {
        kind: "integrity",
        failure: {
          reason: "invalid-result",
          detail: "classifyFour inputs name unplaced points",
        },
      };
    }
    if (convexPosition(pts)) {
      return { kind: "classified", result: { tag: "convex" } };
    }
    const h = hull(pts);
    // §23.2: outer is the CCW id list — map hull vertices (CCW) back to
    // ids by coordinate equality (placed points are distinct). The checker
    // (§23.3a) and the co-shoulder construction (§23.3 item 1) recompute
    // (u,v) from this same ordered triple, so the order is load-bearing.
    const outer: PointId[] = [];
    for (const q of h) {
      const idx = pts.findIndex((p) => p.x.equals(q.x) && p.y.equals(q.y));
      if (idx < 0) {
        return {
          kind: "integrity",
          failure: {
            reason: "invalid-result",
            detail: "classifyFour: hull vertex names no input point",
          },
        };
      }
      outer.push(ids[idx] as PointId);
    }
    let interior: PointId | null = null;
    for (let i = 0; i < ids.length; i += 1) {
      const id = ids[i] as PointId;
      if (!outer.includes(id)) {
        interior = id;
      }
    }
    if (outer.length !== 3 || interior === null) {
      return {
        kind: "integrity",
        failure: {
          reason: "invalid-result",
          detail: "classifyFour: non-convex four points with no single interior",
        },
      };
    }
    return {
      kind: "classified",
      result: { tag: "one-interior", bindings: { outer, interior } },
    };
  },
  boundaries(_state, inputs, _config) {
    const ids = inputs["pts"];
    if (ids === undefined || ids.length !== 4) {
      return {
        kind: "integrity",
        failure: {
          reason: "invalid-result",
          detail: "classifyFour boundaries require exactly 4 points",
        },
      };
    }
    const lines: [PointId, PointId][] = [];
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        lines.push([ids[i] as PointId, ids[j] as PointId]);
      }
    }
    return { kind: "ok", lines };
  },
};

// ---- G1–G11 structural validation ----

function fail(code: string, detail: string): never {
  throw new RegistrationError(code, detail);
}

function checkNodeShape(id: NodeId, node: StrategyNode): void {
  const has = {
    next: node.next !== undefined,
    move: node.move !== undefined,
    placeBind: node.placeBind !== undefined,
    compute: node.compute !== undefined,
    routes: node.routes !== undefined,
    pre: node.pre !== undefined,
    post: node.post !== undefined,
  };
  switch (node.role) {
    case "maker-move":
      if (!has.move || !has.next) {
        fail("G2", `${id}: maker-move requires move + next`);
      }
      if (has.routes || has.compute) {
        fail("G2", `${id}: maker-move forbids routes/compute`);
      }
      break;
    case "classify-breaker":
      if (!has.routes || node.routes === undefined || node.routes.length === 0) {
        fail("G2", `${id}: classify-breaker requires non-empty routes`);
      }
      if (has.next || has.move || has.compute) {
        fail("G2", `${id}: classify-breaker forbids next/move/compute`);
      }
      break;
    case "computed-step":
      if (!has.compute || !has.next) {
        fail("G2", `${id}: computed-step requires compute + next`);
      }
      if (has.routes || has.move) {
        fail("G2", `${id}: computed-step forbids routes/move`);
      }
      break;
    case "terminal":
      if (has.next || has.move || has.compute || has.routes || has.pre || has.post) {
        fail("G2/G4", `${id}: terminal carries no next/move/compute/routes/pre/post`);
      }
      break;
  }
}

function validateGraph(def: StrategyDef): void {
  const nodes = def.nodes;
  const entry = nodes[def.entry];
  if (entry === undefined) {
    fail("G1", `entry ${def.entry} names no node`);
  }
  if (
    entry.role !== "maker-move" &&
    entry.role !== "classify-breaker" &&
    entry.role !== "computed-step"
  ) {
    fail("G1", `entry ${def.entry} is not executable`);
  }
  for (const [id, node] of Object.entries(nodes)) {
    checkNodeShape(id, node);
    if (node.next !== undefined && nodes[node.next] === undefined) {
      fail("G3", `${id}: dangling next ${node.next}`);
    }
    if (node.routes !== undefined) {
      for (const rule of node.routes) {
        const target = nodes[rule.target];
        if (target === undefined) {
          fail("G3", `${id}: dangling route target ${rule.target}`);
        }
        // An `unverified` route never runs its target (the session ends as an
        // honest uncovered terminal), so any existing node may be named.
        if (
          rule.interaction !== "unverified" &&
          target.role !== "maker-move" &&
          target.role !== "computed-step"
        ) {
          fail("G3", `${id}: route target ${rule.target} must be maker-move/computed-step`);
        }
        if (rule.when.kind === "classifier") {
          if (getClassifier(rule.when.classifierId) === undefined) {
            fail("G8", `${id}: unregistered classifier ${rule.when.classifierId}`);
          }
          const clf = getClassifier(rule.when.classifierId) as ClassifierDef;
          if (!clf.resultTags.includes(rule.when.on.tag)) {
            fail("G9", `${id}: tag ${rule.when.on.tag} outside ${clf.id} resultTags`);
          }
        }
      }
      const last = node.routes[node.routes.length - 1];
      if (last === undefined || last.when.kind !== "all") {
        fail("G7", `${id}: last route must be catch-all`);
      }
    }
    if (node.pre !== undefined) {
      for (const spec of node.pre) {
        checkInvariantWellformed(id, spec, "pre");
      }
    }
    if (node.post !== undefined) {
      for (const spec of node.post) {
        checkInvariantWellformed(id, spec, "post");
      }
    }
  }
  // G5: reachability from entry.
  const seen = new Set<NodeId>([def.entry]);
  const queue: NodeId[] = [def.entry];
  while (queue.length > 0) {
    const cur = queue.pop() as NodeId;
    const node = nodes[cur] as StrategyNode;
    const succs: NodeId[] = [
      ...(node.next !== undefined ? [node.next] : []),
      ...(node.routes ?? []).map((r) => r.target),
    ];
    for (const s of succs) {
      if (!seen.has(s)) {
        seen.add(s);
        queue.push(s);
      }
    }
  }
  for (const id of Object.keys(nodes)) {
    if (!seen.has(id)) {
      fail("G5", `${id}: unreachable from entry`);
    }
  }
  // G6: every cycle contains a classify-breaker.
  const color = new Map<NodeId, number>();
  const stack: NodeId[] = [];
  const visit = (id: NodeId): void => {
    color.set(id, 1);
    stack.push(id);
    const node = nodes[id] as StrategyNode;
    const succs: NodeId[] = [
      ...(node.next !== undefined ? [node.next] : []),
      ...(node.routes ?? []).map((r) => r.target),
    ];
    for (const s of succs) {
      const c = color.get(s) ?? 0;
      if (c === 1) {
        const cycle = stack.slice(stack.indexOf(s));
        if (!cycle.some((m) => (nodes[m] as StrategyNode).role === "classify-breaker")) {
          fail("G6", `classify-free cycle: ${cycle.join("→")}`);
        }
      } else if (c === 0) {
        visit(s);
      }
    }
    stack.pop();
    color.set(id, 2);
  };
  visit(def.entry);
}

function checkInvariantWellformed(
  id: NodeId,
  spec: InvariantSpec,
  phase: string,
): void {
  if (spec.kind === "custom") {
    for (const [key, expr] of Object.entries(spec.args)) {
      checkPtListWellformed(id, `${phase}.custom.${key}`, expr);
    }
  }
  if (spec.kind === "exists-k-hole" && spec.where !== undefined) {
    checkRegionWellformed(id, `${phase}.exists-k-hole.where`, spec.where);
  }
  if (spec.kind === "region-empty-of") {
    checkRegionWellformed(id, `${phase}.region-empty-of`, spec.expr);
  }
}

function checkPtListWellformed(
  id: NodeId,
  where: string,
  expr: PtListExpr,
): void {
  switch (expr.kind) {
    case "points":
      for (const leaf of expr.of) {
        checkPtWellformed(id, where, leaf);
      }
      return;
    case "var":
      if (expr.v === "") {
        fail("G8", `${id} ${where}: empty var`);
      }
      return;
    case "last-n":
      if (!Number.isInteger(expr.n) || expr.n < 1) {
        fail("G8", `${id} ${where}: bad last-n ${expr.n}`);
      }
      return;
  }
}

function checkPtWellformed(id: NodeId, where: string, expr: PtExpr): void {
  switch (expr.kind) {
    case "const":
      return;
    case "anchor":
      if (expr.v === "") {
        fail("G8", `${id} ${where}: empty anchor`);
      }
      return;
    case "mid":
      checkPtWellformed(id, where, expr.a);
      checkPtWellformed(id, where, expr.b);
      return;
    case "reflect":
      checkPtWellformed(id, where, expr.src);
      checkPtWellformed(id, where, expr.over[0]);
      checkPtWellformed(id, where, expr.over[1]);
      return;
    case "offset":
      checkPtWellformed(id, where, expr.from);
      return;
  }
}

function checkRegionWellformed(
  id: NodeId,
  where: string,
  expr: RegionExpr,
): void {
  switch (expr.kind) {
    case "all":
    case "window":
      return;
    case "halfplane":
      checkPtWellformed(id, where, expr.thru[0]);
      checkPtWellformed(id, where, expr.thru[1]);
      return;
    case "hull":
      checkPtListWellformed(id, where, expr.of);
      return;
    case "intersect":
      for (const sub of expr.of) {
        checkRegionWellformed(id, where, sub);
      }
      return;
    case "holes":
      if (!Number.isInteger(expr.k) || expr.k < 3) {
        fail("G8", `${id} ${where}: bad holes k ${expr.k}`);
      }
      return;
  }
}

// G10: every var read is bound by some reachable producer. Producers: route
// binds (at rule targets + downstream), placeBind/computed binds (at
// successors + downstream). Fixpoint over the graph (finite vars).
function validateVars(def: StrategyDef): void {
  const nodes = def.nodes;
  const readsPre = new Map<NodeId, Set<VarName>>();
  const readsPost = new Map<NodeId, Set<VarName>>();
  for (const [id, node] of Object.entries(nodes)) {
    const pre = new Set<VarName>();
    const post = new Set<VarName>();
    if (node.move !== undefined) {
      collectMoveReads(node.move, pre);
    }
    if (node.compute !== undefined) {
      const op = node.compute;
      if (op.kind === "select-anchored-shared-edge-pair") {
        pre.add(op.anchorVar);
        pre.add(op.polyVar);
      } else if (op.kind === "select-chord-half-pair") {
        pre.add(op.holeVar);
        pre.add(op.anchorVar);
      } else if (op.kind === "select-twin-holes") {
        for (const v of op.anchorVars) {
          pre.add(v);
        }
      } else if (op.kind === "select-heptagon-pair") {
        pre.add(op.holeVar);
        pre.add(op.anchorVar);
      } else if (op.kind === "select-twin-triangle") {
        for (const v of op.anchorVars) {
          pre.add(v);
        }
      } else if (op.kind === "select-ear-replacement") {
        pre.add(op.twinA);
        pre.add(op.twinB);
        pre.add(op.tri);
        pre.add(op.b1Var);
      } else if (
        op.kind === "select-disjoint-holes" ||
        op.kind === "select-hole-through"
      ) {
        pre.add(op.anchorVar);
      } else {
        pre.add(op.anchorVar);
      }
    }
    if (node.routes !== undefined) {
      for (const rule of node.routes) {
        collectPredicateReads(rule.when, pre);
      }
    }
    if (node.pre !== undefined) {
      for (const spec of node.pre) {
        collectInvariantReads(spec, pre);
      }
    }
    for (const overlay of node.show) {
      collectOverlayReads(overlay, pre);
    }
    if (node.post !== undefined) {
      for (const spec of node.post) {
        collectInvariantReads(spec, post);
      }
    }
    readsPre.set(id, pre);
    readsPost.set(id, post);
  }
  const producesAt = (id: NodeId): Set<VarName> => {
    const node = nodes[id] as StrategyNode;
    const out = new Set<VarName>();
    if (node.placeBind !== undefined) {
      out.add(node.placeBind);
    }
    if (node.compute !== undefined) {
      for (const v of Object.values(node.compute.binds)) {
        out.add(v);
      }
    }
    if (node.routes !== undefined) {
      for (const rule of node.routes) {
        for (const v of Object.keys(rule.bind ?? {})) {
          out.add(v);
        }
      }
    }
    return out;
  };
  // preVars(n): bound on some path entry→n excluding n's own binds.
  // Computed by fixpoint: preVars(n) = ∪ over predecessors p of
  // (preVars(p) ∪ producesAt(p)).
  const preVars = new Map<NodeId, Set<VarName>>();
  for (const id of Object.keys(nodes)) {
    preVars.set(id, new Set());
  }
  // StrategyStart producers (§24.0b): declared startVars are bound before
  // the entry node runs — seed them there; the fixpoint propagates.
  for (const v of def.startVars ?? []) {
    preVars.get(def.entry)?.add(v);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of Object.keys(nodes)) {
      const acc = preVars.get(id) as Set<VarName>;
      const preds = predecessors(def, id);
      for (const p of preds) {
        for (const v of preVars.get(p) as Set<VarName>) {
          if (!acc.has(v)) {
            acc.add(v);
            changed = true;
          }
        }
        for (const v of producesAt(p)) {
          if (!acc.has(v)) {
            acc.add(v);
            changed = true;
          }
        }
      }
    }
  }
  for (const [id] of Object.entries(nodes)) {
    const pre = preVars.get(id) as Set<VarName>;
    const post = new Set(pre);
    for (const v of producesAt(id)) {
      post.add(v);
    }
    for (const v of readsPre.get(id) as Set<VarName>) {
      if (!pre.has(v)) {
        fail("G10", `${id}: var ${v} read with no reachable producer`);
      }
    }
    for (const v of readsPost.get(id) as Set<VarName>) {
      if (!post.has(v)) {
        fail("G10", `${id}: post reads var ${v} with no producer`);
      }
    }
  }
}

function predecessors(def: StrategyDef, id: NodeId): NodeId[] {
  const out: NodeId[] = [];
  for (const [pid, node] of Object.entries(def.nodes)) {
    if (node.next === id) {
      out.push(pid);
    }
    for (const rule of node.routes ?? []) {
      if (rule.target === id) {
        out.push(pid);
      }
    }
  }
  return out;
}

function collectMoveReads(move: MoveSpec, into: Set<VarName>): void {
  switch (move.kind) {
    case "fixed":
      for (const cand of move.at) {
        collectPtReads(cand, into);
      }
      return;
    case "extend":
      if (move.hole.kind === "var") {
        into.add(move.hole.v);
      }
      return;
    case "co-shoulder":
      if (move.outer.kind === "var") {
        into.add(move.outer.v);
      }
      into.add(move.interior);
      return;
    case "escape-beyond-edge":
      if (move.sharedEdge.kind === "var") {
        into.add(move.sharedEdge.v);
      }
      if (move.poly.kind === "var") {
        into.add(move.poly.v);
      }
      for (const q of move.quads ?? []) {
        if (q.kind === "var") {
          into.add(q.v);
        }
      }
      return;
    case "escape-edge-accept":
      if (move.exactAnchor !== undefined) {
        into.add(move.exactAnchor);
      }
      for (const o of move.options) {
        into.add(o.edge.v);
        into.add(o.ring.v);
        for (const g of o.grow) {
          into.add(g.v);
        }
      }
      return;
    case "forcing-pair":
      into.add(move.ring.v);
      for (const v of move.chain) {
        into.add(v);
      }
      return;
    case "double-extend":
      return;
    case "escape-pair-beyond-edge":
      into.add(move.edge.v);
      into.add(move.ring.v);
      into.add(move.anchor);
      for (const h of move.halves) {
        into.add(h.v);
      }
      return;
  }
}

function collectPtReads(expr: PtExpr, into: Set<VarName>): void {
  switch (expr.kind) {
    case "const":
      return;
    case "anchor":
      into.add(expr.v);
      return;
    case "mid":
      collectPtReads(expr.a, into);
      collectPtReads(expr.b, into);
      return;
    case "reflect":
      collectPtReads(expr.src, into);
      collectPtReads(expr.over[0], into);
      collectPtReads(expr.over[1], into);
      return;
    case "offset":
      collectPtReads(expr.from, into);
      return;
  }
}

function collectPredicateReads(pred: RegionPredicate, into: Set<VarName>): void {
  if (pred.kind === "region") {
    collectRegionReads(pred.expr, into);
  } else if (pred.kind === "classifier" && pred.inputs !== undefined) {
    for (const expr of Object.values(pred.inputs)) {
      collectPtListReads(expr, into);
    }
  }
}

function collectPtListReads(expr: PtListExpr, into: Set<VarName>): void {
  switch (expr.kind) {
    case "points":
      for (const leaf of expr.of) {
        collectPtReads(leaf, into);
      }
      return;
    case "var":
      into.add(expr.v);
      return;
    case "last-n":
      return;
  }
}

function collectRegionReads(expr: RegionExpr, into: Set<VarName>): void {
  switch (expr.kind) {
    case "all":
    case "window":
      return;
    case "halfplane":
      collectPtReads(expr.thru[0], into);
      collectPtReads(expr.thru[1], into);
      return;
    case "hull":
      collectPtListReads(expr.of, into);
      return;
    case "intersect":
      for (const sub of expr.of) {
        collectRegionReads(sub, into);
      }
      return;
    case "holes":
      return;
  }
}

function collectInvariantReads(spec: InvariantSpec, into: Set<VarName>): void {
  switch (spec.kind) {
    case "exists-k-hole":
      if (spec.where !== undefined) {
        collectRegionReads(spec.where, into);
      }
      return;
    case "exists-shared-edge-pair":
    case "config-class":
      return;
    case "region-empty-of":
      collectRegionReads(spec.expr, into);
      return;
    case "custom":
      for (const expr of Object.values(spec.args)) {
        collectPtListReads(expr, into);
      }
      return;
  }
}

function collectOverlayReads(overlay: OverlaySpec, into: Set<VarName>): void {
  switch (overlay.kind) {
    case "region":
      collectRegionReads(overlay.expr, into);
      return;
    case "strip":
    case "highlight-hole":
    case "case-map":
      return;
    case "poly-line":
      for (const leaf of overlay.of) {
        collectPtReads(leaf, into);
      }
      return;
  }
}

// G11: tier–k consistency (k=3 ⟺ fixture; k=4 rejected outright — reachable
// only via untyped wire data, hence the numeric comparison).
function validateTierK(def: StrategyDef, tier: StrategyTier): void {
  if (def.k === 3 && tier !== "fixture") {
    fail("G11", `k=3 requires tier fixture`);
  }
  if (def.k !== 3 && tier === "fixture") {
    fail("G11", `tier fixture requires k=3`);
  }
  if ((def.k as number) === 4) {
    fail("G11", `no StrategyDef with k=4 may be registered`);
  }
}

// No-function structural walk: defs are pure data (serializable).
function checkNoFunctions(value: unknown, path: string): void {
  if (typeof value === "function") {
    fail("SER", `${path}: function value in strategy data`);
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      checkNoFunctions(value[i], `${path}[${i}]`);
    }
    return;
  }
  if (value !== null && typeof value === "object") {
    if (value instanceof Rat) {
      return;
    }
    for (const [k, v] of Object.entries(value)) {
      checkNoFunctions(v, `${path}.${k}`);
    }
  }
}

export function registerStrategy(
  def: StrategyDef,
  tier: StrategyTier,
  opts?: { strips?: ReadonlyMap<string, unknown> },
): RegisteredStrategy {
  validateTierK(def, tier);
  validateGraph(def);
  validateVars(def);
  checkNoFunctions(def, "def");
  for (const node of Object.values(def.nodes)) {
    for (const overlay of node.show) {
      if (overlay.kind === "strip") {
        if (opts?.strips === undefined || !opts.strips.has(overlay.strip.stripId)) {
          fail("G8", `${node.id}: strip ${overlay.strip.stripId} unresolved`);
        }
      }
    }
  }
  if (strategyMap.has(def.id)) {
    throw new RegistrationError("dup", `strategy ${def.id} already registered`);
  }
  const rs: RegisteredStrategy = {
    def,
    tier,
    validation: { strategyId: def.id, defVersion: def.version, checks: [] },
  };
  strategyMap.set(def.id, rs);
  return rs;
}

// ---- StrategyDefRuntime/JSON codec ----

function serPt(expr: PtExpr): PtExprJSON {
  switch (expr.kind) {
    case "const":
      return { kind: "const", x: expr.x.toJSON(), y: expr.y.toJSON() };
    case "anchor":
      return { kind: "anchor", v: expr.v };
    case "mid":
      return { kind: "mid", a: serPt(expr.a), b: serPt(expr.b) };
    case "reflect":
      return {
        kind: "reflect",
        src: serPt(expr.src),
        over: [serPt(expr.over[0]), serPt(expr.over[1])],
      };
    case "offset":
      return {
        kind: "offset",
        from: serPt(expr.from),
        by: [expr.by[0].toJSON(), expr.by[1].toJSON()],
      };
  }
}

function dePt(json: PtExprJSON): PtExpr {
  switch (json.kind) {
    case "const":
      return {
        kind: "const",
        x: Rat.fromJSON(json.x),
        y: Rat.fromJSON(json.y),
      };
    case "anchor":
      return { kind: "anchor", v: json.v };
    case "mid":
      return { kind: "mid", a: dePt(json.a), b: dePt(json.b) };
    case "reflect":
      return {
        kind: "reflect",
        src: dePt(json.src),
        over: [dePt(json.over[0]), dePt(json.over[1])],
      };
    case "offset":
      return {
        kind: "offset",
        from: dePt(json.from),
        by: [Rat.fromJSON(json.by[0]), Rat.fromJSON(json.by[1])],
      };
  }
}

function serPtList(expr: PtListExpr): PtListExprJSON {
  switch (expr.kind) {
    case "points":
      return { kind: "points", of: expr.of.map(serPt) };
    case "var":
      return { kind: "var", v: expr.v };
    case "last-n":
      return { kind: "last-n", n: expr.n };
  }
}

function dePtList(json: PtListExprJSON): PtListExpr {
  switch (json.kind) {
    case "points":
      return { kind: "points", of: json.of.map(dePt) };
    case "var":
      return { kind: "var", v: json.v };
    case "last-n":
      return { kind: "last-n", n: json.n };
  }
}

function serRegion(expr: RegionExpr): RegionExprJSON {
  switch (expr.kind) {
    case "all":
      return { kind: "all" };
    case "window":
      return { kind: "window" };
    case "halfplane":
      return {
        kind: "halfplane",
        thru: [serPt(expr.thru[0]), serPt(expr.thru[1])],
        side: expr.side,
      };
    case "hull":
      return { kind: "hull", of: serPtList(expr.of) };
    case "intersect":
      return { kind: "intersect", of: expr.of.map(serRegion) };
    case "holes":
      return { kind: "holes", k: expr.k };
  }
}

function deRegion(json: RegionExprJSON): RegionExpr {
  switch (json.kind) {
    case "all":
      return { kind: "all" };
    case "window":
      return { kind: "window" };
    case "halfplane":
      return {
        kind: "halfplane",
        thru: [dePt(json.thru[0]), dePt(json.thru[1])],
        side: json.side,
      };
    case "hull":
      return { kind: "hull", of: dePtList(json.of) };
    case "intersect":
      return { kind: "intersect", of: json.of.map(deRegion) };
    case "holes":
      return { kind: "holes", k: json.k };
  }
}

// MoveSpec codec entry points (§5.7 single home; replay/ consumes these
// for uncovered-report terminals — never a parallel codec).
export function moveSpecToJSON(move: MoveSpec): MoveSpecJSON {
  return serMove(move);
}

export function moveSpecFromJSON(json: MoveSpecJSON): MoveSpec {
  return deMove(json);
}

function serMove(move: MoveSpec): MoveSpecJSON {
  switch (move.kind) {
    case "fixed":
      return { kind: "fixed", at: move.at.map(serPt) };
    case "extend":
      return {
        kind: "extend",
        hole: move.hole,
        ...(move.prefer !== undefined ? { prefer: move.prefer } : {}),
      };
    case "co-shoulder":
      return { kind: "co-shoulder", outer: move.outer, interior: move.interior };
    case "escape-beyond-edge":
      return {
        kind: "escape-beyond-edge",
        sharedEdge: move.sharedEdge,
        poly: move.poly,
        ...(move.quads !== undefined ? { quads: move.quads } : {}),
      };
    case "escape-pair-beyond-edge":
      return {
        kind: "escape-pair-beyond-edge",
        edge: move.edge,
        ring: move.ring,
        anchor: move.anchor,
        halves: move.halves,
      };
    case "escape-edge-accept":
      return {
        kind: "escape-edge-accept",
        options: move.options,
        ...(move.exactAnchor !== undefined ? { exactAnchor: move.exactAnchor } : {}),
      };
    case "forcing-pair":
      return { kind: "forcing-pair", ring: move.ring, chain: move.chain };
    case "double-extend":
      return { kind: "double-extend", holeSize: move.holeSize };
  }
}

function deMove(json: MoveSpecJSON): MoveSpec {
  switch (json.kind) {
    case "fixed":
      return { kind: "fixed", at: json.at.map(dePt) };
    case "extend":
      return json.prefer === undefined
        ? { kind: "extend", hole: json.hole }
        : { kind: "extend", hole: json.hole, prefer: json.prefer };
    case "co-shoulder":
      return { kind: "co-shoulder", outer: json.outer, interior: json.interior };
    case "escape-beyond-edge":
      return {
        kind: "escape-beyond-edge",
        sharedEdge: json.sharedEdge,
        poly: json.poly,
        ...(json.quads !== undefined ? { quads: json.quads } : {}),
      };
    case "escape-pair-beyond-edge":
      return {
        kind: "escape-pair-beyond-edge",
        edge: json.edge,
        ring: json.ring,
        anchor: json.anchor,
        halves: json.halves,
      };
    case "escape-edge-accept":
      return {
        kind: "escape-edge-accept",
        options: json.options,
        ...(json.exactAnchor !== undefined ? { exactAnchor: json.exactAnchor } : {}),
      };
    case "forcing-pair":
      return { kind: "forcing-pair", ring: json.ring, chain: json.chain };
    case "double-extend":
      return { kind: "double-extend", holeSize: json.holeSize };
  }
}

function serInvariant(
  spec: InvariantSpec,
): InvariantSpecJSON {
  switch (spec.kind) {
    case "exists-k-hole":
      return spec.where === undefined
        ? { kind: "exists-k-hole", k: spec.k }
        : { kind: "exists-k-hole", k: spec.k, where: serRegion(spec.where) };
    case "exists-shared-edge-pair":
      return { kind: "exists-shared-edge-pair", k: spec.k };
    case "region-empty-of":
      return {
        kind: "region-empty-of",
        expr: serRegion(spec.expr),
        owner: spec.owner,
      };
    case "config-class":
      return { kind: "config-class", cls: spec.cls };
    case "custom":
      return {
        kind: "custom",
        checkerId: spec.checkerId,
        args: Object.fromEntries(
          Object.entries(spec.args).map(([k, v]) => [k, serPtList(v)]),
        ),
        describe: spec.describe,
      };
  }
}

function deInvariant(json: InvariantSpecJSON): InvariantSpec {
  switch (json.kind) {
    case "exists-k-hole":
      return json.where === undefined
        ? { kind: "exists-k-hole", k: json.k }
        : { kind: "exists-k-hole", k: json.k, where: deRegion(json.where) };
    case "exists-shared-edge-pair":
      return { kind: "exists-shared-edge-pair", k: json.k };
    case "region-empty-of":
      return {
        kind: "region-empty-of",
        expr: deRegion(json.expr),
        owner: json.owner,
      };
    case "config-class":
      return { kind: "config-class", cls: json.cls };
    case "custom":
      return {
        kind: "custom",
        checkerId: json.checkerId,
        args: Object.fromEntries(
          Object.entries(json.args).map(([k, v]) => [k, dePtList(v)]),
        ),
        describe: json.describe,
      };
  }
}

function serPredicate(pred: RegionPredicate): RegionPredicateJSON {
  switch (pred.kind) {
    case "region":
      return { kind: "region", expr: serRegion(pred.expr) };
    case "classifier":
      return pred.inputs === undefined
        ? {
            kind: "classifier",
            classifierId: pred.classifierId,
            on: pred.on,
          }
        : {
            kind: "classifier",
            classifierId: pred.classifierId,
            inputs: Object.fromEntries(
              Object.entries(pred.inputs).map(([k, v]) => [k, serPtList(v)]),
            ),
            on: pred.on,
          };
    case "all":
      return { kind: "all" };
  }
}

function dePredicate(json: RegionPredicateJSON): RegionPredicate {
  switch (json.kind) {
    case "region":
      return { kind: "region", expr: deRegion(json.expr) };
    case "classifier":
      return json.inputs === undefined
        ? {
            kind: "classifier",
            classifierId: json.classifierId,
            on: json.on,
          }
        : {
            kind: "classifier",
            classifierId: json.classifierId,
            inputs: Object.fromEntries(
              Object.entries(json.inputs).map(([k, v]) => [k, dePtList(v)]),
            ),
            on: json.on,
          };
    case "all":
      return { kind: "all" };
  }
}

function serOverlay(spec: OverlaySpec): OverlaySpecJSON {
  switch (spec.kind) {
    case "region":
      return {
        kind: "region",
        expr: serRegion(spec.expr),
        style: spec.style,
        label: spec.label,
      };
    case "strip":
      return { kind: "strip", strip: spec.strip };
    case "poly-line":
      return {
        kind: "poly-line",
        of: spec.of.map(serPt),
        style: spec.style,
      };
    case "highlight-hole":
      return { kind: "highlight-hole", pattern: spec.pattern };
    case "case-map":
      return { kind: "case-map" };
  }
}

function deOverlay(json: OverlaySpecJSON): OverlaySpec {
  switch (json.kind) {
    case "region":
      return {
        kind: "region",
        expr: deRegion(json.expr),
        style: json.style,
        label: json.label,
      };
    case "strip":
      return { kind: "strip", strip: json.strip };
    case "poly-line":
      return {
        kind: "poly-line",
        of: json.of.map(dePt),
        style: json.style,
      };
    case "highlight-hole":
      return { kind: "highlight-hole", pattern: json.pattern };
    case "case-map":
      return { kind: "case-map" };
  }
}

function serNode(node: StrategyNode): StrategyNodeJSON {
  const out: StrategyNodeJSON = {
    id: node.id,
    role: node.role,
    show: node.show.map(serOverlay),
    why: node.why,
    sourceRef: node.sourceRef,
  };
  if (node.next !== undefined) {
    out.next = node.next;
  }
  if (node.move !== undefined) {
    out.move = serMove(node.move);
  }
  if (node.placeBind !== undefined) {
    out.placeBind = node.placeBind;
  }
  if (node.compute !== undefined) {
    out.compute = node.compute;
  }
  if (node.routes !== undefined) {
    out.routes = node.routes.map((r) => ({
      case: r.case,
      when: serPredicate(r.when),
      target: r.target,
      ...(r.bind !== undefined ? { bind: r.bind } : {}),
      ...(r.note !== undefined ? { note: r.note } : {}),
      ...(r.interaction !== undefined ? { interaction: r.interaction } : {}),
    }));
  }
  if (node.pre !== undefined) {
    out.pre = node.pre.map(serInvariant);
  }
  if (node.post !== undefined) {
    out.post = node.post.map(serInvariant);
  }
  return out;
}

function deNode(json: StrategyNodeJSON): StrategyNode {
  const out: StrategyNode = {
    id: json.id,
    role: json.role,
    show: json.show.map(deOverlay),
    why: json.why,
    sourceRef: json.sourceRef,
  };
  if (json.next !== undefined) {
    out.next = json.next;
  }
  if (json.move !== undefined) {
    out.move = deMove(json.move);
  }
  if (json.placeBind !== undefined) {
    out.placeBind = json.placeBind;
  }
  if (json.compute !== undefined) {
    out.compute = json.compute;
  }
  if (json.routes !== undefined) {
    out.routes = json.routes.map((r) => ({
      case: r.case,
      when: dePredicate(r.when),
      target: r.target,
      ...(r.bind !== undefined ? { bind: r.bind } : {}),
      ...(r.note !== undefined ? { note: r.note } : {}),
      ...(r.interaction !== undefined ? { interaction: r.interaction } : {}),
    }));
  }
  if (json.pre !== undefined) {
    out.pre = json.pre.map(deInvariant);
  }
  if (json.post !== undefined) {
    out.post = json.post.map(deInvariant);
  }
  return out;
}

export function serializeStrategyDef(def: StrategyDef): StrategyDefJSON {
  return {
    id: def.id,
    k: def.k,
    version: def.version,
    source: def.source,
    entry: def.entry,
    nodes: Object.fromEntries(
      Object.entries(def.nodes).map(([id, node]) => [id, serNode(node)]),
    ),
    ...(def.domain !== undefined ? { domain: def.domain } : {}),
    ...(def.startVars !== undefined ? { startVars: [...def.startVars] } : {}),
    ...(def.gameModes !== undefined ? { gameModes: [...def.gameModes] } : {}),
  };
}

export function hydrateStrategyDef(json: StrategyDefJSON): StrategyDef {
  const def: StrategyDef = {
    id: json.id,
    k: json.k,
    version: json.version,
    source: json.source,
    entry: json.entry,
    nodes: Object.fromEntries(
      Object.entries(json.nodes).map(([id, node]) => [id, deNode(node)]),
    ),
    ...(json.domain !== undefined ? { domain: json.domain } : {}),
    ...(json.startVars !== undefined ? { startVars: [...json.startVars] } : {}),
    ...(json.gameModes !== undefined ? { gameModes: [...json.gameModes] } : {}),
  };
  // Structural validation (graph + vars + data); tier assignment (G11) is
  // the registration call's business — tier is not serialized.
  validateGraph(def);
  validateVars(def);
  checkNoFunctions(def, "def");
  return def;
}
