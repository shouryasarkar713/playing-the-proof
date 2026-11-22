// game/turnorder.ts — bias 1:s turn order (pure; imports geometry/ only).
//
// Source (Dzuklevski et al., Sec. 1): speeds sM:sB, normalised to sM = 1 or
// sB = 1; for integer s Breaker places s points per Maker point; for
// non-integer speeds the sources order the multiset {i*sM} ∪ {i*sB}
// increasingly with ties in favour of Maker. As written that convention is
// ambiguous (read literally, a larger s would give Breaker FEWER moves, and
// it does not say who starts). This project therefore fixes ONE exact rule,
// valid for every rational s >= 0:
//
//   Maker always moves first. After Maker's r-th point Breaker has placed
//   exactly floor(s*r) points in total (cumulative floor), and Maker moves
//   again as soon as Breaker has placed that many.
//
// Equivalently, Breaker's j-th point follows Maker's ceil(j/s)-th point (when
// j/s is an integer the tie goes to Maker, who moves first). For s = 1 this is
// strict alternation; for integer s it is s Breaker points per Maker point;
// for s < 1 Maker sometimes moves several times in a row (s = 1/2 gives
// M M B M M B ...); s = 0 is Maker only. This is the project's convention,
// not a quotation of the sources.
//
// An absent bias means 1:1 and is represented by the ABSENCE of the field
// everywhere (GameState.bias, SessionConfig.bias, replay config), so every
// 1:1 state, hash and replay file is identical to the unbiased format.
import { Rat } from "../geometry/rat.ts";
import type { Player } from "./types.ts";

// The engine holds at most 64 points, so a larger s cannot be played out;
// the denominator bound keeps the rule simple and the arithmetic small.
export const BIAS_MAX = 64n;
export const BIAS_MAX_DENOMINATOR = 1000n;

export function isUnitBias(b: Rat | undefined): boolean {
  return b === undefined || (b.n === 1n && b.d === 1n);
}

// 1:1 is stored as absence.
export function normalizeBias(b: Rat | undefined): Rat | undefined {
  return isUnitBias(b) ? undefined : b;
}

// null = acceptable; otherwise the reason.
export function validateBias(b: Rat): string | null {
  if (b.n < 0n) {
    return "bias must be >= 0";
  }
  if (b.d > BIAS_MAX_DENOMINATOR) {
    return `bias denominator must be <= ${String(BIAS_MAX_DENOMINATOR)}`;
  }
  if (b.n > BIAS_MAX * b.d) {
    return `bias must be <= ${String(BIAS_MAX)}`;
  }
  return null;
}

// Breaker's cumulative quota after Maker's r-th point: floor(s*r) (absent = 1).
export function breakerQuota(bias: Rat | undefined, makerMoves: number): number {
  if (bias === undefined) {
    return makerMoves;
  }
  return Number((bias.n * BigInt(makerMoves)) / bias.d);
}

// Who moves next, given how many points each player has placed.
export function nextMover(
  bias: Rat | undefined,
  makerCount: number,
  breakerCount: number,
): Player {
  return breakerCount < breakerQuota(bias, makerCount) ? "breaker" : "maker";
}

// Owners of the first n placements, in order.
export function turnSequence(bias: Rat | undefined, n: number): Player[] {
  const out: Player[] = [];
  let m = 0;
  let b = 0;
  for (let i = 0; i < n; i += 1) {
    const who = nextMover(bias, m, b);
    out.push(who);
    if (who === "maker") {
      m += 1;
    } else {
      b += 1;
    }
  }
  return out;
}

// Owner of the placement with 0-based index i.
export function moverAt(bias: Rat | undefined, index: number): Player {
  return turnSequence(bias, index + 1)[index] as Player;
}

// Round of a position: round r begins with Maker's r-th point and includes
// the Breaker block that follows it (0 before the first point).
export function roundOf(makerCount: number): number {
  return makerCount;
}

export function biasToWire(b: Rat | undefined): string {
  return b === undefined ? "1/1" : b.toString();
}

// Canonical wire form "n/d" only (reduced, d > 0); null otherwise.
export function biasFromWire(s: string): Rat | null {
  const m = /^(\d+)\/(\d+)$/.exec(s);
  if (m === null) {
    return null;
  }
  const d = BigInt(m[2] as string);
  if (d === 0n) {
    return null;
  }
  const r = Rat.make(BigInt(m[1] as string), d);
  return r.toString() === s ? r : null;
}
