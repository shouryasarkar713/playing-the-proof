// Deterministic replay through the spec path + tampered logs.
import { describe, expect, it } from "vitest";
import { pt } from "../../../src/geometry/pt.ts";
import { Rat } from "../../../src/geometry/rat.ts";
import { createGreedyBlockingPolicy, createRandomLegalPolicy, replayLog } from "../../../src/kstrip/index.ts";
import type { MoveLogEntry } from "../../../src/kstrip/index.ts";
import {
  SPEC_BICHROMATIC,
  SPEC_MONO_1_1,
  SPEC_MONO_1_S,
  logPolicy,
  replaySpec,
  runSpec,
  serializeLog,
} from "../../../src/kstrip/spec/index.ts";
import type { KStripSpec, SpecParams } from "../../../src/kstrip/spec/index.ts";

const R = (n: number, d = 1): Rat => Rat.make(BigInt(n), BigInt(d));

const CASES: [string, KStripSpec, SpecParams][] = [
  ["mono-1:1 k=3 t=2", SPEC_MONO_1_1, { k: 3, t: 2n }],
  ["mono-1:s k=3 s=2", SPEC_MONO_1_S, { k: 3, t: 1n, s: R(2) }],
  ["bichromatic k=3 s=1", SPEC_BICHROMATIC, { k: 3, t: 1n, s: R(1) }],
];

function record(spec: KStripSpec, params: SpecParams, seed = 3): readonly MoveLogEntry[] {
  const run = runSpec(spec, params, createRandomLegalPolicy(seed));
  expect(run.outcome.kind).toBe("completed");
  return (run.result as NonNullable<typeof run.result>).log;
}

function patch(log: readonly MoveLogEntry[], i: number, p: Partial<MoveLogEntry>): MoveLogEntry[] {
  return log.map((e, j) => (j === i ? { ...e, ...p } : e));
}

describe("deterministic replay through the spec path", () => {
  for (const [name, spec, params] of CASES) {
    it(`${name}: replaying a recorded log reproduces it byte for byte`, () => {
      const log = record(spec, params);
      const rep = replaySpec(spec, params, log);
      expect(rep.outcome).toEqual({ kind: "completed" });
      expect(serializeLog(rep.result?.log ?? [])).toBe(serializeLog(log));
      // twice: deterministic
      const again = replaySpec(spec, params, log);
      expect(serializeLog(again.result?.log ?? [])).toBe(serializeLog(log));
      expect(rep.certificates.every((c) => c.ok)).toBe(true);
      // and the policy-free legality check of the kernel agrees
      expect(replayLog(log, spec.variant !== "bichromatic").ok).toBe(true);
    });
  }
  it("logPolicy hands back the recorded frame coordinates and reasons", () => {
    const log = record(SPEC_MONO_1_1, { k: 3, t: 1n });
    const pol = logPolicy(log);
    const first = log.find((e) => e.player === "breaker") as MoveLogEntry;
    const d = pol.choose({} as never);
    expect(d.point).toEqual(first.ptFrame);
    expect(d.reason).toEqual(first.reason);
  });
});

