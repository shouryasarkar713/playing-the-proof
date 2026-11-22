// engine/orchestrator.ts — pure orchestration: RuntimeCtx, the reducer
// reduceTransaction (§10.8), event finalization, terminal constructors,
// runComputedOp, classifySpecFailure, activeDef, the commit gate. No I/O, no
// store, no DOM, no metadata assignment — the ONLY output is the
// EngineResult (§10.1/§10.8).
import { stateHash } from "../game/hash.ts";
import { integrityReport } from "../game/integrity.ts";
import { checkStateInvariants, placedId, placePoint } from "../game/place.ts";
import { findNewWinHoles, findWinHoles } from "../game/gamemode.ts";
import { deepFreeze, withStrategy } from "../game/types.ts";
import type {
  Binding,
  CaseId,
  Configuration,
  Diagnostic,
  GameState,
  KHole,
  NodeId,
  Player,
  PointId,
  Pt,
  RawEvent,
  StrategyRuntime,
  Terminal,
  UncoveredReport,
  UserAction,
  VarName,
} from "../game/types.ts";
import type { CheckResult, IntegrityReport } from "../game/integrity.ts";
import { findKHoles, witnessOf } from "../geometry/holes.ts";
import { sharedEdgePairs } from "../geometry/holes.ts";
import { twinSharedTriangle } from "../geometry/twins.ts";
import { chordHalfPair, twinQuadEars } from "../geometry/twinsK7.ts";
import {
  earReplacement,
  heptagonPair,
  interiorsDisjoint,
  rotateToEdge,
  twinTriangleEars,
} from "../geometry/twinsK8.ts";
import type { HoleAnalysis } from "../geometry/holes.ts";
import type { IdPt } from "../geometry/holes.ts";
import { buildIntent } from "./actions.ts";
import { detectWinAfterPlacement } from "./pipeline.ts";
import { checkPost, checkPre } from "../verification/pipeline.ts";
import { classify, isTerminalNode, nodeOf } from "../strategy/runtime.ts";
import { BudgetExhaustedError, evalMoveSpec } from "../strategy/eval.ts";
import { ConstructionIntegrityError } from "../strategy/eval.ts";
import type {
  ComputedOp,
  StrategyDef,
  StrategyNode,
} from "../strategy/types.ts";
import type { RegisteredStrategy } from "../strategy/registry.ts";
import type { ClassifierDef } from "../strategy/types.ts";
import type { CustomChecker } from "../verification/invariants.ts";

// RuntimeCtx (§10.8): the reducer's only external inputs — pure
// configuration + the registries, injected by the caller. The maps ARE the
// live registry objects (single source — strategy/registry.ts and
// verification/invariants.ts own them; main.ts/tests wire the same objects
// in). Phase 9 fully types all three maps.
export interface RuntimeCtx {
  config: Configuration;
  strategies: ReadonlyMap<string, RegisteredStrategy>;
  classifiers: ReadonlyMap<string, ClassifierDef>;
  checkers: ReadonlyMap<string, CustomChecker>;
}

export interface EngineResult {
  status: "accepted" | "rejected";
  outcome?: TxnOutcome;
  nextState?: GameState;
  events: readonly RawEvent[];
  diagnostics: readonly Diagnostic[];
}

export type TxnOutcome =
  { kind: "committed" } | { kind: "terminal"; terminal: Terminal };

export interface PendingRawEvent {
  owner: Player;
  at: Pt;
  appliedPoint: PointId;
}

export type AdmissionResult =
  | { ok: true }
  | {
      ok: false;
      reason: "state-invariant";
      violated: "i1" | "i2" | "i3" | "i4" | "i5a" | "i6" | "i7";
      detail: string;
    }
  | { ok: false; reason: "not-parked"; nodeId: NodeId };

export class CommitGateError extends Error {
  readonly admission: Exclude<AdmissionResult, { ok: true }>;
  constructor(admission: Exclude<AdmissionResult, { ok: true }>) {
    super(`commit gate rejected: ${admission.reason} — implementation error`);
    this.name = "CommitGateError";
    this.admission = admission;
  }
}

const DEV: boolean =
  (import.meta as unknown as { env?: { DEV?: unknown } }).env?.DEV !== false;

// pendingEvent (§10.9): the placement-time record — exactly these fields.
export function pendingEvent(
  owner: Player,
  at: Pt,
  appliedPoint: PointId,
): PendingRawEvent {
  return { owner, at, appliedPoint };
}

// finalize = finalizeRawEvent (§10.9): the ONLY RawEvent constructor.
// Stamps milestone fields; stateHash is computed inside over the milestone.
export function finalize(
  pending: PendingRawEvent,
  milestone: { caseId?: CaseId; nodeAfter: NodeId | null; state: GameState },
): RawEvent {
  const stateHashValue = stateHash(milestone.state);
  if (milestone.caseId !== undefined) {
    return deepFreeze({
      owner: pending.owner,
      at: pending.at,
      appliedPoint: pending.appliedPoint,
      caseId: milestone.caseId,
      nodeAfter: milestone.nodeAfter,
      stateHash: stateHashValue,
    });
  }
  return deepFreeze({
    owner: pending.owner,
    at: pending.at,
    appliedPoint: pending.appliedPoint,
    nodeAfter: milestone.nodeAfter,
    stateHash: stateHashValue,
  });
}

