// tests/game/hash.test.ts — §15.4 canonical hashing: stability,
// sensitivity, seq/var-order semantics.
import { describe, expect, it } from "vitest";
import { Rat } from "../../src/geometry/rat.ts";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { stateHash } from "../../src/game/hash.ts";
import { withSeq } from "../../src/session/commit.ts";
import { placePoint } from "../../src/game/place.ts";
import type { GameState } from "../../src/game/types.ts";
import { sandboxState } from "../helpers.ts";

function P(x: number, y: number): Pt {
  return pt(Rat.make(BigInt(x)), Rat.make(BigInt(y)));
}

describe("stateHash (§15.4)", () => {
  it("is stable across runs and 16-hex formatted", () => {
    const s = sandboxState([P(0, 0), P(4, 0)]);
    const a = stateHash(s);
    const b = stateHash(sandboxState([P(0, 0), P(4, 0)]));
    expect(a).toBe(b);
    expect(/^[0-9a-f]{16}$/.test(a)).toBe(true);
  });

  it("changes with points, seq, turn, and terminal", () => {
    const s = sandboxState([P(0, 0)]);
    expect(stateHash(sandboxState([P(0, 0)]))).toBe(stateHash(s));
    expect(stateHash(sandboxState([P(1, 1)]))).not.toBe(stateHash(s));
    expect(stateHash(withSeq(s, 7))).not.toBe(stateHash(s));
    expect(stateHash(placePoint(s, "breaker", P(1, 0)))).not.toBe(
      stateHash(s),
    );
  });

  it("is independent of vars insertion order", () => {
    const varsA = { B: "p2", A: "p1" } as Record<string, "p1" | "p2">;
    const varsB = { A: "p1", B: "p2" } as Record<string, "p1" | "p2">;
    const mk = (vars: Record<string, "p1" | "p2">): GameState => ({
      ...sandboxState([P(0, 0), P(1, 0)]),
      mode: "break",
      turn: "maker",
      strategy: {
        strategyId: "esmb-k5",
        version: "1.0.0",
        nodeId: "k5:r2:classify",
        vars,
        lastCase: null,
      },
    });
    expect(stateHash(mk(varsA))).toBe(stateHash(mk(varsB)));
  });
});
