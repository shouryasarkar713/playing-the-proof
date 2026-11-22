// tests/strategies/k8driver.ts — shared k=8 scaffolding: registration, session
// helpers, the deterministic guided-tour script (the Figure 3–5 path in exact
// rationals) and cell-representative helpers.
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { Rat } from "../../src/geometry/rat.ts";
import { initSession } from "../../src/engine/init.ts";
import { reduceTransaction } from "../../src/engine/orchestrator.ts";
import type { RuntimeCtx } from "../../src/engine/orchestrator.ts";
import type { GameState, StrategyStart } from "../../src/game/types.ts";
import {
  classifyFour,
  getClassifier,
  registerClassifier,
  registerStrategy,
  strategies,
} from "../../src/strategy/registry.ts";
import { getChecker, registerChecker } from "../../src/verification/invariants.ts";
import { esmbK8 } from "../../src/strategy/strategies/k8/def.ts";
import {
  classifyB0Hept,
  classifyB3Obs2,
  classifyB4Sevens,
} from "../../src/strategy/strategies/k8/classify.ts";
import { K8_CHECKERS } from "../../src/verification/k8checks.ts";
import { PRESET_P7 } from "../../src/strategy/strategies/k8/preset.ts";
import { testCtx } from "../helpers.ts";

export function ensureK8(): void {
  if (getClassifier(classifyFour.id) === undefined) {
    registerClassifier(classifyFour);
  }
  for (const c of [classifyB0Hept, classifyB3Obs2, classifyB4Sevens]) {
    if (getClassifier(c.id) === undefined) {
      registerClassifier(c);
    }
  }
  for (const c of K8_CHECKERS) {
    if (getChecker(c.id) === undefined) {
      registerChecker(c);
    }
  }
  if (!strategies().has(esmbK8.id)) {
    registerStrategy(esmbK8, "core");
  }
}

ensureK8();

export const R = (n: number, d = 1): Rat => Rat.make(BigInt(n), BigInt(d));
export const P = (x: number, y: number): Pt => pt(R(x), R(y));

export function centroid(ps: readonly Pt[]): Pt {
  let x = Rat.ZERO;
  let y = Rat.ZERO;
  for (const p of ps) {
    x = x.add(p.x);
    y = y.add(p.y);
  }
  const n = R(ps.length);
  return pt(x.div(n), y.div(n));
}

export function initK8(
  ctx: RuntimeCtx = testCtx(),
  start?: StrategyStart,
): GameState {
  const r = initSession(
    {
      kind: "guided",
      config: { mode: "break", window: ctx.config.window },
      strategyId: "esmb-k8",
      mode: "break",
      ...(start === undefined ? {} : { strategyStart: start }),
    },
    ctx,
  );
  if (r.status !== "accepted" || r.state === undefined) {
    throw new Error(`initK8 rejected: ${JSON.stringify(r.error)}`);
  }
  return r.state;
}

export interface Step {
  state: GameState;
  caseId: string | undefined;
}

export function breakerMove(
  state: GameState,
  at: Pt,
  ctx: RuntimeCtx = testCtx(),
): Step | null {
  const r = reduceTransaction(state, { kind: "place", owner: "breaker", at }, ctx);
  if (r.status !== "accepted" || r.nextState === undefined) {
    return null;
  }
  return { state: r.nextState, caseId: r.events[0]?.caseId };
}

export const vars = (s: GameState): Record<string, string | string[]> =>
  (s.strategy?.vars ?? {}) as Record<string, string | string[]>;

export function ptOf(s: GameState, id: string): Pt {
  const p = s.points.find((q) => q.id === id);
  if (p === undefined) {
    throw new Error(`ptOf ${id}`);
  }
  return p.pt;
}

export const HEPTAGON = PRESET_P7;
