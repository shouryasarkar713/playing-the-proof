// strategy/eval.ts — expression evaluators: PtExpr, PtListExpr (the shared
// id-list projection), RegionExpr → RegionEvalResult (with the §8.3 cache),
// and MoveSpec → point. Pure; explicit config; no hidden context.
import { Rat } from "../geometry/rat.ts";
import { pt } from "../geometry/pt.ts";
import type { Pt } from "../geometry/pt.ts";
import { clipConvexByHalfPlane, canonicalizeRegion } from "../geometry/poly.ts";
import type { RegionValue } from "../geometry/poly.ts";
import { hull } from "../geometry/hull.ts";
import { twinSharedTriangle } from "../geometry/twins.ts";
import { ccwIds, twinQuadEars, twinSharedPart } from "../geometry/twinsK7.ts";
import { interiorsDisjoint, twinTriangleEars } from "../geometry/twinsK8.ts";
import { arrangementCells } from "../geometry/arrangement.ts";
import { canonicalInteriorPoint } from "../geometry/poly.ts";
import {
  estimateHoleWork,
  findKHoles,
  findNewKHoles,
  isKHole,
} from "../geometry/holes.ts";
import type { HoleAnalysis, IdPt, KHole } from "../geometry/holes.ts";
import {
  coShoulder,
  escapeNearEdge,
  escapeScan,
  extendHole,
} from "../geometry/extend.ts";
import type { Window } from "../geometry/extend.ts";
import { checkPlacement } from "../game/legality.ts";
import { analyzeWinHoles, findWinHoles } from "../game/gamemode.ts";
import type {
  Binding,
  Configuration,
  GameState,
  PointId,
} from "../game/types.ts";
import type {
  MoveSpec,
  PtExpr,
  PtListExpr,
  PtListIdsResult,
  RegionExpr,
} from "./types.ts";

export interface EvalCtx {
  state: GameState;
  config: Configuration;
  channel: "correctness" | "analysis";
}

// BudgetExhaustedError — the typed budget-failure channel for MoveSpec
// evaluation (§6.3: a non-exhaustive enumeration is an integrity-class
// failure CARRYING the HoleAnalysis). evalMoveSpec's `null` cannot carry it
//, so — exactly like CheckerIntegrityError (§10.6) — it travels as a
// typed exception caught at ONE boundary: the reducer's evalMoveSpec call
// site (and init's entry chain), converted there into the integrity
// terminal WITH the analysis payload. Never crosses any other boundary.
export class BudgetExhaustedError extends Error {
  readonly k: number;
  readonly analysis: HoleAnalysis;
  constructor(k: number, analysis: HoleAnalysis) {
    super(`extend enumeration budget-exhausted (k=${k})`);
    this.name = "BudgetExhaustedError";
    this.k = k;
    this.analysis = analysis;
  }
}

// ConstructionIntegrityError — the typed structural-defect channel for
// MoveSpec evaluation (§24.3 item 2: zero candidate escape edges — the
// anchored pairing guarantees at least one, so its absence is a captured
// defect, never a case to route around). Like BudgetExhaustedError it
// travels as a typed exception caught at ONE boundary: the reducer's
// evalMoveSpec site, converted there into the integrity terminal. Never
// crosses any other boundary.
export class ConstructionIntegrityError extends Error {
  readonly detail: string;
  // The failing construction's id for the terminal's CheckResult
  // (default "escape" — the original §24.3 item-2 channel; §24.1's empty
  // extend enumeration passes "extend").
  readonly id: string;
  constructor(detail: string, id: string = "escape") {
    super(`construction integrity: ${detail}`);
    this.name = "ConstructionIntegrityError";
    this.detail = detail;
    this.id = id;
  }
}

export type RegionEvalResult =
  | { kind: "complete"; region: RegionValue }
  | { kind: "incomplete"; analysis: HoleAnalysis };

// ---- PtExpr ----

function lookupId(state: GameState, id: PointId): Pt | null {
  for (const p of state.points) {
    if (p.id === id) {
      return p.pt;
    }
  }
  return null;
}

// evalPt: null = unresolvable (anchor miss) — callers treat as construction
// failure. Total otherwise; exhaustive over the five PtExpr kinds.
export function evalPt(expr: PtExpr, state: GameState): Pt | null {
  switch (expr.kind) {
    case "const":
      return pt(expr.x, expr.y);
    case "anchor": {
      const v = state.strategy?.vars[expr.v];
      if (typeof v !== "string") {
        return null;
      }
      return lookupId(state, v);
    }
    case "mid": {
      const a = evalPt(expr.a, state);
      const b = evalPt(expr.b, state);
      if (a === null || b === null) {
        return null;
      }
      const two = Rat.make(2n);
      return pt(a.x.add(b.x).div(two), a.y.add(b.y).div(two));
    }
    case "reflect": {
      const src = evalPt(expr.src, state);
      const o0 = evalPt(expr.over[0], state);
      const o1 = evalPt(expr.over[1], state);
      if (src === null || o0 === null || o1 === null) {
        return null;
      }
      const dx = o1.x.sub(o0.x);
      const dy = o1.y.sub(o0.y);
      const l2 = dx.mul(dx).add(dy.mul(dy));
      if (l2.isZero()) {
        return null;
      }
      const sx = src.x.sub(o0.x);
      const sy = src.y.sub(o0.y);
      const t = sx.mul(dx).add(sy.mul(dy)).div(l2);
      const two = Rat.make(2n);
      return pt(
        o0.x.add(t.mul(dx)).mul(two).sub(src.x),
        o0.y.add(t.mul(dy)).mul(two).sub(src.y),
      );
    }
    case "offset": {
      const from = evalPt(expr.from, state);
      if (from === null) {
        return null;
      }
      return pt(from.x.add(expr.by[0]), from.y.add(expr.by[1]));
    }
  }
}

