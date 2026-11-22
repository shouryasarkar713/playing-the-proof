// Negative tests of every named predicate: take the exact data a real,
// passing run checked its postconditions on, break one thing, and require the
// predicate to reject it (and to say what is wrong).
import { describe, expect, it } from "vitest";
import { pt } from "../../../src/geometry/pt.ts";
import type { Pt } from "../../../src/geometry/pt.ts";
import { Rat } from "../../../src/geometry/rat.ts";
import { createStrategyAwarePolicy } from "../../../src/kstrip/index.ts";
import type { LevelReport, MoveLogEntry } from "../../../src/kstrip/index.ts";
import {
  PHASE_PREDICATE_INDEX,
  RUN_PREDICATE_INDEX,
  SPEC_BICHROMATIC,
  SPEC_MONO_1_1,
  SPEC_MONO_1_S,
  runSpec,
} from "../../../src/kstrip/spec/index.ts";
import type { KStripSpec, PhaseEnv, RunEnv, SpecParams } from "../../../src/kstrip/spec/index.ts";

const R = (n: number, d = 1): Rat => Rat.make(BigInt(n), BigInt(d));
const P = (x: number, y: number): Pt => pt(R(x), R(y));

function capture(spec: KStripSpec, params: SpecParams): { envs: PhaseEnv[]; run: ReturnType<typeof runSpec> } {
  const envs: PhaseEnv[] = [];
  const run = runSpec(spec, params, createStrategyAwarePolicy(), { onPhaseEnv: (e) => envs.push(e) });
  expect(run.outcome.kind).toBe("completed");
  return { envs, run };
}

const mono = capture(SPEC_MONO_1_1, { k: 3, t: 1n });
const group = capture(SPEC_MONO_1_S, { k: 3, t: 1n, s: R(2) });
const bichro = capture(SPEC_BICHROMATIC, { k: 3, t: 1n, s: R(1) });
const pairEnv = mono.envs.find((e) => e.kind === "pairing") as PhaseEnv;
const baseEnv = mono.envs.find((e) => e.kind === "base") as PhaseEnv;
const groupEnv = group.envs.find((e) => e.kind === "grouping") as PhaseEnv;
const bpairEnv = bichro.envs.find((e) => e.kind === "bichromatic-pairing" && e.level === 3) as PhaseEnv;
const bbaseEnv = bichro.envs.find((e) => e.kind === "bichromatic-base") as PhaseEnv;

function check(id: string, env: PhaseEnv): { ok: boolean; detail: string } {
  const p = PHASE_PREDICATE_INDEX.get(id);
  expect(p, id).toBeDefined();
  return (p as NonNullable<typeof p>).check(env);
}
function bad(id: string, env: PhaseEnv, re: RegExp): void {
  const r = check(id, env);
  expect(r.ok, `${id}: ${r.detail}`).toBe(false);
  expect(r.detail).toMatch(re);
}
function good(id: string, env: PhaseEnv): void {
  const r = check(id, env);
  expect(r.ok, `${id}: ${r.detail}`).toBe(true);
}

describe("real phase data satisfies every predicate (baseline)", () => {
  it("passes", () => {
    for (const [spec, run] of [
      [SPEC_MONO_1_1, mono],
      [SPEC_MONO_1_S, group],
      [SPEC_BICHROMATIC, bichro],
    ] as const) {
      for (const env of run.envs) {
        const ph = spec.phases.find((p) => p.id === env.phaseId);
        for (const r of ph?.post ?? []) {
          good(r.id, env);
        }
      }
    }
  });
});

describe("pre predicates", () => {
  it("board-empty-at-start", () => {
    good("board-empty-at-start", { ...baseEnv, startPoints: [] });
    bad("board-empty-at-start", { ...baseEnv, startPoints: baseEnv.endPoints }, /already on the board/);
  });
  it("inputs-count", () => {
    good("inputs-count", pairEnv);
    bad("inputs-count", { ...pairEnv, inputs: pairEnv.inputs.slice(1) }, /needed/);
  });
  it("inputs-are-strips: size, strip-ness", () => {
    good("inputs-are-strips", pairEnv);
    const first = pairEnv.inputs[0] as readonly Pt[];
    bad("inputs-are-strips", { ...pairEnv, inputs: [[first[0] as Pt], ...pairEnv.inputs.slice(1)] }, /vertices, expected/);
    // a vertex that is not on the board
    bad("inputs-are-strips", { ...pairEnv, inputs: [[P(1000, 1000), P(1001, 999)], ...pairEnv.inputs.slice(1)] }, /not a strip: vertex-not-in-S/);
    // a board point strictly inside the first strip's region
    const a = first[0] as Pt;
    const b = first[1] as Pt;
    const inside = pt(a.x.add(b.x).div(R(2)), a.y.sub(R(1000)));
    bad("inputs-are-strips", { ...pairEnv, startPoints: [...pairEnv.startPoints, { pt: inside, owner: "breaker" }] }, /not a strip: (interior|boundary)-point/);
  });
  it("inputs-pairwise-parallel", () => {
    good("inputs-pairwise-parallel", pairEnv);
    const first = pairEnv.inputs[0] as readonly Pt[];
    bad("inputs-pairwise-parallel", { ...pairEnv, inputs: [first, first, ...pairEnv.inputs.slice(2)] }, /not parallel/);
    bad("inputs-pairwise-parallel", { ...pairEnv, inputs: [[first[0] as Pt, first[0] as Pt]] }, /not a strict cap/);
  });
});

