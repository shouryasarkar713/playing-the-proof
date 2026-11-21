// ui/experiment-io.ts — build, verify and re-execute EXPERIMENT files
// (k-strip explorer sessions and Parameter Lab simulations). The wire schema
// and its caps live in replay/experiment.ts; this module owns the parts that
// need kstrip/ and lab/: converting runs to the wire form and re-executing a
// file deterministically (parameters + seed + log -> the identical run).
import { Rat } from "../geometry/rat.ts";
import { pt } from "../geometry/pt.ts";
import type { Pt } from "../geometry/pt.ts";
import { replayLog } from "../kstrip/index.ts";
import type { MoveLogEntry } from "../kstrip/index.ts";
import { classify, parseBias, runSimulation } from "../lab/index.ts";
import type { LabConfig, SimResult } from "../lab/index.ts";
import {
  EXPERIMENT_FORMAT,
  parseExperiment,
  serializeExperiment,
} from "../replay/experiment.ts";
import type {
  ExperimentFile,
  ExperimentMove,
  KStripExperiment,
  LabExperiment,
} from "../replay/experiment.ts";
import { availability, runBreak, runExplorer } from "./kstrip-core.ts";
import type { BreakScript, ExplorerParams, ExplorerRun } from "./kstrip-core.ts";
import pkg from "../../package.json";

function stamp(label?: string): ExperimentFile["meta"] {
  return {
    createdAt: new Date().toISOString(),
    app: "playing-the-proof",
    appVersion: pkg.version,
    ...(label !== undefined ? { label } : {}),
  };
}

const ptw = (p: Pt): [string, string] => [p.x.toString(), p.y.toString()];
const ptFromWire = (w: readonly [string, string]): Pt => pt(Rat.fromString(w[0]), Rat.fromString(w[1]));

// ---- k-strip ---------------------------------------------------------------

export function kstripExperimentOf(
  run: ExplorerRun,
  script: BreakScript | null,
  label?: string,
): ExperimentFile {
  const p = run.params;
  const moves: ExperimentMove[] = run.log.map((e) => ({
    n: e.n,
    round: e.round,
    phase: e.phase,
    level: e.level,
    levelRound: e.levelRound,
    player: e.player,
    kind: e.kind,
    pt: ptw(e.pt),
    ptFrame: ptw(e.ptFrame),
    frameC: e.frameC,
  }));
  const kstrip: KStripExperiment = {
    variant: p.variant,
    k: p.k,
    t: p.t,
    s: p.s,
    policy: p.policy,
    seed: p.seed,
    script:
      script === null ? null : { level: script.level, points: script.points.map(ptw) },
    moves,
    expect: {
      status: run.status,
      rounds: run.rounds,
      points: run.points.length,
      claims: run.claims.length,
    },
  };
  return {
    format: EXPERIMENT_FORMAT,
    version: 1,
    kind: "kstrip",
    meta: stamp(label),
    kstrip,
  };
}

export type KStripReplay =
  | {
      readonly ok: true;
      readonly run: ExplorerRun;
      readonly script: BreakScript | null;
      readonly verifiedMoves: number;
    }
  | { readonly ok: false; readonly issues: readonly string[] };

function toEntry(m: ExperimentMove): MoveLogEntry {
  return {
    n: m.n,
    round: m.round,
    phase: m.phase,
    level: m.level,
    levelRound: m.levelRound,
    player: m.player,
    kind: m.kind,
    pt: ptFromWire(m.pt),
    ptFrame: ptFromWire(m.ptFrame),
    frameC: m.frameC,
    note: "",
    reason: null,
  };
}

export function paramsOfExperiment(x: KStripExperiment): ExplorerParams {
  return { variant: x.variant, k: x.k, t: x.t, s: x.s, policy: x.policy, seed: x.seed };
}

// Re-execute a k-strip experiment and compare it with the recorded log.
export function replayKStripExperiment(x: KStripExperiment): KStripReplay {
  const params = paramsOfExperiment(x);
  const issues: string[] = [];
  // 1. the recorded log is legal on its own (no policy involved)
  const entries = x.moves.map(toEntry);
  const legality = replayLog(entries, x.variant !== "bichromatic");
  if (!legality.ok) {
    issues.push(...legality.failures.slice(0, 5).map((f) => `recorded log: ${f}`));
  }
  // 2. the parameters are executable here
  const avail = availability(params);
  const trivial = x.expect.status === "refused" || x.expect.status === "unsupported";
  if (avail.kind !== "runnable" && !trivial) {
    return {
      ok: false,
      issues: [
        ...issues,
        `these parameters are not runnable in this build (${avail.kind}); the file records a run that cannot be re-executed here`,
      ],
    };
  }
  // 3. deterministic re-execution
  const script: BreakScript | null =
    x.script === null ? null : { level: x.script.level, points: x.script.points.map(ptFromWire) };
  const run = script === null ? runExplorer(params) : runBreak(params, script).run;
  if (run.status !== x.expect.status) {
    issues.push(`status differs: recorded ${x.expect.status}, re-executed ${run.status}`);
  }
  if (run.rounds !== x.expect.rounds) {
    issues.push(`rounds differ: recorded ${x.expect.rounds}, re-executed ${run.rounds}`);
  }
  if (run.points.length !== x.expect.points) {
    issues.push(`point count differs: recorded ${x.expect.points}, re-executed ${run.points.length}`);
  }
  if (run.claims.length !== x.expect.claims) {
    issues.push(`claim count differs: recorded ${x.expect.claims}, re-executed ${run.claims.length}`);
  }
  if (run.log.length !== x.moves.length) {
    issues.push(`move count differs: recorded ${x.moves.length}, re-executed ${run.log.length}`);
  }
  const n = run.log.length < x.moves.length ? run.log.length : x.moves.length;
  for (let i = 0; i < n; i += 1) {
    const a = run.log[i] as MoveLogEntry;
    const b = x.moves[i] as ExperimentMove;
    if (
      a.n !== b.n || a.round !== b.round || a.phase !== b.phase || a.level !== b.level ||
      a.levelRound !== b.levelRound || a.player !== b.player || a.kind !== b.kind ||
      a.frameC !== b.frameC || a.pt.x.toString() !== b.pt[0] || a.pt.y.toString() !== b.pt[1] ||
      a.ptFrame.x.toString() !== b.ptFrame[0] || a.ptFrame.y.toString() !== b.ptFrame[1]
    ) {
      issues.push(`move ${i + 1} differs from the re-executed run`);
      break;
    }
  }
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, run, script, verifiedMoves: n };
}

