// verification/partition.ts — the §22.6 effective-partition check + the
// §23.2 four-point totality check (k5:r2:classify's partition evidence).
// Pure: exact rational arithmetic only; no DOM, no I/O, no engine/session
// imports (§18.1: verification/ sees geometry/ + game/ + strategy/ only).
//
// The arrangement procedure (checkNodePartition): for a classify node +
// parked state, collect boundary lines (route-region supporting lines on
// the correctness channel ∪ classifier boundaries()), stratify the closed
// window per §10.4 (open 2D cells; open 1D segments; 0D points), and
// classify every piece's canonical representative twice — once by the
// check's own direct first-match evaluation, once by strategy/runtime's
// classify() — requiring agreement. A boundaries() integrity result FAILS
// the check with the typed report (never a pass on partial data, §22.6).
//
// Hypo-placement here is manual GameState construction (never placePoint:
// boundary-stratum representatives are GP-illegal by design — §10.4 case
// i — and placePoint dev-asserts GP). The hypo states are check
// scaffolding only, never committed.
import { Rat } from "../geometry/rat.ts";
import { eqPt, pt } from "../geometry/pt.ts";
import type { Pt } from "../geometry/pt.ts";
import { convexPosition } from "../geometry/hull.ts";
import { arrangementCells } from "../geometry/arrangement.ts";
import type { ArrLine } from "../geometry/arrangement.ts";
import {
  canonicalInteriorPoint,
  regionContains,
} from "../geometry/poly.ts";
import type { ConvexPoly, RegionValue } from "../geometry/poly.ts";
import { evalPtListIds, evalRegion } from "../strategy/eval.ts";
import { classify, nodeOf } from "../strategy/runtime.ts";
import { getClassifier } from "../strategy/registry.ts";
import type { ValidationCheck } from "../strategy/registry.ts";
import type {
  ClassifierFailure,
  StrategyDef,
} from "../strategy/types.ts";
import type {
  CaseId,
  Configuration,
  GameState,
  NodeId,
  PointId,
} from "../game/types.ts";

// ---- boundary-line collection (§22.6 step 1) ----

export type LinesResult =
  | { ok: true; lines: ArrLine[] }
  | {
      ok: false;
      reason: "undecidable-predicate" | "resolution-failure" | "boundaries-integrity";
      detail: string;
      failure?: ClassifierFailure;
    };

// Supporting lines of every poly part of a complete region (the change
// loci). Mirrors the analysis-layer helper structurally; reimplemented
// here so the check never depends on rendering-layer code.
function supportingLines(region: RegionValue): ArrLine[] {
  const polys =
    region.kind === "poly"
      ? [region]
      : region.parts.filter((p) => p.kind === "poly");
  const lines: ArrLine[] = [];
  for (const poly of polys) {
    if (poly.kind !== "poly") {
      continue;
    }
    for (let i = 0; i < poly.verts.length; i += 1) {
      lines.push({
        a: poly.verts[i] as Pt,
        b: poly.verts[(i + 1) % poly.verts.length] as Pt,
      });
    }
  }
  return lines;
}

