// geometry/pt.ts — points in Q² (§3.2).
//
// Pt is a value type { x: Rat; y: Rat }. Placed points (owner/move index)
// live in game/types.ts (§5) — this module knows no game concepts.
import { Rat } from "./rat.ts";

export interface Pt {
  readonly x: Rat;
  readonly y: Rat;
}

export function pt(x: Rat, y: Rat): Pt {
  return { x, y };
}

// Lexicographic comparator: x, then y, on Rat (§7.3). Deterministic sort
// key for hull and state hashing. Returns -1|0|1.
export function cmpPt(a: Pt, b: Pt): -1 | 0 | 1 {
  const cx = a.x.cmp(b.x);
  if (cx !== 0) {
    return cx;
  }
  return a.y.cmp(b.y);
}

export function eqPt(a: Pt, b: Pt): boolean {
  return a.x.equals(b.x) && a.y.equals(b.y);
}

// Canonical "x/y" wire helpers — both coordinates through the Rat codec (§3.1).
export function ptToJSON(p: Pt): { x: string; y: string } {
  return { x: p.x.toJSON(), y: p.y.toJSON() };
}

export function ptFromJSON(s: { x: string; y: string }): Pt {
  return pt(Rat.fromJSON(s.x), Rat.fromJSON(s.y));
}