// finish (§10.8): pure — dev-asserts every event finalized + terminal
// ordering (terminal outcomes reference the already-applied Terminal);
// applies nothing, assigns no metadata.
export function finish(
  state: GameState,
  events: readonly RawEvent[],
  outcome: TxnOutcome,
  notes: readonly Diagnostic[],
): EngineResult {
  if (DEV) {
    for (const e of events) {
      if (typeof e.stateHash !== "string") {
        throw new Error("finish: unfinalized event — implementation error");
      }
    }
    if (outcome.kind === "terminal" && outcome.terminal !== state.terminal) {
      throw new Error(
        "finish: terminal outcome mismatches state — implementation error",
      );
    }
  }
  return deepFreeze({
    status: "accepted",
    outcome,
    nextState: state,
    events,
    diagnostics: notes,
  });
}

// withTerminal (§10.9): the ONLY terminal write in the engine (sets turn
// "over" per I4); always first on terminal exits (§10.8 ordering).
export function withTerminal(state: GameState, terminal: Terminal): GameState {
  return deepFreeze({ ...state, terminal, turn: "over" as const });
}

// withVar (§10.9): placeBind write — new runtime.
export function withVar(
  rt: StrategyRuntime,
  name: VarName,
  value: Binding,
): StrategyRuntime {
  return deepFreeze({ ...rt, vars: { ...rt.vars, [name]: value } });
}

// bind (§10.9): merge route/classifier/computed-op bindings — new record.
export function bind(
  vars: Readonly<Record<VarName, Binding>>,
  entries: Readonly<Record<VarName, Binding>>,
): Readonly<Record<VarName, Binding>> {
  return { ...vars, ...entries };
}

// makerWon (§10.9): the §3.12 win record.
export function makerWon(
  state: GameState,
  holes: readonly KHole[],
  nodeId: NodeId,
): Terminal {
  return { kind: "maker-won", k: state.k, witness: holes, nodeId };
}

// terminalAt (§10.9): the declared-win form at a chain terminal node.
export function terminalAt(nodeId: NodeId, witness: KHole): Terminal {
  return { kind: "maker-won", k: witness.k, witness: [witness], nodeId };
}

// integrity (§10.9): lift an already-constructed report into a Terminal.
export function integrity(
  _state: GameState,
  report: IntegrityReport,
): Terminal {
  return { kind: "strategy-integrity-failure", report };
}

// uncovered (§10.9): wrap the typed UncoveredReport.
export function uncovered(
  _state: GameState,
  report: UncoveredReport,
): Terminal {
  return { kind: "uncovered", report };
}

// activeDef (§10.9): the pipeline's ONE registry resolution.
export function activeDef(state: GameState, ctx: RuntimeCtx): StrategyDef {
  const id = state.strategy?.strategyId;
  if (id === undefined) {
    throw new Error("activeDef: state has no strategy — implementation error");
  }
  const reg = ctx.strategies.get(id);
  if (reg === undefined) {
    throw new Error(
      `activeDef: unknown strategyId ${id} — implementation error`,
    );
  }
  return reg.def;
}

// mustRt: assert-guided helper (guided branches only — sandbox states never
// reach them; unreachable = implementation bug).
function mustRt(state: GameState): StrategyRuntime {
  if (state.strategy === null) {
    throw new Error(
      "orchestrator: guided branch without strategy — implementation error",
    );
  }
  return state.strategy;
}

function idPtsOf(state: GameState): IdPt[] {
  return state.points.map((p) => ({ id: p.id, pt: p.pt }));
}

// committedStateAdmissible (§10.9): the commit gate — game-layer state
// invariants AND the I5b park rule (guided non-terminal ⇒ parked at a
// classify-breaker node; terminal states pass as the sanctioned exception).
export function committedStateAdmissible(
  state: GameState,
  ctx: RuntimeCtx,
): AdmissionResult {
  const check = checkStateInvariants(state);
  if (!check.ok) {
    return {
      ok: false,
      reason: "state-invariant",
      violated: check.violated,
      detail: check.detail,
    };
  }
  if (state.strategy !== null && state.terminal === null) {
    const def = activeDef(state, ctx);
    const node = def.nodes[mustRt(state).nodeId];
    if (node === undefined || node.role !== "classify-breaker") {
      return { ok: false, reason: "not-parked", nodeId: mustRt(state).nodeId };
    }
  }
  return { ok: true };
}