// ---- PtListExpr (the shared id-list projection, §5.7 dispatch contract) ----

export function evalPtListIds(
  expr: PtListExpr,
  state: GameState,
): PtListIdsResult {
  switch (expr.kind) {
    case "var": {
      const v = state.strategy?.vars[expr.v];
      if (v === undefined) {
        return {
          kind: "resolution-failure",
          reason: "unbound-var",
          detail: `var ${expr.v} is unbound`,
        };
      }
      if (!Array.isArray(v)) {
        return {
          kind: "resolution-failure",
          reason: "binding-kind-mismatch",
          detail: `var ${expr.v} is not a PointId list`,
        };
      }
      for (const id of v) {
        if (lookupId(state, id) === null) {
          return {
            kind: "resolution-failure",
            reason: "unavailable-point",
            detail: `var ${expr.v} names unplaced point ${id}`,
          };
        }
      }
      return { kind: "ok", ids: v };
    }
    case "points": {
      const ids: PointId[] = [];
      for (const leaf of expr.of) {
        if (leaf.kind !== "anchor") {
          return {
            kind: "resolution-failure",
            reason: "non-anchor-leaf",
            detail: `points-of leaf kind ${leaf.kind} is not an anchor`,
          };
        }
        const v = state.strategy?.vars[leaf.v];
        if (v === undefined) {
          return {
            kind: "resolution-failure",
            reason: "unbound-var",
            detail: `anchor var ${leaf.v} is unbound`,
          };
        }
        if (typeof v !== "string") {
          return {
            kind: "resolution-failure",
            reason: "binding-kind-mismatch",
            detail: `anchor var ${leaf.v} is not a single PointId`,
          };
        }
        if (lookupId(state, v) === null) {
          return {
            kind: "resolution-failure",
            reason: "unavailable-point",
            detail: `anchor var ${leaf.v} names unplaced point ${v}`,
          };
        }
        ids.push(v);
      }
      return { kind: "ok", ids };
    }
    case "last-n": {
      if (
        !Number.isInteger(expr.n) ||
        expr.n < 1 ||
        expr.n > state.points.length
      ) {
        return {
          kind: "resolution-failure",
          reason: "last-n-domain",
          detail: `last-n ${expr.n} outside 1..${state.points.length}`,
        };
      }
      return {
        kind: "ok",
        ids: state.points.slice(state.points.length - expr.n).map((p) => p.id),
      };
    }
  }
}

// ---- RegionExpr → RegionEvalResult (the §8.3 cache stores full results) ----

interface CacheEntry {
  key: string;
  result: RegionEvalResult;
}

const regionCache = new Map<string, CacheEntry>();
const CACHE_CAP = 500;

function exprKey(expr: RegionExpr): string {
  return JSON.stringify(expr);
}

function windowPoly(window: Window): RegionValue {
  return {
    kind: "poly",
    verts: [
      pt(window.minX, window.minY),
      pt(window.maxX, window.minY),
      pt(window.maxX, window.maxY),
      pt(window.minX, window.maxY),
    ],
  };
}

