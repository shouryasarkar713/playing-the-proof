// kstrip/spec/validate.ts — structural validation of a KStripSpec (rules K1-K9),
// the analogue of the strategy registry's G1-G11 for the k-strip construction.
// Pure: no geometry is executed; formulas are evaluated exactly and compared
// with the kernel's cost estimator (recursion.ts) and the paper's recurrence.
import { Rat } from "../../geometry/rat.ts";
import { MAX_K, estimateCost } from "../recursion.ts";
import type { RunSpec } from "../recursion.ts";
import { exprVars } from "./expr.ts";
import type { Expr, ExprVar } from "./expr.ts";
import { PHASE_PREDICATE_INDEX, RUN_PREDICATE_INDEX } from "./predicates.ts";
import { PlanError, evalPhase, planFromSpec, planRounds, selectPhases } from "./plan.ts";
import type { KStripSpec, PhaseSpec, PredRef, SpecParams } from "./types.ts";

export interface SpecIssue {
  readonly rule: string;
  readonly where: string;
  readonly message: string;
}

const PRIMITIVE_KIND: Readonly<Record<string, { kind: string; terminal: boolean; variants: readonly string[] }>> = {
  "mono-base-1": { kind: "base", terminal: true, variants: ["mono-1:1", "mono-1:s"] },
  "mono-base-2": { kind: "base", terminal: true, variants: ["mono-1:1", "mono-1:s"] },
  "pair-adopt": { kind: "pairing", terminal: false, variants: ["mono-1:1"] },
  "group-slab": { kind: "grouping", terminal: false, variants: ["mono-1:s"] },
  "bichromatic-base-1": { kind: "bichromatic-base", terminal: true, variants: ["bichromatic"] },
  "bichromatic-pair-tilt": { kind: "bichromatic-pairing", terminal: false, variants: ["bichromatic"] },
};

const KNOWN_RESPONSES = ["general-position", "distinct-x"];

function ids(refs: readonly PredRef[]): string[] {
  return refs.map((r) => r.id);
}

function missing(have: readonly PredRef[], need: readonly string[]): string[] {
  const h = new Set(ids(have));
  return need.filter((n) => !h.has(n));
}

function checkVars(
  issues: SpecIssue[],
  where: string,
  e: Expr,
  allowed: readonly ExprVar[],
): void {
  for (const v of exprVars(e)) {
    if (!allowed.includes(v)) {
      issues.push({ rule: "K5", where, message: `formula uses '${v}', not available here` });
    }
  }
}

function runSpecOf(spec: KStripSpec, params: SpecParams): RunSpec {
  return spec.variant === "mono-1:1"
    ? { variant: spec.variant, k: params.k, t: params.t, s: Rat.ONE }
    : params.s === undefined
      ? { variant: spec.variant, k: params.k, t: params.t }
      : { variant: spec.variant, k: params.k, t: params.t, s: params.s };
}

// The configurations the formulas are evaluated on: the verified ones AND a
// grid beyond them (a formula that is only right on the verified points,
// e.g. floor vs ceil on divisible inputs, must still be caught). Large
// instances are skipped (plans are evaluated move by move).
const GRID_T = [1, 2, 3, 5, 7];
const GRID_S: Readonly<Record<KStripSpec["sRule"], readonly string[]>> = {
  "fixed-1": [],
  "integer>=1": ["1", "2", "3", "5"],
  "rational[0,2)": ["0", "1/3", "1", "3/2", "19/10"],
};
const GRID_MAX_ROUNDS = 3000n;

function gridConfigs(spec: KStripSpec): SpecParams[] {
  const out: SpecParams[] = [];
  for (let k = 2; k <= 7; k += 1) {
    for (const t of GRID_T) {
      const ss = GRID_S[spec.sRule];
      for (const s of ss.length === 0 ? [null] : ss) {
        const params: SpecParams =
          s === null ? { k, t: BigInt(t) } : { k, t: BigInt(t), s: Rat.fromString(s) };
        const est = estimateCost(runSpecOf(spec, params));
        if (est.supported && est.rounds <= GRID_MAX_ROUNDS) {
          out.push(params);
        }
      }
    }
  }
  return out;
}

