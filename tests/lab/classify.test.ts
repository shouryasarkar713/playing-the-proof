// tests/lab/classify.test.ts — the three-way classifier at every threshold
// boundary, against an INDEPENDENT table-driven oracle written from the
// papers' statements (explicit lambda table, no shared formula code).
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Rat } from "../../src/geometry/rat.ts";
import { classify, nearestNeighbours, theoremCitations, thm10MinK, validateConfig } from "../../src/lab/classify.ts";
import type { LabConfig, LabStatus } from "../../src/lab/types.ts";
import { ENCODING_REGISTRY } from "../../src/lab/encodings.ts";
import { parseBias } from "../../src/lab/bias.ts";

function B(s: string): Rat {
  const r = parseBias(s);
  if (r === null) {
    throw new Error(`bad bias ${s}`);
  }
  return r;
}

function cfg(
  model: LabConfig["model"],
  rule: LabConfig["rule"],
  k: number,
  bias: string,
  extra: Partial<LabConfig> = {},
): LabConfig {
  return { model, rule, k, bias: B(bias), encodingId: null, structures: 1, ...extra };
}

// ---- independent oracle (from the paper statements) ----
// DZ Thm 10 "In particular": k >= 17 for lambda = 3; >= 11 for lambda in {4,5}; >= 8 for lambda >= 6.
const ORACLE_MIN_K: Record<number, number> = { 3: 17, 4: 11, 5: 11 };

function oracleBacked(c: LabConfig): boolean {
  const num = c.bias.n;
  const den = c.bias.d;
  const lt = (a: number, b: number): boolean => num * BigInt(b) < BigInt(a) * den; // s < a/b with b=1 use
  void lt;
  const sLess = (x: bigint): boolean => num < x * den; // s < x
  const sIsInt = den === 1n;
  if (c.rule === "monochromatic") {
    if (c.k <= 6) {
      return true;
    }
    return c.model === "online"; // Thm 4 (s>=1), DV Thm 3 (0<s<1), reduction at s=0
  }
  if (c.model === "one-round") {
    return true; // Thm 13 for s<2, Prop 7 / intro for s>=2
  }
  if (sLess(2n)) {
    return true; // Thm 5
  }
  if (!sIsInt) {
    return false;
  }
  const s = Number(num);
  if (s >= 12 && c.k >= 8) {
    return true; // Thm 8 (s=12) / abstract "12 or more"
  }
  if (s >= 6 && s % 2 === 0) {
    const lam = s / 2;
    const need = lam >= 6 ? 8 : (ORACLE_MIN_K[lam] as number);
    return c.k >= need;
  }
  return false;
}

function oracleStatus(c: LabConfig): LabStatus {
  if (oracleBacked(c)) {
    return "THEOREM_BACKED";
  }
  return c.k <= 8 && c.bias.cmp(Rat.make(16n)) <= 0 ? "EXPERIMENTAL" : "NOT_COVERED";
}

const BIASES = [
  "0", "1/2", "99/100", "1", "101/100", "3/2", "199/100", "1999999/1000000", "2", "2000001/1000000",
  "21/10", "5/2", "3", "4", "5", "11/2", "6", "13/2", "7", "8", "9", "10", "11", "23/2", "12", "12.5", "13",
  "14", "15", "16", "17", "20", "24", "32",
];

describe("grid against the independent oracle", () => {
  for (const model of ["online", "one-round"] as const) {
    for (const rule of ["monochromatic", "bichromatic"] as const) {
      it(`${model} / ${rule}: every k in 3..12 and every probe bias`, () => {
        for (let k = 3; k <= 12; k += 1) {
          for (const b of BIASES) {
            const c = cfg(model, rule, k, b);
            expect(classify(c).status, `${model} ${rule} k=${k} s=${b}`).toBe(oracleStatus(c));
          }
        }
      });
    }
  }
});

