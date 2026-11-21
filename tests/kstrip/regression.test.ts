// Regression tests for defects found while building the executor.
import { describe, expect, it } from "vitest";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { Rat } from "../../src/geometry/rat.ts";
import { canAdd, lineBlocked, replanLine, runKStrip, extensionCone, planPair } from "../../src/kstrip/index.ts";
import type { BreakerPolicy, BreakerView } from "../../src/kstrip/index.ts";
import { P, R } from "./helpers.ts";

describe("defect: Breaker puts two points on l_j before p_j (found by the counting property test)", () => {
  it("no apex is legal on such a line (general position) ...", () => {
    const S = [P(6, -20), P(6, -30)];
    expect(lineBlocked(S, R(6))).toBe(true);
    expect(canAdd(S, P(6, -50))).toBe(false);
    expect(canAdd(S, P(6, 5))).toBe(false);
    expect(lineBlocked([P(6, -20)], R(6))).toBe(false);
  });

  it("... so Maker re-plans a free line in the same gap with the original cones", () => {
    const A = [P(0, 0), P(1, 3), P(2, 0)];
    const B = [P(10, 0), P(11, 3), P(12, 0)];
    const S = [...A, ...B];
    const pl = planPair(S, A, B, 1);
    if (!pl.ok) throw new Error("plan");
    const blocked = [...S, P(6, -20), P(6, -30)];
    const np = replanLine(blocked, pl.plan.lo, pl.plan.hi, [
      { strip: A, side: "plus", original: pl.plan.coneLeft },
      { strip: B, side: "minus", original: pl.plan.coneRight },
    ]);
    expect(np.xLine.equals(R(4))).toBe(true); // 6 is taken -> next dyadic
    expect(np.top.cmp(R(0)) < 0).toBe(true);
    expect(extensionCone(A, S, { x: R(0), y: R(-1) }, "plus").ok).toBe(true);
  });

  it("the executor survives an adversary that blocks every l_j with two points", () => {
    let calls = 0;
    const pol: BreakerPolicy = {
      name: "line-blocker",
      choose(view: BreakerView) {
        calls += 1;
        const led = view.ledger();
        const bb = view.bbox();
        let base: Pt = pt(bb.xMax.x.add(R(calls)), bb.yMax.y.add(R(calls * calls)));
        if (led !== null) {
          // aim at the planned apex line of the first pair that still has < 2 points on it
          for (const u of [...led.units].reverse()) {
            const l = u.regions[0]?.region.vertices;
            const apex = l?.[l.length - 1];
            if (apex === undefined) continue;
            const onLine = view.points.filter((p) => p.pt.x.equals(apex.x)).length;
            if (onLine < 2) {
              base = pt(apex.x, apex.y.sub(R(40 + calls)));
              break;
            }
          }
        }
        for (let n = 0; n < 400; n += 1) {
          const c = pt(base.x, base.y.sub(Rat.make(BigInt(n))));
          if (view.legal(c).ok) {
            return { point: c, reason: { policy: "line-blocker", code: "x", summary: "", target: null, data: {} } };
          }
          const c2 = pt(base.x.add(Rat.make(BigInt(n + 1), 1000n)), base.y);
          if (view.legal(c2).ok) {
            return { point: c2, reason: { policy: "line-blocker", code: "x", summary: "", target: null, data: {} } };
          }
        }
        throw new Error("no move");
      },
    };
    const r = runKStrip(3, 2, pol);
    expect(r.status, r.message).toBe("completed");
    expect(r.checks.some((c) => c.name.includes("re-planned"))).toBe(true);
    expect(r.levels[r.levels.length - 1]?.survivors).toBeGreaterThanOrEqual(2);
  });
});
