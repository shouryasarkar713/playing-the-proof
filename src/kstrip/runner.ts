// kstrip/runner.ts — executable Maker strategy of Džuklevski et al.
//
// runKStrip builds, with exact geometry, parallel k-strips against a
// Breaker policy and VERIFIES every claimed strip with the exact predicates
// (Definition 2) on the final board. Variants:
//   mono-1:1      Theorem 3 (pairing, adoption)               — verified by tests
//   mono-1:s      Theorem 4 (groups of 2s, slab-restricted)   — verified by tests
//   bichromatic   Theorem 5 (tilted candidates, strict count) — verified by tests
// Every Breaker move is validated for legality (general position; in the
// monochromatic BASE phase also distinct x, the paper's "WLOG distinct x"),
// and every move is logged for replay.
import { eqPt, pt } from "../geometry/pt.ts";
import type { Pt } from "../geometry/pt.ts";
import { Rat } from "../geometry/rat.ts";
import {
  DOWN,
  IDENTITY,
  frameOf,
  fromFrame,
  shearPt,
  tilt,
  toFrame,
} from "./frame.ts";
import type { Frame } from "./frame.ts";
import { buildLedger } from "./ledger.ts";
import type { Ledger, OwnedPoint, Owner, UnitSpec } from "./ledger.ts";
import {
  canAdd,
  chooseApex,
  groupExtension,
  lineBlocked,
  pairRegions,
  planGroup,
  planPair,
  replanLine,
  settlePair,
} from "./pairing.ts";
import type { Cone } from "./cone.ts";
import type { GroupPlan, PairPlan } from "./pairing.ts";
import {
  DEFAULT_BUDGET,
  ceilRat,
  checkBudget,
  estimateCost,
  floorRat,
} from "./recursion.ts";
import type { Budget, RunSpec, Variant } from "./recursion.ts";
import {
  StripRegion,
  interiorsDisjoint,
  isStrip,
  parallel,
  sharedHalfline,
} from "./region.ts";
import { summarizeLedger } from "./trace.ts";
import type { TraceCone, TraceEvent, TraceObserver, TraceUnit } from "./trace.ts";
import type {
  BreakerPolicy,
  BreakerView,
  LegalResult,
  LevelReport,
  MoveKind,
  MoveLogEntry,
  MoveReason,
  PhaseKind,
  RunResult,
  RunStatus,
  StripClaim,
} from "./types.ts";

class BudgetExceeded extends Error {}
class RunFailure extends Error {
  readonly status: RunStatus;
  constructor(status: RunStatus, message: string) {
    super(message);
    this.status = status;
  }
}

interface Ctx {
  readonly spec: RunSpec;
  readonly budget: Budget;
  readonly policy: BreakerPolicy;
  readonly mono: boolean;
  frame: Frame;
  base: { pt: Pt; owner: Owner }[];
  fpts: OwnedPoint[];
  log: MoveLogEntry[];
  round: number;
  n: number;
  work: bigint;
  levels: LevelReport[];
  checks: { name: string; ok: boolean }[];
  trace: TraceObserver | null;
}

// ---- optional trace (observation only; never metered, never read back) ----

function toBaseOf(ctx: Ctx): (p: Pt) => Pt {
  const f = ctx.frame;
  return (p: Pt) => fromFrame(f, p);
}

function traceCone(ctx: Ctx, c: Cone): TraceCone {
  const f = ctx.frame;
  return {
    side: c.side,
    apex: fromFrame(f, c.apex),
    rayTo: fromFrame(f, pt(c.apex.x.add(c.rayF.x), c.apex.y.add(c.rayF.y))),
    stop: c.stop.kind,
    blocker: c.stop.kind === "blocked" ? fromFrame(f, c.stop.blocker) : null,
  };
}

function emit(ctx: Ctx, make: () => TraceEvent): void {
  if (ctx.trace !== null) {
    ctx.trace(make());
  }
}

function strips2base(ctx: Ctx, strips: readonly (readonly Pt[])[]): Pt[][] {
  const f = toBaseOf(ctx);
  return strips.map((s) => s.map(f));
}

function meter(ctx: Ctx, units: number | bigint): void {
  ctx.work += BigInt(units);
  if (ctx.work > ctx.budget.maxWork) {
    throw new BudgetExceeded("work budget exhausted");
  }
}

function check(ctx: Ctx, name: string, ok: boolean): void {
  ctx.checks.push({ name, ok });
  if (!ok) {
    throw new RunFailure("invariant-failure", `exact check failed: ${name}`);
  }
}

function framePts(ctx: Ctx): Pt[] {
  return ctx.fpts.map((o) => o.pt);
}

interface PhaseInfo {
  phase: PhaseKind;
  level: number;
  levelRound: number;
}

