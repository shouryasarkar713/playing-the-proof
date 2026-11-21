// tests/viz/interaction.test.ts — hover ghosts: exact legality + nearest
// point within the 10px world-converted threshold.
import { describe, expect, it } from "vitest";
import { Rat } from "../../src/geometry/rat.ts";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { hoverToGhost } from "../../src/viz/interaction.ts";
import { screenToWorldQuantized } from "../../src/viz/projection.ts";
import type { View } from "../../src/viz/projection.ts";
import { sandboxState, testWindow } from "../helpers.ts";

function P(x: number, y: number): Pt {
  return pt(Rat.make(BigInt(x)), Rat.make(BigInt(y)));
}

const VIEW: View = {
  cx: Rat.make(0n),
  cy: Rat.make(0n),
  s: Rat.make(2n),
  w: 100,
  h: 100,
};

describe("hoverToGhost", () => {
  it("legal hover yields a null-rejection ghost and no hover point", () => {
    const state = sandboxState([P(0, 0)]);
    const q = screenToWorldQuantized(60, 60, VIEW);
    const r = hoverToGhost(60, 60, q, state, VIEW, testWindow());
    expect(r.ghost.rejection).toBe(null);
    expect(r.hoverPoint).toBe(null);
  });

  it("collinear hover yields the math rejection", () => {
    const state = sandboxState([P(0, 0), P(1, 0)]);
    const q = screenToWorldQuantized(54, 50, VIEW); // (2,0): collinear
    expect(q.x.toString()).toBe("2/1");
    const r = hoverToGhost(54, 50, q, state, VIEW, testWindow());
    expect(r.ghost.rejection?.reason).toBe("collinear-with");
  });

  it("hover within 10px finds the nearest placed point", () => {
    const state = sandboxState([P(0, 0)]);
    // (0,0) → screen (50,50); hover at (53,50) is 3px away.
    const q = screenToWorldQuantized(53, 50, VIEW);
    const r = hoverToGhost(53, 50, q, state, VIEW, testWindow());
    expect(r.hoverPoint?.id).toBe("p1");
  });
});
