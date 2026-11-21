// tests/game/integrity.test.ts — the shared verification-value layer:
// integrityReport content + the single-implementation rule is asserted in
// tests/architecture.test.ts (repo-wide structural sweep).
import { describe, expect, it } from "vitest";
import { Rat } from "../../src/geometry/rat.ts";
import { pt } from "../../src/geometry/pt.ts";
import { stateHash } from "../../src/game/hash.ts";
import { integrityReport } from "../../src/game/integrity.ts";
import type { CheckResult } from "../../src/game/integrity.ts";
import { sandboxState } from "../helpers.ts";

describe("integrityReport (game/integrity.ts)", () => {
  it("carries failedAt/phase/failed verbatim + stateHash(state)", () => {
    const state = sandboxState([pt(Rat.make(0n), Rat.make(0n))]);
    const failed: CheckResult = {
      id: "test-check",
      kind: "geometry",
      passed: false,
      detail: "unit fixture",
    };
    const report = integrityReport(state, "k5:r2:classify", "post", failed);
    expect(report.failedAt).toBe("k5:r2:classify");
    expect(report.phase).toBe("post");
    expect(report.failed).toBe(failed);
    expect(report.stateHash).toBe(stateHash(state));
  });
});
