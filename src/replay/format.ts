// replay/format.ts — the v2 wire codec (§15.2): wire JSON interfaces,
// runtime ReplayFile, parseReplayFile (invariants 1–4), serializeReplay.
// Pure: no DOM, no file/blob, no clipboard, no local storage, no network.
// Strategy-shape needs (MoveSpec codec) arrive via engine/replay.ts —
// replay/ may not import strategy/ (§18.1).
import { Rat } from "../geometry/rat.ts";
import type { Pt } from "../geometry/pt.ts";
import type {
  CheckResult,
  GameMode,
  IntegrityReport,
  MoveEvent,
  Player,
  StrategyStart,
  Terminal,
  UncoveredReport,
  UserAction,
} from "../game/types.ts";
import type { HoleAnalysis, KHole } from "../geometry/holes.ts";
import { moveSpecFromJSON, moveSpecToJSON } from "../engine/replay.ts";
import type { MoveSpecJSON } from "../engine/replay.ts";

// ---- wire JSON interfaces (§15.2, normative) ----

export type PtJSON = { x: string; y: string };
export type PlayerJSON = "maker" | "breaker";

export type StrategyStartJSON =
  | {
      kind: "continue";
      points: readonly PtJSON[];
      owners: readonly PlayerJSON[];
      selectedHole: readonly PtJSON[] | null;
    }
  | {
      kind: "supplied";
      points: readonly PtJSON[];
      selectedHole: readonly PtJSON[];
      owners?: readonly PlayerJSON[];
    }
  | { kind: "fixture"; scenarioRef: string };

export interface KHoleJSON {
  verts: readonly string[];
}

export interface HoleAnalysisJSON {
  kind: "exhaustive" | "witness-only" | "budget-exhausted";
  k: number;
  holes?: readonly KHoleJSON[];
  witness?: KHoleJSON;
  stoppedBy?: "found";
  searched?: number;
}

export interface CheckResultJSON {
  id: string;
  kind: "geometry" | "invariant" | "strategy" | "replay";
  passed: boolean;
  detail: string;
  analysis?: HoleAnalysisJSON;
}

export interface IntegrityReportJSON {
  failedAt: string;
  phase: "pre" | "post" | "route" | "construction";
  failed: CheckResultJSON;
  stateHash: string;
}

export type UncoveredReportJSON =
  | {
      origin: "breaker-reply";
      reason: "partial-encoding" | "experimental-disabled";
      at: { nodeId: string; breakerPoint: string };
      detail: string;
    }
  | {
      origin: "maker-construction";
      reason: "window-exhausted";
      at: { nodeId: string; move: MoveSpecJSON };
      detail: string;
    };

export type TerminalJSON =
  | {
      kind: "maker-won";
      k: number;
      witness: readonly KHoleJSON[];
      nodeId: string;
    }
  | { kind: "strategy-integrity-failure"; report: IntegrityReportJSON }
  | { kind: "uncovered"; report: UncoveredReportJSON };

export interface ReplayEventJSON {
  i: number;
  txnId: number;
  indexInTxn: number;
  parent: number | null;
  owner: PlayerJSON;
  at: PtJSON;
  appliedPoint: string;
  caseId?: string;
  nodeAfter: string | null;
  stateHash: string;
}

export type ReplayActionJSON =
  | { kind: "init" }
  | { kind: "place"; owner: PlayerJSON; at: PtJSON }
  | { kind: "sample"; caseId: string; at: PtJSON };

export interface ReplayTxnJSON {
  txnId: number;
  parentTxnId: number | null;
  action: ReplayActionJSON;
  events: readonly ReplayEventJSON[];
  beforeHash: string | null;
  afterHash: string;
  result: { kind: "committed" } | { kind: "terminal"; terminal: TerminalJSON };
}

// Format versions. v2 is the original (monochromatic-only) format and is
// still what every monochromatic session is written as — byte-identical to
// before the game-mode flag. v3 adds `config.gameMode` (REQUIRED in v3,
// FORBIDDEN in v2); the bichromatic game is only expressible in v3, so an
// older reader rejects such a file (bad-version) instead of silently
// replaying it under the monochromatic rule. v2 → v3 migration is implicit
// and lossless: a v2 file is a v3 file with gameMode "monochromatic".
export type ReplayVersion = 2 | 3;

export interface ReplayFileJSON {
  format: "esmb-replay";
  version: ReplayVersion;
  meta: { createdAt: string; app: string; appVersion: string; label?: string };
  config: {
    k: number;
    mode: "proof" | "break" | "sandbox";
    gameMode?: GameMode;
    window: { xMin: string; xMax: string; yMin: string; yMax: string };
  };
  strategy: { id: string; version: string } | null;
  strategyStart: StrategyStartJSON | null;
  transactions: readonly ReplayTxnJSON[];
  cursorTxnId?: number;
  engineVersion: string;
  strategyVersion: string;
}

// ---- runtime form (Pt/Terminal/StrategyStart hydrated) ----

export interface ReplayTxn {
  txnId: number;
  parentTxnId: number | null;
  action: UserAction | { kind: "init" };
  events: readonly MoveEvent[];
  beforeHash: string | null;
  afterHash: string;
  result: { kind: "committed" } | { kind: "terminal"; terminal: Terminal };
}

export interface ReplayFile {
  format: "esmb-replay";
  version: ReplayVersion;
  meta: { createdAt: string; app: string; appVersion: string; label?: string };
  config: {
    k: 3 | 4 | 5 | 6 | 7 | 8;
    mode: "proof" | "break" | "sandbox";
    // Present iff version === 3.
    gameMode?: GameMode;
    window: { xMin: Rat; yMin: Rat; xMax: Rat; yMax: Rat };
  };
  strategy: { id: string; version: string } | null;
  strategyStart: StrategyStart | null;
  transactions: ReplayTxn[];
  cursorTxnId?: number;
  engineVersion: string;
  strategyVersion: string;
}

// ---- structured validation errors (§30) ----

export type ReplayErrorCode =
  | "not-json"
  | "bad-format"
  | "bad-version"
  | "bad-rational"
  | "missing-field"
  | "wrong-type"
  | "bad-root-shape"
  | "bad-tree-shape"
  | "hash-mismatch"
  | "bad-cardinality"
  | "bad-strategy-coupling"
  | "bootstrap-too-large"
  | "version-mismatch"
  | "semantic-divergence"
  | "too-large";

