// kstrip/trace.ts — OPTIONAL observation of a run (pure data, no behaviour).
//
// `runKStrip(..., { trace })` calls the observer at the structural points of
// the construction: the start of a phase (input strips, planned pairs/groups
// with their halflines and extension cones), after every move of a pairing or
// grouping phase (a counting-ledger snapshot with the live candidate regions),
// and at the end of a phase (the harvested strips and the level report).
//
// The observer never influences the run: it receives plain data in BASE
// coordinates (the runner's frame is already undone), the counting snapshot is
// built with the same exported `buildLedger` the policies use, and no work is
// metered for it (a traced run and an untraced run have identical logs).
// Display layers (ui/) draw from these objects; they re-derive no geometry.
import type { Pt } from "../geometry/pt.ts";
import type { Dir } from "./frame.ts";
import type { Ledger, PlacementCategory, UnitSpec } from "./ledger.ts";
import type { LevelReport, MoveLogEntry, PhaseKind } from "./types.ts";

export interface TraceCone {
  readonly side: "minus" | "plus";
  readonly apex: Pt;
  // A second point on the stopping ray (apex + ray direction), base coordinates.
  readonly rayTo: Pt;
  readonly stop: "edge-line" | "blocked" | "horizontal-convention";
  readonly blocker: Pt | null;
}

// A pair (Theorem 3/5: two strips) or a group (Theorem 4: 2s strips) as PLANNED
// at the start of the phase (a later line re-plan is visible in the move log).
export interface TraceUnit {
  readonly unit: number;
  readonly strips: readonly (readonly Pt[])[];
  // Upper end of the halfline l_j ∩ cones (base coordinates); the halfline
  // runs from here in direction `dir` of the enclosing event.
  readonly lineTop: Pt;
  // pair: [C+ of the left strip, C- of the right strip]; group: C- of every strip.
  readonly cones: readonly TraceCone[];
}

export interface TraceRegion {
  readonly id: string;
  readonly unit: number;
  // The chain vertices in base coordinates; the region is conv(chain) + halfline(dir).
  readonly chain: readonly Pt[];
  readonly live: boolean;
  readonly interiorBreakers: number;
  readonly interiorMakers: number;
  readonly boundary: number;
}

export interface TraceUnitStat {
  readonly unit: number;
  readonly liveRegions: number;
  readonly need: number;
  readonly dead: boolean;
  readonly absorbed: number;
  readonly breakerInteriorInUnion: number;
}

export interface TraceAdoption {
  readonly unit: number;
  readonly kind: "apex" | "left-end" | "right-end";
  readonly from: Pt;
  readonly to: Pt;
  readonly absorbed: readonly Pt[];
}

export interface TraceLedger {
  readonly required: number;
  readonly budgetTotal: number;
  readonly breakerUsed: number;
  readonly budgetRemaining: number;
  readonly deadUnits: number;
  readonly survivorsNow: number;
  readonly maxFurtherKills: number;
  readonly guaranteedSurvivors: number;
  readonly units: readonly TraceUnitStat[];
  // One per Breaker move of the phase, in move order.
  readonly placements: readonly {
    readonly pt: Pt;
    readonly category: PlacementCategory;
    readonly unit: number | null;
    readonly region: string | null;
  }[];
  readonly proposition1: {
    readonly unitsWithTwoOrMoreInteriorBreakers: number;
    readonly boundOnSuchUnits: number;
    readonly holds: boolean;
  };
  // Adoption events that actually moved a vertex (from != to).
  readonly adoptions: readonly TraceAdoption[];
}

export type TraceEvent =
  | {
      // Every point placed (both players, every phase), in log order; emitted
      // BEFORE the matching "ledger" snapshot. Lets a viewer follow (or keep a
      // partial log of) a run that has not finished.
      readonly kind: "move";
      readonly entry: MoveLogEntry;
    }
  | {
      readonly kind: "phase-start";
      readonly phase: PhaseKind;
      readonly level: number;
      // Number of log entries before this event.
      readonly logLength: number;
      readonly dir: Dir;
      readonly required: number;
      readonly units: number;
      readonly breakerBudget: number;
      readonly inputs: readonly (readonly Pt[])[];
      readonly plans: readonly TraceUnit[];
    }
  | {
      readonly kind: "ledger";
      readonly phase: PhaseKind;
      readonly level: number;
      readonly logLength: number;
      readonly dir: Dir;
      readonly regions: readonly TraceRegion[];
      readonly ledger: TraceLedger;
    }
  | {
      readonly kind: "phase-end";
      readonly phase: PhaseKind;
      readonly level: number;
      readonly logLength: number;
      readonly dir: Dir;
      // The strips delivered to the next level (base coordinates).
      readonly chosen: readonly (readonly Pt[])[];
      readonly regions: readonly TraceRegion[];
      readonly ledger: TraceLedger | null;
      readonly report: LevelReport | null;
    };

export type TraceObserver = (e: TraceEvent) => void;

// Summarise a ledger (frame coordinates) into trace data (base coordinates).
export function summarizeLedger(
  ledger: Ledger,
  specs: readonly UnitSpec[],
  toBase: (p: Pt) => Pt,
): { regions: TraceRegion[]; ledger: TraceLedger } {
  const regions: TraceRegion[] = [];
  for (const u of ledger.units) {
    for (const r of u.regions) {
      regions.push({
        id: r.id,
        unit: u.unit,
        chain: r.region.vertices.map(toBase),
        live: r.live,
        interiorBreakers: r.interior.filter((p) => p.owner === "breaker").length,
        interiorMakers: r.interior.filter((p) => p.owner === "maker").length,
        boundary: r.boundary.length,
      });
    }
  }
  const adoptions: TraceAdoption[] = [];
  for (const s of specs) {
    for (const a of s.adoption) {
      if (a.from.x.equals(a.to.x) && a.from.y.equals(a.to.y)) {
        continue;
      }
      adoptions.push({
        unit: s.unit,
        kind: a.kind,
        from: toBase(a.from),
        to: toBase(a.to),
        absorbed: a.absorbed.map(toBase),
      });
    }
  }
  return {
    regions,
    ledger: {
      required: ledger.required,
      budgetTotal: ledger.budgetTotal,
      breakerUsed: ledger.breakerUsed,
      budgetRemaining: ledger.budgetRemaining,
      deadUnits: ledger.deadUnits,
      survivorsNow: ledger.survivorsNow,
      maxFurtherKills: ledger.maxFurtherKills,
      guaranteedSurvivors: ledger.guaranteedSurvivors,
      units: ledger.units.map((u) => ({
        unit: u.unit,
        liveRegions: u.liveRegions,
        need: u.need,
        dead: u.dead,
        absorbed: u.absorbed.length,
        breakerInteriorInUnion: u.breakerInteriorInUnion,
      })),
      placements: ledger.placements.map((p) => ({
        pt: toBase(p.pt),
        category: p.category,
        unit: p.unit,
        region: p.region,
      })),
      proposition1: ledger.proposition1,
      adoptions,
    },
  };
}