describe("thresholds, spelled out", () => {
  const st = (c: LabConfig): LabStatus => classify(c).status;

  it("s = 1: monochromatic online is backed by DZ-T3 and DZ-T4, for every k", () => {
    for (let k = 3; k <= 12; k += 1) {
      const r = classify(cfg("online", "monochromatic", k, "1"));
      expect(r.status).toBe("THEOREM_BACKED");
      const ids = r.citations.map((c) => c.rowId);
      expect(ids).toContain("DZ-T3");
      expect(ids).toContain("DZ-T4");
    }
  });

  it("monochromatic below 1: DV-T3 (s > 0) and the reduction (s = 0)", () => {
    expect(classify(cfg("online", "monochromatic", 9, "99/100")).citations.map((c) => c.rowId)).toContain("DV-T3");
    expect(classify(cfg("online", "monochromatic", 9, "0")).citations.map((c) => c.rowId)).toEqual(["DER-MONO-S0"]);
  });

  it("monochromatic one-round: k <= 6 backed (derived), k = 7, 8 experimental, k = 9 not covered", () => {
    expect(st(cfg("one-round", "monochromatic", 6, "40"))).toBe("THEOREM_BACKED");
    expect(classify(cfg("one-round", "monochromatic", 6, "40")).basis).toBe("derived");
    expect(st(cfg("one-round", "monochromatic", 7, "2"))).toBe("EXPERIMENTAL");
    expect(st(cfg("one-round", "monochromatic", 8, "2"))).toBe("EXPERIMENTAL");
    expect(st(cfg("one-round", "monochromatic", 9, "2"))).toBe("NOT_COVERED");
  });

  it("bichromatic online: 2-eps backed, exactly 2 experimental", () => {
    expect(st(cfg("online", "bichromatic", 7, "1999999/1000000"))).toBe("THEOREM_BACKED");
    expect(st(cfg("online", "bichromatic", 7, "199/100"))).toBe("THEOREM_BACKED");
    expect(st(cfg("online", "bichromatic", 7, "2"))).toBe("EXPERIMENTAL");
    expect(st(cfg("online", "bichromatic", 7, "2000001/1000000"))).toBe("EXPERIMENTAL");
    expect(st(cfg("online", "bichromatic", 3, "2"))).toBe("EXPERIMENTAL");
  });

  it("the proposal's mock-up (online, bichromatic, 1:2, k = 7) is EXPERIMENTAL, while one-round is backed", () => {
    expect(st(cfg("online", "bichromatic", 7, "2"))).toBe("EXPERIMENTAL");
    expect(st(cfg("one-round", "bichromatic", 7, "2"))).toBe("THEOREM_BACKED");
  });

  it("one-round bichromatic: backed on both sides of 2 for every k", () => {
    for (let k = 3; k <= 9; k += 1) {
      for (const b of ["0", "1", "199/100", "2", "5/2", "12", "100"]) {
        expect(st(cfg("one-round", "bichromatic", k, b))).toBe("THEOREM_BACKED");
      }
    }
    const lo = classify(cfg("one-round", "bichromatic", 5, "3/2"));
    expect(lo.citations.map((c) => c.rowId)).toEqual(["DZ-T13"]);
    const eq = classify(cfg("one-round", "bichromatic", 5, "2"));
    expect(eq.citations[0]).toMatchObject({ rowId: "DZ-P7", basis: "proved" });
    const hi = classify(cfg("one-round", "bichromatic", 5, "3"));
    expect(hi.citations[0]).toMatchObject({ rowId: "DZ-P7", basis: "stated" });
  });

  it("1:12 and k = 8 is the Thm 8 corner; k = 7 or bias just below/above are not", () => {
    const corner = classify(cfg("online", "bichromatic", 8, "12"));
    expect(corner.status).toBe("THEOREM_BACKED");
    expect(corner.citations.map((c) => `${c.rowId}:${c.basis}`)).toContain("DZ-T8:proved");
    expect(st(cfg("online", "bichromatic", 7, "12"))).toBe("EXPERIMENTAL");
    expect(st(cfg("online", "bichromatic", 8, "11"))).toBe("EXPERIMENTAL");
    expect(st(cfg("online", "bichromatic", 8, "23/2"))).toBe("EXPERIMENTAL");
    expect(st(cfg("online", "bichromatic", 8, "25/2"))).toBe("EXPERIMENTAL"); // non-integer > 12 is not inferred
    expect(classify(cfg("online", "bichromatic", 8, "13")).citations[0]).toMatchObject({ rowId: "DZ-T8", basis: "stated" });
  });

  it("lambda trade-off: both sides of every k-threshold", () => {
    const table: Array<[string, number]> = [["6", 17], ["8", 11], ["10", 11], ["12", 8], ["14", 8], ["16", 8], ["20", 8]];
    for (const [s, kmin] of table) {
      expect(st(cfg("online", "bichromatic", kmin, s)), `s=${s} k=${kmin}`).toBe("THEOREM_BACKED");
      expect(st(cfg("online", "bichromatic", kmin - 1, s)), `s=${s} k=${kmin - 1}`).not.toBe("THEOREM_BACKED");
    }
    // basis honesty: lambda <= 6 proved; lambda >= 7 only stated
    expect(classify(cfg("online", "bichromatic", 17, "6")).citations[0]).toMatchObject({ rowId: "DZ-T10", basis: "proved" });
    const t10 = classify(cfg("online", "bichromatic", 8, "14")).citations.find((c) => c.rowId === "DZ-T10");
    expect(t10?.basis).toBe("stated");
    expect(classify(cfg("online", "bichromatic", 8, "14")).basis).toBe("stated");
  });

  it("odd / non-lambda biases are not inferred from monotonicity (s in [2,12))", () => {
    for (const s of ["2", "5/2", "3", "4", "5", "7", "9", "11", "11.99"]) {
      for (const k of [8, 9, 12, 17, 30]) {
        const r = classify(cfg("online", "bichromatic", k, s));
        // only integer even s in {6,8,10} with k above threshold may be backed
        const allowed = ["6", "8", "10"].includes(s) && k >= (s === "6" ? 17 : 11);
        expect(r.status === "THEOREM_BACKED", `s=${s} k=${k}`).toBe(allowed);
      }
    }
  });

  it("k = 2..9 coverage of the online bichromatic 1:2 column", () => {
    const out = [2, 3, 4, 5, 6, 7, 8, 9].map((k) => st(cfg("online", "bichromatic", k, "2")));
    expect(out).toEqual([
      "NOT_COVERED", // k = 2 invalid
      "EXPERIMENTAL",
      "EXPERIMENTAL",
      "EXPERIMENTAL",
      "EXPERIMENTAL",
      "EXPERIMENTAL",
      "EXPERIMENTAL",
      "NOT_COVERED", // k = 9: no simulation
    ]);
  });

  it("mono k <= 6 is backed for every bias and both models; k = 3..6 + huge bias", () => {
    for (const model of ["online", "one-round"] as const) {
      for (let k = 3; k <= 6; k += 1) {
        expect(st(cfg(model, "monochromatic", k, "1000"))).toBe("THEOREM_BACKED");
      }
    }
  });
});

