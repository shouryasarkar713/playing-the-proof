// Property tests of the spec layer (fast-check): equivalence with the legacy
// executor under random legal Breaker play, formulas against the paper's
// closed forms, and tamper-rejection of Maker moves.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { pt } from "../../../src/geometry/pt.ts";
import { Rat } from "../../../src/geometry/rat.ts";
import {
  biasedClosedForm,
  createRandomLegalPolicy,
  estimateCost,
  monoClosedForm,
  runKStrip,
} from "../../../src/kstrip/index.ts";
import type { MoveLogEntry } from "../../../src/kstrip/index.ts";
import {
  SPEC_BICHROMATIC,
  SPEC_MONO_1_1,
  SPEC_MONO_1_S,
  planFromSpec,
  planRounds,
  replaySpec,
  runSpec,
  serializeLog,
} from "../../../src/kstrip/spec/index.ts";
import type { KStripSpec, SpecParams } from "../../../src/kstrip/spec/index.ts";
import { fingerprint } from "./helpers.ts";

const R = (n: number, d = 1): Rat => Rat.make(BigInt(n), BigInt(d));

// cheap verified configurations
const CHEAP: readonly [KStripSpec, SpecParams, { k: number; t: number; s?: string }][] = [
  [SPEC_MONO_1_1, { k: 2, t: 1n }, { k: 2, t: 1 }],
  [SPEC_MONO_1_1, { k: 3, t: 1n }, { k: 3, t: 1 }],
  [SPEC_MONO_1_1, { k: 3, t: 2n }, { k: 3, t: 2 }],
  [SPEC_MONO_1_S, { k: 3, t: 1n, s: R(2) }, { k: 3, t: 1, s: "2" }],
  [SPEC_BICHROMATIC, { k: 2, t: 1n, s: R(1) }, { k: 2, t: 1, s: "1" }],
  [SPEC_BICHROMATIC, { k: 2, t: 2n, s: R(3, 2) }, { k: 2, t: 2, s: "3/2" }],
  [SPEC_BICHROMATIC, { k: 3, t: 1n, s: R(1) }, { k: 3, t: 1, s: "1" }],
  [SPEC_BICHROMATIC, { k: 3, t: 2n, s: R(0) }, { k: 3, t: 2, s: "0" }],
];
const cheap = fc.integer({ min: 0, max: CHEAP.length - 1 });
const seeds = fc.integer({ min: 1, max: 5000 });

describe("property: spec path == legacy executor under random legal Breaker play", () => {
  it("identical runs, all certificates pass", () => {
    fc.assert(
      fc.property(cheap, seeds, (ci, seed) => {
        const [spec, params, cfg] = CHEAP[ci] as (typeof CHEAP)[number];
        const run = runSpec(spec, params, createRandomLegalPolicy(seed));
        const ref = runKStrip(cfg.k, cfg.t, createRandomLegalPolicy(seed), undefined, {
          variant: spec.variant,
          ...(cfg.s === undefined ? {} : { s: Rat.fromString(cfg.s) }),
        });
        expect(run.result).not.toBeNull();
        expect(fingerprint(run.result as NonNullable<typeof run.result>)).toBe(fingerprint(ref));
        expect(run.outcome.kind).toBe(ref.status === "completed" ? "completed" : run.outcome.kind);
        expect(run.certificates.every((c) => c.ok)).toBe(true);
      }),
      { numRuns: 60 },
    );
  }, 300000);
});

describe("property: replay", () => {
  it("every recorded log replays; a changed Maker move or field never does", () => {
    fc.assert(
      fc.property(cheap, seeds, fc.nat(), fc.integer({ min: 1, max: 9 }), (ci, seed, pick, delta) => {
        const [spec, params] = CHEAP[ci] as (typeof CHEAP)[number];
        const run = runSpec(spec, params, createRandomLegalPolicy(seed));
        const log = (run.result as NonNullable<typeof run.result>).log;
        expect(replaySpec(spec, params, log).outcome.kind).toBe("completed");
        const makers = log.map((e, i) => (e.player === "maker" ? i : -1)).filter((i) => i >= 0);
        const i = makers[pick % makers.length] as number;
        const e = log[i] as MoveLogEntry;
        const moved: MoveLogEntry = {
          ...e,
          pt: pt(e.pt.x, e.pt.y.add(R(delta, 13))),
          ptFrame: pt(e.ptFrame.x, e.ptFrame.y.add(R(delta, 13))),
        };
        const bad = log.map((x, j) => (j === i ? moved : x));
        expect(serializeLog(bad)).not.toBe(serializeLog(log));
        const rep = replaySpec(spec, params, bad);
        expect(rep.outcome.kind).toBe("integrity-failure");
        // field tamper
        const noted = log.map((x, j) => (j === i ? { ...x, note: x.note + "!" } : x));
        expect(replaySpec(spec, params, noted).outcome.kind).toBe("integrity-failure");
      }),
      { numRuns: 40 },
    );
  }, 300000);
});

describe("property: budget formulas = the paper's recurrences", () => {
  it("1:1: spec rounds equal the exact closed form (5*4^(k-2)-2)t/3", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 7 }), fc.integer({ min: 1, max: 12 }), (k, t) => {
        const plan = planFromSpec(SPEC_MONO_1_1, { k, t: BigInt(t) });
        expect(Rat.make(planRounds(plan)).equals(monoClosedForm(k, BigInt(t)))).toBe(true);
        const est = estimateCost({ variant: "mono-1:1", k, t: BigInt(t), s: Rat.ONE });
        expect(planRounds(plan)).toBe(est.rounds);
      }),
      { numRuns: 60 },
    );
  }, 120000);
  it("1:s: rounds within [closed form, +1) and equal to the estimator", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 5 }), fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 6 }), (k, t, s) => {
        const params = { k, t: BigInt(t), s: R(s) };
        const est = estimateCost({ variant: "mono-1:s", ...params });
        fc.pre(est.supported && est.rounds <= 4000n);
        const plan = planFromSpec(SPEC_MONO_1_S, params);
        const rounds = planRounds(plan);
        expect(rounds).toBe(est.rounds);
        const lo = biasedClosedForm(k, BigInt(t), BigInt(s));
        expect(Rat.make(rounds).cmp(lo) >= 0 && Rat.make(rounds).cmp(lo.add(Rat.ONE)) < 0).toBe(true);
      }),
      { numRuns: 120 },
    );
  });
  it("bichromatic: per-level plan equals the estimator for any s in [0,2)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 5 }),
        fc.integer({ min: 1, max: 9 }),
        fc.integer({ min: 0, max: 19 }),
        (k, t, tenths) => {
          const s = R(tenths, 10);
          const params = { k, t: BigInt(t), s };
          const est = estimateCost({ variant: "bichromatic", ...params });
          fc.pre(est.supported && est.rounds <= 4000n);
          const plan = planFromSpec(SPEC_BICHROMATIC, params);
          expect(plan.length).toBe(est.levels.length);
          expect(planRounds(plan)).toBe(est.rounds);
          for (const item of plan) {
            const l = est.levels.find((x) => x.level === item.level);
            expect(l?.makerMoves).toBe(item.makerMoves);
            expect(l?.breakerMoves).toBe(item.breakerMoves);
            expect(l?.inputStrips).toBe(item.inputStrips);
          }
        },
      ),
      { numRuns: 120 },
    );
  });
});
