// tests/strategies/k7oracle.ts — INDEPENDENT oracle for "a k-hole exists":
// plain bigint integer arithmetic (all rationals scaled by the LCM of their
// denominators); imports NOTHING from src/geometry. Criterion (Lean-verified in
//re-derived there): in general position a k-subset is a
// k-hole iff every triple of it spans a triangle containing no point of the
// whole set strictly inside.
import type { Pt } from "../../src/geometry/pt.ts";

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x;
}

type IP = readonly [bigint, bigint];

function toInts(pts: readonly Pt[]): IP[] {
  let l = 1n;
  for (const p of pts) {
    for (const r of [p.x, p.y]) {
      l = (l / gcd(l, r.d)) * r.d;
    }
  }
  return pts.map(
    (p) => [(p.x.n * l) / p.x.d, (p.y.n * l) / p.y.d] as const,
  );
}

function sgn(a: IP, b: IP, c: IP): number {
  const v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return v > 0n ? 1 : v < 0n ? -1 : 0;
}

export function oracleHasHole(allPts: readonly Pt[], k: number): boolean {
  const all = toInts(allPts);
  const n = all.length;
  const empty = new Map<number, boolean>();
  const id = (i: number, j: number, l: number): number => (i * n + j) * n + l;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      for (let l = j + 1; l < n; l += 1) {
        let e = true;
        for (let m = 0; m < n && e; m += 1) {
          if (m === i || m === j || m === l) {
            continue;
          }
          const p = all[m] as IP;
          const s1 = sgn(all[i] as IP, all[j] as IP, p);
          const s2 = sgn(all[j] as IP, all[l] as IP, p);
          const s3 = sgn(all[l] as IP, all[i] as IP, p);
          if ((s1 > 0 && s2 > 0 && s3 > 0) || (s1 < 0 && s2 < 0 && s3 < 0)) {
            e = false;
          }
        }
        empty.set(id(i, j, l), e);
      }
    }
  }
  const chosen: number[] = [];
  const rec = (start: number): boolean => {
    if (chosen.length === k) {
      return true;
    }
    for (let v = start; v < n; v += 1) {
      let ok = true;
      for (let a = 0; a < chosen.length && ok; a += 1) {
        for (let b = a + 1; b < chosen.length && ok; b += 1) {
          if (!empty.get(id(chosen[a] as number, chosen[b] as number, v))) {
            ok = false;
          }
        }
      }
      if (!ok) {
        continue;
      }
      chosen.push(v);
      if (rec(v + 1)) {
        return true;
      }
      chosen.pop();
    }
    return false;
  };
  return rec(0);
}
