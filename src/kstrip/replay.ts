// kstrip/replay.ts — re-validate a move log without any policy: every move is
// re-checked for legality (general position; distinct x in the monochromatic
// base phase), frame consistency (ptFrame = T(pt)), numbering and ownership
// alternation (Maker's move starts each round).
import { eqPt } from "../geometry/pt.ts";
import type { Pt } from "../geometry/pt.ts";
import { Rat } from "../geometry/rat.ts";
import { canAdd } from "./pairing.ts";
import { frameOf, toFrame } from "./frame.ts";
import type { MoveLogEntry } from "./types.ts";

export interface ReplayResult {
  readonly ok: boolean;
  readonly failures: readonly string[];
  readonly points: readonly { readonly pt: Pt; readonly owner: "maker" | "breaker" }[];
}

export function replayLog(log: readonly MoveLogEntry[], monochromatic: boolean): ReplayResult {
  const failures: string[] = [];
  const pts: { pt: Pt; owner: "maker" | "breaker" }[] = [];
  let lastRound = 0;
  log.forEach((e, i) => {
    if (e.n !== i + 1) {
      failures.push(`move ${i + 1}: numbering ${e.n}`);
    }
    if (e.round < lastRound || e.round > lastRound + 1) {
      failures.push(`move ${e.n}: round jumps from ${lastRound} to ${e.round}`);
    }
    if (e.round === lastRound + 1 && e.player !== "maker") {
      failures.push(`move ${e.n}: a round must start with Maker`);
    }
    lastRound = e.round;
    const frame = frameOf({ x: Rat.fromString(e.frameC).neg(), y: Rat.make(-1n) });
    const f = toFrame(frame, e.pt);
    if (!eqPt(f, e.ptFrame)) {
      failures.push(`move ${e.n}: ptFrame is not T(pt)`);
    }
    const base = pts.map((p) => p.pt);
    if (!canAdd(base, e.pt)) {
      failures.push(`move ${e.n}: not in general position`);
    }
    if (monochromatic && (e.phase === "base") && pts.some((p) => p.pt.x.equals(e.pt.x))) {
      // x equality is frame-independent in the identity-frame monochromatic game
      failures.push(`move ${e.n}: repeated x in the base phase`);
    }
    if ((e.kind === "breaker") !== (e.player === "breaker")) {
      failures.push(`move ${e.n}: kind/player mismatch`);
    }
    pts.push({ pt: e.pt, owner: e.player });
  });
  return { ok: failures.length === 0, failures, points: pts };
}
