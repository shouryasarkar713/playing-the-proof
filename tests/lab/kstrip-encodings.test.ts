// The k-strip encoding rows: "verified-guided for listed configurations only".
// Encoding availability never changes the theorem status; it decides only the
// replay offer and the limitations text, and it is never extrapolated beyond
// the listed (k, t, s) points.
import { describe, expect, it } from "vitest";
import { Rat } from "../../src/geometry/rat.ts";
import { KSTRIP_SPECS } from "../../src/kstrip/spec/index.ts";
import { ENCODING_REGISTRY, encodingEntry, inVerifiedScope } from "../../src/lab/encodings.ts";
import type { EncodingEntry } from "../../src/lab/encodings.ts";
import { classify } from "../../src/lab/classify.ts";
import type { LabConfig } from "../../src/lab/types.ts";

function cfg(rule: LabConfig["rule"], k: number, bias: string, structures: number, encodingId: string | null): LabConfig {
  return { model: "online", rule, k, bias: Rat.fromString(bias), encodingId, structures };
}
function enc(rule: LabConfig["rule"], k: number, bias: string, t: number, id: string) {
  return classify(cfg(rule, k, bias, t, id)).encoding;
}

describe("kstrip encodings: scope is exact", () => {
  it("mono 1:1", () => {
    const id = "kstrip-mono-1:1";
    for (const [k, t] of [
      [3, 1],
      [3, 3],
      [4, 1],
      [5, 1],
    ] as const) {
      expect(enc("monochromatic", k, "1", t, id), `${k},${t}`).toMatchObject({ applies: true, availability: "verified-guided", replayOffered: false });
    }
    for (const [k, t] of [
      [3, 4],
      [4, 2],
      [5, 2],
      [6, 1],
      [9, 1],
    ] as const) {
      const e = enc("monochromatic", k, "1", t, id);
      expect(e, `${k},${t}`).toMatchObject({ applies: true, availability: "exists-unverified", replayOffered: false });
      expect(e.note).toContain("not among them");
      expect(e.note).toContain("not extrapolated");
    }
  });
  it("mono 1:s", () => {
    const id = "kstrip-mono-bias";
    for (const [k, s] of [
      [3, "2"],
      [3, "3"],
      [4, "1"],
      [4, "2"],
    ] as const) {
      expect(enc("monochromatic", k, s, 1, id), `${k},${s}`).toMatchObject({ availability: "verified-guided", replayOffered: false });
    }
    for (const [k, s, t] of [
      [3, "1", 1],
      [3, "4", 1],
      [4, "3", 1],
      [5, "2", 1],
      [3, "2", 2],
      [3, "3/2", 1],
    ] as const) {
      expect(enc("monochromatic", k, s, t, id), `${k},${s},${t}`).toMatchObject({ applies: true, availability: "exists-unverified" });
    }
  });
  it("bichromatic", () => {
    const id = "kstrip-bichromatic";
    for (const [k, s, t] of [
      [3, "0", 1],
      [3, "0", 2],
      [3, "1", 2],
      [3, "3/2", 1],
    ] as const) {
      expect(enc("bichromatic", k, s, t, id), `${k},${s},${t}`).toMatchObject({ availability: "verified-guided", replayOffered: false });
    }
    for (const [k, s, t] of [
      [3, "3/2", 2],
      [3, "19/10", 1],
      [4, "1", 1],
      [5, "1", 1],
      [3, "1/2", 1],
    ] as const) {
      expect(enc("bichromatic", k, s, t, id), `${k},${s},${t}`).toMatchObject({ applies: true, availability: "exists-unverified" });
    }
  });
  it("a different game ignores the encoding entirely", () => {
    expect(enc("monochromatic", 5, "1", 1, "kstrip-bichromatic")).toMatchObject({ applies: false, availability: "none", replayOffered: false });
    expect(enc("bichromatic", 5, "1", 1, "kstrip-mono-1:1")).toMatchObject({ applies: false, availability: "none" });
  });
  it("the verified note carries the limitation and never claims a proof", () => {
    const e = enc("monochromatic", 5, "1", 1, "kstrip-mono-1:1");
    expect(e.note).toContain("k-strip explorer");
    expect(e.note).toContain("not an interactive replay");
    for (const id of ["kstrip-mono-1:1", "kstrip-mono-bias", "kstrip-bichromatic"]) {
      expect((encodingEntry(id) as EncodingEntry).note).toMatch(/not a proof/i);
    }
  });
  it("never changes the theorem status", () => {
    const rows: [LabConfig["rule"], number, string, number][] = [
      ["monochromatic", 5, "1", 1],
      ["monochromatic", 9, "1", 5],
      ["monochromatic", 3, "2", 1],
      ["bichromatic", 3, "1", 2],
      ["bichromatic", 7, "3/2", 1],
    ];
    for (const [rule, k, s, t] of rows) {
      const base = classify(cfg(rule, k, s, t, null));
      for (const id of ["kstrip-mono-1:1", "kstrip-mono-bias", "kstrip-bichromatic"]) {
        const r = classify(cfg(rule, k, s, t, id));
        expect(r.status, `${rule} ${k} ${s} ${t} ${id}`).toBe(base.status);
        expect(r.citations).toEqual(base.citations);
      }
    }
  });
  it("inVerifiedScope: entries without a scope are verified wherever they apply", () => {
    const k5 = encodingEntry("esmb-k5") as EncodingEntry;
    expect(inVerifiedScope(k5, cfg("monochromatic", 5, "1", 7, null))).toBe(true);
    const strip = encodingEntry("kstrip-mono-1:1") as EncodingEntry;
    expect(inVerifiedScope(strip, cfg("monochromatic", 5, "1", 7, null))).toBe(false);
    expect(inVerifiedScope(strip, cfg("monochromatic", 5, "1", 1, null))).toBe(true);
  });
  it("an entry with a scope but a Proof-mode replay still offers replay only in scope", () => {
    const reg = ENCODING_REGISTRY.map((e) => (e.id === "kstrip-mono-1:1" ? { ...e, replay: "proof" as const } : e));
    expect(classify(cfg("monochromatic", 5, "1", 1, "kstrip-mono-1:1"), reg).encoding.replayOffered).toBe(true);
    expect(classify(cfg("monochromatic", 5, "1", 2, "kstrip-mono-1:1"), reg).encoding.replayOffered).toBe(false);
  });
});

describe("the lab table agrees with the KStripSpec verified configurations", () => {
  function points(v: readonly { k: number; t: readonly number[]; s?: readonly string[] }[]): string[] {
    const out: string[] = [];
    for (const x of v) {
      for (const t of x.t) {
        for (const s of x.s ?? ["-"]) {
          out.push(`${x.k}|${t}|${s === "-" ? "-" : Rat.fromString(s).toString()}`);
        }
      }
    }
    return out.sort();
  }
  for (const spec of KSTRIP_SPECS) {
    it(spec.id, () => {
      const e = encodingEntry(spec.id) as EncodingEntry;
      expect(e).toBeDefined();
      expect(points(e.verifiedScope ?? [])).toEqual(points(spec.verified));
    });
  }
});