function configs(spec: KStripSpec): SpecParams[] {
  const out: SpecParams[] = gridConfigs(spec);
  for (const v of spec.verified) {
    for (const t of v.t) {
      if (v.s === undefined) {
        out.push({ k: v.k, t: BigInt(t) });
      } else {
        for (const s of v.s) {
          out.push({ k: v.k, t: BigInt(t), s: Rat.fromString(s) });
        }
      }
    }
  }
  return out;
}

function phaseRules(spec: KStripSpec, ph: PhaseSpec, issues: SpecIssue[]): void {
  const where = `phase ${ph.id}`;
  // K2 predicates exist, non-empty pre/post, no duplicates
  for (const [side, refs] of [
    ["pre", ph.pre],
    ["post", ph.post],
  ] as const) {
    if (refs.length === 0) {
      issues.push({ rule: "K2", where, message: `${side}condition list is empty` });
    }
    if (new Set(ids(refs)).size !== refs.length) {
      issues.push({ rule: "K2", where, message: `${side} lists a predicate twice` });
    }
    for (const r of refs) {
      if (!PHASE_PREDICATE_INDEX.has(r.id)) {
        issues.push({ rule: "K2", where, message: `${side} refers to unknown predicate '${r.id}'` });
      }
    }
  }
  // K4 primitive / kind / variant / terminality
  const prim = PRIMITIVE_KIND[ph.primitive];
  if (prim === undefined) {
    issues.push({ rule: "K4", where, message: `unknown primitive '${ph.primitive}'` });
  } else {
    if (prim.kind !== ph.kind) {
      issues.push({ rule: "K4", where, message: `primitive ${ph.primitive} runs a '${prim.kind}' phase, spec says '${ph.kind}'` });
    }
    if (!prim.variants.includes(spec.variant)) {
      issues.push({ rule: "K4", where, message: `primitive ${ph.primitive} does not belong to variant ${spec.variant}` });
    }
    if (prim.terminal !== (ph.transition.kind === "terminal")) {
      issues.push({
        rule: "K4",
        where,
        message: prim.terminal ? "a base primitive must be terminal" : "a pairing/grouping primitive must recurse",
      });
    }
  }
  // K5 formula variable scopes
  const scope: ExprVar[] = ["k", "level", "need", "s"];
  checkVars(issues, where, ph.units, scope);
  checkVars(issues, where, ph.inputStrips, [...scope, "units"]);
  checkVars(issues, where, ph.makerMoves, [...scope, "units"]);
  checkVars(issues, where, ph.breakerAllowance, [...scope, "units", "m"]);
  if (ph.transition.kind === "recurse") {
    checkVars(issues, where, ph.transition.level, [...scope, "units"]);
    checkVars(issues, where, ph.transition.need, [...scope, "units"]);
  }
  // K6 allowed responses
  if (ph.allowedResponses.length === 0) {
    issues.push({ rule: "K6", where, message: "no allowed Breaker response class" });
  }
  for (const c of ph.allowedResponses) {
    if (!KNOWN_RESPONSES.includes(c)) {
      issues.push({ rule: "K6", where, message: `unknown response class '${c}'` });
    }
  }
  if (!ph.allowedResponses.includes("general-position")) {
    issues.push({ rule: "K6", where, message: "general-position is always a response requirement" });
  }
  if (ph.allowedResponses.includes("distinct-x") !== (ph.kind === "base")) {
    issues.push({ rule: "K6", where, message: "distinct-x is required exactly in the monochromatic base phase" });
  }
  // K7 certificate completeness
  const bare = ph.kind === "base" || ph.kind === "bichromatic-base";
  const needPost = ["phase-accounting", "outputs-count", "outputs-are-strips", "outputs-pairwise-parallel"];
  if (!bare) {
    needPost.push("apex-in-gap", "apex-in-cones", "survivor-selection", "ledger-arithmetic");
  }
  if (spec.variant === "bichromatic") {
    needPost.push("outputs-maker-only");
  }
  if (ph.kind === "base") {
    needPost.push("base-distinct-x");
  }
  const needPre = bare ? ["board-empty-at-start"] : ["inputs-count", "inputs-are-strips", "inputs-pairwise-parallel"];
  for (const m of missing(ph.post, needPost)) {
    issues.push({ rule: "K7", where, message: `postcondition '${m}' is required for this phase` });
  }
  for (const m of missing(ph.pre, needPre)) {
    issues.push({ rule: "K7", where, message: `precondition '${m}' is required for this phase` });
  }
}

