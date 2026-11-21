// explain/templates.ts — fixed template data (§10.5 uncovered templates,
// §13.1 honesty labels, §13.4 honesty statement). Strings never contain
// computed numbers — numbers interpolate from evidence objects (§13.1).
// Covered by ClaimLint like every other rendered string.

export interface Template {
  id: string;
  text: string;
}

export const UNCOVERED_TEMPLATES: readonly Template[] = [
  {
    id: "uncovered.breakerReply.partialEncoding",
    text: "Your Breaker move lies in territory this build's encoding declares out of scope (partial encoding). The source argument covers it by [general reasoning not encoded here; sourceRef]. This is a limitation of this build's domain, not a counterexample to the published proof. You can rewind, or start a Sandbox session.",
  },
  {
    id: "uncovered.breakerReply.experimentalDisabled",
    text: "Your Breaker move lies in territory covered only by the experimental def '[strategyId]', which is not active in this session (opt-in via the picker's experimental toggle). You can rewind, restart with the experimental toggle on, or start a Sandbox session.",
  },
  {
    id: "uncovered.makerConstruction.windowExhausted",
    text: "The strategy's reply is mathematically valid, but every admissible placement falls outside this build's play window — a domain limit of this build, not a strategy failure. You can rewind with “Back one step” and try a different move, or start a Sandbox session; the play window is a fixed parameter of this build.",
  },
];

export const HONESTY_WITNESS_ONLY =
  "witness found; enumeration capped — this is NOT an exhaustive count";

export const HONESTY_BUDGET_EXHAUSTED =
  "no k-hole found within budget — never presented as 'none exist'";

export const HONESTY_STATEMENT =
  "Playing with this application demonstrates the encoded constructions and checks their geometric facts exactly, move by move; it does not re-prove the theorem. The proofs are those of the cited authors.";
