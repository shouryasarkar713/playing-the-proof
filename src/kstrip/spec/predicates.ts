// kstrip/spec/predicates.ts — the named predicates a KStripSpec refers to.
//
// Each is an EXACT check over plain data (no hidden state): a PhaseEnv (what a
// phase received and produced) or a RunEnv (what the whole run produced). They
// are implemented with the kernel's own exact predicates (isStrip, parallel,
// extension cones, replayLog, ledger fields) and never with floating point.
// Tier X (exact runtime check on the actual board).
import { eqPt } from "../../geometry/pt.ts";
import type { Pt } from "../../geometry/pt.ts";
import { Rat } from "../../geometry/rat.ts";
import { coneContains, extensionCone } from "../cone.ts";
import type { Cone, ConeSide } from "../cone.ts";
import { DOWN, fromFrame, toFrame } from "../frame.ts";
import type { Dir, Frame } from "../frame.ts";
import type { OwnedPoint } from "../ledger.ts";
import { StripRegion, isStrip, parallel } from "../region.ts";
import { replayLog } from "../replay.ts";
import type { LevelReport, MoveLogEntry, PhaseKind } from "../types.ts";

export interface PhaseEnv {
  readonly phaseId: string;
  readonly kind: PhaseKind;
  readonly level: number;
  readonly need: number;
  readonly units: number;
  readonly makerMoves: number;
  readonly per: number; // input strips per unit (2 for pairs, 2s for groups, 0 in base)
  readonly inputStrips: number;
  readonly stripSize: number; // vertices of every delivered strip (= level)
  readonly allowance: (m: number) => number;
  readonly startFrame: Frame;
  readonly startPoints: readonly OwnedPoint[]; // start-frame coordinates
  readonly endFrame: Frame;
  readonly endPoints: readonly OwnedPoint[]; // end-frame coordinates
  readonly inputs: readonly (readonly Pt[])[]; // start-frame coordinates
  readonly outputs: readonly (readonly Pt[])[]; // end-frame coordinates
  readonly moves: readonly MoveLogEntry[];
  readonly report: LevelReport | null;
}

export interface RunEnv {
  readonly variant: string;
  readonly k: number;
  readonly goal: bigint;
  readonly rounds: number;
  readonly expectedRounds: number;
  readonly domainOk: boolean;
  readonly domainDetail: string;
  readonly claims: readonly { readonly vertices: readonly Pt[]; readonly direction: Dir }[];
  readonly board: readonly OwnedPoint[]; // base coordinates
  readonly log: readonly MoveLogEntry[];
}

export interface Verdict {
  readonly ok: boolean;
  readonly detail: string;
}

export interface PredicateDef<E> {
  readonly id: string;
  readonly describe: string;
  readonly check: (env: E) => Verdict;
}

const pass = (detail: string): Verdict => ({ ok: true, detail });
const fail = (detail: string): Verdict => ({ ok: false, detail });

const byX = (a: Pt, b: Pt): number => a.x.cmp(b.x);

// The inputs exactly as the pairing/grouping primitive reads them: each strip
// sorted along x, strips sorted by first x, truncated to what the phase uses.
function normInputs(env: PhaseEnv): Pt[][] {
  const s = env.inputs.map((c) => [...c].sort(byX));
  s.sort((a, b) => byX(a[0] as Pt, b[0] as Pt));
  return s.slice(0, env.inputStrips);
}

function pts(o: readonly OwnedPoint[]): Pt[] {
  return o.map((p) => p.pt);
}

function allParallel(regions: readonly StripRegion[]): Verdict {
  const sorted = [...regions].sort((a, b) => a.xRange().lo.cmp(b.xRange().lo));
  for (let i = 1; i < sorted.length; i += 1) {
    const r = parallel(sorted[i - 1] as StripRegion, sorted[i] as StripRegion);
    if (!r.ok) {
      return fail(`strips ${i} and ${i + 1} (by x) are not parallel: ${r.reason}`);
    }
  }
  return pass(`${regions.length} strips pairwise parallel`);
}

function regionsOf(chains: readonly (readonly Pt[])[], dir: Dir): StripRegion[] | string {
  const out: StripRegion[] = [];
  for (let i = 0; i < chains.length; i += 1) {
    const r = StripRegion.make(chains[i] as readonly Pt[], dir);
    if (!r.ok) {
      return `strip ${i + 1} is not a strict cap: ${r.reason.code}`;
    }
    out.push(r.region);
  }
  return out;
}

// ---- phase predicates ------------------------------------------------------

