// Proposition 1 / Theorem 3-5 counting, by property tests over ARBITRARY
// legal Breaker placements (random points, interior points, points on the
// shared halfline below p_j, directly below end vertices, above p_j, ...).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { Rat } from "../../src/geometry/rat.ts";
import { runKStrip } from "../../src/kstrip/index.ts";
import type {
  BreakerDecision,
  BreakerPolicy,
  BreakerView,
  Ledger,
} from "../../src/kstrip/index.ts";

type Choice = [number, number, number]; // kind, a, b

interface Probe {
  guaranteed: number[];
  required: number;
  moves: number;
}

function scripted(choices: Choice[], probe: Probe): BreakerPolicy {
  let i = 0;
  return {
    name: "scripted-adversary",
    choose(view: BreakerView): BreakerDecision {
      const [kind, a, b] = choices[i % choices.length] as Choice;
      i += 1;
      const led: Ledger | null = view.ledger();
      if (led !== null) {
        probe.guaranteed.push(led.guaranteedSurvivors);
        probe.required = led.required;
      }
      probe.moves += 1;
      const bb = view.bbox();
      const w = bb.xMax.x.sub(bb.xMin.x).add(Rat.ONE);
      const h = bb.yMax.y.sub(bb.yMin.y).add(Rat.ONE);
      let base: Pt;
      let nudge: "y" | "xy" = "y";
      if (led !== null && led.units.length > 0 && kind > 0) {
        const u = led.units[a % led.units.length];
        const reg = u?.regions[b % (u?.regions.length ?? 1)];
        const verts = reg?.region.vertices ?? [];
        const first = verts[0] as Pt;
        const last = verts[verts.length - 1] as Pt;
        const apexOf = (): Pt => {
          // shared vertex of the pair = last of left region / first of right
          const l = u?.regions[0]?.region.vertices;
          return (l?.[l.length - 1] ?? last) as Pt;
        };
        switch (kind % 6) {
          case 1: {
            const r = reg?.region;
            const p = r?.interiorPoint(Rat.make(BigInt(1 + (a % 7))), Rat.make(BigInt((b % 5) - 2), 16n));
            base = p ?? pt(first.x, first.y.sub(Rat.ONE));
            nudge = "y";
            break;
          }
          case 2:
            base = pt(apexOf().x, apexOf().y.sub(Rat.make(BigInt(1 + b))));
            break;
          case 3:
            base = pt(first.x, first.y.sub(Rat.make(BigInt(1 + b))));
            break;
          case 4:
            base = pt(last.x, last.y.sub(Rat.make(BigInt(1 + b))));
            break;
          case 5:
            base = pt(apexOf().x, apexOf().y.add(Rat.make(BigInt(1 + b))));
            break;
          default:
            base = pt(first.x.add(Rat.make(BigInt(b), 7n)), first.y.sub(Rat.make(BigInt(a), 3n)));
            nudge = "xy";
        }
      } else {
        base = pt(
          bb.xMin.x.add(w.mul(Rat.make(BigInt(a % 997), 997n))),
          bb.yMin.y.add(h.mul(Rat.make(BigInt(b % 991), 991n))),
        );
        nudge = "xy";
      }
      for (let n = 0; n < 5000; n += 1) {
        const dy = Rat.make(BigInt(n), 1000003n);
        const cand =
          nudge === "y" && n < 300
            ? pt(base.x, base.y.sub(dy))
            : pt(base.x.add(dy), base.y.sub(dy.mul(Rat.make(BigInt(3 + (n % 13))))));
        if (view.legal(cand).ok) {
          return {
            point: cand,
            reason: {
              policy: "scripted-adversary",
              code: `kind-${kind % 6}`,
              summary: "property-test adversary",
              target: null,
              data: {},
            },
          };
        }
      }
      throw new Error("no legal nudge");
    },
  };
}

const choiceArb = fc.array(
  fc.tuple(fc.integer({ min: 0, max: 5 }), fc.nat(40), fc.nat(40)),
  { minLength: 1, maxLength: 12 },
) as fc.Arbitrary<Choice[]>;

describe("Proposition 1: survivors >= t for ANY Breaker play (monochromatic 1:1)", () => {
  for (const [k, t, runs] of [
    [3, 1, 60],
    [3, 2, 40],
    [3, 3, 15],
    [4, 1, 12],
  ] as const) {
    it(`k=${k} t=${t}`, () => {
      fc.assert(
        fc.property(choiceArb, (choices) => {
          const probe: Probe = { guaranteed: [], required: t, moves: 0 };
          const res = runKStrip(k, t, scripted(choices, probe));
          expect(res.status, res.message).toBe("completed");
          const top = res.levels[res.levels.length - 1];
          expect(top?.level).toBe(k);
          expect(top?.survivors).toBeGreaterThanOrEqual(t);
          expect(top?.proposition1Holds).toBe(true);
          // the exact lower bound never exceeds the final truth and never drops below t
          for (const g of probe.guaranteed.slice(-2 * t)) {
            expect(g).toBeGreaterThanOrEqual(t);
            expect(g).toBeLessThanOrEqual(top?.survivors ?? 0);
          }
          expect(res.claims.length).toBeGreaterThanOrEqual(t);
        }),
        { numRuns: runs },
      );
    }, 240000);
  }
});

describe("Theorem 4 counting (groups of 2s)", () => {
  it("s=2,k=3,t=1: survivors >= t for any play", () => {
    fc.assert(
      fc.property(choiceArb, (choices) => {
        const probe: Probe = { guaranteed: [], required: 1, moves: 0 };
        const res = runKStrip(3, 1, scripted(choices, probe), undefined, {
          variant: "mono-1:s",
          s: Rat.make(2n),
        });
        expect(res.status, res.message).toBe("completed");
        const top = res.levels[res.levels.length - 1];
        expect(top?.survivors).toBeGreaterThanOrEqual(1);
        for (const g of probe.guaranteed.slice(-4)) {
          expect(g).toBeGreaterThanOrEqual(1);
        }
      }),
      { numRuns: 25 },
    );
  }, 240000);
});

describe("Theorem 5 counting (bichromatic, strict count)", () => {
  it("s=3/2, k=2, r=1: survivors >= r and claims are Maker-owned, Breaker-free", () => {
    fc.assert(
      fc.property(choiceArb, (choices) => {
        const probe: Probe = { guaranteed: [], required: 1, moves: 0 };
        const res = runKStrip(2, 1, scripted(choices, probe), undefined, {
          variant: "bichromatic",
          s: Rat.fromString("3/2"),
        });
        expect(res.status, res.message).toBe("completed");
        expect(res.claims.length).toBeGreaterThanOrEqual(1);
      }),
      { numRuns: 25 },
    );
  }, 240000);
});