export function collectBoundaryLines(
  def: StrategyDef,
  nodeId: NodeId,
  state: GameState,
  config: Configuration,
): LinesResult {
  const node = nodeOf(def, nodeId);
  if (node.role !== "classify-breaker" || node.routes === undefined) {
    return {
      ok: false,
      reason: "resolution-failure",
      detail: `${nodeId} is not a classify-breaker node with routes`,
    };
  }
  const lines: ArrLine[] = [];
  for (const rule of node.routes) {
    const when = rule.when;
    if (when.kind === "all") {
      continue;
    }
    if (when.kind === "region") {
      const r = evalRegion(when.expr, { state, config, channel: "correctness" });
      if (r.kind === "incomplete") {
        return {
          ok: false,
          reason: "undecidable-predicate",
          detail: `route ${rule.case}: region evaluates incomplete on the correctness channel`,
          failure: {
            reason: "undecidable-computation",
            detail: `route ${rule.case}: region evaluates incomplete on the correctness channel`,
            analysis: r.analysis,
          },
        };
      }
      lines.push(...supportingLines(r.region));
      continue;
    }
    const classifier = getClassifier(when.classifierId);
    if (classifier === undefined) {
      return {
        ok: false,
        reason: "resolution-failure",
        detail: `unregistered classifier ${when.classifierId}`,
      };
    }
    const resolved: Record<string, readonly PointId[]> = {};
    if (when.inputs !== undefined) {
      for (const [name, expr] of Object.entries(when.inputs)) {
        const ids = evalPtListIds(expr, state);
        if (ids.kind === "resolution-failure") {
          return {
            ok: false,
            reason: "resolution-failure",
            detail: `route ${rule.case}: input ${name}: ${ids.reason} (${ids.detail})`,
          };
        }
        resolved[name] = ids.ids;
      }
    }
    const b = classifier.boundaries(state, resolved, config);
    if (b.kind === "integrity") {
      // §22.6 v1.2.6: the node-independent ClassifierFailure is kept
      // verbatim; the node identity travels beside it (an explicit input
      // of the check, never inferred by boundaries()).
      return {
        ok: false,
        reason: "boundaries-integrity",
        detail: `route ${rule.case}: boundaries() integrity (${b.failure.reason}: ${b.failure.detail})`,
        failure: { ...b.failure },
      };
    }
    for (const [aId, bId] of b.lines) {
      const a = lookupId(state, aId);
      const c = lookupId(state, bId);
      if (a === null || c === null) {
        return {
          ok: false,
          reason: "resolution-failure",
          detail: `route ${rule.case}: boundary line names unplaced points ${aId},${bId}`,
        };
      }
      lines.push({ a, b: c });
    }
  }
  return { ok: true, lines };
}

function lookupId(state: GameState, id: PointId): Pt | null {
  for (const p of state.points) {
    if (p.id === id) {
      return p.pt;
    }
  }
  return null;
}

// ---- §10.4 stratification (cells; 1D segments; 0D points) ----

export interface Stratified {
  cells: ConvexPoly[];
  segments: Array<{ a: Pt; b: Pt; mid: Pt }>;
  points: Pt[];
}

function lineIntersection(a1: Pt, b1: Pt, a2: Pt, b2: Pt): Pt | null {
  const d1x = b1.x.sub(a1.x);
  const d1y = b1.y.sub(a1.y);
  const d2x = b2.x.sub(a2.x);
  const d2y = b2.y.sub(a2.y);
  const denom = d1x.mul(d2y).sub(d1y.mul(d2x));
  if (denom.isZero()) {
    return null;
  }
  const ex = a2.x.sub(a1.x);
  const ey = a2.y.sub(a1.y);
  const t = ex.mul(d2y).sub(ey.mul(d2x)).div(denom);
  return pt(a1.x.add(d1x.mul(t)), a1.y.add(d1y.mul(t)));
}

function inClosedWindow(p: Pt, w: Configuration["window"]): boolean {
  return (
    p.x.cmp(w.xMin) >= 0 &&
    p.x.cmp(w.xMax) <= 0 &&
    p.y.cmp(w.yMin) >= 0 &&
    p.y.cmp(w.yMax) <= 0
  );
}

function windowCorners(w: Configuration["window"]): Pt[] {
  return [
    pt(w.xMin, w.yMin),
    pt(w.xMax, w.yMin),
    pt(w.xMax, w.yMax),
    pt(w.xMin, w.yMax),
  ];
}

// Exact scalar projection (no division, no floats): monotone along d.
function proj(p: Pt, o: Pt, dx: Rat, dy: Rat): Rat {
  return p.x.sub(o.x).mul(dx).add(p.y.sub(o.y).mul(dy));
}

function dedupePts(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    if (!out.some((q) => eqPt(p, q))) {
      out.push(p);
    }
  }
  return out;
}

// Open segments of one carrier line between consecutive 0D points.
function segmentsOnLine(
  a: Pt,
  b: Pt,
  cuts: Pt[],
): Array<{ a: Pt; b: Pt; mid: Pt }> {
  const dx = b.x.sub(a.x);
  const dy = b.y.sub(a.y);
  const sorted = dedupePts(cuts).sort((p, q) =>
    proj(p, a, dx, dy).cmp(proj(q, a, dx, dy)),
  );
  const segs: Array<{ a: Pt; b: Pt; mid: Pt }> = [];
  for (let i = 0; i + 1 < sorted.length; i += 1) {
    const u = sorted[i] as Pt;
    const v = sorted[i + 1] as Pt;
    if (eqPt(u, v)) {
      continue;
    }
    segs.push({
      a: u,
      b: v,
      mid: pt(u.x.add(v.x).div(Rat.make(2n)), u.y.add(v.y).div(Rat.make(2n))),
    });
  }
  return segs;
}

