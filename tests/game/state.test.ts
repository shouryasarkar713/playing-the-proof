// tests/game/state.test.ts — I1–I4+I5a, placePoint, immutability (§5.2/§5.4).
import { describe, expect, it } from "vitest";
import { Rat } from "../../src/geometry/rat.ts";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import {
  checkStateInvariants,
  placedId,
  placePoint,
} from "../../src/game/place.ts";
import { withStrategy } from "../../src/game/types.ts";
import type { GameState } from "../../src/game/types.ts";
import { sandboxState } from "../helpers.ts";

function P(x: number, y: number): Pt {
  return pt(Rat.make(BigInt(x)), Rat.make(BigInt(y)));
}

describe("checkStateInvariants (I1–I4 + I5a)", () => {
  it("accepts valid sandbox states", () => {
    expect(checkStateInvariants(sandboxState([]))).toEqual({ ok: true });
    expect(
      checkStateInvariants(sandboxState([P(0, 0), P(4, 0), P(0, 4)])),
    ).toEqual({ ok: true });
  });

  it("I1: ids p{i+1} and moves i+1", () => {
    const bad: GameState = {
      ...sandboxState([P(0, 0)]),
      points: [{ id: "q1", owner: "maker", pt: P(0, 0), move: 1 }],
    };
    const r = checkStateInvariants(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.violated).toBe("i1");
    }
  });

  it("I2: general position", () => {
    const r = checkStateInvariants(sandboxState([P(0, 0), P(1, 1), P(2, 2)]));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.violated).toBe("i2");
    }
  });

  it("I3: turn alternation (Maker first)", () => {
    const bad: GameState = {
      ...sandboxState([P(0, 0)]),
      turn: "maker",
    };
    const r = checkStateInvariants(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.violated).toBe("i3");
    }
  });

  it("I4: terminal iff turn over", () => {
    const a: GameState = { ...sandboxState([]), turn: "over" };
    expect(checkStateInvariants(a).ok).toBe(false);
    const b: GameState = {
      ...sandboxState([P(0, 0)]),
      terminal: {
        kind: "maker-won",
        k: 3,
        witness: [],
        nodeId: "sandbox",
      },
      turn: "breaker",
    };
    const r = checkStateInvariants(b);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.violated).toBe("i4");
    }
  });

  it("I5a: strategy iff non-sandbox", () => {
    const bad: GameState = { ...sandboxState([]), mode: "proof" };
    const r = checkStateInvariants(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.violated).toBe("i5a");
    }
  });
});

describe("placePoint", () => {
  it("assigns ids/moves, flips turn, preserves seq and strategy", () => {
    const s0 = sandboxState([]);
    const s1 = placePoint(s0, "maker", P(0, 0));
    expect(s1.points.length).toBe(1);
    expect(s1.points[0]).toMatchObject({ id: "p1", owner: "maker", move: 1 });
    expect(s1.turn).toBe("breaker");
    expect(s1.seq).toBe(0);
    const s2 = placePoint(s1, "breaker", P(4, 0));
    expect(s2.points[1]).toMatchObject({ id: "p2", move: 2 });
    expect(s2.turn).toBe("maker");
    // Prior states untouched (value objects).
    expect(s0.points.length).toBe(0);
    expect(s1.points.length).toBe(1);
  });

  it("throws on terminal input", () => {
    const s: GameState = {
      ...sandboxState([P(0, 0)]),
      terminal: { kind: "maker-won", k: 3, witness: [], nodeId: "sandbox" },
      turn: "over",
    };
    expect(() => placePoint(s, "breaker", P(1, 1))).toThrow();
  });

  it("emitted states are deep-frozen (mutation throws)", () => {
    const s1 = placePoint(sandboxState([]), "maker", P(0, 0));
    expect(() =>
      (s1.points as unknown as Pt[]).push(P(9, 9)),
    ).toThrow();
    expect(() => {
      ((s1 as unknown as Record<string, unknown>)["turn"] = "maker");
    }).toThrow();
  });

  it("placedId returns the last id; throws when empty", () => {
    expect(placedId(sandboxState([P(0, 0), P(1, 0)]))).toBe("p2");
    expect(() => placedId(sandboxState([]))).toThrow();
  });
});

describe("withStrategy", () => {
  it("replaces the runtime wholesale, leaving the old state untouched", () => {
    const rt = {
      strategyId: "esmb-k5",
      version: "1.0.0",
      nodeId: "k5:await-b1",
      vars: {},
      lastCase: null,
    };
    const s: GameState = { ...sandboxState([]), strategy: rt };
    const s2 = withStrategy(s, (r) => ({ ...r, nodeId: "k5:r2:classify" }));
    expect(s2.strategy?.nodeId).toBe("k5:r2:classify");
    expect(s.strategy?.nodeId).toBe("k5:await-b1");
  });

  it("throws on a strategy-less state", () => {
    expect(() =>
      withStrategy(sandboxState([]), (r) => r),
    ).toThrow();
  });
});
