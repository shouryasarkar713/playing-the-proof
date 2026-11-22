import { Rat } from "../../../src/geometry/rat.ts";
import {
  createGreedyBlockingPolicy,
  createRandomLegalPolicy,
  createStrategyAwarePolicy,
  runKStrip,
} from "../../../src/kstrip/index.ts";
import type { BreakerPolicy, RunResult } from "../../../src/kstrip/index.ts";
import type { KStripSpec, SpecParams } from "../../../src/kstrip/spec/index.ts";

export const POLICIES: readonly (readonly [string, () => BreakerPolicy])[] = [
  ["random", () => createRandomLegalPolicy(7)],
  ["greedy", () => createGreedyBlockingPolicy()],
  ["aware", () => createStrategyAwarePolicy()],
];

export interface Cfg {
  readonly k: number;
  readonly t: number;
  readonly s?: string;
}

export function configsOf(spec: KStripSpec): Cfg[] {
  const out: Cfg[] = [];
  for (const v of spec.verified) {
    for (const t of v.t) {
      if (v.s === undefined) out.push({ k: v.k, t });
      else for (const s of v.s) out.push({ k: v.k, t, s });
    }
  }
  return out;
}

export const paramsOf = (c: Cfg): SpecParams =>
  c.s === undefined ? { k: c.k, t: BigInt(c.t) } : { k: c.k, t: BigInt(c.t), s: Rat.fromString(c.s) };

export function legacy(spec: KStripSpec, c: Cfg, policy: BreakerPolicy): RunResult {
  return runKStrip(c.k, c.t, policy, undefined, {
    variant: spec.variant,
    ...(c.s === undefined ? {} : { s: Rat.fromString(c.s) }),
  });
}

// Everything observable about a run except the estimate/budget objects.
export function fingerprint(r: RunResult): string {
  return JSON.stringify({
    status: r.status,
    message: r.message,
    goalMet: r.goalMet,
    goal: String(r.goal),
    rounds: r.rounds,
    work: String(r.work),
    points: r.points,
    log: r.log,
    levels: r.levels,
    checks: r.checks,
    claims: r.claims.map((c) => ({ level: c.level, vertices: c.vertices, direction: c.direction })),
  });
}
