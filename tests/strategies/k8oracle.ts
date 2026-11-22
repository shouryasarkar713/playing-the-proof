// tests/strategies/k8oracle.ts — independent integer oracle for k-hole subsets
// (plain bigint arithmetic, no src/geometry import): a subset of a point set in
// general position is a k-hole iff every triangle spanned by three of its
// members contains no point of the whole set strictly inside.
import type { Pt } from "../../src/geometry/pt.ts";

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x;
}

export function toIntegers(pts: readonly Pt[]): Array<readonly [bigint, bigint]> {
  let l = 1n;
  for (const p of pts) {
    for (const r of [p.x, p.y]) {
      l = (l / gcd(l, r.d)) * r.d;
    }
  }
  return pts.map((p) => [(p.x.n * l) / p.x.d, (p.y.n * l) / p.y.d] as const);
}

type IP = readonly [bigint, bigint];

function sgn(a: IP, b: IP, c: IP): number {
  const v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return v > 0n ? 1 : v < 0n ? -1 : 0;
}

function inside(p: IP, a: IP, b: IP, c: IP): boolean {
  const s1 = sgn(a, b, p);
  const s2 = sgn(b, c, p);
  const s3 = sgn(c, a, p);
  return (s1 > 0 && s2 > 0 && s3 > 0) || (s1 < 0 && s2 < 0 && s3 < 0);
}

export function oracleIsHole(all: readonly Pt[], subset: readonly number[]): boolean {
  const pts = toIntegers(all);
  for (let i = 0; i < subset.length; i += 1) {
    for (let j = i + 1; j < subset.length; j += 1) {
      for (let k = j + 1; k < subset.length; k += 1) {
        const a = pts[subset[i] as number] as IP;
        const b = pts[subset[j] as number] as IP;
        const c = pts[subset[k] as number] as IP;
        for (let m = 0; m < pts.length; m += 1) {
          if (m === subset[i] || m === subset[j] || m === subset[k]) {
            continue;
          }
          if (inside(pts[m] as IP, a, b, c)) {
            return false;
          }
        }
      }
    }
  }
  return true;
}
