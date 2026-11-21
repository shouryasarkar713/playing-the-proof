// tests/ui/kstrip-core.test.ts — the DOM-free logic of the k-strip explorer:
// supported table, availability, traced run, steps, recursion table, Breaker
// wording, and the scripted "Break the Proof" run.
import { describe, expect, it } from "vitest";
import { Rat } from "../../src/geometry/rat.ts";
import { pt } from "../../src/geometry/pt.ts";
import {
  DEFAULT_BUDGET,
  checkBudget,
  estimateCost,
  monoClosedForm,
  monoRounds,
  runKStrip,
} from "../../src/kstrip/index.ts";
import {
  SUPPORTED,
  availability,
  availabilityText,
  breakTargetLevel,
  breakable,
  buildSteps,
  ledgerFor,
  makePolicy,
  parseS,
  phaseChips,
  placementText,
  reasonText,
  recursionTable,
  runBreak,
  runExplorer,
  specOf,
} from "../../src/ui/kstrip-core.ts";
import type { ExplorerParams } from "../../src/ui/kstrip-core.ts";

function params(
  variant: ExplorerParams["variant"],
  k: number,
  t: number,
  s: string | null,
  policy: ExplorerParams["policy"] = "strategy-aware",
): ExplorerParams {
  return { variant, k, t, s, policy, seed: 1 };
}

describe("supported table and availability", () => {
  it("every supported row is runnable under the default budget", () => {
    for (const row of SUPPORTED) {
      for (const t of row.t) {
        const a = availability({ variant: row.variant, k: row.k, t, s: row.s });
        expect(a.kind, `${row.variant} k=${row.k} t=${t} s=${String(row.s)}`).toBe("runnable");
      }
    }
  });

  it("over-budget parameters are refused with the reason, not run", () => {
    const a = availability({ variant: "mono-1:1", k: 6, t: 1, s: null });
    expect(a.kind).toBe("refused");
    if (a.kind === "refused") {
      expect(a.reasons.join(" ")).toContain("points 852 > 400");
      expect(availabilityText(a)).toContain("Refused before execution");
    }
    // the bichromatic k=3, s=3/2, r=2 instance of the doc's range is over budget
    const b = availability({ variant: "bichromatic", k: 3, t: 2, s: "3/2" });
    expect(b.kind).toBe("refused");
  });

  it("unverified but affordable parameters are estimate-only", () => {
    const a = availability({ variant: "mono-1:1", k: 3, t: 4, s: null });
    expect(a.kind).toBe("estimate-only");
    expect(availabilityText(a)).toContain("estimate only — not executed");
    expect(a.estimate.points).toBeGreaterThan(0n);
    // and the executor with preflight would have run it: the UI, not the engine, restricts
    expect(checkBudget(a.estimate, DEFAULT_BUDGET).ok).toBe(true);
  });

  it("invalid parameters say why", () => {
    const a = availability({ variant: "bichromatic", k: 3, t: 1, s: "2/1" });
    expect(a.kind).toBe("invalid");
    expect(availabilityText(a)).toContain("Invalid parameters");
    const mono = parseS("mono-1:s", "3/2");
    expect(mono.ok).toBe(false);
    expect(parseS("bichromatic", "3/2")).toEqual({ ok: true, s: "3/2" });
    expect(parseS("bichromatic", "2").ok).toBe(false);
    expect(parseS("bichromatic", "x").ok).toBe(false);
    expect(parseS("mono-1:1", "whatever")).toEqual({ ok: true, s: null });
  });

  it("estimates shown before running equal the executed rounds and points", () => {
    for (const row of SUPPORTED) {
      const t = row.t[0] as number;
      const p = params(row.variant, row.k, t, row.s);
      const a = availability(p);
      const run = runExplorer(p);
      expect(run.status, run.message).toBe("completed");
      expect(BigInt(run.rounds)).toBe(a.estimate.rounds);
      expect(BigInt(run.points.length)).toBe(a.estimate.points);
      expect(run.claims.length).toBeGreaterThanOrEqual(t);
    }
  }, 120000);
});