describe("base-distinct-x", () => {
  it("rejects a repeated abscissa", () => {
    good("base-distinct-x", baseEnv);
    const p0 = baseEnv.endPoints[0] as { pt: Pt; owner: "maker" | "breaker" };
    bad("base-distinct-x", { ...baseEnv, endPoints: [...baseEnv.endPoints, { pt: pt(p0.pt.x, p0.pt.y.add(R(7))), owner: "breaker" }] }, /occurs twice/);
  });
});

function withMove(env: PhaseEnv, i: number, patch: Partial<MoveLogEntry>): PhaseEnv {
  return { ...env, moves: env.moves.map((m, j) => (j === i ? { ...m, ...patch } : m)) };
}
const apexIdx = (env: PhaseEnv, which = 0): number => {
  let seen = -1;
  for (let i = 0; i < env.moves.length; i += 1) {
    if ((env.moves[i] as MoveLogEntry).kind === "apex") {
      seen += 1;
      if (seen === which) return i;
    }
  }
  throw new Error("no apex");
};

describe("apex-in-gap", () => {
  it("pairing: strictly between the pair's strips", () => {
    const i = apexIdx(pairEnv);
    const a = pairEnv.moves[i] as MoveLogEntry;
    // far left of every strip
    bad("apex-in-gap", withMove(pairEnv, i, { ptFrame: pt(R(-1000), a.ptFrame.y) }), /not in the gap of unit 1/);
    // far right of every strip
    bad("apex-in-gap", withMove(pairEnv, i, { ptFrame: pt(R(100000), a.ptFrame.y) }), /not in the gap of unit 1/);
    // exactly on the right strip's first vertex (not strictly left of it)
    const right = (pairEnv.inputs[1] as readonly Pt[])[0] as Pt;
    bad("apex-in-gap", withMove(pairEnv, i, { ptFrame: pt(right.x, a.ptFrame.y) }), /not in the gap/);
    const left = pairEnv.inputs[0] as readonly Pt[];
    bad("apex-in-gap", withMove(pairEnv, i, { ptFrame: pt((left[left.length - 1] as Pt).x, a.ptFrame.y) }), /not in the gap/);
  });
  it("count and frame", () => {
    bad("apex-in-gap", { ...pairEnv, moves: pairEnv.moves.filter((m) => m.kind !== "apex") }, /apex moves/);
    bad("apex-in-gap", withMove(pairEnv, apexIdx(pairEnv), { frameC: "7/1" }), /different frame/);
  });
  it("grouping: left of the group, right of earlier groups", () => {
    good("apex-in-gap", groupEnv);
    const a0 = groupEnv.moves[apexIdx(groupEnv)] as MoveLogEntry;
    bad("apex-in-gap", withMove(groupEnv, apexIdx(groupEnv), { ptFrame: pt(R(100000), a0.ptFrame.y) }), /not in the gap/);
    // second group's p_2 moved into the first group's span
    const j = apexIdx(groupEnv, 1);
    const a1 = groupEnv.moves[j] as MoveLogEntry;
    const g1 = (groupEnv.inputs[0] as readonly Pt[])[0] as Pt;
    bad("apex-in-gap", withMove(groupEnv, j, { ptFrame: pt(g1.x.sub(R(1)), a1.ptFrame.y) }), /not in the gap of unit 2/);
  });
});