export interface ValidationIssue {
  path: string;
  code: ReplayErrorCode;
  message: string;
  expected?: string;
  actual?: string;
}

export const N_BOOTSTRAP_MIRROR = 12;

// §30: file size cap 2 MB — enforced at every entry (picker, paste,
// autosave) BEFORE the JSON parse; a character-count proxy for byte size
// (ASCII-only wire format: rationals are "n/d" strings, so chars ≈ bytes).
export const MAX_REPLAY_CHARS = 2 * 1024 * 1024;
export const RAT_MAX_DIGITS = 100; // §30: |numerator|, denominator ≤ 10^100

// UTF-8 byte length (the cap is a BYTE cap; audit, replay audit #12).
export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

// ---- parse (invariants 1–4; invariant 5 needs the registry → validate) ----

interface Ctx {
  issues: ValidationIssue[];
}

function issue(
  ctx: Ctx,
  path: string,
  code: ReplayErrorCode,
  message: string,
  expected?: string,
  actual?: string,
): void {
  ctx.issues.push({
    path,
    code,
    message,
    ...(expected !== undefined ? { expected } : {}),
    ...(actual !== undefined ? { actual } : {}),
  });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function reqField(
  obj: Record<string, unknown>,
  ctx: Ctx,
  path: string,
  field: string,
): boolean {
  if (!(field in obj)) {
    issue(
      ctx,
      path === "" ? field : `${path}.${field}`,
      "missing-field",
      `missing required field '${field}'`,
    );
    return false;
  }
  return true;
}

function asString(v: unknown): v is string {
  return typeof v === "string";
}

function asInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v);
}

// Canonical "n/d" rational (§3.1): parseable with d > 0, gcd = 1 — enforced
// by re-serializing (Rat normalizes; any non-canonical spelling mismatches).
function parseRat(v: unknown, ctx: Ctx, path: string): Rat | null {
  if (!asString(v)) {
    issue(
      ctx,
      path,
      "wrong-type",
      "rational must be a string",
      "string",
      typeof v,
    );
    return null;
  }
  // §30 rational size cap (audit, replay audit #9): numerator and
  // denominator magnitudes ≤ 10^100. Checked on the STRING first so a
  // million-digit field never reaches BigInt parsing/gcd (CPU DoS).
  if (v.length > 2 * RAT_MAX_DIGITS + 4) {
    issue(ctx, path, "bad-rational", `rational exceeds the 10^${RAT_MAX_DIGITS} size cap`);
    return null;
  }
  let r: Rat;
  try {
    r = Rat.fromString(v);
  } catch {
    issue(ctx, path, "bad-rational", `unparseable rational '${v}'`);
    return null;
  }
  const LIM = 10n ** BigInt(RAT_MAX_DIGITS);
  if (r.n > LIM || r.n < -LIM || r.d > LIM) {
    issue(ctx, path, "bad-rational", `rational exceeds the 10^${RAT_MAX_DIGITS} size cap`);
    return null;
  }
  if (r.toString() !== v) {
    issue(
      ctx,
      path,
      "bad-rational",
      `non-canonical rational '${v}'`,
      r.toString(),
      v,
    );
    return null;
  }
  return r;
}

function parsePt(v: unknown, ctx: Ctx, path: string): Pt | null {
  if (!isRecord(v)) {
    issue(
      ctx,
      path,
      "wrong-type",
      "point must be an object",
      "object",
      typeof v,
    );
    return null;
  }
  if (!reqField(v, ctx, path, "x") || !reqField(v, ctx, path, "y")) {
    return null;
  }
  const x = parseRat(v["x"], ctx, `${path}.x`);
  const y = parseRat(v["y"], ctx, `${path}.y`);
  if (x === null || y === null) {
    return null;
  }
  return { x, y };
}

function parsePlayer(v: unknown, ctx: Ctx, path: string): Player | null {
  if (v !== "maker" && v !== "breaker") {
    issue(
      ctx,
      path,
      "wrong-type",
      "player must be 'maker' or 'breaker'",
      "'maker'|'breaker'",
      String(v),
    );
    return null;
  }
  return v;
}

function ptArray(u: unknown, ctx: Ctx, p: string): Pt[] | null {
  if (!Array.isArray(u)) {
    issue(ctx, p, "wrong-type", "point list must be an array");
    return null;
  }
  const out: Pt[] = [];
  for (let i = 0; i < u.length; i += 1) {
    const q = parsePt(u[i], ctx, `${p}[${i}]`);
    if (q === null) {
      return null;
    }
    out.push(q);
  }
  return out;
}

function ownerArray(u: unknown, ctx: Ctx, p: string): Player[] | null {
  if (!Array.isArray(u)) {
    issue(ctx, p, "wrong-type", "owner list must be an array");
    return null;
  }
  const out: Player[] = [];
  for (let i = 0; i < u.length; i += 1) {
    const o = parsePlayer(u[i], ctx, `${p}[${i}]`);
    if (o === null) {
      return null;
    }
    out.push(o);
  }
  return out;
}