// runComputedOp (§10.9): the shipped ComputedOp union. select-twin-pair
// (§24.3b) is generic mechanism — implemented here. The anchored pairing
// (§24.2) is k6-specific and activates in Phase 13 (explicit phase gate).
export function runComputedOp(
  state: GameState,
  op: ComputedOp,
  config: Configuration,
):
  | { ok: true; bindings: Readonly<Record<VarName, Binding>> }
  | { ok: false; failed: CheckResult } {
  if (op.kind === "select-anchored-shared-edge-pair") {
    // §24.2: pairs of 4-holes sharing exactly one edge (B0, E) with E in
    // the reference polygon; canonical selection by (E placement index,
    // Q1/Q2 vertex-id tuples in placement-index order —, never string
    // comparison). Binds SE=[B0,E], quadA, quadB.
    const anchor = state.strategy?.vars[op.anchorVar];
    const poly = state.strategy?.vars[op.polyVar];
    if (typeof anchor !== "string" || !Array.isArray(poly)) {
      return {
        ok: false,
        failed: {
          id: "select-anchored-shared-edge-pair",
          kind: "strategy",
          passed: false,
          detail: `anchor var ${op.anchorVar} or poly var ${op.polyVar} misbound`,
        },
      };
    }
    const polyIds = poly as readonly string[];
    const found = findKHoles(idPtsOf(state), 4, {
      mode: "exhaustive",
      budget: config.analysis.budgetOps,
    });
    if (found.kind !== "exhaustive") {
      return {
        ok: false,
        failed: {
          id: "select-anchored-shared-edge-pair",
          kind: "strategy",
          passed: false,
          detail: "pairing enumeration budget-exhausted",
          analysis: found,
        },
      };
    }
    const pos = new Map(state.points.map((p, i) => [p.id, i]));
    const tup = (verts: readonly string[]): number[] =>
      verts.map((v) => pos.get(v) ?? Number.MAX_SAFE_INTEGER);
    const cmpTup = (x: number[], y: number[]): number => {
      const lim = x.length < y.length ? x.length : y.length;
      for (let i = 0; i < lim; i += 1) {
        if ((x[i] as number) !== (y[i] as number)) {
          return (x[i] as number) < (y[i] as number) ? -1 : 1;
        }
      }
      return x.length - y.length;
    };
    const cands: Array<{
      e: string;
      q1: (typeof found.holes)[number];
      q2: (typeof found.holes)[number];
    }> = [];
    for (const pr of sharedEdgePairs(found.holes)) {
      const [a, b] = pr.edge;
      let e: string | null = null;
      if (a === anchor && polyIds.includes(b)) {
        e = b;
      } else if (b === anchor && polyIds.includes(a)) {
        e = a;
      }
      if (e === null) {
        continue;
      }
      // §24.2: intersecting ONLY in the one edge — the pair's total vertex
      // intersection is exactly the edge's endpoints (the prototype's
      // len(shared) == 2 rule; extra shared vertices break the escape
      // geometry).
      const inter = pr.first.verts.filter((v) => pr.second.verts.includes(v));
      if (inter.length !== 2) {
        continue;
      }
      cands.push({ e, q1: pr.first, q2: pr.second });
    }
    if (cands.length === 0) {
      return {
        ok: false,
        failed: {
          id: "select-anchored-shared-edge-pair",
          kind: "strategy",
          passed: false,
          detail: "no anchored shared-edge 4-hole pair",
        },
      };
    }
    cands.sort(
      (c1, c2) =>
        (pos.get(c1.e) as number) - (pos.get(c2.e) as number) ||
        cmpTup(tup(c1.q1.verts), tup(c2.q1.verts)) ||
        cmpTup(tup(c1.q2.verts), tup(c2.q2.verts)),
    );
    const best = cands[0] as (typeof cands)[number];
    return {
      ok: true,
      bindings: {
        [op.binds.sharedEdge]: [anchor, best.e],
        [op.binds.quadA]: [...best.q1.verts],
        [op.binds.quadB]: [...best.q2.verts],
      },
    };
  }
  if (op.kind === "select-chord-half-pair") {
    // Lemma 8 step 1: the first rotation of the hexagon whose chord halves
    // Q_i, Q_{i+2} both survive B0 as 5-holes meeting exactly in a triangle.
    const hole = state.strategy?.vars[op.holeVar];
    const b0 = state.strategy?.vars[op.anchorVar];
    const id = "select-chord-half-pair";
    if (!Array.isArray(hole) || hole.length !== 6 || typeof b0 !== "string") {
      return {
        ok: false,
        failed: {
          id,
          kind: "strategy",
          passed: false,
          detail: `hole var ${op.holeVar} (6 ids) or anchor var ${op.anchorVar} misbound`,
        },
      };
    }
    const sel = chordHalfPair(
      hole as readonly string[],
      b0,
      (pid) => state.points.find((p) => p.id === pid)?.pt ?? null,
      state.points.map((p) => p.pt),
    );
    if (sel === null) {
      return {
        ok: false,
        failed: {
          id,
          kind: "strategy",
          passed: false,
          detail:
            "no two chord halves of the hexagon survive B0 as 5-holes meeting in a triangle (B0 not strictly inside an empty hexagon?)",
        },
      };
    }
    const r = sel.ring;
    return {
      ok: true,
      bindings: {
        [op.binds.v0]: r[0] as string,
        [op.binds.v1]: r[1] as string,
        [op.binds.v2]: r[2] as string,
        [op.binds.v3]: r[3] as string,
        [op.binds.v4]: r[4] as string,
        [op.binds.v5]: r[5] as string,
        [op.binds.ring]: [...r],
        [op.binds.edge]: [r[2] as string, r[3] as string],
        [op.binds.halfA]: r.slice(0, 4),
        [op.binds.halfB]: r.slice(2, 6),
      },
    };
  }
  if (op.kind === "select-twin-holes") {
    // Lemma 8 step 3: enumerate the 6-holes after A1; bind the canonical
    // exact quad-twins for (A1, B0) — never transcribed from the construction.
    const id = "select-twin-holes";
    const x = state.strategy?.vars[op.anchorVars[0]];
    const y = state.strategy?.vars[op.anchorVars[1]];
    if (typeof x !== "string" || typeof y !== "string") {
      return {
        ok: false,
        failed: {
          id,
          kind: "strategy",
          passed: false,
          detail: `anchor vars ${op.anchorVars.join(",")} are not single PointIds`,
        },
      };
    }
    const found6 = findKHoles(idPtsOf(state), op.holeSize, {
      mode: "exhaustive",
      budget: config.analysis.budgetOps,
    });
    if (found6.kind !== "exhaustive") {
      return {
        ok: false,
        failed: {
          id,
          kind: "strategy",
          passed: false,
          detail: "twin enumeration budget-exhausted",
          analysis: found6,
        },
      };
    }
    const ptOf6 = (pid: string): Pt | null =>
      state.points.find((p) => p.id === pid)?.pt ?? null;
    for (let i = 0; i < found6.holes.length; i += 1) {
      for (let j = i + 1; j < found6.holes.length; j += 1) {
        const a = found6.holes[i]?.verts ?? [];
        const b = found6.holes[j]?.verts ?? [];
        const t = twinQuadEars(a, b, [x, y], ptOf6);
        if (t !== null) {
          return {
            ok: true,
            bindings: {
              [op.binds.twinA]: [...a],
              [op.binds.twinB]: [...b],
              [op.binds.quad]: [...t.quadIds],
            },
          };
        }
      }
    }
    return {
      ok: false,
      failed: {
        id,
        kind: "strategy",
        passed: false,
        detail: `no two ${op.holeSize}-holes meet exactly in a quadrilateral with A1/B0 as its diagonal`,
      },
    };
  }
  const vars = state.strategy?.vars ?? {};
  const ptOfS = (pid: string): Pt | null =>
    state.points.find((p) => p.id === pid)?.pt ?? null;
  const fail = (id: string, detail: string, analysis?: HoleAnalysis) => ({
    ok: false as const,
    failed: {
      id,
      kind: "strategy" as const,
      passed: false,
      detail,
      ...(analysis !== undefined ? { analysis } : {}),
    },
  });
  if (op.kind === "select-heptagon-pair") {
    const id = "select-heptagon-pair";
    const hole = vars[op.holeVar];
    const b0 = vars[op.anchorVar];
    if (!Array.isArray(hole) || hole.length !== 7 || typeof b0 !== "string") {
      return fail(id, `hole var ${op.holeVar} (7 ids) or anchor ${op.anchorVar} misbound`);
    }
    const sel = heptagonPair(
      hole as readonly string[],
      b0,
      ptOfS,
      state.points.map((p) => p.pt),
    );
    if (sel === null) {
      return fail(
        id,
        "no two chord halves of the 7-hole survive B0 as 5-holes meeting only in a segment",
      );
    }
    const r = sel.ring;
    return {
      ok: true,
      bindings: {
        [op.binds.v0]: r[0] as string,
        [op.binds.v1]: r[1] as string,
        [op.binds.v2]: r[2] as string,
        [op.binds.v3]: r[3] as string,
        [op.binds.v4]: r[4] as string,
        [op.binds.v5]: r[5] as string,
        [op.binds.v6]: r[6] as string,
        [op.binds.ring]: [...r],
        [op.binds.edge]: [r[3] as string, r[4] as string],
        [op.binds.pentA]: [...r.slice(0, 4), b0],
        [op.binds.pentB]: [...r.slice(3, 7), b0],
      },
    };
  }
  if (op.kind === "select-twin-triangle") {
    const id = "select-twin-triangle";
    const x = vars[op.anchorVars[0]];
    const y = vars[op.anchorVars[1]];
    if (typeof x !== "string" || typeof y !== "string") {
      return fail(id, `anchor vars ${op.anchorVars.join(",")} are not single PointIds`);
    }
    const found6 = findKHoles(idPtsOf(state), 6, {
      mode: "exhaustive",
      budget: config.analysis.budgetOps,
    });
    if (found6.kind !== "exhaustive") {
      return fail(id, "twin enumeration budget-exhausted", found6);
    }
    for (let i = 0; i < found6.holes.length; i += 1) {
      for (let j = i + 1; j < found6.holes.length; j += 1) {
        const a = found6.holes[i]?.verts ?? [];
        const b = found6.holes[j]?.verts ?? [];
        const t = twinTriangleEars(a, b, [x, y], ptOfS);
        if (t !== null) {
          return {
            ok: true,
            bindings: {
              [op.binds.twinA]: [...a],
              [op.binds.twinB]: [...b],
              [op.binds.tri]: [...t.triIds],
            },
          };
        }
      }
    }
    return fail(id, "no two 6-holes meet exactly in a triangle with A1/B0 among its vertices");
  }
  if (op.kind === "select-ear-replacement") {
    const id = "select-ear-replacement";
    const a = vars[op.twinA];
    const b = vars[op.twinB];
    const tri = vars[op.tri];
    const b1 = vars[op.b1Var];
    if (!Array.isArray(a) || !Array.isArray(b) || !Array.isArray(tri) || typeof b1 !== "string") {
      return fail(id, "twin/triangle/B1 vars misbound");
    }
    const t = twinTriangleEars(a as string[], b as string[], [tri[0] as string, tri[1] as string], ptOfS);
    if (t === null) {
      return fail(id, "twins are not exact triangle-twins");
    }
    const rep = earReplacement(a as string[], b as string[], t, b1, ptOfS);
    if (rep === null) {
      return fail(id, "no ear replacement");
    }
    const sharedEdge = (hole: readonly string[]): [string, string] | null => {
      for (let i = 0; i < hole.length; i += 1) {
        const u = hole[i] as string;
        const v = hole[(i + 1) % hole.length] as string;
        if ((u === b1 && v === rep.thirdVertex) || (u === rep.thirdVertex && v === b1)) {
          return [u, v];
        }
      }
      return null;
    };
    const e1 = sharedEdge(rep.holeA);
    const e2 = sharedEdge(rep.holeB);
    if (e1 === null || e2 === null) {
      return fail(id, "replacement holes do not share the edge B1–third vertex");
    }
    const r1 = rotateToEdge(rep.holeA, e1[0], e1[1]);
    const r2 = rotateToEdge(rep.holeB, e2[0], e2[1]);
    if (r1 === null || r2 === null) {
      return fail(id, "shared edge not CCW-consecutive");
    }
    const without = (hole: readonly string[], v: string): string[] =>
      hole.filter((q) => q !== v);
    return {
      ok: true,
      bindings: {
        [op.binds.ring1]: r1,
        [op.binds.edge1]: [e1[0], e1[1]],
        [op.binds.k1a]: without(rep.holeB, e1[0]),
        [op.binds.k1b]: without(rep.holeB, e1[1]),
        [op.binds.ring2]: r2,
        [op.binds.edge2]: [e2[0], e2[1]],
        [op.binds.k2a]: without(rep.holeA, e2[0]),
        [op.binds.k2b]: without(rep.holeA, e2[1]),
      },
    };
  }
  if (op.kind === "select-hole-through") {
    const id = "select-hole-through";
    const anchorId = vars[op.anchorVar];
    if (typeof anchorId !== "string") {
      return fail(id, `anchor var ${op.anchorVar} is not a single PointId`);
    }
    const found = findKHoles(idPtsOf(state), op.holeSize, {
      mode: "exhaustive",
      budget: config.analysis.budgetOps,
    });
    if (found.kind !== "exhaustive") {
      return fail(id, "enumeration budget-exhausted", found);
    }
    const first = found.holes.find((h) => h.verts.includes(anchorId));
    if (first === undefined) {
      return fail(id, `no ${op.holeSize}-hole through ${anchorId}`);
    }
    return { ok: true, bindings: { [op.binds.hole]: [...first.verts] } };
  }
  if (op.kind === "select-disjoint-holes") {
    const id = "select-disjoint-holes";
    const anchorId = vars[op.anchorVar];
    if (typeof anchorId !== "string") {
      return fail(id, `anchor var ${op.anchorVar} is not a single PointId`);
    }
    const found = findKHoles(idPtsOf(state), op.holeSize, {
      mode: "exhaustive",
      budget: config.analysis.budgetOps,
    });
    if (found.kind !== "exhaustive") {
      return fail(id, "enumeration budget-exhausted", found);
    }
    const through = found.holes.filter((h) => h.verts.includes(anchorId));
    for (let i = 0; i < through.length; i += 1) {
      for (let j = i + 1; j < through.length; j += 1) {
        const a = through[i]?.verts ?? [];
        const b = through[j]?.verts ?? [];
        const pa = a.map((q) => ptOfS(q) as Pt);
        const pb = b.map((q) => ptOfS(q) as Pt);
        if (interiorsDisjoint(pa, pb)) {
          return {
            ok: true,
            bindings: { [op.binds.holeA]: [...a], [op.binds.holeB]: [...b] },
          };
        }
      }
    }
    return fail(id, `no two ${op.holeSize}-holes through ${anchorId} with disjoint interiors`);
  }
  // select-twin-pair: enumerate 5-holes; canonical pair sharing exactly 3
  // vertices including the anchor (enumeration-position order).
  const anchor = state.strategy?.vars[op.anchorVar];
  if (typeof anchor !== "string") {
    return {
      ok: false,
      failed: {
        id: "select-twin-pair",
        kind: "strategy",
        passed: false,
        detail: `anchor var ${op.anchorVar} is not a single PointId`,
      },
    };
  }
  const found = findKHoles(idPtsOf(state), 5, {
    mode: "exhaustive",
    budget: config.analysis.budgetOps,
  });
  if (found.kind !== "exhaustive") {
    return {
      ok: false,
      failed: {
        id: "select-twin-pair",
        kind: "strategy",
        passed: false,
        detail: "twin enumeration budget-exhausted",
        analysis: found,
      },
    };
  }
  // prefer the first pair (canonical enumeration order) that meets
  // EXACTLY in its shared triangle (Lemma 7's "two 5-holes intersecting in
  // one triangle"); a pair that only shares 3 vertices is the fallback —
  // k6-inv:twinpair then fails closed on it, never silently.
  const ptOfId = (id: string): Pt | null =>
    state.points.find((p) => p.id === id)?.pt ?? null;
  let fallback: { a: readonly string[]; b: readonly string[] } | null = null;
  for (let i = 0; i < found.holes.length; i += 1) {
    for (let j = i + 1; j < found.holes.length; j += 1) {
      const a = found.holes[i]?.verts ?? [];
      const b = found.holes[j]?.verts ?? [];
      const shared = a.filter((id) => b.includes(id));
      if (shared.length === 3 && shared.includes(anchor)) {
        if (twinSharedTriangle(a, b, ptOfId) !== null) {
          return {
            ok: true,
            bindings: {
              [op.binds.twinA]: [...a],
              [op.binds.twinB]: [...b],
            },
          };
        }
        fallback ??= { a, b };
      }
    }
  }
  if (fallback !== null) {
    return {
      ok: true,
      bindings: {
        [op.binds.twinA]: [...fallback.a],
        [op.binds.twinB]: [...fallback.b],
      },
    };
  }
  return {
    ok: false,
    failed: {
      id: "select-twin-pair",
      kind: "strategy",
      passed: false,
      detail: "no twin pair sharing exactly 3 vertices including the anchor",
    },
  };
}

