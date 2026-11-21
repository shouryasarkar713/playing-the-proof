// tests/geometry/rat.test.ts — §7.2/§3.1 vectors + field-axiom fuzz +
// the Phase-1 throughput micro-benchmark (informational; §29 budgets key
// off a recorded orient-ops/s figure).
import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { Rat } from "../../src/geometry/rat.ts";

describe("Rat normalization (§22.1b, §3.1)", () => {
  it("(2,−4) → (−1,2)", () => {
    const r = Rat.make(2n, -4n);
    expect(r.n).toBe(-1n);
    expect(r.d).toBe(2n);
  });

  it("make(4,−6) → (−2,3)", () => {
    const r = Rat.make(4n, -6n);
    expect(r.n).toBe(-2n);
    expect(r.d).toBe(3n);
  });

  it("make(0,−5) → (0,1)", () => {
    const r = Rat.make(0n, -5n);
    expect(r.n).toBe(0n);
    expect(r.d).toBe(1n);
  });

  it("make(6,8) → (3,4)", () => {
    const r = Rat.make(6n, 8n);
    expect(r.n).toBe(3n);
    expect(r.d).toBe(4n);
  });

  it("default denominator is 1", () => {
    expect(Rat.make(5n).toString()).toBe("5/1");
  });
});

describe("Rat comparison (§22.1e)", () => {
  it("cmp(1/3, 33/100) = +1", () => {
    expect(Rat.make(1n, 3n).cmp(Rat.make(33n, 100n))).toBe(1);
  });

  it("cmp is antisymmetric and reflexive", () => {
    const a = Rat.make(-7n, 3n);
    const b = Rat.make(5n, 2n);
    expect(a.cmp(b)).toBe(-b.cmp(a));
    expect(a.cmp(a)).toBe(0);
  });

  it("compares near-equal values exactly", () => {
    const a = Rat.make(1000000000000000000000000000001n, 1000000000000000000000000000000n);
    expect(a.cmp(Rat.ONE)).toBe(1);
    expect(Rat.ONE.cmp(a)).toBe(-1);
  });
});

describe("Rat arithmetic at 10^30 scale (§3.1)", () => {
  it("products stay exact past 2^53", () => {
    const big = Rat.make(10n ** 30n, 1n);
    const third = Rat.make(1n, 3n);
    const p = big.mul(third);
    // 10^30 / 3, reduced: 10^30 = 2^30·5^30, coprime to 3.
    expect(p.n).toBe(10n ** 30n);
    expect(p.d).toBe(3n);
    // (10^30/3)·3 = 10^30 exactly — no precision loss.
    expect(p.mul(Rat.make(3n, 1n)).equals(big)).toBe(true);
  });

  it("add/sub/mul/div identities", () => {
    const a = Rat.make(7n, 11n);
    expect(a.add(Rat.ZERO).equals(a)).toBe(true);
    expect(a.sub(a).equals(Rat.ZERO)).toBe(true);
    expect(a.mul(Rat.ONE).equals(a)).toBe(true);
    expect(a.div(a).equals(Rat.ONE)).toBe(true);
    expect(a.neg().neg().equals(a)).toBe(true);
    expect(a.neg().abs().equals(a.abs())).toBe(true);
    expect(Rat.make(-3n, 4n).abs().equals(Rat.make(3n, 4n))).toBe(true);
  });

  it("div by zero throws", () => {
    expect(() => Rat.make(1n, 2n).div(Rat.ZERO)).toThrow();
    expect(() => Rat.make(0n, 1n)).not.toThrow();
  });

  it("make with zero denominator throws", () => {
    expect(() => Rat.make(1n, 0n)).toThrow();
  });
});

