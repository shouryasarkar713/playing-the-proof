// verification/invariants.ts — the CustomChecker registry (§5.7).
// Implementations live in code; defs reference them by checkerId (data).
import type { Configuration, GameState, PointId } from "../game/types.ts";
import type { CheckResult } from "../game/integrity.ts";
import type { HoleAnalysis } from "../geometry/holes.ts";

export interface CustomChecker {
  id: string;
  describe: string;
  check(
    state: GameState,
    args: Readonly<Record<string, readonly PointId[]>>,
    config: Configuration,
  ): CheckResult;
}

// CheckerIntegrityError (§5.7) — the checker's ONLY non-value exit, caught
// and converted at exactly one place: the checkPre/checkPost boundary.
export class CheckerIntegrityError extends Error {
  readonly checkerId: string;
  readonly reason: "argument-cardinality" | "undecidable-computation";
  readonly detail: string;
  readonly analysis?: HoleAnalysis;
  constructor(
    checkerId: string,
    reason: "argument-cardinality" | "undecidable-computation",
    detail: string,
    analysis?: HoleAnalysis,
  ) {
    super(`${checkerId}: ${reason}: ${detail}`);
    this.name = "CheckerIntegrityError";
    this.checkerId = checkerId;
    this.reason = reason;
    this.detail = detail;
    if (analysis !== undefined) {
      this.analysis = analysis;
    }
  }
}

const checkerMap = new Map<string, CustomChecker>();

export function registerChecker(checker: CustomChecker): void {
  if (checker.id === "") {
    throw new Error("registerChecker: empty checker id");
  }
  if (checkerMap.has(checker.id)) {
    throw new Error(`registerChecker: ${checker.id} already registered`);
  }
  checkerMap.set(checker.id, checker);
}

export function getChecker(id: string): CustomChecker | undefined {
  return checkerMap.get(id);
}

export function checkers(): ReadonlyMap<string, CustomChecker> {
  return checkerMap;
}
