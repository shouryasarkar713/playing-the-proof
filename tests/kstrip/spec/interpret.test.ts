import { describe, expect, it } from "vitest";
import { pt } from "../../../src/geometry/pt.ts";
import type { Pt } from "../../../src/geometry/pt.ts";
import { Rat } from "../../../src/geometry/rat.ts";
import { DEFAULT_BUDGET, createStrategyAwarePolicy, runKStrip } from "../../../src/kstrip/index.ts";
import type { BreakerPolicy, BreakerView } from "../../../src/kstrip/index.ts";
import {
  SPEC_BICHROMATIC,
  SPEC_MONO_1_1,
  SPEC_MONO_1_S,
  certificateFailures,
  certificateTable,
  runSpec,
  specTable,
} from "../../../src/kstrip/spec/index.ts";
import type { KStripSpec, PhaseSpec } from "../../../src/kstrip/spec/index.ts";
import { add, num, vr } from "../../../src/kstrip/spec/expr.ts";
import { fingerprint } from "./helpers.ts";

const R = (n: number, d = 1): Rat => Rat.make(BigInt(n), BigInt(d));
const aware = (): BreakerPolicy => createStrategyAwarePolicy();

describe("uncovered: parameters outside the verified configurations", () => {
  const cases: [string, KStripSpec, { k: number; t: bigint; s?: Rat }][] = [
    ["k = 6 (runKStrip would refuse by budget)", SPEC_MONO_1_1, { k: 6, t: 1n }],
    ["k = 1", SPEC_MONO_1_1, { k: 1, t: 1n }],
    ["t beyond the verified list", SPEC_MONO_1_1, { k: 5, t: 2n }],
    ["1:1 with s = 2", SPEC_MONO_1_1, { k: 3, t: 1n, s: R(2) }],
    ["1:s without s", SPEC_MONO_1_S, { k: 3, t: 1n }],
    ["1:s with s = 5", SPEC_MONO_1_S, { k: 3, t: 1n, s: R(5) }],
    ["1:s with non-integer s", SPEC_MONO_1_S, { k: 3, t: 1n, s: R(3, 2) }],
    ["bichromatic s = 2", SPEC_BICHROMATIC, { k: 2, t: 1n, s: R(2) }],
    ["bichromatic k = 4", SPEC_BICHROMATIC, { k: 4, t: 1n, s: R(1) }],
    ["bichromatic r = 2 at k = 3, s = 3/2", SPEC_BICHROMATIC, { k: 3, t: 2n, s: R(3, 2) }],
    ["bichromatic with s = 7/5 (never verified)", SPEC_BICHROMATIC, { k: 2, t: 1n, s: R(7, 5) }],
  ];
  for (const [name, spec, params] of cases) {
    it(name, () => {
      const run = runSpec(spec, params, aware());
      expect(run.outcome.kind).toBe("uncovered");
      expect(run.result).toBeNull(); // nothing executed, nothing guessed
      expect(run.certificates).toEqual([]);
      expect(run.runPre.some((r) => !r.ok && r.id === "params-in-verified-domain")).toBe(true);
    });
  }
  it("the reason names the configuration", () => {
    const run = runSpec(SPEC_MONO_1_S, { k: 3, t: 1n, s: R(5) }, aware());
    expect(run.outcome).toMatchObject({ kind: "uncovered", reason: expect.stringContaining("s=5/1") });
  });
});

describe("incomplete: budget", () => {
  it("refused before execution, identical to runKStrip", () => {
    const tiny = { ...DEFAULT_BUDGET, maxPoints: 10n };
    const run = runSpec(SPEC_MONO_1_1, { k: 4, t: 1n }, aware(), { budget: tiny });
    expect(run.outcome).toMatchObject({ kind: "incomplete", reason: "refused" });
    const ref = runKStrip(4, 1, aware(), tiny);
    expect(ref.status).toBe("refused");
    expect(run.result?.message).toBe(ref.message);
    expect(run.result?.claims).toEqual([]);
    expect(run.plan.length).toBeGreaterThan(0);
  });
  it("work budget exhausted mid-run reports no claims", () => {
    const b = { ...DEFAULT_BUDGET, preflight: false, maxWork: 100n };
    const run = runSpec(SPEC_MONO_1_1, { k: 3, t: 1n }, aware(), { budget: b });
    expect(run.outcome).toMatchObject({ kind: "incomplete", reason: "budget-exhausted" });
    expect(run.result?.status).toBe("budget-exhausted");
    expect(run.result?.claims).toEqual([]);
    const ref = runKStrip(3, 1, aware(), b);
    expect(fingerprint(run.result as NonNullable<typeof run.result>)).toBe(fingerprint(ref));
  });
});

