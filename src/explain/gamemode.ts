// explain/gamemode.ts — wording for the game-mode flag (pure data/functions,
// L4). Strings avoid every ClaimLint forbidden word; they describe the
// winning-hole RULE of the selected model, never a theorem outcome.
import type { GameMode } from "../game/types.ts";

export interface GameModeLabel {
  readonly id: GameMode;
  readonly short: string;
  readonly rule: string;
}

export const MONOCHROMATIC_LABEL: GameModeLabel = {
  id: "monochromatic",
  short: "Monochromatic",
  rule: "A winning hole may use points of either player; its hull must contain no other point.",
};

export const BICHROMATIC_LABEL: GameModeLabel = {
  id: "bichromatic",
  short: "Bichromatic",
  rule: "A winning hole uses Maker points only; Breaker points are blockers and are never hole vertices. Its hull must contain no other point of either colour.",
};

export function gameModeLabel(mode: GameMode): GameModeLabel {
  return mode === "bichromatic" ? BICHROMATIC_LABEL : MONOCHROMATIC_LABEL;
}

// Terminal-card wording for the maker-won early exit (a hole completed by a
// placement, before the strategy's declared terminal node).
export function earlyWinClaimText(mode: GameMode): string {
  return mode === "bichromatic"
    ? "The witness hole below was found by exact enumeration; every vertex is a Maker point and its hull holds no other point of either colour (bichromatic rule)."
    : "The witness hole below was found by exact enumeration; the winning point may be Breaker's own (monochromatic rule).";
}

export function earlyWinHeadline(mode: GameMode): string {
  return mode === "bichromatic"
    ? "A Maker-only k-hole already exists — Maker wins here."
    : "A k-hole already exists — Maker wins here.";
}

// Witness line on the win card.
export function witnessLabel(mode: GameMode, verts: readonly string[]): string {
  return mode === "bichromatic"
    ? `Maker-only k-hole: ${verts.join(", ")}`
    : `k-hole: ${verts.join(", ")}`;
}

// Short caption naming the rule in force (HUD / lab output).
export function ruleCaption(mode: GameMode): string {
  return `${gameModeLabel(mode).short} rule: ${gameModeLabel(mode).rule}`;
}
