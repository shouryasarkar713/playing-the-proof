// orient() computes the sign without gcd normalization; it must equal
// the sign of the exact rational signedArea2 on EVERY input (random
// rationals incl. huge, negative, collinear-by-construction, repeated).
import { describe, expect, it } from "vitest";
import { orient, signedArea2 } from "../../src/geometry/predicates.ts";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { Rat } from "../../src/geometry/rat.ts";
import { mulberry32 } from "../helpers.ts";

function rr(rand: () => number, bits: number): Rat {
  let n = 0n;
  let d = 0n;
  for (let i = 0; i < bits; i += 16) {
    n = (n << 16n) | BigInt(Math.floor(rand() * 65536));
    d = (d << 16n) | BigInt(Math.floor(rand() * 65536));
  }
  if (rand() < 0.5) {
    n = -n;
  }
  return Rat.make(n, d === 0n ? 1n : d);
}

describe("orient fast path == sign(signedArea2)", () => {
  it("fuzz: 6000 random rational triples (small, medium, 200-bit)", () => {
    const rand = mulberry32(2026);
    for (let i = 0; i < 6000; i += 1) {
      const bits = [16, 48, 200][i % 3] as number;
      const mk = (): Pt => pt(rr(rand, bits), rr(rand, bits));
      const a = mk();
      const b = mk();
      const c = mk();
      expect(orient(a, b, c)).toBe(signedArea2(a, b, c).sign());
    }
  }, 120000);

  it("exactly-collinear rational triples and repeated points give 0", () => {
    const rand = mulberry32(7);
    for (let i = 0; i < 2000; i += 1) {
      const a = pt(rr(rand, 48), rr(rand, 48));
      const dir = pt(rr(rand, 32), rr(rand, 32));
      const t1 = rr(rand, 32);
      const t2 = rr(rand, 32);
      const b = pt(a.x.add(dir.x.mul(t1)), a.y.add(dir.y.mul(t1)));
      const c = pt(a.x.add(dir.x.mul(t2)), a.y.add(dir.y.mul(t2)));
      expect(orient(a, b, c)).toBe(0);
      expect(orient(a, a, b)).toBe(0);
    }
  });

  it("near-collinear perturbation of 1/10^40 keeps its sign", () => {
    const a = pt(Rat.make(0n), Rat.make(0n));
    const b = pt(Rat.make(1n), Rat.make(1n));
    const eps = Rat.make(1n, 10n ** 40n);
    expect(orient(a, b, pt(Rat.make(2n), Rat.make(2n).add(eps)))).toBe(1);
    expect(orient(a, b, pt(Rat.make(2n), Rat.make(2n).sub(eps)))).toBe(-1);
  });
});
