// replay/experiment.ts — the versioned wire schema of EXPERIMENT files: a
// k-strip explorer session or a Parameter Lab simulation, exported so that it
// can be re-executed deterministically (parameters + seed + log -> the
// identical run). Pure and structural: it validates shape, enums and size
// caps only. Re-execution (runKStrip / runSimulation / replayLog) lives in
// ui/experiment-io.ts, because replay/ may not import kstrip/ or lab/.
//
// Format "playing-the-proof/experiment", version 1. Documented in
// docs/EXPERIMENT_REPLAY.md. Core game replays (replay/format.ts, v2/v3) are
// a different, untouched format and are rejected here by `format`.
//
// Caps (same spirit as replay/format.ts): 2 MB of text, rationals canonical
// "n/d" with |n|, d <= 10^100, at most EXPERIMENT_MAX_MOVES logged moves.
import { Rat } from "../geometry/rat.ts";
import { RAT_MAX_DIGITS } from "./format.ts";

export const EXPERIMENT_FORMAT = "playing-the-proof/experiment";
export const EXPERIMENT_VERSION = 1;
export const EXPERIMENT_MAX_CHARS = 2 * 1024 * 1024;
export const EXPERIMENT_MAX_MOVES = 1000;
export const EXPERIMENT_MAX_SCRIPT = 200;
export const EXPERIMENT_MAX_TRANSCRIPT = 200;

export type ExperimentIssueCode =
  | "too-large"
  | "bad-json"
  | "not-an-object"
  | "bad-format"
  | "bad-version"
  | "missing-field"
  | "unknown-field"
  | "wrong-type"
  | "bad-value"
  | "bad-rational"
  | "too-many";

export interface ExperimentIssue {
  readonly path: string;
  readonly code: ExperimentIssueCode;
  readonly message: string;
}

export type KStripVariantWire = "mono-1:1" | "mono-1:s" | "bichromatic";
export type KStripPolicyWire = "random-legal" | "greedy-blocking" | "strategy-aware";
export type PhaseWire = "base" | "pairing" | "grouping" | "bichromatic-base" | "bichromatic-pairing";
export type MoveKindWire = "base-point" | "apex" | "breaker";

export interface ExperimentMove {
  readonly n: number;
  readonly round: number;
  readonly phase: PhaseWire;
  readonly level: number;
  readonly levelRound: number;
  readonly player: "maker" | "breaker";
  readonly kind: MoveKindWire;
  readonly pt: readonly [string, string];
  readonly ptFrame: readonly [string, string];
  readonly frameC: string;
}

export type KStripExpectStatus =
  | "completed"
  | "budget-exhausted"
  | "refused"
  | "unsupported"
  | "invalid-breaker-move"
  | "invariant-failure"
  | "awaiting-breaker-move";

export interface KStripExperiment {
  readonly variant: KStripVariantWire;
  readonly k: number;
  readonly t: number;
  // Canonical rational, or null for mono-1:1.
  readonly s: string | null;
  // Breaker policy for every move that is not scripted.
  readonly policy: KStripPolicyWire;
  readonly seed: number;
  // "Break the proof": the user's Breaker points at the pairing phase of
  // `level` (rationals, base coordinates), in move order. null otherwise.
  readonly script: { readonly level: number; readonly points: readonly (readonly [string, string])[] } | null;
  readonly moves: readonly ExperimentMove[];
  readonly expect: {
    readonly status: KStripExpectStatus;
    readonly rounds: number;
    readonly points: number;
    readonly claims: number;
  };
}

export type LabStatusWire = "THEOREM_BACKED" | "EXPERIMENTAL" | "NOT_COVERED";
export type LabPolicyWire = "random-legal" | "greedy";

export interface LabObservedWire {
  readonly kind: "completed" | "budgetExhausted";
  readonly stoppedBy: string;
  readonly rounds: number;
  readonly makerPoints: number;
  readonly breakerPoints: number;
  readonly holeFound: boolean;
  readonly witness: readonly string[] | null;
  readonly holeRound: number | null;
  readonly opsUsed: number;
  readonly transcript: readonly string[];
}

