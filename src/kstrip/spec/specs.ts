// kstrip/spec/specs.ts — the KStripSpec DATA for the three verified variants
// (docs/KSTRIP.md section 6 table). No geometry, no functions: formulas are
// Expr trees, conditions are predicate ids, geometry is a primitive id.
import { add, ceil, div, floor, mul, num, sub, vr } from "./expr.ts";
import type { PhaseSpec, KStripSpec, PredRef, ResponseClass } from "./types.ts";

const p = (...ids: string[]): PredRef[] => ids.map((id) => ({ id }));
const GP: ResponseClass[] = ["general-position"];
const GP_X: ResponseClass[] = ["general-position", "distinct-x"];

const S = vr("s");
const NEED = vr("need");
const ONE = num(1);
const TWO = num(2);

// Breaker replies after Maker's m-th move: s per move (integer s); in the
// bichromatic game floor(m s) - floor((m-1) s) so that Breaker has floor(m s)
// points in total.
const ALLOW_MONO = S;
const ALLOW_BICHRO = sub(floor(mul(vr("m"), S)), floor(mul(sub(vr("m"), ONE), S)));

const NONE = num(0);

function monoBase(id: string, level: 1 | 2): PhaseSpec {
  return {
    id,
    kind: "base",
    when: { kind: "eq", level },
    primitive: level === 1 ? "mono-base-1" : "mono-base-2",
    summary:
      level === 1
        ? "Maker puts points on the parabola at fresh abscissae; every point is a 1-strip."
        : "Maker puts points on the parabola; consecutive-x pairs are the 2-strips.",
    units: NONE,
    inputStrips: NONE,
    makerMoves: level === 1 ? ceil(div(NEED, add(S, ONE))) : ceil(div(mul(TWO, NEED), add(S, ONE))),
    breakerAllowance: ALLOW_MONO,
    pairing: level === 1 ? null : "consecutive points in x order form a 2-strip",
    candidateRegions: null,
    extensionMove: "base point on y = x^2 (+ general-position offset) at the next fresh integer abscissa",
    survivorSelection: level === 1 ? "every point of the board" : "every consecutive-x pair that passes isStrip",
    allowedResponses: GP_X,
    pre: p("board-empty-at-start", "inputs-count"),
    post:
      level === 1
        ? p("phase-accounting", "base-distinct-x", "outputs-count", "outputs-are-strips", "outputs-pairwise-parallel")
        : p(
            "phase-accounting",
            "base-distinct-x",
            "ledger-arithmetic",
            "outputs-count",
            "outputs-are-strips",
            "outputs-pairwise-parallel",
          ),
    transition: { kind: "terminal" },
  };
}

const MONO_PRE = p("inputs-count", "inputs-are-strips", "inputs-pairwise-parallel");
const PAIR_POST = p(
  "phase-accounting",
  "apex-in-gap",
  "apex-in-cones",
  "ledger-arithmetic",
  "survivor-selection",
  "outputs-count",
  "outputs-are-strips",
  "outputs-pairwise-parallel",
);

export const SPEC_MONO_1_1: KStripSpec = {
  id: "kstrip-mono-1:1",
  title: "Maker k-strip strategy, monochromatic 1:1 (Theorem 3)",
  variant: "mono-1:1",
  theorem: "Dzuklevski et al., Theorem 3",
  version: "1.0.0",
  sRule: "fixed-1",
  verified: [
    { k: 2, t: [1] },
    { k: 3, t: [1, 2, 3] },
    { k: 4, t: [1] },
    { k: 5, t: [1] },
  ],
  runPre: p("params-in-verified-domain"),
  runPost: p("claims-verified-base-coordinates", "claims-pairwise-parallel", "claims-at-least-goal", "rounds-match-plan", "log-legal"),
  phases: [
    monoBase("base-1", 1),
    monoBase("base-2", 2),
    {
      id: "pairing",
      kind: "pairing",
      when: { kind: "gte", level: 3 },
      primitive: "pair-adopt",
      summary:
        "Pair the (k-1)-strips consecutively; Maker plays p_j on the halfline l_j ∩ C+ ∩ C-; a Breaker point on the halfline below is adopted as the vertex; harvest one k-strip per surviving pair.",
      units: mul(TWO, NEED),
      inputStrips: mul(mul(num(4), S), NEED),
      makerMoves: vr("units"),
      breakerAllowance: ALLOW_MONO,
      pairing: "strips S_{2j-1}, S_{2j} (sorted by x) form pair j",
      candidateRegions: "R_{2j-1} = conv(S_{2j-1} ∪ p_j) + halfline, R_{2j} likewise; interiors disjoint, sharing the halfline below p_j",
      extensionMove: "p_j on l_j ∩ C+_{2j-1} ∩ C-_{2j} (lowest legal integer step below the cone top)",
      survivorSelection: "one strip per pair whose candidate region is still empty (left region preferred)",
      allowedResponses: GP,
      pre: MONO_PRE,
      post: PAIR_POST,
      transition: { kind: "recurse", level: sub(vr("level"), ONE), need: mul(mul(num(4), S), NEED) },
    },
  ],
};

