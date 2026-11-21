// tests/ui/claim-copy.test.ts — ClaimLint over every string of the new modes:
// static copy, computed wording, library text that the Lab displays verbatim,
// and the DOM text actually rendered.
import { describe, expect, it } from "vitest";
import { Rat } from "../../src/geometry/rat.ts";
import { NEGATED_CLAIM_SENTENCES, lintSources, lintStrings } from "../../src/explain/claimlint.ts";
import { DISCREPANCIES, SOURCE_ROWS, classify, constructionArithmetic, parseBias } from "../../src/lab/index.ts";
import type { LabConfig } from "../../src/lab/index.ts";
import {
  BREAK_DONE_NOTE,
  BREAK_INTRO,
  CLAIM_TIERS,
  CLIP_NOTE,
  ESTIMATE_NOTE,
  EXPLORER_INTRO,
  EXPLORER_TITLE,
  RESULT_TEXT,
  SCOPE_NOTE,
  explainStep,
} from "../../src/ui/modes/kstrip-copy.ts";
import { LAB_DISC_NOTE, LAB_INTRO, LAB_SIM_NOTE } from "../../src/ui/modes/lab.ts";
import { STATUS_LABEL, STATUS_MEANING, STOP_TEXT, simKindText } from "../../src/ui/lab-core.ts";
import {
  PHASE_NAMES,
  availability,
  availabilityText,
  describePreview,
  placementText,
  reasonText,
  recursionTable,
  runExplorer,
} from "../../src/ui/kstrip-core.ts";
import type { PreviewClass } from "../../src/ui/kstrip-core.ts";
import { HELP_SECTIONS } from "../../src/explain/help.ts";
import { ABOUT_SECTIONS } from "../../src/explain/about.ts";
import { runSimulation } from "../../src/lab/index.ts";

describe("ClaimLint over the new modes' copy", () => {
  it("static explorer and lab copy is clean", () => {
    const texts = [
      EXPLORER_TITLE, EXPLORER_INTRO, SCOPE_NOTE, CLIP_NOTE, ESTIMATE_NOTE, BREAK_INTRO, BREAK_DONE_NOTE,
      LAB_INTRO, LAB_SIM_NOTE, LAB_DISC_NOTE,
      ...CLAIM_TIERS.flatMap((t) => [t.label, t.text]),
      ...Object.values(RESULT_TEXT),
      ...Object.values(STATUS_LABEL),
      ...Object.values(STATUS_MEANING),
      ...Object.values(STOP_TEXT),
      simKindText("completed"),
      simKindText("budgetExhausted"),
      ...Object.values(PHASE_NAMES),
    ];
    expect(lintStrings(texts)).toEqual([]);
  });

  it("every phase explanation is clean and complete", () => {
    const phases = ["base", "pairing", "grouping", "bichromatic-base", "bichromatic-pairing"] as const;
    const kinds = ["start", "move", "end"] as const;
    const mk = ["base-point", "apex", "breaker"] as const;
    const texts: string[] = [];
    for (const p of phases) {
      for (const k of kinds) {
        for (const m of mk) {
          const e = explainStep(p, k, m);
          expect(e, `${p} ${k} ${m}`).not.toBeNull();
          if (e !== null) {
            for (const v of Object.values(e)) {
              expect(v.length).toBeGreaterThan(15);
              texts.push(v);
            }
          }
        }
      }
    }
    expect(explainStep(null, "result", null)).toBeNull();
    expect(lintStrings(texts)).toEqual([]);
  });

  it("computed wording (availability, Breaker reasons, previews, placements, recursion notes) is clean", () => {
    const avail = [
      availability({ variant: "mono-1:1", k: 4, t: 1, s: null }),
      availability({ variant: "mono-1:1", k: 6, t: 1, s: null }),
      availability({ variant: "mono-1:1", k: 3, t: 4, s: null }),
      availability({ variant: "bichromatic", k: 3, t: 1, s: "2/1" }),
    ].map(availabilityText);
    const previews: PreviewClass[] = [
      { kind: "illegal", code: "collinear", message: "point is collinear with two placed points" },
      { kind: "blocks", unit: 1, region: "R1", wasLive: true },
      { kind: "blocks", unit: 1, region: "R1", wasLive: false },
      { kind: "absorbed", unit: 2, region: "R3" },
      { kind: "boundary", unit: 2, region: "R3", note: "a boundary point blocks the region (Theorem 4 has no adoption rule)." },
      { kind: "useless" },
    ];
    const reasons: string[] = [];
    for (const policy of ["random-legal", "greedy-blocking", "strategy-aware"] as const) {
      for (const [variant, k, s] of [["mono-1:1", 3, null], ["mono-1:s", 3, "2/1"], ["bichromatic", 3, "1/1"]] as const) {
        const r = runExplorer({ variant, k, t: 1, s, policy, seed: 2 });
        for (const e of r.log) {
          if (e.player === "breaker") {
            reasons.push(reasonText(e.reason));
          }
        }
      }
    }
    const texts = [
      ...avail,
      ...previews.map(describePreview),
      ...["interior", "absorbed", "boundary-unabsorbed", "wasted"].map((c) => placementText(c, 1, "R1")),
      ...reasons,
      reasonText(null),
      reasonText({ policy: "p", code: "user-point", summary: "s", target: null, data: {} }),
      reasonText({ policy: "p", code: "fallback-far", summary: "s", target: null, data: {} }),
      reasonText({ policy: "p", code: "nothing-to-block", summary: "s", target: null, data: {} }),
      reasonText({ policy: "p", code: "no-ledger", summary: "s", target: null, data: {} }),
      reasonText({ policy: "p", code: "cannot-kill", summary: "s", target: null, data: { remaining: 1 } }),
      recursionTable({ variant: "mono-1:1", k: 4, t: 1, s: null }).note,
      recursionTable({ variant: "mono-1:s", k: 4, t: 1, s: "2/1" }).note,
      recursionTable({ variant: "bichromatic", k: 3, t: 1, s: "1/1" }).note,
    ];
    expect(lintStrings(texts)).toEqual([]);
  });

  it("the new Help and About text is clean", () => {
    const texts = [...HELP_SECTIONS, ...ABOUT_SECTIONS].flatMap((s) => [s.heading, ...s.body]);
    expect(lintStrings(texts)).toEqual([]);
    const help = HELP_SECTIONS.flatMap((s) => s.body).join(" ");
    for (const must of ["Parameter Lab", "k-strip explorer", "bichromatic", "THEOREM-BACKED", "Break the Proof"]) {
      expect(help).toContain(must);
    }
  });
});

