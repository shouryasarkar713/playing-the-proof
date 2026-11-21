// viz/interaction.ts — DOM-free interaction logic: hover ghosts and exact
// legality halos. Hit-testing is exact rational space throughout: the hover
// threshold (10px) is converted to world units and squared distances are
// compared as Rats — no float geometry anywhere in viz/ outside
// projection.ts (the one-way rule, §17.3).
import { Rat } from "../geometry/rat.ts";
import type { Pt } from "../geometry/pt.ts";
import { checkPlacement } from "../game/legality.ts";
import type {
  GameState,
  PlacedPoint,
  Rejection,
  WindowBounds,
} from "../game/types.ts";
import type { View } from "./projection.ts";
import { screenToWorldExact } from "./projection.ts";
import type { GhostSpec } from "./scene.ts";

export interface HoverResult {
  readonly ghost: GhostSpec;
  readonly hoverPoint: PlacedPoint | null;
}

// Hover at screen (sx, sy): quantized candidate + exact legality + nearest
// placed point within 10px (exact world-space comparison).
export function hoverToGhost(
  sx: number,
  sy: number,
  quantized: Pt,
  state: GameState,
  view: View,
  window: WindowBounds,
): HoverResult {
  const rejection: Rejection | null = checkPlacement(state, quantized, window);
  const cursor = screenToWorldExact(sx, sy, view);
  const maxD = Rat.make(10n).div(view.s);
  const maxD2 = maxD.mul(maxD);
  let hoverPoint: PlacedPoint | null = null;
  let best: Rat | null = null;
  for (const p of state.points) {
    const dx = cursor.x.sub(p.pt.x);
    const dy = cursor.y.sub(p.pt.y);
    const d2 = dx.mul(dx).add(dy.mul(dy));
    if (d2.cmp(maxD2) <= 0 && (best === null || d2.cmp(best) < 0)) {
      best = d2;
      hoverPoint = p;
    }
  }
  return { ghost: { at: quantized, rejection }, hoverPoint };
}
