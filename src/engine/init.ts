// engine/init.ts — initSession: txn-0 state construction (§5.10, §6.2
// session-start contract). PURE, total, deterministic. Assigns no
// transaction metadata (seq = 0 is the definitional root, §5.5); txn-0
// creation is session/commit.ts.
import { findKHoles, witnessOf } from "../geometry/holes.ts";
import { findNewWinHoles, findWinHoles, isBichromatic, isGameMode } from "../game/gamemode.ts";
import type { IdPt, KHole } from "../geometry/holes.ts";
import {
  BOOTSTRAP_EXACT_HOLE_BUDGET_5,
  BOOTSTRAP_EXACT_HOLE_BUDGET_6,
  N_BOOTSTRAP_EXACT,
} from "../geometry/holes.ts";
import { defaultStartFor } from "../strategy/presets.ts";
import { hull } from "../geometry/hull.ts";
import { gp, orient } from "../geometry/predicates.ts";
import { cmpPt, eqPt } from "../geometry/pt.ts";
import { isKHole } from "../geometry/holes.ts";
import type { Pt } from "../geometry/pt.ts";
import { checkStateInvariants, placedId, placePoint } from "../game/place.ts";
import { withStrategy } from "../game/types.ts";
import type {
  Diagnostic,
  GameState,
  NodeId,
  PlacedPoint,
  Player,
  PointId,
  SessionConfig,
  StrategyStart,
  Terminal,
} from "../game/types.ts";
import { Rat } from "../geometry/rat.ts";
import { normalizeBias, validateBias } from "../game/turnorder.ts";
import type { CheckResult } from "../game/integrity.ts";
import { integrityReport } from "../game/integrity.ts";
import { checkPost, checkPre } from "../verification/pipeline.ts";
import { isTerminalNode, nodeOf } from "../strategy/runtime.ts";
import { BudgetExhaustedError, evalMoveSpec } from "../strategy/eval.ts";
import type { StrategyDef } from "../strategy/types.ts";
import {
  bind,
  integrity,
  makerWon,
  runComputedOp,
  terminalAt,
  withTerminal,
  withVar,
} from "./orchestrator.ts";
import type { RuntimeCtx } from "./orchestrator.ts";

export type BootstrapError =
  | { code: "malformed-input"; detail: string }
  | { code: "not-gp-or-window"; detail: string; triple?: [Pt, Pt, Pt] }
  | { code: "invalid-hole"; operands: string }
  | { code: "parity"; count: number; turn: Player }
  | { code: "missing-witness" };

export interface FixtureStartRecord {
  points: readonly Pt[];
  selectedHole: readonly Pt[];
  owners?: readonly Player[];
}

const fixtureStarts = new Map<string, FixtureStartRecord>();

export function registerFixtureStart(ref: string, record: FixtureStartRecord): void {
  if (ref === "") {
    throw new Error("registerFixtureStart: empty scenarioRef");
  }
  if (fixtureStarts.has(ref)) {
    throw new Error(`registerFixtureStart: ${ref} already registered`);
  }
  fixtureStarts.set(ref, record);
}

export function hasFixtureStart(ref: string): boolean {
  return fixtureStarts.has(ref);
}

export type InitRequest =
  | { kind: "sandbox"; config: SessionConfig; k: 3 | 4 | 5 | 6 | 7 | 8 }
  | {
      kind: "guided";
      config: SessionConfig;
      strategyId: string;
      mode: "proof" | "break";
      strategyStart?: StrategyStart;
    };

export interface InitResult {
  status: "accepted" | "rejected";
  state?: GameState;
  error?: BootstrapError;
  diagnostics: readonly Diagnostic[];
}

function malformed(detail: string): InitResult {
  return {
    status: "rejected",
    error: { code: "malformed-input", detail },
    diagnostics: [],
  };
}

function saneWindow(config: { window: { xMin: Rat; xMax: Rat; yMin: Rat; yMax: Rat } }): boolean {
  return (
    config.window.xMin.cmp(config.window.xMax) < 0 &&
    config.window.yMin.cmp(config.window.yMax) < 0
  );
}