function legalMove(ctx: Ctx, phase: PhaseKind, p: Pt): LegalResult {
  meter(ctx, ctx.fpts.length);
  for (const o of ctx.fpts) {
    if (eqPt(o.pt, p)) {
      return { ok: false, code: "duplicate", message: "point already placed" };
    }
    if (phase === "base" && o.pt.x.equals(p.x)) {
      return {
        ok: false,
        code: "same-x",
        message: "monochromatic base phase requires distinct x (paper: WLOG)",
      };
    }
  }
  if (!canAdd(framePts(ctx), p)) {
    return {
      ok: false,
      code: "collinear",
      message: "point is collinear with two placed points",
    };
  }
  return { ok: true, code: "ok", message: "legal" };
}

function addPoint(
  ctx: Ctx,
  pf: Pt,
  owner: Owner,
  kind: MoveKind,
  info: PhaseInfo,
  note: string,
  reason: MoveReason | null,
): void {
  const base = fromFrame(ctx.frame, pf);
  ctx.n += 1;
  ctx.base.push({ pt: base, owner });
  ctx.fpts.push({ pt: pf, owner });
  const entry: MoveLogEntry = {
    n: ctx.n,
    round: ctx.round,
    phase: info.phase,
    level: info.level,
    levelRound: info.levelRound,
    player: owner,
    kind,
    pt: base,
    ptFrame: pf,
    frameC: ctx.frame.c.toString(),
    note,
    reason,
  };
  ctx.log.push(entry);
  emit(ctx, () => ({ kind: "move", entry }));
}

function bboxOf(ctx: Ctx): { xMin: Pt; xMax: Pt; yMin: Pt; yMax: Pt } {
  let first = ctx.fpts[0]?.pt ?? pt(Rat.ZERO, Rat.ZERO);
  let xMin = first;
  let xMax = first;
  let yMin = first;
  let yMax = first;
  for (const o of ctx.fpts) {
    first = o.pt;
    if (first.x.cmp(xMin.x) < 0) xMin = first;
    if (first.x.cmp(xMax.x) > 0) xMax = first;
    if (first.y.cmp(yMin.y) < 0) yMin = first;
    if (first.y.cmp(yMax.y) > 0) yMax = first;
  }
  return { xMin, xMax, yMin, yMax };
}

function makeView(
  ctx: Ctx,
  info: PhaseInfo,
  left: number,
  total: number,
  ledgerFn: (() => Ledger) | null,
): BreakerView {
  let memo: Ledger | null = null;
  return {
    variant: ctx.spec.variant,
    phase: info.phase,
    level: info.level,
    levelRound: info.levelRound,
    breakerMovesLeftInPhase: left,
    breakerMovesTotalInPhase: total,
    frame: ctx.frame,
    points: ctx.fpts.slice(),
    ledger: () => {
      if (ledgerFn === null) {
        return null;
      }
      memo ??= ledgerFn();
      return memo;
    },
    legal: (p: Pt) => legalMove(ctx, info.phase, p),
    bbox: () => bboxOf(ctx),
  };
}

function breakerMove(
  ctx: Ctx,
  info: PhaseInfo,
  left: number,
  total: number,
  ledgerFn: (() => Ledger) | null,
  phasePts: Pt[],
): void {
  const view = makeView(ctx, info, left, total, ledgerFn);
  const dec = ctx.policy.choose(view);
  const lg = legalMove(ctx, info.phase, dec.point);
  if (!lg.ok) {
    throw new RunFailure(
      "invalid-breaker-move",
      `policy ${ctx.policy.name} chose an illegal point: ${lg.code}`,
    );
  }
  addPoint(ctx, dec.point, "breaker", "breaker", info, dec.reason.summary, dec.reason);
  phasePts.push(dec.point);
}

// Breaker moves owed after Maker's m-th move of a phase.
function breakerAfter(ctx: Ctx, m: bigint): number {
  const s = ctx.spec.s ?? Rat.ONE;
  if (ctx.spec.variant === "bichromatic") {
    return Number(floorRat(s.mul(Rat.make(m))) - floorRat(s.mul(Rat.make(m - 1n))));
  }
  return Number(s.n);
}

function breakerTotal(ctx: Ctx, makerMoves: bigint): number {
  let tot = 0;
  for (let m = 1n; m <= makerMoves; m += 1n) {
    tot += breakerAfter(ctx, m);
  }
  return tot;
}

// ---------------------------------------------------------------------------
// Base phase: Maker places points on the parabola y = x^2 (+ offset for
// general position) at fresh integer abscissae.

function makerBasePoint(ctx: Ctx): Pt {
  const mono = ctx.mono;
  let mx = 0n;
  const used = new Set<string>();
  for (const o of ctx.fpts) {
    used.add(o.pt.x.toString());
    const c = ceilRat(o.pt.x);
    if (c > mx) {
      mx = c;
    }
  }
  let x = mx + 1n;
  while (used.has(Rat.make(x).toString())) {
    x += 1n;
  }
  const S = framePts(ctx);
  const xr = Rat.make(x);
  for (let off = 0n; off < 100000n; off += 1n) {
    for (const sg of off === 0n ? [1n] : [1n, -1n]) {
      const y = xr.mul(xr).add(Rat.make(off * sg));
      const p = pt(xr, y);
      if (canAdd(S, p) && (!mono || !used.has(xr.toString()))) {
        return p;
      }
    }
  }
  throw new RunFailure("invariant-failure", "no legal base point found");
}