describe("traced run, steps and ledger", () => {
  const p = params("mono-1:1", 4, 1, null);
  const run = runExplorer(p);
  const steps = buildSteps(run);

  it("runs like the plain executor (same log)", () => {
    const plain = runKStrip(4, 1, makePolicy("strategy-aware", 1));
    expect(run.log.map((e) => `${e.pt.x.toString()},${e.pt.y.toString()}`)).toEqual(
      plain.log.map((e) => `${e.pt.x.toString()},${e.pt.y.toString()}`),
    );
    expect(run.claims.length).toBe(plain.claims.length);
  });

  it("the step list covers every move once, in order, bracketed by phases", () => {
    const moveSteps = steps.filter((s) => s.kind === "move");
    expect(moveSteps.map((s) => s.moveIdx)).toEqual(run.log.map((_, i) => i));
    expect(steps[steps.length - 1]?.kind).toBe("result");
    expect(steps.filter((s) => s.kind === "start").length).toBe(steps.filter((s) => s.kind === "end").length);
    const chips = phaseChips(steps);
    expect(chips.map((c) => c.level)).toEqual([...chips.map((c) => c.level)].sort((a, b) => a - b));
    expect(chips.length).toBe(3); // levels 2 (base), 3, 4
  });

  it("the ledger displayed at each harvest equals the executor's level report", () => {
    for (const s of steps) {
      if (s.kind === "end" && s.end?.report !== null && s.end?.ledger !== null && s.end !== null) {
        expect(s.end.ledger.guaranteedSurvivors).toBe(s.end.report.guaranteedAtEnd);
        expect(s.end.chosen.length).toBe(s.end.report.survivors);
        const rep = run.levels.find((l) => l.level === s.end?.level);
        expect(rep).toBeDefined();
        expect(s.end.ledger.placements.length).toBe(rep?.breakerMoves);
      }
    }
  });

  it("ledgerFor returns the latest snapshot of the same phase only", () => {
    const first = steps.find((s) => s.kind === "move" && s.ledger !== null);
    expect(first).toBeDefined();
    const idx = first?.index ?? 0;
    expect(ledgerFor(steps, idx)).toBe(first?.ledger);
    const base = steps.find((s) => s.kind === "move" && s.phase === "base");
    expect(ledgerFor(steps, base?.index ?? 0)).toBeNull();
  });

  it("every Breaker move has wording for its policy reason", () => {
    for (const pol of ["random-legal", "greedy-blocking", "strategy-aware"] as const) {
      const r = runExplorer(params("mono-1:1", 3, 1, null, pol));
      const breakers = r.log.filter((e) => e.player === "breaker");
      expect(breakers.length).toBeGreaterThan(0);
      for (const e of breakers) {
        const text = reasonText(e.reason);
        expect(text.length).toBeGreaterThan(20);
        expect(text).not.toContain("undefined");
      }
    }
    expect(reasonText(null)).toContain("No Breaker policy reason");
  });
});

describe("recursion table", () => {
  it("matches the exact recurrence and closed form, with the next level", () => {
    const t = recursionTable({ variant: "mono-1:1", k: 5, t: 1, s: null });
    expect(t.rows.map((r) => r.level)).toEqual([2, 3, 4, 5]);
    for (const r of t.rows) {
      const tt = 4n ** BigInt(5 - r.level);
      expect(r.strips).toBe(String(tt));
      const v = monoRounds(r.level, tt);
      expect(r.value).toBe(v.d === 1n ? String(v.n) : `${String(v.n)}/${String(v.d)}`);
      const c = monoClosedForm(r.level, tt);
      expect(r.closed).toBe(c.d === 1n ? String(c.n) : `${String(c.n)}/${String(c.d)}`);
      expect(r.value).toBe(r.closed);
    }
    expect(t.rows[3]?.value).toBe("106");
    expect(t.next?.level).toBe(6);
    expect(t.next?.value).toBe(String(monoRounds(6, 1n).n));
    expect(t.note).toContain("tends to 4");
  });

  it("biased variants use the biased closed form; bichromatic has no recurrence", () => {
    const b = recursionTable({ variant: "mono-1:s", k: 4, t: 1, s: "2/1" });
    expect(b.rows.length).toBe(3);
    expect(b.rows.every((r) => r.value === r.closed)).toBe(true);
    const bi = recursionTable({ variant: "bichromatic", k: 3, t: 1, s: "1/1" });
    expect(bi.rows).toEqual([]);
    expect(bi.note).toContain("Theorem 5");
  });
});

