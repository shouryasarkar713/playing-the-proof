// kstrip/ledger.ts — the counting ledger (Proposition 1 / Theorem 3-5 counts).
//
// A phase has U "units" (pairs of candidate regions for Theorem 3, groups of
// 2s strip regions for Theorem 4, pairs of tilted candidates for Theorem 5).
// A region is LIVE iff no point of the board other than its own vertices lies
// in the closed region (interior blockers AND unabsorbed boundary points both
// disqualify it; absorbed boundary points are removed by the adoption rule
// before the ledger is built). A unit is DEAD iff none of its regions is live.
//
// Exact lower bound for ANY continuation of Breaker play:
//   * the regions of different units, and the interiors of the two regions of
//     one pair, are pairwise interior-disjoint, so one new Breaker point is
//     inside at most one live region;
//   * regions only shrink (adoption / re-picked apex only move vertices down);
//   * therefore a currently live unit with n live regions needs >= n NEW
//     Breaker points to die. With R Breaker points left, at most
//     maxFurtherKills units (cheapest first) die, so
//         final live units >= U - deadNow - maxFurtherKills = guaranteedSurvivors
//   (a dead unit is conservatively assumed to stay dead).
// [theorem-level argument of the paper; property-tested by random play]
import { eqPt } from "../geometry/pt.ts";
import type { Pt } from "../geometry/pt.ts";
import type { AdoptionEvent } from "./pairing.ts";
import type { StripRegion } from "./region.ts";

export type Owner = "maker" | "breaker";

export interface OwnedPoint {
  readonly pt: Pt;
  readonly owner: Owner;
}

export interface UnitSpec {
  readonly unit: number;
  readonly regions: readonly { readonly id: string; readonly region: StripRegion }[];
  readonly adoption: readonly AdoptionEvent[];
}

export interface RegionStatus {
  readonly id: string;
  readonly region: StripRegion;
  readonly interior: readonly OwnedPoint[];
  // Non-vertex points exactly on the boundary (should be empty after adoption
  // in the monochromatic game).
  readonly boundary: readonly OwnedPoint[];
  readonly live: boolean;
}

export interface UnitStatus {
  readonly unit: number;
  readonly regions: readonly RegionStatus[];
  readonly liveRegions: number;
  readonly dead: boolean;
  // Further Breaker points needed to kill this unit (= liveRegions).
  readonly need: number;
  readonly absorbed: readonly Pt[];
  readonly breakerInteriorInUnion: number;
}

export type PlacementCategory =
  | "interior"
  | "absorbed"
  | "boundary-unabsorbed"
  | "wasted";

export interface BreakerPlacement {
  readonly pt: Pt;
  readonly category: PlacementCategory;
  readonly unit: number | null;
  readonly region: string | null;
}

export interface Ledger {
  readonly units: readonly UnitStatus[];
  readonly required: number;
  readonly budgetTotal: number;
  readonly breakerUsed: number;
  readonly budgetRemaining: number;
  readonly deadUnits: number;
  readonly survivorsNow: number;
  readonly maxFurtherKills: number;
  readonly guaranteedSurvivors: number;
  readonly placements: readonly BreakerPlacement[];
  readonly proposition1: {
    // paper: "at most t indices j with >= 2 Breaker points in int(R_{2j-1} ∪ R_{2j})"
    readonly unitsWithTwoOrMoreInteriorBreakers: number;
    readonly boundOnSuchUnits: number; // floor(budgetTotal / 2)
    readonly holds: boolean;
  };
}

export interface LedgerInput {
  readonly units: readonly UnitSpec[];
  readonly points: readonly OwnedPoint[]; // every point on the board (frame coords)
  readonly breakerPhasePoints: readonly Pt[]; // Breaker's points of THIS phase
  readonly budgetTotal: number;
  readonly required: number;
  // 'adopt' (default): boundary points block (they must have been absorbed).
  // 'pre-tilt' (Theorem 5): boundary points are tilt-resolvable and do not
  // block; the bound is the static U - floor(B/2).
  readonly mode?: "adopt" | "pre-tilt";
}