describe("EXPERIMENTAL vs NOT_COVERED", () => {
  it("EXPERIMENTAL iff outside every theorem AND the simulation envelope covers it", () => {
    const e = classify(cfg("online", "bichromatic", 7, "5"));
    expect(e.status).toBe("EXPERIMENTAL");
    expect(e.simulation).toMatchObject({ available: true, mustLabelObservationOnly: true });
    expect(e.citations).toEqual([]);
    expect(e.neighbours.length).toBeGreaterThan(0);
    const n = classify(cfg("online", "bichromatic", 9, "5"));
    expect(n.status).toBe("NOT_COVERED");
    expect(n.simulation.available).toBe(false);
    expect(n.simulation.mustLabelObservationOnly).toBe(false);
    expect(n.neighbours.length).toBeGreaterThan(0);
    const big = classify(cfg("online", "bichromatic", 7, "17"));
    expect(big.status).toBe("NOT_COVERED"); // bias above the 1:16 envelope
    expect(classify(cfg("online", "bichromatic", 7, "16")).status).toBe("EXPERIMENTAL");
  });

  it("invalid parameters are NOT_COVERED with reasons and no neighbours", () => {
    for (const bad of [
      cfg("online", "monochromatic", 2, "1"),
      cfg("online", "monochromatic", 4.5, "1"),
      cfg("online", "monochromatic", 4, "1", { structures: 0 }),
      cfg("online", "monochromatic", 4, "1", { structures: 1.5 }),
      { ...cfg("online", "monochromatic", 4, "1"), bias: Rat.make(-1n) },
      { ...cfg("online", "monochromatic", 4, "1"), model: "x" as never },
      { ...cfg("online", "monochromatic", 4, "1"), rule: "y" as never },
    ]) {
      const r = classify(bad);
      expect(r.status).toBe("NOT_COVERED");
      expect(r.invalid.length).toBeGreaterThan(0);
      expect(r.citations).toEqual([]);
      expect(r.neighbours).toEqual([]);
      expect(r.simulation.available).toBe(false);
    }
    expect(validateConfig(cfg("online", "monochromatic", 3, "0"))).toEqual([]);
  });
});

