// strategy/samples.ts — analysis-layer case computation: effective cells
// per case (§10.4) and representative sample replies (§11.4). PURE analysis:
// never routes for real, never freezes sessions, never manufactures
// IntegrityReports. Consumers: case-map rendering, sample chips (both via
// engine/describe.ts — ui/ never imports strategy/).
import { Rat } from "../geometry/rat.ts";
import { pt } from "../geometry/pt.ts";
import type { Pt } from "../geometry/pt.ts";
import { arrangementCells } from "../geometry/arrangement.ts";
import type { ArrLine } from "../geometry/arrangement.ts";
import { canonicalInteriorPoint, polygonArea2 } from "../geometry/poly.ts";
import type { ConvexPoly, RegionValue } from "../geometry/poly.ts";
import { checkPlacement } from "../game/legality.ts";
import { placePoint } from "../game/place.ts";
import type {
  CaseId,
  Configuration,
  GameState,
  NodeId,
  PointId,
} from "../game/types.ts";
import { evalPtListIds, evalRegion } from "./eval.ts";
import { classify, nodeOf } from "./runtime.ts";
import { getClassifier } from "./registry.ts";
import type { StrategyDef } from "./types.ts";

export interface EffectiveCell {
  readonly poly: ConvexPoly;
  readonly caseId: CaseId;
  readonly area2: Rat;
}

export type EffectiveCells =
  | { available: true; groups: ReadonlyArray<{ caseId: CaseId; cells: readonly EffectiveCell[] }> }
  | { available: false; reason: string; detail: string };

