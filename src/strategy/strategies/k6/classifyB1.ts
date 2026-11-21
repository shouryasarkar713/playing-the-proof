// strategy/strategies/k6/classifyB1.ts — the B1 case classifier (§24.4).
// Classifies WHERE B1 landed against the PRE-B1 twin witnesses (§24.3b
// bindings — never a post-B1 re-enumeration). Reads ONLY its resolved
// inputs (v1.2.6): twinA/twinB (the bound 5-hole id lists), se (the SE
// pair [B0, E]), a1 (the A1 point). B1 itself is the just-placed point —
// the last point of the state (the classifier contract carries no point
// id; same reading as classifyB3). Pure hull/containment arithmetic:
// ignores config; the integrity branch is unreachable by construction
// (noted here, never relied upon — every malformed shape fails closed).
import { hull } from "../../../geometry/hull.ts";
import { sharedTriple } from "../../../geometry/twins.ts";
import { eqPt } from "../../../geometry/pt.ts";
import type { Pt } from "../../../geometry/pt.ts";
import { regionContains } from "../../../geometry/poly.ts";
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

function resolveList(
  state: GameState,
  ids: readonly PointId[] | undefined,
  want: number,
): Pt[] | null {
  if (ids === undefined || ids.length !== want) {
    return null;
  }
  const pts: Pt[] = [];
  for (const id of ids) {
    const p = lookup(state, id);
    if (p === null) {
      return null;
    }
    pts.push(p);
  }
  return pts;
}

// Hull vertices mapped back to ids by exact coordinate equality (robust
// whether or not hull preserves references).
function hullIds(ids: readonly PointId[], pts: readonly Pt[]): PointId[] {
  const h = hull([...pts]);
  return h.map((q) => {
    const at = pts.findIndex((p) => eqPt(p, q));
    return ids[at] as PointId;
  });
}

function bad(detail: string): { kind: "integrity"; failure: { reason: "invalid-result"; detail: string } } {
  return { kind: "integrity", failure: { reason: "invalid-result", detail } };
}

export const classifyB1: ClassifierDef = {
  id: "classifyB1",
  resultTags: ["inside-shared-triangle", "inside-twin", "else"],
  classify(state, inputs, _config) {
    const twinAPts = resolveList(state, inputs["twinA"], 5);
    const twinBPts = resolveList(state, inputs["twinB"], 5);
    const sePts = resolveList(state, inputs["se"], 2);
    const a1Pts = resolveList(state, inputs["a1"], 1);
    if (twinAPts === null || twinBPts === null || sePts === null || a1Pts === null) {
      return bad("classifyB1 requires twinA/twinB (5 ids), se (2 ids), a1 (1 id)");
    }
    // the shared triangle is the one the BOUND twins actually share
    // (select-twin-pair may pick the twins anchored on either pentagon
    // neighbour of E, so hull(B0,E,A1) is not always their intersection).
    const twinIds = [inputs["twinA"], inputs["twinB"]] as readonly (readonly PointId[])[];
    const shared = sharedTriple(
      twinIds[0] as readonly PointId[],
      twinIds[1] as readonly PointId[],
      (id) => lookup(state, id),
    );
    if (shared === null) {
      return bad("classifyB1: twinA/twinB do not share exactly 3 distinct non-collinear vertices");
    }
    const tri = [...shared.tri];
    if (state.points.length < 1) {
      return bad("classifyB1 requires a placed B1 (empty state)");
    }
    const b1 = (state.points[state.points.length - 1] as { pt: Pt }).pt;
    // Inside-or-on (non-strict — boundaries are pair-lines of placed
    // points, hence GP-unreachable; the phrasing keeps it total).
    if (regionContains({ kind: "poly", verts: tri }, b1, false)) {
      return { kind: "classified", result: { tag: "inside-shared-triangle" } };
    }
    for (const [tag, ids, pts] of [
      ["twinA", inputs["twinA"], twinAPts],
      ["twinB", inputs["twinB"], twinBPts],
    ] as const) {
      const hp = hull([...pts]);
      if (hp.length !== 5) {
        return bad(`classifyB1: ${tag} is not a 5-hole hull`);
      }
      if (regionContains({ kind: "poly", verts: hp }, b1, false)) {
        return { kind: "classified", result: { tag: "inside-twin", bindings: { twin: [...(ids as readonly PointId[])] } } };
      }
    }
    return { kind: "classified", result: { tag: "else" } };
  },
  boundaries(state, inputs, _config) {
    const twinA = inputs["twinA"];
    const twinB = inputs["twinB"];
    const se = inputs["se"];
    const a1 = inputs["a1"];
    if (
      twinA === undefined || twinA.length !== 5 ||
      twinB === undefined || twinB.length !== 5 ||
      se === undefined || se.length !== 2 ||
      a1 === undefined || a1.length !== 1
    ) {
      return bad("classifyB1 boundaries require twinA/twinB (5), se (2), a1 (1)");
    }
    const resolve = (ids: readonly PointId[]): Pt[] | null => {
      const pts: Pt[] = [];
      for (const id of ids) {
        const p = lookup(state, id);
        if (p === null) {
          return null;
        }
        pts.push(p);
      }
      return pts;
    };
    const twinAPts = resolve(twinA);
    const twinBPts = resolve(twinB);
    const sePts = resolve(se);
    const a1Pts = resolve(a1);
    if (twinAPts === null || twinBPts === null || sePts === null || a1Pts === null) {
      return bad("classifyB1 boundaries name unplaced points");
    }
    // Pair-lines of {B0, E, A1} ∪ supporting lines of the twin hulls.
    const lines: [PointId, PointId][] = [];
    const seen = new Set<string>();
    const push = (a: PointId, b: PointId): void => {
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (!seen.has(key)) {
        seen.add(key);
        lines.push([a, b]);
      }
    };
    // the shared triangle's pair-lines come from the BOUND twins (the
    // classification triangle), not from hull(B0,E,A1) — they can differ.
    const sharedTri = sharedTriple(
      twinA,
      twinB,
      (id) => lookup(state, id),
    );
    if (sharedTri === null) {
      return bad("classifyB1 boundaries: twinA/twinB do not share exactly 3 distinct non-collinear vertices");
    }
    const triIds = [...sharedTri.ids];
    for (let i = 0; i < triIds.length; i += 1) {
      for (let j = i + 1; j < triIds.length; j += 1) {
        push(triIds[i] as PointId, triIds[j] as PointId);
      }
    }
    for (const [ids, pts] of [
      [twinA, twinAPts],
      [twinB, twinBPts],
    ] as const) {
      const h = hullIds(ids, pts);
      for (let i = 0; i < h.length; i += 1) {
        push(h[i] as PointId, h[(i + 1) % h.length] as PointId);
      }
    }
    lines.sort((a, b) =>
      a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1,
    );
    return { kind: "ok", lines };
  },
};