const boardEmptyAtStart: PredicateDef<PhaseEnv> = {
  id: "board-empty-at-start",
  describe: "a base phase starts on the empty board (the recursion's bottom)",
  check: (e) =>
    e.startPoints.length === 0
      ? pass("empty board")
      : fail(`${e.startPoints.length} points already on the board`),
};

const inputsCount: PredicateDef<PhaseEnv> = {
  id: "inputs-count",
  describe: "at least inputStrips (level-1)-strips are delivered by the level below",
  check: (e) =>
    e.inputs.length >= e.inputStrips
      ? pass(`${e.inputs.length} >= ${e.inputStrips}`)
      : fail(`only ${e.inputs.length} input strips, ${e.inputStrips} needed`),
};

const inputsAreStrips: PredicateDef<PhaseEnv> = {
  id: "inputs-are-strips",
  describe: "every input is a (level-1)-strip of the board in the phase-start frame (Definition 2, exact isStrip)",
  check: (e) => {
    const S = pts(e.startPoints);
    const ins = normInputs(e);
    for (let i = 0; i < ins.length; i += 1) {
      const c = ins[i] as Pt[];
      if (c.length !== e.stripSize - 1) {
        return fail(`input ${i + 1} has ${c.length} vertices, expected ${e.stripSize - 1}`);
      }
      const r = isStrip(c, S, DOWN);
      if (!r.ok) {
        return fail(`input ${i + 1} is not a strip: ${r.reason.code}`);
      }
    }
    return pass(`${ins.length} inputs are ${e.stripSize - 1}-strips`);
  },
};

const inputsParallel: PredicateDef<PhaseEnv> = {
  id: "inputs-pairwise-parallel",
  describe: "the inputs are pairwise parallel (disjoint closed regions, same direction)",
  check: (e) => {
    const rs = regionsOf(normInputs(e), DOWN);
    return typeof rs === "string" ? fail(rs) : allParallel(rs);
  },
};

const baseDistinctX: PredicateDef<PhaseEnv> = {
  id: "base-distinct-x",
  describe: "monochromatic base phase: all abscissae are distinct (the paper's WLOG distinct x)",
  check: (e) => {
    const seen = new Set<string>();
    for (const p of e.endPoints) {
      const key = p.pt.x.toString();
      if (seen.has(key)) {
        return fail(`x = ${key} occurs twice`);
      }
      seen.add(key);
    }
    return pass(`${seen.size} distinct x`);
  },
};

interface UnitSlot {
  readonly strips: readonly (readonly Pt[])[];
  readonly lo: Rat | null; // exclusive lower bound of the unit's span (grouping)
}

function unitSlots(e: PhaseEnv): UnitSlot[] {
  const ins = normInputs(e);
  const out: UnitSlot[] = [];
  for (let j = 0; j < e.units; j += 1) {
    const strips = ins.slice(j * e.per, (j + 1) * e.per);
    let lo: Rat | null = null;
    if (e.kind === "grouping" && j > 0) {
      const prev = ins[j * e.per - 1] as Pt[];
      lo = (prev[prev.length - 1] as Pt).x;
    }
    out.push({ strips, lo });
  }
  return out;
}

const apexInGap: PredicateDef<PhaseEnv> = {
  id: "apex-in-gap",
  describe: "Maker's p_j lies on a vertical line strictly between the unit's strips and the previous unit (pairing rule)",
  check: (e) => {
    const apexes = e.moves.filter((m) => m.kind === "apex");
    if (apexes.length !== e.units) {
      return fail(`${apexes.length} apex moves, ${e.units} units`);
    }
    const slots = unitSlots(e);
    for (let j = 0; j < slots.length; j += 1) {
      const a = apexes[j] as MoveLogEntry;
      const slot = slots[j] as UnitSlot;
      if (a.frameC !== e.startFrame.c.toString()) {
        return fail(`p_${j + 1} was placed in a different frame`);
      }
      const x = a.ptFrame.x;
      let ok: boolean;
      if (e.kind === "grouping") {
        // left of the group, right of every earlier group
        const first = (slot.strips[0] as Pt[])[0] as Pt;
        ok = x.cmp(first.x) < 0 && (slot.lo === null || x.cmp(slot.lo) > 0);
      } else {
        // between the two strips of the pair
        const left = slot.strips[0] as Pt[];
        const right = slot.strips[1] as Pt[];
        ok = x.cmp((left[left.length - 1] as Pt).x) > 0 && x.cmp((right[0] as Pt).x) < 0;
      }
      if (!ok) {
        return fail(`p_${j + 1} is not in the gap of unit ${j + 1}`);
      }
    }
    return pass(`${apexes.length} extension points in their gaps`);
  },
};