describe("Rat parse/format + wire codec (§3.1, §7.2)", () => {
  it('fromString("-3/7") round-trips', () => {
    const r = Rat.fromString("-3/7");
    expect(r.n).toBe(-3n);
    expect(r.d).toBe(7n);
    expect(r.toString()).toBe("-3/7");
  });

  it("accepts U+2212 minus on input, emits ASCII", () => {
    const r = Rat.fromString("−3/7");
    expect(r.equals(Rat.make(-3n, 7n))).toBe(true);
    expect(r.toJSON()).toBe("-3/7");
  });

  it("accepts bare integers", () => {
    expect(Rat.fromString("42").equals(Rat.make(42n, 1n))).toBe(true);
  });

  it("JSON round-trips through the string form only", () => {
    const r = Rat.make(37n, 6n);
    const json = JSON.stringify(r);
    expect(json).toBe('"37/6"');
    expect(Rat.fromJSON(JSON.parse(json) as string).equals(r)).toBe(true);
    expect(Rat.fromJSON("0/1").isZero()).toBe(true);
    expect(Rat.fromJSON("-13/4").toString()).toBe("-13/4");
  });

  it("fromJSON rejects non-strings", () => {
    expect(() => Rat.fromJSON(42 as unknown as string)).toThrow();
  });

  it("fromString rejects garbage", () => {
    expect(() => Rat.fromString("")).toThrow();
    expect(() => Rat.fromString("a/b")).toThrow();
    expect(() => Rat.fromString("1/0")).toThrow();
  });
});

describe("Rat field axioms (fuzz, |n|,d ≤ 10^6)", () => {
  const arbRat = fc
    .tuple(
      fc.bigInt({ min: -1000000n, max: 1000000n }),
      fc.bigInt({ min: 1n, max: 1000000n }),
    )
    .map(([n, d]) => Rat.make(n, d));

  it("add/mul commute; add associates; mul distributes", () => {
    fc.assert(
      fc.property(arbRat, arbRat, arbRat, (a, b, c) => {
        expect(a.add(b).equals(b.add(a))).toBe(true);
        expect(a.mul(b).equals(b.mul(a))).toBe(true);
        expect(a.add(b).add(c).equals(a.add(b.add(c)))).toBe(true);
        expect(a.mul(b.add(c)).equals(a.mul(b).add(a.mul(c)))).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it("cmp is consistent with add/sub; parse∘format is identity", () => {
    fc.assert(
      fc.property(arbRat, arbRat, (a, b) => {
        // Antisymmetry without ±0 artifacts (Object.is distinguishes them).
        expect(a.cmp(b) + b.cmp(a)).toBe(0);
        expect(a.sub(b).sign()).toBe(a.cmp(b));
        expect(Rat.fromString(a.toString()).equals(a)).toBe(true);
        expect(a.d > 0n).toBe(true);
      }),
      { numRuns: 500 },
    );
  });
});

describe("Phase-1 throughput micro-benchmark (informational)", () => {
  it("measures orient-formula ops/s at representative scales", () => {
    // One orient op = 4 sub + 2 mul + 1 sub + sign, computed here with Rat.
    const scales: Array<[Rat, Rat, Rat, Rat, Rat, Rat]> = [
      // Small integers.
      [Rat.ONE, Rat.ZERO, Rat.ZERO, Rat.ONE, Rat.ONE, Rat.ONE],
      // Denominators ~10^6 (strategy-construction scale).
      [
        Rat.make(123456n, 1000000n),
        Rat.make(-987654n, 1000000n),
        Rat.make(1n, 3n),
        Rat.make(22n, 7n),
        Rat.make(-11n, 13n),
        Rat.make(5n, 999983n),
      ],
      // 10^25-scale coordinates (float64 would fail here).
      [
        Rat.make(10n ** 25n, 1n),
        Rat.make(10n ** 25n - 1n, 1n),
        Rat.make(-(10n ** 25n), 1n),
        Rat.make(-(10n ** 25n) + 1n, 1n),
        Rat.ZERO,
        Rat.ONE,
      ],
    ];
    const iters = 2000;
    const start = Date.now();
    let acc = 0;
    for (const [ax, ay, bx, by, cx, cy] of scales) {
      for (let i = 0; i < iters; i += 1) {
        const v = bx
          .sub(ax)
          .mul(cy.sub(ay))
          .sub(by.sub(ay).mul(cx.sub(ax)));
        acc += v.sign();
      }
    }
    const elapsedMs = Date.now() - start;
    const ops = scales.length * iters;
    const opsPerSec = (ops * 1000) / Math.max(elapsedMs, 1);
    console.log(
      `PHASE1-BENCHMARK orient-formula ops/s: ${Math.round(opsPerSec)} ` +
        `(${ops} ops in ${elapsedMs} ms; checksum ${acc})`,
    );
    // Flake-proof floor: the figure is informational.
    expect(opsPerSec).toBeGreaterThan(100);
  });
});