export function buildLedger(input: LedgerInput): Ledger {
  const placementByKey = new Map<string, BreakerPlacement>();
  const unitStatuses: UnitStatus[] = [];
  for (const u of input.units) {
    const regions: RegionStatus[] = [];
    const absorbed: Pt[] = [];
    for (const ev of u.adoption) {
      absorbed.push(...ev.absorbed);
    }
    for (const r of u.regions) {
      const interior: OwnedPoint[] = [];
      const boundary: OwnedPoint[] = [];
      for (const op of input.points) {
        if (r.region.vertices.some((v) => eqPt(v, op.pt))) {
          continue;
        }
        const c = r.region.classify(op.pt);
        if (c === "interior") {
          interior.push(op);
        } else if (c === "boundary") {
          boundary.push(op);
        }
      }
      regions.push({
        id: r.id,
        region: r.region,
        interior,
        boundary,
        live:
          interior.length === 0 &&
          (input.mode === "pre-tilt" || boundary.length === 0),
      });
    }
    const liveRegions = regions.filter((r) => r.live).length;
    let union = 0;
    for (const r of regions) {
      union += r.interior.filter((p) => p.owner === "breaker").length;
    }
    unitStatuses.push({
      unit: u.unit,
      regions,
      liveRegions,
      dead: liveRegions === 0,
      need: liveRegions,
      absorbed,
      breakerInteriorInUnion: union,
    });
    for (const r of regions) {
      for (const p of r.interior) {
        if (p.owner === "breaker") {
          placementByKey.set(key(p.pt), {
            pt: p.pt,
            category: "interior",
            unit: u.unit,
            region: r.id,
          });
        }
      }
      for (const p of r.boundary) {
        if (p.owner === "breaker" && !placementByKey.has(key(p.pt))) {
          placementByKey.set(key(p.pt), {
            pt: p.pt,
            category: "boundary-unabsorbed",
            unit: u.unit,
            region: r.id,
          });
        }
      }
    }
    for (const a of absorbed) {
      if (!placementByKey.has(key(a))) {
        placementByKey.set(key(a), {
          pt: a,
          category: "absorbed",
          unit: u.unit,
          region: null,
        });
      }
    }
    // Adopted replacement vertices are Breaker points too.
    for (const ev of u.adoption) {
      if (!eqPt(ev.to, ev.from)) {
        placementByKey.set(key(ev.to), {
          pt: ev.to,
          category: "absorbed",
          unit: u.unit,
          region: null,
        });
      }
    }
  }
  const placements: BreakerPlacement[] = input.breakerPhasePoints.map(
    (p) =>
      placementByKey.get(key(p)) ?? {
        pt: p,
        category: "wasted",
        unit: null,
        region: null,
      },
  );
  const used = input.breakerPhasePoints.length;
  const remaining = input.budgetTotal > used ? input.budgetTotal - used : 0;
  const deadUnits = unitStatuses.filter((u) => u.dead).length;
  const needs = unitStatuses
    .filter((u) => !u.dead)
    .map((u) => u.need)
    .sort((a, b) => a - b);
  let spent = 0;
  let kills = 0;
  for (const n of needs) {
    if (spent + n <= remaining) {
      spent += n;
      kills += 1;
    } else {
      break;
    }
  }
  const twoPlus = unitStatuses.filter(
    (u) => u.breakerInteriorInUnion >= 2,
  ).length;
  const bound = (input.budgetTotal - (input.budgetTotal % 2)) / 2;
  return {
    units: unitStatuses,
    required: input.required,
    budgetTotal: input.budgetTotal,
    breakerUsed: used,
    budgetRemaining: remaining,
    deadUnits,
    survivorsNow: unitStatuses.length - deadUnits,
    maxFurtherKills: kills,
    guaranteedSurvivors:
      input.mode === "pre-tilt"
        ? unitStatuses.length - bound
        : unitStatuses.length - deadUnits - kills,
    placements,
    proposition1: {
      unitsWithTwoOrMoreInteriorBreakers: twoPlus,
      boundOnSuchUnits: bound,
      holds: twoPlus <= bound,
    },
  };
}

function key(p: Pt): string {
  return `${p.x.toString()}|${p.y.toString()}`;
}