// classifySpecFailure (§10.9,): kind-deterministic — extend/escape can
// only fail placement via window-exhaustion (Edge-Extension Lemma) ⇒
// uncovered; co-shoulder/fixed failures are convention defects ⇒ integrity.
// (Post-violations never reach here — evalMoveSpec throws loudly,.)
export function classifySpecFailure(
  node: StrategyNode,
  state: GameState,
):
  | { kind: "uncovered"; report: UncoveredReport }
  | { kind: "integrity"; failed: CheckResult } {
  void state;
  const kind = node.move?.kind;
  if (
    kind === "extend" ||
    kind === "escape-beyond-edge" ||
    kind === "escape-pair-beyond-edge" ||
    kind === "escape-edge-accept" ||
    kind === "forcing-pair" ||
    kind === "double-extend"
  ) {
    return {
      kind: "uncovered",
      report: {
        origin: "maker-construction",
        reason: "window-exhausted",
        at: { nodeId: node.id, move: node.move ?? { kind } },
        detail: `${kind} found no admissible placement inside the window`,
      },
    };
  }
  return {
    kind: "integrity",
    failed: {
      id: `move:${kind ?? "missing"}`,
      kind: "strategy",
      passed: false,
      detail: `${kind ?? "missing"} construction failed (convention failure)`,
    },
  };
}

