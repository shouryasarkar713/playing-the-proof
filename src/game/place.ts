// game/place.ts — the immutable placement transition + the game-layer
// state-invariant check (I1–I4 + I5a — the strategy-independent set, §5.2).
import { gp } from "../geometry/predicates.ts";
import type { Pt } from "../geometry/pt.ts";
import {
  deepFreeze,
} from "./types.ts";
import { checkTerminalWitness } from "./gamemode.ts";
import type {
  GameState,
  Player,
  PointId,
} from "./types.ts";

const DEV: boolean =
  (import.meta as unknown as { env?: { DEV?: unknown } }).env?.DEV !==
  false;

// placedId (§10.9): the most recently placed point's id. Throws on empty —
export function placedId(state: GameState): PointId {
  const last = state.points[state.points.length - 1];
  if (last === undefined) {
    throw new Error("placedId: state has no points — implementation error");
  }
  return last.id;
}

// placePoint (§10.9): new points array (id `p{n+1}`, move n+1), turn flipped
// (Maker first: even length ⇒ maker to move), seq preserved (§5.5).
// Legality pre-verified by the caller (§4.4); dev-asserts the invariants.
export function placePoint(
  state: GameState,
  owner: Player,
  pt: Pt,
): GameState {
  if (state.terminal !== null) {
    throw new Error("placePoint: state is terminal — implementation error");
  }
  const n = state.points.length;
  const next: GameState = {
    ...state,
    points: [
      ...state.points,
      { id: `p${n + 1}`, owner, pt, move: n + 1 },
    ],
    turn: (n + 1) % 2 === 0 ? "maker" : "breaker",
  };
  if (DEV) {
    const check = checkStateInvariants(next);
    if (!check.ok) {
      throw new Error(
        `placePoint: invariant ${check.violated} violated — implementation error (${check.detail})`,
      );
    }
  }
  return deepFreeze(next);
}

export type InvariantCheck =
  | { ok: true }
  | {
      ok: false;
      violated: "i1" | "i2" | "i3" | "i4" | "i5a" | "i6";
      detail: string;
    };

// checkStateInvariants (§10.9): I1–I4 + I5a from GameState alone.
export function checkStateInvariants(state: GameState): InvariantCheck {
  for (let i = 0; i < state.points.length; i += 1) {
    const p = state.points[i] as (typeof state.points)[number];
    if (p.move !== i + 1 || p.id !== `p${i + 1}`) {
      return {
        ok: false,
        violated: "i1",
        detail: `points[${i}] has id ${p.id} move ${p.move}`,
      };
    }
  }
  if (!gp(state.points.map((p) => p.pt))) {
    return { ok: false, violated: "i2", detail: "points not in general position" };
  }
  if (state.terminal === null) {
    const expectTurn: Player = state.points.length % 2 === 0 ? "maker" : "breaker";
    if (state.turn !== expectTurn) {
      return {
        ok: false,
        violated: "i3",
        detail: `turn ${state.turn} with ${state.points.length} points`,
      };
    }
  }
  if ((state.terminal !== null) !== (state.turn === "over")) {
    return { ok: false, violated: "i4", detail: "terminal/turn mismatch" };
  }
  if ((state.strategy !== null) !== (state.mode !== "sandbox")) {
    return { ok: false, violated: "i5a", detail: "strategy/mode mismatch" };
  }
  // I6 (bichromatic only; vacuous for monochromatic states): a maker-won
  // terminal's witnesses are genuine Maker-only, all-colour-empty k-holes.
  const witness = checkTerminalWitness(state);
  if (!witness.ok) {
    return { ok: false, violated: "i6", detail: witness.detail };
  }
  return { ok: true };
}
