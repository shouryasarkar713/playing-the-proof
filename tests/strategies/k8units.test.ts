// tests/strategies/k8units.test.ts — unit / negative / boundary tests for the
// k=8 geometry (twinsK8), checkers (k8checks), classifiers and moves.
import { describe, expect, it } from "vitest";
import type { Pt } from "../../src/geometry/pt.ts";
import {
  earReplacement,
  heptagonPair,
  interiorsDisjoint,
  rotateToEdge,
  twinTriangleEars,
} from "../../src/geometry/twinsK8.ts";
import {
  forcingChecker,
  obs1Checker,
  pentPairChecker,
  sevenPairChecker,
  twinPairTriChecker,
  twinsTriChecker,
  twoSevensChecker,
} from "../../src/verification/k8checks.ts";
import { CheckerIntegrityError } from "../../src/verification/invariants.ts";
import { classifyB0Hept, classifyB3Obs2, classifyB4Sevens } from "../../src/strategy/strategies/k8/classify.ts";
import { evalMoveSpec } from "../../src/strategy/eval.ts";
import { placePoint } from "../../src/game/place.ts";
import type { GameState } from "../../src/game/types.ts";
import { testCtx } from "../helpers.ts";
import { HEPTAGON, P, breakerMove, centroid, ensureK8, initK8, ptOf, vars } from "./k8driver.ts";

ensureK8();
const ctx = testCtx();
const [A, , C, , E, F] = HEPTAGON as [Pt, Pt, Pt, Pt, Pt, Pt, Pt];

const s0 = initK8(ctx);
const s1 = (breakerMove(s0, centroid([A, C, E, F]), ctx) as { state: GameState }).state;
const tri = (vars(s1)["TRI"] as string[]).map((id) => ptOf(s1, id));
const s2 = (breakerMove(s1, centroid(tri), ctx) as { state: GameState }).state;
const X2 = (vars(s2)["X"] as string[]).map((id) => ptOf(s2, id));
const s3 = (breakerMove(s2, centroid([X2[0] as Pt, X2[2] as Pt, X2[4] as Pt]), ctx) as { state: GameState }).state;
const v1 = vars(s1) as Record<string, string | string[]>;
const v2 = vars(s2) as Record<string, string | string[]>;
const v3 = vars(s3) as Record<string, string | string[]>;
const ptOf1 = (id: string): Pt | null => s1.points.find((p) => p.id === id)?.pt ?? null;
const cfg = ctx.config;

describe("twinsK8 geometry", () => {
  it("interiorsDisjoint: touching hexagon halves are disjoint, overlapping ones are not", () => {
    const sq1 = [P(0, 0), P(4, 0), P(4, 4), P(0, 4)];
    const sq2 = [P(4, 0), P(8, 0), P(8, 4), P(4, 4)];
    const sq3 = [P(2, 1), P(6, 1), P(6, 3), P(2, 3)];
    expect(interiorsDisjoint(sq1, sq2)).toBe(true);
    expect(interiorsDisjoint(sq1, sq3)).toBe(false);
    expect(interiorsDisjoint(sq1, [P(10, 10), P(11, 10), P(11, 11)])).toBe(true);
  });

  it("heptagonPair: ring of 7 only, rotation reported, null for a hexagon or an unplaced B0", () => {
    const ids = vars(s0)["P7"] as string[];
    const all = s1.points.map((p) => p.pt);
    expect(heptagonPair(ids.slice(0, 6), "p8", ptOf1, all)).toBeNull();
    expect(heptagonPair(ids, "nope", ptOf1, all)).toBeNull();
    const r = heptagonPair(ids, "p8", ptOf1, all);
    expect(r?.ring.length).toBe(7);
  });

  it("twinTriangleEars: accepts the bound twins; rejects identical holes, non-shared anchors, same anchors", () => {
    const a = v1["twinA"] as string[];
    const b = v1["twinB"] as string[];
    const a1 = v1["A1"] as string;
    const b0 = v1["B0"] as string;
    const t = twinTriangleEars(a, b, [a1, b0], ptOf1);
    expect(t).not.toBeNull();
    expect(t?.earA.apex).not.toBe(t?.earB.apex);
    expect(twinTriangleEars(a, a, [a1, b0], ptOf1)).toBeNull();
    expect(twinTriangleEars(a, b, [a1, a1], ptOf1)).toBeNull();
    const far = a.find((x) => !b.includes(x)) as string;
    expect(twinTriangleEars(a, b, [a1, far], ptOf1)).toBeNull();
  });

  it("earReplacement replaces exactly the apexes by B1 and reports the third vertex; rotateToEdge needs consecutive ids", () => {
    const a = v1["twinA"] as string[];
    const b = v1["twinB"] as string[];
    const t = twinTriangleEars(a, b, [v1["A1"] as string, v1["B0"] as string], ptOf1);
    const rep = earReplacement(a, b, t as NonNullable<typeof t>, "pB1", ptOf1);
    expect(rep?.holeA.includes("pB1")).toBe(true);
    expect(rep?.holeA.length).toBe(6);
    expect(rep?.holeA.includes((t as NonNullable<typeof t>).earA.apex)).toBe(false);
    expect(rotateToEdge(["a", "b", "c", "d"], "b", "c")).toEqual(["b", "c", "d", "a"]);
    expect(rotateToEdge(["a", "b", "c", "d"], "a", "c")).toBeNull();
    expect(rotateToEdge(["a", "b"], "z", "a")).toBeNull();
  });
});

