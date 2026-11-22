// verification/k8checks.ts — the k=8 (Lemma 9) structure checkers. Pure,
// exact. Malformed arguments throw CheckerIntegrityError; everything else is a
// typed CheckResult.
//
//   k8-inv:pent-pair    (after B0) two 5-holes through B0 meeting only in a segment
//   k8-inv:twins-tri    (after A1) pentA/pentB + A1 are 6-holes meeting exactly in
//                       a triangle (A1, B0 among its vertices), one ear per hole
//   k8-inv:twinpair-tri the BOUND twins have that exact structure
//   k8-inv:obs1         (after A2) Observation 1: a 7-hole through A2 and two
//                       6-holes through A2 each sharing exactly one edge with it,
//                       the two shared edges adjacent at A2
//   k8-inv:forcing      (after A3) Observation 2's A3: two 6-holes through A3 meet
//                       exactly in a triangle and neither has B0·A2·B1 consecutive
//   k8-inv:two-sevens   (after A4) two 7-holes through A4 with disjoint interiors
//   k8-inv:sevenpair    the BOUND pair holeA/holeB: 7-holes, disjoint interiors
import { findKHoles, isKHole } from "../geometry/holes.ts";
import type { KHole } from "../geometry/holes.ts";
import { ccwIds, twinSharedPart } from "../geometry/twinsK7.ts";
import { interiorsDisjoint, twinTriangleEars } from "../geometry/twinsK8.ts";
import type { Pt } from "../geometry/pt.ts";
import type { Configuration, GameState, PointId } from "../game/types.ts";
import type { CheckResult } from "../game/integrity.ts";
import { CheckerIntegrityError } from "./invariants.ts";
import type { CustomChecker } from "./invariants.ts";

type Args = Readonly<Record<string, readonly PointId[]>>;

function lookup(state: GameState, id: PointId): Pt | null {
  return state.points.find((p) => p.id === id)?.pt ?? null;
}

function keys(id: string, args: Args, names: readonly string[]): void {
  if (Object.keys(args).sort().join(",") !== [...names].sort().join(",")) {
    throw new CheckerIntegrityError(
      id,
      "argument-cardinality",
      `args must be exactly {${names.join(", ")}}`,
    );
  }
}

function need(id: string, args: Args, name: string, n: number): readonly PointId[] {
  const ids = args[name];
  if (ids === undefined || ids.length !== n) {
    throw new CheckerIntegrityError(id, "argument-cardinality", `arg ${name} must be a ${n}-id list`);
  }
  return ids;
}

function pts(id: string, state: GameState, ids: readonly PointId[]): Pt[] {
  return ids.map((q) => {
    const p = lookup(state, q);
    if (p === null) {
      throw new CheckerIntegrityError(id, "argument-cardinality", `arg names unplaced point ${q}`);
    }
    return p;
  });
}

function all(state: GameState): Pt[] {
  return state.points.map((p) => p.pt);
}

function result(id: string, passed: boolean, ok: string, bad: string): CheckResult {
  return { id, kind: "invariant", passed, detail: passed ? ok : bad };
}

function holes(id: string, state: GameState, k: number, config: Configuration): KHole[] {
  const found = findKHoles(
    state.points.map((p) => ({ id: p.id, pt: p.pt })),
    k,
    { mode: "exhaustive", budget: config.analysis.budgetOps },
  );
  if (found.kind !== "exhaustive") {
    throw new CheckerIntegrityError(id, "undecidable-computation", `${k}-hole enumeration budget-exhausted`, found);
  }
  return [...found.holes];
}

export const pentPairChecker: CustomChecker = {
  id: "k8-inv:pent-pair",
  describe:
    "The two chord halves, each extended by B0, are 5-holes meeting only in a segment (Lemma 9, first step).",
  check(state, args, _config): CheckResult {
    const id = "k8-inv:pent-pair";
    keys(id, args, ["pentA", "pentB", "B0"]);
    const a = need(id, args, "pentA", 5);
    const b = need(id, args, "pentB", 5);
    need(id, args, "B0", 1);
    const pa = pts(id, state, a);
    const pb = pts(id, state, b);
    const aOk = isKHole(pa, all(state));
    const bOk = isKHole(pb, all(state));
    const shared = a.filter((v) => b.includes(v));
    const ok = aOk && bOk && shared.length === 2 && interiorsDisjoint(pa, pb);
    return result(
      id,
      ok,
      "both 5-holes exist and meet only in the segment on their two shared vertices",
      aOk && bOk
        ? "the two 5-holes overlap or share more than a segment"
        : `a chord half does not survive B0 as a 5-hole (A ${aOk ? "ok" : "gone"}, B ${bOk ? "ok" : "gone"})`,
    );
  },
};

function twinsTriDetail(aOk: boolean, bOk: boolean, exact: boolean, lead: string): CheckResult["detail"] {
  if (aOk && bOk && exact) {
    return `${lead} are 6-holes meeting exactly in a triangle with one ear per hole (isKHole + exact area + ear structure verified)`;
  }
  if (aOk && bOk) {
    return `${lead} are 6-holes but do not have the exact Lemma 9 triangle/ear structure`;
  }
  return `${lead} do not both exist as 6-holes`;
}

