// tests/audit/oracle.test.ts — differential test of src/geometry against an
// INDEPENDENT Python oracle (scripts/audit/oracle.py, fractions.Fraction;
// fixtures from scripts/audit/gen_fixtures.py). Shares no code with src/.
//
// Regenerate fixtures:  python -I scripts/audit/gen_fixtures.py
// Every mismatch is also written (input / expected / actual) to
// scripts/audit/out/oracle_test_results.json so results survive output
// suppression.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Rat } from "../../src/geometry/rat.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { gp, insideTriangleStrict, orient } from "../../src/geometry/predicates.ts";
import { convexPosition, hull } from "../../src/geometry/hull.ts";
import { analyzeHoles, findKHoles, findNewKHoles, isKHole } from "../../src/geometry/holes.ts";
import type { IdPt } from "../../src/geometry/holes.ts";
import { insideConvex } from "../../src/geometry/poly.ts";

const fx = (name: string): unknown =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8"),
  );
const OUT_FILE = fileURLToPath(
  new URL("../../scripts/audit/out/oracle_test_results.json", import.meta.url),
);

type Wire = [string, string];
const P = (w: readonly string[]): Pt => ({
  x: Rat.fromString(w[0] as string),
  y: Rat.fromString(w[1] as string),
});
const ptStr = (p: Pt): string => `${p.x.toString()},${p.y.toString()}`;
const wStr = (w: readonly string[]): string => `${w[0]},${w[1]}`;

interface Mismatch {
  section: string;
  input: unknown;
  expected: unknown;
  actual: unknown;
}
const results: Record<string, { checked: number; mismatches: Mismatch[] }> = {};
function sec(name: string): { checked: number; mismatches: Mismatch[] } {
  results[name] ??= { checked: 0, mismatches: [] };
  return results[name] as { checked: number; mismatches: Mismatch[] };
}
function check(
  section: string,
  input: unknown,
  expected: unknown,
  actual: unknown,
): void {
  const s = sec(section);
  s.checked += 1;
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    s.mismatches.push({ section, input, expected, actual });
  }
}
function attempt<T>(f: () => T): { ok: true; v: T } | { ok: false; err: string } {
  try {
    return { ok: true, v: f() };
  } catch (e) {
    return { ok: false, err: e instanceof Error ? e.message : String(e) };
  }
}
function done(section: string): void {
  const s = sec(section);
  // Mismatches are listed in the results file; fail the test with a short head.
  expect(s.mismatches.slice(0, 3), `${section}: ${s.mismatches.length} mismatches`).toEqual([]);
  expect(s.checked).toBeGreaterThan(0);
}

afterAll(() => {
  mkdirSync(dirname(OUT_FILE), { recursive: true });
  const summary: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(results)) {
    summary[k] = { checked: v.checked, mismatch_count: v.mismatches.length };
  }
  writeFileSync(
    OUT_FILE,
    JSON.stringify({ summary, mismatches: Object.values(results).flatMap((v) => v.mismatches.slice(0, 50)), probes }, null, 1),
  );
});

const probes: Record<string, string> = {};

// ------------------------------------------------------------------- Rat

