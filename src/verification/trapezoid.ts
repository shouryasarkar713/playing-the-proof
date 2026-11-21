// verification/trapezoid.ts — the `k5-inv:trapezoid` custom checker
// (§23.3a): the intended 4-hole {u,v,interior,A3} exists, where (u,v) is the
// outer edge farthest from interior recomputed by §23.3 item 1's rule.
// Pure, enumerates NOTHING (budget clause vacuous; config received per the
// §5.7 contract and otherwise unread).
import { isKHole } from "../geometry/holes.ts";
import { signedArea2 } from "../geometry/predicates.ts";
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

export const trapezoidChecker: CustomChecker = {
  id: "k5-inv:trapezoid",
  describe:
    "The intended 4-hole {u,v,interior,A3} exists — u,v = the outer edge farthest from interior (§23.3 item 1).",
  check(
    state: GameState,
    args: Readonly<Record<string, readonly PointId[]>>,
    _config: Configuration,
  ): CheckResult {
    const id = "k5-inv:trapezoid";
    const keys = Object.keys(args).sort();
    if (keys.length !== 3 || keys[0] !== "A3" || keys[1] !== "interior" || keys[2] !== "outer") {
      throw new CheckerIntegrityError(
        id,
        "argument-cardinality",
        "args must be exactly {outer, interior, A3}",
      );
    }
    const outerIds = need(id, args, "outer", 3);
    const interiorIds = need(id, args, "interior", 1);
    const a3Ids = need(id, args, "A3", 1);
    const outer = outerIds.map((pid) => lookup(state, pid));
    const interior = lookup(state, interiorIds[0] as PointId);
    const a3 = lookup(state, a3Ids[0] as PointId);
    if (outer.some((p) => p === null) || interior === null || a3 === null) {
      throw new CheckerIntegrityError(
        id,
        "argument-cardinality",
        "args name unplaced points",
      );
    }
    const o = outer as Pt[];
    const inp = interior as Pt;
    // §23.3 item 1, recomputed identically: edge maximizing
    // |signedArea2| (exact |Rat| comparison); tie → smallest edge index.
    let best = 0;
    let bestAbs = signedArea2(o[0] as Pt, o[1] as Pt, inp).abs();
    for (let i = 1; i < 3; i += 1) {
      const m = signedArea2(o[i] as Pt, o[(i + 1) % 3] as Pt, inp).abs();
      if (m.cmp(bestAbs) > 0) {
        best = i;
        bestAbs = m;
      }
    }
    const u = o[best] as Pt;
    const v = o[(best + 1) % 3] as Pt;
    const placed = state.points.map((p) => p.pt);
    const passed = isKHole([u, v, inp, a3 as Pt], placed);
    return {
      id,
      kind: "invariant",
      passed,
      detail: passed
        ? "the 4-hole {u,v,interior,A3} exists (isKHole verified)"
        : "the 4-hole {u,v,interior,A3} does NOT exist — the construction's claim failed",
    };
  },
};
