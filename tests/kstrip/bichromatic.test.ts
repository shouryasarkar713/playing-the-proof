import { describe, expect, it } from "vitest";
import { eqPt } from "../../src/geometry/pt.ts";
import { Rat } from "../../src/geometry/rat.ts";
import {
  bichromaticGuarantee,
  createRandomLegalPolicy,
  createStrategyAwarePolicy,
  estimateCost,
  isStrip,
  parallel,
  runKStrip,
} from "../../src/kstrip/index.ts";

describe("Theorem 5 (bichromatic) executor", () => {
  const spec = { variant: "bichromatic" as const, s: Rat.fromString("3/2") };

  for (const [name, mk] of [
    ["random", () => createRandomLegalPolicy(4)],
    ["aware", () => createStrategyAwarePolicy()],
  ] as const) {
    it(`${name}: strips are Maker-owned, Breaker-free, parallel, w.r.t. a tilted common direction`, () => {
      const res = runKStrip(3, 1, mk(), undefined, spec);
      expect(res.status, res.message).toBe("completed");
      const S = res.points.map((p) => p.pt);
      expect(res.claims.length).toBeGreaterThanOrEqual(1);
      for (const c of res.claims) {
        for (const v of c.vertices) {
          expect(res.points.some((p) => p.owner === "maker" && eqPt(p.pt, v))).toBe(true);
        }
        expect(isStrip(c.vertices, S, c.direction).ok).toBe(true);
        for (const p of res.points) {
          if (p.owner === "breaker") {
            expect(c.region.classify(p.pt)).toBe("exterior"); // never on the boundary either
          }
        }
        expect(c.direction.y.equals(Rat.make(-1n))).toBe(true);
      }
      for (let i = 1; i < res.claims.length; i += 1) {
        expect(parallel(res.claims[i - 1]!.region, res.claims[i]!.region).ok).toBe(true);
      }
      // Breaker points are NOT adopted: every claim vertex is a Maker point
      expect(res.levels.every((l) => l.absorbedBreakerPoints === 0)).toBe(true);
    });
  }

  it("the common direction is tilted (not vertical) after the construction", () => {
    const res = runKStrip(3, 1, createRandomLegalPolicy(4), undefined, spec);
    expect(res.claims[0]?.direction.x.isZero()).toBe(false);
    expect(res.levels.some((l) => l.tilt !== null)).toBe(true);
  });

  it("Breaker budget respects floor(m*s) after Maker's m-th point", () => {
    const res = runKStrip(2, 2, createRandomLegalPolicy(4), undefined, spec);
    expect(res.status).toBe("completed");
    let maker = 0;
    let breaker = 0;
    for (const e of res.log) {
      if (e.phase === "bichromatic-pairing") {
        if (e.player === "maker") maker += 1;
        else breaker += 1;
        expect(breaker).toBeLessThanOrEqual(Math.floor((maker * 3) / 2));
      }
    }
    expect(breaker).toBe(Math.floor((maker * 3) / 2));
  });

  it("strict counting: t = ceil(2r/eps); the paper's t = ceil(r/eps) can leave fewer than r PARALLEL strips", () => {
    // r=2, s=3/2 (eps=1/2): paper t=4 -> 8 candidates, Breaker floor(4*3/2)=6 points
    const paper = bichromaticGuarantee(4n, Rat.fromString("3/2"));
    expect(paper.candidatesAliveAtLeast).toBe(2n); // the paper's "eps*t >= r" count
    expect(paper.parallelStripsAtLeast).toBe(1n); // but both may sit in ONE pair (shared halfline)
    const strict = bichromaticGuarantee(8n, Rat.fromString("3/2"));
    expect(strict.parallelStripsAtLeast).toBe(2n);
    const est = estimateCost({ variant: "bichromatic", k: 2, t: 2n, s: Rat.fromString("3/2") });
    expect(est.levels[1]?.makerMoves).toBe(8n); // executor uses the strict t
  });
});
