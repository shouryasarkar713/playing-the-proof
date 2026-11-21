// engine/describe.ts — read-only describers for ui panels (pure data
// assembly, §10.1 step 9 minus rendering). ui/ cannot import strategy/ or
// verification/ (§18.1), so these engine-owned queries bridge: node text,
// live invariant lamps, case-map/sample data, session counters, threat
// previews, hole effect-diffs, and the attack log (Break mode, §12).
import { findWinHoles, gameModeOf } from "../game/gamemode.ts";
import {
  earlyWinClaimText,
  earlyWinHeadline,
  witnessLabel,
} from "../explain/gamemode.ts";
import { hull as hullOf } from "../geometry/hull.ts";
import type { ConvexPoly, RegionValue } from "../geometry/poly.ts";
import { checkPlacement } from "../game/legality.ts";
import { placedId, placePoint } from "../game/place.ts";
import type { Pt } from "../geometry/pt.ts";
import { checkPost, checkPre } from "../verification/pipeline.ts";
import { activeDef } from "./orchestrator.ts";
import type { RuntimeCtx } from "./orchestrator.ts";
import { nodeOf } from "../strategy/runtime.ts";
import { classify } from "../strategy/runtime.ts";
import { effectiveStatus } from "../strategy/registry.ts";
import type { RegisteredStrategy } from "../strategy/registry.ts";
import { HONESTY_STATEMENT, UNCOVERED_TEMPLATES } from "../explain/templates.ts";
import { presetSupplied } from "../strategy/strategies/k6/preset.ts";
import { presetStartFor as presetStartForImpl } from "../strategy/presets.ts";
import {
  effectiveCells,
  sampleForCase,
} from "../strategy/samples.ts";
import { evalRegion } from "../strategy/eval.ts";
import { evalPtListIds } from "../strategy/eval.ts";
import type {
  EffectiveCells,
  SampleReply,
} from "../strategy/samples.ts";
import type {
  Claim,
  EvidenceItem,
} from "../explain/types.ts";
import type {
  CaseId,
  CheckResult,
  Configuration,
  GameState,
  PointId,
  SessionTree,
  StrategyStart,
} from "../game/types.ts";
import type { InvariantSpec, StrategyNode } from "../strategy/types.ts";

export interface NodeExplanation {
  nodeId: string;
  headline: string;
  claims: readonly Claim[];
  evidence: readonly EvidenceItem[];
  threats: readonly Claim[];
  invariantNotes: readonly Claim[];
  sourceRef: string;
}

// nodeExplanation: the current node's why-spec as data, with live evidence
// (Phase 17): terminal maker-won states cite their witness holes; live
// states cite one evidence item per evaluated pre/post invariant
// (predicate label, operand ids, PASS/FAIL + the checker's detail).
// Unevaluated specs (past the first failure) contribute no evidence.
export function nodeExplanation(
  state: GameState,
  ctx: RuntimeCtx,
): NodeExplanation | null {
  if (state.strategy === null) {
    return null;
  }
  const def = activeDef(state, ctx);
  const node = nodeOf(def, state.strategy.nodeId);
  // on a terminal that did not end at the strategy's declared terminal
  // node (uncovered, integrity failure, or a hole completed by Breaker's own
  // point) the parked node's headline describes a step that never ran — say
  // what actually happened instead.
  const t = state.terminal;
  if (t !== null && !(t.kind === "maker-won" && node.role === "terminal")) {
    const early =
      t.kind === "maker-won"
        ? {
            headline: earlyWinHeadline(gameModeOf(state)),
            claims: [
              {
                tier: "verified-geometry" as const,
                text: earlyWinClaimText(gameModeOf(state)),
              },
            ],
          }
        : t.kind === "uncovered"
          ? {
              headline: "Uncovered: this situation lies outside the encoded analysis.",
              claims: [
                {
                  tier: "uncovered" as const,
                  text: "This is a boundary of the encoding or of the play window, reported honestly — not a software failure and not a counterexample.",
                },
              ],
            }
          : {
              headline: "Strategy integrity failure — a defect, not a user error.",
              claims: [
                {
                  tier: "observed" as const,
                  text: "An exact check of the encoded strategy failed at runtime; the session is frozen so the failure can be inspected.",
                },
              ],
            };
    return {
      nodeId: node.id,
      headline: early.headline,
      claims: early.claims,
      evidence: assembleEvidence(state, node, ctx.config),
      threats: [],
      invariantNotes: [],
      sourceRef: node.why.sourceRef,
    };
  }
  return {
    nodeId: node.id,
    headline: node.why.headline,
    claims: node.why.claims,
    evidence: assembleEvidence(state, node, ctx.config),
    threats: node.why.threats ?? [],
    invariantNotes: node.why.invariantNotes ?? [],
    sourceRef: node.why.sourceRef,
  };
}

