// Week-7 gate, layer 2a (slow): for random convex hexagons of five families
// (integer, rational, nearly-concurrent main chords, near-collinear, needle),
// EVERY B0 arrangement cell, A1 chosen by the strategy, EVERY post-A1 B1
// arrangement cell: an independent oracle confirms a 6-hole exists after B1
// (A2 then exists by the Edge-Extension Lemma; the engine leg is 2b).
import { describe, expect, it } from "vitest";
import { runGate } from "../strategies/k7gate.ts";
import type { Family } from "../strategies/k7gate.ts";

const FAMILIES: Array<[Family, number, number]> = [
  ["integer", 7101, 6],
  ["rational", 7102, 6],
  ["concurrent", 7103, 6],
  ["flat", 7104, 5],
  ["needle", 7105, 5],
];

describe("k7 gate: all B0 cells x all post-A1 B1 cells (oracle: 6-hole survives)", () => {
  for (const [family, seed, n] of FAMILIES) {
    it(`${family}: ${n} hexagons`, () => {
      const s = runGate(family, seed, n, { leaf: "oracle6" });
      expect(s.failures).toEqual([]);
      expect(s.leaves).toBeGreaterThan(100);
    }, 3_600_000);
  }
});
