// Soundness of the survivor lower bound at EVERY intermediate state: Breaker's
// pairing-phase moves are enumerated over a grid of cells (interior of each
// candidate, the shared halfline, below each end vertex, above the apex, far
// away) and earlier-phase Breaker points over a grid of "shadow" offsets. For
// every full play, every ledger state of the phase must satisfy
//   guaranteedSurvivors <= number of units that really deliver a strip,
// the latter recounted independently with the exact predicate isStrip on the
// final board (bichromatic) or taken from the verified claims (monochromatic).
import { describe, expect, it } from "vitest";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { Rat } from "../../src/geometry/rat.ts";
import { interiorLegal, isStrip, parallel, runKStrip, StripRegion } from "../../src/kstrip/index.ts";
import type { BreakerPolicy, BreakerView, RunOptions, TraceEvent } from "../../src/kstrip/index.ts";

const R = (n: number, d = 1): Rat => Rat.make(BigInt(n), BigInt(d));
const LABELS = ["iL", "iR", "shared", "belowL", "belowR", "above"] as const;
type Label = (typeof LABELS)[number] | "far";
const BASE_GRID = [
  { u: R(1, 2), w: R(3) },
  { u: R(2), w: R(9) },
  { u: R(-1, 2), w: R(1) },
  { u: R(3), w: R(30) },
];

// On an exact vertical line a second Breaker point is never legal (collinear with the
// vertex above it): the cell then degrades to a far move.
function legalNear(view: BreakerView, x: Rat, y: Rat, vertical: boolean): Pt {
  for (let j = 0; j < 400; j += 1) {
    const p = vertical ? pt(x, y.sub(R(j, 17))) : pt(x.add(R(j, 1013)), y.sub(R(j, 7919)));
    if (view.legal(p).ok) return p;
  }
  if (vertical) {
    return cellPoint(view, "far", 0);
  }
  throw new Error("no legal point");
}

function cellPoint(view: BreakerView, label: Label, unit: number): Pt {
  const led = view.ledger();
  const u = led === null ? undefined : led.units[unit];
  if (u === undefined || label === "far") {
    const bb = view.bbox();
    return legalNear(view, bb.xMax.x.add(R(100)), bb.yMin.y.sub(R(1000)), false);
  }
  const left = (u.regions[0] as { region: StripRegion }).region;
  const right = (u.regions[1] as { region: StripRegion }).region;
  const apex = left.vertices[left.vertices.length - 1] as Pt;
  switch (label) {
    case "iL":
      return interiorLegal(left, view) ?? cellPoint(view, "far", 0);
    case "iR":
      return interiorLegal(right, view) ?? cellPoint(view, "far", 0);
    case "shared":
      return legalNear(view, apex.x, apex.y.sub(R(2)), true);
    case "belowL":
      return legalNear(view, (left.vertices[0] as Pt).x, (left.vertices[0] as Pt).y.sub(R(3)), true);
    case "belowR":
      return legalNear(view, (right.vertices[right.vertices.length - 1] as Pt).x, (right.vertices[right.vertices.length - 1] as Pt).y.sub(R(3)), true);
    case "above":
      return legalNear(view, apex.x, apex.y.add(R(5)), true);
  }
}

function policy(baseChoice: readonly number[], moves: readonly { label: Label; unit: number }[]): BreakerPolicy {
  let b = 0;
  let m = 0;
  return {
    name: "grid",
    choose(view: BreakerView) {
      const reason = { policy: "grid", code: "g", summary: "g", target: null, data: {} };
      if (view.phase === "bichromatic-base" || view.phase === "base") {
        const g = BASE_GRID[(baseChoice[b % baseChoice.length] as number) % BASE_GRID.length] as { u: Rat; w: Rat };
        b += 1;
        let mk: Pt | undefined;
        for (const o of view.points) if (o.owner === "maker") mk = o.pt;
        const at = mk ?? pt(R(0), R(0));
        return { point: legalNear(view, at.x.add(g.u), at.y.sub(g.w), false), reason };
      }
      const mv = moves[m % moves.length] as { label: Label; unit: number };
      m += 1;
      return { point: cellPoint(view, mv.label, mv.unit), reason };
    },
  };
}

interface Outcome {
  bounds: number[];
  delivered: number;
  independent: number;
  status: string;
}