function parseStrategyStart(
  v: unknown,
  ctx: Ctx,
  path: string,
): StrategyStart | null | "invalid" {
  if (v === null) {
    return null;
  }
  if (!isRecord(v)) {
    issue(ctx, path, "wrong-type", "strategyStart must be an object or null");
    return "invalid";
  }
  const kind = v["kind"];
  if (kind === "continue") {
    if (
      !reqField(v, ctx, path, "points") ||
      !reqField(v, ctx, path, "owners") ||
      !reqField(v, ctx, path, "selectedHole")
    ) {
      return "invalid";
    }
    const points = ptArray(v["points"], ctx, `${path}.points`);
    const owners = ownerArray(v["owners"], ctx, `${path}.owners`);
    if (points === null || owners === null) {
      return "invalid";
    }
    if (owners.length !== points.length) {
      issue(
        ctx,
        `${path}.owners`,
        "wrong-type",
        "owners/points length mismatch",
      );
      return "invalid";
    }
    if (points.length > N_BOOTSTRAP_MIRROR) {
      issue(
        ctx,
        `${path}.points`,
        "bootstrap-too-large",
        `strategyStart exceeds N_BOOTSTRAP_EXACT = ${N_BOOTSTRAP_MIRROR}`,
        `≤ ${N_BOOTSTRAP_MIRROR} points`,
        `${points.length} points`,
      );
      return "invalid";
    }
    const sh = v["selectedHole"];
    if (sh === null) {
      return { kind: "continue", points, owners, selectedHole: null };
    }
    const sel = ptArray(sh, ctx, `${path}.selectedHole`);
    if (sel === null) {
      return "invalid";
    }
    return { kind: "continue", points, owners, selectedHole: sel };
  }
  if (kind === "supplied") {
    if (
      !reqField(v, ctx, path, "points") ||
      !reqField(v, ctx, path, "selectedHole")
    ) {
      return "invalid";
    }
    const points = ptArray(v["points"], ctx, `${path}.points`);
    const sel = ptArray(v["selectedHole"], ctx, `${path}.selectedHole`);
    if (points === null || sel === null) {
      return "invalid";
    }
    if (points.length > N_BOOTSTRAP_MIRROR) {
      issue(
        ctx,
        `${path}.points`,
        "bootstrap-too-large",
        `strategyStart exceeds N_BOOTSTRAP_EXACT = ${N_BOOTSTRAP_MIRROR}`,
        `≤ ${N_BOOTSTRAP_MIRROR} points`,
        `${points.length} points`,
      );
      return "invalid";
    }
    if ("owners" in v && v["owners"] !== undefined) {
      const owners = ownerArray(v["owners"], ctx, `${path}.owners`);
      if (owners === null) {
        return "invalid";
      }
      if (owners.length !== points.length) {
        issue(
          ctx,
          `${path}.owners`,
          "wrong-type",
          "owners/points length mismatch",
        );
        return "invalid";
      }
      return { kind: "supplied", points, selectedHole: sel, owners };
    }
    return { kind: "supplied", points, selectedHole: sel };
  }
  if (kind === "fixture") {
    if (!reqField(v, ctx, path, "scenarioRef")) {
      return "invalid";
    }
    if (!asString(v["scenarioRef"])) {
      issue(
        ctx,
        `${path}.scenarioRef`,
        "wrong-type",
        "scenarioRef must be a string",
      );
      return "invalid";
    }
    return { kind: "fixture", scenarioRef: v["scenarioRef"] };
  }
  issue(
    ctx,
    `${path}.kind`,
    "wrong-type",
    "strategyStart kind must be continue|supplied|fixture",
    "continue|supplied|fixture",
    String(kind),
  );
  return "invalid";
}

function parseHoleList(u: unknown, ctx: Ctx, p: string): KHole[] | null {
  if (!Array.isArray(u)) {
    issue(ctx, p, "wrong-type", "hole list must be an array");
    return null;
  }
  const out: KHole[] = [];
  for (let i = 0; i < u.length; i += 1) {
    const h = u[i];
    if (
      !isRecord(h) ||
      !Array.isArray(h["verts"]) ||
      !(h["verts"] as unknown[]).every(asString)
    ) {
      issue(ctx, `${p}[${i}]`, "wrong-type", "holes must be {verts: string[]}");
      return null;
    }
    out.push({
      k: (h["verts"] as string[]).length,
      verts: [...(h["verts"] as string[])],
    });
  }
  return out;
}

function parseHoleAnalysis(
  v: unknown,
  ctx: Ctx,
  path: string,
): HoleAnalysis | null {
  if (!isRecord(v)) {
    issue(ctx, path, "wrong-type", "analysis must be an object");
    return null;
  }
  const kind = v["kind"];
  if (!asInt(v["k"])) {
    issue(ctx, `${path}.k`, "wrong-type", "analysis k must be an integer");
    return null;
  }
  const k = v["k"] as number;
  if (kind === "exhaustive") {
    if (!("holes" in v)) {
      issue(
        ctx,
        `${path}.holes`,
        "missing-field",
        "exhaustive analysis requires holes[]",
      );
      return null;
    }
    const holes = parseHoleList(v["holes"], ctx, `${path}.holes`);
    return holes === null ? null : { kind: "exhaustive", k, holes };
  }
  if (kind === "witness-only") {
    if (!("witness" in v)) {
      issue(
        ctx,
        `${path}.witness`,
        "missing-field",
        "witness-only analysis requires witness",
      );
      return null;
    }
    const w = v["witness"];
    if (
      !isRecord(w) ||
      !Array.isArray(w["verts"]) ||
      !(w["verts"] as unknown[]).every(asString)
    ) {
      issue(
        ctx,
        `${path}.witness`,
        "wrong-type",
        "witness must be {verts: string[]}",
      );
      return null;
    }
    if (v["stoppedBy"] !== "found") {
      issue(
        ctx,
        `${path}.stoppedBy`,
        "wrong-type",
        "witness-only stoppedBy must be 'found'",
      );
      return null;
    }
    return {
      kind: "witness-only",
      k,
      witness: {
        k: (w["verts"] as string[]).length,
        verts: [...(w["verts"] as string[])],
      },
      stoppedBy: "found",
    };
  }
  if (kind === "budget-exhausted") {
    if (!asInt(v["searched"])) {
      issue(
        ctx,
        `${path}.searched`,
        "wrong-type",
        "budget-exhausted analysis requires integer searched",
      );
      return null;
    }
    return { kind: "budget-exhausted", k, searched: v["searched"] as number };
  }
  issue(
    ctx,
    `${path}.kind`,
    "wrong-type",
    "analysis kind must be exhaustive|witness-only|budget-exhausted",
  );
  return null;
}

function parseCheckResult(
  v: unknown,
  ctx: Ctx,
  path: string,
): CheckResult | null {
  if (!isRecord(v)) {
    issue(ctx, path, "wrong-type", "check result must be an object");
    return null;
  }
  if (
    !asString(v["id"]) ||
    (v["kind"] !== "geometry" &&
      v["kind"] !== "invariant" &&
      v["kind"] !== "strategy" &&
      v["kind"] !== "replay") ||
    typeof v["passed"] !== "boolean" ||
    !asString(v["detail"])
  ) {
    issue(
      ctx,
      path,
      "wrong-type",
      "check result must be {id, kind, passed, detail}",
    );
    return null;
  }
  if ("analysis" in v && v["analysis"] !== undefined) {
    const a = parseHoleAnalysis(v["analysis"], ctx, `${path}.analysis`);
    if (a === null) {
      return null;
    }
    return {
      id: v["id"] as string,
      kind: v["kind"] as CheckResult["kind"],
      passed: v["passed"] as boolean,
      detail: v["detail"] as string,
      analysis: a,
    };
  }
  return {
    id: v["id"] as string,
    kind: v["kind"] as CheckResult["kind"],
    passed: v["passed"] as boolean,
    detail: v["detail"] as string,
  };
}

