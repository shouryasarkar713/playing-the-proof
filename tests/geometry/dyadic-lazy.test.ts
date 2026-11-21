// dyadicSValues is now lazy; it must produce EXACTLY the sequence of the
// original eager (materialise + sort) generator, which is reproduced here as
// the reference, and must not blow up on wide ranges.
import { describe, expect, it } from "vitest";
import { dyadicSValues } from "../../src/geometry/extend.ts";
import { Rat } from "../../src/geometry/rat.ts";
import { mulberry32 } from "../helpers.ts";

function floorRat(r: Rat): bigint {
  const q = r.n / r.d;
  return r.n % r.d === 0n || r.n >= 0n ? q : q - 1n;
}
function ceilRat(r: Rat): bigint {
  const q = r.n / r.d;
  return r.n % r.d === 0n || r.n <= 0n ? q : q + 1n;
}
function* eager(sLo: Rat, sHi: Rat): Generator<Rat> {
  for (let j = 0; ; j += 1) {
    const den = 2n ** BigInt(j);
    const denRat = Rat.make(den);
    const loK = floorRat(sLo.mul(denRat)) + 1n;
    const hiK = ceilRat(sHi.mul(denRat)) - 1n;
    const ks: bigint[] = [];
    for (let k = loK; k <= hiK; k += 1n) {
      if (k === 0n) {
        if (j === 0) {
          ks.push(k);
        }
        continue;
      }
      if (k % 2n !== 0n) {
        ks.push(k);
      }
    }
    ks.sort((a, b) => {
      const aa = a < 0n ? -a : a;
      const bb = b < 0n ? -b : b;
      if (aa !== bb) {
        return aa < bb ? -1 : 1;
      }
      return a < b ? -1 : 1;
    });
    for (const k of ks) {
      yield Rat.make(k, den);
    }
  }
}

describe("dyadicSValues lazy == eager reference", () => {
  it("same first 400 values on 120 random (and edge) ranges", () => {
    const rand = mulberry32(99);
    const ranges: Array<[Rat, Rat]> = [
      [Rat.make(-3n), Rat.make(3n)],
      [Rat.make(0n), Rat.make(1n)],
      [Rat.make(-1n, 2n), Rat.make(1n, 2n)],
      [Rat.make(1n), Rat.make(2n)],
      [Rat.make(-7n, 3n), Rat.make(-1n, 5n)],
    ];
    for (let i = 0; i < 120; i += 1) {
      const a = Rat.make(BigInt(Math.floor((rand() - 0.5) * 400)), BigInt(1 + Math.floor(rand() * 17)));
      const w = Rat.make(BigInt(1 + Math.floor(rand() * 90)), BigInt(1 + Math.floor(rand() * 9)));
      ranges.push([a, a.add(w)]);
    }
    for (const [lo, hi] of ranges) {
      const L = dyadicSValues(lo, hi);
      const E = eager(lo, hi);
      for (let n = 0; n < 400; n += 1) {
        const x = L.next().value as Rat;
        const y = E.next().value as Rat;
        expect(x.toString()).toBe(y.toString());
      }
    }
  });

  it("a ±10^6-wide range yields its first 200 values instantly (the eager one built ~10^6-entry ranks)", () => {
    const g = dyadicSValues(Rat.make(-1000000n), Rat.make(1000000n));
    const t0 = performance.now();
    const firsts: string[] = [];
    for (let i = 0; i < 200; i += 1) {
      firsts.push((g.next().value as Rat).toString());
    }
    expect(performance.now() - t0).toBeLessThan(500);
    expect(firsts.slice(0, 5)).toEqual(["0/1", "-1/1", "1/1", "-3/1", "3/1"]);
  });
});