function operandString(
  spec: InvariantSpec,
  state: GameState,
  check: CheckResult,
): string {
  switch (spec.kind) {
    case "exists-k-hole":
    case "exists-shared-edge-pair": {
      const holes =
        check.analysis !== undefined && check.analysis.kind === "exhaustive"
          ? check.analysis.holes
          : undefined;
      const first = holes?.[0];
      return first !== undefined ? first.verts.join(",") : "—";
    }
    case "config-class": {
      const vars = state.strategy?.vars;
      const parts: string[] = [];
      const outer = vars?.["outer"];
      const interior = vars?.["interior"];
      if (Array.isArray(outer)) {
        parts.push(`outer=${outer.join(",")}`);
      }
      if (typeof interior === "string") {
        parts.push(`interior=${interior}`);
      }
      return parts.length > 0 ? parts.join(";") : "—";
    }
    case "custom": {
      const parts: string[] = [];
      for (const [name, expr] of Object.entries(spec.args)) {
        const ids = evalPtListIds(expr, state);
        if (ids.kind === "resolution-failure") {
          return "—";
        }
        parts.push(`${name}=${ids.ids.join(",")}`);
      }
      return parts.length > 0 ? parts.join(";") : "—";
    }
    default:
      return "—";
  }
}

function assembleEvidence(
  state: GameState,
  node: StrategyNode,
  config: Configuration,
): EvidenceItem[] {
  if (state.terminal?.kind === "maker-won") {
    return state.terminal.witness.map((h) => ({
      predicate: "terminal-witness",
      operands: h.verts.join(","),
      result: `verified ${h.k}-hole`,
    }));
  }
  if (state.terminal !== null) {
    return [];
  }
  const out: EvidenceItem[] = [];
  const push = (
    specs: readonly InvariantSpec[],
    checks: readonly CheckResult[],
  ): void => {
    checks.forEach((check, i) => {
      const spec = specs[i];
      if (spec === undefined) {
        return;
      }
      out.push({
        predicate: specLabel(spec),
        operands: operandString(spec, state, check),
        result: `${check.passed ? "PASS" : "FAIL"}: ${check.detail}`,
      });
    });
  };
  const pre = checkPre(state, node, config);
  push(node.pre ?? [], pre.checks);
  if (pre.kind === "failed") {
    return out;
  }
  push(node.post ?? [], checkPost(state, node, config).checks);
  return out;
}

// uncoveredCard (§10.5/§11.4): the terminal's uncovered template with
// every bracket interpolated (strategy id + owning paper) — no raw
// "[...]" ever reaches the panel. Pure data; ui renders textContent.
export function uncoveredCard(
  terminal: Extract<GameState["terminal"], { kind: "uncovered" }>,
  strategyId: string,
  ctx: RuntimeCtx,
): string {
  const report = terminal.report;
  const template =
    report.origin === "maker-construction"
      ? UNCOVERED_TEMPLATES[2]?.text ?? ""
      : report.reason === "experimental-disabled"
        ? UNCOVERED_TEMPLATES[1]?.text ?? ""
        : UNCOVERED_TEMPLATES[0]?.text ?? "";
  const paper =
    ctx.strategies.get(strategyId)?.def.source.paper ?? "the cited source";
  return (
    template.replace("[strategyId]", strategyId).replace(
      "[general reasoning not encoded here; sourceRef]",
      paper,
    ) + ` (${report.detail})`
  );
}

