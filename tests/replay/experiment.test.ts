// tests/replay/experiment.test.ts — the experiment wire schema: round trip,
// strict shape, caps, version handling, and that Core replay files are not
// confused with experiment files.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXPERIMENT_FORMAT,
  EXPERIMENT_MAX_MOVES,
  migrateExperiment,
  parseExperiment,
  serializeExperiment,
} from "../../src/replay/experiment.ts";
import type { ExperimentFile } from "../../src/replay/experiment.ts";
import { parseReplayFile } from "../../src/replay/format.ts";

const meta = { createdAt: "2026-01-01T00:00:00.000Z", app: "playing-the-proof", appVersion: "1.0.0" };

function kstripFile(): ExperimentFile {
  return {
    format: EXPERIMENT_FORMAT,
    version: 1,
    kind: "kstrip",
    meta,
    kstrip: {
      variant: "mono-1:1",
      k: 3,
      t: 1,
      s: null,
      policy: "strategy-aware",
      seed: 1,
      script: null,
      moves: [
        {
          n: 1,
          round: 1,
          phase: "base",
          level: 2,
          levelRound: 1,
          player: "maker",
          kind: "base-point",
          pt: ["1/1", "1/1"],
          ptFrame: ["1/1", "1/1"],
          frameC: "0/1",
        },
      ],
      expect: { status: "completed", rounds: 1, points: 1, claims: 0 },
    },
  };
}

function labFile(): ExperimentFile {
  return {
    format: EXPERIMENT_FORMAT,
    version: 1,
    kind: "lab",
    meta,
    lab: {
      config: { model: "online", k: 7, bias: "2/1", rule: "bichromatic", encodingId: null, structures: 1 },
      status: "EXPERIMENTAL",
      simulation: {
        seed: 3,
        makerPolicy: "random-legal",
        breakerPolicy: "greedy",
        maxRounds: 12,
        opsBudget: 3000000,
        observed: {
          kind: "budgetExhausted",
          stoppedBy: "max-rounds",
          rounds: 12,
          makerPoints: 12,
          breakerPoints: 24,
          holeFound: false,
          witness: null,
          holeRound: null,
          opsUsed: 10,
          transcript: ["maker:1,2", "breaker:3,4"],
        },
      },
    },
  };
}

function reparse(f: ExperimentFile): ReturnType<typeof parseExperiment> {
  return parseExperiment(serializeExperiment(f));
}

function mutate(f: ExperimentFile, fn: (o: Record<string, unknown>) => void): string {
  const o = JSON.parse(serializeExperiment(f)) as Record<string, unknown>;
  fn(o);
  return JSON.stringify(o);
}