export function stratify(
  lines: readonly ArrLine[],
  window: Configuration["window"],
): Stratified {
  const corners = windowCorners(window);
  const edges: Array<[Pt, Pt]> = [
    [corners[0] as Pt, corners[1] as Pt],
    [corners[1] as Pt, corners[2] as Pt],
    [corners[2] as Pt, corners[3] as Pt],
    [corners[3] as Pt, corners[0] as Pt],
  ];
  const cells = arrangementCells(lines, [...corners]);
  // 0D: pairwise intersections in-window + line∩edge points + corners.
  const zero: Pt[] = [...corners];
  const perLine: Pt[][] = lines.map(() => []);
  for (let i = 0; i < lines.length; i += 1) {
    const li = lines[i] as ArrLine;
    for (let j = i + 1; j < lines.length; j += 1) {
      const lj = lines[j] as ArrLine;
      const p = lineIntersection(li.a, li.b, lj.a, lj.b);
      if (p !== null && inClosedWindow(p, window)) {
        zero.push(p);
        (perLine[i] as Pt[]).push(p);
        (perLine[j] as Pt[]).push(p);
      }
    }
    for (const [e0, e1] of edges) {
      const p = lineIntersection(li.a, li.b, e0, e1);
      if (
        p !== null &&
        inClosedWindow(p, window) &&
        onSegment(p, e0, e1)
      ) {
        zero.push(p);
        (perLine[i] as Pt[]).push(p);
      }
    }
  }
  const points = dedupePts(zero);
  // 1D: arrangement-line pieces + window-edge pieces.
  const segments: Array<{ a: Pt; b: Pt; mid: Pt }> = [];
  for (let i = 0; i < lines.length; i += 1) {
    const li = lines[i] as ArrLine;
    segments.push(...segmentsOnLine(li.a, li.b, perLine[i] as Pt[]));
  }
  for (const [e0, e1] of edges) {
    const cuts: Pt[] = [e0, e1];
    for (const p of points) {
      if (onSegment(p, e0, e1)) {
        cuts.push(p);
      }
    }
    segments.push(...segmentsOnLine(e0, e1, cuts));
  }
  return { cells, segments, points };
}

function onSegment(p: Pt, a: Pt, b: Pt): boolean {
  // Collinearity via signed area + bounding box (exact, non-strict).
  const s = p.x.sub(a.x).mul(b.y.sub(a.y)).sub(p.y.sub(a.y).mul(b.x.sub(a.x)));
  if (!s.isZero()) {
    return false;
  }
  const xLo = a.x.cmp(b.x) <= 0 ? a.x : b.x;
  const xHi = a.x.cmp(b.x) >= 0 ? a.x : b.x;
  const yLo = a.y.cmp(b.y) <= 0 ? a.y : b.y;
  const yHi = a.y.cmp(b.y) >= 0 ? a.y : b.y;
  return (
    p.x.cmp(xLo) >= 0 &&
    p.x.cmp(xHi) <= 0 &&
    p.y.cmp(yLo) >= 0 &&
    p.y.cmp(yHi) <= 0
  );
}

// ---- hypo-placement (manual construction; see header) ----

export function hypoPlace(state: GameState, rep: Pt): {
  hypo: GameState;
  pointId: PointId;
} {
  const n = state.points.length;
  const pointId = `p${n + 1}`;
  const hypo: GameState = {
    ...state,
    points: [
      ...state.points,
      { id: pointId, owner: "breaker", pt: rep, move: n + 1 },
    ],
    turn: (n + 1) % 2 === 0 ? "maker" : "breaker",
  };
  return { hypo, pointId };
}

// ---- direct first-match evaluation (the check's own routing read) ----

export type DirectResult =
  | { ok: true; caseId: CaseId }
  | {
      ok: false;
      reason: "undecidable-predicate" | "resolution-failure";
      detail: string;
      failure?: ClassifierFailure;
    };