function parseTerminal(v: unknown, ctx: Ctx, path: string): Terminal | null {
  if (!isRecord(v)) {
    issue(ctx, path, "wrong-type", "terminal must be an object");
    return null;
  }
  const kind = v["kind"];
  if (kind === "maker-won") {
    if (
      !asInt(v["k"]) ||
      !asString(v["nodeId"]) ||
      !Array.isArray(v["witness"])
    ) {
      issue(
        ctx,
        path,
        "wrong-type",
        "maker-won terminal must be {k, witness[], nodeId}",
      );
      return null;
    }
    const holes = parseHoleList(v["witness"], ctx, `${path}.witness`);
    if (holes === null) {
      return null;
    }
    return {
      kind: "maker-won",
      k: v["k"] as number,
      witness: holes,
      nodeId: v["nodeId"] as string,
    };
  }
  if (kind === "strategy-integrity-failure") {
    const r = v["report"];
    if (!isRecord(r)) {
      issue(
        ctx,
        `${path}.report`,
        "wrong-type",
        "integrity report must be an object",
      );
      return null;
    }
    if (!asString(r["failedAt"])) {
      issue(
        ctx,
        `${path}.report.failedAt`,
        "wrong-type",
        "failedAt must be a string",
      );
      return null;
    }
    if (
      r["phase"] !== "pre" &&
      r["phase"] !== "post" &&
      r["phase"] !== "route" &&
      r["phase"] !== "construction"
    ) {
      issue(
        ctx,
        `${path}.report.phase`,
        "wrong-type",
        "phase must be pre|post|route|construction",
      );
      return null;
    }
    const failed = parseCheckResult(r["failed"], ctx, `${path}.report.failed`);
    if (failed === null) {
      return null;
    }
    if (!asString(r["stateHash"])) {
      issue(
        ctx,
        `${path}.report.stateHash`,
        "wrong-type",
        "stateHash must be a string",
      );
      return null;
    }
    return {
      kind: "strategy-integrity-failure",
      report: {
        failedAt: r["failedAt"] as string,
        phase: r["phase"] as IntegrityReport["phase"],
        failed,
        stateHash: r["stateHash"] as string,
      },
    };
  }
  if (kind === "uncovered") {
    const r = v["report"];
    if (!isRecord(r)) {
      issue(
        ctx,
        `${path}.report`,
        "wrong-type",
        "uncovered report must be an object",
      );
      return null;
    }
    const origin = r["origin"];
    if (!asString(r["detail"])) {
      issue(
        ctx,
        `${path}.report.detail`,
        "wrong-type",
        "detail must be a string",
      );
      return null;
    }
    const detail = r["detail"] as string;
    const at = r["at"];
    if (!isRecord(at) || !asString(at["nodeId"])) {
      issue(
        ctx,
        `${path}.report.at`,
        "wrong-type",
        "at must carry a nodeId string",
      );
      return null;
    }
    const nodeId = at["nodeId"] as string;
    if (origin === "breaker-reply") {
      if (
        r["reason"] !== "partial-encoding" &&
        r["reason"] !== "experimental-disabled"
      ) {
        issue(
          ctx,
          `${path}.report.reason`,
          "wrong-type",
          "breaker-reply reason must be partial-encoding|experimental-disabled",
        );
        return null;
      }
      if (!asString(at["breakerPoint"])) {
        issue(
          ctx,
          `${path}.report.at.breakerPoint`,
          "wrong-type",
          "breakerPoint must be a string",
        );
        return null;
      }
      const report: UncoveredReport = {
        origin: "breaker-reply",
        reason: r["reason"] as "partial-encoding" | "experimental-disabled",
        at: { nodeId, breakerPoint: at["breakerPoint"] as string },
        detail,
      };
      return { kind: "uncovered", report };
    }
    if (origin === "maker-construction") {
      if (r["reason"] !== "window-exhausted") {
        issue(
          ctx,
          `${path}.report.reason`,
          "wrong-type",
          "maker-construction reason must be window-exhausted",
        );
        return null;
      }
      // Move payload: kind-shape check here (the fold compares kind only;
      // the full §5.7 walk lives in the strategy codec).
      if (
        !isRecord(at["move"]) ||
        !asString((at["move"] as Record<string, unknown>)["kind"])
      ) {
        issue(
          ctx,
          `${path}.report.at.move`,
          "wrong-type",
          "move must carry a kind string",
        );
        return null;
      }
      let move;
      try {
        move = moveSpecFromJSON(at["move"] as MoveSpecJSON);
      } catch {
        issue(
          ctx,
          `${path}.report.at.move`,
          "wrong-type",
          "move payload is not a well-formed MoveSpec",
        );
        return null;
      }
      const report: UncoveredReport = {
        origin: "maker-construction",
        reason: "window-exhausted",
        at: { nodeId, move },
        detail,
      };
      return { kind: "uncovered", report };
    }
    issue(
      ctx,
      `${path}.report.origin`,
      "wrong-type",
      "origin must be breaker-reply|maker-construction",
    );
    return null;
  }
  issue(
    ctx,
    `${path}.kind`,
    "wrong-type",
    "terminal kind must be maker-won|strategy-integrity-failure|uncovered",
  );
  return null;
}

