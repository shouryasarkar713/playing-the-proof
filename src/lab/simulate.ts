// lab/simulate.ts — the lab's bounded, seeded, interruptible simulation.
//
// Exact rational geometry throughout (integer-coordinate candidates as Rat;
// orient() for legality; the engine's ownership-aware win detection from
// game/gamemode.ts). Two players, each driven by a SIMPLE policy
// (random-legal, or greedy: best of 16 random legal candidates by a budgeted
// hole-count score). These are NOT the published strategies: a result is one
// sampled play, an OBSERVATION. It is returned as
//   { kind: "completed" | "budgetExhausted", observed, notAGuarantee: true }
// and never as a statement of what either player can force.
//
// Bias convention (simulation only; the sources fix none, see D5): after
// Maker's r-th point Breaker has placed floor(s*r) points in total; Maker
// moves first in each round. One-round: Maker places n points, then Breaker
// places floor(s*n) points, n capped so everything fits the 64-point engine cap.
import { Rat } from "../geometry/rat.ts";
import { pt } from "../geometry/pt.ts";
import type { Pt } from "../geometry/pt.ts";
import { orient } from "../geometry/predicates.ts";
import { binom } from "../geometry/holes.ts";
import type { KHole } from "../geometry/holes.ts";
import { findNewWinHoles, findWinHoles } from "../game/gamemode.ts";
import type { GameState, PlacedPoint, Player } from "../game/types.ts";
import { floorRat } from "./bias.ts";
import {
  SIM_DEFAULT_OPS_BUDGET,
  SIM_DEFAULT_ROUNDS,
  SIM_K_MAX,
  SIM_K_MIN,
  SIM_MAX_POINTS,
} from "./limits.ts";
import { simulationSupport } from "./classify.ts";
import type { LabConfig } from "./types.ts";

export type Policy = "random-legal" | "greedy";

export interface SimOptions {
  readonly seed: number;
  readonly makerPolicy?: Policy;
  readonly breakerPolicy?: Policy;
  // Online: number of rounds to play. One-round: number of Maker points.
  readonly maxRounds?: number;
  // Exact-geometry work budget (candidate-granular, as in findKHoles).
  readonly opsBudget?: number;
  // Polled before every placement; true stops the run (budgetExhausted).
  readonly shouldStop?: () => boolean;
}

export type StoppedBy =
  | "maker-hole"
  | "rounds-complete"
  | "max-rounds"
  | "ops-budget"
  | "interrupted"
  | "point-cap"
  | "no-legal-point";

export interface SimObserved {
  readonly model: LabConfig["model"];
  readonly rule: LabConfig["rule"];
  readonly k: number;
  readonly bias: string;
  readonly seed: number;
  readonly makerPolicy: Policy;
  readonly breakerPolicy: Policy;
  readonly rounds: number;
  readonly makerPoints: number;
  readonly breakerPoints: number;
  readonly holeFound: boolean;
  readonly witness: readonly string[] | null;
  readonly holeRound: number | null;
  readonly opsUsed: number;
  readonly transcript: readonly string[];
}

export type SimResult =
  | {
      readonly kind: "completed" | "budgetExhausted";
      readonly stoppedBy: StoppedBy;
      readonly observed: SimObserved;
      readonly notAGuarantee: true;
      readonly label: string;
    }
  | { readonly kind: "unsupported"; readonly reason: string; readonly notAGuarantee: true };

const LABEL =
  "Observation only: one bounded, seeded play with simple policies. It says nothing about what either player can force and is not a statement about any theorem.";

// xorshift32 — deterministic, no Math.*, no clock.
class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = (seed >>> 0) === 0 ? 0x9e3779b9 : seed >>> 0;
  }
  next(): number {
    let x = this.s;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    this.s = x;
    return x;
  }
  int(n: number): number {
    return this.next() % n;
  }
}

const SIDE = 1000;
const CANDIDATES = 16;
const GREEDY_CAP = 150_000;

function legal(points: readonly PlacedPoint[], p: Pt): boolean {
  for (const q of points) {
    if (q.pt.x.equals(p.x) && q.pt.y.equals(p.y)) {
      return false;
    }
  }
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      if (orient((points[i] as PlacedPoint).pt, (points[j] as PlacedPoint).pt, p) === 0) {
        return false;
      }
    }
  }
  return true;
}