export function directCase(
  def: StrategyDef,
  nodeId: NodeId,
  hypo: GameState,
  pointId: PointId,
  config: Configuration,
): DirectResult {
  const node = nodeOf(def, nodeId);
  if (node.role !== "classify-breaker" || node.routes === undefined) {
    return {
      ok: false,
      reason: "resolution-failure",
      detail: `${nodeId} is not a classify-breaker node`,
    };
  }
  const point = lookupId(hypo, pointId);
  if (point === null) {
    return {
      ok: false,
      reason: "resolution-failure",
      detail: `point ${pointId} names no placed point`,
    };
  }
  for (const rule of node.routes) {
    const when = rule.when;
    if (when.kind === "all") {
      return { ok: true, caseId: rule.case };
    }
    if (when.kind === "region") {
      const r = evalRegion(when.expr, {
        state: hypo,
        config,
        channel: "correctness",
      });
      if (r.kind === "incomplete") {
        return {
          ok: false,
          reason: "undecidable-predicate",
          detail: `route ${rule.case}: region evaluates incomplete`,
          failure: {
            reason: "undecidable-computation",
            detail: `route ${rule.case}: region evaluates incomplete`,
            analysis: r.analysis,
          },
        };
      }
      if (regionContains(r.region, point, false)) {
        return { ok: true, caseId: rule.case };
      }
      continue;
    }
    const classifier = getClassifier(when.classifierId);
    if (classifier === undefined) {
      return {
        ok: false,
        reason: "resolution-failure",
        detail: `unregistered classifier ${when.classifierId}`,
      };
    }
    const resolved: Record<string, readonly PointId[]> = {};
    if (when.inputs !== undefined) {
      for (const [name, expr] of Object.entries(when.inputs)) {
        const ids = evalPtListIds(expr, hypo);
        if (ids.kind === "resolution-failure") {
          return {
            ok: false,
            reason: "resolution-failure",
            detail: `input ${name}: ${ids.reason} (${ids.detail})`,
          };
        }
        resolved[name] = ids.ids;
      }
    }
    const execution = classifier.classify(hypo, resolved, config);
    if (execution.kind === "integrity") {
      return {
        ok: false,
        reason: "undecidable-predicate",
        detail: `classifier ${when.classifierId}: ${execution.failure.detail}`,
        failure: { ...execution.failure },
      };
    }
    if (!classifier.resultTags.includes(execution.result.tag)) {
      return {
        ok: false,
        reason: "resolution-failure",
        detail: `undeclared tag ${execution.result.tag}`,
      };
    }
    if (execution.result.tag === when.on.tag) {
      return { ok: true, caseId: rule.case };
    }
  }
  return {
    ok: false,
    reason: "resolution-failure",
    detail: `no route matched at ${nodeId} — def defect (G7)`,
  };
}

// ---- the check (§22.6 steps 2–4) ----

export interface PartitionReport {
  checkId: string;
  nodeId: NodeId;
  scope: string;
  result: ValidationCheck["result"];
  cells: number;
  segments: number;
  points: number;
  cases: readonly CaseId[];
  detail?: string;
  witness?: { fixture: string };
}

function toCheck(r: PartitionReport): ValidationCheck {
  return {
    id: r.checkId,
    scope: r.scope,
    result: r.result,
    ...(r.witness !== undefined ? { witness: r.witness } : {}),
  };
}

export function checkToValidation(r: PartitionReport): ValidationCheck {
  return toCheck(r);
}

export function totalityToValidation(r: TotalityReport): ValidationCheck {
  return {
    id: r.checkId,
    scope: r.scope,
    result: r.result,
    ...(r.witness !== undefined ? { witness: r.witness } : {}),
  };
}

function fixtureOf(
  nodeId: NodeId,
  kind: string,
  index: number,
  rep: Pt,
  extra: string,
): string {
  return JSON.stringify({
    node: nodeId,
    piece: `${kind}[${index}]`,
    rep: { x: rep.x.toString(), y: rep.y.toString() },
    info: extra,
  });
}