interface RatFx {
  parse: { in: string; out: string | null }[];
  make: { n: string; d: string; out: string | null }[];
  ops: { op: string; a: string; b: string | null; out: string | null }[];
}
describe("Rat vs oracle", () => {
  const rf = fx("rat.json") as RatFx;

  it("fromString: canonical output, expected errors", () => {
    for (const c of rf.parse) {
      const r = attempt(() => Rat.fromString(c.in));
      const actual = r.ok ? r.v.toString() : null;
      check("rat.parse", c.in, c.out, actual);
      if (r.ok) {
        // normalisation invariant + JSON round trip
        check("rat.parse.invariant", c.in, true, r.v.d > 0n);
        const rt = Rat.fromJSON(r.v.toJSON());
        check("rat.parse.roundtrip", c.in, r.v.toString(), rt.toString());
        check("rat.parse.jsonstring", c.in, c.out, JSON.parse(JSON.stringify({ v: r.v })).v);
      }
    }
    done("rat.parse");
    done("rat.parse.invariant");
    done("rat.parse.roundtrip");
    done("rat.parse.jsonstring");
  });

  it("make(n,d): normalisation + zero denominator", () => {
    for (const c of rf.make) {
      const r = attempt(() => Rat.make(BigInt(c.n), BigInt(c.d)));
      check("rat.make", [c.n, c.d], c.out, r.ok ? r.v.toString() : null);
    }
    done("rat.make");
  });

  it("add/sub/mul/div/cmp/neg/abs/sign", () => {
    for (const c of rf.ops) {
      const a = Rat.fromString(c.a);
      const b = c.b === null ? null : Rat.fromString(c.b);
      const r = attempt((): string => {
        switch (c.op) {
          case "add": return a.add(b as Rat).toString();
          case "sub": return a.sub(b as Rat).toString();
          case "mul": return a.mul(b as Rat).toString();
          case "div": return a.div(b as Rat).toString();
          case "cmp": return String(a.cmp(b as Rat));
          case "neg": return a.neg().toString();
          case "abs": return a.abs().toString();
          case "sign": return String(a.sign());
          default: throw new Error(`unknown op ${c.op}`);
        }
      });
      check(`rat.op.${c.op}`, [c.op, c.a, c.b], c.out, r.ok ? r.v : null);
      if (c.op === "cmp" && b !== null) {
        const eq = a.equals(b);
        check("rat.equals", [c.a, c.b], c.out === "0", eq);
        check("rat.cmp.antisym", [c.a, c.b], -Number(c.out), b.cmp(a));
      }
      if (c.op === "sign") {
        check("rat.isZero/isNeg", c.a, [c.out === "0", c.out === "-1"], [a.isZero(), a.isNeg()]);
      }
    }
    for (const k of Object.keys(results).filter((k) => k.startsWith("rat.op.") || k === "rat.equals" || k === "rat.cmp.antisym" || k === "rat.isZero/isNeg")) {
      done(k);
    }
  });

  it("informational probes (no assertion): inputs the oracle spec does not decide", () => {
    for (const s of ["+3", "+3/7", " 3/7 ", "\t3/7\n", "3/+7", "−3/−7", "1/2 ", "​3", "٣", "3/7−"]) {
      const r = attempt(() => Rat.fromString(s));
      probes[JSON.stringify(s)] = r.ok ? r.v.toString() : `THROWS: ${r.err}`;
    }
  });
});

// ---------------------------------------------------------------- orient

interface OrientFx {
  cases: { cat: string; a: Wire; b: Wire; c: Wire; o: number }[];
}
describe("orient vs oracle", () => {
  const of = fx("orient.json") as OrientFx;
  it("orientation incl. collinear, near-collinear, huge", () => {
    for (const c of of.cases) {
      const a = P(c.a);
      const b = P(c.b);
      const cc = P(c.c);
      check(`orient.${c.cat}`, [c.a, c.b, c.c], c.o, orient(a, b, cc));
      check("orient.swap-antisym", [c.a, c.b, c.c], -c.o, orient(b, a, cc));
      check("orient.cyclic", [c.a, c.b, c.c], c.o, orient(b, cc, a));
    }
    for (const k of Object.keys(results).filter((k) => k.startsWith("orient."))) {
      done(k);
    }
    expect(of.cases.length).toBeGreaterThan(500);
  });
});

// ------------------------------------------------------------ point sets

interface SetFx {
  name: string;
  n: number;
  pts: Wire[];
  distinct: boolean;
  gp: boolean;
  hull: Wire[];
  convex: boolean;
  holes?: Record<string, number[][]>;
  nonholes?: Record<string, number[][]>;
}
const sets = (fx("pointsets.json") as { sets: SetFx[] }).sets;

describe("hull / gp / convexPosition vs oracle", () => {
  it("all sets (incl. non-GP, duplicates, collinear, n<3)", () => {
    for (const s of sets) {
      const pts = s.pts.map(P);
      check("gp", s.name, s.gp, gp(pts));
      const h = hull(pts).map(ptStr);
      const eh = s.hull.map(wStr);
      check("hull.set", s.name, [...eh].sort(), [...h].sort());
      check("hull.ccw-order-from-lexmin", s.name, eh, h);
      check("convexPosition", s.name, s.convex, convexPosition(pts));
      // order independence of hull (reverse input)
      check("hull.reverse-input", s.name, eh, hull([...pts].reverse()).map(ptStr));
    }
    for (const k of ["gp", "hull.set", "hull.ccw-order-from-lexmin", "convexPosition", "hull.reverse-input"]) {
      done(k);
    }
    expect(sets.length).toBeGreaterThan(80);
    expect(sets.some((s) => !s.gp)).toBe(true);
    expect(sets.some((s) => !s.distinct)).toBe(true);
  });
});