// A Breaker whose first move is whatever `pick` says (then random-legal-ish).
function scripted(pick: (view: BreakerView) => Pt | null): BreakerPolicy {
  const inner = aware();
  return {
    name: "scripted",
    choose(view) {
      const p = pick(view);
      if (p === null) {
        return inner.choose(view);
      }
      return { point: p, reason: { policy: "scripted", code: "x", summary: "x", target: null, data: {} } };
    },
  };
}

describe("rejected: Breaker responses outside the allowed classes", () => {
  it("duplicate point (general-position)", () => {
    const run = runSpec(
      SPEC_MONO_1_1,
      { k: 3, t: 1n },
      scripted((v) => (v.points.length > 0 ? (v.points[0] as { pt: Pt }).pt : null)),
    );
    expect(run.outcome).toMatchObject({ kind: "rejected", responseClass: "general-position", phase: "base-2" });
    expect(run.result?.status).toBe("invalid-breaker-move");
    expect(run.result?.message).toContain("duplicate");
    expect(run.result?.claims).toEqual([]);
  });
  it("same x in the monochromatic base phase (distinct-x)", () => {
    const run = runSpec(
      SPEC_MONO_1_1,
      { k: 3, t: 1n },
      scripted((v) => {
        const p = v.points[0];
        return p === undefined ? null : pt(p.pt.x, p.pt.y.add(R(12345)));
      }),
    );
    expect(run.outcome).toMatchObject({ kind: "rejected", responseClass: "distinct-x" });
    const ref = runKStrip(
      3,
      1,
      scripted((v) => {
        const p = v.points[0];
        return p === undefined ? null : pt(p.pt.x, p.pt.y.add(R(12345)));
      }),
    );
    expect(ref.status).toBe("invalid-breaker-move");
    expect(ref.message).toBe(run.result?.message);
  });
  it("collinear with two placed points (general-position)", () => {
    const run = runSpec(
      SPEC_MONO_1_1,
      { k: 3, t: 1n },
      scripted((v) => {
        if (v.phase === "base") {
          return null; // collinearity is tested in the pairing phase (no distinct-x there)
        }
        const a = (v.points[0] as { pt: Pt }).pt;
        const b = (v.points[1] as { pt: Pt }).pt;
        // the midpoint of a and b lies on their line (and has a fresh x)
        return pt(a.x.add(b.x).div(R(2)), a.y.add(b.y).div(R(2)));
      }),
    );
    expect(run.outcome).toMatchObject({ kind: "rejected", responseClass: "general-position" });
    expect(run.result?.message).toContain("collinear");
  });
  it("a bichromatic phase has no distinct-x requirement (same x is a legal response there)", () => {
    // different y, same x as the first Maker point: legal in the bichromatic base
    let first = true;
    const run = runSpec(
      SPEC_BICHROMATIC,
      { k: 2, t: 1n, s: R(1) },
      scripted((v) => {
        const p = v.points[0];
        if (p === undefined || !first) {
          return null;
        }
        first = false;
        return pt(p.pt.x, p.pt.y.add(R(777)));
      }),
    );
    expect(run.outcome.kind, JSON.stringify(run.outcome)).not.toBe("rejected");
  });
});

function withPhase(spec: KStripSpec, id: string, patch: Partial<PhaseSpec>): KStripSpec {
  return { ...spec, phases: spec.phases.map((p) => (p.id === id ? { ...p, ...patch } : p)) };
}
const pairing = SPEC_MONO_1_1.phases.find((p) => p.id === "pairing") as PhaseSpec;