describe("encoding selection never changes the status", () => {
  it("only controls replay and limitations", () => {
    const base = cfg("online", "monochromatic", 5, "1");
    const a = classify(base);
    const b = classify({ ...base, encodingId: "esmb-k5" });
    expect(b.status).toBe(a.status);
    expect(b.encoding).toMatchObject({ applies: true, availability: "verified-interactive", replayOffered: true });
    expect(a.encoding.replayOffered).toBe(false);
  });

  it("encodings that do not match the exact game are ignored with a note", () => {
    const r = classify(cfg("online", "bichromatic", 5, "1", { encodingId: "esmb-k5" }));
    expect(r.status).toBe("THEOREM_BACKED");
    expect(r.encoding).toMatchObject({ applies: false, replayOffered: false, availability: "none" });
    expect(classify(cfg("online", "monochromatic", 6, "1", { encodingId: "esmb-k5" })).encoding.applies).toBe(false);
    expect(classify(cfg("online", "monochromatic", 5, "2", { encodingId: "esmb-k5" })).encoding.applies).toBe(false);
    expect(classify(cfg("one-round", "monochromatic", 5, "1", { encodingId: "esmb-k5" })).encoding.applies).toBe(false);
    expect(classify(cfg("online", "monochromatic", 5, "1", { encodingId: "nope" })).encoding.note).toContain("unknown");
  });

  it("unverified/none encodings offer no replay even when they match", () => {
    expect(classify(cfg("online", "monochromatic", 7, "1", { encodingId: "kstrip-mono-1:1" })).encoding).toMatchObject({
      applies: true,
      availability: "exists-unverified", // k=7 lies outside the verified k-strip scope
      replayOffered: false,
    });
    expect(classify(cfg("online", "monochromatic", 7, "1", { encodingId: "esmb-k7" })).encoding).toMatchObject({
      applies: true,
      availability: "verified-interactive",
      replayOffered: true,
    });
    expect(classify(cfg("online", "monochromatic", 8, "1", { encodingId: "esmb-k8" })).encoding).toMatchObject({
      applies: true,
      availability: "verified-guided",
      replayOffered: true,
    });
    expect(classify(cfg("online", "monochromatic", 6, "1", { encodingId: "esmb-k6-wide" })).encoding).toMatchObject({
      availability: "exists-unverified",
      replayOffered: false,
    });
    expect(classify(cfg("online", "bichromatic", 5, "1", { encodingId: "kstrip-bichromatic" })).encoding).toMatchObject({
      applies: true,
      replayOffered: false,
    });
  });

  it("an injected registry (integrator update) flips replay without touching classification code", () => {
    const updated = ENCODING_REGISTRY.map((e) => (e.id === "esmb-k6-wide" ? { ...e, availability: "verified-guided" as const } : e));
    const r = classify(cfg("online", "monochromatic", 6, "1", { encodingId: "esmb-k6-wide" }), updated);
    expect(r.encoding).toMatchObject({ availability: "verified-guided", replayOffered: true });
  });
});