// ---- lab -------------------------------------------------------------------

export interface LabSimSettings {
  readonly seed: number;
  readonly makerPolicy: "random-legal" | "greedy";
  readonly breakerPolicy: "random-legal" | "greedy";
  readonly maxRounds: number;
  readonly opsBudget: number;
}

export function labExperimentOf(
  cfg: LabConfig,
  sim: { settings: LabSimSettings; result: SimResult } | null,
  label?: string,
): ExperimentFile {
  const result = classify(cfg);
  let simulation: LabExperiment["simulation"] = null;
  if (sim !== null && sim.result.kind !== "unsupported") {
    const o = sim.result.observed;
    simulation = {
      ...sim.settings,
      observed: {
        kind: sim.result.kind,
        stoppedBy: sim.result.stoppedBy,
        rounds: o.rounds,
        makerPoints: o.makerPoints,
        breakerPoints: o.breakerPoints,
        holeFound: o.holeFound,
        witness: o.witness === null ? null : [...o.witness],
        holeRound: o.holeRound,
        opsUsed: o.opsUsed,
        transcript: [...o.transcript],
      },
    };
  }
  return {
    format: EXPERIMENT_FORMAT,
    version: 1,
    kind: "lab",
    meta: stamp(label),
    lab: {
      config: {
        model: cfg.model,
        k: cfg.k,
        bias: cfg.bias.toString(),
        rule: cfg.rule,
        encodingId: cfg.encodingId,
        structures: cfg.structures,
      },
      status: result.status,
      simulation,
    },
  };
}

export function labConfigOfExperiment(x: LabExperiment): LabConfig | null {
  const bias = parseBias(x.config.bias);
  if (bias === null) {
    return null;
  }
  return {
    model: x.config.model,
    k: x.config.k,
    bias,
    rule: x.config.rule,
    encodingId: x.config.encodingId,
    structures: x.config.structures,
  };
}

export type LabReplay =
  | { readonly ok: true; readonly config: LabConfig; readonly result: SimResult | null }
  | { readonly ok: false; readonly issues: readonly string[] };

export function replayLabExperiment(x: LabExperiment): LabReplay {
  const cfg = labConfigOfExperiment(x);
  if (cfg === null) {
    return { ok: false, issues: ["the bias is not a valid rational"] };
  }
  const issues: string[] = [];
  const status = classify(cfg).status;
  if (status !== x.status) {
    issues.push(`status differs: recorded ${x.status}, classify() now returns ${status}`);
  }
  let result: SimResult | null = null;
  if (x.simulation !== null) {
    const s = x.simulation;
    const rec = s.observed;
    let polls = 0;
    // An interrupted run is reproduced by interrupting at the same placement.
    const stopAt = rec.stoppedBy === "interrupted" ? rec.transcript.length : -1;
    result = runSimulation(cfg, {
      seed: s.seed,
      makerPolicy: s.makerPolicy,
      breakerPolicy: s.breakerPolicy,
      maxRounds: s.maxRounds,
      opsBudget: s.opsBudget,
      shouldStop: () => {
        polls += 1;
        return stopAt >= 0 && polls > stopAt;
      },
    });
    if (result.kind === "unsupported") {
      issues.push("the simulation is not supported for this configuration any more");
    } else {
      const o = result.observed;
      const same =
        result.kind === rec.kind &&
        result.stoppedBy === rec.stoppedBy &&
        o.rounds === rec.rounds &&
        o.makerPoints === rec.makerPoints &&
        o.breakerPoints === rec.breakerPoints &&
        o.holeFound === rec.holeFound &&
        o.opsUsed === rec.opsUsed &&
        o.transcript.length === rec.transcript.length &&
        o.transcript.every((t, i) => t === rec.transcript[i]);
      if (!same) {
        issues.push("the re-executed simulation differs from the recorded observation");
      }
    }
  }
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, config: cfg, result };
}

// ---- file-level helpers ----------------------------------------------------

export function experimentText(file: ExperimentFile): string {
  return serializeExperiment(file);
}

export function experimentFilename(file: ExperimentFile): string {
  if (file.kind === "kstrip") {
    const x = file.kstrip;
    return `playing-the-proof-kstrip-${x.variant.replace(":", "-")}-k${x.k}-t${x.t}.experiment.json`;
  }
  const c = file.lab.config;
  return `playing-the-proof-lab-k${c.k}-${c.rule}-${c.model}.experiment.json`;
}

export function looksLikeExperiment(text: string): boolean {
  // Cheap sniff before the cap-checked parse: the format marker near the top.
  return text.slice(0, 4096).includes(EXPERIMENT_FORMAT);
}

export { parseExperiment };
