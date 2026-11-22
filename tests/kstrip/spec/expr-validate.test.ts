import { describe, expect, it } from "vitest";
import { Rat } from "../../../src/geometry/rat.ts";
import {
  ExprError,
  KSTRIP_SPECS,
  SPEC_BICHROMATIC,
  SPEC_MONO_1_1,
  SPEC_MONO_1_S,
  evalCount,
  evalExpr,
  exprVars,
  planFromSpec,
  planRounds,
  showExpr,
  validateSpec,
  validateSpecCached,
} from "../../../src/kstrip/spec/index.ts";
import type { Expr, KStripSpec, PhaseSpec } from "../../../src/kstrip/spec/index.ts";
import { add, ceil, div, floor, mul, num, sub, vr } from "../../../src/kstrip/spec/expr.ts";

const R = (n: number, d = 1): Rat => Rat.make(BigInt(n), BigInt(d));
const ph = (spec: KStripSpec, id: string): PhaseSpec => spec.phases.find((p) => p.id === id) as PhaseSpec;

describe("Expr", () => {
  it("evaluates exactly, with floor/ceil on rationals", () => {
    const e: Expr = ceil(div(mul(num(2), vr("need")), add(vr("s"), num(1))));
    expect(evalExpr(e, { need: R(5), s: R(2) }).toString()).toBe("4/1"); // ceil(10/3)
    expect(evalExpr(floor(div(num(7), num(2))), {}).toString()).toBe("3/1");
    expect(evalExpr(floor(div(num(-7), num(2))), {}).toString()).toBe("-4/1");
    expect(evalExpr(ceil(div(num(-7), num(2))), {}).toString()).toBe("-3/1");
    expect(evalExpr(sub(num(1), num(4)), {}).toString()).toBe("-3/1");
    expect(evalExpr({ op: "const", v: "3/6" }, {}).toString()).toBe("1/2");
  });
  it("is typed about failures", () => {
    expect(() => evalExpr(vr("need"), {})).toThrow(ExprError);
    expect(() => evalExpr(div(num(1), num(0)), {})).toThrow(/division by zero/);
    expect(() => evalCount(div(num(1), num(2)), {})).toThrow(/not a non-negative integer/);
    expect(() => evalCount(num(-1), {})).toThrow(ExprError);
    expect(evalCount(num(7), {})).toBe(7n);
  });
  it("prints and lists variables", () => {
    const e = floor(mul(vr("m"), sub(vr("s"), num(1))));
    expect(showExpr(e)).toBe("floor(m*(s - 1))");
    expect(showExpr(add(num(1), ceil(div(vr("k"), num(2)))))).toBe("(1 + ceil(k/2))");
    expect([...exprVars(e)].sort()).toEqual(["m", "s"]);
    expect([...exprVars(num(3))]).toEqual([]);
  });
});

function withPhase(spec: KStripSpec, id: string, patch: Partial<PhaseSpec>): KStripSpec {
  return { ...spec, phases: spec.phases.map((p) => (p.id === id ? { ...p, ...patch } : p)) };
}
const hit = (spec: KStripSpec, rule: string, re: RegExp): boolean =>
  validateSpec(spec).some((i) => i.rule === rule && re.test(i.message));

