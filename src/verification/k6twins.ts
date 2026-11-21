// verification/k6twins.ts — the k=6 twin checkers (§24.3/§24.3b).
// Pure; enumeration budgets thread from config (the §10.9 normative
// budgets); undecidable computation throws CheckerIntegrityError.
import { findKHoles, isKHole } from "../geometry/holes.ts";
import { twinSharedTriangle } from "../geometry/twins.ts";
import type { Pt } from "../geometry/pt.ts";
import type { Configuration, GameState, PointId } from "../game/types.ts";
import type { CheckResult } from "../game/integrity.ts";
import { CheckerIntegrityError } from "./invariants.ts";
import type { CustomChecker } from "./invariants.ts";

function lookup(state: GameState, id: PointId): Pt | null {
  for (const p of state.points) {
    if (p.id === id) {
      return p.pt;
    }
  }
  return null;
}

function need(
  checkerId: string,
  args: Readonly<Record<string, readonly PointId[]>>,
  name: string,
  n: number,
): readonly PointId[] {
  const ids = args[name];
  if (ids === undefined || ids.length !== n) {
    throw new CheckerIntegrityError(
      checkerId,
      "argument-cardinality",
      `arg ${name} must be a ${n}-id list`,
    );
  }
  return ids;
}

function placedOrThrow(checkerId: string, state: GameState, ids: readonly PointId[]): Pt[] {
  const pts: Pt[] = [];
  for (const id of ids) {
    const p = lookup(state, id);
    if (p === null) {
      throw new CheckerIntegrityError(
        checkerId,
        "argument-cardinality",
        `arg names unplaced point ${id}`,
      );
    }
    pts.push(p);
  }
  return pts;
}

// k6-inv:twins (§24.3 item 4): at least two 5-hole witnesses sharing
// exactly 3 vertices including A1 — the twin 5-holes of Lemma 7, found by
// enumeration, never transcribed.
export const twinsChecker: CustomChecker = {
  id: "k6-inv:twins",
  describe:
    "Two 5-holes share exactly 3 vertices including A1 (the Lemma 7 twins, enumerated).",
  check(
    state: GameState,
    args: Readonly<Record<string, readonly PointId[]>>,
    config: Configuration,
  ): CheckResult {
    const id = "k6-inv:twins";
    if (Object.keys(args).join(",") !== "A1") {
      throw new CheckerIntegrityError(
        id,
        "argument-cardinality",
        "args must be exactly {A1}",
      );
    }
    const a1Ids = need(id, args, "A1", 1);
    const a1 = lookup(state, a1Ids[0] as PointId);
    if (a1 === null) {
      throw new CheckerIntegrityError(id, "argument-cardinality", "A1 names an unplaced point");
    }
    const found = findKHoles(
      state.points.map((p) => ({ id: p.id, pt: p.pt })),
      5,
      { mode: "exhaustive", budget: config.analysis.budgetOps },
    );
    if (found.kind !== "exhaustive") {
      throw new CheckerIntegrityError(
        id,
        "undecidable-computation",
        "twin 5-hole enumeration budget-exhausted",
        found,
      );
    }
    let twins = 0;
    for (let i = 0; i < found.holes.length; i += 1) {
      for (let j = i + 1; j < found.holes.length; j += 1) {
        const a = found.holes[i]?.verts ?? [];
        const b = found.holes[j]?.verts ?? [];
        const shared = a.filter((v) => b.includes(v));
        if (shared.length === 3 && shared.includes(a1Ids[0] as PointId)) {
          twins += 1;
        }
      }
    }
    const passed = twins > 0;
    return {
      id,
      kind: "invariant",
      passed,
      detail: passed
        ? `${twins} twin 5-hole pair(s) share exactly 3 vertices including A1 (enumerated)`
        : "no two 5-holes share exactly 3 vertices including A1 — the escape claim failed",
    };
  },
};

// k6-inv:twinpair (§24.3b post): the BOUND pair (twinA, twinB vars) both
// exist as 5-holes in the current state — re-asserted, never assumed.
export const twinPairChecker: CustomChecker = {
  id: "k6-inv:twinpair",
  describe: "The bound twin pair twinA/twinB both exist as 5-holes.",
  check(
    state: GameState,
    args: Readonly<Record<string, readonly PointId[]>>,
    _config: Configuration,
  ): CheckResult {
    const id = "k6-inv:twinpair";
    const keys = Object.keys(args).sort();
    if (keys.length !== 2 || keys[0] !== "twinA" || keys[1] !== "twinB") {
      throw new CheckerIntegrityError(
        id,
        "argument-cardinality",
        "args must be exactly {twinA, twinB}",
      );
    }
    const aIds = need(id, args, "twinA", 5);
    const bIds = need(id, args, "twinB", 5);
    const aPts = placedOrThrow(id, state, aIds);
    const bPts = placedOrThrow(id, state, bIds);
    const placed = state.points.map((p) => p.pt);
    const aOk = isKHole(aPts, placed);
    const bOk = isKHole(bPts, placed);
    // and they are EXACT twins — share exactly 3 vertices and meet only
    // in the triangle on them (Lemma 7's "two 5-holes intersecting in one
    // triangle"; the B1 survival argument depends on it).
    const exact =
      aOk && bOk && twinSharedTriangle(aIds, bIds, (pid) => lookup(state, pid)) !== null;
    const passed = aOk && bOk && exact;
    return {
      id,
      kind: "invariant",
      passed,
      detail: passed
        ? "the bound twins twinA/twinB both exist as 5-holes meeting exactly in their shared triangle (isKHole + exact area verified)"
        : aOk && bOk
          ? "the bound twins are 5-holes but do not meet exactly in one shared triangle"
          : `the bound twin pair does not survive (twinA ${aOk ? "ok" : "gone"}, twinB ${bOk ? "ok" : "gone"})`,
    };
  },
};
