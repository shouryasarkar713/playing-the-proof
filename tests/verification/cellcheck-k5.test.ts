// tests/verification/cellcheck-k5.test.ts — the §23.8 exact B3-cell check
// (Phase 16, Gate C): F = the five B3-time points of the safe-integer
// playbook; 10 pair-lines → arrangement cells window-scoped; one
// representative per cell must complete a 4-hole (estimateHoleWork(6,4),
// non-empty exhaustive). On pass the check is recorded and esmb-k5's
// derived status upgrades to verified-conventions.
import { describe, expect, it } from "vitest";
import { Rat } from "../../src/geometry/rat.ts";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { commit, startSession } from "../../src/session/commit.ts";
import { Store } from "../../src/session/store.ts";
import { reduceTransaction } from "../../src/engine/orchestrator.ts";
import {
  cellCheckToValidation,
  k5B3Check,
} from "../../src/verification/cellchecks.ts";
import {
  effectiveStatus,
  recordValidationCheck,
  strategies,
} from "../../src/strategy/registry.ts";
import { ensureK5 } from "../strategies/k5driver.ts";
import { P } from "../strategies/k6driver.ts";
import { testCtx } from "../helpers.ts";

ensureK5();

describe("k=5 B3-cell check (§23.8, Gate C)", () => {
  it("safe-integer configuration: every cell keeps a 4-hole; status promotes", () => {
    const store = new Store();
    const ctx = testCtx();
    const started = startSession(
      {
        kind: "guided",
        config: { mode: "break", window: ctx.config.window },
        strategyId: "esmb-k5",
        mode: "break",
      },
      ctx,
      store,
    );
    expect(started.status).toBe("accepted");
    const drive = (at: Pt): void => {
      const r = reduceTransaction(
        store.current(),
        { kind: "place", owner: "breaker", at },
        ctx,
      );
      if (r.status !== "accepted") {
        throw new Error("cellcheck-k5: placement rejected — test bug");
      }
      commit(r, { kind: "place", owner: "breaker", at }, store, ctx);
    };
    drive(P(10, 0));
    drive(pt(Rat.make(10n), Rat.make(9n)));
    const cur = store.current();
    expect(cur.strategy?.nodeId).toBe("k5:r3:classify");
    const f = cur.points.map((p) => p.pt);
    expect(f.length).toBe(5);
    const scope =
      "play window ±1000000; safe-integer playbook (B1 10/0, B2 10/9) at B3-time; " +
      "|F|=5; C(5,2)=10 pair-lines";
    const r = k5B3Check(f, ctx.config.window, scope);
    expect(r.result).toBe("PASS");
    expect(r.cells).toBe(40);
    expect(r.cells).toBeLessThanOrEqual(56);
    expect(r.checked).toBe(r.cells);
    recordValidationCheck("esmb-k5", cellCheckToValidation(r));
    const rs = strategies().get("esmb-k5");
    expect(rs !== undefined).toBe(true);
    if (rs === undefined) {
      throw new Error("unreachable");
    }
    expect(effectiveStatus(rs)).toBe("verified-conventions");
  });
});
