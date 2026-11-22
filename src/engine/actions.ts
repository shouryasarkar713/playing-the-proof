// engine/actions.ts — intent construction (§10.9 buildIntent).
//
// Maps a UserAction to an exact placement candidate or a typed Rejection per
// the §4.4 ladder order (window → coincidence → collinearity). The [UI]
// separation tag is attached by the ui caller for user clicks, never here
// and never for constructions. A Proof-mode `sample` resolves to a Breaker
// placement at its point (§5.5; case validation is Proof-mode/Phase-10).
import { checkPlacement } from "../game/legality.ts";
import type {
  GameState,
  Intent,
  UserAction,
} from "../game/types.ts";
import type { RuntimeCtx } from "./orchestrator.ts";

export function buildIntent(
  state: GameState,
  action: UserAction,
  ctx: RuntimeCtx,
): Intent {
  // ctx is explicit — the window is session configuration (§10.9 audit
  // clause (b): configuration is always an explicit parameter wherever a
  // window is consumed).
  const owner = action.kind === "place" ? action.owner : "breaker";
  // terminal states never receive placements (§3.13), and guided
  // sessions accept only Breaker-owned placements (Maker's moves are the
  // engine's). Sandbox owners are free by design.
  if (state.terminal !== null) {
    return {
      kind: "rejected",
      reason: { reason: "wrong-turn", at: action.at, detail: "game-over" },
    };
  }
  // §5.8/§29: the engine's placement cap (config.engine.maxPoints, 64) bounds
  // every enumeration estimate; it was declared but never enforced.
  if (state.points.length >= ctx.config.engine.maxPoints) {
    return {
      kind: "rejected",
      reason: { reason: "wrong-turn", at: action.at, detail: "point-cap" },
    };
  }
  if (state.mode !== "sandbox" && owner !== "breaker") {
    return {
      kind: "rejected",
      reason: { reason: "wrong-turn", at: action.at, detail: "not-breaker" },
    };
  }
  // Biased sessions enforce the bias turn order (game/turnorder.ts): only
  // the player to move may place. 1:1 sandbox sessions keep free owners.
  if (state.bias !== undefined && owner !== state.turn) {
    return {
      kind: "rejected",
      reason: { reason: "wrong-turn", at: action.at, detail: "out-of-turn" },
    };
  }
  const rejection = checkPlacement(state, action.at, ctx.config.window);
  if (rejection !== null) {
    return { kind: "rejected", reason: rejection };
  }
  return { kind: "placement", owner, at: action.at };
}
