// lab/encodings.ts — the strategy-encoding registry: a DATA TABLE that says,
// per encoded construction, which exact game it is a valid construction for
// and how far its verification has got. Other work (k=7/k=8 strategies, the
// k-strip modules) flips `availability` here when it lands; nothing else in
// the lab changes. tests/lab/encodings.test.ts cross-checks the table against
// the real strategy registry so a stale entry fails a test.
//
// availability:
//   none                 no implementation exists
//   exists-unverified    an implementation exists but its response classes
//                        are not verified (experimental def)
//   verified-interactive verified; free adversarial play + replay offered
//   verified-guided      verified only as a guided/annotated walk-through
import { Rat } from "../geometry/rat.ts";
import type { EncodingAvailability, LabConfig } from "./types.ts";

export type BiasRule =
  | { readonly kind: "exactly"; readonly value: Rat }
  | { readonly kind: "at-least"; readonly value: Rat }
  | { readonly kind: "below"; readonly value: Rat };

export interface EncodingEntry {
  readonly id: string;
  readonly label: string;
  readonly model: "online";
  readonly rule: "monochromatic" | "bichromatic";
  // Exact k, or "any" (k >= 3).
  readonly k: number | "any";
  readonly bias: BiasRule;
  readonly sourceRows: readonly string[];
  readonly availability: EncodingAvailability;
  readonly note: string;
}

const ONE = Rat.make(1n);
const TWO = Rat.make(2n);

export const ENCODING_REGISTRY: readonly EncodingEntry[] = [
  {
    id: "esmb-k5",
    label: "Das–Valla Lemma 6 (k = 5)",
    model: "online",
    rule: "monochromatic",
    k: 5,
    bias: { kind: "exactly", value: ONE },
    sourceRows: ["DV-L6"],
    availability: "verified-interactive",
    note: "Core def; status badge stays validated-randomized (finite checks, not a proof).",
  },
  {
    id: "esmb-k6",
    label: "Das–Valla Lemma 7 (k = 6)",
    model: "online",
    rule: "monochromatic",
    k: 6,
    bias: { kind: "exactly", value: ONE },
    sourceRows: ["DV-L7"],
    availability: "verified-interactive",
    note: "Forced-region route; universality of the escape convention is not claimed.",
  },
  {
    id: "esmb-k6-wide",
    label: "Das–Valla Lemma 7, experimental wide variant (k = 6)",
    model: "online",
    rule: "monochromatic",
    k: 6,
    bias: { kind: "exactly", value: ONE },
    sourceRows: ["DV-L7"],
    availability: "exists-unverified",
    note: "Experimental def; repo-recorded slow run 190/200 wins. The theorem backs the regime, not this variant.",
  },
  {
    id: "esmb-k7",
    label: "Das–Valla Lemma 8 (k = 7)",
    model: "online",
    rule: "monochromatic",
    k: 7,
    bias: { kind: "exactly", value: ONE },
    sourceRows: ["DV-T1"],
    availability: "none",
    note: "No encoding in the repository yet.",
  },
  {
    id: "esmb-k8",
    label: "Das–Valla Lemma 9 (k = 8)",
    model: "online",
    rule: "monochromatic",
    k: 8,
    bias: { kind: "exactly", value: ONE },
    sourceRows: ["DV-T2"],
    availability: "none",
    note: "No encoding in the repository yet.",
  },
  {
    id: "kstrip-mono-1:1",
    label: "k-strip construction, monochromatic 1:1 (DZ Thm 3)",
    model: "online",
    rule: "monochromatic",
    k: "any",
    bias: { kind: "exactly", value: ONE },
    sourceRows: ["DZ-T3"],
    availability: "none",
    note: "Geometry for the strips is being built separately (src/kstrip).",
  },
  {
    id: "kstrip-mono-bias",
    label: "k-strip construction, monochromatic 1:s, s >= 1 (DZ Thm 4)",
    model: "online",
    rule: "monochromatic",
    k: "any",
    bias: { kind: "at-least", value: ONE },
    sourceRows: ["DZ-T4"],
    availability: "none",
    note: "Integer s in the written proof.",
  },
  {
    id: "kstrip-bichromatic",
    label: "k-strip construction, bichromatic 1:s, s < 2 (DZ Thm 5)",
    model: "online",
    rule: "bichromatic",
    k: "any",
    bias: { kind: "below", value: TWO },
    sourceRows: ["DZ-T5"],
    availability: "none",
    note: "Needs the Maker-only winning rule (game mode bichromatic).",
  },
];

const INDEX: ReadonlyMap<string, EncodingEntry> = new Map(ENCODING_REGISTRY.map((e) => [e.id, e]));

export function encodingEntry(
  id: string,
  registry: readonly EncodingEntry[] = ENCODING_REGISTRY,
): EncodingEntry | undefined {
  return registry === ENCODING_REGISTRY ? INDEX.get(id) : registry.find((e) => e.id === id);
}

export function biasSatisfies(rule: BiasRule, s: Rat): boolean {
  const c = s.cmp(rule.value);
  switch (rule.kind) {
    case "exactly":
      return c === 0;
    case "at-least":
      return c >= 0;
    case "below":
      return c < 0;
  }
}

// Is the entry a valid construction for this exact game?
export function encodingApplies(entry: EncodingEntry, cfg: LabConfig): boolean {
  return (
    cfg.model === entry.model &&
    cfg.rule === entry.rule &&
    (entry.k === "any" ? cfg.k >= 3 : cfg.k === entry.k) &&
    biasSatisfies(entry.bias, cfg.bias)
  );
}

export function isVerified(a: EncodingAvailability): boolean {
  return a === "verified-interactive" || a === "verified-guided";
}
