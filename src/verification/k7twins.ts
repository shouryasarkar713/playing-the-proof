// verification/k7twins.ts — the k=7 (Lemma 8) structure checkers.
// Pure; exact; every failure is a typed CheckResult (or CheckerIntegrityError
// for malformed arguments), never a throw of anything else.
//
//   k7-inv:pair5     (after B0)  halfA+B0 and halfB+B0 are 5-holes meeting
//                    exactly in the triangle (C, D, B0).
//   k7-inv:twins6    (after A1)  halfA+B0+A1 and halfB+B0+A1 are 6-holes that
//                    meet exactly in a convex quadrilateral with A1/B0 as its
//                    diagonal and one ear per hole (geometry/twinsK7.ts).
//   k7-inv:twinpair6 (after the enumerated selection) the BOUND pair
//                    twinA/twinB has that exact structure.
import { isKHole } from "../geometry/holes.ts";
import { twinQuadEars, twinSharedPart } from "../geometry/twinsK7.ts";
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

function exactKeys(
  checkerId: string,
  args: Readonly<Record<string, readonly PointId[]>>,
  names: readonly string[],
): void {
  const keys = Object.keys(args).sort().join(",");
  const want = [...names].sort().join(",");
  if (keys !== want) {
    throw new CheckerIntegrityError(
      checkerId,
      "argument-cardinality",
      `args must be exactly {${names.join(", ")}}`,
    );
  }
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

function placedOrThrow(
  checkerId: string,
  state: GameState,
  ids: readonly PointId[],
): Pt[] {
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

export const pair5Checker: CustomChecker = {
  id: "k7-inv:pair5",
  describe:
    "The two chord halves, each extended by B0, are 5-holes meeting exactly in a triangle (Lemma 8, first step).",
  check(
    state: GameState,
    args: Readonly<Record<string, readonly PointId[]>>,
    _config: Configuration,
  ): CheckResult {
    const id = "k7-inv:pair5";
    exactKeys(id, args, ["halfA", "halfB", "B0"]);
    const a = [...need(id, args, "halfA", 4), ...need(id, args, "B0", 1)];
    const b = [...need(id, args, "halfB", 4), ...need(id, args, "B0", 1)];
    const aPts = placedOrThrow(id, state, a);
    const bPts = placedOrThrow(id, state, b);
    const placed = state.points.map((p) => p.pt);
    const aOk = isKHole(aPts, placed);
    const bOk = isKHole(bPts, placed);
    const exact =
      aOk && bOk && twinSharedPart(a, b, (pid) => lookup(state, pid), 3) !== null;
    return {
      id,
      kind: "invariant",
      passed: exact,
      detail: exact
        ? "halfA+B0 and halfB+B0 are 5-holes meeting exactly in their shared triangle (isKHole + exact area verified)"
        : aOk && bOk
          ? "the two 5-holes are holes but do not meet exactly in one shared triangle"
          : `a chord half does not survive B0 as a 5-hole (halfA ${aOk ? "ok" : "gone"}, halfB ${bOk ? "ok" : "gone"})`,
    };
  },
};

function twinsDetail(
  aOk: boolean,
  bOk: boolean,
  exact: boolean,
  lead: string,
): { passed: boolean; detail: string } {
  if (aOk && bOk && exact) {
    return {
      passed: true,
      detail: `${lead} are 6-holes meeting exactly in a convex quadrilateral, A1/B0 opposite, one ear per hole (isKHole + exact area + ear structure verified)`,
    };
  }
  if (aOk && bOk) {
    return {
      passed: false,
      detail: `${lead} are 6-holes but do not have the exact Lemma 8 quadrilateral/ear structure`,
    };
  }
  return {
    passed: false,
    detail: `${lead} do not both exist as 6-holes (first ${aOk ? "ok" : "gone"}, second ${bOk ? "ok" : "gone"})`,
  };
}

export const twins6Checker: CustomChecker = {
  id: "k7-inv:twins6",
  describe:
    "After A1 the two extended chord halves are 6-holes meeting exactly in a convex quadrilateral (Lemma 8 twins).",
  check(
    state: GameState,
    args: Readonly<Record<string, readonly PointId[]>>,
    _config: Configuration,
  ): CheckResult {
    const id = "k7-inv:twins6";
    exactKeys(id, args, ["halfA", "halfB", "B0", "A1"]);
    const b0 = need(id, args, "B0", 1);
    const a1 = need(id, args, "A1", 1);
    const a = [...need(id, args, "halfA", 4), ...b0, ...a1];
    const b = [...need(id, args, "halfB", 4), ...b0, ...a1];
    const aPts = placedOrThrow(id, state, a);
    const bPts = placedOrThrow(id, state, b);
    const placed = state.points.map((p) => p.pt);
    const aOk = isKHole(aPts, placed);
    const bOk = isKHole(bPts, placed);
    const exact =
      aOk &&
      bOk &&
      twinQuadEars(
        a,
        b,
        [a1[0] as PointId, b0[0] as PointId],
        (pid) => lookup(state, pid),
      ) !== null;
    const r = twinsDetail(aOk, bOk, exact, "halfA+B0+A1 and halfB+B0+A1");
    return { id, kind: "invariant", passed: r.passed, detail: r.detail };
  },
};

export const twinPair6Checker: CustomChecker = {
  id: "k7-inv:twinpair6",
  describe:
    "The bound pair twinA/twinB are 6-holes meeting exactly in a convex quadrilateral with one ear per hole.",
  check(
    state: GameState,
    args: Readonly<Record<string, readonly PointId[]>>,
    _config: Configuration,
  ): CheckResult {
    const id = "k7-inv:twinpair6";
    exactKeys(id, args, ["twinA", "twinB", "A1", "B0"]);
    const a = need(id, args, "twinA", 6);
    const b = need(id, args, "twinB", 6);
    const a1 = need(id, args, "A1", 1);
    const b0 = need(id, args, "B0", 1);
    const aPts = placedOrThrow(id, state, a);
    const bPts = placedOrThrow(id, state, b);
    const placed = state.points.map((p) => p.pt);
    const aOk = isKHole(aPts, placed);
    const bOk = isKHole(bPts, placed);
    const exact =
      aOk &&
      bOk &&
      twinQuadEars(
        a,
        b,
        [a1[0] as PointId, b0[0] as PointId],
        (pid) => lookup(state, pid),
      ) !== null;
    const r = twinsDetail(aOk, bOk, exact, "twinA and twinB");
    return { id, kind: "invariant", passed: r.passed, detail: r.detail };
  },
};
