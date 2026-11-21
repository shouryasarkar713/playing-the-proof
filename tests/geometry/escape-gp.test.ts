// escapeNearEdge general-position validation + acceptance predicate
// (mutation survivor 14: removing gpSelfCheck went undetected).
import { describe, expect, it } from "vitest";
import { escapeNearEdge, DEFAULT_WINDOW } from "../../src/geometry/extend.ts";
import { orient } from "../../src/geometry/predicates.ts";
import { eqPt, pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { Rat } from "../../src/geometry/rat.ts";

const R = (n: number, d = 1): Rat => Rat.make(BigInt(n), BigInt(d));
const P = (x: number, y: number): Pt => pt(R(x), R(y));
const pent = [P(0, 0), P(10, 0), P(13, 8), P(5, 13), P(-3, 8)];

describe("escapeNearEdge", () => {
  it("first candidate is (5,-1/20); a placed pair collinear with it forces another point", () => {
    const first = escapeNearEdge(pent[0]!, pent[1]!, pent[4]!, pent[2]!, pent, DEFAULT_WINDOW);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.point.x.toString()).toBe("5/1");
    expect(first.point.y.toString()).toBe("-1/20");
    // two extra placed points whose line is y = -1/20 (through the first candidate)
    const placed = [...pent, pt(R(-10), R(-1, 20)), pt(R(20), R(-1, 20))];
    const r = escapeNearEdge(pent[0]!, pent[1]!, pent[4]!, pent[2]!, placed, DEFAULT_WINDOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(eqPt(r.point, first.point)).toBe(false);
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        expect(orient(placed[i]!, placed[j]!, r.point)).not.toBe(0);
      }
      expect(eqPt(placed[i]!, r.point)).toBe(false);
    }
  });

  it("the accept predicate is honoured: rejected candidates are skipped, halving continues", () => {
    const seen: Pt[] = [];
    const r = escapeNearEdge(pent[0]!, pent[1]!, pent[4]!, pent[2]!, pent, DEFAULT_WINDOW, (p) => {
      seen.push(p);
      return seen.length >= 3;
    });
    expect(r.ok).toBe(true);
    expect(seen.length).toBe(3);
    if (r.ok) {
      expect(eqPt(r.point, seen[2]!)).toBe(true);
      // later candidates are strictly closer to the edge than the first
      expect(seen[2]!.y.cmp(seen[0]!.y)).toBeGreaterThan(0);
    }
  });

  it("a predicate that never accepts fails closed (window-exhausted), never returns a point", () => {
    const r = escapeNearEdge(pent[0]!, pent[1]!, pent[4]!, pent[2]!, pent, DEFAULT_WINDOW, () => false);
    expect(r).toEqual({ ok: false, reason: "window-exhausted" });
  });
});
