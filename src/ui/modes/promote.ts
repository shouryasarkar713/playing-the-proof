// ui/modes/promote.ts — the k=5 → k=6 promotion flow (§24.0b, §11.7):
// the win card's "Grow to 6" button assembles the RESOLVED continue record
// from the finished k=5 session and boots the k=6 session in the same mode.
// Corrupt source records degrade to selectedHole=null (fallback ladder),
// never a crash; ladder rejections surface as toasts with the typed error.
import { holeToPointList } from "../../engine/init.ts";
import type { BootstrapError } from "../../engine/init.ts";
import { growStartFromWin } from "../../engine/promote.ts";
import type { StrategyStart } from "../../game/types.ts";
import type { Shell } from "../app.ts";

export function bootstrapErrorText(error: BootstrapError): string {
  switch (error.code) {
    case "malformed-input":
    case "not-gp-or-window":
      return `${error.code}: ${error.detail}`;
    case "invalid-hole":
      return `invalid-hole: ${error.operands}`;
    case "parity":
      return `parity: ${error.count} points, Breaker to move required`;
    case "missing-witness":
      return "missing-witness: the source record contains no 5-hole";
  }
}

// growToSixBlock: the k=6 phase begins with Breaker to move
// (odd placed count, §24.0b P4). A k=5 win that ENDS ON A BREAKER PLACEMENT
// (Breaker's own point completed the 5-hole, §3.12) leaves an even count with
// Maker to move: Lemma 7's two-round construction does not apply — Maker just
// extends the existing 5-hole by the generic extension principle. Returns the
// honest reason (button disabled, never a bootstrap-parity error toast), or
// null when the promotion is available.
export function growToSixBlock(state: {
  readonly k: number;
  readonly points: readonly unknown[];
  readonly terminal: { readonly kind: string } | null;
}): string | null {
  if (state.terminal?.kind !== "maker-won" || state.k !== 5) {
    return "Grow to 6 needs a finished k=5 Maker win.";
  }
  if (state.points.length % 2 === 0) {
    return "Breaker's own last point completed this 5-hole, so it is Maker's turn: Maker simply extends the hole to a 6-hole. The two-round k=6 strategy starts with Breaker to move, so it does not apply here.";
  }
  return null;
}

// assembleContinue: points/owners verbatim in placement order; selectedHole
// from the canonical-first witness (data order, not display order) via the
// formal conversion — null on ANY conversion failure (fallback ladder).
export function assembleContinue(shell: Shell): StrategyStart | null {
  const state = shell.store.current();
  if (state.terminal?.kind !== "maker-won" || state.k !== 5) {
    return null;
  }
  const witness = state.terminal.witness[0];
  const points = state.points.map((p) => p.pt);
  const owners = state.points.map((p) => p.owner);
  if (witness === undefined) {
    return { kind: "continue", points, owners, selectedHole: null };
  }
  const conv = holeToPointList(witness, state.points);
  return {
    kind: "continue",
    points,
    owners,
    selectedHole: conv.ok ? [...conv.pts] : null,
  };
}

export function growToSix(
  shell: Shell,
  toast: (message: string) => void,
  mode: "proof" | "break",
): void {
  const blocked = growToSixBlock(shell.store.current());
  if (blocked !== null) {
    toast(blocked);
    return;
  }
  const record = assembleContinue(shell);
  if (record === null) {
    toast("Grow to 6 needs a finished k=5 Maker win.");
    return;
  }
  if (mode === "proof") {
    shell.startProof("esmb-k6", record);
  } else {
    shell.startBreak("esmb-k6", record);
  }
}

// growToSevenBlock: the k=6 -> k=7 promotion (Lemma 8 phase). Same rule as the
// k=5 -> k=6 flow, decided by the generic engine ladder (engine/promote.ts);
// returns the honest reason or null when the promotion is available.
export function growToSevenBlock(
  state: Parameters<typeof growStartFromWin>[0],
): string | null {
  if (state.k !== 6) {
    return "Grow to 7 needs a finished k=6 Maker win.";
  }
  const r = growStartFromWin(state);
  return r.ok ? null : r.message;
}

export function growToSeven(
  shell: Shell,
  toast: (message: string) => void,
  mode: "proof" | "break",
): void {
  const r = growStartFromWin(shell.store.current());
  if (!r.ok) {
    toast(r.message);
    return;
  }
  if (mode === "proof") {
    shell.startProof("esmb-k7", r.start);
  } else {
    shell.startBreak("esmb-k7", r.start);
  }
}