// Canonical case order: the def's route declaration order (matches the
// analysis layer's group order, §11.4).
function orderCases(
  def: StrategyDef,
  nodeId: NodeId,
  seen: Set<CaseId>,
): CaseId[] {
  const order = new Map(
    nodeOf(def, nodeId).routes?.map((r, i) => [r.case, i] as const) ?? [],
  );
  return [...seen].sort(
    (a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999),
  );
}

export function checkNodePartition(
  def: StrategyDef,
  nodeId: NodeId,
  state: GameState,
  config: Configuration,
  scope: string,
): PartitionReport {
  const checkId = `route-partition:${nodeId}`;
  const collected = collectBoundaryLines(def, nodeId, state, config);
  if (!collected.ok) {
    const result =
      collected.reason === "boundaries-integrity" &&
      collected.failure?.reason === "undecidable-computation"
        ? "BUDGET_EXCEEDED"
        : collected.reason === "boundaries-integrity"
          ? "IMPLEMENTATION_ERROR"
          : collected.reason === "undecidable-predicate"
            ? "BUDGET_EXCEEDED"
            : "IMPLEMENTATION_ERROR";
    return {
      checkId,
      nodeId,
      scope,
      result,
      cells: 0,
      segments: 0,
      points: 0,
      cases: [],
      detail: collected.detail,
      ...(collected.failure !== undefined
        ? {
            witness: {
              fixture: fixtureOf(nodeId, "lines", -1, state.points[0]?.pt ?? pt(Rat.make(0n), Rat.make(0n)), collected.detail),
            },
          }
        : {}),
    };
  }
  const { cells, segments, points } = stratify(collected.lines, config.window);
  const seen = new Set<CaseId>();
  const reps: Array<{ kind: string; index: number; rep: Pt }> = [];
  cells.forEach((cell, i) => {
    const rep = canonicalInteriorPoint(cell);
    if (rep !== null) {
      reps.push({ kind: "cell", index: i, rep });
    }
  });
  if (reps.length !== cells.length) {
    return {
      checkId,
      nodeId,
      scope,
      result: "IMPLEMENTATION_ERROR",
      cells: cells.length,
      segments: segments.length,
      points: points.length,
      cases: [],
      detail: `${cells.length - reps.length} cell(s) admit no interior representative — arrangement defect`,
    };
  }
  segments.forEach((s, i) => {
    reps.push({ kind: "segment", index: i, rep: s.mid });
  });
  points.forEach((p, i) => {
    reps.push({ kind: "point", index: i, rep: p });
  });
  for (const { kind, index, rep } of reps) {
    const { hypo, pointId } = hypoPlace(state, rep);
    const direct = directCase(def, nodeId, hypo, pointId, config);
    if (!direct.ok) {
      const result =
        direct.reason === "undecidable-predicate"
          ? "BUDGET_EXCEEDED"
          : "IMPLEMENTATION_ERROR";
      return {
        checkId,
        nodeId,
        scope,
        result,
        cells: cells.length,
        segments: segments.length,
        points: points.length,
        cases: [...seen],
        detail: `${kind}[${index}]: ${direct.detail}`,
        witness: {
          fixture: fixtureOf(nodeId, kind, index, rep, direct.detail),
        },
      };
    }
    const live = classify(def, hypo, nodeId, pointId, config);
    if (!live.ok) {
      return {
        checkId,
        nodeId,
        scope,
        result: "IMPLEMENTATION_ERROR",
        cells: cells.length,
        segments: segments.length,
        points: points.length,
        cases: [...seen],
        detail: `${kind}[${index}]: classify() integrity where direct evaluation decided ${direct.caseId}`,
        witness: {
          fixture: fixtureOf(nodeId, kind, index, rep, `direct=${direct.caseId}`),
        },
      };
    }
    if (live.case !== direct.caseId) {
      return {
        checkId,
        nodeId,
        scope,
        result: "COUNTEREXAMPLE",
        cells: cells.length,
        segments: segments.length,
        points: points.length,
        cases: [...seen],
        detail: `${kind}[${index}]: direct=${direct.caseId} vs classify()=${live.case}`,
        witness: {
          fixture: fixtureOf(
            nodeId,
            kind,
            index,
            rep,
            `direct=${direct.caseId} live=${live.case}`,
          ),
        },
      };
    }
    seen.add(direct.caseId);
  }
  return {
    checkId,
    nodeId,
    scope,
    result: "PASS",
    cells: cells.length,
    segments: segments.length,
    points: points.length,
    cases: orderCases(def, nodeId, seen),
  };
}

