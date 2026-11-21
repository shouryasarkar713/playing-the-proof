// tests/strategies/k5driver.ts — seeded random-game driver for esmb-k5
// (§23.7 items 5–6; mirrors §2.6's prototype batteries). Full guided games
// through the real pipeline (startSession + reduceTransaction + commit):
// uniform-random legal B1, B2 safe (resampled until non-convex) or forced
// convex (blunder suite), B3 anywhere legal. 100% maker-won required —
// empirical evidence, never proof (§26F).
import { convexPosition } from "../../src/geometry/hull.ts";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { Rat } from "../../src/geometry/rat.ts";
import { checkPlacement } from "../../src/game/legality.ts";
import type { GameState } from "../../src/game/types.ts";
import { commit, startSession } from "../../src/session/commit.ts";
import { Store } from "../../src/session/store.ts";
import { reduceTransaction } from "../../src/engine/orchestrator.ts";
import type { RuntimeCtx } from "../../src/engine/orchestrator.ts";
import {
  classifyFour,
  getClassifier,
  registerClassifier,
  strategies,
  registerStrategy,
} from "../../src/strategy/registry.ts";
import { getChecker, registerChecker } from "../../src/verification/invariants.ts";
import { esmbK5 } from "../../src/strategy/strategies/k5/def.ts";
import { classifyB3 } from "../../src/strategy/strategies/k5/classifyB3.ts";
import { trapezoidChecker } from "../../src/verification/trapezoid.ts";
import { mulberry32, testCtx } from "../helpers.ts";

// Idempotent: the live maps are shared across test files in a worker.
export function ensureK5(): void {
  if (getClassifier(classifyFour.id) === undefined) {
    registerClassifier(classifyFour);
  }
  if (getClassifier(classifyB3.id) === undefined) {
    registerClassifier(classifyB3);
  }
  if (getChecker(trapezoidChecker.id) === undefined) {
    registerChecker(trapezoidChecker);
  }
  if (!strategies().has(esmbK5.id)) {
    registerStrategy(esmbK5, "core");
  }
}

ensureK5();

export interface K5GameResult {
  won: boolean;
  terminalKind: string | null;
  points: number;
  nodeId: string | null;
  cases: readonly (string | null)[];
  breaker: readonly Pt[];
}

function intPt(rand: () => number, lo: number, hi: number): Pt {
  const span = hi - lo + 1;
  const x = Math.floor(rand() * span) + lo;
  const y = Math.floor(rand() * span) + lo;
  return pt(Rat.make(BigInt(x)), Rat.make(BigInt(y)));
}

function ptsOf(state: GameState): Pt[] {
  return state.points.map((p) => p.pt);
}

// Uniform-random legal Breaker point; extra `accept` screens candidates
// (e.g., the B2 convexity class) before legality is even attempted.
function sampleBreaker(
  state: GameState,
  ctx: RuntimeCtx,
  rand: () => number,
  accept?: (cand: Pt) => boolean,
): Pt {
  for (let t = 0; t < 500; t += 1) {
    const cand = intPt(rand, -40, 40);
    if (accept !== undefined && !accept(cand)) {
      continue;
    }
    if (checkPlacement(state, cand, ctx.config.window) === null) {
      return cand;
    }
  }
  throw new Error("sampleBreaker: no legal point in 500 tries — test bug");
}

export function playK5Game(
  seedRand: () => number,
  b2mode: "safe" | "blunder",
): K5GameResult {
  const store = new Store();
  const ctx = testCtx();
  const started = startSession(
    {
      kind: "guided",
      config: { mode: "break", window: ctx.config.window },
      strategyId: "esmb-k5",
      mode: "break",
    },
    ctx,
    store,
  );
  if (started.status !== "accepted") {
    throw new Error("playK5Game: start rejected — test bug");
  }
  const cases: (string | null)[] = [];
  const breakerPts: Pt[] = [];
  const place = (at: Pt): void => {
    const r = reduceTransaction(
      store.current(),
      { kind: "place", owner: "breaker", at },
      ctx,
    );
    if (r.status !== "accepted" || r.nextState === undefined) {
      throw new Error("playK5Game: breaker placement rejected — test bug");
    }
    commit(r, { kind: "place", owner: "breaker", at }, store, ctx);
    breakerPts.push(at);
    cases.push(store.current().strategy?.lastCase ?? null);
  };
  // B1: anywhere legal.
  place(sampleBreaker(store.current(), ctx, seedRand));
  // B2: safe (non-convex four) or blunder (convex four) by pure geometry —
  // the same predicate classifyFour evaluates.
  const four = ptsOf(store.current());
  place(
    sampleBreaker(store.current(), ctx, seedRand, (cand) =>
      b2mode === "safe"
        ? !convexPosition([...four, cand])
        : convexPosition([...four, cand]),
    ),
  );
  if (store.current().terminal === null) {
    // B3: anywhere legal (blunder games already ended in round 3).
    place(sampleBreaker(store.current(), ctx, seedRand));
  }
  const cur = store.current();
  return {
    won: cur.terminal?.kind === "maker-won",
    terminalKind: cur.terminal?.kind ?? null,
    points: cur.points.length,
    nodeId: cur.strategy?.nodeId ?? null,
    cases,
    breaker: breakerPts,
  };
}

// Drive only the recorded Breaker placements on a fresh session (the
// reduction-fold substitute for §23.7 item 8 pending Phase 15: Maker moves
// are deterministic consequences, so identical Breaker inputs must yield
// the identical terminal + state hash).
export function refoldK5(
  breakerPts: readonly Pt[],
  config?: import("../../src/game/types.ts").Configuration,
): K5GameResult {
  const store = new Store();
  const base = testCtx();
  const ctx: RuntimeCtx = config === undefined ? base : { ...base, config };
  const started = startSession(
    {
      kind: "guided",
      config: { mode: "break", window: ctx.config.window },
      strategyId: "esmb-k5",
      mode: "break",
    },
    ctx,
    store,
  );
  if (started.status !== "accepted") {
    throw new Error("refoldK5: start rejected — test bug");
  }
  const cases: (string | null)[] = [];
  for (const at of breakerPts) {
    if (store.current().terminal !== null) {
      break;
    }
    const r = reduceTransaction(
      store.current(),
      { kind: "place", owner: "breaker", at },
      ctx,
    );
    if (r.status !== "accepted") {
      throw new Error("refoldK5: placement rejected on replay — test bug");
    }
    commit(r, { kind: "place", owner: "breaker", at }, store, ctx);
    cases.push(store.current().strategy?.lastCase ?? null);
  }
  const cur = store.current();
  return {
    won: cur.terminal?.kind === "maker-won",
    terminalKind: cur.terminal?.kind ?? null,
    points: cur.points.length,
    nodeId: cur.strategy?.nodeId ?? null,
    cases,
    breaker: breakerPts,
  };
}

export function runK5Suite(
  seeds: number,
  seed0: number,
  b2mode: "safe" | "blunder",
): { wins: number; games: number; failures: string[] } {
  const rand = mulberry32(seed0);
  let wins = 0;
  const failures: string[] = [];
  for (let i = 0; i < seeds; i += 1) {
    const g = playK5Game(rand, b2mode);
    if (g.won) {
      wins += 1;
    } else if (failures.length < 3) {
      failures.push(
        `game ${i}: terminal=${g.terminalKind} points=${g.points} node=${g.nodeId} cases=${g.cases.join(",")}`,
      );
    }
  }
  return { wins, games: seeds, failures };
}
