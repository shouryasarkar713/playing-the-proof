// ui/modes/kstrip-copy.ts — every explanatory string of the k-strip explorer.
// Pure data/functions so that tests can run ClaimLint over all of it
// (tests/ui/claim-copy.test.ts). Wording rules: no claim words, claim tiers
// named honestly (theorem / construction / exact check on this run).
import type { PhaseKind } from "../../kstrip/index.ts";

export interface PhaseExplanation {
  readonly object: string;
  readonly why: string;
  readonly maker: string;
  readonly breaker: string;
  readonly invariant: string;
  readonly next: string;
}

export const EXPLORER_TITLE = "k-strip explorer";

export const EXPLORER_INTRO =
  "Run the recursive k-strip construction of Džuklevski et al. with exact rational geometry against a Breaker policy, then step through its move log. A k-strip is a convex chain whose downward region holds no other point (Definition 2).";

export const CLAIM_TIERS: readonly { tag: string; label: string; text: string }[] = [
  {
    tag: "T",
    label: "theorem",
    text: "The round bounds and the counting argument are theorems of the paper (Theorems 3, 4, 5, Proposition 1). They are cited here, not re-derived.",
  },
  {
    tag: "C",
    label: "construction",
    text: "The pairing, adoption, grouping and tilt steps are the paper's constructions implemented as code; the places where the paper leaves a choice open are documented implementation conventions.",
  },
  {
    tag: "X",
    label: "exact check on this run",
    text: "After the run, every claimed strip is re-checked on the final board with the exact predicate of Definition 2, and the claimed strips are checked pairwise parallel. This is a check of this one run against this one Breaker policy.",
  },
];

export const SCOPE_NOTE =
  "Scope: only the configurations in the verified table were executed in this repository. A successful run says nothing about other parameters, other Breaker behaviour, or the general strategy for arbitrary k.";

export const CLIP_NOTE =
  "Clipped for display (illustrative); the exact region is unbounded. Axes are scaled independently, which keeps incidences and strip relations but not distances.";

export const ESTIMATE_NOTE =
  "The estimate is computed before anything runs; the executed numbers equal it for every verified configuration (tested).";

export const BREAK_INTRO =
  "Break the Proof: you play Breaker in the pairing phase of the top level. Place a point (click the board or type exact coordinates); the run is re-executed with your points and the ledger classifies each one. Points you do not place are played by the selected policy in the lower levels.";

export const BREAK_DONE_NOTE =
  "Breaker's budget for this phase is spent. The run has been re-executed to the end and every claimed strip re-checked exactly; this is one adversary, not all of them.";

// ---- phase explanations --------------------------------------------------

const BASE: PhaseExplanation = {
  object:
    "Base points: Maker places points on a parabola, one per round, at fresh abscissae. Single points are 1-strips; two points with adjacent abscissae form a 2-strip when nothing lies in the region under their segment.",
  why: "The recursion needs many disjoint low-order strips to start from. The parabola keeps the points in convex position, so any chain of them is a cap.",
  maker: "Maker adds one base point per round; the abscissa is the next free integer.",
  breaker:
    "Breaker replies with legal points (general position; in the monochromatic base phase also a fresh abscissa). A reply only matters if it lands in the region under a chain.",
  invariant: "Every point added keeps the whole set in general position (no three collinear).",
  next: "The strips that survive become the input of the first pairing or grouping phase.",
};