function play(k: number, r: number, opts: RunOptions, pol: BreakerPolicy): Outcome {
  const bounds: number[] = [];
  let dir = { x: R(0), y: R(-1) };
  let plans: readonly { strips: readonly (readonly Pt[])[] }[] = [];
  const res = runKStrip(k, r, pol, undefined, {
    ...opts,
    trace: (e: TraceEvent) => {
      const top = k;
      if (e.kind === "phase-start" && e.level === top) plans = e.plans;
      if ((e.kind === "ledger" || e.kind === "phase-end") && e.level === top && e.ledger !== null) bounds.push(e.ledger.guaranteedSurvivors);
      if (e.kind === "phase-end" && e.level === top) dir = e.dir;
    },
  });
  let independent = res.claims.length;
  if (opts.variant === "bichromatic" && res.status === "completed") {
    const S = res.points.map((p) => p.pt);
    const apexes = res.log.filter((e) => e.phase === "bichromatic-pairing" && e.level === k && e.kind === "apex").map((e) => e.pt);
    const regions: StripRegion[] = [];
    plans.forEach((pl, j) => {
      const ap = apexes[j] as Pt;
      const cands = [[...(pl.strips[0] as Pt[]), ap], [ap, ...(pl.strips[1] as Pt[])]];
      const live = cands.find((c) => isStrip(c, S, dir).ok);
      if (live !== undefined) {
        const reg = StripRegion.make(live, dir);
        if (reg.ok) regions.push(reg.region);
      }
    });
    for (let i = 1; i < regions.length; i += 1) expect(parallel(regions[i - 1] as StripRegion, regions[i] as StripRegion).ok).toBe(true);
    independent = regions.length;
  }
  return { bounds, delivered: res.claims.length, independent, status: res.status };
}

function check(o: Outcome, tag: string): void {
  expect(o.status, tag).toBe("completed");
  expect(o.delivered, tag).toBe(o.independent);
  for (const b of o.bounds) {
    expect(b, `${tag}: bound ${b} vs ${o.independent}`).toBeLessThanOrEqual(o.independent);
  }
}

function sequences(units: number, len: number): { label: Label; unit: number }[][] {
  const cells: { label: Label; unit: number }[] = [{ label: "far", unit: 0 }];
  for (let u = 0; u < units; u += 1) for (const l of LABELS) cells.push({ label: l, unit: u });
  let acc: { label: Label; unit: number }[][] = [[]];
  for (let i = 0; i < len; i += 1) acc = acc.flatMap((a) => cells.map((c) => [...a, c]));
  return acc;
}

describe("lower bound vs true survivors at every intermediate state", () => {
  it("bichromatic k=2 r=1 s=1/2 (2 pairs, 1 Breaker move): every cell x every earlier-phase placement", () => {
    let n = 0;
    for (const bc of [[0, 0], [0, 1], [1, 2], [2, 3], [3, 0], [1, 1]]) {
      for (const seq of sequences(2, 1)) {
        check(play(2, 1, { variant: "bichromatic", s: Rat.fromString("1/2") }, policy(bc, seq)), `s=1/2 ${bc} ${JSON.stringify(seq)}`);
        n += 1;
      }
    }
    expect(n).toBe(78);
  });

  it("bichromatic k=2 r=1 s=1 (2 pairs, 2 Breaker moves): every ordered pair of cells", () => {
    let n = 0;
    for (const bc of [[0, 1, 2, 3], [3, 3, 0, 0], [2, 2, 2, 2], [1, 0, 3, 2]]) {
      for (const seq of sequences(2, 2)) {
        check(play(2, 1, { variant: "bichromatic", s: Rat.ONE }, policy(bc, seq)), `s=1 ${bc} ${JSON.stringify(seq)}`);
        n += 1;
      }
    }
    expect(n).toBe(4 * 169);
  });

  it("bichromatic k=3 r=1 s=1: sampled adversarial sequences over the same cells", () => {
    const seqs = sequences(2, 2);
    for (const bc of [[0, 1, 2, 3], [3, 0, 0, 1]]) {
      for (const seq of seqs.filter((_, i) => i % 7 === 0)) {
        check(play(3, 1, { variant: "bichromatic", s: Rat.ONE }, policy(bc, seq)), `k3 ${bc} ${JSON.stringify(seq)}`);
      }
    }
  }, 300000);

  it("monochromatic 1:1 k=3 t=1 (adoption ledger): every ordered pair of cells", () => {
    for (const seq of sequences(2, 2)) {
      check(play(3, 1, {}, policy([0], seq)), `mono ${JSON.stringify(seq)}`);
    }
  });
});
