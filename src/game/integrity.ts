// game/integrity.ts — the shared verification-value layer (v1.2.8).
//
// Home of CheckResult / IntegrityReport / VerificationResult (§5.8) and the
// ONE integrityReport() constructor (§10.9). Value types + one pure value
// constructor ONLY: no checking, routing, or orchestration logic.
// Importable strictly downward by strategy/, verification/, engine/.
import type { GameState, NodeId } from "./types.ts";
import type { HoleAnalysis } from "../geometry/holes.ts";
import { stateHash } from "./hash.ts";

export interface CheckResult {
  id: string;
  kind: "geometry" | "invariant" | "strategy" | "replay";
  passed: boolean;
  detail: string;
  analysis?: HoleAnalysis;
}

export interface IntegrityReport {
  failedAt: NodeId;
  phase: "pre" | "post" | "route" | "construction";
  failed: CheckResult;
  stateHash: string;
}

export type VerificationResult =
  | { kind: "passed"; checks: readonly CheckResult[] }
  | { kind: "failed"; checks: readonly CheckResult[]; report: IntegrityReport };

export function integrityReport(
  state: GameState,
  failedAt: NodeId,
  phase: IntegrityReport["phase"],
  failed: CheckResult,
): IntegrityReport {
  return { failedAt, phase, failed, stateHash: stateHash(state) };
}