function failTerminal(
  s: GameState,
  nodeId: NodeId,
  phase: "pre" | "post" | "construction",
  failed: CheckResult,
): GameState {
  return withTerminal(s, integrity(s, integrityReport(s, nodeId, phase, failed)));
}

// runEntryChain: the §6.2 lifecycle for maker-move/computed-step entries
// (pre → op/place+bind → post → advance), with the guided win check after
// every placement. No events (txn 0 carries zero, §5.5). Chain failure →
// accepted-terminal integrity (mirroring reducer exits and the P3
// accepted-terminal precedent —); entry-chain wins → accepted-terminal
// maker-won (§5.10).
function runEntryChain(
  s0: GameState,
  def: StrategyDef,
  ctx: RuntimeCtx,
): GameState {
  let s = s0;
  for (;;) {
    const rt = s.strategy;
    if (rt === null) {
      throw new Error("initSession: entry chain without strategy — implementation error");
    }
    const n = nodeOf(def, rt.nodeId);
    if (n.role === "classify-breaker") {
      // Parked: entry-chain pre on the park node (same lifecycle).
      const pre = checkPre(s, n, ctx.config);
      if (pre.kind === "failed") {
        return failTerminal(s, n.id, "pre", pre.report.failed);
      }
      return s;
    }
    if (n.role === "terminal") {
      const w = findWinHoles(s, s.k, {
        mode: "first-witness",
        budget: ctx.config.analysis.budgetOps,
      });
      const witness = witnessOf(w);
      if (witness === null) {
        return failTerminal(s, n.id, "post", {
          id: "engine:declared-win",
          kind: "strategy",
          passed: false,
          detail: "declared win without a k-hole",
        });
      }
      return withTerminal(s, terminalAt(n.id, witness));
    }
    const pre = checkPre(s, n, ctx.config);
    if (pre.kind === "failed") {
      return failTerminal(s, n.id, "pre", pre.report.failed);
    }
    if (n.role === "computed-step") {
      if (n.compute === undefined || n.next === undefined) {
        throw new Error("initSession: malformed computed-step — implementation error");
      }
      const c = runComputedOp(s, n.compute, ctx.config);
      if (!c.ok) {
        return failTerminal(s, n.id, "construction", c.failed);
      }
      s = withStrategy(s, (r) => ({ ...r, vars: bind(r.vars, c.bindings) }));
    } else {
      // maker-move.
      if (n.move === undefined || n.next === undefined) {
        throw new Error("initSession: malformed maker-move — implementation error");
      }
      let p: { pt: Pt } | null;
      try {
        p = evalMoveSpec(n.move, s, ctx.config);
      } catch (e) {
        if (e instanceof BudgetExhaustedError) {
          return failTerminal(s, n.id, "construction", {
            id: "extend",
            kind: "strategy",
            passed: false,
            detail: `extend enumeration undecidable (${e.message})`,
            analysis: e.analysis,
          });
        }
        throw e;
      }
      if (p === null) {
        return failTerminal(s, n.id, "construction", {
          id: `move:${n.move.kind}`,
          kind: "strategy",
          passed: false,
          detail: `${n.move.kind} construction failed at init`,
        });
      }
      s = placePoint(s, "maker", p.pt);
      if (n.placeBind !== undefined) {
        const bound = placedId(s);
        const bindName = n.placeBind;
        s = withStrategy(s, (r) => withVar(r, bindName, bound));
      }
      const w2 = findNewWinHoles(s, s.k, placedId(s));
      if (w2.holes.length > 0) {
        const m = isTerminalNode(def, n.next) ? n.next : n.id;
        if (m === n.next) {
          const target = n.next;
          s = withStrategy(s, (r) => ({ ...r, nodeId: target }));
        }
        const terminal: Terminal = makerWon(s, w2.holes, m);
        return withTerminal(s, terminal);
      }
    }
    const post = checkPost(s, n, ctx.config);
    if (post.kind === "failed") {
      return failTerminal(s, n.id, "post", post.report.failed);
    }
    const target = n.next as NodeId;
    s = withStrategy(s, (r) => ({ ...r, nodeId: target }));
  }
}

