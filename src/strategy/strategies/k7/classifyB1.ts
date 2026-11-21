// strategy/strategies/k7/classifyB1.ts — the Lemma 8 B1 classifier.
// Classifies WHERE B1 landed against the PRE-B1 twin 6-holes (bound by
// select-twin-holes — never a post-B1 re-enumeration). Inputs: twinA/twinB
// (6 ids each), a1 and b0 (1 id each). B1 is the just-placed (last) point.
// Pure hull/containment arithmetic; ignores config. Every malformed shape
// fails closed (integrity), never a guessed tag.
//
// Tags (checked in this order):
//   inside-ear-A   B1 in the ear triangle of twin A at its quadrilateral apex
//   inside-ear-B   B1 in the ear triangle of twin B at its apex
//                  (the two ears are exactly the two halves of the shared
//                  quadrilateral cut by the diagonal A1–B0: B1 in the shared
//                  quadrilateral kills BOTH twins but is an ear of one of them,
//                  so replacing that apex by B1 gives a new 6-hole)
//   inside-twin-A  B1 in twin A only (twin B survives untouched)
//   inside-twin-B  B1 in twin B only (twin A survives untouched)
//   else           B1 in neither twin (both survive)
import { hull } from "../../../geometry/hull.ts";
import { twinQuadEars } from "../../../geometry/twinsK7.ts";
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

function bad(detail: string): {
  kind: "integrity";
  failure: { reason: "invalid-result"; detail: string };
} {
  return { kind: "integrity", failure: { reason: "invalid-result", detail } };
}

function resolveAll(
  state: GameState,
  ids: readonly PointId[],
): Pt[] | null {
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

function shape(
  inputs: Readonly<Record<string, readonly PointId[]>>,
):
  | {
      twinA: readonly PointId[];
      twinB: readonly PointId[];
      a1: PointId;
      b0: PointId;
    }
  | null {
  const twinA = inputs["twinA"];
  const twinB = inputs["twinB"];
  const a1 = inputs["a1"];
  const b0 = inputs["b0"];
  if (
    twinA === undefined ||
    twinA.length !== 6 ||
    twinB === undefined ||
    twinB.length !== 6 ||
    a1 === undefined ||
    a1.length !== 1 ||
    b0 === undefined ||
    b0.length !== 1
  ) {
    return null;
  }
  return { twinA, twinB, a1: a1[0] as PointId, b0: b0[0] as PointId };
}

export const classifyB1Hex: ClassifierDef = {
  id: "classifyB1Hex",
  resultTags: [
    "inside-ear-A",
    "inside-ear-B",
    "inside-twin-A",
    "inside-twin-B",
    "else",
  ],
  classify(state, inputs, _config) {
    const sh = shape(inputs);
    if (sh === null) {
      return bad(
        "classifyB1Hex requires twinA/twinB (6 ids), a1 (1 id), b0 (1 id)",
      );
    }
    const ptOf = (id: PointId): Pt | null => lookup(state, id);
    const t = twinQuadEars(sh.twinA, sh.twinB, [sh.a1, sh.b0], ptOf);
    if (t === null) {
      return bad(
        "classifyB1Hex: twinA/twinB are not exact quad-twins for (a1, b0)",
      );
    }
    if (state.points.length < 1) {
      return bad("classifyB1Hex requires a placed B1 (empty state)");
    }
    const b1 = (state.points[state.points.length - 1] as { pt: Pt }).pt;
    if (regionContains({ kind: "poly", verts: [...t.earA.tri] }, b1, false)) {
      return {
        kind: "classified",
        result: {
          tag: "inside-ear-A",
          bindings: { apex: t.earA.apex, twin: [...sh.twinA] },
        },
      };
    }
    if (regionContains({ kind: "poly", verts: [...t.earB.tri] }, b1, false)) {
      return {
        kind: "classified",
        result: {
          tag: "inside-ear-B",
          bindings: { apex: t.earB.apex, twin: [...sh.twinB] },
        },
      };
    }
    for (const [tag, ids] of [
      ["inside-twin-A", sh.twinA],
      ["inside-twin-B", sh.twinB],
    ] as const) {
      const pts = resolveAll(state, ids);
      if (pts === null) {
        return bad("classifyB1Hex: twin names unplaced points");
      }
      const h = hull([...pts]);
      if (h.length !== 6) {
        return bad(`classifyB1Hex: ${tag} twin is not a 6-hole hull`);
      }
      if (regionContains({ kind: "poly", verts: h }, b1, false)) {
        return {
          kind: "classified",
          result: { tag, bindings: { twin: [...ids] } },
        };
      }
    }
    return { kind: "classified", result: { tag: "else" } };
  },
  boundaries(state, inputs, _config) {
    const sh = shape(inputs);
    if (sh === null) {
      return bad(
        "classifyB1Hex boundaries require twinA/twinB (6), a1 (1), b0 (1)",
      );
    }
    const ptOf = (id: PointId): Pt | null => lookup(state, id);
    const t = twinQuadEars(sh.twinA, sh.twinB, [sh.a1, sh.b0], ptOf);
    if (t === null) {
      return bad(
        "classifyB1Hex boundaries: twinA/twinB are not exact quad-twins",
      );
    }
    const lines: [PointId, PointId][] = [];
    const seen = new Set<string>();
    const push = (a: PointId, b: PointId): void => {
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (!seen.has(key)) {
        seen.add(key);
        lines.push([a, b]);
      }
    };
    // The shared quadrilateral's pair-lines (sides + both diagonals).
    for (let i = 0; i < t.quadIds.length; i += 1) {
      for (let j = i + 1; j < t.quadIds.length; j += 1) {
        push(t.quadIds[i] as PointId, t.quadIds[j] as PointId);
      }
    }
    // Supporting lines of both twin hulls.
    for (const ids of [sh.twinA, sh.twinB]) {
      const pts = resolveAll(state, ids);
      if (pts === null) {
        return bad("classifyB1Hex boundaries name unplaced points");
      }
      const h = hull([...pts]);
      const hIds = h.map((q) => {
        const at = pts.findIndex((p) => eqPt(p, q));
        return ids[at] as PointId;
      });
      for (let i = 0; i < hIds.length; i += 1) {
        push(hIds[i] as PointId, hIds[(i + 1) % hIds.length] as PointId);
      }
    }
    lines.sort((a, b) =>
      a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1,
    );
    return { kind: "ok", lines };
  },
};
