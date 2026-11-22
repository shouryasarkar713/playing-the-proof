// explain/bias.ts — wording for the bias 1:s turn order (pure; L4).
// Strings avoid every ClaimLint forbidden word and describe the RULE of the
// selected model only.
import type { Rat } from "../geometry/rat.ts";

export function biasLabel(bias: Rat | undefined): string {
  if (bias === undefined) {
    return "1:1";
  }
  return bias.d === 1n ? `1:${String(bias.n)}` : `1:${String(bias.n)}/${String(bias.d)}`;
}

export function biasCaption(bias: Rat | undefined): string {
  if (bias === undefined || (bias.n === 1n && bias.d === 1n)) {
    return "Bias 1:1: Maker and Breaker alternate, Maker first.";
  }
  if (bias.n === 0n) {
    return "Bias 1:0: Breaker places no points; Maker moves every turn.";
  }
  if (bias.d === 1n) {
    return `Bias ${biasLabel(bias)}: after each Maker point Breaker places ${String(bias.n)} point${bias.n === 1n ? "" : "s"}; Maker moves first.`;
  }
  return `Bias ${biasLabel(bias)}: after Maker's r-th point Breaker has placed floor(${String(bias.n)}r/${String(bias.d)}) points in total; Maker moves first (this project's rule for non-integer bias).`;
}

export const OUT_OF_TURN_TEXT =
  "Out of turn: under this bias the other player is to move.";
