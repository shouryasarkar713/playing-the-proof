// game/gamemode.ts — the game-mode flag and the OWNERSHIP-AWARE win
// predicates. Pure; imports geometry/ only (L1).
//
// Monochromatic (default, the shipped game): a winning k-hole may use points
// of either player; every function below then delegates to the unrestricted
// geometry/holes.ts search with identical arguments, so results, budgets and
// hashes are byte-identical to the pre-flag behaviour.
//
// Bichromatic: a winning k-hole is a convex k-subset of MAKER's points whose
// convex hull contains no point of ANY colour in its interior. Breaker's
// points are interior blockers only and can never be a vertex of a winning
// hole (Dzuklevski et al., Section 1; Aichholzer et al., Game 3).
import {
  analyzeHoles,
  findKHoles,
  findNewKHoles,
} from "../geometry/holes.ts";
import type {
  FindKHolesOpts,
  HoleAnalysis,
  IdPt,
  KHole,
  PointId,
} from "../geometry/holes.ts";
import {
  analyzeHolesAmong,
  findKHolesAmong,
  findNewKHolesAmong,
  isHoleAmong,
} from "../geometry/ownedholes.ts";
import type { GameMode, GameState, Player } from "./types.ts";

export const GAME_MODES: readonly GameMode[] = ["monochromatic", "bichromatic"];

export function isGameMode(v: unknown): v is GameMode {
  return v === "monochromatic" || v === "bichromatic";
}

// The effective mode of a state / config: absent means monochromatic.
export function gameModeOf(x: { readonly gameMode?: GameMode }): GameMode {
  return x.gameMode === "bichromatic" ? "bichromatic" : "monochromatic";
}

export function isBichromatic(x: { readonly gameMode?: GameMode }): boolean {
  return x.gameMode === "bichromatic";
}

// May a point owned by `owner` be a vertex of a winning hole in `mode`?
export function mayBeHoleVertex(mode: GameMode, owner: Player): boolean {
  return mode === "monochromatic" || owner === "maker";
}

function idPtsOf(state: GameState): IdPt[] {
  return state.points.map((p) => ({ id: p.id, pt: p.pt }));
}

// The vertex-eligibility predicate of a state (ids of points that may be
// winning-hole vertices). Monochromatic: every point.
export function eligibleVertex(state: GameState): (id: PointId) => boolean {
  if (!isBichromatic(state)) {
    return () => true;
  }
  const maker = new Set<PointId>();
  for (const p of state.points) {
    if (p.owner === "maker") {
      maker.add(p.id);
    }
  }
  return (id) => maker.has(id);
}

// findWinHoles: all (or the first) winning k-holes of the state under its
// game mode. Monochromatic == findKHoles over all points.
export function findWinHoles(
  state: GameState,
  k: number,
  opts: FindKHolesOpts,
): HoleAnalysis {
  if (!isBichromatic(state)) {
    return findKHoles(idPtsOf(state), k, opts);
  }
  return findKHolesAmong(idPtsOf(state), eligibleVertex(state), k, opts);
}

// analyzeWinHoles: budget-guarded policy wrapper (sandbox / diagnostics).
export function analyzeWinHoles(
  state: GameState,
  k: number,
  opts: { readonly budget: number },
): HoleAnalysis {
  if (!isBichromatic(state)) {
    return analyzeHoles(idPtsOf(state), k, opts);
  }
  return analyzeHolesAmong(idPtsOf(state), eligibleVertex(state), k, opts);
}

// findNewWinHoles: the incremental guided-mode detector — winning holes that
// contain the just-placed point `last`. In bichromatic mode a Breaker
// placement can never create a winning hole (empty result).
export function findNewWinHoles(
  state: GameState,
  k: number,
  last: PointId,
): { holes: readonly KHole[] } {
  if (!isBichromatic(state)) {
    return findNewKHoles(idPtsOf(state), k, last);
  }
  return findNewKHolesAmong(idPtsOf(state), eligibleVertex(state), k, last);
}

export type WinningHoleCheck =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "wrong-size"
        | "unknown-point"
        | "duplicate-vertex"
        | "breaker-vertex"
        | "not-a-hole";
      detail: string;
    };

// checkWinningHole: is `hole` a winning k-hole of `state` (k = state.k)
// under the state's game mode? Typed result naming the first violation.
export function checkWinningHole(
  state: GameState,
  hole: KHole,
): WinningHoleCheck {
  if (hole.k !== state.k || hole.verts.length !== state.k) {
    return {
      ok: false,
      reason: "wrong-size",
      detail: `hole has ${hole.verts.length} vertices (k=${hole.k}), state.k=${state.k}`,
    };
  }
  const byId = new Map(state.points.map((p) => [p.id, p] as const));
  if (new Set(hole.verts).size !== hole.verts.length) {
    return { ok: false, reason: "duplicate-vertex", detail: "a vertex id repeats" };
  }
  for (const id of hole.verts) {
    const p = byId.get(id);
    if (p === undefined) {
      return { ok: false, reason: "unknown-point", detail: `no point ${id}` };
    }
    if (!mayBeHoleVertex(gameModeOf(state), p.owner)) {
      return {
        ok: false,
        reason: "breaker-vertex",
        detail: `${id} is owned by ${p.owner}; bichromatic holes use Maker points only`,
      };
    }
  }
  if (!isHoleAmong(idPtsOf(state), eligibleVertex(state), hole.verts)) {
    return {
      ok: false,
      reason: "not-a-hole",
      detail: "vertices are not in convex position or the hull contains another point",
    };
  }
  return { ok: true };
}

export function isWinningHole(state: GameState, hole: KHole): boolean {
  return checkWinningHole(state, hole).ok;
}

// checkTerminalWitness: the bichromatic integrity rule I6 — a maker-won
// terminal's every witness hole must be a genuine winning hole of its own
// state (Maker-only vertices, empty of all colours). Vacuous for any
// monochromatic state (the shipped checks are unchanged).
export function checkTerminalWitness(
  state: GameState,
): { ok: true } | { ok: false; detail: string } {
  if (!isBichromatic(state) || state.terminal?.kind !== "maker-won") {
    return { ok: true };
  }
  if (state.terminal.witness.length === 0) {
    return { ok: false, detail: "maker-won terminal carries no witness hole" };
  }
  for (const hole of state.terminal.witness) {
    const r = checkWinningHole(state, hole);
    if (!r.ok) {
      return { ok: false, detail: `witness [${hole.verts.join(",")}]: ${r.reason} — ${r.detail}` };
    }
  }
  return { ok: true };
}

// Convenience: the ids of the points that may be vertices (Maker's, when
// bichromatic) in placement order.
export function vertexEligibleIds(state: GameState): readonly PointId[] {
  const ok = eligibleVertex(state);
  return state.points.filter((p) => ok(p.id)).map((p) => p.id);
}
