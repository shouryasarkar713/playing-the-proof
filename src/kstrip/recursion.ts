// kstrip/recursion.ts — round recurrences, closed forms, cost estimator,
// budget (paper Theorems 3, 4, 5). Exact (Rat / bigint); no floating point.
//
// Theorem 3 (1:1):  r(1,t) = t/2, r(2,t) = t, r(k,t) = r(k-1,4t) + 2t (k>=3).
//   closed form (k>=2):  (5/3 * 4^(k-2) - 2/3) * t   — an EQUALITY (checked
//   exactly for all tested k,t); the paper's theorem says "at most", the
//   proposal (§7.6) says "<="; both are weaker than what the recurrence gives.
// Theorem 4 (1:s, s integer): r(1,t) = t/(s+1), r(2,t) = 2t/(s+1),
//   r(k,t) = r(k-1,4st) + 2t (k>=3), closed form (k>=2)
//   ((4s)^(k-2)/(s+1) + ((4s)^(k-2) - 1)/(4s-1)) * 2t.
//   NB the recurrence is NOT valid at k = 2 (r(1,4st)+2t != r(2,t)); the
//   closed form is valid for all k >= 2 with base r(2,t).
import { Rat } from "../geometry/rat.ts";

function rat(n: bigint, d: bigint = 1n): Rat {
  return Rat.make(n, d);
}

function pow(b: bigint, e: number): bigint {
  let r = 1n;
  for (let i = 0; i < e; i += 1) {
    r *= b;
  }
  return r;
}

export function floorRat(r: Rat): bigint {
  const q = r.n / r.d;
  return r.n < 0n && q * r.d !== r.n ? q - 1n : q;
}

export function ceilRat(r: Rat): bigint {
  const q = r.n / r.d;
  return r.n > 0n && q * r.d !== r.n ? q + 1n : q;
}

// ---- recurrences (as in the paper; Rat because r(1,t) = t/2 etc.) --------

export function monoRounds(k: number, t: bigint): Rat {
  if (k < 1 || t < 1n) {
    throw new Error("monoRounds: k >= 1 and t >= 1 required");
  }
  if (k === 1) {
    return rat(t, 2n);
  }
  if (k === 2) {
    return rat(t);
  }
  return monoRounds(k - 1, 4n * t).add(rat(2n * t));
}

export function monoClosedForm(k: number, t: bigint): Rat {
  if (k < 2) {
    throw new Error("monoClosedForm: valid for k >= 2");
  }
  // (5/3 * 4^(k-2) - 2/3) t = (5 * 4^(k-2) - 2) t / 3
  return rat((5n * pow(4n, k - 2) - 2n) * t, 3n);
}

export function biasedRounds(k: number, t: bigint, s: bigint): Rat {
  if (k < 1 || t < 1n || s < 1n) {
    throw new Error("biasedRounds: k,t,s >= 1 required");
  }
  if (k === 1) {
    return rat(t, s + 1n);
  }
  if (k === 2) {
    return rat(2n * t, s + 1n);
  }
  return biasedRounds(k - 1, 4n * s * t, s).add(rat(2n * t));
}

export function biasedClosedForm(k: number, t: bigint, s: bigint): Rat {
  if (k < 2) {
    throw new Error("biasedClosedForm: valid for k >= 2");
  }
  const a = pow(4n * s, k - 2);
  return rat(a, s + 1n)
    .add(rat(a - 1n, 4n * s - 1n))
    .mul(rat(2n * t));
}

// ---- level plans ---------------------------------------------------------

export type Variant = "mono-1:1" | "mono-1:s" | "bichromatic";

export interface RunSpec {
  readonly variant: Variant;
  readonly k: number;
  // mono: number of parallel k-strips to guarantee (t);
  // bichromatic: r, the number of parallel k-strips to guarantee.
  readonly t: bigint;
  // mono-1:s: integer s >= 1 (Breaker points per Maker point).
  // bichromatic: rational s in [0,2) (Breaker points per Maker point;
  // after Maker's m-th point Breaker has floor(m*s) points in total).
  readonly s?: Rat;
}

export interface LevelPlan {
  readonly level: number; // 1 = base
  readonly kind: "base" | "pairing" | "grouping" | "bichromatic-pairing";
  readonly strips: bigint; // strips this level must deliver (t_level / R_level)
  readonly makerMoves: bigint;
  readonly breakerMoves: bigint;
  readonly units: bigint; // pairs / groups
  readonly regions: bigint; // candidate regions examined
  readonly inputStrips: bigint; // (level-1)-strips consumed
}

