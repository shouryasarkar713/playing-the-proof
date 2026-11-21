import { describe, expect, it } from "vitest";
import { Rat } from "../../src/geometry/rat.ts";
import {
  createGreedyBlockingPolicy,
  createRandomLegalPolicy,
  createStrategyAwarePolicy,
  interiorLegal,
  replayLog,
  runKStrip,
} from "../../src/kstrip/index.ts";
import type { BreakerPolicy, BreakerView } from "../../src/kstrip/index.ts";

function sig(r: ReturnType<typeof runKStrip>): string {
  return r.log.map((e) => `${e.pt.x.toString()},${e.pt.y.toString()}`).join(";");
}

const makers: [string, () => BreakerPolicy][] = [
  ["random-legal", () => createRandomLegalPolicy(11)],
  ["greedy-blocking", () => createGreedyBlockingPolicy()],
  ["strategy-aware", () => createStrategyAwarePolicy()],
];

describe("Breaker policies: determinism and legality", () => {
  for (const [name, mk] of makers) {
    it(`${name}: identical runs from a fresh policy`, () => {
      const a = runKStrip(3, 2, mk());
      const b = runKStrip(3, 2, mk());
      expect(a.status).toBe("completed");
      expect(sig(a)).toBe(sig(b));
      expect(replayLog(a.log, true).ok).toBe(true);
      for (const e of a.log) {
        if (e.player === "breaker") {
          expect(e.reason).not.toBeNull();
          expect(e.reason?.policy).toBe(name);
        }
      }
    });
  }

  it("random-legal: different seeds differ, same seed reproduces", () => {
    const a = runKStrip(3, 1, createRandomLegalPolicy(1));
    const b = runKStrip(3, 1, createRandomLegalPolicy(2));
    const c = runKStrip(3, 1, createRandomLegalPolicy(1));
    expect(sig(a)).not.toBe(sig(b));
    expect(sig(a)).toBe(sig(c));
  });
});

// Wrapper that audits every decision against the live ledger at decision time.
function audited(inner: BreakerPolicy, seen: { checked: number; interiorTargets: number }): BreakerPolicy {
  return {
    name: inner.name,
    choose(view: BreakerView) {
      const dec = inner.choose(view);
      expect(view.legal(dec.point).ok).toBe(true);
      const led = view.ledger();
      const t = dec.reason.target;
      if (led !== null && t !== null) {
        const u = led.units.find((x) => x.unit === t.unit);
        const r = u?.regions.find((x) => x.id === t.region);
        expect(r).toBeDefined();
        // the explanation corresponds to the actual move: the point is strictly
        // inside the named region, which was live, and the stated need is right.
        expect(r?.region.classify(dec.point)).toBe("interior");
        expect(r?.live).toBe(true);
        expect(dec.reason.data["unitNeed"]).toBe(u?.need);
        expect(dec.reason.data["remaining"]).toBe(led.budgetRemaining);
        if (dec.reason.code === "finish-unit") {
          expect(u?.need).toBe(1);
        }
        seen.interiorTargets += 1;
      } else if (dec.reason.code !== "random") {
        expect(t).toBeNull();
      }
      seen.checked += 1;
      return dec;
    },
  };
}

describe("explanations correspond to the actual move", () => {
  for (const [name, mk] of [
    ["greedy-blocking", () => createGreedyBlockingPolicy()],
    ["strategy-aware", () => createStrategyAwarePolicy()],
  ] as const) {
    it(`${name}: target region contains the point; need/remaining facts are the ledger's`, () => {
      const seen = { checked: 0, interiorTargets: 0 };
      const r = runKStrip(3, 2, audited(mk(), seen));
      expect(r.status, r.message).toBe("completed");
      expect(seen.checked).toBeGreaterThan(10);
      expect(seen.interiorTargets).toBeGreaterThan(0);
    });
  }

  it("1:s grouping and bichromatic phases are audited too", () => {
    const seen = { checked: 0, interiorTargets: 0 };
    const r = runKStrip(3, 1, audited(createStrategyAwarePolicy(), seen), undefined, {
      variant: "mono-1:s",
      s: Rat.make(2n),
    });
    expect(r.status, r.message).toBe("completed");
    expect(seen.interiorTargets).toBeGreaterThan(0);
  });
});

describe("strategy-aware differs from the baselines", () => {
  it("after one pair-2 region is blocked, greedy opens pair 1, aware finishes pair 2", () => {
    const greedy = createGreedyBlockingPolicy();
    const aware = createStrategyAwarePolicy();
    const rec: { g: string | null; a: string | null; gc: string; ac: string }[] = [];
    let step = 0;
    const driver: BreakerPolicy = {
      name: "driver",
      choose(view) {
        const led = view.ledger();
        if (led === null || view.phase !== "pairing") {
          return greedy.choose(view);
        }
        step += 1;
        if (step === 1) {
          // scripted first move: block R3 (pair 2)
          const u2 = led.units.find((u) => u.unit === 2);
          const r3 = u2?.regions[0];
          if (r3 === undefined) throw new Error("no pair 2");
          const p = interiorLegal(r3.region, view);
          if (p === null) throw new Error("no point");
          return {
            point: p,
            reason: { policy: "driver", code: "scripted", summary: "", target: null, data: {} },
          };
        }
        const g = greedy.choose(view);
        const a = aware.choose(view);
        if (step === 2) {
          rec.push({
            g: g.reason.target === null ? null : `${g.reason.target.unit}/${g.reason.target.region}`,
            a: a.reason.target === null ? null : `${a.reason.target.unit}/${a.reason.target.region}`,
            gc: g.reason.code,
            ac: a.reason.code,
          });
        }
        return a;
      },
    };
    const r = runKStrip(3, 2, driver);
    expect(r.status).toBe("completed");
    expect(rec.length).toBe(1);
    expect(rec[0]?.g).toBe("1/R1"); // baseline: first live region in index order
    expect(rec[0]?.a).toBe("2/R4"); // heuristic: one point kills pair 2
    expect(rec[0]?.gc).toBe("block-first-live-region");
    expect(rec[0]?.ac).toBe("finish-unit");
  });

  it("strategy-aware stops wasting structure when no unit is killable", () => {
    const codes: string[] = [];
    const aware = createStrategyAwarePolicy();
    const wrap: BreakerPolicy = {
      name: "w",
      choose(view) {
        const d = aware.choose(view);
        if (view.phase === "pairing") codes.push(d.reason.code);
        return d;
      },
    };
    const r = runKStrip(3, 2, wrap);
    expect(r.status).toBe("completed");
    expect(codes.length).toBe(4); // 2t = 4 Breaker points in the level-3 pairing phase
    expect(codes.some((c) => c === "finish-unit")).toBe(true);
    expect(new Set(codes).size).toBeGreaterThan(1);
  });

  it("aware logs never contain boundary or absorbed points in the pairing phase", () => {
    const r = runKStrip(3, 3, createStrategyAwarePolicy());
    const top = r.levels[r.levels.length - 1];
    expect(top?.absorbedBreakerPoints).toBe(0);
  });

  it("aware leaves fewer survivors than random on the same instance (not a universal claim)", () => {
    const a = runKStrip(3, 3, createStrategyAwarePolicy());
    const rnd = runKStrip(3, 3, createRandomLegalPolicy(9));
    const sa = a.levels[a.levels.length - 1]?.survivors ?? 99;
    const sr = rnd.levels[rnd.levels.length - 1]?.survivors ?? 0;
    expect(sa).toBeLessThanOrEqual(sr);
    expect(sa).toBeGreaterThanOrEqual(3); // theorem: still >= t
  });
});