describe("experiment schema v1", () => {
  it("round-trips a k-strip and a lab file byte-identically", () => {
    for (const f of [kstripFile(), labFile()]) {
      const text = serializeExperiment(f);
      const p = parseExperiment(text);
      expect(p.ok).toBe(true);
      if (p.ok) {
        expect(serializeExperiment(p.file)).toBe(text);
      }
    }
  });

  it("rejects unknown fields, missing fields and wrong types with typed issues", () => {
    const f = kstripFile();
    const extra = parseExperiment(mutate(f, (o) => { o["surprise"] = 1; }));
    expect(extra.ok).toBe(false);
    if (!extra.ok) {
      expect(extra.issues.some((i) => i.code === "unknown-field")).toBe(true);
    }
    const missing = parseExperiment(mutate(f, (o) => { delete o["kstrip"]; }));
    expect(missing.ok).toBe(false);
    const wrong = parseExperiment(mutate(f, (o) => { (o["kstrip"] as Record<string, unknown>)["k"] = "3"; }));
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) {
      expect(wrong.issues[0]?.code).toBe("wrong-type");
    }
    const badEnum = parseExperiment(mutate(f, (o) => { (o["kstrip"] as Record<string, unknown>)["variant"] = "nope"; }));
    expect(badEnum.ok).toBe(false);
  });

  it("requires a bias for biased variants and forbids it for mono-1:1", () => {
    const f = kstripFile();
    expect(parseExperiment(mutate(f, (o) => { (o["kstrip"] as Record<string, unknown>)["s"] = "2/1"; })).ok).toBe(false);
    expect(
      parseExperiment(mutate(f, (o) => { (o["kstrip"] as Record<string, unknown>)["variant"] = "mono-1:s"; })).ok,
    ).toBe(false);
  });

  it("enforces the rational caps and canonical spelling", () => {
    const f = kstripFile();
    const long = `${"9".repeat(101)}/1`;
    const big = parseExperiment(mutate(f, (o) => { ((o["kstrip"] as { moves: { pt: string[] }[] })["moves"][0] as { pt: string[] }).pt = [long, "1/1"]; }));
    expect(big.ok).toBe(false);
    if (!big.ok) {
      expect(big.issues[0]?.code).toBe("bad-rational");
    }
    const noncanon = parseExperiment(mutate(f, (o) => { ((o["kstrip"] as { moves: { pt: string[] }[] })["moves"][0] as { pt: string[] }).pt = ["2/2", "1/1"]; }));
    expect(noncanon.ok).toBe(false);
    const garbage = parseExperiment(mutate(f, (o) => { ((o["kstrip"] as { moves: { frameC: string }[] })["moves"][0] as { frameC: string }).frameC = "x"; }));
    expect(garbage.ok).toBe(false);
  });

  it("enforces the size and count caps", () => {
    expect(parseExperiment("x".repeat(2 * 1024 * 1024 + 1))).toMatchObject({ ok: false, issues: [{ code: "too-large" }] });
    const f = kstripFile();
    const many = parseExperiment(
      mutate(f, (o) => {
        const k = o["kstrip"] as { moves: unknown[] };
        k.moves = Array.from({ length: EXPERIMENT_MAX_MOVES + 1 }, () => k.moves[0]);
      }),
    );
    expect(many.ok).toBe(false);
    if (!many.ok) {
      expect(many.issues[0]?.code).toBe("too-many");
    }
    const lab = labFile();
    const tr = parseExperiment(
      mutate(lab, (o) => {
        const s = (o["lab"] as { simulation: { observed: { transcript: string[] } } }).simulation;
        s.observed.transcript = Array.from({ length: 201 }, () => "maker:1,1");
      }),
    );
    expect(tr.ok).toBe(false);
  });

  it("not JSON, not an object, wrong format", () => {
    expect(parseExperiment("{nope")).toMatchObject({ ok: false, issues: [{ code: "bad-json" }] });
    expect(parseExperiment("[1]")).toMatchObject({ ok: false, issues: [{ code: "not-an-object" }] });
    expect(parseExperiment('{"format":"other","version":1}')).toMatchObject({ ok: false, issues: [{ code: "bad-format" }] });
  });

  it("versions: 1 is read; older or newer versions are refused with their own message", () => {
    expect(migrateExperiment({ format: EXPERIMENT_FORMAT, version: 1 }).ok).toBe(true);
    const newer = migrateExperiment({ format: EXPERIMENT_FORMAT, version: 2 });
    expect(newer.ok).toBe(false);
    if (!newer.ok) {
      expect(newer.issues[0]?.code).toBe("bad-version");
      expect(newer.issues[0]?.message).toContain("newer");
    }
    const old = migrateExperiment({ format: EXPERIMENT_FORMAT, version: 0 });
    expect(old.ok).toBe(false);
    const missing = migrateExperiment({ format: EXPERIMENT_FORMAT });
    expect(missing.ok).toBe(false);
  });

  it("meta may carry extra keys (forward compatibility) but they are dropped", () => {
    const f = kstripFile();
    const p = parseExperiment(mutate(f, (o) => { (o["meta"] as Record<string, unknown>)["future"] = "x"; }));
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect((p.file.meta as unknown as Record<string, unknown>)["future"]).toBeUndefined();
    }
  });

  it("lab: bias must be non-negative and canonical", () => {
    const lab = labFile();
    expect(parseExperiment(mutate(lab, (o) => { ((o["lab"] as { config: Record<string, unknown> }).config)["bias"] = "-1/1"; })).ok).toBe(false);
    expect(reparse(lab).ok).toBe(true);
  });

  it("Core replay files are not experiment files, and experiment files are not Core replays", () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "../../data/replays");
    const files = readdirSync(dir).filter((n) => n.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    for (const n of files) {
      const text = readFileSync(join(dir, n), "utf8");
      expect(parseExperiment(text)).toMatchObject({ ok: false, issues: [{ code: "bad-format" }] });
      expect(parseReplayFile(text).ok, n).toBe(true); // untouched Core fixtures still parse
    }
    expect(parseReplayFile(serializeExperiment(kstripFile())).ok).toBe(false);
  });
});
