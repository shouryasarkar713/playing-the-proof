// The tilt conditions of the bichromatic construction (runner.ts, T1-T6):
// exact fixtures for each rule, the shared-halfline case, and a regression for
// the adversarial play in which an EARLIER Breaker point ended up inside a
// candidate region (it was accepted when only "at most one region per Breaker
// point" was enforced).
import { describe, expect, it } from "vitest";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { Rat } from "../../src/geometry/rat.ts";
import {
  DOWN,
  Prng,
  StripRegion,
  checkTilt,
  createGreedyBlockingPolicy,
  isStrip,
  runKStrip,
  shearPt,
  tiltPointVerdict,
} from "../../src/kstrip/index.ts";
import type { BreakerPolicy, BreakerView, OwnedPoint, TraceEvent } from "../../src/kstrip/index.ts";

const R = (n: number, d = 1): Rat => Rat.make(BigInt(n), BigInt(d));
const P = (x: number, y: number, dx = 1, dy = 1): Pt => pt(R(x, dx), R(y, dy));
const M = (p: Pt): OwnedPoint => ({ pt: p, owner: "maker" });
const B = (p: Pt): OwnedPoint => ({ pt: p, owner: "breaker" });

function region(chain: readonly Pt[]): StripRegion {
  const r = StripRegion.make(chain, DOWN);
  if (!r.ok) {
    throw new Error("bad fixture chain");
  }
  return r.region;
}

// pair: a --- p --- b (single-point strips; apex p below both)
const PAIR1 = { left: [P(0, 0)], right: [P(2, 0)], apex: P(1, -1) };
const PAIR1_PTS = [P(0, 0), P(2, 0), P(1, -1)].map(M);

describe("T6: tiltPointVerdict (the per-point counting rule)", () => {
  // two regions of DIFFERENT pairs overlapping in the tilted frame
  const delta = R(1, 32);
  const pair2 = { left: [P(3, -100)], right: [P(5, -100)], apex: P(4, -101) };
  const tilted = (c: readonly Pt[]): Pt[] => c.map((p) => shearPt(delta, p));
  const r1 = region(tilted([...PAIR1.left, PAIR1.apex]));
  const r2 = region(tilted([...pair2.left, pair2.apex]));
  // a Breaker point deep below both, with tilted abscissa 1/2
  const q = shearPt(delta, pt(R(127, 4), R(-1000))); // x' = 31.75 - 31.25 = 1/2

  it("a Breaker point in two closed regions is rejected (and the count says 2)", () => {
    expect(r1.classify(q)).toBe("interior");
    expect(r2.classify(q)).toBe("interior");
    expect(tiltPointVerdict([r1, r2], q, "phase-breaker")).toEqual({ ok: false, reason: "breaker-in-two-regions", hits: 2 });
  });
  it("one region is fine for a phase Breaker point, never for an old point", () => {
    expect(tiltPointVerdict([r1], q, "phase-breaker")).toEqual({ ok: true, hits: 1 });
    expect(tiltPointVerdict([r1], q, "old")).toEqual({ ok: false, reason: "old-point-in-candidate", hits: 1 });
    expect(tiltPointVerdict([r1, r2], P(50, 50), "old")).toEqual({ ok: true, hits: 0 });
    expect(tiltPointVerdict([r1, r2], P(50, 50), "phase-breaker")).toEqual({ ok: true, hits: 0 });
  });
  it("a vertex of a region is not an intruder; a boundary point counts as inside", () => {
    expect(tiltPointVerdict([r1], r1.vertices[0] as Pt, "old")).toEqual({ ok: true, hits: 0 });
    // on the vertical line below the apex: boundary of both candidates of one pair
    const left = region([P(0, 0), P(1, -1)]);
    const right = region([P(1, -1), P(2, 0)]);
    const onShared = P(1, -5);
    expect(left.classify(onShared)).toBe("boundary");
    expect(right.classify(onShared)).toBe("boundary");
    expect(tiltPointVerdict([left, right], onShared, "phase-breaker")).toEqual({ ok: false, reason: "breaker-in-two-regions", hits: 2 });
  });
});

