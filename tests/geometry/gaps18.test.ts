// tests/geometry/gaps18.test.ts — Phase-18 line-coverage completions for
// small geometry units: wire codec, sparse-input guards, degenerate
// inputs, budget-throw paths, union/wraparound canonicalization. Each
// pins presently-uncovered but reachable behavior.
import { describe, expect, it } from "vitest";
import { Rat } from "../../src/geometry/rat.ts";
import { pt, ptFromJSON, ptToJSON } from "../../src/geometry/pt.ts";import type { Pt } from "../../src/geometry/pt.ts";
import { gp } from "../../src/geometry/predicates.ts";
import { analyzeHoles } from "../../src/geometry/holes.ts";
import { withIds } from "../helpers.ts";
import {
  canonicalInteriorPoint,
  canonicalizePoly,
  insideConvex,
  regionKey,
} from "../../src/geometry/poly.ts";

function P(x: number, y: number): Pt {
  return pt(Rat.make(BigInt(x)), Rat.make(BigInt(y)));
}

describe("pt wire codec (§3.1)", () => {
  it("round-trips through JSON strings", () => {
    const p = pt(Rat.make(3n, 2n), Rat.make(-7n, 5n));
    expect(ptFromJSON(ptToJSON(p))).toEqual(p);
    expect(ptToJSON(p)).toEqual({ x: "3/2", y: "-7/5" });
  });
});

describe("sparse-input guards (never crash on holes)", () => {
  it("gp tolerates holes vacuously", () => {
    const sparse = [P(0, 0), undefined as never, P(1, 1)];
    expect(gp(sparse as Pt[])).toBe(true);
  });

  it("canonicalInteriorPoint skips holes", () => {
    const sparse = [P(0, 0), undefined as never, P(1, 0), P(0, 1)];
    const rep = canonicalInteriorPoint(sparse as Pt[]);
    // First hole-free non-collinear triple is (0,0),(1,0),(0,1).
    expect(rep).toEqual(pt(Rat.make(1n, 3n), Rat.make(1n, 3n)));
  });
});

describe("Rat predicates", () => {
  it("isNeg distinguishes sign", () => {
    expect(Rat.make(-3n).isNeg()).toBe(true);
    expect(Rat.make(0n).isNeg()).toBe(false);
    expect(Rat.make(4n).isNeg()).toBe(false);
  });
});

describe("analyzeHoles budget discipline (§7.3)", () => {
  it("rejects non-finite and negative budgets loudly", () => {
    const pts = withIds([P(0, 0), P(4, 0), P(4, 4)]);
    expect(() => analyzeHoles(pts, 3, { budget: Number.NaN })).toThrowError(
      /budget must be a finite number/,
    );
    expect(() => analyzeHoles(pts, 3, { budget: -1 })).toThrowError(
      /budget must be a finite number/,
    );
  });
});

describe("poly degenerate + canonicalization branches", () => {
  it("insideConvex rejects sub-triangle inputs", () => {
    expect(insideConvex([P(0, 0), P(1, 1)], P(0, 0), false)).toBe(false);
    expect(insideConvex([], P(0, 0), true)).toBe(false);
  });

  it("regionKey serializes unions", () => {
    const key = regionKey({
      kind: "union",
      parts: [
        { kind: "poly", verts: [P(0, 0), P(1, 0)] },
        { kind: "poly", verts: [P(2, 2)] },
      ],
    });
    expect(key.startsWith("U(")).toBe(true);
    expect(key).toContain("P(0/1,0/1;1/1,0/1)");
  });

  it("canonicalizePoly drops wraparound duplicates", () => {
    expect(canonicalizePoly([P(0, 0), P(1, 0), P(0, 0)])).toEqual([
      P(0, 0),
      P(1, 0),
    ]);
  });
});
