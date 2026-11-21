import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { Rat } from "../../src/geometry/rat.ts";

export function P(x: number | string, y: number | string): Pt {
  const r = (v: number | string): Rat =>
    typeof v === "number" ? Rat.make(BigInt(v)) : Rat.fromString(v);
  return pt(r(x), r(y));
}

export function R(n: number, d = 1): Rat {
  return Rat.make(BigInt(n), BigInt(d));
}