describe("checkTilt: T1-T5", () => {
  it("baseline: the vertical frame of a clean pair is admissible", () => {
    expect(checkTilt(PAIR1_PTS, [], R(0), [PAIR1])).toEqual({ ok: true });
  });

  it("T4: candidates of different pairs must not overlap (even if no point is inside)", () => {
    const pair2 = { left: [P(3, -100)], right: [P(5, -100)], apex: P(4, -101) };
    const pts = [...PAIR1_PTS, ...[P(3, -100), P(5, -100), P(4, -101)].map(M)];
    expect(checkTilt(pts, [], R(0), [PAIR1, pair2])).toEqual({ ok: true });
    expect(checkTilt(pts, [], R(1, 32), [PAIR1, pair2])).toEqual({ ok: false, reason: "pairs-overlap" });
  });

  it("T5: an EARLIER Breaker point may not end up inside a candidate; a phase Breaker point may", () => {
    // outside every vertical candidate (x = 5/2 is right of the pair), but inside the left candidate
    // once the direction is (1/2,-1): x' = 5/2 - 19/8 = 1/8 in [0, 1/2], far below the chain
    const q = P(5, -19, 2, 4);
    const pts = [...PAIR1_PTS, B(q)];
    expect(checkTilt(pts, [], R(0), [PAIR1])).toEqual({ ok: true });
    expect(checkTilt(pts, [], R(1, 2), [PAIR1])).toEqual({ ok: false, reason: "old-point-in-candidate" });
    expect(checkTilt(pts, [q], R(1, 2), [PAIR1])).toEqual({ ok: true });
  });

  it("T5: a Maker point inside a candidate is rejected whoever it belongs to", () => {
    const m = P(5, -19, 2, 4);
    expect(checkTilt([...PAIR1_PTS, M(m)], [], R(1, 2), [PAIR1])).toEqual({ ok: false, reason: "old-point-in-candidate" });
  });

  it("T1: a Breaker point on the shared halfline spoils BOTH candidates (Definition 2) until the direction leaves it", () => {
    const q = P(1, -5);
    const S = [...PAIR1_PTS.map((o) => o.pt), q];
    // vertical: both candidates fail the strip test because of q on their boundary
    expect(isStrip([P(0, 0), P(1, -1)], S, DOWN)).toMatchObject({ ok: false, reason: { code: "boundary-point" } });
    expect(isStrip([P(1, -1), P(2, 0)], S, DOWN)).toMatchObject({ ok: false, reason: { code: "boundary-point" } });
    // the vertical direction is not admissible (q shares the abscissa of the apex)
    expect(checkTilt([...PAIR1_PTS, B(q)], [q], R(0), [PAIR1])).toEqual({ ok: false, reason: "shared-abscissa" });
    // a tilted direction is: q is then in at most one region
    expect(checkTilt([...PAIR1_PTS, B(q)], [q], R(1, 4), [PAIR1])).toEqual({ ok: true });
    const t = (p: Pt): Pt => shearPt(R(1, 4), p);
    const left = region([t(P(0, 0)), t(P(1, -1))]);
    const right = region([t(P(1, -1)), t(P(2, 0))]);
    const hits = [left, right].filter((r) => r.classify(t(q)) !== "exterior").length;
    expect(hits).toBeLessThanOrEqual(1);
    // and the candidates are strips again w.r.t. the tilted direction (-1/4, -1) in base coordinates
    const v = { x: R(-1, 4), y: R(-1) };
    expect(isStrip([P(0, 0), P(1, -1)], S, v).ok || isStrip([P(1, -1), P(2, 0)], S, v).ok).toBe(true);
  });

  it("T2/T3: invalid candidate shapes", () => {
    // an apex not between the strips: the left chain is not increasing in x'
    expect(checkTilt([...PAIR1_PTS], [], R(0), [{ ...PAIR1, apex: P(-1, -1) }])).toMatchObject({ ok: false });
    // a cup instead of a cap: (0,0), (1,-5), (2,0)
    const cup = { left: [P(0, 0), P(1, -5)], right: [P(3, 0)], apex: P(2, 0) };
    expect(checkTilt([P(0, 0), P(1, -5), P(3, 0), P(2, 0)].map(M), [], R(0), [cup])).toEqual({
      ok: false,
      reason: "candidate-not-a-cap",
    });
    // a tilt that reverses the order of the two candidates of a pair
    const flat = { left: [P(0, 0)], right: [P(2, 0)], apex: P(1, -100) };
    expect(checkTilt([P(0, 0), P(2, 0), P(1, -100)].map(M), [], R(1, 2), [flat])).toMatchObject({ ok: false });
    // shared abscissa of two board points
    expect(checkTilt([P(0, 0), P(0, 5)].map(M), [], R(0), [])).toEqual({ ok: false, reason: "shared-abscissa" });
  });
});

