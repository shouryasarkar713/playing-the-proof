// strategy/types.ts — the §5.7 strategy-definition AST (data only).
//
// Every type here is DATA: no function values anywhere (custom invariants
// and classifiers are referenced by id through registries; §5.7). The
// RUNTIME form carries Rat objects (StrategyDef); the WIRE form
// (StrategyDefJSON, §5.7 codec) carries "n/d" strings — converted only by
// serializeStrategyDef/hydrateStrategyDef (strategy/registry.ts).
import type { Rat } from "../geometry/rat.ts";
import type { HoleAnalysis } from "../geometry/holes.ts";
import type {
  CaseId,
  Configuration,
  GameMode,
  GameState,
  NodeId,
  PointId,
  VarName,
} from "../game/types.ts";

export type { CaseId, NodeId, VarName };

export interface StrategyDef {
  id: string;
  k: 3 | 5 | 6 | 7 | 8;
  version: string;
  source: { paper: string; stepMap: Record<NodeId, string> };
  entry: NodeId;
  nodes: Record<NodeId, StrategyNode>;
  domain?: { coverage: "full" | "partial"; note?: string };
  // startVars (§24.0b): vars bound by StrategyStart before the entry node
  // runs (e.g. esmb-k6's ["P5","V0",…,"V4"]). Declared here so G10 can
  // validate reads against StrategyStart producers; bound by initSession.
  startVars?: readonly VarName[];
  // gameModes: the winning-hole rules this def's construction is valid for.
  // ABSENT means ["monochromatic"] — every shipped def. A guided session
  // under the bichromatic rule (Maker-only vertices) is refused unless the
  // def lists "bichromatic" here (engine/init.ts, fail closed).
  gameModes?: readonly GameMode[];
}

export interface StrategyNode {
  id: NodeId;
  role: "maker-move" | "classify-breaker" | "computed-step" | "terminal";
  next?: NodeId;
  move?: MoveSpec;
  placeBind?: VarName;
  compute?: ComputedOp;
  routes?: readonly RouteRule[];
  pre?: readonly InvariantSpec[];
  post?: readonly InvariantSpec[];
  show: readonly OverlaySpec[];
  why: ExplanationSpec;
  sourceRef: string;
}

export type MoveSpec =
  | { kind: "fixed"; at: readonly PtExpr[] }
  | { kind: "extend"; hole: HoleRef; prefer?: EdgeSelector }
  | { kind: "co-shoulder"; outer: TriRef; interior: VarName }
  | {
      kind: "escape-beyond-edge";
      sharedEdge: EdgeRef;
      poly: PolyRef;
      // quads (§24.3 item 1, Phase-13 refinement): the paired 4-holes whose
      // E-neighborhood filters the candidate edges. Absent (pre-13 defs) →
      // both pentagon neighbors are candidates.
      quads?: readonly [PolyRef, PolyRef];
    }
  // escape-pair-beyond-edge (Lemma 8, k = 7): A1 just outside the shared edge
  // of the two chord halves, accepted only when each half extended by the
  // anchor (B0) and the new point is an exact (|half|+2)-hole. `edge` names the
  // two shared half vertices [C, D] (CCW along `ring`), `ring` the rotated
  // hexagon (the wedge neighbours are read from it).
  | {
      kind: "escape-pair-beyond-edge";
      edge: EdgeRef;
      ring: PolyRef;
      anchor: VarName;
      halves: readonly [PolyRef, PolyRef];
    }
  // escape-edge-accept (Lemma 9 A1/A2): the new point just outside a CCW edge
  // [u, v] of `ring`, accepted only when every listed id-list extended by the
  // new point is an exact hole (|list|+1 vertices) and, with `meet`, the first
  // two such holes meet exactly in a convex `meet`-gon. Options are tried in
  // order (first success wins).
  | { kind: "escape-edge-accept"; options: readonly EscapeEdgeOption[] }
  // forcing-pair (Lemma 9 A3): a point just outside an edge of the 7-hole
  // `ring`, accepted when two 6-holes through it meet exactly in a triangle and
  // neither has all three `chain` vertices consecutive.
  | { kind: "forcing-pair"; ring: PolyRef; chain: readonly [VarName, VarName, VarName] }
  // double-extend (Lemma 9 A4): near the unique common vertex of two
  // interior-disjoint `holeSize`-holes, accepted when the point extends BOTH to
  // exact (holeSize+1)-holes with disjoint interiors.
  | { kind: "double-extend"; holeSize: number };

export interface EscapeEdgeOption {
  edge: EdgeRef;
  ring: PolyRef;
  grow: readonly PolyRef[];
  meet?: number;
}

