// kstrip/policies.ts — deterministic Breaker policies with machine-readable
// reasons. HEURISTICS ONLY: no minimax / search, no optimality claim. The
// strategy-aware policy targets what the counting argument says is cheapest
// to destroy; the theorems guarantee Maker survives it anyway.
import { pt } from "../geometry/pt.ts";
import type { Pt } from "../geometry/pt.ts";
import { Rat } from "../geometry/rat.ts";
import type { Ledger, RegionStatus, UnitStatus } from "./ledger.ts";
import type { StripRegion } from "./region.ts";
import { Prng } from "./types.ts";
import type { BreakerDecision, BreakerPolicy, BreakerView, MoveReason } from "./types.ts";

const SHIFTS: readonly Rat[] = [
  Rat.ZERO,
  Rat.make(1n, 8n),
  Rat.make(-1n, 8n),
  Rat.make(1n, 4n),
  Rat.make(-1n, 4n),
  Rat.make(1n, 16n),
  Rat.make(-1n, 16n),
  Rat.make(3n, 16n),
  Rat.make(-3n, 16n),
];

// Strictly interior, legal point of a region (current-frame coordinates).
export function interiorLegal(region: StripRegion, view: BreakerView): Pt | null {
  for (let drop = 1n; drop <= 40n; drop += 1n) {
    for (const sh of SHIFTS) {
      const p = region.interiorPoint(Rat.make(drop), sh);
      if (p !== null && region.classify(p) === "interior" && view.legal(p).ok) {
        return p;
      }
    }
  }
  return null;
}

// Deterministic legal point far to the right of everything (a "wasted" move).
export function farLegal(view: BreakerView): Pt {
  const bb = view.bbox();
  for (let i = 1n; i < 5000n; i += 1n) {
    const p = pt(bb.xMax.x.add(Rat.make(i)), bb.yMax.y.add(Rat.make(i * i)));
    if (view.legal(p).ok) {
      return p;
    }
  }
  throw new Error("farLegal: no legal far point");
}

function reason(
  policy: string,
  code: string,
  summary: string,
  target: MoveReason["target"],
  data: MoveReason["data"],
): MoveReason {
  return { policy, code, summary, target, data };
}

// ---------------------------------------------------------------------------
export function createRandomLegalPolicy(seed: number): BreakerPolicy {
  const rng = new Prng(seed);
  const name = "random-legal";
  return {
    name,
    choose(view: BreakerView): BreakerDecision {
      const bb = view.bbox();
      const w = bb.xMax.x.sub(bb.xMin.x).add(Rat.make(2n));
      const h = bb.yMax.y.sub(bb.yMin.y).add(Rat.make(2n));
      const den = 2n;
      for (let attempt = 1; attempt <= 400; attempt += 1) {
        const fx = Rat.make(rng.below(den * 2n) - den / 2n, den);
        const fy = Rat.make(rng.below(den * 2n) - den / 2n, den);
        const p = pt(bb.xMin.x.add(w.mul(fx)), bb.yMin.y.add(h.mul(fy)));
        if (view.legal(p).ok) {
          return {
            point: p,
            reason: reason(name, "random", "uniform random legal point", null, {
              attempts: attempt,
              seeded: true,
            }),
          };
        }
      }
      return {
        point: farLegal(view),
        reason: reason(name, "fallback-far", "random search exhausted", null, {
          attempts: 400,
        }),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Baseline: block the FIRST live region in (unit, region) order.
export function createGreedyBlockingPolicy(): BreakerPolicy {
  const name = "greedy-blocking";
  return {
    name,
    choose(view: BreakerView): BreakerDecision {
      const led = view.ledger();
      if (led !== null) {
        for (const u of led.units) {
          for (const r of u.regions) {
            if (!r.live) {
              continue;
            }
            const p = interiorLegal(r.region, view);
            if (p !== null) {
              return {
                point: p,
                reason: reason(
                  name,
                  "block-first-live-region",
                  "interior point of the first live region in index order",
                  { unit: u.unit, region: r.id },
                  { unitNeed: u.need, remaining: led.budgetRemaining },
                ),
              };
            }
          }
        }
      }
      return {
        point: farLegal(view),
        reason: reason(name, "nothing-to-block", "no live region", null, {}),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Strategy-aware heuristic: reads the live ledger.
//  * units that cannot be killed with the remaining budget are ignored
//    (a point spent there is wasted);
//  * among killable units choose the CHEAPEST (fewest live regions: a pair
//    with one region already blocked needs one more point, an untouched pair
//    two): this maximises dead units per point, the exact quantity the
//    pigeonhole count bounds;
//  * ties: the unit whose region has the widest chain edge (more room for a
//    legal interior point), then the lowest index;
//  * points are always strictly interior (never on shared halflines /
//    boundaries, which the adoption rule would absorb for free).
export function createStrategyAwarePolicy(): BreakerPolicy {
  const name = "strategy-aware";
  return {
    name,
    choose(view: BreakerView): BreakerDecision {
      const led: Ledger | null = view.ledger();
      if (led === null) {
        return {
          point: farLegal(view),
          reason: reason(name, "no-ledger", "no counting structure in this phase", null, {}),
        };
      }
      const remaining = led.budgetRemaining;
      const cands: UnitStatus[] = led.units.filter((u) => !u.dead && u.need <= remaining);
      cands.sort((a, b) => a.need - b.need || a.unit - b.unit);
      for (const u of cands) {
        const live: RegionStatus[] = u.regions.filter((r) => r.live);
        for (const r of live) {
          const p = interiorLegal(r.region, view);
          if (p !== null) {
            return {
              point: p,
              reason: reason(
                name,
                u.need === 1 ? "finish-unit" : "start-cheapest-unit",
                u.need === 1
                  ? "one more interior point kills this unit"
                  : "cheapest killable unit (fewest live regions)",
                { unit: u.unit, region: r.id },
                {
                  unitNeed: u.need,
                  remaining,
                  killableUnits: cands.length,
                  avoidedBoundary: true,
                },
              ),
            };
          }
        }
      }
      return {
        point: farLegal(view),
        reason: reason(
          name,
          "cannot-kill",
          "no unit can be killed with the remaining budget; spend no structure",
          null,
          { remaining, liveUnits: led.survivorsNow },
        ),
      };
    },
  };
}
