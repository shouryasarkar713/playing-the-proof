// tests/game/legality.test.ts — §4.4 ladder order + rejection shapes.
import { describe, expect, it } from "vitest";
import { Rat } from "../../src/geometry/rat.ts";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { checkPlacement } from "../../src/game/legality.ts";
import { sandboxState, testWindow } from "../helpers.ts";

function P(x: number, y: number): Pt {
  return pt(Rat.make(BigInt(x)), Rat.make(BigInt(y)));
}

describe("§4.4 legality ladder", () => {
  it("reports outside-window first (even when collinear)", () => {
    const state = sandboxState([P(0, 0), P(10, 0)]);
    // (2·10⁶, 0): outside the window AND collinear with (p1,p2).
    const r = checkPlacement(
      state,
      pt(Rat.make(2000000n), Rat.make(0n)),
      testWindow(),
    );
    expect(r?.reason).toBe("outside-window");
  });

  it("reports coincidence before collinearity", () => {
    const state = sandboxState([P(0, 0), P(1, 0), P(0, 1)]);
    // (0,0) coincides with p1 (and is trivially collinear with pairs).
    const r = checkPlacement(state, P(0, 0), testWindow());
    expect(r?.reason).toBe("coincides-with-existing-point");
    if (r?.reason === "coincides-with-existing-point") {
      expect(r.with).toBe("p1");
    }
  });

  it("reports the first collinear pair in placement order", () => {
    const state = sandboxState([P(0, 0), P(1, 0)]);
    const r = checkPlacement(state, P(2, 0), testWindow());
    expect(r?.reason).toBe("collinear-with");
    if (r?.reason === "collinear-with") {
      expect(r.pair).toEqual(["p1", "p2"]);
    }
  });

  it("accepts a legal point (null)", () => {
    const state = sandboxState([P(0, 0), P(1, 0)]);
    expect(checkPlacement(state, P(1, 1), testWindow())).toBe(null);
    expect(checkPlacement(sandboxState([]), P(0, 0), testWindow())).toBe(null);
  });

  it("window edges are legal (closed window)", () => {
    const state = sandboxState([]);
    const edge = pt(Rat.make(1000000n), Rat.make(0n));
    expect(checkPlacement(state, edge, testWindow())).toBe(null);
  });
});