export const twinsTriChecker: CustomChecker = {
  id: "k8-inv:twins-tri",
  describe:
    "After A1 the two extended 5-holes are 6-holes meeting exactly in a triangle (Lemma 9 twins).",
  check(state, args, _config): CheckResult {
    const id = "k8-inv:twins-tri";
    keys(id, args, ["pentA", "pentB", "B0", "A1"]);
    const b0 = need(id, args, "B0", 1);
    const a1 = need(id, args, "A1", 1);
    const a = [...need(id, args, "pentA", 5), ...a1];
    const b = [...need(id, args, "pentB", 5), ...a1];
    const aOk = isKHole(pts(id, state, a), all(state));
    const bOk = isKHole(pts(id, state, b), all(state));
    const exact =
      aOk && bOk &&
      twinTriangleEars(a, b, [a1[0] as PointId, b0[0] as PointId], (q) => lookup(state, q)) !== null;
    const ok = aOk && bOk && exact;
    return { id, kind: "invariant", passed: ok, detail: twinsTriDetail(aOk, bOk, exact, "pentA+A1 and pentB+A1") };
  },
};

export const twinsAnyChecker: CustomChecker = {
  id: "k8-inv:twins-any",
  describe:
    "After A1 two 6-holes through A1 meet exactly in a triangle with A1 and B0 among its vertices, one ear per hole (enumerated).",
  check(state, args, config): CheckResult {
    const id = "k8-inv:twins-any";
    keys(id, args, ["B0", "A1"]);
    const b0 = need(id, args, "B0", 1)[0] as PointId;
    const a1 = need(id, args, "A1", 1)[0] as PointId;
    pts(id, state, [b0, a1]);
    const six = holes(id, state, 6, config).filter((h) => h.verts.includes(a1));
    for (let i = 0; i < six.length; i += 1) {
      for (let j = i + 1; j < six.length; j += 1) {
        const a = (six[i] as KHole).verts;
        const b = (six[j] as KHole).verts;
        if (twinTriangleEars(a, b, [a1, b0], (q) => lookup(state, q)) !== null) {
          return result(
            id,
            true,
            `6-holes ${a.join(",")} and ${b.join(",")} through A1 meet exactly in a triangle with A1 and B0 as vertices, one ear per hole`,
            "",
          );
        }
      }
    }
    return result(id, false, "", "no two 6-holes through A1 meet exactly in a triangle with A1 and B0 as vertices");
  },
};

export const twinPairTriChecker: CustomChecker = {
  id: "k8-inv:twinpair-tri",
  describe: "The bound pair twinA/twinB are 6-holes meeting exactly in a triangle, one ear per hole.",
  check(state, args, _config): CheckResult {
    const id = "k8-inv:twinpair-tri";
    keys(id, args, ["twinA", "twinB", "A1", "B0"]);
    const a = need(id, args, "twinA", 6);
    const b = need(id, args, "twinB", 6);
    const a1 = need(id, args, "A1", 1);
    const b0 = need(id, args, "B0", 1);
    const aOk = isKHole(pts(id, state, a), all(state));
    const bOk = isKHole(pts(id, state, b), all(state));
    const exact =
      aOk && bOk &&
      twinTriangleEars(a, b, [a1[0] as PointId, b0[0] as PointId], (q) => lookup(state, q)) !== null;
    return { id, kind: "invariant", passed: aOk && bOk && exact, detail: twinsTriDetail(aOk, bOk, exact, "twinA and twinB") };
  },
};

// Edges of a hole as unordered id pairs.
function edgesOf(state: GameState, ids: readonly PointId[]): Array<[PointId, PointId]> {
  const ring = ccwIds(ids, (q) => lookup(state, q)) ?? [];
  return ring.map((v, i) => [v, ring[(i + 1) % ring.length] as PointId] as [PointId, PointId]);
}
const sameEdge = (e: [PointId, PointId], f: [PointId, PointId]): boolean =>
  (e[0] === f[0] && e[1] === f[1]) || (e[0] === f[1] && e[1] === f[0]);