// holeToPointList (§24.0b, v1.2.3 — engine/init.ts, PURE): the formal
// KHole→Pt[] bridge for the promotion flow. Never a cast: cardinality,
// id resolution, and canonical-order verification, in that order.
export function holeToPointList(
  hole: KHole,
  points: readonly PlacedPoint[],
): { ok: true; pts: readonly Pt[] } | { ok: false; reason: "missing-point" | "bad-cardinality" | "non-canonical" } {
  if (hole.verts.length !== 5) {
    return { ok: false, reason: "bad-cardinality" };
  }
  const pts: Pt[] = [];
  for (const id of hole.verts) {
    const found = points.find((p) => p.id === id);
    if (found === undefined) {
      return { ok: false, reason: "missing-point" };
    }
    pts.push(found.pt);
  }
  const h = hull(pts);
  if (h.length !== pts.length) {
    return { ok: false, reason: "non-canonical" };
  }
  for (let i = 0; i < pts.length; i += 1) {
    if (!eqPt(h[i] as Pt, pts[i] as Pt)) {
      return { ok: false, reason: "non-canonical" };
    }
  }
  return { ok: true, pts };
}

function gpTriple(pts: readonly Pt[]): [Pt, Pt, Pt] | null {
  for (let i = 0; i < pts.length; i += 1) {
    for (let j = i + 1; j < pts.length; j += 1) {
      for (let k = j + 1; k < pts.length; k += 1) {
        if (orient(pts[i] as Pt, pts[j] as Pt, pts[k] as Pt) === 0) {
          return [pts[i] as Pt, pts[j] as Pt, pts[k] as Pt];
        }
      }
    }
  }
  return null;
}

function inWindow(p: Pt, window: { xMin: Rat; yMin: Rat; xMax: Rat; yMax: Rat }): boolean {
  return (
    window.xMin.cmp(p.x) <= 0 &&
    p.x.cmp(window.xMax) <= 0 &&
    window.yMin.cmp(p.y) <= 0 &&
    p.y.cmp(window.yMax) <= 0
  );
}

