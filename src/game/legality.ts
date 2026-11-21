// game/legality.ts — the §4.4 mathematical legality ladder (window,
// coincidence, collinearity — in that order, first failure reported).
// The [UI] separation rung (minSeparationPx) is a ui-layer affordance and is
// never applied here or to engine constructions (§4.4).
import { eqPt } from "../geometry/pt.ts";
import type { Pt } from "../geometry/pt.ts";
import { orient } from "../geometry/predicates.ts";
import type { GameState, Rejection, WindowBounds } from "./types.ts";

// First-failure legality check; null = legal. Pure, total. Owner-agnostic:
// mathematical legality never depends on who places (§4.1 item 4).
export function checkPlacement(
  state: GameState,
  at: Pt,
  window: WindowBounds,
): Rejection | null {
  if (
    window.xMin.cmp(at.x) > 0 ||
    at.x.cmp(window.xMax) > 0 ||
    window.yMin.cmp(at.y) > 0 ||
    at.y.cmp(window.yMax) > 0
  ) {
    return { reason: "outside-window", at };
  }
  for (const q of state.points) {
    if (eqPt(q.pt, at)) {
      return { reason: "coincides-with-existing-point", at, with: q.id };
    }
  }
  const pts = state.points;
  for (let i = 0; i < pts.length; i += 1) {
    for (let j = i + 1; j < pts.length; j += 1) {
      const a = pts[i] as (typeof pts)[number];
      const b = pts[j] as (typeof pts)[number];
      if (orient(a.pt, b.pt, at) === 0) {
        return { reason: "collinear-with", at, pair: [a.id, b.id] };
      }
    }
  }
  return null;
}
