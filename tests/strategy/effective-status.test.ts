// effectiveStatus derivation — kills the mutation-survivors X1 (`every`→`some`),
// X3 (loosened PASS filter), X4 (dropped required check) and the stale-version hole.
import { describe, expect, it } from "vitest";
import { effectiveStatus } from "../../src/strategy/registry.ts";
import type { RegisteredStrategy, ValidationCheck } from "../../src/strategy/registry.ts";
import { esmbK5 } from "../../src/strategy/strategies/k5/def.ts";
import { esmbK6 } from "../../src/strategy/strategies/k6/def.ts";

const chk = (id: string, result: ValidationCheck["result"]): ValidationCheck => ({ id, scope: "t", result });
const reg = (def: RegisteredStrategy["def"], checks: ValidationCheck[], version = def.version): RegisteredStrategy => ({
  def,
  tier: "core",
  validation: { strategyId: def.id, defVersion: version, checks },
});
const K6_ALL = ["exact:b1-cell", "exact:b0-cell", "rep:escape"];

describe("effectiveStatus", () => {
  it("k6 promotes ONLY when every required check has a recorded PASS", () => {
    expect(effectiveStatus(reg(esmbK6, K6_ALL.map((i) => chk(i, "PASS"))))).toBe("verified-conventions");
    // X4: one required check missing
    expect(effectiveStatus(reg(esmbK6, ["exact:b1-cell", "exact:b0-cell"].map((i) => chk(i, "PASS"))))).toBe("validated-randomized");
    // X1: one PASS is not enough
    expect(effectiveStatus(reg(esmbK6, [chk("exact:b1-cell", "PASS")]))).toBe("validated-randomized");
    expect(effectiveStatus(reg(esmbK6, []))).toBe("validated-randomized");
  });

  it("only PASS counts (X3): every non-PASS status blocks promotion", () => {
    for (const bad of ["COUNTEREXAMPLE", "NOT_RUN", "BUDGET_EXCEEDED", "IMPLEMENTATION_ERROR"] as const) {
      const checks = K6_ALL.map((i, n) => chk(i, n === 2 ? bad : "PASS"));
      expect(effectiveStatus(reg(esmbK6, checks))).toBe("validated-randomized");
    }
  });

  it("k5 needs exact:b3-cell; unrelated check ids do not promote", () => {
    expect(effectiveStatus(reg(esmbK5, [chk("exact:b3-cell", "PASS")]))).toBe("verified-conventions");
    expect(effectiveStatus(reg(esmbK5, [chk("exact:b1-cell", "PASS")]))).toBe("validated-randomized");
    expect(effectiveStatus(reg(esmbK5, [chk("exact:b3-cell", "COUNTEREXAMPLE")]))).toBe("validated-randomized");
  });

  it("a report recorded for another def version never promotes (stale report)", () => {
    expect(effectiveStatus(reg(esmbK5, [chk("exact:b3-cell", "PASS")], "0.9.0"))).toBe("validated-randomized");
  });

  it("tiers: fixture and experimental never become verified; unknown core def never promotes", () => {
    const k6 = reg(esmbK6, K6_ALL.map((i) => chk(i, "PASS")));
    expect(effectiveStatus({ ...k6, tier: "fixture" })).toBe("fixture");
    expect(effectiveStatus({ ...k6, tier: "experimental-extension" })).toBe("experimental-extension");
    expect(effectiveStatus(reg({ ...esmbK5, id: "unknown-core" }, [chk("exact:b3-cell", "PASS")]))).toBe("validated-randomized");
  });
});
