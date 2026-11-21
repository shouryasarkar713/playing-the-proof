import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  StripRegion,
  buildLedger,
  canAdd,
  chooseApex,
  chooseLineX,
  coneContains,
  groupExtension,
  interiorsDisjoint,
  isStrip,
  pairRegions,
  parallel,
  planGroup,
  planPair,
  settlePair,
  sharedHalfline,
} from "../../src/kstrip/index.ts";
import type { OwnedPoint } from "../../src/kstrip/index.ts";
import { eqPt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { P, R } from "./helpers.ts";

const A = [P(0, 0), P(1, 3), P(2, 0)];
const B = [P(10, 0), P(11, 3), P(12, 0)];
const S0 = [...A, ...B];

function plan(S: Pt[] = S0) {
  const r = planPair(S, A, B, 1);
  if (!r.ok) throw new Error("plan failed");
  return r.plan;
}

describe("pairing step", () => {
  it("canAdd: duplicates and collinear triples are rejected", () => {
    expect(canAdd(S0, P(3, 4))).toBe(true);
    expect(canAdd(S0, P(0, 0))).toBe(false);
    expect(canAdd(S0, P(4, 0))).toBe(false); // (0,0),(2,0) collinear with it
    expect(canAdd(S0, P(2, -4))).toBe(true);
  });

  it("chooseLineX: strictly between, avoids every x of S, deterministic dyadic", () => {
    expect(chooseLineX(S0, R(2), R(10)).equals(R(6))).toBe(true);
    const S = [...S0, P(6, 100)];
    const x = chooseLineX(S, R(2), R(10));
    expect(x.equals(R(4))).toBe(true); // 1/4 of the gap, after 1/2 is taken
    expect(() => chooseLineX(S, R(2), R(2))).toThrow();
  });

  it("halfline = l ∩ C+ ∩ C- with exact top; apex is strictly inside both cones", () => {
    const pl = plan();
    expect(pl.xLine.equals(R(6))).toBe(true);
    // C+ of A: apex (2,0), ray slope -3 -> -12 at x=6; C- of B: slope 3 -> -12
    expect(pl.top.equals(R(-12))).toBe(true);
    const p = chooseApex(pl.top, pl.xLine, (q) => canAdd(S0, q));
    if (p === null) throw new Error("no apex");
    expect(p.y.equals(R(-13))).toBe(true);
    expect(coneContains(pl.coneLeft, p, "open")).toBe(true);
    expect(coneContains(pl.coneRight, p, "open")).toBe(true);
    // the halfline's closed top lies in both closed cones, one step above is outside one
    const top = P(6, -12);
    expect(coneContains(pl.coneLeft, top)).toBe(true);
    expect(coneContains(pl.coneRight, top)).toBe(true);
    expect(
      coneContains(pl.coneLeft, P(6, "-23/2")) && coneContains(pl.coneRight, P(6, "-23/2")),
    ).toBe(false);
  });

  it("top is the MIN of the two cone sections (blocked right cone)", () => {
    const S = [...S0, P(9, -30)]; // a low point right of the left strip blocks C+ of A? no: C- of B
    const pl = plan(S);
    expect(pl.top.cmp(R(-12)) <= 0).toBe(true);
    const p = chooseApex(pl.top, pl.xLine, (q) => canAdd(S, q));
    if (p === null) throw new Error("no apex");
    expect(coneContains(pl.coneLeft, p) && coneContains(pl.coneRight, p)).toBe(true);
  });

  it("candidate strips are strips; regions interior-disjoint, share only the halfline below p", () => {
    const pl = plan();
    const p = chooseApex(pl.top, pl.xLine, (q) => canAdd(S0, q)) as Pt;
    const S = [...S0, p];
    const reg = pairRegions(A, B, p);
    if (reg === null) throw new Error("regions");
    expect(isStrip([...A, p], S).ok).toBe(true);
    expect(isStrip([p, ...B], S).ok).toBe(true);
    expect(interiorsDisjoint(reg.left, reg.right)).toBe(true);
    expect(sharedHalfline(reg.left, reg.right)).not.toBeNull();
    expect(parallel(reg.left, reg.right).ok).toBe(false);
    // a point on the shared halfline is on the boundary of BOTH
    expect(reg.left.classify(P(6, -50))).toBe("boundary");
    expect(reg.right.classify(P(6, -50))).toBe("boundary");
  });

  it("planPair rejects invalid strips and unordered projections", () => {
    const bad = planPair([...S0, P(1, 0)], A, B, 1);
    expect(!bad.ok && bad.reason.code).toBe("invalid-strip");
    const swapped = planPair(S0, B, A, 1);
    expect(!swapped.ok && swapped.reason.code).toBe("projections-not-ordered");
  });
});

describe("adoption (monochromatic replacement rule)", () => {
  const pl = plan();
  const apex = chooseApex(pl.top, pl.xLine, (q) => canAdd(S0, q)) as Pt; // (6,-13)

  it("Breaker below p replaces p by the LOWEST such point", () => {
    const S = [...S0, apex, P(6, -20), P(6, -30)];
    const s = settlePair(S, A, B, apex, true);
    expect(eqPt(s.apex, P(6, -30))).toBe(true);
    const ev = s.events.find((e) => e.kind === "apex");
    expect(ev?.absorbed.length).toBe(2); // (6,-20) and (6,-30); p itself excluded
  });

  it("Breaker below s_{2j-1,1} / s_{2j,k-1} replaces that vertex", () => {
    const S = [...S0, apex, P(0, -5), P(12, -1)];
    const s = settlePair(S, A, B, apex, true);
    expect(eqPt(s.left[0] as Pt, P(0, -5))).toBe(true);
    expect(eqPt(s.right[2] as Pt, P(12, -1))).toBe(true);
    expect(eqPt(s.apex, apex)).toBe(true);
    // the replaced strips are still strips against the full board
    expect(isStrip([...s.left, s.apex], S).ok).toBe(true);
    expect(isStrip([s.apex, ...s.right], S).ok).toBe(true);
  });

  it("without the rule a boundary point spoils the strip; with it the strip is valid", () => {
    const S = [...S0, apex, P(6, -20)];
    expect(isStrip([...A, apex], S).ok).toBe(false); // boundary-point violation
    const s = settlePair(S, A, B, apex, true);
    expect(isStrip([...s.left, s.apex], S).ok).toBe(true);
    const off = settlePair(S, A, B, apex, false); // bichromatic: no adoption
    expect(eqPt(off.apex, apex)).toBe(true);
  });

  it("interior Breaker points are NOT adopted", () => {
    const S = [...S0, apex, P(1, 1)];
    const s = settlePair(S, A, B, apex, true);
    expect(eqPt(s.apex, apex)).toBe(true);
    expect(eqPt(s.left[0] as Pt, A[0] as Pt)).toBe(true);
  });

  it("property: adoption keeps strips valid, regions only shrink, interiors disjoint", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(fc.constantFrom(0, 6, 12), fc.integer({ min: -60, max: -1 })),
          { maxLength: 8 },
        ),
        (extra) => {
          const S: Pt[] = [...S0, apex];
          for (const [x, y] of extra) {
            const q = P(x, y);
            if (canAdd(S, q)) S.push(q);
          }
          const s = settlePair(S, A, B, apex, true);
          const before = pairRegions(A, B, apex);
          const after = pairRegions(s.left, s.right, s.apex);
          if (before === null || after === null) return false;
          const okStrips =
            isStrip([...s.left, s.apex], S).ok && isStrip([s.apex, ...s.right], S).ok;
          // monotone: every point interior/boundary of the NEW region was in the old closed region
          const mono = S.every((q) =>
            [
              [before.left, after.left],
              [before.right, after.right],
            ].every(([b, a]) => {
              const na = (a as StripRegion).classify(q);
              const ob = (b as StripRegion).classify(q);
              return na === "exterior" || ob !== "exterior";
            }),
          );
          return (
            okStrips &&
            mono &&
            interiorsDisjoint(after.left, after.right) &&
            sharedHalfline(after.left, after.right) !== null
          );
        },
      ),
      { numRuns: 150 },
    );
  });
});