export interface InvariantLamp {
  id: string;
  phase: "pre" | "post";
  passed: boolean;
  detail: string;
}

// invariantStatuses: live re-evaluation of the current node's pre AND post
// on the current state (matches the §11.6 display: parked structure present
// ⇒ post lamps pass; empty for terminal/sandbox states).
export function invariantStatuses(
  state: GameState,
  ctx: RuntimeCtx,
): InvariantLamp[] {
  if (state.strategy === null || state.terminal !== null) {
    return [];
  }
  const def = activeDef(state, ctx);
  const node = nodeOf(def, state.strategy.nodeId);
  const lamps: InvariantLamp[] = [];
  const pre = checkPre(state, node, ctx.config);
  const preSpecs = node.pre ?? [];
  preSpecs.forEach((spec, i) => {
    const check: CheckResult | undefined = pre.checks[i];
    lamps.push({
      id: specLabel(spec),
      phase: "pre",
      passed: check?.passed ?? false,
      detail: check?.detail ?? "unevaluated",
    });
  });
  if (pre.kind === "failed") {
    return lamps;
  }
  const post = checkPost(state, node, ctx.config);
  const postSpecs = node.post ?? [];
  postSpecs.forEach((spec, i) => {
    const check: CheckResult | undefined = post.checks[i];
    lamps.push({
      id: specLabel(spec),
      phase: "post",
      passed: check?.passed ?? false,
      detail: check?.detail ?? "unevaluated",
    });
  });
  return lamps;
}

function specLabel(spec: {
  kind: string;
  k?: number;
  cls?: string;
  checkerId?: string;
}): string {
  switch (spec.kind) {
    case "exists-k-hole":
      return `exists-${spec.k}-hole`;
    case "exists-shared-edge-pair":
      return `shared-edge-pair-${spec.k}`;
    case "region-empty-of":
      return "region-empty";
    case "config-class":
      return `config-${spec.cls}`;
    case "custom":
      return spec.checkerId ?? "custom";
    default:
      return spec.kind;
  }
}

export interface CaseData {
  cells: EffectiveCells;
  samples: ReadonlyArray<SampleReply | null>;
  cases: readonly string[];
}

// caseData: effective cells + one sample per case (in route order) for the
// parked classify node; null when no strategy or no classify park.
export function caseData(
  state: GameState,
  ctx: RuntimeCtx,
): CaseData | null {
  if (state.strategy === null || state.terminal !== null) {
    return null;
  }
  const def = activeDef(state, ctx);
  const node = nodeOf(def, state.strategy.nodeId);
  if (node.role !== "classify-breaker") {
    return null;
  }
  const cells = effectiveCells(state, def, node.id, ctx.config);
  if (!cells.available) {
    return { cells, samples: [], cases: [] };
  }
  const samples = cells.groups.map((g) =>
    sampleForCase(state, def, node.id, g.caseId, ctx.config),
  );
  return {
    cells,
    samples,
    cases: cells.groups.map((g) => g.caseId),
  };
}

export interface SessionStats {
  round: number;
  move: number;
  points: number;
  turn: string;
}

// sessionStats: display counters (integer UI arithmetic, never geometry;
// bit-shift ceil avoids even Math.* outside projection.ts).
export function sessionStats(state: GameState): SessionStats {
  const move = state.points.length;
  return {
    round: move === 0 ? 0 : ((move + 1) >> 1),
    move,
    points: move,
    turn: state.turn,
  };
}

export interface WinCard {
  title: string;
  stats: string;
  witnesses: readonly string[];
  honesty: string;
  nodeId: string;
}