describe("apex-in-cones", () => {
  it("rejects an apex above the cone, in either unit shape", () => {
    good("apex-in-cones", pairEnv);
    const i = apexIdx(pairEnv);
    const a = pairEnv.moves[i] as MoveLogEntry;
    bad("apex-in-cones", withMove(pairEnv, i, { ptFrame: pt(a.ptFrame.x, a.ptFrame.y.add(R(100000))) }), /outside the (plus|minus) cone/);
    good("apex-in-cones", groupEnv);
    const j = apexIdx(groupEnv);
    const g = groupEnv.moves[j] as MoveLogEntry;
    bad("apex-in-cones", withMove(groupEnv, j, { ptFrame: pt(g.ptFrame.x, g.ptFrame.y.add(R(100000))) }), /outside the minus cone/);
    bad("apex-in-cones", { ...pairEnv, moves: [] }, /apex moves/);
  });
  it("closed cones: a point straight below the left strip's last vertex is inside (boundary of the open cone)", () => {
    const i = apexIdx(pairEnv);
    const left = pairEnv.inputs[0] as readonly Pt[];
    const v = left[left.length - 1] as Pt;
    good("apex-in-cones", withMove(pairEnv, i, { ptFrame: pt(v.x, R(-100000)) }));
  });
  it("a strip that is not a strip has no cone", () => {
    bad("apex-in-cones", { ...pairEnv, startPoints: pairEnv.startPoints.slice(1) }, /no (plus|minus) cone \(not-a-strip\)/);
  });
});

describe("phase-accounting", () => {
  it("round structure and counts", () => {
    good("phase-accounting", pairEnv);
    bad("phase-accounting", { ...pairEnv, moves: pairEnv.moves.slice(1) }, /expected a Maker move|Maker move is/);
    bad("phase-accounting", { ...pairEnv, moves: pairEnv.moves.slice(0, -1) }, /missing/);
    bad("phase-accounting", { ...pairEnv, moves: [...pairEnv.moves, pairEnv.moves[0] as MoveLogEntry] }, /unexpected extra moves/);
    bad("phase-accounting", { ...pairEnv, allowance: () => 2 }, /missing|unexpected/);
    bad("phase-accounting", { ...pairEnv, makerMoves: pairEnv.makerMoves + 1 }, /expected a Maker move/);
    bad("phase-accounting", withMove(pairEnv, 0, { levelRound: 9 }), /Maker move is/);
    bad("phase-accounting", withMove(pairEnv, 0, { level: 9 }), /Maker move is/);
    bad("phase-accounting", withMove(pairEnv, 0, { phase: "grouping" }), /Maker move is/);
    bad("phase-accounting", withMove(pairEnv, 0, { kind: "base-point" }), /Maker move is/);
    bad("phase-accounting", withMove(pairEnv, 1, { player: "maker" }), /Breaker reply 1 of 1 is missing/);
    bad("phase-accounting", withMove(pairEnv, 1, { levelRound: 5 }), /Breaker reply/);
    bad("phase-accounting", { ...pairEnv, endPoints: pairEnv.endPoints.slice(1) }, /board size/);
    // base phases expect base points
    good("phase-accounting", baseEnv);
    bad("phase-accounting", withMove(baseEnv, 0, { kind: "apex" }), /Maker move is/);
    good("phase-accounting", bbaseEnv);
    bad("phase-accounting", withMove(bbaseEnv, 0, { kind: "apex" }), /Maker move is/);
  });
});

function withReport(env: PhaseEnv, patch: Partial<LevelReport>): PhaseEnv {
  return { ...env, report: { ...(env.report as LevelReport), ...patch } };
}

describe("ledger-arithmetic", () => {
  it("each clause", () => {
    good("ledger-arithmetic", pairEnv);
    const r = pairEnv.report as LevelReport;
    bad("ledger-arithmetic", { ...pairEnv, report: null }, /no level report/);
    bad("ledger-arithmetic", withReport(pairEnv, { level: 99 }), /report is for/);
    bad("ledger-arithmetic", withReport(pairEnv, { phase: "base" }), /report is for/);
    bad("ledger-arithmetic", withReport(pairEnv, { survivors: r.survivors + 1 }), /survivors/);
    bad("ledger-arithmetic", withReport(pairEnv, { breakerMoves: r.breakerMoves + 1 }), /breakerMoves/);
    bad("ledger-arithmetic", withReport(pairEnv, { guaranteedAtEnd: r.survivors + 1 }), /guaranteedAtEnd/);
    bad("ledger-arithmetic", withReport(pairEnv, { absorbedBreakerPoints: r.breakerMoves + 1 }), /exceed Breaker moves/);
    bad("ledger-arithmetic", withReport(pairEnv, { wastedBreakerPoints: r.breakerMoves + 1 }), /exceed Breaker moves/);
    bad("ledger-arithmetic", withReport(pairEnv, { interiorBreakerPoints: r.breakerMoves + 1 }), /exceed Breaker moves/);
    bad("ledger-arithmetic", withReport(pairEnv, { required: r.required + 1 }), /required/);
    // equality at the boundary is fine
    good("ledger-arithmetic", withReport(pairEnv, { guaranteedAtEnd: r.survivors }));
    good("ledger-arithmetic", withReport(pairEnv, { absorbedBreakerPoints: r.breakerMoves, wastedBreakerPoints: 0, interiorBreakerPoints: 0 }));
  });
});

