// lab/bounds.ts — the published k-strip round bounds as exact rationals
// (monochromatic game, integer bias s >= 1): DZ Thm 3 (s = 1) and Thm 4.
//   r(1,t) = t/(s+1),  r(2,t) = 2t/(s+1),  r(k,t) = r(k-1, 4st) + 2t  (k >= 3)
// These are UPPER BOUNDS from the source; no bound is stated for the
// bichromatic strategy, and none is invented here.
import { Rat } from "../geometry/rat.ts";

export type RoundBound =
  | { readonly kind: "bound"; readonly rounds: Rat; readonly source: "DZ-T3" | "DZ-T4" }
  | { readonly kind: "none"; readonly reason: string };

export function monoRoundBound(k: number, t: number, s: Rat): RoundBound {
  if (!Number.isInteger(k) || k < 1 || !Number.isInteger(t) || t < 1) {
    return { kind: "none", reason: "k and t must be integers >= 1" };
  }
  if (s.d !== 1n || s.n < 1n) {
    return { kind: "none", reason: "the published round bound is stated for integer s >= 1 only" };
  }
  const four = 4n * s.n;
  let tt = BigInt(t);
  let acc = Rat.ZERO;
  for (let j = k; j >= 3; j -= 1) {
    acc = acc.add(Rat.make(2n * tt));
    tt *= four;
  }
  const base = k >= 2 ? Rat.make(2n * tt, s.n + 1n) : Rat.make(tt, s.n + 1n);
  return { kind: "bound", rounds: acc.add(base), source: s.n === 1n ? "DZ-T3" : "DZ-T4" };
}

// Closed form as printed (k >= 2), for cross-checking the recurrence.
export function monoRoundBoundClosedForm(k: number, t: number, s: bigint): Rat {
  const p = (4n * s) ** BigInt(k - 2);
  const inner = Rat.make(p, s + 1n).add(Rat.make(p - 1n, 4n * s - 1n));
  return inner.mul(Rat.make(2n * BigInt(t)));
}