const PAIRING: Record<"start" | "apex" | "breaker" | "end", PhaseExplanation> = {
  start: {
    object:
      "Pairing plan: consecutive strips S_(2j−1), S_(2j) of the previous level are paired. Between them a vertical line l_j is chosen and the halfline l_j ∩ C+ ∩ C− is computed from the two extension cones.",
    why: "A new point p_j on that halfline extends either strip to a strip of one more point, so each pair offers two candidate regions R_(2j−1) and R_(2j) that share exactly the halfline below p_j.",
    maker: "Maker will place one point p_j per pair; each placement creates two candidates at once.",
    breaker:
      "Breaker has a fixed budget of points for the whole phase. A point strictly inside a candidate region blocks that candidate; a pair is lost only if both candidates are blocked.",
    invariant:
      "The candidate regions of different pairs are interior-disjoint, and the two candidates of one pair meet only in the shared halfline (exact check at harvest).",
    next: "Maker places p_1, Breaker replies, and so on for every pair.",
  },
  apex: {
    object:
      "Maker's extension point p_j, placed on the halfline l_j ∩ C+ ∩ C−. The two candidate regions of the pair now exist.",
    why: "p_j is the vertex shared by the two candidate strips; placing it low on the halfline only shrinks the regions, which makes them easier to defend, not harder.",
    maker: "Maker commits p_j before seeing Breaker's reply.",
    breaker:
      "Breaker may now aim at either candidate of this pair, or at the end vertices, or elsewhere.",
    invariant: "p_j keeps general position and lies in both cones, so both candidates are strips when nothing blocks them.",
    next: "Breaker answers with the points owed after this Maker move.",
  },
  breaker: {
    object:
      "A Breaker point, classified by the ledger: it blocks the interior of a candidate, is absorbed by adoption, or is useless.",
    why: "Each pair needs two blockers to be lost. With a budget of B points, at most ⌊B/2⌋ pairs can contain two Breaker points in R_(2j−1) ∪ R_(2j) (Proposition 1 as worded in the paper).",
    maker: "Maker does not react inside the phase; the survivors are read off at the end.",
    breaker:
      "The policy's reason for this point is shown in words below. A point on the halfline below an end vertex or below p_j replaces that vertex (adoption) and is not a blocker.",
    invariant:
      "Regions only shrink: adoption moves a vertex down its vertical line, so the lower bound on survivors never rises above the true count.",
    next: "When Breaker's budget for the phase is spent the phase is harvested.",
  },
  end: {
    object:
      "Harvest: one strip per surviving pair is chosen and re-checked with the exact predicate of Definition 2; the chosen strips are checked pairwise parallel.",
    why: "These strips are the input of the next level; their number must reach the requirement t of the recursion.",
    maker: "Maker keeps one live candidate per surviving pair.",
    breaker: "Breaker's budget for this phase is spent; blocked pairs are lost.",
    invariant:
      "Survivors needed (required) against the lower bound from the ledger: units − dead − kills still possible with the points left.",
    next: "The next level starts from these strips (recursion), or the run ends with the claimed k-strips.",
  },
};

const GROUPING: Record<"start" | "apex" | "breaker" | "end", PhaseExplanation> = {
  start: {
    object:
      "Grouping plan (Theorem 4): groups of 2s consecutive strips with a vertical line to their left and the cones C− of every strip in the group.",
    why: "With s Breaker points per Maker point, a group of 2s strips can lose at most 2s − 1 strips to the s points of one Maker move plus earlier ones; one strip per group survives the count.",
    maker: "Maker places one point p_j per group on the intersection of the groups' cone sections.",
    breaker: "Breaker places s points after each Maker point.",
    invariant: "Groups are pairwise separated, so a Breaker point lies in at most one strip region.",
    next: "Maker places p_1, Breaker replies with s points, and so on.",
  },
  apex: {
    object: "Maker's point p_j for this group, below every cone section of the group.",
    why: "Rotating the left edge of a surviving strip to p_j extends it by one vertex inside the group's slab.",
    maker: "Maker commits p_j before Breaker answers.",
    breaker: "Breaker may block any of the 2s strip regions of the group.",
    invariant: "p_j lies in every cone of the group.",
    next: "Breaker answers with s points.",
  },
  breaker: {
    object: "A Breaker point, classified by the ledger against the strip regions of the groups.",
    why: "A group dies only when every one of its strip regions holds a point.",
    maker: "Maker does not react inside the phase.",
    breaker: "See the policy's reason below.",
    invariant: "The survivor lower bound counts units minus units already dead minus the kills the remaining points can still afford.",
    next: "After the budget is spent the groups are harvested.",
  },
  end: {
    object: "Harvest: each surviving group yields one extended strip, verified exactly; the strips are checked pairwise parallel.",
    why: "They are the input of the next level.",
    maker: "Maker extends one live strip per surviving group.",
    breaker: "Breaker's budget for this phase is spent.",
    invariant: "Survivors against the required number t, from the ledger.",
    next: "The next level starts from these strips, or the run ends.",
  },
};

