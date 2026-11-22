// tests/lab/regimes.test.ts — the source-row base, the reconstructed proposal
// tables, the discrepancy register, bias parsing, round bounds, encodings
// registry cross-check and the controls list.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Rat } from "../../src/geometry/rat.ts";
import {
  DISCREPANCIES,
  PROPOSAL_TABLE1,
  PROPOSAL_TABLE2,
  SOURCE_ROWS,
  constructionArithmetic,
  sourceRow,
} from "../../src/lab/regimes.ts";
import { formatBias, floorRat, isIntegerRat, parseBias } from "../../src/lab/bias.ts";
import { monoRoundBound, monoRoundBoundClosedForm } from "../../src/lab/bounds.ts";
import {
  ENCODING_REGISTRY,
  biasSatisfies,
  encodingApplies,
  encodingEntry,
  isVerified,
} from "../../src/lab/encodings.ts";
import { availableControls } from "../../src/lab/controls.ts";
import { configToJSON } from "../../src/lab/classify.ts";
import { strategies } from "../../src/strategy/registry.ts";
import { ensureK5 } from "../strategies/k5driver.ts";
import { ensureK6 } from "../strategies/k6driver.ts";
import { ensureK7 } from "../strategies/k7driver.ts";
import { ensureK8 } from "../strategies/k8driver.ts";

ensureK5();
ensureK6();
ensureK7();
ensureK8();

describe("source rows", () => {
  it("ids are unique; game rows carry a status, reference rows do not", () => {
    const ids = SOURCE_ROWS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of SOURCE_ROWS) {
      if (!r.aboutThisGame) {
        expect(r.status, r.id).toBeNull();
      }
      expect(r.statement.length).toBeGreaterThan(10);
    }
  });

  it("classical facts are NOT classified as statements about the game", () => {
    for (const id of ["REF-ES", "REF-ES-BOUNDS", "REF-H", "REF-KG", "REF-CL"]) {
      const r = sourceRow(id);
      expect(r?.aboutThisGame).toBe(false);
      expect(r?.status).toBeNull();
    }
    expect(sourceRow("AI-T37")?.aboutThisGame).toBe(true);
    expect(sourceRow("AI-T37")?.tier).toBe("extended-abstract");
  });

  it("derived rows are tier derived-inference; Thm 10 is flagged partial-proof", () => {
    for (const r of SOURCE_ROWS.filter((x) => x.id.startsWith("DER-"))) {
      expect(r.tier).toBe("derived-inference");
    }
    expect(sourceRow("DZ-T10")?.tier).toBe("published-statement-partial-proof");
    expect(sourceRow("DZ-OPEN")?.status).toBeNull();
    expect(sourceRow("nope")).toBeUndefined();
  });
});

describe("proposal tables", () => {
  const known = new Set(SOURCE_ROWS.map((r) => r.id));
  it("Table 1 and Table 2 reference only known rows; ids unique", () => {
    for (const t of [PROPOSAL_TABLE1, PROPOSAL_TABLE2]) {
      expect(new Set(t.map((r) => r.id)).size).toBe(t.length);
      for (const r of t) {
        for (const id of r.rows) {
          expect(known.has(id), `${r.id} -> ${id}`).toBe(true);
        }
      }
    }
    expect(PROPOSAL_TABLE1.length).toBe(11);
    expect(PROPOSAL_TABLE2.length).toBe(11);
  });

  it("the 8-hole 12-round claim is recorded as a discrepancy in both tables", () => {
    expect(PROPOSAL_TABLE1.find((r) => r.id === "T1-05")?.verdict).toBe("discrepancy");
    expect(PROPOSAL_TABLE2.find((r) => r.id === "T2-06")?.verdict).toBe("discrepancy");
    const others = [...PROPOSAL_TABLE1, ...PROPOSAL_TABLE2].filter((r) => r.verdict === "discrepancy");
    expect(others.map((r) => r.id).sort()).toEqual(["T1-05", "T2-06"]);
  });

  it("Table 2 encoding ids exist in the encoding registry", () => {
    for (const r of PROPOSAL_TABLE2) {
      if (r.encodingId !== null) {
        expect(encodingEntry(r.encodingId), r.id).toBeDefined();
      }
    }
  });
});

describe("Das–Valla construction arithmetic (D1)", () => {
  it("recomputes 4 / 6 / 8 / 13 rounds and 7 / 11 / 15 / 25 points", () => {
    const a = constructionArithmetic();
    expect(a.map((x) => x.rounds)).toEqual([4, 6, 8, 13]);
    expect(a.map((x) => x.points)).toEqual([7, 11, 15, 25]);
  });
  it("only the printed k = 8 round count is inconsistent", () => {
    const a = constructionArithmetic();
    expect(a.filter((x) => !x.consistent).map((x) => x.k)).toEqual([8]);
    expect(a.find((x) => x.k === 8)).toMatchObject({ printedRounds: 12, printedPoints: 25, rounds: 13, points: 25 });
  });
  it("discrepancy register covers D1..D12 with an effect on the lab", () => {
    expect(DISCREPANCIES.map((d) => d.id)).toEqual(Array.from({ length: 12 }, (_, i) => `D${i + 1}`));
    for (const d of DISCREPANCIES) {
      expect(d.finding.length).toBeGreaterThan(20);
      expect(d.effectOnLab.length).toBeGreaterThan(10);
    }
  });
});

