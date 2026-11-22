// kstrip/spec/plan.ts — evaluate a KStripSpec's formulas (no geometry).
//
// The plan is the recursion unrolled: which phase runs at which level, with
// which strip demand, how many units / Maker moves / Breaker replies, and
// which level is entered next.
import { Rat } from "../../geometry/rat.ts";
import { MAX_K } from "../recursion.ts";
import { evalCount } from "./expr.ts";
import type { ExprEnv } from "./expr.ts";
import type { KStripSpec, PhaseSpec, PlanItem, SpecParams } from "./types.ts";

export type PlanErrorCode = "no-unique-phase" | "no-descent" | "no-termination";

export class PlanError extends Error {
  readonly code: PlanErrorCode;
  constructor(code: PlanErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export function selectPhases(spec: KStripSpec, level: number): PhaseSpec[] {
  return spec.phases.filter((ph) =>
    ph.when.kind === "eq" ? level === ph.when.level : level >= ph.when.level,
  );
}

// The Breaker bias the spec uses for these parameters.
export function biasOf(spec: KStripSpec, params: SpecParams): Rat | null {
  if (spec.sRule === "fixed-1") {
    return params.s === undefined || params.s.equals(Rat.ONE) ? Rat.ONE : null;
  }
  return params.s ?? null;
}

export function inDomain(
  spec: KStripSpec,
  params: SpecParams,
): { readonly ok: boolean; readonly detail: string } {
  const s = biasOf(spec, params);
  if (s === null) {
    return {
      ok: false,
      detail:
        spec.sRule === "fixed-1"
          ? `${spec.id} is defined for s = 1 only`
          : `${spec.id} needs the bias s`,
    };
  }
  const t = Number(params.t);
  for (const v of spec.verified) {
    if (v.k !== params.k || !v.t.includes(t)) {
      continue;
    }
    if (v.s === undefined || v.s.some((x) => Rat.fromString(x).equals(s))) {
      return { ok: true, detail: `k=${params.k}, t=${t}, s=${s.toString()} is a verified configuration` };
    }
  }
  return {
    ok: false,
    detail: `k=${params.k}, t=${t}, s=${s.toString()} is not among the verified configurations of ${spec.id}`,
  };
}

export interface PhaseValues {
  readonly phase: PhaseSpec;
  readonly level: number;
  readonly need: bigint;
  readonly units: bigint;
  readonly inputStrips: bigint;
  readonly makerMoves: bigint;
  readonly per: number;
  readonly allowance: (m: number) => number;
  readonly child: { readonly level: number; readonly need: bigint } | null;
}

export function evalPhase(
  spec: KStripSpec,
  phase: PhaseSpec,
  params: SpecParams,
  level: number,
  need: bigint,
): PhaseValues {
  const s = biasOf(spec, params);
  if (s === null) {
    throw new Error("bias undefined for these parameters");
  }
  const base: ExprEnv = {
    k: Rat.make(BigInt(params.k)),
    level: Rat.make(BigInt(level)),
    need: Rat.make(need),
    s,
  };
  const units = evalCount(phase.units, base);
  const env: ExprEnv = { ...base, units: Rat.make(units) };
  const inputStrips = evalCount(phase.inputStrips, env);
  const makerMoves = evalCount(phase.makerMoves, env);
  const allowance = (m: number): number =>
    Number(evalCount(phase.breakerAllowance, { ...env, m: Rat.make(BigInt(m)) }));
  let child: PhaseValues["child"] = null;
  if (phase.transition.kind === "recurse") {
    child = {
      level: Number(evalCount(phase.transition.level, env)),
      need: evalCount(phase.transition.need, env),
    };
  }
  const per = units === 0n ? 0 : Number(inputStrips / units);
  return { phase, level, need, units, inputStrips, makerMoves, per, allowance, child };
}

export function breakerTotalOf(v: PhaseValues): bigint {
  let tot = 0n;
  for (let m = 1n; m <= v.makerMoves; m += 1n) {
    tot += BigInt(v.allowance(Number(m)));
  }
  return tot;
}

// The recursion unrolled, TOP-DOWN (execution order is the reverse).
export function planFromSpec(spec: KStripSpec, params: SpecParams): PlanItem[] {
  const out: PlanItem[] = [];
  let level = params.k;
  let need = params.t;
  for (let guard = 0; guard <= MAX_K + 1; guard += 1) {
    const cands = selectPhases(spec, level);
    const phase = cands[0];
    if (cands.length !== 1 || phase === undefined) {
      throw new PlanError("no-unique-phase", `level ${level}: ${cands.length} phases apply (exactly one required)`);
    }
    const v = evalPhase(spec, phase, params, level, need);
    out.push({
      level,
      phaseId: phase.id,
      kind: phase.kind,
      need,
      units: v.units,
      inputStrips: v.inputStrips,
      makerMoves: v.makerMoves,
      breakerMoves: breakerTotalOf(v),
    });
    if (v.child === null) {
      return out;
    }
    if (v.child.level >= level) {
      throw new PlanError("no-descent", `level ${level}: transition does not descend (to ${v.child.level})`);
    }
    level = v.child.level;
    need = v.child.need;
  }
  throw new PlanError("no-termination", "plan does not terminate");
}

export function planRounds(plan: readonly PlanItem[]): bigint {
  return plan.reduce((a, p) => a + p.makerMoves, 0n);
}