describe("tampered logs are rejected with the violated predicate named", () => {
  for (const [name, spec, params] of CASES) {
    const log = record(spec, params);
    const mk = log.findIndex((e) => e.player === "maker" && e.kind === "apex");
    const mkIdx = mk >= 0 ? mk : log.findIndex((e) => e.player === "maker");
    const br = log.findIndex((e) => e.player === "breaker");
    const lastMk = log.map((e) => e.player).lastIndexOf("maker");

    it(`${name}: a different Maker move is not the strategy's`, () => {
      const e = log[mkIdx] as MoveLogEntry;
      const bad = patch(log, mkIdx, { pt: pt(e.pt.x, e.pt.y.add(R(1, 3))), ptFrame: pt(e.ptFrame.x, e.ptFrame.y.add(R(1, 3))) });
      const rep = replaySpec(spec, params, bad);
      expect(rep.outcome).toMatchObject({ kind: "integrity-failure", scope: "replay", predicate: "log-matches-strategy" });
      expect((rep.outcome as { message: string }).message).toContain(`move ${e.n}`);
    });
    it(`${name}: an edited note / reason / counter / frame field`, () => {
      for (const p of [{ note: "tampered" }, { levelRound: 99 }, { round: 99 }, { level: 9 }, { kind: "base-point" as const }]) {
        const rep = replaySpec(spec, params, patch(log, mkIdx, p));
        expect(rep.outcome, JSON.stringify(p)).toMatchObject({ kind: "integrity-failure", predicate: "log-matches-strategy" });
      }
      const rr = replaySpec(spec, params, patch(log, br, { reason: null }));
      expect(rr.outcome).toMatchObject({ kind: "integrity-failure", predicate: "log-matches-strategy" });
    });
    it(`${name}: an illegal Breaker move (duplicate point) is rejected by the response class`, () => {
      const first = log[0] as MoveLogEntry;
      const bad = patch(log, br, { pt: first.pt, ptFrame: first.ptFrame });
      const rep = replaySpec(spec, params, bad);
      expect(rep.outcome).toMatchObject({ kind: "rejected", responseClass: "general-position" });
    });
    it(`${name}: a truncated log has too few Breaker moves`, () => {
      const rep = replaySpec(spec, params, log.slice(0, br + 1));
      expect(rep.outcome).toMatchObject({ kind: "integrity-failure", scope: "replay", predicate: "log-complete" });
    });
    it(`${name}: trailing extra moves are reported`, () => {
      const rep = replaySpec(spec, params, [...log, { ...(log[lastMk] as MoveLogEntry), n: log.length + 1 }]);
      expect(rep.outcome).toMatchObject({ kind: "integrity-failure", predicate: "log-matches-strategy" });
      expect((rep.outcome as { message: string }).message).toContain("trailing");
    });
    it(`${name}: a log cut right after its last Maker move is reported as stopping early`, () => {
      // all Breaker moves present but the final entries dropped
      const cut = log.slice(0, lastMk);
      const rep = replaySpec(spec, params, cut);
      expect(rep.outcome.kind).toBe("integrity-failure");
    });
    it(`${name}: a replaced Breaker move either diverges or is a fully legal alternative play`, () => {
      const e = log[br] as MoveLogEntry;
      const moved = pt(e.ptFrame.x.add(R(1, 7)), e.ptFrame.y.sub(R(3, 11)));
      // keep pt and ptFrame consistent so that only the CHOICE differs
      const frameC = Rat.fromString(e.frameC);
      const base = pt(moved.x.add(frameC.mul(moved.y)), moved.y);
      const bad = patch(log, br, { pt: base, ptFrame: moved });
      const rep = replaySpec(spec, params, bad);
      if (rep.outcome.kind === "completed") {
        // accepted only if the regenerated log IS the tampered log: a legal play
        expect(serializeLog(rep.result?.log ?? [])).toBe(serializeLog(bad));
      } else {
        expect(["integrity-failure", "rejected"]).toContain(rep.outcome.kind);
      }
    });
  }

  it("a log recorded for other parameters is not the strategy's play", () => {
    const log = record(SPEC_MONO_1_1, { k: 3, t: 1n });
    const rep = replaySpec(SPEC_MONO_1_1, { k: 3, t: 2n }, log);
    expect(rep.outcome.kind).not.toBe("completed");
  });
  it("replay of an uncovered configuration is uncovered, never executed", () => {
    const log = record(SPEC_MONO_1_1, { k: 3, t: 1n });
    const rep = replaySpec(SPEC_MONO_1_1, { k: 7, t: 1n }, log);
    expect(rep.outcome.kind).toBe("uncovered");
  });
  it("kernel replay rejects the same illegal move without any strategy", () => {
    const log = record(SPEC_MONO_1_1, { k: 3, t: 1n });
    const br = log.findIndex((e) => e.player === "breaker");
    const first = log[0] as MoveLogEntry;
    const r = replayLog(patch(log, br, { pt: first.pt, ptFrame: first.ptFrame }), true);
    expect(r.ok).toBe(false);
  });
  it("greedy-policy logs replay too", () => {
    const run = runSpec(SPEC_MONO_1_1, { k: 3, t: 1n }, createGreedyBlockingPolicy());
    const log = (run.result as NonNullable<typeof run.result>).log;
    expect(replaySpec(SPEC_MONO_1_1, { k: 3, t: 1n }, log).outcome.kind).toBe("completed");
  });
});