describe("validateSpec (K1-K9)", () => {
  it("the three shipped specs are clean", () => {
    for (const s of KSTRIP_SPECS) {
      expect(validateSpec(s), s.id).toEqual([]);
    }
    expect(validateSpecCached(SPEC_MONO_1_1)).toBe(validateSpecCached(SPEC_MONO_1_1));
  });

  it("K1: no phases / duplicate ids / empty claim", () => {
    expect(hit({ ...SPEC_MONO_1_1, phases: [] }, "K1", /no phases/)).toBe(true);
    const dup = { ...SPEC_MONO_1_1, phases: [...SPEC_MONO_1_1.phases, ph(SPEC_MONO_1_1, "base-1")] };
    expect(hit(dup, "K1", /duplicate/)).toBe(true);
    expect(hit({ ...SPEC_MONO_1_1, verified: [] }, "K1", /no verified/)).toBe(true);
  });

  it("K2: empty or unknown predicates, duplicates, run level", () => {
    expect(hit(withPhase(SPEC_MONO_1_1, "pairing", { pre: [] }), "K2", /precondition list is empty/)).toBe(true);
    expect(hit(withPhase(SPEC_MONO_1_1, "pairing", { post: [] }), "K2", /postcondition list is empty/)).toBe(true);
    const post = ph(SPEC_MONO_1_1, "pairing").post;
    expect(hit(withPhase(SPEC_MONO_1_1, "pairing", { post: [...post, { id: "nope" }] }), "K2", /unknown predicate 'nope'/)).toBe(true);
    expect(hit(withPhase(SPEC_MONO_1_1, "pairing", { post: [...post, post[0] as { id: string }] }), "K2", /twice/)).toBe(true);
    const rp = SPEC_MONO_1_1.runPost;
    expect(hit({ ...SPEC_MONO_1_1, runPost: [...rp, { id: "ghost" }] }, "K2", /unknown run predicate 'ghost'/)).toBe(true);
    expect(validateSpec({ ...SPEC_MONO_1_1, runPre: [] }).some((i) => i.rule === "K2" && i.where === "runPre")).toBe(true);
    expect(validateSpec({ ...SPEC_MONO_1_1, runPost: [] }).some((i) => i.rule === "K2" && i.where === "runPost")).toBe(true);
    // a phase predicate is not a run predicate
    expect(hit({ ...SPEC_MONO_1_1, runPre: [{ id: "inputs-count" }] }, "K2", /unknown run predicate/)).toBe(true);
  });

  it("K3: every level 1..12 has exactly one phase (gap and overlap)", () => {
    const gap = withPhase(SPEC_MONO_1_1, "pairing", { when: { kind: "gte", level: 5 } });
    expect(validateSpec(gap).filter((i) => i.rule === "K3").map((i) => i.where)).toEqual(["level 3", "level 4"]);
    const overlap = withPhase(SPEC_MONO_1_1, "base-2", { when: { kind: "gte", level: 2 } });
    expect(hit(overlap, "K3", /2 phases apply/)).toBe(true);
  });

  it("K3: a gap only at the last level (12) is found", () => {
    const pair = ph(SPEC_MONO_1_1, "pairing");
    const split: PhaseSpec[] = [];
    for (let l = 3; l <= 11; l += 1) {
      split.push({ ...pair, id: `pairing-${l}`, when: { kind: "eq", level: l } });
    }
    const spec = { ...SPEC_MONO_1_1, phases: [ph(SPEC_MONO_1_1, "base-1"), ph(SPEC_MONO_1_1, "base-2"), ...split] };
    expect(validateSpec(spec).filter((i) => i.rule === "K3").map((i) => i.where)).toEqual(["level 12"]);
  });

  it("K4: invalid phase transitions are named", () => {
    const pairing = ph(SPEC_MONO_1_1, "pairing");
    const same = withPhase(SPEC_MONO_1_1, "pairing", { transition: { kind: "recurse", level: vr("level"), need: pairing.inputStrips } });
    expect(hit(same, "K4", /does not descend/)).toBe(true);
    const need = withPhase(SPEC_MONO_1_1, "pairing", {
      transition: { kind: "recurse", level: sub(vr("level"), num(1)), need: add(pairing.inputStrips, num(1)) },
    });
    expect(hit(need, "K4", /demanded below/)).toBe(true);
    expect(hit(withPhase(SPEC_MONO_1_1, "pairing", { transition: { kind: "terminal" } }), "K4", /must recurse/)).toBe(true);
    // skipping a level
    const skip = withPhase(SPEC_MONO_1_1, "pairing", {
      transition: { kind: "recurse", level: sub(vr("level"), num(2)), need: pairing.inputStrips },
    });
    expect(hit(skip, "K4", /recurses to 1, not 2/)).toBe(true);
    const base = ph(SPEC_MONO_1_1, "base-2");
    const rec = withPhase(SPEC_MONO_1_1, "base-2", {
      transition: { kind: "recurse", level: sub(vr("level"), num(1)), need: base.inputStrips },
    });
    expect(hit(rec, "K4", /must be terminal/)).toBe(true);
    expect(hit(withPhase(SPEC_MONO_1_1, "pairing", { kind: "grouping" }), "K4", /runs a 'pairing' phase/)).toBe(true);
    expect(hit(withPhase(SPEC_MONO_1_1, "pairing", { primitive: "group-slab", kind: "grouping" }), "K4", /does not belong to variant mono-1:1/)).toBe(true);
    expect(hit(withPhase(SPEC_MONO_1_1, "pairing", { primitive: "nope" as never }), "K4", /unknown primitive/)).toBe(true);
  });

  it("K5: formula scope and arithmetic", () => {
    expect(hit(withPhase(SPEC_MONO_1_1, "pairing", { units: add(vr("m"), num(1)) }), "K5", /uses 'm'/)).toBe(true);
    expect(hit(withPhase(SPEC_MONO_1_1, "base-2", { units: vr("units") }), "K5", /uses 'units'/)).toBe(true);
    expect(hit(withPhase(SPEC_MONO_1_1, "pairing", { makerMoves: add(vr("units"), num(1)) }), "K5", /Maker moves for/)).toBe(true);
    expect(hit(withPhase(SPEC_MONO_1_1, "pairing", { makerMoves: div(vr("units"), num(3)) }), "K5", /formulas do not evaluate/)).toBe(true);
    expect(hit(withPhase(SPEC_MONO_1_1, "base-2", { units: num(1) }), "K5", /terminal phase/)).toBe(true);
    const zero = withPhase(SPEC_MONO_1_1, "pairing", {
      units: num(0),
      makerMoves: num(0),
      inputStrips: num(0),
      transition: { kind: "recurse", level: sub(vr("level"), num(1)), need: num(0) },
    });
    expect(hit(zero, "K5", /0 units/)).toBe(true);
    const tv = withPhase(SPEC_MONO_1_1, "pairing", { transition: { kind: "recurse", level: sub(vr("level"), vr("m")), need: num(4) } });
    expect(hit(tv, "K5", /uses 'm'/)).toBe(true);
    const tn = withPhase(SPEC_MONO_1_1, "pairing", {
      transition: { kind: "recurse", level: sub(vr("level"), num(1)), need: vr("m") },
    });
    expect(hit(tn, "K5", /uses 'm'/)).toBe(true);
    expect(hit(withPhase(SPEC_MONO_1_1, "pairing", { inputStrips: vr("m") }), "K5", /uses 'm'/)).toBe(true);
    expect(hit(withPhase(SPEC_MONO_1_1, "pairing", { makerMoves: vr("m") }), "K5", /uses 'm'/)).toBe(true);
    expect(hit(withPhase(SPEC_MONO_1_1, "pairing", { breakerAllowance: vr("m") }), "K8", /Breaker moves/)).toBe(true);
  });

  it("K6: allowed Breaker responses", () => {
    expect(hit(withPhase(SPEC_MONO_1_1, "pairing", { allowedResponses: [] }), "K6", /no allowed/)).toBe(true);
    expect(hit(withPhase(SPEC_MONO_1_1, "pairing", { allowedResponses: ["general-position", "bogus" as never] }), "K6", /unknown response class/)).toBe(true);
    expect(hit(withPhase(SPEC_MONO_1_1, "pairing", { allowedResponses: ["distinct-x"] }), "K6", /always a response requirement/)).toBe(true);
    expect(hit(withPhase(SPEC_MONO_1_1, "base-2", { allowedResponses: ["general-position"] }), "K6", /distinct-x is required exactly/)).toBe(true);
    expect(hit(withPhase(SPEC_MONO_1_1, "pairing", { allowedResponses: ["general-position", "distinct-x"] }), "K6", /distinct-x is required exactly/)).toBe(true);
  });

  it("K7: every phase needs its certificate predicates", () => {
    const pairing = ph(SPEC_MONO_1_1, "pairing");
    for (const drop of ["apex-in-gap", "apex-in-cones", "phase-accounting", "survivor-selection", "ledger-arithmetic", "outputs-count", "outputs-are-strips", "outputs-pairwise-parallel"]) {
      const s = withPhase(SPEC_MONO_1_1, "pairing", { post: pairing.post.filter((p) => p.id !== drop) });
      expect(hit(s, "K7", new RegExp(`'${drop}'`)), drop).toBe(true);
    }
    for (const drop of ["inputs-count", "inputs-are-strips", "inputs-pairwise-parallel"]) {
      const s = withPhase(SPEC_MONO_1_1, "pairing", { pre: pairing.pre.filter((p) => p.id !== drop) });
      expect(hit(s, "K7", new RegExp(`'${drop}'`)), drop).toBe(true);
    }
    const b = ph(SPEC_MONO_1_1, "base-2");
    expect(hit(withPhase(SPEC_MONO_1_1, "base-2", { post: b.post.filter((p) => p.id !== "base-distinct-x") }), "K7", /base-distinct-x/)).toBe(true);
    expect(hit(withPhase(SPEC_MONO_1_1, "base-2", { pre: [{ id: "inputs-count" }] }), "K7", /board-empty-at-start/)).toBe(true);
    const bi = ph(SPEC_BICHROMATIC, "bichromatic-pairing");
    expect(hit(withPhase(SPEC_BICHROMATIC, "bichromatic-pairing", { post: bi.post.filter((p) => p.id !== "outputs-maker-only") }), "K7", /outputs-maker-only/)).toBe(true);
    expect(hit({ ...SPEC_BICHROMATIC, runPost: SPEC_BICHROMATIC.runPost.filter((p) => p.id !== "claims-maker-only") }, "K7", /claims-maker-only/)).toBe(true);
    for (const drop of ["claims-verified-base-coordinates", "claims-pairwise-parallel", "claims-at-least-goal", "rounds-match-plan"]) {
      expect(hit({ ...SPEC_MONO_1_1, runPost: SPEC_MONO_1_1.runPost.filter((p) => p.id !== drop) }, "K7", new RegExp(drop)), drop).toBe(true);
    }
    expect(hit({ ...SPEC_MONO_1_1, runPre: [] }, "K2", /empty/)).toBe(true);
  });

  it("K8: budget formulas must match the recurrence / estimator", () => {
    // (for s = 1, floor and ceil of 2*need/2 coincide: use s >= 2)
    const lo = withPhase(SPEC_MONO_1_S, "base-2", { makerMoves: floor(div(mul(num(2), vr("need")), add(vr("s"), num(1)))) });
    expect(hit(lo, "K8", /Maker moves/)).toBe(true);
    const al = withPhase(SPEC_MONO_1_S, "grouping", { breakerAllowance: add(vr("s"), num(1)) });
    expect(hit(al, "K8", /Breaker moves/)).toBe(true);
    const dem = withPhase(SPEC_MONO_1_S, "grouping", {
      transition: { kind: "recurse", level: sub(vr("level"), num(1)), need: mul(num(4), vr("need")) },
      inputStrips: mul(num(4), vr("need")),
    });
    expect(hit(dem, "K8", /differs from recursion.ts/)).toBe(true);
    const eps = withPhase(SPEC_BICHROMATIC, "bichromatic-pairing", { units: ceil(div(num(2), sub(num(2), vr("s")))) });
    expect(hit(eps, "K8", /differs from recursion.ts/)).toBe(true);
    // the estimator's own opinion about the claimed configuration is binding
    expect(hit({ ...SPEC_BICHROMATIC, verified: [{ k: 2, t: [1], s: ["2"] }] }, "K9", /violates/)).toBe(true);
    // the paper's recurrence window: an extra round per level is caught even
    // if units/need are consistent (levels differ from the estimator)
    const extra = withPhase(SPEC_MONO_1_1, "base-2", { makerMoves: add(ceil(div(mul(num(2), vr("need")), add(vr("s"), num(1)))), num(1)) });
    expect(hit(extra, "K8", /Maker moves/)).toBe(true);
  });

  it("K8: a floor where the paper has a ceiling is caught off the verified points", () => {
    // every verified bichromatic point has an integral 2*need/(2-s): floor == ceil there
    const f = withPhase(SPEC_BICHROMATIC, "bichromatic-pairing", { units: floor(div(mul(num(2), vr("need")), sub(num(2), vr("s")))) });
    const issues = validateSpec(f);
    expect(issues.some((i) => i.rule === "K8")).toBe(true);
    // the offending configurations include ones off the verified table
    expect(issues.some((i) => i.where.includes("s=1/3") || i.where.includes("s=19/10"))).toBe(true);
  });

  it("K9: the claimed domain must be well formed", () => {
    const m = SPEC_MONO_1_1;
    const b = SPEC_BICHROMATIC;
    const s = SPEC_MONO_1_S;
    const v = (spec: KStripSpec, verified: KStripSpec["verified"], re: RegExp): boolean => hit({ ...spec, verified }, "K9", re);
    expect(v(m, [{ k: 3, t: [0] }], /k must be/)).toBe(true);
    expect(v(m, [{ k: 3, t: [] }], /k must be/)).toBe(true);
    expect(v(m, [{ k: 0, t: [1] }], /k must be/)).toBe(true);
    expect(v(m, [{ k: 13, t: [1] }], /k must be/)).toBe(true);
    expect(v(m, [{ k: 3, t: [1.5] }], /k must be/)).toBe(true);
    expect(v(m, [{ k: 3, t: [1], s: ["1"] }], /does not match/)).toBe(true);
    expect(v(s, [{ k: 3, t: [1] }], /does not match/)).toBe(true);
    expect(v(s, [{ k: 3, t: [1], s: [] }], /does not match/)).toBe(true);
    expect(v(s, [{ k: 3, t: [1], s: ["3/2"] }], /violates/)).toBe(true);
    expect(v(s, [{ k: 3, t: [1], s: ["0"] }], /violates/)).toBe(true);
    expect(v(b, [{ k: 2, t: [1], s: ["2"] }], /violates/)).toBe(true);
    expect(v(b, [{ k: 2, t: [1], s: ["-1/2"] }], /violates/)).toBe(true);
    expect(v(b, [{ k: 2, t: [1], s: ["x"] }], /not a rational/)).toBe(true);
    expect(validateSpec({ ...b, verified: [{ k: 2, t: [1], s: ["0", "19/10"] }] })).toEqual([]);
    expect(validateSpec({ ...s, verified: [{ k: 3, t: [1], s: ["2"] }] })).toEqual([]);
  });
});

