// strategy/strategies/k6/preset.ts — the shipped k6 entry preset (§24.0b):
// a bare convex pentagon (5 points, odd count ⇒ Breaker to move; the
// pentagon itself is trivially the selected 5-hole; no 6-hole can exist
// among 5 points, so P3 passes vacuously). The entry chooser starts k6
// sessions from this supplied record; richer starts arrive via promotion.
import { Rat } from "../../../geometry/rat.ts";
import { pt } from "../../../geometry/pt.ts";
import type { StrategyStart } from "../../../game/types.ts";

const V = (x: number, y: number) => pt(Rat.make(BigInt(x)), Rat.make(BigInt(y)));

export const PRESET_P5 = [V(0, 0), V(10, 0), V(13, 8), V(5, 13), V(-3, 8)];

export function presetSupplied(): StrategyStart {
  return {
    kind: "supplied",
    points: [...PRESET_P5],
    selectedHole: [...PRESET_P5],
  };
}