export interface LabExperiment {
  readonly config: {
    readonly model: "online" | "one-round";
    readonly k: number;
    readonly bias: string;
    readonly rule: "monochromatic" | "bichromatic";
    readonly encodingId: string | null;
    readonly structures: number;
  };
  // Recorded for comparison only: re-derived by classify() on import.
  readonly status: LabStatusWire;
  readonly simulation: {
    readonly seed: number;
    readonly makerPolicy: LabPolicyWire;
    readonly breakerPolicy: LabPolicyWire;
    readonly maxRounds: number;
    readonly opsBudget: number;
    readonly observed: LabObservedWire;
  } | null;
}

export interface ExperimentMeta {
  readonly createdAt: string;
  readonly app: string;
  readonly appVersion: string;
  readonly label?: string;
}

export type ExperimentFile =
  | {
      readonly format: typeof EXPERIMENT_FORMAT;
      readonly version: 1;
      readonly kind: "kstrip";
      readonly meta: ExperimentMeta;
      readonly kstrip: KStripExperiment;
    }
  | {
      readonly format: typeof EXPERIMENT_FORMAT;
      readonly version: 1;
      readonly kind: "lab";
      readonly meta: ExperimentMeta;
      readonly lab: LabExperiment;
    };

export type ParseExperimentResult =
  | { readonly ok: true; readonly file: ExperimentFile }
  | { readonly ok: false; readonly issues: readonly ExperimentIssue[] };

// ---------------------------------------------------------------------------

interface Ctx {
  readonly issues: ExperimentIssue[];
}

