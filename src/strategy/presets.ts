// strategy/presets.ts — the shipped entry records (StrategyStart) per
// strategy whose entry is a classify-breaker node. Data-driven bridge for the
// entry chooser (ui/ never imports strategy/): `presetStartFor(id)` returns the
// record, or undefined for strategies that start from an empty board.
import type { StrategyStart } from "../game/types.ts";
import { presetSupplied as k6Preset } from "./strategies/k6/preset.ts";
import { presetSupplied as k7Preset } from "./strategies/k7/preset.ts";

export function presetStartFor(strategyId: string): StrategyStart | undefined {
  if (strategyId === "esmb-k6" || strategyId === "esmb-k6-wide") {
    return k6Preset();
  }
  if (strategyId === "esmb-k7") {
    return k7Preset();
  }
  return undefined;
}

// Strategies whose session may start WITHOUT an explicit record (the engine
// falls back to the shipped preset). esmb-k6 keeps its explicit-record
// contract (entry chooser / promotion supply it).
export function defaultStartFor(strategyId: string): StrategyStart | undefined {
  return strategyId === "esmb-k7" ? k7Preset() : undefined;
}
