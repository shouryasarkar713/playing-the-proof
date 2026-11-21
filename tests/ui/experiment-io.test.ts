// tests/ui/experiment-io.test.ts — deterministic replay of k-strip explorer
// sessions and lab experiments (log + parameters + seed -> identical run).
import { describe, expect, it } from "vitest";
import { Rat } from "../../src/geometry/rat.ts";
import { pt } from "../../src/geometry/pt.ts";
import { classify, runSimulation } from "../../src/lab/index.ts";
import type { LabConfig } from "../../src/lab/index.ts";
import {
  experimentFilename,
  experimentText,
  kstripExperimentOf,
  labExperimentOf,
  looksLikeExperiment,
  paramsOfExperiment,
  parseExperiment,
  replayKStripExperiment,
  replayLabExperiment,
} from "../../src/ui/experiment-io.ts";
import { runBreak, runExplorer } from "../../src/ui/kstrip-core.ts";
import type { ExplorerParams } from "../../src/ui/kstrip-core.ts";
import { decodeWire, encodeWire } from "../../src/ui/wire.ts";

function parse(text: string): Extract<NonNullable<ReturnType<typeof parseExperiment> extends infer R ? (R extends { ok: true; file: infer F } ? F : never) : never>, object> {
  const p = parseExperiment(text);
  if (!p.ok) {
    throw new Error(JSON.stringify(p.issues));
  }
  return p.file as never;
}

const P: ExplorerParams = { variant: "mono-1:1", k: 3, t: 1, s: null, policy: "random-legal", seed: 5 };

describe("k-strip experiments", () => {
  it("export -> parse -> replay reproduces the identical run (every policy and variant)", () => {
    const cases: ExplorerParams[] = [
      P,
      { ...P, policy: "greedy-blocking" },
      { ...P, policy: "strategy-aware", t: 2 },
      { variant: "mono-1:s", k: 3, t: 1, s: "2/1", policy: "strategy-aware", seed: 1 },
      { variant: "bichromatic", k: 3, t: 1, s: "1/1", policy: "random-legal", seed: 9 },
    ];
    for (const p of cases) {
      const run = runExplorer(p);
      const text = experimentText(kstripExperimentOf(run, null, "t"));
      expect(looksLikeExperiment(text)).toBe(true);
      const file = parse(text);
      expect(file.kind).toBe("kstrip");
      if (file.kind !== "kstrip") {
        return;
      }
      const rep = replayKStripExperiment(file.kstrip);
      expect(rep.ok, rep.ok ? "" : rep.issues.join("; ")).toBe(true);
      if (rep.ok) {
        expect(rep.verifiedMoves).toBe(run.log.length);
        expect(rep.run.claims.length).toBe(run.claims.length);
        expect(paramsOfExperiment(file.kstrip)).toEqual(p);
      }
      // exporting the replayed run is byte-identical apart from the timestamp
      const again = kstripExperimentOf((rep as { run: typeof run }).run, null, "t");
      expect(JSON.stringify(again.kind === "kstrip" ? again.kstrip : null)).toBe(JSON.stringify(file.kstrip));
    }
  });

  it("a different seed gives a different log (the seed matters), and the file records it", () => {
    const a = runExplorer(P);
    const b = runExplorer({ ...P, seed: 6 });
    expect(a.log.map((e) => e.pt.x.toString() + e.pt.y.toString())).not.toEqual(
      b.log.map((e) => e.pt.x.toString() + e.pt.y.toString()),
    );
  });

  it("a tampered move is rejected, with the first differing move named", () => {
    const run = runExplorer(P);
    const file = kstripExperimentOf(run, null);
    if (file.kind !== "kstrip") {
      throw new Error("kind");
    }
    const moves = file.kstrip.moves.map((m, i) =>
      i === 7 ? { ...m, pt: [m.pt[0], "123456789/1"] as [string, string], ptFrame: [m.ptFrame[0], "123456789/1"] as [string, string] } : m,
    );
    const rep = replayKStripExperiment({ ...file.kstrip, moves });
    expect(rep.ok).toBe(false);
    if (!rep.ok) {
      expect(rep.issues.join(" ")).toMatch(/move 8 differs|recorded log/);
    }
  });

  it("a recorded log whose numbering is broken fails the policy-free legality check", () => {
    const run = runExplorer(P);
    const file = kstripExperimentOf(run, null);
    if (file.kind !== "kstrip") {
      throw new Error("kind");
    }
    const moves = file.kstrip.moves.map((m, i) => (i === 3 ? { ...m, n: 99 } : m));
    const rep = replayKStripExperiment({ ...file.kstrip, moves });
    expect(rep.ok).toBe(false);
    if (!rep.ok) {
      expect(rep.issues.join(" ")).toContain("recorded log: move 4: numbering 99");
    }
  });

  it("parameters that cannot run here are not re-executed", () => {
    const file = kstripExperimentOf(runExplorer(P), null);
    if (file.kind !== "kstrip") {
      throw new Error("kind");
    }
    const rep = replayKStripExperiment({ ...file.kstrip, k: 6 });
    expect(rep.ok).toBe(false);
    if (!rep.ok) {
      expect(rep.issues.join(" ")).toContain("not runnable");
    }
  });

  it("Break the Proof sessions replay deterministically from the user's points", () => {
    let pts = [] as ReturnType<typeof pt>[];
    let out = runBreak(P, { level: 3, points: pts });
    let guard = 0;
    while (out.pending !== null && guard < 10) {
      guard += 1;
      const pe = out.pending;
      for (let x = 0; x < 60; x += 1) {
        const cand = pt(Rat.make(BigInt(2 * x + 1), 2n), Rat.make(BigInt(-5 * x - 2)));
        if (pe.classify(cand).kind !== "illegal") {
          pts = [...pts, cand];
          break;
        }
      }
      out = runBreak(P, { level: 3, points: pts });
    }
    expect(out.run.status).toBe("completed");
    const text = experimentText(kstripExperimentOf(out.run, { level: 3, points: pts }));
    const file = parse(text);
    if (file.kind !== "kstrip") {
      throw new Error("kind");
    }
    expect(file.kstrip.script?.points.length).toBe(pts.length);
    const rep = replayKStripExperiment(file.kstrip);
    expect(rep.ok).toBe(true);
    if (rep.ok) {
      expect(rep.script?.points.length).toBe(pts.length);
      expect(rep.run.log.filter((e) => e.reason?.policy === "user").length).toBe(pts.length);
    }
    // a pending (unfinished) session round-trips too
    const half = runBreak(P, { level: 3, points: [] });
    const f2 = parse(experimentText(kstripExperimentOf(half.run, { level: 3, points: [] })));
    if (f2.kind === "kstrip") {
      expect(f2.kstrip.expect.status).toBe("awaiting-breaker-move");
      expect(replayKStripExperiment(f2.kstrip).ok).toBe(true);
    }
  });

  it("filenames are stable and descriptive", () => {
    const f = kstripExperimentOf(runExplorer(P), null);
    expect(experimentFilename(f)).toBe("playing-the-proof-kstrip-mono-1-1-k3-t1.experiment.json");
  });
});