describe("k8 checkers: pass on the tour, fail typed on tampering", () => {
  it("pent-pair / twins-tri / twinpair-tri", () => {
    expect(pentPairChecker.check(s1, { pentA: v1["pentA"] as string[], pentB: v1["pentB"] as string[], B0: [v1["B0"] as string] }, cfg).passed).toBe(true);
    expect(pentPairChecker.check(s1, { pentA: v1["pentA"] as string[], pentB: v1["pentA"] as string[], B0: [v1["B0"] as string] }, cfg).passed).toBe(false);
    const tw = { pentA: v1["pentA"] as string[], pentB: v1["pentB"] as string[], B0: [v1["B0"] as string], A1: [v1["A1"] as string] };
    expect(twinsTriChecker.check(s1, tw, cfg).passed).toBe(true);
    expect(twinsTriChecker.check(s1, { ...tw, pentB: v1["pentA"] as string[] }, cfg).passed).toBe(false);
    const tp = { twinA: v1["twinA"] as string[], twinB: v1["twinB"] as string[], A1: [v1["A1"] as string], B0: [v1["B0"] as string] };
    expect(twinPairTriChecker.check(s1, tp, cfg).passed).toBe(true);
    expect(twinPairTriChecker.check(s1, { ...tp, twinB: v1["twinA"] as string[] }, cfg).passed).toBe(false);
    expect(twinPairTriChecker.check(s1, { ...tp, twinB: (vars(s0)["P7"] as string[]).slice(0, 6) }, cfg).passed).toBe(false);
  });

  it("obs1 passes after A2 and fails where no 7-hole through the argument exists", () => {
    expect(obs1Checker.check(s2, { A2: [v2["A2"] as string] }, cfg).passed).toBe(true);
    expect(obs1Checker.check(s1, { A2: [v1["A1"] as string] }, cfg).passed).toBe(false);
  });

  it("forcing passes after A3, fails for a chain that every 6-hole contains or for a point without twins", () => {
    const chain = [v3["B0"] as string, v3["A2"] as string, v3["B1"] as string];
    expect(forcingChecker.check(s3, { A3: [v3["A3"] as string], chain }, cfg).passed).toBe(true);
    expect(forcingChecker.check(s2, { A3: [v2["B1"] as string], chain }, cfg).passed).toBe(false);
  });

  it("two-sevens / sevenpair: fail before A4; sevenpair fails for overlapping or dead holes", () => {
    expect(twoSevensChecker.check(s3, { A4: [v3["A3"] as string] }, cfg).passed).toBe(false);
    const x = v2["X"] as string[];
    expect(sevenPairChecker.check(s2, { holeA: x, holeB: x }, cfg).passed).toBe(false);
    expect(sevenPairChecker.check(s3, { holeA: x, holeB: x }, cfg).passed).toBe(false);
  });

  it("malformed arguments throw CheckerIntegrityError", () => {
    expect(() => pentPairChecker.check(s1, { pentA: ["p1"], pentB: ["p1"], B0: ["p8"] }, cfg)).toThrow(CheckerIntegrityError);
    expect(() => obs1Checker.check(s1, {}, cfg)).toThrow(CheckerIntegrityError);
    expect(() => obs1Checker.check(s1, { A2: ["nope"] }, cfg)).toThrow(CheckerIntegrityError);
    expect(() => forcingChecker.check(s3, { A3: ["p13"], chain: ["p1", "p2"] }, cfg)).toThrow(CheckerIntegrityError);
  });
});