describe("thm10MinK", () => {
  it("matches the paper's stated particular values", () => {
    expect(thm10MinK(3n)).toBe(17n);
    expect(thm10MinK(4n)).toBe(11n);
    expect(thm10MinK(5n)).toBe(11n);
    expect(thm10MinK(6n)).toBe(8n);
    expect(thm10MinK(7n)).toBe(8n);
    expect(thm10MinK(1000n)).toBe(8n);
  });
  it("equals 3*c-1 for the least integer c with c*(lambda-2) >= 2*lambda (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 3, max: 5000 }), (lam) => {
        let c = 1;
        while (c * (lam - 2) < 2 * lam) {
          c += 1;
        }
        expect(thm10MinK(BigInt(lam))).toBe(BigInt(3 * c - 1));
      }),
    );
  });
  it("rejects lambda < 3", () => {
    expect(() => thm10MinK(2n)).toThrow();
  });
});

describe("properties", () => {
  const arbCfg = fc
    .tuple(
      fc.constantFrom("online", "one-round" as const),
      fc.constantFrom("monochromatic", "bichromatic" as const),
      fc.integer({ min: 3, max: 14 }),
      fc.integer({ min: 0, max: 400 }),
      fc.integer({ min: 1, max: 20 }),
    )
    .map(([m, r, k, n, d]) => cfg(m as LabConfig["model"], r as LabConfig["rule"], k, `${n}/${d}`));

  it("matches the oracle; deterministic; status is backed iff there are citations", () => {
    fc.assert(
      fc.property(arbCfg, (c) => {
        const a = classify(c);
        const b = classify(c);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
        expect(a.status).toBe(oracleStatus(c));
        expect(a.status === "THEOREM_BACKED").toBe(a.citations.length > 0);
        expect(theoremCitations(c).length > 0).toBe(a.status === "THEOREM_BACKED");
        if (a.status !== "THEOREM_BACKED") {
          expect(a.neighbours.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 400 },
    );
  });

  it("neighbours are genuinely theorem-backed and differ from the query", () => {
    fc.assert(
      fc.property(arbCfg, (c) => {
        if (classify(c).status === "THEOREM_BACKED") {
          return;
        }
        for (const nb of nearestNeighbours(c)) {
          const nc = cfg(nb.config.model, nb.config.rule, nb.config.k, nb.config.bias);
          expect(classify(nc).status).toBe("THEOREM_BACKED");
          expect(nb.changed.length).toBeGreaterThan(0);
          expect(JSON.stringify(nb.config)).not.toBe(JSON.stringify({ ...c, bias: c.bias.toString(), encodingId: null, structures: 1 }));
        }
      }),
      { numRuns: 150 },
    );
  });

  it("noninteger bias in the online bichromatic open band is never backed", () => {
    fc.assert(
      fc.property(fc.integer({ min: 201, max: 1199 }), fc.integer({ min: 3, max: 30 }), (n, k) => {
        if (n % 100 === 0) {
          return;
        }
        const c = cfg("online", "bichromatic", k, `${n}/100`);
        expect(classify(c).status).not.toBe("THEOREM_BACKED");
      }),
    );
  });
});
