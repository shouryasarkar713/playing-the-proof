// ui/kstrip-core.ts — DOM-free logic of the k-strip explorer: the supported
// (verified) parameter table, availability (runnable / refused / estimate
// only), the traced run, the step list over the trace, the recursion table,
// Breaker-reason wording, and the "Break the proof" scripted run. All geometry
// is delegated to src/kstrip; nothing here evaluates a predicate itself.
import { Rat } from "../geometry/rat.ts";
import type { Pt } from "../geometry/pt.ts";
import { parseBias } from "../lab/bias.ts";
import {
  DEFAULT_BUDGET,
  biasedClosedForm,
  biasedRounds,
  checkBudget,
  createGreedyBlockingPolicy,
  createRandomLegalPolicy,
  createStrategyAwarePolicy,
  estimateCost,
  monoClosedForm,
  monoRounds,
  runKStrip,
  toFrame,
} from "../kstrip/index.ts";
import type {
  BreakerDecision,
  BreakerPolicy,
  BreakerView,
  Dir,
  Estimate,
  LevelReport,
  MoveLogEntry,
  MoveReason,
  PhaseKind,
  RunOptions,
  RunResult,
  RunSpec,
  RunStatus,
  TraceEvent,
  Variant,
} from "../kstrip/index.ts";

export type PolicyId = "random-legal" | "greedy-blocking" | "strategy-aware";
export const POLICY_IDS: readonly PolicyId[] = ["random-legal", "greedy-blocking", "strategy-aware"];

export const POLICY_LABELS: Readonly<Record<PolicyId, string>> = {
  "random-legal": "Random legal point",
  "greedy-blocking": "Greedy blocking (first live region)",
  "strategy-aware": "Strategy-aware (reads the counting ledger)",
};

export interface ExplorerParams {
  readonly variant: Variant;
  readonly k: number;
  readonly t: number;
  // Canonical rational ("n/d") for mono-1:s and bichromatic; null for mono-1:1.
  readonly s: string | null;
  readonly policy: PolicyId;
  readonly seed: number;
}

export function makePolicy(id: PolicyId, seed: number): BreakerPolicy {
  if (id === "random-legal") {
    return createRandomLegalPolicy(seed);
  }
  return id === "greedy-blocking" ? createGreedyBlockingPolicy() : createStrategyAwarePolicy();
}

// ---------------------------------------------------------------------------
// The verified table. These are exactly the configurations that docs/KSTRIP.md
// section 6 lists AND that the repository executes in tests/kstrip (run-mono,
// run-variants, bichromatic, recursion) or measured in the explorer pass; the
// bichromatic k = 3, s = 3/2, r = 2 instance of the doc's "r <= 2" is refused by
// the default budget and therefore not executable. Everything else is
// estimate-only.

export interface SupportedRow {
  readonly variant: Variant;
  readonly k: number;
  readonly s: string | null;
  readonly t: readonly number[];
}

export const SUPPORTED: readonly SupportedRow[] = [
  { variant: "mono-1:1", k: 2, s: null, t: [1] },
  { variant: "mono-1:1", k: 3, s: null, t: [1, 2, 3] },
  { variant: "mono-1:1", k: 4, s: null, t: [1] },
  { variant: "mono-1:1", k: 5, s: null, t: [1] },
  { variant: "mono-1:s", k: 3, s: "2/1", t: [1] },
  { variant: "mono-1:s", k: 3, s: "3/1", t: [1] },
  { variant: "mono-1:s", k: 4, s: "1/1", t: [1] },
  { variant: "mono-1:s", k: 4, s: "2/1", t: [1] },
  { variant: "bichromatic", k: 2, s: "1/1", t: [1, 2] },
  { variant: "bichromatic", k: 2, s: "3/2", t: [1, 2] },
  { variant: "bichromatic", k: 3, s: "0/1", t: [1, 2] },
  { variant: "bichromatic", k: 3, s: "1/1", t: [1, 2] },
  { variant: "bichromatic", k: 3, s: "3/2", t: [1] },
];