export const obs1Checker: CustomChecker = {
  id: "k8-inv:obs1",
  describe:
    "Observation 1: after A2 there is a 7-hole through A2 and two 6-holes through A2, each sharing exactly one edge with the 7-hole, the two shared edges adjacent in it.",
  check(state, args, config): CheckResult {
    const id = "k8-inv:obs1";
    keys(id, args, ["A2"]);
    const a2 = need(id, args, "A2", 1)[0] as PointId;
    pts(id, state, [a2]);
    const sevens = holes(id, state, 7, config).filter((h) => h.verts.includes(a2));
    const sixes = holes(id, state, 6, config).filter((h) => h.verts.includes(a2));
    for (const x of sevens) {
      const ex = edgesOf(state, x.verts);
      const around = ex.filter((e) => e[0] === a2 || e[1] === a2);
      for (let i = 0; i < sixes.length; i += 1) {
        for (let j = i + 1; j < sixes.length; j += 1) {
          const ei = edgesOf(state, (sixes[i] as KHole).verts);
          const ej = edgesOf(state, (sixes[j] as KHole).verts);
          const si = ei.filter((e) => ex.some((f) => sameEdge(e, f)));
          const sj = ej.filter((e) => ex.some((f) => sameEdge(e, f)));
          if (si.length !== 1 || sj.length !== 1) {
            continue;
          }
          const [p, q] = [si[0] as [PointId, PointId], sj[0] as [PointId, PointId]];
          if (
            !sameEdge(p, q) &&
            around.some((e) => sameEdge(e, p)) &&
            around.some((e) => sameEdge(e, q))
          ) {
            return {
              id,
              kind: "invariant",
              passed: true,
              detail: `7-hole ${x.verts.join(",")} and two 6-holes share the adjacent edges ${p.join("–")} and ${q.join("–")} with it (enumerated)`,
            };
          }
        }
      }
    }
    return {
      id,
      kind: "invariant",
      passed: false,
      detail: "no 7-hole through A2 with two 6-holes sharing adjacent single edges with it",
    };
  },
};

export const forcingChecker: CustomChecker = {
  id: "k8-inv:forcing",
  describe:
    "After A3 two 6-holes through A3 meet exactly in a triangle and neither has B0, A2, B1 as consecutive vertices (Observation 2's A3).",
  check(state, args, config): CheckResult {
    const id = "k8-inv:forcing";
    keys(id, args, ["A3", "chain"]);
    const a3 = need(id, args, "A3", 1)[0] as PointId;
    const chain = need(id, args, "chain", 3);
    pts(id, state, [a3, ...chain]);
    const six = holes(id, state, 6, config).filter((h) => h.verts.includes(a3));
    const cons = (ids: readonly PointId[]): boolean => {
      const ring = ccwIds(ids, (q) => lookup(state, q)) ?? [];
      const k = ring.length;
      return ring.some((_, i) => {
        const t = [ring[i], ring[(i + 1) % k], ring[(i + 2) % k]];
        return (
          (t[0] === chain[0] && t[1] === chain[1] && t[2] === chain[2]) ||
          (t[0] === chain[2] && t[1] === chain[1] && t[2] === chain[0])
        );
      });
    };
    for (let i = 0; i < six.length; i += 1) {
      for (let j = i + 1; j < six.length; j += 1) {
        const a = (six[i] as KHole).verts;
        const b = (six[j] as KHole).verts;
        if (!cons(a) && !cons(b) && twinSharedPart(a, b, (q) => lookup(state, q), 3) !== null) {
          return result(id, true, `6-holes ${a.join(",")} and ${b.join(",")} meet exactly in a triangle; neither has B0·A2·B1 consecutive`, "");
        }
      }
    }
    return result(id, false, "", "no two 6-holes through A3 meet exactly in a triangle without the B0·A2·B1 chain");
  },
};

export const twoSevensChecker: CustomChecker = {
  id: "k8-inv:two-sevens",
  describe: "After A4 two 7-holes through A4 have disjoint interiors.",
  check(state, args, config): CheckResult {
    const id = "k8-inv:two-sevens";
    keys(id, args, ["A4"]);
    const a4 = need(id, args, "A4", 1)[0] as PointId;
    pts(id, state, [a4]);
    const sev = holes(id, state, 7, config).filter((h) => h.verts.includes(a4));
    for (let i = 0; i < sev.length; i += 1) {
      for (let j = i + 1; j < sev.length; j += 1) {
        const pa = pts(id, state, (sev[i] as KHole).verts);
        const pb = pts(id, state, (sev[j] as KHole).verts);
        if (interiorsDisjoint(pa, pb)) {
          return result(id, true, `two 7-holes through A4 with disjoint interiors (${(sev[i] as KHole).verts.join(",")} / ${(sev[j] as KHole).verts.join(",")})`, "");
        }
      }
    }
    return result(id, false, "", "no two 7-holes through A4 with disjoint interiors");
  },
};

export const sevenPairChecker: CustomChecker = {
  id: "k8-inv:sevenpair",
  describe: "The bound pair holeA/holeB are 7-holes with disjoint interiors.",
  check(state, args, _config): CheckResult {
    const id = "k8-inv:sevenpair";
    keys(id, args, ["holeA", "holeB"]);
    const a = need(id, args, "holeA", 7);
    const b = need(id, args, "holeB", 7);
    const pa = pts(id, state, a);
    const pb = pts(id, state, b);
    const aOk = isKHole(pa, all(state));
    const bOk = isKHole(pb, all(state));
    return result(
      id,
      aOk && bOk && interiorsDisjoint(pa, pb),
      "both bound 7-holes exist and their interiors are disjoint (isKHole + exact area)",
      aOk && bOk ? "the bound 7-holes overlap" : "a bound 7-hole does not survive",
    );
  },
};

export const K8_CHECKERS: readonly CustomChecker[] = [
  pentPairChecker,
  twinsTriChecker,
  twinsAnyChecker,
  twinPairTriChecker,
  obs1Checker,
  forcingChecker,
  twoSevensChecker,
  sevenPairChecker,
];