function evalRegionUncached(expr: RegionExpr, ctx: EvalCtx): RegionEvalResult {
  const { state, config, channel } = ctx;
  const window: Window = {
    minX: config.window.xMin,
    minY: config.window.yMin,
    maxX: config.window.xMax,
    maxY: config.window.yMax,
  };
  switch (expr.kind) {
    case "all":
    case "window":
      return { kind: "complete", region: windowPoly(window) };
    case "halfplane": {
      const a = evalPt(expr.thru[0], state);
      const b = evalPt(expr.thru[1], state);
      if (a === null || b === null) {
        // unresolvable region operands are caller defects (G10 +
        // producer discipline make them unreachable in registered defs) —
        // fail loud, never a guessed region.
        throw new Error(
          "evalRegion: halfplane anchor unresolvable — implementation error",
        );
      }
      const keepLeft = expr.side === "left";
      const base = windowPoly(window);
      if (base.kind !== "poly") {
        throw new Error(
          "evalRegion: window is not a poly — implementation error",
        );
      }
      return {
        kind: "complete",
        region: canonicalizeRegion({
          kind: "poly",
          verts: clipConvexByHalfPlane(base.verts, a, b, keepLeft),
        }),
      };
    }
    case "hull": {
      const resolved = evalPtListIds(expr.of, state);
      if (resolved.kind === "resolution-failure") {
        throw new Error(
          `evalRegion: hull id-list ${resolved.reason} — implementation error (${resolved.detail})`,
        );
      }
      const pts = resolved.ids.map((id) => lookupId(state, id) as Pt);
      const h = hull(pts);
      return {
        kind: "complete",
        region: canonicalizeRegion({ kind: "poly", verts: h }),
      };
    }
    case "intersect": {
      const parts: RegionValue[] = [];
      for (const sub of expr.of) {
        const r = evalRegion(sub, ctx);
        if (r.kind === "incomplete") {
          return r; // FIRST incomplete operand's analysis propagates (§7.4)
        }
        parts.push(r.region);
      }
      let acc: RegionValue = windowPoly(window);
      for (const part of parts) {
        acc = intersectRegion(acc, part);
      }
      return { kind: "complete", region: canonicalizeRegion(acc) };
    }
    case "holes": {
      const idpts: IdPt[] = state.points.map((p) => ({ id: p.id, pt: p.pt }));
      if (channel === "correctness") {
        const bound = estimateHoleWork(idpts.length, expr.k);
        if (!(bound <= config.analysis.budgetOps)) {
          return {
            kind: "incomplete",
            analysis: {
              kind: "budget-exhausted",
              k: expr.k,
              searched: 0,
            },
          };
        }
        const found = findWinHoles(state, expr.k, {
          mode: "exhaustive",
          budget: config.analysis.budgetOps,
        });
        if (found.kind !== "exhaustive") {
          return { kind: "incomplete", analysis: found };
        }
        return { kind: "complete", region: holesUnion(found, state) };
      }
      const analysis = analyzeWinHoles(state, expr.k, {
        budget: config.analysis.budgetOps,
      });
      if (analysis.kind !== "exhaustive") {
        return { kind: "incomplete", analysis };
      }
      return { kind: "complete", region: holesUnion(analysis, state) };
    }
  }
}

function holesUnion(
  analysis: {
    kind: "exhaustive";
    k: number;
    holes: readonly { verts: readonly string[] }[];
  },
  state: GameState,
): RegionValue {
  const parts: RegionValue[] = [];
  for (const hole of analysis.holes) {
    const pts: Pt[] = [];
    let ok = true;
    for (const id of hole.verts) {
      const p = lookupId(state, id);
      if (p === null) {
        ok = false;
        break;
      }
      pts.push(p);
    }
    if (ok) {
      parts.push({ kind: "poly", verts: hull(pts) });
    }
  }
  return canonicalizeRegion({ kind: "union", parts });
}

function intersectRegion(a: RegionValue, b: RegionValue): RegionValue {
  const polysA =
    a.kind === "poly" ? [a] : a.parts.filter((p) => p.kind === "poly");
  const polysB =
    b.kind === "poly" ? [b] : b.parts.filter((p) => p.kind === "poly");
  const out: RegionValue[] = [];
  for (const pa of polysA) {
    if (pa.kind !== "poly") {
      continue;
    }
    for (const pb of polysB) {
      if (pb.kind !== "poly") {
        continue;
      }
      let acc = [...pa.verts];
      for (let i = 0; i < pb.verts.length; i += 1) {
        acc = clipConvexByHalfPlane(
          acc,
          pb.verts[i] as Pt,
          pb.verts[(i + 1) % pb.verts.length] as Pt,
          true,
        );
        if (acc.length === 0) {
          break;
        }
      }
      out.push({ kind: "poly", verts: acc });
    }
  }
  return { kind: "union", parts: out };
}

function stateKey(state: GameState): string {
  // Hash is the lookup index; the stored full key is compared on retrieval
  // (§8.3) — collisions cost performance, never correctness.
  // (spec review A1): strategy vars (P5, anchors…) are part of the state
  // identity — `hull var P5` / anchor leaves read them, so the key must too.
  const vars = state.strategy === null ? "" : JSON.stringify(state.strategy.vars);
  return `${state.seq}|${vars}|${state.points.map((p) => `${p.id}:${p.pt.x.toString()},${p.pt.y.toString()}`).join(";")}`;
}

function configKey(config: Configuration): string {
  // The §8.3 triple (state, expr, channel) does NOT determine the result on
  // its own: the window shapes every region and budgetOps gates every holes
  // enumeration (a settings change mid-session must never hit a stale
  // entry). The key therefore carries exactly the config parts evaluation
  // reads — same key ⟹ same result (kind included).
  const w = config.window;
  return `b${config.analysis.budgetOps}|${w.xMin.toString()},${w.yMin.toString()},${w.xMax.toString()},${w.yMax.toString()}`;
}

export function evalRegion(expr: RegionExpr, ctx: EvalCtx): RegionEvalResult {
  const key = `${stateKey(ctx.state)}|${ctx.channel}|${configKey(ctx.config)}|${exprKey(expr)}`;
  const hit = regionCache.get(key);
  if (hit !== undefined && hit.key === key) {
    return hit.result;
  }
  const result = evalRegionUncached(expr, ctx);
  if (regionCache.size >= CACHE_CAP) {
    const oldest = regionCache.keys().next();
    if (!oldest.done) {
      regionCache.delete(oldest.value);
    }
  }
  regionCache.set(key, { key, result });
  return result;
}

// Test seam: clear the region cache (deterministic re-evaluation).
export function clearRegionCache(): void {
  regionCache.clear();
}

// ---- MoveSpec ----