export const SPEC_MONO_1_S: KStripSpec = {
  id: "kstrip-mono-bias",
  title: "Maker k-strip strategy, monochromatic 1:s, integer s (Theorem 4)",
  variant: "mono-1:s",
  theorem: "Dzuklevski et al., Theorem 4",
  version: "1.0.0",
  sRule: "integer>=1",
  verified: [
    { k: 3, t: [1], s: ["2", "3"] },
    { k: 4, t: [1], s: ["1", "2"] },
  ],
  runPre: p("params-in-verified-domain"),
  runPost: p("claims-verified-base-coordinates", "claims-pairwise-parallel", "claims-at-least-goal", "rounds-match-plan", "log-legal"),
  phases: [
    monoBase("base-1", 1),
    monoBase("base-2", 2),
    {
      id: "grouping",
      kind: "grouping",
      when: { kind: "gte", level: 3 },
      primitive: "group-slab",
      summary:
        "Group the (k-1)-strips in 2s; Maker plays p_j below the groups' C- cones; the surviving strip of each group is extended by the first point met by the slab-restricted rotation.",
      units: mul(TWO, NEED),
      inputStrips: mul(mul(num(4), S), NEED),
      makerMoves: vr("units"),
      breakerAllowance: ALLOW_MONO,
      pairing: "2s consecutive strips (sorted by x) form group j",
      candidateRegions: "the 2s input strips themselves (a group dies only if all 2s are blocked)",
      extensionMove: "p_j on l_j ∩ C-_1 ∩ ... ∩ C-_{2s}, l_j left of group j and right of group j-1",
      survivorSelection: "one extended strip per group that still has an empty input strip",
      allowedResponses: GP,
      pre: MONO_PRE,
      post: PAIR_POST,
      transition: { kind: "recurse", level: sub(vr("level"), ONE), need: mul(mul(num(4), S), NEED) },
    },
  ],
};

export const SPEC_BICHROMATIC: KStripSpec = {
  id: "kstrip-bichromatic",
  title: "Maker k-strip strategy, bichromatic 1:s, s < 2 (Theorem 5)",
  variant: "bichromatic",
  theorem: "Dzuklevski et al., Theorem 5 (strict count, see docs/KSTRIP.md section 6)",
  version: "1.0.0",
  sRule: "rational[0,2)",
  verified: [
    { k: 2, t: [1, 2], s: ["1", "3/2"] },
    { k: 3, t: [1, 2], s: ["0", "1"] },
    // r = 2 at s = 3/2 needs 500 points: refused by the default budget (400)
    { k: 3, t: [1], s: ["3/2"] },
  ],
  runPre: p("params-in-verified-domain"),
  runPost: p(
    "claims-verified-base-coordinates",
    "claims-pairwise-parallel",
    "claims-at-least-goal",
    "claims-maker-only",
    "rounds-match-plan",
    "log-legal",
  ),
  phases: [
    {
      id: "bichromatic-base",
      kind: "bichromatic-base",
      when: { kind: "eq", level: 1 },
      primitive: "bichromatic-base-1",
      summary: "Maker puts points on the parabola; a dyadic tilt makes every Maker point a 1-strip.",
      units: NONE,
      inputStrips: NONE,
      makerMoves: NEED,
      breakerAllowance: ALLOW_BICHRO,
      pairing: null,
      candidateRegions: null,
      extensionMove: "base point on y = x^2 (+ general-position offset) at the next fresh integer abscissa",
      survivorSelection: "every Maker point after the tilt",
      allowedResponses: GP,
      pre: p("board-empty-at-start", "inputs-count"),
      post: p(
        "phase-accounting",
        "ledger-arithmetic",
        "outputs-count",
        "outputs-are-strips",
        "outputs-pairwise-parallel",
        "outputs-maker-only",
      ),
      transition: { kind: "terminal" },
    },
    {
      id: "bichromatic-pairing",
      kind: "bichromatic-pairing",
      when: { kind: "gte", level: 2 },
      primitive: "bichromatic-pair-tilt",
      summary:
        "Pair the (k-1)-strips; Maker plays p_j (t points, t = ceil(2R/eps)); a dyadic tilt makes both candidates of every pair strict strips; Breaker points are never adopted; harvest one Maker-only strip per surviving pair.",
      units: ceil(div(mul(TWO, NEED), sub(TWO, S))),
      inputStrips: mul(TWO, vr("units")),
      makerMoves: vr("units"),
      breakerAllowance: ALLOW_BICHRO,
      pairing: "strips S_{2j-1}, S_{2j} (sorted by x) form pair j",
      candidateRegions: "R_{2j-1}, R_{2j} in the tilted frame; each Breaker point in at most one closed region",
      extensionMove: "p_j on l_j ∩ C+_{2j-1} ∩ C-_{2j} (k = 1 horizontal cone convention for single points)",
      survivorSelection: "one Maker-only strip per pair whose candidate is empty",
      allowedResponses: GP,
      pre: MONO_PRE,
      post: [...PAIR_POST, ...p("outputs-maker-only")],
      transition: { kind: "recurse", level: sub(vr("level"), ONE), need: mul(TWO, vr("units")) },
    },
  ],
};

export const KSTRIP_SPECS: readonly KStripSpec[] = [SPEC_MONO_1_1, SPEC_MONO_1_S, SPEC_BICHROMATIC];

export function specById(id: string): KStripSpec | undefined {
  return KSTRIP_SPECS.find((s) => s.id === id);
}