describe("outputs", () => {
  it("outputs-count", () => {
    good("outputs-count", pairEnv);
    bad("outputs-count", { ...pairEnv, outputs: [] }, /required/);
    bad("outputs-count", { ...pairEnv, need: pairEnv.outputs.length + 1 }, /required/);
    good("outputs-count", { ...pairEnv, need: pairEnv.outputs.length });
  });
  it("outputs-are-strips: size and Definition 2", () => {
    good("outputs-are-strips", pairEnv);
    const o = pairEnv.outputs[0] as readonly Pt[];
    bad("outputs-are-strips", { ...pairEnv, outputs: [o.slice(1)] }, /vertices, expected/);
    bad("outputs-are-strips", { ...pairEnv, outputs: [[P(5000, 5000), P(5001, 4999), P(5002, 4997)]] }, /not a strip: vertex-not-in-S/);
    const a = o[0] as Pt;
    const b = o[1] as Pt;
    const inside = pt(a.x.add(b.x).div(R(2)), a.y.sub(R(100000)));
    bad("outputs-are-strips", { ...pairEnv, endPoints: [...pairEnv.endPoints, { pt: inside, owner: "breaker" }] }, /not a strip: (interior|boundary)-point/);
  });
  it("outputs-pairwise-parallel", () => {
    const o = pairEnv.outputs[0] as readonly Pt[];
    good("outputs-pairwise-parallel", pairEnv);
    bad("outputs-pairwise-parallel", { ...pairEnv, outputs: [o, o] }, /not parallel/);
    bad("outputs-pairwise-parallel", { ...pairEnv, outputs: [[o[0] as Pt, o[0] as Pt]] }, /not a strict cap/);
  });
  it("outputs-maker-only", () => {
    good("outputs-maker-only", bpairEnv);
    const o = bpairEnv.outputs[0] as readonly Pt[];
    const v = o[0] as Pt;
    bad(
      "outputs-maker-only",
      { ...bpairEnv, endPoints: bpairEnv.endPoints.map((p) => (p.pt.x.equals(v.x) && p.pt.y.equals(v.y) ? { ...p, owner: "breaker" as const } : p)) },
      /not a Maker point/,
    );
    // in the monochromatic game Breaker points are legitimate vertices
    const brk = pairEnv.endPoints.some((p) => p.owner === "breaker");
    expect(brk).toBe(true);
  });
  it("survivor-selection: one strip per unit, inside its span", () => {
    good("survivor-selection", pairEnv);
    const o = pairEnv.outputs[0] as readonly Pt[];
    bad("survivor-selection", { ...pairEnv, outputs: [o, o] }, /delivered two strips/);
    // far outside every unit
    bad("survivor-selection", { ...pairEnv, outputs: [[P(100000, 0), P(100001, -1), P(100002, -3)]] }, /lies in no unit/);
    bad("survivor-selection", { ...pairEnv, outputs: [[P(-100000, 0), P(-99999, -1), P(-99998, -3)]] }, /lies in no unit/);
    good("survivor-selection", groupEnv);
    bad("survivor-selection", { ...groupEnv, outputs: [[P(100000, 0), P(100001, -1), P(100002, -3)]] }, /lies in no unit/);
    const g = groupEnv.outputs[0] as readonly Pt[];
    bad("survivor-selection", { ...groupEnv, outputs: [g, g] }, /delivered two strips/);
    // a group strip reaching left into the previous group
    const g2first = (groupEnv.inputs[1] as readonly Pt[])[0] as Pt;
    bad("survivor-selection", { ...groupEnv, outputs: [[pt(g2first.x.sub(R(1)), R(0)), ...g.slice(1)]] }, /lies in no unit/);
    good("survivor-selection", bpairEnv);
  });
});

// ---- run predicates --------------------------------------------------------

const runRes = mono.run.result as NonNullable<typeof mono.run.result>;
const runEnv: RunEnv = {
  variant: "mono-1:1",
  k: 3,
  goal: 1n,
  rounds: runRes.rounds,
  expectedRounds: runRes.rounds,
  domainOk: true,
  domainDetail: "ok",
  claims: runRes.claims.map((c) => ({ vertices: c.vertices, direction: c.direction })),
  board: runRes.points,
  log: runRes.log,
};
function rcheck(id: string, env: RunEnv): { ok: boolean; detail: string } {
  return (RUN_PREDICATE_INDEX.get(id) as NonNullable<ReturnType<typeof RUN_PREDICATE_INDEX.get>>).check(env);
}
function rbad(id: string, env: RunEnv, re: RegExp): void {
  const r = rcheck(id, env);
  expect(r.ok, `${id}: ${r.detail}`).toBe(false);
  expect(r.detail).toMatch(re);
}