export type ComputedOp =
  | {
      kind: "select-anchored-shared-edge-pair";
      k: number;
      anchorVar: VarName;
      polyVar: VarName;
      binds: { sharedEdge: VarName; quadA: VarName; quadB: VarName };
    }
  | {
      kind: "select-twin-pair";
      anchorVar: VarName;
      binds: { twinA: VarName; twinB: VarName };
    }
  // select-chord-half-pair (Lemma 8): from the bound hexagon `holeVar` and the
  // Breaker point `anchorVar`, bind the rotated ring (v0..v5 single ids), the
  // shared edge [v2, v3] and the two chord halves [v0..v3], [v2..v5].
  | {
      kind: "select-chord-half-pair";
      holeVar: VarName;
      anchorVar: VarName;
      binds: {
        v0: VarName;
        v1: VarName;
        v2: VarName;
        v3: VarName;
        v4: VarName;
        v5: VarName;
        ring: VarName;
        edge: VarName;
        halfA: VarName;
        halfB: VarName;
      };
    }
  // select-twin-holes (Lemma 8): enumerate the (holeSize)-holes and bind the
  // canonical exact quad-twins for the anchors (A1, B0) — see
  // geometry/twinsK7.ts twinQuadEars.
  | {
      kind: "select-twin-holes";
      holeSize: number;
      anchorVars: readonly [VarName, VarName];
      binds: { twinA: VarName; twinB: VarName; quad: VarName };
    }
  // Lemma 9 step 1: the rotation of the 7-hole `holeVar` whose chord halves
  // survive B0 as two 5-holes meeting only in a segment. Binds v0..v6 (rotated
  // ring ids), ring, the A1 edge [v3, v4], pentA = v0..v3+B0, pentB = v3..v6+B0.
  | {
      kind: "select-heptagon-pair";
      holeVar: VarName;
      anchorVar: VarName;
      binds: {
        v0: VarName;
        v1: VarName;
        v2: VarName;
        v3: VarName;
        v4: VarName;
        v5: VarName;
        v6: VarName;
        ring: VarName;
        edge: VarName;
        pentA: VarName;
        pentB: VarName;
      };
    }
  // Lemma 9 step 3: enumerate the 6-holes after A1 and bind the canonical
  // exact triangle-twins for the anchors (A1, B0).
  | {
      kind: "select-twin-triangle";
      anchorVars: readonly [VarName, VarName];
      binds: { twinA: VarName; twinB: VarName; tri: VarName };
    }
  // Lemma 9 step 4 (Observation 1): after B1 inside the shared triangle, bind
  // the two replacement 6-holes and, per orientation, the ring/edge of the one
  // that is extended across the shared edge and the two grow-bases of the
  // other one (its replacement holes after A2).
  | {
      kind: "select-ear-replacement";
      twinA: VarName;
      twinB: VarName;
      tri: VarName;
      b1Var: VarName;
      binds: {
        ring1: VarName;
        edge1: VarName;
        k1a: VarName;
        k1b: VarName;
        ring2: VarName;
        edge2: VarName;
        k2a: VarName;
        k2b: VarName;
      };
    }
  // Lemma 9: bind the canonical (first enumerated) `holeSize`-hole through the
  // anchor (CCW id list) — e.g. the 7-hole X created by A2.
  | {
      kind: "select-hole-through";
      holeSize: number;
      anchorVar: VarName;
      binds: { hole: VarName };
    }
  // Lemma 9 step 7 (after A4): enumerate the `holeSize`-holes through the
  // anchor and bind the canonical pair with disjoint interiors.
  | {
      kind: "select-disjoint-holes";
      holeSize: number;
      anchorVar: VarName;
      binds: { holeA: VarName; holeB: VarName };
    };

export type PtExpr =
  | { kind: "const"; x: Rat; y: Rat }
  | { kind: "anchor"; v: VarName }
  | { kind: "mid"; a: PtExpr; b: PtExpr }
  | { kind: "reflect"; src: PtExpr; over: [PtExpr, PtExpr] }
  | { kind: "offset"; from: PtExpr; by: [Rat, Rat] };

export type PtListExpr =
  | { kind: "points"; of: readonly PtExpr[] }
  | { kind: "var"; v: VarName }
  | { kind: "last-n"; n: number };

// RouteInteraction (k=8 guided tours): how far the response class of a route
// is verified. interactive = the class is verified exactly (free play and
// replay are offered); guided = the continuation is verified along the
// stated path / per-move exact checks only; unverified = the class is NOT
// encoded: reaching it ends the session as an honest `uncovered`
// (partial-encoding) terminal and the route's target is never run.
export type RouteInteraction = "interactive" | "guided" | "unverified";

export interface RouteRule {
  case: CaseId;
  when: RegionPredicate;
  target: NodeId;
  bind?: Readonly<Record<VarName, BindingExpr>>;
  note?: string;
  interaction?: RouteInteraction;
}