// bootstrapK6 (§24.0b P0–P4 + entry rule + var init): builds the initial
// guided state for a classify-breaker entry from a StrategyStart record.
// The hole var is startVars[0] and the vertex vars are startVars[1..5]
// (esmb-k6 declares ["P5","V0",…,"V4"]). Returns the pre-entry-chain state;
// the caller runs it through runEntryChain + the invariant gate.
function bootstrapK6(
  def: StrategyDef,
  start: StrategyStart,
  ctx: RuntimeCtx,
): { ok: true; state: GameState } | { ok: false; error: BootstrapError } {
  // Resolve the record per kind.
  let rawPts: readonly Pt[];
  let rawOwners: readonly Player[] | undefined;
  let rawSel: readonly Pt[] | null;
  let explicit: boolean;
  if (start.kind === "fixture") {
    const rec = fixtureStarts.get(start.scenarioRef);
    if (rec === undefined) {
      return {
        ok: false,
        error: { code: "malformed-input", detail: `unknown scenarioRef '${start.scenarioRef}'` },
      };
    }
    rawPts = rec.points;
    rawOwners = rec.owners;
    rawSel = rec.selectedHole;
    explicit = true;
  } else if (start.kind === "supplied") {
    rawPts = start.points;
    rawOwners = start.owners;
    rawSel = start.selectedHole;
    explicit = true;
  } else {
    rawPts = start.points;
    rawOwners = start.owners;
    rawSel = start.selectedHole;
    explicit = false;
  }
  // P0: shape.
  if (rawPts.length < 5) {
    return {
      ok: false,
      error: { code: "malformed-input", detail: `bootstrap needs at least 5 points (got ${rawPts.length})` },
    };
  }
  if (rawPts.length > N_BOOTSTRAP_EXACT) {
    return {
      ok: false,
      error: {
        code: "malformed-input",
        detail: `supplied bootstrap exceeds N_BOOTSTRAP_EXACT = ${N_BOOTSTRAP_EXACT} points — the k=6 session starts from at most ${N_BOOTSTRAP_EXACT} points (the exact P3 enumeration bound; §7.6)`,
      },
    };
  }
  const owners: readonly Player[] =
    rawOwners ??
    rawPts.map((_, i) => (i % 2 === 0 ? "maker" : "breaker") as Player);
  if (owners.length !== rawPts.length) {
    return {
      ok: false,
      error: {
        code: "malformed-input",
        detail: `owners/points length mismatch (${owners.length} owners, ${rawPts.length} points)`,
      },
    };
  }
  // Entry rule: canonical cmpPt sort for supplied/fixture (ids p1..pn in
  // that order); verbatim placement order for continue (the history is real).
  const order =
    start.kind === "continue"
      ? rawPts.map((_, i) => i)
      : rawPts
          .map((_, i) => i)
          .sort((a, b) => cmpPt(rawPts[a] as Pt, rawPts[b] as Pt));
  const placed: GameState["points"] = order.map((src, i) => ({
    id: `p${i + 1}`,
    owner: owners[src] as Player,
    pt: rawPts[src] as Pt,
    move: i + 1,
  }));
  const allPts = placed.map((p) => p.pt);
  const idPts: IdPt[] = placed.map((p) => ({ id: p.id, pt: p.pt }));
  // P1: GP + window.
  if (!gp(allPts)) {
    const triple = gpTriple(allPts);
    return {
      ok: false,
      error: {
        code: "not-gp-or-window",
        detail: "bootstrap points are not in general position",
        ...(triple === null ? {} : { triple }),
      },
    };
  }
  const window = ctx.config.window;
  if (!allPts.every((p) => inWindow(p, window))) {
    return {
      ok: false,
      error: { code: "not-gp-or-window", detail: "bootstrap points leave the configured window" },
    };
  }
  // P2: the selected 5-hole (explicit selection: hard validation, no
  // fallback; continue: the ordered fallback ladder).
  const holeSize = def.k - 1;
  let holeIds: readonly PointId[] | null = null;
  if (rawSel !== null) {
    const sel = rawSel;
    if (sel.length === holeSize && sel.every((q) => allPts.some((p) => eqPt(p, q)))) {
      if (isKHole(sel, allPts)) {
        const h = hull([...sel]);
        holeIds = h.map((q) => {
          const at = allPts.findIndex((p) => eqPt(p, q));
          return placed[at]?.id as PointId;
        });
      }
    }
    if (holeIds === null && explicit) {
      return {
        ok: false,
        error: { code: "invalid-hole", operands: invalidOperands(sel, allPts, placed) },
      };
    }
  }
  if (holeIds === null) {
    // Continue fallback ladder (v1.2.2): canonical-first enumerated 5-hole.
    const found = findKHoles(idPts, holeSize, {
      mode: "exhaustive",
      // Actual cost C(n,k)·k·(n−k) ≤ BUDGET_5 for k-hole sizes 5 and 6 at
      // n ≤ 12 (33 264 ≤ 55 440), so the k=7 ladder is exhaustive too.
      budget: BOOTSTRAP_EXACT_HOLE_BUDGET_5,
    });
    if (found.kind !== "exhaustive") {
      throw new Error(
        "bootstrapK6: fallback 5-hole enumeration overran the exact bootstrap budget — implementation error",
      );
    }
    if (found.holes.length === 0) {
      return { ok: false, error: { code: "missing-witness" } };
    }
    holeIds = [...(found.holes[0] as (typeof found.holes)[number]).verts];
  }
  // Var init: startVars[0] = the hole's CCW id list; the rest = vertices.
  const bindings: Record<string, PointId | readonly PointId[]> = {};
  const startVars = def.startVars ?? [];
  if (startVars[0] !== undefined) {
    bindings[startVars[0]] = [...holeIds];
    for (let i = 1; i < startVars.length && i - 1 < holeIds.length; i += 1) {
      bindings[startVars[i] as string] = holeIds[i - 1] as PointId;
    }
  }
  const state: GameState = {
    seq: 0,
    k: def.k,
    mode: "break",
    points: placed,
    turn: "breaker",
    terminal: null,
    strategy: {
      strategyId: def.id,
      version: def.version,
      nodeId: def.entry,
      vars: bindings,
      lastCase: null,
    },
  };
  // P3: 6-hole pre-check (genuinely exhaustive inside P0's bound — the
  // named exact constant; an overrun is an implementation error).
  const pre = findKHoles(idPts, def.k, {
    mode: "exhaustive",
    // k=7 at n ≤ 12: C(12,7)·7·5 = 27 720 ≤ BUDGET_6 (66 528).
    budget: BOOTSTRAP_EXACT_HOLE_BUDGET_6,
  });
  if (pre.kind !== "exhaustive") {
    throw new Error(
      "bootstrapK6: P3 6-hole sweep overran the exact bootstrap budget — implementation error",
    );
  }
  if (pre.holes.length > 0) {
    return {
      ok: true,
      state: withTerminal(state, makerWon(state, [...pre.holes], def.entry)),
    };
  }
  // P4: Breaker-to-move parity (odd count; P3-terminal states skip this).
  if (placed.length % 2 === 0) {
    return {
      ok: false,
      error: { code: "parity", count: placed.length, turn: "breaker" },
    };
  }
  return { ok: true, state };
}