const BICHRO: Record<"start" | "apex" | "breaker" | "end", PhaseExplanation> = {
  start: {
    object:
      "Pairing plan (Theorem 5): strips are paired as in the monochromatic case, but Breaker's points are blockers only. They are never adopted and never become strip vertices.",
    why: "In the bichromatic game a winning object may use Maker's points only, so a Breaker point on a boundary cannot be absorbed; instead the whole picture is tilted by a small dyadic amount so that no Breaker point lies in two regions.",
    maker: "Maker places one point p_j per pair; after the phase a tilt direction is chosen exactly.",
    breaker: "Breaker's points can only block candidates.",
    invariant: "After the tilt, every candidate is a strict strip and each Breaker point lies in at most one closed candidate (checked exactly).",
    next: "Maker places p_1, Breaker replies, and so on.",
  },
  apex: {
    object: "Maker's extension point p_j between the two strips of the pair.",
    why: "It is the shared vertex of the two candidate strips.",
    maker: "Maker commits p_j.",
    breaker: "Breaker may block either candidate.",
    invariant: "p_j keeps general position.",
    next: "Breaker answers with floor(m·s) points in total after Maker's m-th point.",
  },
  breaker: {
    object: "A Breaker point (blocker only).",
    why: "Each point spoils at most one candidate after the tilt, so at most ⌊B/2⌋ whole pairs can be lost for a budget of B points.",
    maker: "Maker does not react inside the phase.",
    breaker: "See the policy's reason below.",
    invariant: "Breaker points are never vertices of a claimed strip.",
    next: "After the budget is spent the tilt is chosen and the pairs are harvested.",
  },
  end: {
    object: "Tilt and harvest: a common direction is chosen, then one Maker-only strip per surviving pair is verified exactly against every point of the board.",
    why: "The claimed strips are parallel in the tilted direction and contain no point of either colour in their region.",
    maker: "Maker keeps one live candidate per surviving pair.",
    breaker: "Breaker's budget for this phase is spent.",
    invariant: "Claimed strips are Maker-only, and the closed regions hold no other point.",
    next: "The next level starts from these strips, or the run ends.",
  },
};

export function explainStep(
  phase: PhaseKind | null,
  stepKind: "start" | "move" | "end" | "result",
  moveKind: "base-point" | "apex" | "breaker" | null,
): PhaseExplanation | null {
  if (phase === null || stepKind === "result") {
    return null;
  }
  if (phase === "base" || phase === "bichromatic-base") {
    return BASE;
  }
  const table = phase === "pairing" ? PAIRING : phase === "grouping" ? GROUPING : BICHRO;
  if (stepKind === "start") {
    return table.start;
  }
  if (stepKind === "end") {
    return table.end;
  }
  return moveKind === "breaker" ? table.breaker : table.apex;
}

export const RESULT_TEXT: Readonly<Record<string, string>> = {
  completed:
    "Completed: the goal number of strips was reached and every claimed strip passed the exact re-check. This is the result of this run against this policy.",
  "budget-exhausted": "Budget exhausted during execution: the run stopped part-way and claims nothing.",
  refused: "Refused before execution: the estimate exceeded the default budget, so nothing ran.",
  unsupported: "Unsupported parameters: nothing ran.",
  "invalid-breaker-move": "A Breaker move was illegal: the run stopped and claims nothing.",
  "invariant-failure": "An exact check failed: the run stopped and claims nothing.",
  "awaiting-breaker-move": "Waiting for your next Breaker point.",
};
