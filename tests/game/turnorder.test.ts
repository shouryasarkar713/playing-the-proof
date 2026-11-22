// tests/game/turnorder.test.ts — the bias 1:s turn order against an
// INDEPENDENT oracle built from the explicit multiset formulation: Maker's
// r-th move has time r, Breaker's j-th move is anchored to Maker's
// ceil(j/s)-th move (ties, j/s an integer, go to Maker), and the sequence is
// "each Maker move followed by the Breaker moves anchored to it".
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Rat } from "../../src/geometry/rat.ts";
import {
  BIAS_MAX,
  BIAS_MAX_DENOMINATOR,
  biasFromWire,
  biasToWire,
  breakerQuota,
  isUnitBias,
  moverAt,
  nextMover,
  normalizeBias,
  roundOf,
  turnSequence,
  validateBias,
} from "../../src/game/turnorder.ts";
import type { Player } from "../../src/game/types.ts";

function oracle(n: number, d: number, length: number): Player[] {
  // s = n/d. Enough Maker moves to cover `length` placements.
  const out: Player[] = [];
  if (n === 0) {
    return Array.from({ length }, () => "maker" as Player);
  }
  const makerMoves = length + 1;
  // anchor(j) = ceil(j / s) = ceil(j*d / n)
  const anchor = (j: number): number => Math.floor((j * d + n - 1) / n);
  const breakerAnchored = new Map<number, number[]>();
  for (let j = 1; j <= length * 2 + 2; j += 1) {
    const a = anchor(j);
    const list = breakerAnchored.get(a) ?? [];
    list.push(j);
    breakerAnchored.set(a, list);
  }
  for (let r = 1; r <= makerMoves && out.length < length; r += 1) {
    out.push("maker");
    for (const _j of breakerAnchored.get(r) ?? []) {
      void _j;
      out.push("breaker");
    }
  }
  return out.slice(0, length);
}

const arbS = fc.tuple(fc.integer({ min: 0, max: 40 }), fc.integer({ min: 1, max: 12 }));

describe("turn order vs the multiset oracle", () => {
  it("matches for every rational s = n/d (n <= 40, d <= 12), first 60 placements", () => {
    fc.assert(
      fc.property(arbS, ([n, d]) => {
        const bias = Rat.make(BigInt(n), BigInt(d));
        expect(turnSequence(bias, 60)).toEqual(oracle(n, d, 60));
      }),
      { numRuns: 300 },
    );
  });

  it("exhaustive small grid", () => {
    for (let n = 0; n <= 24; n += 1) {
      for (let d = 1; d <= 12; d += 1) {
        expect(turnSequence(Rat.make(BigInt(n), BigInt(d)), 50), `s=${n}/${d}`).toEqual(oracle(n, d, 50));
      }
    }
  });

  it("moverAt and nextMover agree with the sequence", () => {
    fc.assert(
      fc.property(arbS, fc.integer({ min: 0, max: 40 }), ([n, d], i) => {
        const bias = Rat.make(BigInt(n), BigInt(d));
        const seq = turnSequence(bias, 50);
        expect(moverAt(bias, i)).toBe(seq[i]);
        const before = seq.slice(0, i);
        const m = before.filter((p) => p === "maker").length;
        expect(nextMover(bias, m, before.length - m)).toBe(seq[i]);
      }),
    );
  });
});

