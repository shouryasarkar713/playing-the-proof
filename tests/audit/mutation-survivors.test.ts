// Kills the mutants that SURVIVED an earlier mutation run:
//  M5  holes.ts emptiness `<0`→`<=0`   (a point ON a hole's boundary must block)
//  M19 k6twins `=== 3`→`>= 3`          (pairs sharing 4 vertices are not twins)
//  M20b trapezoid emptiness skipped    (a fifth point inside {u,v,P,A3} must fail it)
//  M25a MAX_REPLAY_CHARS 2 MB→20 MB    (literal pin of the §30 cap)
import { describe, expect, it } from "vitest";
import { isKHole } from "../../src/geometry/holes.ts";
import { trapezoidChecker } from "../../src/verification/trapezoid.ts";
import { twinsChecker } from "../../src/verification/k6twins.ts";
import { MAX_REPLAY_CHARS } from "../../src/replay/format.ts";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { Rat } from "../../src/geometry/rat.ts";
import { sandboxState, testConfig } from "../helpers.ts";

const P = (x: number, y: number): Pt => pt(Rat.make(BigInt(x)), Rat.make(BigInt(y)));

describe("mutation survivors", () => {
  it("M5: a point on a hole's boundary is a blocker (isKHole false)", () => {
    const sq = [P(0, 0), P(4, 0), P(4, 4), P(0, 4)];
    expect(isKHole(sq, sq)).toBe(true);
    expect(isKHole(sq, [...sq, P(2, 0)])).toBe(false); // on the edge
    expect(isKHole(sq, [...sq, P(2, 2)])).toBe(false); // interior
    expect(isKHole(sq, [...sq, P(2, -1)])).toBe(true); // outside
  });

  it("M19: twins must share EXACTLY 3 vertices — a convex hexagon (all pairs share 4) has none", () => {
    const hex = [P(0, 0), P(10, -3), P(20, 0), P(23, 10), P(10, 15), P(-3, 10)];
    const st = sandboxState(hex, 5);
    const r = twinsChecker.check(st, { A1: ["p1"] }, testConfig());
    expect(r.passed).toBe(false);
  });

  it("M20b: the trapezoid checker fails when a fifth point lies inside {u,v,P,A3}", () => {
    const base = [P(0, 0), P(30, 0), P(0, 30), P(4, 6), P(1, 9)];
    const args = { outer: ["p1", "p2", "p3"], interior: ["p4"], A3: ["p5"] };
    const ok = trapezoidChecker.check(sandboxState(base, 5), args, testConfig());
    expect(ok.passed).toBe(true);
    const blocked = trapezoidChecker.check(sandboxState([...base, P(12, 12)], 5), args, testConfig());
    expect(blocked.passed).toBe(false);
  });

  it("M25a: the replay cap is exactly 2 MiB", () => {
    expect(MAX_REPLAY_CHARS).toBe(2 * 1024 * 1024);
  });
});