// reduceTransaction (§10.8) — intent → legality → placement → mode-aware win
// check → (guided) route + chain → sandbox/guided commit path. Guided
// chain-complete transactions return INSIDE the guided branch (committed),
// so the fall-through finalize is sandbox-only — preserving every
// node-milestone event (§5.8; see the control-flow note at the fall-through).
export function reduceTransaction(
  state: GameState,
  action: UserAction,
  ctx: RuntimeCtx,
): EngineResult {
  const intent = buildIntent(state, action, ctx);
  if (intent.kind === "rejected") {
    return {
      status: "rejected",
      events: [],
      diagnostics: [{ kind: "rejection", rejection: intent.reason }],
    };
  }

  let s = placePoint(state, intent.owner, intent.at);
  const pending: Array<PendingRawEvent | RawEvent> = [
    pendingEvent(intent.owner, intent.at, placedId(s)),
  ];
  const fin = (
    index: number,
    milestone: { caseId?: CaseId; nodeAfter: NodeId | null; state: GameState },
  ): void => {
    const p = pending[index] as PendingRawEvent | RawEvent | undefined;
    if (p === undefined || "stateHash" in p) {
      throw new Error(
        "reduceTransaction: double finalize — implementation error",
      );
    }
    pending[index] = finalize(p, milestone);
  };
  const notes: Diagnostic[] = [];

  const win = detectWinAfterPlacement(s, placedId(s), ctx);
  if (win.kind === "win" && s.mode !== "sandbox") {
    // A Breaker placement that itself completed a k-hole (monochromatic
    // rule, §3.12 E) — routing never ran. TERMINAL FIRST, then finalize.
    const terminal = makerWon(s, win.holes, mustRt(s).nodeId);
    const sF = withTerminal(s, terminal);
    fin(0, { nodeAfter: null, state: sF });
    return finish(
      sF,
      pending as RawEvent[],
      { kind: "terminal", terminal },
      notes,
    );
  }
  if (win.kind === "win") {
    // Sandbox: analysis note, session continues (§14.1).
    notes.push({ kind: "analysis-note", note: win.analysis });
  }

  if (s.mode !== "sandbox" && intent.owner === "breaker") {
    const def = activeDef(s, ctx);
    const r = classify(def, s, mustRt(s).nodeId, placedId(s), ctx.config);
    if (!r.ok) {
      const terminal = integrity(s, r.report);
      const sF = withTerminal(s, terminal);
      fin(0, { nodeAfter: null, state: sF });
      return finish(
        sF,
        pending as RawEvent[],
        { kind: "terminal", terminal },
        notes,
      );
    }
    const cn = nodeOf(def, mustRt(s).nodeId);
    if (r.interaction === "unverified") {
      // The matched response class is declared NOT encoded: end honestly as
      // an uncovered (partial-encoding) terminal; the route target never runs.
      const terminal = uncovered(s, {
        origin: "breaker-reply",
        reason: "partial-encoding",
        at: { nodeId: cn.id, breakerPoint: placedId(s) },
        detail: `response class ${r.case} is not encoded or verified in this build`,
      });
      const sF = withTerminal(s, terminal);
      fin(0, { caseId: r.case, nodeAfter: null, state: sF });
      return finish(
        sF,
        pending as RawEvent[],
        { kind: "terminal", terminal },
        notes,
      );
    }
    // v1.2.9 TRANSIENT: route bindings applied, nodeId STILL the classify
    // node — control does not leave until its post passes.
    s = withStrategy(s, (rt) => ({
      ...rt,
      lastCase: r.case,
      vars: bind(rt.vars, r.bindings),
    }));
    const post = checkPost(s, cn, ctx.config);
    if (post.kind === "failed") {
      fin(0, { caseId: r.case, nodeAfter: cn.id, state: s });
      const terminal = integrity(s, post.report);
      const sF = withTerminal(s, terminal);
      return finish(
        sF,
        pending as RawEvent[],
        { kind: "terminal", terminal },
        notes,
      );
    }
    // THE ADVANCE — only after post passed.
    s = withStrategy(s, (rt) => ({ ...rt, nodeId: r.target }));
    fin(0, { caseId: r.case, nodeAfter: r.target, state: s });
    // LOOP INVARIANT: at the top of every iteration every pending event is
    // already finalized (dev-asserted below in finish).
    while (nodeOf(def, mustRt(s).nodeId).role !== "classify-breaker") {
      const n = nodeOf(def, mustRt(s).nodeId);
      if (n.role === "terminal") {
        // Declared-win verification (G4: terminal nodes execute nothing).
        const w = findWinHoles(s, s.k, {
          mode: "first-witness",
          budget: ctx.config.analysis.budgetOps,
        });
        const witness = witnessOf(w);
        const sF =
          witness !== null
            ? withTerminal(s, terminalAt(n.id, witness))
            : withTerminal(
                s,
                integrity(
                  s,
                  integrityReport(s, n.id, "post", {
                    id: "engine:declared-win",
                    kind: "strategy",
                    passed: false,
                    detail:
                      w.kind === "budget-exhausted"
                        ? "declared win not verified: witness search hit the analysis budget"
                        : "declared win without a k-hole",
                    ...(w.kind === "budget-exhausted" ? { analysis: w } : {}),
                  }),
                ),
              );
        const terminal = sF.terminal as Terminal;
        return finish(
          sF,
          pending as RawEvent[],
          { kind: "terminal", terminal },
          notes,
        );
      }
      const pre = checkPre(s, n, ctx.config);
      if (pre.kind === "failed") {
        const terminal = integrity(s, pre.report);
        const sF = withTerminal(s, terminal);
        return finish(
          sF,
          pending as RawEvent[],
          { kind: "terminal", terminal },
          notes,
        );
      }
      if (n.role === "computed-step") {
        // §6.2 computed-step lifecycle, verbatim.
        if (n.compute === undefined) {
          throw new Error(
            "reduceTransaction: computed-step without compute — implementation error",
          );
        }
        const c = runComputedOp(s, n.compute, ctx.config);
        if (!c.ok) {
          const terminal = integrity(
            s,
            integrityReport(s, n.id, "construction", c.failed),
          );
          const sF = withTerminal(s, terminal);
          return finish(
            sF,
            pending as RawEvent[],
            { kind: "terminal", terminal },
            notes,
          );
        }
        s = withStrategy(s, (rt) => ({
          ...rt,
          vars: bind(rt.vars, c.bindings),
        }));
        const postStep = checkPost(s, n, ctx.config);
        if (postStep.kind === "failed") {
          const terminal = integrity(s, postStep.report);
          const sF = withTerminal(s, terminal);
          return finish(
            sF,
            pending as RawEvent[],
            { kind: "terminal", terminal },
            notes,
          );
        }
        if (n.next === undefined) {
          throw new Error(
            "reduceTransaction: computed-step without next — implementation error",
          );
        }
        s = withStrategy(s, (rt) => ({ ...rt, nodeId: n.next as NodeId }));
      } else {
        // maker-move.
        if (n.move === undefined) {
          throw new Error(
            "reduceTransaction: maker-move without move — implementation error",
          );
        }
        if (n.next === undefined) {
          throw new Error(
            "reduceTransaction: maker-move without next — implementation error",
          );
        }
        const nextId = n.next;
        let p: { pt: Pt } | null;
        try {
          p = evalMoveSpec(n.move, s, ctx.config);
        } catch (e) {
          // BudgetExhaustedError is the typed budget channel (§6.3) —
          // converted HERE (the single boundary), never crossing further.
          if (e instanceof BudgetExhaustedError) {
            const terminal = integrity(
              s,
              integrityReport(s, n.id, "construction", {
                id: "extend",
                kind: "strategy",
                passed: false,
                detail: `extend enumeration undecidable (${e.message})`,
                analysis: e.analysis,
              }),
            );
            const sF = withTerminal(s, terminal);
            return finish(
              sF,
              pending as RawEvent[],
              { kind: "terminal", terminal },
              notes,
            );
          }
          // ConstructionIntegrityError is the typed structural-defect
          // channel (§24.3 item 2,; §24.1's empty extend enumeration
          // rides it with id "extend") — converted HERE, same boundary.
          if (e instanceof ConstructionIntegrityError) {
            const terminal = integrity(
              s,
              integrityReport(s, n.id, "construction", {
                id: e.id,
                kind: "strategy",
                passed: false,
                detail: e.detail,
              }),
            );
            const sF = withTerminal(s, terminal);
            return finish(
              sF,
              pending as RawEvent[],
              { kind: "terminal", terminal },
              notes,
            );
          }
          throw e;
        }
        if (p === null) {
          const f = classifySpecFailure(n, s);
          const terminal =
            f.kind === "uncovered"
              ? uncovered(s, f.report)
              : integrity(
                  s,
                  integrityReport(s, n.id, "construction", f.failed),
                );
          const sF = withTerminal(s, terminal);
          return finish(
            sF,
            pending as RawEvent[],
            { kind: "terminal", terminal },
            notes,
          );
        }
        s = placePoint(s, "maker", p.pt);
        pending.push(pendingEvent("maker", p.pt, placedId(s)));
        const e = pending.length - 1;
        if (n.placeBind !== undefined) {
          const bound = placedId(s);
          const bindName = n.placeBind;
          s = withStrategy(s, (rt) => withVar(rt, bindName, bound));
        }
        const postMove = checkPost(s, n, ctx.config);
        if (postMove.kind === "failed") {
          fin(e, { nodeAfter: n.id, state: s });
          const terminal = integrity(s, postMove.report);
          const sF = withTerminal(s, terminal);
          return finish(
            sF,
            pending as RawEvent[],
            { kind: "terminal", terminal },
            notes,
          );
        }
        const w2 = findNewWinHoles(s, s.k, placedId(s));
        if (w2.holes.length > 0) {
          const m = isTerminalNode(def, nextId) ? nextId : n.id;
          if (m === nextId) {
            s = withStrategy(s, (rt) => ({ ...rt, nodeId: nextId }));
          }
          fin(e, { nodeAfter: m, state: s });
          const terminal = makerWon(s, w2.holes, m);
          const sF = withTerminal(s, terminal);
          return finish(
            sF,
            pending as RawEvent[],
            { kind: "terminal", terminal },
            notes,
          );
        }
        // ADVANCE FIRST, then finalize (milestone nodeId === nodeAfter).
        s = withStrategy(s, (rt) => ({ ...rt, nodeId: nextId }));
        fin(e, { nodeAfter: nextId, state: s });
      }
    }
    const parkNode = nodeOf(def, mustRt(s).nodeId);
    const parkPre = checkPre(s, parkNode, ctx.config);
    if (parkPre.kind === "failed") {
      const terminal = integrity(s, parkPre.report);
      const sF = withTerminal(s, terminal);
      return finish(
        sF,
        pending as RawEvent[],
        { kind: "terminal", terminal },
        notes,
      );
    }
    // Chain parked: the guided transaction commits here (INSIDE the guided
    // branch — so the fall-through finalize below stays sandbox-only and no
    // node-milestone event is ever re-finalized; §5.8).
    return finish(s, pending as RawEvent[], { kind: "committed" }, notes);
  }
  // Sandbox path only (all guided transactions returned above): no strategy
  // milestones exist; the milestone is the final state — nodeAfter null.
  fin(0, { nodeAfter: null, state: s });
  return finish(s, pending as RawEvent[], { kind: "committed" }, notes);
}