describe("integrity failures name the violated predicate", () => {
  it("a postcondition that does not hold (outputs-maker-only in a monochromatic phase)", () => {
    const spec = withPhase(SPEC_MONO_1_1, "pairing", { post: [...pairing.post, { id: "outputs-maker-only" }] });
    const run = runSpec(spec, { k: 3, t: 1n }, aware());
    expect(run.outcome).toMatchObject({ kind: "integrity-failure", scope: "post", phase: "pairing", predicate: "outputs-maker-only" });
    expect(run.result?.status).toBe("invariant-failure");
    expect(run.result?.claims).toEqual([]);
    const failed = certificateFailures(run);
    expect(failed.map((f) => f.id)).toEqual(["outputs-maker-only"]);
    const cert = run.certificates[run.certificates.length - 1];
    expect(cert?.ok).toBe(false);
    expect(cert?.phaseId).toBe("pairing");
  });
  it("a precondition that does not hold (board-empty-at-start on the pairing phase)", () => {
    const spec = withPhase(SPEC_MONO_1_1, "pairing", { pre: [...pairing.pre, { id: "board-empty-at-start" }] });
    const run = runSpec(spec, { k: 3, t: 1n }, aware());
    expect(run.outcome).toMatchObject({ kind: "integrity-failure", scope: "pre", phase: "pairing", predicate: "board-empty-at-start" });
    // the failing certificate is recorded, with no postconditions evaluated
    expect(run.certificates[run.certificates.length - 1]).toMatchObject({ phaseId: "pairing", ok: false, post: [] });
    expect(run.result?.log.length).toBeGreaterThan(0); // the level below ran
  });
  it("a run postcondition that does not hold (claims-maker-only in the monochromatic game)", () => {
    const spec = { ...SPEC_MONO_1_1, runPost: [...SPEC_MONO_1_1.runPost, { id: "claims-maker-only" }] };
    const run = runSpec(spec, { k: 3, t: 1n }, aware());
    // monochromatic claims contain Breaker points (every shipped policy, k = 3)
    expect(run.outcome).toMatchObject({ kind: "integrity-failure", scope: "run-post", predicate: "claims-maker-only" });
    expect(run.result?.claims).toEqual([]);
    expect(run.runPost.filter((r) => !r.ok).map((r) => r.id)).toEqual(["claims-maker-only"]);
  });
  it("removing a required certificate predicate is refused by the validator (K7)", () => {
    const spec = withPhase(SPEC_MONO_1_1, "pairing", {
      post: [...pairing.post.filter((p) => p.id !== "outputs-count")],
    });
    const run = runSpec(spec, { k: 3, t: 1n }, aware());
    expect(run.outcome).toMatchObject({ scope: "spec", predicate: "K7" });
    expect(run.result).toBeNull();
  });
  it("an invalid spec is refused with the violated rule (fail closed)", () => {
    const spec = withPhase(SPEC_MONO_1_1, "pairing", { post: [] });
    const run = runSpec(spec, { k: 3, t: 1n }, aware());
    expect(run.outcome).toMatchObject({ kind: "integrity-failure", scope: "spec", predicate: "K2" });
    expect(run.result).toBeNull();
    expect(run.plan).toEqual([]);
  });
  it("unknown predicates fail closed even if validation is skipped (test seam)", () => {
    const spec = withPhase(SPEC_MONO_1_1, "pairing", { post: [...pairing.post, { id: "ghost" }] });
    const run = runSpec(spec, { k: 3, t: 1n }, aware(), { unsafeSkipValidation: true });
    expect(run.outcome).toMatchObject({ kind: "integrity-failure", scope: "post", predicate: "ghost" });
    expect(certificateFailures(run)[0]).toMatchObject({ id: "ghost", detail: "unknown predicate" });
  });
});