export function parseReplayFile(
  text: string,
): { ok: true; file: ReplayFile } | { ok: false; issues: ValidationIssue[] } {
  // §30 size cap first — an oversized payload is rejected before any parse
  // work, with the typed issue (never an exception across a module
  // boundary).
  if (text.length > MAX_REPLAY_CHARS || utf8Bytes(text) > MAX_REPLAY_CHARS) {
    return {
      ok: false,
      issues: [
        {
          path: "",
          code: "too-large",
          message: `replay file exceeds the 2 MB cap (${text.length} characters)`,
          expected: `at most ${MAX_REPLAY_CHARS} characters`,
          actual: `${text.length} characters`,
        },
      ],
    };
  }
  const ctx: Ctx = { issues: [] };
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return {
      ok: false,
      issues: [{ path: "", code: "not-json", message: "not valid JSON" }],
    };
  }
  if (!isRecord(doc)) {
    return {
      ok: false,
      issues: [
        {
          path: "",
          code: "bad-root-shape",
          message: "replay root must be an object",
        },
      ],
    };
  }
  // Invariant 1: format/version/meta/config/strategy/strategyStart/transactions/versions.
  if (doc["format"] !== "esmb-replay") {
    issue(
      ctx,
      "format",
      "bad-format",
      "format must be 'esmb-replay'",
      "'esmb-replay'",
      String(doc["format"]),
    );
  }
  const version: ReplayVersion = doc["version"] === 3 ? 3 : 2;
  if (doc["version"] !== 2 && doc["version"] !== 3) {
    issue(
      ctx,
      "version",
      "bad-version",
      "version must be 2 or 3",
      "2 | 3",
      String(doc["version"]),
    );
  }
  let meta: {
    createdAt: string;
    app: string;
    appVersion: string;
    label?: string;
  } = {
    createdAt: "",
    app: "",
    appVersion: "",
  };
  if (!isRecord(doc["meta"])) {
    issue(ctx, "meta", "missing-field", "missing meta object");
  } else {
    let okMeta = true;
    for (const f of ["createdAt", "app", "appVersion"]) {
      if (!asString((doc["meta"] as Record<string, unknown>)[f])) {
        issue(ctx, `meta.${f}`, "missing-field", `meta.${f} must be a string`);
        okMeta = false;
      }
    }
    const label = (doc["meta"] as Record<string, unknown>)["label"];
    if (
      "label" in (doc["meta"] as Record<string, unknown>) &&
      label !== undefined &&
      !asString(label)
    ) {
      issue(ctx, "meta.label", "wrong-type", "meta.label must be a string");
      okMeta = false;
    }
    if (okMeta) {
      meta = {
        createdAt: (doc["meta"] as Record<string, unknown>)[
          "createdAt"
        ] as string,
        app: (doc["meta"] as Record<string, unknown>)["app"] as string,
        appVersion: (doc["meta"] as Record<string, unknown>)[
          "appVersion"
        ] as string,
        ...((label as string | undefined) !== undefined
          ? { label: label as string }
          : {}),
      };
    }
  }
  let k: 3 | 4 | 5 | 6 | 7 | 8 = 5;
  let mode: "proof" | "break" | "sandbox" = "break";
  let gameMode: GameMode | undefined;
  let window: { xMin: Rat; yMin: Rat; xMax: Rat; yMax: Rat } | null = null;
  if (!isRecord(doc["config"])) {
    issue(ctx, "config", "missing-field", "missing config object");
  } else {
    const config = doc["config"] as Record<string, unknown>;
    if (
      !asInt(config["k"]) ||
      (config["k"] as number) < 3 ||
      (config["k"] as number) > 8
    ) {
      issue(
        ctx,
        "config.k",
        "bad-root-shape",
        "config.k must be an integer 3–8",
      );
    } else {
      k = config["k"] as 3 | 4 | 5 | 6 | 7 | 8;
    }
    if (
      config["mode"] !== "proof" &&
      config["mode"] !== "break" &&
      config["mode"] !== "sandbox"
    ) {
      issue(
        ctx,
        "config.mode",
        "wrong-type",
        "config.mode must be proof|break|sandbox",
      );
    } else {
      mode = config["mode"];
    }
    // Game mode (v3 only): required in v3, forbidden in v2 so a v2 file can
    // never smuggle in a non-monochromatic rule.
    if (version === 2) {
      if ("gameMode" in config) {
        issue(
          ctx,
          "config.gameMode",
          "bad-version",
          "config.gameMode is not part of format v2 (use version 3)",
        );
      }
    } else if (
      config["gameMode"] !== "monochromatic" &&
      config["gameMode"] !== "bichromatic"
    ) {
      issue(
        ctx,
        "config.gameMode",
        "wrong-type",
        "config.gameMode must be monochromatic|bichromatic (required in v3)",
      );
    } else {
      gameMode = config["gameMode"];
    }
    if (!isRecord(config["window"])) {
      issue(
        ctx,
        "config.window",
        "missing-field",
        "missing config.window object",
      );
    } else {
      const w = config["window"] as Record<string, unknown>;
      const xMin = parseRat(w["xMin"], ctx, "config.window.xMin");
      const xMax = parseRat(w["xMax"], ctx, "config.window.xMax");
      const yMin = parseRat(w["yMin"], ctx, "config.window.yMin");
      const yMax = parseRat(w["yMax"], ctx, "config.window.yMax");
      if (xMin !== null && xMax !== null && yMin !== null && yMax !== null) {
        window = { xMin, yMin, xMax, yMax };
      }
    }
  }
  let strategy: { id: string; version: string } | null = null;
  if (doc["strategy"] !== null) {
    if (!isRecord(doc["strategy"])) {
      issue(
        ctx,
        "strategy",
        "wrong-type",
        "strategy must be an object or null",
      );
    } else {
      const s = doc["strategy"] as Record<string, unknown>;
      if (!asString(s["id"]) || !asString(s["version"])) {
        issue(
          ctx,
          "strategy",
          "wrong-type",
          "strategy must be {id: string, version: string}",
        );
      } else {
        strategy = { id: s["id"] as string, version: s["version"] as string };
      }
    }
  }
  const strategyStart = parseStrategyStart(
    doc["strategyStart"] ?? null,
    ctx,
    "strategyStart",
  );
  if (
    !Array.isArray(doc["transactions"]) ||
    (doc["transactions"] as unknown[]).length === 0
  ) {
    issue(
      ctx,
      "transactions",
      "bad-root-shape",
      "transactions must be a non-empty array",
    );
    return { ok: false, issues: ctx.issues };
  }
  if (!asString(doc["engineVersion"])) {
    issue(
      ctx,
      "engineVersion",
      "missing-field",
      "engineVersion must be a string",
    );
  }
  if (!asString(doc["strategyVersion"])) {
    issue(
      ctx,
      "strategyVersion",
      "missing-field",
      "strategyVersion must be a string",
    );
  }
  const txns = doc["transactions"] as unknown[];
  const seenIds = new Map<number, number>();
  const lastEventByTxn = new Map<number, number>();
  const afterHashByTxn = new Map<number, string>();
  let prevI = 0;
  let firstEvent = true;
  const parsedTxns: ReplayTxn[] = [];
  let fatal = false;
  txns.forEach((tu, ti) => {
    const base = `transactions[${ti}]`;
    if (!isRecord(tu)) {
      issue(ctx, base, "wrong-type", "transaction must be an object");
      fatal = true;
      return;
    }
    if (!asInt(tu["txnId"]) || (tu["txnId"] as number) < 0) {
      issue(
        ctx,
        `${base}.txnId`,
        "bad-tree-shape",
        "txnId must be a non-negative integer",
      );
      fatal = true;
      return;
    }
    const txnId = tu["txnId"] as number;
    if (seenIds.has(txnId)) {
      issue(ctx, `${base}.txnId`, "bad-tree-shape", `duplicate txnId ${txnId}`);
      fatal = true;
      return;
    }
    const parentRaw = tu["parentTxnId"];
    if (parentRaw !== null && !asInt(parentRaw)) {
      issue(
        ctx,
        `${base}.parentTxnId`,
        "bad-tree-shape",
        "parentTxnId must be an integer or null",
      );
      fatal = true;
      return;
    }
    const parentTxnId = parentRaw as number | null;
    if (ti === 0) {
      if (txnId !== 0) {
        issue(
          ctx,
          `${base}.txnId`,
          "bad-root-shape",
          "first transaction must be txn 0",
          "0",
          String(txnId),
        );
        fatal = true;
        return;
      }
      if (parentTxnId !== null) {
        issue(
          ctx,
          `${base}.parentTxnId`,
          "bad-root-shape",
          "txn 0 parentTxnId must be null",
        );
        fatal = true;
        return;
      }
    } else if (parentTxnId === null) {
      issue(
        ctx,
        `${base}.parentTxnId`,
        "bad-tree-shape",
        "only txn 0 may have a null parent",
      );
      fatal = true;
      return;
    }
    // Invariant 3 (order): the parent must precede in array order.
    if (parentTxnId !== null && !seenIds.has(parentTxnId)) {
      issue(
        ctx,
        `${base}.parentTxnId`,
        "bad-tree-shape",
        `parent txn ${parentTxnId} does not precede txn ${txnId} in array order`,
        `an earlier txnId`,
        String(parentTxnId),
      );
      fatal = true;
      return;
    }
    // Action.
    let action: ReplayTxn["action"] | null = null;
    const a = tu["action"];
    if (!isRecord(a)) {
      issue(ctx, `${base}.action`, "wrong-type", "action must be an object");
      fatal = true;
      return;
    }
    if (ti === 0) {
      if (a["kind"] !== "init") {
        issue(
          ctx,
          `${base}.action`,
          "bad-root-shape",
          "txn 0 action must be {kind:'init'}",
        );
        fatal = true;
        return;
      }
      action = { kind: "init" };
    } else if (a["kind"] === "place") {
      const owner = parsePlayer(a["owner"], ctx, `${base}.action.owner`);
      const at = parsePt(a["at"], ctx, `${base}.action.at`);
      if (owner === null || at === null) {
        fatal = true;
        return;
      }
      action = { kind: "place", owner, at };
    } else if (a["kind"] === "sample") {
      if (!asString(a["caseId"])) {
        issue(
          ctx,
          `${base}.action.caseId`,
          "wrong-type",
          "sample caseId must be a string",
        );
        fatal = true;
        return;
      }
      const at = parsePt(a["at"], ctx, `${base}.action.at`);
      if (at === null) {
        fatal = true;
        return;
      }
      action = { kind: "sample", caseId: a["caseId"] as string, at };
    } else {
      issue(
        ctx,
        `${base}.action.kind`,
        "wrong-type",
        "action kind must be init|place|sample",
      );
      fatal = true;
      return;
    }
    // Events.
    if (!Array.isArray(tu["events"])) {
      issue(ctx, `${base}.events`, "wrong-type", "events must be an array");
      fatal = true;
      return;
    }
    const evs = tu["events"] as unknown[];
    if (ti === 0 && evs.length !== 0) {
      issue(
        ctx,
        `${base}.events`,
        "bad-cardinality",
        "txn 0 carries zero events (CardinalityRule)",
      );
      fatal = true;
      return;
    }
    const events: MoveEvent[] = [];
    let evFatal = false;
    evs.forEach((eu, ei) => {
      const p = `${base}.events[${ei}]`;
      if (!isRecord(eu)) {
        issue(ctx, p, "wrong-type", "event must be an object");
        evFatal = true;
        return;
      }
      if (!asInt(eu["i"]) || (eu["i"] as number) < 1) {
        issue(
          ctx,
          `${p}.i`,
          "bad-cardinality",
          "event ordinal i must be a positive integer",
        );
        evFatal = true;
        return;
      }
      const i = eu["i"] as number;
      if (!firstEvent && i <= prevI) {
        issue(
          ctx,
          `${p}.i`,
          "bad-cardinality",
          "event ordinals must strictly increase in commit order",
          `> ${prevI}`,
          String(i),
        );
        evFatal = true;
        return;
      }
      firstEvent = false;
      prevI = i;
      if (eu["txnId"] !== txnId) {
        issue(
          ctx,
          `${p}.txnId`,
          "bad-tree-shape",
          "event txnId must match its transaction",
          String(txnId),
          String(eu["txnId"]),
        );
        evFatal = true;
        return;
      }
      if (!asInt(eu["indexInTxn"]) || (eu["indexInTxn"] as number) !== ei + 1) {
        issue(
          ctx,
          `${p}.indexInTxn`,
          "bad-cardinality",
          "indexInTxn must be 1-based contiguous",
          String(ei + 1),
          String(eu["indexInTxn"]),
        );
        evFatal = true;
        return;
      }
      const owner = parsePlayer(eu["owner"], ctx, `${p}.owner`);
      const at = parsePt(eu["at"], ctx, `${p}.at`);
      if (owner === null || at === null) {
        evFatal = true;
        return;
      }
      if (!asString(eu["appliedPoint"])) {
        issue(
          ctx,
          `${p}.appliedPoint`,
          "wrong-type",
          "appliedPoint must be a string",
        );
        evFatal = true;
        return;
      }
      let caseId: string | undefined;
      if ("caseId" in eu && eu["caseId"] !== undefined) {
        if (!asString(eu["caseId"])) {
          issue(
            ctx,
            `${p}.caseId`,
            "wrong-type",
            "caseId must be a string when present",
          );
          evFatal = true;
          return;
        }
        caseId = eu["caseId"] as string;
      }
      if (
        !("nodeAfter" in eu) ||
        (eu["nodeAfter"] !== null && !asString(eu["nodeAfter"]))
      ) {
        issue(
          ctx,
          `${p}.nodeAfter`,
          "wrong-type",
          "nodeAfter must be a string or null",
        );
        evFatal = true;
        return;
      }
      if (!asString(eu["stateHash"])) {
        issue(
          ctx,
          `${p}.stateHash`,
          "wrong-type",
          "stateHash must be a string",
        );
        evFatal = true;
        return;
      }
      if (eu["parent"] !== null && !asInt(eu["parent"])) {
        issue(
          ctx,
          `${p}.parent`,
          "wrong-type",
          "event parent must be an integer or null",
        );
        evFatal = true;
        return;
      }
      events.push({
        i,
        txnId,
        indexInTxn: ei + 1,
        parent: eu["parent"] as number | null,
        owner,
        at,
        appliedPoint: eu["appliedPoint"] as string,
        ...(caseId !== undefined ? { caseId } : {}),
        nodeAfter: eu["nodeAfter"] as string | null,
        stateHash: eu["stateHash"] as string,
      });
    });
    if (evFatal) {
      fatal = true;
      return;
    }
    // Result (+ terminal hydration).
    const res = tu["result"];
    let result: ReplayTxn["result"] | null = null;
    if (!isRecord(res)) {
      issue(ctx, `${base}.result`, "wrong-type", "result must be an object");
      fatal = true;
      return;
    }
    if (res["kind"] === "committed") {
      result = { kind: "committed" };
    } else if (res["kind"] === "terminal") {
      const terminal = parseTerminal(
        res["terminal"],
        ctx,
        `${base}.result.terminal`,
      );
      if (terminal === null) {
        fatal = true;
        return;
      }
      result = { kind: "terminal", terminal };
    } else {
      issue(
        ctx,
        `${base}.result.kind`,
        "wrong-type",
        "result kind must be committed|terminal",
      );
      fatal = true;
      return;
    }
    // Invariant 4 (cardinality by mode): init 0; sandbox exactly 1 +
    // committed; guided committed ≥ 2, guided terminal ≥ 1.
    const isSandbox = mode === "sandbox";
    if (ti !== 0) {
      if (isSandbox) {
        if (events.length !== 1 || result.kind !== "committed") {
          issue(
            ctx,
            `${base}.events`,
            "bad-cardinality",
            "sandbox transactions carry exactly one committed event",
          );
          fatal = true;
          return;
        }
      } else if (result.kind === "committed") {
        if (events.length < 2) {
          issue(
            ctx,
            `${base}.events`,
            "bad-cardinality",
            "committed guided transactions carry ≥ 2 events",
          );
          fatal = true;
          return;
        }
      } else if (events.length < 1) {
        issue(
          ctx,
          `${base}.events`,
          "bad-cardinality",
          "terminal guided transactions carry ≥ 1 event",
        );
        fatal = true;
        return;
      }
    }
    // Hashes (invariant 3 linkage checked after all txnIds are known —
    // recorded here, verified below).
    if (!asString(tu["afterHash"])) {
      issue(
        ctx,
        `${base}.afterHash`,
        "wrong-type",
        "afterHash must be a string",
      );
      fatal = true;
      return;
    }
    const bh = tu["beforeHash"];
    if (ti === 0) {
      if (bh !== null) {
        issue(
          ctx,
          `${base}.beforeHash`,
          "bad-root-shape",
          "txn 0 beforeHash must be null",
        );
        fatal = true;
        return;
      }
    } else if (!asString(bh)) {
      issue(
        ctx,
        `${base}.beforeHash`,
        "wrong-type",
        "beforeHash must be a string",
      );
      fatal = true;
      return;
    }
    // Event parent linkage (invariant 4): previous event of this txn, else
    // the parent txn's last event, else null.
    for (let ei = 0; ei < events.length; ei += 1) {
      const ev = events[ei] as MoveEvent;
      const want =
        ei > 0
          ? (events[ei - 1] as MoveEvent).i
          : parentTxnId === null
            ? null
            : (lastEventByTxn.get(parentTxnId) ?? null);
      if (ev.parent !== want) {
        issue(
          ctx,
          `${base}.events[${ei}].parent`,
          "bad-cardinality",
          "event parent must chain within the txn, else the parent txn's last event",
          want === null ? "null" : String(want),
          ev.parent === null ? "null" : String(ev.parent),
        );
        fatal = true;
        break;
      }
    }
    if (fatal) {
      return;
    }
    seenIds.set(txnId, ti);
    if (events.length > 0) {
      lastEventByTxn.set(txnId, events[events.length - 1]?.i as number);
    }
    afterHashByTxn.set(txnId, tu["afterHash"] as string);
    parsedTxns.push({
      txnId,
      parentTxnId,
      action: action as ReplayTxn["action"],
      events,
      beforeHash: bh as string | null,
      afterHash: tu["afterHash"] as string,
      result: result as ReplayTxn["result"],
    });
  });
  if (fatal || ctx.issues.length > 0) {
    return { ok: false, issues: ctx.issues };
  }
  // Invariant 3 (hash linkage): beforeHash equals the parent's afterHash.
  for (const t of parsedTxns) {
    if (t.parentTxnId === null) {
      continue;
    }
    const parentHash = afterHashByTxn.get(t.parentTxnId);
    if (t.beforeHash !== parentHash) {
      const idx = seenIds.get(t.txnId) as number;
      issue(
        ctx,
        `transactions[${idx}].beforeHash`,
        "hash-mismatch",
        "beforeHash must equal the parent txn's afterHash",
        parentHash,
        t.beforeHash ?? "null",
      );
    }
  }
  // Cursor (invariant 3): names a committed txn when present.
  let cursorTxnId: number | undefined;
  if ("cursorTxnId" in doc && doc["cursorTxnId"] !== undefined) {
    if (!asInt(doc["cursorTxnId"])) {
      issue(
        ctx,
        "cursorTxnId",
        "bad-tree-shape",
        "cursorTxnId must be an integer",
      );
    } else if (!seenIds.has(doc["cursorTxnId"] as number)) {
      issue(
        ctx,
        "cursorTxnId",
        "bad-tree-shape",
        "cursorTxnId must name a committed txn",
        "a committed txnId",
        String(doc["cursorTxnId"]),
      );
    } else {
      cursorTxnId = doc["cursorTxnId"] as number;
    }
  }
  if (ctx.issues.length > 0) {
    return { ok: false, issues: ctx.issues };
  }
  if (strategyStart === "invalid" || window === null) {
    return { ok: false, issues: ctx.issues };
  }
  const file: ReplayFile = {
    format: "esmb-replay",
    version,
    meta,
    config: {
      k,
      mode,
      ...(gameMode !== undefined ? { gameMode } : {}),
      window,
    },
    strategy,
    strategyStart,
    transactions: parsedTxns,
    ...(cursorTxnId !== undefined ? { cursorTxnId } : {}),
    engineVersion: doc["engineVersion"] as string,
    strategyVersion: doc["strategyVersion"] as string,
  };
  return { ok: true, file };
}