// ---- k5:r2:classify totality (§23.2 theorem form) ----

export interface FourConfig {
  pts: readonly [Pt, Pt, Pt, Pt];
  note: string;
}

export interface TotalityReport {
  checkId: string;
  scope: string;
  result: ValidationCheck["result"];
  configs: number;
  detail?: string;
  witness?: { fixture: string };
}

// The four-point theorem as a check: over GP 4-point configurations the
// hull size is 3 or 4; classifyFour must decide accordingly (never
// integrity, never an undeclared tag), with exact bindings, and
// boundaries() must return the 6 pair-lines. Correlated with the fixture
// battery (inside-triangle, each swallow wedge, convex) plus seeded
// random GP quads.
export function checkClassifyFourTotality(
  configs: readonly FourConfig[],
  scope: string,
): TotalityReport {
  const checkId = "route-partition:k5:r2:classify";
  const classifier = getClassifier("classifyFour");
  if (classifier === undefined) {
    return {
      checkId,
      scope,
      result: "IMPLEMENTATION_ERROR",
      configs: configs.length,
      detail: "classifyFour is not registered",
    };
  }
  for (let i = 0; i < configs.length; i += 1) {
    const cfg = configs[i] as FourConfig;
    const ids = ["t1", "t2", "t3", "t4"] as const;
    const state = totalityState(cfg.pts);
    const execution = classifier.classify(
      state,
      { pts: [...ids] },
      // Classification is hull arithmetic and ignores config; any
      // well-formed Configuration will do. The budget below is well
      // above every accounted cost on this path by construction.
      minimalConfig(),
    );
    if (execution.kind === "integrity") {
      return {
        checkId,
        scope,
        result: "COUNTEREXAMPLE",
        configs: configs.length,
        detail: `config[${i}] (${cfg.note}): integrity where the theorem decides — ${execution.failure.detail}`,
        witness: {
          fixture: JSON.stringify({
            config: i,
            note: cfg.note,
            pts: cfg.pts.map((p) => ({ x: p.x.toString(), y: p.y.toString() })),
          }),
        },
      };
    }
    const convex = convexPosition([...cfg.pts]);
    const want = convex ? "convex" : "one-interior";
    if (execution.result.tag !== want) {
      return {
        checkId,
        scope,
        result: "COUNTEREXAMPLE",
        configs: configs.length,
        detail: `config[${i}] (${cfg.note}): tag ${execution.result.tag} vs independent ${want}`,
        witness: {
          fixture: JSON.stringify({ config: i, note: cfg.note }),
        },
      };
    }
    const b = classifier.boundaries(state, { pts: [...ids] }, minimalConfig());
    if (b.kind === "integrity" || b.lines.length !== 6) {
      return {
        checkId,
        scope,
        result: "IMPLEMENTATION_ERROR",
        configs: configs.length,
        detail: `config[${i}] (${cfg.note}): boundaries() not the 6 pair-lines`,
      };
    }
  }
  return { checkId, scope, result: "PASS", configs: configs.length };
}

function totalityState(pts: readonly [Pt, Pt, Pt, Pt]): GameState {
  return {
    seq: 0,
    k: 5,
    mode: "break",
    points: pts.map((p, i) => ({
      id: `t${i + 1}`,
      owner: i % 2 === 0 ? "maker" : "breaker",
      pt: p,
      move: i + 1,
    })),
    turn: "maker",
    terminal: null,
    strategy: null,
  };
}

// A well-formed Configuration for budget-independent hull arithmetic.
// classifyFour/boundaries ignore analysis budgets and windows; the values
// below are inert on this path (kept well-formed, never relied upon).
function minimalConfig(): Configuration {
  const z = Rat.make(0n);
  const one = Rat.make(1n);
  return {
    window: { xMin: z, yMin: z, xMax: one, yMax: one },
    ui: { minSeparationPx: 6, theme: "light", autoplayMs: 900 },
    engine: { maxPoints: 64 },
    analysis: { budgetOps: 20000000 },
  };
}