describe("lab library text shown verbatim", () => {
  const strings = new Set<string>();
  for (const model of ["online", "one-round"] as const) {
    for (const rule of ["monochromatic", "bichromatic"] as const) {
      for (const k of [3, 5, 6, 7, 8, 9, 12]) {
        for (const bias of ["0", "1/2", "1", "3/2", "2", "3", "6", "7", "12", "13", "17", "25/2"]) {
          for (const enc of [null, "esmb-k5", "esmb-k6-wide", "kstrip-mono-1:1", "kstrip-bichromatic"]) {
            const cfg: LabConfig = { model, rule, k, bias: parseBias(bias) as Rat, encodingId: enc, structures: 2 };
            const r = classify(cfg);
            strings.add(r.verification);
            r.limitations.forEach((s) => strings.add(s));
            r.reasons.forEach((s) => strings.add(s));
            r.invalid.forEach((s) => strings.add(s));
            strings.add(r.simulation.reason);
            strings.add(r.encoding.note);
            r.neighbours.forEach((n) => strings.add(n.label));
          }
        }
      }
    }
  }

  it("is clean once the two negated-claim sentences are allowed, and those are really emitted by the lab", () => {
    // a limitation that restates a cited row ("DZ-P7: ...") is a theorem citation with its row id
    const asSource = (s: string): { text: string; tier?: "theorem-cited"; ref?: string } => {
      const m = /^([A-Z]{2,3}-[A-Z0-9]+): /.exec(s);
      return m === null ? { text: s } : { text: s, tier: "theorem-cited", ref: m[1] as string };
    };
    expect(lintSources([...strings].map(asSource))).toEqual([]);
    for (const s of NEGATED_CLAIM_SENTENCES) {
      expect(strings.has(s), s).toBe(true);
    }
    // the allowance is exact-match: embedding the sentence in other prose does not widen it
    expect(lintStrings([`${NEGATED_CLAIM_SENTENCES[1] as string} and this is guaranteed`]).length).toBeGreaterThan(0);
  });

  it("cited theorem text is whitelisted only as a theorem citation with its row id", () => {
    const sources = SOURCE_ROWS.flatMap((r) => [
      { text: r.statement, tier: "theorem-cited" as const, ref: r.id },
      { text: r.note, tier: "theorem-cited" as const, ref: r.id },
    ]);
    expect(lintSources(sources)).toEqual([]);
    // the same text without the citation context is what the linter objects to
    const bare = lintStrings(SOURCE_ROWS.map((r) => r.note));
    expect(bare.length).toBeGreaterThan(0);
    const disc = DISCREPANCIES.flatMap((d) => [
      { text: d.where, tier: "theorem-cited" as const, ref: d.id },
      { text: d.finding, tier: "theorem-cited" as const, ref: d.id },
      { text: d.effectOnLab, tier: "theorem-cited" as const, ref: d.id },
    ]);
    expect(lintSources(disc)).toEqual([]);
    expect(constructionArithmetic().length).toBe(4);
  });

  it("the simulation label is clean", () => {
    const cfg: LabConfig = { model: "online", rule: "bichromatic", k: 7, bias: Rat.make(2n), encodingId: null, structures: 1 };
    const r = runSimulation(cfg, { seed: 1, maxRounds: 2 });
    if (r.kind === "unsupported") {
      throw new Error("unsupported");
    }
    expect(lintStrings([r.label])).toEqual([]);
  });
});