export interface Estimate {
  readonly spec: RunSpec;
  readonly supported: boolean;
  readonly unsupportedReason: string | null;
  readonly levels: readonly LevelPlan[];
  readonly rounds: bigint; // integer rounds executed
  readonly points: bigint; // all points (both players)
  readonly regions: bigint;
  readonly peakStrips: bigint;
  readonly work: bigint; // abstract exact-operation units (relative cost)
  readonly paperRounds: Rat | null; // the paper's (fractional) closed form where it applies
}

export const MAX_K = 12; // estimator sanity cap (execution is budget-gated)

function noEstimate(spec: RunSpec, why: string): Estimate {
  return {
    spec,
    supported: false,
    unsupportedReason: why,
    levels: [],
    rounds: 0n,
    points: 0n,
    regions: 0n,
    peakStrips: 0n,
    work: 0n,
    paperRounds: null,
  };
}

export function estimateCost(spec: RunSpec): Estimate {
  const { k, t } = spec;
  if (!Number.isInteger(k) || k < 1 || k > MAX_K || t < 1n) {
    return noEstimate(spec, "k must be an integer in [1,12] and t >= 1");
  }
  const levels: LevelPlan[] = [];
  let paperRounds: Rat | null = null;
  if (spec.variant === "mono-1:1" || spec.variant === "mono-1:s") {
    const s =
      spec.variant === "mono-1:1"
        ? 1n
        : spec.s !== undefined && spec.s.d === 1n && spec.s.n >= 1n
          ? spec.s.n
          : -1n;
    if (s < 1n) {
      return noEstimate(spec, "mono-1:s needs an integer s >= 1");
    }
    if (k === 1) {
      const rounds = (t + s) / (s + 1n); // ceil(t/(s+1)) with t>=1
      levels.push({
        level: 1,
        kind: "base",
        strips: t,
        makerMoves: rounds,
        breakerMoves: rounds * s,
        units: 0n,
        regions: 0n,
        inputStrips: 0n,
      });
      paperRounds = rat(t, s + 1n);
    } else {
      // t_level: strips delivered at `level`; t_(level-1) = 4 s t_level.
      const tl: bigint[] = [];
      let cur = t;
      for (let lv = k; lv >= 2; lv -= 1) {
        tl[lv] = cur;
        cur = 4n * s * cur;
      }
      const t2 = tl[2] as bigint;
      const baseRounds = (2n * t2 + s) / (s + 1n); // ceil(2 t2 / (s+1))
      levels.push({
        level: 2,
        kind: "base",
        strips: t2,
        makerMoves: baseRounds,
        breakerMoves: baseRounds * s,
        units: 0n,
        regions: 0n,
        inputStrips: 0n,
      });
      for (let lv = 3; lv <= k; lv += 1) {
        const tt = tl[lv] as bigint;
        levels.push({
          level: lv,
          kind: s === 1n && spec.variant === "mono-1:1" ? "pairing" : "grouping",
          strips: tt,
          makerMoves: 2n * tt,
          breakerMoves: 2n * tt * s,
          units: 2n * tt,
          regions: 4n * s * tt,
          inputStrips: 4n * s * tt,
        });
      }
      paperRounds =
        spec.variant === "mono-1:1"
          ? monoClosedForm(k, t)
          : biasedClosedForm(k, t, s);
    }
  } else {
    const s = spec.s ?? Rat.ZERO;
    if (s.isNeg() || s.cmp(rat(2n)) >= 0) {
      return noEstimate(spec, "bichromatic bias s must satisfy 0 <= s < 2");
    }
    const eps = rat(2n).sub(s);
    // strict-parallel parameter: t = ceil(2R/eps)  (see docs/KSTRIP.md)
    const req: bigint[] = [];
    const tt: bigint[] = [];
    let cur = t;
    for (let lv = k; lv >= 2; lv -= 1) {
      req[lv] = cur;
      tt[lv] = ceilRat(rat(2n * cur).div(eps));
      cur = 2n * (tt[lv] as bigint);
    }
    const baseMoves = k === 1 ? t : cur;
    levels.push({
      level: 1,
      kind: "base",
      strips: baseMoves,
      makerMoves: baseMoves,
      breakerMoves: floorRat(rat(baseMoves).mul(s)),
      units: 0n,
      regions: 0n,
      inputStrips: 0n,
    });
    for (let lv = 2; lv <= k; lv += 1) {
      const m = tt[lv] as bigint;
      levels.push({
        level: lv,
        kind: "bichromatic-pairing",
        strips: req[lv] as bigint,
        makerMoves: m,
        breakerMoves: floorRat(rat(m).mul(s)),
        units: m,
        regions: 2n * m,
        inputStrips: 2n * m,
      });
    }
  }
  let rounds = 0n;
  let points = 0n;
  let regions = 0n;
  let peak = 0n;
  let work = 0n;
  for (const lv of levels) {
    rounds += lv.makerMoves;
    points += lv.makerMoves + lv.breakerMoves;
    regions += lv.regions;
    if (lv.inputStrips > peak) {
      peak = lv.inputStrips;
    }
    if (lv.strips > peak) {
      peak = lv.strips;
    }
    // one ledger rebuild per Breaker move (regions x points) + a legality
    // check per move (points) + final verification (strips x points).
    work +=
      (lv.breakerMoves + lv.makerMoves) * (lv.regions * points + points) +
      lv.strips * points;
  }
  return {
    spec,
    supported: true,
    unsupportedReason: null,
    levels,
    rounds,
    points,
    regions,
    peakStrips: peak,
    work,
    paperRounds,
  };
}