export type RegionPredicate =
  | { kind: "region"; expr: RegionExpr }
  | {
      kind: "classifier";
      classifierId: string;
      inputs?: Readonly<Record<string, PtListExpr>>;
      on: { tag: string };
    }
  | { kind: "all" };

export type BindingExpr =
  | { kind: "last" }
  | { kind: "result"; field: string };

export type RegionExpr =
  | { kind: "all" }
  | { kind: "window" }
  | { kind: "halfplane"; thru: [PtExpr, PtExpr]; side: "left" | "right" }
  | { kind: "hull"; of: PtListExpr }
  | { kind: "intersect"; of: readonly RegionExpr[] }
  | { kind: "holes"; k: number };

export type OverlaySpec =
  | { kind: "region"; expr: RegionExpr; style: RegionStyle; label: string }
  | { kind: "strip"; strip: StripSpec }
  | { kind: "poly-line"; of: readonly PtExpr[]; style: LineStyle }
  | { kind: "highlight-hole"; pattern: HolePattern }
  | { kind: "case-map" };

export type InvariantSpec =
  | { kind: "exists-k-hole"; k: number; where?: RegionExpr }
  | { kind: "exists-shared-edge-pair"; k: number }
  | { kind: "region-empty-of"; expr: RegionExpr; owner: "breaker" | "any" }
  | { kind: "config-class"; cls: "one-interior" | "convex" }
  | {
      kind: "custom";
      checkerId: string;
      args: Readonly<Record<string, PtListExpr>>;
      describe: string;
    };

export type RegionStyle =
  | "neutral"
  | "candidate"
  | "forced"
  | "protected"
  | "verify"
  | "structure"
  | "illegal";

export type LineStyle = "reference" | "forbidden" | "shared-edge";

export interface StripSpec {
  stripId: string;
}

export type HolePattern =
  | "winning"
  | "intended"
  | "intended-next"
  | "twin"
  | "survivors";

export type HoleRef =
  | { kind: "var"; v: VarName }
  | { kind: "enumerate"; k: number; prefer?: EdgeSelector };

export type TriRef = { kind: "var"; v: VarName };
export type EdgeRef = { kind: "var"; v: VarName };
export type PolyRef = { kind: "var"; v: VarName };
export type EdgeSelector = "largest-interval" | "farthest-clearance";

// KStrip — THIS PROJECT'S visualization abstraction (§9).
// NOT a term from Das–Valla (verified: zero occurrences in the journal text).
// NOT the formal "k-strip" of Džuklevski et al., arXiv:2505.15366, Definition 2
// (a different mathematical object — the basis of their winning strategy).
// Never cite S2 for this construct; never describe project strips by S2's
// definition. UI label: "growth strip (project abstraction)".
export interface KStrip {
  id: string;
  label: string;
  expr: RegionExpr;
  meaning: "growth-corridor" | "forced-region" | "protected-zone";
  provenance: { sourceRef: string; note: string };
  growsWith?: readonly NodeId[];
}

export type ClaimTier =
  | "verified-geometry"
  | "strategy-rule"
  | "theorem-cited"
  | "observed"
  | "uncovered";

export interface Claim {
  tier: ClaimTier;
  text: string;
  ref?: string;
}

export interface EvidenceItem {
  predicate: string;
  operands: string;
  result: string;
}

export interface ExplanationSpec {
  headline: string;
  claims: readonly Claim[];
  threats?: readonly Claim[];
  invariantNotes?: readonly Claim[];
  sourceRef: string;
}

// ---- Classifier / checker contracts (§5.7) ----

export interface ClassifierResult {
  tag: string;
  bindings?: Readonly<Record<string, PointId | readonly PointId[]>>;
}

export interface ClassifierFailure {
  reason: "undecidable-computation" | "invalid-result";
  detail: string;
  analysis?: HoleAnalysis;
}

export type ClassifierExecution =
  | { kind: "classified"; result: ClassifierResult }
  | { kind: "integrity"; failure: ClassifierFailure };

export type BoundariesExecution =
  | { kind: "ok"; lines: readonly [PointId, PointId][] }
  | { kind: "integrity"; failure: ClassifierFailure };

// ---- Wire mirrors (StrategyDefJSON — "n/d" strings for every Rat leaf) ----

export type RatJSON = string;

export type PtExprJSON =
  | { kind: "const"; x: RatJSON; y: RatJSON }
  | { kind: "anchor"; v: VarName }
  | { kind: "mid"; a: PtExprJSON; b: PtExprJSON }
  | { kind: "reflect"; src: PtExprJSON; over: [PtExprJSON, PtExprJSON] }
  | { kind: "offset"; from: PtExprJSON; by: [RatJSON, RatJSON] };