describe("named cases", () => {
  const S = (s: string): Player[] => s.split("").map((c) => (c === "M" ? "maker" : "breaker"));
  it("s = 1 and absent bias alternate, Maker first", () => {
    expect(turnSequence(undefined, 8)).toEqual(S("MBMBMBMB"));
    expect(turnSequence(Rat.make(1n), 8)).toEqual(S("MBMBMBMB"));
  });
  it("integer s: s Breaker points per Maker point", () => {
    expect(turnSequence(Rat.make(2n), 9)).toEqual(S("MBBMBBMBB"));
    expect(turnSequence(Rat.make(3n), 8)).toEqual(S("MBBBMBBB"));
    expect(turnSequence(Rat.make(12n), 14)).toEqual(S("M" + "B".repeat(12) + "M"));
  });
  it("s < 1: Maker sometimes moves repeatedly; s = 0 is Maker only", () => {
    expect(turnSequence(Rat.make(1n, 2n), 9)).toEqual(S("MMBMMBMMB"));
    expect(turnSequence(Rat.make(1n, 3n), 8)).toEqual(S("MMMBMMMB"));
    expect(turnSequence(Rat.make(0n), 5)).toEqual(S("MMMMM"));
  });
  it("non-integer s > 1: cumulative floor", () => {
    // s = 3/2: quotas after Maker 1,2,3,4 = 1,3,4,6
    expect(turnSequence(Rat.make(3n, 2n), 10)).toEqual(S("MBMBBMBMBB"));
    expect(turnSequence(Rat.make(5n, 2n), 9)).toEqual(S("MBBMBBBMB"));
  });
  it("quota is floor(s*r); absent = r", () => {
    expect(breakerQuota(undefined, 7)).toBe(7);
    expect(breakerQuota(Rat.make(5n, 2n), 3)).toBe(7);
    expect(breakerQuota(Rat.make(1n, 3n), 2)).toBe(0);
    expect(breakerQuota(Rat.make(0n), 100)).toBe(0);
  });
  it("Maker always moves first, and after every complete block counts match the quota (property)", () => {
    fc.assert(
      fc.property(arbS, fc.integer({ min: 1, max: 60 }), ([n, d], len) => {
        const bias = Rat.make(BigInt(n), BigInt(d));
        const seq = turnSequence(bias, len);
        expect(seq[0]).toBe("maker");
        let m = 0;
        let b = 0;
        for (const p of seq) {
          if (p === "maker") {
            m += 1;
          } else {
            b += 1;
          }
          expect(b).toBeLessThanOrEqual(breakerQuota(bias, m));
        }
      }),
    );
  });
  it("roundOf is the Maker move count", () => {
    expect(roundOf(0)).toBe(0);
    expect(roundOf(5)).toBe(5);
  });
});

describe("validation and wire forms", () => {
  it("unit bias normalises to absence", () => {
    expect(isUnitBias(undefined)).toBe(true);
    expect(isUnitBias(Rat.make(2n, 2n))).toBe(true);
    expect(isUnitBias(Rat.make(3n, 2n))).toBe(false);
    expect(normalizeBias(Rat.make(1n))).toBeUndefined();
    expect(normalizeBias(undefined)).toBeUndefined();
    const two = Rat.make(2n);
    expect(normalizeBias(two)).toBe(two);
  });
  it("validateBias bounds", () => {
    expect(validateBias(Rat.make(0n))).toBeNull();
    expect(validateBias(Rat.make(BIAS_MAX))).toBeNull();
    expect(validateBias(Rat.make(BIAS_MAX * 1000n + 1n, 1000n))).not.toBeNull();
    expect(validateBias(Rat.make(-1n))).not.toBeNull();
    expect(validateBias(Rat.make(1n, BIAS_MAX_DENOMINATOR))).toBeNull();
    expect(validateBias(Rat.make(1n, BIAS_MAX_DENOMINATOR + 1n))).not.toBeNull();
  });
  it("wire form: canonical n/d only", () => {
    expect(biasToWire(undefined)).toBe("1/1");
    expect(biasToWire(Rat.make(5n, 2n))).toBe("5/2");
    expect(biasFromWire("5/2")?.equals(Rat.make(5n, 2n))).toBe(true);
    expect(biasFromWire("0/1")?.equals(Rat.make(0n))).toBe(true);
    for (const bad of ["", "2", "4/2", "5/0", "-1/2", "1/2/3", "a/b", "05/2", " 5/2"]) {
      expect(biasFromWire(bad), bad).toBeNull();
    }
  });
});
