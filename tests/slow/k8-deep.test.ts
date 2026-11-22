// Slow tier: the deep path of the k=8 walkthrough (B0 cells -> A1 -> B1 cells -> A2 ->
// B2 cells -> A3 -> B3 cells -> A4 -> B4 probes -> A5) with exact cell
// representatives at every Breaker move; every maker-won leaf is confirmed by the
// independent oracle. Long-running (tens of minutes to hours depending on strides);
// results are written to K8_GATE_EVIDENCE when set and summarised in docs/K8_GATE.md.
import { appendFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { testCtx } from "../helpers.ts";
import { HEPTAGON } from "../strategies/k8driver.ts";
import { driveHeptagon } from "../strategies/k8tree.ts";

describe("k8 deep path (preset heptagon)", () => {
  it("strided sweep", { timeout: 7_200_000 }, () => {
    const opts = {
      b0: Number(process.env["K8_B0"] ?? 11),
      b1: Number(process.env["K8_B1"] ?? 3),
      b2: Number(process.env["K8_B2"] ?? 60),
      b3: Number(process.env["K8_B3"] ?? 150),
      maxB0: Number(process.env["K8_MAXB0"] ?? 3),
    };
    const run = driveHeptagon([...HEPTAGON], testCtx(), opts);
    const out = process.env["K8_GATE_EVIDENCE"];
    if (out !== undefined && out !== "") {
      appendFileSync(out, JSON.stringify({ name: "deep:preset", opts, ...run }) + "\n");
    }
    expect(run.failures).toEqual([]);
    expect(run.leaves).toBeGreaterThan(0);
  });
});