function bad(ctx: Ctx, path: string, code: ExperimentIssueCode, message: string): void {
  ctx.issues.push({ path, code, message });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function exactKeys(ctx: Ctx, o: Record<string, unknown>, path: string, keys: readonly string[]): void {
  for (const k of keys) {
    if (!(k in o)) {
      bad(ctx, path === "" ? k : `${path}.${k}`, "missing-field", `missing required field '${k}'`);
    }
  }
  for (const k of Object.keys(o)) {
    if (!keys.includes(k)) {
      bad(ctx, path === "" ? k : `${path}.${k}`, "unknown-field", `unknown field '${k}'`);
    }
  }
}

function int(ctx: Ctx, v: unknown, path: string, lo: number, hi: number): number | null {
  if (typeof v !== "number" || !Number.isInteger(v)) {
    bad(ctx, path, "wrong-type", "expected an integer");
    return null;
  }
  if (v < lo || v > hi) {
    bad(ctx, path, "bad-value", `expected an integer in [${lo}, ${hi}]`);
    return null;
  }
  return v;
}

function str(ctx: Ctx, v: unknown, path: string, maxLen = 200): string | null {
  if (typeof v !== "string") {
    bad(ctx, path, "wrong-type", "expected a string");
    return null;
  }
  if (v.length > maxLen) {
    bad(ctx, path, "bad-value", `string longer than ${maxLen}`);
    return null;
  }
  return v;
}

function oneOf<T extends string>(ctx: Ctx, v: unknown, path: string, allowed: readonly T[]): T | null {
  if (typeof v !== "string") {
    bad(ctx, path, "wrong-type", "expected a string");
    return null;
  }
  if (!(allowed as readonly string[]).includes(v)) {
    bad(ctx, path, "bad-value", `expected one of ${allowed.join(", ")}`);
    return null;
  }
  return v as T;
}

// Canonical "n/d", magnitudes <= 10^100 (checked on the string first).
function rat(ctx: Ctx, v: unknown, path: string): string | null {
  if (typeof v !== "string") {
    bad(ctx, path, "wrong-type", "rational must be a string");
    return null;
  }
  if (v.length > 2 * RAT_MAX_DIGITS + 4) {
    bad(ctx, path, "bad-rational", `rational exceeds the 10^${RAT_MAX_DIGITS} size cap`);
    return null;
  }
  let r: Rat;
  try {
    r = Rat.fromString(v);
  } catch {
    bad(ctx, path, "bad-rational", `unparseable rational '${v}'`);
    return null;
  }
  const LIM = 10n ** BigInt(RAT_MAX_DIGITS);
  if (r.n > LIM || r.n < -LIM || r.d > LIM) {
    bad(ctx, path, "bad-rational", `rational exceeds the 10^${RAT_MAX_DIGITS} size cap`);
    return null;
  }
  if (r.toString() !== v) {
    bad(ctx, path, "bad-rational", `non-canonical rational '${v}' (expected '${r.toString()}')`);
    return null;
  }
  return v;
}

function ratPair(ctx: Ctx, v: unknown, path: string): [string, string] | null {
  if (!Array.isArray(v) || v.length !== 2) {
    bad(ctx, path, "wrong-type", "expected a [x, y] pair of rationals");
    return null;
  }
  const x = rat(ctx, v[0], `${path}[0]`);
  const y = rat(ctx, v[1], `${path}[1]`);
  return x === null || y === null ? null : [x, y];
}

const PHASES: readonly PhaseWire[] = ["base", "pairing", "grouping", "bichromatic-base", "bichromatic-pairing"];
const KINDS: readonly MoveKindWire[] = ["base-point", "apex", "breaker"];
const VARIANTS: readonly KStripVariantWire[] = ["mono-1:1", "mono-1:s", "bichromatic"];
const POLICIES: readonly KStripPolicyWire[] = ["random-legal", "greedy-blocking", "strategy-aware"];
const STATUSES: readonly KStripExpectStatus[] = [
  "completed",
  "budget-exhausted",
  "refused",
  "unsupported",
  "invalid-breaker-move",
  "invariant-failure",
  "awaiting-breaker-move",
];

function parseMove(ctx: Ctx, v: unknown, path: string): ExperimentMove | null {
  if (!isRecord(v)) {
    bad(ctx, path, "wrong-type", "move must be an object");
    return null;
  }
  const before = ctx.issues.length;
  exactKeys(ctx, v, path, ["n", "round", "phase", "level", "levelRound", "player", "kind", "pt", "ptFrame", "frameC"]);
  const n = int(ctx, v["n"], `${path}.n`, 1, EXPERIMENT_MAX_MOVES);
  const round = int(ctx, v["round"], `${path}.round`, 1, EXPERIMENT_MAX_MOVES);
  const phase = oneOf(ctx, v["phase"], `${path}.phase`, PHASES);
  const level = int(ctx, v["level"], `${path}.level`, 1, 12);
  const levelRound = int(ctx, v["levelRound"], `${path}.levelRound`, 1, EXPERIMENT_MAX_MOVES);
  const player = oneOf(ctx, v["player"], `${path}.player`, ["maker", "breaker"] as const);
  const kind = oneOf(ctx, v["kind"], `${path}.kind`, KINDS);
  const pt = ratPair(ctx, v["pt"], `${path}.pt`);
  const ptFrame = ratPair(ctx, v["ptFrame"], `${path}.ptFrame`);
  const frameC = rat(ctx, v["frameC"], `${path}.frameC`);
  if (
    ctx.issues.length > before ||
    n === null || round === null || phase === null || level === null || levelRound === null ||
    player === null || kind === null || pt === null || ptFrame === null || frameC === null
  ) {
    return null;
  }
  return { n, round, phase, level, levelRound, player, kind, pt, ptFrame, frameC };
}

function parseKStrip(ctx: Ctx, v: unknown, path: string): KStripExperiment | null {
  if (!isRecord(v)) {
    bad(ctx, path, "wrong-type", "kstrip must be an object");
    return null;
  }
  const before = ctx.issues.length;
  exactKeys(ctx, v, path, ["variant", "k", "t", "s", "policy", "seed", "script", "moves", "expect"]);
  const variant = oneOf(ctx, v["variant"], `${path}.variant`, VARIANTS);
  const k = int(ctx, v["k"], `${path}.k`, 1, 12);
  const t = int(ctx, v["t"], `${path}.t`, 1, 100000);
  let s: string | null = null;
  if (v["s"] !== null) {
    s = rat(ctx, v["s"], `${path}.s`);
  }
  if (variant === "mono-1:1" && v["s"] !== null) {
    bad(ctx, `${path}.s`, "bad-value", "mono-1:1 has no bias parameter (expected null)");
  }
  if (variant !== null && variant !== "mono-1:1" && v["s"] === null) {
    bad(ctx, `${path}.s`, "missing-field", `${variant} needs the bias s`);
  }
  const policy = oneOf(ctx, v["policy"], `${path}.policy`, POLICIES);
  const seed = int(ctx, v["seed"], `${path}.seed`, 0, 0xffffffff);
  let script: KStripExperiment["script"] = null;
  if (v["script"] !== null) {
    const sc = v["script"];
    if (!isRecord(sc)) {
      bad(ctx, `${path}.script`, "wrong-type", "script must be an object or null");
    } else {
      exactKeys(ctx, sc, `${path}.script`, ["level", "points"]);
      const level = int(ctx, sc["level"], `${path}.script.level`, 1, 12);
      const pts: [string, string][] = [];
      const raw = sc["points"];
      if (!Array.isArray(raw)) {
        bad(ctx, `${path}.script.points`, "wrong-type", "points must be an array");
      } else if (raw.length > EXPERIMENT_MAX_SCRIPT) {
        bad(ctx, `${path}.script.points`, "too-many", `more than ${EXPERIMENT_MAX_SCRIPT} scripted points`);
      } else {
        raw.forEach((p, i) => {
          const q = ratPair(ctx, p, `${path}.script.points[${i}]`);
          if (q !== null) {
            pts.push(q);
          }
        });
        if (level !== null && pts.length === raw.length) {
          script = { level, points: pts };
        }
      }
    }
  }
  const moves: ExperimentMove[] = [];
  const rawMoves = v["moves"];
  if (!Array.isArray(rawMoves)) {
    bad(ctx, `${path}.moves`, "wrong-type", "moves must be an array");
  } else if (rawMoves.length > EXPERIMENT_MAX_MOVES) {
    bad(ctx, `${path}.moves`, "too-many", `more than ${EXPERIMENT_MAX_MOVES} moves`);
  } else {
    rawMoves.forEach((m, i) => {
      const mv = parseMove(ctx, m, `${path}.moves[${i}]`);
      if (mv !== null) {
        moves.push(mv);
      }
    });
  }
  let expect: KStripExperiment["expect"] | null = null;
  const ex = v["expect"];
  if (!isRecord(ex)) {
    bad(ctx, `${path}.expect`, "wrong-type", "expect must be an object");
  } else {
    exactKeys(ctx, ex, `${path}.expect`, ["status", "rounds", "points", "claims"]);
    const status = oneOf(ctx, ex["status"], `${path}.expect.status`, STATUSES);
    const rounds = int(ctx, ex["rounds"], `${path}.expect.rounds`, 0, EXPERIMENT_MAX_MOVES);
    const points = int(ctx, ex["points"], `${path}.expect.points`, 0, EXPERIMENT_MAX_MOVES);
    const claims = int(ctx, ex["claims"], `${path}.expect.claims`, 0, 100000);
    if (status !== null && rounds !== null && points !== null && claims !== null) {
      expect = { status, rounds, points, claims };
    }
  }
  if (
    ctx.issues.length > before ||
    variant === null || k === null || t === null || policy === null || seed === null || expect === null
  ) {
    return null;
  }
  return { variant, k, t, s, policy, seed, script, moves, expect };
}

const LAB_STATUSES: readonly LabStatusWire[] = ["THEOREM_BACKED", "EXPERIMENTAL", "NOT_COVERED"];
const LAB_POLICIES: readonly LabPolicyWire[] = ["random-legal", "greedy"];

function parseLab(ctx: Ctx, v: unknown, path: string): LabExperiment | null {
  if (!isRecord(v)) {
    bad(ctx, path, "wrong-type", "lab must be an object");
    return null;
  }
  const before = ctx.issues.length;
  exactKeys(ctx, v, path, ["config", "status", "simulation"]);
  let config: LabExperiment["config"] | null = null;
  const c = v["config"];
  if (!isRecord(c)) {
    bad(ctx, `${path}.config`, "wrong-type", "config must be an object");
  } else {
    exactKeys(ctx, c, `${path}.config`, ["model", "k", "bias", "rule", "encodingId", "structures"]);
    const model = oneOf(ctx, c["model"], `${path}.config.model`, ["online", "one-round"] as const);
    const k = int(ctx, c["k"], `${path}.config.k`, 1, 1000);
    const bias = rat(ctx, c["bias"], `${path}.config.bias`);
    const rule = oneOf(ctx, c["rule"], `${path}.config.rule`, ["monochromatic", "bichromatic"] as const);
    const encodingId = c["encodingId"] === null ? null : str(ctx, c["encodingId"], `${path}.config.encodingId`, 64);
    const structures = int(ctx, c["structures"], `${path}.config.structures`, 1, 1000000);
    if (bias !== null && Rat.fromString(bias).isNeg()) {
      bad(ctx, `${path}.config.bias`, "bad-value", "bias must be >= 0");
    }
    if (model !== null && k !== null && bias !== null && rule !== null && structures !== null &&
        (c["encodingId"] === null || encodingId !== null)) {
      config = { model, k, bias, rule, encodingId, structures };
    }
  }
  const status = oneOf(ctx, v["status"], `${path}.status`, LAB_STATUSES);
  let simulation: LabExperiment["simulation"] = null;
  if (v["simulation"] !== null) {
    const sm = v["simulation"];
    if (!isRecord(sm)) {
      bad(ctx, `${path}.simulation`, "wrong-type", "simulation must be an object or null");
    } else {
      const sp = `${path}.simulation`;
      exactKeys(ctx, sm, sp, ["seed", "makerPolicy", "breakerPolicy", "maxRounds", "opsBudget", "observed"]);
      const seed = int(ctx, sm["seed"], `${sp}.seed`, 0, 0xffffffff);
      const makerPolicy = oneOf(ctx, sm["makerPolicy"], `${sp}.makerPolicy`, LAB_POLICIES);
      const breakerPolicy = oneOf(ctx, sm["breakerPolicy"], `${sp}.breakerPolicy`, LAB_POLICIES);
      const maxRounds = int(ctx, sm["maxRounds"], `${sp}.maxRounds`, 1, 64);
      const opsBudget = int(ctx, sm["opsBudget"], `${sp}.opsBudget`, 1, 1_000_000_000);
      let observed: LabObservedWire | null = null;
      const ob = sm["observed"];
      if (!isRecord(ob)) {
        bad(ctx, `${sp}.observed`, "wrong-type", "observed must be an object");
      } else {
        const op = `${sp}.observed`;
        exactKeys(ctx, ob, op, [
          "kind", "stoppedBy", "rounds", "makerPoints", "breakerPoints",
          "holeFound", "witness", "holeRound", "opsUsed", "transcript",
        ]);
        const kind = oneOf(ctx, ob["kind"], `${op}.kind`, ["completed", "budgetExhausted"] as const);
        const stoppedBy = str(ctx, ob["stoppedBy"], `${op}.stoppedBy`, 40);
        const rounds = int(ctx, ob["rounds"], `${op}.rounds`, 0, 64);
        const makerPoints = int(ctx, ob["makerPoints"], `${op}.makerPoints`, 0, 64);
        const breakerPoints = int(ctx, ob["breakerPoints"], `${op}.breakerPoints`, 0, 64);
        const opsUsed = int(ctx, ob["opsUsed"], `${op}.opsUsed`, 0, Number.MAX_SAFE_INTEGER);
        if (typeof ob["holeFound"] !== "boolean") {
          bad(ctx, `${op}.holeFound`, "wrong-type", "expected a boolean");
        }
        let witness: string[] | null = null;
        if (ob["witness"] !== null) {
          const w = ob["witness"];
          if (!Array.isArray(w) || w.length > 12 || !w.every((x) => typeof x === "string" && x.length <= 12)) {
            bad(ctx, `${op}.witness`, "wrong-type", "witness must be null or an array of point ids");
          } else {
            witness = w as string[];
          }
        }
        let holeRound: number | null = null;
        if (ob["holeRound"] !== null) {
          holeRound = int(ctx, ob["holeRound"], `${op}.holeRound`, 0, 64);
        }
        let transcript: string[] | null = null;
        const tr = ob["transcript"];
        if (!Array.isArray(tr)) {
          bad(ctx, `${op}.transcript`, "wrong-type", "transcript must be an array");
        } else if (tr.length > EXPERIMENT_MAX_TRANSCRIPT) {
          bad(ctx, `${op}.transcript`, "too-many", `more than ${EXPERIMENT_MAX_TRANSCRIPT} transcript lines`);
        } else if (!tr.every((x) => typeof x === "string" && x.length <= 2 * RAT_MAX_DIGITS + 20)) {
          bad(ctx, `${op}.transcript`, "wrong-type", "transcript lines must be short strings");
        } else {
          transcript = tr as string[];
        }
        if (
          kind !== null && stoppedBy !== null && rounds !== null && makerPoints !== null &&
          breakerPoints !== null && opsUsed !== null && typeof ob["holeFound"] === "boolean" &&
          transcript !== null && (ob["holeRound"] === null || holeRound !== null) &&
          (ob["witness"] === null || witness !== null)
        ) {
          observed = {
            kind, stoppedBy, rounds, makerPoints, breakerPoints,
            holeFound: ob["holeFound"], witness, holeRound, opsUsed, transcript,
          };
        }
      }
      if (
        seed !== null && makerPolicy !== null && breakerPolicy !== null &&
        maxRounds !== null && opsBudget !== null && observed !== null
      ) {
        simulation = { seed, makerPolicy, breakerPolicy, maxRounds, opsBudget, observed };
      }
    }
  }
  if (ctx.issues.length > before || config === null || status === null) {
    return null;
  }
  return { config, status, simulation };
}

// The single place a future version bump is handled. Version 1 is current.
export function migrateExperiment(raw: unknown): { ok: true; value: unknown } | { ok: false; issues: ExperimentIssue[] } {
  if (!isRecord(raw)) {
    return { ok: false, issues: [{ path: "", code: "not-an-object", message: "experiment file must be a JSON object" }] };
  }
  if (raw["format"] !== EXPERIMENT_FORMAT) {
    return {
      ok: false,
      issues: [{ path: "format", code: "bad-format", message: `not an experiment file (format must be '${EXPERIMENT_FORMAT}')` }],
    };
  }
  if (raw["version"] === EXPERIMENT_VERSION) {
    return { ok: true, value: raw };
  }
  const v = raw["version"];
  return {
    ok: false,
    issues: [
      {
        path: "version",
        code: "bad-version",
        message:
          typeof v === "number" && v > EXPERIMENT_VERSION
            ? `version ${v} is newer than this build understands (${EXPERIMENT_VERSION})`
            : `unsupported experiment version ${String(v)} (this build reads ${EXPERIMENT_VERSION})`,
      },
    ],
  };
}

export function parseExperiment(text: string): ParseExperimentResult {
  if (text.length > EXPERIMENT_MAX_CHARS || new TextEncoder().encode(text).length > EXPERIMENT_MAX_CHARS) {
    return { ok: false, issues: [{ path: "", code: "too-large", message: "experiment file exceeds the 2 MB cap" }] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, issues: [{ path: "", code: "bad-json", message: "not valid JSON" }] };
  }
  const mig = migrateExperiment(raw);
  if (!mig.ok) {
    return mig;
  }
  const o = mig.value as Record<string, unknown>;
  const ctx: Ctx = { issues: [] };
  const kind = oneOf(ctx, o["kind"], "kind", ["kstrip", "lab"] as const);
  const metaRaw = o["meta"];
  let meta: ExperimentMeta | null = null;
  if (!isRecord(metaRaw)) {
    bad(ctx, "meta", "wrong-type", "meta must be an object");
  } else {
    // meta may carry extra keys (forward compatibility); only these are read.
    const createdAt = str(ctx, metaRaw["createdAt"], "meta.createdAt", 40);
    const app = str(ctx, metaRaw["app"], "meta.app", 80);
    const appVersion = str(ctx, metaRaw["appVersion"], "meta.appVersion", 40);
    const label = "label" in metaRaw ? str(ctx, metaRaw["label"], "meta.label", 200) : undefined;
    if (createdAt !== null && app !== null && appVersion !== null && label !== null) {
      meta = { createdAt, app, appVersion, ...(label !== undefined ? { label } : {}) };
    }
  }
  if (kind === "kstrip") {
    exactKeys(ctx, o, "", ["format", "version", "kind", "meta", "kstrip"]);
    const ks = parseKStrip(ctx, o["kstrip"], "kstrip");
    if (ctx.issues.length === 0 && ks !== null && meta !== null) {
      return { ok: true, file: { format: EXPERIMENT_FORMAT, version: 1, kind: "kstrip", meta, kstrip: ks } };
    }
  } else if (kind === "lab") {
    exactKeys(ctx, o, "", ["format", "version", "kind", "meta", "lab"]);
    const lab = parseLab(ctx, o["lab"], "lab");
    if (ctx.issues.length === 0 && lab !== null && meta !== null) {
      return { ok: true, file: { format: EXPERIMENT_FORMAT, version: 1, kind: "lab", meta, lab } };
    }
  }
  return { ok: false, issues: ctx.issues };
}

export function serializeExperiment(file: ExperimentFile): string {
  return `${JSON.stringify(file, null, 1)}\n`;
}