export type PtListExprJSON =
  | { kind: "points"; of: readonly PtExprJSON[] }
  | { kind: "var"; v: VarName }
  | { kind: "last-n"; n: number };

export type RegionExprJSON =
  | { kind: "all" }
  | { kind: "window" }
  | { kind: "halfplane"; thru: [PtExprJSON, PtExprJSON]; side: "left" | "right" }
  | { kind: "hull"; of: PtListExprJSON }
  | { kind: "intersect"; of: readonly RegionExprJSON[] }
  | { kind: "holes"; k: number };

export type RegionPredicateJSON =
  | { kind: "region"; expr: RegionExprJSON }
  | {
      kind: "classifier";
      classifierId: string;
      inputs?: Readonly<Record<string, PtListExprJSON>>;
      on: { tag: string };
    }
  | { kind: "all" };

export type MoveSpecJSON =
  | { kind: "fixed"; at: readonly PtExprJSON[] }
  | { kind: "extend"; hole: HoleRef; prefer?: EdgeSelector }
  | { kind: "co-shoulder"; outer: TriRef; interior: VarName }
  | {
      kind: "escape-beyond-edge";
      sharedEdge: EdgeRef;
      poly: PolyRef;
      quads?: readonly [PolyRef, PolyRef];
    }
  | {
      kind: "escape-pair-beyond-edge";
      edge: EdgeRef;
      ring: PolyRef;
      anchor: VarName;
      halves: readonly [PolyRef, PolyRef];
    }
  | { kind: "escape-edge-accept"; options: readonly EscapeEdgeOption[] }
  | { kind: "forcing-pair"; ring: PolyRef; chain: readonly [VarName, VarName, VarName] }
  | { kind: "double-extend"; holeSize: number };

export type InvariantSpecJSON =
  | { kind: "exists-k-hole"; k: number; where?: RegionExprJSON }
  | { kind: "exists-shared-edge-pair"; k: number }
  | { kind: "region-empty-of"; expr: RegionExprJSON; owner: "breaker" | "any" }
  | { kind: "config-class"; cls: "one-interior" | "convex" }
  | {
      kind: "custom";
      checkerId: string;
      args: Readonly<Record<string, PtListExprJSON>>;
      describe: string;
    };

export interface RouteRuleJSON {
  case: CaseId;
  when: RegionPredicateJSON;
  target: NodeId;
  bind?: Readonly<Record<VarName, BindingExpr>>;
  note?: string;
  interaction?: RouteInteraction;
}

export type OverlaySpecJSON =
  | { kind: "region"; expr: RegionExprJSON; style: RegionStyle; label: string }
  | { kind: "strip"; strip: StripSpec }
  | { kind: "poly-line"; of: readonly PtExprJSON[]; style: LineStyle }
  | { kind: "highlight-hole"; pattern: HolePattern }
  | { kind: "case-map" };

export interface ExplanationSpecJSON {
  headline: string;
  claims: readonly Claim[];
  threats?: readonly Claim[];
  invariantNotes?: readonly Claim[];
  sourceRef: string;
}

export interface StrategyNodeJSON {
  id: NodeId;
  role: "maker-move" | "classify-breaker" | "computed-step" | "terminal";
  next?: NodeId;
  move?: MoveSpecJSON;
  placeBind?: VarName;
  compute?: ComputedOp;
  routes?: readonly RouteRuleJSON[];
  pre?: readonly InvariantSpecJSON[];
  post?: readonly InvariantSpecJSON[];
  show: readonly OverlaySpecJSON[];
  why: ExplanationSpecJSON;
  sourceRef: string;
}

export interface StrategyDefJSON {
  id: string;
  k: 3 | 5 | 6 | 7 | 8;
  version: string;
  source: { paper: string; stepMap: Record<NodeId, string> };
  entry: NodeId;
  nodes: Record<NodeId, StrategyNodeJSON>;
  domain?: { coverage: "full" | "partial"; note?: string };
  startVars?: readonly VarName[];
  gameModes?: readonly GameMode[];
}

export interface ClassifierDef {
  id: string;
  resultTags: readonly string[];
  classify(
    state: GameState,
    inputs: Readonly<Record<string, readonly PointId[]>>,
    config: Configuration,
  ): ClassifierExecution;
  boundaries(
    state: GameState,
    inputs: Readonly<Record<string, readonly PointId[]>>,
    config: Configuration,
  ): BoundariesExecution;
}

export type PtListIdsResult =
  | { kind: "ok"; ids: readonly PointId[] }
  | {
      kind: "resolution-failure";
      reason:
        | "unbound-var"
        | "binding-kind-mismatch"
        | "non-anchor-leaf"
        | "unavailable-point"
        | "last-n-domain";
      detail: string;
    };