function configWindow(config: Configuration): Window {
  return {
    minX: config.window.xMin,
    minY: config.window.yMin,
    maxX: config.window.xMax,
    maxY: config.window.yMax,
  };
}

function idPtsOf(state: GameState): IdPt[] {
  return state.points.map((p) => ({ id: p.id, pt: p.pt }));
}

function lookupVar(state: GameState, v: string): Binding | undefined {
  return state.strategy?.vars[v];
}

// evalMoveSpec (§10.9): {pt} | null. null = construction failure (classified
// by classifySpecFailure —). A post-violation (impossible for correct
// code) throws LOUDLY rather than collapsing into null.
export function evalMoveSpec(
  moveSpec: MoveSpec,
  state: GameState,
  config: Configuration,
): { pt: Pt } | null {
  const window = configWindow(config);
  switch (moveSpec.kind) {
    case "fixed": {
      for (const cand of moveSpec.at) {
        const p = evalPt(cand, state);
        if (p === null) {
          continue;
        }
        if (checkPlacement(state, p, config.window) === null) {
          return { pt: p };
        }
      }
      return null;
    }
    case "extend": {
      // enumerate-form may throw BudgetExhaustedError (integrity-class,
      // caught at the reducer/init boundary — never null, never partial).
      const holes =
        moveSpec.hole.kind === "var"
          ? varHole(state, moveSpec.hole.v)
          : enumerateHoles(state, moveSpec.hole.k, config);
      if (holes === null) {
        return null;
      }
      // §24.1 k6:immediate: an EMPTY exhaustive enumeration contradicts the
      // cited forcing sentence — a captured defect, never a case to route
      // around (and never the plain geometry-layer throw): the typed
      // ConstructionIntegrityError channel carries it to the integrity
      // terminal with the fixture recoverable from the terminal's
      // stateHash/session state.
      if (holes.length === 0) {
        throw new ConstructionIntegrityError(
          `extend enumeration empty (${state.points.length} points, k=${moveSpec.hole.kind === "var" ? holes.length : moveSpec.hole.k}) — contradicts the forcing sentence (§24.1); fixture captured by the integrity terminal`,
          "extend",
        );
      }
      const prefer = moveSpec.prefer ?? "largest-interval";
      const out = extendHole(holes, idPtsOf(state), window, prefer);
      if (!out.ok) {
        if (out.reason === "post-violation") {
          throw new Error(
            `evalMoveSpec: extend post-violation — implementation error (${out.detail})`,
          );
        }
        return null;
      }
      return { pt: out.point };
    }
    case "co-shoulder": {
      const outerIds = lookupVar(state, moveSpec.outer.v);
      const interiorId = lookupVar(state, moveSpec.interior);
      if (!Array.isArray(outerIds) || outerIds.length !== 3) {
        return null;
      }
      if (typeof interiorId !== "string") {
        return null;
      }
      const outer = outerIds.map((id) => lookupId(state, id));
      const interior = lookupId(state, interiorId);
      if (outer.some((p) => p === null) || interior === null) {
        return null;
      }
      const out = coShoulder(
        outer as Pt[],
        interior as Pt,
        state.points.map((p) => p.pt),
        window,
      );
      if (!out.ok) {
        if (out.reason === "post-violation") {
          throw new Error(
            `evalMoveSpec: co-shoulder post-violation — implementation error (${out.detail})`,
          );
        }
        return null;
      }
      return { pt: out.point };
    }
    case "escape-pair-beyond-edge": {
      // Lemma 8 A1: just outside the shared edge [C, D] of the two chord
      // halves; accepted only after which the two extended halves are exact
      // 6-hole quad-twins for (A1, B0) (geometry/twinsK7.ts twinQuadEars).
      // The strict conditions hold on an open neighbourhood of the edge's
      // interior (docs/K7_GATE.md §2), so the near-first halving search is
      // complete for every B0 inside the hexagon; a window too small for it
      // is reported by the caller as window-exhausted (never a guess).
      const edgeIds = lookupVar(state, moveSpec.edge.v);
      const ringIds = lookupVar(state, moveSpec.ring.v);
      const anchorId = lookupVar(state, moveSpec.anchor);
      const halfIds = moveSpec.halves.map((h) => lookupVar(state, h.v));
      if (
        !Array.isArray(edgeIds) ||
        edgeIds.length !== 2 ||
        !Array.isArray(ringIds) ||
        ringIds.length < 4 ||
        typeof anchorId !== "string" ||
        halfIds.length !== 2 ||
        !halfIds.every((h) => Array.isArray(h))
      ) {
        throw new ConstructionIntegrityError(
          "escape-pair-beyond-edge: edge/ring/anchor/halves vars misbound",
          "escape-pair",
        );
      }
      const n = ringIds.length;
      const uPos = ringIds.indexOf(edgeIds[0] as string);
      const vPos = ringIds.indexOf(edgeIds[1] as string);
      if (uPos < 0 || vPos !== (uPos + 1) % n) {
        throw new ConstructionIntegrityError(
          "escape-pair-beyond-edge: edge is not a CCW edge of the ring",
          "escape-pair",
        );
      }
      const ringPts = ringIds.map((id) => lookupId(state, id));
      const anchorPt = lookupId(state, anchorId);
      if (ringPts.some((q) => q === null) || anchorPt === null) {
        return null;
      }
      const u = ringPts[uPos] as Pt;
      const v = ringPts[vPos] as Pt;
      const prev = ringPts[(uPos - 1 + n) % n] as Pt;
      const next = ringPts[(vPos + 1) % n] as Pt;
      const placedPts = state.points.map((p) => p.pt);
      const newId = `p${state.points.length + 1}`;
      const accept = (cand: Pt): boolean => {
        const ptOf = (id: string): Pt | null =>
          id === newId ? cand : lookupId(state, id);
        const all = [...placedPts, cand];
        const lists: string[][] = [];
        for (const h of halfIds as string[][]) {
          const ids = [...h, anchorId, newId];
          const pts = ids.map((id) => ptOf(id));
          if (pts.some((q) => q === null) || !isKHole(pts as Pt[], all)) {
            return false;
          }
          lists.push(ids);
        }
        return (
          twinQuadEars(
            lists[0] as string[],
            lists[1] as string[],
            [newId, anchorId],
            ptOf,
          ) !== null
        );
      };
      const near = escapeNearEdge(u, v, prev, next, placedPts, window, accept);
      if (near.ok) {
        return { pt: near.point };
      }
      // No accepted point: place the first wedge-valid point WITHOUT the
      // acceptance test so the k7-inv:twins post-condition reports the
      // truthful failure (integrity failure with a captured fixture).
      const fb = escapeNearEdge(u, v, prev, next, placedPts, window);
      return fb.ok ? { pt: fb.point } : null;
    }
    case "escape-edge-accept": {
      // Lemma 9 A1/A2: near-first halving just outside a CCW ring edge,
      // accepted only after which every `grow` list + the new point is an exact
      // hole (and, with `meet`, the first two meet exactly in a convex part).
      const newId = `p${state.points.length + 1}`;
      const placedPts = state.points.map((p) => p.pt);
      const fallbacks: Array<{ accept: (c: Pt) => boolean; anchor: Pt }> = [];
      for (const opt of moveSpec.options) {
        const edgeIds = lookupVar(state, opt.edge.v);
        const ringIds = lookupVar(state, opt.ring.v);
        const growLists = opt.grow.map((g) => lookupVar(state, g.v));
        if (
          !Array.isArray(edgeIds) ||
          edgeIds.length !== 2 ||
          !Array.isArray(ringIds) ||
          ringIds.length < 4 ||
          !growLists.every((g) => Array.isArray(g))
        ) {
          throw new ConstructionIntegrityError(
            "escape-edge-accept: edge/ring/grow vars misbound",
            "escape-edge",
          );
        }
        const n = ringIds.length;
        const uPos = ringIds.indexOf(edgeIds[0] as string);
        const vPos = ringIds.indexOf(edgeIds[1] as string);
        if (uPos < 0 || vPos !== (uPos + 1) % n) {
          throw new ConstructionIntegrityError(
            "escape-edge-accept: edge is not a CCW edge of the ring",
            "escape-edge",
          );
        }
        const ringPts = ringIds.map((id) => lookupId(state, id));
        if (ringPts.some((q) => q === null)) {
          return null;
        }
        const u = ringPts[uPos] as Pt;
        const v = ringPts[vPos] as Pt;
        const prev = ringPts[(uPos - 1 + n) % n] as Pt;
        const next = ringPts[(vPos + 1) % n] as Pt;
        const accept = (cand: Pt): boolean => {
          const ptOf = (id: string): Pt | null =>
            id === newId ? cand : lookupId(state, id);
          const all = [...placedPts, cand];
          const lists: string[][] = [];
          for (const g of growLists as string[][]) {
            const ids = [...g, newId];
            const pts = ids.map((id) => ptOf(id));
            if (pts.some((q) => q === null) || !isKHole(pts as Pt[], all)) {
              return false;
            }
            lists.push(ids);
          }
          if (opt.meet !== undefined) {
            return (
              twinSharedPart(
                lists[0] as string[],
                lists[1] as string[],
                ptOf,
                opt.meet,
              ) !== null
            );
          }
          return true;
        };
        // The near-edge halving schedule is only a fast path: it is given a small
        // evaluation budget and then yields to the exact cell search below.
        let evals = 0;
        const budgeted = (cand: Pt): boolean => {
          evals += 1;
          if (evals > HALVING_EVALS) {
            throw new HalvingBudget();
          }
          return accept(cand);
        };
        try {
          const near = escapeNearEdge(u, v, prev, next, placedPts, window, budgeted);
          if (near.ok) {
            return { pt: near.point };
          }
        } catch (e) {
          if (!(e instanceof HalvingBudget)) {
            throw e;
          }
        }
        fallbacks.push({
          accept,
          anchor: pt(u.x.add(v.x).div(Rat.make(2n)), u.y.add(v.y).div(Rat.make(2n))),
        });
      }
      // Exact fallback. Every acceptance predicate above depends only on the
      // orientation of the new point with respect to the lines through pairs of
      // the placed points, so it is constant on the cells of that arrangement:
      // one representative per cell decides, over the whole plane, whether an
      // admissible point exists (the halving schedule above only samples a thin
      // neighbourhood of the edge). Cells are tried nearest-first to the edge.
      const first = fallbacks[0];
      if (first === undefined) {
        return null;
      }
      const reps = cellCandidates(placedPts, window, first.anchor).filter(
        (c) => checkPlacement(state, c, config.window) === null,
      );
      for (const f of fallbacks) {
        for (const c of reps) {
          if (f.accept(c)) {
            return { pt: c };
          }
        }
      }
      if (moveSpec.exactAnchor !== undefined) {
        const b0 = lookupVar(state, moveSpec.exactAnchor);
        if (typeof b0 === "string") {
          for (const c of reps) {
            const ids: IdPt[] = [
              ...idPtsOf(state),
              { id: newId, pt: c },
            ];
            const ptOf = (id: string): Pt | null =>
              ids.find((q) => q.id === id)?.pt ?? null;
            const news = findNewKHoles(ids, 6, newId).holes;
            for (let i = 0; i < news.length; i += 1) {
              for (let j = i + 1; j < news.length; j += 1) {
                if (
                  twinTriangleEars(
                    (news[i] as KHole).verts,
                    (news[j] as KHole).verts,
                    [newId, b0],
                    ptOf,
                  ) !== null
                ) {
                  return { pt: c };
                }
              }
            }
          }
        }
      }
      return null;
    }
    case "forcing-pair": {
      // Lemma 9 A3: candidates just outside each ring edge (canonical order),
      // accepted when two 6-holes through the new point meet exactly in a
      // triangle and neither has the whole `chain` as consecutive vertices.
      const ringIds = lookupVar(state, moveSpec.ring.v);
      const chainIds = moveSpec.chain.map((c) => lookupVar(state, c));
      if (
        !Array.isArray(ringIds) ||
        ringIds.length < 4 ||
        !chainIds.every((c) => typeof c === "string")
      ) {
        throw new ConstructionIntegrityError(
          "forcing-pair: ring/chain vars misbound",
          "forcing-pair",
        );
      }
      const ringPts = ringIds.map((id) => lookupId(state, id));
      if (ringPts.some((q) => q === null)) {
        return null;
      }
      const newId = `p${state.points.length + 1}`;
      const [c0, c1, c2] = chainIds as [string, string, string];
      const consecutive = (ids: readonly string[]): boolean => {
        const k = ids.length;
        for (let i = 0; i < k; i += 1) {
          const a = ids[i] as string;
          const b = ids[(i + 1) % k] as string;
          const c = ids[(i + 2) % k] as string;
          if ((a === c0 && b === c1 && c === c2) || (a === c2 && b === c1 && c === c0)) {
            return true;
          }
        }
        return false;
      };
      const half = Rat.make(1n, 2n);
      const fractions = [Rat.make(1n, 3n), half, Rat.make(2n, 3n)];
      for (let m = 0; m < ringIds.length; m += 1) {
        const a = ringPts[m] as Pt;
        const b = ringPts[(m + 1) % ringIds.length] as Pt;
        const nx = b.y.sub(a.y);
        const ny = a.x.sub(b.x);
        for (const f of fractions) {
          const mx = a.x.add(b.x.sub(a.x).mul(f));
          const my = a.y.add(b.y.sub(a.y).mul(f));
          for (let e = 1; e <= 10; e += 1) {
            const t = Rat.make(1n, 2n ** BigInt(e));
            const cand = pt(mx.add(nx.mul(t)), my.add(ny.mul(t)));
            if (checkPlacement(state, cand, config.window) !== null) {
              continue;
            }
            const ids: IdPt[] = [
              ...idPtsOf(state),
              { id: newId, pt: cand },
            ];
            const news = findNewKHoles(ids, 6, newId);
            const ptOf = (id: string): Pt | null =>
              ids.find((q) => q.id === id)?.pt ?? null;
            const hs = news.holes;
            for (let i = 0; i < hs.length; i += 1) {
              for (let j = i + 1; j < hs.length; j += 1) {
                const ai = (hs[i] as KHole).verts;
                const bj = (hs[j] as KHole).verts;
                if (consecutive(ai) || consecutive(bj)) {
                  continue;
                }
                if (twinSharedPart(ai, bj, ptOf, 3) !== null) {
                  return { pt: cand };
                }
              }
            }
          }
        }
      }
      return null;
    }
    case "double-extend": {
      // Lemma 9 A4: two interior-disjoint holes sharing exactly one vertex v;
      // a point near v (directions: sums of the two neighbour edge vectors, both
      // signs; dyadic halving) extending BOTH to exact holes whose interiors stay
      // disjoint.
      const holes = enumerateHoles(state, moveSpec.holeSize, config);
      const newId = `p${state.points.length + 1}`;
      const ptsOf = (ids: readonly string[]): Pt[] =>
        ids.map((id) => lookupId(state, id) as Pt);
      for (let i = 0; i < holes.length; i += 1) {
        for (let j = i + 1; j < holes.length; j += 1) {
          const a = (holes[i] as KHole).verts;
          const b = (holes[j] as KHole).verts;
          const sh = a.filter((x) => b.includes(x));
          if (sh.length !== 1) {
            continue;
          }
          const pa = ptsOf(a);
          const pb = ptsOf(b);
          if (!interiorsDisjoint(pa, pb)) {
            continue;
          }
          const vId = sh[0] as string;
          const v = lookupId(state, vId) as Pt;
          const nbrs = (ids: readonly string[]): Pt[] => {
            const ring = ccwIds(ids, (id) => lookupId(state, id)) as string[];
            const at = ring.indexOf(vId);
            return [
              lookupId(state, ring[(at + 1) % ring.length] as string) as Pt,
              lookupId(state, ring[(at + ring.length - 1) % ring.length] as string) as Pt,
            ];
          };
          for (const wa of nbrs(a)) {
            for (const wb of nbrs(b)) {
              const dx = wa.x.sub(v.x).add(wb.x.sub(v.x));
              const dy = wa.y.sub(v.y).add(wb.y.sub(v.y));
              for (const sgn of [1n, -1n]) {
                for (let e = 1; e <= 40; e += 1) {
                  const t = Rat.make(sgn, 2n ** BigInt(e));
                  const cand = pt(v.x.add(dx.mul(t)), v.y.add(dy.mul(t)));
                  if (checkPlacement(state, cand, config.window) !== null) {
                    continue;
                  }
                  const ptOf = (id: string): Pt | null =>
                    id === newId ? cand : lookupId(state, id);
                  const all = [...state.points.map((p) => p.pt), cand];
                  const ka = [...a, newId].map((id) => ptOf(id) as Pt);
                  const kb = [...b, newId].map((id) => ptOf(id) as Pt);
                  if (
                    isKHole(ka, all) &&
                    isKHole(kb, all) &&
                    interiorsDisjoint(ka, kb)
                  ) {
                    return { pt: cand };
                  }
                }
              }
            }
          }
        }
      }
      return null;
    }
    case "escape-beyond-edge": {
      const edgeIds = lookupVar(state, moveSpec.sharedEdge.v);
      const polyIds = lookupVar(state, moveSpec.poly.v);
      if (
        !Array.isArray(edgeIds) ||
        edgeIds.length !== 2 ||
        !Array.isArray(polyIds) ||
        polyIds.length < 3
      ) {
        return null;
      }
      const eId = edgeIds[1] as string;
      const poly = polyIds.map((id) => lookupId(state, id));
      if (poly.some((p) => p === null)) {
        return null;
      }
      const ePos = polyIds.indexOf(eId);
      if (ePos < 0) {
        return null;
      }
      // §24.3 item 1: candidate edges (E, nb) with nb a pentagon neighbor of
      // E lying in one of the paired quads. Without quad refs (pre-13
      // defs/tests) both neighbors are candidates.
      let dirs = [-1, 1];
      if (moveSpec.quads !== undefined) {
        const quadSets: string[][] = [];
        for (const q of moveSpec.quads) {
          if (q.kind !== "var") {
            return null;
          }
          const ids = lookupVar(state, q.v);
          if (!Array.isArray(ids)) {
            throw new ConstructionIntegrityError(
              `escape-beyond-edge: quad var ${q.v} is not a PointId list`,
            );
          }
          quadSets.push(ids);
        }
        const n = polyIds.length;
        dirs = [];
        for (const d of [-1, 1]) {
          const nb = polyIds[(ePos + d + n) % n] as string;
          if (quadSets.some((ids) => ids.includes(nb))) {
            dirs.push(d);
          }
        }
        if (dirs.length === 0) {
          throw new ConstructionIntegrityError(
            "escape-beyond-edge: neither pentagon neighbor of E lies in the paired quads",
          );
        }
      }
      const n = polyIds.length;
      const placed = state.points.map((p) => p.pt);
      // Edge ranking per the §7.5 escape row (larger ℓ_e; tie → larger t;
      // tie → smaller nb PointId in placement-index order —). The row
      // ranks edges; the POINT on the winning edge is near-first.
      // Traversal is CCW-consistent: for d=+1 the frame runs E→nb, for
      // d=−1 it runs nb→E (a backward frame would flip the wedge signs
      // and degenerate the side constraints).
      const ranked: Array<{ ell: Rat; t: Rat; nbIdx: number; d: number }> = [];
      for (const d of dirs) {
        const nbPos = (ePos + d + n) % n;
        const uPos = d === 1 ? ePos : nbPos;
        const vPos = d === 1 ? nbPos : ePos;
        const u = poly[uPos] as Pt;
        const v = poly[vPos] as Pt;
        const prev = poly[(uPos - 1 + n) % n] as Pt;
        const next = poly[(vPos + 1) % n] as Pt;
        const r = escapeScan(u, v, prev, next, placed, window);
        if (!r.ok) {
          if (r.reason === "post-violation") {
            throw new Error(
              `evalMoveSpec: escape post-violation — implementation error (${r.detail})`,
            );
          }
          continue;
        }
        const nbIdx = state.points.findIndex(
          (p) => p.id === (polyIds[nbPos] as string),
        );
        ranked.push({ ell: r.ell, t: r.t, nbIdx, d });
      }
      // §7.5 escape row: larger ℓ_e, then larger t, then smaller nb index.
      ranked.sort(
        (x, y) =>
          y.ell.cmp(x.ell) || y.t.cmp(x.t) || x.nbIdx - y.nbIdx,
      );
      if (ranked.length === 0) {
        return null;
      }
      // accept only a point after which Lemma 7's exact twins exist.
      const twinsAfter = (cand: Pt): boolean => {
        const ids: IdPt[] = [
          ...state.points.map((q) => ({ id: q.id, pt: q.pt })),
          { id: `p${state.points.length + 1}`, pt: cand },
        ];
        const newId = `p${state.points.length + 1}`;
        const found = findKHoles(ids, 5, {
          mode: "exhaustive",
          budget: estimateHoleWork(ids.length, 5),
        });
        if (found.kind !== "exhaustive") {
          return true; // undecidable here: defer to the post-condition (fail-closed)
        }
        const ptOf = (id: string): Pt | null =>
          ids.find((q) => q.id === id)?.pt ?? null;
        for (let i = 0; i < found.holes.length; i += 1) {
          for (let j = i + 1; j < found.holes.length; j += 1) {
            const a = (found.holes[i] as KHole).verts;
            const b = (found.holes[j] as KHole).verts;
            const shared = a.filter((v) => b.includes(v));
            if (
              shared.length === 3 &&
              shared.includes(newId) &&
              twinSharedTriangle(a, b, ptOf) !== null
            ) {
              return true;
            }
          }
        }
        return false;
      };
      // try the ranked edges in order — a failed twin search on the best
      // edge must not forfeit the other adjacent edge (near-first point, // twin formation needs A1 in the Figure-1 zone by the edge).
      for (const cand of ranked) {
        const nbPos = (ePos + cand.d + n) % n;
        const wu = poly[cand.d === 1 ? ePos : nbPos] as Pt;
        const wv = poly[cand.d === 1 ? nbPos : ePos] as Pt;
        const wprev = poly[((cand.d === 1 ? ePos : nbPos) - 1 + n) % n] as Pt;
        const wnext = poly[((cand.d === 1 ? nbPos : ePos) + 1) % n] as Pt;
        const near = escapeNearEdge(wu, wv, wprev, wnext, placed, window, twinsAfter);
        if (near.ok) {
          return { pt: near.point };
        }
      }
      // No twin-forming point found: place the first wedge-valid point of the
      // best edge WITHOUT the twin test, so the k6-inv:twins post-condition
      // reports the truthful failure (an integrity failure with a captured
      // fixture) instead of a mislabelled "window-exhausted".
      const top = ranked[0] as (typeof ranked)[number];
      const tnb = (ePos + top.d + n) % n;
      const fb = escapeNearEdge(
        poly[top.d === 1 ? ePos : tnb] as Pt,
        poly[top.d === 1 ? tnb : ePos] as Pt,
        poly[((top.d === 1 ? ePos : tnb) - 1 + n) % n] as Pt,
        poly[((top.d === 1 ? tnb : ePos) + 1) % n] as Pt,
        placed,
        window,
      );
      return fb.ok ? { pt: fb.point } : null;
    }
  }
}

