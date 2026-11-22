// strategy/strategies/k8/preset.ts — the shipped k8 entry preset: a bare convex
// heptagon (7 points, odd count ⇒ Breaker to move; the three chord families are
// generic, no three points collinear). The guided tour starts here; a start from
// the 15-point result of a Lemma 6–8 chain exceeds the exact bootstrap bound
// (N_BOOTSTRAP_EXACT = 12), so promotion from k=7 is not offered.
import { Rat } from "../../../geometry/rat.ts";
import { pt } from "../../../geometry/pt.ts";
import type { StrategyStart } from "../../../game/types.ts";

const V = (x: number, y: number) => pt(Rat.make(BigInt(x)), Rat.make(BigInt(y)));

// CCW; labelled A..G in the paper's Figure 3.
export const PRESET_P7 = [
  V(0, 0),
  V(14, -4),
  V(26, 6),
  V(28, 20),
  V(18, 31),
  V(4, 29),
  V(-5, 14),
];

export function presetSupplied(): StrategyStart {
  return { kind: "supplied", points: [...PRESET_P7], selectedHole: [...PRESET_P7] };
}
