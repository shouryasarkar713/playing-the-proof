// lab/types.ts — value types of the Research / Parameter Lab (pure data).
//
// The lab reports the EPISTEMIC STATUS of a parameter configuration:
//   THEOREM_BACKED  the selected game model + parameters lie inside a regime
//                   established by a cited source statement (rows in
//                   regimes.ts), irrespective of whether an encoding exists.
//   EXPERIMENTAL    outside every cited regime IN THE SELECTED GAME MODEL, but
//                   the lab has a runnable bounded exact-geometry simulation
//                   for the configuration (observations only).
//   NOT_COVERED     outside every cited regime and no simulation exists (or
//                   the parameters are invalid). The lab names the nearest
//                   theorem-backed neighbours instead of extrapolating.
import type { Rat } from "../geometry/rat.ts";

export type LabStatus = "THEOREM_BACKED" | "EXPERIMENTAL" | "NOT_COVERED";
export type GameModel = "online" | "one-round";
export type Rule = "monochromatic" | "bichromatic";

export interface LabConfig {
  readonly model: GameModel;
  // Target hole size. Valid: integer >= 3.
  readonly k: number;
  // Breaker points per Maker point (the s of "1:s"), exact rational >= 0.
  readonly bias: Rat;
  readonly rule: Rule;
  // Selected encoded strategy variant id (encodings.ts), or null.
  readonly encodingId: string | null;
  // Number of parallel structures t (k-strips) for the round-bound
  // calculator. Valid: integer >= 1. Does not change the status.
  readonly structures: number;
}

// How strongly a citation supports the regime it is attached to.
//  proved   the cited source proves exactly this statement (or this case of it)
//  stated   the source STATES the statement (abstract/introduction/theorem
//           text) but the written proof covers only part of the parameter
//           range; the remainder is not proved in the text
//  derived  an elementary deduction from cited statements/definitions
export type BasisKind = "proved" | "stated" | "derived";

export interface Citation {
  readonly rowId: string;
  readonly basis: BasisKind;
  // What, concretely, backs this configuration.
  readonly note: string;
}

export type EncodingAvailability =
  | "none"
  | "exists-unverified"
  | "verified-interactive"
  | "verified-guided";

export interface EncodingInfo {
  readonly requested: string | null;
  // The requested encoding is a valid construction for this exact game
  // (model, rule, k, bias).
  readonly applies: boolean;
  readonly availability: EncodingAvailability;
  // True only for verified-interactive / verified-guided AND applies.
  readonly replayOffered: boolean;
  readonly note: string;
}

export interface Neighbour {
  readonly label: string;
  // A concrete theorem-backed configuration near the queried one.
  readonly config: LabConfigJSON;
  readonly changed: readonly string[];
  readonly citedRows: readonly string[];
}

// Wire-friendly config (bias as "n/d").
export interface LabConfigJSON {
  readonly model: GameModel;
  readonly k: number;
  readonly bias: string;
  readonly rule: Rule;
  readonly encodingId: string | null;
  readonly structures: number;
}

export interface SimulationAvailability {
  readonly available: boolean;
  readonly reason: string;
  // Any simulation output is a sample of play: it must carry the
  // observation-only label wherever shown.
  readonly mustLabelObservationOnly: boolean;
}

export interface LabResult {
  readonly status: LabStatus;
  readonly config: LabConfigJSON;
  readonly citations: readonly Citation[];
  // Strongest basis among the citations (best available support); null when none.
  readonly basis: BasisKind | null;
  readonly verification: string;
  readonly encoding: EncodingInfo;
  readonly limitations: readonly string[];
  readonly neighbours: readonly Neighbour[];
  readonly simulation: SimulationAvailability;
  readonly reasons: readonly string[];
  readonly invalid: readonly string[];
}
