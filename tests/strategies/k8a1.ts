// tests/strategies/k8a1.ts — exact analysis of the first Maker reply (A1) of the
// k=8 walkthrough. Admissibility is decided over the WHOLE plane: the predicate
// "A1 = x makes two 6-holes through x that meet exactly in a triangle with x and
// B0 among its vertices (an ear of both)" depends only on the orientation of x
// with respect to the lines through pairs of the already placed points, so it is
// constant on the cells of that line arrangement. One exact representative per
// cell therefore decides existence exhaustively (bounded and unbounded cells).
import { findNewKHoles } from "../../src/geometry/holes.ts";
import type { IdPt } from "../../src/geometry/holes.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { checkPlacement } from "../../src/game/legality.ts";
import type { GameState } from "../../src/game/types.ts";
import type { RuntimeCtx } from "../../src/engine/orchestrator.ts";
import { twinTriangleEars } from "../../src/geometry/twinsK8.ts";
import { cellReps } from "./k8tree.ts";

export interface A1Witness {
  x: Pt;
  twinA: readonly string[];
  twinB: readonly string[];
  triangle: readonly string[];
}

// State = after B0 (B0 is the last placed point, id given).
export function admissibleA1(
  state: GameState,
  b0Id: string,
  x: Pt,
  ctx: RuntimeCtx,
): A1Witness | null {
  if (checkPlacement(state, x, ctx.config.window) !== null) {
    return null;
  }
  const newId = `p${state.points.length + 1}`;
  const ids: IdPt[] = [...state.points.map((p) => ({ id: p.id, pt: p.pt })), { id: newId, pt: x }];
  const ptOf = (id: string): Pt | null => ids.find((q) => q.id === id)?.pt ?? null;
  const news = findNewKHoles(ids, 6, newId).holes;
  for (let i = 0; i < news.length; i += 1) {
    for (let j = i + 1; j < news.length; j += 1) {
      const a = news[i]?.verts ?? [];
      const b = news[j]?.verts ?? [];
      const t = twinTriangleEars(a, b, [newId, b0Id], ptOf);
      if (t !== null) {
        return { x, twinA: a, twinB: b, triangle: t.triIds };
      }
    }
  }
  return null;
}

export interface A1Census {
  cells: number;
  admissible: number;
  witnesses: A1Witness[];
}

// Exhaustive over the cells of the pair-line arrangement of the placed points.
export function a1Census(state: GameState, b0Id: string, ctx: RuntimeCtx, keep = 3): A1Census {
  const reps = cellReps(
    state.points.map((p) => p.pt),
    ctx,
  );
  const out: A1Census = { cells: reps.length, admissible: 0, witnesses: [] };
  for (const x of reps) {
    const w = admissibleA1(state, b0Id, x, ctx);
    if (w !== null) {
      out.admissible += 1;
      if (out.witnesses.length < keep) {
        out.witnesses.push(w);
      }
    }
  }
  return out;
}