const apexInCones: PredicateDef<PhaseEnv> = {
  id: "apex-in-cones",
  describe: "Maker's p_j lies in the extension cones of its unit (pair: C+ of the left strip and C- of the right; group: C- of every strip), computed on the phase-start board",
  check: (e) => {
    const apexes = e.moves.filter((m) => m.kind === "apex");
    if (apexes.length !== e.units) {
      return fail(`${apexes.length} apex moves, ${e.units} units`);
    }
    const S = pts(e.startPoints);
    const slots = unitSlots(e);
    for (let j = 0; j < slots.length; j += 1) {
      const a = (apexes[j] as MoveLogEntry).ptFrame;
      const slot = slots[j] as UnitSlot;
      const wanted: { strip: readonly Pt[]; side: ConeSide }[] =
        e.kind === "grouping"
          ? slot.strips.map((strip) => ({ strip, side: "minus" as const }))
          : [
              { strip: slot.strips[0] as readonly Pt[], side: "plus" as const },
              { strip: slot.strips[1] as readonly Pt[], side: "minus" as const },
            ];
      for (const w of wanted) {
        const c = extensionCone(w.strip, S, DOWN, w.side);
        if (!c.ok) {
          return fail(`unit ${j + 1}: no ${w.side} cone (${c.reason.code})`);
        }
        const cone: Cone = c.cone;
        if (!coneContains(cone, a, "closed")) {
          return fail(`p_${j + 1} is outside the ${w.side} cone of a strip of unit ${j + 1}`);
        }
      }
    }
    return pass(`${apexes.length} extension points inside all their cones`);
  },
};

const phaseAccounting: PredicateDef<PhaseEnv> = {
  id: "phase-accounting",
  describe: "round and budget accounting: Maker moves = makerMoves, Breaker replies after the m-th Maker move = allowance(m), rounds alternate Maker-first, board grows by exactly the moves",
  check: (e) => {
    let i = 0;
    let breakers = 0;
    for (let m = 1; m <= e.makerMoves; m += 1) {
      const mk = e.moves[i];
      if (mk === undefined || mk.player !== "maker") {
        return fail(`round ${m}: expected a Maker move`);
      }
      const wantKind = e.kind === "base" || e.kind === "bichromatic-base" ? "base-point" : "apex";
      if (mk.kind !== wantKind || mk.levelRound !== m || mk.phase !== e.kind || mk.level !== e.level) {
        return fail(`round ${m}: Maker move is ${mk.kind}/${mk.phase}/L${mk.level}/r${mk.levelRound}`);
      }
      i += 1;
      const nb = e.allowance(m);
      for (let b = 0; b < nb; b += 1) {
        const br = e.moves[i];
        if (br === undefined || br.player !== "breaker" || br.levelRound !== m) {
          return fail(`round ${m}: Breaker reply ${b + 1} of ${nb} is missing`);
        }
        i += 1;
        breakers += 1;
      }
    }
    if (i !== e.moves.length) {
      return fail(`${e.moves.length - i} unexpected extra moves after the last round`);
    }
    if (e.endPoints.length !== e.startPoints.length + e.moves.length) {
      return fail("board size is not start + moves");
    }
    return pass(`${e.makerMoves} Maker moves, ${breakers} Breaker replies`);
  },
};

const ledgerArithmetic: PredicateDef<PhaseEnv> = {
  id: "ledger-arithmetic",
  describe: "ledger report arithmetic: survivors = delivered strips, breakerMoves = Breaker points of the phase, guaranteedAtEnd <= survivors, absorbed+wasted+interior <= breakerMoves",
  check: (e) => {
    const r = e.report;
    if (r === null) {
      return fail("no level report");
    }
    const breakers = e.moves.filter((m) => m.player === "breaker").length;
    if (r.level !== e.level || r.phase !== e.kind) {
      return fail(`report is for ${r.phase}/L${r.level}`);
    }
    if (r.survivors !== e.outputs.length) {
      return fail(`report.survivors ${r.survivors} != ${e.outputs.length} delivered`);
    }
    if (r.breakerMoves !== breakers) {
      return fail(`report.breakerMoves ${r.breakerMoves} != ${breakers}`);
    }
    if (r.guaranteedAtEnd > r.survivors) {
      return fail(`guaranteedAtEnd ${r.guaranteedAtEnd} > survivors ${r.survivors}`);
    }
    if (r.absorbedBreakerPoints + r.wastedBreakerPoints + r.interiorBreakerPoints > r.breakerMoves) {
      return fail("categorised Breaker points exceed Breaker moves");
    }
    if (r.required !== e.need) {
      return fail(`report.required ${r.required} != need ${e.need}`);
    }
    return pass(`survivors ${r.survivors}, guaranteed ${r.guaranteedAtEnd}`);
  },
};

