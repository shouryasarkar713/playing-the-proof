// tests/strategies/k8a1.test.ts — the first Maker reply (A1) of the k=8
// walkthrough, on the 14 inside-pair B0 positions of the preset heptagon for which
// the original near-edge halving search found no point.
//
// For each position the admissibility predicate (two 6-holes through the new point
// meeting exactly in a triangle with the new point and B0 among its vertices, an
// ear of both) is decided over the WHOLE plane by exact cell representatives of the
// arrangement of all pair lines of the placed points (the predicate is constant on
// cells, bounded and unbounded). Verdict for all 14: admissible region non-empty;
// the failure was the search, not the configuration. The engine now finds a point
// (halving first, exact cell search as fallback) and every witness hole is
// re-confirmed by an independent integer oracle.
import { describe, expect, it } from "vitest";
import { Rat } from "../../src/geometry/rat.ts";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { placePoint } from "../../src/game/place.ts";
import { testCtx } from "../helpers.ts";
import { breakerMove, initK8 } from "./k8driver.ts";
import { a1Census } from "./k8a1.ts";
import { oracleIsHole } from "./k8oracle.ts";
import { verifyEight } from "./k8tree.ts";

const ctx = testCtx();
const frac = (s: string): Rat => {
  const [n, d] = s.split("/");
  return Rat.make(BigInt(n as string), BigInt(d ?? "1"));
};
const FIXTURES: Array<[string, string]> = [
  ["548378/33069", "1765759/66138"],
  ["200521534/12467013", "556894133/24934026"],
  ["-115611/289541", "4011632/289541"],
  ["69747614/4387149", "831097204/48258639"],
  ["504704/20855", "76634/4171"],
  ["119548554/5651705", "18306924/1130341"],
  ["5773251001/706486170", "16829668579/1412972340"],
  ["2347471154/159088725", "310779962/31817745"],
  ["2787940421/161350650", "147093694/16135065"],
  ["6258233/272850", "1063564/136425"],
  ["620209226/55911413", "504194902/55911413"],
  ["9597206494/681382287", "1128549418/227127429"],
  ["8296318/610011", "148084/203337"],
  ["165904/55029", "182656/55029"],
];

describe("A1 on the 14 configurations the halving search missed", () => {
  const s0 = initK8(ctx);
  FIXTURES.forEach(([xs, ys], idx) => {
    const b0: Pt = pt(frac(xs), frac(ys));
    it(`configuration ${idx + 1}: admissible region exists; engine places A1; oracle confirms the twin 6-holes`, () => {
      const hypo = placePoint(s0, "breaker", b0);
      const b0Id = hypo.points[hypo.points.length - 1]?.id as string;
      const census = a1Census(hypo, b0Id, ctx, 2);
      expect(census.cells).toBeGreaterThan(100);
      expect(census.admissible).toBeGreaterThan(0);
      for (const w of census.witnesses) {
        const all = [...hypo.points.map((p) => p.pt), w.x];
        const index = (id: string): number => Number(id.slice(1)) - 1;
        const sorted = (ids: readonly string[]): number[] => ids.map(index);
        const idsOf = (ids: readonly string[]): number[] => sorted(ids);
        expect(oracleIsHole(all, idsOf(w.twinA))).toBe(true);
        expect(oracleIsHole(all, idsOf(w.twinB))).toBe(true);
      }
      const st = breakerMove(s0, b0, ctx);
      expect(st?.state.terminal?.kind).not.toBe("uncovered");
      expect(st?.state.strategy?.nodeId === "k8:r1:classify" || st?.state.terminal?.kind === "maker-won").toBe(true);
      if (st?.state.terminal?.kind === "maker-won") {
        expect(verifyEight(st.state)).toBeNull();
      }
    }, 300000);
  });
});