describe("parseBias", () => {
  it("accepts integers, fractions, decimals, numbers; rejects the rest", () => {
    expect(parseBias("12")?.toString()).toBe("12/1");
    expect(parseBias("5/2")?.toString()).toBe("5/2");
    expect(parseBias("24/2")?.toString()).toBe("12/1");
    expect(parseBias("2.5")?.toString()).toBe("5/2");
    expect(parseBias("1.999")?.toString()).toBe("1999/1000");
    expect(parseBias(" 3 ")?.toString()).toBe("3/1");
    expect(parseBias(0)?.toString()).toBe("0/1");
    expect(parseBias(2.5)?.toString()).toBe("5/2");
    expect(parseBias(7n)?.toString()).toBe("7/1");
    for (const bad of ["", "-1", "1/0", "abc", "1e3", "1.", ".5", "--2", "1/2/3"]) {
      expect(parseBias(bad), bad).toBeNull();
    }
    expect(parseBias(-1)).toBeNull();
    expect(parseBias(Number.NaN)).toBeNull();
    expect(parseBias(Number.POSITIVE_INFINITY)).toBeNull();
    expect(parseBias(1e21)).toBeNull();
    expect(parseBias(-3n)).toBeNull();
  });
  it("floor / integer / format helpers", () => {
    expect(floorRat(Rat.make(7n, 2n))).toBe(3n);
    expect(floorRat(Rat.make(6n, 2n))).toBe(3n);
    expect(isIntegerRat(Rat.make(6n, 2n))).toBe(true);
    expect(isIntegerRat(Rat.make(7n, 2n))).toBe(false);
    expect(formatBias(Rat.make(12n))).toBe("1:12");
    expect(formatBias(Rat.make(5n, 2n))).toBe("1:5/2");
  });
  it("decimal parse is exact (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 99999 }), fc.integer({ min: 0, max: 99 }), (a, b) => {
        const s = `${a}.${String(b).padStart(2, "0")}`;
        const r = parseBias(s) as Rat;
        expect(r.equals(Rat.make(BigInt(a * 100 + b), 100n))).toBe(true);
      }),
    );
  });
});

describe("round bounds (DZ Thm 3 / Thm 4)", () => {
  it("s = 1 reproduces (5/3*4^(k-2) - 2/3) t for k >= 2", () => {
    for (let k = 2; k <= 9; k += 1) {
      for (const t of [1, 2, 5]) {
        const b = monoRoundBound(k, t, Rat.make(1n));
        expect(b.kind).toBe("bound");
        if (b.kind === "bound") {
          const expected = Rat.make(5n * 4n ** BigInt(k - 2) - 2n, 3n).mul(Rat.make(BigInt(t)));
          expect(b.rounds.equals(expected), `k=${k} t=${t}`).toBe(true);
          expect(b.source).toBe("DZ-T3");
        }
      }
    }
  });
  it("recurrence equals the printed closed form for integer s (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 8 }), fc.integer({ min: 1, max: 6 }), fc.integer({ min: 1, max: 9 }), (k, t, s) => {
        const b = monoRoundBound(k, t, Rat.make(BigInt(s)));
        expect(b.kind).toBe("bound");
        if (b.kind === "bound") {
          expect(b.rounds.equals(monoRoundBoundClosedForm(k, t, BigInt(s)))).toBe(true);
          expect(b.source).toBe(s === 1 ? "DZ-T3" : "DZ-T4");
        }
      }),
    );
  });
  it("k = 1 base, small hand values (k=3,t=1,s=1 is 6)", () => {
    const k1 = monoRoundBound(1, 4, Rat.make(1n));
    expect(k1.kind === "bound" && k1.rounds.equals(Rat.make(2n))).toBe(true);
    const k3 = monoRoundBound(3, 1, Rat.make(1n));
    expect(k3.kind === "bound" && k3.rounds.equals(Rat.make(6n))).toBe(true);
  });
  it("refuses non-integer s, s < 1 and bad k/t instead of inventing a bound", () => {
    expect(monoRoundBound(5, 1, Rat.make(3n, 2n)).kind).toBe("none");
    expect(monoRoundBound(5, 1, Rat.make(1n, 2n)).kind).toBe("none");
    expect(monoRoundBound(0, 1, Rat.make(1n)).kind).toBe("none");
    expect(monoRoundBound(5, 0, Rat.make(1n)).kind).toBe("none");
    expect(monoRoundBound(5.5, 1, Rat.make(1n)).kind).toBe("none");
  });
});