const outputsCount: PredicateDef<PhaseEnv> = {
  id: "outputs-count",
  describe: "the phase delivers at least `need` strips (the strip demand of the level)",
  check: (e) =>
    e.outputs.length >= e.need
      ? pass(`${e.outputs.length} >= ${e.need}`)
      : fail(`${e.outputs.length} strips delivered, ${e.need} required`),
};

const outputsAreStrips: PredicateDef<PhaseEnv> = {
  id: "outputs-are-strips",
  describe: "every delivered strip has `level` vertices and is a strip of the phase-end board (Definition 2, exact isStrip)",
  check: (e) => {
    const S = pts(e.endPoints);
    for (let i = 0; i < e.outputs.length; i += 1) {
      const c = e.outputs[i] as readonly Pt[];
      if (c.length !== e.stripSize) {
        return fail(`delivered strip ${i + 1} has ${c.length} vertices, expected ${e.stripSize}`);
      }
      const r = isStrip(c, S, DOWN);
      if (!r.ok) {
        return fail(`delivered strip ${i + 1} is not a strip: ${r.reason.code}`);
      }
    }
    return pass(`${e.outputs.length} delivered ${e.stripSize}-strips`);
  },
};

const outputsParallel: PredicateDef<PhaseEnv> = {
  id: "outputs-pairwise-parallel",
  describe: "the delivered strips are pairwise parallel",
  check: (e) => {
    const rs = regionsOf(e.outputs, DOWN);
    return typeof rs === "string" ? fail(rs) : allParallel(rs);
  },
};

const outputsMakerOnly: PredicateDef<PhaseEnv> = {
  id: "outputs-maker-only",
  describe: "bichromatic rule: every vertex of every delivered strip is a Maker point",
  check: (e) => {
    for (const c of e.outputs) {
      for (const v of c) {
        if (!e.endPoints.some((p) => p.owner === "maker" && eqPt(p.pt, v))) {
          return fail("a delivered vertex is not a Maker point");
        }
      }
    }
    return pass("all delivered vertices are Maker points");
  },
};

function inSpan(kind: PhaseKind, s: UnitSlot, lo: Rat, hi: Rat): boolean {
  const lastStrip = s.strips[s.strips.length - 1] as Pt[];
  if (hi.cmp((lastStrip[lastStrip.length - 1] as Pt).x) > 0) {
    return false;
  }
  if (kind === "grouping") {
    // a slab extension may reach left of the group, never into an earlier group
    return s.lo === null || lo.cmp(s.lo) > 0;
  }
  return lo.cmp(((s.strips[0] as Pt[])[0] as Pt).x) >= 0;
}

const survivorSelection: PredicateDef<PhaseEnv> = {
  id: "survivor-selection",
  describe: "harvest: at most one delivered strip per unit, each inside the x-span of its own unit (pair: both strips; group: right of the earlier groups)",
  check: (e) => {
    const slots = unitSlots(e);
    const used = new Set<number>();
    for (let i = 0; i < e.outputs.length; i += 1) {
      const xs = (e.outputs[i] as readonly Pt[]).map((v) => toFrame(e.startFrame, fromFrame(e.endFrame, v)).x);
      const lo = xs.reduce((a, b) => (a.cmp(b) <= 0 ? a : b));
      const hi = xs.reduce((a, b) => (a.cmp(b) >= 0 ? a : b));
      const j = slots.findIndex((s) => inSpan(e.kind, s, lo, hi));
      if (j < 0) {
        return fail(`delivered strip ${i + 1} lies in no unit's span`);
      }
      if (used.has(j)) {
        return fail(`unit ${j + 1} delivered two strips`);
      }
      used.add(j);
    }
    return pass(`${used.size} units delivered one strip each`);
  },
};

export const PHASE_PREDICATES: readonly PredicateDef<PhaseEnv>[] = [
  boardEmptyAtStart,
  inputsCount,
  inputsAreStrips,
  inputsParallel,
  baseDistinctX,
  apexInGap,
  apexInCones,
  phaseAccounting,
  ledgerArithmetic,
  outputsCount,
  outputsAreStrips,
  outputsParallel,
  outputsMakerOnly,
  survivorSelection,
];

