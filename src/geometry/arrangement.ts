// geometry/arrangement.ts — the shared exact cell machinery (§7.3).
//
// arrangementCells(lines, window): start with [window]; for each line, split
// every cell it strictly crosses (a vertex strictly on each side) into its
// two clipped halves; discard degenerates; verify coverage exactly
// (Σ area2(cells) == area2(window) — a fail-loud tripwire).
// Work: O(lines × cells) exact clips. Owned by geometry/, consumed by
// strategy/ and verification/ (§18).
import { Rat } from "./rat.ts";
import type { Pt } from "./pt.ts";
import { signedArea2 } from "./predicates.ts";
import {
  clipConvexByHalfPlane,
  polygonArea2,
  regionNonEmpty,
} from "./poly.ts";
import type { ConvexPoly } from "./poly.ts";

export interface ArrLine {
  readonly a: Pt;
  readonly b: Pt;
}

export function arrangementCells(
  lines: readonly ArrLine[],
  window: ConvexPoly,
): ConvexPoly[] {
  let cells: Pt[][] = [[...window]];
  for (const line of lines) {
    const next: Pt[][] = [];
    for (const cell of cells) {
      let hasPos = false;
      let hasNeg = false;
      for (const v of cell) {
        const s = signedArea2(line.a, line.b, v).sign();
        if (s > 0) {
          hasPos = true;
        } else if (s < 0) {
          hasNeg = true;
        }
      }
      if (hasPos && hasNeg) {
        const left = clipConvexByHalfPlane(cell, line.a, line.b, true);
        const right = clipConvexByHalfPlane(cell, line.a, line.b, false);
        if (regionNonEmpty(left)) {
          next.push(left);
        }
        if (regionNonEmpty(right)) {
          next.push(right);
        }
      } else {
        next.push(cell);
      }
    }
    cells = next;
  }
  const total = cells.reduce(
    (acc, c) => acc.add(polygonArea2(c)),
    Rat.ZERO,
  );
  if (!total.equals(polygonArea2([...window]))) {
    throw new Error(
      "arrangementCells: coverage mismatch — implementation error",
    );
  }
  return cells;
}
