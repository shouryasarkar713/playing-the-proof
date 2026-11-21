// (spec review A1): the region cache key must include strategy vars.
import { describe, expect, it } from "vitest";
import { evalRegion, clearRegionCache } from "../../src/strategy/eval.ts";
import { guidedState } from "./scaffolding.ts";
import { P } from "../strategies/k6driver.ts";
import { testConfig } from "../helpers.ts";

describe("evalRegion cache", () => {
  it("same seq and points, different P5 binding → different region (no stale hit)", () => {
    clearRegionCache();
    const pts = [P(0, 0), P(10, 0), P(13, 8), P(5, 13), P(-3, 8)];
    const a = guidedState(pts, 6, "C", { P5: ["p1", "p2", "p3"] });
    const b = guidedState(pts, 6, "C", { P5: ["p1", "p2", "p3", "p4", "p5"] });
    const expr = { kind: "hull", of: { kind: "var", v: "P5" } } as never;
    const ra = evalRegion(expr, { state: a, config: testConfig(), channel: "correctness" });
    const rb = evalRegion(expr, { state: b, config: testConfig(), channel: "correctness" });
    const n = (r: typeof ra): number => (r.kind === "complete" && r.region.kind === "poly" ? r.region.verts.length : -1);
    expect(n(ra)).toBe(3);
    expect(n(rb)).toBe(5);
  });
});
