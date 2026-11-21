// tests/slow/thirtyPoint.test.ts — SLOW TIER (excluded from `verify`).
// Heule–Scheucher property (S7, Theorem 1: H(6) = 30): randomized 30-point
// GP sets always contain a 6-hole — the k=6 analog of the Harborth test.
import { describe, expect, it } from "vitest";
import { Rat } from "../../src/geometry/rat.ts";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { gp } from "../../src/geometry/predicates.ts";
import { analyzeHoles, estimateHoleWork, findKHoles } from "../../src/geometry/holes.ts";
import { withIds } from "../helpers.ts";

function P(x: number, y: number): Pt {
  return pt(Rat.make(BigInt(x)), Rat.make(BigInt(y)));
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("30-point 6-hole property (slow)", () => {
  for (let seed = 1; seed <= 10; seed += 1) {
    it(`seed ${seed}: a random 30-point GP set contains a 6-hole`, () => {
      // 10000×10000 grid: a 100×100 grid almost never yields 30 points in
      // general position (dozens of expected collinear triples). Draw with
      // rejection on the deterministic stream (bounded attempts).
      const rand = mulberry32(seed);
      let pts: Pt[] = [];
      for (let attempt = 0; attempt < 50 && pts.length === 0; attempt += 1) {
        const seen = new Set<string>();
        const cand: Pt[] = [];
        let guard = 0;
        while (cand.length < 30 && guard < 100000) {
          guard += 1;
          const p = P(Math.floor(rand() * 10000), Math.floor(rand() * 10000));
          const k = `${p.x},${p.y}`;
          if (!seen.has(k)) {
            seen.add(k);
            cand.push(p);
          }
        }
        if (cand.length === 30 && gp(cand)) {
          pts = cand;
        }
      }
      expect(pts.length).toBe(30);
      expect(gp(pts)).toBe(true);
      // Fast path: first witness (usually hits early). Fallback: the full
      // exhaustive sweep, which is complete — the theorem guarantees a
      // 6-hole, so a completed sweep must be nonempty.
      let r = analyzeHoles(withIds(pts), 6, { budget: 3000000 });
      if (r.kind === "budget-exhausted") {
        r = findKHoles(withIds(pts), 6, {
          mode: "exhaustive",
          budget: estimateHoleWork(30, 6),
        });
      }
      const found =
        r.kind === "witness-only" ||
        (r.kind === "exhaustive" && r.holes.length > 0);
      expect(found, `seed ${seed}: no 6-hole`).toBe(true);
    }, 600000);
  }
});
