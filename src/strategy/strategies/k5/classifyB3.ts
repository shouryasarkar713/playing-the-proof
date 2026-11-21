// strategy/strategies/k5/classifyB3.ts — the B3 case-labeling classifier
// (§23.4). Both cases route to the same node; the guarantee is the post
// invariant (exists-4-hole), not the branching. Pure, total; the failure
// channel is the RETURN VALUE (no throws, no node context).
import { findKHoles } from "../../../geometry/holes.ts";
import { hull } from "../../../geometry/hull.ts";
import { regionContains } from "../../../geometry/poly.ts";
import type { Pt } from "../../../geometry/pt.ts";
import type { GameState, PointId } from "../../../game/types.ts";
import type { ClassifierDef } from "../../types.ts";

function lookup(state: GameState, id: PointId): Pt | null {
  for (const p of state.points) {
    if (p.id === id) {
      return p.pt;
    }
  }
  return null;
}

// The pre-B3 4-hole enumeration (§23.4): the five points before B3 with an
// explicit exhaustive budget. Budget-exhausted ⇒ undecidable (typed
// failure — never a fake tag).
function preB3Holes(
  state: GameState,
  restIds: readonly PointId[],
  budget: number,
): ReturnType<typeof findKHoles> {
  return findKHoles(
    restIds.map((id) => ({ id, pt: lookup(state, id) as Pt })),
    4,
    { mode: "exhaustive", budget },
  );
}

export const classifyB3: ClassifierDef = {
  id: "classifyB3",
  resultTags: ["blocked-intended", "else"],
  classify(state, _inputs, config) {
    if (state.points.length < 1) {
      return {
        kind: "integrity",
        failure: {
          reason: "invalid-result",
          detail: "classifyB3 requires a placed B3 (empty state)",
        },
      };
    }
    // B3 is the just-placed point: the last point of the state. The
    // classifier contract carries no point id, so "last" is the reading
    // (§23.4: "findKHoles(points ∖ {B3}, 4, …)").
    const b3 = state.points[state.points.length - 1] as {
      id: PointId;
      pt: Pt;
    };
    const restIds = state.points
      .slice(0, state.points.length - 1)
      .map((p) => p.id);
    const pre = preB3Holes(state, restIds, config.analysis.budgetOps);
    if (pre.kind === "budget-exhausted") {
      return {
        kind: "integrity",
        failure: {
          reason: "undecidable-computation",
          detail:
            "the pre-B3 4-hole enumeration was budget-exhausted; " +
            "the classification is undecidable",
          analysis: pre,
        },
      };
    }
    if (pre.kind !== "exhaustive") {
      return {
        kind: "integrity",
        failure: {
          reason: "undecidable-computation",
          detail: "the pre-B3 4-hole enumeration is not exhaustive",
          analysis: pre,
        },
      };
    }
    for (const h of pre.holes) {
      const verts: Pt[] = [];
      let ok = true;
      for (const id of h.verts) {
        const p = lookup(state, id);
        if (p === null) {
          ok = false;
          break;
        }
        verts.push(p);
      }
      if (!ok) {
        continue;
      }
      // Inside-or-on (non-strict — §23.4's "inside-or-on hull(H)").
      if (regionContains({ kind: "poly", verts: hull(verts) }, b3.pt, false)) {
        return { kind: "classified", result: { tag: "blocked-intended" } };
      }
    }
    return { kind: "classified", result: { tag: "else" } };
  },
  boundaries(state, _inputs, config) {
    if (state.points.length < 1) {
      return {
        kind: "integrity",
        failure: {
          reason: "invalid-result",
          detail: "classifyB3 boundaries require a placed B3 (empty state)",
        },
      };
    }
    const restIds = state.points
      .slice(0, state.points.length - 1)
      .map((p) => p.id);
    const pre = preB3Holes(state, restIds, config.analysis.budgetOps);
    if (pre.kind !== "exhaustive") {
      return {
        kind: "integrity",
        failure: {
          reason: "undecidable-computation",
          detail:
            "the pre-B3 4-hole boundary enumeration was budget-exhausted",
          analysis: pre,
        },
      };
    }
    // Pair-lines of the five pre-B3 points ∪ supporting lines of their
    // 4-holes (the SAME explicit enumeration as classify).
    const lines: [PointId, PointId][] = [];
    const seen = new Set<string>();
    const push = (a: PointId, b: PointId): void => {
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (!seen.has(key)) {
        seen.add(key);
        lines.push([a, b]);
      }
    };
    for (let i = 0; i < restIds.length; i += 1) {
      for (let j = i + 1; j < restIds.length; j += 1) {
        push(restIds[i] as PointId, restIds[j] as PointId);
      }
    }
    for (const h of pre.holes) {
      const vs = h.verts;
      for (let i = 0; i < vs.length; i += 1) {
        push(vs[i] as PointId, vs[(i + 1) % vs.length] as PointId);
      }
    }
    lines.sort((a, b) =>
      a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1,
    );
    return { kind: "ok", lines };
  },
};