function invalidOperands(
  sel: readonly Pt[],
  allPts: readonly Pt[],
  placed: GameState["points"],
): string {
  if (sel.length !== 5) {
    return `selected hole has ${sel.length} points, not 5`;
  }
  if (!sel.every((q) => allPts.some((p) => eqPt(p, q)))) {
    return "selected hole names points outside the supplied set";
  }
  const h = hull([...sel]);
  if (h.length !== sel.length) {
    return `the supplied 5 points do not form an empty convex pentagon in the supplied set: hull size ${h.length}`;
  }
  for (const p of placed) {
    if (sel.some((q) => eqPt(q, p.pt))) {
      continue;
    }
    let inside = true;
    for (let i = 0; i < h.length; i += 1) {
      if (orient(h[i] as Pt, h[(i + 1) % h.length] as Pt, p.pt) < 0) {
        inside = false;
        break;
      }
    }
    if (inside) {
      return `the supplied 5 points do not form an empty convex pentagon in the supplied set: non-empty blocker ${p.id}`;
    }
  }
  return "the supplied 5 points do not form an empty convex pentagon in the supplied set";
}

export function initSession(
  request: InitRequest,
  ctx: RuntimeCtx,
): InitResult {
  const rawGameMode = (request.config as { gameMode?: unknown }).gameMode;
  if (rawGameMode !== undefined && !isGameMode(rawGameMode)) {
    return malformed(`unknown gameMode '${String(rawGameMode)}'`);
  }
  // Monochromatic is represented by ABSENCE (hash/structure stability).
  const bichromatic = isBichromatic(request.config);
  const modeField = bichromatic ? { gameMode: "bichromatic" as const } : {};
  // Bias 1:s (game/turnorder.ts). 1:1 is represented by ABSENCE.
  const rawBias = (request.config as { bias?: unknown }).bias;
  if (rawBias !== undefined && !(rawBias instanceof Rat)) {
    return malformed("bias must be an exact rational");
  }
  if (rawBias !== undefined) {
    const why = validateBias(rawBias);
    if (why !== null) {
      return malformed(`invalid bias: ${why}`);
    }
  }
  const bias = normalizeBias(rawBias);
  const biasField = bias !== undefined ? { bias } : {};
  if (bias !== undefined && request.kind === "guided") {
    // Fail closed: every guided strategy is a 1:1 construction (one Breaker
    // point, one Maker reply); none encodes a multi-point Breaker round.
    return malformed(
      "unsupported-bias: guided strategies are constructions for bias 1:1 only",
    );
  }
  if (request.kind === "sandbox") {
    if (request.config.mode !== "sandbox") {
      return malformed("sandbox request carries a non-sandbox mode");
    }
    if (
      !Number.isInteger(request.k) ||
      request.k < 3 ||
      request.k > 8
    ) {
      return malformed(`sandbox k out of range: ${request.k}`);
    }
    if (!saneWindow(request.config)) {
      return malformed("sandbox window is degenerate");
    }
    const state: GameState = {
      seq: 0,
      k: request.k,
      mode: "sandbox",
      ...modeField,
      ...biasField,
      points: [],
      turn: "maker",
      terminal: null,
      strategy: null,
    };
    const check = checkStateInvariants(state);
    if (!check.ok) {
      throw new Error(
        `initSession: sandbox initial state violates ${check.violated} — implementation error`,
      );
    }
    return { status: "accepted", state, diagnostics: [] };
  }
  if (request.mode !== request.config.mode) {
    return malformed("guided request mode mismatches config mode");
  }
  if (!saneWindow(request.config)) {
    return malformed("guided window is degenerate");
  }
  const reg = ctx.strategies.get(request.strategyId);
  if (reg === undefined) {
    return malformed(`unknown strategyId '${request.strategyId}'`);
  }
  const def = reg.def;
  const entry = nodeOf(def, def.entry);
  if (bichromatic) {
    // Fail closed: the shipped strategies are monochromatic constructions
    // (their holes may use Breaker points). A def must opt in explicitly.
    if (!(def.gameModes ?? ["monochromatic"]).includes("bichromatic")) {
      return malformed(
        `unsupported-game-mode: strategy '${def.id}' does not declare bichromatic support`,
      );
    }
    if (entry.role === "classify-breaker") {
      return malformed(
        "unsupported-game-mode: bichromatic sessions cannot bootstrap from a StrategyStart",
      );
    }
  }
  if (entry.role !== "classify-breaker" && request.strategyStart !== undefined) {
    return malformed("strategyStart is forbidden for maker-move/computed-step entries");
  }
  if (entry.role === "classify-breaker") {
    // esmb-k7 may start without an explicit record (the shipped preset);
    // every other classify-breaker entry requires one.
    const start = request.strategyStart ?? defaultStartFor(def.id);
    if (start === undefined) {
      return malformed("strategyStart is required for classify-breaker entries");
    }
    // Bootstrap (§24.0b): resolve the record through the P0–P4 ladder,
    // then park through the shared entry chain (pre on the boot node).
    const boot = bootstrapK6(def, start, ctx);
    if (!boot.ok) {
      return { status: "rejected", error: boot.error, diagnostics: [] };
    }
    const state = runEntryChain(boot.state, def, ctx);
    const check = checkStateInvariants(state);
    if (!check.ok) {
      throw new Error(
        `initSession: bootstrapped initial state violates ${check.violated} — implementation error`,
      );
    }
    return { status: "accepted", state, diagnostics: [] };
  }
  // maker-move/computed-step entry: empty board, Maker to move, run chain.
  const s0: GameState = {
    seq: 0,
    k: def.k,
    mode: request.mode,
    ...modeField,
    points: [],
    turn: "maker",
    terminal: null,
    strategy: {
      strategyId: def.id,
      version: def.version,
      nodeId: def.entry,
      vars: {},
      lastCase: null,
    },
  };
  const state = runEntryChain(s0, def, ctx);
  const check = checkStateInvariants(state);
  if (!check.ok) {
    throw new Error(
      `initSession: guided initial state violates ${check.violated} — implementation error`,
    );
  }
  return { status: "accepted", state, diagnostics: [] };
}