describe("plan = recursion unrolled", () => {
  it("matches the paper's closed forms", () => {
    const p = planFromSpec(SPEC_MONO_1_1, { k: 5, t: 1n });
    expect(p.map((x) => x.level)).toEqual([5, 4, 3, 2]); // top-down
    expect(planRounds(p)).toBe(106n);
    expect(planRounds(planFromSpec(SPEC_MONO_1_1, { k: 3, t: 3n }))).toBe(18n);
    const g = planFromSpec(SPEC_MONO_1_S, { k: 3, t: 1n, s: R(2) });
    expect(g.map((x) => [x.level, Number(x.need), Number(x.makerMoves), Number(x.breakerMoves)])).toEqual([
      [3, 1, 2, 4],
      [2, 8, 6, 12],
    ]);
  });
  it("is defined only where the formulas are", () => {
    expect(() => planFromSpec(SPEC_MONO_1_S, { k: 3, t: 1n })).toThrow(/bias undefined/);
    expect(() => planFromSpec({ ...SPEC_MONO_1_1, phases: [] }, { k: 3, t: 1n })).toThrow(/exactly one required/);
    const loop = withPhase(SPEC_MONO_1_1, "pairing", { transition: { kind: "recurse", level: vr("level"), need: vr("need") } });
    expect(() => planFromSpec(loop, { k: 3, t: 1n })).toThrow(/does not descend/);
  });
});
