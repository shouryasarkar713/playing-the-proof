// strategy/strategies/k8/classify.ts — the exact Breaker-response classifiers
// of the k=8 guided tour. Each reads ONLY its resolved inputs and the placed
// points (the just-placed Breaker point is the last point); pure exact
// arithmetic; every malformed shape fails closed (integrity).
//
//   classifyB0Hept   B0 against the starting 7-hole: outside | pair | no-pair
//   classifyB3Obs2   B3 against the position after A3: seven-hole | vertex-pair
//                    | no-pair (Observation 2's "two 6-holes sharing exactly one
//                    vertex" with disjoint interiors, enumerated)
//   classifyB4Sevens B4 against the two bound 7-holes
import { findKHoles } from "../../../geometry/holes.ts";
import type { KHole } from "../../../geometry/holes.ts";
import { hull } from "../../../geometry/hull.ts";
import { insideConvex } from "../../../geometry/poly.ts";
import type { Pt } from "../../../geometry/pt.ts";
import { heptagonPair, interiorsDisjoint } from "../../../geometry/twinsK8.ts";
import type { GameState, PointId } from "../../../game/types.ts";
import type { ClassifierDef } from "../../types.ts";

function lookup(state: GameState, id: PointId): Pt | null {
  return state.points.find((p) => p.id === id)?.pt ?? null;
}

function bad(detail: string): {
  kind: "integrity";
  failure: { reason: "invalid-result"; detail: string };
} {
  return { kind: "integrity", failure: { reason: "invalid-result", detail } };
}

function resolveAll(state: GameState, ids: readonly PointId[]): Pt[] | null {
  const out: Pt[] = [];
  for (const id of ids) {
    const p = lookup(state, id);
    if (p === null) {
      return null;
    }
    out.push(p);
  }
  return out;
}

function pairLines(ids: readonly PointId[]): [PointId, PointId][] {
  const out: [PointId, PointId][] = [];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      out.push([ids[i] as PointId, ids[j] as PointId]);
    }
  }
  return out;
}

export const classifyB0Hept: ClassifierDef = {
  id: "classifyB0Hept",
  resultTags: ["outside", "pair", "no-pair"],
  classify(state, inputs, _config) {
    const hole = inputs["hole"];
    if (hole === undefined || hole.length !== 7 || state.points.length < 1) {
      return bad("classifyB0Hept requires hole (7 ids) and a placed B0");
    }
    const ring = resolveAll(state, hole);
    if (ring === null) {
      return bad("classifyB0Hept: hole names unplaced points");
    }
    const h = hull([...ring]);
    if (h.length !== 7) {
      return bad("classifyB0Hept: hole is not a convex 7-gon");
    }
    const b0Point = state.points[state.points.length - 1] as GameState["points"][number];
    if (!insideConvex(h, b0Point.pt, true)) {
      return { kind: "classified", result: { tag: "outside" } };
    }
    // The pair search runs over the CCW id order (hull order of the hole).
    const ccw = h.map((q) => hole[ring.findIndex((p) => p.x.equals(q.x) && p.y.equals(q.y))] as PointId);
    const sel = heptagonPair(
      ccw,
      b0Point.id,
      (id) => lookup(state, id),
      state.points.map((p) => p.pt),
    );
    return {
      kind: "classified",
      result: { tag: sel === null ? "no-pair" : "pair" },
    };
  },
  boundaries(state, inputs, _config) {
    const hole = inputs["hole"];
    if (hole === undefined || hole.length !== 7) {
      return bad("classifyB0Hept boundaries require hole (7 ids)");
    }
    const ring = resolveAll(state, hole);
    if (ring === null) {
      return bad("classifyB0Hept boundaries name unplaced points");
    }
    // Class changes only across the 7 hull edges and the 7 chords V_i V_{i+3}
    // (the 4-hole membership of B0); the hole var is CCW from the bootstrap.
    const lines: [PointId, PointId][] = [];
    const seen = new Set<string>();
    for (let i = 0; i < 7; i += 1) {
      for (const d of [1, 3]) {
        const a = hole[i] as PointId;
        const b = hole[(i + d) % 7] as PointId;
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (!seen.has(key)) {
          seen.add(key);
          lines.push([a, b]);
        }
      }
    }
    return { kind: "ok", lines };
  },
};

