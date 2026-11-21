// game/types.ts — the §5 core state model (authoritative semantic state).
//
// GameState and StrategyRuntime are immutable value objects (§5.4): every
// field readonly, transitions return new objects (placePoint, withStrategy,
// withTerminal, withSeq). No derived caches live here — hole results are
// HoleAnalysis values computed on demand (§7.3).
import type { Rat } from "../geometry/rat.ts";
import type { Pt } from "../geometry/pt.ts";
import type {
  HoleAnalysis,
  IdPt,
  KHole,
  PointId,
} from "../geometry/holes.ts";
import type {
  CheckResult,
  IntegrityReport,
  VerificationResult,
} from "./integrity.ts";

export type {
  Rat,
  Pt,
  HoleAnalysis,
  IdPt,
  KHole,
  PointId,
  CheckResult,
  IntegrityReport,
  VerificationResult,
};

export type Player = "maker" | "breaker";
export type NodeId = string;
export type CaseId = string;
export type VarName = string;

// The winning-hole rule (bichromatic game, Dzuklevski et al. / Aichholzer et
// al.). "monochromatic": a k-hole may use points of either player.
// "bichromatic": a winning k-hole consists ONLY of Maker's points; Breaker's
// points count only as interior blockers and never become hole vertices.
export type GameMode = "monochromatic" | "bichromatic";

export interface WindowBounds {
  readonly xMin: Rat;
  readonly xMax: Rat;
  readonly yMin: Rat;
  readonly yMax: Rat;
}

export interface PlacedPoint {
  readonly id: PointId;
  readonly owner: Player;
  readonly pt: Pt;
  readonly move: number; // 1-based, == index in order
}

export interface GameState {
  readonly seq: number; // owning committed txn id (§5.5 SeqFinalization)
  readonly k: 3 | 4 | 5 | 6 | 7 | 8;
  readonly mode: "proof" | "break" | "sandbox";
  // ABSENT means "monochromatic" (every pre-existing state, hash and replay
  // is monochromatic). Present only as "bichromatic": the property is
  // omitted, never set to "monochromatic", so monochromatic states stay
  // structurally and hash-wise identical (see gamemode.ts gameModeOf).
  readonly gameMode?: GameMode;
  readonly points: readonly PlacedPoint[];
  readonly turn: Player | "over";
  readonly terminal: Terminal | null;
  readonly strategy: StrategyRuntime | null; // null iff sandbox
}

export type Terminal =
  | { kind: "maker-won"; k: number; witness: readonly KHole[]; nodeId: NodeId }
  | { kind: "strategy-integrity-failure"; report: IntegrityReport }
  | { kind: "uncovered"; report: UncoveredReport };

export interface StrategyRuntime {
  readonly strategyId: string;
  readonly version: string;
  readonly nodeId: NodeId;
  readonly vars: Readonly<Record<VarName, Binding>>;
  readonly lastCase: CaseId | null;
}

// StrategyStart (§24.0b) — how a k=6 session acquires its pre-existing
// 5-hole. Runtime form carries Pt values (game-native); the wire form
// (StrategyStartJSON, "n/d" strings) lands with the replay codec (Phase 15).
export type StrategyStart =
  | {
      kind: "continue";
      points: readonly Pt[];
      owners: readonly Player[];
      selectedHole: readonly Pt[] | null;
    }
  | {
      kind: "supplied";
      points: readonly Pt[];
      selectedHole: readonly Pt[];
      owners?: readonly Player[];
    }
  | { kind: "fixture"; scenarioRef: string };

export type Binding = PointId | Rat | readonly PointId[];

export type UncoveredReport =
  | {
      origin: "breaker-reply";
      reason: "partial-encoding" | "experimental-disabled";
      at: { nodeId: NodeId; breakerPoint: PointId };
      detail: string;
    }
  | {
      origin: "maker-construction";
      reason: "window-exhausted";
      at: { nodeId: NodeId; move: MoveSpecRef };
      detail: string;
    };

// game/ owns no strategy AST (§18.1): the maker-construction report cites
// the move by an opaque descriptor. The structured MoveSpec lives in
// strategy/types.ts (Phase 9); this alias keeps the report total now.
export type MoveSpecRef = { readonly kind: string };

