import { describe, expect, it } from "vitest";
import { Rat } from "../../src/geometry/rat.ts";
import {
  createGreedyBlockingPolicy,
  createRandomLegalPolicy,
  createStrategyAwarePolicy,
  runKStrip,
} from "../../src/kstrip/index.ts";
import type { BreakerPolicy } from "../../src/kstrip/index.ts";

const policies: [string, () => BreakerPolicy][] = [
  ["random", () => createRandomLegalPolicy(7)],
  ["greedy", () => createGreedyBlockingPolicy()],
  ["aware", () => createStrategyAwarePolicy()],
];

describe("mono 1:1 deeper", () => {
  for (const [n, mk] of policies) {
    it(`${n} k=5 t=1`, () => {
      const r = runKStrip(5, 1, mk());
      expect(r.status, r.message).toBe("completed");
      expect(r.rounds).toBe(106);
    }, 120000);
    it(`${n} k=3 t=3`, () => {
      const r = runKStrip(3, 3, mk());
      expect(r.status, r.message).toBe("completed");
      expect(r.claims.length).toBeGreaterThanOrEqual(3);
    });
  }
});

describe("mono 1:s", () => {
  for (const [n, mk] of policies) {
    for (const [k, s] of [[3, 2], [4, 2], [3, 3], [4, 1]] as const) {
      it(`${n} k=${k} s=${s}`, () => {
        const r = runKStrip(k, 1, mk(), undefined, {
          variant: "mono-1:s",
          s: Rat.make(BigInt(s)),
        });
        expect(r.status, r.message).toBe("completed");
        expect(r.claims.length).toBeGreaterThanOrEqual(1);
      }, 120000);
    }
  }
});

describe("bichromatic", () => {
  for (const [n, mk] of policies) {
    for (const [k, s, r] of [
      [2, "1/1", 1],
      [3, "1/1", 1],
      [3, "3/2", 1],
      [2, "3/2", 2],
      [3, "0/1", 2],
    ] as const) {
      it(`${n} k=${k} s=${s} r=${r}`, () => {
        const res = runKStrip(k, r, mk(), undefined, {
          variant: "bichromatic",
          s: Rat.fromString(s),
        });
        expect(res.status, res.message).toBe("completed");
        expect(res.claims.length).toBeGreaterThanOrEqual(r);
      }, 120000);
    }
  }
});