export function validateSpec(spec: KStripSpec): SpecIssue[] {
  const issues: SpecIssue[] = [];
  // K1
  if (spec.phases.length === 0) {
    issues.push({ rule: "K1", where: spec.id, message: "no phases" });
  }
  if (new Set(spec.phases.map((p) => p.id)).size !== spec.phases.length) {
    issues.push({ rule: "K1", where: spec.id, message: "duplicate phase ids" });
  }
  if (spec.verified.length === 0) {
    issues.push({ rule: "K1", where: spec.id, message: "no verified configuration (a spec must claim something)" });
  }
  // K9 domain well-formed
  for (const v of spec.verified) {
    if (!Number.isInteger(v.k) || v.k < 1 || v.k > MAX_K || v.t.length === 0 || v.t.some((t) => !Number.isInteger(t) || t < 1)) {
      issues.push({ rule: "K9", where: `verified k=${v.k}`, message: "k must be in [1,12] and t a non-empty list of integers >= 1" });
    }
    if (spec.sRule === "fixed-1" ? v.s !== undefined : v.s === undefined || v.s.length === 0) {
      issues.push({ rule: "K9", where: `verified k=${v.k}`, message: `s list does not match the rule '${spec.sRule}'` });
      continue;
    }
    for (const sx of v.s ?? []) {
      try {
        const s = Rat.fromString(sx);
        const okS =
          spec.sRule === "integer>=1"
            ? s.d === 1n && s.n >= 1n
            : !s.isNeg() && s.cmp(Rat.make(2n)) < 0;
        if (!okS) {
          issues.push({ rule: "K9", where: `verified k=${v.k}`, message: `s = ${sx} violates '${spec.sRule}'` });
        }
      } catch {
        issues.push({ rule: "K9", where: `verified k=${v.k}`, message: `s = '${sx}' is not a rational` });
      }
    }
  }
  // K2 (run level)
  for (const [side, refs] of [
    ["runPre", spec.runPre],
    ["runPost", spec.runPost],
  ] as const) {
    if (refs.length === 0) {
      issues.push({ rule: "K2", where: side, message: "empty" });
    }
    for (const r of refs) {
      if (!RUN_PREDICATE_INDEX.has(r.id)) {
        issues.push({ rule: "K2", where: side, message: `unknown run predicate '${r.id}'` });
      }
    }
  }
  const needRunPost = ["claims-verified-base-coordinates", "claims-pairwise-parallel", "claims-at-least-goal", "rounds-match-plan"];
  if (spec.variant === "bichromatic") {
    needRunPost.push("claims-maker-only");
  }
  for (const m of missing(spec.runPost, needRunPost)) {
    issues.push({ rule: "K7", where: "runPost", message: `run postcondition '${m}' is required` });
  }
  for (const m of missing(spec.runPre, ["params-in-verified-domain"])) {
    issues.push({ rule: "K7", where: "runPre", message: `run precondition '${m}' is required` });
  }
  for (const ph of spec.phases) {
    phaseRules(spec, ph, issues);
  }
  // K3 level coverage: exactly one phase at every level 1..MAX_K
  for (let level = 1; level <= MAX_K; level += 1) {
    const n = selectPhases(spec, level).length;
    if (n !== 1) {
      issues.push({ rule: "K3", where: `level ${level}`, message: `${n} phases apply (exactly one required)` });
    }
  }
  if (issues.some((i) => i.rule === "K1" || i.rule === "K3" || i.rule === "K9")) {
    return issues; // the evaluation rules below need a well-formed spec
  }
  // K5 / K8 evaluate every verified configuration
  for (const params of configs(spec)) {
    const where = `config k=${params.k} t=${params.t}${params.s === undefined ? "" : ` s=${params.s.toString()}`}`;
    try {
      const plan = planFromSpec(spec, params);
      let level = params.k;
      for (const item of plan) {
        const ph = selectPhases(spec, level)[0] as PhaseSpec;
        const v = evalPhase(spec, ph, params, level, item.need);
        if (v.child !== null) {
          if (v.child.level !== level - 1) {
            issues.push({ rule: "K4", where, message: `level ${level} recurses to ${v.child.level}, not ${level - 1}` });
          }
          if (v.child.need !== v.inputStrips) {
            issues.push({ rule: "K4", where, message: `level ${level}: strips demanded below (${v.child.need}) differ from strips consumed (${v.inputStrips})` });
          }
          if (v.units === 0n) {
            issues.push({ rule: "K5", where, message: `level ${level}: recursive phase with 0 units` });
          }
          if (v.makerMoves !== v.units) {
            issues.push({ rule: "K5", where, message: `level ${level}: ${v.makerMoves} Maker moves for ${v.units} units` });
          }
          level = v.child.level;
        } else if (v.units !== 0n || v.inputStrips !== 0n) {
          issues.push({ rule: "K5", where, message: `terminal phase ${ph.id} has units or inputs` });
        }
      }
      // K8: the budget formulas against the kernel's estimator and the paper
      const est = estimateCost(runSpecOf(spec, params));
      if (!est.supported) {
        issues.push({ rule: "K8", where, message: `estimator refuses this configuration: ${est.unsupportedReason ?? "?"}` });
        continue;
      }
      const byLevel = new Map(est.levels.map((l) => [l.level, l]));
      for (const item of plan) {
        const l = byLevel.get(item.level);
        if (l === undefined) {
          issues.push({ rule: "K8", where, message: `estimator has no level ${item.level}` });
          continue;
        }
        const diffs: string[] = [];
        if (l.strips !== item.need) diffs.push(`strips ${item.need} vs ${l.strips}`);
        if (l.makerMoves !== item.makerMoves) diffs.push(`Maker moves ${item.makerMoves} vs ${l.makerMoves}`);
        if (l.breakerMoves !== item.breakerMoves) diffs.push(`Breaker moves ${item.breakerMoves} vs ${l.breakerMoves}`);
        if (l.units !== item.units) diffs.push(`units ${item.units} vs ${l.units}`);
        if (l.inputStrips !== item.inputStrips) diffs.push(`inputs ${item.inputStrips} vs ${l.inputStrips}`);
        if (diffs.length > 0) {
          issues.push({ rule: "K8", where, message: `level ${item.level} differs from recursion.ts estimate: ${diffs.join("; ")}` });
        }
      }
      const rounds = planRounds(plan);
      if (rounds !== est.rounds || plan.length !== est.levels.length) {
        issues.push({ rule: "K8", where, message: `${rounds} rounds in ${plan.length} levels, estimator ${est.rounds} in ${est.levels.length}` });
      }
      // the paper's closed form (fractional) bounds the integer rounds from below
      if (est.paperRounds !== null) {
        const lo = est.paperRounds;
        const r = Rat.make(rounds);
        if (r.cmp(lo) < 0 || r.cmp(lo.add(Rat.ONE)) >= 0) {
          issues.push({ rule: "K8", where, message: `${rounds} rounds outside [${lo.toString()}, ${lo.toString()} + 1) of the paper's recurrence` });
        }
      }
    } catch (e) {
      if (e instanceof PlanError && e.code === "no-descent") {
        issues.push({ rule: "K4", where, message: `invalid transition: ${e.message}` });
      } else {
        issues.push({ rule: "K5", where, message: `formulas do not evaluate: ${e instanceof Error ? e.message : String(e)}` });
      }
    }
  }
  return issues;
}

// Memoised per spec object (specs are immutable data).
const CACHE = new WeakMap<KStripSpec, SpecIssue[]>();
export function validateSpecCached(spec: KStripSpec): SpecIssue[] {
  let r = CACHE.get(spec);
  if (r === undefined) {
    r = validateSpec(spec);
    CACHE.set(spec, r);
  }
  return r;
}
