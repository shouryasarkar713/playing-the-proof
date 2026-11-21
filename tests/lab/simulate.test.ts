// tests/lab/simulate.test.ts — the bounded simulation: seeded determinism,
// bounds, interruption, observation-only labelling, ownership-aware winning.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Rat } from "../../src/geometry/rat.ts";
import { gp } from "../../src/geometry/predicates.ts";
import { pt } from "../../src/geometry/pt.ts";
import { runSimulation } from "../../src/lab/simulate.ts";
import type { SimResult } from "../../src/lab/simulate.ts";
import type { LabConfig } from "../../src/lab/types.ts";
import { parseBias } from "../../src/lab/bias.ts";
import { classify } from "../../src/lab/classify.ts";
import { SIM_MAX_POINTS } from "../../src/lab/limits.ts";

function cfg(model: LabConfig["model"], rule: LabConfig["rule"], k: number, bias: string): LabConfig {
  return { model, rule, k, bias: parseBias(bias) as Rat, encodingId: null, structures: 1 };
}

function ok(r: SimResult) {
  if (r.kind === "unsupported") {
    throw new Error(`unsupported: ${r.reason}`);
  }
  return r;
}

function parsePts(tr: readonly string[]) {
  return tr.map((s) => {
    const [owner, xy] = s.split(":") as [string, string];
    const [x, y] = xy.split(",") as [string, string];
    return { owner, pt: pt(Rat.fromString(x), Rat.fromString(y)) };
  });
}

describe("labelling and shape", () => {
  it("every result is observation-only: notAGuarantee, completed|budgetExhausted, label", () => {
    for (const c of [cfg("online", "monochromatic", 3, "1"), cfg("online", "bichromatic", 5, "2"), cfg("one-round", "bichromatic", 4, "3/2")]) {
      const r = ok(runSimulation(c, { seed: 7 }));
      expect(r.notAGuarantee).toBe(true);
      expect(["completed", "budgetExhausted"]).toContain(r.kind);
      expect(r.label).toContain("Observation only");
      expect(r.label.toLowerCase()).not.toMatch(/guarantee|prove|always|exhaustive/);
    }
  });

  it("unsupported configurations return a typed refusal, never an observation", () => {
    for (const c of [cfg("online", "bichromatic", 9, "5"), cfg("online", "bichromatic", 7, "17"), cfg("online", "bichromatic", 2, "1")]) {
      const r = runSimulation(c, { seed: 1 });
      expect(r.kind).toBe("unsupported");
      expect(r.notAGuarantee).toBe(true);
    }
  });

  it("simulation is available exactly where classify says so", () => {
    for (const k of [2, 3, 8, 9]) {
      for (const b of ["0", "1", "16", "17"]) {
        const c = cfg("online", "bichromatic", k, b);
        const avail = classify(c).simulation.available;
        expect(runSimulation(c, { seed: 1, maxRounds: 1 }).kind !== "unsupported").toBe(avail);
      }
    }
  });
});

describe("determinism and bounds", () => {
  it("same seed => identical transcript; different seed => (almost surely) different", () => {
    const c = cfg("online", "bichromatic", 5, "2");
    const a = ok(runSimulation(c, { seed: 42 }));
    const b = ok(runSimulation(c, { seed: 42 }));
    expect(a.observed.transcript).toEqual(b.observed.transcript);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const d = ok(runSimulation(c, { seed: 43 }));
    expect(d.observed.transcript).not.toEqual(a.observed.transcript);
  });

  it("every transcript is in general position and within the point cap (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000 }),
        fc.constantFrom("monochromatic", "bichromatic" as const),
        fc.constantFrom("random-legal", "greedy" as const),
        (seed, rule, pol) => {
          const r = ok(
            runSimulation(cfg("online", rule as LabConfig["rule"], 5, "3"), {
              seed,
              maxRounds: 8,
              makerPolicy: pol as "random-legal" | "greedy",
              breakerPolicy: pol as "random-legal" | "greedy",
              opsBudget: 400_000,
            }),
          );
          const pts = parsePts(r.observed.transcript).map((p) => p.pt);
          expect(gp(pts)).toBe(true);
          expect(pts.length).toBeLessThanOrEqual(SIM_MAX_POINTS);
          expect(r.observed.makerPoints + r.observed.breakerPoints).toBe(pts.length);
        },
      ),
      { numRuns: 25 },
    );
  });

  it("bias convention: floor(s*r) Breaker points after Maker's r-th point", () => {
    const r = ok(runSimulation(cfg("online", "bichromatic", 8, "3/2"), { seed: 5, maxRounds: 4, opsBudget: 1e9 }));
    // Breaker totals after rounds 1..4: 1,3,4,6 ; Maker 4  => 10 points if it ran out of rounds
    if (r.stoppedBy === "max-rounds") {
      expect(r.observed.breakerPoints).toBe(6);
      expect(r.observed.makerPoints).toBe(4);
    }
    const z = ok(runSimulation(cfg("online", "bichromatic", 8, "0"), { seed: 5, maxRounds: 4, opsBudget: 1e9 }));
    expect(z.observed.breakerPoints).toBe(0);
    const half = ok(runSimulation(cfg("online", "bichromatic", 8, "1/2"), { seed: 5, maxRounds: 4, opsBudget: 1e9 }));
    expect(half.observed.breakerPoints).toBe(2);
  });

  it("budget exhaustion is reported, never as a Breaker win", () => {
    const r = ok(runSimulation(cfg("online", "bichromatic", 7, "2"), { seed: 3, maxRounds: 50, opsBudget: 50 }));
    expect(r.kind).toBe("budgetExhausted");
    expect(r.stoppedBy).toBe("ops-budget");
    expect(r.observed.holeFound).toBe(false);
    const rr = ok(runSimulation(cfg("online", "bichromatic", 8, "1"), { seed: 3, maxRounds: 3, opsBudget: 1e9 }));
    expect(rr.kind).toBe("budgetExhausted");
    expect(rr.stoppedBy).toBe("max-rounds");
    expect(rr.observed.holeFound).toBe(false);
  });

  it("point cap stops the run", () => {
    const r = ok(runSimulation(cfg("online", "bichromatic", 8, "10"), { seed: 2, maxRounds: 100, opsBudget: 1e12 }));
    expect(["point-cap", "ops-budget", "max-rounds"]).toContain(r.stoppedBy);
    expect(r.observed.makerPoints + r.observed.breakerPoints).toBeLessThanOrEqual(SIM_MAX_POINTS);
  });

  it("is interruptible before the first placement and mid-run", () => {
    const c = cfg("online", "bichromatic", 6, "2");
    const stopNow = ok(runSimulation(c, { seed: 1, shouldStop: () => true }));
    expect(stopNow).toMatchObject({ kind: "budgetExhausted", stoppedBy: "interrupted" });
    expect(stopNow.observed.transcript.length).toBe(0);
    let calls = 0;
    const mid = ok(runSimulation(c, { seed: 1, shouldStop: () => ++calls > 4 }));
    expect(mid.stoppedBy).toBe("interrupted");
    expect(mid.observed.transcript.length).toBe(4);
  });
});

