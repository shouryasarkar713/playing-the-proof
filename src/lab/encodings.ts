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

// One verified point set of an encoding that is verified for listed
// configurations only (k, number of structures t, bias s as exact rationals).
export interface VerifiedScope {
  readonly k: number;
  readonly t: readonly number[];
  // exact Rat strings; absent when the bias is fixed by the entry's BiasRule
  readonly s?: readonly string[];
}

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
  // Absent: the availability holds for every configuration the entry applies
  // to. Present: it holds ONLY for these configurations; any other
  // configuration is reported 'exists-unverified' (never extrapolated).
  readonly verifiedScope?: readonly VerifiedScope[];
  // How a verified encoding is replayed. "proof" (default): Proof/Break mode
  // of the strategy engine. "explorer": an exact headless run in the k-strip
  // explorer (not an interactive replay of the game, so no Proof-mode link).
  readonly replay?: "proof" | "explorer";
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
    availability: "verified-interactive",
    note: "Core def; docs/K7_GATE.md: every B0 pattern and B1 class verified by exact cell enumeration against an independent oracle (finite hexagon families). Badge stays validated-randomized.",
  },
  {
    id: "esmb-k8",
    label: "Das–Valla Lemma 9 (k = 8)",
    model: "online",
    rule: "monochromatic",
    k: 8,
    bias: { kind: "exactly", value: ONE },
    sourceRows: ["DV-T2"],
    availability: "verified-guided",
    note: "Guided walkthrough only (docs/K8_GATE.md): the Figure 3-5 path is verified exactly; classes not encoded end as uncovered. Not fully interactive.",
  },
  {
    id: "kstrip-mono-1:1",
    label: "k-strip construction, monochromatic 1:1 (DZ Thm 3)",
    model: "online",
    rule: "monochromatic",
    k: "any",
    bias: { kind: "exactly", value: ONE },
    sourceRows: ["DZ-T3"],
    availability: "verified-guided",
    replay: "explorer",
    verifiedScope: [
      { k: 2, t: [1] },
      { k: 3, t: [1, 2, 3] },
      { k: 4, t: [1] },
      { k: 5, t: [1] },
    ],
    note: "Declarative KStripSpec executed through the exact k-strip kernel (docs/KSTRIP_SPEC.md). Verified only for the listed configurations (k = 2..5 with t = 1; k = 3 with t <= 3): each run re-checks every claimed strip exactly against Definition 2 for the shipped Breaker policies. This is not a proof for arbitrary k, t or Breaker play; other configurations are not covered by this encoding.",
  },
  {
    id: "kstrip-mono-bias",
    label: "k-strip construction, monochromatic 1:s, s >= 1 (DZ Thm 4)",
    model: "online",
    rule: "monochromatic",
    k: "any",
    bias: { kind: "at-least", value: ONE },
    sourceRows: ["DZ-T4"],
    availability: "verified-guided",
    replay: "explorer",
    verifiedScope: [
      { k: 3, t: [1], s: ["2", "3"] },
      { k: 4, t: [1], s: ["1", "2"] },
    ],
    note: "Integer s in the written proof. Declarative KStripSpec (docs/KSTRIP_SPEC.md); verified only for k = 3 with s = 2, 3 and k = 4 with s = 1, 2 (t = 1). The slab-restricted rotation is a documented deviation from the paper's text. Not a proof for arbitrary k or s.",
  },
  {
    id: "kstrip-bichromatic",
    label: "k-strip construction, bichromatic 1:s, s < 2 (DZ Thm 5)",
    model: "online",
    rule: "bichromatic",
    k: "any",
    bias: { kind: "below", value: TWO },
    sourceRows: ["DZ-T5"],
    availability: "verified-guided",
    replay: "explorer",
    verifiedScope: [
      { k: 2, t: [1, 2], s: ["1", "3/2"] },
      { k: 3, t: [1, 2], s: ["0", "1"] },
      { k: 3, t: [1], s: ["3/2"] },
    ],
    note: "Needs the Maker-only winning rule (game mode bichromatic). Declarative KStripSpec (docs/KSTRIP_SPEC.md); verified only for the listed configurations (k = 2 with s = 1, 3/2; k = 3 with s = 0, 1, and s = 3/2 for r = 1). The executor uses the strict count t = ceil(2r/eps), not the paper's (docs/KSTRIP.md section 6). Not a proof for arbitrary k or s.",
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

// Is the configuration one of the entry's verified points? Entries without a
// verifiedScope are verified wherever they apply. t is the number of
// structures (the lab's `structures`), s the bias.
export function inVerifiedScope(entry: EncodingEntry, cfg: LabConfig): boolean {
  if (entry.verifiedScope === undefined) {
    return true;
  }
  return entry.verifiedScope.some(
    (v) =>
      v.k === cfg.k &&
      v.t.includes(cfg.structures) &&
      (v.s === undefined || v.s.some((x) => Rat.fromString(x).equals(cfg.bias))),
  );
}

export function isVerified(a: EncodingAvailability): boolean {
  return a === "verified-interactive" || a === "verified-guided";
}