export const VARIANT_LABELS: Readonly<Record<Variant, string>> = {
  "mono-1:1": "Monochromatic 1:1 (Theorem 3)",
  "mono-1:s": "Monochromatic 1:s, integer s (Theorem 4)",
  bichromatic: "Bichromatic 1:s, rational s < 2 (Theorem 5)",
};

export function isSupported(p: Pick<ExplorerParams, "variant" | "k" | "t" | "s">): boolean {
  return SUPPORTED.some(
    (r) => r.variant === p.variant && r.k === p.k && r.s === p.s && r.t.includes(p.t),
  );
}

export function parseS(variant: Variant, text: string): { ok: true; s: string | null } | { ok: false; message: string } {
  if (variant === "mono-1:1") {
    return { ok: true, s: null };
  }
  const r = parseBias(text);
  if (r === null) {
    return { ok: false, message: "s must be a non-negative rational such as 2, 3/2 or 1.5" };
  }
  if (variant === "mono-1:s" && (r.d !== 1n || r.n < 1n)) {
    return { ok: false, message: "mono 1:s needs an integer s >= 1 (Theorem 4 is stated for integer s)" };
  }
  if (variant === "bichromatic" && r.cmp(Rat.make(2n)) >= 0) {
    return { ok: false, message: "bichromatic Theorem 5 needs 0 <= s < 2" };
  }
  return { ok: true, s: r.toString() };
}

export function specOf(p: Pick<ExplorerParams, "variant" | "k" | "t" | "s">): RunSpec {
  const t = BigInt(p.t);
  if (p.variant === "mono-1:1") {
    return { variant: p.variant, k: p.k, t, s: Rat.ONE };
  }
  return { variant: p.variant, k: p.k, t, s: Rat.fromString(p.s ?? "1/1") };
}

export function optsOf(p: Pick<ExplorerParams, "variant" | "s">): RunOptions {
  return p.variant === "mono-1:1"
    ? { variant: p.variant }
    : { variant: p.variant, s: Rat.fromString(p.s ?? "1/1") };
}

export type Availability =
  | { readonly kind: "invalid"; readonly estimate: Estimate; readonly reasons: readonly string[] }
  | { readonly kind: "runnable"; readonly estimate: Estimate }
  | {
      readonly kind: "refused";
      readonly estimate: Estimate;
      readonly reasons: readonly string[];
      readonly alsoUnverified: boolean;
    }
  | { readonly kind: "estimate-only"; readonly estimate: Estimate; readonly reason: string };

export function availability(p: Pick<ExplorerParams, "variant" | "k" | "t" | "s">): Availability {
  const estimate = estimateCost(specOf(p));
  if (!estimate.supported) {
    return { kind: "invalid", estimate, reasons: [estimate.unsupportedReason ?? "unsupported parameters"] };
  }
  const verified = isSupported(p);
  const bc = checkBudget(estimate, DEFAULT_BUDGET);
  if (!bc.ok) {
    return { kind: "refused", estimate, reasons: bc.exceeded, alsoUnverified: !verified };
  }
  if (!verified) {
    return {
      kind: "estimate-only",
      estimate,
      reason:
        "estimate only — not executed: these parameters are not among the verified configurations listed in the table.",
    };
  }
  return { kind: "runnable", estimate };
}

export function availabilityText(a: Availability): string {
  switch (a.kind) {
    case "invalid":
      return `Invalid parameters: ${a.reasons.join("; ")}.`;
    case "runnable":
      return "Verified configuration: this run is executed with exact geometry and every claimed strip is re-checked on the final board.";
    case "refused":
      return (
        `Refused before execution — over the default budget (${a.reasons.join("; ")}).` +
        (a.alsoUnverified ? " These parameters are also not among the verified configurations." : "")
      );
    case "estimate-only":
      return a.reason;
  }
}

// ---------------------------------------------------------------------------
// Runs

export type ExplorerStatus = RunStatus | "awaiting-breaker-move";

export interface ExplorerClaim {
  readonly level: number;
  readonly vertices: readonly Pt[];
  readonly direction: Dir;
}