describe("Theorem 4 groups", () => {
  const A2 = [P(0, 0), P(1, 3), P(2, 0)];
  const B2 = [P(5, 0), P(6, 3), P(7, 0)];
  const S = [...A2, ...B2];
  it("planGroup: line left of the group, top = min of the C- sections", () => {
    const r = planGroup(S, [A2, B2], null, 1);
    if (!r.ok) throw new Error("plan");
    expect(r.plan.xLine.cmp(R(0)) < 0).toBe(true);
    expect(r.plan.cones.length).toBe(2);
    const p = chooseApex(r.plan.top, r.plan.xLine, (q) => canAdd(S, q)) as Pt;
    for (const c of r.plan.cones) expect(coneContains(c, p, "open")).toBe(true);
  });
  it("slab extension: first point met (Maker's p included) yields a verified strip", () => {
    const r = planGroup(S, [A2, B2], null, 1);
    if (!r.ok) throw new Error("plan");
    const p = chooseApex(r.plan.top, r.plan.xLine, (q) => canAdd(S, q)) as Pt;
    const board = [...S, p];
    const e = groupExtension(board, A2, r.plan.xLine);
    if (!e.ok) throw new Error(e.message);
    expect(eqPt(e.q, p)).toBe(true);
    // a Breaker point inside the cone but not in Q_1 that is met first
    const q = P("-1/2", "-10");
    const board2 = [...board, q];
    const e2 = groupExtension(board2, A2, r.plan.xLine);
    if (!e2.ok) throw new Error(e2.message);
    expect(isStrip(e2.vertices, board2).ok).toBe(true);
  });
  it("slab restriction keeps harvested strips of different groups parallel", () => {
    const G1 = [P(0, 0), P(1, 3), P(2, 0)];
    const G2 = [P(20, 0), P(21, 3), P(22, 0)];
    const Sx = [...G1, ...G2];
    const p1 = planGroup(Sx, [G1], null, 1);
    if (!p1.ok) throw new Error("p1");
    const p2 = planGroup(Sx, [G2], R(2), 2);
    if (!p2.ok) throw new Error("p2");
    const a1 = chooseApex(p1.plan.top, p1.plan.xLine, (q) => canAdd(Sx, q)) as Pt;
    const a2 = chooseApex(p2.plan.top, p2.plan.xLine, (q) => canAdd([...Sx, a1], q)) as Pt;
    // z: a steep low point far LEFT of l_2 (inside G2's unbounded cone C-, in
    // G1's x-range). Without the slab restriction it would be met first and the
    // extended region of G2 would swallow G1's x-range (not parallel).
    const z = P(-5, -1000);
    const board = [...Sx, a1, a2, z];
    const e1 = groupExtension(board, G1, p1.plan.xLine);
    const e2 = groupExtension(board, G2, p2.plan.xLine);
    if (!e1.ok || !e2.ok) throw new Error("ext");
    expect(eqPt(e2.q, z)).toBe(false);
    expect(eqPt(e2.q, a2)).toBe(true);
    expect(parallel(e1.region, e2.region).ok).toBe(true);
  });
});

