// kstrip/spec/interpret.ts — the KStripSpec interpreter.
//
// Executes the construction described by a KStripSpec through the exact
// kernel: the spec chooses the phase for each level, evaluates every formula
// (strip demand, units, Maker moves, Breaker allowance), descends the
// recursion, checks the declared pre/post predicates (per-phase certificates)
// and the Breaker's responses; the geometry is done by the named primitives
// (runner.ts: base points, pairing + adoption, slab-restricted grouping,
// tilted pairing). The legacy `runKStrip` is the reference implementation:
// for every verified configuration both produce byte-identical move logs
// (tests/kstrip/spec/equivalence.test.ts).
import { eqPt } from "../../geometry/pt.ts";
import type { Pt } from "../../geometry/pt.ts";
import { Rat } from "../../geometry/rat.ts";
import { canAdd } from "../pairing.ts";
import { DEFAULT_BUDGET, checkBudget, estimateCost } from "../recursion.ts";
import type { Budget, RunSpec } from "../recursion.ts";
import {
  BudgetExceeded,
  RunFailure,
  bichromaticBaseLevel1,
  finalClaims,
  groupingPhase,
  monoBaseLevel1,
  monoBaseLevel2,
  newCtx,
  pairingPhase,
  resultOf,
} from "../runner.ts";
import type { Ctx } from "../runner.ts";
import type { TraceObserver } from "../trace.ts";
import type { BreakerDecision, BreakerPolicy, BreakerView, RunResult, StripClaim } from "../types.ts";
import { PHASE_PREDICATE_INDEX, RUN_PREDICATE_INDEX } from "./predicates.ts";
import type { PhaseEnv, RunEnv } from "./predicates.ts";
import { biasOf, evalPhase, inDomain, planFromSpec, planRounds, selectPhases } from "./plan.ts";
import type { PhaseValues } from "./plan.ts";
import type {
  KStripSpec,
  PhaseCertificate,
  PhaseSpec,
  PlanItem,
  PredRef,
  PredResult,
  ResponseClass,
  SpecOutcome,
  SpecParams,
  SpecRun,
} from "./types.ts";
import { validateSpecCached } from "./validate.ts";

export interface SpecRunOptions {
  readonly budget?: Budget;
  readonly trace?: TraceObserver;
  // Observation hook: the exact data each phase's postconditions were checked
  // on (tests tamper with copies of it to prove the predicates reject).
  readonly onPhaseEnv?: (env: PhaseEnv) => void;
  // TEST SEAM ONLY: run a spec that fails validateSpec, to exercise the
  // fail-closed runtime paths (unknown predicate, ...). Never set in the app.
  readonly unsafeSkipValidation?: boolean;
}

class PredicateViolation extends Error {
  readonly scope: "pre" | "post";
  readonly phaseId: string;
  readonly predicate: string;
  constructor(scope: "pre" | "post", phaseId: string, predicate: string, detail: string) {
    super(`${scope}condition '${predicate}' of phase ${phaseId} violated: ${detail}`);
    this.scope = scope;
    this.phaseId = phaseId;
    this.predicate = predicate;
  }
}

class ResponseRejected extends Error {
  readonly phaseId: string;
  readonly responseClass: ResponseClass;
  readonly code: string;
  constructor(phaseId: string, responseClass: ResponseClass, code: string, policy: string) {
    super(`policy ${policy} chose an illegal point: ${code}`);
    this.phaseId = phaseId;
    this.responseClass = responseClass;
    this.code = code;
  }
}

// Which response class does Breaker's point p violate (frame coordinates)?
// Same order of tests as the executor's legality rule.
function responseViolation(
  classes: readonly ResponseClass[],
  board: readonly Pt[],
  p: Pt,
): { cls: ResponseClass; code: string } | null {
  for (const o of board) {
    if (eqPt(o, p)) {
      return { cls: "general-position", code: "duplicate" };
    }
    if (classes.includes("distinct-x") && o.x.equals(p.x)) {
      return { cls: "distinct-x", code: "same-x" };
    }
  }
  if (classes.includes("general-position") && !canAdd(board, p)) {
    return { cls: "general-position", code: "collinear" };
  }
  return null;
}

function runPredicates<E>(
  refs: readonly PredRef[],
  index: ReadonlyMap<string, { check: (e: E) => { ok: boolean; detail: string } }>,
  env: E,
): PredResult[] {
  return refs.map((r) => {
    const def = index.get(r.id);
    if (def === undefined) {
      return { id: r.id, ok: false, detail: "unknown predicate" };
    }
    try {
      const v = def.check(env);
      return { id: r.id, ok: v.ok, detail: v.detail };
    } catch (e) {
      return { id: r.id, ok: false, detail: `predicate threw: ${e instanceof Error ? e.message : String(e)}` };
    }
  });
}

function outcomeOfFailure(status: RunResult["status"], message: string): SpecOutcome {
  if (status === "invariant-failure") {
    return {
      kind: "integrity-failure",
      scope: "executor",
      phase: null,
      predicate: message.replace(/^exact check failed: /, ""),
      message,
    };
  }
  return { kind: "integrity-failure", scope: "executor", phase: null, predicate: status, message };
}