export interface ExplorerRun {
  readonly params: ExplorerParams;
  readonly status: ExplorerStatus;
  readonly message: string;
  readonly estimate: Estimate;
  readonly rounds: number;
  readonly goal: bigint;
  readonly goalMet: boolean;
  readonly points: readonly { readonly pt: Pt; readonly owner: "maker" | "breaker" }[];
  readonly log: readonly MoveLogEntry[];
  readonly levels: readonly LevelReport[];
  readonly checks: readonly { readonly name: string; readonly ok: boolean }[];
  readonly claims: readonly ExplorerClaim[];
  readonly trace: readonly TraceEvent[];
  readonly work: bigint;
  readonly ms: number;
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function runExplorer(params: ExplorerParams, policy?: BreakerPolicy): ExplorerRun {
  const t0 = nowMs();
  const moves: MoveLogEntry[] = [];
  const events: TraceEvent[] = [];
  let res: RunResult;
  try {
    res = runKStrip(params.k, params.t, policy ?? makePolicy(params.policy, params.seed), DEFAULT_BUDGET, {
      ...optsOf(params),
      trace: (e) => {
        if (e.kind === "move") {
          moves.push(e.entry);
        } else {
          events.push(e);
        }
      },
    });
  } catch (e) {
    if (!(e instanceof NeedUserMove)) {
      throw e;
    }
    // A scripted Breaker needs its next point: the partial log is the moves
    // observed so far; nothing has been claimed.
    return {
      params,
      status: "awaiting-breaker-move",
      message: "waiting for your next Breaker point",
      estimate: estimateCost(specOf(params)),
      rounds: moves.length === 0 ? 0 : (moves[moves.length - 1] as MoveLogEntry).round,
      goal: BigInt(params.t),
      goalMet: false,
      points: moves.map((m) => ({ pt: m.pt, owner: m.player })),
      log: moves,
      levels: [],
      checks: [],
      claims: [],
      trace: events,
      work: 0n,
      ms: nowMs() - t0,
    };
  }
  return {
    params,
    status: res.status,
    message: res.message,
    estimate: res.estimate,
    rounds: res.rounds,
    goal: res.goal,
    goalMet: res.goalMet,
    points: res.points,
    log: res.log,
    levels: res.levels,
    checks: res.checks,
    claims: res.claims.map((c) => ({ level: c.level, vertices: c.vertices, direction: c.direction })),
    trace: events,
    work: res.work,
    ms: nowMs() - t0,
  };
}

// ---------------------------------------------------------------------------
// Worker plumbing: a run request/response over plain (wire-encoded) data.
// The worker module calls runExplorer; tests and Worker-less environments call
// it directly through runExplorerAsync's fallback.

export interface RunHandle {
  cancel(): void;
}

export function runExplorerAsync(
  params: ExplorerParams,
  onDone: (run: ExplorerRun) => void,
  onError: (message: string) => void,
  workerFactory: (() => Worker | null) | null = defaultWorkerFactory,
  decode: (v: unknown) => ExplorerRun = (v) => v as ExplorerRun,
): RunHandle {
  let cancelled = false;
  const w = workerFactory === null ? null : workerFactory();
  if (w !== null) {
    w.onmessage = (ev: MessageEvent): void => {
      if (cancelled) {
        return;
      }
      const d = ev.data as { ok: boolean; run?: unknown; message?: string };
      w.terminate();
      if (d.ok && d.run !== undefined) {
        onDone(decode(d.run));
      } else {
        onError(d.message ?? "worker failed");
      }
    };
    w.onerror = (): void => {
      if (!cancelled) {
        w.terminate();
        onError("the worker failed to start");
      }
    };
    w.postMessage({ params });
    return {
      cancel(): void {
        cancelled = true;
        w.terminate();
      },
    };
  }
  // No Worker: run in a macrotask so the click handler returns first.
  const timer = setTimeout(() => {
    if (cancelled) {
      return;
    }
    try {
      onDone(runExplorer(params));
    } catch (e) {
      onError(e instanceof Error ? e.message : "run failed");
    }
  }, 0);
  return {
    cancel(): void {
      cancelled = true;
      clearTimeout(timer);
    },
  };
}

// Set by ui/modes/kstrip.ts (it owns the `new Worker(new URL(...))` literal
// that the bundler needs to see); null in tests.
export let defaultWorkerFactory: (() => Worker | null) | null = null;
export function setDefaultWorkerFactory(f: (() => Worker | null) | null): void {
  defaultWorkerFactory = f;
}

// ---------------------------------------------------------------------------
// Step list over a trace

type LedgerEvent = Extract<TraceEvent, { kind: "ledger" }>;
type StartEvent = Extract<TraceEvent, { kind: "phase-start" }>;
type EndEvent = Extract<TraceEvent, { kind: "phase-end" }>;

export interface Step {
  readonly index: number;
  readonly kind: "start" | "move" | "end" | "result";
  readonly phase: PhaseKind | null;
  readonly level: number | null;
  // Points visible at this step: log[0 .. logLength).
  readonly logLength: number;
  readonly title: string;
  readonly moveIdx: number | null;
  readonly start: StartEvent | null;
  readonly ledger: LedgerEvent | null;
  readonly end: EndEvent | null;
}

export const PHASE_NAMES: Readonly<Record<PhaseKind, string>> = {
  base: "base points",
  pairing: "pairing",
  grouping: "grouping",
  "bichromatic-base": "base points (bichromatic)",
  "bichromatic-pairing": "pairing (bichromatic)",
};

export function moveTitle(e: MoveLogEntry): string {
  if (e.player === "maker") {
    return e.kind === "apex"
      ? `Move ${e.n}: Maker places the extension point p_${e.levelRound}`
      : `Move ${e.n}: Maker places a base point`;
  }
  return `Move ${e.n}: Breaker replies (${e.reason?.policy ?? "policy"})`;
}

export function buildSteps(run: ExplorerRun): Step[] {
  const steps: Step[] = [];
  const log = run.log;
  const push = (s: Omit<Step, "index">): void => {
    steps.push({ ...s, index: steps.length });
  };
  const ledgerAt = new Map<string, LedgerEvent>();
  for (const e of run.trace) {
    if (e.kind === "ledger") {
      ledgerAt.set(`${e.level}:${e.phase}:${e.logLength}`, e);
    }
  }
  let cursor = 0; // next log index not yet emitted
  let currentStart: StartEvent | null = null;
  const emitMovesUpTo = (limit: number, start: StartEvent | null): void => {
    while (cursor < limit && cursor < log.length) {
      const e = log[cursor] as MoveLogEntry;
      push({
        kind: "move",
        phase: e.phase,
        level: e.level,
        logLength: cursor + 1,
        title: moveTitle(e),
        moveIdx: cursor,
        start,
        ledger: ledgerAt.get(`${e.level}:${e.phase}:${cursor + 1}`) ?? null,
        end: null,
      });
      cursor += 1;
    }
  };
  for (const e of run.trace) {
    if (e.kind === "phase-start") {
      emitMovesUpTo(e.logLength, currentStart);
      currentStart = e;
      push({
        kind: "start",
        phase: e.phase,
        level: e.level,
        logLength: e.logLength,
        title: `Level ${e.level}: ${PHASE_NAMES[e.phase]} — start`,
        moveIdx: null,
        start: e,
        ledger: null,
        end: null,
      });
    } else if (e.kind === "phase-end") {
      emitMovesUpTo(e.logLength, currentStart);
      push({
        kind: "end",
        phase: e.phase,
        level: e.level,
        logLength: e.logLength,
        title: `Level ${e.level}: ${PHASE_NAMES[e.phase]} — harvest`,
        moveIdx: null,
        start: currentStart,
        ledger: null,
        end: e,
      });
      currentStart = null;
    }
  }
  emitMovesUpTo(log.length, currentStart);
  push({
    kind: "result",
    phase: null,
    level: null,
    logLength: log.length,
    title: `Result: ${run.status}`,
    moveIdx: null,
    start: null,
    ledger: null,
    end: null,
  });
  return steps;
}

// The latest ledger snapshot at or before step index i within its phase.
export function ledgerFor(steps: readonly Step[], i: number): LedgerEvent | null {
  const here = steps[i];
  if (here === undefined) {
    return null;
  }
  for (let j = i; j >= 0; j -= 1) {
    const s = steps[j] as Step;
    if (s.start !== here.start && s.kind !== "end") {
      return null;
    }
    if (s.ledger !== null) {
      return s.ledger;
    }
    if (s.kind === "start") {
      return null;
    }
  }
  return null;
}

// First step index of every (level, phase) block, for the phase chips.
export function phaseChips(steps: readonly Step[]): { label: string; index: number; level: number; phase: PhaseKind }[] {
  const out: { label: string; index: number; level: number; phase: PhaseKind }[] = [];
  for (const s of steps) {
    if (s.kind === "start" && s.level !== null && s.phase !== null) {
      out.push({ label: `L${s.level} ${PHASE_NAMES[s.phase]}`, index: s.index, level: s.level, phase: s.phase });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Wording

export function reasonText(r: MoveReason | null): string {
  if (r === null) {
    return "No Breaker policy reason is attached to this move.";
  }
  const d = r.data;
  const tgt = r.target;
  switch (r.code) {
    case "random":
      return "A uniformly random legal point (seeded): it is not aimed at any candidate region.";
    case "fallback-far":
      return "The random search found no legal point after 400 tries, so a legal point far to the right was played; it blocks nothing.";
    case "block-first-live-region":
      return (
        `Aimed at ${tgt?.region ?? "a region"} of unit ${String(tgt?.unit ?? "?")}: the first live region in index order. ` +
        `The unit needs ${String(d["unitNeed"] ?? "?")} more interior point(s) to die and ${String(d["remaining"] ?? "?")} Breaker point(s) remain in this phase.`
      );
    case "nothing-to-block":
      return "No candidate region is live, so there is nothing to block; a far legal point was played.";
    case "no-ledger":
      return "This phase has no counting structure (base points), so a far legal point was played.";
    case "finish-unit":
      return (
        `One more interior point kills unit ${String(tgt?.unit ?? "?")} (aimed at ${tgt?.region ?? "a region"}); ` +
        `${String(d["remaining"] ?? "?")} Breaker point(s) remain and ${String(d["killableUnits"] ?? "?")} unit(s) are killable.`
      );
    case "start-cheapest-unit":
      return (
        `Starts the cheapest killable unit (${tgt?.region ?? "a region"} of unit ${String(tgt?.unit ?? "?")}, needs ${String(d["unitNeed"] ?? "?")} points); ` +
        `${String(d["remaining"] ?? "?")} Breaker point(s) remain. The point is strictly interior, so the adoption rule cannot absorb it.`
      );
    case "cannot-kill":
      return `No unit can be killed with the ${String(d["remaining"] ?? "?")} remaining Breaker point(s), so no structure is spent and a far legal point is played.`;
    case "user-point":
      return "A point you placed in Break the Proof mode.";
    default:
      return r.summary;
  }
}

function fmtRat(r: Rat): string {
  return r.d === 1n ? String(r.n) : `${String(r.n)}/${String(r.d)}`;
}
export { fmtRat };

export interface RecursionRow {
  readonly level: number;
  readonly strips: string; // t_level
  readonly recurrence: string;
  readonly value: string; // exact
  readonly closed: string | null;
}

// r(l, t_l) for the levels of the chosen run (l = 2..k) plus the next level.
export function recursionTable(
  p: Pick<ExplorerParams, "variant" | "k" | "t" | "s">,
): { rows: RecursionRow[]; next: RecursionRow | null; note: string } {
  const rows: RecursionRow[] = [];
  if (p.variant === "bichromatic") {
    return {
      rows,
      next: null,
      note: "Theorem 5 states no round recurrence here: its counts are the estimator's per-level table (strict parallel count t = ceil(2r/(2 - s))).",
    };
  }
  const s = p.variant === "mono-1:1" ? 1n : Rat.fromString(p.s ?? "1/1").n;
  const mk = (level: number, t: bigint): RecursionRow => {
    const value = p.variant === "mono-1:1" ? monoRounds(level, t) : biasedRounds(level, t, s);
    const closed =
      level >= 2 ? (p.variant === "mono-1:1" ? monoClosedForm(level, t) : biasedClosedForm(level, t, s)) : null;
    let recurrence: string;
    if (level === 1) {
      recurrence = p.variant === "mono-1:1" ? `r(1,${t}) = ${t}/2` : `r(1,${t}) = ${t}/${s + 1n}`;
    } else if (level === 2) {
      recurrence = p.variant === "mono-1:1" ? `r(2,${t}) = ${t}` : `r(2,${t}) = 2·${t}/${s + 1n}`;
    } else {
      recurrence = `r(${level},${t}) = r(${level - 1},${4n * s * t}) + 2·${t}`;
    }
    return {
      level,
      strips: String(t),
      recurrence,
      value: fmtRat(value),
      closed: closed === null ? null : fmtRat(closed),
    };
  };
  const tl = (level: number): bigint => (4n * s) ** BigInt(p.k - level) * BigInt(p.t);
  for (let level = 2; level <= p.k; level += 1) {
    rows.push(mk(level, tl(level)));
  }
  const next = mk(p.k + 1, BigInt(p.t));
  return {
    rows,
    next,
    note:
      p.variant === "mono-1:1"
        ? "Closed form (5/3·4^(k−2) − 2/3)·t. It equals the recurrence exactly (checked for k = 2..14); the paper states 'at most'. Growth: r(k,t)/r(k−1,t) tends to 4."
        : "Closed form ((4s)^(k−2)/(s+1) + ((4s)^(k−2) − 1)/(4s − 1))·2t, equal to the recurrence for k >= 2 (the recurrence itself is not valid at k = 2).",
  };
}

// ---------------------------------------------------------------------------
// Break the proof: a Breaker policy that plays the USER's points in the
// pairing/grouping phase of `level` and asks for the next one by throwing a
// sentinel carrying a captured view (kstrip rethrows unknown exceptions).

export type PreviewClass =
  | { readonly kind: "illegal"; readonly code: string; readonly message: string }
  | { readonly kind: "blocks"; readonly unit: number; readonly region: string; readonly wasLive: boolean }
  | { readonly kind: "absorbed"; readonly unit: number; readonly region: string }
  | { readonly kind: "boundary"; readonly unit: number; readonly region: string; readonly note: string }
  | { readonly kind: "useless" };

export interface PendingBreak {
  readonly phase: PhaseKind;
  readonly level: number;
  readonly levelRound: number;
  readonly breakerMovesLeftInPhase: number;
  readonly breakerMovesTotalInPhase: number;
  classify(p: Pt): PreviewClass;
}

class NeedUserMove extends Error {
  readonly pending: PendingBreak;
  constructor(pending: PendingBreak) {
    super("awaiting a Breaker move");
    this.pending = pending;
  }
}

export function describePreview(c: PreviewClass): string {
  switch (c.kind) {
    case "illegal":
      return `Illegal: ${c.message}`;
    case "blocks":
      return c.wasLive
        ? `Blocks the interior of candidate ${c.region} (unit ${c.unit}): that candidate can no longer be harvested.`
        : `Lands inside ${c.region} (unit ${c.unit}), which is already blocked: no further effect on the count.`;
    case "absorbed":
      return `On the boundary of ${c.region} (unit ${c.unit}): absorbed by the adoption rule — it replaces a vertex and the region only shrinks.`;
    case "boundary":
      return `On the boundary of ${c.region} (unit ${c.unit}): ${c.note}`;
    case "useless":
      return "Useless: outside every candidate region, so it removes nothing from the count.";
  }
}

export function placementText(category: string, unit: number | null, region: string | null): string {
  switch (category) {
    case "interior":
      return `blocks the interior of ${region ?? "a candidate"} (unit ${String(unit)})`;
    case "absorbed":
      return `absorbed by adoption (unit ${String(unit)})`;
    case "boundary-unabsorbed":
      return `on the boundary of ${region ?? "a candidate"} (unit ${String(unit)}), not absorbed`;
    default:
      return "useless (outside every candidate region)";
  }
}

function captureView(view: BreakerView): PendingBreak {
  const ledger = view.ledger();
  const frame = view.frame;
  const mono = view.phase === "pairing";
  const grouping = view.phase === "grouping";
  return {
    phase: view.phase,
    level: view.level,
    levelRound: view.levelRound,
    breakerMovesLeftInPhase: view.breakerMovesLeftInPhase,
    breakerMovesTotalInPhase: view.breakerMovesTotalInPhase,
    classify(pBase: Pt): PreviewClass {
      const pf = toFrame(frame, pBase);
      const lg = view.legal(pf);
      if (!lg.ok) {
        return { kind: "illegal", code: lg.code, message: lg.message };
      }
      if (ledger !== null) {
        let boundaryHit: PreviewClass | null = null;
        let deadHit: PreviewClass | null = null;
        for (const u of ledger.units) {
          for (const r of u.regions) {
            const c = r.region.classify(pf);
            if (c === "interior") {
              if (r.live) {
                return { kind: "blocks", unit: u.unit, region: r.id, wasLive: true };
              }
              deadHit ??= { kind: "blocks", unit: u.unit, region: r.id, wasLive: false };
            } else if (c === "boundary" && boundaryHit === null) {
              boundaryHit = mono
                ? { kind: "absorbed", unit: u.unit, region: r.id }
                : {
                    kind: "boundary",
                    unit: u.unit,
                    region: r.id,
                    note: grouping
                      ? "a boundary point blocks the region (Theorem 4 has no adoption rule)."
                      : "Breaker points are never adopted in the bichromatic variant; the tilt resolves boundary points.",
                  };
            }
          }
        }
        if (boundaryHit !== null) {
          return boundaryHit;
        }
        if (deadHit !== null) {
          return deadHit;
        }
      }
      return { kind: "useless" };
    },
  };
}

export interface BreakScript {
  readonly level: number;
  readonly points: readonly Pt[];
}

function isStructured(phase: PhaseKind): boolean {
  return phase === "pairing" || phase === "grouping" || phase === "bichromatic-pairing";
}

export function createBreakPolicy(
  fallback: BreakerPolicy,
  script: BreakScript,
  onNeed?: (p: PendingBreak) => void,
): BreakerPolicy {
  let used = 0;
  return {
    name: "user",
    choose(view: BreakerView): BreakerDecision {
      if (view.level !== script.level || !isStructured(view.phase)) {
        return fallback.choose(view);
      }
      const next = script.points[used];
      if (next !== undefined) {
        used += 1;
        return {
          point: toFrame(view.frame, next),
          reason: {
            policy: "user",
            code: "user-point",
            summary: "placed by you",
            target: null,
            data: { index: used },
          },
        };
      }
      const pending = captureView(view);
      onNeed?.(pending);
      throw new NeedUserMove(pending);
    },
  };
}

// The pairing/grouping phase of the top level is the one the user attacks.
export function breakTargetLevel(k: number, variant: Variant): number {
  return variant === "mono-1:1" || variant === "mono-1:s" ? (k >= 3 ? k : 0) : k >= 2 ? k : 0;
}

export function breakable(p: Pick<ExplorerParams, "variant" | "k" | "t" | "s">): { ok: boolean; reason: string } {
  const a = availability(p);
  if (a.kind !== "runnable") {
    return { ok: false, reason: "Break the Proof needs a verified, runnable configuration." };
  }
  const lv = breakTargetLevel(p.k, p.variant);
  if (lv === 0) {
    return { ok: false, reason: "There is no pairing phase at this k (k >= 3 for monochromatic, k >= 2 for bichromatic)." };
  }
  const top = a.estimate.levels.find((l) => l.level === lv);
  if (top === undefined || top.breakerMoves === 0n) {
    return { ok: false, reason: "Breaker has no moves in the pairing phase at this bias (s = 0)." };
  }
  if (a.estimate.points > 120n) {
    return {
      ok: false,
      reason: `Break the Proof re-executes the run after every point; it is limited to runs of at most 120 points (this one has ${a.estimate.points}).`,
    };
  }
  return { ok: true, reason: "" };
}

export interface BreakOutcome {
  readonly run: ExplorerRun;
  readonly pending: PendingBreak | null;
}

// Re-execute the run with the user's points so far. Either the run completes
// (the phase's Breaker budget is spent) or it stops awaiting the next point.
export function runBreak(params: ExplorerParams, script: BreakScript): BreakOutcome {
  let pending: PendingBreak | null = null;
  const policy = createBreakPolicy(makePolicy(params.policy, params.seed), script, (p) => {
    pending = p;
  });
  const run = runExplorer(params, policy);
  return { run, pending: run.status === "awaiting-breaker-move" ? pending : null };
}