const BIG = Number.MAX_SAFE_INTEGER;
describe("k-holes vs oracle (brute force, GP sets)", () => {
  const gpSets = sets.filter((s) => s.holes !== undefined);

  it("findKHoles exhaustive == oracle, k=3..6 (ids in CCW hull order)", () => {
    for (const s of gpSets) {
      const idpts: IdPt[] = s.pts.map((w, i) => ({ id: String(i), pt: P(w) }));
      for (const k of [3, 4, 5, 6]) {
        const exp = (s.holes as Record<string, number[][]>)[String(k)] as number[][];
        const an = findKHoles(idpts, k, { mode: "exhaustive", budget: BIG });
        const act =
          an.kind === "exhaustive" ? an.holes.map((h) => h.verts.map(Number)) : `kind=${an.kind}`;
        check(`holes.exhaustive.k${k}`, [s.name, k], exp, act);
        // first-witness
        const fw = findKHoles(idpts, k, { mode: "first-witness", budget: BIG });
        if (exp.length === 0) {
          check(`holes.witness.k${k}`, [s.name, k], "exhaustive-empty", fw.kind === "exhaustive" && fw.holes.length === 0 ? "exhaustive-empty" : fw.kind);
        } else {
          check(`holes.witness.k${k}`, [s.name, k], exp[0], fw.kind === "witness-only" ? fw.witness.verts.map(Number) : fw.kind);
        }
        // analyzeHoles (generous budget -> exhaustive path)
        const ah = analyzeHoles(idpts, k, { budget: 1e12 });
        check(`holes.analyze.k${k}`, [s.name, k], exp, ah.kind === "exhaustive" ? ah.holes.map((h) => h.verts.map(Number)) : `kind=${ah.kind}`);
        // findNewKHoles for last = n-1 and last = 0
        for (const last of [s.n - 1, 0]) {
          const nk = findNewKHoles(idpts, k, String(last));
          const want = exp.filter((h) => h.includes(last)).map((h) => [...h].sort((x, y) => x - y).join(","));
          const got = nk.holes.map((h) => h.verts.map(Number).sort((x, y) => x - y).join(","));
          check(`holes.new.k${k}`, [s.name, k, last], want.sort(), got.sort());
        }
      }
    }
    for (const k of Object.keys(results).filter((k) => k.startsWith("holes."))) {
      done(k);
    }
    expect(gpSets.length).toBeGreaterThan(60);
  }, 120_000);

  it("isKHole true on every oracle hole (shuffled order), false on sampled non-holes", () => {
    for (const s of gpSets) {
      const pts = s.pts.map(P);
      for (const k of [3, 4, 5, 6]) {
        const holes = (s.holes as Record<string, number[][]>)[String(k)] as number[][];
        for (const h of holes) {
          const subset = [...h].reverse().map((i) => pts[i] as Pt);
          check(`isKHole.true.k${k}`, [s.name, h], true, isKHole(subset, pts));
        }
        for (const nh of (s.nonholes as Record<string, number[][]>)[String(k)] ?? []) {
          const subset = [...nh].reverse().map((i) => pts[i] as Pt);
          check(`isKHole.false.k${k}`, [s.name, nh], false, isKHole(subset, pts));
        }
      }
    }
    for (const k of Object.keys(results).filter((k) => k.startsWith("isKHole."))) {
      done(k);
    }
  }, 120_000);
});

// --------------------------------------------------------------- polygon

interface PolyFx {
  cases: { poly: Wire[]; queries: { cat: string; q: Wire; strict: boolean; closed: boolean }[] }[];
}
describe("point in convex polygon vs oracle", () => {
  const pf = fx("polygon.json") as PolyFx;
  it("insideConvex strict/closed; insideTriangleStrict for triangles (both windings)", () => {
    let nq = 0;
    for (const c of pf.cases) {
      const poly = c.poly.map(P);
      for (const q of c.queries) {
        nq += 1;
        const qp = P(q.q);
        check(`poly.strict.${q.cat}`, [c.poly, q.q], q.strict, insideConvex(poly, qp, true));
        check(`poly.closed.${q.cat}`, [c.poly, q.q], q.closed, insideConvex(poly, qp, false));
        if (poly.length === 3) {
          const [a, b, d] = poly as [Pt, Pt, Pt];
          check("tri.strict", [c.poly, q.q], q.strict, insideTriangleStrict(a, b, d, qp));
          check("tri.strict.reversed", [c.poly, q.q], q.strict, insideTriangleStrict(a, d, b, qp));
        }
      }
    }
    for (const k of Object.keys(results).filter((k) => k.startsWith("poly.") || k.startsWith("tri."))) {
      done(k);
    }
    expect(nq).toBeGreaterThan(2000);
  });
});