// Acceptance evaluations granted to the near-edge halving fast path before the
// exact cell search takes over.
const HALVING_EVALS = 400;

class HalvingBudget extends Error {
  constructor() {
    super("halving budget exhausted");
    this.name = "HalvingBudget";
  }
}

// One exact interior representative per cell of the arrangement of all lines
// through pairs of `placed`, restricted to the window, ordered by squared
// distance to `near` (ties keep the arrangement's deterministic order).
function cellCandidates(placed: readonly Pt[], window: Window, near: Pt): Pt[] {
  const lines: Array<{ a: Pt; b: Pt }> = [];
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      lines.push({ a: placed[i] as Pt, b: placed[j] as Pt });
    }
  }
  const cells = arrangementCells(lines, [
    pt(window.minX, window.minY),
    pt(window.maxX, window.minY),
    pt(window.maxX, window.maxY),
    pt(window.minX, window.maxY),
  ]);
  const reps: Array<{ p: Pt; d: Rat; i: number }> = [];
  cells.forEach((cell, i) => {
    const p = canonicalInteriorPoint(cell);
    if (p !== null) {
      const dx = p.x.sub(near.x);
      const dy = p.y.sub(near.y);
      reps.push({ p, d: dx.mul(dx).add(dy.mul(dy)), i });
    }
  });
  reps.sort((a, b) => a.d.cmp(b.d) || a.i - b.i);
  return reps.map((r) => r.p);
}

function varHole(state: GameState, v: string): KHole[] | null {
  const ids = lookupVar(state, v);
  if (!Array.isArray(ids) || ids.length < 3) {
    return null;
  }
  const pts: Pt[] = [];
  for (const id of ids) {
    const p = lookupId(state, id);
    if (p === null) {
      return null;
    }
    pts.push(p);
  }
  // Canonical hull order (bindings are id lists, not ordered hulls).
  const h = hull(pts);
  if (h.length !== pts.length) {
    return null;
  }
  const ordered = h.map((q) => {
    const idx = pts.indexOf(q);
    return ids[idx] as string;
  });
  return [{ k: pts.length, verts: ordered }];
}

function enumerateHoles(
  state: GameState,
  k: number,
  config: Configuration,
): KHole[] {
  const found = findWinHoles(state, k, {
    mode: "exhaustive",
    budget: config.analysis.budgetOps,
  });
  if (found.kind !== "exhaustive") {
    throw new BudgetExhaustedError(k, found);
  }
  return [...found.holes];
}