describe("encodings registry", () => {
  it("esmb-k5/k6/k7 are verified-interactive and esmb-k8 verified-guided; k-strip entries are verified-guided for listed configurations only", () => {
    const verified = ENCODING_REGISTRY.filter((e) => !e.id.startsWith("kstrip-") && isVerified(e.availability)).map((e) => e.id);
    expect(verified.sort()).toEqual(["esmb-k5", "esmb-k6", "esmb-k7", "esmb-k8"]);
    expect(encodingEntry("esmb-k7")?.availability).toBe("verified-interactive");
    expect(encodingEntry("esmb-k8")?.availability).toBe("verified-guided");
    for (const id of ["kstrip-mono-1:1", "kstrip-mono-bias", "kstrip-bichromatic"]) {
      const e = encodingEntry(id);
      expect(e?.availability, id).toBe("verified-guided");
      expect(e?.replay, id).toBe("explorer");
      expect(e?.verifiedScope?.length, id).toBeGreaterThan(0);
      expect(e?.note, id).toMatch(/not a proof/i);
    }
    expect(encodingEntry("esmb-k6-wide")?.availability).toBe("exists-unverified");
  });

  it("is consistent with the REAL strategy registry (update encodings.ts when a def lands)", () => {
    const real = strategies();
    for (const e of ENCODING_REGISTRY) {
      if (!e.id.startsWith("esmb-")) {
        continue;
      }
      const registered = real.has(e.id);
      expect(
        registered,
        `encodings.ts says ${e.id} is '${e.availability}' but the strategy registry ${registered ? "HAS" : "lacks"} it — update src/lab/encodings.ts`,
      ).toBe(e.availability !== "none");
    }
  });

  it("every entry cites known rows; ids unique", () => {
    expect(new Set(ENCODING_REGISTRY.map((e) => e.id)).size).toBe(ENCODING_REGISTRY.length);
    for (const e of ENCODING_REGISTRY) {
      for (const r of e.sourceRows) {
        expect(sourceRow(r), `${e.id} -> ${r}`).toBeDefined();
      }
    }
  });

  it("bias rules and applicability", () => {
    const one = Rat.make(1n);
    expect(biasSatisfies({ kind: "exactly", value: one }, one)).toBe(true);
    expect(biasSatisfies({ kind: "exactly", value: one }, Rat.make(2n))).toBe(false);
    expect(biasSatisfies({ kind: "at-least", value: one }, Rat.make(3n, 2n))).toBe(true);
    expect(biasSatisfies({ kind: "at-least", value: one }, Rat.make(1n, 2n))).toBe(false);
    expect(biasSatisfies({ kind: "below", value: Rat.make(2n) }, Rat.make(2n))).toBe(false);
    expect(biasSatisfies({ kind: "below", value: Rat.make(2n) }, Rat.make(19n, 10n))).toBe(true);
    const strip = encodingEntry("kstrip-bichromatic");
    const base = { model: "online" as const, k: 9, bias: Rat.make(3n, 2n), rule: "bichromatic" as const, encodingId: null, structures: 1 };
    expect(strip !== undefined && encodingApplies(strip, base)).toBe(true);
    expect(strip !== undefined && encodingApplies(strip, { ...base, bias: Rat.make(2n) })).toBe(false);
    expect(strip !== undefined && encodingApplies(strip, { ...base, k: 2 })).toBe(false);
    expect(strip !== undefined && encodingApplies(strip, { ...base, model: "one-round" })).toBe(false);
    const kb = encodingEntry("kstrip-mono-bias");
    const mono = { ...base, rule: "monochromatic" as const };
    expect(kb !== undefined && encodingApplies(kb, { ...mono, bias: Rat.make(1n) })).toBe(true); // boundary s = 1
    expect(kb !== undefined && encodingApplies(kb, { ...mono, bias: Rat.make(99n, 100n) })).toBe(false);
    expect(encodingEntry("x", ENCODING_REGISTRY)).toBeUndefined();
    expect(encodingEntry("esmb-k5", [...ENCODING_REGISTRY])?.id).toBe("esmb-k5");
    expect(configToJSON(base).bias).toBe("3/2");
  });
});

describe("availableControls", () => {
  it("every control names an implementation that exists", async () => {
    const controls = availableControls();
    expect(controls.length).toBeGreaterThan(5);
    expect(new Set(controls.map((c) => c.id)).size).toBe(controls.length);
    for (const c of controls) {
      const mod = (await import(`../../src/lab/${c.implementedBy.module}.ts`)) as Record<string, unknown>;
      expect(mod[c.implementedBy.symbol], `${c.id} -> ${c.implementedBy.module}.${c.implementedBy.symbol}`).toBeDefined();
    }
  });
  it("offers exactly the implemented parameters; encoding options mirror the registry", () => {
    const ids = availableControls().map((c) => c.id);
    expect(ids).toEqual(
      expect.arrayContaining(["model", "rule", "k", "bias", "encoding", "structures", "simulate"]),
    );
    const enc = availableControls().find((c) => c.id === "encoding");
    expect(enc?.options?.map((o) => o.value)).toEqual(["", ...ENCODING_REGISTRY.map((e) => e.id)]);
  });
});
