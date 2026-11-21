// tests/viz/projection.test.ts — §17.3 vectors: exact forward transform,
// integer-exact click quantization, auto-fit, nice steps.
import { describe, expect, it } from "vitest";
import { Rat } from "../../src/geometry/rat.ts";
import { pt } from "../../src/geometry/pt.ts";
import {
  autoFit,
  niceScalar,
  ratToNumber,
  screenToWorldExact,
  screenToWorldQuantized,
  worldToScreen,
} from "../../src/viz/projection.ts";
import type { View } from "../../src/viz/projection.ts";

const VIEW: View = {
  cx: Rat.make(0n),
  cy: Rat.make(0n),
  s: Rat.make(2n),
  w: 100,
  h: 100,
};

describe("worldToScreen (§17.3)", () => {
  it("applies scale/center with y-flip, exactly", () => {
    const s = worldToScreen(pt(Rat.make(3n), Rat.make(4n)), VIEW);
    expect(s.x).toBe(56);
    expect(s.y).toBe(42);
    const origin = worldToScreen(pt(Rat.make(0n), Rat.make(0n)), VIEW);
    expect(origin).toEqual({ x: 50, y: 50 });
  });
});

describe("screenToWorldQuantized (§17.3)", () => {
  it("inverts exactly and quantizes to denominator 2s", () => {
    const p = screenToWorldQuantized(51, 50, VIEW);
    expect(p.x.toString()).toBe("1/2");
    expect(p.y.toString()).toBe("0/1");
  });

  it("maps adjacent pixels to distinct rationals", () => {
    const a = screenToWorldQuantized(51, 50, VIEW);
    const b = screenToWorldQuantized(52, 50, VIEW);
    expect(a.x.toString()).toBe("1/2");
    expect(b.x.toString()).toBe("1/1");
    expect(a.x.equals(b.x)).toBe(false);
  });

  it("screenToWorldExact inverts worldToScreen on pixels", () => {
    const p = screenToWorldExact(56, 42, VIEW);
    expect(p.x.toString()).toBe("3/1");
    expect(p.y.toString()).toBe("4/1");
    expect(ratToNumber(p.x)).toBe(3);
  });
});

describe("niceScalar", () => {
  it("floors to 1/2/5 × 10^e", () => {
    expect(niceScalar(Rat.make(7n)).toString()).toBe("5/1");
    expect(niceScalar(Rat.make(2n)).toString()).toBe("2/1");
    expect(niceScalar(Rat.make(1n)).toString()).toBe("1/1");
    expect(niceScalar(Rat.make(99n, 10n)).toString()).toBe("5/1");
    expect(niceScalar(Rat.make(3n, 2n)).toString()).toBe("1/1");
    expect(niceScalar(Rat.make(1n, 100n)).toString()).toBe("1/100");
    expect(niceScalar(Rat.make(0n)).toString()).toBe("1/1");
  });
});

describe("autoFit (§17.3)", () => {
  it("centers content with 12% margin at a nice zoom", () => {
    const view = autoFit(
      [pt(Rat.make(0n), Rat.make(0n)), pt(Rat.make(10n), Rat.make(0n))],
      800,
      600,
    );
    // x: [0,10] + 12% → [−6/5, 56/5]; y: span 0 → [−1, 1].
    expect(view.cx.toString()).toBe("5/1");
    expect(view.cy.toString()).toBe("0/1");
    // min(800/(62/5), 600/2) = min(64.5…, 300) → nice floor 50.
    expect(view.s.toString()).toBe("50/1");
    // Content strictly inside with margin to spare.
    const a = worldToScreen(pt(Rat.make(0n), Rat.make(0n)), view);
    const b = worldToScreen(pt(Rat.make(10n), Rat.make(0n)), view);
    expect(a.x).toBe(150);
    expect(b.x).toBe(650);
    expect(a.y).toBe(300);
  });

  it("empty board yields the default view", () => {
    const view = autoFit([], 800, 600);
    expect(view.s.toString()).toBe("50/1");
  });
});