describe("rules and policies", () => {
  it("monochromatic k = 3 ends at once with a hole (any three points of a thin set)", () => {
    const r = ok(runSimulation(cfg("online", "monochromatic", 3, "1"), { seed: 9 }));
    expect(r.kind).toBe("completed");
    expect(r.stoppedBy).toBe("maker-hole");
    expect(r.observed.holeFound).toBe(true);
    expect(r.observed.witness?.length).toBe(3);
  });

  it("bichromatic: every witness vertex is a Maker point (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5000 }), fc.constantFrom("random-legal", "greedy" as const), (seed, pol) => {
        const r = ok(
          runSimulation(cfg("online", "bichromatic", 3, "1"), {
            seed,
            makerPolicy: pol as "random-legal" | "greedy",
            breakerPolicy: pol as "random-legal" | "greedy",
            maxRounds: 10,
          }),
        );
        if (r.observed.witness !== null) {
          const owners = parsePts(r.observed.transcript).map((p) => p.owner);
          for (const id of r.observed.witness) {
            expect(owners[Number(id.slice(1)) - 1]).toBe("maker");
          }
        }
      }),
      { numRuns: 40 },
    );
  });

  it("monochromatic hole can use Breaker points: witness may include a breaker id in some runs", () => {
    let seen = false;
    for (let seed = 1; seed <= 60 && !seen; seed += 1) {
      const r = ok(runSimulation(cfg("online", "monochromatic", 3, "1"), { seed, makerPolicy: "random-legal", breakerPolicy: "random-legal" }));
      const owners = parsePts(r.observed.transcript).map((p) => p.owner);
      seen = (r.observed.witness ?? []).some((id) => owners[Number(id.slice(1)) - 1] === "breaker");
    }
    expect(seen).toBe(true);
  });

  it("greedy policies run and stay deterministic", () => {
    const c = cfg("online", "bichromatic", 4, "1");
    const o = { seed: 11, makerPolicy: "greedy" as const, breakerPolicy: "greedy" as const, maxRounds: 8, opsBudget: 2_000_000 };
    const a = ok(runSimulation(c, o));
    const b = ok(runSimulation(c, o));
    expect(a.observed.transcript).toEqual(b.observed.transcript);
    expect(a.observed.makerPolicy).toBe("greedy");
  });

  it("one-round: completes after Maker's n points and Breaker's floor(s*n); bichromatic with s >= 2 sample", () => {
    const r = ok(runSimulation(cfg("one-round", "bichromatic", 3, "2"), { seed: 4, maxRounds: 6 }));
    expect(r.kind).toBe("completed");
    expect(r.stoppedBy).toBe("rounds-complete");
    expect(r.observed.makerPoints).toBe(6);
    expect(r.observed.breakerPoints).toBe(12);
    const m = ok(runSimulation(cfg("one-round", "monochromatic", 5, "0"), { seed: 4, maxRounds: 12, opsBudget: 1e9 }));
    expect(m.observed.breakerPoints).toBe(0);
    expect(m.observed.makerPoints).toBe(12);
  });

  it("one-round clamps Maker's n to fit the point cap, and can run out of budget", () => {
    const r = ok(runSimulation(cfg("one-round", "bichromatic", 3, "10"), { seed: 4, maxRounds: 12 }));
    expect(r.observed.makerPoints + r.observed.breakerPoints).toBeLessThanOrEqual(SIM_MAX_POINTS);
    const b = ok(runSimulation(cfg("one-round", "bichromatic", 8, "1"), { seed: 4, maxRounds: 12, opsBudget: 10 }));
    expect(b.kind).toBe("budgetExhausted");
  });
});