// ---- regression: the play found by search -------------------------------------

function shadowPolicy(g: readonly { x: number; y: number }[]): BreakerPolicy {
  const inner = createGreedyBlockingPolicy();
  let i = 0;
  return {
    name: "shadow-base",
    choose(view: BreakerView) {
      if (view.phase === "bichromatic-base") {
        const gp = g[i % g.length] as { x: number; y: number };
        i += 1;
        for (let j = 0; j < 400; j += 1) {
          const p = pt(R(gp.x, 4).add(R(j, 1013)), R(gp.y, 4).add(R(j, 7919)));
          if (view.legal(p).ok) {
            return { point: p, reason: { policy: "shadow-base", code: "g", summary: "g", target: null, data: {} } };
          }
        }
      }
      return inner.choose(view);
    },
  };
}

interface Seen {
  oldInside: number;
  unitsAndBound: [number, number];
}

describe("regression: earlier Breaker points can no longer spoil candidates for free", () => {
  // Found by local search (k = 2, r = 1, s = 1/2: two pairs, ONE Breaker point in the pairing
  // phase, so the survivor bound is 2 - floor(1/2) = 2): earlier Breaker points were
  // placed so that, in the first accepted direction, one sat in a candidate region.
  const GENES: readonly (readonly { x: number; y: number }[])[] = [
    [{ x: 10, y: -28 }, { x: 35, y: -23 }, { x: 16, y: -167 }, { x: 8, y: -31 }],
    [{ x: 12, y: -26 }, { x: 35, y: -23 }, { x: 16, y: -167 }, { x: 8, y: -31 }],
    [{ x: 12, y: -26 }, { x: 35, y: -23 }, { x: 26, y: -119 }, { x: 7, y: -32 }],
    [{ x: 9, y: -11 }, { x: 35, y: -23 }, { x: 26, y: -119 }, { x: 7, y: -32 }],
  ];
  for (const [gi, gene] of GENES.entries()) {
    it(`gene ${gi}: the delivered strips reach the lower bound the ledger reports`, () => {
      const seen: Seen = { oldInside: 0, unitsAndBound: [0, 0] };
      const res = runKStrip(2, 1, shadowPolicy(gene), undefined, {
        variant: "bichromatic",
        s: Rat.fromString("1/2"),
        trace: (e: TraceEvent) => {
          if (e.kind === "phase-end" && e.phase === "bichromatic-pairing" && e.ledger !== null) {
            const inside = e.regions.reduce((a, r) => a + r.interiorBreakers + r.boundary, 0);
            seen.oldInside = inside - e.ledger.breakerUsed;
            seen.unitsAndBound = [e.ledger.units.length, e.ledger.guaranteedSurvivors];
          }
        },
      });
      expect(res.status, res.message).toBe("completed");
      // no point of an earlier phase lies in any final candidate
      expect(seen.oldInside).toBeLessThanOrEqual(0);
      // the reported lower bound is attained (it was 2 against 1 delivered strip before the fix)
      expect(res.claims.length).toBeGreaterThanOrEqual(seen.unitsAndBound[1]);
    });
  }

  it("random shadow play: no earlier Breaker point is ever inside a final candidate", () => {
    const rng = new Prng(11);
    for (let seed = 0; seed < 400; seed += 1) {
      const gene = [0, 1, 2, 3].map(() => ({ x: Number(rng.below(160n)), y: -Number(rng.below(700n)) }));
      let oldInside = 0;
      let bound = 0;
      const res = runKStrip(2, 1, shadowPolicy(gene), undefined, {
        variant: "bichromatic",
        s: Rat.fromString(seed % 2 === 0 ? "1/2" : "1"),
        trace: (e: TraceEvent) => {
          if (e.kind === "phase-end" && e.phase === "bichromatic-pairing" && e.ledger !== null) {
            oldInside = e.regions.reduce((a, r) => a + r.interiorBreakers + r.boundary, 0) - e.ledger.breakerUsed;
            bound = e.ledger.guaranteedSurvivors;
          }
        },
      });
      expect(res.status, `seed ${seed}: ${res.message}`).toBe("completed");
      expect(oldInside, `seed ${seed}`).toBeLessThanOrEqual(0);
      expect(res.claims.length, `seed ${seed}`).toBeGreaterThanOrEqual(bound);
    }
  });
});