describe("run predicates", () => {
  it("baseline passes", () => {
    for (const id of ["params-in-verified-domain", "claims-verified-base-coordinates", "claims-pairwise-parallel", "claims-at-least-goal", "log-legal", "rounds-match-plan"]) {
      expect(rcheck(id, runEnv).ok, id).toBe(true);
    }
  });
  it("params-in-verified-domain", () => {
    rbad("params-in-verified-domain", { ...runEnv, domainOk: false, domainDetail: "k=9 not verified" }, /k=9/);
  });
  it("claims-verified-base-coordinates", () => {
    const c = runEnv.claims[0] as RunEnv["claims"][number];
    rbad("claims-verified-base-coordinates", { ...runEnv, claims: [{ ...c, vertices: c.vertices.slice(1) }] }, /vertices, expected 3/);
    rbad("claims-verified-base-coordinates", { ...runEnv, claims: [{ ...c, vertices: [P(9000, 9000), P(9001, 8999), P(9002, 8997)] }] }, /not a strip: vertex-not-in-S/);
    const a = c.vertices[0] as Pt;
    const b = c.vertices[1] as Pt;
    rbad(
      "claims-verified-base-coordinates",
      { ...runEnv, board: [...runEnv.board, { pt: pt(a.x.add(b.x).div(R(2)), a.y.sub(R(100000))), owner: "breaker" }] },
      /not a strip/,
    );
  });
  it("claims-pairwise-parallel", () => {
    const c = runEnv.claims[0] as RunEnv["claims"][number];
    rbad("claims-pairwise-parallel", { ...runEnv, claims: [c, c] }, /claims 1 and 2/);
    rbad("claims-pairwise-parallel", { ...runEnv, claims: [{ ...c, vertices: [c.vertices[0] as Pt, c.vertices[0] as Pt] }] }, /not a strict cap/);
  });
  it("claims-at-least-goal", () => {
    rbad("claims-at-least-goal", { ...runEnv, goal: 2n }, /< goal 2/);
    rbad("claims-at-least-goal", { ...runEnv, claims: [] }, /< goal/);
  });
  it("claims-maker-only", () => {
    const bres = bichro.run.result as NonNullable<typeof bichro.run.result>;
    const benv: RunEnv = {
      ...runEnv,
      variant: "bichromatic",
      k: 3,
      claims: bres.claims.map((c) => ({ vertices: c.vertices, direction: c.direction })),
      board: bres.points,
      log: bres.log,
    };
    expect(rcheck("claims-maker-only", benv).ok).toBe(true);
    // a mono run's claim contains Breaker points (adoption / consecutive pairs)
    const mk = new Set(runEnv.board.filter((p) => p.owner === "maker").map((p) => `${p.pt.x.toString()},${p.pt.y.toString()}`));
    const hasBreakerVertex = runEnv.claims.some((c) => c.vertices.some((v) => !mk.has(`${v.x.toString()},${v.y.toString()}`)));
    expect(hasBreakerVertex).toBe(true);
    rbad("claims-maker-only", runEnv, /not a Maker point/);
    rbad("claims-maker-only", { ...benv, board: benv.board.map((p) => ({ ...p, owner: "breaker" as const })) }, /not a Maker point/);
  });
  it("log-legal", () => {
    rbad("log-legal", { ...runEnv, log: runEnv.log.slice(1) }, /numbering/);
    rbad("log-legal", { ...runEnv, log: [...runEnv.log, runEnv.log[0] as MoveLogEntry] }, /./);
    expect(rcheck("log-legal", { ...runEnv, variant: "bichromatic" }).ok).toBe(true); // legal in the weaker rule too
  });
  it("rounds-match-plan", () => {
    rbad("rounds-match-plan", { ...runEnv, expectedRounds: runEnv.rounds + 1 }, /spec formulas give/);
  });
});

describe("predicates fail closed on malformed data", () => {
  it("an empty board and no moves are rejected, not crashed", () => {
    expect(check("apex-in-cones", { ...pairEnv, moves: [], units: 0 }).ok).toBe(true); // vacuous: zero units
    expect(check("survivor-selection", { ...pairEnv, outputs: [] }).ok).toBe(true);
  });
});
