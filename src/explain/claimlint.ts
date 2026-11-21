// explain/claimlint.ts — the claim-word linter (§13.1, §26F wording rule).
//
// Sources: every rendered string (templates, def why fields, About, badges,
// terminal cards, diagnostics). Whitelist (§26F): (1) the fixed honesty
// sentences (exact match); (2) source-theorem citations — structured claims
// with tier theorem-cited AND a ref; (3) exactly-scoped finite-check
// statements — "exhaustive"/"complete" accompanied by an explicit finite
// scope (points/window/domain/cells/subsets/corpus).
import type { ClaimTier } from "./types.ts";
import {
  HONESTY_BUDGET_EXHAUSTED,
  HONESTY_STATEMENT,
  HONESTY_WITNESS_ONLY,
  UNCOVERED_TEMPLATES,
} from "./templates.ts";

const FORBIDDEN = [
  "prove",
  "proves",
  "guarantee",
  "guaranteed",
  "guarantees",
  "always",
  "never fails",
  "complete",
  "exhaustive",
  "source-faithful",
  // (spec §26F/§34 forbidden list was only partly encoded):
  "the app establishes",
  "therefore the theorem",
];

// Sentences produced by the Parameter Lab (src/lab/classify.ts) that NEGATE a
// claim ("never a guarantee", "never claims to re-prove it"). They are shown
// verbatim; exact match only. tests/ui/claim-copy.test.ts asserts that each is
// really emitted by classify() and that no other lab string needs this allowance.
export const NEGATED_CLAIM_SENTENCES: readonly string[] = [
  "published theorem; the lab asserts the regime and never claims to re-prove it",
  "a bounded simulation exists: its output is an observation, never a guarantee",
];

const ALLOW_EXACT: readonly string[] = [
  HONESTY_WITNESS_ONLY,
  HONESTY_BUDGET_EXHAUSTED,
  HONESTY_STATEMENT,
  ...NEGATED_CLAIM_SENTENCES,
  ...UNCOVERED_TEMPLATES.map((t) => t.text),
];

// "exhaustive"/"complete" require an explicit finite scope in the SAME string.
const SCOPED_PATTERN =
  /\b(exhaustive|complete)\b[^.]*\b(over|in|within|across)\b[^.]*\b(points?|window|domain|cells?|subsets?|corpus|configurations?)\b/i;

export interface LintSource {
  text: string;
  tier?: ClaimTier;
  ref?: string | null;
}

export interface LintHit {
  word: string;
  context: string;
}

function containsWord(text: string, word: string): boolean {
  const pattern = new RegExp(`\\b${word.replace(/ /g, "\\s+")}\\b`, "i");
  return pattern.test(text);
}

// lintSources: hits for forbidden claim words outside the §26F whitelist.
// Whitelisted fixed sentences are discounted wherever embedded: a text
// composed of allowed sentences plus clean prose lints only its
// non-whitelisted remainder (exact-match removal — allowed content cannot
// smuggle a violation it does not itself contain).
export function lintSources(sources: readonly LintSource[]): LintHit[] {
  const hits: LintHit[] = [];
  for (const source of sources) {
    const s = source.text;
    if (ALLOW_EXACT.includes(s)) {
      continue;
    }
    let rest = s;
    for (const allowed of ALLOW_EXACT) {
      rest = rest.split(allowed).join("");
    }
    if (rest.trim() === "") {
      continue;
    }
    for (const word of FORBIDDEN) {
      if (!containsWord(rest, word)) {
        continue;
      }
      if (
        source.tier === "theorem-cited" &&
        source.ref !== undefined &&
        source.ref !== null &&
        source.ref !== ""
      ) {
        continue;
      }
      if (
        (word === "exhaustive" || word === "complete") &&
        SCOPED_PATTERN.test(rest)
      ) {
        continue;
      }
      hits.push({ word, context: rest.slice(0, 120) });
    }
  }
  return hits;
}

// lintStrings: plain-string sources (no tier/ref context).
export function lintStrings(strings: readonly string[]): LintHit[] {
  return lintSources(strings.map((text) => ({ text })));
}