export type UserAction =
  | { kind: "place"; owner: Player; at: Pt }
  | { kind: "sample"; caseId: CaseId; at: Pt };

export type Intent =
  | { kind: "placement"; owner: Player; at: Pt }
  | { kind: "rejected"; reason: Rejection };

export type Rejection =
  | { reason: "outside-window"; at: Pt }
  | { reason: "coincides-with-existing-point"; at: Pt; with: PointId }
  | { reason: "collinear-with"; at: Pt; pair: [PointId, PointId] }
  | { reason: "ui-too-close"; at: Pt }
  // a placement the session cannot accept right now — the game is
  // over, or (guided modes) the placement's owner is not Breaker.
  | { reason: "wrong-turn"; at: Pt; detail: "game-over" | "not-breaker" | "point-cap" };

export interface RawEvent {
  readonly owner: Player;
  readonly at: Pt;
  readonly appliedPoint: PointId;
  readonly caseId?: CaseId;
  readonly nodeAfter: NodeId | null;
  readonly stateHash: string;
}

export interface MoveEvent extends RawEvent {
  readonly i: number;
  readonly txnId: number;
  readonly indexInTxn: number;
  readonly parent: number | null;
}

export interface ActionTransaction {
  readonly txnId: number;
  readonly parentTxnId: number | null;
  readonly action: UserAction | { kind: "init" };
  readonly events: readonly MoveEvent[];
  readonly beforeHash: string | null;
  readonly afterHash: string;
  readonly result:
    | { kind: "committed" }
    | { kind: "terminal"; terminal: Terminal };
}

export interface SessionTree {
  events: readonly MoveEvent[];
  transactions: readonly ActionTransaction[];
}

export interface SessionSnapshot {
  state: GameState;
  cursorTxnId: number;
}

export type NavigationOp =
  | { kind: "goto"; txnId: number }
  | { kind: "undo" }
  | { kind: "branch"; atTxnId: number };

export interface Configuration {
  window: WindowBounds;
  ui: { minSeparationPx: number; theme: "light"; autoplayMs: number };
  engine: { maxPoints: number };
  analysis: { budgetOps: number };
}

export interface SessionConfig {
  mode: "proof" | "break" | "sandbox";
  window: WindowBounds;
  // Optional; absent === "monochromatic".
  gameMode?: GameMode;
}

export type Diagnostic =
  | { kind: "rejection"; rejection: Rejection }
  | { kind: "analysis-note"; note: HoleAnalysis }
  | { kind: "timing"; label: string; ms: number };

// withStrategy (§10.9, game/types companion): new state with
// strategy = fn(old); the SINGLE WRITER of runtime changes in the chain.
export function withStrategy(
  state: GameState,
  fn: (rt: StrategyRuntime) => StrategyRuntime,
): GameState {
  if (state.strategy === null) {
    throw new Error("withStrategy: state has no strategy — implementation error");
  }
  return deepFreeze({ ...state, strategy: fn(state.strategy) });
}

const DEV: boolean =
  (import.meta as unknown as { env?: { DEV?: unknown } }).env?.DEV !==
  false;

// deepFreeze (§5.4 immutability discipline): the dev build freezes every
// emitted state and stored tree node, so any mutation attempt throws in
// development and testing. No-op in production builds.
export function deepFreeze<T>(value: T): T {  if (!DEV) {
    return value;
  }
  const seen = new Set<object>();
  const visit = (v: unknown): void => {
    if (v === null || typeof v !== "object") {
      return;
    }
    if (seen.has(v)) {
      return;
    }
    seen.add(v);
    if (Array.isArray(v)) {
      for (const item of v) {
        visit(item);
      }
    } else {
      for (const key of Object.keys(v)) {
        visit((v as Record<string, unknown>)[key]);
      }
    }
    Object.freeze(v);
  };
  visit(value);
  return value;
}

// withSeq (§5.5 SeqFinalization): the ONLY seq write in the system (moved
// here from session/commit.ts in Phase 15 so the replay fold — which may
// not import session/ (§18.1) — finalizes exactly like commit does).
export function withSeq(state: GameState, id: number): GameState {
  return deepFreeze({ ...state, seq: id });
}
