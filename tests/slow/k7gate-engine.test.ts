// Week-7 gate, layer 2b (slow): the FULL engine pipeline (B0 route, A1 escape,
// twin selection, B1 classification, A2 extension, win detection) over every
// B0 cell and a stride of the post-A1 B1 cells; every leaf must end in a
// terminal maker-won with a 7-vertex witness that the independent oracle
// re-confirms.
import { describe, expect, it } from "vitest";
import { runGate } from "../strategies/k7gate.ts";
import type { Family } from "../strategies/k7gate.ts";

const FAMILIES: Array<[Family, number, number]> = [
  ["integer", 7201, 2],
  ["rational", 7202, 2],
  ["concurrent", 7203, 2],
  ["flat", 7204, 2],
  ["needle", 7205, 2],
];

describe("k7 gate: full engine pipeline over cell representatives", () => {
  for (const [family, seed, n] of FAMILIES) {
    it(`${family}: ${n} hexagons`, () => {
      const s = runGate(family, seed, n, {
        leaf: "engine",
        b0Stride: 2,
        b1Stride: 6,
      });
      expect(s.failures).toEqual([]);
      expect(s.leaves).toBeGreaterThan(50);
    }, 3_600_000);
  }
});