function basePhase(
  ctx: Ctx,
  level: number,
  makerMoves: bigint,
  phase: PhaseKind,
): void {
  const phasePts: Pt[] = [];
  for (let m = 1n; m <= makerMoves; m += 1n) {
    ctx.round += 1;
    const info: PhaseInfo = { phase, level, levelRound: Number(m) };
    const p = makerBasePoint(ctx);
    addPoint(ctx, p, "maker", "base-point", info, "Maker base point", null);
    const nb = breakerAfter(ctx, m);
    for (let b = 0; b < nb; b += 1) {
      breakerMove(ctx, info, nb - b, nb, null, phasePts);
    }
  }
}

function sortStrips(strips: Pt[][]): Pt[][] {
  const out = strips.map((s) => [...s].sort((a, b) => a.x.cmp(b.x)));
  out.sort((a, b) => (a[0] as Pt).x.cmp((b[0] as Pt).x));
  return out;
}

function validStripsFromChains(ctx: Ctx, chains: Pt[][]): Pt[][] {
  const S = framePts(ctx);
  const out: Pt[][] = [];
  for (const c of chains) {
    meter(ctx, S.length * c.length);
    const r = isStrip(c, S, DOWN);
    if (r.ok) {
      out.push([...r.region.vertices]);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tilt (Theorem 5 / Observation 6): find delta so that, in the tilted frame,
// all x are distinct, every candidate is a strict strip shape, the two
// candidates of a pair meet exactly in the halfline below the apex, no Maker
// point (other than vertices) is inside a candidate, and every Breaker point
// lies in at most one closed region.

interface TiltPair {
  left: readonly Pt[];
  right: readonly Pt[];
  apex: Pt;
}

function acceptTilt(
  ctx: Ctx,
  delta: Rat,
  pairs: readonly TiltPair[],
): boolean {
  const pts = ctx.fpts.map((o) => ({ p: shearPt(delta, o.pt), owner: o.owner }));
  const xs = new Set<string>();
  for (const q of pts) {
    const k = q.p.x.toString();
    if (xs.has(k)) {
      return false;
    }
    xs.add(k);
  }
  const regions: StripRegion[] = [];
  for (const pr of pairs) {
    const a = StripRegion.make([...pr.left, pr.apex].map((p) => shearPt(delta, p)), DOWN);
    const b = StripRegion.make([pr.apex, ...pr.right].map((p) => shearPt(delta, p)), DOWN);
    if (!a.ok || !b.ok) {
      return false;
    }
    if (!interiorsDisjoint(a.region, b.region)) {
      return false;
    }
    if (sharedHalfline(a.region, b.region) === null) {
      return false;
    }
    regions.push(a.region, b.region);
  }
  meter(ctx, pts.length * regions.length);
  for (const q of pts) {
    let hits = 0;
    for (const r of regions) {
      if (r.vertices.some((v) => eqPt(v, q.p))) {
        continue;
      }
      if (r.classify(q.p) !== "exterior") {
        if (q.owner === "maker") {
          return false;
        }
        hits += 1;
      }
    }
    if (hits > 1) {
      return false;
    }
  }
  return true;
}

function applyTilt(ctx: Ctx, delta: Rat): void {
  ctx.frame = tilt(ctx.frame, delta);
  ctx.fpts = ctx.fpts.map((o) => ({ pt: shearPt(delta, o.pt), owner: o.owner }));
}

function chooseAndApplyTilt(ctx: Ctx, pairs: readonly TiltPair[]): Rat {
  for (let n = 1; n <= 60; n += 1) {
    const den = 1n << BigInt(n);
    for (const sg of [1n, -1n]) {
      const delta = Rat.make(sg, den);
      if (acceptTilt(ctx, delta, pairs)) {
        applyTilt(ctx, delta);
        return delta;
      }
    }
  }
  throw new RunFailure("invariant-failure", "no admissible tilt found (60 halvings)");
}

// ---------------------------------------------------------------------------
// Pairing phase (Theorem 3 with adoption, Theorem 5 without).

interface PairState {
  plan: PairPlan;
  apex0: Pt; // provisional (planned) apex, then the placed one
  placed: boolean;
}

function pairingPhase(
  ctx: Ctx,
  level: number,
  inputsAll: Pt[][],
  unitsT: bigint,
  adopt: boolean,
  required: bigint,
): Pt[][] {
  const phase: PhaseKind = adopt ? "pairing" : "bichromatic-pairing";
  const inputs = sortStrips(inputsAll).slice(0, Number(unitsT) * 2);
  if (inputs.length < Number(unitsT) * 2) {
    throw new RunFailure("invariant-failure", "not enough input strips for pairing");
  }
  const S0 = framePts(ctx);
  const states: PairState[] = [];
  for (let j = 0; j < Number(unitsT); j += 1) {
    const pr = planPair(S0, inputs[2 * j] as Pt[], inputs[2 * j + 1] as Pt[], j + 1);
    if (!pr.ok) {
      throw new RunFailure("invariant-failure", `planPair failed: ${pr.reason.code}`);
    }
    const apex = chooseApex(pr.plan.top, pr.plan.xLine, (p) => canAdd(S0, p));
    if (apex === null) {
      throw new RunFailure("invariant-failure", "no legal apex");
    }
    states.push({ plan: pr.plan, apex0: apex, placed: false });
  }
  const phasePts: Pt[] = [];
  const budgetTotal = breakerTotal(ctx, unitsT);

  const unitSpecs = (): UnitSpec[] => {
    const S = framePts(ctx);
    const out: UnitSpec[] = [];
    for (const st of states) {
      const pool = st.placed ? S : [...S, st.apex0];
      const settled = settlePair(pool, st.plan.left, st.plan.right, st.apex0, adopt);
      const reg = pairRegions(settled.left, settled.right, settled.apex);
      if (reg === null) {
        throw new RunFailure("invariant-failure", "adoption produced an invalid chain");
      }
      out.push({
        unit: st.plan.index,
        regions: [
          { id: `R${2 * st.plan.index - 1}`, region: reg.left },
          { id: `R${2 * st.plan.index}`, region: reg.right },
        ],
        adoption: settled.events,
      });
    }
    return out;
  };
  const ledgerNow = (): Ledger => {
    meter(ctx, ctx.fpts.length * states.length * 2);
    return buildLedger({
      units: unitSpecs(),
      points: ctx.fpts,
      breakerPhasePoints: phasePts,
      budgetTotal,
      required: Number(required),
      mode: adopt ? "adopt" : "pre-tilt",
    });
  };
  const snapLedger = (): void => {
    if (ctx.trace === null) {
      return;
    }
    const specs0 = unitSpecs();
    const lg = buildLedger({
      units: specs0,
      points: ctx.fpts,
      breakerPhasePoints: phasePts,
      budgetTotal,
      required: Number(required),
      mode: adopt ? "adopt" : "pre-tilt",
    });
    const sm = summarizeLedger(lg, specs0, toBaseOf(ctx));
    emit(ctx, () => ({
      kind: "ledger",
      phase,
      level,
      logLength: ctx.log.length,
      dir: ctx.frame.dir,
      regions: sm.regions,
      ledger: sm.ledger,
    }));
  };
  emit(ctx, () => {
    const f = toBaseOf(ctx);
    const plans: TraceUnit[] = states.map((st) => ({
      unit: st.plan.index,
      strips: strips2base(ctx, [st.plan.left, st.plan.right]),
      lineTop: f(pt(st.plan.xLine, st.plan.top)),
      cones: [traceCone(ctx, st.plan.coneLeft), traceCone(ctx, st.plan.coneRight)],
    }));
    return {
      kind: "phase-start",
      phase,
      level,
      logLength: ctx.log.length,
      dir: ctx.frame.dir,
      required: Number(required),
      units: states.length,
      breakerBudget: budgetTotal,
      inputs: strips2base(ctx, inputs),
      plans,
    };
  });

  for (let m = 1n; m <= unitsT; m += 1n) {
    ctx.round += 1;
    const info: PhaseInfo = { phase, level, levelRound: Number(m) };
    const st = states[Number(m) - 1] as PairState;
    const Scur = framePts(ctx);
    if (lineBlocked(Scur, st.plan.xLine)) {
      const np = replanLine(Scur, st.plan.lo, st.plan.hi, [
        { strip: st.plan.left, side: "plus", original: st.plan.coneLeft },
        { strip: st.plan.right, side: "minus", original: st.plan.coneRight },
      ]);
      st.plan = { ...st.plan, xLine: np.xLine, top: np.top };
      ctx.checks.push({ name: `pair ${st.plan.index}: line re-planned after blocking`, ok: true });
    }
    const apex = chooseApex(st.plan.top, st.plan.xLine, (p) => canAdd(Scur, p));
    if (apex === null) {
      throw new RunFailure("invariant-failure", "no legal apex at placement");
    }
    st.apex0 = apex;
    st.placed = true;
    addPoint(
      ctx,
      apex,
      "maker",
      "apex",
      info,
      `p_${st.plan.index} on the halfline l_j ∩ C+ ∩ C-`,
      null,
    );
    snapLedger();
    const nb = breakerAfter(ctx, m);
    for (let b = 0; b < nb; b += 1) {
      breakerMove(ctx, info, nb - b, nb, ledgerNow, phasePts);
      snapLedger();
    }
  }

  // Finalise: ledger, optional tilt, harvest one strip per surviving pair.
  let tiltNote: string | null = null;
  if (!adopt) {
    const pairs: TiltPair[] = states.map((st) => ({
      left: st.plan.left,
      right: st.plan.right,
      apex: st.apex0,
    }));
    const d = chooseAndApplyTilt(ctx, pairs);
    tiltNote = d.toString();
    for (const st of states) {
      st.apex0 = shearPt(d, st.apex0);
      st.plan = {
        ...st.plan,
        left: st.plan.left.map((p) => shearPt(d, p)),
        right: st.plan.right.map((p) => shearPt(d, p)),
      };
    }
  }
  const S = framePts(ctx);
  const specs = unitSpecs();
  const chosen: Pt[][] = [];
  let absorbed = 0;
  let wasted = 0;
  let interior = 0;
  let final: Ledger;
  if (adopt) {
    final = ledgerNow();
  } else {
    final = buildLedger({
      units: specs,
      points: ctx.fpts,
      breakerPhasePoints: phasePts.map((p) => (tiltNote === null ? p : shearPt(Rat.fromString(tiltNote), p))),
      budgetTotal,
      required: Number(required),
      mode: "adopt", // after the tilt boundary points block (none expected)
    });
  }
  for (const u of final.units) {
    const st = states[u.unit - 1] as PairState;
    const spec = specs[u.unit - 1] as UnitSpec;
    const settled = settlePair(S, st.plan.left, st.plan.right, st.apex0, adopt);
    const regL = u.regions[0];
    const regR = u.regions[1];
    check(
      ctx,
      `pair ${u.unit}: interiors of R_{2j-1}, R_{2j} disjoint`,
      interiorsDisjoint(
        (spec.regions[0] as { region: StripRegion }).region,
        (spec.regions[1] as { region: StripRegion }).region,
      ),
    );
    check(
      ctx,
      `pair ${u.unit}: regions share exactly the halfline below the apex`,
      sharedHalfline(
        (spec.regions[0] as { region: StripRegion }).region,
        (spec.regions[1] as { region: StripRegion }).region,
      ) !== null,
    );
    let verts: Pt[] | null = null;
    if (regL !== undefined && regL.live) {
      verts = [...settled.left, settled.apex];
    } else if (regR !== undefined && regR.live) {
      verts = [settled.apex, ...settled.right];
    }
    if (verts !== null) {
      meter(ctx, S.length * verts.length);
      const v = isStrip(verts, S, DOWN);
      check(ctx, `pair ${u.unit}: claimed strip passes Definition 2`, v.ok);
      if (v.ok) {
        chosen.push([...v.region.vertices]);
      }
    }
  }
  for (const p of final.placements) {
    if (p.category === "absorbed") absorbed += 1;
    else if (p.category === "wasted") wasted += 1;
    else if (p.category === "interior") interior += 1;
  }
  const out = sortStrips(chosen);
  for (let i = 1; i < out.length; i += 1) {
    const a = StripRegion.make(out[i - 1] as Pt[], DOWN);
    const b = StripRegion.make(out[i] as Pt[], DOWN);
    check(
      ctx,
      "harvested strips pairwise parallel",
      a.ok && b.ok && parallel(a.region, b.region).ok,
    );
  }
  const report: LevelReport = {
    level,
    phase,
    units: states.length,
    required: Number(required),
    survivors: out.length,
    guaranteedAtEnd: final.guaranteedSurvivors,
    breakerMoves: phasePts.length,
    absorbedBreakerPoints: absorbed,
    wastedBreakerPoints: wasted,
    interiorBreakerPoints: interior,
    proposition1Holds: final.proposition1.holds,
    tilt: tiltNote,
  };
  ctx.levels.push(report);
  emit(ctx, () => {
    const sm = summarizeLedger(final, specs, toBaseOf(ctx));
    return {
      kind: "phase-end",
      phase,
      level,
      logLength: ctx.log.length,
      dir: ctx.frame.dir,
      chosen: strips2base(ctx, out),
      regions: sm.regions,
      ledger: sm.ledger,
      report,
    };
  });
  return out;
}

// ---------------------------------------------------------------------------
// Grouping phase (Theorem 4).

function groupingPhase(
  ctx: Ctx,
  level: number,
  inputsAll: Pt[][],
  t: bigint,
  s: bigint,
): Pt[][] {
  const per = Number(2n * s);
  const groupsN = Number(2n * t);
  const inputs = sortStrips(inputsAll).slice(0, per * groupsN);
  if (inputs.length < per * groupsN) {
    throw new RunFailure("invariant-failure", "not enough input strips for grouping");
  }
  const S0 = framePts(ctx);
  const plans: GroupPlan[] = [];
  let prevMax: Rat | null = null;
  for (let j = 0; j < groupsN; j += 1) {
    const strips = inputs.slice(j * per, (j + 1) * per);
    const r = planGroup(S0, strips, prevMax, j + 1);
    if (!r.ok) {
      throw new RunFailure("invariant-failure", `planGroup failed: ${r.reason.code}`);
    }
    plans.push(r.plan);
    const lastStrip = strips[per - 1] as Pt[];
    prevMax = (lastStrip[lastStrip.length - 1] as Pt).x;
  }
  const apexes: (Pt | null)[] = plans.map(() => null);
  const phasePts: Pt[] = [];
  const budgetTotal = breakerTotal(ctx, BigInt(groupsN));
  const specs = (): UnitSpec[] =>
    plans.map((pl) => ({
      unit: pl.index,
      regions: pl.strips.map((st, i) => {
        const r = StripRegion.make(st, DOWN);
        if (!r.ok) {
          throw new RunFailure("invariant-failure", "input strip invalid");
        }
        return { id: `Q${pl.index}.${i + 1}`, region: r.region };
      }),
      adoption: [],
    }));
  const ledgerNow = (): Ledger => {
    meter(ctx, ctx.fpts.length * groupsN * per);
    return buildLedger({
      units: specs(),
      points: ctx.fpts,
      breakerPhasePoints: phasePts,
      budgetTotal,
      required: Number(t),
    });
  };
  const snapLedger = (): void => {
    if (ctx.trace === null) {
      return;
    }
    const sp = specs();
    const lg = buildLedger({
      units: sp,
      points: ctx.fpts,
      breakerPhasePoints: phasePts,
      budgetTotal,
      required: Number(t),
    });
    const sm = summarizeLedger(lg, sp, toBaseOf(ctx));
    emit(ctx, () => ({
      kind: "ledger",
      phase: "grouping",
      level,
      logLength: ctx.log.length,
      dir: ctx.frame.dir,
      regions: sm.regions,
      ledger: sm.ledger,
    }));
  };
  emit(ctx, () => {
    const f = toBaseOf(ctx);
    return {
      kind: "phase-start",
      phase: "grouping",
      level,
      logLength: ctx.log.length,
      dir: ctx.frame.dir,
      required: Number(t),
      units: groupsN,
      breakerBudget: budgetTotal,
      inputs: strips2base(ctx, inputs),
      plans: plans.map((pl) => ({
        unit: pl.index,
        strips: strips2base(ctx, pl.strips),
        lineTop: f(pt(pl.xLine, pl.top)),
        cones: pl.cones.map((c) => traceCone(ctx, c)),
      })),
    };
  });
  for (let m = 1; m <= groupsN; m += 1) {
    ctx.round += 1;
    const info: PhaseInfo = { phase: "grouping", level, levelRound: m };
    const Scur = framePts(ctx);
    let pl = plans[m - 1] as GroupPlan;
    if (lineBlocked(Scur, pl.xLine)) {
      const np = replanLine(
        Scur,
        pl.lo,
        pl.hi,
        pl.strips.map((strip, i) => ({
          strip,
          side: "minus" as const,
          original: pl.cones[i] as Cone,
        })),
      );
      pl = { ...pl, xLine: np.xLine, top: np.top };
      plans[m - 1] = pl;
      ctx.checks.push({ name: `group ${pl.index}: line re-planned after blocking`, ok: true });
    }
    const apex = chooseApex(pl.top, pl.xLine, (p) => canAdd(Scur, p));
    if (apex === null) {
      throw new RunFailure("invariant-failure", "no legal apex (group)");
    }
    apexes[m - 1] = apex;
    addPoint(ctx, apex, "maker", "apex", info, `p_${m} on l_j ∩ ⋂ C-_i`, null);
    snapLedger();
    for (let b = 0; b < Number(s); b += 1) {
      breakerMove(ctx, info, Number(s) - b, Number(s), ledgerNow, phasePts);
      snapLedger();
    }
  }
  const S = framePts(ctx);
  const final = ledgerNow();
  const out: Pt[][] = [];
  for (const u of final.units) {
    const pl = plans[u.unit - 1] as GroupPlan;
    const idx = u.regions.findIndex((r) => r.live);
    if (idx < 0) {
      continue;
    }
    const ext = groupExtension(S, pl.strips[idx] as Pt[], pl.xLine);
    check(ctx, `group ${u.unit}: slab extension exists and is a strip`, ext.ok);
    if (ext.ok) {
      out.push([...ext.vertices]);
    }
  }
  const sorted = sortStrips(out);
  for (let i = 1; i < sorted.length; i += 1) {
    const a = StripRegion.make(sorted[i - 1] as Pt[], DOWN);
    const b = StripRegion.make(sorted[i] as Pt[], DOWN);
    check(
      ctx,
      "harvested strips pairwise parallel",
      a.ok && b.ok && parallel(a.region, b.region).ok,
    );
  }
  let wasted = 0;
  let interior = 0;
  for (const p of final.placements) {
    if (p.category === "wasted") wasted += 1;
    else if (p.category === "interior") interior += 1;
  }
  const report: LevelReport = {
    level,
    phase: "grouping",
    units: groupsN,
    required: Number(t),
    survivors: sorted.length,
    guaranteedAtEnd: final.guaranteedSurvivors,
    breakerMoves: phasePts.length,
    absorbedBreakerPoints: 0,
    wastedBreakerPoints: wasted,
    interiorBreakerPoints: interior,
    proposition1Holds: final.proposition1.holds,
    tilt: null,
  };
  ctx.levels.push(report);
  emit(ctx, () => {
    const sm = summarizeLedger(final, specs(), toBaseOf(ctx));
    return {
      kind: "phase-end",
      phase: "grouping",
      level,
      logLength: ctx.log.length,
      dir: ctx.frame.dir,
      chosen: strips2base(ctx, sorted),
      regions: sm.regions,
      ledger: sm.ledger,
      report,
    };
  });
  return sorted;
}

// ---------------------------------------------------------------------------
// Recursion.

function traceBaseStart(
  ctx: Ctx,
  level: number,
  phase: PhaseKind,
  need: bigint,
  rounds: bigint,
): void {
  emit(ctx, () => ({
    kind: "phase-start",
    phase,
    level,
    logLength: ctx.log.length,
    dir: ctx.frame.dir,
    required: Number(need),
    units: 0,
    breakerBudget: breakerTotal(ctx, rounds),
    inputs: [],
    plans: [],
  }));
}

function traceBaseEnd(
  ctx: Ctx,
  level: number,
  phase: PhaseKind,
  chosen: Pt[][],
  report: LevelReport | null,
): void {
  emit(ctx, () => ({
    kind: "phase-end",
    phase,
    level,
    logLength: ctx.log.length,
    dir: ctx.frame.dir,
    chosen: strips2base(ctx, chosen),
    regions: [],
    ledger: null,
    report,
  }));
}

function build(ctx: Ctx, level: number, need: bigint): Pt[][] {
  const spec = ctx.spec;
  const bichro = spec.variant === "bichromatic";
  if (!bichro) {
    const s = spec.variant === "mono-1:1" ? 1n : (spec.s as Rat).n;
    if (level === 1) {
      const rounds = (need + s) / (s + 1n);
      traceBaseStart(ctx, 1, "base", need, rounds);
      basePhase(ctx, 1, rounds, "base");
      const chains = ctx.fpts.map((o) => [o.pt]);
      const sortedV = sortStrips(validStripsFromChains(ctx, chains));
      traceBaseEnd(ctx, 1, "base", sortedV, null);
      return sortedV;
    }
    if (level === 2) {
      const rounds = (2n * need + s) / (s + 1n);
      traceBaseStart(ctx, 2, "base", need, rounds);
      basePhase(ctx, 2, rounds, "base");
      const sorted = [...ctx.fpts].map((o) => o.pt).sort((a, b) => a.x.cmp(b.x));
      const chains: Pt[][] = [];
      for (let i = 0; i + 1 < sorted.length; i += 2) {
        chains.push([sorted[i] as Pt, sorted[i + 1] as Pt]);
      }
      const v = validStripsFromChains(ctx, chains);
      const rep2: LevelReport = {
        level: 2,
        phase: "base",
        units: chains.length,
        required: Number(need),
        survivors: v.length,
        guaranteedAtEnd: v.length,
        breakerMoves: Number(rounds * s),
        absorbedBreakerPoints: 0,
        wastedBreakerPoints: 0,
        interiorBreakerPoints: 0,
        proposition1Holds: true,
        tilt: null,
      };
      ctx.levels.push(rep2);
      traceBaseEnd(ctx, 2, "base", v, rep2);
      return v;
    }
    const below = build(ctx, level - 1, 4n * s * need);
    return spec.variant === "mono-1:1"
      ? pairingPhase(ctx, level, below, 2n * need, true, need)
      : groupingPhase(ctx, level, below, need, s);
  }
  // bichromatic
  const sRat = spec.s ?? Rat.ZERO;
  const eps = Rat.make(2n).sub(sRat);
  if (level === 1) {
    traceBaseStart(ctx, 1, "bichromatic-base", need, need);
    basePhase(ctx, 1, need, "bichromatic-base");
    const d = chooseAndApplyTilt(ctx, []);
    const chains = ctx.fpts.filter((o) => o.owner === "maker").map((o) => [o.pt]);
    const v = validStripsFromChains(ctx, chains);
    const rep1: LevelReport = {
      level: 1,
      phase: "bichromatic-base",
      units: chains.length,
      required: Number(need),
      survivors: v.length,
      guaranteedAtEnd: v.length,
      breakerMoves: ctx.fpts.filter((o) => o.owner === "breaker").length,
      absorbedBreakerPoints: 0,
      wastedBreakerPoints: 0,
      interiorBreakerPoints: 0,
      proposition1Holds: true,
      tilt: d.toString(),
    };
    ctx.levels.push(rep1);
    const sv = sortStrips(v);
    traceBaseEnd(ctx, 1, "bichromatic-base", sv, rep1);
    return sv;
  }
  const t = ceilRat(Rat.make(2n * need).div(eps));
  const below = build(ctx, level - 1, 2n * t);
  return pairingPhase(ctx, level, below, t, false, need);
}

// ---------------------------------------------------------------------------

export interface RunOptions {
  readonly variant?: Variant;
  // mono-1:s: integer s >= 1 (as Rat); bichromatic: rational in [0,2).
  readonly s?: Rat;
  // Optional observer (see trace.ts): pure observation, never changes the run.
  readonly trace?: TraceObserver;
}

export function runKStrip(
  k: number,
  t: number | bigint,
  breakerPolicy: BreakerPolicy,
  budget: Budget = DEFAULT_BUDGET,
  opts: RunOptions = {},
): RunResult {
  const variant: Variant = opts.variant ?? "mono-1:1";
  const goal = BigInt(t);
  const base: RunSpec =
    opts.s === undefined
      ? { variant, k, t: goal }
      : { variant, k, t: goal, s: opts.s };
  const spec: RunSpec =
    variant === "mono-1:1"
      ? { variant, k, t: goal, s: Rat.ONE }
      : base;
  const estimate = estimateCost(spec);
  const mk = (
    status: RunStatus,
    message: string,
    ctx: Ctx | null,
    claims: StripClaim[],
  ): RunResult => ({
    status,
    message,
    estimate,
    budget,
    claims,
    goal,
    goalMet: status === "completed" && BigInt(claims.length) >= goal,
    rounds: ctx?.round ?? 0,
    points: ctx?.base.map((b) => ({ pt: b.pt, owner: b.owner })) ?? [],
    log: ctx?.log ?? [],
    levels: ctx?.levels ?? [],
    checks: ctx?.checks ?? [],
    work: ctx?.work ?? 0n,
  });
  if (!estimate.supported) {
    return mk("unsupported", estimate.unsupportedReason ?? "unsupported", null, []);
  }
  if (budget.preflight) {
    const bc = checkBudget(estimate, budget);
    if (!bc.ok) {
      return mk("refused", `refused before execution: ${bc.exceeded.join("; ")}`, null, []);
    }
  }
  const ctx: Ctx = {
    spec,
    budget,
    policy: breakerPolicy,
    mono: variant !== "bichromatic",
    frame: IDENTITY,
    base: [],
    fpts: [],
    log: [],
    round: 0,
    n: 0,
    work: 0n,
    levels: [],
    checks: [],
    trace: opts.trace ?? null,
  };
  try {
    const strips = build(ctx, k, goal);
    const claims = finalClaims(ctx, strips);
    const ok = BigInt(claims.length) >= goal;
    return mk(
      ok ? "completed" : "invariant-failure",
      ok ? "goal met; every claimed strip re-verified exactly" : "fewer verified strips than the goal",
      ctx,
      claims,
    );
  } catch (e) {
    if (e instanceof BudgetExceeded) {
      return mk("budget-exhausted", e.message, ctx, []);
    }
    if (e instanceof RunFailure) {
      return mk(e.status, e.message, ctx, []);
    }
    throw e;
  }
}

// Convert to base coordinates and re-verify EVERYTHING there, independently
// of the frame bookkeeping.
function finalClaims(ctx: Ctx, strips: Pt[][]): StripClaim[] {
  const v = ctx.frame.dir;
  const frame = frameOf(v);
  const S = ctx.base.map((b) => b.pt);
  const claims: StripClaim[] = [];
  for (const st of strips) {
    const verts = st.map((p) => fromFrame(frame, p));
    meter(ctx, S.length * verts.length);
    const r = isStrip(verts, S, v);
    check(ctx, "final claim: strip verified in base coordinates", r.ok);
    if (!r.ok) {
      continue;
    }
    if (ctx.spec.variant === "bichromatic") {
      check(
        ctx,
        "bichromatic claim: every vertex is a Maker point",
        verts.every((p) =>
          ctx.base.some((b) => b.owner === "maker" && eqPt(b.pt, p)),
        ),
      );
    }
    claims.push({
      level: ctx.spec.k,
      vertices: r.region.vertices,
      direction: v,
      region: r.region,
    });
  }
  const regs = claims.map((c) => c.region).sort((a, b) => a.xRange().lo.cmp(b.xRange().lo));
  for (let i = 1; i < regs.length; i += 1) {
    check(
      ctx,
      "final claims pairwise parallel",
      parallel(regs[i - 1] as StripRegion, regs[i] as StripRegion).ok,
    );
  }
  // frames sanity: toFrame/fromFrame round trip
  const probe = S[0];
  if (probe !== undefined) {
    check(ctx, "frame round trip", eqPt(fromFrame(frame, toFrame(frame, probe)), probe));
  }
  return claims;
}
