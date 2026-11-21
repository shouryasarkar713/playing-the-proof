// engine/pipeline.ts — the §10.1 pure computation, Phase-7 scope: the
// mode-aware win check. Routing/chain/verification/explanation assembly
// activate with strategy/ + verification/ in Phase 9.
import type { HoleAnalysis, KHole } from "../geometry/holes.ts";
import type { GameState, PointId } from "../game/types.ts";
import { analyzeWinHoles, findNewWinHoles } from "../game/gamemode.ts";
import type { RuntimeCtx } from "./orchestrator.ts";

export type WinCheck =
  | { kind: "win"; holes: readonly KHole[]; analysis: HoleAnalysis }
  | { kind: "no-win" }
  | { kind: "incomplete" };

// detectWinAfterPlacement (§7.3) — the ONE mode-aware win check. Guided:
// the exact incremental detector (precondition: the prior committed state
// was verified k-hole-free — maintained because guided sessions terminate
// at the first k-hole). Sandbox: the budgeted full analysis (win here never
// terminates — surfaced as an analysis-note diagnostic, §14.1).
//
// Game-mode aware: under the bichromatic rule only Maker's points are hole
// vertices (game/gamemode.ts); a Breaker placement therefore never wins.
// Monochromatic states take the unrestricted detectors with the arguments
// they always had.
export function detectWinAfterPlacement(
  state: GameState,
  placement: PointId,
  ctx: RuntimeCtx,
): WinCheck {
  if (state.mode === "sandbox") {
    const analysis = analyzeWinHoles(state, state.k, {
      budget: ctx.config.analysis.budgetOps,
    });
    if (analysis.kind === "exhaustive") {
      return analysis.holes.length > 0
        ? { kind: "win", holes: analysis.holes, analysis }
        : { kind: "no-win" };
    }
    if (analysis.kind === "witness-only") {
      return { kind: "win", holes: [analysis.witness], analysis };
    }
    return { kind: "incomplete" };
  }
  const { holes } = findNewWinHoles(state, state.k, placement);
  if (holes.length > 0) {
    // Complete by the maintained precondition — the synthesized exhaustive
    // record states exactly what a full sweep would return (never a claim
    // beyond it: the list IS the complete k-hole set of this state).
    return {
      kind: "win",
      holes,
      analysis: { kind: "exhaustive", k: state.k, holes },
    };
  }
  return { kind: "no-win" };
}