// ---- serialize (exact inverse; canonical field order) ----

function ratStr(r: Rat): string {
  return r.toString();
}

function ptJSON(p: Pt): PtJSON {
  return { x: ratStr(p.x), y: ratStr(p.y) };
}

function holeJSON(h: KHole): KHoleJSON {
  return { verts: [...h.verts] };
}

function analysisJSON(a: HoleAnalysis): HoleAnalysisJSON {
  if (a.kind === "exhaustive") {
    return { kind: "exhaustive", k: a.k, holes: a.holes.map(holeJSON) };
  }
  if (a.kind === "witness-only") {
    return {
      kind: "witness-only",
      k: a.k,
      witness: holeJSON(a.witness),
      stoppedBy: "found",
    };
  }
  return { kind: "budget-exhausted", k: a.k, searched: a.searched };
}

function terminalJSON(t: Terminal): TerminalJSON {
  if (t.kind === "maker-won") {
    return {
      kind: "maker-won",
      k: t.k,
      witness: t.witness.map(holeJSON),
      nodeId: t.nodeId,
    };
  }
  if (t.kind === "strategy-integrity-failure") {
    const f = t.report.failed;
    return {
      kind: "strategy-integrity-failure",
      report: {
        failedAt: t.report.failedAt,
        phase: t.report.phase,
        failed: {
          id: f.id,
          kind: f.kind,
          passed: f.passed,
          detail: f.detail,
          ...("analysis" in f && f.analysis !== undefined
            ? { analysis: analysisJSON(f.analysis) }
            : {}),
        },
        stateHash: t.report.stateHash,
      },
    };
  }
  const r = t.report;
  if (r.origin === "breaker-reply") {
    return {
      kind: "uncovered",
      report: {
        origin: "breaker-reply",
        reason: r.reason,
        at: { nodeId: r.at.nodeId, breakerPoint: r.at.breakerPoint },
        detail: r.detail,
      },
    };
  }
  // Maker-construction: the runtime report carries the kind-only ref; the
  // full MoveSpec was expanded at assembly time (engine/replay.ts), so the
  // payload here IS a MoveSpec — the `never` cast marks the layer boundary
  // (replay/ may not name strategy types, §18.1).
  return {
    kind: "uncovered",
    report: {
      origin: "maker-construction",
      reason: r.reason,
      at: { nodeId: r.at.nodeId, move: moveSpecToJSON(r.at.move as never) },
      detail: r.detail,
    },
  };
}

