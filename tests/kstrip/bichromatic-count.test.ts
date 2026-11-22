// Theorem 5 counting step, checked on an exact play. With eps = 2 - s = 1/2 the
// published parameter for r = 2 is t = ceil(r/eps) = 4 pairs, i.e. 8 candidates
// against floor(4 s) = 6 Breaker points; each Breaker point spoils at most one
// candidate, so >= 2 candidates stay free. This play shows that the two free
// candidates may belong to ONE pair; they then meet in the halfline below the
// apex, so under Definition 2 ("C1, C2 disjoint") they are not parallel and only
// one parallel strip results. (r = 1 under the executor's strict t = ceil(2r/eps)
// has the same t = 4 and B = 6.)
import { describe, expect, it } from "vitest";
import type { Pt } from "../../src/geometry/pt.ts";
import { Rat } from "../../src/geometry/rat.ts";
import {
  StripRegion,
  bichromaticGuarantee,
  createGreedyBlockingPolicy,
  estimateCost,
  isStrip,
  parallel,
  runKStrip,
  sharedHalfline,
} from "../../src/kstrip/index.ts";
import type { TraceEvent } from "../../src/kstrip/index.ts";

describe("two free candidates of one pair are not two parallel strips", () => {
  const s = Rat.fromString("3/2");
  let plans: readonly { strips: readonly (readonly Pt[])[] }[] = [];
  let dir = { x: Rat.ZERO, y: Rat.make(-1n) };
  let breakerInPhase = 0;
  const res = runKStrip(2, 1, createGreedyBlockingPolicy(), undefined, {
    variant: "bichromatic",
    s,
    trace: (e: TraceEvent) => {
      if (e.kind === "phase-start" && e.phase === "bichromatic-pairing") plans = e.plans;
      if (e.kind === "phase-end" && e.phase === "bichromatic-pairing") {
        dir = e.dir;
        breakerInPhase = e.ledger?.breakerUsed ?? 0;
      }
    },
  });
  const S = res.points.map((p) => p.pt);
  const apexes = res.log.filter((e) => e.phase === "bichromatic-pairing" && e.kind === "apex").map((e) => e.pt);
  const cand = (j: number, side: 0 | 1): Pt[] => {
    const pl = plans[j] as { strips: readonly (readonly Pt[])[] };
    const ap = apexes[j] as Pt;
    return side === 0 ? [...(pl.strips[0] as Pt[]), ap] : [ap, ...(pl.strips[1] as Pt[])];
  };
  const live: [number, number][] = [];
  for (let j = 0; j < plans.length; j += 1) {
    for (const side of [0, 1] as const) if (isStrip(cand(j, side), S, dir).ok) live.push([j, side]);
  }

  it("parameters: t = 4 pairs, 8 candidates, B = 6 Breaker points, eps*t = 2", () => {
    expect(plans.length).toBe(4);
    expect(breakerInPhase).toBe(6);
    expect(estimateCost({ variant: "bichromatic", k: 2, t: 1n, s }).levels[1]?.units).toBe(4n);
    expect(bichromaticGuarantee(4n, s)).toMatchObject({ breakerPoints: 6n, candidatesAliveAtLeast: 2n, parallelStripsAtLeast: 1n });
  });

  it("exactly eps*t = 2 candidates are free (isStrip on the final board), both in the last pair", () => {
    expect(live).toEqual([
      [3, 0],
      [3, 1],
    ]);
  });

  it("they meet in the halfline below the apex: not disjoint, hence not parallel (Definition 2)", () => {
    const a = StripRegion.make(cand(3, 0), dir);
    const b = StripRegion.make(cand(3, 1), dir);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(parallel(a.region, b.region).ok).toBe(false);
      expect(sharedHalfline(a.region, b.region)).not.toBeNull();
      // closed regions intersect exactly in the v-halfline through the apex
      const ap = apexes[3] as Pt;
      expect(a.region.classify(ap)).not.toBe("exterior");
      expect(b.region.classify(ap)).not.toBe("exterior");
    }
  });

  it("so only one parallel strip is delivered (the goal of this run is r = 1)", () => {
    expect(res.status).toBe("completed");
    expect(res.claims.length).toBe(1);
  });
});
