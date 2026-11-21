// Independent-oracle cross-check (scripts/audit/kstrip_oracle.py): strip
// membership (Definition 2, evaluated via a truncated convex hull) and the
// extension criterion (P + {q} is a strip) against src/kstrip, for general
// directions v (vertical, tilted, upward).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { Rat } from "../../src/geometry/rat.ts";
import { extendStrip, isStrip } from "../../src/kstrip/index.ts";

interface Case {
  P: number[];
  expectStrip: boolean;
  extensions: { q: number; expects: boolean }[];
}
interface Inst {
  v: [string, string];
  S: [string, string][];
  cases: Case[];
}
const fx = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/strips.json", import.meta.url)), "utf8"),
) as { positives: Record<string, number>; instances: Inst[] };

function load(inst: Inst) {
  const v = { x: Rat.fromString(inst.v[0]), y: Rat.fromString(inst.v[1]) };
  const S: Pt[] = inst.S.map(([x, y]) => pt(Rat.fromString(x), Rat.fromString(y)));
  return { v, S };
}

describe("oracle cross-check", () => {
  it("fixture has substantial positives for k=1..4", () => {
    for (const k of ["1", "2", "3", "4"]) {
      expect(fx.positives[k] ?? 0).toBeGreaterThan(30);
    }
  });

  it("isStrip agrees with the hull-truncation oracle on every case", () => {
    let n = 0;
    let pos = 0;
    for (const inst of fx.instances) {
      const { v, S } = load(inst);
      for (const c of inst.cases) {
        const P = c.P.map((i) => S[i] as Pt);
        const r = isStrip(P, S, v);
        expect(r.ok, JSON.stringify(inst.v) + JSON.stringify(c.P)).toBe(c.expectStrip);
        n += 1;
        if (c.expectStrip) pos += 1;
      }
    }
    expect(n).toBeGreaterThan(1000);
    expect(pos).toBeGreaterThan(300);
  });

  it("extendStrip: cone 'yes' is sound; a cone 'no' carries the exact verdict (k>=2)", () => {
    let checked = 0;
    let positives = 0;
    let coneNotNecessary = 0;
    for (const inst of fx.instances) {
      const { v, S } = load(inst);
      for (const c of inst.cases) {
        const P = c.P.map((i) => S[i] as Pt);
        for (const e of c.extensions) {
          const r = extendStrip(P, S, S[e.q] as Pt, v);
          if (P.length >= 2) {
            const verdict = r.ok ? true : r.reason.stillStrip;
            expect(verdict, JSON.stringify(inst.v) + JSON.stringify(c.P) + e.q).toBe(
              e.expects,
            );
            checked += 1;
            if (e.expects) positives += 1;
            if (!r.ok && e.expects) coneNotNecessary += 1;
          } else if (r.ok) {
            // k = 1 uses the conservative horizontal convention: soundness only
            expect(e.expects).toBe(true);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(300);
    expect(positives).toBeGreaterThan(80);
    // the cone condition is sufficient, not necessary: witnessed on random data
    expect(coneNotNecessary).toBeGreaterThan(0);
  });
});