describe("the spec, not the executor, decides the Breaker allowance", () => {
  const changed = withPhase(SPEC_MONO_1_1, "pairing", { breakerAllowance: add(vr("s"), num(1)) });
  it("a changed allowance formula is refused by K8 ...", () => {
    const run = runSpec(changed, { k: 3, t: 1n }, aware());
    expect(run.outcome).toMatchObject({ kind: "integrity-failure", scope: "spec", predicate: "K8" });
  });
  it("... and, with validation skipped, really changes the game played", () => {
    const run = runSpec(changed, { k: 3, t: 1n }, aware(), { unsafeSkipValidation: true });
    const log = run.result?.log ?? [];
    const pair = log.filter((e) => e.phase === "pairing");
    expect(pair.length).toBeGreaterThan(0);
    for (const round of new Set(pair.map((e) => e.levelRound))) {
      expect(pair.filter((e) => e.levelRound === round && e.player === "breaker").length).toBe(2);
    }
    // the base phase still follows the shipped formula (1 reply per move)
    const base = log.filter((e) => e.phase === "base");
    expect(base.filter((e) => e.player === "breaker").length).toBe(base.filter((e) => e.player === "maker").length);
  });
});

describe("hypothetical spec for the k = 1 base primitive matches runKStrip", () => {
  it("mono-base-1 is the same code path as the legacy executor", () => {
    const spec: KStripSpec = { ...SPEC_MONO_1_1, verified: [{ k: 1, t: [1, 3] }] };
    for (const t of [1, 3]) {
      const run = runSpec(spec, { k: 1, t: BigInt(t) }, aware());
      const ref = runKStrip(1, t, aware());
      expect(run.outcome.kind, JSON.stringify(run.outcome)).toBe("completed");
      expect(fingerprint(run.result as NonNullable<typeof run.result>)).toBe(fingerprint(ref));
    }
  });
});

describe("tables", () => {
  it("specTable is plain data with formulas printed", () => {
    const t = specTable(SPEC_MONO_1_S);
    expect(JSON.parse(JSON.stringify(t))).toEqual(t);
    expect(t.phases.map((p) => p.levels)).toEqual(["level = 1", "level = 2", "level >= 3"]);
    const g = t.phases[2] as (typeof t.phases)[number];
    expect(g.makerMoves).toBe("units");
    expect(g.units).toBe("2*need");
    expect(g.inputStrips).toBe("4*s*need");
    expect(g.transition).toBe("recurse: level (level - 1), need 4*s*need");
    expect(g.pre.map((p) => p.id)).toEqual(["inputs-count", "inputs-are-strips", "inputs-pairwise-parallel"]);
    expect(g.pre.every((p) => p.describe.length > 10)).toBe(true);
    expect(t.runPost.map((p) => p.id)).toContain("claims-at-least-goal");
    expect(t.verified).toEqual(["k=3, t in {1}, s in {2, 3}", "k=4, t in {1}, s in {1, 2}"]);
    expect(specTable(SPEC_BICHROMATIC).phases[0]?.breakerAllowance).toBe("(floor(m*s) - floor((m - 1)*s))");
    const unknown = specTable({ ...SPEC_MONO_1_1, runPre: [{ id: "zzz" }] });
    expect(unknown.runPre[0]?.describe).toBe("(unknown predicate)");
  });
  it("certificateTable has one row per executed phase, bottom first", () => {
    const run = runSpec(SPEC_MONO_1_1, { k: 4, t: 1n }, aware());
    const rows = certificateTable(run);
    expect(rows.map((r) => [r.level, r.phaseId])).toEqual([
      [2, "base-2"],
      [3, "pairing"],
      [4, "pairing"],
    ]);
    expect(rows.every((r) => r.ok && r.post.every((p) => p.ok) && r.pre.every((p) => p.ok))).toBe(true);
    // contiguous log ranges covering the whole log
    expect(rows[0]?.logFrom).toBe(0);
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i]?.logFrom).toBe(rows[i - 1]?.logTo);
    }
    expect(rows[rows.length - 1]?.logTo).toBe(run.result?.log.length);
    // the table mirrors the plan
    expect(rows.map((r) => r.makerMoves)).toEqual([...run.plan].reverse().map((p) => Number(p.makerMoves)));
    expect(rows.map((r) => r.breakerMoves)).toEqual([...run.plan].reverse().map((p) => Number(p.breakerMoves)));
    expect(rows.map((r) => r.delivered).every((d, i) => d >= (rows[i] as (typeof rows)[number]).need)).toBe(true);
  });
});