describe("Break the proof", () => {
  const p = params("mono-1:1", 3, 1, null);

  it("is available only where a pairing phase and Breaker moves exist", () => {
    expect(breakable(p).ok).toBe(true);
    expect(breakable(params("mono-1:1", 2, 1, null)).ok).toBe(false);
    expect(breakable(params("bichromatic", 3, 1, "0/1")).ok).toBe(false); // s = 0: no Breaker moves
    expect(breakable(params("mono-1:1", 5, 1, null)).ok).toBe(false); // too many points to re-execute
    expect(breakable(params("mono-1:1", 6, 1, null)).ok).toBe(false); // not runnable
    expect(breakTargetLevel(3, "mono-1:1")).toBe(3);
    expect(breakTargetLevel(2, "bichromatic")).toBe(2);
  });

  it("asks for the first point, classifies candidates, and agrees with the ledger afterwards", () => {
    const first = runBreak(p, { level: 3, points: [] });
    expect(first.run.status).toBe("awaiting-breaker-move");
    expect(first.pending).not.toBeNull();
    const pend = first.pending as NonNullable<typeof first.pending>;
    expect(pend.level).toBe(3);
    expect(pend.breakerMovesTotalInPhase).toBeGreaterThan(0);
    // an illegal point: a repeat of an existing point
    const taken = first.run.log[0]?.pt ?? pt(Rat.ZERO, Rat.ZERO);
    const bad = pend.classify(taken);
    expect(bad.kind).toBe("illegal");
    // a point far away is useless
    const far = pend.classify(pt(Rat.make(9999n), Rat.make(100000007n)));
    expect(["useless", "illegal"]).toContain(far.kind);
    // play points until the phase ends; classification preview == ledger placement
    let pts: ReturnType<typeof pt>[] = [];
    let outcome = first;
    let guard = 0;
    while (outcome.pending !== null && guard < 20) {
      guard += 1;
      const pe = outcome.pending;
      // try a spread of candidates and take the first legal one with a stated class
      let chosen: { p: ReturnType<typeof pt>; kind: string } | null = null;
      for (let x = 0; x < 40 && chosen === null; x += 1) {
        const cand = pt(Rat.make(BigInt(x * 3 + 1), 2n), Rat.make(BigInt(-(x * 7 + 3)), 3n));
        const c = pe.classify(cand);
        if (c.kind !== "illegal") {
          chosen = { p: cand, kind: c.kind };
        }
      }
      expect(chosen).not.toBeNull();
      pts = [...pts, (chosen as NonNullable<typeof chosen>).p];
      outcome = runBreak(p, { level: 3, points: pts });
      const lastLedger = [...outcome.run.trace]
        .reverse()
        .find((e) => e.kind === "ledger" && e.level === 3);
      const placement =
        lastLedger?.kind === "ledger" ? lastLedger.ledger.placements[pts.length - 1] : undefined;
      if (placement !== undefined) {
        const want = (chosen as NonNullable<typeof chosen>).kind;
        const got = placement.category;
        const map: Record<string, string[]> = {
          blocks: ["interior"],
          absorbed: ["absorbed"],
          boundary: ["boundary-unabsorbed"],
          useless: ["wasted"],
        };
        expect(map[want]).toContain(got);
        expect(placementText(got, placement.unit, placement.region).length).toBeGreaterThan(5);
      }
    }
    expect(outcome.pending).toBeNull();
    expect(outcome.run.status).toBe("completed");
    expect(outcome.run.claims.length).toBeGreaterThanOrEqual(1);
    expect(outcome.run.log.filter((e) => e.reason?.policy === "user").length).toBe(pts.length);
  });

  it("is deterministic: the same points give the identical run", () => {
    const a = runBreak(p, { level: 3, points: [] }).run;
    const b = runBreak(p, { level: 3, points: [] }).run;
    expect(a.log.map((e) => e.pt.x.toString() + e.pt.y.toString())).toEqual(
      b.log.map((e) => e.pt.x.toString() + e.pt.y.toString()),
    );
  });
});

describe("specOf", () => {
  it("builds the spec the runner builds (so the shown estimate is the executor's)", () => {
    const s = specOf({ variant: "mono-1:1", k: 4, t: 1, s: null });
    expect(estimateCost(s).points).toBe(52n);
    expect(specOf({ variant: "mono-1:s", k: 3, t: 1, s: "2/1" }).s?.toString()).toBe("2/1");
  });
});
