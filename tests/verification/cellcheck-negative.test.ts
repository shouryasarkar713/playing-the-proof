// NEGATIVE paths of the exact cell checks (mutation survivors X5/X6):
// a failing configuration must be reported COUNTEREXAMPLE with a reproducible
// witness fixture; accounting defects IMPLEMENTATION_ERROR; never PASS.
import { describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ mode: "real" as "real" | "empty" | "starved" }));
vi.mock("../../src/geometry/holes.ts", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../src/geometry/holes.ts")>();
  return {
    ...orig,
    findKHoles: (pts: Parameters<typeof orig.findKHoles>[0], k: number, o: Parameters<typeof orig.findKHoles>[2]) => {
      if (hooks.mode === "empty") return { kind: "exhaustive", k, holes: [] };
      if (hooks.mode === "starved") return { kind: "budget-exhausted", k, searched: 0 };
      return orig.findKHoles(pts, k, o);
    },
  };
});

import { cellCheckToValidation, k5B3Check, k6B1Check } from "../../src/verification/cellchecks.ts";
import { PRESET_P5 } from "../../src/strategy/strategies/k6/preset.ts";
import { testWindow } from "../helpers.ts";
import { P } from "../strategies/k6driver.ts";

const FIVE = [P(0, 0), P(10, 1), P(3, 12), P(-7, 5), P(9, -8)];

describe("cell checks: negative paths", () => {
  it("k5B3Check: PASS on a real configuration; COUNTEREXAMPLE + witness when a cell has no 4-hole; IMPLEMENTATION_ERROR on starvation / wrong |F|", () => {
    hooks.mode = "real";
    expect(k5B3Check(FIVE, testWindow(), "t").result).toBe("PASS");
    hooks.mode = "empty";
    const cx = k5B3Check(FIVE, testWindow(), "t");
    expect(cx.result).toBe("COUNTEREXAMPLE");
    expect(cx.witness?.fixture).toContain("no-4-hole");
    expect(cx.checked).toBe(0);
    expect(cellCheckToValidation(cx).result).toBe("COUNTEREXAMPLE");
    hooks.mode = "starved";
    expect(k5B3Check(FIVE, testWindow(), "t").result).toBe("IMPLEMENTATION_ERROR");
    hooks.mode = "real";
    expect(k5B3Check(FIVE.slice(0, 4), testWindow(), "t").result).toBe("IMPLEMENTATION_ERROR");
  });

  it("k6B1Check: a bare pentagon is a NATURAL counterexample (B1 in the forced region leaves no 5-hole); starvation is IMPLEMENTATION_ERROR", () => {
    hooks.mode = "real";
    const r = k6B1Check([...PRESET_P5], testWindow(), "bare-pentagon");
    expect(r.result).toBe("COUNTEREXAMPLE");
    expect(r.witness?.fixture).toContain("no-5-hole");
    hooks.mode = "empty";
    expect(k6B1Check(FIVE, testWindow(), "t").result).toBe("COUNTEREXAMPLE");
    hooks.mode = "starved";
    const s = k6B1Check(FIVE, testWindow(), "t");
    expect(s.result).toBe("IMPLEMENTATION_ERROR");
    expect(s.witness?.fixture).toContain("budget-exhausted");
    hooks.mode = "real";
  });
});
