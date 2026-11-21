// geometry/hull.ts — convex hull via Andrew's monotone chain (§3.6, §22.2).
import { cmpPt, eqPt } from "./pt.ts";
import type { Pt } from "./pt.ts";
import { orient } from "./predicates.ts";

function scan(chain: Pt[], p: Pt): void {
  while (chain.length >= 2) {
    const a = chain[chain.length - 2];
    const b = chain[chain.length - 1];
    if (a === undefined || b === undefined || orient(a, b, p) > 0) {
      break;
    }
    chain.pop();
  }
  chain.push(p);
}

// hull(P): dedupe(sortBy cmpPt); if |P| ≤ 2 return P; lower/upper scans pop
// while orient(h[-2],h[-1],p) ≤ 0; return lower[0..-2] ++ upper[0..-2] —
// CCW, starting at the lexicographic minimum (§22.2). All-collinear input
// returns the 2 endpoints (GP makes this unreachable live; still tested).
export function hull(points: readonly Pt[]): Pt[] {
  const sorted = [...points].sort(cmpPt);
  const uniq: Pt[] = [];
  for (const p of sorted) {
    const last = uniq[uniq.length - 1];
    if (last === undefined || !eqPt(last, p)) {
      uniq.push(p);
    }
  }
  if (uniq.length <= 2) {
    return uniq;
  }
  const lower: Pt[] = [];
  for (const p of uniq) {
    scan(lower, p);
  }
  const upper: Pt[] = [];
  for (let i = uniq.length - 1; i >= 0; i -= 1) {
    const p = uniq[i];
    if (p === undefined) {
      continue;
    }
    scan(upper, p);
  }
  // Drop the duplicated endpoints of each chain.
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

// A set is in convex position iff every point is a hull vertex (§3.5).
// k < 3 → false; k = 3 → non-degenerate triangle (total even for
// collinear sandbox inputs, which GP forbids live).
export function convexPosition(points: readonly Pt[]): boolean {
  if (points.length < 3) {
    return false;
  }
  return hull(points).length === points.length;
}
