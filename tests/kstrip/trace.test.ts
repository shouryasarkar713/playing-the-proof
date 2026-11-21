import { describe, expect, it } from "vitest";
import { Rat } from "../../src/geometry/rat.ts";
import {
  createRandomLegalPolicy,
  createStrategyAwarePolicy,
  runKStrip,
} from "../../src/kstrip/index.ts";
import type { RunOptions, RunResult, TraceEvent } from "../../src/kstrip/index.ts";

function logKey(r: RunResult): string {
  return JSON.stringify(
    r.log.map((e) => [e.n, e.round, e.phase, e.level, e.player, e.pt.x.toString(), e.pt.y.toString(), e.frameC]),
  );
}

const CASES: [number, number, RunOptions][] = [
  [3, 1, {}],
  [4, 1, {}],
  [3, 2, {}],
  [3, 1, { variant: "mono-1:s", s: Rat.make(2n) }],
  [3, 1, { variant: "bichromatic", s: Rat.fromString("1/1") }],
  [2, 2, { variant: "bichromatic", s: Rat.fromString("3/2") }],
];

describe("kstrip trace observer", () => {
  for (const [k, t, o] of CASES) {
    const name = `${o.variant ?? "mono-1:1"} k=${k} t=${t}`;
    it(`${name}: observation never changes the run`, () => {
      const plain = runKStrip(k, t, createStrategyAwarePolicy(), undefined, o);
      const events: TraceEvent[] = [];
      const traced = runKStrip(k, t, createStrategyAwarePolicy(), undefined, {
        ...o,
        trace: (e) => events.push(e),
      });
      expect(traced.status).toBe(plain.status);
      expect(traced.rounds).toBe(plain.rounds);
      expect(traced.work).toBe(plain.work);
      expect(logKey(traced)).toBe(logKey(plain));
      expect(JSON.stringify(traced.levels)).toBe(JSON.stringify(plain.levels));
      expect(events.length).toBeGreaterThan(0);
    });

    it(`${name}: events are well nested and the counting snapshots match the level reports`, () => {
      const events: TraceEvent[] = [];
      const r = runKStrip(k, t, createRandomLegalPolicy(2), undefined, { ...o, trace: (e) => events.push(e) });
      expect(r.status, r.message).toBe("completed");
      let open: { level: number } | null = null;
      let ends = 0;
      let lastLen = 0;
      const moves = events.filter((e) => e.kind === "move");
      expect(moves.map((e) => (e.kind === "move" ? e.entry.n : 0))).toEqual(r.log.map((e) => e.n));
      for (const e of events) {
        if (e.kind === "move") {
          continue;
        }
        expect(e.logLength).toBeGreaterThanOrEqual(lastLen);
        lastLen = e.logLength;
        if (e.kind === "phase-start") {
          expect(open).toBeNull();
          open = e;
        } else if (e.kind === "ledger") {
          expect(open).not.toBeNull();
          expect(e.level).toBe((open as { level: number }).level);
        } else {
          expect(open).not.toBeNull();
          expect(e.level).toBe((open as { level: number }).level);
          open = null;
          ends += 1;
          if (e.report !== null && e.ledger !== null) {
            expect(e.ledger.guaranteedSurvivors).toBe(e.report.guaranteedAtEnd);
            expect(e.ledger.placements.length).toBe(e.report.breakerMoves);
            expect(e.chosen.length).toBe(e.report.survivors);
            expect(e.ledger.proposition1.holds).toBe(e.report.proposition1Holds);
          }
        }
      }
      expect(open).toBeNull();
      expect(ends).toBeGreaterThanOrEqual(k >= 2 ? 2 : 1);
      // one ledger snapshot per move of a pairing/grouping phase
      const snaps = events.filter((e) => e.kind === "ledger").length;
      const movesInStructured = r.log.filter((e) => e.phase !== "base" && e.phase !== "bichromatic-base").length;
      expect(snaps).toBe(movesInStructured);
    });
  }

  it("phase-start of a pairing phase carries the planned pairs with both extension cones", () => {
    const events: TraceEvent[] = [];
    runKStrip(3, 1, createStrategyAwarePolicy(), undefined, { trace: (e) => events.push(e) });
    const ps = events.find((e) => e.kind === "phase-start" && e.phase === "pairing");
    expect(ps?.kind).toBe("phase-start");
    if (ps?.kind !== "phase-start") {
      return;
    }
    expect(ps.plans.length).toBe(ps.units);
    for (const u of ps.plans) {
      expect(u.strips.length).toBe(2);
      expect(u.cones.map((c) => c.side)).toEqual(["plus", "minus"]);
    }
  });
});
