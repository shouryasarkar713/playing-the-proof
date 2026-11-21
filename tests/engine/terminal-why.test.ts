// a terminal that did not end at the declared terminal node must not
// show the parked node's (stale) headline.
import { describe, expect, it } from "vitest";
import { nodeExplanation } from "../../src/engine/describe.ts";
import { lintStrings } from "../../src/explain/claimlint.ts";
import { guidedState } from "../strategy/scaffolding.ts";
import { ensureK5 } from "../strategies/k5driver.ts";
import { P } from "../strategies/k6driver.ts";
import { testCtx } from "../helpers.ts";
import type { GameState } from "../../src/game/types.ts";

ensureK5();
const pts = [P(0, 0), P(10, 0), P(3, 12), P(8, 8)];
const base = (): GameState => guidedState(pts, 5, "k5:r2:classify", {}, "esmb-k5");

describe("nodeExplanation on terminals", () => {
  it("uncovered / integrity / early-win headlines describe what happened", () => {
    const ctx = testCtx();
    const live = nodeExplanation(base(), ctx);
    expect(live?.headline).toMatch(/^Four points/);
    const unc = { ...base(), turn: "over" as const, terminal: { kind: "uncovered" as const, report: { origin: "maker-construction" as const, reason: "window-exhausted" as const, at: { nodeId: "k5:r2:classify", move: { kind: "extend" } }, detail: "x" } } } as unknown as GameState;
    const u = nodeExplanation(unc, ctx);
    expect(u?.headline).toMatch(/^Uncovered/);
    expect(u?.headline).not.toBe(live?.headline);
    const early = { ...base(), turn: "over" as const, terminal: { kind: "maker-won" as const, k: 5, witness: [{ k: 5, verts: ["p1", "p2", "p3", "p4"] }], nodeId: "k5:r2:classify" } } as unknown as GameState;
    const e = nodeExplanation(early, ctx);
    expect(e?.headline).toMatch(/Maker wins here/);
    const integ = { ...base(), turn: "over" as const, terminal: { kind: "strategy-integrity-failure" as const, report: { failedAt: "k5:r2:classify", phase: "post", failed: { id: "x", kind: "invariant", passed: false, detail: "d" } } } } as unknown as GameState;
    expect(nodeExplanation(integ, ctx)?.headline).toMatch(/integrity failure/i);
    // every new sentence passes ClaimLint
    for (const x of [u, e, nodeExplanation(integ, ctx)]) {
      expect(lintStrings([x!.headline, ...x!.claims.map((c) => c.text)])).toEqual([]);
    }
  });
});
