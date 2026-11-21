// strategy/strategies/k7/preset.ts — the shipped k7 entry preset (§24.0b
// pattern): a convex hexagon plus ONE extra point (7 points: odd count ⇒
// Breaker to move). The extra point sits in the angular region opposite a
// hexagon vertex (beyond two of its edge-lines), so it is NOT in convex
// position with the six — no 7-hole exists yet (P3 passes) — and it lies
// outside the hexagon (the hexagon is the selected 6-hole). It makes the
// parity honest and the "surrounding points do not matter" point concrete.
// Richer starts arrive by promotion from a won k=6 session.
import { Rat } from "../../../geometry/rat.ts";
import { pt } from "../../../geometry/pt.ts";
import type { StrategyStart } from "../../../game/types.ts";

const V = (x: number, y: number) => pt(Rat.make(BigInt(x)), Rat.make(BigInt(y)));

// CCW; the three main chords V0V3, V1V4, V2V5 are NOT concurrent.
export const PRESET_P6 = [
  V(0, 0),
  V(12, -3),
  V(20, 7),
  V(17, 19),
  V(4, 22),
  V(-6, 10),
];
export const PRESET_EXTRA = V(-9, -6);

export function presetSupplied(): StrategyStart {
  return {
    kind: "supplied",
    points: [...PRESET_P6, PRESET_EXTRA],
    selectedHole: [...PRESET_P6],
  };
}