function randomLegal(rng: Rng, points: readonly PlacedPoint[]): Pt | null {
  for (let t = 0; t < 200; t += 1) {
    const p = pt(Rat.make(BigInt(rng.int(SIDE + 1))), Rat.make(BigInt(rng.int(SIDE + 1))));
    if (legal(points, p)) {
      return p;
    }
  }
  return null;
}

function stateOf(points: readonly PlacedPoint[], k: number, rule: LabConfig["rule"]): GameState {
  return {
    seq: 0,
    k: k as GameState["k"],
    mode: "sandbox",
    ...(rule === "bichromatic" ? { gameMode: "bichromatic" as const } : {}),
    points,
    turn: "maker",
    terminal: null,
    strategy: null,
  };
}

function eligibleCount(points: readonly PlacedPoint[], rule: LabConfig["rule"]): number {
  return rule === "bichromatic" ? points.filter((p) => p.owner === "maker").length : points.length;
}

// Candidate-granular cost of findNewWinHoles(k) on n points, m eligible.
function newCost(n: number, m: number, k: number): number {
  return binom(m > 0 ? m - 1 : 0, k - 1) * k * (n - k > 0 ? n - k : 0);
}

function inside(hole: KHole, points: readonly PlacedPoint[], q: Pt): boolean {
  const byId = new Map(points.map((p) => [p.id, p.pt] as const));
  for (let i = 0; i < hole.verts.length; i += 1) {
    const a = byId.get(hole.verts[i] as string) as Pt;
    const b = byId.get(hole.verts[(i + 1) % hole.verts.length] as string) as Pt;
    if (orient(a, b, q) <= 0) {
      return false;
    }
  }
  return true;
}