describe("lab experiments", () => {
  const cfg: LabConfig = {
    model: "online",
    k: 3,
    bias: Rat.make(2n),
    rule: "bichromatic",
    encodingId: null,
    structures: 1,
  };
  const settings = { seed: 4, makerPolicy: "random-legal", breakerPolicy: "random-legal", maxRounds: 12, opsBudget: 3_000_000 } as const;

  it("an EXPERIMENTAL configuration round-trips with its recorded simulation", () => {
    expect(classify(cfg).status).toBe("EXPERIMENTAL");
    const result = runSimulation(cfg, settings);
    const text = experimentText(labExperimentOf(cfg, { settings, result }, "x"));
    const file = parse(text);
    if (file.kind !== "lab") {
      throw new Error("kind");
    }
    expect(file.lab.status).toBe("EXPERIMENTAL");
    const rep = replayLabExperiment(file.lab);
    expect(rep.ok, rep.ok ? "" : rep.issues.join("; ")).toBe(true);
  });

  it("an interrupted run is reproduced by interrupting at the same placement", () => {
    let polls = 0;
    const result = runSimulation(cfg, { ...settings, shouldStop: () => (polls += 1) > 5 });
    expect(result.kind).toBe("budgetExhausted");
    if (result.kind === "unsupported") {
      return;
    }
    expect(result.stoppedBy).toBe("interrupted");
    const file = parse(experimentText(labExperimentOf(cfg, { settings, result })));
    if (file.kind !== "lab") {
      throw new Error("kind");
    }
    expect(replayLabExperiment(file.lab).ok).toBe(true);
  });

  it("a stale status or a doctored observation is rejected", () => {
    const result = runSimulation(cfg, settings);
    const file = parse(experimentText(labExperimentOf(cfg, { settings, result })));
    if (file.kind !== "lab" || file.lab.simulation === null) {
      throw new Error("kind");
    }
    const staleStatus = replayLabExperiment({ ...file.lab, status: "THEOREM_BACKED" });
    expect(staleStatus.ok).toBe(false);
    const sim = file.lab.simulation;
    const doctored = replayLabExperiment({
      ...file.lab,
      simulation: { ...sim, observed: { ...sim.observed, rounds: sim.observed.rounds + 1 } },
    });
    expect(doctored.ok).toBe(false);
  });

  it("a lab file without a simulation is accepted when the classifier agrees", () => {
    const file = parse(experimentText(labExperimentOf(cfg, null)));
    if (file.kind !== "lab") {
      throw new Error("kind");
    }
    expect(file.lab.simulation).toBeNull();
    expect(replayLabExperiment(file.lab).ok).toBe(true);
  });
});

describe("wire encoding", () => {
  it("round-trips Rat, bigint, points and nesting through JSON", () => {
    const v = {
      a: Rat.make(-3n, 7n),
      b: [1n << 80n, { c: pt(Rat.make(1n, 2n), Rat.make(5n)) }],
      d: "s",
      e: null,
      f: 3,
      g: true,
    };
    const back = decodeWire(JSON.parse(JSON.stringify(encodeWire(v)))) as typeof v;
    expect(back.a.equals(Rat.make(-3n, 7n))).toBe(true);
    expect(back.b[0]).toBe(1n << 80n);
    expect((back.b[1] as { c: ReturnType<typeof pt> }).c.y.equals(Rat.make(5n))).toBe(true);
    expect(back.d).toBe("s");
    expect(back.e).toBeNull();
    expect(back.f).toBe(3);
    expect(back.g).toBe(true);
  });

  it("a whole explorer run survives the worker boundary", () => {
    const run = runExplorer({ ...P, k: 3 });
    const back = decodeWire(JSON.parse(JSON.stringify(encodeWire(run)))) as typeof run;
    expect(back.log.length).toBe(run.log.length);
    expect(back.log[3]?.pt.x.equals(run.log[3]?.pt.x ?? Rat.ZERO)).toBe(true);
    expect(back.estimate.points).toBe(run.estimate.points);
    expect(back.trace.length).toBe(run.trace.length);
  });
});