export function runSpec(
  spec: KStripSpec,
  params: SpecParams,
  policy: BreakerPolicy,
  opts: SpecRunOptions = {},
): SpecRun {
  const base = { specId: spec.id, specVersion: spec.version };
  const none = {
    plan: [] as PlanItem[],
    certificates: [] as PhaseCertificate[],
    runPre: [] as PredResult[],
    runPost: [] as PredResult[],
    result: null,
  };
  // 1. the spec itself must be well formed (K1-K9)
  const issues = opts.unsafeSkipValidation === true ? [] : validateSpecCached(spec);
  const first = issues[0];
  if (first !== undefined) {
    return {
      ...base,
      ...none,
      outcome: {
        kind: "integrity-failure",
        scope: "spec",
        phase: null,
        predicate: first.rule,
        message: `${first.where}: ${first.message}`,
      },
    };
  }
  // 2. run precondition: only verified configurations are executed
  const dom = inDomain(spec, params);
  const domainEnv: RunEnv = {
    variant: spec.variant,
    k: params.k,
    goal: params.t,
    rounds: 0,
    expectedRounds: 0,
    domainOk: dom.ok,
    domainDetail: dom.detail,
    claims: [],
    board: [],
    log: [],
  };
  const runPre = runPredicates(spec.runPre, RUN_PREDICATE_INDEX, domainEnv);
  if (!dom.ok) {
    return { ...base, ...none, runPre, outcome: { kind: "uncovered", reason: dom.detail } };
  }
  const bad = runPre.find((r) => !r.ok);
  if (bad !== undefined) {
    return {
      ...base,
      ...none,
      runPre,
      outcome: { kind: "integrity-failure", scope: "run-pre", phase: null, predicate: bad.id, message: bad.detail },
    };
  }
  const s = biasOf(spec, params) as Rat;
  const runSpecData: RunSpec =
    spec.variant === "mono-1:1"
      ? { variant: spec.variant, k: params.k, t: params.t, s: Rat.ONE }
      : { variant: spec.variant, k: params.k, t: params.t, s };
  const budget = opts.budget ?? DEFAULT_BUDGET;
  const estimate = estimateCost(runSpecData);
  const plan = planFromSpec(spec, params);
  if (budget.preflight) {
    const bc = checkBudget(estimate, budget);
    if (!bc.ok) {
      const message = `refused before execution: ${bc.exceeded.join("; ")}`;
      return {
        ...base,
        ...none,
        plan,
        runPre,
        outcome: { kind: "incomplete", reason: "refused", message },
        result: resultOf("refused", message, estimate, budget, params.t, null, []),
      };
    }
  }

  // 3. execute
  const guard: { phase: PhaseSpec | null } = { phase: null };
  const guarded: BreakerPolicy = {
    name: policy.name,
    choose(view: BreakerView): BreakerDecision {
      const dec = policy.choose(view);
      const ph = guard.phase;
      if (ph !== null) {
        const v = responseViolation(
          ph.allowedResponses,
          view.points.map((o) => o.pt),
          dec.point,
        );
        if (v !== null) {
          throw new ResponseRejected(ph.id, v.cls, v.code, policy.name);
        }
      }
      return dec;
    },
  };
  const ctx: Ctx = newCtx(runSpecData, budget, guarded, opts.trace ?? null);
  const certificates: PhaseCertificate[] = [];

  const exec = (level: number, need: bigint): Pt[][] => {
    const cands = selectPhases(spec, level);
    const phase = cands[0] as PhaseSpec;
    const v: PhaseValues = evalPhase(spec, phase, params, level, need);
    let inputs: Pt[][] = [];
    if (v.child !== null) {
      inputs = exec(v.child.level, v.child.need);
    }
    const startFrame = ctx.frame;
    const startPoints = ctx.fpts.slice();
    const logFrom = ctx.log.length;
    const levelsFrom = ctx.levels.length;
    const envBase = {
      phaseId: phase.id,
      kind: phase.kind,
      level,
      need: Number(need),
      units: Number(v.units),
      makerMoves: Number(v.makerMoves),
      per: v.per,
      inputStrips: Number(v.inputStrips),
      stripSize: level,
      allowance: v.allowance,
      startFrame,
      startPoints,
      inputs,
    };
    const preEnv: PhaseEnv = {
      ...envBase,
      endFrame: startFrame,
      endPoints: startPoints,
      outputs: [],
      moves: [],
      report: null,
    };
    const pre = runPredicates(phase.pre, PHASE_PREDICATE_INDEX, preEnv);
    const cert = (post: PredResult[], delivered: number, breakerMoves: number, ok: boolean): void => {
      certificates.push({
        phaseId: phase.id,
        kind: phase.kind,
        level,
        need: Number(need),
        units: Number(v.units),
        makerMoves: Number(v.makerMoves),
        breakerMoves,
        delivered,
        logFrom,
        logTo: ctx.log.length,
        pre,
        post,
        ok,
      });
    };
    const preBad = pre.find((r) => !r.ok);
    if (preBad !== undefined) {
      cert([], 0, 0, false);
      throw new PredicateViolation("pre", phase.id, preBad.id, preBad.detail);
    }
    ctx.allowance = (m: bigint) => v.allowance(Number(m));
    guard.phase = phase;
    const sInt = s.n;
    let out: Pt[][];
    switch (phase.primitive) {
      case "mono-base-1":
        out = monoBaseLevel1(ctx, need, v.makerMoves);
        break;
      case "mono-base-2":
        out = monoBaseLevel2(ctx, need, v.makerMoves, sInt);
        break;
      case "pair-adopt":
        out = pairingPhase(ctx, level, inputs, v.units, true, need);
        break;
      case "group-slab":
        out = groupingPhase(ctx, level, inputs, need, sInt);
        break;
      case "bichromatic-base-1":
        out = bichromaticBaseLevel1(ctx, need, v.makerMoves);
        break;
      case "bichromatic-pair-tilt":
        out = pairingPhase(ctx, level, inputs, v.units, false, need);
        break;
    }
    guard.phase = null;
    ctx.allowance = null;
    const moves = ctx.log.slice(logFrom);
    const report = ctx.levels.length > levelsFrom ? (ctx.levels[ctx.levels.length - 1] ?? null) : null;
    const postEnv: PhaseEnv = {
      ...envBase,
      endFrame: ctx.frame,
      endPoints: ctx.fpts.slice(),
      outputs: out,
      moves,
      report,
    };
    const post = runPredicates(phase.post, PHASE_PREDICATE_INDEX, postEnv);
    opts.onPhaseEnv?.(postEnv);
    const postBad = post.find((r) => !r.ok);
    cert(post, out.length, moves.filter((m) => m.player === "breaker").length, postBad === undefined);
    if (postBad !== undefined) {
      throw new PredicateViolation("post", phase.id, postBad.id, postBad.detail);
    }
    return out;
  };

  const finish = (outcome: SpecOutcome, result: RunResult, runPost: PredResult[] = []): SpecRun => ({
    ...base,
    plan,
    certificates,
    runPre,
    runPost,
    outcome,
    result,
  });
  const mkResult = (status: RunResult["status"], message: string, claims: StripClaim[]): RunResult =>
    resultOf(status, message, estimate, budget, params.t, ctx, claims);

  try {
    const strips = exec(params.k, params.t);
    const claims = finalClaims(ctx, strips);
    const env: RunEnv = {
      variant: spec.variant,
      k: params.k,
      goal: params.t,
      rounds: ctx.round,
      expectedRounds: Number(planRounds(plan)),
      domainOk: true,
      domainDetail: dom.detail,
      claims,
      board: ctx.base.map((b) => ({ pt: b.pt, owner: b.owner })),
      log: ctx.log,
    };
    const runPost = runPredicates(spec.runPost, RUN_PREDICATE_INDEX, env);
    const postBad = runPost.find((r) => !r.ok);
    if (postBad !== undefined) {
      const message =
        postBad.id === "claims-at-least-goal"
          ? "fewer verified strips than the goal"
          : `run postcondition '${postBad.id}' violated: ${postBad.detail}`;
      return finish(
        {
          kind: "integrity-failure",
          scope: "run-post",
          phase: null,
          predicate: postBad.id,
          message: `${postBad.id}: ${postBad.detail}`,
        },
        mkResult("invariant-failure", message, postBad.id === "claims-at-least-goal" ? claims : []),
        runPost,
      );
    }
    return finish(
      { kind: "completed" },
      mkResult("completed", "goal met; every claimed strip re-verified exactly", claims),
      runPost,
    );
  } catch (e) {
    if (e instanceof BudgetExceeded) {
      return finish(
        { kind: "incomplete", reason: "budget-exhausted", message: e.message },
        mkResult("budget-exhausted", e.message, []),
      );
    }
    if (e instanceof PredicateViolation) {
      return finish(
        {
          kind: "integrity-failure",
          scope: e.scope,
          phase: e.phaseId,
          predicate: e.predicate,
          message: e.message,
        },
        mkResult("invariant-failure", e.message, []),
      );
    }
    if (e instanceof ResponseRejected) {
      return finish(
        { kind: "rejected", phase: e.phaseId, responseClass: e.responseClass, message: e.message },
        mkResult("invalid-breaker-move", e.message, []),
      );
    }
    if (e instanceof RunFailure) {
      if (e.status === "invalid-breaker-move") {
        return finish(
          { kind: "rejected", phase: null, responseClass: "executor-legality", message: e.message },
          mkResult(e.status, e.message, []),
        );
      }
      return finish(outcomeOfFailure(e.status, e.message), mkResult(e.status, e.message, []));
    }
    throw e;
  }
}

// Every failed predicate of a run (certificates + run level).
export function certificateFailures(run: SpecRun): readonly PredResult[] {
  return [...run.certificates.flatMap((c) => [...c.pre, ...c.post]), ...run.runPre, ...run.runPost].filter(
    (r) => !r.ok,
  );
}