export function runSimulation(cfg: LabConfig, opts: SimOptions): SimResult {
  const support = simulationSupport(cfg);
  if (!support.available) {
    return { kind: "unsupported", reason: support.reason, notAGuarantee: true };
  }
  if (cfg.k < SIM_K_MIN || cfg.k > SIM_K_MAX) {
    return { kind: "unsupported", reason: "k out of range", notAGuarantee: true };
  }
  const makerPolicy = opts.makerPolicy ?? "random-legal";
  const breakerPolicy = opts.breakerPolicy ?? "random-legal";
  const maxRounds = opts.maxRounds ?? SIM_DEFAULT_ROUNDS;
  const budget = opts.opsBudget ?? SIM_DEFAULT_OPS_BUDGET;
  const rng = new Rng(opts.seed);
  const k = cfg.k;
  const rule = cfg.rule;
  const points: PlacedPoint[] = [];
  const transcript: string[] = [];
  let ops = 0;
  let holeFound = false;
  let witness: string[] | null = null;
  let holeRound: number | null = null;
  let rounds = 0;

  const finish = (kind: "completed" | "budgetExhausted", stoppedBy: StoppedBy): SimResult => ({
    kind,
    stoppedBy,
    observed: {
      model: cfg.model,
      rule,
      k,
      bias: cfg.bias.toString(),
      seed: opts.seed,
      makerPolicy,
      breakerPolicy,
      rounds,
      makerPoints: points.filter((p) => p.owner === "maker").length,
      breakerPoints: points.filter((p) => p.owner === "breaker").length,
      holeFound,
      witness,
      holeRound,
      opsUsed: ops,
      transcript,
    },
    notAGuarantee: true,
    label: LABEL,
  });

  // Scoring helpers (budget-guarded; fall back to random when too costly).
  const score = (cand: Pt, owner: Player): number => {
    if (k - 1 < 3) {
      return 0;
    }
    const trial: PlacedPoint[] = [
      ...points,
      { id: `p${points.length + 1}`, owner, pt: cand, move: points.length + 1 },
    ];
    const st = stateOf(trial, k - 1, rule);
    const cost = newCost(trial.length, eligibleCount(trial, rule), k - 1);
    if (cost > GREEDY_CAP || ops + cost > budget) {
      return 0;
    }
    ops += cost;
    if (owner === "maker") {
      return findNewWinHoles(st, k - 1, `p${trial.length}`).holes.length;
    }
    // Breaker: count current (k-1)-holes whose hull the candidate lands in.
    const cur = stateOf(points, k - 1, rule);
    const holes = findWinHoles(cur, k - 1, { mode: "exhaustive", budget: GREEDY_CAP });
    if (holes.kind !== "exhaustive") {
      return 0;
    }
    return holes.holes.filter((h) => inside(h, points, cand)).length;
  };

  const choose = (owner: Player, policy: Policy): Pt | null => {
    if (policy === "random-legal") {
      return randomLegal(rng, points);
    }
    let best: Pt | null = null;
    let bestScore = -1;
    for (let c = 0; c < CANDIDATES; c += 1) {
      const cand = randomLegal(rng, points);
      if (cand === null) {
        break;
      }
      const sc = score(cand, owner);
      if (sc > bestScore) {
        bestScore = sc;
        best = cand;
      }
    }
    return best;
  };

  // Place one point; returns a stop reason, or null to continue.
  const place = (owner: Player, policy: Policy, round: number): StoppedBy | null => {
    if (opts.shouldStop?.() === true) {
      return "interrupted";
    }
    if (points.length >= SIM_MAX_POINTS) {
      return "point-cap";
    }
    const at = choose(owner, policy);
    if (at === null) {
      return "no-legal-point";
    }
    points.push({ id: `p${points.length + 1}`, owner, pt: at, move: points.length + 1 });
    transcript.push(`${owner}:${at.x.toString()},${at.y.toString()}`);
    if (cfg.model === "online") {
      const n = points.length;
      const cost = newCost(n, eligibleCount(points, rule), k);
      if (ops + cost > budget) {
        return "ops-budget";
      }
      ops += cost;
      const st = stateOf(points, k, rule);
      const found = findNewWinHoles(st, k, `p${n}`);
      if (found.holes.length > 0) {
        holeFound = true;
        witness = [...(found.holes[0] as KHole).verts];
        holeRound = round;
        return "maker-hole";
      }
    }
    return null;
  };

  const perRound = (r: number): number => {
    const a = floorRat(cfg.bias.mul(Rat.make(BigInt(r))));
    const b = floorRat(cfg.bias.mul(Rat.make(BigInt(r - 1))));
    return Number(a - b);
  };

  if (cfg.model === "online") {
    for (let r = 1; r <= maxRounds; r += 1) {
      rounds = r;
      let stop = place("maker", makerPolicy, r);
      if (stop === null) {
        for (let b = perRound(r); b > 0 && stop === null; b -= 1) {
          stop = place("breaker", breakerPolicy, r);
        }
      }
      if (stop === "maker-hole") {
        return finish("completed", "maker-hole");
      }
      if (stop !== null) {
        return finish("budgetExhausted", stop);
      }
    }
    return finish("budgetExhausted", "max-rounds");
  }

  // one-round
  let n = maxRounds;
  while (n > 0 && n + Number(floorRat(cfg.bias.mul(Rat.make(BigInt(n))))) > SIM_MAX_POINTS) {
    n -= 1;
  }
  if (n < 1) {
    return finish("budgetExhausted", "point-cap");
  }
  for (let i = 1; i <= n; i += 1) {
    rounds = i;
    const stop = place("maker", makerPolicy, i);
    if (stop !== null) {
      return finish("budgetExhausted", stop);
    }
  }
  const bCount = Number(floorRat(cfg.bias.mul(Rat.make(BigInt(n)))));
  for (let i = 0; i < bCount; i += 1) {
    const stop = place("breaker", breakerPolicy, n);
    if (stop !== null) {
      return finish("budgetExhausted", stop);
    }
  }
  const total = points.length;
  const cost =
    binom(eligibleCount(points, rule), k) * k * (total - k > 0 ? total - k : 0);
  if (ops + cost > budget) {
    return finish("budgetExhausted", "ops-budget");
  }
  ops += cost;
  const res = findWinHoles(stateOf(points, k, rule), k, { mode: "first-witness", budget: cost + k * total });
  if (res.kind === "witness-only") {
    holeFound = true;
    witness = [...res.witness.verts];
    holeRound = n;
  }
  return finish("completed", "rounds-complete");
}