// ---- run predicates --------------------------------------------------------

const paramsVerified: PredicateDef<RunEnv> = {
  id: "params-in-verified-domain",
  describe: "the parameters are one of the spec's verified configurations (otherwise 'uncovered')",
  check: (e) => (e.domainOk ? pass(e.domainDetail) : fail(e.domainDetail)),
};

const claimsVerified: PredicateDef<RunEnv> = {
  id: "claims-verified-base-coordinates",
  describe: "every claimed strip has k vertices and passes Definition 2 on the final board, in BASE coordinates (independent of the frame bookkeeping)",
  check: (e) => {
    const S = e.board.map((p) => p.pt);
    for (let i = 0; i < e.claims.length; i += 1) {
      const c = e.claims[i] as RunEnv["claims"][number];
      if (c.vertices.length !== e.k) {
        return fail(`claim ${i + 1} has ${c.vertices.length} vertices, expected ${e.k}`);
      }
      const r = isStrip(c.vertices, S, c.direction);
      if (!r.ok) {
        return fail(`claim ${i + 1} is not a strip: ${r.reason.code}`);
      }
    }
    return pass(`${e.claims.length} claims verified`);
  },
};

const claimsParallel: PredicateDef<RunEnv> = {
  id: "claims-pairwise-parallel",
  describe: "the claimed strips are pairwise parallel (common direction, disjoint closed regions)",
  check: (e) => {
    const rs: StripRegion[] = [];
    for (let i = 0; i < e.claims.length; i += 1) {
      const c = e.claims[i] as RunEnv["claims"][number];
      const r = StripRegion.make(c.vertices, c.direction);
      if (!r.ok) {
        return fail(`claim ${i + 1} is not a strict cap`);
      }
      rs.push(r.region);
    }
    for (let i = 0; i < rs.length; i += 1) {
      for (let j = i + 1; j < rs.length; j += 1) {
        const p = parallel(rs[i] as StripRegion, rs[j] as StripRegion);
        if (!p.ok) {
          return fail(`claims ${i + 1} and ${j + 1}: ${p.reason}`);
        }
      }
    }
    return pass(`${rs.length} claims pairwise parallel`);
  },
};

const claimsAtLeastGoal: PredicateDef<RunEnv> = {
  id: "claims-at-least-goal",
  describe: "the number of verified parallel k-strips reaches the goal t",
  check: (e) =>
    BigInt(e.claims.length) >= e.goal
      ? pass(`${e.claims.length} >= ${e.goal}`)
      : fail(`${e.claims.length} claims < goal ${e.goal}`),
};

const claimsMakerOnly: PredicateDef<RunEnv> = {
  id: "claims-maker-only",
  describe: "bichromatic rule: every claimed vertex is a Maker point",
  check: (e) => {
    for (const c of e.claims) {
      for (const v of c.vertices) {
        if (!e.board.some((p) => p.owner === "maker" && eqPt(p.pt, v))) {
          return fail("a claimed vertex is not a Maker point");
        }
      }
    }
    return pass("all claimed vertices are Maker points");
  },
};

const logLegal: PredicateDef<RunEnv> = {
  id: "log-legal",
  describe: "the move log re-validates without any policy (general position, distinct x in the monochromatic base, frame consistency, alternation)",
  check: (e) => {
    const r = replayLog(e.log, e.variant !== "bichromatic");
    return r.ok ? pass(`${e.log.length} moves legal`) : fail(r.failures[0] ?? "log illegal");
  },
};

const roundsMatchPlan: PredicateDef<RunEnv> = {
  id: "rounds-match-plan",
  describe: "rounds executed equal the sum of the spec's Maker-move formulas over the levels",
  check: (e) =>
    e.rounds === e.expectedRounds
      ? pass(`${e.rounds} rounds`)
      : fail(`${e.rounds} rounds executed, spec formulas give ${e.expectedRounds}`),
};

export const RUN_PREDICATES: readonly PredicateDef<RunEnv>[] = [
  paramsVerified,
  claimsVerified,
  claimsParallel,
  claimsAtLeastGoal,
  claimsMakerOnly,
  logLegal,
  roundsMatchPlan,
];

export const PHASE_PREDICATE_INDEX: ReadonlyMap<string, PredicateDef<PhaseEnv>> = new Map(
  PHASE_PREDICATES.map((p) => [p.id, p]),
);
export const RUN_PREDICATE_INDEX: ReadonlyMap<string, PredicateDef<RunEnv>> = new Map(
  RUN_PREDICATES.map((p) => [p.id, p]),
);