// Supporting lines of every poly part of a complete region (change loci).
function supportingLines(region: RegionValue): ArrLine[] {
  const polys =
    region.kind === "poly" ? [region] : region.parts.filter((p) => p.kind === "poly");
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

function windowPoly(config: Configuration): ConvexPoly {
  const w = config.window;
  return [
    pt(w.xMin, w.yMin),
    pt(w.xMax, w.yMin),
    pt(w.xMax, w.yMax),
    pt(w.xMin, w.yMax),
  ];
}

function lookupId(state: GameState, id: PointId): Pt | null {
  for (const p of state.points) {
    if (p.id === id) {
      return p.pt;
    }
  }
  return null;
}

// Cell centroid (vertex average, exact) — the §11.4 nudge anchor.
export function cellCentroid(cell: ConvexPoly): Pt {
  let sx = Rat.make(0n);
  let sy = Rat.make(0n);
  for (const v of cell) {
    sx = sx.add(v.x);
    sy = sy.add(v.y);
  }
  const n = Rat.make(BigInt(cell.length));
  return pt(sx.div(n), sy.div(n));
}

// effectiveCells: arrangement over route-region supporting lines +
// classifier boundaries(); per-cell hypo-place + classify. A cell whose
// representative is GP-illegal is nudged (bounded dyadic search toward the
// centroid); persistently illegal cells are skipped (counted); any
// undecidable classification is a typed defect (never a blank cell), and a
// boundaries() integrity result yields NO map with the honesty wording.
export function effectiveCells(
  state: GameState,
  def: StrategyDef,
  nodeId: NodeId,
  config: Configuration,
): EffectiveCells {
  const node = nodeOf(def, nodeId);
  if (node.role !== "classify-breaker" || node.routes === undefined) {
    return {
      available: false,
      reason: "not-a-classify-node",
      detail: `${nodeId} is not a classify-breaker node`,
    };
  }
  const lines: ArrLine[] = [];
  // (QA D4 + cell-constancy audit): classifiers are written in the
  // POST-placement frame — "the last point" is the new Breaker point (classify
  // reads it; classifyB3.boundaries drops it; classifyFour's `last-n 4` needs
  // it). Their boundaries must therefore be asked of a probe state carrying a
  // GP-legal stand-in for the new point, and any boundary line that names the
  // stand-in is discarded (such a line moves with the unknown point — it is
  // not a fixed change locus in the new point's plane).
  let probe: { state: GameState; id: PointId } | null = null;
  const probeState = (): { state: GameState; id: PointId } | null => {
    if (probe === null) {
      const ids = `p${state.points.length + 1}`;
      const seeds: Array<[bigint, bigint, bigint]> = [
        [314159n, 7n, 271828n],
        [-523599n, 11n, 161803n],
        [701n, 3n, -97531n],
        [-88888n, 13n, -66666n],
        [424243n, 17n, 123457n],
      ];
      for (const [x, d, y] of seeds) {
        const cand = pt(Rat.make(x, d), Rat.make(y, d));
        if (checkPlacement(state, cand, config.window) === null) {
          probe = { state: placePoint(state, "breaker", cand), id: ids };
          break;
        }
      }
    }
    return probe;
  };
  for (const rule of node.routes) {
    const when = rule.when;
    if (when.kind === "region") {
      const r = evalRegion(when.expr, { state, config, channel: "correctness" });
      if (r.kind === "incomplete") {
        return {
          available: false,
          reason: "undecidable-predicate",
          detail: "a route predicate cannot be decided exactly",
        };
      }
      lines.push(...supportingLines(r.region));
    } else if (when.kind === "classifier") {
      const classifier = getClassifier(when.classifierId);
      if (classifier === undefined) {
        return {
          available: false,
          reason: "unregistered-classifier",
          detail: when.classifierId,
        };
      }
      const pr = probeState();
      if (pr === null) {
        return {
          available: false,
          reason: "undecidable-predicate",
          detail: "no GP-legal stand-in point for the classifier frame",
        };
      }
      const resolved: Record<string, readonly PointId[]> = {};
      if (when.inputs !== undefined) {
        for (const [name, expr] of Object.entries(when.inputs)) {
          const ids = evalPtListIds(expr, pr.state);
          if (ids.kind === "resolution-failure") {
            return {
              available: false,
              reason: "undecidable-predicate",
              detail: `input ${name}: ${ids.reason}`,
            };
          }
          resolved[name] = ids.ids;
        }
      }
      const b = classifier.boundaries(pr.state, resolved, config);
      if (b.kind === "integrity") {
        // §11.5 honesty path: NO map from partial lines; session continues.
        return {
          available: false,
          reason: "boundaries-unavailable",
          detail: `${b.failure.reason}: ${b.failure.detail}`,
        };
      }
      for (const [aId, bId] of b.lines) {
        if (aId === pr.id || bId === pr.id) {
          continue;
        }
        const a = lookupId(state, aId);
        const c = lookupId(state, bId);
        if (a === null || c === null) {
          return {
            available: false,
            reason: "undecidable-predicate",
            detail: "boundary line names unplaced points",
          };
        }
        lines.push({ a, b: c });
      }
    }
  }
  const window = windowPoly(config);
  const cells = arrangementCells(lines, window);
  const nextId = `p${state.points.length + 1}`;
  const grouped = new Map<CaseId, EffectiveCell[]>();
  for (const cell of cells) {
    const rep = canonicalInteriorPoint(cell);
    if (rep === null) {
      continue;
    }
    const centroid = cellCentroid(cell);
    // Bounded GP-nudge search: representative, then dyadic steps toward the
    // centroid (§11.4). Convexity keeps every combo inside the cell.
    const cands: Pt[] = [rep];
    for (let j = 1; j <= 7; j += 1) {
      const t = Rat.make(BigInt(j), 8n);
      cands.push(
        pt(
          rep.x.add(centroid.x.sub(rep.x).mul(t)),
          rep.y.add(centroid.y.sub(rep.y).mul(t)),
        ),
      );
    }
    let candPt: Pt | null = null;
    for (const cand of cands) {
      if (checkPlacement(state, cand, config.window) === null) {
        candPt = cand;
        break;
      }
    }
    if (candPt === null) {
      continue;
    }
    const hypo = placePoint(state, "breaker", candPt);
    const r = classify(def, hypo, nodeId, nextId, config);
    if (!r.ok) {
      return {
        available: false,
        reason: "undecidable-predicate",
        detail: "a cell representative cannot be classified exactly",
      };
    }
    const list = grouped.get(r.case) ?? [];
    list.push({
      poly: cell,
      caseId: r.case,
      area2: polygonArea2(cell).abs(),
    });
    grouped.set(r.case, list);
  }
  const groups = [...grouped.entries()].map(([caseId, groupCells]) => ({
    caseId,
    cells: groupCells.sort((a, b) =>
      a.area2.cmp(b.area2) !== 0
        ? b.area2.cmp(a.area2)
        : 0,
    ),
  }));
  // Canonical group order: declaration order of first appearance... use the
  // def's route order for determinism.
  const order = new Map(node.routes.map((r, i) => [r.case, i]));
  groups.sort(
    (a, b) => (order.get(a.caseId) ?? 999) - (order.get(b.caseId) ?? 999),
  );
  return { available: true, groups };
}

export interface SampleReply {
  readonly caseId: CaseId;
  readonly at: Pt;
}

// sampleForCase: the case's largest-area cell representative (§11.4),
// GP-nudged exactly like effectiveCells. Null = "no representative
// available" (finite, fully specified search — never a guess).
export function sampleForCase(
  state: GameState,
  def: StrategyDef,
  nodeId: NodeId,
  caseId: CaseId,
  config: Configuration,
): SampleReply | null {
  const cells = effectiveCells(state, def, nodeId, config);
  if (!cells.available) {
    return null;
  }
  const group = cells.groups.find((g) => g.caseId === caseId);
  if (group === undefined || group.cells.length === 0) {
    return null;
  }
  for (const cell of group.cells) {
    const rep = canonicalInteriorPoint(cell.poly);
    if (rep === null) {
      continue;
    }
    const centroid = cellCentroid(cell.poly);
    const cands: Pt[] = [rep];
    for (let j = 1; j <= 7; j += 1) {
      const t = Rat.make(BigInt(j), 8n);
      cands.push(
        pt(
          rep.x.add(centroid.x.sub(rep.x).mul(t)),
          rep.y.add(centroid.y.sub(rep.y).mul(t)),
        ),
      );
    }
    for (const cand of cands) {
      if (checkPlacement(state, cand, config.window) === null) {
        return { caseId, at: cand };
      }
    }
  }
  return null;
}
