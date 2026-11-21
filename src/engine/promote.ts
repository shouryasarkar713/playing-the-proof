// engine/promote.ts — generic, PURE promotion: a finished k-hole Maker win
// becomes the StrategyStart of the (k+1) session (k=5 → k=6 → k=7). The UI's
// "Grow to N" button calls this instead of re-implementing the ladder (the
// existing ui/modes/promote.ts is the k=5→6 special case of the same rule).
//
// Sound only when the (k+1)-phase precondition holds: the win must be a Maker
// win with a k-hole witness whose completion left an ODD number of points
// (Breaker to move). A win completed by Breaker's own point leaves Maker to
// move — then Maker simply extends the hole (no two-round construction).
import { hull } from "../geometry/hull.ts";
import { eqPt } from "../geometry/pt.ts";
import type { Pt } from "../geometry/pt.ts";
import { N_BOOTSTRAP_EXACT } from "../geometry/holes.ts";
import type { GameState, KHole, StrategyStart } from "../game/types.ts";

export type GrowBlock =
  | "not-a-finished-win"
  | "wrong-k"
  | "breaker-completed-hole"
  | "too-many-points"
  | "bad-witness";

export type GrowResult =
  | { ok: true; start: StrategyStart }
  | { ok: false; reason: GrowBlock; message: string };

const MESSAGES: Record<GrowBlock, string> = {
  "not-a-finished-win": "Growing needs a finished Maker win.",
  "wrong-k": "Growing is defined for k=5→6 and k=6→7 wins only.",
  "breaker-completed-hole":
    "Breaker's own last point completed this hole, so it is Maker's turn: Maker simply extends the hole. The two-round strategy starts with Breaker to move, so it does not apply here.",
  "too-many-points": `The next phase starts from at most ${N_BOOTSTRAP_EXACT} points (exact bootstrap bound).`,
  "bad-witness": "The winning witness is not a canonical convex hole of the right size.",
};

function fail(reason: GrowBlock): GrowResult {
  return { ok: false, reason, message: MESSAGES[reason] };
}

export function growStartFromWin(state: GameState): GrowResult {
  if (state.terminal?.kind !== "maker-won") {
    return fail("not-a-finished-win");
  }
  if (state.k !== 5 && state.k !== 6) {
    return fail("wrong-k");
  }
  if (state.points.length % 2 === 0) {
    return fail("breaker-completed-hole");
  }
  if (state.points.length > N_BOOTSTRAP_EXACT) {
    return fail("too-many-points");
  }
  const witness: KHole | undefined = state.terminal.witness[0];
  if (witness === undefined || witness.verts.length !== state.k) {
    return fail("bad-witness");
  }
  const pts: Pt[] = [];
  for (const id of witness.verts) {
    const found = state.points.find((p) => p.id === id);
    if (found === undefined) {
      return fail("bad-witness");
    }
    pts.push(found.pt);
  }
  const h = hull(pts);
  if (h.length !== pts.length || !h.every((q, i) => eqPt(q, pts[i] as Pt))) {
    return fail("bad-witness");
  }
  return {
    ok: true,
    start: {
      kind: "continue",
      points: state.points.map((p) => p.pt),
      owners: state.points.map((p) => p.owner),
      selectedHole: pts,
    },
  };
}