// winCard (§11.7): terminal maker-won summary data, honesty included.
export function winCard(state: GameState): WinCard | null {
  if (state.terminal?.kind !== "maker-won") {
    return null;
  }
  const terminal = state.terminal;
  const stats = sessionStats(state);
  return {
    title: `Maker wins — ${terminal.witness.length} witness hole(s)`,
    stats: `Round ${stats.round} · ${stats.points} points · node ${terminal.nodeId}`,
    witnesses: terminal.witness.map((h) =>
      witnessLabel(gameModeOf(state), h.verts),
    ),
    honesty:
      "This replay followed the encoded strategy; it demonstrates the construction, it does not by itself constitute the proof — see the cited source. " +
      HONESTY_STATEMENT,
    nodeId: terminal.nodeId,
  };
}

export interface StrategyListItem {
  id: string;
  k: number;
  version: string;
  tier: string;
  status: string;
  paper: string;
}

// listStrategies: picker data (badges derived — Gate E; ui-safe shape).
export function listStrategies(ctx: RuntimeCtx): StrategyListItem[] {
  const out: StrategyListItem[] = [];
  for (const rs of ctx.strategies.values()) {
    out.push({
      id: rs.def.id,
      k: rs.def.k,
      version: rs.def.version,
      tier: rs.tier,
      status: effectiveStatus(rs),
      paper: rs.def.source.paper,
    });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export interface StatusBadge {
  text: string;
  title: string;
}

// statusBadge (Gate E): derived from RegisteredStrategy.effectiveStatus —
// never an ad-hoc string. Null when no strategy is active.
export function statusBadge(
  state: GameState,
  ctx: RuntimeCtx,
): StatusBadge | null {
  if (state.strategy === null) {
    return null;
  }
  const reg: RegisteredStrategy | undefined = ctx.strategies.get(
    state.strategy.strategyId,
  );
  if (reg === undefined) {
    return null;
  }
  return {
    text: `Status: ${effectiveStatus(reg)}`,
    title: `Strategy ${reg.def.id} v${reg.def.version}`,
  };
}

// k6PresetSupplied: the shipped k6 entry record (engine-owned bridge —
// ui/ never imports strategy/; §18.1).
export function k6PresetSupplied(): StrategyStart {
  return presetSupplied();
}

// k7PresetSupplied: the shipped k7 entry record (Lemma 8 starts from a
// 6-hole; odd point count => Breaker to move).
export function k7PresetSupplied(): StrategyStart {
  return presetStartForImpl("esmb-k7") as StrategyStart;
}

// presetStartFor: the entry chooser's data-driven bridge — the shipped
// StrategyStart for strategies whose entry is a classify-breaker node
// (undefined for strategies that start from an empty board).
export function presetStartFor(strategyId: string): StrategyStart | undefined {
  return presetStartForImpl(strategyId);
}

export interface StrategyOverlay {
  nodeId: string;
  label: string;
  style: string;
  region: RegionValue | null;
  skipped: string | null;
}

// strategyOverlays (§14.1 passive strategy overlay): every region overlay
// declared by the strategy's nodes, evaluated on the CURRENT (sandbox)
// state on the analysis channel. Overlays naming guided vars fail loud
// inside evalRegion — caught per overlay and listed as needing a
// live guided session; capped hole-enumerations list as capped. Null for
// unknown strategies. Pure; layers render region polys, never routes.
export function strategyOverlays(
  strategyId: string,
  state: GameState,
  ctx: RuntimeCtx,
): StrategyOverlay[] | null {
  const reg = ctx.strategies.get(strategyId);
  if (reg === undefined) {
    return null;
  }
  const out: StrategyOverlay[] = [];
  const seen = new Set<string>();
  for (const node of Object.values(reg.def.nodes)) {
    for (const show of node.show) {
      if (show.kind !== "region") {
        continue;
      }
      const key = `${node.id}|${show.label}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      try {
        const r = evalRegion(show.expr, { state, config: ctx.config, channel: "analysis" });
        if (r.kind === "complete") {
          out.push({ nodeId: node.id, label: show.label, style: show.style, region: r.region, skipped: null });
        } else {
          out.push({
            nodeId: node.id,
            label: show.label,
            style: show.style,
            region: null,
            skipped: "capped analysis — run with fewer points or more budget",
          });
        }
      } catch {
        out.push({
          nodeId: node.id,
          label: show.label,
          style: show.style,
          region: null,
          skipped: "needs a live guided session (names strategy vars)",
        });
      }
    }
  }
  return out;
}

export interface ThreatPreview {
  caseId: CaseId;
  targetHeadline: string;
}

// threatPreview (§12.2 step 1): the EXACT case the cursor point would draw
// — hypo-place it (pure, discarded) and run the real first-match routing,
// whose inputs (e.g. last-n) resolve only with the pending point present.
// (The effective-cell wash cannot resolve such inputs pre-placement, so the
// preview does not go through cells; the wash stays a teaching overlay for
// nodes whose boundaries resolve.) Null when no classification is pending,
// the point is illegal (the ghost halo covers that), or routing fails.
export function threatPreview(
  state: GameState,
  ctx: RuntimeCtx,
  at: Pt,
): ThreatPreview | null {
  if (state.strategy === null || state.terminal !== null) {
    return null;
  }
  const def = activeDef(state, ctx);
  const node = nodeOf(def, state.strategy.nodeId);
  if (node.role !== "classify-breaker") {
    return null;
  }
  if (checkPlacement(state, at, ctx.config.window) !== null) {
    return null;
  }
  const hypo = placePoint(state, "breaker", at);
  const r = classify(def, hypo, node.id, placedId(hypo), ctx.config);
  if (!r.ok) {
    return null;
  }
  const target = nodeOf(def, r.target);
  return { caseId: r.case, targetHeadline: target.why.headline };
}

export interface CaseWashCell {
  caseId: CaseId;
  poly: ConvexPoly;
}

// caseWash (§11.5/§12.2): every effective cell of the parked classify node
// with its case — the overlay wash. Empty when no map is available.
export function caseWash(
  state: GameState,
  ctx: RuntimeCtx,
): CaseWashCell[] {
  if (state.strategy === null || state.terminal !== null) {
    return [];
  }
  const def = activeDef(state, ctx);
  const node = nodeOf(def, state.strategy.nodeId);
  if (node.role !== "classify-breaker") {
    return [];
  }
  const cells = effectiveCells(state, def, node.id, ctx.config);
  if (!cells.available) {
    return [];
  }
  const out: CaseWashCell[] = [];
  for (const group of cells.groups) {
    for (const cell of group.cells) {
      out.push({ caseId: group.caseId, poly: cell.poly });
    }
  }
  return out;
}

export interface HoleDiff {
  size: number;
  died: readonly (readonly PointId[])[];
  survived: readonly (readonly PointId[])[];
  emerged: readonly (readonly PointId[])[];
  emergedWithMoved: readonly (readonly PointId[])[];
}

export type EffectDiffResult =
  | { available: true; sizes: readonly HoleDiff[]; movedId: PointId }
  | { available: false; reason: string };

// effectDiff (§12.2 step 3, §12.3b): (k−1)- and k-hole sets before/after a
// placement, keyed by sorted vertex-id tuples. "Emerged with moved" =
// replacement holes using the new point as a vertex. Exhaustive at guided
// sizes; a capped enumeration yields NO diff (never a partial one) with
// the fixed budget wording for the panel.
export function effectDiff(
  before: GameState,
  after: GameState,
  k: number,
  movedId: PointId,
  budgetOps: number,
): EffectDiffResult {
  const sizes: HoleDiff[] = [];
  for (const size of [k - 1, k]) {
    if (size < 3) {
      continue;
    }
    const snap = (s: GameState): Map<string, readonly PointId[]> => {
      const found = findWinHoles(s, size, {
        mode: "exhaustive",
        budget: budgetOps,
      });
      if (found.kind !== "exhaustive") {
        throw new Error("effectDiff: capped enumeration");
      }
      const out = new Map<string, readonly PointId[]>();
      for (const h of found.holes) {
        out.set([...h.verts].sort().join("|"), [...h.verts].sort());
      }
      return out;
    };
    let prev: Map<string, readonly PointId[]>;
    let next: Map<string, readonly PointId[]>;
    try {
      prev = snap(before);
      next = snap(after);
    } catch {
      return {
        available: false,
        reason: `hole enumeration capped over ${after.points.length} points — diff not established`,
      };
    }
    const died: (readonly PointId[])[] = [];
    const survived: (readonly PointId[])[] = [];
    const emerged: (readonly PointId[])[] = [];
    const emergedWithMoved: (readonly PointId[])[] = [];
    for (const [key, verts] of prev) {
      if (next.has(key)) {
        survived.push(verts);
      } else {
        died.push(verts);
      }
    }
    for (const [key, verts] of next) {
      if (!prev.has(key)) {
        emerged.push(verts);
        if (verts.includes(movedId)) {
          emergedWithMoved.push(verts);
        }
      }
    }
    // Zero-activity sizes (no holes on either side) carry no information —
    // the case line already says what happened.
    if (died.length > 0 || survived.length > 0 || emerged.length > 0) {
      sizes.push({ size, died, survived, emerged, emergedWithMoved });
    }
  }
  return { available: true, sizes, movedId };
}

export interface AttackEntry {
  txnId: number;
  point: { x: string; y: string };
  caseId: CaseId | null;
  terminalKind: string | null;
  diff: EffectDiffResult;
  claims: Claim[];
}

export interface AttackLog {
  format: "esmb-attack-log";
  version: 1;
  strategyId: string;
  strategyVersion: string;
  k: number;
  entries: AttackEntry[];
  summary: {
    classified: number;
    byCase: Record<string, number>;
    uncovered: number;
    wins: number;
    integrity: number;
  };
}

// attackLog (§12.6): one entry per committed Breaker transaction, derived
// from the tree alone (states via atTxn — no mode-local copies). Evaluative
// sentences are tiered `observed` claims with numbers interpolated from the
// diff data (§13.1). Null for strategy-less (sandbox) trees.
export function attackLog(
  tree: SessionTree,
  atTxn: (txnId: number) => GameState,
  budgetOps: number,
): AttackLog | null {
  const head = tree.transactions.length === 0
    ? null
    : atTxn(tree.transactions[tree.transactions.length - 1]?.txnId ?? 0);
  if (head === null || head.strategy === null) {
    return null;
  }
  const strategyId = head.strategy.strategyId;
  const strategyVersion = head.strategy.version;
  const k = head.k;
  const entries: AttackEntry[] = [];
  const byCase: Record<string, number> = {};
  let uncovered = 0;
  let wins = 0;
  let integrity = 0;
  for (const txn of tree.transactions) {
    if (txn.parentTxnId === null) {
      continue; // txn 0: init, no Breaker move.
    }
    const placed = txn.events.find((e) => e.owner === "breaker");
    if (placed === undefined) {
      continue; // no Breaker placement in this txn.
    }
    const after = atTxn(txn.txnId);
    const before = atTxn(txn.parentTxnId);
    const caseId: CaseId | null = placed.caseId ?? null;
    if (caseId !== null) {
      byCase[caseId] = (byCase[caseId] ?? 0) + 1;
    }
    const terminalKind = after.terminal?.kind ?? null;
    if (terminalKind === "uncovered") {
      uncovered += 1;
    } else if (terminalKind === "maker-won") {
      wins += 1;
    } else if (terminalKind === "strategy-integrity-failure") {
      integrity += 1;
    }
    const diff = effectDiff(before, after, k, placed.appliedPoint, budgetOps);
    const claims: Claim[] = [];
    if (caseId !== null) {
      claims.push({ tier: "observed", text: `Txn ${txn.txnId}: classified ${caseId}.` });
    } else {
      claims.push({
        tier: "observed",
        text: `Txn ${txn.txnId}: the win pre-empted routing (no case).`,
      });
    }
    if (diff.available) {
      for (const s of diff.sizes) {
        claims.push({
          tier: "observed",
          text:
            `Txn ${txn.txnId}: ${s.died.length} ${s.size}-hole(s) destroyed, ` +
            `${s.survived.length} survived, ${s.emerged.length} emerged ` +
            `(${s.emergedWithMoved.length} use ${diff.movedId}).`,
        });
      }
    } else {
      claims.push({ tier: "observed", text: `Txn ${txn.txnId}: ${diff.reason}.` });
    }
    entries.push({
      txnId: txn.txnId,
      point: { x: placed.at.x.toString(), y: placed.at.y.toString() },
      caseId,
      terminalKind,
      diff,
      claims,
    });
  }
  return {
    format: "esmb-attack-log",
    version: 1,
    strategyId,
    strategyVersion,
    k,
    entries,
    summary: {
      classified: entries.filter((e) => e.caseId !== null).length,
      byCase,
      uncovered,
      wins,
      integrity,
    },
  };
}

// ---- guided overlays (; spec §11.3/§11.6/§17.2) ----

export interface GuidedOverlay {
  readonly label: string;
  readonly style: string; // RegionStyle | "twin"
  readonly polys: readonly (readonly Pt[])[];
}

// guidedOverlays: the CURRENT node's declared `show` overlays, evaluated on
// the live state (correctness channel — region exprs may name strategy
// vars): `region` specs (forced region, ears, hulls…) and the `twin`
// highlight (the bound pre-B1 twinA/twinB). Nothing is invented: a spec that
// cannot be evaluated exactly (incomplete / unbound) is skipped, never drawn
// as empty. Null when no strategy is active. Pure.
export function guidedOverlays(
  state: GameState,
  ctx: RuntimeCtx,
): GuidedOverlay[] | null {
  if (state.strategy === null || state.terminal !== null) {
    return null;
  }
  const def = activeDef(state, ctx);
  const node = nodeOf(def, state.strategy.nodeId);
  const out: GuidedOverlay[] = [];
  for (const show of node.show) {
    if (show.kind === "region") {
      try {
        const r = evalRegion(show.expr, {
          state,
          config: ctx.config,
          channel: "correctness",
        });
        if (r.kind !== "complete") {
          continue;
        }
        const parts = r.region.kind === "poly" ? [r.region] : r.region.parts;
        const polys: Pt[][] = [];
        for (const part of parts) {
          if (part.kind === "poly" && part.verts.length >= 3) {
            polys.push([...part.verts]);
          }
        }
        if (polys.length > 0) {
          out.push({ label: show.label, style: show.style, polys });
        }
      } catch {
        // names a var not bound at this node: skip (never drawn)
      }
    } else if (
      show.kind === "highlight-hole" &&
      (show.pattern === "twin" ||
        (show.pattern === "survivors" &&
          Array.isArray(state.strategy.vars["twinA"])))
    ) {
      const vars = state.strategy.vars;
      const polys: Pt[][] = [];
      for (const v of ["twinA", "twinB"]) {
        const ids = vars[v];
        if (!Array.isArray(ids)) {
          continue;
        }
        const pts = ids.map((id) => state.points.find((p) => p.id === id)?.pt);
        if (pts.every((p) => p !== undefined)) {
          polys.push(hullOf(pts as Pt[]));
        }
      }
      if (polys.length > 0) {
        out.push({
          label: `twin ${(polys[0] as Pt[]).length}-holes (pre-B1 witnesses)`,
          style: "twin",
          polys,
        });
      }
    }
  }
  return out;
}