export const classifyB3Obs2: ClassifierDef = {
  id: "classifyB3Obs2",
  resultTags: ["seven-hole", "vertex-pair", "no-pair"],
  classify(state, _inputs, config) {
    const idpts = state.points.map((p) => ({ id: p.id, pt: p.pt }));
    const sev = findKHoles(idpts, 7, { mode: "exhaustive", budget: config.analysis.budgetOps });
    if (sev.kind !== "exhaustive") {
      return {
        kind: "integrity",
        failure: { reason: "undecidable-computation", detail: "7-hole enumeration budget-exhausted", analysis: sev },
      };
    }
    if (sev.holes.length > 0) {
      return { kind: "classified", result: { tag: "seven-hole" } };
    }
    const six = findKHoles(idpts, 6, { mode: "exhaustive", budget: config.analysis.budgetOps });
    if (six.kind !== "exhaustive") {
      return {
        kind: "integrity",
        failure: { reason: "undecidable-computation", detail: "6-hole enumeration budget-exhausted", analysis: six },
      };
    }
    const hs: readonly KHole[] = six.holes;
    for (let i = 0; i < hs.length; i += 1) {
      for (let j = i + 1; j < hs.length; j += 1) {
        const a = (hs[i] as KHole).verts;
        const b = (hs[j] as KHole).verts;
        if (a.filter((v) => b.includes(v)).length !== 1) {
          continue;
        }
        const pa = resolveAll(state, a);
        const pb = resolveAll(state, b);
        if (pa !== null && pb !== null && interiorsDisjoint(pa, pb)) {
          return { kind: "classified", result: { tag: "vertex-pair" } };
        }
      }
    }
    return { kind: "classified", result: { tag: "no-pair" } };
  },
  boundaries(_state, _inputs, _config) {
    // The class changes across lines through ANY two placed points and the
    // just-placed point; an exact bounded case map is not offered here.
    return bad("classifyB3Obs2: no bounded boundary set (case map unavailable by design)");
  },
};

export const classifyB4Sevens: ClassifierDef = {
  id: "classifyB4Sevens",
  resultTags: ["inside-seven-A", "inside-seven-B", "else"],
  classify(state, inputs, _config) {
    const a = inputs["holeA"];
    const b = inputs["holeB"];
    if (a === undefined || a.length !== 7 || b === undefined || b.length !== 7 || state.points.length < 1) {
      return bad("classifyB4Sevens requires holeA/holeB (7 ids each) and a placed B4");
    }
    const pa = resolveAll(state, a);
    const pb = resolveAll(state, b);
    if (pa === null || pb === null) {
      return bad("classifyB4Sevens: holes name unplaced points");
    }
    const b4 = (state.points[state.points.length - 1] as GameState["points"][number]).pt;
    const ha = hull([...pa]);
    const hb = hull([...pb]);
    if (ha.length !== 7 || hb.length !== 7) {
      return bad("classifyB4Sevens: bound holes are not convex 7-gons");
    }
    if (insideConvex(ha, b4, false)) {
      return { kind: "classified", result: { tag: "inside-seven-A" } };
    }
    if (insideConvex(hb, b4, false)) {
      return { kind: "classified", result: { tag: "inside-seven-B" } };
    }
    return { kind: "classified", result: { tag: "else" } };
  },
  boundaries(state, inputs, _config) {
    const a = inputs["holeA"];
    const b = inputs["holeB"];
    if (a === undefined || a.length !== 7 || b === undefined || b.length !== 7) {
      return bad("classifyB4Sevens boundaries require holeA/holeB");
    }
    const lines: [PointId, PointId][] = [];
    const seen = new Set<string>();
    for (const ids of [a, b]) {
      const pts = resolveAll(state, ids);
      if (pts === null) {
        return bad("classifyB4Sevens boundaries name unplaced points");
      }
      const h = hull([...pts]);
      const hIds = h.map((q) => ids[pts.findIndex((p) => p.x.equals(q.x) && p.y.equals(q.y))] as PointId);
      for (let i = 0; i < hIds.length; i += 1) {
        const u = hIds[i] as PointId;
        const v = hIds[(i + 1) % hIds.length] as PointId;
        const key = u < v ? `${u}|${v}` : `${v}|${u}`;
        if (!seen.has(key)) {
          seen.add(key);
          lines.push([u, v]);
        }
      }
    }
    void pairLines;
    return { kind: "ok", lines };
  },
};
