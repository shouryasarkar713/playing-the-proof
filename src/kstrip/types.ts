// kstrip/types.ts — shared types of the executor, the move log and the
// Breaker policies. Pure data; no behaviour.
import type { Pt } from "../geometry/pt.ts";
import type { Dir, Frame } from "./frame.ts";
import type { Ledger, OwnedPoint, Owner } from "./ledger.ts";
import type { Budget, Estimate, RunSpec } from "./recursion.ts";
import type { StripRegion } from "./region.ts";

export type PhaseKind =
  | "base"
  | "pairing"
  | "grouping"
  | "bichromatic-base"
  | "bichromatic-pairing";

export type MoveKind = "base-point" | "apex" | "breaker";

// Machine-readable explanation attached to every Breaker move.
export interface MoveReason {
  readonly policy: string;
  readonly code: string;
  readonly summary: string;
  // The structure the move was aimed at (null when none).
  readonly target: { readonly unit: number; readonly region: string } | null;
  // Free-form scalar facts used to choose (need, remaining budget, ...).
  readonly data: Readonly<Record<string, string | number | boolean | null>>;
}

export interface LegalResult {
  readonly ok: boolean;
  readonly code: "ok" | "duplicate" | "collinear" | "same-x";
  readonly message: string;
}

export interface BreakerView {
  readonly variant: RunSpec["variant"];
  readonly phase: PhaseKind;
  readonly level: number;
  readonly levelRound: number; // 1-based Maker move index within the phase
  readonly breakerMovesLeftInPhase: number; // including this move
  readonly breakerMovesTotalInPhase: number;
  readonly frame: Frame;
  // Every point on the board in the CURRENT FRAME's coordinates (the frame
  // is the identity in the monochromatic variants).
  readonly points: readonly OwnedPoint[];
  // Counting ledger (null in base phases). Lazily built; coordinates as above.
  ledger(): Ledger | null;
  legal(p: Pt): LegalResult;
  bbox(): { xMin: Pt; xMax: Pt; yMin: Pt; yMax: Pt };
}

export interface BreakerDecision {
  readonly point: Pt; // current-frame coordinates
  readonly reason: MoveReason;
}

export interface BreakerPolicy {
  readonly name: string;
  choose(view: BreakerView): BreakerDecision;
}

export interface MoveLogEntry {
  readonly n: number; // 1-based move number over the whole run
  readonly round: number; // 1-based global round (one Maker move + replies)
  readonly phase: PhaseKind;
  readonly level: number;
  readonly levelRound: number;
  readonly player: Owner;
  readonly kind: MoveKind;
  readonly pt: Pt; // base coordinates
  readonly ptFrame: Pt; // coordinates in the frame in force
  readonly frameC: string; // shear coefficient of the frame in force (Rat string)
  readonly note: string;
  readonly reason: MoveReason | null;
}

export interface StripClaim {
  readonly level: number; // k of the claimed strip
  readonly vertices: readonly Pt[]; // base coordinates, sorted along the frame x
  readonly direction: Dir; // the common halfline direction v (base coordinates)
  readonly region: StripRegion;
}

export type RunStatus =
  | "completed"
  | "budget-exhausted"
  | "refused"
  | "unsupported"
  | "invalid-breaker-move"
  | "invariant-failure";

export interface LevelReport {
  readonly level: number;
  readonly phase: PhaseKind;
  readonly units: number;
  readonly required: number;
  readonly survivors: number;
  readonly guaranteedAtEnd: number;
  readonly breakerMoves: number;
  readonly absorbedBreakerPoints: number;
  readonly wastedBreakerPoints: number;
  readonly interiorBreakerPoints: number;
  readonly proposition1Holds: boolean;
  readonly tilt: string | null;
}

export interface RunResult {
  readonly status: RunStatus;
  readonly message: string;
  readonly estimate: Estimate;
  readonly budget: Budget;
  readonly claims: readonly StripClaim[];
  readonly goal: bigint;
  readonly goalMet: boolean;
  readonly rounds: number;
  readonly points: readonly { readonly pt: Pt; readonly owner: Owner }[]; // base coords
  readonly log: readonly MoveLogEntry[];
  readonly levels: readonly LevelReport[];
  readonly checks: readonly { readonly name: string; readonly ok: boolean }[];
  readonly work: bigint;
}

// Seeded PRNG on bigint (xorshift64*), deterministic across platforms.
export class Prng {
  private state: bigint;
  private static readonly MASK = (1n << 64n) - 1n;

  constructor(seed: number) {
    let s = (BigInt(seed) * 0x9e3779b97f4a7c15n + 0x1234567n) & Prng.MASK;
    if (s === 0n) {
      s = 0x2545f4914f6cdd1dn;
    }
    this.state = s;
  }

  nextBig(): bigint {
    let x = this.state;
    x ^= x >> 12n;
    x ^= (x << 25n) & Prng.MASK;
    x ^= x >> 27n;
    this.state = x;
    return (x * 0x2545f4914f6cdd1dn) & Prng.MASK;
  }

  // uniform-ish integer in [0, n)
  below(n: bigint): bigint {
    return (this.nextBig() >> 11n) % n;
  }
}
