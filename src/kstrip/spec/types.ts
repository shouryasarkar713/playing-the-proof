// kstrip/spec/types.ts — the declarative KStripSpec (pure data) and the typed
// outcome / certificate shapes of its interpreter. See docs/KSTRIP_SPEC.md.
//
// A KStripSpec says WHAT the construction is (which phase runs at which level,
// how many Maker moves / units / Breaker replies, what must hold before and
// after each phase, which Breaker responses are allowed, how the recursion
// descends). It contains no geometry: every geometric act is a named
// PRIMITIVE implemented by the exact kernel (kstrip/runner.ts + pairing.ts),
// and every condition is a named PREDICATE implemented over exact kstrip
// predicates (predicates.ts).
import type { Rat } from "../../geometry/rat.ts";
import type { Variant } from "../recursion.ts";
import type { PhaseKind, RunResult } from "../types.ts";
import type { Expr } from "./expr.ts";

export type PrimitiveId =
  | "mono-base-1"
  | "mono-base-2"
  | "pair-adopt"
  | "group-slab"
  | "bichromatic-base-1"
  | "bichromatic-pair-tilt";

export type ResponseClass = "general-position" | "distinct-x";

export type LevelCond =
  | { readonly kind: "eq"; readonly level: number }
  | { readonly kind: "gte"; readonly level: number };

export interface PredRef {
  readonly id: string;
}

// Descriptive (validated, displayed) structure of a phase; the geometry that
// realises it is the PRIMITIVE.
export interface PhaseSpec {
  readonly id: string;
  readonly kind: PhaseKind;
  readonly when: LevelCond;
  readonly primitive: PrimitiveId;
  readonly summary: string;
  // Formulas (vars: k level need s m units).
  readonly units: Expr; // pairs / groups (0 in base phases)
  readonly inputStrips: Expr; // (level-1)-strips consumed
  readonly makerMoves: Expr;
  readonly breakerAllowance: Expr; // Breaker replies after Maker's m-th move
  // Phase structure (named rules of the paper's construction).
  readonly pairing: string | null; // how input strips are grouped into units
  readonly candidateRegions: string | null;
  readonly extensionMove: string | null; // Maker's move p_j
  readonly survivorSelection: string | null;
  readonly allowedResponses: readonly ResponseClass[];
  readonly pre: readonly PredRef[];
  readonly post: readonly PredRef[];
  readonly transition:
    | { readonly kind: "terminal" }
    | { readonly kind: "recurse"; readonly level: Expr; readonly need: Expr };
}

export interface VerifiedConfig {
  readonly k: number;
  readonly t: readonly number[];
  // exact Rat strings; absent for mono-1:1 (s is fixed to 1)
  readonly s?: readonly string[];
}

export interface KStripSpec {
  readonly id: string;
  readonly title: string;
  readonly variant: Variant;
  readonly theorem: string;
  readonly version: string;
  readonly sRule: "fixed-1" | "integer>=1" | "rational[0,2)";
  // The ONLY configurations the spec claims; anything else is 'uncovered'.
  readonly verified: readonly VerifiedConfig[];
  readonly runPre: readonly PredRef[];
  readonly runPost: readonly PredRef[];
  readonly phases: readonly PhaseSpec[];
}

// ---- interpreter I/O ---------------------------------------------------

export interface SpecParams {
  readonly k: number;
  readonly t: bigint;
  readonly s?: Rat;
}

export interface PredResult {
  readonly id: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface PhaseCertificate {
  readonly phaseId: string;
  readonly kind: PhaseKind;
  readonly level: number;
  readonly need: number;
  readonly units: number;
  readonly makerMoves: number;
  readonly breakerMoves: number;
  readonly delivered: number;
  readonly logFrom: number; // log index range [from, to) of the phase
  readonly logTo: number;
  readonly pre: readonly PredResult[];
  readonly post: readonly PredResult[];
  readonly ok: boolean;
}

export interface PlanItem {
  readonly level: number;
  readonly phaseId: string;
  readonly kind: PhaseKind;
  readonly need: bigint;
  readonly units: bigint;
  readonly inputStrips: bigint;
  readonly makerMoves: bigint;
  readonly breakerMoves: bigint;
}

export type SpecOutcome =
  | { readonly kind: "completed" }
  // parameters outside the spec's verified configurations (nothing executed)
  | { readonly kind: "uncovered"; readonly reason: string }
  // Breaker's move is not an allowed response of the phase
  | {
      readonly kind: "rejected";
      readonly phase: string | null;
      readonly responseClass: string;
      readonly message: string;
    }
  // a declared (or executor) invariant failed: the violated predicate is named
  | {
      readonly kind: "integrity-failure";
      readonly scope: "spec" | "pre" | "post" | "run-pre" | "run-post" | "executor" | "replay";
      readonly phase: string | null;
      readonly predicate: string;
      readonly message: string;
    }
  // stopped before finishing (budget); never reports claims
  | { readonly kind: "incomplete"; readonly reason: "refused" | "budget-exhausted"; readonly message: string };

export interface SpecRun {
  readonly specId: string;
  readonly specVersion: string;
  readonly outcome: SpecOutcome;
  readonly plan: readonly PlanItem[];
  readonly certificates: readonly PhaseCertificate[];
  readonly runPre: readonly PredResult[];
  readonly runPost: readonly PredResult[];
  // The legacy-shaped result (null when nothing ran: uncovered / invalid spec).
  readonly result: RunResult | null;
}
