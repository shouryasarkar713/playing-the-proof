import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Rat } from "../../src/geometry/rat.ts";
import {
  DEFAULT_BUDGET,
  biasedClosedForm,
  biasedRounds,
  ceilRat,
  checkBudget,
  createGreedyBlockingPolicy,
  createRandomLegalPolicy,
  estimateCost,
  floorRat,
  monoClosedForm,
  monoRounds,
  replayLog,
  runKStrip,
} from "../../src/kstrip/index.ts";

describe("round recurrences and closed forms (exact)", () => {
  it("r(1,t)=t/2, r(2,t)=t, recurrence for k>=3", () => {
    expect(monoRounds(1, 5n).equals(Rat.make(5n, 2n))).toBe(true);
    expect(monoRounds(2, 5n).equals(Rat.make(5n))).toBe(true);
    expect(monoRounds(3, 1n).equals(Rat.make(6n))).toBe(true);
    expect(monoRounds(4, 1n).equals(Rat.make(26n))).toBe(true);
    expect(monoRounds(5, 1n).equals(Rat.make(106n))).toBe(true);
  });

  it("closed form (5/3*4^(k-2) - 2/3) t EQUALS the recurrence for k>=2 (not merely <=)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 14 }), fc.bigInt({ min: 1n, max: 500n }), (k, t) => {
        expect(monoRounds(k, t).equals(monoClosedForm(k, t))).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("biased closed form equals the recurrence for k>=2, s>=1", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 9 }),
        fc.bigInt({ min: 1n, max: 60n }),
        fc.bigInt({ min: 1n, max: 9n }),
        (k, t, s) => {
          expect(biasedRounds(k, t, s).equals(biasedClosedForm(k, t, s))).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("biased bases and the k=2 non-recurrence", () => {
    expect(biasedRounds(1, 6n, 2n).equals(Rat.make(2n))).toBe(true); // t/(s+1)
    expect(biasedRounds(2, 6n, 2n).equals(Rat.make(4n))).toBe(true); // 2t/(s+1)
    // r(1,4st)+2t != r(2,t): the recurrence is only valid from k=3 on
    const naive = biasedRounds(1, 4n * 2n * 6n, 2n).add(Rat.make(12n));
    expect(naive.equals(biasedRounds(2, 6n, 2n))).toBe(false);
    // s=1 reduces to Theorem 3
    for (let k = 2; k <= 8; k += 1) {
      expect(biasedClosedForm(k, 3n, 1n).equals(monoClosedForm(k, 3n))).toBe(true);
    }
  });

  it("floor/ceil on Rat", () => {
    expect(floorRat(Rat.make(7n, 2n))).toBe(3n);
    expect(ceilRat(Rat.make(7n, 2n))).toBe(4n);
    expect(floorRat(Rat.make(-7n, 2n))).toBe(-4n);
    expect(ceilRat(Rat.make(-7n, 2n))).toBe(-3n);
    expect(ceilRat(Rat.make(4n))).toBe(4n);
  });
});

describe("cost estimator, budget, completed vs refused vs exhausted", () => {
  it("estimated rounds/points equal the executed ones (1:1 and 1:s and bichromatic)", () => {
    const cases: [number, number, "mono-1:1" | "mono-1:s" | "bichromatic", Rat | undefined][] = [
      [3, 1, "mono-1:1", undefined],
      [4, 1, "mono-1:1", undefined],
      [3, 2, "mono-1:1", undefined],
      [3, 1, "mono-1:s", Rat.make(2n)],
      [3, 1, "bichromatic", Rat.fromString("3/2")],
      [2, 2, "bichromatic", Rat.fromString("1/1")],
    ];
    for (const [k, t, variant, s] of cases) {
      const est = estimateCost(s === undefined ? { variant, k, t: BigInt(t) } : { variant, k, t: BigInt(t), s });
      const res = runKStrip(k, t, createRandomLegalPolicy(3), undefined, s === undefined ? { variant } : { variant, s });
      expect(res.status, res.message).toBe("completed");
      expect(BigInt(res.rounds)).toBe(est.rounds);
      expect(BigInt(res.points.length)).toBe(est.points);
    }
  });

  it("mono rounds match the paper closed form exactly", () => {
    for (const [k, t] of [[2, 3], [3, 2], [4, 1]] as const) {
      const est = estimateCost({ variant: "mono-1:1", k, t: BigInt(t), s: Rat.ONE });
      expect(est.paperRounds?.equals(Rat.make(est.rounds))).toBe(true);
    }
  });

  it("refuses before any execution when over budget (distinct from budget-exhausted)", () => {
    const r = runKStrip(7, 1, createGreedyBlockingPolicy());
    expect(r.status).toBe("refused");
    expect(r.log.length).toBe(0);
    expect(r.message).toContain("points");
    const un = runKStrip(3, 1, createGreedyBlockingPolicy(), DEFAULT_BUDGET, {
      variant: "mono-1:s",
      s: Rat.fromString("3/2"),
    });
    expect(un.status).toBe("unsupported");
    const bi = runKStrip(3, 1, createGreedyBlockingPolicy(), DEFAULT_BUDGET, {
      variant: "bichromatic",
      s: Rat.make(2n),
    });
    expect(bi.status).toBe("unsupported");
    const bad = runKStrip(0, 1, createGreedyBlockingPolicy());
    expect(bad.status).toBe("unsupported");
  });

  it("runtime meter: budget-exhausted is reported with the partial log (preflight off)", () => {
    const r = runKStrip(4, 1, createGreedyBlockingPolicy(), {
      ...DEFAULT_BUDGET,
      preflight: false,
      maxWork: 500n,
    });
    expect(r.status).toBe("budget-exhausted");
    expect(r.goalMet).toBe(false);
    expect(r.log.length).toBeGreaterThan(0);
    expect(r.claims.length).toBe(0);
  });

  it("budget caps are off-by-one exact", () => {
    const est = estimateCost({ variant: "mono-1:1", k: 4, t: 1n, s: Rat.ONE });
    expect(est.points).toBe(52n);
    expect(checkBudget(est, { ...DEFAULT_BUDGET, maxPoints: 52n }).ok).toBe(true);
    expect(checkBudget(est, { ...DEFAULT_BUDGET, maxPoints: 51n }).ok).toBe(false);
    expect(checkBudget(est, { ...DEFAULT_BUDGET, maxRounds: 26n }).ok).toBe(true);
    expect(checkBudget(est, { ...DEFAULT_BUDGET, maxRounds: 25n }).ok).toBe(false);
    expect(checkBudget(est, { ...DEFAULT_BUDGET, maxWork: est.work }).ok).toBe(true);
    expect(checkBudget(est, { ...DEFAULT_BUDGET, maxWork: est.work - 1n }).ok).toBe(false);
  });

  it("level plan of k=5,t=1 (1:1): strips 64/16/4/1 and 106 rounds", () => {
    const est = estimateCost({ variant: "mono-1:1", k: 5, t: 1n, s: Rat.ONE });
    expect(est.rounds).toBe(106n);
    expect(est.levels.map((l) => l.strips)).toEqual([64n, 16n, 4n, 1n]);
    expect(est.points).toBe(212n);
  });

  it("move log replays (legality, frames, rounds) for every variant", () => {
    const a = runKStrip(4, 1, createRandomLegalPolicy(5));
    expect(replayLog(a.log, true).ok).toBe(true);
    const b = runKStrip(3, 1, createRandomLegalPolicy(5), undefined, {
      variant: "bichromatic",
      s: Rat.fromString("3/2"),
    });
    const rb = replayLog(b.log, false);
    expect(rb.failures).toEqual([]);
    expect(rb.points.length).toBe(b.points.length);
    // tamper: duplicate a point -> detected
    const bad = [...a.log];
    bad[3] = { ...(bad[3] as (typeof bad)[number]), pt: (bad[1] as (typeof bad)[number]).pt };
    expect(replayLog(bad, true).ok).toBe(false);
  });
});