export interface Budget {
  readonly maxPoints: bigint;
  readonly maxRounds: bigint;
  readonly maxRegions: bigint;
  readonly maxStrips: bigint;
  readonly maxWork: bigint;
  // true: refuse BEFORE execution when the estimate exceeds a cap.
  readonly preflight: boolean;
}

// Default: enough for 1:1, k=5, t=1 (212 points) and the bichromatic k=3
// instances exercised in the tests; refuses k=6 (852 points) and above.
export const DEFAULT_BUDGET: Budget = {
  maxPoints: 400n,
  maxRounds: 250n,
  maxRegions: 1000n,
  maxStrips: 400n,
  maxWork: 2_000_000_000n,
  preflight: true,
};

export type BudgetCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly exceeded: readonly string[] };

export function checkBudget(est: Estimate, b: Budget): BudgetCheck {
  const exceeded: string[] = [];
  if (!est.supported) {
    exceeded.push(`unsupported: ${est.unsupportedReason ?? "?"}`);
  }
  if (est.points > b.maxPoints) {
    exceeded.push(`points ${est.points} > ${b.maxPoints}`);
  }
  if (est.rounds > b.maxRounds) {
    exceeded.push(`rounds ${est.rounds} > ${b.maxRounds}`);
  }
  if (est.regions > b.maxRegions) {
    exceeded.push(`regions ${est.regions} > ${b.maxRegions}`);
  }
  if (est.peakStrips > b.maxStrips) {
    exceeded.push(`strips ${est.peakStrips} > ${b.maxStrips}`);
  }
  if (est.work > b.maxWork) {
    exceeded.push(`work ${est.work} > ${b.maxWork}`);
  }
  return exceeded.length === 0 ? { ok: true } : { ok: false, exceeded };
}

// Theorem 5 counting for t extension points (2t candidates, t pairs) against
// B = floor(t*s) Breaker points, each spoiling at most ONE candidate after
// the tilt. The paper counts alive CANDIDATES (>= 2t - B = eps*t); two alive
// candidates of one pair share the halfline below p_j and are NOT parallel
// (Definition 2 needs disjoint regions), so only t - floor(B/2) pairs are
// guaranteed to contribute a PARALLEL strip. The executor therefore uses
// t = ceil(2r/eps) (strict), not the paper's ceil(r/eps).
export function bichromaticGuarantee(
  t: bigint,
  s: Rat,
): {
  readonly breakerPoints: bigint;
  readonly candidatesAliveAtLeast: bigint;
  readonly parallelStripsAtLeast: bigint;
} {
  const b = floorRat(rat(t).mul(s));
  const alive = 2n * t - b;
  const par = t - b / 2n;
  return {
    breakerPoints: b,
    candidatesAliveAtLeast: alive < 0n ? 0n : alive,
    parallelStripsAtLeast: par < 0n ? 0n : par,
  };
}