export function serializeReplay(file: ReplayFile): string {
  const txns: ReplayTxnJSON[] = file.transactions.map((t) => ({
    txnId: t.txnId,
    parentTxnId: t.parentTxnId,
    action:
      t.action.kind === "init"
        ? { kind: "init" }
        : t.action.kind === "place"
          ? { kind: "place", owner: t.action.owner, at: ptJSON(t.action.at) }
          : {
              kind: "sample",
              caseId: t.action.caseId,
              at: ptJSON(t.action.at),
            },
    events: t.events.map((e) => ({
      i: e.i,
      txnId: e.txnId,
      indexInTxn: e.indexInTxn,
      parent: e.parent,
      owner: e.owner,
      at: ptJSON(e.at),
      appliedPoint: e.appliedPoint,
      ...(e.caseId !== undefined ? { caseId: e.caseId } : {}),
      nodeAfter: e.nodeAfter,
      stateHash: e.stateHash,
    })),
    beforeHash: t.beforeHash,
    afterHash: t.afterHash,
    result:
      t.result.kind === "committed"
        ? { kind: "committed" }
        : { kind: "terminal", terminal: terminalJSON(t.result.terminal) },
  }));
  const doc: ReplayFileJSON = {
    format: "esmb-replay",
    version: file.version,
    meta:
      file.meta.label === undefined
        ? {
            createdAt: file.meta.createdAt,
            app: file.meta.app,
            appVersion: file.meta.appVersion,
          }
        : { ...file.meta },
    config: {
      k: file.config.k,
      mode: file.config.mode,
      ...(file.config.gameMode !== undefined
        ? { gameMode: file.config.gameMode }
        : {}),
      window: {
        xMin: ratStr(file.config.window.xMin),
        xMax: ratStr(file.config.window.xMax),
        yMin: ratStr(file.config.window.yMin),
        yMax: ratStr(file.config.window.yMax),
      },
    },
    strategy: file.strategy === null ? null : { ...file.strategy },
    strategyStart:
      file.strategyStart === null
        ? null
        : file.strategyStart.kind === "continue"
          ? {
              kind: "continue",
              points: file.strategyStart.points.map(ptJSON),
              owners: [...file.strategyStart.owners],
              selectedHole:
                file.strategyStart.selectedHole === null
                  ? null
                  : file.strategyStart.selectedHole.map(ptJSON),
            }
          : file.strategyStart.kind === "supplied"
            ? {
                kind: "supplied",
                points: file.strategyStart.points.map(ptJSON),
                selectedHole: file.strategyStart.selectedHole.map(ptJSON),
                ...(file.strategyStart.owners !== undefined
                  ? { owners: [...file.strategyStart.owners] }
                  : {}),
              }
            : { kind: "fixture", scenarioRef: file.strategyStart.scenarioRef },
    transactions: txns,
    ...(file.cursorTxnId !== undefined
      ? { cursorTxnId: file.cursorTxnId }
      : {}),
    engineVersion: file.engineVersion,
    strategyVersion: file.strategyVersion,
  };
  return JSON.stringify(doc);
}
