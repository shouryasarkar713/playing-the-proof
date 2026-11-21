// the strategy's declared overlays are evaluated for guided sessions
// (they were declared in every def but never drawn).
import { describe, expect, it } from "vitest";
import { commit, startSession } from "../../src/session/commit.ts";
import { Store } from "../../src/session/store.ts";
import { reduceTransaction } from "../../src/engine/orchestrator.ts";
import { guidedOverlays } from "../../src/engine/describe.ts";
import { hull } from "../../src/geometry/hull.ts";
import { testCtx } from "../helpers.ts";
import { PRESET_P5 } from "../../src/strategy/strategies/k6/preset.ts";
import { centroidOf, ensureK6, forcedRegion } from "../strategies/k6driver.ts";

ensureK6();

describe("guidedOverlays", () => {
  it("k6:boot shows the forced region (the inner pentagon), five ears and the 5-hole; r5:classify shows the twins", () => {
    const ctx = testCtx();
    const store = new Store();
    startSession(
      { kind: "guided", config: { mode: "proof", window: ctx.config.window }, strategyId: "esmb-k6", mode: "proof",
        strategyStart: { kind: "supplied", points: [...PRESET_P5], selectedHole: [...PRESET_P5] } },
      ctx,
      store,
    );
    const boot = guidedOverlays(store.current(), ctx) ?? [];
    const forced = boot.find((o) => o.style === "forced");
    expect(forced?.polys.length).toBe(1);
    expect(forced?.polys[0]?.length).toBe(5); // inner pentagon of the pentagram
    expect(boot.filter((o) => o.style === "candidate").length).toBe(5); // ears
    expect(boot.some((o) => o.style === "neutral")).toBe(true);
    const b0 = centroidOf(forcedRegion(hull([...PRESET_P5])));
    const a = { kind: "place" as const, owner: "breaker" as const, at: b0 };
    commit(reduceTransaction(store.current(), a, ctx), a, store, ctx);
    const after = guidedOverlays(store.current(), ctx) ?? [];
    const twin = after.find((o) => o.style === "twin");
    expect(twin?.polys.length).toBe(2);
    expect(twin?.polys.every((p) => p.length === 5)).toBe(true);
  });

  it("null without a strategy or after a terminal", () => {
    const ctx = testCtx();
    const store = new Store();
    startSession({ kind: "sandbox", config: { mode: "sandbox", window: ctx.config.window }, k: 5 }, ctx, store);
    expect(guidedOverlays(store.current(), ctx)).toBeNull();
  });
});