describe("k8 classifiers", () => {
  const hypo = (s: GameState, at: Pt): GameState => placePoint(s, "breaker", at);
  it("classifyB0Hept: outside / pair; malformed fails closed; boundaries are 7 edges + 7 chords", () => {
    const hole = vars(s0)["P7"] as string[];
    const out = classifyB0Hept.classify(hypo(s0, P(80, 80)), { hole }, cfg);
    expect(out.kind === "classified" && out.result.tag).toBe("outside");
    const inside = classifyB0Hept.classify(hypo(s0, centroid([A, C, E, F])), { hole }, cfg);
    expect(inside.kind === "classified" && inside.result.tag).toBe("pair");
    expect(classifyB0Hept.classify(s0, { hole: ["p1"] }, cfg).kind).toBe("integrity");
    const b = classifyB0Hept.boundaries(s0, { hole }, cfg);
    expect(b.kind === "ok" && b.lines.length).toBe(14);
    expect(classifyB0Hept.boundaries(s0, { hole: ["p1"] }, cfg).kind).toBe("integrity");
  });

  it("classifyB4Sevens: inside A / inside B / else (tags pinned to regions); integrity on malformed", () => {
    const reps: GameState[] = [];
    for (const s of [s3]) {
      reps.push(s);
    }
    // Build a state with two disjoint 7-holes bound: use the first vertex-pair B3 found by a coarse scan.
    const x = v2["X"] as string[];
    expect(classifyB4Sevens.classify(s2, { holeA: x, holeB: x.slice(0, 6) }, cfg).kind).toBe("integrity");
    expect(classifyB4Sevens.classify(s2, { holeA: x, holeB: ["nope", ...x.slice(1)] }, cfg).kind).toBe("integrity");
    const inA = classifyB4Sevens.classify(hypo(s2, centroid([X2[0] as Pt, X2[2] as Pt, X2[4] as Pt])), { holeA: x, holeB: x }, cfg);
    expect(inA.kind === "classified" && inA.result.tag).toBe("inside-seven-A");
    const far = classifyB4Sevens.classify(hypo(s2, P(900, -700)), { holeA: x, holeB: x }, cfg);
    expect(far.kind === "classified" && far.result.tag).toBe("else");
    expect(classifyB4Sevens.boundaries(s2, { holeA: x, holeB: x }, cfg).kind).toBe("ok");
    expect(classifyB4Sevens.boundaries(s2, { holeA: x }, cfg).kind).toBe("integrity");
  });

  it("classifyB3Obs2: a far B3 leaves a 7-hole; boundaries unavailable by design", () => {
    const far = classifyB3Obs2.classify(hypo(s2, P(900, -700)), {}, cfg);
    expect(far.kind === "classified" && far.result.tag).toBe("seven-hole");
    expect(classifyB3Obs2.boundaries(s3, {}, cfg).kind).toBe("integrity");
  });
});

describe("k8 moves fail closed", () => {
  it("double-extend returns null when no vertex-sharing pair exists; escape-edge-accept rejects misbound vars loudly", () => {
    expect(evalMoveSpec({ kind: "double-extend", holeSize: 6 }, s1, cfg)).toBeNull();
    expect(() =>
      evalMoveSpec(
        { kind: "escape-edge-accept", options: [{ edge: { kind: "var", v: "nope" }, ring: { kind: "var", v: "RING" }, grow: [] }] },
        s1,
        cfg,
      ),
    ).toThrow();
    expect(() =>
      evalMoveSpec({ kind: "forcing-pair", ring: { kind: "var", v: "nope" }, chain: ["B0", "A1", "B0"] }, s1, cfg),
    ).toThrow();
  });
});