describe("ledger", () => {
  it("counts interior blockers, absorbed points, bound and Proposition 1", () => {
    const pl = plan();
    const apex = chooseApex(pl.top, pl.xLine, (q) => canAdd(S0, q)) as Pt;
    const reg = pairRegions(A, B, apex);
    if (reg === null) throw new Error("reg");
    const mk = (pt: Pt): OwnedPoint => ({ pt, owner: "breaker" });
    const own: OwnedPoint[] = [...S0, apex].map((pt) => ({ pt, owner: "maker" as const }));
    const b1 = P(1, -3); // interior of R1
    const b2 = P("11", "-3"); // interior of R2
    const ledger = buildLedger({
      units: [
        {
          unit: 1,
          regions: [
            { id: "R1", region: reg.left },
            { id: "R2", region: reg.right },
          ],
          adoption: [],
        },
      ],
      points: [...own, mk(b1), mk(b2)],
      breakerPhasePoints: [b1, b2],
      budgetTotal: 2,
      required: 1,
    });
    expect(ledger.units[0]?.dead).toBe(true);
    expect(ledger.survivorsNow).toBe(0);
    expect(ledger.placements.every((p) => p.category === "interior")).toBe(true);
    expect(ledger.proposition1.unitsWithTwoOrMoreInteriorBreakers).toBe(1);
    const partial = buildLedger({
      units: [
        {
          unit: 1,
          regions: [
            { id: "R1", region: reg.left },
            { id: "R2", region: reg.right },
          ],
          adoption: [],
        },
      ],
      points: [...own, mk(b1)],
      breakerPhasePoints: [b1],
      budgetTotal: 2,
      required: 1,
    });
    expect(partial.units[0]?.need).toBe(1);
    expect(partial.budgetRemaining).toBe(1);
    expect(partial.maxFurtherKills).toBe(1);
    expect(partial.guaranteedSurvivors).toBe(0);
  });
});
